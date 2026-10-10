import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshPublicUpstreams } from '../../scripts/github-upstream.js';
import type { Repo } from '../../server/types.js';

function reference(slug = 'source/example', id = slug): Repo {
  return {
    id, name: 'collector-copy', path: '', shelfId: 'engineering', virtual: true,
    linkUrl: `https://github.com/${slug}`, visibility: 'public', archived: false,
    createdAt: '2020-01-01T00:00:00Z', doc: null, summary: 'Curated capability card',
    branch: null, lastCommitAt: '2025-01-01T00:00:00Z', commitCount: 0, dirtyCount: 0,
    sizeKB: 0, languageGuess: 'Python', remoteUrl: `https://github.com/${slug}.git`,
    owner: slug.split('/')[0], repoSlug: slug,
    github: {
      description: 'Curated capability card', language: 'Python', stars: 999,
      topics: ['curated-topic'], isPrivate: false, isFork: true,
      pushedAt: '2025-01-01T00:00:00Z', htmlUrl: `https://github.com/${slug}`,
      fetchedAt: '2025-01-02T00:00:00Z',
    },
    catalog: {
      kind: 'reference-copy', upstream: slug, commitsAhead: 0,
      repoUrl: `https://github.com/${slug}`, cardStale: false,
      verificationStatus: 'verified', confidence: 'high', cardGeneratedAt: '2025-01-01T00:00:00Z', alive: true,
    },
  };
}

function response(data: Record<string, unknown>, errors?: unknown[]): Response {
  return new Response(JSON.stringify({ data, ...(errors ? { errors } : {}) }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('build-only public upstream hydration', () => {
  it('queries canonical public upstream popularity without changing account stars, content or provenance', async () => {
    const repo = reference();
    const fetcher = vi.fn().mockResolvedValue(response({ r0: { nameWithOwner: 'Source/Example', isPrivate: false, stargazerCount: 12_345 } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await refreshPublicUpstreams([repo], 'build-only-test-token');
    expect(result).toMatchObject({ requested: 1, refreshed: 1, cached: 0, unavailable: 0 });
    const hydrated = result.repos[0];
    expect(hydrated.github!.upstream).toMatchObject({ fullName: 'Source/Example', stars: 12_345 });
    expect(Number.isFinite(Date.parse(hydrated.github!.upstream!.fetchedAt))).toBe(true);
    expect(hydrated.github!.stars).toBe(999);
    expect({ ...hydrated, github: repo.github }).toEqual(repo);
    expect(repo.github!.upstream).toBeUndefined();
    expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/graphql');
    const options = fetcher.mock.calls[0][1];
    expect(options.headers.Authorization).toBe('Bearer build-only-test-token');
    expect(JSON.parse(options.body).query).toContain('repository(owner:"source",name:"example"){nameWithOwner isPrivate stargazerCount}');
    expect(JSON.stringify(result)).not.toContain('build-only-test-token');
  });

  it('deduplicates upstreams and uses at most 50 aliases per request', async () => {
    const repos = Array.from({ length: 51 }, (_, index) => reference(`source/repo-${index}`));
    repos.push(reference('SOURCE/REPO-0', 'another-copy'));
    const fetcher = vi.fn().mockImplementation(async (_url, options: { body: string }) => {
      const query = (JSON.parse(options.body) as { query: string }).query;
      const data = Object.fromEntries([...query.matchAll(/r(\d+):repository\(owner:("[^"]*"),name:("[^"]*")\)/g)].map((match) => {
        const fullName = `${JSON.parse(match[2])}/${JSON.parse(match[3])}`;
        return [`r${match[1]}`, { nameWithOwner: fullName, isPrivate: false, stargazerCount: 42 }];
      }));
      return response(data);
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await refreshPublicUpstreams(repos, 'test-token');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ requested: 51, refreshed: 51, unavailable: 0 });
    expect(result.repos).toHaveLength(52);
    expect(result.repos.every((repo) => repo.github!.upstream!.stars === 42)).toBe(true);
    for (const [, options] of fetcher.mock.calls) {
      expect([...JSON.parse(options.body).query.matchAll(/:repository\(/g)].length).toBeLessThanOrEqual(50);
    }
  });

  it('accepts partial GraphQL success and retains only correct same-identity cached values', async () => {
    const cached = reference('source/cached');
    cached.github!.upstream = { fullName: 'Source/Cached', stars: 321, fetchedAt: '2026-09-01T00:00:00Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      r0: { nameWithOwner: 'source/available', isPrivate: false, stargazerCount: 0 },
      r1: null, r2: null,
    }, [{ message: 'Could not resolve unavailable repository.' }])));
    const result = await refreshPublicUpstreams([reference('source/available'), cached, reference('source/deleted')], 'test-token');
    expect(result).toMatchObject({ refreshed: 1, cached: 1, unavailable: 1 });
    expect(result.repos[0].github!.upstream!.stars).toBe(0);
    expect(result.repos[1]).toBe(cached);
    expect(result.repos[1].github!.upstream!.fetchedAt).toBe('2026-09-01T00:00:00Z');
    expect(result.repos[2].github!.upstream).toBeUndefined();
  });

  it('rejects private, mismatched and malformed upstream results without substituting account stars', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      r0: { nameWithOwner: 'source/private', isPrivate: true, stargazerCount: 123 },
      r1: { nameWithOwner: 'different/project', isPrivate: false, stargazerCount: 123 },
      r2: { nameWithOwner: 'source/malformed', isPrivate: false, stargazerCount: -1 },
    })));
    const result = await refreshPublicUpstreams([reference('source/private'), reference('source/mismatched'), reference('source/malformed')], 'test-token');
    expect(result).toMatchObject({ refreshed: 0, cached: 0, unavailable: 3 });
    expect(result.repos.every((repo) => !repo.github!.upstream && repo.github!.stars === 999)).toBe(true);
  });

  it('never treats authored forks or originals as unchanged upstream copies', async () => {
    const authored = reference('source/authored');
    authored.catalog = { ...authored.catalog!, kind: 'authored-fork', commitsAhead: 2 };
    const original = reference('source/original');
    original.catalog = { ...original.catalog!, kind: 'original', commitsAhead: 0 };
    const inconsistent = reference('source/inconsistent');
    inconsistent.catalog = { ...inconsistent.catalog!, commitsAhead: 1 };
    const fetcher = vi.fn().mockResolvedValue(response({ r0: { nameWithOwner: 'source/example', isPrivate: false, stargazerCount: 7 } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await refreshPublicUpstreams([reference(), authored, original, inconsistent], 'test-token');
    expect(result.requested).toBe(1);
    expect(result.repos.slice(1)).toEqual([authored, original, inconsistent]);
    expect(fetcher.mock.calls[0][1].body).not.toContain('authored');
  });

  it('hydrates forks with no collector-authored commits even when other authors diverged upstream', async () => {
    const repo = reference();
    repo.catalog = { ...repo.catalog!, commitsAhead: 14, authoredCommitsAhead: 0 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ r0: { nameWithOwner: 'source/example', isPrivate: false, stargazerCount: 246 } })));
    const result = await refreshPublicUpstreams([repo], 'test-token');
    expect(result.refreshed).toBe(1);
    expect(result.repos[0].github!.upstream!.stars).toBe(246);
    expect(result.repos[0].catalog).toEqual(repo.catalog);
  });

  it('uses safe cached upstream values without making unauthenticated per-book requests', async () => {
    const good = reference();
    good.github!.upstream = { fullName: 'source/example', stars: 456, fetchedAt: '2026-09-01T00:00:00Z' };
    const wrong = reference('source/wrong');
    wrong.github!.upstream = { fullName: 'another/repository', stars: 999, fetchedAt: '2026-09-01T00:00:00Z' };
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.stubEnv('GH_TOKEN', '');
    const result = await refreshPublicUpstreams([good, wrong]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ refreshed: 0, cached: 1, unavailable: 1 });
    expect(result.repos[0]).toBe(good);
    expect(result.repos[1].github!.upstream).toBeUndefined();
  });

  it.each([401, 403, 429, 500])('keeps valid cached public stars on HTTP %i without leaking credentials', async (status) => {
    const repo = reference();
    repo.github!.upstream = { fullName: 'source/example', stars: 456, fetchedAt: '2026-09-01T00:00:00Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    const repos = [repo];
    const result = await refreshPublicUpstreams(repos, 'secret-test-token');
    expect(result.repos).toBe(repos);
    expect(result).toMatchObject({ refreshed: 0, cached: 1, unavailable: 0 });
    expect(JSON.stringify(result)).not.toContain('secret-test-token');
  });

  it('preserves the snapshot on a network failure', async () => {
    const repos = [reference()];
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const result = await refreshPublicUpstreams(repos, 'test-token');
    expect(result.repos).toBe(repos);
    expect(result.unavailable).toBe(1);
  });
});
