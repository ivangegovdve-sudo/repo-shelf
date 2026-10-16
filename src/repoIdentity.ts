import type { Repo } from './types';

/** A canonical GitHub owner/repo, without a URL, path suffix or whitespace. */
export function isRepoSlug(value: string): boolean {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/.test(value)) return false;
  const name = value.split('/')[1];
  return name !== '.' && name !== '..';
}

/** Keep provenance available even when its public source is missing or archived. */
export function attributedUpstream(repo: Repo): string | null {
  const catalog = repo.catalog;
  const authored = catalog?.authoredCommitsAhead !== undefined ? catalog.authoredCommitsAhead : catalog?.commitsAhead;
  return catalog?.kind === 'reference-copy' && authored === 0 && catalog.upstream && isRepoSlug(catalog.upstream)
    ? catalog.upstream
    : null;
}

/** A confirmed unavailable or archived source yields to the public collecting fork. */
export function referenceUpstream(repo: Repo): string | null {
  const source = attributedUpstream(repo);
  const metadata = repo.github?.upstream;
  if (source && typeof metadata?.fullName === 'string' && metadata.fullName.toLowerCase() === source.toLowerCase()
    && (metadata.status === 'missing' || metadata.status === 'archived')) return null;
  return source;
}

/** Published legacy books may have had their repoSlug rewritten to upstream. */
export function ownRepoSlug(repo: Repo): string | null {
  const source = attributedUpstream(repo)?.toLowerCase();
  const own = (slug: unknown): slug is string => typeof slug === 'string' && isRepoSlug(slug) && slug.toLowerCase() !== source;
  if (own(repo.github?.fullName)) return repo.github!.fullName!;
  if (repo.catalog?.repoUrl) {
    try {
      const url = new URL(repo.catalog.repoUrl);
      const slug = url.pathname.replace(/^\//, '').replace(/\/$/, '');
      if (url.protocol === 'https:' && url.hostname === 'github.com' && own(slug)) return slug;
    } catch { /* Malformed historical links are not repository identities. */ }
  }
  return own(repo.repoSlug) ? repo.repoSlug : null;
}

export function primaryRepoSlug(repo: Repo): string | null {
  return referenceUpstream(repo) ?? ownRepoSlug(repo);
}

/** The original repository name for alphabetic name sorting, preserving source spelling. */
export function primaryRepoName(repo: Repo): string {
  return referenceUpstream(repo)?.split('/')[1] ?? repo.name;
}

/** Keep primary links aligned when a browser lookup changes source availability. */
export function applyPrimaryRepoLink(repo: Repo): Repo {
  const source = attributedUpstream(repo);
  const metadata = repo.github?.upstream;
  if (!source || !repo.github || typeof metadata?.fullName !== 'string' || metadata.fullName.toLowerCase() !== source.toLowerCase()
    || !metadata.status || !['active', 'archived', 'missing'].includes(metadata.status)) return repo;
  const slug = primaryRepoSlug(repo);
  if (!slug) return repo;
  const url = `https://github.com/${slug}`;
  return repo.linkUrl === url && repo.github.htmlUrl === url ? repo : { ...repo, linkUrl: url, github: { ...repo.github, htmlUrl: url } };
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

/** Dates follow the displayed source; existing Updated since semantics use the last push. */
export function updatedAtOf(repo: Repo): string | null {
  const source = referenceUpstream(repo);
  const upstream = repo.github?.upstream;
  const sourceDate = source && typeof upstream?.fullName === 'string' && upstream.fullName.toLowerCase() === source.toLowerCase()
    ? upstream.pushedAt : null;
  for (const date of [sourceDate, repo.github?.pushedAt, repo.lastCommitAt]) {
    if (!date) continue;
    const time = Date.parse(date);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return null;
}
