import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useShelf, selectVisibleRepos, selectFilterCandidates, isFiltering } from '../store';
import { filterChips, languageCounts } from '../derive';
import { starThresholds } from '../repoFilters';
import { SUB_CATEGORIES, subCategory } from '../taxonomy';
import { ViewToggle } from './ViewToggle';

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
  const language = useShelf((s) => s.languageFilter);
  const topic = useShelf((s) => s.topicFilter);
  const updatedAfter = useShelf((s) => s.updatedAfter);
  const minStars = useShelf((s) => s.minStars);
  const setLanguage = useShelf((s) => s.setLanguageFilter);
  const setTopic = useShelf((s) => s.setTopicFilter);
  const setUpdatedAfter = useShelf((s) => s.setUpdatedAfter);
  const setMinStars = useShelf((s) => s.setMinStars);
  const filtering = useShelf(isFiltering);
  const visibleCount = useShelf((s) => selectVisibleRepos(s).length);
  const candidates = useShelf(useShallow(selectFilterCandidates));
  const inputRef = useRef<HTMLInputElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const catalog = repos.some((repo) => repo.catalog);
  const chips = useMemo(() => filterChips(repos), [repos]);
  const languages = useMemo(() => languageCounts(repos), [repos]);
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const repo of repos) {
      for (const tag of new Set(repo.github?.topics ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [repos]);
  const counts = useMemo(() => {
    const shelf = new Map<string, number>();
    const sub = new Map<string, number>();
    for (const repo of repos) {
      shelf.set(repo.shelfId, (shelf.get(repo.shelfId) ?? 0) + 1);
      if (repo.catalog?.subCategory) sub.set(repo.catalog.subCategory, (sub.get(repo.catalog.subCategory) ?? 0) + 1);
    }
    return { shelf, sub };
  }, [repos]);
  const thresholds = useMemo(() => starThresholds(candidates), [candidates]);
  let thresholdIndex = 0;
  for (let i = 1; i < thresholds.length; i++) if (thresholds[i] <= minStars) thresholdIndex = i;
  const lastThresholdIndex = thresholds.length - 1;
  const progress = lastThresholdIndex > 0 ? thresholdIndex / lastThresholdIndex * 100 : 0;
  const activeLabels = [
    ...categories.map((id) => shelves.find((s) => s.id === id)?.label ?? id),
    ...subs.map((id) => subCategory(id).label),
    ...(filter !== 'all' ? [chips.find((c) => c.key === filter)?.label ?? filter] : []),
    ...(activeShelfId !== 'all' ? [shelves.find((s) => s.id === activeShelfId)?.label ?? activeShelfId] : []),
    ...(language !== 'all' ? [language] : []),
    ...(topic !== 'all' ? [`#${topic}`] : []),
    ...(updatedAfter ? [`Updated since ${updatedAfter}`] : []),
    ...(minStars > 0 ? [`${minStars.toLocaleString()}+ stars`] : []),
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
    <section className={`controls ${catalog ? 'catalog-controls' : ''} ${filtersOpen ? 'filters-expanded' : 'filters-collapsed'}`} aria-label="Library filters">
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
        <ViewToggle />
        <button
          type="button"
          className="filter-fold"
          aria-expanded={filtersOpen}
          aria-controls="library-metadata library-editions active-library-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          {filtersOpen ? 'Hide filters' : 'Show filters'}
        </button>
        <span className="filter-result" aria-live="polite">{visibleCount.toLocaleString()} / {repos.length.toLocaleString()} repos</span>
        <button className="link filter-clear" onClick={clearFilters} disabled={!filtering}>Clear filters ×</button>
      </div>

      <div className="discovery-row">
        <div className="metadata-filters" id="library-metadata" hidden={!filtersOpen}>
          <div className="metadata-filter">
            <label htmlFor="language-filter">Primary language</label>
            <select id="language-filter" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="all">All languages</option>
              {languages.map(({ language: name, count }) => <option key={name} value={name}>{name} ({count})</option>)}
            </select>
          </div>
          <div className="metadata-filter">
            <label htmlFor="topic-filter">Topic / tag</label>
            <select id="topic-filter" value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="all">All topics</option>
              {topics.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
            </select>
          </div>
          <div className="metadata-filter date-filter">
            <label htmlFor="updated-filter">Updated since</label>
            <div className="date-input-wrap">
              <input id="updated-filter" type="date" value={updatedAfter} onChange={(e) => setUpdatedAfter(e.target.value)} />
              {updatedAfter && <button type="button" onClick={() => setUpdatedAfter('')} aria-label="Clear updated date" title="Any update date">×</button>}
            </div>
          </div>
        </div>

        <div className="star-filter">
          <div className="star-filter-heading">
            <label htmlFor="star-threshold"><span className="star-glyph" aria-hidden="true">✦</span> Star threshold</label>
            <output id="star-readout" htmlFor="star-threshold" aria-live="polite">
              <strong>{minStars.toLocaleString()}+ <span>stars</span></strong>
              <span className="star-remaining">{visibleCount.toLocaleString()} {visibleCount === 1 ? 'book' : 'books'} remain</span>
            </output>
          </div>
          <input
            id="star-threshold"
            className="star-range"
            type="range"
            min={0}
            max={Math.max(1, lastThresholdIndex)}
            step={1}
            value={thresholdIndex}
            disabled={lastThresholdIndex === 0 || candidates.length === 0}
            style={{ '--star-progress': `${progress}%` } as CSSProperties}
            onChange={(e) => setMinStars(thresholds[Number(e.target.value)] ?? 0)}
            aria-valuetext={`${minStars.toLocaleString()} or more stars; ${visibleCount.toLocaleString()} books remain`}
            aria-describedby="star-help"
          />
          <div className="star-range-labels" id="star-help">
            <span>All repos</span>
            <span>{lastThresholdIndex === 0 ? 'No starred repos in this selection' : 'Most starred →'}</span>
          </div>
        </div>
      </div>

      {catalog && <>
        <div className="taxonomy-row" hidden={!filtersOpen}>
          <span className="filter-label">Categories</span>
          <div className="chips" role="group" aria-label="Filter by top category">
            {shelves.map((s) => <button key={s.id} className={`chip ${categories.includes(s.id) ? 'on' : ''}`} aria-pressed={categories.includes(s.id)} onClick={() => toggleCategory(s.id)}>
              {s.label}<em>{counts.shelf.get(s.id) ?? 0}</em>
            </button>)}
          </div>
        </div>
        <div className="taxonomy-row" hidden={!filtersOpen}>
          <span className="filter-label">Book colors</span>
          <div className="chips color-chips" role="group" aria-label="Filter by sub-category and color">
            {SUB_CATEGORIES.map((sub) => {
              const count = counts.sub.get(sub.id) ?? 0;
              return count > 0 && <button key={sub.id} className={`chip ${subs.includes(sub.id) ? 'on' : ''}`} aria-pressed={subs.includes(sub.id)} onClick={() => toggleSub(sub.id)}>
                <i className="category-swatch" style={{ background: sub.color }} aria-hidden="true" />{sub.label}<em>{count}</em>
              </button>;
            })}
          </div>
        </div>
      </>}
      <details id="library-editions" className="edition-filters" open={catalog ? undefined : true} hidden={!filtersOpen}>
        <summary>{catalog ? 'Edition & metadata' : 'More filters'}{filter !== 'all' ? ` · ${chips.find((c) => c.key === filter)?.label}` : ''}</summary>
        <div className="chips" role="group" aria-label={catalog ? 'Filter by edition' : 'Filters'}>
          {chips.map((c) => <button key={c.key} className={`chip ${filter === c.key ? 'on' : ''}`} onClick={() => setFilter(filter === c.key ? 'all' : c.key)} aria-pressed={filter === c.key}>
            {c.label}{c.count !== undefined && <em>{c.count}</em>}
          </button>)}
        </div>
      </details>
      <div id="active-library-filters" className={`active-filters chips-meta ${filtering ? 'has-active' : ''} ${filtersOpen ? '' : 'sr-only'}`}>
        {filtering ? <><span>{visibleCount} {visibleCount === 1 ? 'repo' : 'repos'} found</span><b>Active filters:</b> <span>{activeLabels.join(' · ')}</span>{visibleCount === 0 && <strong>No matching repos. Clear filters or broaden your selection.</strong>}</> : <span>Explore the shelves or browse the list · slide the star threshold to reveal the most starred</span>}
      </div>
    </section>
  );
}
