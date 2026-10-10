import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Repo, Shelf } from '../src/types';
import { advanceCull, SpineField, stepEligibleSpine, type CullState } from '../src/scene/spineField';
import { layoutWall, wallMetrics } from '../src/scene/wallLayout';

function repo(id: string, stars: number): Repo {
  return {
    id, name: id, path: '', shelfId: 'shelf', virtual: true,
    linkUrl: null, visibility: 'public', archived: false, createdAt: null,
    doc: null, summary: null, branch: null, lastCommitAt: null,
    commitCount: 1, dirtyCount: 0, sizeKB: 0, languageGuess: 'TypeScript',
    remoteUrl: null, owner: 'library', repoSlug: `library/${id}`,
    github: {
      description: null, language: 'TypeScript', stars, topics: [],
      isPrivate: false, isFork: false, pushedAt: '', htmlUrl: '', fetchedAt: '',
    },
  };
}

const repos = [repo('a-zero', 0), repo('b-one', 1), repo('c-five', 5), repo('d-top', 100), repo('e-top-tie', 100)];
const shelf: Shelf = { id: 'shelf', label: 'Library', path: null, kind: 'github', hidden: false, repoCount: repos.length };
const layout = layoutWall([shelf], new Map([['shelf', repos]]), wallMetrics(600));

function field(): SpineField {
  const next = new SpineField();
  next.setLayout(layout);
  return next;
}

function settle(next: SpineField): void {
  for (let i = 0; i < 120; i++) next.animate(1 / 60, false);
}

function matrix(next: SpineField, id: string): THREE.Matrix4 {
  const mesh = next.group.children[0] as THREE.InstancedMesh;
  const out = new THREE.Matrix4();
  mesh.getMatrixAt(layout.spines.findIndex((s) => s.repo.id === id), out);
  return out;
}

describe('reversible star culling', () => {
  it('eases the lowest star groups away first and preserves every highest-star tie', () => {
    const next = field();
    next.setStarThreshold(100);
    expect(next.cullingStats()).toMatchObject({ threshold: 100, targetVisible: 2, visible: 5, animating: 3 });
    // Eligibility changes immediately while rendering eases independently.
    expect(next.canInteract('a-zero')).toBe(false);
    expect(next.canInteract('d-top')).toBe(true);
    next.animate(0.05, false);
    expect(next.visibilityOf('a-zero')).toBeLessThan(1);
    expect(next.visibilityOf('b-one')).toBe(1);
    expect(next.visibilityOf('c-five')).toBe(1);
    for (let i = 0; i < 6; i++) next.animate(1 / 60, false);
    expect(next.visibilityOf('a-zero')).toBeLessThan(next.visibilityOf('b-one'));
    expect(next.visibilityOf('b-one')).toBeLessThan(next.visibilityOf('c-five'));
    settle(next);
    expect(next.cullingStats()).toEqual({ threshold: 100, visible: 2, targetVisible: 2, animating: 0 });
    expect(next.visibilityOf('d-top')).toBe(1);
    expect(next.visibilityOf('e-top-tie')).toBe(1);
    next.dispose();
  });

  it('reverses a partially completed cull without popping and restores exact shelf positions', () => {
    const next = field();
    const before = matrix(next, 'a-zero').elements.slice();
    const geometry = (next.group.children[0] as THREE.InstancedMesh).geometry;
    next.setStarThreshold(5);
    next.animate(0.12, false);
    const halfway = next.visibilityOf('a-zero');
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(1);
    next.setStarThreshold(0);
    expect(next.visibilityOf('a-zero')).toBe(halfway);
    next.animate(1 / 60, false);
    expect(next.visibilityOf('a-zero')).toBeGreaterThan(halfway);
    settle(next);
    expect(next.cullingStats()).toEqual({ threshold: 0, visible: 5, targetVisible: 5, animating: 0 });
    expect(matrix(next, 'a-zero').elements).toEqual(before);
    expect(next.layout).toBe(layout);
    expect((next.group.children[0] as THREE.InstancedMesh).geometry).toBe(geometry);
    expect(next.group.children).toHaveLength(1);
    expect(next.atlas.stats().pages).toBe(0);
    next.dispose();
  });

  it('handles rapid repeated direction changes and reduced motion', () => {
    const next = field();
    for (const threshold of [1, 100, 0, 5, 0, 100, 1, 0]) {
      const current = next.visibilityOf('a-zero');
      next.setStarThreshold(threshold);
      expect(next.visibilityOf('a-zero')).toBe(current);
      next.animate(1 / 60, false);
    }
    next.setStarThreshold(100, true);
    expect(next.visibilityOf('a-zero')).toBe(0);
    expect(matrix(next, 'a-zero').elements).toEqual(new THREE.Matrix4().makeScale(0, 0, 0).elements);
    expect(next.cullingStats().animating).toBe(0);
    next.setStarThreshold(0, true);
    expect(next.visibilityOf('a-zero')).toBe(1);
    expect(next.animate(1 / 60, true)).toBe(false);
    next.dispose();
  });

  it('initializes an active threshold instantly when the 3D view is remounted', () => {
    const next = new SpineField();
    next.setStarThreshold(100);
    next.setLayout(layout);
    expect(next.cullingStats()).toEqual({ threshold: 100, visible: 2, targetVisible: 2, animating: 0 });
    next.dispose();
  });

  it('still animates smoothly when demand rendering wakes after a long idle gap', () => {
    const next = field();
    next.setStarThreshold(100);
    next.animate(12, false);
    expect(next.visibilityOf('a-zero')).toBeGreaterThan(0);
    expect(next.visibilityOf('a-zero')).toBeLessThan(1);
    expect(next.visibilityOf('b-one')).toBe(1);
    expect(next.cullingStats().animating).toBe(3);
    next.dispose();
  });

  it('does not allocate atlas pages or queue lettering for fully culled / hidden books', () => {
    const next = field();
    next.setStarThreshold(101, true);
    expect(next.update(0, layout.width, 1, 12, true)).toEqual({ drawn: 0, pending: 0, uploads: 0 });
    expect(next.unlettered(0, layout.width)).toBe(0);
    next.hidden = new Set(repos.map((r) => r.id));
    next.setStarThreshold(0, true);
    expect(next.update(0, layout.width, 2, 12, true)).toEqual({ drawn: 0, pending: 0, uploads: 0 });
    expect(next.atlas.stats().pages).toBe(0);
    expect(next.canInteract('d-top')).toBe(false);
    next.dispose();
  });
});

describe('cull easing and keyboard focus', () => {
  it('has the same easing at different frame rates', () => {
    const slow: CullState = { cur: 1, target: 0, delay: 0.1 };
    const fast: CullState = { ...slow };
    for (let i = 0; i < 9; i++) advanceCull(slow, 1 / 30, false);
    for (let i = 0; i < 36; i++) advanceCull(fast, 1 / 120, false);
    expect(slow.cur).toBeCloseTo(fast.cur, 10);
    expect(advanceCull(slow, 0, true)).toBe(false);
    expect(slow.cur).toBe(0);
  });

  it('skips fading books for arrows and Home / End, including an empty result', () => {
    const next = field();
    next.setStarThreshold(100);
    const eligible = (id: string) => next.canInteract(id);
    const first = layout.spines.findIndex((s) => s.repo.id === 'd-top');
    const last = layout.spines.findIndex((s) => s.repo.id === 'e-top-tie');
    expect(stepEligibleSpine(layout, 0, 'home', eligible)).toBe(first);
    expect(stepEligibleSpine(layout, first, 'right', eligible)).toBe(last);
    expect(stepEligibleSpine(layout, last, 'left', eligible)).toBe(first);
    expect(stepEligibleSpine(layout, first, 'end', eligible)).toBe(last);
    next.setStarThreshold(101);
    expect(stepEligibleSpine(layout, first, 'right', eligible)).toBe(-1);
    next.dispose();
  });
});
