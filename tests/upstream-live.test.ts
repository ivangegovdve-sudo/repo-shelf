import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attributedUpstream, primaryRepoSlug, referenceUpstream, starCountOf, updatedAtOf } from '../src/repoIdentity';
import type { Repo } from '../src/types';

function book(name = 'project'): Repo {
  return {
    id: name, name: `collector-${name}`, path: '', shelfId: 'ai', virtual: true, linkUrl: null,
    visibility: 'public', archived: false, createdAt: null, doc: null, summary: 'Published card',
    branch: null, lastCommitAt: null, commitCount: 0, dirtyCount: 0, sizeKB: 0,
    languageGuess: 'Python', remoteUrl: null, owner: 'collector', repoSlug: `collector/collector-${name}`,
    github: { description: null, language: 'Python', stars: 999999, topics: [], isPrivate: false,
      fullName: `collector/collector-${name}`, isFork: true, pushedAt: '2026-04-01T00:00:00Z', htmlUrl: '', fetchedAt: '',
      upstream: { fullName: `source/${name}`, stars: 10, fetchedAt: '2020-01-01T00:00:00Z' } },
    catalog: { kind: 'reference-copy', upstream: `source/${name}`, commitsAhead: 0,
      repoUrl: '', cardStale: false, verificationStatus: 'verified', confidence: 'high', cardGeneratedAt: '', alive: true },
  };
}

const response = (fullName = 'source/project', stars = 1024, extra = {}) => new Response(JSON.stringify({
  full_name: fullName, stargazers_count: stars, private: false, archived: false,
  pushed_at: '2026-10-12T15:00:00Z', updated_at: '2026-10-13T15:00:00Z', ...extra,
}));

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bounded public upstream star refresh', () => {
  it('keeps a newer opened-book count when the slower initial inventory finishes, without merging another source', async () => {
    const incoming = book();
    const current = book();
    current.github!.upstream = { fullName: 'source/project', stars: 2048, fetchedAt: '2026-10-11T00:00:00Z' };
    const { preserveNewerUpstreamCounts } = await import('../src/upstreamLive');
    expect(preserveNewerUpstreamCounts([incoming], [current])[0].github!.upstream!.stars).toBe(2048);
    expect(incoming.github!.upstream!.stars).toBe(10);
    current.catalog!.upstream = 'other/project';
    current.github!.upstream!.fullName = 'other/project';
    expect(preserveNewerUpstreamCounts([incoming], [current])[0]).toBe(incoming);
  });

  it('refreshes the original count without changing the fork count, book identity or attribution', async () => {
    const original = book();
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const [updated] = await refreshUpstreamStars([original]);
    expect(updated.github!.upstream).toMatchObject({ fullName: 'source/project', stars: 1024, status: 'active' });
    expect(Date.parse(updated.github!.upstream!.pushedAt!)).toBe(Date.parse('2026-10-12T15:00:00Z'));
    expect(Date.parse(updated.github!.upstream!.updatedAt!)).toBe(Date.parse('2026-10-13T15:00:00Z'));
    expect(updated.github!.stars).toBe(999999);
    expect(Date.parse(updatedAtOf(updated)!)).toBe(Date.parse('2026-10-12T15:00:00Z'));
    expect(updated.linkUrl).toBe('https://github.com/source/project');
    expect(updated.github!.htmlUrl).toBe('https://github.com/source/project');
    expect({ ...updated, linkUrl: original.linkUrl, github: original.github }).toEqual(original);
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/source/project', expect.objectContaining({
      credentials: 'omit', headers: { Accept: 'application/vnd.github+json' },
    }));
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it.each([
    ['different owner', response('other/project')],
    ['malformed count', response('source/project', -1)],
    ['missing archived flag', response('source/project', 1024, { archived: undefined })],
    ['missing public flag', response('source/project', 1024, { private: undefined })],
    ['rate limit', new Response('{}', { status: 403 })],
    ['too many requests', new Response('{}', { status: 429 })],
    ['server error', new Response('{}', { status: 500 })],
  ])('retains the last verified original count after a %s response', async (_label, result) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result));
    const repos = [book()];
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    expect(await refreshUpstreamStars(repos)).toBe(repos);
    expect(repos[0].github!.upstream!.stars).toBe(10);
  });

  it.each([404, 410])('records a confirmed %s as missing, retaining the own book and source attribution', async status => {
    const original = book();
    original.linkUrl = 'https://github.com/source/project';
    original.github!.htmlUrl = original.linkUrl;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const [updated] = await refreshUpstreamStars([original]);
    expect(updated.github!.upstream).toMatchObject({ fullName: 'source/project', status: 'missing' });
    expect(updated.github!.upstream!.stars).toBeUndefined();
    expect(referenceUpstream(updated)).toBeNull();
    expect(attributedUpstream(updated)).toBe('source/project');
    expect(primaryRepoSlug(updated)).toBe('collector/collector-project');
    expect(updated.linkUrl).toBe('https://github.com/collector/collector-project');
    expect(updated.github!.htmlUrl).toBe('https://github.com/collector/collector-project');
    expect(starCountOf(updated)).toBe(999999);
    expect(Date.parse(updatedAtOf(updated)!)).toBe(Date.parse('2026-04-01T00:00:00Z'));
    expect({ ...updated, linkUrl: original.linkUrl, github: original.github }).toEqual(original);
  });

  it('does not copy private upstream identity, stars or dates into the public book or session cache', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('secret-owner/private-project', 987654321, {
      private: true, pushed_at: '2026-07-17T12:34:56Z', updated_at: '2026-07-18T12:34:56Z',
    })));
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const [updated] = await refreshUpstreamStars([book()]);
    expect(updated.github!.upstream).toMatchObject({ fullName: 'source/project', status: 'missing' });
    expect(updated.github!.upstream!.stars).toBeUndefined();
    expect(primaryRepoSlug(updated)).toBe('collector/collector-project');
    expect(updated.linkUrl).toBe('https://github.com/collector/collector-project');
    expect(updated.github!.htmlUrl).toBe('https://github.com/collector/collector-project');
    const published = JSON.stringify([updated, ...saved.values()]);
    for (const secret of ['secret-owner', '987654321', '2026-07-17T12:34:56Z', '2026-07-18T12:34:56Z']) {
      expect(published).not.toContain(secret);
    }
  });

  it('records an archived public source without replacing the own count or effective date', async () => {
    const original = book();
    original.linkUrl = 'https://github.com/source/project';
    original.github!.htmlUrl = original.linkUrl;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('source/project', 2048, { archived: true })));
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const [updated] = await refreshUpstreamStars([original]);
    expect(updated.github!.upstream).toMatchObject({ fullName: 'source/project', status: 'archived', stars: 2048 });
    expect(Date.parse(updated.github!.upstream!.pushedAt!)).toBe(Date.parse('2026-10-12T15:00:00Z'));
    expect(referenceUpstream(updated)).toBeNull();
    expect(attributedUpstream(updated)).toBe('source/project');
    expect(updated.linkUrl).toBe('https://github.com/collector/collector-project');
    expect(updated.github!.htmlUrl).toBe('https://github.com/collector/collector-project');
    expect(starCountOf(updated)).toBe(999999);
    expect(Date.parse(updatedAtOf(updated)!)).toBe(Date.parse('2026-04-01T00:00:00Z'));
  });

  it.each(['missing', 'archived'] as const)('recovers an old %s source when GitHub confirms it is active', async status => {
    const original = book();
    original.linkUrl = 'https://github.com/collector/collector-project';
    original.github!.htmlUrl = original.linkUrl;
    original.github!.upstream = { fullName: 'source/project', status, fetchedAt: '2020-01-01T00:00:00Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const [updated] = await refreshUpstreamStars([original]);
    expect(updated.github!.upstream).toMatchObject({ status: 'active', stars: 1024 });
    expect(referenceUpstream(updated)).toBe('source/project');
    expect(primaryRepoSlug(updated)).toBe('source/project');
    expect(updated.linkUrl).toBe('https://github.com/source/project');
    expect(updated.github!.htmlUrl).toBe('https://github.com/source/project');
    expect(starCountOf(updated)).toBe(1024);
    expect(Date.parse(updatedAtOf(updated)!)).toBe(Date.parse('2026-10-12T15:00:00Z'));
  });

  it.each(['missing', 'archived'] as const)('preserves a cached %s result across a transient failure', async status => {
    const original = book();
    original.github!.upstream = { fullName: 'source/project', status, fetchedAt: '2020-01-01T00:00:00Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const repos = [original];
    expect(await refreshUpstreamStars(repos)).toBe(repos);
    expect(referenceUpstream(original)).toBeNull();
    expect(starCountOf(original)).toBe(999999);
  });

  it('retains the previous verified source state when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const repos = [book()];
    expect(await refreshUpstreamStars(repos)).toBe(repos);
    expect(starCountOf(repos[0])).toBe(10);
  });

  it('skips fresh embedded counts and authored forks', async () => {
    const reference = book();
    reference.github!.upstream!.fetchedAt = new Date().toISOString();
    const adapted = book('adapted');
    adapted.catalog = { ...adapted.catalog!, kind: 'authored-fork', commitsAhead: 1 };
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    expect(await refreshUpstreamStars([reference, adapted])).toEqual([reference, adapted]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reuses validated counts in the session cache without another request', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value) });
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    await refreshUpstreamStars([book()]);
    expect((await refreshUpstreamStars([book()]))[0].github!.upstream!.stars).toBe(1024);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'archived'] as const)('reuses a validated %s session result without resurrecting a stale source', async status => {
    const saved = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value) });
    const fetcher = vi.fn().mockResolvedValue(status === 'missing'
      ? new Response('{}', { status: 404 }) : response('source/project', 2048, { archived: true }));
    vi.stubGlobal('fetch', fetcher);
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    await refreshUpstreamStars([book()]);
    const [updated] = await refreshUpstreamStars([book()]);
    expect(updated.github!.upstream!.status).toBe(status);
    expect(referenceUpstream(updated)).toBeNull();
    expect(updated.linkUrl).toBe('https://github.com/collector/collector-project');
    expect(updated.github!.htmlUrl).toBe('https://github.com/collector/collector-project');
    expect(starCountOf(updated)).toBe(999999);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'archived'] as const)('keeps a newer %s selection result when a stale account inventory completes', async status => {
    const incoming = book();
    const current = book();
    current.github!.upstream = { fullName: 'source/project', status, fetchedAt: '2026-10-15T00:00:00Z' };
    const { preserveNewerUpstreamCounts } = await import('../src/upstreamLive');
    const [merged] = preserveNewerUpstreamCounts([incoming], [current]);
    expect(merged.github!.upstream!.status).toBe(status);
    expect(referenceUpstream(merged)).toBeNull();
    expect(merged.linkUrl).toBe('https://github.com/collector/collector-project');
    expect(merged.github!.htmlUrl).toBe('https://github.com/collector/collector-project');
    expect(incoming.github!.upstream!.status).toBeUndefined();
    expect({ ...merged, linkUrl: incoming.linkUrl, github: incoming.github }).toEqual(incoming);
  });

  it('keeps a newer active recovery when an older missing inventory arrives', async () => {
    const incoming = book();
    incoming.github!.upstream = { fullName: 'source/project', status: 'missing', fetchedAt: '2026-10-14T00:00:00Z' };
    const current = book();
    current.github!.upstream = { fullName: 'source/project', status: 'active', stars: 2048,
      pushedAt: '2026-10-15T10:00:00Z', fetchedAt: '2026-10-15T12:00:00Z' };
    const { preserveNewerUpstreamCounts } = await import('../src/upstreamLive');
    const [merged] = preserveNewerUpstreamCounts([incoming], [current]);
    expect(referenceUpstream(merged)).toBe('source/project');
    expect(merged.linkUrl).toBe('https://github.com/source/project');
    expect(merged.github!.htmlUrl).toBe('https://github.com/source/project');
    expect(starCountOf(merged)).toBe(2048);
    expect(Date.parse(updatedAtOf(merged)!)).toBe(Date.parse('2026-10-15T10:00:00Z'));
  });

  it('caps public requests across refreshes and never drops books when the budget is exhausted', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => response(new URL(url).pathname.slice('/repos/'.length)));
    vi.stubGlobal('fetch', fetcher);
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const repos = Array.from({ length: 30 }, (_, i) => book(`project-${i}`));
    expect(await refreshUpstreamStars(repos, 100)).toHaveLength(30);
    expect(fetcher).toHaveBeenCalledTimes(24);
    expect(await refreshUpstreamStars([book('other')])).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(24);
  });

  it('shares an in-flight source lookup between two selections', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const a = refreshUpstreamStars([book()], 1);
    const b = refreshUpstreamStars([book()], 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(response());
    expect((await a)[0].github!.upstream!.stars).toBe(1024);
    expect((await b)[0].github!.upstream!.stars).toBe(1024);
  });

  it('honors cancellation and keeps the published snapshot', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    })));
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    const repos = [book()];
    const pending = refreshUpstreamStars(repos, 1, controller.signal);
    controller.abort();
    expect(await pending).toBe(repos);
  });
});
