import { test, expect, type Page } from '@playwright/test';
import { catalogToState } from '../../server/catalog';
import type { CatalogRepo } from '../../server/catalog';

/** Screen point (page CSS px) at the middle of a spine's face, projected with the live camera. */
async function spinePoint(page: Page, name: string): Promise<{ x: number; y: number }> {
  await expect.poll(() => page.evaluate(() => Boolean((window as never as { __wall?: unknown }).__wall))).toBe(true);
  return page.evaluate((bookName) => {
    const w = window as unknown as {
      __wall: { getState(): { layout: { spines: { repo: { name: string }; x: number; y: number; w: number; h: number }[] } } };
      __r3f: { camera: { projectionMatrix: { elements: number[] }; matrixWorldInverse: { elements: number[] } }; gl: { domElement: HTMLCanvasElement } };
    };
    const s = w.__wall.getState().layout.spines.find((x) => x.repo.name === bookName);
    if (!s) throw new Error(`no spine ${bookName}`);
    const p = [s.x + s.w / 2, s.y + s.h * 0.45, 0, 1];
    const mul = (m: number[], v: number[]) => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
    const c = mul(w.__r3f.camera.projectionMatrix.elements, mul(w.__r3f.camera.matrixWorldInverse.elements, p));
    const rect = w.__r3f.gl.domElement.getBoundingClientRect();
    return { x: rect.left + ((c[0] / c[3] + 1) / 2) * rect.width, y: rect.top + ((1 - c[1] / c[3]) / 2) * rect.height };
  }, name);
}

/** Book names in wall order, and the bay (shelf label) each stands in. The fixture is shared and mutated by shelf.spec.ts, so read it live. */
async function wallBooks(page: Page): Promise<{ name: string; shelf: string }[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __wall: { getState(): { layout: { bays: { shelf: { label: string } }[]; spines: { repo: { name: string }; bay: number }[] } } } };
    const L = w.__wall.getState().layout;
    return L.spines.map((s) => ({ name: s.repo.name, shelf: L.bays[s.bay].shelf.label }));
  });
}

test.describe('spine-out wall (folder shelves)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.status.ok')).toBeVisible();
    await expect(page.locator('.plate').first()).toContainText('Alpha Shelf');
  });

  test('every category is its own bay with a name plate, empty ones included', async ({ page }) => {
    await expect(page.locator('.plates .plate')).toHaveCount(2);
    await expect(page.locator('.plates .plate').nth(1)).toContainText('Beta Shelf');
    const books = await wallBooks(page);
    const inBeta = books.filter((b) => b.shelf === 'Beta Shelf').length;
    await expect(page.locator('.plates .plate').nth(1)).toContainText(`${inBeta} ${inBeta === 1 ? 'repo' : 'repos'}`);
  });

  test('hovering a spine shows its tooltip; clicking folds it out; another click swaps the window', async ({ page }) => {
    const [first, second] = await wallBooks(page);
    const a = await spinePoint(page, first.name);
    await page.mouse.move(a.x, a.y);
    await expect(page.locator('.spine-tip .tip-title')).toBeVisible();
    await expect(page.locator('.spine-tip')).toContainText('commits');
    await page.mouse.click(a.x, a.y);
    await expect(page.locator('.book-window .panel-slug')).toHaveText(first.name);
    await expect(page.locator('.book-viewer canvas')).toBeVisible();
    const b = await spinePoint(page, second.name);
    await page.mouse.click(b.x, b.y);
    await expect(page.locator('.book-window .panel-slug')).toHaveText(second.name);
    await expect(page.locator('.book-window')).toHaveCount(1);
  });

  test('arrow keys walk the spines, Enter opens, Esc closes', async ({ page }) => {
    const books = await wallBooks(page);
    await page.locator('canvas').first().hover({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.spine-ring')).toBeVisible();
    await expect(page.locator('.wall-overlay [aria-live]')).toContainText('Press Enter to open');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('.book-window .panel-slug')).toHaveText(books[1].name);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(page.locator('.book-window .panel-slug')).toHaveText(books[0].name);
    await page.keyboard.press('Escape');
    await expect(page.locator('.book-window')).toHaveCount(0);
  });

  test('dragging a folder book onto another bay asks to move it', async ({ page }) => {
    const [first] = await wallBooks(page);
    const from = await spinePoint(page, first.name);
    const plate = await page.locator('.plates .plate').nth(1).boundingBox();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y, { steps: 4 });
    await page.mouse.move(plate!.x + plate!.width / 2, from.y, { steps: 10 });
    await expect(page.locator('.plate-active')).toContainText('Beta Shelf');
    await page.mouse.up();
    await expect(page.locator('.modal')).toContainText('Beta Shelf');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
  });
});

function catalogRepo(name: string, fork: boolean, ahead: number): CatalogRepo {
  return {
    name, full_name: `ivangegovdve-sudo/${name}`, fork, upstream: fork ? `upstream-org/${name}` : null, commits_ahead: ahead,
    last_push: '2026-09-01T00:00:00Z', language: 'Python', topics: ['voice'], summary: `${name} turns speech into text for voice agents.`,
    card_path: `cards/${name}.md`, card_generated_at: '2026-09-20T00:00:00Z', stale: false, confidence: 'high', verification_status: 'verified', topics_source: 'curated',
  };
}

test.describe('spine-out wall (published catalog)', () => {
  test.beforeEach(async ({ page }) => {
    const repos = [catalogRepo('echo-original', false, 0), catalogRepo('echo-adapted', true, 5), catalogRepo('echo-reference', true, 0)];
    const state = catalogToState({ schema_version: 1, generated_at: '2026-09-25T00:00:00Z', source: 'e2e', repo_count: repos.length, repos });
    await page.addInitScript((data) => {
      (window as unknown as { __SHELF_STATIC: unknown }).__SHELF_STATIC = data;
    }, { owner: 'ivangegovdve-sudo', title: 'E2E library', generatedAt: '2026-09-25T00:00:00Z', sourceUrl: 'https://example.com', shelves: state.shelves, repos: state.repos, pages: {} });
    await page.goto('/');
    await expect(page.locator('.plate').first()).toContainText('Voice & Audio');
  });

  test('shelves Ivan’s work before reference copies and names the upstream on hover', async ({ page }) => {
    const order = await page.evaluate(() =>
      (window as unknown as { __wall: { getState(): { layout: { spines: { repo: { name: string }; edition: string }[] } } } }).__wall
        .getState()
        .layout.spines.map((s) => `${s.edition}:${s.repo.name}`),
    );
    expect(order).toEqual(['original:echo-original', 'adapted:echo-adapted', 'reference:echo-reference']);
    const ref = await spinePoint(page, 'echo-reference');
    await page.mouse.move(ref.x, ref.y);
    await expect(page.locator('.spine-tip .tip-edition')).toContainText('Reference copy');
    await expect(page.locator('.spine-tip .tip-upstream')).toHaveText('Copy of upstream-org/echo-reference');
    await expect(page.locator('.spine-tip')).toContainText('Not Ivan’s work');
    const adapted = await spinePoint(page, 'echo-adapted');
    await page.mouse.move(adapted.x, adapted.y);
    await expect(page.locator('.spine-tip .tip-upstream')).toHaveText('Forked from upstream-org/echo-adapted');
  });

  test('the fold-out window leads with the attribution and links upstream', async ({ page }) => {
    const ref = await spinePoint(page, 'echo-reference');
    await page.mouse.click(ref.x, ref.y);
    const win = page.locator('.book-window');
    await expect(win.locator('.bw-edition')).toHaveText('Reference copy');
    await expect(win.locator('.attribution-upstream')).toHaveAttribute('href', 'https://github.com/upstream-org/echo-reference');
    await expect(win.getByRole('link', { name: 'View upstream source ↗' })).toHaveAttribute('href', 'https://github.com/upstream-org/echo-reference');
    await expect(win.getByRole('link', { name: 'View Ivan’s fork ↗' })).toHaveAttribute('href', 'https://github.com/ivangegovdve-sudo/echo-reference');
    await expect(win).toContainText('Last push');
    await expect(win).toContainText('Python');
    await expect(win.locator('.book-right')).toHaveCount(0);
  });
});
