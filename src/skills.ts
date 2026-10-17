import { displayName } from './derive';
import { isRepoSlug } from './repoIdentity';
import { SUB_CATEGORIES } from './taxonomy';

export type SkillCategoryId = typeof SUB_CATEGORIES[number]['id'];
export type SkillScanStatus = 'complete' | 'partial' | 'unavailable';

/** Compact public metadata only. Skill Markdown is fetched separately when opened. */
export interface SkillLocation {
  path: string;
  blobSha?: string;
  bytes?: number;
  name: string;
  description: string;
  categoryId: string;
  sourceUrl: string;
  metadata: 'manifest' | 'path';
  template?: boolean;
}

export interface SkillSource {
  sourceSlug: string;
  repoIds: string[];
  sourceCategoryId?: string;
  defaultBranch?: string;
  commitSha?: string;
  treeSha?: string;
  scannedAt: string;
  status: SkillScanStatus;
  skills: SkillLocation[];
}

export interface SkillsIndex {
  schemaVersion: 1;
  generatedAt: string;
  totalRepos: number;
  scannedRepos: number;
  sources: SkillSource[];
}

export interface SkillEntryLocation extends SkillLocation {
  sourceSlug: string;
  repoIds: string[];
  defaultBranch?: string;
  commitSha?: string;
  scannedAt: string;
  status: SkillScanStatus;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  categoryId: SkillCategoryId;
  locations: SkillEntryLocation[];
  sourceCount: number;
  occurrenceCount: number;
  /** True only when every known location is marked as a template. */
  template?: boolean;
}

export interface SkillsMeta {
  generatedAt: string;
  totalRepos: number;
  scannedRepos: number;
  sourceCount: number;
  completeSources: number;
  partialSources: number;
  unavailableSources: number;
  skillCount: number;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
}

type SkillMetadata = SkillFrontmatter & { categoryId?: string };
const FRONTMATTER_LIMIT = 16_384;
const FRONTMATTER_LINES = 256;

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

/** A deliberately small scalar reader: no tags, references, objects or evaluation. */
function scalar(value: string): string | undefined {
  const raw = value.trim();
  if (!raw || /^[&*!\[\]{}>|]/.test(raw)) return undefined;
  if (raw.startsWith('"') || raw.startsWith("'")) {
    const quote = raw[0];
    for (let i = 1; i < raw.length; i++) {
      if (quote === '"' && raw[i] === '\\') { i++; continue; }
      if (raw[i] !== quote) continue;
      if (quote === "'" && raw[i + 1] === "'") { i++; continue; }
      if (!/^\s*(?:#.*)?$/.test(raw.slice(i + 1))) return undefined;
      if (quote === "'") return raw.slice(1, i).replace(/''/g, "'");
      try { return JSON.parse(raw.slice(0, i + 1)) as string; } catch { return undefined; }
    }
    return undefined;
  }
  const plain = raw.replace(/\s+#.*$/, '').trim();
  return /^(?:null|true|false|~)$/i.test(plain) ? undefined : plain;
}

function tagList(value: string): string[] {
  if (!value.trim().startsWith('[') || !value.trim().endsWith(']')) return [];
  const body = value.trim().slice(1, -1);
  const parts: string[] = [];
  let start = 0;
  let quote = '';
  for (let i = 0; i <= body.length; i++) {
    if (quote) {
      if (quote === '"' && body[i] === '\\') { i++; continue; }
      if (body[i] === quote) {
        if (quote === "'" && body[i + 1] === "'") { i++; continue; }
        quote = '';
      }
    } else if (body[i] === '"' || body[i] === "'") quote = body[i];
    else if (body[i] === ',' || i === body.length) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  return quote ? [] : parts.slice(0, 32).flatMap((part) => {
    const tag = text(scalar(part), 64);
    return tag ? [tag] : [];
  });
}

/** Read bounded top-level YAML metadata without retaining or executing the Markdown body. */
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  if (typeof markdown !== 'string') return {};
  const lines = markdown.slice(0, FRONTMATTER_LIMIT).replace(/^\uFEFF/, '').split(/\r?\n/, FRONTMATTER_LINES + 1);
  if (!/^---[ \t]*$/.test(lines[0])) return {};
  const end = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (end < 0 || end > FRONTMATTER_LINES) return {};
  const result: SkillFrontmatter = {};
  for (let i = 1; i < end; i++) {
    const match = /^([a-z][\w-]*):(?:[ \t]+(.*)|[ \t]*)$/i.exec(lines[i]);
    if (!match) continue;
    const key = match[1].toLowerCase().replace(/[-_]/g, '');
    let value = match[2] ?? '';
    if (!['name', 'description', 'category', 'categoryid', 'tags'].includes(key)) continue;
    const blockScalar = /^[>|][+-]?$/.test(value.trim());
    if (blockScalar) {
      const block: string[] = [];
      while (i + 1 < end && (/^[ \t]/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i]);
      value = block.join(' ').trim();
    }
    if (key === 'tags') {
      const tags = value.trim() ? tagList(value) : [];
      if (!value.trim()) {
        while (i + 1 < end && /^[ \t]+-[ \t]+/.test(lines[i + 1])) {
          const tag = text(scalar(lines[++i].replace(/^[ \t]+-[ \t]+/, '')), 64);
          if (tag && tags.length < 32) tags.push(tag);
        }
      }
      if (tags.length) result.tags = [...new Set(tags)];
      continue;
    }
    const parsed = text(blockScalar ? value : scalar(value), key === 'description' ? 1200 : key === 'name' ? 160 : 96);
    if (!parsed) continue;
    if (key === 'category' || key === 'categoryid') result.category = parsed;
    else result[key as 'name' | 'description'] = parsed;
  }
  return result;
}

const normalizeCategory = (value: string) => value.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const TOP_DEFAULTS: Record<string, SkillCategoryId> = {
  intelligence: 'agents-assistants', creative: 'video-creative', engineering: 'developer-tools',
  'trust-finance': 'security-privacy', devices: 'mobile-devices', explore: 'unshelved',
};

function categoryOf(value: unknown): SkillCategoryId | undefined {
  if (typeof value !== 'string') return undefined;
  const category = normalizeCategory(value);
  return SUB_CATEGORIES.find((item) => item.id === category || normalizeCategory(item.label) === category)?.id ?? TOP_DEFAULTS[category];
}

const CATEGORY_WORDS: Partial<Record<SkillCategoryId, RegExp>> = {
  'agents-assistants': /\b(agent|agents|assistant|orchestrat\w*|delegat\w*|planning|autonomous)\b/gi,
  'models-learning': /\b(model|models|training|inference|machine learning|deep learning|fine tun\w*|evaluation|dataset\w*|benchmark\w*|llm)\b/gi,
  'knowledge-memory': /\b(research|knowledge|memory|rag|retrieval|search|document\w*|notebook|notes|pdf|epub|wikipedia)\b/gi,
  'voice-audio': /\b(audio|speech|voice|sound|music|transcrib\w*|podcast|tts|stt|audiobook)\b/gi,
  'video-creative': /\b(video|cinema\w*|film\w*|image\w*|illustrat\w*|animat\w*|3d|blender|figma|design|photo\w*|media|svg|canvas)\b/gi,
  'mcp-integrations': /\b(mcp|integration\w*|connector\w*|gateway|model context protocol)\b/gi,
  'web-automation': /\b(browser|website|frontend|front end|html|css|react|nextjs|next\.js|playwright|web|scrap\w*|crawl\w*|webhook\w*)\b/gi,
  'developer-tools': /\b(test|testing|debug\w*|git|github|refactor\w*|cli|sdk|code review|developer tools|software|lint\w*|api design)\b/gi,
  'data-infrastructure': /\b(database|sql|postgres\w*|mysql|sqlite|data|analytics|infrastructure|cloud|aws|gcp|azure|docker|kubernetes|storage|pipeline\w*|cache|network\w*)\b/gi,
  'security-privacy': /\b(security|privacy|auth\w*|vulnerab\w*|penetration|pentest\w*|malware|threat|encrypt\w*|secrets)\b/gi,
  'finance-trading': /\b(finance|financial|trading|portfolio|stock|crypto|payment\w*|invoice\w*|accounting|tax|invest\w*)\b/gi,
  'mobile-devices': /\b(android|ios|swift|kotlin|mobile|device\w*|embedded|arduino|robot\w*|bluetooth|esp32)\b/gi,
};

/** Declared category, then skill purpose, then the source book's category, then Other. */
export function inferSkillCategory(metadata: SkillMetadata | string, sourceCategoryId?: string): SkillCategoryId {
  const info = typeof metadata === 'string' ? { name: metadata } : metadata;
  const declared = categoryOf(info.categoryId) ?? categoryOf(info.category);
  if (declared) return declared;
  const words = (value: unknown) => text(value, 2048).replace(/[-_/]/g, ' ');
  const name = words(info.name);
  const description = words(info.description);
  const tags = words((info.tags ?? []).slice(0, 32).join(' '));
  let winner: SkillCategoryId | undefined;
  let score = 0;
  for (const category of SUB_CATEGORIES) {
    const pattern = CATEGORY_WORDS[category.id];
    if (!pattern) continue;
    const count = (value: string) => [...value.matchAll(new RegExp(pattern))].length;
    // "Agent" describes many skill packages; a concrete domain should win a tie.
    const next = (count(name) * 4 + count(description) + count(tags) * 6) * (category.id === 'agents-assistants' ? 0.5 : 1);
    if (next > score) { score = next; winner = category.id; }
  }
  return winner ?? categoryOf(sourceCategoryId) ?? 'unshelved';
}

export function skillNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const folder = parts.length > 1 ? parts[parts.length - 2] : 'skill';
  return displayName(folder);
}

function validPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 2048 && !/[\\\u0000-\u001f\u007f]/.test(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
    && /(?:^|\/)skill\.md$/i.test(path);
}

function sourceUrl(source: SkillSource, location: SkillLocation): string {
  try {
    const url = new URL(location.sourceUrl);
    if (url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password
      && url.pathname.toLowerCase().startsWith(`/${source.sourceSlug.toLowerCase()}/blob/`)) return url.href;
  } catch { /* Derive a safe source link when metadata is malformed. */ }
  const ref = source.commitSha || source.defaultBranch || 'HEAD';
  return `https://github.com/${source.sourceSlug}/blob/${encodeURIComponent(ref)}/${location.path.split('/').map(encodeURIComponent).join('/')}`;
}

const compareLocations = (a: SkillEntryLocation, b: SkillEntryLocation) =>
  Number(a.metadata !== 'manifest') - Number(b.metadata !== 'manifest')
  || Number(Boolean(a.template)) - Number(Boolean(b.template))
  || a.sourceSlug.toLowerCase().localeCompare(b.sourceSlug.toLowerCase()) || a.path.localeCompare(b.path);

/** Content-identical copies share a card; every distinct source path remains available as provenance. */
export function compileSkills(index: SkillsIndex): SkillEntry[] {
  const locations = new Map<string, SkillEntryLocation>();
  for (const source of index.sources ?? []) {
    if (typeof source.sourceSlug !== 'string' || !isRepoSlug(source.sourceSlug) || !Array.isArray(source.skills)) continue;
    for (const skill of source.skills) {
      if (!skill || !validPath(skill.path)) continue;
      const location: SkillEntryLocation = {
        path: skill.path, name: text(skill.name, 160) || skillNameFromPath(skill.path),
        description: text(skill.description, 1200),
        categoryId: inferSkillCategory(skill, source.sourceCategoryId),
        sourceUrl: sourceUrl(source, skill), metadata: skill.metadata === 'manifest' ? 'manifest' : 'path',
        sourceSlug: source.sourceSlug, repoIds: [...new Set((source.repoIds ?? []).filter((id) => typeof id === 'string' && id.length > 0))].sort(),
        scannedAt: source.scannedAt, status: source.status,
        ...(source.defaultBranch ? { defaultBranch: source.defaultBranch } : {}),
        ...(source.commitSha ? { commitSha: source.commitSha } : {}),
        ...(typeof skill.blobSha === 'string' && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(skill.blobSha) ? { blobSha: skill.blobSha.toLowerCase() } : {}),
        ...(typeof skill.bytes === 'number' && Number.isSafeInteger(skill.bytes) && skill.bytes >= 0 ? { bytes: skill.bytes } : {}),
        ...(skill.template ? { template: true } : {}),
      };
      const key = `${source.sourceSlug.toLowerCase()}\0${skill.path}`;
      const previous = locations.get(key);
      if (!previous) locations.set(key, location);
      else {
        const fresh = (Date.parse(location.scannedAt) || 0) - (Date.parse(previous.scannedAt) || 0);
        const preferred = fresh > 0 || (fresh === 0 && compareLocations(location, previous) < 0) ? location : previous;
        locations.set(key, { ...preferred, repoIds: [...new Set([...previous.repoIds, ...location.repoIds])].sort() });
      }
    }
  }
  const groups = new Map<string, SkillEntryLocation[]>();
  for (const location of locations.values()) {
    const id = location.blobSha ? `blob:${location.blobSha}` : `path:${location.sourceSlug.toLowerCase()}:${location.path}`;
    const group = groups.get(id) ?? [];
    group.push(location);
    groups.set(id, group);
  }
  return [...groups].map(([id, occurrences]): SkillEntry => {
    occurrences.sort(compareLocations);
    const first = occurrences[0];
    return {
      id, name: first.name, description: first.description,
      categoryId: inferSkillCategory(first), locations: occurrences,
      sourceCount: new Set(occurrences.map((item) => item.sourceSlug.toLowerCase())).size,
      occurrenceCount: occurrences.length,
      ...(occurrences.every((item) => item.template) ? { template: true } : {}),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function filterSkills(entries: readonly SkillEntry[], filters: { query?: string; category?: string } = {}): SkillEntry[] {
  const terms = text(filters.query, 2048).toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filters.category && filters.category !== 'all' && entry.categoryId !== filters.category) return false;
    const haystack = [entry.name, entry.description, entry.categoryId, ...entry.locations.flatMap((location) => [location.sourceSlug, location.path])].join('\n').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function groupSkills(entries: readonly SkillEntry[]) {
  return SUB_CATEGORIES.map((category) => {
    const skills = entries.filter((entry) => entry.categoryId === category.id);
    return { ...category, count: skills.length, skills };
  }).filter((category) => category.count > 0);
}

export function skillsMeta(index: SkillsIndex, entries: readonly SkillEntry[]): SkillsMeta {
  const sources = new Map((index.sources ?? []).filter((source) => typeof source.sourceSlug === 'string' && isRepoSlug(source.sourceSlug))
    .map((source) => [source.sourceSlug.toLowerCase(), source]));
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const totalRepos = count(index.totalRepos);
  return {
    generatedAt: index.generatedAt, totalRepos, scannedRepos: Math.min(totalRepos, count(index.scannedRepos)),
    sourceCount: sources.size,
    completeSources: [...sources.values()].filter((source) => source.status === 'complete').length,
    partialSources: [...sources.values()].filter((source) => source.status === 'partial').length,
    unavailableSources: [...sources.values()].filter((source) => source.status === 'unavailable').length,
    skillCount: entries.length,
  };
}
