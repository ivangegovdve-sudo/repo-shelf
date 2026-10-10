import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StaticShelfData } from '../server/publish.js';
import type { CatalogDocument } from '../server/catalog.js';

export interface ComparedCommit {
  sha: string;
  author: { login: string } | null;
  committer: { login: string } | null;
  parents: { sha: string }[];
}

export interface ForkComparison {
  ahead_by: number;
  commits: ComparedCommit[];
  /** GitHub provides files only on the first page, capped at 300. */
  files?: unknown[];
}

export interface ForkAuthorship {
  kind: 'reference-copy' | 'authored-fork' | 'unverified-fork';
  commitsAhead: number | null;
  authoredCommitsAhead: number | null;
}

export type GitHubRequest = <T>(endpoint: string, body?: unknown) => Promise<T>;

/** Divergence is not authorship: upstream commits and synchronizing merges retain upstream credit. */
export function classifyForkAuthorship(comparison: ForkComparison, collector: string): ForkAuthorship {
  const ahead = comparison.ahead_by;
  const unresolved: ForkAuthorship = { kind: 'unverified-fork', commitsAhead: Number.isSafeInteger(ahead) && ahead >= 0 ? ahead : null, authoredCommitsAhead: null };
  if (!Number.isSafeInteger(ahead) || ahead < 0) return unresolved;
  const reference: ForkAuthorship = { kind: 'reference-copy', commitsAhead: ahead, authoredCommitsAhead: 0 };
  if (ahead === 0) return reference;
  // A complete empty diff proves that no effective changes remain, even after commits were reverted.
  if (Array.isArray(comparison.files) && comparison.files.length === 0) return reference;
  if (!Array.isArray(comparison.commits) || new Set(comparison.commits.map((commit) => commit.sha)).size !== ahead) return unresolved;
  let authored = 0;
  let uncertainMerge = false;
  for (const commit of comparison.commits) {
    const author = commit.author?.login?.toLowerCase();
    if (!Array.isArray(commit.parents)) return unresolved;
    if (commit.parents.length > 1) {
      // A collector-authored merge may contain conflict resolutions; never claim it has no changes.
      if (!author || author === collector.toLowerCase()) uncertainMerge = true;
      continue;
    }
    if (!author) return unresolved;
    // A collector committer applying someone else's authored commit does not transfer authorship.
    if (author === collector.toLowerCase()) authored++;
  }
  if (authored > 0) return { kind: 'authored-fork', commitsAhead: ahead, authoredCommitsAhead: authored };
  return uncertainMerge ? unresolved : reference;
}

/** Collect every ahead commit before concluding that none belongs to the collecting account. */
export async function fetchCompleteComparison(endpoint: string, request: GitHubRequest): Promise<ForkComparison> {
  const first = await request<ForkComparison>(`${endpoint}?per_page=100&page=1`);
  const commits = new Map((first.commits ?? []).map((commit) => [commit.sha, commit]));
  if (!Number.isSafeInteger(first.ahead_by) || first.ahead_by < 0) return first;
  for (let page = 2; commits.size < first.ahead_by && page <= 50; page++) {
    const next = await request<ForkComparison>(`${endpoint}?per_page=100&page=${page}`);
    if (next.ahead_by !== first.ahead_by || !Array.isArray(next.commits) || !next.commits.length) break;
    const size = commits.size;
    for (const commit of next.commits) commits.set(commit.sha, commit);
    if (commits.size === size) break;
  }
  return { ...first, commits: [...commits.values()] };
}

interface ForkHead {
  isPrivate: boolean;
  defaultBranchRef: { name: string } | null;
  parent: { isPrivate: boolean; nameWithOwner: string; defaultBranchRef: { target: { oid: string } } | null } | null;
}

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  const libraryFile = path.join(root, 'data', 'library.public.json');
  const catalogFile = path.join(root, 'data', 'catalog.public.json');
  const library = JSON.parse(await fs.readFile(libraryFile, 'utf8')) as StaticShelfData;
  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8')) as CatalogDocument;
  const owner = library.owner;
  if (!owner || !/^[a-z\d-]+$/i.test(owner)) throw new Error('A valid public collecting account is required.');
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required for public comparison verification.');
  const request: GitHubRequest = async <T>(endpoint: string, body?: unknown): Promise<T> => {
    const response = await fetch(`https://api.github.com/${endpoint}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Public verification unavailable (${response.status}); snapshots were not written.`);
    return await response.json() as T;
  };
  const candidates = library.repos.filter((repo) => repo.catalog?.kind === 'authored-fork' && repo.visibility === 'public');
  const query = `{${candidates.map((repo, index) => `r${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo.name)}){isPrivate defaultBranchRef{name} parent{isPrivate nameWithOwner defaultBranchRef{target{oid}}}}`).join('\n')}}`;
  const heads = await request<{ data: Record<string, ForkHead | null>; errors?: unknown[] }>('graphql', { query });
  if (heads.errors) throw new Error('Public fork lookup incomplete; snapshots were not written.');
  const results = new Map<string, ForkAuthorship>();
  for (const [index, repo] of candidates.entries()) {
    const fork = heads.data[`r${index}`];
    if (!fork || fork.isPrivate || !fork.parent || fork.parent.isPrivate || !fork.defaultBranchRef || !fork.parent.defaultBranchRef) {
      results.set(repo.name.toLowerCase(), { kind: 'unverified-fork', commitsAhead: repo.catalog!.commitsAhead, authoredCommitsAhead: null });
      continue;
    }
    const endpoint = `repos/${fork.parent.nameWithOwner}/compare/${fork.parent.defaultBranchRef.target.oid}...${owner}:${encodeURIComponent(fork.defaultBranchRef.name)}`;
    const comparison = await fetchCompleteComparison(endpoint, request);
    const result = classifyForkAuthorship(comparison, owner);
    results.set(repo.name.toLowerCase(), result);
    console.log(`${repo.name}: ${result.kind}; ${result.authoredCommitsAhead ?? 'unresolved'} authored / ${result.commitsAhead ?? 'unresolved'} ahead`);
  }
  const verifiedAt = new Date().toISOString();
  for (const repo of library.repos) {
    const result = results.get(repo.name.toLowerCase());
    if (result && repo.catalog) repo.catalog = { ...repo.catalog, ...result, authorshipVerifiedAt: verifiedAt };
  }
  for (const repo of catalog.repos) {
    const result = results.get(repo.name.toLowerCase());
    if (result) {
      repo.commits_ahead = result.commitsAhead;
      repo.authored_commits_ahead = result.authoredCommitsAhead;
      repo.authorship_verified_at = verifiedAt;
    }
  }
  // All comparisons finish before either complete public snapshot is replaced.
  await fs.writeFile(`${libraryFile}.tmp`, `${JSON.stringify(library)}\n`, 'utf8');
  await fs.writeFile(`${catalogFile}.tmp`, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await fs.rename(`${libraryFile}.tmp`, libraryFile);
  await fs.rename(`${catalogFile}.tmp`, catalogFile);
  console.log(`Reverified ${results.size} public fork classifications without changing books, shelves or capability cards.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
