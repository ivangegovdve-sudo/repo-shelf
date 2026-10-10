import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../src/types';
import { bookTextures, visualKey } from '../src/scene/textures';
import { paintSpine, SpineAtlas } from '../src/scene/spineAtlas';
import { spineStyle } from '../src/scene/spineStyle';

function reference(id: string): Repo {
  return {
    id, name: 'renamed-fork', path: '', shelfId: 'agents-assistants', virtual: true,
    linkUrl: null, visibility: 'public', archived: false, createdAt: null,
    doc: null, summary: 'An upstream SDK.', branch: null, lastCommitAt: null,
    commitCount: 0, dirtyCount: 0, sizeKB: 0, languageGuess: 'TypeScript',
    remoteUrl: null, owner: 'Ivan', repoSlug: 'Ivan/renamed-fork',
    github: {
      description: 'An upstream SDK.', language: 'TypeScript', stars: 17, topics: [],
      isPrivate: false, isFork: true, pushedAt: '', htmlUrl: '', fetchedAt: '',
      upstream: { fullName: 'SourceOrg/SDK', stars: 9999, fetchedAt: '2026-10-10T00:00:00Z' },
    },
    catalog: {
      kind: 'reference-copy', upstream: 'SourceOrg/SDK', commitsAhead: 0,
      repoUrl: 'https://github.com/Ivan/renamed-fork', cardStale: false,
      verificationStatus: 'verified', confidence: 'high', cardGeneratedAt: '', alive: true,
    },
  };
}

interface PaintedCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texts: string[];
}

/** Record what is actually painted without requiring a browser or allocating GPU textures. */
function paintedCanvas(): PaintedCanvas {
  const texts: string[] = [];
  const values: Record<string, unknown> = { font: '16px sans-serif' };
  const ctx = new Proxy(values, {
    get(target, property) {
      if (property === 'fillText') return (value: string) => texts.push(value);
      if (property === 'measureText') return (value: string) => ({ width: value.length * Number(String(target.font).match(/([\d.]+)px/)?.[1] ?? 16) * 0.5 });
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => ({ addColorStop() {} });
      return target[String(property)] ?? (() => undefined);
    },
    set(target, property, value) {
      target[String(property)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx, texts };
}

function captureBook(repo: Repo): PaintedCanvas[] {
  const painted: PaintedCanvas[] = [];
  vi.stubGlobal('document', {
    createElement() {
      const next = paintedCanvas();
      painted.push(next);
      return next.canvas;
    },
  });
  bookTextures(repo, 90, true);
  return painted;
}

afterEach(() => vi.unstubAllGlobals());

describe('scene uses unchanged upstream identity', () => {
  it('paints the exact source owner/repo on the atlas spine', () => {
    const repo = reference('atlas-source');
    const painted = paintedCanvas();
    paintSpine(painted.ctx, repo, spineStyle(repo, 90), 36, 200);
    expect(painted.texts).toContain('SourceOrg/SDK');
    expect(painted.texts.join(' ')).not.toContain('Renamed Fork');
  });

  it('shows the source title and actual source stars on the cover and first page', () => {
    const painted = captureBook(reference('detail-source'));
    expect(painted).toHaveLength(3);
    const [, cover, page] = painted;
    const referenceLabel = cover.texts.indexOf('REFERENCE EDITION');
    expect(cover.texts.slice(1, referenceLabel).join('')).toBe('SourceOrg/SDK');
    expect(cover.texts).toContain('★ 9,999 GITHUB STARS');
    expect(page.texts).toContain('SourceOrg/SDK');
    expect(page.texts.join(' ')).toContain('9,999 stars');
    expect(page.texts.join(' ')).not.toContain('17 stars');
  });

  it('wraps a long source name without losing characters on either detailed title', () => {
    const repo = reference('long-source');
    const source = `SourceOrganization/${'upstream-sdk-'.repeat(5)}implementation`;
    repo.catalog!.upstream = source;
    repo.github!.upstream!.fullName = source;
    const [, cover, page] = captureBook(repo);
    const referenceLabel = cover.texts.indexOf('REFERENCE EDITION');
    expect(cover.texts.slice(1, referenceLabel).join('')).toBe(source);
    const slugLine = page.texts.indexOf(source);
    expect(page.texts.slice(0, slugLine).join('')).toBe(source);
  });

  it('does not paint the fork count as the source count when source metadata is unavailable', () => {
    const repo = reference('unknown-source');
    delete repo.github!.upstream;
    const [, cover, page] = captureBook(repo);
    expect(cover.texts).toContain('GITHUB STARS UNAVAILABLE');
    expect(page.texts.join(' ')).toContain('stars unavailable');
    expect(page.texts.join(' ')).not.toContain('17 stars');
  });

  it('keeps original / adapted titles and their own star counts', () => {
    const repo = reference('adapted-source');
    repo.catalog!.kind = 'authored-fork';
    repo.catalog!.commitsAhead = 4;
    const [spine, cover, page] = captureBook(repo);
    expect(spine.texts).toContain('Renamed Fork');
    expect(cover.texts).toContain('Renamed Fork');
    expect(cover.texts).toContain('★ 17 GITHUB STARS');
    expect(page.texts.join(' ')).toContain('17 stars');
    expect(page.texts).toContain('Ivan/renamed-fork');
  });

  it('uses authored commits for attribution when the fork contains other contributors’ commits', () => {
    const repo = reference('authored-source');
    repo.catalog!.kind = 'authored-fork';
    repo.catalog!.commitsAhead = 12;
    repo.catalog!.authoredCommitsAhead = 2;
    const [, , page] = captureBook(repo);
    expect(page.texts).toContain("2 authored commits in Ivan's fork");
    expect(page.texts.join(' ')).not.toContain('12 commits');
  });

  it('keeps an unavailable authorship result distinct from the raw ahead count', () => {
    const repo = reference('unverified-authorship-source');
    repo.catalog!.kind = 'unverified-fork';
    repo.catalog!.commitsAhead = 10;
    repo.catalog!.authoredCommitsAhead = null;
    const [, , page] = captureBook(repo);
    expect(page.texts).toContain('Authorship could not be verified');
    expect(page.texts.join(' ')).not.toContain('10 authored commits');
    expect(page.texts.join(' ')).not.toContain('no common ancestor');
  });

  it('invalidates atlas and detail cache keys when the source name or source star count changes', () => {
    const repo = reference('cache-source');
    const atlas = new SpineAtlas();
    const initial = visualKey(repo, 90);
    const atlasKey = atlas.keyFor(repo, 36, 200, 90);
    repo.github!.upstream!.stars = 10000;
    expect(visualKey(repo, 90)).not.toBe(initial);
    expect(atlas.keyFor(repo, 36, 200, 90)).not.toBe(atlasKey);
    const popularityKey = visualKey(repo, 90);
    repo.catalog!.upstream = 'AnotherOrg/SDK';
    repo.github!.upstream!.fullName = 'AnotherOrg/SDK';
    expect(visualKey(repo, 90)).not.toBe(popularityKey);
    const knownKey = visualKey(repo, 90);
    delete repo.github!.upstream;
    expect(visualKey(repo, 90)).not.toBe(knownKey);
    const unknownKey = visualKey(repo, 90);
    repo.github!.upstream = { fullName: 'AnotherOrg/SDK', stars: 0, fetchedAt: '' };
    expect(visualKey(repo, 90)).not.toBe(unknownKey);
    atlas.dispose();
  });
});
