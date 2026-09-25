import crypto from 'node:crypto';
import fs from 'node:fs';
import type { AppState, Repo, Shelf } from './types.js';

export interface CatalogRepo {
  name: string;
  full_name: string;
  fork: boolean;
  upstream: string | null;
  commits_ahead: number;
  last_push: string | null;
  language: string;
  topics: string[];
  summary: string;
  card_path: string;
  card_generated_at: string;
  stale: boolean;
  confidence: 'high' | 'medium' | 'low' | 'unrecorded';
  verification_status: 'verified' | 'unverified';
  topics_source: string;
}

export interface CatalogDocument {
  schema_version: number;
  generated_at: string;
  source: string;
  repo_count: number;
  repos: CatalogRepo[];
}

interface Rule {
  id: string;
  label: string;
  description: string;
  topics: string[];
  phrases: RegExp;
}

/** Derived from recurring purposes in the published capability-card corpus. */
export const PURPOSE_SHELVES: Rule[] = [
  { id: 'mcp-integrations', label: 'MCP & Integrations', description: 'Protocol servers, connectors, gateways, and system integrations.', topics: ['mcp'], phrases: /\b(model context protocol|mcp server|mcp client|integration|connector|gateway)\b/g },
  { id: 'voice-audio', label: 'Voice & Audio', description: 'Speech, sound, transcription, synthesis, music, and audio production.', topics: ['voice'], phrases: /\b(voice|audio|speech|text-to-speech|tts|transcri(?:be|ption)|music|podcast|audiobook)\b/g },
  { id: 'video-creative', label: 'Video & Creative', description: 'Video, images, animation, 3D, VFX, design, and creative production.', topics: ['creative', 'video-generation', 'ai-video', 'seedance', 'text-to-video'], phrases: /\b(video|animation|image generation|image editing|3d|vfx|rendering|creative|design tool|filmmaking)\b/g },
  { id: 'finance-trading', label: 'Finance & Trading', description: 'Markets, portfolios, trading systems, payments, and financial analysis.', topics: ['finance'], phrases: /\b(finance|financial|trading|trader|portfolio|stock market|crypto market|payments?)\b/g },
  { id: 'security-privacy', label: 'Security & Privacy', description: 'Security analysis, identity, authentication, privacy, and defensive tooling.', topics: ['security'], phrases: /\b(security|privacy|vulnerabilit|exploit|authentication|authorization|identity|malware|pentest)\w*\b/g },
  { id: 'mobile-devices', label: 'Mobile & Devices', description: 'Mobile applications, embedded systems, device control, and automotive software.', topics: ['android'], phrases: /\b(android|ios|mobile app|embedded|device control|automotive|carplay|termux)\b/g },
  { id: 'knowledge-memory', label: 'Knowledge & Memory', description: 'Search, retrieval, research, memory, documents, and knowledge systems.', topics: ['memory', 'research'], phrases: /\b(memory|knowledge|retrieval|rag|research|search engine|document intelligence|note-taking|semantic search)\b/g },
  { id: 'models-learning', label: 'Models & Learning', description: 'Model training, inference, evaluation, datasets, and ML research.', topics: ['llm'], phrases: /\b(language model|machine learning|deep learning|model training|model inference|fine-tun|dataset|benchmark|evaluation)\w*\b/g },
  { id: 'agents-assistants', label: 'Agents & Assistants', description: 'Autonomous agents, assistants, planning, and task execution.', topics: ['ai-agents'], phrases: /\b(agent|agents|assistant|multi-agent|autonomous coding|computer use)\b/g },
  { id: 'web-automation', label: 'Web & Automation', description: 'Browser control, scraping, websites, workflows, and web applications.', topics: ['web', 'automation', 'scraping'], phrases: /\b(browser|web automation|scrap|crawler|website|web app|frontend|workflow automation|playwright)\w*\b/g },
  { id: 'developer-tools', label: 'Developer Tools', description: 'Tools for writing, understanding, testing, shipping, and operating software.', topics: ['code-tools'], phrases: /\b(developer tool|coding assistant|code analysis|code search|software development|command-line|cli|sdk|debugg|testing framework)\w*\b/g },
  { id: 'data-infrastructure', label: 'Data & Infrastructure', description: 'Databases, storage, cloud services, networking, and infrastructure.', topics: ['infra', 'database'], phrases: /\b(database|data platform|infrastructure|cloud platform|object storage|data pipeline|networking|message queue|cache server)\b/g },
];

const UNSHELVED = { id: 'unshelved', label: 'Unshelved', description: 'Repositories whose purpose is not clear enough to place confidently.' };

function occurrences(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

export function assignPurpose(repo: CatalogRepo): string {
  const topics = new Set(repo.topics.map((topic) => topic.toLowerCase()));
  const summary = repo.summary.toLowerCase();
  let winner = UNSHELVED.id;
  let high = 0;
  for (const rule of PURPOSE_SHELVES) {
    const score = rule.topics.reduce((n, topic) => n + (topics.has(topic) ? 8 : 0), 0) + occurrences(summary, rule.phrases) * 2;
    if (score > high) { high = score; winner = rule.id; }
  }
  return winner;
}

export function parseCatalog(value: unknown): CatalogDocument {
  if (!value || typeof value !== 'object') throw new Error('Catalog must be a JSON object.');
  const doc = value as CatalogDocument;
  if (!Array.isArray(doc.repos) || !Number.isInteger(doc.repo_count)) throw new Error('Catalog is missing repos or repo_count.');
  if (doc.repo_count !== doc.repos.length) throw new Error(`Catalog declares ${doc.repo_count} repositories but contains ${doc.repos.length}.`);
  const names = new Set<string>();
  for (const repo of doc.repos) {
    if (!repo?.name || !repo.full_name || !Array.isArray(repo.topics)) throw new Error('Catalog contains a malformed repository.');
    const key = repo.full_name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate repository: ${repo.full_name}`);
    names.add(key);
    if (repo.fork && !repo.upstream) throw new Error(`Fork ${repo.full_name} has no upstream attribution.`);
  }
  return doc;
}

export function catalogToState(value: unknown): AppState {
  const doc = parseCatalog(value);
  const repos = doc.repos.map<Repo>((item) => {
    const kind = item.fork ? (item.commits_ahead === 0 ? 'reference-copy' : 'authored-fork') : 'original';
    const shelfId = assignPurpose(item);
    const upstreamUrl = item.upstream ? `https://github.com/${item.upstream}` : null;
    const repoUrl = `https://github.com/${item.full_name}`;
    return {
      id: crypto.createHash('sha1').update(`catalog:${item.full_name.toLowerCase()}`).digest('hex').slice(0, 16),
      name: item.name, path: '', shelfId, virtual: true,
      linkUrl: upstreamUrl ?? repoUrl, visibility: 'public', archived: false,
      createdAt: null, doc: null, summary: item.summary, branch: null,
      lastCommitAt: item.last_push, commitCount: Math.max(0, item.commits_ahead), dirtyCount: 0, sizeKB: 0,
      languageGuess: item.language || null, remoteUrl: `${repoUrl}.git`, owner: item.full_name.split('/')[0] ?? null,
      repoSlug: item.full_name, github: {
        description: item.summary, language: item.language || null, stars: 0, topics: item.topics,
        isPrivate: false, isFork: item.fork, pushedAt: item.last_push ?? '', htmlUrl: repoUrl, fetchedAt: doc.generated_at,
      },
      catalog: {
        kind, upstream: item.upstream, commitsAhead: item.commits_ahead, repoUrl,
        cardStale: item.stale, verificationStatus: item.verification_status,
        confidence: item.confidence, cardGeneratedAt: item.card_generated_at,
        alive: Boolean(item.last_push) && new Date(doc.generated_at).getTime() - new Date(item.last_push!).getTime() <= 365 * 24 * 60 * 60 * 1000,
      },
    };
  });
  const counts = new Map<string, number>();
  for (const repo of repos) counts.set(repo.shelfId, (counts.get(repo.shelfId) ?? 0) + 1);
  const definitions = [...PURPOSE_SHELVES, UNSHELVED];
  const shelves = definitions
    .filter((definition) => (counts.get(definition.id) ?? 0) > 0)
    .map<Shelf>((definition) => ({ id: definition.id, label: definition.label, path: null, kind: 'catalog', hidden: false, repoCount: counts.get(definition.id) ?? 0 }));
  return { shelves, repos, github: { available: false, login: null }, config: { staleAfterDays: 365 } };
}

/**
 * Catalog books first, then the local shelves. An on-disk clone is always kept, even of a
 * cataloged repo: it is what can be opened, moved and renamed. So is a guide book: its
 * documentation pages are something the catalog book does not have. Any other virtual book that
 * duplicates a catalog entry is dropped, since the catalog book stands for it. When that duplicate
 * comes from a GitHub shelf, its live state (visibility, archived, metadata) is folded into the
 * catalog book, which then offers the same owner-checked GitHub actions.
 *
 * `deleted` lists slugs deleted on GitHub from this app: the catalog is a snapshot and would
 * otherwise put them back on the wall.
 */
export function mergeCatalog(catalog: AppState | null, shelves: Shelf[], repos: Repo[], deleted: ReadonlySet<string> = new Set()): { shelves: Shelf[]; repos: Repo[] } {
  if (!catalog) return { shelves, repos };
  const current = catalog.repos.filter((repo) => !repo.repoSlug || !deleted.has(repo.repoSlug.toLowerCase()));
  const slugs = new Set(current.map((repo) => repo.repoSlug?.toLowerCase()).filter(Boolean));
  const githubShelves = new Set(shelves.filter((s) => s.kind === 'github').map((s) => s.id));
  const live = new Map<string, Repo>();
  const kept: Repo[] = [];
  for (const repo of repos) {
    const slug = repo.repoSlug?.toLowerCase();
    if (!repo.virtual || repo.doc || !slug || !slugs.has(slug)) kept.push(repo);
    else if (githubShelves.has(repo.shelfId) && !live.has(slug)) live.set(slug, repo);
  }
  const books = current.map((book) => {
    const twin = book.repoSlug ? live.get(book.repoSlug.toLowerCase()) : undefined;
    if (!twin || !book.catalog) return book;
    return {
      ...book,
      visibility: twin.visibility,
      archived: twin.archived,
      createdAt: twin.createdAt ?? book.createdAt,
      github: twin.github ?? book.github,
      catalog: { ...book.catalog, githubShelfId: twin.shelfId },
    };
  });
  const counts = new Map<string, number>();
  for (const book of books) counts.set(book.shelfId, (counts.get(book.shelfId) ?? 0) + 1);
  const catalogShelves = catalog.shelves.map((s) => ({ ...s, repoCount: counts.get(s.id) ?? 0 })).filter((s) => s.repoCount > 0);
  return { shelves: [...catalogShelves, ...shelves], repos: [...books, ...kept] };
}

export function loadCatalogFile(file: string): AppState | null {
  if (!fs.existsSync(file)) return null;
  return catalogToState(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
}
