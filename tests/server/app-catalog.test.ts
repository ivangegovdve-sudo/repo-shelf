import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { makeTempRoot, rm } from './helpers';
import { createApp, type AppHandle } from '../../server/app';
import { saveConfig } from '../../server/config';
import { GitHubEnricher } from '../../server/github';
import type { Runner } from '../../server/git';
import type { AppState, Repo } from '../../server/types';

/** The signed-in account owns a GitHub shelf, and one of its repos is also in the bundled catalog. */
let tmp: string;
let handle: AppHandle;
let server: import('node:http').Server;
let base: string;
let visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC';
const ghCalls: string[][] = [];

const listItem = (name: string, vis: string) => ({
  nameWithOwner: `me-user/${name}`, name, visibility: vis, isArchived: false, isFork: false, description: `${name} live`,
  primaryLanguage: { name: 'TypeScript' }, stargazerCount: 1, pushedAt: '2026-09-20T00:00:00Z', createdAt: '2024-01-02T00:00:00Z',
  url: `https://github.com/me-user/${name}`, repositoryTopics: [], diskUsage: 10,
});

const runner: Runner = async (cmd, args) => {
  if (cmd !== 'gh') return { code: 1, stdout: '', stderr: 'no git here' };
  ghCalls.push(args);
  const [a, b, c] = args;
  if (a === 'auth' && b === 'status') return { code: 0, stdout: '', stderr: '' };
  if (a === 'api' && b === 'user') return { code: 0, stdout: 'me-user\n', stderr: '' };
  if (a === 'repo' && b === 'list') return { code: 0, stdout: JSON.stringify([listItem('voice-tool', visibility), listItem('solo-tool', 'PUBLIC')]), stderr: '' };
  if (a === 'repo' && b === 'edit' && c === 'me-user/voice-tool') {
    visibility = args.includes('private') ? 'PRIVATE' : 'PUBLIC';
    return { code: 0, stdout: '', stderr: '' };
  }
  return { code: 1, stdout: '', stderr: 'not faked' };
};

beforeAll(async () => {
  tmp = await makeTempRoot('repo-shelf-appcat-');
  const configFile = path.join(tmp, 'shelf.config.json');
  saveConfig(configFile, { shelves: [{ label: 'GitHub', github: 'me' }], staleAfterDays: 90, githubCacheHours: 24 });
  const catalogFile = path.join(tmp, 'catalog.json');
  fs.writeFileSync(catalogFile, JSON.stringify({
    schema_version: 1, generated_at: '2026-09-25T00:00:00Z', source: 'test', repo_count: 1,
    repos: [{
      name: 'voice-tool', full_name: 'me-user/voice-tool', fork: false, upstream: null, commits_ahead: 4, last_push: '2026-09-20T00:00:00Z',
      language: 'TypeScript', topics: ['voice'], summary: 'Turns text into natural speech.', card_path: 'cards/voice-tool.md',
      card_generated_at: '2026-09-25T00:00:00Z', stale: false, confidence: 'high', verification_status: 'verified', topics_source: 'catalog_tags',
    }],
  }));
  const cacheDir = path.join(tmp, '.cache');
  handle = await createApp({ configFile, cacheDir, catalogFile, runner, enricher: new GitHubEnricher(path.join(cacheDir, 'github.json'), runner), spawn: (() => ({})) as never });
  await new Promise<void>((resolve) => {
    server = handle.app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  handle.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rm(tmp);
});

async function state(): Promise<AppState> {
  return (await (await fetch(`${base}/api/state`)).json()) as AppState;
}
const voiceBooks = (s: AppState): Repo[] => s.repos.filter((r) => r.repoSlug?.toLowerCase() === 'me-user/voice-tool');

describe('a cataloged repo that is also on your GitHub shelf', () => {
  it('is one book: the catalog book, carrying the live GitHub state', async () => {
    const s = await state();
    const books = voiceBooks(s);
    expect(books).toHaveLength(1);
    expect(books[0].catalog?.kind).toBe('original');
    expect(books[0].catalog?.githubShelfId).toBe(s.shelves.find((x) => x.kind === 'github')!.id);
    expect(books[0].visibility).toBe('public');
    expect(books[0].createdAt).toBe('2024-01-02T00:00:00Z');
    expect(s.repos.some((r) => r.repoSlug === 'me-user/solo-tool' && !r.catalog)).toBe(true);
  });

  it('can be managed from the catalog book, and the GitHub-shelf rescan that follows does not duplicate it', async () => {
    const [book] = voiceBooks(await state());
    const r = await fetch(`${base}/api/repo/visibility`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: book.id, visibility: 'private' }),
    });
    expect(r.status).toBe(200);
    expect(ghCalls.some((a) => a[0] === 'repo' && a[1] === 'edit' && a[2] === 'me-user/voice-tool')).toBe(true);
    const after = voiceBooks(await state());
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(book.id);
    expect(after[0].visibility).toBe('private');
  });
});
