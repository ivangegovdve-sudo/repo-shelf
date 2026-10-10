import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { refreshPublicMetadata } from '../src/githubLive';
import type { Repo } from '../src/types';

const OWNER = 'collector';

function book(over: Partial<Repo> = {}): Repo {
  return {
    id: 'book-1', name: 'example', path: '', shelfId: 'engineering', virtual: true,
    linkUrl: 'https://github.com/upstream/example', visibility: 'public', archived: false,
    createdAt: '2020-01-01T00:00:00Z', doc: null, summary: 'Curated capability card',
    branch: null, lastCommitAt: '2025-01-01T00:00:00Z', commitCount: 0, dirtyCount: 0,
    sizeKB: 0, languageGuess: 'Python', remoteUrl: 'https://github.com/upstream/example.git',
    owner: 'upstream', repoSlug: 'upstream/example',
    github: {
      description: 'Curated capability card', language: 'Python', stars: 1,
      topics: ['curated-topic'], isPrivate: false, isFork: true,
      pushedAt: '2025-01-01T00:00:00Z', htmlUrl: 'https://github.com/upstream/example',
      fetchedAt: '2025-01-02T00:00:00Z',
    },
    catalog: {
      kind: 'reference-copy', upstream: 'upstream/example', commitsAhead: 0,
      repoUrl: 'https://github.com/upstream/example', cardStale: false,
      verificationStatus: 'verified', confidence: 'high', cardGeneratedAt: '2025-01-01T00:00:00Z', alive: true,
    },
    ...over,
  };
}

function row(name = 'example', over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, full_name: `${OWNER}/${name}`, private: false, stargazers_count: 12,
    language: 'TypeScript', topics: ['live-topic'], pushed_at: '2026-10-01T12:00:00Z',
    description: 'An API description that must not overwrite the capability card',
    html_url: `https://github.com/${OWNER}/${name}`, ...over,
  };
}

function mockPages(...pages: unknown[]): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn();
  pages.forEach((page) => fetcher.mockResolvedValueOnce(new Response(JSON.stringify(page), { status: 200 })));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('public GitHub metadata refresh', () => {
  it('matches collector names while preserving published upstream identity, attribution and curated content', async () => {
    const original = book();
    const fetcher = mockPages([row('EXAMPLE')]);
    const result = await refreshPublicMetadata([original], OWNER);

    expect(result).toHaveLength(1);
    const refreshed = result[0];
    expect(refreshed.github).toMatchObject({
      description: 'Curated capability card', stars: 12, language: 'TypeScript',
      topics: ['curated-topic', 'live-topic'], pushedAt: '2026-10-01T12:00:00.000Z',
      htmlUrl: original.github!.htmlUrl, isFork: true, isPrivate: false,
    });
    expect(refreshed.github!.fetchedAt).not.toBe(original.github!.fetchedAt);
    expect(refreshed.lastCommitAt).toBe('2026-10-01T12:00:00.000Z');
    expect(refreshed.languageGuess).toBe('TypeScript');
    expect({ ...refreshed, github: original.github, lastCommitAt: original.lastCommitAt, languageGuess: original.languageGuess }).toEqual(original);
    expect(original.github!.stars).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/users/collector/repos?per_page=100&page=1&type=owner&sort=full_name');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } });
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('paginates the account once and never fetches individual books or removes missing books', async () => {
    const first = Array.from({ length: 100 }, (_, index) => row(`repo-${index}`));
    const fetcher = mockPages(first, [row('example')]);
    const missing = book({ id: 'missing', name: 'not-in-live-api' });
    const result = await refreshPublicMetadata([book(), missing], OWNER);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('page=2');
    expect(result).toHaveLength(2);
    expect(result[0].github!.stars).toBe(12);
    expect(result[1]).toBe(missing);
  });

  it('ignores private and other-account rows', async () => {
    mockPages([row('example', { private: true }), row('example', { full_name: 'other/example' })]);
    const repos = [book()];
    expect(await refreshPublicMetadata(repos, OWNER)).toBe(repos);
  });

  it('accepts zero stars and null language, retains curated topics, and ignores malformed fields', async () => {
    mockPages([row('example', { stargazers_count: 0, language: null, topics: [] }), row('invalid', {
      stargazers_count: -1, language: 42, topics: ['okay', 1], pushed_at: 'invalid-date',
    })]);
    const invalid = book({ id: 'invalid', name: 'invalid' });
    const result = await refreshPublicMetadata([book(), invalid], OWNER);
    expect(result[0].github).toMatchObject({ stars: 0, language: null, topics: ['curated-topic'] });
    expect(result[0].languageGuess).toBeNull();
    expect(result[1]).toBe(invalid);
  });

  it.each([403, 429, 500])('preserves the snapshot when GitHub responds %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    const repos = [book()];
    expect(await refreshPublicMetadata(repos, OWNER)).toBe(repos);
  });

  it('preserves the whole snapshot when a later page fails', async () => {
    const fetcher = mockPages(Array.from({ length: 100 }, () => row()));
    fetcher.mockRejectedValueOnce(new Error('Offline'));
    const repos = [book()];
    expect(await refreshPublicMetadata(repos, OWNER)).toBe(repos);
    expect(repos[0].github!.stars).toBe(1);
  });

  it.each([
    { inventory: [] },
    { inventory: { message: 'Not an inventory' } },
    { inventory: [null, { name: 'example' }] },
  ])('preserves the snapshot for empty or invalid inventory $inventory', async ({ inventory }) => {
    mockPages(inventory);
    const repos = [book()];
    expect(await refreshPublicMetadata(repos, OWNER)).toBe(repos);
  });

  it('bounds the request budget and rejects a truncated inventory', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(Array.from({ length: 100 }, () => row())), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const repos = [book()];
    expect(await refreshPublicMetadata(repos, OWNER)).toBe(repos);
    expect(fetcher).toHaveBeenCalledTimes(20);
  });

  it('skips missing or invalid owners and already cancelled requests', async () => {
    const fetcher = mockPages([]);
    const repos = [book()];
    for (const owner of [null, '', '../other', 'a'.repeat(40)]) {
      expect(await refreshPublicMetadata(repos, owner)).toBe(repos);
    }
    expect(await refreshPublicMetadata(repos, OWNER, AbortSignal.abort())).toBe(repos);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('honors cancellation during an in-flight request without losing books', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    }));
    vi.stubGlobal('fetch', fetcher);
    const repos = [book()];
    const result = refreshPublicMetadata(repos, OWNER, controller.signal);
    controller.abort();
    expect(await result).toBe(repos);
  });

  it('reuses validated public metadata for ten minutes within the same browser session', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
    const fetcher = mockPages([row()]);
    const first = await refreshPublicMetadata([book()], OWNER);
    const second = await refreshPublicMetadata([book()], OWNER.toUpperCase());
    expect(first[0].github!.stars).toBe(12);
    expect(second[0].github!.stars).toBe(12);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect([...saved.values()][0]).not.toContain('description');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000 + 1);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify([row('example', { stargazers_count: 42 })])));
    expect((await refreshPublicMetadata([book()], OWNER))[0].github!.stars).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { rows: [row('example', { private: true })] },
    { rows: [row('example', { full_name: 'other/example' })] },
  ])('revalidates cached privacy and account identity $rows', async ({ rows }) => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => JSON.stringify({ owner: OWNER, savedAt: Date.now(), rows }),
      setItem: () => {},
    });
    const fetcher = mockPages([row()]);
    expect((await refreshPublicMetadata([book()], OWNER))[0].github!.stars).toBe(12);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('continues without storage when session storage is unavailable', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('Blocked storage'); },
      setItem: () => { throw new Error('Quota exceeded'); },
    });
    mockPages([row()]);
    expect((await refreshPublicMetadata([book()], OWNER))[0].github!.stars).toBe(12);
  });

  it('bounds the entire refresh lifetime to 45 seconds', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation((_url, options: RequestInit) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(Array.from({ length: 100 }, () => row())))), 14_000);
      options.signal!.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Cancelled'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetcher);
    const repos = [book()];
    const result = refreshPublicMetadata(repos, OWNER);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await result).toBe(repos);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe('existing public deployment inventory', () => {
  it('preserves every already-public book and has no local or private metadata', () => {
    const data = JSON.parse(fs.readFileSync(new URL('../data/library.public.json', import.meta.url), 'utf8')) as {
      repos: Repo[]; shelves: { path: string | null; hidden: boolean; repoCount: number }[];
    };
    expect(data.repos.length).toBeGreaterThanOrEqual(1280);
    expect(new Set(data.repos.map((repo) => repo.id)).size).toBe(data.repos.length);
    expect(data.shelves.reduce((sum, shelf) => sum + shelf.repoCount, 0)).toBe(data.repos.length);
    for (const repo of data.repos) {
      expect(repo.path).toBe('');
      expect(repo.dirtyCount).toBe(0);
      expect(repo.error).toBeUndefined();
      expect(repo.visibility).not.toBe('private');
      expect(repo.github?.isPrivate).not.toBe(true);
    }
    expect(data.shelves.every((shelf) => shelf.path === null && !shelf.hidden)).toBe(true);
  });
});
