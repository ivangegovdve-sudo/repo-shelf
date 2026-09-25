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

export interface ShelfDefinition {
  id: string;
  label: string;
  description: string;
  count: number;
}

export interface LibraryBook extends CatalogRepo {
  shelfId: string;
  alive: boolean;
  referenceCopy: boolean;
  kind: 'original' | 'authored-fork' | 'reference-copy';
}

export interface Library {
  generatedAt: string;
  books: LibraryBook[];
  shelves: ShelfDefinition[];
}

interface ShelfRule extends Omit<ShelfDefinition, 'count'> {
  topics: string[];
  phrases: RegExp;
}

/**
 * Names and vocabulary come from TF-IDF/K-means review of the published card
 * summaries and their curated topics. Rules are deliberately about purpose,
 * never implementation language or popularity.
 */
const SHELF_RULES: ShelfRule[] = [
  {
    id: 'mcp-integrations',
    label: 'MCP & Integrations',
    description: 'Protocol servers, connectors, gateways, and tools that join systems together.',
    topics: ['mcp'],
    phrases: /\b(model context protocol|mcp server|mcp client|integration|connector|gateway)\b/g,
  },
  {
    id: 'voice-audio',
    label: 'Voice & Audio',
    description: 'Speech, sound, transcription, synthesis, music, and conversational audio.',
    topics: ['voice'],
    phrases: /\b(voice|audio|speech|text-to-speech|tts|transcri(?:be|ption)|music|podcast|audiobook)\b/g,
  },
  {
    id: 'video-creative',
    label: 'Video & Creative',
    description: 'Video, images, animation, 3D, VFX, design, and creative production.',
    topics: ['creative', 'video-generation', 'ai-video', 'seedance', 'text-to-video'],
    phrases: /\b(video|animation|image generation|image editing|3d|vfx|rendering|creative|design tool|filmmaking)\b/g,
  },
  {
    id: 'finance-trading',
    label: 'Finance & Trading',
    description: 'Market research, portfolios, trading systems, payments, and financial analysis.',
    topics: ['finance'],
    phrases: /\b(finance|financial|trading|trader|portfolio|stock market|crypto market|payments?)\b/g,
  },
  {
    id: 'security-privacy',
    label: 'Security & Privacy',
    description: 'Security analysis, identity, authentication, privacy, and defensive tooling.',
    topics: ['security'],
    phrases: /\b(security|privacy|vulnerabilit|exploit|authentication|authorization|identity|malware|pentest)\w*\b/g,
  },
  {
    id: 'mobile-devices',
    label: 'Mobile & Devices',
    description: 'Mobile applications, embedded systems, device control, and automotive software.',
    topics: ['android'],
    phrases: /\b(android|ios|mobile app|embedded|device control|automotive|carplay|termux)\b/g,
  },
  {
    id: 'knowledge-memory',
    label: 'Knowledge & Memory',
    description: 'Search, retrieval, research, memory, documents, and knowledge systems.',
    topics: ['memory', 'research'],
    phrases: /\b(memory|knowledge|retrieval|rag|research|search engine|document intelligence|note-taking|semantic search)\b/g,
  },
  {
    id: 'models-research',
    label: 'Models & Learning',
    description: 'Model training, inference, evaluation, datasets, and machine-learning research.',
    topics: ['llm'],
    phrases: /\b(language model|machine learning|deep learning|model training|model inference|fine-tun|dataset|benchmark|evaluation)\w*\b/g,
  },
  {
    id: 'agents-assistants',
    label: 'Agents & Assistants',
    description: 'Autonomous agents, assistants, and systems for planning and task execution.',
    topics: ['ai-agents'],
    phrases: /\b(agent|agents|assistant|multi-agent|autonomous coding|computer use)\b/g,
  },
  {
    id: 'web-automation',
    label: 'Web & Automation',
    description: 'Browser control, scraping, websites, workflow automation, and web applications.',
    topics: ['web', 'automation', 'scraping'],
    phrases: /\b(browser|web automation|scrap|crawler|website|web app|frontend|workflow automation|playwright)\w*\b/g,
  },
  {
    id: 'developer-tools',
    label: 'Developer Tools',
    description: 'Tools for writing, understanding, testing, shipping, and operating software.',
    topics: ['code-tools'],
    phrases: /\b(developer tool|coding assistant|code analysis|code search|software development|command-line|\bcli\b|\bsdk\b|debugg|testing framework)\w*\b/g,
  },
  {
    id: 'data-infrastructure',
    label: 'Data & Infrastructure',
    description: 'Databases, storage, cloud platforms, services, networking, and infrastructure.',
    topics: ['infra', 'database'],
    phrases: /\b(database|data platform|infrastructure|cloud platform|object storage|data pipeline|networking|message queue|cache server)\b/g,
  },
];

const UNSHELVED: Omit<ShelfDefinition, 'count'> = {
  id: 'unshelved',
  label: 'Unshelved',
  description: 'Repositories whose purpose is not clear enough to place confidently.',
};

function occurrences(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

export function assignShelf(repo: CatalogRepo): string {
  const topicSet = new Set(repo.topics.map((topic) => topic.toLowerCase()));
  const summary = repo.summary.toLowerCase();
  let winner = UNSHELVED.id;
  let highScore = 0;
  for (const rule of SHELF_RULES) {
    const topicScore = rule.topics.reduce((score, topic) => score + (topicSet.has(topic) ? 8 : 0), 0);
    const score = topicScore + occurrences(summary, rule.phrases) * 2;
    if (score > highScore) {
      winner = rule.id;
      highScore = score;
    }
  }
  return winner;
}

export function isReferenceCopy(repo: Pick<CatalogRepo, 'fork' | 'commits_ahead'>): boolean {
  return repo.fork && repo.commits_ahead === 0;
}

export function isAlive(lastPush: string | null, generatedAt: string): boolean {
  if (!lastPush) return false;
  const pushed = new Date(lastPush).getTime();
  const generated = new Date(generatedAt).getTime();
  if (!Number.isFinite(pushed) || !Number.isFinite(generated)) return false;
  return generated - pushed <= 365 * 24 * 60 * 60 * 1000;
}

export function buildLibrary(document: CatalogDocument): Library {
  if (document.repo_count !== document.repos.length) {
    throw new Error(`Catalog declares ${document.repo_count} repositories but contains ${document.repos.length}.`);
  }
  const names = new Set<string>();
  const books = document.repos.map<LibraryBook>((repo) => {
    const key = repo.name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate repository name: ${repo.name}`);
    names.add(key);
    const referenceCopy = isReferenceCopy(repo);
    return {
      ...repo,
      shelfId: assignShelf(repo),
      alive: isAlive(repo.last_push, document.generated_at),
      referenceCopy,
      kind: referenceCopy ? 'reference-copy' : repo.fork ? 'authored-fork' : 'original',
    };
  });
  const counts = new Map<string, number>();
  for (const book of books) counts.set(book.shelfId, (counts.get(book.shelfId) ?? 0) + 1);
  const shelves = [...SHELF_RULES, UNSHELVED].map<ShelfDefinition>((shelf) => ({
    id: shelf.id,
    label: shelf.label,
    description: shelf.description,
    count: counts.get(shelf.id) ?? 0,
  }));
  return { generatedAt: document.generated_at, books, shelves };
}

export interface BookFilters {
  query: string;
  shelfId: string;
  originalsOnly: boolean;
}

export function filterBooks(books: LibraryBook[], filters: BookFilters): LibraryBook[] {
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return books.filter((book) => {
    if (filters.shelfId !== 'all' && book.shelfId !== filters.shelfId) return false;
    if (filters.originalsOnly && book.fork) return false;
    const haystack = `${book.name}\n${book.summary}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function relativePush(lastPush: string | null, generatedAt: string): string {
  if (!lastPush) return 'date unknown';
  const pushed = new Date(lastPush).getTime();
  const generated = new Date(generatedAt).getTime();
  if (!Number.isFinite(pushed) || !Number.isFinite(generated)) return 'date unknown';
  const days = Math.max(0, Math.floor((generated - pushed) / (24 * 60 * 60 * 1000)));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}
