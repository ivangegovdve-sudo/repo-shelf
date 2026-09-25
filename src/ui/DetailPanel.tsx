import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useShelf, selectVisibleRepos } from '../store';
import { api } from '../api';
import { bookColor, displayName, editionOf, formatSize, isStale, languageOf, relativeTime } from '../derive';
import { BookPages, DocPages, type Chapter } from './BookPages';
import { BookViewer } from './BookViewer';
import { useWall } from '../scene/wallStore';
import type { OpenTarget, Repo } from '../types';

function docSourceHref(doc: string): string {
  const m = doc.match(/^([\w.-]+\/[\w.-]+):(.+)$/);
  return m ? `https://github.com/${m[1]}/blob/HEAD/${m[2]}` : doc;
}

/** "getting-started · quickstart" from the guide's website URL. */
function docPathLabel(repo: { linkUrl: string | null; name: string }): string {
  const m = repo.linkUrl?.match(/\/docs\/(.+?)\/?$/);
  return m ? m[1].split('/').join(' · ') : repo.name;
}

function dateOf(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'unknown';
}

/** Who wrote this: shown before anything else a fork says about itself. */
function Attribution({ repo }: { repo: Repo }) {
  const c = repo.catalog;
  if (!c) return null;
  if (c.kind === 'original') {
    return (
      <div className="attribution original">
        <strong>Ivan’s original</strong>
        <small>Not a fork. Written from scratch by Ivan.</small>
      </div>
    );
  }
  const upstreamUrl = `https://github.com/${c.upstream}`;
  return (
    <div className={`attribution ${c.kind}`}>
      <strong>{c.kind === 'reference-copy' ? 'Reference copy of upstream work' : 'Adapted from upstream'}</strong>
      <a href={upstreamUrl} target="_blank" rel="noopener" className="attribution-upstream">
        {c.upstream} ↗
      </a>
      <small>
        {c.kind === 'reference-copy'
          ? 'Zero commits of Ivan’s own. Shelved as a reference; the authorship belongs upstream.'
          : `Ivan’s fork carries ${c.commitsAhead} ${c.commitsAhead === 1 ? 'commit' : 'commits'} of his own on top; the original work belongs upstream.`}
      </small>
    </div>
  );
}

export function DetailPanel() {
  const repo = useShelf((s) => s.repos.find((r) => r.id === s.selectedRepoId) ?? null);
  const shelves = useShelf((s) => s.shelves);
  const staleDays = useShelf((s) => s.staleAfterDays);
  const select = useShelf((s) => s.select);
  const openDialog = useShelf((s) => s.openDialog);
  const toast = useShelf((s) => s.toast);
  const visible = useShelf(useShallow(selectVisibleRepos));
  const githubLogin = useShelf((s) => s.githubLogin);
  const readOnly = useShelf((s) => s.readOnly);
  const hasPages = useShelf((s) => (repo ? Boolean(s.pages[repo.id]) : false));
  const [chapter, setChapter] = useState<Chapter>('readme');
  const [coverOpen, setCoverOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const isOpen = repo !== null;

  // The window covers the right of the wall: tell the wall, so the open spine is kept in the uncovered part.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!isOpen || !el) return;
    const measure = () => {
      const wrap = el.parentElement?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      useWall.getState().setOccludeRight(wrap && r.width < wrap.width * 0.9 ? wrap.right - r.left : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      useWall.getState().setOccludeRight(0);
    };
  }, [isOpen]);

  useEffect(() => setCoverOpen(false), [repo?.id]);

  if (!repo) return null;

  const idx = visible.findIndex((r) => r.id === repo.id);
  const step = (d: number) => {
    if (!visible.length) return;
    select(visible[(idx + d + visible.length) % visible.length].id);
  };

  const shelfIndex = shelves.findIndex((s) => s.id === repo.shelfId);
  const diskShelves = shelves.filter((s) => s.kind === 'disk');
  const explorerLabel = /Mac|iPhone/.test(navigator.platform) ? 'Finder' : /Win/.test(navigator.platform) ? 'Explorer' : 'Files';
  const shelf = shelves[shelfIndex];
  const lang = languageOf(repo);
  const stale = isStale(repo, staleDays);
  const edition = editionOf(repo);
  const c = repo.catalog;
  // A published catalog carries no README pages; do not open an empty chapter book there.
  const showPages = !c || !readOnly || hasPages;

  const ownsIt = Boolean(!c && repo.owner && githubLogin && repo.owner.toLowerCase() === githubLogin.toLowerCase());
  const archive = (archived: boolean) => {
    void useShelf
      .getState()
      .runAction(archived ? `Archived ${repo.name}` : `Unarchived ${repo.name}`, () => api.setArchived(repo.id, archived))
      .catch(() => undefined);
  };
  const open = (target: OpenTarget) => {
    api.open(repo.id, target).catch((e: Error) => toast('error', e.message));
  };
  const copyPath = () => {
    navigator.clipboard?.writeText(repo.virtual ? (repo.linkUrl ?? '') : repo.path).then(
      () => toast('info', repo.virtual ? 'Link copied' : 'Path copied'),
      () => toast('error', 'Could not copy'),
    );
  };

  return (
    <aside ref={panel} className={`panel book-window ed-${edition}`} role="dialog" aria-modal="false" aria-label={`${displayName(repo.name)} details`}>
      <header className="bw-bar">
        <div className="panel-eyebrow">
          SHELF {String(shelfIndex + 1).padStart(2, '0')} · {shelf?.label}
        </div>
        <div className="bw-nav">
          <span className="bw-count">
            {idx >= 0 ? idx + 1 : '–'} / {visible.length}
          </span>
          <button className="nav" onClick={() => step(-1)} aria-label="Previous repo" title="Previous book">
            ←
          </button>
          <button className="nav" onClick={() => step(1)} aria-label="Next repo" title="Next book">
            →
          </button>
          <button className="panel-close" onClick={() => select(null)} aria-label="Close" title="Close  (Esc)">
            ×
          </button>
        </div>
      </header>

      <div className="bw-scroll">
        <section className={`bw-hero ${coverOpen ? 'cover-open' : ''}`} key={repo.id}>
          <div className="bw-book">
            <BookViewer repo={repo} staleDays={staleDays} open={coverOpen} onToggle={() => setCoverOpen((o) => !o)} />
            <span className="bw-book-hint">{coverOpen ? 'Click to close the cover' : 'Click the book to open it'}</span>
          </div>
          <div className="bw-id">
            {edition !== 'plain' && (
              <div className={`bw-edition ed-${edition}`}>
                <i className={`ed-swatch ed-${edition}`} aria-hidden="true" />
                {edition === 'original' ? 'Original' : edition === 'adapted' ? 'Adapted fork' : 'Reference copy'}
              </div>
            )}
            <h2 className="panel-title">{displayName(repo.name)}</h2>
            <div className="panel-slug">{repo.doc ? docPathLabel(repo) : (repo.repoSlug ?? repo.name)}</div>
            <Attribution repo={repo} />
            <p className="panel-desc">
              {repo.github?.description ??
                repo.summary ??
                (repo.virtual
                  ? 'Not on your disk yet. Open it, or clone it onto one of your shelves.'
                  : repo.repoSlug
                    ? 'No description on GitHub.'
                    : 'Local repo, no GitHub remote.')}
            </p>
          </div>
        </section>

        <div className="tags">
          {!repo.doc && (
            <span className="tag" style={{ background: bookColor(lang) }}>
              {lang}
            </span>
          )}
          {c && <span className={`tag ${c.alive ? 'tag-alive' : 'tag-muted'}`}>{c.alive ? 'Alive' : 'Dormant'}</span>}
          {c?.cardStale && <span className="tag tag-red">Stale card</span>}
          {c?.verificationStatus === 'unverified' && <span className="tag tag-red">Unverified card</span>}
          {!c && repo.virtual && <span className="tag tag-muted">{repo.doc ? 'Guide' : repo.repoSlug ? 'On GitHub' : 'Link'}</span>}
          {!c && repo.visibility === 'private' && <span className="tag tag-muted">🔒 Private</span>}
          {!c && repo.visibility === 'public' && <span className="tag tag-muted">Public</span>}
          {repo.archived && <span className="tag tag-muted">Archived</span>}
          {!c && repo.github?.isFork && <span className="tag tag-muted">Fork</span>}
          {repo.dirtyCount > 0 && <span className="tag tag-red">{repo.dirtyCount} uncommitted</span>}
          {!repo.virtual && stale && <span className="tag tag-muted">Stale</span>}
          {repo.error && <span className="tag tag-red">git error</span>}
        </div>

        {c ? (
          <dl className="facts">
            <div>
              <dt>Language</dt>
              <dd>{lang}</dd>
            </div>
            <div>
              <dt>Last push</dt>
              <dd title={repo.lastCommitAt ?? ''}>
                {relativeTime(repo.lastCommitAt)} · {dateOf(repo.lastCommitAt)}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{c.alive ? 'Alive, pushed within a year' : 'Dormant for over a year'}</dd>
            </div>
            <div>
              <dt>Ivan’s commits</dt>
              <dd>{c.kind === 'original' ? 'All of them' : c.commitsAhead}</dd>
            </div>
            {c.upstream && (
              <div className="span2">
                <dt>Upstream</dt>
                <dd>{c.upstream}</dd>
              </div>
            )}
            <div>
              <dt>Capability card</dt>
              <dd>
                {c.cardStale ? 'Stale' : 'Current'} · {c.verificationStatus}
              </dd>
            </div>
            <div>
              <dt>Card written</dt>
              <dd>{dateOf(c.cardGeneratedAt)}</dd>
            </div>
            <div className="span2">
              <dt>Topics</dt>
              <dd>{repo.github?.topics.length ? repo.github.topics.join(', ') : '—'}</dd>
            </div>
          </dl>
        ) : repo.doc ? (
          <dl className="facts">
            <div className="span2">
              <dt>From</dt>
              <dd>Hermes Agent documentation</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>Guide, page by page</dd>
            </div>
          </dl>
        ) : repo.virtual ? (
          <dl className="facts">
            <div>
              <dt>Stars</dt>
              <dd>{repo.github ? repo.github.stars.toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt>Last push</dt>
              <dd title={repo.github?.pushedAt ?? ''}>{repo.github ? relativeTime(repo.github.pushedAt) : '—'}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{repo.owner ?? '—'}</dd>
            </div>
            <div className="span2">
              <dt>Topics</dt>
              <dd>{repo.github?.topics.length ? repo.github.topics.join(', ') : '—'}</dd>
            </div>
          </dl>
        ) : (
          <dl className="facts">
            <div>
              <dt>Branch</dt>
              <dd>{repo.branch ?? '—'}</dd>
            </div>
            <div>
              <dt>Last commit</dt>
              <dd title={repo.lastCommitAt ?? ''}>{relativeTime(repo.lastCommitAt)}</dd>
            </div>
            <div>
              <dt>Commits</dt>
              <dd>{repo.commitCount}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatSize(repo.sizeKB)}</dd>
            </div>
            <div>
              <dt>Stars</dt>
              <dd>{repo.github ? repo.github.stars.toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt>Topics</dt>
              <dd>{repo.github?.topics.length ? repo.github.topics.join(', ') : '—'}</dd>
            </div>
          </dl>
        )}

        {c ? (
          <div className="btn-row">
            <a className="btn primary" href={repo.linkUrl ?? c.repoUrl} target="_blank" rel="noopener">
              {c.upstream ? 'View upstream source ↗' : 'View on GitHub ↗'}
            </a>
            {c.upstream && (
              <a className="btn" href={c.repoUrl} target="_blank" rel="noopener">
                View Ivan’s fork ↗
              </a>
            )}
            {!readOnly && repo.remoteUrl && (
              <button className="btn" onClick={() => openDialog({ kind: 'clone', repoId: repo.id })} disabled={!diskShelves.length}>
                Clone Ivan’s copy…
              </button>
            )}
          </div>
        ) : readOnly ? (
          <div className="btn-row">
            {(repo.linkUrl || repo.repoSlug) && (
              <a className="btn primary" href={repo.linkUrl ?? `https://github.com/${repo.repoSlug}`} target="_blank" rel="noopener">
                {repo.repoSlug ? 'View on GitHub ↗' : 'Open link ↗'}
              </a>
            )}
          </div>
        ) : repo.virtual ? (
          <div className="btn-row">
            <button className="btn primary" onClick={() => open('github')}>
              {repo.doc ? 'Read on the website ↗' : repo.repoSlug ? 'View on GitHub ↗' : 'Open link ↗'}
            </button>
            {repo.doc && (
              <a className="btn" href={docSourceHref(repo.doc)} target="_blank" rel="noopener">
                Source ↗
              </a>
            )}
            {repo.remoteUrl && (
              <button className="btn" onClick={() => openDialog({ kind: 'clone', repoId: repo.id })} disabled={!diskShelves.length}>
                Clone to a shelf…
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="btn-row">
              <button className="btn primary" onClick={() => open('code')}>
                Open in VS Code
              </button>
              <button className="btn" onClick={() => open('terminal')}>
                Terminal
              </button>
              <button className="btn" onClick={() => open('explorer')}>
                {explorerLabel}
              </button>
              {(repo.github?.htmlUrl || repo.repoSlug) && (
                <button className="btn" onClick={() => open('github')}>
                  View on GitHub ↗
                </button>
              )}
            </div>
            <div className="btn-row secondary">
              <button className="link" onClick={() => openDialog({ kind: 'move', repoId: repo.id })} disabled={diskShelves.length < 2}>
                Move…
              </button>
              <button className="link" onClick={() => openDialog({ kind: 'rename', repoId: repo.id })}>
                Rename…
              </button>
              <button className="link" onClick={() => openDialog({ kind: 'mkdir', repoId: repo.id })}>
                New folder…
              </button>
            </div>
          </>
        )}

        {!c && (
          <button className="path" onClick={copyPath} title="Click to copy">
            {repo.virtual ? repo.linkUrl : repo.path}
          </button>
        )}

        {!readOnly && !c && repo.virtual && repo.repoSlug && (
          <div className="gh-manage">
            <div className="lbl">Manage on GitHub</div>
            {ownsIt ? (
              <div className="btn-row">
                <button className="btn" onClick={() => openDialog({ kind: 'visibility', repoId: repo.id, visibility: repo.visibility === 'private' ? 'public' : 'private' })}>
                  {repo.visibility === 'private' ? 'Make public…' : 'Make private…'}
                </button>
                <button className="btn" onClick={() => archive(!repo.archived)}>
                  {repo.archived ? 'Unarchive' : 'Archive'}
                </button>
                <button className="btn danger-outline" onClick={() => openDialog({ kind: 'delete', repoId: repo.id })}>
                  Delete…
                </button>
              </div>
            ) : (
              <p className="modal-note">Owned by {repo.owner}. Only your own repos can be changed from here.</p>
            )}
          </div>
        )}

        {showPages && (repo.doc ? <DocPages key={repo.id} repo={repo} /> : <BookPages key={repo.id} repo={repo} chapter={chapter} onChapter={setChapter} />)}
      </div>
    </aside>
  );
}
