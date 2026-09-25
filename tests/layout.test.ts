import { describe, expect, it } from 'vitest';
import { catalogBookDimensions, layoutRow } from '../src/scene/layout';
import type { Repo } from '../src/types';

function repo(name: string, kind: NonNullable<Repo['catalog']>['kind']): Repo {
  return {
    id: name, name, path: '', shelfId: 's', virtual: true, linkUrl: 'https://example.com',
    visibility: 'public', archived: false, createdAt: null, doc: null, summary: 'A useful repository with a clear purpose.',
    branch: null, lastCommitAt: '2026-09-01T00:00:00Z', commitCount: 0, dirtyCount: 0, sizeKB: 0,
    languageGuess: 'TypeScript', remoteUrl: null, owner: 'ivan', repoSlug: `ivan/${name}`, github: null,
    catalog: {
      kind, upstream: kind === 'original' ? null : `upstream/${name}`, commitsAhead: kind === 'reference-copy' ? 0 : 3,
      repoUrl: `https://github.com/ivan/${name}`, cardStale: false, verificationStatus: 'verified', confidence: 'high',
      cardGeneratedAt: '2026-09-20T00:00:00Z', alive: true,
    },
  };
}

describe('catalog book proportions', () => {
  it('gives stable, book-like dimensions instead of identical virtual slivers', () => {
    const books = Array.from({ length: 20 }, (_, index) => repo(`book-${index}`, 'reference-copy'));
    const dimensions = books.map(catalogBookDimensions);
    expect(new Set(dimensions.map(({ width, height }) => `${width.toFixed(2)}:${height.toFixed(2)}`)).size).toBeGreaterThan(10);
    expect(dimensions.every(({ width, height }) => width >= 0.26 && height >= 2.05)).toBe(true);
    expect(layoutRow(books).slots.map(({ width, height }) => ({ width, height }))).toEqual(dimensions);
  });

  it('makes authored editions more substantial than archival reference copies', () => {
    const reference = catalogBookDimensions(repo('same-title', 'reference-copy'));
    const authored = catalogBookDimensions(repo('same-title', 'authored-fork'));
    const original = catalogBookDimensions(repo('same-title', 'original'));
    expect(authored.width).toBeGreaterThan(reference.width);
    expect(original.width).toBeGreaterThan(authored.width);
    expect(original.height).toBeGreaterThan(reference.height);
  });
});
