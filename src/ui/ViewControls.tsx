import { useShelf } from '../store';
import { useWall, wallView } from '../scene/wallStore';

/** Scroll so the previous / next category bay starts at the left edge of the view. */
export function jumpBay(dir: 1 | -1): void {
  const { layout, target, size } = useWall.getState();
  if (!layout?.bays.length) return;
  const left = target.x - size.width / 2 / target.zoom;
  let i = layout.bays.findIndex((b) => b.x + b.width > left + 40);
  if (i < 0) i = layout.bays.length - 1;
  const current = layout.bays[i];
  const next = dir < 0 && current.x < left - 40 ? current : layout.bays[Math.min(layout.bays.length - 1, Math.max(0, i + dir))];
  useWall.getState().setTarget({ x: next.x - 24 + size.width / 2 / target.zoom });
  if (wallView.keyboard && next.end > next.first) useShelf.getState().setFocused(layout.spines[next.first].repo.id);
}

export function ViewControls() {
  const zoom = useWall((s) => s.target.zoom);
  const wall = useWall.getState();
  return (
    <div className="viewctl" role="group" aria-label="View controls">
      <button onClick={() => wall.zoomAt(zoom / 1.25)} aria-label="Zoom out" title="Zoom out  (−, ctrl+wheel)">
        −
      </button>
      <button className="zoom-val" onClick={() => wall.resetView()} disabled={Math.abs(zoom - 1) < 0.01} title="Back to 100 %  (0, double-click the wood)">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => wall.zoomAt(zoom * 1.25)} aria-label="Zoom in" title="Zoom in  (+, ctrl+wheel)">
        +
      </button>
      <span className="viewctl-sep" />
      <button onClick={() => jumpBay(-1)} aria-label="Previous category" title="Previous category  (Page Up)">
        ‹
      </button>
      <button onClick={() => jumpBay(1)} aria-label="Next category" title="Next category  (Page Down)">
        ›
      </button>
      <button
        className="viewctl-help"
        aria-label="Keyboard and mouse help"
        title={'Scroll, or drag the wood, to move along the wall\nArrow keys walk the spines · Page Up / Down jump categories\nEnter opens a book · Esc closes it\nCtrl + wheel or + / − zoom · 0 resets · / searches'}
        onClick={() => useShelf.getState().toast('info', 'Scroll or drag along the wall. Arrow keys walk the spines, Enter opens, Esc closes, / searches.')}
      >
        ?
      </button>
    </div>
  );
}
