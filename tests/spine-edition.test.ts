import { describe, expect, it } from 'vitest';
import type { Repo } from '../src/types';
import { EDITION_CLOTH, EDITION_INK, contrastRatio, hueOf, luminance, spineStyle } from '../src/scene/spineStyle';
import { WALL, spineSize, wallMetrics } from '../src/scene/wall';

type Kind = NonNullable<Repo['catalog']>['kind'];

function repo(name: string, kind: Kind): Repo {
  return {
    id: name, name, path: '', shelfId: 'agents-assistants', virtual: true, linkUrl: 'https://example.com',
    visibility: 'public', archived: false, createdAt: null, doc: null, summary: 'Purpose.',
    branch: null, lastCommitAt: '2026-09-01T00:00:00Z', commitCount: 0, dirtyCount: 0, sizeKB: 0,
    languageGuess: 'Python', remoteUrl: null, owner: 'ivan', repoSlug: `ivan/${name}`, github: null,
    catalog: {
      kind, upstream: kind === 'original' ? null : `upstream/${name}`, commitsAhead: kind === 'reference-copy' ? 0 : 4,
      repoUrl: `https://github.com/ivan/${name}`, cardStale: false, verificationStatus: 'verified', confidence: 'high',
      cardGeneratedAt: '2026-09-20T00:00:00Z', alive: true,
    },
  };
}

const names = Array.from({ length: 60 }, (_, i) => `repo-${i}-${'x'.repeat(i % 7)}`);
const styles = (kind: Kind) => names.map((n) => spineStyle(repo(n, kind), 90));

describe('edition is readable from the spine alone', () => {
  it('maps each attribution class to its own edition', () => {
    expect(new Set(styles('original').map((s) => s.edition))).toEqual(new Set(['original']));
    expect(new Set(styles('authored-fork').map((s) => s.edition))).toEqual(new Set(['adapted']));
    expect(new Set(styles('reference-copy').map((s) => s.edition))).toEqual(new Set(['reference']));
  });

  it('separates reference copies from Ivan’s work by luminance, the channel that survives at any size', () => {
    const pale = EDITION_CLOTH.reference.map(luminance);
    const dark = [...EDITION_CLOTH.original, ...EDITION_CLOTH.adapted].map(luminance);
    expect(Math.min(...pale)).toBeGreaterThan(0.6);
    expect(Math.max(...dark)).toBeLessThan(0.06);
    for (const a of EDITION_CLOTH.reference) for (const b of [...EDITION_CLOTH.original, ...EDITION_CLOTH.adapted]) expect(contrastRatio(a, b)).toBeGreaterThan(7);
  });

  it('separates originals from adapted forks by hue (red vs blue, safe for red-green colour blindness)', () => {
    for (const o of EDITION_CLOTH.original) {
      for (const a of EDITION_CLOTH.adapted) {
        const d = Math.abs(hueOf(o) - hueOf(a));
        expect(Math.min(d, 360 - d)).toBeGreaterThan(90);
      }
    }
  });

  it('letters every edition legibly against its own cloth (WCAG AA, 4.5:1)', () => {
    for (const kind of ['original', 'adapted', 'reference'] as const) {
      for (const cloth of EDITION_CLOTH[kind]) expect(contrastRatio(EDITION_INK[kind], cloth)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives each edition its own head and foot marks', () => {
    const marks = (kind: Kind) => new Set(styles(kind).map((s) => `${s.head}/${s.foot}`));
    const o = [...marks('original')];
    const a = [...marks('authored-fork')];
    const r = [...marks('reference-copy')];
    expect([o.length, a.length, r.length]).toEqual([1, 1, 1]);
    expect(new Set([o[0], a[0], r[0]]).size).toBe(3);
    expect(r[0]).toContain('call-number');
  });

  it('makes authored editions physically larger than reference copies on the wall', () => {
    const m = wallMetrics(960);
    const size = (kind: Kind) => names.map((n) => spineSize(repo(n, kind), m));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const [o, a, r] = [size('original'), size('authored-fork'), size('reference-copy')];
    expect(Math.min(...o.map((s) => s.w))).toBeGreaterThan(Math.max(...r.map((s) => s.w)));
    expect(avg(o.map((s) => s.w))).toBeGreaterThan(avg(a.map((s) => s.w)));
    expect(avg(a.map((s) => s.w))).toBeGreaterThan(avg(r.map((s) => s.w)));
    expect(avg(o.map((s) => s.h))).toBeGreaterThan(avg(r.map((s) => s.h)));
    expect(Math.min(...r.map((s) => s.w))).toBeGreaterThanOrEqual(WALL.MIN_SPINE);
  });
});
