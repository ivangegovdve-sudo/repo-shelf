import { describe, expect, it } from 'vitest';
import {
  assignShelf,
  buildLibrary,
  filterBooks,
  isAlive,
  isReferenceCopy,
  type CatalogDocument,
  type CatalogRepo,
} from '../src/catalog/model';

const repo = (overrides: Partial<CatalogRepo> = {}): CatalogRepo => ({
  name: 'example',
  full_name: 'ivan/example',
  fork: false,
  upstream: null,
  commits_ahead: 0,
  last_push: '2026-09-01T00:00:00Z',
  language: 'TypeScript',
  topics: [],
  summary: 'A small example repository.',
  card_path: 'cards/example.md',
  card_generated_at: '2026-09-01T00:00:00Z',
  stale: false,
  confidence: 'high',
  verification_status: 'verified',
  topics_source: 'catalog_tags',
  ...overrides,
});

describe('purpose shelf derivation', () => {
  it.each([
    ['voice synthesis for expressive audiobooks', ['voice'], 'voice-audio'],
    ['MCP server for design tools', ['mcp'], 'mcp-integrations'],
    ['AI video editing and animation', ['creative'], 'video-creative'],
    ['vector database for production workloads', ['database'], 'data-infrastructure'],
    ['algorithmic portfolio and trading signals', ['finance'], 'finance-trading'],
    ['an Android app for in-car controls', ['android'], 'mobile-devices'],
  ])('places %s by purpose', (summary, topics, shelf) => {
    expect(assignShelf(repo({ summary, topics }))).toBe(shelf);
  });

  it('uses the visible Unshelved fallback instead of forcing an ambiguous repo', () => {
    expect(assignShelf(repo({ summary: 'Personal experiments and assorted notes.' }))).toBe('unshelved');
  });

  it('assigns every repository to exactly one shelf', () => {
    const document: CatalogDocument = {
      schema_version: 1,
      generated_at: '2026-09-25T07:07:00Z',
      source: 'test',
      repo_count: 3,
      repos: [repo(), repo({ name: 'speech', summary: 'Speech recognition toolkit.' }), repo({ name: 'odd', summary: 'Miscellaneous.' })],
    };
    const library = buildLibrary(document);
    expect(library.books).toHaveLength(3);
    expect(library.shelves.reduce((sum, shelf) => sum + shelf.count, 0)).toBe(3);
    expect(new Set(library.books.map((book) => book.shelfId)).size).toBeGreaterThan(0);
  });
});

describe('library semantics', () => {
  it('makes untouched forks reference copies but keeps authored forks distinct', () => {
    expect(isReferenceCopy(repo({ fork: true, commits_ahead: 0 }))).toBe(true);
    expect(isReferenceCopy(repo({ fork: true, commits_ahead: 2 }))).toBe(false);
    expect(isReferenceCopy(repo({ fork: false, commits_ahead: 0 }))).toBe(false);
  });

  it('defines alive as pushed within 365 days of the catalog snapshot', () => {
    const generated = '2026-09-25T07:07:00Z';
    expect(isAlive('2026-01-01T00:00:00Z', generated)).toBe(true);
    expect(isAlive('2024-01-01T00:00:00Z', generated)).toBe(false);
    expect(isAlive(null, generated)).toBe(false);
  });

  it('searches only name and one-line description and supports originals-only', () => {
    const document: CatalogDocument = {
      schema_version: 1,
      generated_at: '2026-09-25T07:07:00Z',
      source: 'test',
      repo_count: 2,
      repos: [
        repo({ name: 'council', summary: 'Runs multi-model deliberation.', topics: ['mcp'] }),
        repo({ name: 'borrowed', fork: true, summary: 'Browser automation reference.', topics: ['web'] }),
      ],
    };
    const books = buildLibrary(document).books;
    expect(filterBooks(books, { query: 'deliberation', shelfId: 'all', originalsOnly: false }).map((x) => x.name)).toEqual(['council']);
    expect(filterBooks(books, { query: 'mcp', shelfId: 'all', originalsOnly: false })).toHaveLength(0);
    expect(filterBooks(books, { query: '', shelfId: 'all', originalsOnly: true }).map((x) => x.name)).toEqual(['council']);
  });
});
