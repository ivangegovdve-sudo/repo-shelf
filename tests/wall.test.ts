import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogToState } from '../server/catalog';
import type { Repo, Shelf } from '../src/types';
import { WALL, bayAt, layoutWall, rowAt, spineAt, spinesWithin, stepSpine, wallMetrics, type WallLayout } from '../src/scene/wallLayout';

const state = catalogToState(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.public.json'), 'utf8')));

function wallFor(canvasHeight: number, repos: Repo[] = state.repos, shelves: Shelf[] = state.shelves): WallLayout {
  const byShelf = new Map<string, Repo[]>();
  for (const r of repos) byShelf.set(r.shelfId, [...(byShelf.get(r.shelfId) ?? []), r]);
  return layoutWall(shelves, byShelf, wallMetrics(canvasHeight));
}

/** Header + toolbar height in the compact layout (see .hdr / .controls in styles.css); generous on purpose. */
const CHROME = 110;

describe('wall metrics', () => {
  it('adds rows as the window grows and keeps every row at least MIN_PITCH tall', () => {
    for (const h of [500, 700, 900, 1100, 1400]) {
      const m = wallMetrics(h);
      expect(m.pitch).toBeGreaterThanOrEqual(WALL.MIN_PITCH);
      expect(m.height).toBe(Math.max(h, WALL.TOP + WALL.BOTTOM + WALL.MIN_PITCH));
    }
    expect(wallMetrics(1080 - CHROME).rows).toBe(4);
    expect(wallMetrics(900 - CHROME).rows).toBe(3);
  });
});

describe('spine-out wall layout', () => {
  const layout = wallFor(1080 - CHROME);

  it('places every book exactly once, one bay per purpose shelf, in shelf order', () => {
    expect(layout.spines).toHaveLength(state.repos.length);
    expect(new Set(layout.spines.map((s) => s.repo.id)).size).toBe(state.repos.length);
    expect(layout.bays.map((b) => b.shelf.id)).toEqual(state.shelves.map((s) => s.id));
    for (const bay of layout.bays) {
      expect(layout.spines.slice(bay.first, bay.end).every((s) => s.repo.shelfId === bay.shelf.id)).toBe(true);
    }
  });

  it('separates bays with real divider boards and keeps books inside their bay and row', () => {
    for (let i = 1; i < layout.bays.length; i++) {
      const prev = layout.bays[i - 1];
      expect(layout.bays[i].x - (prev.x + prev.width)).toBe(WALL.DIVIDER);
    }
    for (const s of layout.spines) {
      const bay = layout.bays[s.bay];
      expect(s.x).toBeGreaterThanOrEqual(bay.x + WALL.BAY_PAD);
      expect(s.x + s.w).toBeLessThanOrEqual(bay.x + bay.width - WALL.BAY_PAD + 0.001);
      expect(s.row).toBeLessThan(layout.metrics.rows);
      expect(s.h).toBeLessThanOrEqual(layout.metrics.spineMax);
    }
  });

  it("shelves Ivan's own work first in every bay, reference copies last", () => {
    const rank = { original: 0, adapted: 1, plain: 2, reference: 3 };
    for (const bay of layout.bays) {
      const ranks = layout.spines.slice(bay.first, bay.end).map((s) => rank[s.edition]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('picks the spine under a point, including the headroom above a short book', () => {
    for (const s of [layout.spines[0], layout.spines[500], layout.spines[layout.spines.length - 1]]) {
      expect(spineAt(layout, s.x + s.w / 2, s.y + 2)).toBe(s.index);
      expect(spineAt(layout, s.x + s.w / 2, s.y + layout.metrics.spineMax + 4)).toBe(s.index);
    }
    expect(spineAt(layout, 1, layout.height / 2)).toBe(-1);
    expect(rowAt(layout.metrics, 1)).toBe(-1);
    const gap = layout.bays[1].x - WALL.DIVIDER / 2;
    expect(bayAt(layout, gap)).not.toBeNull();
    expect(spineAt(layout, gap, layout.spines[0].y + 10)).toBe(-1);
  });

  it('moves the keyboard focus along the wall and between rows of the same bay', () => {
    const s = layout.spines[layout.bays[0].rows[0][0] + 3];
    expect(stepSpine(layout, s.index, 'right')).toBe(s.index + 1);
    expect(stepSpine(layout, s.index, 'left')).toBe(s.index - 1);
    const below = layout.spines[stepSpine(layout, s.index, 'down')];
    expect(below.row).toBe(s.row + 1);
    expect(below.bay).toBe(s.bay);
    expect(Math.abs(below.x - s.x)).toBeLessThan(WALL.MAX_SPINE);
    expect(stepSpine(layout, below.index, 'up')).toBeLessThanOrEqual(s.index + 1);
    expect(stepSpine(layout, s.index, 'up')).toBe(s.index);
    expect(layout.spines[stepSpine(layout, s.index, 'next-bay')].bay).toBe(1);
    expect(stepSpine(layout, 0, 'left')).toBe(0);
    expect(stepSpine(layout, -1, 'right')).toBe(0);
  });
});

describe('density target: at least 150 legible spines in one window', () => {
  const screens = [
    { name: '1920×1080', w: 1920, h: 1080 },
    { name: '1440×900', w: 1440, h: 900 },
    { name: '1366×768', w: 1366, h: 768 },
  ];
  for (const screen of screens) {
    it(`holds ≥150 whole spines anywhere along the wall at ${screen.name}`, () => {
      const layout = wallFor(screen.h - CHROME);
      let worst = Infinity;
      for (let x0 = 0; x0 + screen.w <= layout.width; x0 += 97) worst = Math.min(worst, spinesWithin(layout, x0, x0 + screen.w));
      expect(worst).toBeGreaterThanOrEqual(150);
    });
  }

  it('never trades legibility for density: spines stay wide and tall enough to letter', () => {
    const layout = wallFor(768 - CHROME);
    expect(Math.min(...layout.spines.map((s) => s.w))).toBeGreaterThanOrEqual(WALL.MIN_SPINE);
    expect(Math.min(...layout.spines.map((s) => s.h))).toBeGreaterThanOrEqual(115);
  });
});
