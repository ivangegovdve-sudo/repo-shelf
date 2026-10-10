import { create } from 'zustand';
import type { AppState, Repo, RepoPages, Shelf } from './types';
import { api, ApiError, subscribeEvents } from './api';
import { compareOnShelf, matches, type Filter } from './derive';
import { applyThemeCss, loadThemeId, saveThemeId, themeById } from './themes';
import { staticData, staticState } from './static';
import { matchesTaxonomy } from './taxonomy';
import { matchesRepoMetadata, starsOf } from './repoFilters';
import { refreshPublicMetadata } from './githubLive';

export type DialogKind = 'move' | 'rename' | 'mkdir' | 'shelves' | 'clone' | 'visibility' | 'delete' | 'create' | 'publish';

export interface Dialog {
  kind: DialogKind;
  repoId?: string;
  shelfId?: string;
  targetShelfId?: string;
  visibility?: 'public' | 'private';
}

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

export type CaseStyle = 'classic' | 'modern' | 'floating';
export type ViewMode = '3d' | 'list';
export const CASE_STYLES: { id: CaseStyle; name: string; description: string }[] = [
  { id: 'classic', name: 'Classic', description: 'Walnut case with crown, plinth and panelled back' },
  { id: 'modern', name: 'Modern', description: 'Painted case, flat back, no crown' },
  { id: 'floating', name: 'Floating', description: 'Planks and dividers on the wall, no carcass' },
];

export interface DragState {
  repoId: string;
  overShelfId: string | null;
}

export interface ShelfState {
  loaded: boolean;
  loadError: string | null;
  connected: boolean;
  /** Every shelf the server knows, including hidden ones. */
  allShelves: Shelf[];
  /** Shelves currently shown on the bookcase (hidden ones appear once revealed). */
  shelves: Shelf[];
  repos: Repo[];
  secretRevealed: boolean;
  caseStyle: CaseStyle;
  githubAvailable: boolean;
  githubLogin: string | null;
  staleAfterDays: number;

  query: string;
  filter: Filter;
  activeShelfId: string;
  categoryFilters: string[];
  subCategoryFilters: string[];
  languageFilter: string;
  topicFilter: string;
  updatedAfter: string;
  minStars: number;
  viewMode: ViewMode;
  toggleCategory: (id: string) => void;
  toggleSubCategory: (id: string) => void;
  setLanguageFilter: (language: string) => void;
  setTopicFilter: (topic: string) => void;
  setUpdatedAfter: (date: string) => void;
  setMinStars: (stars: number) => void;
  setViewMode: (view: ViewMode) => void;
  selectedRepoId: string | null;
  hoveredRepoId: string | null;
  /** Keyboard focus on the wall: arrows move it, Enter opens it. */
  focusedRepoId: string | null;
  drag: DragState | null;
  dialog: Dialog | null;
  toasts: Toast[];
  busy: boolean;
  themeId: string;
  pages: Record<string, RepoPages>;
  setPages: (repoId: string, pages: RepoPages) => void;
  /** Rewind: books created after this instant are hidden. null = off. */
  timeline: number | null;
  rewindPlaying: boolean;
  setTimeline: (t: number | null) => void;
  startRewind: () => void;
  readOnly: boolean;
  /** When true every eased animation snaps to its target (used while exporting frames). */
  instant: boolean;
  setInstant: (v: boolean) => void;

  load: () => Promise<void>;
  applyState: (s: AppState) => void;
  mergeRepo: (r: Repo) => void;
  setQuery: (q: string) => void;
  setFilter: (f: Filter) => void;
  setActiveShelf: (id: string) => void;
  clearFilters: () => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setFocused: (id: string | null) => void;
  startDrag: (repoId: string) => void;
  dragOver: (shelfId: string | null) => void;
  endDrag: (drop: boolean) => void;
  openDialog: (d: Dialog) => void;
  closeDialog: () => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  setTheme: (id: string) => void;
  setCaseStyle: (c: CaseStyle) => void;
  revealSecret: () => void;
  setBusy: (b: boolean) => void;
  runAction: (label: string, fn: () => Promise<{ state?: AppState }>) => Promise<boolean>;
}

let toastSeq = 1;
// React StrictMode boots twice in development; share the account inventory request.
let publicRefresh: Promise<Repo[]> | null = null;

function loadCaseStyle(): CaseStyle {
  try {
    const v = localStorage.getItem('repo-shelf.case');
    if (v === 'classic' || v === 'modern' || v === 'floating') return v;
  } catch {
    /* ignore */
  }
  return 'classic';
}

function loadViewMode(): ViewMode {
  try {
    if (localStorage.getItem('repo-shelf.view') === 'list') return 'list';
  } catch {
    /* ignore */
  }
  return '3d';
}

/** Preserve an open book while clearing pointers to books the current filters hide. */
function reconcileVisible(st: ShelfState, patch: Partial<ShelfState>): Partial<ShelfState> {
  const next = { ...st, ...patch };
  const candidates = selectFilterCandidates(next);
  const maxStars = candidates.reduce((max, repo) => Math.max(max, starsOf(repo)), 0);
  // After another filter changes, use the next surviving tier so the slider and
  // predicate agree. Rounding up preserves which books pass the previous threshold.
  const boundedMin = Math.min(next.minStars, maxStars);
  const nextTier = boundedMin === 0 ? 0 : candidates.reduce((tier, repo) => {
    const stars = starsOf(repo);
    return stars >= boundedMin ? Math.min(tier, stars) : tier;
  }, maxStars);
  const minStars = patch.minStars ?? nextTier;
  const visible = new Set(candidates.filter((repo) => starsOf(repo) >= minStars).map((repo) => repo.id));
  return {
    ...patch,
    minStars,
    hoveredRepoId: st.hoveredRepoId && visible.has(st.hoveredRepoId) ? st.hoveredRepoId : null,
    focusedRepoId: st.focusedRepoId && visible.has(st.focusedRepoId) ? st.focusedRepoId : null,
  };
}

export const useShelf = create<ShelfState>()((set, get) => ({
  loaded: false,
  loadError: null,
  connected: false,
  allShelves: [],
  shelves: [],
  repos: [],
  secretRevealed: false,
  caseStyle: loadCaseStyle(),
  githubAvailable: false,
  githubLogin: null,
  staleAfterDays: 90,

  query: '',
  filter: 'all',
  activeShelfId: 'all',
  categoryFilters: [],
  subCategoryFilters: [],
  languageFilter: 'all',
  topicFilter: 'all',
  updatedAfter: '',
  minStars: 0,
  viewMode: loadViewMode(),
  toggleCategory: (id) => set((st) => reconcileVisible(st, { categoryFilters: st.categoryFilters.includes(id) ? st.categoryFilters.filter((x) => x !== id) : [...st.categoryFilters, id] })),
  toggleSubCategory: (id) => set((st) => reconcileVisible(st, { subCategoryFilters: st.subCategoryFilters.includes(id) ? st.subCategoryFilters.filter((x) => x !== id) : [...st.subCategoryFilters, id] })),
  setLanguageFilter: (languageFilter) => set((st) => reconcileVisible(st, { languageFilter })),
  setTopicFilter: (topicFilter) => set((st) => reconcileVisible(st, { topicFilter })),
  setUpdatedAfter: (updatedAfter) => set((st) => reconcileVisible(st, { updatedAfter })),
  setMinStars: (stars) => set((st) => reconcileVisible(st, { minStars: Number.isFinite(stars) ? Math.max(0, Math.floor(stars)) : 0 })),
  setViewMode(viewMode) {
    try {
      localStorage.setItem('repo-shelf.view', viewMode);
    } catch {
      /* ignore */
    }
    set({ viewMode, ...(viewMode === 'list' ? { rewindPlaying: false, timeline: null } : {}) });
  },
  selectedRepoId: null,
  hoveredRepoId: null,
  focusedRepoId: null,
  drag: null,
  dialog: null,
  toasts: [],
  busy: false,
  themeId: loadThemeId(),
  pages: {},
  setPages: (repoId, pages) => set((st) => ({ pages: { ...st.pages, [repoId]: pages } })),
  timeline: null,
  rewindPlaying: false,
  setTimeline: (timeline) => set({ timeline }),
  startRewind: () => {
    get().setViewMode('3d');
    set({ rewindPlaying: true, selectedRepoId: null, timeline: 0 });
  },
  readOnly: staticData() !== null,
  instant: false,
  setInstant: (instant) => set({ instant }),

  async load() {
    const embedded = staticData();
    if (embedded) {
      get().applyState(staticState(embedded));
      set({ loaded: true, loadError: null, connected: true, pages: embedded.pages, readOnly: true });
      publicRefresh ??= refreshPublicMetadata(embedded.repos, embedded.owner);
      void publicRefresh.then((repos) => {
        if (repos !== embedded.repos) get().applyState(staticState({ ...embedded, repos }));
      });
      return;
    }
    try {
      const s = await api.state();
      get().applyState(s);
      set({ loaded: true, loadError: null });
    } catch (err) {
      set({ loaded: true, loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  applyState(s) {
    const selected = get().selectedRepoId;
    if (!staticData()) set({ pages: {} });
    const visible = s.shelves.filter((sh) => !sh.hidden || get().secretRevealed);
    set((st) => reconcileVisible(st, {
      allShelves: s.shelves,
      shelves: visible,
      repos: s.repos,
      githubAvailable: s.github.available,
      githubLogin: s.github.login,
      staleAfterDays: s.config.staleAfterDays,
      selectedRepoId: selected && s.repos.some((r) => r.id === selected) ? selected : null,
    }));
  },

  mergeRepo(r) {
    set((st) => reconcileVisible(st, { repos: st.repos.map((x) => (x.id === r.id ? { ...x, ...r } : x)) }));
  },

  setQuery: (query) => set((st) => reconcileVisible(st, { query })),
  setFilter: (filter) => set((st) => reconcileVisible(st, { filter })),
  setActiveShelf: (activeShelfId) => set((st) => reconcileVisible(st, { activeShelfId })),
  clearFilters: () => set((st) => reconcileVisible(st, {
    query: '', filter: 'all', activeShelfId: 'all', categoryFilters: [], subCategoryFilters: [],
    languageFilter: 'all', topicFilter: 'all', updatedAfter: '', minStars: 0,
  })),
  select: (selectedRepoId) => set((st) => ({ selectedRepoId, focusedRepoId: selectedRepoId ?? st.focusedRepoId })),
  hover: (hoveredRepoId) => set({ hoveredRepoId }),
  setFocused: (focusedRepoId) => set({ focusedRepoId }),

  startDrag: (repoId) => set({ drag: { repoId, overShelfId: null }, hoveredRepoId: null }),
  dragOver(shelfId) {
    const d = get().drag;
    if (d && d.overShelfId !== shelfId) set({ drag: { ...d, overShelfId: shelfId } });
  },
  endDrag(drop) {
    const d = get().drag;
    set({ drag: null });
    if (!d || !drop) return;
    const repo = get().repos.find((r) => r.id === d.repoId);
    if (!repo || !d.overShelfId || d.overShelfId === repo.shelfId) return;
    const target = get().allShelves.find((s) => s.id === d.overShelfId);
    if (!target) return;
    if (target.kind === 'github') {
      // Dropping a GitHub book on the other GitHub shelf flips its visibility.
      const vis = /private/i.test(target.label) ? 'private' : /public/i.test(target.label) ? 'public' : null;
      if (repo.virtual && repo.repoSlug && vis && vis !== repo.visibility) {
        set({ dialog: { kind: 'visibility', repoId: repo.id, targetShelfId: target.id, visibility: vis } });
      }
      return;
    }
    if (target.kind !== 'disk') return;
    if (repo.virtual) {
      set({ dialog: { kind: 'clone', repoId: repo.id, targetShelfId: target.id } });
      return;
    }
    set({ dialog: { kind: 'move', repoId: repo.id, targetShelfId: target.id } });
  },

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  toast(kind, text) {
    const id = toastSeq++;
    set((st) => ({ toasts: [...st.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 4000);
  },
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

  setBusy: (busy) => set({ busy }),
  setTheme(id) {
    const t = themeById(id);
    saveThemeId(t.id);
    applyThemeCss(t);
    set({ themeId: t.id });
  },
  setCaseStyle(caseStyle) {
    try {
      localStorage.setItem('repo-shelf.case', caseStyle);
    } catch {
      /* ignore */
    }
    set({ caseStyle });
  },
  revealSecret() {
    if (get().secretRevealed) return;
    const all = get().allShelves;
    const hidden = all.filter((s) => s.hidden);
    set({ secretRevealed: true, shelves: all });
    if (hidden.length) {
      get().toast('info', `Secret shelf revealed: ${hidden.map((s) => s.label).join(', ')}`);
      const first = get().repos.find((r) => r.shelfId === hidden[0].id);
      if (first) set({ focusedRepoId: first.id });
    }
  },

  async runAction(label, fn) {
    set({ busy: true });
    try {
      const r = await fn();
      if (r.state) get().applyState(r.state);
      get().toast('success', label);
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      get().toast('error', msg);
      throw err;
    } finally {
      set({ busy: false });
    }
  },
}));

declare global {
  interface Window {
    __shelf?: typeof useShelf;
  }
}
if (typeof window !== 'undefined') window.__shelf = useShelf;

/** Repos eligible for the slider, before the star threshold is applied, in shelf order. */
export function selectFilterCandidates(st: ShelfState): Repo[] {
  const order = new Map(st.shelves.map((s, i) => [s.id, i]));
  return st.repos
    .filter((r) => order.has(r.shelfId))
    .filter((r) => matches(r, st.query, st.filter, st.activeShelfId, st.staleAfterDays))
    .filter((r) => matchesTaxonomy(r.shelfId, r.catalog?.subCategory, st.categoryFilters, st.subCategoryFilters))
    .filter((r) => matchesRepoMetadata(r, st))
    .sort((a, b) => (order.get(a.shelfId) ?? 0) - (order.get(b.shelfId) ?? 0) || compareOnShelf(a, b));
}

/** Shared by the wall and flat list so every filter has the same result in both views. */
export function selectVisibleRepos(st: ShelfState): Repo[] {
  return selectFilterCandidates(st).filter((repo) => starsOf(repo) >= st.minStars);
}

export function isFiltering(st: ShelfState): boolean {
  return st.query.trim() !== '' || st.filter !== 'all' || st.activeShelfId !== 'all' || st.categoryFilters.length > 0 || st.subCategoryFilters.length > 0 || st.languageFilter !== 'all' || st.topicFilter !== 'all' || st.updatedAfter !== '' || st.minStars > 0;
}

/** Boot: load state, subscribe to SSE. Returns cleanup. */
export function connectStore(): () => void {
  const st = useShelf.getState();
  applyThemeCss(themeById(st.themeId));
  void st.load();
  if (staticData()) return () => undefined;
  return subscribeEvents({
    onRepoUpdate: (r) => useShelf.getState().mergeRepo(r),
    onStateChanged: () => void useShelf.getState().load(),
    onConnection: (connected) => useShelf.setState({ connected }),
  });
}
