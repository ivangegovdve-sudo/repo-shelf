import type { Repo } from './types';
import { referenceUpstream, starsOf } from './repoIdentity';

const TTL_MS = 10 * 60_000;
const BUDGET_MS = 60 * 60_000;
const MAX_REQUESTS = 24;
const CACHE_PREFIX = 'repo-shelf:upstream-github:v1:';
const BUDGET_KEY = `${CACHE_PREFIX}budget`;
const pending = new Map<string, Promise<Upstream | null>>();
let budget = { since: Date.now(), used: 0 };

type Upstream = NonNullable<NonNullable<Repo['github']>['upstream']>;

function valid(value: unknown, source: string): value is Upstream {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Upstream>;
  return typeof row.fullName === 'string' && row.fullName.toLowerCase() === source.toLowerCase()
    && typeof row.stars === 'number' && Number.isSafeInteger(row.stars) && row.stars >= 0
    && typeof row.fetchedAt === 'string' && Number.isFinite(Date.parse(row.fetchedAt));
}

function fresh(value: unknown, source: string): value is Upstream {
  if (!valid(value, source)) return false;
  const age = Date.now() - Date.parse(value.fetchedAt);
  return age >= 0 && age < TTL_MS;
}

function cached(source: string): Upstream | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${source.toLowerCase()}`);
    if (!raw || raw.length > 2048) return null;
    const row: unknown = JSON.parse(raw);
    return fresh(row, source) ? row : null;
  } catch { return null; }
}

function reserveRequest(): boolean {
  try {
    const saved = JSON.parse(sessionStorage.getItem(BUDGET_KEY) ?? 'null') as typeof budget | null;
    if (saved && Number.isFinite(saved.since) && Number.isInteger(saved.used) && saved.used >= 0
      && saved.since <= Date.now() && Date.now() - saved.since < BUDGET_MS) {
      budget = { since: saved.since, used: Math.max(saved.used, budget.used) };
    }
  } catch { /* Storage is optional. */ }
  if (Date.now() - budget.since >= BUDGET_MS) budget = { since: Date.now(), used: 0 };
  if (budget.used >= MAX_REQUESTS) return false;
  budget.used++;
  try { sessionStorage.setItem(BUDGET_KEY, JSON.stringify(budget)); } catch { /* Storage is optional. */ }
  return true;
}

async function requestSource(source: string, signal?: AbortSignal): Promise<Upstream | null> {
  const key = source.toLowerCase();
  const inFlight = pending.get(key);
  if (inFlight) return await inFlight;
  if (signal?.aborted || !reserveRequest()) return null;
  const request = (async () => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 12_000);
    try {
      const response = await fetch(`https://api.github.com/repos/${source.split('/').map(encodeURIComponent).join('/')}`, {
        headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', signal: controller.signal,
      });
      if (!response.ok) return null;
      const row = await response.json() as Record<string, unknown>;
      if (row.private !== false) return null;
      const result = { fullName: row.full_name, stars: row.stargazers_count, fetchedAt: new Date().toISOString() };
      if (!valid(result, source) || controller.signal.aborted) return null;
      try { sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(result)); } catch { /* Storage is optional. */ }
      return result;
    } catch { return null; }
    finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  })();
  pending.set(key, request);
  try { return await request; }
  finally { pending.delete(key); }
}

/** Builds hydrate the full collection; browsers refresh leaders and opened books within a small public API budget. */
export async function refreshUpstreamStars(repos: Repo[], maxRequests = 12, signal?: AbortSignal): Promise<Repo[]> {
  if (signal?.aborted) return repos;
  const sources = [...new Map([...repos].sort((a, b) => starsOf(b) - starsOf(a)).flatMap(repo => {
    const source = referenceUpstream(repo);
    return source && repo.github ? [[source.toLowerCase(), { source, repo }] as const] : [];
  })).values()];
  const updates = new Map<string, Upstream>();
  const missing: string[] = [];
  for (const { source, repo } of sources) {
    const hit = cached(source);
    if (hit) updates.set(source.toLowerCase(), hit);
    else if (!fresh(repo.github?.upstream, source)) missing.push(source);
  }
  let next = 0;
  const limit = Math.min(missing.length, Math.max(0, Math.floor(maxRequests)), MAX_REQUESTS);
  await Promise.all(Array.from({ length: Math.min(3, limit) }, async () => {
    while (next < limit && !signal?.aborted) {
      const source = missing[next++];
      const result = await requestSource(source, signal);
      if (result) updates.set(source.toLowerCase(), result);
    }
  }));
  if (!updates.size) return repos;
  return repos.map(repo => {
    const source = referenceUpstream(repo);
    const update = source && updates.get(source.toLowerCase());
    return update && repo.github ? { ...repo, github: { ...repo.github, upstream: update } } : repo;
  });
}

/** An opened book may refresh before the initial account request finishes. Keep its newer source data. */
export function preserveNewerUpstreamCounts(incoming: Repo[], current: Repo[]): Repo[] {
  const existing = new Map(current.map(repo => [repo.id, repo]));
  return incoming.map(repo => {
    const source = referenceUpstream(repo);
    const previous = existing.get(repo.id);
    const update = previous?.github?.upstream;
    if (!source || !repo.github || !previous || referenceUpstream(previous) !== source || !valid(update, source)) return repo;
    const replaced = repo.github.upstream;
    return !valid(replaced, source) || Date.parse(update.fetchedAt) > Date.parse(replaced.fetchedAt)
      ? { ...repo, github: { ...repo.github, upstream: update } }
      : repo;
  });
}
