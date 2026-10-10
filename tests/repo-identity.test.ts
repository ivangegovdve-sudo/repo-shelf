import { describe, expect, it } from 'vitest';
import { compareOnShelf, hasGoldBand, repoTitleOf } from '../src/derive';
import { primaryRepoName, primaryRepoSlug, referenceUpstream } from '../src/repoIdentity';
import { starCountOf, starsOf, starThresholds } from '../src/repoFilters';
import type { Repo } from '../src/types';

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 'collector/copy-renamed', name: 'copy-renamed', path: '', shelfId: 'engineering',
    virtual: true, linkUrl: 'https://github.com/collector/copy-renamed', visibility: 'public',
    archived: false, createdAt: null, doc: null, summary: 'An upstream project.',
    branch: null, lastCommitAt: '2026-10-01T00:00:00Z', commitCount: 0, dirtyCount: 0,
    sizeKB: 100, languageGuess: 'TypeScript', remoteUrl: null, owner: 'collector',
    repoSlug: 'collector/copy-renamed',
    github: {
      description: 'An upstream project.', language: 'TypeScript', stars: 9_000,
      topics: ['tools'], isPrivate: false, isFork: true, pushedAt: '2026-10-01T00:00:00Z',
      htmlUrl: 'https://github.com/collector/copy-renamed', fetchedAt: '2026-10-10T00:00:00Z',
      upstream: { fullName: 'RealOwner/Original_API.v2', stars: 300, fetchedAt: '2026-10-10T00:00:00Z' },
    },
    catalog: {
      kind: 'reference-copy', upstream: 'RealOwner/Original_API.v2', commitsAhead: 0,
      repoUrl: 'https://github.com/collector/copy-renamed', subCategory: 'developer-tools',
      cardStale: false, verificationStatus: 'verified', confidence: 'high',
      cardGeneratedAt: '2026-10-10T00:00:00Z', alive: true,
    },
    ...over,
  };
}

describe('primary repository identity', () => {
  it('uses exact upstream owner/repo for unchanged reference titles while preserving stored fork identity', () => {
    const r = repo();
    expect(referenceUpstream(r)).toBe('RealOwner/Original_API.v2');
    expect(primaryRepoSlug(r)).toBe('RealOwner/Original_API.v2');
    expect(primaryRepoName(r)).toBe('Original_API.v2');
    expect(repoTitleOf(r)).toBe('RealOwner/Original_API.v2');
    expect(r.name).toBe('copy-renamed');
    expect(r.id).toBe('collector/copy-renamed');
    expect(r.repoSlug).toBe('collector/copy-renamed');
  });

  it('keeps original, adapted and unverified books under their own identity and star count', () => {
    const base = repo();
    for (const kind of ['original', 'authored-fork', 'unverified-fork'] as const) {
      const r = { ...base, catalog: { ...base.catalog!, kind } };
      expect(referenceUpstream(r)).toBeNull();
      expect(primaryRepoSlug(r)).toBe('collector/copy-renamed');
      expect(primaryRepoName(r)).toBe('copy-renamed');
      expect(repoTitleOf(r)).toBe('Copy Renamed');
      expect(starCountOf(r)).toBe(9_000);
    }
    expect(repoTitleOf({ ...base, catalog: undefined })).toBe('Copy Renamed');
  });

  it('requires a confirmed unchanged copy and a valid canonical source slug', () => {
    const base = repo();
    for (const commitsAhead of [null, 1]) {
      const r = { ...base, catalog: { ...base.catalog!, commitsAhead } };
      expect(referenceUpstream(r)).toBeNull();
      expect(repoTitleOf(r)).toBe('Copy Renamed');
    }
    for (const upstream of [null, '', 'https://github.com/source/repo', 'source/repo/tree/main', ' source/repo ', '/source/repo', 'source/<script>', 'source/..', 'owner_/repo', 'owner-/repo']) {
      const r = { ...base, catalog: { ...base.catalog!, upstream } };
      expect(referenceUpstream(r)).toBeNull();
      expect(primaryRepoSlug(r)).toBe('collector/copy-renamed');
    }
  });

  it('uses verified collector authorship when other authors contributed ahead of the source', () => {
    const base = repo();
    const noCollectorChanges = { ...base, catalog: { ...base.catalog!, commitsAhead: 2, authoredCommitsAhead: 0 } };
    expect(referenceUpstream(noCollectorChanges)).toBe('RealOwner/Original_API.v2');
    expect(repoTitleOf(noCollectorChanges)).toBe('RealOwner/Original_API.v2');
    expect(starCountOf(noCollectorChanges)).toBe(300);
    const collectorChanges = { ...base, catalog: { ...base.catalog!, commitsAhead: 0, authoredCommitsAhead: 1 } };
    expect(referenceUpstream(collectorChanges)).toBeNull();
    expect(repoTitleOf(collectorChanges)).toBe('Copy Renamed');
    expect(starCountOf(collectorChanges)).toBe(9_000);
  });

  it('allows local books without a GitHub slug to keep their title', () => {
    const r = repo({ github: null, catalog: undefined, repoSlug: null, name: 'local-ui-tools' });
    expect(primaryRepoSlug(r)).toBeNull();
    expect(primaryRepoName(r)).toBe('local-ui-tools');
    expect(repoTitleOf(r)).toBe('Local UI Tools');
  });
});

describe('upstream popularity', () => {
  it('uses the actual upstream stars and accepts GitHub canonical casing', () => {
    const r = repo();
    expect(starCountOf(r)).toBe(300);
    expect(starsOf(r)).toBe(300);
    const renamedCase = { ...r, github: { ...r.github!, upstream: { ...r.github!.upstream!, fullName: 'realowner/original_api.v2' } } };
    expect(starCountOf(renamedCase)).toBe(300);
  });

  it('never substitutes fork stars when upstream metadata is absent, mismatched or malformed', () => {
    const r = repo();
    for (const upstream of [undefined, { ...r.github!.upstream!, fullName: 'different/project' }, { ...r.github!.upstream!, fullName: undefined } as never]) {
      const copy = { ...r, github: { ...r.github!, upstream } };
      expect(starCountOf(copy)).toBeNull();
      expect(starsOf(copy)).toBe(0);
      expect(hasGoldBand(copy)).toBe(false);
    }
    expect(starCountOf({ ...r, github: null })).toBeNull();
  });

  it('distinguishes known zero stars from unavailable counts and normalizes malformed counts safely', () => {
    const r = repo();
    const withStars = (stars: number) => ({ ...r, github: { ...r.github!, upstream: { ...r.github!.upstream!, stars } } });
    expect(starCountOf(withStars(0))).toBe(0);
    expect(starsOf(withStars(0))).toBe(0);
    for (const stars of [-4, NaN, Infinity]) expect(starCountOf(withStars(stars))).toBeNull();
    expect(starCountOf(withStars(2.9))).toBe(2);
    expect(hasGoldBand(withStars(1))).toBe(true);
  });

  it('sets slider tiers from source stars and retains every top source tie', () => {
    const base = repo();
    const withSource = (upstream: string, stars: number) => repo({
      id: upstream, catalog: { ...base.catalog!, upstream },
      github: { ...base.github!, stars: 50_000, upstream: { ...base.github!.upstream!, fullName: upstream, stars } },
    });
    const repos = [withSource('source/low', 3), withSource('source/top-a', 2_000), withSource('source/top-b', 2_000), repo({ github: { ...base.github!, upstream: undefined } })];
    expect(starThresholds(repos)).toEqual([0, 3, 2_000]);
    expect(repos.filter((r) => starsOf(r) >= 2_000).map((r) => r.id)).toEqual(['source/top-a', 'source/top-b']);
  });
});

describe('shelf order', () => {
  it('preserves authored edition priority and ranks references by upstream stars descending', () => {
    const base = repo();
    const original = repo({ id: 'original', name: 'z-original', catalog: { ...base.catalog!, kind: 'original' } });
    const adapted = repo({ id: 'adapted', name: 'adapted', catalog: { ...base.catalog!, kind: 'authored-fork' } });
    const low = repo({ id: 'low', name: 'a-fork', github: { ...base.github!, stars: 99_000, upstream: { ...base.github!.upstream!, stars: 4 } } });
    const high = repo({ id: 'high', name: 'z-fork', github: { ...base.github!, stars: 1, upstream: { ...base.github!.upstream!, stars: 300 } } });
    expect([low, high, adapted, original].sort(compareOnShelf).map((r) => r.id)).toEqual(['original', 'adapted', 'high', 'low']);
  });

  it('breaks equal source-star ties by source identity, independently of collector fork names', () => {
    const base = repo();
    const first = repo({ id: 'first', name: 'z-copy', catalog: { ...base.catalog!, upstream: 'alpha/project' }, github: { ...base.github!, upstream: { ...base.github!.upstream!, fullName: 'alpha/project' } } });
    const second = repo({ id: 'second', name: 'a-copy', catalog: { ...base.catalog!, upstream: 'zeta/project' }, github: { ...base.github!, upstream: { ...base.github!.upstream!, fullName: 'zeta/project' } } });
    expect([second, first].sort(compareOnShelf).map((r) => r.id)).toEqual(['first', 'second']);
  });
});
