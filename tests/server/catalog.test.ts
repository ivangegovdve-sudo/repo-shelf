import { describe, expect, it } from 'vitest';
import { catalogToState, mergeCatalog, parseCatalog, type CatalogDocument, type CatalogRepo } from '../../server/catalog';
import type { Repo, Shelf } from '../../server/types';
import fs from 'node:fs';
import path from 'node:path';

function item(over: Partial<CatalogRepo> = {}): CatalogRepo {
  return {
    name: 'voice-tool',
    full_name: 'ivangegovdve-sudo/voice-tool',
    fork: false,
    upstream: null,
    commits_ahead: 4,
    last_push: '2026-09-20T00:00:00Z',
    language: 'TypeScript',
    topics: ['voice'],
    summary: 'Turns text into natural speech.',
    card_path: 'cards/voice-tool.md',
    card_generated_at: '2026-09-25T00:00:00Z',
    stale: false,
    confidence: 'high',
    verification_status: 'verified',
    topics_source: 'catalog_tags',
    ...over,
  };
}

function catalog(repos: CatalogRepo[]): CatalogDocument {
  return {
    schema_version: 1,
    generated_at: '2026-09-25T00:00:00Z',
    source: 'repoindex/catalog.db',
    repo_count: repos.length,
    repos,
  };
}

describe('catalogToState', () => {
  it('derives purpose shelves and puts every repo on exactly one shelf', () => {
    const state = catalogToState(catalog([
      item(),
      item({ name: 'mystery', full_name: 'ivangegovdve-sudo/mystery', topics: [], summary: 'A collection of assorted experiments.' }),
    ]));
    expect(state.repos).toHaveLength(2);
    expect(state.repos.find((r) => r.name === 'voice-tool')?.shelfId).toBe('voice-audio');
    expect(state.repos.find((r) => r.name === 'mystery')?.shelfId).toBe('unshelved');
    expect(state.repos.every((r) => state.shelves.some((s) => s.id === r.shelfId))).toBe(true);
  });

  it('links forks to upstream and distinguishes references, authored forks, and originals', () => {
    const state = catalogToState(catalog([
      item({ name: 'reference', full_name: 'ivangegovdve-sudo/reference', fork: true, upstream: 'real/reference', commits_ahead: 0 }),
      item({ name: 'changed-fork', full_name: 'ivangegovdve-sudo/changed-fork', fork: true, upstream: 'real/project', commits_ahead: 3 }),
      item({ name: 'original', full_name: 'ivangegovdve-sudo/original', fork: false, upstream: null }),
    ]));
    const [reference, authoredFork, original] = state.repos;
    expect(reference.linkUrl).toBe('https://github.com/real/reference');
    expect(reference.catalog).toMatchObject({ kind: 'reference-copy', upstream: 'real/reference', repoUrl: 'https://github.com/ivangegovdve-sudo/reference' });
    expect(authoredFork.catalog).toMatchObject({ kind: 'authored-fork', upstream: 'real/project' });
    expect(original.catalog).toMatchObject({ kind: 'original', upstream: null });
    expect(original.catalog?.alive).toBe(true);
  });

  it('preserves card stale and verification status and rejects malformed catalogs', () => {
    const state = catalogToState(catalog([item({ stale: true, confidence: 'low', verification_status: 'unverified' })]));
    expect(state.repos[0].catalog).toMatchObject({ cardStale: true, confidence: 'low', verificationStatus: 'unverified', alive: true });
    expect(() => parseCatalog({ ...catalog([item()]), repo_count: 2 })).toThrow(/declares 2/);
  });
});

describe('bundled public catalog', () => {
  it('is complete, attributable, and safe to publish as virtual public books', () => {
    const file = path.resolve('data/catalog.public.json');
    const doc = parseCatalog(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
    const state = catalogToState(doc);
    expect(state.repos).toHaveLength(doc.repo_count);
    expect(state.repos.every((repo) => repo.virtual && repo.visibility === 'public' && repo.path === '')).toBe(true);
    expect(doc.repos.filter((repo) => repo.fork).every((repo) => Boolean(repo.upstream))).toBe(true);
    expect(state.repos.filter((repo) => repo.catalog?.kind === 'reference-copy').length).toBeGreaterThan(1_000);
    expect(state.repos.filter((repo) => repo.catalog?.kind === 'original').length).toBeGreaterThan(0);
    expect(state.repos.every((repo) => state.shelves.some((shelf) => shelf.id === repo.shelfId))).toBe(true);
  });
});

describe('mergeCatalog', () => {
  const local = (over: Partial<Repo>): Repo => ({
    ...catalogToState(catalog([item()])).repos[0],
    catalog: undefined, virtual: false, shelfId: 'disk', path: '/projects/voice-tool', ...over,
  });
  const diskShelf: Shelf = { id: 'disk', label: 'Projects', path: '/projects', kind: 'disk', hidden: false, repoCount: 1 };

  it('keeps an on-disk clone of a cataloged repo, and drops only virtual GitHub duplicates', () => {
    const cat = catalogToState(catalog([item()]));
    const clone = local({ id: 'clone', repoSlug: 'ivangegovdve-sudo/voice-tool' });
    const ghDuplicate = local({ id: 'gh', virtual: true, path: '', shelfId: 'gh', repoSlug: 'IvanGegovDVE-sudo/Voice-Tool' });
    const other = local({ id: 'other', repoSlug: 'someone/else' });
    const merged = mergeCatalog(cat, [diskShelf], [clone, ghDuplicate, other]);
    expect(merged.repos.map((r) => r.id)).toEqual([cat.repos[0].id, 'clone', 'other']);
    expect(merged.shelves.map((s) => s.id)).toEqual([...cat.shelves.map((s) => s.id), 'disk']);
    expect(mergeCatalog(null, [diskShelf], [clone])).toEqual({ shelves: [diskShelf], repos: [clone] });
  });

  it('folds a GitHub-shelf duplicate’s live state into the catalog book; a link duplicate is just dropped', () => {
    const cat = catalogToState(catalog([item(), item({ name: 'reader', full_name: 'ivangegovdve-sudo/reader' })]));
    const ghShelf: Shelf = { id: 'gh', label: 'GitHub', path: null, kind: 'github', hidden: false, repoCount: 1 };
    const linkShelf: Shelf = { id: 'links', label: 'Reads', path: null, kind: 'links', hidden: false, repoCount: 1 };
    const live = local({ id: 'gh-voice', virtual: true, path: '', shelfId: 'gh', visibility: 'private', archived: true, createdAt: '2024-01-02T00:00:00Z' });
    const link = local({ id: 'link-reader', virtual: true, path: '', shelfId: 'links', repoSlug: 'ivangegovdve-sudo/reader', visibility: null });
    const merged = mergeCatalog(cat, [ghShelf, linkShelf], [live, link]);
    expect(merged.repos.map((r) => r.id)).toEqual(cat.repos.map((r) => r.id));
    const [voice, reader] = merged.repos;
    expect(voice).toMatchObject({ visibility: 'private', archived: true, createdAt: '2024-01-02T00:00:00Z' });
    expect(voice.catalog).toMatchObject({ kind: 'original', githubShelfId: 'gh' });
    expect(reader).toEqual(cat.repos[1]);
  });

  it('keeps a guide book that shares a catalog slug: its documentation pages have nowhere else to live', () => {
    const cat = catalogToState(catalog([item()]));
    const guide = local({ id: 'guide', virtual: true, path: '', shelfId: 'links', doc: 'https://github.com/ivangegovdve-sudo/voice-tool/tree/main/docs' });
    expect(mergeCatalog(cat, [], [guide]).repos.map((r) => r.id)).toEqual([cat.repos[0].id, 'guide']);
  });

  it('leaves out catalog repos deleted on GitHub, and bays they emptied', () => {
    const cat = catalogToState(catalog([item(), item({ name: 'reader', full_name: 'ivangegovdve-sudo/reader', topics: ['ebook'], summary: 'Reads ebooks aloud.' })]));
    const merged = mergeCatalog(cat, [], [], new Set(['ivangegovdve-sudo/voice-tool']));
    expect(merged.repos.map((r) => r.repoSlug)).toEqual(['ivangegovdve-sudo/reader']);
    const total = merged.shelves.reduce((n, s) => n + s.repoCount, 0);
    expect(total).toBe(1);
    expect(merged.shelves.every((s) => s.repoCount > 0)).toBe(true);
  });
});
