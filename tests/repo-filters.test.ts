import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchesRepoMetadata, starsOf, starThresholds, updatedAtOf } from '../src/repoFilters';
import { isFiltering, selectFilterCandidates, selectVisibleRepos, useShelf, type ShelfState } from '../src/store';
import type { Repo, Shelf } from '../src/types';

function repo(id: string, over: Partial<Repo> = {}): Repo {
  return {
    id, name: id, path: '', shelfId: 'engineering', virtual: true,
    linkUrl: null, visibility: 'public', archived: false, createdAt: null,
    doc: null, summary: null, branch: null, lastCommitAt: null,
    commitCount: 0, dirtyCount: 0, sizeKB: 100, languageGuess: null,
    remoteUrl: null, owner: 'owner', repoSlug: `owner/${id}`,
    github: {
      description: 'A useful agent', language: 'TypeScript', stars: 4,
      topics: ['agents', 'tools'], isPrivate: false, isFork: false,
      pushedAt: '2026-10-01T12:00:00Z', htmlUrl: `https://github.com/owner/${id}`,
      fetchedAt: '2026-10-10T00:00:00Z',
    },
    catalog: {
      kind: 'original', upstream: null, commitsAhead: null,
      repoUrl: `https://github.com/owner/${id}`, subCategory: 'developer-tools',
      cardStale: false, verificationStatus: 'verified', confidence: 'high',
      cardGeneratedAt: '2026-10-10T00:00:00Z', alive: true,
    },
    ...over,
  };
}

function shelf(id: string, hidden = false): Shelf {
  return { id, label: id, path: null, kind: 'catalog', hidden, repoCount: 0 };
}

const initial = useShelf.getState();
const anyMetadata = { languageFilter: 'all', topicFilter: 'all', updatedAfter: '' };

function state(over: Partial<ShelfState> = {}): ShelfState {
  return { ...initial, shelves: [shelf('engineering'), shelf('intelligence')], ...over };
}

beforeEach(() => useShelf.setState(initial, true));
afterEach(() => {
  useShelf.setState(initial, true);
  vi.unstubAllGlobals();
});

describe('repository metadata filters', () => {
  it('combines primary language, exact topic, and updated date', () => {
    const r = repo('agent');
    const filters = { languageFilter: 'TypeScript', topicFilter: 'AGENTS', updatedAfter: '2026-10-01' };
    expect(matchesRepoMetadata(r, filters)).toBe(true);
    expect(matchesRepoMetadata(r, { ...filters, languageFilter: 'Python' })).toBe(false);
    expect(matchesRepoMetadata(r, { ...filters, topicFilter: 'agent' })).toBe(false);
    expect(matchesRepoMetadata(r, { ...filters, updatedAfter: '2026-10-02' })).toBe(false);
  });

  it('uses the full inclusive UTC day, accounting for timestamp offsets', () => {
    const filters = { ...anyMetadata, updatedAfter: '2026-10-01' };
    const r = repo('offset');
    expect(matchesRepoMetadata({ ...r, github: { ...r.github!, pushedAt: '2026-10-01T00:00:00Z' } }, filters)).toBe(true);
    expect(matchesRepoMetadata({ ...r, github: { ...r.github!, pushedAt: '2026-09-30T23:59:59Z' } }, filters)).toBe(false);
    expect(matchesRepoMetadata({ ...r, github: { ...r.github!, pushedAt: '2026-09-30T20:00:00-05:00' } }, filters)).toBe(true);
    expect(matchesRepoMetadata({ ...r, github: { ...r.github!, pushedAt: '2026-10-01T01:00:00+02:00' } }, filters)).toBe(false);
  });

  it('falls back to local language and last commit, with unknown dates excluded only when filtering dates', () => {
    const r = repo('local', { github: null, languageGuess: 'Rust', lastCommitAt: '2026-10-02T12:00:00Z' });
    expect(updatedAtOf(r)).toBe('2026-10-02T12:00:00.000Z');
    expect(matchesRepoMetadata(r, { ...anyMetadata, languageFilter: 'Rust', updatedAfter: '2026-10-01' })).toBe(true);
    expect(matchesRepoMetadata(r, { ...anyMetadata, topicFilter: 'agents' })).toBe(false);
    const undated = { ...r, lastCommitAt: null, languageGuess: null };
    expect(updatedAtOf(undated)).toBeNull();
    expect(matchesRepoMetadata(undated, { ...anyMetadata, languageFilter: 'Unknown' })).toBe(true);
    expect(matchesRepoMetadata(undated, { ...anyMetadata, updatedAfter: '2026-10-01' })).toBe(false);
  });

  it('prefers valid GitHub dates, and safely handles malformed metadata or date input', () => {
    const r = repo('dated', { lastCommitAt: '2020-01-01T00:00:00Z' });
    expect(updatedAtOf(r)).toBe('2026-10-01T12:00:00.000Z');
    expect(updatedAtOf({ ...r, github: { ...r.github!, pushedAt: 'invalid' } })).toBe('2020-01-01T00:00:00.000Z');
    expect(updatedAtOf({ ...r, github: null, lastCommitAt: 'invalid' })).toBeNull();
    expect(matchesRepoMetadata(r, { ...anyMetadata, updatedAfter: 'invalid' })).toBe(true);
    expect(matchesRepoMetadata(r, { ...anyMetadata, updatedAfter: '2026-02-30' })).toBe(true);
  });
});

describe('star tiers', () => {
  const starred = (id: string, stars: number) => {
    const r = repo(id);
    return { ...r, github: { ...r.github!, stars } };
  };

  it('starts with all repositories, removes complete lowest tiers, and keeps maximum ties', () => {
    const repos = [repo('missing', { github: null }), starred('zero', 0), starred('low', 1), starred('mid', 50), starred('top-a', 300), starred('top-b', 300)];
    const thresholds = starThresholds(repos);
    expect(thresholds).toEqual([0, 1, 50, 300]);
    const st = state({ repos });
    expect(thresholds.map((minStars) => selectVisibleRepos({ ...st, minStars }).length)).toEqual([6, 4, 3, 2]);
    expect(selectVisibleRepos({ ...st, minStars: thresholds.at(-1)! }).map((r) => r.id)).toEqual(['top-a', 'top-b']);
    expect(selectVisibleRepos({ ...st, minStars: 0 })).toHaveLength(6);
  });

  it('normalizes invalid counts and has a usable all-repos endpoint for empty or unstarred sets', () => {
    for (const stars of [-4, NaN, Infinity]) expect(starsOf(starred('bad', stars))).toBe(0);
    expect(starsOf(repo('missing', { github: null }))).toBe(0);
    expect(starsOf(starred('fraction', 2.9))).toBe(2);
    expect(starThresholds([])).toEqual([0]);
    expect(starThresholds([starred('zero', 0), repo('unknown', { github: null })])).toEqual([0]);
  });

  it('handles one starred tier without losing any tied books', () => {
    expect(starThresholds([starred('a', 7), starred('b', 7)])).toEqual([0, 7]);
    expect(selectVisibleRepos(state({ repos: [starred('a', 7), starred('b', 7)], minStars: 7 }))).toHaveLength(2);
  });
});

describe('shared selectors and filter state', () => {
  it('combines existing query, edition, shelf and taxonomy with every new metadata filter and stars', () => {
    const target = repo('target');
    const otherLanguage = repo('other-language', { github: { ...target.github!, language: 'Python' } });
    const otherTopic = repo('other-topic', { github: { ...target.github!, topics: ['web'] } });
    const older = repo('older', { github: { ...target.github!, pushedAt: '2020-01-01T00:00:00Z' } });
    const lowStars = repo('low-stars', { github: { ...target.github!, stars: 1 } });
    const otherCategory = repo('other-category', { shelfId: 'intelligence' });
    const otherEdition = repo('other-edition', { catalog: { ...target.catalog!, kind: 'reference-copy' } });
    const otherSubcategory = repo('other-subcategory', { catalog: { ...target.catalog!, subCategory: 'web-automation' } });
    const wrongQuery = repo('wrong-query', { github: { ...target.github!, description: 'No match', topics: ['tools'] } });
    const st = state({
      repos: [target, otherLanguage, otherTopic, older, lowStars, otherCategory, otherEdition, otherSubcategory, wrongQuery],
      query: 'agent', filter: 'originals', activeShelfId: 'engineering',
      categoryFilters: ['engineering'], subCategoryFilters: ['developer-tools'],
      languageFilter: 'TypeScript', topicFilter: 'tools', updatedAfter: '2026-10-01', minStars: 4,
    });
    expect(selectVisibleRepos(st).map((r) => r.id)).toEqual(['target']);
    expect(selectFilterCandidates(st).map((r) => r.id)).toEqual(['low-stars', 'target']);
  });

  it('excludes hidden and missing shelves from both selectors until revealed', () => {
    const shelves = [shelf('engineering'), shelf('secret', true)];
    useShelf.getState().applyState({
      shelves, repos: [repo('visible'), repo('hidden', { shelfId: 'secret' }), repo('orphan', { shelfId: 'absent' })],
      github: { available: true, login: 'owner' }, config: { staleAfterDays: 90 },
    });
    expect(selectFilterCandidates(useShelf.getState()).map((r) => r.id)).toEqual(['visible']);
    expect(selectVisibleRepos(useShelf.getState()).map((r) => r.id)).toEqual(['visible']);
    // Directly reveal without the toast timer, which is unrelated to filtering.
    useShelf.setState({ secretRevealed: true, shelves });
    expect(selectVisibleRepos(useShelf.getState()).map((r) => r.id)).toEqual(['visible', 'hidden']);
  });

  it('maintains shelf order and existing edition order', () => {
    const first = repo('z-original', { shelfId: 'intelligence' });
    const second = repo('a-reference', { shelfId: 'intelligence', catalog: { ...first.catalog!, kind: 'reference-copy' } });
    const third = repo('a-other-shelf');
    const st = state({ repos: [third, second, first], shelves: [shelf('intelligence'), shelf('engineering')] });
    expect(selectVisibleRepos(st).map((r) => r.id)).toEqual(['z-original', 'a-reference', 'a-other-shelf']);
  });

  it('clears excluded hover and keyboard focus while leaving the open book available', () => {
    useShelf.setState(state({ repos: [repo('open')], selectedRepoId: 'open', hoveredRepoId: 'open', focusedRepoId: 'open' }));
    useShelf.getState().setLanguageFilter('Rust');
    expect(useShelf.getState().selectedRepoId).toBe('open');
    expect(useShelf.getState().hoveredRepoId).toBeNull();
    expect(useShelf.getState().focusedRepoId).toBeNull();
    useShelf.getState().setLanguageFilter('all');
    expect(selectVisibleRepos(useShelf.getState())).toHaveLength(1);
  });

  it('clamps the slider range after narrowing other filters, and normalizes direct threshold input', () => {
    const low = repo('low');
    const high = repo('high', { github: { ...low.github!, stars: 100, language: 'Python' } });
    useShelf.setState(state({ repos: [low, high], minStars: 100 }));
    useShelf.getState().setLanguageFilter('TypeScript');
    expect(useShelf.getState().minStars).toBe(4);
    expect(selectVisibleRepos(useShelf.getState()).map((r) => r.id)).toEqual(['low']);
    useShelf.getState().setMinStars(3.8);
    expect(useShelf.getState().minStars).toBe(3);
    useShelf.getState().setMinStars(Infinity);
    expect(useShelf.getState().minStars).toBe(0);
    useShelf.getState().setMinStars(-4);
    expect(useShelf.getState().minStars).toBe(0);
  });

  it('snaps to the next surviving star tier after metadata filters or API updates change the range', () => {
    const low = repo('low');
    low.github!.stars = 3;
    const middle = repo('middle', { github: { ...low.github!, stars: 5, language: 'Python' } });
    const high = repo('high', { github: { ...low.github!, stars: 10 } });
    useShelf.setState(state({ repos: [low, middle, high], minStars: 5 }));
    useShelf.getState().setLanguageFilter('TypeScript');
    expect(starThresholds(selectFilterCandidates(useShelf.getState()))).toEqual([0, 3, 10]);
    expect(useShelf.getState().minStars).toBe(10);
    expect(selectVisibleRepos(useShelf.getState()).map((r) => r.id)).toEqual(['high']);

    // An explicit threshold stays exact until another dimension or API data changes.
    useShelf.getState().setMinStars(5);
    expect(useShelf.getState().minStars).toBe(5);
    useShelf.getState().mergeRepo({ ...high, github: { ...high.github!, stars: 8 } });
    expect(useShelf.getState().minStars).toBe(8);
    expect(selectVisibleRepos(useShelf.getState()).map((r) => r.id)).toEqual(['high']);

    useShelf.getState().setMinStars(0);
    useShelf.getState().setLanguageFilter('all');
    expect(useShelf.getState().minStars).toBe(0);
    useShelf.getState().setMinStars(5);
    useShelf.getState().setTopicFilter('missing-topic');
    expect(useShelf.getState().minStars).toBe(0);
    expect(selectVisibleRepos(useShelf.getState())).toEqual([]);
  });

  it('resets old and new filters together while preserving view mode and open-book details', () => {
    useShelf.setState(state({
      repos: [repo('open')], selectedRepoId: 'open', viewMode: 'list',
      query: 'agent', filter: 'originals', activeShelfId: 'engineering',
      categoryFilters: ['engineering'], subCategoryFilters: ['developer-tools'],
      languageFilter: 'TypeScript', topicFilter: 'agents', updatedAfter: '2026-10-01', minStars: 4,
    }));
    expect(isFiltering(useShelf.getState())).toBe(true);
    useShelf.getState().clearFilters();
    expect(isFiltering(useShelf.getState())).toBe(false);
    expect(useShelf.getState()).toMatchObject({
      query: '', filter: 'all', activeShelfId: 'all', categoryFilters: [], subCategoryFilters: [],
      languageFilter: 'all', topicFilter: 'all', updatedAfter: '', minStars: 0,
      viewMode: 'list', selectedRepoId: 'open',
    });
  });

  it('reports each new dimension as filtering independently, without treating a view preference as a filter', () => {
    expect(isFiltering(state({ viewMode: 'list' }))).toBe(false);
    for (const over of [{ languageFilter: 'Rust' }, { topicFilter: 'agents' }, { updatedAfter: '2026-10-01' }, { minStars: 1 }]) {
      expect(isFiltering(state(over))).toBe(true);
    }
  });

  it('persists the view preference and still switches when storage is unavailable', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    useShelf.getState().setViewMode('list');
    expect(setItem).toHaveBeenCalledWith('repo-shelf.view', 'list');
    expect(useShelf.getState().viewMode).toBe('list');
    setItem.mockImplementation(() => { throw new Error('blocked'); });
    useShelf.getState().setViewMode('3d');
    expect(useShelf.getState().viewMode).toBe('3d');
  });
});
