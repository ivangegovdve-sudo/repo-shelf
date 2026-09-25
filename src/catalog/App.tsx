import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { buildLibrary, filterBooks, relativePush, type CatalogDocument, type LibraryBook } from './model';
import './styles.css';

const PAGE_SIZE = 120;

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function Book({ book, generatedAt }: { book: LibraryBook; generatedAt: string }) {
  const tone = book.kind === 'reference-copy' ? 'reference' : book.kind === 'authored-fork' ? 'rust' : book.name.length % 2 ? 'green' : 'rust';
  const kindLabel = book.kind === 'reference-copy' ? 'Fork · 0 ahead' : book.kind === 'authored-fork' ? `Fork · ${book.commits_ahead} ahead` : 'Original';
  return (
    <li className={`catalog-book ${tone}`}>
      <a href={`https://github.com/${book.full_name}`} target="_blank" rel="noreferrer" aria-label={`Open ${book.name} on GitHub`}>
        <span className="book-binding" aria-hidden="true" />
        <span className="book-body">
          <span className="book-name">{book.name}</span>
          <span className="book-slug">{book.full_name}</span>
          <span className="book-summary">{book.summary}</span>
          <span className="book-meta">
            <span className="book-kind">{kindLabel}</span>
            <span className={`life ${book.alive ? 'alive' : 'dormant'}`}>
              <i aria-hidden="true" /> {book.alive ? 'Alive' : 'Dormant'}
            </span>
          </span>
          <span className="book-push">Pushed {relativePush(book.last_push, generatedAt)}</span>
          {(book.stale || book.verification_status === 'unverified') && (
            <span className="warnings">
              {book.stale ? <span>Stale card</span> : null}
              {book.verification_status === 'unverified' ? <span>Unverified</span> : null}
            </span>
          )}
          {book.referenceCopy ? <strong className="reference-label">Reference copy</strong> : null}
        </span>
      </a>
    </li>
  );
}

function Legend() {
  return (
    <section className="legend" aria-label="Repository types and status">
      <div className="legend-kind original-swatch"><i /> <span><b>Original</b><small>Author’s repository</small></span></div>
      <div className="legend-kind fork-swatch"><i /> <span><b>Authored fork</b><small>Has commits ahead</small></span></div>
      <div className="legend-kind reference-swatch"><i /> <span><b>Reference copy</b><small>Untouched fork</small></span></div>
      <div className="legend-status"><span><i className="dot alive-dot" /> Alive</span><span><i className="dot dormant-dot" /> Dormant</span><span>△ Stale</span><span>? Unverified</span></div>
    </section>
  );
}

export function CatalogApp({ catalog }: { catalog: CatalogDocument }) {
  const library = useMemo(() => buildLibrary(catalog), [catalog]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [shelfId, setShelfId] = useState('all');
  const [originalsOnly, setOriginalsOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const visible = useMemo(
    () => filterBooks(library.books, { query: deferredQuery, shelfId, originalsOnly }),
    [deferredQuery, library.books, originalsOnly, shelfId],
  );
  useEffect(() => setLimit(PAGE_SIZE), [deferredQuery, originalsOnly, shelfId]);

  const activeShelf = library.shelves.find((shelf) => shelf.id === shelfId);
  const referenceCount = library.books.filter((book) => book.referenceCopy).length;
  const workCount = library.books.length - referenceCount;

  return (
    <div className="catalog-shell">
      <aside className="catalog-sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><h1>Repository<br /> Library</h1><p>{library.books.length.toLocaleString()} repositories<br />organized by purpose</p></div>
        </div>
        <nav aria-label="Purpose shelves">
          <button className={shelfId === 'all' ? 'selected' : ''} onClick={() => setShelfId('all')}>
            <i aria-hidden="true" /><span>All shelves</span><b>{library.books.length.toLocaleString()}</b>
          </button>
          {library.shelves.map((shelf) => (
            <button key={shelf.id} className={shelfId === shelf.id ? 'selected' : ''} onClick={() => setShelfId(shelf.id)}>
              <i aria-hidden="true" /><span>{shelf.label}</span><b>{shelf.count.toLocaleString()}</b>
            </button>
          ))}
        </nav>
        <p className="sidebar-note">Shelves are derived from capability-card summaries and topics, never language or stars.</p>
      </aside>

      <main className="catalog-main">
        <header className="catalog-toolbar">
          <label className="catalog-search">
            <SearchIcon />
            <input aria-label="Search repositories by name or description" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or what it does" type="search" />
          </label>
          <label className="switch-control">
            <input type="checkbox" checked={originalsOnly} onChange={(event) => setOriginalsOnly(event.target.checked)} />
            <span className="switch" aria-hidden="true"><i /></span>
            <span>Originals only</span>
          </label>
          <output className="result-count" aria-live="polite">{visible.length.toLocaleString()} results</output>
        </header>

        <div className="shelf-heading">
          <div>
            <h2>{activeShelf?.label ?? 'All purpose shelves'}</h2>
            <p>{activeShelf?.description ?? 'Browse the collection by the reason you would reach for a repository.'}</p>
          </div>
          <Legend />
        </div>

        <div className="collection-summary" aria-label="Collection summary">
          <span><b>{workCount.toLocaleString()}</b> original or authored</span>
          <span><b>{referenceCount.toLocaleString()}</b> reference copies</span>
          <span>Activity is “alive” within 365 days of the {new Date(library.generatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })} snapshot.</span>
        </div>

        {visible.length ? (
          <>
            <ol className="book-grid" aria-label="Repositories">
              {visible.slice(0, limit).map((book) => <Book key={book.full_name} book={book} generatedAt={library.generatedAt} />)}
            </ol>
            {limit < visible.length ? (
              <button className="show-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, visible.length - limit)} more <span>({visible.length - limit} remaining)</span>
              </button>
            ) : null}
          </>
        ) : (
          <section className="empty-state">
            <h3>No books found.</h3>
            <p>Try a different name or description, change shelves, or turn off originals only.</p>
            <button onClick={() => { setQuery(''); setShelfId('all'); setOriginalsOnly(false); }}>Clear filters</button>
          </section>
        )}
      </main>
    </div>
  );
}
