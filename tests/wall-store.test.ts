import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { catalogToState } from '../server/catalog';
import type { Repo } from '../src/types';
import { layoutWall, wallMetrics } from '../src/scene/wallLayout';
import { ZOOM_MIN, useWall } from '../src/scene/wallStore';

const state = catalogToState(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.public.json'), 'utf8')));
const size = { width: 1440, height: 790 };

beforeEach(() => {
  const byShelf = new Map<string, Repo[]>();
  for (const r of state.repos) byShelf.set(r.shelfId, [...(byShelf.get(r.shelfId) ?? []), r]);
  useWall.setState({ layout: null, target: { x: 0, y: 0, zoom: 1 } });
  useWall.getState().setLayout(layoutWall(state.shelves, byShelf, wallMetrics(size.height)), size);
});

describe('framing the whole wall for an export', () => {
  it('fits the full public catalog even when that needs less than the interactive zoom floor', () => {
    const { layout } = useWall.getState();
    const needed = (size.width - 32) / layout!.width;
    expect(needed).toBeLessThan(ZOOM_MIN);
    useWall.getState().frameAll();
    const { target } = useWall.getState();
    expect(target.zoom).toBeCloseTo(needed, 6);
    expect(size.width / target.zoom).toBeGreaterThanOrEqual(layout!.width);
    expect(target.x).toBeCloseTo(layout!.width / 2, 6);
  });

  it('keeps the floor for interactive moves', () => {
    useWall.getState().setTarget({ zoom: 0.05 });
    expect(useWall.getState().target.zoom).toBe(ZOOM_MIN);
    useWall.getState().frameAll();
    useWall.getState().scrollBy(10);
    expect(useWall.getState().target.zoom).toBe(ZOOM_MIN);
  });
});
