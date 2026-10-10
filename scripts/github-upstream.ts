import type { GitHubMeta, Repo } from '../server/types.js';

const BATCH_SIZE = 50;
const MAX_UPSTREAMS = 2_000;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 20_000;
const SLUG_PATTERN = /^([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/([a-z\d_.-]{1,100})$/i;

type UpstreamMetadata = NonNullable<GitHubMeta['upstream']>;

export interface UpstreamRefresh {
  repos: Repo[];
  requested: number;
  refreshed: number;
  cached: number;
  unavailable: number;
}

function unchangedUpstream(repo: Repo): string | null {
  if (repo.catalog?.kind !== 'reference-copy' || (repo.catalog.authoredCommitsAhead ?? repo.catalog.commitsAhead) !== 0) return null;
  const slug = repo.catalog.upstream;
  return slug && SLUG_PATTERN.test(slug) ? slug : null;
}

function validCached(value: GitHubMeta['upstream'], slug: string): value is UpstreamMetadata {
  return Boolean(value && typeof value.fullName === 'string' && value.fullName.toLowerCase() === slug.toLowerCase()
    && Number.isSafeInteger(value.stars) && value.stars >= 0 && Number.isFinite(Date.parse(value.fetchedAt)));
}

/**
 * Build-only public upstream lookup. The credential stays in this Node process and is never
 * returned or written into site data. Batched aliases avoid one request per reference book.
 * Missing/deleted/private upstreams retain only a valid cached value for the same identity.
 */
export async function refreshPublicUpstreams(repos: Repo[], token: string | undefined = process.env.GH_TOKEN): Promise<UpstreamRefresh> {
  const wanted = new Map<string, string>();
  for (const repo of repos) {
    const slug = unchangedUpstream(repo);
    if (slug) wanted.set(slug.toLowerCase(), slug);
  }
  const entries = [...wanted].slice(0, MAX_UPSTREAMS);
  const fresh = new Map<string, UpstreamMetadata>();
  let next = 0;
  let blocked = false;
  if (token && entries.length) {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.ceil(entries.length / BATCH_SIZE)) }, async () => {
      while (!blocked && next < entries.length) {
        const batch = entries.slice(next, next + BATCH_SIZE);
        next += BATCH_SIZE;
        const query = `{${batch.map(([, slug], index) => {
          const [owner, name] = slug.split('/');
          return `r${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){nameWithOwner isPrivate stargazerCount}`;
        }).join('\n')}}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ query }),
            signal: controller.signal,
          });
          if (!response.ok) {
            if ([401, 403, 429].includes(response.status)) blocked = true;
            continue;
          }
          const result = await response.json() as { data?: Record<string, unknown> };
          if (!result.data || typeof result.data !== 'object') continue;
          const fetchedAt = new Date().toISOString();
          batch.forEach(([key], index) => {
            const value = result.data![`r${index}`];
            if (!value || typeof value !== 'object') return;
            const row = value as Record<string, unknown>;
            if (row.isPrivate !== false || typeof row.nameWithOwner !== 'string'
              || row.nameWithOwner.toLowerCase() !== key || typeof row.stargazerCount !== 'number'
              || !Number.isSafeInteger(row.stargazerCount) || row.stargazerCount < 0) return;
            fresh.set(key, { fullName: row.nameWithOwner, stars: row.stargazerCount, fetchedAt });
          });
        } catch {
          // A failed batch does not discard successfully hydrated books or the safe snapshot.
        } finally {
          clearTimeout(timer);
        }
      }
    }));
  }

  const cached = new Set<string>();
  const updated = repos.map((repo) => {
    const slug = unchangedUpstream(repo);
    if (!slug) return repo;
    const key = slug.toLowerCase();
    const value = fresh.get(key);
    if (!value) {
      if (validCached(repo.github?.upstream, slug)) {
        cached.add(key);
        return repo;
      }
      if (!repo.github?.upstream) return repo;
      const { upstream: _invalid, ...github } = repo.github;
      return { ...repo, github };
    }
    const github: GitHubMeta = repo.github ?? {
      description: repo.summary, language: repo.languageGuess, stars: 0, topics: [],
      isPrivate: false, isFork: true, pushedAt: repo.lastCommitAt ?? '',
      htmlUrl: repo.linkUrl ?? `https://github.com/${slug}`, fetchedAt: '',
    };
    return { ...repo, github: { ...github, upstream: value } };
  });
  return {
    repos: updated.every((repo, index) => repo === repos[index]) ? repos : updated,
    requested: wanted.size,
    refreshed: fresh.size,
    cached: cached.size,
    unavailable: wanted.size - fresh.size - cached.size,
  };
}
