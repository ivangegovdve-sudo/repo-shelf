import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRepoSlug, primaryRepoSlug } from '../src/repoIdentity.js';
import { inferSkillCategory, skillNameFromPath, type SkillLocation, type SkillSource, type SkillsIndex } from '../src/skills.js';
import type { Repo } from '../server/types.js';
import { readPublicLibrary } from './public-library.js';

const METADATA_BATCH_SIZE = 30;
// Large public monorepos can return roughly 17 MB of uncompressed tree JSON before GitHub
// marks a recursive response truncated. Keep enough headroom to retain discovered paths and
// label the source partial instead of incorrectly reporting it unavailable.
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_TREE_ENTRIES = 100_000;
// Split only truncated recursive trees. Most large subtrees still fit in one recursive read,
// while these per-source limits keep pathological trees within the global request/time cap.
const DEFAULT_MAX_FALLBACK_TREES = 256;
const MAX_FALLBACK_ENTRIES = 1_000_000;
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REQUESTS = 4_000;
// A source can legitimately contain thousands of reusable skills. The tree response and JSON
// bounds remain the safety limit; do not silently omit valid paths at an arbitrary small count.
const DEFAULT_MAX_SKILLS = MAX_TREE_ENTRIES;
const SHA_PATTERN = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;

interface SourceGroup {
  slug: string;
  repoIds: string[];
  category?: string;
}

interface PublicHead {
  slug: string;
  branch?: string;
  commit?: string;
  tree?: string;
  empty: boolean;
}

export interface SkillsRefreshOptions {
  token?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  maxRequests?: number;
  concurrency?: number;
  maxSkillsPerSource?: number;
  maxFallbackTrees?: number;
  maxDurationMs?: number;
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.floor(value))) : fallback;
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && SHA_PATTERN.test(value);
}

function skillPath(value: unknown): value is string {
  return repoPath(value) && /(?:^|\/)skill\.md$/i.test(value);
}

function repoPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && !/[\\\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

interface GitTree {
  tree: unknown[];
  truncated: boolean;
}

function gitTree(value: unknown, expectedSha: string): GitTree | null {
  if (!value || typeof value !== 'object') return null;
  const tree = value as { sha?: unknown; tree?: unknown; truncated?: unknown };
  return sha(tree.sha) && tree.sha.toLowerCase() === expectedSha.toLowerCase()
    && Array.isArray(tree.tree) && typeof tree.truncated === 'boolean'
    ? { tree: tree.tree, truncated: tree.truncated } : null;
}

function sourceBase(group: SourceGroup, scannedAt: string): SkillSource {
  return {
    sourceSlug: group.slug,
    repoIds: group.repoIds,
    ...(group.category ? { sourceCategoryId: group.category } : {}),
    scannedAt,
    status: 'unavailable',
    skills: [],
  };
}

function sourceUrl(slug: string, commit: string, file: string): string {
  return `https://github.com/${slug}/blob/${commit}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

function plain(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function pathMetadata(file: string, group: SourceGroup, head: PublicHead, entry: Record<string, unknown>): SkillLocation {
  const namePath = file.includes('/') ? file : `${head.slug.split('/')[1]}/SKILL.md`;
  const template = file.split('/').slice(0, -1).some(part => /^(?:templates?|examples?|samples?|fixtures?|tests?|readme)$/i.test(part));
  return {
    path: file,
    ...(sha(entry.sha) ? { blobSha: entry.sha } : {}),
    ...(typeof entry.size === 'number' && Number.isSafeInteger(entry.size) && entry.size >= 0 ? { bytes: entry.size } : {}),
    name: skillNameFromPath(namePath),
    description: `Skill definition at ${file}`,
    categoryId: inferSkillCategory(file, group.category),
    sourceUrl: sourceUrl(head.slug, head.commit!, file),
    metadata: 'path',
    ...(template ? { template: true } : {}),
  };
}

/** Retain only the public schema, never unknown cache fields or arbitrary external URLs. */
function cachedSource(value: SkillSource | undefined, group: SourceGroup): SkillSource | null {
  if (!value || typeof value.sourceSlug !== 'string' || value.sourceSlug.toLowerCase() !== group.slug.toLowerCase()
    || !['complete', 'partial', 'unavailable'].includes(value.status) || !Array.isArray(value.skills)
    || !Number.isFinite(Date.parse(value.scannedAt)) || (value.commitSha !== undefined && !sha(value.commitSha))
    || (value.treeSha !== undefined && !sha(value.treeSha))) return null;
  const seen = new Set<string>();
  const skills: SkillLocation[] = [];
  let incomplete = value.skills.length > DEFAULT_MAX_SKILLS;
  for (const item of value.skills.slice(0, DEFAULT_MAX_SKILLS)) {
    if (!item || !skillPath(item.path) || !value.commitSha) { incomplete = true; continue; }
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    const head: PublicHead = { slug: group.slug, commit: value.commitSha, empty: false };
    const fallback = pathMetadata(item.path, group, head, { sha: item.blobSha, size: item.bytes });
    skills.push({
      ...fallback,
      name: plain(item.name, 160) || fallback.name,
      description: plain(item.description, 1200) || fallback.description,
      categoryId: typeof item.categoryId === 'string' && /^[a-z\d][a-z\d-]{0,95}$/i.test(item.categoryId)
        ? item.categoryId : fallback.categoryId,
      metadata: item.metadata === 'manifest' ? 'manifest' : 'path',
      ...(typeof item.template === 'boolean' ? { template: item.template } : {}),
    });
  }
  return {
    ...sourceBase(group, value.scannedAt),
    ...(value.defaultBranch && typeof value.defaultBranch === 'string' ? { defaultBranch: value.defaultBranch.slice(0, 256) } : {}),
    ...(value.commitSha ? { commitSha: value.commitSha } : {}),
    ...(value.treeSha ? { treeSha: value.treeSha } : {}),
    status: incomplete && value.status === 'complete' ? 'partial' : value.status,
    skills,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return await response.json();
  const decoder = new TextDecoder();
  const pieces: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_JSON_BYTES) throw new Error('GitHub response exceeded the skills scan limit.');
      pieces.push(decoder.decode(next.value, { stream: true }));
    }
    pieces.push(decoder.decode());
    return JSON.parse(pieces.join('')) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function workers<T>(rows: readonly T[], concurrency: number, run: (row: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(rows.length, concurrency) }, async () => {
    while (next < rows.length) await run(rows[next++]);
  }));
}

/**
 * Scan only the public, effective repositories represented by the published library. Metadata
 * lookups prove public visibility before a tree is used. Only a tree failure after that proof
 * can retain the previous public cache. No file bodies, private API names, raw errors, credentials, commands
 * or local filesystem paths enter the index.
 */
export async function refreshSkillsIndex(repos: Repo[], previous: SkillsIndex | null, options: SkillsRefreshOptions = {}): Promise<SkillsIndex> {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const groups = new Map<string, SourceGroup>();
  let totalRepos = 0;
  for (const repo of repos) {
    if ((repo.visibility != null && repo.visibility !== 'public') || repo.github?.isPrivate) continue;
    const slug = primaryRepoSlug(repo);
    if (!slug || !isRepoSlug(slug)) continue;
    totalRepos++;
    const key = slug.toLowerCase();
    const group = groups.get(key);
    if (group) {
      if (!group.repoIds.includes(repo.id)) group.repoIds.push(repo.id);
    } else groups.set(key, { slug, repoIds: [repo.id], category: repo.catalog?.subCategory ?? repo.shelfId });
  }
  const old = new Map(previous?.schemaVersion === 1 && Array.isArray(previous.sources)
    ? previous.sources.flatMap(source => source && typeof source.sourceSlug === 'string' ? [[source.sourceSlug.toLowerCase(), source] as const] : []) : []);
  const cache = new Map([...groups].map(([key, group]) => [key, cachedSource(old.get(key), group)]));
  const token = options.token ?? process.env.GH_TOKEN;
  const fetcher = options.fetcher ?? fetch;
  // GitHub's abuse detector is sensitive to a large burst of recursive tree reads. This still
  // keeps the full library practical while making a cold scan more reliable on Pages runners.
  const concurrency = Math.max(1, bounded(options.concurrency, 3, 12));
  const maxRequests = bounded(options.maxRequests, DEFAULT_MAX_REQUESTS, 10_000);
  const maxSkills = bounded(options.maxSkillsPerSource, DEFAULT_MAX_SKILLS, DEFAULT_MAX_SKILLS);
  const maxFallbackTrees = bounded(options.maxFallbackTrees, DEFAULT_MAX_FALLBACK_TREES, 1_024);
  const maxDurationMs = bounded(options.maxDurationMs, 30 * 60_000, 60 * 60_000);
  const startedAt = Date.now();
  let requests = 0;
  let blocked = false;
  const request = async (route: string, query?: string): Promise<unknown | null> => {
    if (!token || blocked || requests >= maxRequests || Date.now() - startedAt >= maxDurationMs) return null;
    requests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(`https://api.github.com/${route}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
          'User-Agent': 'repo-shelf-public-skills', ...(query ? { 'Content-Type': 'application/json' } : {}) },
        ...(query ? { method: 'POST', body: JSON.stringify({ query }) } : {}),
        credentials: 'omit', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        // A single source can return 403 for a policy or visibility edge case. Only stop the
        // whole scan when GitHub explicitly signals credential/rate exhaustion; otherwise the
        // remaining independent public sources are still useful.
        if (response.status === 401 || response.status === 429
          || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
          blocked = true;
        }
        return null;
      }
      return await readJson(response);
    } catch { return null; }
    finally { clearTimeout(timer); }
  };

  const heads = new Map<string, PublicHead>();
  const privateSources = new Set<string>();
  const entries = [...groups];
  const batches = Array.from({ length: Math.ceil(entries.length / METADATA_BATCH_SIZE) }, (_, index) => entries.slice(index * METADATA_BATCH_SIZE, (index + 1) * METADATA_BATCH_SIZE));
  // Keep GraphQL metadata deliberately low-burst. Tree discovery remains concurrent below.
  await workers(batches, 1, async batch => {
    const query = `{${batch.map(([, group], index) => {
      const [owner, name] = group.slug.split('/');
      return `r${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){nameWithOwner isPrivate defaultBranchRef{name target{... on Commit{oid tree{oid}}}}}`;
    }).join('\n')}}`;
    const result = await request('graphql', query);
    if (!result || typeof result !== 'object') return;
    const data = (result as { data?: unknown }).data;
    const errors = (result as { errors?: unknown }).errors;
    if (!data || typeof data !== 'object') return;
    batch.forEach(([key, group], index) => {
      const value = (data as Record<string, unknown>)[`r${index}`];
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      // Never copy a credential-visible private identity, even into an unavailable entry.
      if (row.isPrivate === true) { privateSources.add(key); return; }
      // A field-level error can null defaultBranchRef. That is not proof of an empty repo,
      // and must not replace a previously indexed source with a complete empty result.
      if (Array.isArray(errors) && errors.some(error => {
        if (!error || typeof error !== 'object') return true;
        const errorPath = (error as { path?: unknown }).path;
        return !Array.isArray(errorPath) || !errorPath.length || errorPath[0] === `r${index}`;
      })) return;
      if (row.isPrivate !== false || typeof row.nameWithOwner !== 'string'
        || row.nameWithOwner.toLowerCase() !== key || !isRepoSlug(row.nameWithOwner)) return;
      if (row.defaultBranchRef === null) {
        heads.set(key, { slug: row.nameWithOwner, empty: true });
        return;
      }
      const branch = row.defaultBranchRef as { name?: unknown; target?: { oid?: unknown; tree?: { oid?: unknown } } } | undefined;
      if (!branch || typeof branch.name !== 'string' || !branch.name || branch.name.length > 256
        || !sha(branch.target?.oid) || !sha(branch.target?.tree?.oid)) return;
      heads.set(key, { slug: row.nameWithOwner, branch: branch.name, commit: branch.target.oid, tree: branch.target.tree.oid, empty: false });
      // Keep source spellings canonical without copying any other API metadata.
      group.slug = row.nameWithOwner;
    });
  });

  const sources = new Map<string, SkillSource>();
  await workers(entries, concurrency, async ([key, group]) => {
    if (privateSources.has(key)) return;
    const head = heads.get(key);
    // Publishing a stale path index is only safe after this run has positively established
    // that the source remains public. A failed, incomplete, or mismatched metadata response
    // must not carry forward a cache from a repository that may since have become private.
    if (!head) return;
    const previousSource = cache.get(key);
    const fallback = () => sources.set(key, previousSource
      ? { ...previousSource, repoIds: group.repoIds, status: previousSource.status === 'unavailable' ? 'unavailable' : 'partial' }
      : sourceBase(group, generatedAt));
    if (head.empty) {
      sources.set(key, { ...sourceBase(group, generatedAt), sourceSlug: head.slug, status: 'complete' });
      return;
    }
    if (previousSource?.status === 'complete' && previousSource.commitSha === head.commit) {
      sources.set(key, { ...previousSource, sourceSlug: head.slug, repoIds: group.repoIds,
        defaultBranch: head.branch, treeSha: head.tree });
      return;
    }
    const treeRoute = `repos/${head.slug.split('/').map(encodeURIComponent).join('/')}/git/trees/`;
    const tree = gitTree(await request(`${treeRoute}${head.tree}?recursive=1`), head.tree!);
    if (!tree) { fallback(); return; }
    let partial = tree.truncated || tree.tree.length > MAX_TREE_ENTRIES;
    const skills: SkillLocation[] = [];
    const seen = new Set<string>();
    const collectSkill = (entry: Record<string, unknown>, prefix: string) => {
      if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) return;
      if (typeof entry.path !== 'string' || !/(?:^|\/)skill\.md$/i.test(entry.path)) return;
      const file = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (!skillPath(file) || !sha(entry.sha)) { partial = true; return; }
      if (seen.has(file)) return;
      if (skills.length >= maxSkills) { partial = true; return; }
      seen.add(file);
      skills.push(pathMetadata(file, group, head, entry));
    };
    for (const value of tree.tree.slice(0, MAX_TREE_ENTRIES)) {
      if (value && typeof value === 'object') collectSkill(value as Record<string, unknown>, '');
    }
    if (tree.truncated) {
      // A recursive response can omit the tail of a monorepo. Start at its nonrecursive
      // root, then read each subtree recursively; split again only where GitHub truncates.
      // Prefixes belong to locations, so identical trees mounted at two paths stay distinct.
      interface PendingTree { tree: string; prefix: string; recursive: boolean; ancestors: string[] }
      const pending: PendingTree[] = [{ tree: head.tree!, prefix: '', recursive: false, ancestors: [] }];
      let examined = 0;
      let fetched = 0;
      partial = false;
      const enqueue = (item: PendingTree) => {
        if (pending.length >= maxFallbackTrees) { partial = true; return; }
        pending.push(item);
      };
      for (let index = 0; index < pending.length; index++) {
        if (fetched >= maxFallbackTrees || examined >= MAX_FALLBACK_ENTRIES) { partial = true; break; }
        const item = pending[index];
        fetched++;
        const subtree = gitTree(await request(`${treeRoute}${item.tree}${item.recursive ? '?recursive=1' : ''}`), item.tree);
        if (!subtree) { partial = true; continue; }
        if (subtree.tree.length > MAX_TREE_ENTRIES) partial = true;
        if (subtree.truncated) {
          if (item.recursive) enqueue({ ...item, recursive: false });
          else partial = true;
        }
        for (const value of subtree.tree.slice(0, MAX_TREE_ENTRIES)) {
          if (examined++ >= MAX_FALLBACK_ENTRIES) { partial = true; break; }
          if (!value || typeof value !== 'object') continue;
          const entry = value as Record<string, unknown>;
          // Nonrecursive tree names must be single safe segments. Never turn malformed
          // directory entries into API routes or claim that their descendants were scanned.
          if (!item.recursive && (!repoPath(entry.path) || entry.path.includes('/'))) { partial = true; continue; }
          collectSkill(entry, item.prefix);
          if (item.recursive || entry.type !== 'tree') continue;
          const prefix = item.prefix ? `${item.prefix}/${entry.path}` : entry.path;
          if (entry.mode !== '040000' || !sha(entry.sha) || !repoPath(prefix)
            || item.tree.toLowerCase() === entry.sha.toLowerCase() || item.ancestors.includes(entry.sha.toLowerCase())) {
            partial = true; continue;
          }
          enqueue({ tree: entry.sha, prefix, recursive: true, ancestors: [...item.ancestors, item.tree.toLowerCase()] });
        }
      }
    }
    skills.sort((a, b) => a.path.localeCompare(b.path));
    // A partial scan cannot prove previous paths were removed. Keep the last source result
    // intact rather than replacing it with a misleading empty or shortened list.
    if (partial && previousSource?.skills.length) { fallback(); return; }
    sources.set(key, {
      ...sourceBase(group, generatedAt), sourceSlug: head.slug,
      defaultBranch: head.branch, commitSha: head.commit, treeSha: head.tree,
      status: partial ? 'partial' : 'complete', skills,
    });
  });
  const rows = [...sources.values()].sort((a, b) => a.sourceSlug.localeCompare(b.sourceSlug));
  return {
    schemaVersion: 1, generatedAt, totalRepos,
    scannedRepos: rows.filter(source => source.status !== 'unavailable').reduce((sum, source) => sum + source.repoIds.length, 0),
    sources: rows,
  };
}

export async function writeSkillsIndex(root: string, index: SkillsIndex): Promise<void> {
  const dir = path.join(root, 'data');
  const file = path.join(dir, 'skills.public.json');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await fs.rename(`${file}.tmp`, file);
}

async function main(): Promise<void> {
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required to verify public skill sources. Existing index was not written.');
  const root = path.resolve(process.cwd());
  const library = await readPublicLibrary(root);
  let previous: SkillsIndex | null = null;
  try {
    previous = JSON.parse(await fs.readFile(path.join(root, 'data', 'skills.public.json'), 'utf8')) as SkillsIndex;
    if (previous.schemaVersion !== 1 || !Array.isArray(previous.sources)) throw new Error('Invalid skills index schema.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Existing skills cache could not be read safely; it was not replaced.');
  }
  const numberFromEnv = (name: string): number | undefined => {
    const value = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const index = await refreshSkillsIndex(library.repos, previous, {
    maxRequests: numberFromEnv('SHELF_SKILLS_MAX_REQUESTS'),
    concurrency: numberFromEnv('SHELF_SKILLS_CONCURRENCY'),
    maxDurationMs: numberFromEnv('SHELF_SKILLS_MAX_DURATION_MS'),
  });
  await writeSkillsIndex(root, index);
  const count = index.sources.reduce((sum, source) => sum + source.skills.length, 0);
  console.log(`Indexed ${count} skill locations from ${index.scannedRepos}/${index.totalRepos} public books (${index.sources.filter(source => source.status === 'partial').length} partial, ${index.sources.filter(source => source.status === 'unavailable').length} unavailable sources).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
