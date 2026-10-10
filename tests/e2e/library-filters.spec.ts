import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { catalogToState, type CatalogRepo } from '../../server/catalog';
import { sanitizeForPublish, type StaticShelfData } from '../../server/publish';

const books: CatalogRepo[] = [
  { name: 'zero-stars', language: 'Python', topics: ['voice'], stars: 0, last_push: '2026-01-01T00:00:00Z' },
  { name: 'one-star', language: 'TypeScript', topics: ['voice'], stars: 1, last_push: '2026-10-02T00:00:00Z' },
  { name: 'five-stars', language: 'Python', topics: ['voice', 'ai'], stars: 5, last_push: '2026-09-01T00:00:00Z' },
  { name: 'leading-python', language: 'Python', topics: ['voice', 'ai'], stars: 100, last_push: '2026-10-08T00:00:00Z' },
  { name: 'leading-typescript', language: 'TypeScript', topics: ['voice', 'ai'], stars: 100, last_push: '2026-10-07T00:00:00Z' },
].map<CatalogRepo>((repo) => ({
  ...repo, full_name: `library-e2e/${repo.name}`, fork: false, upstream: null, commits_ahead: 0,
  summary: `${repo.name} is a voice library.`, card_path: '', card_generated_at: '', stale: false,
  confidence: 'high', verification_status: 'verified', topics_source: 'test',
}));

const library = catalogToState({ schema_version: 1, generated_at: '2026-10-10T00:00:00Z', source: 'e2e', repo_count: books.length, repos: books });
// No account refresh: these tests exercise fixed API-derived metadata independently of GitHub uptime.
const data = {
  ...sanitizeForPublish(library, null), owner: null, title: 'Library filters test',
  generatedAt: '2026-10-10T00:00:00Z', sourceUrl: 'https://example.com', pages: {},
};

async function loadLibrary(page: Page, fixture = data): Promise<void> {
  await page.addInitScript((embedded) => {
    (window as unknown as { __SHELF_STATIC: unknown }).__SHELF_STATIC = embedded;
    localStorage.removeItem('repo-shelf.view');
  }, fixture);
  await page.goto('/');
  const count = fixture.repos.length.toLocaleString();
  await expect(page.locator('.filter-result')).toHaveText(`${count} / ${count} repos`);
  await expect(page.getByRole('button', { name: '3D Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __wallStats?: unknown }).__wallStats))).toBe(true);
}

interface CullStats {
  threshold: number;
  visible: number;
  targetVisible: number;
  animating: number;
  books: { id: string; stars: number; visibility: number; eligible: boolean; x: number; y: number; pull: number }[];
}

async function cullStats(page: Page): Promise<CullStats> {
  // Switching back from the list remounts WebGL; wait for the new field, never read a disposed one.
  await page.waitForFunction(() => typeof (window as unknown as { __wallStats?: unknown }).__wallStats === 'function');
  return page.evaluate(() => (window as unknown as { __wallStats(): { culling: CullStats } }).__wallStats().culling);
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function indexNames(page: Page): Promise<string[]> {
  return page.locator('#book-index button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-book')!).sort());
}

async function layoutPositions(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const wall = (window as unknown as {
      __wall: { getState(): { layout: { spines: { repo: { name: string }; x: number; y: number; w: number; h: number }[] } } };
    }).__wall;
    return wall.getState().layout.spines.map((spine) => ({ name: spine.repo.name, x: spine.x, y: spine.y, w: spine.w, h: spine.h }));
  });
}

async function setStarStep(page: Page, value: number): Promise<void> {
  await page.getByRole('slider', { name: 'Star threshold' }).evaluate((input, step) => {
    const range = input as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(range, String(step));
    range.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('language, topic, date and star filters stay in sync across the 3D and list views', async ({ page }) => {
  await loadLibrary(page);
  await page.getByRole('combobox', { name: 'Primary language', exact: true }).selectOption('Python');
  await expect(page.locator('.filter-result')).toHaveText('3 / 5 repos');
  await page.getByRole('combobox', { name: 'Topic / tag', exact: true }).selectOption('ai');
  await expect(page.locator('.filter-result')).toHaveText('2 / 5 repos');
  await page.getByLabel('Updated since', { exact: true }).fill('2026-10-01');
  await expect.poll(() => indexNames(page)).toEqual(['leading-python']);
  await expect(page.locator('.filter-result')).toHaveText('1 / 5 repos');
  await expect.poll(async () => (await cullStats(page)).targetVisible).toBe(1);

  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.repo-list-row')).toHaveCount(1);
  await expect(page.locator('.repo-list-row')).toContainText('Leading Python');
  await setStarStep(page, 1);
  await expect(page.locator('#star-readout')).toContainText('100');
  await expect(page.locator('.repo-list-row')).toHaveCount(1);
  await page.getByRole('button', { name: '3D Library', exact: true }).click();
  await expect.poll(() => indexNames(page)).toEqual(['leading-python']);
  await expect.poll(async () => (await cullStats(page)).targetVisible).toBe(1);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.filter-result')).toHaveText('5 / 5 repos');
  await expect(page.getByRole('combobox', { name: 'Primary language', exact: true })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Topic / tag', exact: true })).toHaveValue('all');
  await expect(page.getByLabel('Updated since', { exact: true })).toHaveValue('');
  await expect(page.getByRole('slider', { name: 'Star threshold' })).toHaveValue('0');
});

test('keyboard star tiers remove the least-starred books first, preserve tied leaders and keep their shelf slots', async ({ page }) => {
  await loadLibrary(page);
  const range = page.getByRole('slider', { name: 'Star threshold' });
  await expect(range).toHaveAttribute('max', '3');
  const positions = await layoutPositions(page);
  await range.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => indexNames(page)).toEqual(['five-stars', 'leading-python', 'leading-typescript', 'one-star']);
  await expect(page.locator('#star-readout')).toContainText('1');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => indexNames(page)).toEqual(['five-stars', 'leading-python', 'leading-typescript']);
  await page.keyboard.press('End');
  await expect.poll(() => indexNames(page)).toEqual(['leading-python', 'leading-typescript']);
  await expect(page.locator('#star-readout')).toContainText('100');
  await expect(page.locator('#star-readout')).toContainText('2 books remain');
  await expect.poll(async () => {
    const stats = await cullStats(page);
    return [stats.threshold, stats.targetVisible, stats.visible, stats.animating];
  }).toEqual([100, 2, 2, 0]);
  expect(await layoutPositions(page)).toEqual(positions);
  await page.keyboard.press('Home');
  await expect.poll(() => indexNames(page)).toEqual(books.map((book) => book.name).sort());
  await expect(page.locator('#star-readout')).toContainText('5 books remain');
  await expect.poll(async () => {
    const stats = await cullStats(page);
    return [stats.targetVisible, stats.visible, stats.animating];
  }).toEqual([5, 5, 0]);
  expect(await layoutPositions(page)).toEqual(positions);
});

test('star culling visibly animates in ascending tiers and reverses during an unfinished transition', async ({ page }) => {
  const renderErrors: string[] = [];
  page.on('pageerror', (error) => renderErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /WebGL|Shader|THREE\./i.test(message.text())) renderErrors.push(message.text());
  });
  await loadLibrary(page);
  await setStarStep(page, 3);
  let exiting!: CullStats;
  await expect.poll(async () => {
    const stats = await cullStats(page);
    exiting = stats;
    return stats.targetVisible === 2 && stats.animating > 0 && stats.books.some((book) => book.visibility > 0 && book.visibility < 1);
  }, { intervals: [20, 20, 50] }).toBe(true);
  const lowerTiers = exiting.books.filter((book) => book.stars < 100).sort((a, b) => a.stars - b.stars);
  expect(lowerTiers[0].visibility).toBeLessThanOrEqual(lowerTiers[1].visibility);
  expect(lowerTiers[1].visibility).toBeLessThanOrEqual(lowerTiers[2].visibility);
  expect(lowerTiers[0].visibility).toBeLessThan(lowerTiers[2].visibility);
  expect(exiting.books.filter((book) => book.stars === 100).every((book) => book.visibility === 1)).toBe(true);

  await setStarStep(page, 0);
  await expect.poll(async () => {
    const stats = await cullStats(page);
    return stats.targetVisible === 5 && stats.animating > 0;
  }, { intervals: [20, 20, 50] }).toBe(true);
  await expect.poll(async () => {
    const stats = await cullStats(page);
    return [stats.visible, stats.animating];
  }).toEqual([5, 0]);
  expect((await cullStats(page)).books.every((book) => book.visibility === 1)).toBe(true);

  // Retarget repeatedly while moving; the last request must restore every actual instance.
  for (const step of [1, 3, 2, 0]) {
    await setStarStep(page, step);
    await nextFrames(page);
  }
  await expect.poll(async () => {
    const stats = await cullStats(page);
    return [stats.targetVisible, stats.visible, stats.animating];
  }).toEqual([5, 5, 0]);
  await expect.poll(() => indexNames(page)).toEqual(books.map((book) => book.name).sort());
  expect(renderErrors).toEqual([]);
});

test('narrowing to an unstarred repository restores a reachable slider threshold', async ({ page }) => {
  await loadLibrary(page);
  await setStarStep(page, 3);
  await expect(page.locator('.filter-result')).toHaveText('2 / 5 repos');
  await page.getByLabel('Search repos').fill('zero-stars');
  await expect(page.locator('.filter-result')).toHaveText('1 / 5 repos');
  await expect(page.getByRole('slider', { name: 'Star threshold' })).toHaveValue('0');
  await expect(page.locator('#star-readout')).toContainText('0+');
  await expect(page.getByLabel('Search repos')).toHaveValue('zero-stars');
  await expect.poll(async () => {
    const stats = await cullStats(page);
    return [stats.threshold, stats.targetVisible, stats.visible, stats.animating];
  }).toEqual([0, 1, 1, 0]);
});

test('reduced motion snaps culling and restoration without an animated transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadLibrary(page);
  await setStarStep(page, 3);
  await nextFrames(page);
  const culled = await cullStats(page);
  expect([culled.threshold, culled.targetVisible, culled.visible, culled.animating]).toEqual([100, 2, 2, 0]);
  expect(culled.books.filter((book) => book.stars < 100).every((book) => book.visibility === 0)).toBe(true);
  await setStarStep(page, 0);
  await nextFrames(page);
  const restored = await cullStats(page);
  expect([restored.targetVisible, restored.visible, restored.animating]).toEqual([5, 5, 0]);
});

test('empty results can be cleared in either view and list books open the same detail panel', async ({ page }) => {
  await loadLibrary(page);
  await page.getByLabel('Search repos').fill('no-repository-matches');
  await expect(page.locator('.filter-result')).toHaveText('0 / 5 repos');
  await expect(page.getByRole('heading', { name: 'No matching repositories' })).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching repositories' })).toBeVisible();
  await expect(page.locator('.repo-list-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page.locator('.repo-list-row')).toHaveCount(5);
  await page.locator('.repo-list-row').filter({ hasText: 'Leading Python' }).click();
  await expect(page.getByRole('dialog').locator('.panel-slug')).toHaveText('library-e2e/leading-python');
  await page.getByRole('button', { name: '3D Library', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.panel-slug')).toHaveText('library-e2e/leading-python');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the list loads more repositories on demand and resets its page after sorting or filtering', async ({ page }) => {
  const entries = Array.from({ length: 65 }, (_, i) => ({
    ...books[0], name: `index-book-${i}`, full_name: `library-e2e/index-book-${i}`,
    stars: i, summary: `Index book ${i} is a voice library.`,
  }));
  const state = catalogToState({ schema_version: 1, generated_at: data.generatedAt, source: 'e2e', repo_count: entries.length, repos: entries });
  await loadLibrary(page, { ...data, ...sanitizeForPublish(state, null) });
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.repo-list-row')).toHaveCount(60);
  await page.getByRole('button', { name: 'Show 5 more' }).click();
  await expect(page.locator('.repo-list-row')).toHaveCount(65);
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('stars');
  await expect(page.locator('.repo-list-row')).toHaveCount(60);
  await expect(page.locator('.repo-list-row').first()).toHaveAttribute('data-repo-id', state.repos.find((repo) => repo.name === 'index-book-64')!.id);
  await page.getByLabel('Search repos').fill('index-book-64');
  await expect(page.locator('.repo-list-row')).toHaveCount(1);
  await expect(page.locator('.filter-result')).toHaveText('1 / 65 repos');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.repo-list-row')).toHaveCount(60);
});

test('filters, range and list remain usable without horizontal overflow on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadLibrary(page);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('combobox', { name: 'Primary language', exact: true }).selectOption('TypeScript');
  await expect(page.locator('.repo-list-row')).toHaveCount(2);
  await setStarStep(page, 2);
  await expect(page.locator('.repo-list-row')).toHaveCount(1);
  await expect(page.locator('.repo-list-row')).toContainText('Leading Typescript');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '3D Library', exact: true }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect.poll(() => indexNames(page)).toEqual(['leading-typescript']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('collapsing metadata filters keeps the star slider available and gives a dense shelf more room', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const snapshot = JSON.parse(fs.readFileSync(new URL('../../data/library.public.json', import.meta.url), 'utf8')) as StaticShelfData;
  await loadLibrary(page, { ...snapshot, owner: null });
  const canvas = page.locator('.scene-wrap canvas');
  const expandedHeight = (await canvas.boundingBox())!.height;
  await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show filters', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#language-filter')).toBeHidden();
  await expect(page.locator('[aria-label="Filter by top category"]')).toBeHidden();
  await expect(page.getByLabel('Search repos')).toBeVisible();
  await expect(page.getByRole('button', { name: '3D Library', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Star threshold' })).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())!.height).toBeGreaterThan(expandedHeight + 100);
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as {
      __wall: { getState(): { layout: { spines: { x: number; y: number; w: number; h: number }[] } } };
      __r3f: { camera: { position: { x: number; y: number; z: number }; fov: number; aspect: number; zoom: number } };
    };
    const camera = w.__r3f.camera;
    // The wall uses a perspective camera looking straight at its z=0 face.
    // Logical zoom changes its distance; camera.zoom is the physical projection zoom.
    const halfHeight = camera.position.z * Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
    const halfWidth = halfHeight * camera.aspect;
    const x0 = camera.position.x - halfWidth;
    const x1 = camera.position.x + halfWidth;
    const y0 = camera.position.y - halfHeight;
    const y1 = camera.position.y + halfHeight;
    return w.__wall.getState().layout.spines.filter((spine) => spine.x >= x0 && spine.x + spine.w <= x1 && spine.y >= y0 && spine.y + spine.h <= y1).length;
  })).toBeGreaterThanOrEqual(150);
  await page.getByRole('button', { name: 'Show filters', exact: true }).click();
  await expect(page.locator('#language-filter')).toBeVisible();
  await page.getByRole('combobox', { name: 'Primary language', exact: true }).selectOption('Python');
  const filteredCount = await page.locator('.filter-result').textContent();
  await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
  await expect(page.locator('.filter-result')).toHaveText(filteredCount!);
  await page.getByRole('button', { name: 'Show filters', exact: true }).click();
  await expect(page.locator('#language-filter')).toHaveValue('Python');
  await expect(page.locator('.filter-result')).toHaveText(filteredCount!);
});

test('a shelfie requested from List starts the 3D library and downloads a real PNG', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Intercept the save endpoint: exercising capture must never write exports beside real repos.
  await page.route('**/api/share/save', async (route) => {
    await route.fulfill({ json: { ok: true, file: '/tmp/e2e-shelfie.png', dir: '/tmp' } });
  });
  await page.addInitScript(() => localStorage.removeItem('repo-shelf.view'));
  await page.goto('/');
  await expect(page.locator('.status.ok')).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Share ▾', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  const saveEvent = page.waitForRequest('**/api/share/save');
  await page.getByRole('menuitem', { name: /^Shelfie \(PNG\)/ }).click();
  const [download, request] = await Promise.all([downloadEvent, saveEvent]);
  expect(download.suggestedFilename()).toMatch(/repo-shelf-\d{4}-\d{2}-\d{2}\.png$/);
  expect(await download.failure()).toBeNull();
  const payload = request.postDataJSON() as { name: string; dataUrl: string };
  expect(payload.name).toBe(download.suggestedFilename());
  expect(payload.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  const png = Buffer.from(payload.dataUrl.split(',')[1], 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(1600);
  await expect(page.getByRole('button', { name: '3D Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.scene-wrap canvas')).toBeVisible();
  await expect(page.locator('.toast.success')).toContainText('Saved');
  await expect(page.locator('.toast.error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('playing rewind from List opens 3D and switching back stops the timeline', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('repo-shelf.view'));
  await page.goto('/');
  await expect(page.locator('.status.ok')).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Share ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Play rewind here/ }).click();
  await expect(page.getByRole('button', { name: '3D Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.rewind')).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.rewind')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const state = (window as unknown as { __shelf: { getState(): { rewindPlaying: boolean; timeline: number | null } } }).__shelf.getState();
    return [state.rewindPlaying, state.timeline];
  })).toEqual([false, null]);
  await page.getByRole('button', { name: '3D Library', exact: true }).click();
  await expect(page.locator('.scene-wrap canvas')).toBeVisible();
  await expect(page.locator('.rewind')).toHaveCount(0);
});
