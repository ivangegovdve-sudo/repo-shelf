import { useEffect } from 'react';
import { connectStore, useShelf } from './store';
import { Scene } from './scene/Scene';
import { Header } from './ui/Header';
import { Controls } from './ui/Controls';
import { DetailPanel } from './ui/DetailPanel';
import { Dialogs } from './ui/Dialogs';
import { Toasts } from './ui/Toasts';
import { ViewControls } from './ui/ViewControls';
import { RewindOverlay } from './ui/Rewind';
import { WallOverlay } from './ui/WallOverlay';
import { WallMap } from './ui/WallMap';
import { RepoList } from './ui/RepoList';
import { staticData } from './static';
import { useShallow } from 'zustand/react/shallow';
import { selectVisibleRepos } from './store';

export function App() {
  const loaded = useShelf((s) => s.loaded);
  const loadError = useShelf((s) => s.loadError);
  const shelves = useShelf((s) => s.shelves);
  const repos = useShelf(useShallow(selectVisibleRepos));
  const busy = useShelf((s) => s.busy);
  const hasSelection = useShelf((s) => s.selectedRepoId !== null);
  const viewMode = useShelf((s) => s.viewMode);

  useEffect(() => connectStore(), []);
  useEffect(() => {
    const d = staticData();
    if (d) document.title = d.title;
  }, []);

  // Keep closing a book available even while the 3D canvas is mounting after a view switch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key !== 'Escape' || e.defaultPrevented || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = useShelf.getState();
      if (st.dialog || !st.selectedRepoId) return;
      e.preventDefault();
      st.select(null);
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Easter egg: typing "hermes" anywhere (outside inputs) reveals the hidden shelf.
  useEffect(() => {
    const word = 'hermes';
    let typed = '';
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-word.length);
      if (typed === word) useShelf.getState().revealSecret();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app ${busy ? 'busy' : ''}`}>
      <Header />
      <Controls />
      <main className={`stage view-${viewMode} ${hasSelection ? 'with-page' : ''}`}>
        {loadError ? (
          <div className="empty">
            <h2>Cannot reach the server</h2>
            <p>{loadError}</p>
            <p>
              Start it with <code>npm run dev</code> in the repo-shelf folder.
            </p>
          </div>
        ) : loaded && shelves.length === 0 ? (
          <div className="empty">
            <h2>No shelves yet</h2>
            <p>Add a folder that contains git repos.</p>
            <button className="btn primary" onClick={() => useShelf.getState().openDialog({ kind: 'shelves' })}>
              Add a shelf
            </button>
          </div>
        ) : viewMode === 'list' ? (
          <RepoList />
        ) : (
          <div className="scene-wrap">
            <Scene />
            <WallOverlay />
            <WallMap />
            <ViewControls />
            <RewindOverlay />
            {loaded && repos.length === 0 && <div className="scene-empty" role="status">
              <h2>No matching repositories</h2>
              <p>Try a broader selection or lower the star threshold.</p>
              <button className="btn primary" onClick={() => useShelf.getState().clearFilters()}>Reset filters</button>
            </div>}
          </div>
        )}
        <DetailPanel />
        {/* visually hidden index: keyboard / screen-reader access to every book */}
        <ul id="book-index" className="sr-only" aria-label="All repos">
          {repos.map((r) => (
            <li key={r.id}>
              <button data-book={r.name} data-shelf={r.shelfId} data-subcategory={r.catalog?.subCategory} onClick={() => useShelf.getState().select(r.id)}>
                {r.name}{r.catalog ? ` — ${r.catalog.kind}${r.catalog.upstream ? `, upstream ${r.catalog.upstream}` : ''}` : ''}
              </button>
            </li>
          ))}
        </ul>
      </main>
      <Dialogs />
      <Toasts />
    </div>
  );
}
