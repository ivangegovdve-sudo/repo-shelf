import { useEffect, useRef } from 'react';
import { useWall, wallView } from '../scene/wallStore';

/** The whole wall in one strip: every bay, how much of it is Ivan's work, and where the view is. Click or drag to travel. */
export function WallMap() {
  const layout = useWall((s) => s.layout);
  const strip = useRef<HTMLDivElement>(null);
  const windowEl = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      wallView.subscribe(() => {
        const L = useWall.getState().layout;
        const node = windowEl.current;
        if (!L || !node || L.width <= 0) return;
        const a = Math.max(0, wallView.x0 / L.width);
        const b = Math.min(1, wallView.x1 / L.width);
        node.style.left = `${(a * 100).toFixed(3)}%`;
        node.style.width = `${(Math.max(0.01, b - a) * 100).toFixed(3)}%`;
      }),
    [],
  );

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let dragging = false;
    const travel = (clientX: number) => {
      const L = useWall.getState().layout;
      if (!L) return;
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      useWall.getState().setTarget({ x: f * L.width });
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      travel(e.clientX);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      travel(e.clientX);
      wallView.snap = true;
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);

  if (!layout || layout.bays.length < 2) return null;
  const W = layout.width;
  return (
    <nav className="wallmap" aria-label="Categories along the wall">
      <div className="wallmap-strip" ref={strip}>
        {layout.bays.map((bay) => {
          const n = Math.max(1, bay.end - bay.first);
          return (
            <div
              key={bay.shelf.id}
              className="wallmap-bay"
              style={{ left: `${(bay.x / W) * 100}%`, width: `${(bay.width / W) * 100}%` }}
              title={`${bay.shelf.label}: ${bay.end - bay.first} repos, ${bay.counts.original} originals, ${bay.counts.adapted} adapted forks`}
            >
              <span className="wallmap-label">{bay.shelf.label}</span>
              <span className="wallmap-bar" aria-hidden="true">
                <i className="ed-original" style={{ width: `${(bay.counts.original / n) * 100}%` }} />
                <i className="ed-adapted" style={{ width: `${(bay.counts.adapted / n) * 100}%` }} />
              </span>
            </div>
          );
        })}
        <div className="wallmap-window" ref={windowEl} />
      </div>
      <div className="sr-only">
        {layout.bays.map((bay) => (
          <button key={bay.shelf.id} onClick={() => useWall.getState().setTarget({ x: bay.x + useWall.getState().size.width / 2 / useWall.getState().target.zoom - 24 })}>
            Go to {bay.shelf.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
