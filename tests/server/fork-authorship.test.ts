import { describe, expect, it, vi } from 'vitest';
import { classifyForkAuthorship, fetchCompleteComparison, type ComparedCommit, type ForkComparison, type GitHubRequest } from '../../scripts/verify-fork-authorship';
import { catalogToState, type CatalogDocument } from '../../server/catalog';

const COLLECTOR = 'collector';
function commit(sha: string, author: string | null, merge = false, committer = author): ComparedCommit {
  return {
    sha, author: author ? { login: author } : null, committer: committer ? { login: committer } : null,
    parents: merge ? [{ sha: 'parent-1' }, { sha: 'parent-2' }] : [{ sha: 'parent-1' }],
  };
}
function comparison(commits: ComparedCommit[], over: Partial<ForkComparison> = {}): ForkComparison {
  return { ahead_by: commits.length, commits, files: [{ filename: 'README.md' }], ...over };
}

describe('fork authorship', () => {
  it('does not mistake upstream divergence for changes authored by the collecting account', () => {
    const result = classifyForkAuthorship(comparison([
      commit('fix', 'upstream-author'), commit('merge', 'upstream-author', true),
    ]), COLLECTOR);
    expect(result).toEqual({ kind: 'reference-copy', commitsAhead: 2, authoredCommitsAhead: 0 });
  });

  it('counts actual collector-authored non-merge changes, independently of raw ahead counts', () => {
    const result = classifyForkAuthorship(comparison([
      commit('own', 'COLLECTOR'), commit('upstream', 'upstream-author'), commit('sync', COLLECTOR, true),
    ]), COLLECTOR);
    expect(result).toEqual({ kind: 'authored-fork', commitsAhead: 3, authoredCommitsAhead: 1 });
  });

  it('preserves upstream authorship when the collector merely commits another author’s change', () => {
    const result = classifyForkAuthorship(comparison([commit('upstream', 'upstream-author', false, COLLECTOR)]), COLLECTOR);
    expect(result.kind).toBe('reference-copy');
    expect(result.authoredCommitsAhead).toBe(0);
  });

  it('keeps unresolved authors unverified even when a committer is known', () => {
    const result = classifyForkAuthorship(comparison([commit('unknown', null, false, COLLECTOR)]), COLLECTOR);
    expect(result).toEqual({ kind: 'unverified-fork', commitsAhead: 1, authoredCommitsAhead: null });
  });

  it('does not claim merge-only changes have no collector contribution', () => {
    expect(classifyForkAuthorship(comparison([commit('merge', COLLECTOR, true)]), COLLECTOR).kind).toBe('unverified-fork');
    expect(classifyForkAuthorship(comparison([commit('merge', null, true)]), COLLECTOR).kind).toBe('unverified-fork');
  });

  it('recognizes a complete empty diff as no effective changes, including reverted own history', () => {
    expect(classifyForkAuthorship(comparison([commit('own', COLLECTOR)], { files: [] }), COLLECTOR))
      .toEqual({ kind: 'reference-copy', commitsAhead: 1, authoredCommitsAhead: 0 });
  });

  it('never concludes that authors are absent from a truncated or duplicate comparison', () => {
    expect(classifyForkAuthorship(comparison([commit('first', 'upstream-author')], { ahead_by: 2 }), COLLECTOR).kind).toBe('unverified-fork');
    expect(classifyForkAuthorship(comparison([commit('duplicate', 'upstream-author'), commit('duplicate', 'upstream-author')]), COLLECTOR).kind).toBe('unverified-fork');
  });

  it('paginates the entire comparison, including a collector contribution after the first page', async () => {
    const first = Array.from({ length: 100 }, (_, index) => commit(`upstream-${index}`, 'upstream-author'));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(comparison(first, { ahead_by: 101 }))
      .mockResolvedValueOnce(comparison([commit('own-last', COLLECTOR)], { ahead_by: 101, files: undefined }));
    const result = await fetchCompleteComparison('repos/upstream/project/compare/base...collector:main', fetcher as GitHubRequest);
    expect(result.commits).toHaveLength(101);
    expect(result.files).toEqual([{ filename: 'README.md' }]);
    expect(classifyForkAuthorship(result, COLLECTOR).authoredCommitsAhead).toBe(1);
    expect(fetcher.mock.calls[1][0]).toContain('per_page=100&page=2');
  });

  it('leaves a comparison unverified when later pages cannot complete it', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(comparison([commit('first', 'upstream-author')], { ahead_by: 2 }))
      .mockResolvedValueOnce(comparison([], { ahead_by: 2, files: undefined }));
    expect(classifyForkAuthorship(await fetchCompleteComparison('public-comparison', fetcher as GitHubRequest), COLLECTOR).kind).toBe('unverified-fork');
  });

  it('retains both raw divergence and verified authorship when mapping catalogs to books', () => {
    const catalog: CatalogDocument = {
      schema_version: 1, generated_at: '2026-10-10T00:00:00Z', source: 'public comparison', repo_count: 2,
      repos: [0, null].map((authored, index) => ({
        name: `fork-${index}`, full_name: `collector/fork-${index}`, fork: true, upstream: `upstream/fork-${index}`,
        commits_ahead: 2, authored_commits_ahead: authored, last_push: '2026-10-01T00:00:00Z', language: 'TypeScript',
        topics: [], summary: 'A public project', card_path: '', card_generated_at: '2026-10-01T00:00:00Z', stale: false,
        confidence: 'high', verification_status: 'verified', topics_source: 'public',
      })),
    };
    const books = catalogToState(catalog).repos;
    expect(books[0].catalog).toMatchObject({ kind: 'reference-copy', commitsAhead: 2, authoredCommitsAhead: 0 });
    expect(books[1].catalog).toMatchObject({ kind: 'unverified-fork', commitsAhead: 2, authoredCommitsAhead: null });
  });
});
