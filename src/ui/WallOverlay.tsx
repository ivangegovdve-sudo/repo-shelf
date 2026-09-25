import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShelf } from '../store';
import { displayName, editionOf, languageOf, relativeTime } from '../derive';
import { useWall, wallView } from '../scene/wallStore';
import type { Repo } from '../types';

/** What a fork is, in one line, naming the upstream whenever there is one. */
export function editionLine(repo: Repo): { label: string; upstream: string | null; note: string | null } {
  const c = repo.catalog;
  switch (editionOf(repo)) {
    case 'original':
      return { label: 'Ivan’s original', upstream: null, note: null };
    case 'adapted':
      return { label: 'Adapted fork', upstream: c!.upstream, note: `${c!.commitsAhead} ${c!.commitsAhead === 1 ? 'commit' : 'commits'} of Ivan’s on top` };
    case 'reference':
      return { label: 'Reference copy', upstream: c!.upstream, note: 'Not Ivan’s work: zero commits of his own' };
    default:
      return {
        label: repo.doc ? 'Guide' : repo.virtual ? (repo.repoSlug ? 'On GitHub' : 'Link') : languageOf(repo),
        upstream: null,
        note: repo.virtual ? null : `${repo.commitCount} commits${repo.dirtyCount ? ` · ${repo.dirtyCount} uncommitted` : ''}`,
      };
  }
}

function purposeOf(repo: Repo): string {
  const text = (repo.summary ?? repo.github?.description ?? '').replace(/\s+/g, ' ').trim();
  const first = text.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? text;
  return first.length > 150 ? `${first.slice(0, 147).trimEnd()}…` : first;
}

function statusOf(repo: Repo): { alive: boolean; text: string } {
  const pushed = relativeTime(repo.lastCommitAt);
  if (repo.catalog) return { alive: repo.catalog.alive, text: `${repo.catalog.alive ? 'Alive' : 'Dormant'} · pushed ${pushed}` };
  return { alive: repo.lastCommitAt !== null, text: repo.lastCommitAt ? `Last commit ${pushed}` : 'No commits yet' };
}

export function announce(repo: Repo, shelfLabel: string | undefined): string {
  const e = editionLine(repo);
  return `${displayName(repo.name)}. ${e.label}${e.upstream ? ` of ${e.upstream}` : ''}. ${shelfLabel ?? ''}. ${statusOf(repo).text}. Press Enter to open.`;
}

/** Put the tooltip above its spine (below when there is no room), clear of the book window. */
function placeTip(node: HTMLDivElement | null): void {
  const tip = wallView.tip;
  if (!node || !tip || node.hidden) return;
  const { size, occludeRight } = useWall.getState();
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const cx = tip.rect.left + tip.rect.width / 2;
  const x = Math.min(size.width - occludeRight - w / 2 - 10, Math.max(w / 2 + 10, cx));
  const above = tip.rect.top - h - 14 > 8;
  const y = above ? tip.rect.top - h - 14 : tip.rect.top + tip.rect.height + 14;
  node.style.transform = `translate3d(${Math.round(x - w / 2)}px, ${Math.round(y)}px, 0)`;
  node.dataset.side = above ? 'above' : 'below';
  node.style.setProperty('--arrow-x', `${Math.round(Math.min(w - 16, Math.max(16, cx - (x - w / 2))))}px`);
}

function SpineTip() {
  const el = useRef<HTMLDivElement>(null);
  const [id, setId] = useState<string | null>(null);
  const repo = useShelf((s) => (id ? (s.repos.find((r) => r.id === id) ?? null) : null));

  useEffect(
    () =>
      wallView.subscribe(() => {
        setId(wallView.tip?.id ?? null);
        placeTip(el.current);
      }),
    [],
  );
  // New content has a new size: place it again as soon as it is laid out.
  useLayoutEffect(() => placeTip(el.current), [repo]);

  if (!repo) return <div ref={el} className="spine-tip" hidden />;
  const edition = editionOf(repo);
  const line = editionLine(repo);
  const status = statusOf(repo);
  const purpose = purposeOf(repo);
  return (
    <div ref={el} className={`spine-tip ed-${edition}`} role="tooltip">
      <div className="tip-edition">
        {edition !== 'plain' && <i className={`ed-swatch ed-${edition}`} aria-hidden="true" />}
        <span>{line.label}</span>
        {repo.catalog?.cardStale && <span className="tip-flag">stale card</span>}
        {repo.catalog?.verificationStatus === 'unverified' && <span className="tip-flag">unverified</span>}
      </div>
      <strong className="tip-title">{displayName(repo.name)}</strong>
      {line.upstream && (
        <div className="tip-upstream">
          {edition === 'reference' ? 'Copy of ' : 'Forked from '}
          <b>{line.upstream}</b>
        </div>
      )}
      {purpose && <p className="tip-purpose">{purpose}</p>}
      <div className="tip-foot">
        <span className={`tip-status ${status.alive ? 'alive' : 'dormant'}`}>
          <i aria-hidden="true" />
          {status.text}
        </span>
        {line.note && <span className="tip-note">{line.note}</span>}
      </div>
    </div>
  );
}

function FocusRing() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      wallView.subscribe(() => {
        const node = el.current;
        if (!node) return;
        const r = wallView.ring;
        node.hidden = !r;
        if (!r) return;
        node.style.transform = `translate3d(${Math.round(r.left - 4)}px, ${Math.round(r.top - 4)}px, 0)`;
        node.style.width = `${Math.round(r.width + 8)}px`;
        node.style.height = `${Math.round(r.height + 8)}px`;
      }),
    [],
  );
  return <div ref={el} className="spine-ring" hidden aria-hidden="true" />;
}

function Plates() {
  const layout = useWall((s) => s.layout);
  const overShelfId = useShelf((s) => s.drag?.overShelfId ?? null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(
    () =>
      wallView.subscribe(() => {
        wallView.plates.forEach((x, i) => {
          const node = refs.current[i];
          if (!node) return;
          if (x === null) {
            node.style.visibility = 'hidden';
            return;
          }
          node.style.visibility = 'visible';
          node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(wallView.plateY)}px, 0) translate(-50%, -50%) scale(${Math.min(1, Math.max(0.72, wallView.zoom))})`;
        });
      }),
    [],
  );
  if (!layout) return null;
  return (
    <div className="plates" aria-hidden="true">
      {layout.bays.map((bay, i) => {
        const n = bay.end - bay.first;
        const kind = bay.shelf.kind;
        return (
          <div key={bay.shelf.id} ref={(node) => void (refs.current[i] = node)} className={`plate ${overShelfId === bay.shelf.id ? 'plate-active' : ''}`}>
            <span className="plate-label">{bay.shelf.label}</span>
            <span className="plate-count">
              {kind === 'github' && n === 0 ? 'sign in with gh auth login' : `${n} ${n === 1 ? (kind === 'links' ? 'link' : 'repo') : kind === 'links' ? 'links' : 'repos'}`}
            </span>
            {(bay.counts.original > 0 || bay.counts.adapted > 0) && (
              <span className="plate-eds" title="Ivan's originals and adapted forks in this bay">
                {bay.counts.original > 0 && (
                  <>
                    <i className="ed-dot ed-original" />
                    {bay.counts.original}
                  </>
                )}
                {bay.counts.adapted > 0 && (
                  <>
                    <i className="ed-dot ed-adapted" />
                    {bay.counts.adapted}
                  </>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LiveFocus() {
  const focused = useShelf((s) => (s.focusedRepoId ? (s.repos.find((r) => r.id === s.focusedRepoId) ?? null) : null));
  const shelves = useShelf((s) => s.shelves);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!focused || !wallView.keyboard) return;
    setText(announce(focused, shelves.find((s) => s.id === focused.shelfId)?.label));
  }, [focused, shelves]);
  return (
    <div className="sr-only" aria-live="polite">
      {text}
    </div>
  );
}

export function WallOverlay() {
  return (
    <div className="wall-overlay">
      <Plates />
      <FocusRing />
      <SpineTip />
      <LiveFocus />
    </div>
  );
}
