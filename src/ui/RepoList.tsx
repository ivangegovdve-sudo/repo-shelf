import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useShelf, selectVisibleRepos } from '../store';
import { bookColor, languageOf, relativeTime, repoTitleOf } from '../derive';
import { starCountOf, updatedAtOf } from '../repoFilters';
import { primaryRepoName, primaryRepoSlug, referenceUpstream } from '../repoIdentity';
import { subCategory } from '../taxonomy';

const PAGE_SIZE = 60;
type SortOrder = 'shelf' | 'stars' | 'updated' | 'name';
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

export function RepoList() {
  const repos = useShelf(useShallow(selectVisibleRepos));
  const shelves = useShelf((s) => s.shelves);
  const selected = useShelf((s) => s.selectedRepoId);
  const select = useShelf((s) => s.select);
  const clearFilters = useShelf((s) => s.clearFilters);
  const [sort, setSort] = useState<SortOrder>('stars');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => {
    if (sort === 'shelf') return repos;
    return [...repos].sort((a, b) => {
      const nameOrder = primaryRepoName(a).localeCompare(primaryRepoName(b));
      if (sort === 'stars') return (starCountOf(b) ?? -1) - (starCountOf(a) ?? -1) || nameOrder;
      if (sort === 'updated') return (Date.parse(updatedAtOf(b) ?? '') || 0) - (Date.parse(updatedAtOf(a) ?? '') || 0) || nameOrder;
      return nameOrder;
    });
  }, [repos, sort]);
  const shelfLabels = useMemo(() => new Map(shelves.map((shelf) => [shelf.id, shelf.label])), [shelves]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [repos, sort]);

  return (
    <div className="repo-list" ref={scrollRef}>
      <div className="repo-list-inner">
        <header className="repo-list-header">
          <div>
            <h1>Repository list<span>{repos.length.toLocaleString()}</span></h1>
          </div>
          <label className="list-sort" htmlFor="list-sort">Sort by
            <select id="list-sort" value={sort} onChange={(e) => {
              setSort(e.target.value as SortOrder);
              setLimit(PAGE_SIZE);
              scrollRef.current?.scrollTo({ top: 0 });
            }}>
              <option value="shelf">Shelf order</option>
              <option value="stars">Most stars</option>
              <option value="updated">Recently updated</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
        </header>

        {repos.length === 0 ? (
          <div className="list-empty">
            <span className="list-empty-icon" aria-hidden="true">⌕</span>
            <h2>No matching repositories</h2>
            <p>Try another language, topic or date, or lower the star threshold.</p>
            <button className="btn primary" onClick={clearFilters}>Reset filters</button>
          </div>
        ) : (
          <>
            <ul className="repo-list-rows" aria-label="Repository list">
              {ordered.slice(0, limit).map((repo) => {
                const language = languageOf(repo);
                const updated = updatedAtOf(repo);
                const topics = repo.github?.topics ?? [];
                const summary = repo.summary || repo.github?.description;
                const category = repo.catalog?.subCategory ? subCategory(repo.catalog.subCategory) : null;
                const edition = repo.catalog?.kind;
                const editionLabel = edition === 'original' ? 'Original' : edition === 'authored-fork' ? 'Adapted fork' : edition === 'reference-copy' ? 'Reference copy' : edition === 'unverified-fork' ? 'Fork · unverified' : null;
                const upstream = referenceUpstream(repo);
                const collectorSlug = upstream && repo.repoSlug && repo.repoSlug.toLowerCase() !== upstream.toLowerCase() ? repo.repoSlug : null;
                const stars = starCountOf(repo);
                const starsLabel = upstream ? 'Upstream stars' : 'Stars';
                const starsText = stars === null ? 'unavailable' : stars.toLocaleString();
                return (
                  <li key={repo.id}>
                    <button
                      type="button"
                      className={`repo-list-row ${selected === repo.id ? 'selected' : ''}`}
                      data-repo-id={repo.id}
                      onClick={() => select(repo.id)}
                      aria-label={`Open ${repoTitleOf(repo)} details${repo.catalog?.upstream && !upstream ? `; upstream ${repo.catalog.upstream}` : ''}; ${starsLabel}: ${starsText}; ${language}`}
                      aria-pressed={selected === repo.id}
                    >
                      <span className="list-book" style={{ '--book-tint': category?.color ?? bookColor(language) } as CSSProperties} aria-hidden="true"><i /><i /></span>
                      <span className="repo-list-copy">
                        <span className="repo-list-title"><span className="repo-list-name">{repoTitleOf(repo)}</span>{editionLabel && <span className="list-edition">{editionLabel}</span>}</span>
                        {(!upstream || collectorSlug) && <span className="repo-list-slug">{collectorSlug ? `Collected as ${collectorSlug}` : primaryRepoSlug(repo) ?? repo.name}</span>}
                        <span className="repo-list-summary" title={summary ?? undefined}>{summary || 'Open this book to explore the repository.'}</span>
                        {repo.catalog?.upstream && !upstream && <span className="repo-list-upstream">Upstream: <strong>{repo.catalog.upstream}</strong></span>}
                        <span className="repo-list-tags">
                          <span className="list-language"><i style={{ background: bookColor(language) }} aria-hidden="true" />{language}</span>
                          <span className="list-category">{shelfLabels.get(repo.shelfId) ?? 'Repository'}</span>
                          {topics.slice(0, 3).map((tag) => <span className="list-topic" key={tag}>#{tag}</span>)}
                          {topics.length > 3 && <span className="list-topic-more" title={topics.slice(3).join(', ')}>+{topics.length - 3} topics</span>}
                        </span>
                      </span>
                      <span className="repo-list-stats">
                        <span className="list-stars" aria-label={`${starsLabel}: ${starsText}`} title={`${starsLabel}${upstream ? ` for ${upstream}` : ''}: ${starsText}`}><span aria-hidden="true">☆</span>{stars?.toLocaleString() ?? '—'}</span>
                        <span className="list-updated">Updated <time dateTime={updated ?? undefined} title={updated ? dateFormatter.format(new Date(updated)) : undefined}>{updated ? relativeTime(updated) : 'unknown'}</time></span>
                        <span className="list-open">Open book <span aria-hidden="true">↗</span></span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <footer className="repo-list-footer">
              <span>Showing {Math.min(limit, ordered.length).toLocaleString()} of {ordered.length.toLocaleString()} repositories</span>
              {limit < ordered.length && <button className="btn" onClick={() => setLimit((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, ordered.length - limit)} more <span aria-hidden="true">↓</span></button>}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
