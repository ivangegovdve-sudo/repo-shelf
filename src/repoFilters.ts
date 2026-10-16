import { languageOf } from './derive';
import { primaryRepoName, primaryRepoSlug, starsOf, updatedAtOf } from './repoIdentity';
import type { Repo } from './types';

export { starCountOf, starsOf, updatedAtOf } from './repoIdentity';

export interface RepoMetadataFilters {
  languageFilter: string;
  topicFilter: string;
  /** Inclusive UTC calendar day, or an empty string for any date. */
  updatedAfter: string;
}

/** Newest known push first, with undated books last and stable source-name ties. */
export function compareLatestUpdated(a: Repo, b: Repo): number {
  const aDate = updatedAtOf(a);
  const bDate = updatedAtOf(b);
  const aTime = aDate === null ? -Infinity : Date.parse(aDate);
  const bTime = bDate === null ? -Infinity : Date.parse(bDate);
  return bTime - aTime
    || primaryRepoName(a).localeCompare(primaryRepoName(b))
    || (primaryRepoSlug(a) ?? a.name).localeCompare(primaryRepoSlug(b) ?? b.name)
    || a.id.localeCompare(b.id);
}

export function matchesRepoMetadata(repo: Repo, filters: RepoMetadataFilters): boolean {
  if (filters.languageFilter !== 'all' && languageOf(repo) !== filters.languageFilter) return false;
  if (filters.topicFilter !== 'all') {
    const topic = filters.topicFilter.trim().toLowerCase();
    if (!(repo.github?.topics ?? []).some((value) => value.trim().toLowerCase() === topic)) return false;
  }
  if (filters.updatedAfter) {
    const after = Date.parse(`${filters.updatedAfter}T00:00:00Z`);
    // Ignore malformed filter input; valid dates must not silently roll into another month.
    if (Number.isFinite(after) && new Date(after).toISOString().slice(0, 10) === filters.updatedAfter) {
      const updated = updatedAtOf(repo);
      if (!updated || Date.parse(updated) < after) return false;
    }
  }
  return true;
}

/** Each step removes one complete star tier; the last keeps every highest-starred tie. */
export function starThresholds(repos: readonly Repo[]): number[] {
  return [...new Set([0, ...repos.map(starsOf)])].sort((a, b) => a - b);
}
