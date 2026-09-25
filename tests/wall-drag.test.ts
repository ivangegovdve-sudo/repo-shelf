import { describe, expect, it } from 'vitest';
import type { Repo, Shelf } from '../src/types';
import { layoutWall, wallMetrics } from '../src/scene/wallLayout';
import { dropTarget, keepConfiguredBays, movable } from '../src/scene/wallDrag';
import { configurableShelves } from '../src/derive';

const shelf = (id: string, kind: Shelf['kind'], label = id): Shelf => ({ id, label, path: null, kind, hidden: false, repoCount: 0 });
const shelves = [shelf('voice', 'catalog'), shelf('empty-bay', 'catalog'), shelf('gh-pub', 'github', 'GitHub · public'), shelf('gh-priv', 'github', 'GitHub · private'), shelf('disk', 'disk')];

function book(id: string, githubShelfId?: string): Repo {
  return {
    id, name: id, path: '', shelfId: 'voice', virtual: true, linkUrl: `https://github.com/me/${id}`, visibility: 'public', archived: false,
    createdAt: null, doc: null, summary: null, branch: null, lastCommitAt: null, commitCount: 0, dirtyCount: 0, sizeKB: 0,
    languageGuess: null, remoteUrl: `https://github.com/me/${id}.git`, owner: 'me', repoSlug: `me/${id}`, github: null,
    catalog: { kind: 'original', upstream: null, commitsAhead: 3, repoUrl: `https://github.com/me/${id}`, cardStale: false, verificationStatus: 'verified', confidence: 'high', cardGeneratedAt: '', alive: true, githubShelfId },
  };
}
const managed = book('managed', 'gh-pub');
const snapshot = book('snapshot');
const layout = layoutWall(shelves, new Map([['voice', [managed, snapshot]]]), wallMetrics(700), keepConfiguredBays);
const centreOf = (id: string) => {
  const bay = layout.bays.find((b) => b.shelf.id === id)!;
  return bay.x + bay.width / 2;
};

describe('bays beside the catalog', () => {
  it('keeps empty configured shelves as bays (drop targets) and leaves out empty catalog bays', () => {
    expect(layout.bays.map((b) => b.shelf.id)).toEqual(['voice', 'gh-pub', 'gh-priv', 'disk']);
  });

  it('keeps them when a filter empties them too', () => {
    const filtered = layoutWall(shelves, new Map(), wallMetrics(700), keepConfiguredBays);
    expect(filtered.bays.map((b) => b.shelf.id)).toEqual(['gh-pub', 'gh-priv', 'disk']);
  });

  it('lists only configured shelves in shelf management', () => {
    expect(configurableShelves(shelves).map((s) => s.id)).toEqual(['gh-pub', 'gh-priv', 'disk']);
  });
});

describe('dragging catalog books', () => {
  const st = { readOnly: false, shelves };

  it('lets a catalog book that is also on your GitHub shelf be dragged; a snapshot book stays put', () => {
    expect(movable(managed, st)).toBe(true);
    expect(movable(snapshot, st)).toBe(false);
    expect(movable(managed, { ...st, readOnly: true })).toBe(false);
  });

  it('drops it on the other GitHub shelf (visibility) or a folder shelf (clone), never on its own GitHub shelf', () => {
    expect(dropTarget(managed, layout, centreOf('gh-priv'))).toBe('gh-priv');
    expect(dropTarget(managed, layout, centreOf('disk'))).toBe('disk');
    expect(dropTarget(managed, layout, centreOf('gh-pub'))).toBeNull();
    expect(dropTarget(managed, layout, centreOf('voice'))).toBeNull();
  });
});
