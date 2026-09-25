import { create } from 'zustand';
import type { WallLayout } from './wall';

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 3;
/** Room shown beyond the end panels at zoom 1. */
const EDGE = 0;

export interface WallTarget {
  /** World x/y at the centre of the canvas. */
  x: number;
  y: number;
  zoom: number;
}

interface WallState {
  layout: WallLayout | null;
  size: { width: number; height: number };
  target: WallTarget;
  /** CSS px of the canvas covered on the right by the open book window. */
  occludeRight: number;
  setLayout: (layout: WallLayout, size: { width: number; height: number }) => void;
  setOccludeRight: (px: number) => void;
  setTarget: (t: Partial<WallTarget>) => void;
  scrollBy: (dxWorld: number, dyWorld?: number) => void;
  zoomAt: (zoom: number, anchor?: { x: number; y: number }) => void;
  /** Scroll just enough to bring [x0, x1] (world) into the unobscured part of the canvas. */
  reveal: (x0: number, x1: number, y0?: number, y1?: number) => void;
  resetView: () => void;
}

function clampTarget(t: WallTarget, layout: WallLayout | null, size: { width: number; height: number }): WallTarget {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, t.zoom));
  if (!layout || size.width <= 0) return { ...t, zoom };
  const halfW = size.width / 2 / zoom;
  const halfH = size.height / 2 / zoom;
  const minX = halfW - EDGE;
  const maxX = layout.width - halfW + EDGE;
  const x = minX > maxX ? layout.width / 2 : Math.min(maxX, Math.max(minX, t.x));
  const y = halfH * 2 >= layout.height ? layout.height / 2 : Math.min(layout.height - halfH, Math.max(halfH, t.y));
  return { x, y, zoom };
}

export const useWall = create<WallState>()((set, get) => ({
  layout: null,
  size: { width: 0, height: 0 },
  target: { x: 0, y: 0, zoom: 1 },
  occludeRight: 0,

  setLayout(layout, size) {
    const first = get().layout === null;
    const target = first ? { x: size.width / 2 - EDGE, y: layout.height / 2, zoom: get().target.zoom } : get().target;
    set({ layout, size, target: clampTarget(target, layout, size) });
  },
  setOccludeRight: (occludeRight) => set({ occludeRight }),
  setTarget(t) {
    const { layout, size, target } = get();
    set({ target: clampTarget({ ...target, ...t }, layout, size) });
  },
  scrollBy(dx, dy = 0) {
    const { target } = get();
    get().setTarget({ x: target.x + dx, y: target.y + dy });
  },
  zoomAt(zoom, anchor) {
    const { target, layout, size } = get();
    const next = clampTarget({ ...target, zoom }, layout, size).zoom;
    if (!anchor) {
      get().setTarget({ zoom: next });
      return;
    }
    // Keep the world point under the pointer fixed while zooming.
    const k = target.zoom / next;
    get().setTarget({ zoom: next, x: anchor.x + (target.x - anchor.x) * k, y: anchor.y + (target.y - anchor.y) * k });
  },
  reveal(x0, x1, y0, y1) {
    const { target, size, occludeRight } = get();
    const halfW = size.width / 2 / target.zoom;
    const margin = 48 / target.zoom;
    const left = target.x - halfW + margin;
    const right = target.x + halfW - (occludeRight + 48) / target.zoom;
    let x = target.x;
    if (right - left < x1 - x0) x = (x0 + x1) / 2 + (occludeRight / 2) / target.zoom;
    else if (x0 < left) x += x0 - left;
    else if (x1 > right) x += x1 - right;
    let y = target.y;
    if (y0 !== undefined && y1 !== undefined) {
      const halfH = size.height / 2 / target.zoom;
      if (y0 < target.y - halfH + margin) y += y0 - (target.y - halfH + margin);
      else if (y1 > target.y + halfH - margin) y += y1 - (target.y + halfH - margin);
    }
    get().setTarget({ x, y });
  },
  resetView() {
    const { target, size, layout } = get();
    const halfW = size.width / 2;
    // Stay on the part of the wall being looked at, just back at 100 %.
    const left = target.x - size.width / 2 / target.zoom;
    set({ target: clampTarget({ x: left + halfW, y: (layout?.height ?? size.height) / 2, zoom: 1 }, layout, size) });
  },
}));

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Live camera window and overlay anchors, written every rendered frame. Not reactive: subscribe for per-frame updates. */
export const wallView = {
  x0: 0,
  x1: 0,
  y0: 0,
  y1: 0,
  zoom: 1,
  /** Canvas-relative rect of the spine the tooltip belongs to. */
  tip: null as { id: string; rect: ScreenRect } | null,
  /** Canvas-relative rect of the keyboard-focused spine. */
  ring: null as ScreenRect | null,
  /** Canvas-relative centre x of each bay's name plate (sticky within the bay), null when off screen. */
  plates: [] as (number | null)[],
  plateY: 0,
  /** True after arrow-key navigation, false again on pointer movement. */
  keyboard: false,
  /** Set by direct manipulation (drag to pan): the camera jumps to its target for one frame instead of easing. */
  snap: false,
  listeners: new Set<() => void>(),
  subscribe(fn: () => void): () => void {
    wallView.listeners.add(fn);
    return () => wallView.listeners.delete(fn);
  },
  emit(): void {
    for (const fn of wallView.listeners) fn();
  },
};

declare global {
  interface Window {
    __wall?: typeof useWall;
  }
}
if (typeof window !== 'undefined') window.__wall = useWall;
