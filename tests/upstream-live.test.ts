import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../src/types';

function book(name = 'project'): Repo {
  return {
    id: name, name: `collector-${name}`, path: '', shelfId: 'ai', virtual: true, linkUrl: null,
    visibility: 'public', archived: false, createdAt: null, doc: null, summary: 'Published card',
    branch: null, lastCommitAt: null, commitCount: 0, dirtyCount: 0, sizeKB: 0,
    languageGuess: 'Python', remoteUrl: null, owner: 'collector', repoSlug: `collector/collector-${name}`,
    github: { description: null, language: 'Python', stars: 999999, topics: [], isPrivate: false,
      isFork: true, pushedAt: '', htmlUrl: '', fetchedAt: '',
      upstream: { fullName: `source/${name}`, stars: 10, fetchedAt: '2020-01-01T00:00:00Z' } },
    catalog: { kind: 'reference-copy', upstream: `source/${name}`, commitsAhead: 0,
      repoUrl: '', cardStale: false, verificationStatus: 'verified', confidence: 'high', cardGeneratedAt: '', alive: true },
  };
}

const response = (fullName = 'source/project', stars = 1024, extra = {}) => new Response(JSON.stringify({
  full_name: fullName, stargazers_count: stars, private: false, ...extra,
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
    expect(updated.github!.upstream).toMatchObject({ fullName: 'source/project', stars: 1024 });
    expect(updated.github!.stars).toBe(999999);
    expect({ ...updated, github: original.github }).toEqual(original);
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/source/project', expect.objectContaining({
      credentials: 'omit', headers: { Accept: 'application/vnd.github+json' },
    }));
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it.each([
    ['private', response('source/project', 5000, { private: true })],
    ['different owner', response('other/project')],
    ['malformed count', response('source/project', -1)],
    ['rate limit', new Response('{}', { status: 403 })],
  ])('retains the last verified original count after a %s response', async (_label, result) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result));
    const repos = [book()];
    const { refreshUpstreamStars } = await import('../src/upstreamLive');
    expect(await refreshUpstreamStars(repos)).toBe(repos);
    expect(repos[0].github!.upstream!.stars).toBe(10);
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
