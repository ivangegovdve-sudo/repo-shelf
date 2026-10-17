import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRoot, rm } from './helpers';
import { buildStaticSite, publishSite, sanitizeForPublish, sanitizeSkillsForPublish, validateStaticBundle } from '../../server/publish';
import { ActionError } from '../../server/actions';
import type { AppState, Repo, Shelf } from '../../server/types';
import type { Runner } from '../../server/git';
import type { SkillsIndex } from '../../src/skills';

let tmp: string;
beforeEach(async () => {
  tmp = await makeTempRoot('repo-shelf-pub-');
});
afterEach(() => rm(tmp));

function repo(over: Partial<Repo>): Repo {
  return {
    id: over.id ?? 'x',
    name: 'thing',
    path: 'C:/secret/thing',
    shelfId: 's1',
    virtual: false,
    linkUrl: null,
    visibility: null,
    archived: false,
    createdAt: null,
    doc: null,
    summary: null,
    branch: 'main',
    lastCommitAt: null,
    commitCount: 3,
    dirtyCount: 5,
    sizeKB: 10,
    languageGuess: 'Go',
    remoteUrl: null,
    owner: null,
    repoSlug: null,
    github: null,
    ...over,
  };
}

const shelves: Shelf[] = [
  { id: 's1', label: 'Work', path: 'C:/secret', kind: 'disk', hidden: false, repoCount: 3 },
  { id: 's2', label: 'Secret', path: null, kind: 'links', hidden: true, repoCount: 1 },
  { id: 's3', label: 'Reads', path: null, kind: 'links', hidden: false, repoCount: 1 },
];
const state: AppState = {
  shelves,
  repos: [
    repo({ id: 'pub', visibility: 'public', repoSlug: 'me/pub', remoteUrl: 'https://github.com/me/pub.git' }),
    repo({ id: 'priv', visibility: 'private', repoSlug: 'me/priv' }),
    repo({ id: 'metadata-private', visibility: 'public', repoSlug: 'me/metadata-private', github: {
      description: null, language: null, stars: 0, topics: [], isPrivate: true, isFork: false, pushedAt: '', htmlUrl: '', fetchedAt: '',
    } }),
    repo({ id: 'unlisted-link', shelfId: 's3', virtual: true, path: '', visibility: 'internal' as never, linkUrl: 'https://example.test/unlisted' }),
    repo({ id: 'local', visibility: null }),
    repo({ id: 'arch', visibility: 'public', repoSlug: 'me/arch', archived: true }),
    repo({ id: 'hidden-link', shelfId: 's2', virtual: true, linkUrl: 'https://x' }),
    repo({ id: 'link', shelfId: 's3', virtual: true, linkUrl: 'https://example.com', path: '' }),
  ],
  github: { available: true, login: 'me' },
  config: { staleAfterDays: 90 },
};

describe('sanitizeForPublish', () => {
  it('keeps only public repos and visible shelves, strips paths and dirty state', () => {
    const out = sanitizeForPublish(state, 'me');
    expect(out.repos.map((r) => r.id).sort()).toEqual(['link', 'pub']);
    for (const r of out.repos) {
      expect(r.path).toBe('');
      expect(r.dirtyCount).toBe(0);
    }
    expect(out.repos.find((r) => r.id === 'pub')!.linkUrl).toBe('https://github.com/me/pub');
    expect(out.shelves.map((s) => s.label)).toEqual(['Work', 'Reads']);
    expect(out.shelves.every((s) => s.path === null)).toBe(true);
    expect(out.shelves[0].repoCount).toBe(1);
  });

  it.each(['missing', 'archived'] as const)('publishes the public fork when upstream is %s, recovering legacy collecting identity', (status) => {
    const book = repo({
      id: 'reference-id', name: 'renamed-copy', virtual: true, path: '', visibility: 'public',
      owner: 'upstream', repoSlug: 'upstream/original', linkUrl: 'https://github.com/upstream/original',
      catalog: { kind: 'reference-copy', upstream: 'upstream/original', commitsAhead: 0,
        repoUrl: 'https://github.com/upstream/original', cardStale: false, verificationStatus: 'verified',
        confidence: 'high', cardGeneratedAt: '', alive: true },
      github: { description: null, language: 'Go', stars: 7, topics: [], isPrivate: false,
        isFork: true, pushedAt: '2026-10-15T00:00:00Z', htmlUrl: 'https://github.com/upstream/original', fetchedAt: '',
        upstream: { fullName: 'upstream/original', status, fetchedAt: '2026-10-16T00:00:00Z' } },
    });
    const published = sanitizeForPublish({ ...state, repos: [book] }, 'collector').repos[0];
    expect(published).toMatchObject({ id: 'reference-id', name: 'renamed-copy', owner: 'collector',
      repoSlug: 'collector/renamed-copy', linkUrl: 'https://github.com/collector/renamed-copy',
      remoteUrl: 'https://github.com/collector/renamed-copy.git',
      github: { fullName: 'collector/renamed-copy', stars: 7, htmlUrl: 'https://github.com/collector/renamed-copy' },
      catalog: { kind: 'reference-copy', upstream: 'upstream/original', repoUrl: 'https://github.com/collector/renamed-copy' } });
    expect(published.path).toBe('');
    expect(published.dirtyCount).toBe(0);
    expect(book.github!.fullName).toBeUndefined();
  });

  it('preserves upstream primary links for active public sources while retaining the public collecting fork identity', () => {
    const book = repo({ name: 'renamed-copy', virtual: true, path: '', visibility: 'public', repoSlug: 'collector/renamed-copy',
      catalog: { kind: 'reference-copy', upstream: 'upstream/original', commitsAhead: 0,
        repoUrl: 'https://github.com/collector/renamed-copy', cardStale: false, verificationStatus: 'verified',
        confidence: 'high', cardGeneratedAt: '', alive: true },
      github: { description: null, language: 'Go', stars: 7, topics: [], isPrivate: false,
        isFork: true, pushedAt: '', htmlUrl: '', fetchedAt: '', upstream: {
          fullName: 'upstream/original', status: 'active', stars: 3000,
          pushedAt: '2026-10-16T00:00:00Z', fetchedAt: '2026-10-16T01:00:00Z' } },
    });
    const published = sanitizeForPublish({ ...state, repos: [book] }, 'collector').repos[0];
    expect(published.repoSlug).toBe('upstream/original');
    expect(published.linkUrl).toBe('https://github.com/upstream/original');
    expect(published.github!.htmlUrl).toBe('https://github.com/upstream/original');
    expect(published.github!.fullName).toBe('collector/renamed-copy');
    expect(published.github!.upstream).toEqual(book.github!.upstream);
  });
});

describe('buildStaticSite', () => {
  function fakeDist(): string {
    const dist = path.join(tmp, 'dist-static');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>repo shelf.</title></head><body><script src="./assets/app.js"></script></body></html>');
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), '// app');
    fs.writeFileSync(path.join(dist, 'server.cjs'), '// must not ship');
    return dist;
  }

  it('copies the build, embeds sanitized data and pages, and never ships the server', async () => {
    const out = path.join(tmp, 'site');
    const r = await buildStaticSite(state, {
      staticDist: fakeDist(),
      outDir: out,
      owner: 'me',
      pagesFor: async (repo) => ({ readme: `# ${repo.name}`, files: [], commits: [], branches: ['main'], issues: [], pulls: [], source: 'github', fetchedAt: '' }),
    });
    expect(r).toMatchObject({ repos: 2, shelves: 2, withPages: 2 });
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(html).toContain('<script src="./shelf-data.js"></script>');
    expect(html).toContain("<title>me's repo shelf</title>");
    const data = fs.readFileSync(path.join(out, 'shelf-data.js'), 'utf8');
    expect(data.startsWith('window.__SHELF_STATIC = ')).toBe(true);
    expect(data).not.toContain('C:/secret');
    expect(data).not.toContain('priv');
    expect(data).toContain('"readme":"# thing"');
    expect(fs.existsSync(path.join(out, 'assets', 'app.js'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'server.cjs'))).toBe(false);
    expect(fs.existsSync(path.join(out, '.nojekyll'))).toBe(true);
  });

  it('rejects a stale partial build whose HTML references missing hashed assets', () => {
    const broken = path.join(tmp, 'broken-dist');
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, 'index.html'), '<!doctype html><script type="module" src="./assets/index-old.js"></script>');
    expect(() => validateStaticBundle(broken)).toThrow(/missing local assets/i);
  });

  it('does not fetch pages for catalog books, which carry their capability card instead', async () => {
    const book = repo({ id: 'cat', shelfId: 's3', virtual: true, path: '', visibility: 'public', repoSlug: 'me/cat', linkUrl: 'https://github.com/me/cat',
      catalog: { kind: 'reference-copy', upstream: 'up/cat', commitsAhead: 0, repoUrl: 'https://github.com/me/cat', cardStale: false, verificationStatus: 'verified', confidence: 'high', cardGeneratedAt: '', alive: true } });
    const asked: string[] = [];
    const r = await buildStaticSite({ ...state, repos: [...state.repos, book] }, {
      staticDist: fakeDist(),
      outDir: path.join(tmp, 'site'),
      owner: 'me',
      pagesFor: async (x) => (asked.push(x.id), { readme: null, files: [], commits: [], branches: [], issues: [], pulls: [], source: 'github', fetchedAt: '' }),
    });
    expect(r.repos).toBe(3);
    expect(asked.sort()).toEqual(['link', 'pub']);
  });

  it('ships a deferred skills sidecar only for published public books', async () => {
    const index: SkillsIndex = {
      schemaVersion: 1, generatedAt: '2026-10-17T12:00:00.000Z', totalRepos: 3, scannedRepos: 3,
      sources: [
        { sourceSlug: 'me/pub', repoIds: ['pub', 'priv'], defaultBranch: 'main', commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), scannedAt: '2026-10-17T12:00:00.000Z', status: 'complete', skills: [
          { path: 'skills/publish/SKILL.md', blobSha: 'c'.repeat(40), bytes: 12, name: 'Publish', description: 'Publish safely', categoryId: 'developer-tools', metadata: 'path', sourceUrl: 'https://example.test/private' },
        ] },
        { sourceSlug: 'me/priv', repoIds: ['priv'], scannedAt: '2026-10-17T12:00:00.000Z', status: 'complete', skills: [{ path: 'SKILL.md', name: 'Private', description: 'Never publish', categoryId: 'security-privacy', metadata: 'path', sourceUrl: 'https://github.com/me/priv/blob/main/SKILL.md' }] },
      ],
    };
    const out = path.join(tmp, 'site');
    const r = await buildStaticSite(state, { staticDist: fakeDist(), outDir: out, owner: 'me', skills: index });
    expect(r.skills).toBe(1);
    const sidecar = JSON.parse(fs.readFileSync(path.join(out, 'skills-index.json'), 'utf8')) as SkillsIndex;
    expect(sidecar.sources).toHaveLength(1);
    expect(sidecar.sources[0]).toMatchObject({ sourceSlug: 'me/pub', repoIds: ['pub'] });
    expect(sidecar.sources[0].skills[0].sourceUrl).toBe(`https://github.com/me/pub/blob/${'a'.repeat(40)}/skills/publish/SKILL.md`);
    const embedded = fs.readFileSync(path.join(out, 'shelf-data.js'), 'utf8');
    expect(embedded).toContain('"skills":{"url":"./skills-index.json"');
    expect(embedded).not.toContain('Publish safely');
    expect(JSON.stringify(sidecar)).not.toContain('Private');
  });

  it('derives source book membership from the published library rather than the input cache', () => {
    const index: SkillsIndex = { schemaVersion: 1, generatedAt: '', totalRepos: 1, scannedRepos: 1, sources: [{
      sourceSlug: 'me/pub', repoIds: ['priv'], scannedAt: '', status: 'complete', skills: [],
    }] };
    const safe = sanitizeSkillsForPublish(index, sanitizeForPublish(state, 'me').repos);
    expect(safe.sources[0].repoIds).toEqual(['pub']);
    expect(safe.totalRepos).toBe(2);
  });

  it('fails closed for malformed locations and coalesces duplicate source spellings', () => {
    const raw = {
      schemaVersion: 1, generatedAt: '2026-10-17T12:00:00.000Z', totalRepos: 1, scannedRepos: 1,
      sources: [
        { sourceSlug: ['me/pub'], repoIds: ['pub'], scannedAt: '2026-10-17T12:00:00.000Z', status: 'complete', skills: [] },
        { sourceSlug: 'ME/PUB', repoIds: ['pub'], scannedAt: '2026-10-16T12:00:00.000Z', status: 'complete', skills: [] },
        { sourceSlug: 'me/pub', repoIds: ['pub'], scannedAt: '2026-10-17T12:00:00.000Z', status: 'partial', skills: [{ path: 'skills/ok/SKILL.md', name: 'OK', description: '', categoryId: 'developer-tools', metadata: 'path', sourceUrl: '' }] },
      ],
    } as unknown as SkillsIndex;
    const safe = sanitizeSkillsForPublish(raw, sanitizeForPublish(state, 'me').repos);
    expect(safe.sources).toHaveLength(1);
    expect(safe.sources[0]).toMatchObject({ sourceSlug: 'me/pub', status: 'partial' });

    const malformedLocation = sanitizeSkillsForPublish({ ...raw, sources: [{
      sourceSlug: 'me/pub', repoIds: ['pub'], scannedAt: '2026-10-17T12:00:00.000Z', status: 'complete',
      skills: [{ path: 'skills/ok/SKILL.md', name: 'OK', description: '', categoryId: 'developer-tools', metadata: 'path', sourceUrl: '' }, { name: 'Missing path' }],
    }] } as unknown as SkillsIndex, sanitizeForPublish(state, 'me').repos);
    expect(malformedLocation.sources[0].status).toBe('partial');
    expect(malformedLocation.sources[0].skills).toHaveLength(1);
  });

  it('refuses when nothing is public or the static build is missing', async () => {
    await expect(buildStaticSite({ ...state, repos: [repo({ id: 'p', visibility: 'private' })] }, { staticDist: fakeDist(), outDir: path.join(tmp, 'o'), owner: 'me' })).rejects.toMatchObject({ code: 'nothing_public' });
    await expect(buildStaticSite(state, { staticDist: path.join(tmp, 'nope'), outDir: path.join(tmp, 'o2'), owner: 'me' })).rejects.toBeInstanceOf(ActionError);
  });
});

describe('publishSite', () => {
  it('inits a repo in the site folder, creates the GitHub repo with --push, and enables Pages', async () => {
    const dir = path.join(tmp, 'site');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    const calls: string[][] = [];
    const runner: Runner = async (cmd, args, opts) => {
      if (cmd === 'gh') {
        calls.push([cmd, ...args]);
        if (args[0] === 'repo' && args[1] === 'view') return { code: 1, stdout: '', stderr: 'not found' };
        return { code: 0, stdout: '', stderr: '' };
      }
      const { execRunner } = await import('../../server/git');
      return execRunner(cmd, args, opts);
    };
    const r = await publishSite(dir, 'Me', 'my-shelf', runner);
    expect(r).toMatchObject({ created: true, repoUrl: 'https://github.com/Me/my-shelf', pagesUrl: 'https://me.github.io/my-shelf/' });
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
    expect(calls.some((c) => c[1] === 'repo' && c[2] === 'create' && c.includes('--public') && c.includes('--push'))).toBe(true);
    expect(calls.some((c) => c[1] === 'api' && c.includes('repos/Me/my-shelf/pages'))).toBe(true);
    await expect(publishSite(dir, null, 'x', runner)).rejects.toMatchObject({ code: 'gh_unavailable' });
    await expect(publishSite(dir, 'Me', 'bad name', runner)).rejects.toMatchObject({ code: 'invalid_name' });
  });
});
