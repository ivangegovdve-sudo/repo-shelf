import { test, expect } from '@playwright/test';
import { catalogToState, type CatalogRepo } from '../../server/catalog';
import { sanitizeForPublish } from '../../server/publish';
import type { SkillsIndex } from '../../src/skills';
import type { StaticShelfData } from '../../src/static';

const GENERATED_AT = '2026-10-17T12:00:00Z';
const COMMIT_SHA = 'f'.repeat(40);
const catalogEntries: CatalogRepo[] = [
  { name: 'audio-toolkit', language: 'Python', topics: ['voice'], summary: 'Speech and audio tools.' },
  { name: 'browser-toolkit', language: 'TypeScript', topics: ['web'], summary: 'Browser testing tools.' },
].map((repo) => ({
  ...repo, full_name: `skills-e2e/${repo.name}`, fork: false, upstream: null,
  commits_ahead: 0, last_push: '2026-10-16T12:00:00Z', stars: 0,
  card_path: '', card_generated_at: GENERATED_AT, stale: false,
  confidence: 'high', verification_status: 'verified', topics_source: 'test',
}));
const library = catalogToState({
  schema_version: 1, generated_at: GENERATED_AT, source: 'e2e',
  repo_count: catalogEntries.length, repos: catalogEntries,
});
const repoIds = new Map(library.repos.map((repo) => [repo.name, repo.id]));

const index: SkillsIndex = {
  schemaVersion: 1, generatedAt: GENERATED_AT, totalRepos: 2, scannedRepos: 2,
  sources: [
    {
      sourceSlug: 'skills-e2e/audio-toolkit', repoIds: [repoIds.get('audio-toolkit')!],
      sourceCategoryId: 'voice-audio', defaultBranch: 'main', commitSha: COMMIT_SHA,
      treeSha: 'e'.repeat(40), scannedAt: GENERATED_AT, status: 'complete',
      skills: [
        { name: 'Transcribe', description: 'Turn recordings into accurate text.', path: 'skills/transcribe/SKILL.md', blobSha: 'a'.repeat(40) },
        { name: 'Narrate', description: 'Create expressive spoken narration.', path: 'skills/narrate/SKILL.md', blobSha: 'b'.repeat(40) },
        { name: 'Mix Dialogue', description: 'Balance dialogue tracks for clear listening.', path: 'skills/mix-dialogue/SKILL.md', blobSha: 'c'.repeat(40) },
      ].map((skill) => ({
        ...skill, bytes: 512, categoryId: 'voice-audio', metadata: 'manifest',
        sourceUrl: `https://github.com/skills-e2e/audio-toolkit/blob/${COMMIT_SHA}/${skill.path}`,
      })),
    },
    {
      sourceSlug: 'skills-e2e/browser-toolkit', repoIds: [repoIds.get('browser-toolkit')!],
      sourceCategoryId: 'web-automation', defaultBranch: 'main', commitSha: COMMIT_SHA,
      treeSha: 'd'.repeat(40), scannedAt: GENERATED_AT, status: 'complete',
      skills: [{
        name: 'Browser Check', description: 'Check keyboard navigation on a website.',
        path: 'skills/browser-check/SKILL.md', blobSha: '9'.repeat(40), bytes: 512,
        categoryId: 'web-automation', metadata: 'manifest',
        sourceUrl: `https://github.com/skills-e2e/browser-toolkit/blob/${COMMIT_SHA}/skills/browser-check/SKILL.md`,
      }],
    },
  ],
};

const data: StaticShelfData = {
  ...sanitizeForPublish(library, null), owner: null, title: 'Skills library test',
  generatedAt: GENERATED_AT, sourceUrl: 'https://github.com/skills-e2e/library', pages: {},
  skills: {
    url: './skills-index.json',
    meta: {
      generatedAt: GENERATED_AT, totalRepos: 2, scannedRepos: 2, sourceCount: 2,
      completeSources: 2, partialSources: 0, unavailableSources: 0, skillCount: 4,
    },
  },
};

test('skills folders reflect category volume, filter and search public sources, and preserve the repository list', async ({ page }) => {
  let indexRequests = 0;
  await page.route('**/skills-index.json', async (route) => {
    indexRequests++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(index) });
  });
  // An anonymous static fixture prevents external account refreshes from changing the test data.
  await page.addInitScript((embedded) => {
    (window as unknown as { __SHELF_STATIC: StaticShelfData }).__SHELF_STATIC = embedded;
    (window as unknown as { __copiedSkillLink?: string }).__copiedSkillLink = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as unknown as { __copiedSkillLink: string }).__copiedSkillLink = value; },
    } });
    localStorage.removeItem('repo-shelf.view');
  }, data);
  await page.goto('/');
  await expect(page.locator('.filter-result')).toHaveText('2 / 2 repos');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.repo-list-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  const skills = page.getByRole('region', { name: 'Skills library', exact: true });
  await expect(skills).toBeVisible();
  const folders = skills.getByRole('list', { name: 'Skill folders', exact: true });
  await expect(folders.locator('.skill-folder')).toHaveCount(2);
  await expect(skills.locator('.skill-entry')).toHaveCount(4);
  expect(indexRequests).toBe(1);

  const audioFolder = folders.getByRole('button', { name: 'Voice & Audio, 3 skills', exact: true });
  const webFolder = folders.getByRole('button', { name: 'Web & Automation, 1 skill', exact: true });
  await expect(audioFolder).toBeVisible();
  await expect(webFolder).toBeVisible();
  await expect(audioFolder).toHaveAttribute('data-skill-count', '3');
  await expect(webFolder).toHaveAttribute('data-skill-count', '1');
  await expect(audioFolder.locator('.skill-folder-count')).toHaveText('3 skills');
  await expect(webFolder.locator('.skill-folder-count')).toHaveText('1 skill');
  const audioBounds = await audioFolder.boundingBox();
  const webBounds = await webFolder.boundingBox();
  expect(audioBounds).not.toBeNull();
  expect(webBounds).not.toBeNull();
  expect(audioBounds!.width).toBeGreaterThan(webBounds!.width);

  await audioFolder.click();
  await expect(audioFolder).toHaveAttribute('aria-pressed', 'true');
  await expect(skills.locator('.skill-entry')).toHaveCount(3);
  await expect(skills.getByRole('button', { name: 'Browser Check', exact: true })).toHaveCount(0);

  const search = skills.getByRole('searchbox', { name: 'Search skills', exact: true });
  await search.fill('recordings');
  await expect(skills.locator('.skill-entry')).toHaveCount(1);
  await expect(skills.locator('.skill-entry-name')).toHaveText('Transcribe');
  await expect(skills.getByRole('link', { name: 'View Transcribe source on GitHub', exact: true }))
    .toHaveAttribute('href', `https://github.com/skills-e2e/audio-toolkit/blob/${COMMIT_SHA}/skills/transcribe/SKILL.md`);
  await skills.getByRole('button', { name: 'Copy Transcribe source link', exact: true }).click();
  await expect(skills.getByRole('button', { name: 'Copy Transcribe source link', exact: true })).toHaveText('Copied');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedSkillLink: string }).__copiedSkillLink))
    .toBe(`https://github.com/skills-e2e/audio-toolkit/blob/${COMMIT_SHA}/skills/transcribe/SKILL.md`);

  // Search and folder selection intersect; looking in every folder restores the matching skill.
  await search.fill('Browser Check');
  await expect(skills.getByRole('heading', { name: 'No matching skills', exact: true })).toBeVisible();
  await skills.getByRole('button', { name: 'All folders', exact: true }).click();
  await expect(skills.locator('.skill-entry')).toHaveCount(1);
  await expect(skills.locator('.skill-entry-name')).toHaveText('Browser Check');

  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  await expect(skills).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Library filters', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search repos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '3D Library', exact: true })).toBeVisible();
  await expect(page.locator('.repo-list-row')).toHaveCount(2);
  await expect(page.locator('.filter-result')).toHaveText('2 / 2 repos');
});
