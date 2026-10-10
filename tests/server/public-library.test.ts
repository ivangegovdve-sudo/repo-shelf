import { describe, expect, it } from 'vitest';
import { publicLibraryState } from '../../scripts/public-library.js';
import type { StaticShelfData } from '../../server/publish.js';
import type { AppState, Repo, Shelf } from '../../server/types.js';

const shelf: Shelf = { id: 'existing', label: 'Existing shelf', path: null, kind: 'catalog', hidden: false, repoCount: 1 };
const existing = { id: 'existing-book', name: 'existing', shelfId: shelf.id, summary: 'Published summary', catalog: { upstream: 'upstream/original' } } as Repo;
const snapshot: StaticShelfData = {
  owner: 'collector', title: 'Existing library', generatedAt: '2026-10-01T00:00:00Z', sourceUrl: 'https://github.com/collector/library',
  repos: [existing], shelves: [shelf], pages: {},
};

function catalog(repos: Repo[], shelves = [shelf]): AppState {
  return { repos, shelves, github: { available: false, login: null }, config: { staleAfterDays: 365 } };
}

describe('public library catalog additions', () => {
  it('applies newer verified authorship while preserving published cards and source-star caches', () => {
    const published = { ...existing, owner: 'upstream', repoSlug: 'upstream/original',
      catalog: { ...existing.catalog!, kind: 'reference-copy', commitsAhead: 0 },
      github: { stars: 0, upstream: { fullName: 'upstream/original', stars: 1000, fetchedAt: '2026-10-01T00:00:00Z' } } } as Repo;
    const refreshed = { ...published, owner: 'collector', repoSlug: 'collector/original',
      summary: 'New card must not replace published card',
      catalog: { ...published.catalog!, kind: 'authored-fork', commitsAhead: 3, authoredCommitsAhead: 1 },
      github: { ...published.github!, stars: 2, htmlUrl: 'https://github.com/collector/original' } } as Repo;
    const state = publicLibraryState({ ...snapshot, repos: [published] }, catalog([refreshed]), '2026-10-02T00:00:00Z');
    expect(state.repos[0]).toMatchObject({ owner: 'collector', repoSlug: 'collector/original', summary: 'Published summary',
      catalog: { kind: 'authored-fork', commitsAhead: 3, authoredCommitsAhead: 1 },
      github: { stars: 2, upstream: published.github!.upstream } });
    expect(published.catalog!.kind).toBe('reference-copy');
  });

  it('does not regress current authorship with an older catalog generation', () => {
    const replacement = { ...existing, catalog: { ...existing.catalog!, kind: 'authored-fork', commitsAhead: 5 } } as Repo;
    const state = publicLibraryState(snapshot, catalog([replacement]), '2026-09-30T00:00:00Z');
    expect(state.repos[0]).toBe(existing);
  });

  it('applies newer per-book authorship even when star hydration has a later snapshot timestamp', () => {
    const published = { ...existing,
      catalog: { ...existing.catalog!, kind: 'reference-copy', commitsAhead: 0, authorshipVerifiedAt: '2026-10-01T00:00:00Z' },
      github: { stars: 0, upstream: { fullName: 'upstream/original', stars: 1000, fetchedAt: '2026-10-10T00:00:00Z' } },
    } as Repo;
    const refreshed = { ...published, owner: 'collector', repoSlug: 'collector/original',
      catalog: { ...published.catalog!, kind: 'authored-fork', commitsAhead: 3, authoredCommitsAhead: 1,
        authorshipVerifiedAt: '2026-10-05T00:00:00Z' },
    } as Repo;
    const state = publicLibraryState({ ...snapshot, generatedAt: '2026-10-10T00:00:00Z', repos: [published] }, catalog([refreshed]), '2026-10-05T00:00:00Z');
    expect(state.repos[0].catalog).toMatchObject({ kind: 'authored-fork', authoredCommitsAhead: 1, authorshipVerifiedAt: '2026-10-05T00:00:00Z' });
    expect(state.repos[0].github!.upstream).toEqual(published.github!.upstream);
  });

  it('does not overwrite newer per-book evidence merely because the catalog metadata generation is newer', () => {
    const published = { ...existing, catalog: { ...existing.catalog!, kind: 'authored-fork', authoredCommitsAhead: 1,
      authorshipVerifiedAt: '2026-10-05T00:00:00Z' } } as Repo;
    const oldEvidence = { ...published, catalog: { ...published.catalog!, kind: 'reference-copy', authoredCommitsAhead: 0,
      authorshipVerifiedAt: '2026-10-01T00:00:00Z' } } as Repo;
    const state = publicLibraryState({ ...snapshot, repos: [published] }, catalog([oldEvidence]), '2026-10-10T00:00:00Z');
    expect(state.repos[0]).toBe(published);
  });

  it('keeps published books when the current public catalog omits them', () => {
    const state = publicLibraryState(snapshot, catalog([]));
    expect(state.repos).toEqual([existing]);
    expect(state.repos[0]).toBe(existing);
    expect(state.shelves).toEqual([shelf]);
  });

  it('retains existing attribution and appends only new catalog IDs with accurate shelf counts', () => {
    const replacement = { ...existing, summary: 'Different catalog summary', catalog: { ...existing.catalog!, upstream: 'changed/upstream' } };
    const added = { ...existing, id: 'new-book', name: 'new' };
    const state = publicLibraryState(snapshot, catalog([replacement, added]));
    expect(state.repos).toEqual([existing, added]);
    expect(state.repos[0]).toBe(existing);
    expect(state.shelves).toEqual([{ ...shelf, repoCount: 2 }]);
    expect(snapshot.repos).toEqual([existing]);
    expect(snapshot.shelves[0].repoCount).toBe(1);
  });

  it('preserves existing shelves and adds a new shelf only when it contains a new book', () => {
    const addedShelf = { ...shelf, id: 'new-shelf', label: 'New shelf', repoCount: 9 };
    const unusedShelf = { ...addedShelf, id: 'unused' };
    const renamedExistingShelf = { ...shelf, label: 'Catalog label' };
    const added = { ...existing, id: 'new-book', name: 'new', shelfId: addedShelf.id };
    const state = publicLibraryState(snapshot, catalog([added], [renamedExistingShelf, addedShelf, unusedShelf]));
    expect(state.shelves).toEqual([shelf, { ...addedShelf, repoCount: 1 }]);
    expect(state.github.login).toBe(snapshot.owner);
  });
});
