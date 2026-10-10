import { useShelf } from '../store';

export function ViewToggle() {
  const viewMode = useShelf((s) => s.viewMode);
  const setViewMode = useShelf((s) => s.setViewMode);
  return (
    <div className="view-toggle" role="group" aria-label="Library view">
      <button type="button" aria-pressed={viewMode === '3d'} onClick={() => setViewMode('3d')} title="Explore repositories as books on the shelves">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M3 15V5h3v10m2 0V3h3v12m2 0V6h4v9M2 17h16" />
        </svg>
        3D Library
      </button>
      <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} title="Browse repositories in a flat list">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M7 5h10M7 10h10M7 15h10M3 5h1M3 10h1M3 15h1" strokeLinecap="round" />
        </svg>
        List
      </button>
    </div>
  );
}
