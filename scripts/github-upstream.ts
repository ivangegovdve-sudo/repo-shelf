import type { GitHubMeta, Repo } from '../server/types.js';
import { applyPrimaryRepoLink } from '../src/repoIdentity.js';

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
  const authored = repo.catalog?.authoredCommitsAhead !== undefined ? repo.catalog.authoredCommitsAhead : repo.catalog?.commitsAhead;
  if (repo.catalog?.kind !== 'reference-copy' || authored !== 0) return null;
  const slug = repo.catalog.upstream;
  return slug && SLUG_PATTERN.test(slug) ? slug : null;
}

function validCached(value: GitHubMeta['upstream'], slug: string): value is UpstreamMetadata {
  return Boolean(value && typeof value.fullName === 'string' && value.fullName.toLowerCase() === slug.toLowerCase()
    && (value.status === 'missing' || value.status === 'archived'
      || (typeof value.stars === 'number' && Number.isSafeInteger(value.stars) && value.stars >= 0))
    && Number.isFinite(Date.parse(value.fetchedAt)));
}

function date(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** Prefer source caches that cannot yet power the effective latest-update filter. */
function needsSourceMetadata(repo: Repo, slug: string): boolean {
  const metadata = repo.github?.upstream;
  return !validCached(metadata, slug)
    || metadata.status === undefined
    || (metadata.status === 'active' && !date(metadata.pushedAt));
}

/**
 * Build-only public upstream lookup. The credential stays in this Node process and is never
 * returned or written into site data. Batched aliases avoid one request per reference book.
 * Confirmed missing/private/archived sources select the collecting fork. Transport failures
 * retain the previous state; they never imply that a public upstream has disappeared.
 */
export async function refreshPublicUpstreams(repos: Repo[], token: string | undefined = process.env.GH_TOKEN): Promise<UpstreamRefresh> {
  const wanted = new Map<string, string>();
  const incomplete = new Set<string>();
  for (const repo of repos) {
    const slug = unchangedUpstream(repo);
    if (!slug) continue;
    const key = slug.toLowerCase();
    wanted.set(key, slug);
    if (needsSourceMetadata(repo, slug)) incomplete.add(key);
  }
  const entries = [...wanted]
    .sort(([left], [right]) => Number(incomplete.has(right)) - Number(incomplete.has(left)))
    .slice(0, MAX_UPSTREAMS);
  const fresh = new Map<string, UpstreamMetadata>();
  const missing = new Map<string, UpstreamMetadata>();
  let next = 0;
  let blocked = false;
  if (token && entries.length) {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.ceil(entries.length / BATCH_SIZE)) }, async () => {
      while (!blocked && next < entries.length) {
        const batch = entries.slice(next, next + BATCH_SIZE);
        next += BATCH_SIZE;
        const query = `{${batch.map(([, slug], index) => {
          const [owner, name] = slug.split('/');
          return `r${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){nameWithOwner isPrivate isArchived stargazerCount pushedAt updatedAt}`;
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
          const result = await response.json() as {
            data?: Record<string, unknown> | null;
            errors?: { type?: string; path?: unknown[]; extensions?: { code?: string } }[];
          };
          if (!result || typeof result !== 'object') continue;
          const fetchedAt = new Date().toISOString();
          batch.forEach(([key, slug], index) => {
            const alias = `r${index}`;
            const errors = Array.isArray(result.errors) ? result.errors : [];
            const explicitMissing = errors.some(error => error.path?.[0] === alias
              && (error.type === 'NOT_FOUND' || error.extensions?.code === 'NOT_FOUND'));
            const value = result.data?.[alias];
            if (explicitMissing || (value === null && !errors.length)) {
              missing.set(key, { fullName: slug, status: 'missing', fetchedAt });
              return;
            }
            if (!value || typeof value !== 'object') return;
            const row = value as Record<string, unknown>;
            // Do not retain any name, stars or dates returned from a private source.
            if (row.isPrivate === true) {
              missing.set(key, { fullName: slug, status: 'missing', fetchedAt });
              return;
            }
            if (row.isPrivate !== false || typeof row.nameWithOwner !== 'string' || row.nameWithOwner.toLowerCase() !== key
              || typeof row.isArchived !== 'boolean') return;
            const stars = typeof row.stargazerCount === 'number' && Number.isSafeInteger(row.stargazerCount) && row.stargazerCount >= 0
              ? row.stargazerCount : undefined;
            if (stars === undefined && !row.isArchived) return;
            fresh.set(key, {
              fullName: row.nameWithOwner, ...(stars !== undefined ? { stars } : {}),
              status: row.isArchived ? 'archived' : 'active',
              pushedAt: date(row.pushedAt), updatedAt: date(row.updatedAt), fetchedAt,
            });
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
    const value = fresh.get(key) ?? missing.get(key);
    if (!value) {
      if (validCached(repo.github?.upstream, slug)) {
        if (repo.github?.upstream?.status !== 'missing') cached.add(key);
        return applyPrimaryRepoLink(repo);
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
    return applyPrimaryRepoLink({ ...repo, github: { ...github, upstream: value } });
  });
  return {
    repos: updated.every((repo, index) => repo === repos[index]) ? repos : updated,
    requested: wanted.size,
    refreshed: fresh.size,
    cached: cached.size,
    unavailable: wanted.size - fresh.size - cached.size,
  };
}
