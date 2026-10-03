import { describe, expect, it } from 'vitest';
import { catalogToState } from '../server/catalog';
import { matchesTaxonomy, SUB_CATEGORIES, TOP_CATEGORIES } from '../src/taxonomy';
import { contrastRatio, spineStyle } from '../src/scene/spineStyle';
import { sanitizeForPublish } from '../server/publish';
import { useShelf, selectVisibleRepos, isFiltering } from '../src/store';

function state() {
  const repos = [
    { name: 'voice', topics: ['voice'], fork: false, upstream: null, commits_ahead: 0 },
    { name: 'video', topics: ['creative'], fork: true, upstream: 'upstream/video', commits_ahead: 0 },
    { name: 'agents', topics: ['ai-agents'], fork: true, upstream: 'upstream/agents', commits_ahead: 3 },
    { name: 'unknown-fork', topics: ['voice'], fork: true, upstream: 'upstream/unknown', commits_ahead: null },
  ].map((r) => ({ ...r, full_name: `ivangegovdve-sudo/${r.name}`, last_push: '', language: 'Python', summary: '', card_path: '', card_generated_at: '', stale: false, confidence: 'unrecorded', verification_status: 'unverified', topics_source: 'test' }));
  return catalogToState({ repo_count: repos.length, generated_at: '', repos });
}

describe('category and color library', () => {
  it('assigns every smaller category to a broad shelf and a unique stable color', () => {
    expect(SUB_CATEGORIES.every((s) => TOP_CATEGORIES.some((t) => t.id === s.top))).toBe(true);
    expect(new Set(SUB_CATEGORIES.map((s) => s.color)).size).toBe(SUB_CATEGORIES.length);
    const library = state();
    expect(library.repos.map((r) => r.shelfId)).toEqual(['creative', 'creative', 'intelligence', 'creative']);
    expect(library.repos[3].catalog?.kind).toBe('unverified-fork');
  });

  it('keeps identical category colors across editions, with legible ink and different marks', () => {
    const book = state().repos[0];
    for (const sub of SUB_CATEGORIES) {
      const styles = (['original', 'reference-copy', 'authored-fork'] as const).map((kind) => spineStyle({ ...book, catalog: { ...book.catalog!, subCategory: sub.id, kind } }, 90));
      expect(new Set(styles.map((s) => s.cloth))).toEqual(new Set([sub.color]));
      expect(new Set(styles.map((s) => `${s.head}/${s.foot}`)).size).toBe(3);
      for (const style of styles) expect(contrastRatio(style.ink, style.cloth)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses union within each level and intersection across levels, search and edition', () => {
    const store = useShelf.getState();
    store.applyState(state());
    store.clearFilters();
    store.toggleCategory('creative');
    store.toggleCategory('intelligence');
    store.toggleSubCategory('voice-audio');
    store.toggleSubCategory('agents-assistants');
    expect(selectVisibleRepos(useShelf.getState()).map((r) => r.name).sort()).toEqual(['agents', 'unknown-fork', 'voice']);
    store.setQuery('agents');
    expect(selectVisibleRepos(useShelf.getState()).map((r) => r.name)).toEqual(['agents']);
    store.setFilter('reference-copy');
    expect(selectVisibleRepos(useShelf.getState())).toHaveLength(0);
    store.clearFilters();
    expect(isFiltering(useShelf.getState())).toBe(false);
    expect(selectVisibleRepos(useShelf.getState())).toHaveLength(4);
    expect(matchesTaxonomy('creative', 'voice-audio', ['intelligence'], ['voice-audio'])).toBe(false);
  });

  it('retains archived public catalog entries and publishes unchanged forks using only upstream identity', () => {
    const library = state();
    library.repos[1].archived = true;
    const published = sanitizeForPublish(library, 'ivangegovdve-sudo');
    expect(published.repos).toHaveLength(4);
    const reference = published.repos.find((r) => r.name === 'video')!;
    expect(reference.repoSlug).toBe('upstream/video');
    expect(reference.linkUrl).toBe('https://github.com/upstream/video');
    expect(JSON.stringify(reference)).not.toContain('ivangegovdve-sudo');
  });
});
