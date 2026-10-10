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
