import fs from 'node:fs/promises';
import path from 'node:path';
import type { StaticShelfData } from '../server/publish.js';
import type { AppState } from '../server/types.js';
import type { SkillsIndex } from '../src/skills.js';

export const PUBLIC_LIBRARY_PATH = 'data/library.public.json';

/** The single canonical repo dataset for the public shelf, never a private gh inventory. */
export async function readPublicLibrary(root: string): Promise<StaticShelfData> {
  const data = JSON.parse(await fs.readFile(path.join(root, PUBLIC_LIBRARY_PATH), 'utf8')) as StaticShelfData;
  if (!Array.isArray(data.repos) || !data.repos.length || !Array.isArray(data.shelves)) {
    throw new Error('The public library snapshot is missing its books or shelves.');
  }
  // Fail closed if this already-public source is accidentally replaced with a local/private export.
  // buildStaticSite still uses sanitizeForPublish as the sole publication sanitizer.
  if (data.repos.some((repo) => repo.path !== '' || repo.dirtyCount !== 0 || repo.error
    || (repo.visibility != null && repo.visibility !== 'public') || repo.github?.isPrivate)
    || data.shelves.some((shelf) => shelf.path !== null || shelf.hidden)) {
    throw new Error('The public library source contains local or private data.');
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const repo of data.repos) {
    if (!repo.id || ids.has(repo.id)) throw new Error(`The public library source contains a duplicate book id: ${repo.id || '(missing)'}.`);
    ids.add(repo.id);
    const slug = repo.repoSlug?.toLowerCase();
    if (slug && slugs.has(slug)) throw new Error(`The public library source contains a duplicate repository: ${repo.repoSlug}.`);
    if (slug) slugs.add(slug);
  }
  return data;
}

/** The optional sidecar is validated and sanitized again immediately before publication. */
export async function readPublicSkills(root: string): Promise<SkillsIndex | null> {
  const file = path.join(root, 'data', 'skills.public.json');
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('The public skills index could not be read safely.');
  }
  if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || !Array.isArray((value as { sources?: unknown }).sources)) {
    throw new Error('The public skills index has an invalid schema.');
  }
  return value as SkillsIndex;
}

/** Append new public books and apply newer authorship evidence without replacing published cards or star caches. */
export function publicLibraryState(data: StaticShelfData, catalog?: AppState, catalogGeneratedAt?: string): AppState {
  const catalogBooks = new Map(catalog?.repos.map(repo => [repo.id, repo]));
  const repos = data.repos.map(repo => {
    const fresh = catalogBooks.get(repo.id);
    if (!fresh || !repo.catalog || !fresh.catalog) return repo;
    const verifiedAt = fresh.catalog.authorshipVerifiedAt ?? catalogGeneratedAt;
    const previousVerifiedAt = repo.catalog.authorshipVerifiedAt ?? data.generatedAt;
    if (!verifiedAt || !(Date.parse(verifiedAt) > Date.parse(previousVerifiedAt))) return repo;
    // Refresh authorship without replacing published cards, categories, or upstream star caches.
    return {
      ...repo, owner: fresh.owner, repoSlug: fresh.repoSlug, remoteUrl: fresh.remoteUrl, linkUrl: fresh.linkUrl,
      catalog: { ...repo.catalog, kind: fresh.catalog.kind, upstream: fresh.catalog.upstream,
        commitsAhead: fresh.catalog.commitsAhead, authoredCommitsAhead: fresh.catalog.authoredCommitsAhead,
        authorshipVerifiedAt: verifiedAt,
        repoUrl: fresh.catalog.repoUrl, cardStale: fresh.catalog.cardStale, alive: fresh.catalog.alive },
      github: repo.github ? { ...repo.github, stars: fresh.github?.stars ?? repo.github.stars,
        htmlUrl: fresh.github?.htmlUrl ?? repo.github.htmlUrl } : fresh.github,
    };
  });
  const ids = new Set(repos.map((repo) => repo.id));
  for (const repo of catalog?.repos ?? []) {
    if (ids.has(repo.id)) continue;
    repos.push(repo);
    ids.add(repo.id);
  }
  const counts = new Map<string, number>();
  for (const repo of repos) counts.set(repo.shelfId, (counts.get(repo.shelfId) ?? 0) + 1);
  const shelves = new Map(data.shelves.map((shelf) => [shelf.id, shelf]));
  for (const shelf of catalog?.shelves ?? []) {
    if (!shelves.has(shelf.id) && counts.has(shelf.id)) shelves.set(shelf.id, shelf);
  }
  return {
    shelves: [...shelves.values()].map((shelf) => ({ ...shelf, repoCount: counts.get(shelf.id) ?? 0 })),
    repos,
    github: { available: false, login: data.owner },
    config: { staleAfterDays: 365 },
  };
}
