import type { GitHubMeta, Repo } from './types';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_PREFIX = 'repo-shelf:public-github:v1:';
const OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

interface PublicMetadata {
  stars?: number;
  language?: string | null;
  topics?: string[];
  pushedAt?: string;
}

function cachedInventory(owner: string): unknown[] | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${owner.toLowerCase()}`);
    if (!raw || raw.length > 2_000_000) return null;
    const cached = JSON.parse(raw) as { owner?: unknown; savedAt?: unknown; rows?: unknown };
    if (cached.owner !== owner.toLowerCase() || typeof cached.savedAt !== 'number'
      || cached.savedAt > Date.now() || Date.now() - cached.savedAt >= CACHE_TTL_MS
      || !Array.isArray(cached.rows) || cached.rows.length >= PAGE_SIZE * MAX_PAGES
      || !cached.rows.every((row) => metadata(row, owner) !== null)) return null;
    return cached.rows;
  } catch {
    // Browsers may disable storage. The public API and embedded snapshot still work.
    return null;
  }
}

function cacheInventory(owner: string, inventory: Map<string, PublicMetadata>): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const rows = [...inventory].map(([name, fresh]) => ({
      name, full_name: `${owner}/${name}`, private: false,
      stargazers_count: fresh.stars, language: fresh.language,
      topics: fresh.topics, pushed_at: fresh.pushedAt,
    }));
    sessionStorage.setItem(`${CACHE_PREFIX}${owner.toLowerCase()}`, JSON.stringify({ owner: owner.toLowerCase(), savedAt: Date.now(), rows }));
  } catch {
    // A full or unavailable session cache never blocks a refresh.
  }
}

function metadata(value: unknown, owner: string): [string, PublicMetadata] | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  // Even if an authenticated proxy ever replaces the API, private rows never enrich public books.
  if (row.private !== false || typeof row.name !== 'string' || typeof row.full_name !== 'string'
    || row.full_name.toLowerCase() !== `${owner}/${row.name}`.toLowerCase()) return null;
  const result: PublicMetadata = {};
  if (typeof row.stargazers_count === 'number' && Number.isSafeInteger(row.stargazers_count) && row.stargazers_count >= 0) {
    result.stars = row.stargazers_count;
  }
  if (row.language === null || (typeof row.language === 'string' && row.language.trim())) {
    result.language = typeof row.language === 'string' ? row.language.trim() : null;
  }
  if (Array.isArray(row.topics) && row.topics.every((topic) => typeof topic === 'string')) {
    result.topics = [...new Set(row.topics.map((topic: string) => topic.trim()).filter(Boolean))];
  }
  if (typeof row.pushed_at === 'string' && Number.isFinite(Date.parse(row.pushed_at))) {
    result.pushedAt = new Date(row.pushed_at).toISOString();
  }
  return [row.name.toLowerCase(), result];
}

async function requestPage(owner: string, page: number, signal?: AbortSignal): Promise<unknown[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new Error('GitHub refresh cancelled.');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=${PAGE_SIZE}&page=${page}&type=owner&sort=full_name`, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub public metadata unavailable (${response.status}).`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid GitHub public inventory.');
    return rows;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Refresh a published collection's public stars/language/topics/dates without changing its books.
 * Reference copies link to upstream, but their names still identify the collector's GitHub repos.
 * One paginated inventory request replaces thousands of per-book calls. Rate limits, cancellation,
 * incomplete inventories and offline visits leave the complete embedded snapshot usable.
 */
export async function refreshPublicMetadata(repos: Repo[], owner: string | null, signal?: AbortSignal): Promise<Repo[]> {
  if (!owner || !OWNER_PATTERN.test(owner) || !repos.length || signal?.aborted) return repos;
  const inventory = new Map<string, PublicMetadata>();
  const cached = cachedInventory(owner);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REFRESH_TIMEOUT_MS);
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = cached ?? await requestPage(owner, page, controller.signal);
      for (const row of rows) {
        const parsed = metadata(row, owner);
        if (parsed) inventory.set(...parsed);
      }
      if (cached || rows.length < PAGE_SIZE) break;
      // Do not commit a truncated inventory if the account exceeds our request budget.
      if (page === MAX_PAGES) return repos;
    }
  } catch {
    return repos;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  if (controller.signal.aborted || !inventory.size) return repos;
  if (!cached) cacheInventory(owner, inventory);

  const fetchedAt = new Date().toISOString();
  return repos.map((repo) => {
    const fresh = inventory.get(repo.name.toLowerCase());
    if (!fresh || !Object.keys(fresh).length) return repo;
    const previous: GitHubMeta = repo.github ?? {
      description: repo.summary,
      language: repo.languageGuess,
      stars: 0,
      topics: [],
      isPrivate: false,
      isFork: Boolean(repo.catalog && repo.catalog.kind !== 'original'),
      pushedAt: repo.lastCommitAt ?? '',
      htmlUrl: repo.linkUrl ?? (repo.repoSlug ? `https://github.com/${repo.repoSlug}` : ''),
      fetchedAt: '',
    };
    // Capability-card tags remain searchable alongside current GitHub topics.
    const topics = fresh.topics ? [...new Set([...previous.topics, ...fresh.topics])] : previous.topics;
    return {
      ...repo,
      lastCommitAt: fresh.pushedAt ?? repo.lastCommitAt,
      languageGuess: 'language' in fresh ? fresh.language ?? null : repo.languageGuess,
      github: { ...previous, ...fresh, topics, fetchedAt },
    };
  });
}
