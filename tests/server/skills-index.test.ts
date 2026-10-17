import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { refreshSkillsIndex, writeSkillsIndex } from '../../scripts/refresh-skills-library.js';
import type { SkillsIndex, SkillSource } from '../../src/skills.js';
import type { Repo } from '../../server/types.js';
import { makeTempRoot, rm } from './helpers';

const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BLOB = 'c'.repeat(40);
const NOW = new Date('2026-10-17T12:00:00Z');
const TOKEN = 'build-only-skills-test-token';

function book(source = 'source/project', id = source): Repo {
  return {
    id, name: 'collector-copy', path: '', shelfId: 'engineering', virtual: true,
    linkUrl: `https://github.com/${source}`, visibility: 'public', archived: false,
    createdAt: null, doc: null, summary: 'Existing capability card', branch: null,
    lastCommitAt: '2026-01-01T00:00:00Z', commitCount: 0, dirtyCount: 0, sizeKB: 0,
    languageGuess: 'TypeScript', remoteUrl: null, owner: 'collector', repoSlug: 'collector/copy',
    github: {
      fullName: 'collector/copy', description: 'Existing description', language: 'TypeScript',
      stars: 0, topics: [], isPrivate: false, isFork: true, pushedAt: '', htmlUrl: '', fetchedAt: '',
      upstream: { fullName: source, stars: 10, status: 'active', fetchedAt: NOW.toISOString() },
    },
    catalog: {
      kind: 'reference-copy', upstream: source, commitsAhead: 0, authoredCommitsAhead: 0,
      repoUrl: 'https://github.com/collector/copy', subCategory: 'developer-tools', cardStale: false,
      verificationStatus: 'verified', confidence: 'high', cardGeneratedAt: '', alive: true,
    },
  };
}

function row(pathname = 'skills/writing/SKILL.md', extra: Record<string, unknown> = {}) {
  return { path: pathname, type: 'blob', mode: '100644', sha: BLOB, size: 123, ...extra };
}

function publicMetadata(slug: string, extra: Record<string, unknown> = {}) {
  return { nameWithOwner: slug, isPrivate: false,
    defaultBranchRef: { name: 'main', target: { oid: COMMIT, tree: { oid: TREE } } }, ...extra };
}

function tree(rows: unknown[] = [row()], extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ sha: TREE, truncated: false, tree: rows, ...extra }));
}

function metadataResponse(init: RequestInit | undefined, resolve: (slug: string) => unknown = publicMetadata) {
  const query = JSON.parse(String(init?.body)).query as string;
  const aliases = [...query.matchAll(/(\w+)\s*:\s*repository\s*\(\s*owner\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*name\s*:\s*("(?:[^"\\]|\\.)*")\s*\)/g)];
  expect(aliases.length).toBeGreaterThan(0);
  const data = Object.fromEntries(aliases.map((match) => [match[1], resolve(`${JSON.parse(match[2])}/${JSON.parse(match[3])}`)]));
  return new Response(JSON.stringify({ data }));
}

function mockNetwork(options: {
  metadata?: (slug: string) => unknown;
  trees?: (url: string) => Response | Promise<Response>;
} = {}) {
  return vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.github.com/graphql') return metadataResponse(init, options.metadata);
    expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/git\/trees\/[a-f\d]{40}(?:\?recursive=1)?$/);
    expect(init?.method ?? 'GET').toBe('GET');
    return options.trees ? await options.trees(url) : tree();
  });
}

function previous(sourceSlug = 'source/project', status: SkillSource['status'] = 'complete'): SkillsIndex {
  return {
    schemaVersion: 1, generatedAt: '2026-10-16T12:00:00.000Z', totalRepos: 1, scannedRepos: 1,
    sources: [{
      sourceSlug, repoIds: [sourceSlug], defaultBranch: 'main', commitSha: COMMIT, treeSha: TREE,
      scannedAt: '2026-10-16T12:00:00.000Z', status,
      skills: [{ path: 'skills/writing/SKILL.md', blobSha: BLOB, bytes: 123, name: 'Writing',
        description: 'Skill found at skills/writing/SKILL.md.', categoryId: 'engineering',
        sourceUrl: `https://github.com/${sourceSlug}/blob/${COMMIT}/skills/writing/SKILL.md`, metadata: 'path' }],
    }],
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('public skills path index', () => {
  it('indexes a skill location from a public source without fetching or executing its contents', async () => {
    const repo = book();
    const original = structuredClone(repo);
    const fetcher = mockNetwork();
    const index = await refreshSkillsIndex([repo], null, { token: TOKEN, fetcher, now: () => NOW });
    expect(index).toMatchObject({ schemaVersion: 1, generatedAt: NOW.toISOString(), totalRepos: 1 });
    expect(index.sources).toHaveLength(1);
    expect(index.sources[0]).toMatchObject({ sourceSlug: 'source/project', repoIds: [repo.id],
      defaultBranch: 'main', commitSha: COMMIT, treeSha: TREE, status: 'complete', scannedAt: NOW.toISOString() });
    expect(index.scannedRepos).toBe(1);
    const [skill] = index.sources[0].skills;
    expect(skill).toMatchObject({ path: 'skills/writing/SKILL.md', blobSha: BLOB, bytes: 123,
      sourceUrl: `https://github.com/source/project/blob/${COMMIT}/skills/writing/SKILL.md`, metadata: 'path' });
    expect(skill.name.toLowerCase()).toContain('writing');
    expect(skill.description).toContain('skills/writing/SKILL.md');
    expect(typeof skill.categoryId).toBe('string');
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(index)).not.toContain(TOKEN);
    expect(repo).toEqual(original);
  });

  it('groups unchanged references by effective upstream and scans authored or inactive copies at their own fork', async () => {
    const active = book();
    const duplicate = book('SOURCE/PROJECT', 'second-copy');
    const authored = book('source/authored', 'authored');
    authored.github!.fullName = 'collector/authored';
    authored.catalog!.kind = 'authored-fork';
    authored.catalog!.authoredCommitsAhead = 2;
    const inactive = book('source/inactive', 'inactive');
    inactive.github!.fullName = 'collector/inactive';
    inactive.github!.upstream!.status = 'missing';
    const unknown = book('source/unknown', 'unknown');
    unknown.github!.fullName = 'collector/unknown';
    unknown.catalog!.authoredCommitsAhead = null;
    const fetcher = mockNetwork();
    const index = await refreshSkillsIndex([active, duplicate, authored, inactive, unknown], null, { token: TOKEN, fetcher });
    expect(index.sources.map(source => source.sourceSlug.toLowerCase()).sort()).toEqual([
      'collector/authored', 'collector/inactive', 'collector/unknown', 'source/project',
    ]);
    expect(index.sources.find(source => source.sourceSlug.toLowerCase() === 'source/project')!.repoIds.sort()).toEqual([active.id, duplicate.id].sort());
    expect(index.totalRepos).toBe(5);
    expect(index.scannedRepos).toBe(5);
    const requested = fetcher.mock.calls.filter(([input]) => String(input).endsWith('/graphql')).map(([, init]) => String(init?.body)).join('\n');
    expect(requested).not.toContain('source/authored');
    expect(requested).not.toContain('source/inactive');
    expect(requested).not.toContain('source/unknown');
  });

  it('accepts case-insensitive SKILL.md basenames and nested paths while rejecting symlinks, submodules and unsafe paths', async () => {
    const rows = [
      row('SKILL.md'), row('skills/code-review/skill.MD'), row('.agents/skills/debug/SKILL.md'),
      row('plugins/design/skills/color/SKILL.md'), row('skills/code-review/skill.MD'),
      row('skills/README.md'), row('skills/TEMPLATE.md'), row('skills/not-skill.md'),
      row('skills/link/SKILL.md', { mode: '120000' }),
      row('skills/submodule/SKILL.md', { type: 'commit', mode: '160000' }),
      row('skills/folder/SKILL.md', { type: 'tree', mode: '040000' }),
      row('../outside/SKILL.md'), row('/absolute/SKILL.md'), row('skills/../outside/SKILL.md'),
      row('skills\\outside\\SKILL.md'), row('skills/control\u0000/SKILL.md'),
    ];
    const fetcher = mockNetwork({ trees: () => tree(rows) });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(index.sources[0].skills.map(skill => skill.path).sort()).toEqual([
      '.agents/skills/debug/SKILL.md', 'SKILL.md', 'plugins/design/skills/color/SKILL.md', 'skills/code-review/skill.MD',
    ].sort());
    expect(index.sources[0].status).toBe('partial');
  });

  it('does not expose an explicitly private source or resurrect its previously public cached skills', async () => {
    const fetcher = mockNetwork({ metadata: () => publicMetadata('secret-owner/private-renamed', { isPrivate: true }) });
    const index = await refreshSkillsIndex([book()], previous(), { token: TOKEN, fetcher });
    expect(index.sources).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(index)).not.toContain('secret-owner');
    expect(JSON.stringify(index)).not.toContain('Writing');
  });

  it('excludes private books and books without a canonical repository before issuing requests', async () => {
    const privateBook = book('source/private');
    privateBook.visibility = 'private';
    const privateMetadata = book('source/private-metadata');
    privateMetadata.github!.isPrivate = true;
    const local = book('source/local');
    local.virtual = false;
    local.visibility = null;
    local.catalog = undefined;
    local.github = null;
    local.repoSlug = null;
    const fetcher = mockNetwork();
    const index = await refreshSkillsIndex([privateBook, privateMetadata, local], null, { token: TOKEN, fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(index).toMatchObject({ totalRepos: 0, scannedRepos: 0, sources: [] });
  });

  it.each([
    ['different identity', () => publicMetadata('different/repository')],
    ['missing public proof', () => publicMetadata('source/project', { isPrivate: undefined })],
    ['invalid commit SHA', () => publicMetadata('source/project', { defaultBranchRef: { name: 'main', target: { oid: 'not-a-sha', tree: { oid: TREE } } } })],
  ])('omits a source after %s metadata rather than publishing an unverified identity', async (_label, metadata) => {
    const fetcher = mockNetwork({ metadata });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(index.sources).toEqual([]);
    expect(index.scannedRepos).toBe(0);
    expect(JSON.stringify(index)).not.toContain('different/repository');
  });

  it('recognizes a confirmed public repository with no default branch as complete and empty', async () => {
    const fetcher = mockNetwork({ metadata: slug => publicMetadata(slug, { defaultBranchRef: null }) });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(index.sources[0]).toMatchObject({ sourceSlug: 'source/project', status: 'complete', skills: [] });
    expect(index.scannedRepos).toBe(1);
  });

  it.each([false, true])('does not reuse an unverified cache after a GraphQL field error (cache: %s)', async hasCache => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: { r0: publicMetadata('source/project', { defaultBranchRef: null }) },
      errors: [{ type: 'INTERNAL', path: ['r0', 'defaultBranchRef'] }],
    })));
    const cached = hasCache ? previous() : null;
    const index = await refreshSkillsIndex([book()], cached, { token: TOKEN, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(index.sources).toEqual([]);
    expect(JSON.stringify(index)).not.toContain('Writing');
  });

  it('rechecks public metadata but reuses a complete index for the same immutable commit', async () => {
    const cached = previous();
    const fetcher = mockNetwork();
    const index = await refreshSkillsIndex([book()], cached, { token: TOKEN, fetcher, now: () => NOW });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.github.com/graphql');
    expect(index.sources[0].status).toBe('complete');
    expect(index.sources[0].skills).toEqual(cached.sources[0].skills);
    expect(cached.generatedAt).toBe('2026-10-16T12:00:00.000Z');
  });

  it('retains only declared cache metadata and regenerates pinned GitHub links', async () => {
    const cached = previous();
    Object.assign(cached.sources[0], { machinePath: '/home/private-worktree', token: TOKEN });
    Object.assign(cached.sources[0].skills[0], { markdown: '# Private cached body', run: 'untrusted cached command' });
    cached.sources[0].skills[0].sourceUrl = 'https://untrusted.example/redirect';
    const fetcher = mockNetwork();
    const index = await refreshSkillsIndex([book()], cached, { token: TOKEN, fetcher });
    expect(index.sources[0].skills[0].sourceUrl).toBe(`https://github.com/source/project/blob/${COMMIT}/skills/writing/SKILL.md`);
    for (const value of ['/home/private-worktree', TOKEN, 'Private cached body', 'untrusted cached command', 'untrusted.example']) {
      expect(JSON.stringify(index)).not.toContain(value);
    }
    expect(index.sources[0].repoIds).toEqual([book().id]);
  });

  it('rescans a partial cache even when its commit has not changed', async () => {
    const fetcher = mockNetwork({ trees: () => tree([row('skills/new/SKILL.md')]) });
    const index = await refreshSkillsIndex([book()], previous('source/project', 'partial'), { token: TOKEN, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(index.sources[0].status).toBe('complete');
    expect(index.sources[0].skills.map(skill => skill.path)).toEqual(['skills/new/SKILL.md']);
  });

  it('rescans when the default-branch commit changes and pins links to that actual commit', async () => {
    const commit = 'd'.repeat(40);
    const fetcher = mockNetwork({ metadata: slug => publicMetadata(slug, {
      defaultBranchRef: { name: 'release', target: { oid: commit, tree: { oid: TREE } } },
    }) });
    const index = await refreshSkillsIndex([book()], previous(), { token: TOKEN, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(index.sources[0]).toMatchObject({ commitSha: commit, defaultBranch: 'release' });
    expect(index.sources[0].skills[0].sourceUrl).toContain(`/blob/${commit}/`);
  });

  it.each([401, 403, 429, 500])('does not republish cached records after HTTP %i metadata failures', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
    const cached = previous();
    const index = await refreshSkillsIndex([book()], cached, { token: TOKEN, fetcher });
    expect(index.sources).toEqual([]);
    expect(index.scannedRepos).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(index)).not.toContain(TOKEN);
    expect(JSON.stringify(index)).not.toContain('Writing');
  });

  it('continues with other public sources after one non-rate-limited 403', async () => {
    const fetcher = mockNetwork({ trees: (url) => url.includes('/project-a/')
      ? new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '99' } })
      : tree() });
    const index = await refreshSkillsIndex([book('source/project-a'), book('source/project-b')], null, { token: TOKEN, fetcher, concurrency: 2 });
    const a = index.sources.find(source => source.sourceSlug === 'source/project-a');
    const b = index.sources.find(source => source.sourceSlug === 'source/project-b');
    expect(a).toMatchObject({ status: 'unavailable', skills: [] });
    expect(b).toMatchObject({ status: 'complete' });
    expect(b!.skills).toHaveLength(1);
  });

  it('omits a source rather than a false complete-empty result after a metadata network failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Offline'));
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(index.sources).toEqual([]);
  });

  it.each([
    ['malformed JSON', () => new Response('not json')],
    ['missing tree', () => new Response(JSON.stringify({ sha: TREE, truncated: false }))],
    ['non-array tree', () => new Response(JSON.stringify({ sha: TREE, truncated: false, tree: {} }))],
    ['missing truncation flag', () => new Response(JSON.stringify({ sha: TREE, tree: [] }))],
    ['rate limit', () => new Response('{}', { status: 429 })],
  ])('retains cached skills as partial after a %s tree response', async (_label, trees) => {
    const cached = previous('source/project', 'partial');
    const fetcher = mockNetwork({ trees });
    const index = await refreshSkillsIndex([book()], cached, { token: TOKEN, fetcher });
    expect(index.sources[0].status).toBe('partial');
    expect(index.sources[0].skills).toEqual(cached.sources[0].skills);
  });

  it('marks a truncated tree partial while retaining its discovered locations', async () => {
    const fetcher = mockNetwork({ trees: () => tree([row()], { truncated: true }) });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(index.sources[0].status).toBe('partial');
    expect(index.sources[0].skills).toHaveLength(1);
  });

  it('completes a truncated root by traversing complete child trees and deduplicates full skill paths', async () => {
    const child = 'd'.repeat(40);
    const rootUrl = `https://api.github.com/repos/source/project/git/trees/${TREE}`;
    const childUrl = `https://api.github.com/repos/source/project/git/trees/${child}`;
    const fetcher = mockNetwork({ trees: url => {
      if (url === `${rootUrl}?recursive=1`) return tree([row('SKILL.md'), row('skills/writing/SKILL.md')], { truncated: true });
      if (url === rootUrl) return tree([row('SKILL.md'), { path: 'skills', type: 'tree', mode: '040000', sha: child }]);
      if (url === `${childUrl}?recursive=1`) return tree([row('writing/SKILL.md'), row('design/SKILL.md')], { sha: child });
      throw new Error(`Unexpected mocked tree route: ${url}`);
    } });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(index.sources[0].status).toBe('complete');
    expect(index.sources[0].skills.map(skill => skill.path).sort()).toEqual([
      'SKILL.md', 'skills/design/SKILL.md', 'skills/writing/SKILL.md',
    ]);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      'https://api.github.com/graphql', `${rootUrl}?recursive=1`, rootUrl, `${childUrl}?recursive=1`,
    ]);
    expect(index.sources[0].skills.every(skill => skill.sourceUrl.endsWith(`/${skill.path}`))).toBe(true);
  });

  it('splits a truncated child tree again and prefixes nested results exactly once', async () => {
    const child = 'd'.repeat(40);
    const deep = 'e'.repeat(40);
    const base = 'https://api.github.com/repos/source/project/git/trees/';
    const fetcher = mockNetwork({ trees: url => {
      if (url === `${base}${TREE}?recursive=1`) return tree([], { truncated: true });
      if (url === `${base}${TREE}`) return tree([{ path: 'skills', type: 'tree', mode: '040000', sha: child }]);
      if (url === `${base}${child}?recursive=1`) return tree([row('deep/SKILL.md')], { sha: child, truncated: true });
      if (url === `${base}${child}`) return tree([row('SKILL.md'), { path: 'deep', type: 'tree', mode: '040000', sha: deep }], { sha: child });
      if (url === `${base}${deep}?recursive=1`) return tree([row('SKILL.md'), row('nested/SKILL.md')], { sha: deep });
      throw new Error(`Unexpected mocked tree route: ${url}`);
    } });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(index.sources[0].status).toBe('complete');
    expect(index.sources[0].skills.map(skill => skill.path).sort()).toEqual([
      'skills/SKILL.md', 'skills/deep/SKILL.md', 'skills/deep/nested/SKILL.md',
    ].sort());
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('retains both full locations when different directories share an identical Git subtree', async () => {
    const child = 'd'.repeat(40);
    const base = 'https://api.github.com/repos/source/project/git/trees/';
    const fetcher = mockNetwork({ trees: url => {
      if (url === `${base}${TREE}?recursive=1`) return tree([], { truncated: true });
      if (url === `${base}${TREE}`) return tree([
        { path: 'first', type: 'tree', mode: '040000', sha: child },
        { path: 'second', type: 'tree', mode: '040000', sha: child },
      ]);
      if (url === `${base}${child}?recursive=1`) return tree([row('writing/SKILL.md')], { sha: child });
      throw new Error(`Unexpected mocked tree route: ${url}`);
    } });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(index.sources[0].status).toBe('complete');
    expect(index.sources[0].skills.map(skill => skill.path).sort()).toEqual([
      'first/writing/SKILL.md', 'second/writing/SKILL.md',
    ]);
  });

  it('retains initially discovered paths as partial when a fallback subtree request fails', async () => {
    const child = 'd'.repeat(40);
    const base = 'https://api.github.com/repos/source/project/git/trees/';
    const fetcher = mockNetwork({ trees: url => {
      if (url === `${base}${TREE}?recursive=1`) return tree([row('skills/existing/SKILL.md')], { truncated: true });
      if (url === `${base}${TREE}`) return tree([{ path: 'skills', type: 'tree', mode: '040000', sha: child }]);
      if (url === `${base}${child}?recursive=1`) return new Response('{}', { status: 500 });
      throw new Error(`Unexpected mocked tree route: ${url}`);
    } });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(index.sources[0].status).toBe('partial');
    expect(index.sources[0].skills.map(skill => skill.path)).toEqual(['skills/existing/SKILL.md']);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([0, 1])('stops after at most %i fallback tree requests and keeps discovered paths partial', async maxFallbackTrees => {
    const child = 'd'.repeat(40);
    const base = 'https://api.github.com/repos/source/project/git/trees/';
    const fetcher = mockNetwork({ trees: url => {
      if (url === `${base}${TREE}?recursive=1`) return tree([row('skills/existing/SKILL.md')], { truncated: true });
      if (url === `${base}${TREE}`) return tree([{ path: 'skills', type: 'tree', mode: '040000', sha: child }]);
      if (url === `${base}${child}?recursive=1`) return tree([row('existing/SKILL.md'), row('new/SKILL.md')], { sha: child });
      throw new Error(`Unexpected mocked tree route: ${url}`);
    } });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher, maxFallbackTrees });
    expect(index.sources[0].status).toBe('partial');
    expect(index.sources[0].skills.map(skill => skill.path)).toEqual(['skills/existing/SKILL.md']);
    expect(fetcher).toHaveBeenCalledTimes(2 + maxFallbackTrees);
  });

  it('marks capped discovery partial instead of claiming a complete source', async () => {
    const fetcher = mockNetwork({ trees: () => tree([row('skills/a/SKILL.md'), row('skills/b/SKILL.md'), row('skills/c/SKILL.md')]) });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher, maxSkillsPerSource: 2 });
    expect(index.sources[0].status).toBe('partial');
    expect(index.sources[0].skills).toHaveLength(2);
  });

  it('recognizes complete empty sources only after a valid, non-truncated tree', async () => {
    const fetcher = mockNetwork({ trees: () => tree([row('README.md')]) });
    const index = await refreshSkillsIndex([book()], null, { token: TOKEN, fetcher });
    expect(index.sources[0]).toMatchObject({ status: 'complete', skills: [] });
  });

  it('enforces one global request budget across metadata batches and tree workers', async () => {
    const fetcher = mockNetwork();
    const repos = Array.from({ length: 60 }, (_, i) => book(`source/project-${i}`));
    const index = await refreshSkillsIndex(repos, null, { token: TOKEN, fetcher, maxRequests: 2, concurrency: 8 });
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
    expect(index.sources).toHaveLength(60);
    expect(index.sources.some(source => source.status !== 'complete')).toBe(true);
  });

  it('bounds simultaneous tree requests by the configured concurrency', async () => {
    let active = 0;
    let peak = 0;
    const fetcher = mockNetwork({ trees: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return tree();
    } });
    const repos = Array.from({ length: 8 }, (_, i) => book(`source/project-${i}`));
    const index = await refreshSkillsIndex(repos, null, { token: TOKEN, fetcher, concurrency: 2 });
    expect(index.sources.every(source => source.status === 'complete')).toBe(true);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('does not issue unauthenticated requests or publish the cache when no build token is configured', async () => {
    vi.stubEnv('GH_TOKEN', '');
    const fetcher = vi.fn<typeof fetch>();
    const index = await refreshSkillsIndex([book()], previous(), { token: '', fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(index.sources).toEqual([]);
    expect(JSON.stringify(index)).not.toContain('Writing');
  });
});

describe('skills index publication artifact', () => {
  it('writes only data/skills.public.json while preserving the library and catalog snapshots', async () => {
    const root = await makeTempRoot('repo-shelf-skills-');
    try {
      const dir = path.join(root, 'data');
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'library.public.json'), 'existing library\n');
      await fs.writeFile(path.join(dir, 'catalog.public.json'), 'existing catalog\n');
      const index = previous();
      await writeSkillsIndex(root, index);
      expect(JSON.parse(await fs.readFile(path.join(dir, 'skills.public.json'), 'utf8'))).toEqual(index);
      expect(await fs.readFile(path.join(dir, 'library.public.json'), 'utf8')).toBe('existing library\n');
      expect(await fs.readFile(path.join(dir, 'catalog.public.json'), 'utf8')).toBe('existing catalog\n');
      expect((await fs.readdir(dir)).sort()).toEqual(['catalog.public.json', 'library.public.json', 'skills.public.json']);
    } finally { rm(root); }
  });

  it('keeps the prior valid skills index when the atomic replacement fails', async () => {
    const root = await makeTempRoot('repo-shelf-skills-atomic-');
    try {
      const target = path.join(root, 'data', 'skills.public.json');
      await fs.mkdir(path.dirname(target));
      const original = `${JSON.stringify(previous())}\n`;
      await fs.writeFile(target, original);
      vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Atomic replacement failed'));
      await expect(writeSkillsIndex(root, { ...previous(), generatedAt: NOW.toISOString() })).rejects.toThrow('Atomic replacement failed');
      expect(await fs.readFile(target, 'utf8')).toBe(original);
    } finally { rm(root); }
  });
});
