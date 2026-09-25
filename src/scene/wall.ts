import type { Repo, Shelf } from '../types';
import { bookHeight, bookThickness, compareOnShelf, editionOf, type Edition } from '../derive';
import { catalogBookDimensions } from './layout';

/**
 * The spine-out wall. World units are CSS pixels at zoom 1, y up, x along the
 * wall. Each shelf (category) is a bay: a vertical section between two divider
 * boards, with `rows` planks filled left to right, top to bottom.
 */
export const WALL = {
  /** Cornice above the rows; carries the bay name plates. */
  TOP: 42,
  /** Plinth below the rows; the wall map floats over it. */
  BOTTOM: 50,
  /** Rows are added while each can stay at least this tall. */
  MIN_PITCH: 180,
  MAX_ROWS: 8,
  PLANK: 14,
  /** Free space above the tallest spine in a row. */
  HEADROOM: 24,
  DIVIDER: 18,
  END: 34,
  BAY_PAD: 8,
  GAP: 1,
  /** Narrowest bay, so its name plate always fits. */
  MIN_BAY: 176,
  /** Book depth, front to back. */
  DEPTH: 150,
  /** Spine width in CSS px per unit of the catalog book proportions. */
  PX_PER_UNIT: 58,
  MIN_SPINE: 16,
  MAX_SPINE: 48,
} as const;

export interface WallMetrics {
  rows: number;
  pitch: number;
  /** Height of the tallest possible spine. */
  spineMax: number;
  height: number;
}

export interface SpineSlot {
  repo: Repo;
  index: number;
  bay: number;
  row: number;
  /** Left edge. */
  x: number;
  /** Bottom edge, the top of the plank it stands on. */
  y: number;
  w: number;
  h: number;
  edition: Edition;
}

export interface BayLayout {
  shelf: Shelf;
  index: number;
  x: number;
  width: number;
  /** Spine index range [first, end). */
  first: number;
  end: number;
  /** Spine index ranges per row, top row first. */
  rows: [number, number][];
  counts: Record<Edition, number>;
}

export interface WallLayout {
  metrics: WallMetrics;
  bays: BayLayout[];
  spines: SpineSlot[];
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function wallMetrics(canvasHeight: number): WallMetrics {
  const avail = Math.max(WALL.MIN_PITCH, canvasHeight - WALL.TOP - WALL.BOTTOM);
  const rows = clamp(Math.floor(avail / WALL.MIN_PITCH), 1, WALL.MAX_ROWS);
  const pitch = avail / rows;
  return { rows, pitch, spineMax: pitch - WALL.PLANK - WALL.HEADROOM, height: WALL.TOP + WALL.BOTTOM + avail };
}

/** y of the plank top that row `row` (0 = top row) stands on. */
export function rowBaseY(m: WallMetrics, row: number): number {
  return WALL.BOTTOM + (m.rows - 1 - row) * m.pitch + WALL.PLANK;
}

/** Spine footprint in CSS px. Width is fixed per book (so lettering never shrinks with the window); height follows the row pitch. */
export function spineSize(repo: Repo, m: WallMetrics): { w: number; h: number } {
  let width: number;
  let frac: number;
  if (repo.catalog) {
    const d = catalogBookDimensions(repo);
    width = d.width;
    frac = (d.height - 2.0) / 1.3;
  } else {
    const stars = repo.github?.stars ?? 0;
    width = repo.virtual ? bookThickness(stars * 40 + 400) : bookThickness(repo.sizeKB);
    frac = ((repo.virtual ? bookHeight(stars * 4 + 60) : bookHeight(repo.commitCount)) - 1.6) / 1.8;
  }
  return {
    w: Math.round(clamp(width * WALL.PX_PER_UNIT, WALL.MIN_SPINE, WALL.MAX_SPINE)),
    h: Math.round(m.spineMax * (0.8 + 0.2 * clamp(frac, 0, 1))),
  };
}

function rowsNeeded(widths: number[], inner: number): number {
  let rows = 1;
  let cx = 0;
  for (const w of widths) {
    if (cx > 0 && cx + w > inner) {
      rows++;
      cx = 0;
    }
    cx += w + WALL.GAP;
  }
  return rows;
}

/** Narrowest inner bay width whose books fit in `rows` rows. */
export function fitBayWidth(widths: number[], rows: number): number {
  const total = widths.reduce((a, w) => a + w + WALL.GAP, 0);
  let lo = Math.max(WALL.MIN_BAY - WALL.BAY_PAD * 2, ...widths, Math.ceil(total / rows));
  if (rowsNeeded(widths, lo) <= rows) return lo;
  let hi = Math.ceil(total);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (rowsNeeded(widths, mid) <= rows) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function layoutWall(shelves: Shelf[], byShelf: Map<string, Repo[]>, m: WallMetrics): WallLayout {
  const bays: BayLayout[] = [];
  const spines: SpineSlot[] = [];
  let x = WALL.END;
  for (const shelf of shelves) {
    const list = byShelf.get(shelf.id) ?? [];
    if (!list.length) continue;
    const sized = [...list].sort(compareOnShelf).map((repo) => ({ repo, edition: editionOf(repo), ...spineSize(repo, m) }));
    const inner = fitBayWidth(sized.map((s) => s.w), m.rows);
    if (bays.length) x += WALL.DIVIDER;
    const bayIndex = bays.length;
    const first = spines.length;
    const rows: [number, number][] = [];
    const counts: Record<Edition, number> = { original: 0, adapted: 0, reference: 0, plain: 0 };
    let row = 0;
    let cx = 0;
    let rowStart = first;
    for (const s of sized) {
      if (cx > 0 && cx + s.w > inner) {
        rows.push([rowStart, spines.length]);
        rowStart = spines.length;
        row++;
        cx = 0;
      }
      counts[s.edition]++;
      spines.push({ repo: s.repo, index: spines.length, bay: bayIndex, row, x: x + WALL.BAY_PAD + cx, y: rowBaseY(m, row), w: s.w, h: s.h, edition: s.edition });
      cx += s.w + WALL.GAP;
    }
    rows.push([rowStart, spines.length]);
    const width = inner + WALL.BAY_PAD * 2;
    bays.push({ shelf, index: bayIndex, x, width, first, end: spines.length, rows, counts });
    x += width;
  }
  return { metrics: m, bays, spines, width: x + WALL.END, height: m.height };
}

/** Bay whose span (including half of each neighbouring divider) contains x. */
export function bayAt(layout: WallLayout, x: number): BayLayout | null {
  const { bays } = layout;
  let lo = 0;
  let hi = bays.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = bays[mid];
    if (x < b.x - WALL.DIVIDER / 2) hi = mid - 1;
    else if (x > b.x + b.width + WALL.DIVIDER / 2) lo = mid + 1;
    else return b;
  }
  return null;
}

/** Row band under world y, or -1 (cornice, plinth, planks). */
export function rowAt(m: WallMetrics, y: number): number {
  const fromTop = m.height - WALL.TOP - y;
  if (fromTop < 0) return -1;
  const row = Math.floor(fromTop / m.pitch);
  if (row >= m.rows || y < rowBaseY(m, row)) return -1;
  return row;
}

/** Spine under a wall point; anywhere in the column above a spine counts, which keeps hover steady. */
export function spineAt(layout: WallLayout, x: number, y: number): number {
  const bay = bayAt(layout, x);
  if (!bay) return -1;
  const row = rowAt(layout.metrics, y);
  if (row < 0 || row >= bay.rows.length) return -1;
  const [start, end] = bay.rows[row];
  let lo = start;
  let hi = end - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = layout.spines[mid];
    if (x < s.x) hi = mid - 1;
    else if (x > s.x + s.w + WALL.GAP) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export type WallStep = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'prev-bay' | 'next-bay';

/** Keyboard movement: left/right read along the wall, up/down change rows within the bay. */
export function stepSpine(layout: WallLayout, index: number, step: WallStep): number {
  const n = layout.spines.length;
  if (!n) return -1;
  if (index < 0 || index >= n) return step === 'end' ? n - 1 : 0;
  const s = layout.spines[index];
  const bay = layout.bays[s.bay];
  switch (step) {
    case 'left':
      return Math.max(0, index - 1);
    case 'right':
      return Math.min(n - 1, index + 1);
    case 'home':
      return 0;
    case 'end':
      return n - 1;
    case 'prev-bay':
      return s.index > bay.first ? bay.first : s.bay > 0 ? layout.bays[s.bay - 1].first : index;
    case 'next-bay':
      return s.bay < layout.bays.length - 1 ? layout.bays[s.bay + 1].first : index;
    case 'up':
    case 'down': {
      const row = s.row + (step === 'up' ? -1 : 1);
      const range = bay.rows[row];
      if (!range || range[0] === range[1]) return index;
      const cx = s.x + s.w / 2;
      let best = range[0];
      for (let i = range[0]; i < range[1]; i++) {
        const t = layout.spines[i];
        if (Math.abs(t.x + t.w / 2 - cx) < Math.abs(layout.spines[best].x + layout.spines[best].w / 2 - cx)) best = i;
      }
      return best;
    }
  }
}

/** Spines lying entirely inside the horizontal window [x0, x1]. */
export function spinesWithin(layout: WallLayout, x0: number, x1: number): number {
  let count = 0;
  for (const bay of layout.bays) {
    if (bay.x + bay.width < x0 || bay.x > x1) continue;
    for (let i = bay.first; i < bay.end; i++) {
      const s = layout.spines[i];
      if (s.x >= x0 && s.x + s.w <= x1) count++;
    }
  }
  return count;
}

/** Index range of bays overlapping [x0, x1]. */
export function baysWithin(layout: WallLayout, x0: number, x1: number): [number, number] {
  let a = -1;
  let b = -1;
  layout.bays.forEach((bay, i) => {
    if (bay.x + bay.width >= x0 && bay.x <= x1) {
      if (a < 0) a = i;
      b = i;
    }
  });
  return a < 0 ? [0, -1] : [a, b];
}
