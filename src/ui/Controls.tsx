import { useEffect, useRef } from 'react';
import { useShelf, selectVisibleRepos, isFiltering } from '../store';
import { filterChips } from '../derive';
import { SUB_CATEGORIES, subCategory } from '../taxonomy';

export function Controls() {
  const query = useShelf((s) => s.query);
  const setQuery = useShelf((s) => s.setQuery);
  const filter = useShelf((s) => s.filter);
  const setFilter = useShelf((s) => s.setFilter);
  const activeShelfId = useShelf((s) => s.activeShelfId);
  const setActiveShelf = useShelf((s) => s.setActiveShelf);
  const shelves = useShelf((s) => s.shelves);
  const repos = useShelf((s) => s.repos);
  const categories = useShelf((s) => s.categoryFilters);
  const subs = useShelf((s) => s.subCategoryFilters);
  const toggleCategory = useShelf((s) => s.toggleCategory);
  const toggleSub = useShelf((s) => s.toggleSubCategory);
  const clearFilters = useShelf((s) => s.clearFilters);
  const filtering = useShelf(isFiltering);
  const visibleCount = useShelf((s) => selectVisibleRepos(s).length);
  const inputRef = useRef<HTMLInputElement>(null);
  const catalog = repos.some((repo) => repo.catalog);
  const chips = filterChips(repos);
  const activeLabels = [
    ...categories.map((id) => shelves.find((s) => s.id === id)?.label ?? id),
    ...subs.map((id) => subCategory(id).label),
    ...(filter !== 'all' ? [chips.find((c) => c.key === filter)?.label ?? filter] : []),
    ...(activeShelfId !== 'all' ? [shelves.find((s) => s.id === activeShelfId)?.label ?? activeShelfId] : []),
    ...(query.trim() ? [`Search: ${query.trim()}`] : []),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !inField) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setQuery('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setQuery]);

  return (
    <section className={`controls ${catalog ? 'catalog-controls' : ''}`} aria-label="Library filters">
      <div className="filter-search-row">
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input ref={inputRef} type="search" placeholder={catalog ? 'Find a repo, purpose or upstream' : 'Find a repo, description or path'} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search repos" />
          <kbd>/</kbd>
        </div>
        {!catalog && <select className="shelf-select" value={activeShelfId} onChange={(e) => setActiveShelf(e.target.value)} aria-label="Shelf">
          <option value="all">All shelves</option>
          {shelves.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>}
        <span className="filter-result" aria-live="polite">{visibleCount} / {repos.length} repos</span>
        <button className="link filter-clear" onClick={clearFilters} disabled={!filtering}>Clear filters ×</button>
      </div>
      {catalog && <>
        <div className="taxonomy-row">
          <span className="filter-label">Categories</span>
          <div className="chips" role="group" aria-label="Filter by top category">
            {shelves.map((s) => <button key={s.id} className={`chip ${categories.includes(s.id) ? 'on' : ''}`} aria-pressed={categories.includes(s.id)} onClick={() => toggleCategory(s.id)}>
              {s.label}<em>{repos.filter((r) => r.shelfId === s.id).length}</em>
            </button>)}
          </div>
        </div>
        <div className="taxonomy-row">
          <span className="filter-label">Book colors</span>
          <div className="chips color-chips" role="group" aria-label="Filter by sub-category and color">
            {SUB_CATEGORIES.map((sub) => {
              const count = repos.filter((r) => r.catalog?.subCategory === sub.id).length;
              return count > 0 && <button key={sub.id} className={`chip ${subs.includes(sub.id) ? 'on' : ''}`} aria-pressed={subs.includes(sub.id)} onClick={() => toggleSub(sub.id)}>
                <i className="category-swatch" style={{ background: sub.color }} aria-hidden="true" />{sub.label}<em>{count}</em>
              </button>;
            })}
          </div>
        </div>
      </>}
      <details className="edition-filters" open={catalog ? undefined : true}>
        <summary>{catalog ? 'Edition & metadata' : 'More filters'}{filter !== 'all' ? ` · ${chips.find((c) => c.key === filter)?.label}` : ''}</summary>
        <div className="chips" role="group" aria-label={catalog ? 'Filter by edition' : 'Filters'}>
          {chips.map((c) => <button key={c.key} className={`chip ${filter === c.key ? 'on' : ''}`} onClick={() => setFilter(filter === c.key ? 'all' : c.key)} aria-pressed={filter === c.key}>
            {c.label}{c.count !== undefined && <em>{c.count}</em>}
          </button>)}
        </div>
      </details>
      <div className="active-filters chips-meta" aria-live="polite">
        {filtering && <span>{visibleCount} {visibleCount === 1 ? 'repo' : 'repos'} found</span>}
        {filtering ? <><b>Active filters:</b> {activeLabels.join(' · ')}{visibleCount === 0 && <strong> — No matching repos. Clear filters or broaden your selection.</strong>}</> : <span>Select multiple categories or colors · selections combine with search · edition marks show authorship</span>}
      </div>
    </section>
  );
}
