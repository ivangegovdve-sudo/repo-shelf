import fs from 'node:fs/promises';
import path from 'node:path';
import type { StaticShelfData } from '../server/publish.js';
import type { AppState } from '../server/types.js';

/** This source was captured from the existing public Pages deployment, never from a private gh inventory. */
export async function readPublicLibrary(root: string): Promise<StaticShelfData> {
  const data = JSON.parse(await fs.readFile(path.join(root, 'data', 'library.public.json'), 'utf8')) as StaticShelfData;
  if (!Array.isArray(data.repos) || !data.repos.length || !Array.isArray(data.shelves)) {
    throw new Error('The public library snapshot is missing its books or shelves.');
  }
  // Fail closed if this already-public source is accidentally replaced with a local/private export.
  // buildStaticSite still uses sanitizeForPublish as the sole publication sanitizer.
  if (data.repos.some((repo) => repo.path !== '' || repo.dirtyCount !== 0 || repo.error
    || repo.visibility === 'private' || repo.github?.isPrivate)
    || data.shelves.some((shelf) => shelf.path !== null || shelf.hidden)) {
    throw new Error('The public library source contains local or private data.');
  }
  return data;
}

/** Append newly catalogued public books while retaining every existing published book verbatim. */
export function publicLibraryState(data: StaticShelfData, catalog?: AppState): AppState {
  const repos = [...data.repos];
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
