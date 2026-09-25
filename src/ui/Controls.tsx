import { useEffect, useRef } from 'react';
import { useShelf, selectVisibleRepos, isFiltering } from '../store';
import { filterChips } from '../derive';

export function Controls() {
  const query = useShelf((s) => s.query);
  const setQuery = useShelf((s) => s.setQuery);
  const filter = useShelf((s) => s.filter);
  const setFilter = useShelf((s) => s.setFilter);
  const activeShelfId = useShelf((s) => s.activeShelfId);
  const setActiveShelf = useShelf((s) => s.setActiveShelf);
  const shelves = useShelf((s) => s.shelves);
  const repos = useShelf((s) => s.repos);
  const clearFilters = useShelf((s) => s.clearFilters);
  const filtering = useShelf(isFiltering);
  const visibleCount = useShelf((s) => selectVisibleRepos(s).length);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const catalog = repos.some((repo) => repo.catalog);
  const chips = filterChips(repos);

  return (
    <section className="controls">
      <div className="search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          placeholder={catalog ? 'Find a repo, purpose or upstream' : 'Find a repo, description or path'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search repos"
        />
        <kbd>/</kbd>
      </div>
      <select className="shelf-select" value={activeShelfId} onChange={(e) => setActiveShelf(e.target.value)} aria-label="Shelf">
        <option value="all">All shelves</option>
        {shelves.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <div className="chips" role="group" aria-label={catalog ? 'Filter by edition' : 'Filters'}>
        {chips.map((c) => (
          <button key={c.key} className={`chip ${filter === c.key ? 'on' : ''}`} onClick={() => setFilter(filter === c.key ? 'all' : c.key)} aria-pressed={filter === c.key}>
            {c.edition && <i className={`ed-swatch ed-${c.edition}`} aria-hidden="true" />}
            {c.label}
            {c.count !== undefined && <em>{c.count}</em>}
          </button>
        ))}
      </div>
      <div className="chips-meta" aria-live="polite">
        {filtering ? (
          <>
            <span>
              {visibleCount} {visibleCount === 1 ? 'repo' : 'repos'} found
            </span>
            <button className="link" onClick={clearFilters}>
              Clear filters ×
            </button>
          </>
        ) : (
          <span className="hint">
            {catalog ? 'Pale spines are reference copies. Dark spines are Ivan’s work.' : 'Drag a book onto another shelf to move the repo.'}
          </span>
        )}
      </div>
    </section>
  );
}
