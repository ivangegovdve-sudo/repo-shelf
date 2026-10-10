import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCatalog, type CatalogRepo } from '../server/catalog.js';
import { classifyForkAuthorship, fetchCompleteComparison } from './verify-fork-authorship.js';

const OWNER = 'ivangegovdve-sudo';
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'repo-shelf-catalog-refresh',
  ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };

class ComparisonUnavailable extends Error {}

async function github<T>(endpoint: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.github.com/${endpoint}`, {
      headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return await response.json() as T;
    if (response.status === 404 && endpoint.includes('/compare/')) {
      const error = await response.json() as { message?: string };
      if (error.message?.includes('No common ancestor')) throw new ComparisonUnavailable('Upstream history has no common ancestor.');
    }
    if (response.status < 500) throw new Error(`GitHub ${endpoint.split('?')[0]} failed (${response.status}). Catalog not written.`);
  }
  throw new Error('GitHub unavailable. Catalog not written.');
}

interface InventoryRepo {
  name: string; full_name: string; fork: boolean; private: boolean; pushed_at: string;
  language: string | null; topics: string[]; description: string | null; default_branch: string;
  archived: boolean; created_at: string; stargazers_count: number;
}
interface ForkInfo { parent: { nameWithOwner: string; defaultBranchRef: { target: { oid: string } } | null } | null }

async function main(): Promise<void> {
  const file = path.resolve(process.argv[2] ?? 'data/catalog.public.json');
  const source = parseCatalog(JSON.parse(await fs.readFile(file, 'utf8')) as unknown);
  const previous = new Map(source.repos.map((r) => [r.full_name.toLowerCase(), r]));
  const inventory: InventoryRepo[] = [];
  for (let page = 1; ; page++) {
    const rows = await github<InventoryRepo[]>(`users/${OWNER}/repos?per_page=100&page=${page}&type=owner&sort=full_name`);
    inventory.push(...rows.filter((r) => !r.private));
    if (rows.length < 100) break;
  }
  if (!inventory.length) throw new Error('Empty public inventory. Catalog not written.');
  console.log(`Refreshing all ${inventory.length} public repositories; private repositories stay private.`);
  const forks = inventory.filter((r) => r.fork);
  const parents = new Map<string, ForkInfo>();
  for (let start = 0; start < forks.length; start += 40) {
    const batch = forks.slice(start, start + 40);
    const query = `{${batch.map((r, i) => `r${i}:repository(owner:${JSON.stringify(OWNER)},name:${JSON.stringify(r.name)}){parent{nameWithOwner defaultBranchRef{target{oid}}}}`).join('\n')}}`;
    const result = await github<{ data: Record<string, ForkInfo>; errors?: unknown[] }>('graphql', { query });
    if (result.errors) throw new Error('Fork parent query incomplete. Catalog not written.');
    batch.forEach((r, i) => parents.set(r.full_name, result.data[`r${i}`]));
  }
  const now = new Date().toISOString();
  const repos: CatalogRepo[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < inventory.length) {
      const r = inventory[next++];
      const old = previous.get(r.full_name.toLowerCase());
      let upstream: string | null = null;
      let ahead: number | null = 0;
      let authoredAhead: number | null = 0;
      if (r.fork) {
        const parent = parents.get(r.full_name)?.parent;
        upstream = parent?.nameWithOwner ?? old?.upstream ?? null;
        if (!upstream) throw new Error(`Cannot attribute upstream for ${r.name}. Catalog not written.`);
        try {
          if (!parent?.defaultBranchRef) throw new ComparisonUnavailable('Upstream default branch unavailable.');
          const comparison = await fetchCompleteComparison(`repos/${upstream}/compare/${parent.defaultBranchRef.target.oid}...${OWNER}:${encodeURIComponent(r.default_branch)}`, github);
          ahead = comparison.ahead_by;
          if (!Number.isInteger(ahead) || ahead < 0) throw new Error(`Invalid fork comparison for ${r.name}.`);
          authoredAhead = classifyForkAuthorship(comparison, OWNER).authoredCommitsAhead;
        } catch (error) {
          if (!(error instanceof ComparisonUnavailable)) throw error;
          ahead = null;
          authoredAhead = null;
          console.log(`Comparison unavailable for ${r.name}; preserving upstream, no authorship claim.`);
        }
      }
      repos.push({
        name: r.name, full_name: r.full_name, fork: r.fork, upstream, commits_ahead: ahead, authored_commits_ahead: authoredAhead,
        authorship_verified_at: new Date().toISOString(),
        last_push: r.pushed_at, language: r.language ?? 'Unknown',
        topics: [...new Set([...(old?.topics ?? []), ...r.topics])],
        summary: old?.summary || r.description || `Source repository for ${r.name}.`,
        card_path: old?.card_path ?? '', card_generated_at: old?.card_generated_at ?? now,
        stale: old ? old.stale || r.pushed_at > old.card_generated_at : false,
        confidence: old?.confidence ?? 'unrecorded', verification_status: old?.verification_status ?? 'unverified',
        topics_source: old ? 'catalog_tags+live_github' : 'live_github',
        archived: r.archived, created_at: r.created_at, stars: r.stargazers_count,
      });
      if (repos.length % 100 === 0) console.log(`Verified ${repos.length}/${inventory.length}`);
    }
  }));
  repos.sort((a, b) => a.full_name.localeCompare(b.full_name));
  const document = { schema_version: 1, generated_at: now, source: 'Complete live GitHub public inventory + default-branch comparisons with verified public author identities + existing capability cards', repo_count: repos.length, repos };
  parseCatalog(document);
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await fs.rename(`${file}.tmp`, file);
  console.log(`Wrote ${repos.length} public repositories (${repos.filter((r) => r.fork && r.authored_commits_ahead === 0).length} forks with no collector-authored changes).`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
