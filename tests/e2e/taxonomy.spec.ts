import { test, expect } from '@playwright/test';
import { catalogToState } from '../../server/catalog';
import { sanitizeForPublish } from '../../server/publish';

const entries = [
  { name: 'voice-original', topics: ['voice'], fork: false, upstream: null, commits_ahead: 0 },
  { name: 'voice-reference', topics: ['voice'], fork: true, upstream: 'upstream/voice', commits_ahead: 0 },
  { name: 'video-reference', topics: ['creative'], fork: true, upstream: 'upstream/video', commits_ahead: 0 },
  { name: 'agent-reference', topics: ['ai-agents'], fork: true, upstream: 'upstream/agent', commits_ahead: 0 },
].map((r) => ({ ...r, full_name: `ivangegovdve-sudo/${r.name}`, last_push: '', language: 'Python', summary: '', card_path: '', card_generated_at: '', stale: false, confidence: 'high', verification_status: 'verified', topics_source: 'test' }));
const library = catalogToState({ generated_at: '2026-10-03T00:00:00Z', repo_count: entries.length, repos: entries });
const data = { ...sanitizeForPublish(library, 'ivangegovdve-sudo'), owner: null, title: 'Taxonomy test library', generatedAt: '2026-10-03T00:00:00Z', sourceUrl: 'https://example.com', pages: {} };

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`multi-select category/color filters update actual 3D books, clear and upstream details at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((embedded) => { (window as unknown as { __SHELF_STATIC: unknown }).__SHELF_STATIC = embedded; }, data);
    await page.goto('/');
    await expect(page.locator('.filter-result')).toHaveText('4 / 4 repos');
    const categories = page.getByRole('group', { name: 'Filter by top category' });
    const colors = page.getByRole('group', { name: 'Filter by sub-category and color' });
    const wallCount = () => page.evaluate(() => (window as unknown as { __wall: { getState(): { layout: { spines: unknown[] } } } }).__wall.getState().layout.spines.length);
    await categories.getByRole('button', { name: /Creative & Media/ }).click();
    await colors.getByRole('button', { name: /Voice & Audio/ }).click();
    await expect(page.locator('.filter-result')).toHaveText('2 / 4 repos');
    await expect.poll(wallCount).toBe(2);
    await expect(page.locator('#book-index button')).toHaveCount(2);
    await colors.getByRole('button', { name: /Video & Creative/ }).click();
    await expect.poll(wallCount).toBe(3);
    await categories.getByRole('button', { name: /AI & Knowledge/ }).click();
    await colors.getByRole('button', { name: /Agents & Assistants/ }).click();
    await expect.poll(wallCount).toBe(4);
    await expect(page.locator('.active-filters')).toContainText('Active filters:');
    await page.getByLabel('Search repos').fill('voice');
    await expect.poll(wallCount).toBe(2);
    await page.getByLabel('Search repos').fill('nothing-matches');
    await expect.poll(wallCount).toBe(0);
    await expect(page.locator('.active-filters')).toContainText('No matching repos');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(wallCount).toBe(4);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-book="voice-reference"]').dispatchEvent('click');
    const panel = page.getByRole('dialog');
    await expect(panel.locator('.panel-slug')).toHaveText('upstream/voice');
    await expect(panel).not.toContainText('Ivan');
    await expect(panel.getByRole('link', { name: /View upstream source/ })).toHaveAttribute('href', 'https://github.com/upstream/voice');
  });
}
