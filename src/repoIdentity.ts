import type { Repo } from './types';

/** A canonical GitHub owner/repo, without a URL, path suffix or whitespace. */
function isRepoSlug(value: string): boolean {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/.test(value)) return false;
  const name = value.split('/')[1];
  return name !== '.' && name !== '..';
}

/** A reference without collector-authored commits represents its upstream as the primary book. */
export function referenceUpstream(repo: Repo): string | null {
  const catalog = repo.catalog;
  return catalog?.kind === 'reference-copy' && (catalog.authoredCommitsAhead ?? catalog.commitsAhead) === 0 && catalog.upstream && isRepoSlug(catalog.upstream)
    ? catalog.upstream
    : null;
}

export function primaryRepoSlug(repo: Repo): string | null {
  return referenceUpstream(repo) ?? repo.repoSlug;
}

/** The original repository name for alphabetic name sorting, preserving source spelling. */
export function primaryRepoName(repo: Repo): string {
  return referenceUpstream(repo)?.split('/')[1] ?? repo.name;
}

/** null means unavailable, which is distinct from a known repository with zero stars. */
export function starCountOf(repo: Repo): number | null {
  const source = referenceUpstream(repo);
  const metadata = repo.github?.upstream;
  const matchesSource = typeof metadata?.fullName === 'string' && metadata.fullName.toLowerCase() === source?.toLowerCase();
  const stars = source
    ? matchesSource ? metadata?.stars : undefined
    : repo.github?.stars;
  return typeof stars === 'number' && Number.isFinite(stars) && stars >= 0 ? Math.floor(stars) : null;
}

/** Unknown source counts participate as zero in filters, without borrowing the fork's stars. */
export function starsOf(repo: Repo): number {
  return starCountOf(repo) ?? 0;
}
