import type { Repo, Shelf } from '../types';
import { bayAt, type WallLayout } from './wallLayout';

/** Configured shelves keep their bay even when empty or filtered empty, so they stay drop targets; catalog bays only exist with books. */
export const keepConfiguredBays = (shelf: Shelf) => shelf.kind !== 'catalog';

/**
 * Folder repos move between folder shelves; GitHub books change visibility or clone. Catalog books stay put,
 * except one that is also on your GitHub shelf: it carries that book's GitHub actions.
 */
export function movable(repo: Repo, st: { readOnly: boolean; shelves: Shelf[] }): boolean {
  if (st.readOnly || (repo.catalog && !repo.catalog.githubShelfId)) return false;
  if (repo.virtual && !repo.repoSlug) return false;
  return st.shelves.some((s) => s.kind === 'disk' || s.kind === 'github');
}

export function dropTarget(repo: Repo, layout: WallLayout, x: number): string | null {
  const bay = bayAt(layout, x);
  const shelf = bay?.shelf;
  if (!shelf || shelf.id === repo.shelfId || shelf.id === repo.catalog?.githubShelfId) return null;
  if (repo.virtual) return shelf.kind === 'github' || shelf.kind === 'disk' ? shelf.id : null;
  return shelf.kind === 'disk' ? shelf.id : null;
}
