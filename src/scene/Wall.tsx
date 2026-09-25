import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isFiltering, useShelf, type ShelfState } from '../store';
import { matches } from '../derive';
import { themeById } from '../themes';
import type { Repo } from '../types';
import { backPanelTexture, bookTextures, sideColor, textureCacheStats, woodTexture } from './textures';
import { WALL, bayAt, layoutWall, spineAt, stepSpine, wallMetrics, type WallLayout, type WallStep } from './wallLayout';
import { buildStructure, shadeTexture } from './wallStructure';
import { PULL, SpineField } from './spineField';
import { SPINE_FONT } from './spineAtlas';
import { useWall, wallView, type ScreenRect } from './wallStore';
import { wallPoint } from './WallCamera';
import './benchmark';

const KEY_STEPS: Record<string, WallStep> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'prev-bay',
  PageDown: 'next-bay',
};

/** Folder repos move between folder shelves; GitHub books change visibility or clone. Catalog books stay put. */
function movable(repo: Repo, st: ShelfState): boolean {
  if (st.readOnly || repo.catalog) return false;
  if (repo.virtual && !repo.repoSlug) return false;
  return st.shelves.some((s) => s.kind === 'disk' || s.kind === 'github');
}

function dropTarget(repo: Repo, layout: WallLayout, x: number): string | null {
  const bay = bayAt(layout, x);
  const shelf = bay?.shelf;
  if (!shelf || shelf.id === repo.shelfId) return null;
  if (repo.virtual) return shelf.kind === 'github' || shelf.kind === 'disk' ? shelf.id : null;
  return shelf.kind === 'disk' ? shelf.id : null;
}

function firstVisible(layout: WallLayout): number {
  const i = layout.spines.findIndex((s) => s.x >= wallView.x0 + 8);
  return i >= 0 ? i : 0;
}

const tmp = new THREE.Vector3();
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Wall() {
  const { camera, gl, invalidate, size } = useThree();
  const shelves = useShelf((s) => s.shelves);
  const repos = useShelf((s) => s.repos);
  const query = useShelf((s) => s.query);
  const filter = useShelf((s) => s.filter);
  const activeShelfId = useShelf((s) => s.activeShelfId);
  const staleAfterDays = useShelf((s) => s.staleAfterDays);
  const timeline = useShelf((s) => s.timeline);
  const theme = useShelf((s) => themeById(s.themeId));
  const hovered = useShelf((s) => s.hoveredRepoId);
  const focused = useShelf((s) => s.focusedRepoId);
  const selected = useShelf((s) => s.selectedRepoId);
  const dragId = useShelf((s) => s.drag?.repoId ?? null);
  const overShelfId = useShelf((s) => s.drag?.overShelfId ?? null);
  const filtering = useShelf(isFiltering);
  const occludeRight = useWall((s) => s.occludeRight);

  const displayed = useMemo(
    () => repos.filter((r) => matches(r, query, filter, activeShelfId, staleAfterDays)),
    [repos, query, filter, activeShelfId, staleAfterDays],
  );
  const byShelf = useMemo(() => {
    const m = new Map<string, Repo[]>();
    for (const r of displayed) {
      const list = m.get(r.shelfId);
      if (list) list.push(r);
      else m.set(r.shelfId, [r]);
    }
    return m;
  }, [displayed]);
  const metrics = useMemo(() => wallMetrics(size.height), [size.height]);
  const keepEmpty = !filtering && shelves.every((s) => s.kind !== 'catalog');
  const layout = useMemo(() => layoutWall(shelves, byShelf, metrics, keepEmpty), [shelves, byShelf, metrics, keepEmpty]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useLayoutEffect(() => {
    useWall.getState().setLayout(layout, { width: size.width, height: size.height });
    invalidate();
  }, [layout, size.width, size.height, invalidate]);

  // A new search or filter reflows the wall: start reading it from the beginning.
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    useWall.getState().setTarget({ x: 0 });
  }, [query, filter, activeShelfId]);

  const caseStyle = useShelf((s) => s.caseStyle);
  const structure = useMemo(() => buildStructure(layout, caseStyle), [layout, caseStyle]);
  useEffect(
    () => () => {
      structure.frame.dispose();
      structure.planks.dispose();
      structure.back.dispose();
      structure.shade.dispose();
      structure.trim.dispose();
      structure.metal?.dispose();
    },
    [structure],
  );

  const wood = useMemo(() => {
    const t = woodTexture().clone();
    t.repeat.set(1, 1);
    t.needsUpdate = true;
    return t;
  }, []);
  const back = backPanelTexture(theme);
  // The room the bookcase stands in, seen only when zoomed out: a wall behind it and a floor under it. Unlit, so the colours are exact.
  const room = useMemo(() => {
    const bg = new THREE.Color(theme.scene.background);
    const wood = new THREE.Color(theme.scene.frame);
    return {
      wall: `#${bg.clone().lerp(wood, theme.dark ? 0.3 : 0.14).getHexString()}`,
      floor: `#${wood.clone().lerp(bg, theme.dark ? 0.12 : 0.3).getHexString()}`,
    };
  }, [theme]);
  const trimColor = useMemo(() => `#${new THREE.Color(theme.scene.plank).lerp(new THREE.Color('#f3e2c4'), 0.28).getHexString()}`, [theme]);

  const field = useMemo(() => new SpineField(), []);
  useEffect(() => () => field.dispose(), [field]);
  useEffect(() => {
    // Measurement hook for the texture budget and draw-call numbers reported in PROGRESS.md.
    (window as unknown as { __wallStats?: () => unknown }).__wallStats = () => ({
      atlas: field.atlas.stats(),
      detail: textureCacheStats(),
      spines: layoutRef.current.spines.length,
      unlettered: field.unlettered(wallView.x0, wallView.x1),
      view: [Math.round(wallView.x0), Math.round(wallView.x1)],
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      glTextures: gl.info.memory.textures,
    });
  }, [field, gl]);
  useEffect(() => {
    field.staleDays = staleAfterDays;
    field.setLayout(layout);
    invalidate();
  }, [field, layout, staleAfterDays, invalidate]);

  // Letter spines only once the spine typeface is ready (or clearly not coming).
  const fontsReady = useRef(false);
  useEffect(() => {
    let alive = true;
    let timedOut = false;
    const ready = () => {
      if (!alive || fontsReady.current) return;
      fontsReady.current = true;
      invalidate();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      ready();
    }, 2500);
    const fonts = document.fonts;
    if (!fonts) ready();
    else
      Promise.all([fonts.load(`600 12px ${SPINE_FONT}`), fonts.load(`700 12px ${SPINE_FONT}`)]).then(
        () => {
          if (timedOut && alive) {
            field.resetAtlas();
            invalidate();
          }
          ready();
        },
        ready,
      );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [field, invalidate]);

  // Rewind hides books not created yet; a dragged book leaves its slot empty.
  useEffect(() => {
    const hidden = new Set<string>();
    if (timeline !== null) for (const s of layout.spines) if (!s.repo.createdAt || new Date(s.repo.createdAt).getTime() > timeline) hidden.add(s.repo.id);
    if (dragId) hidden.add(dragId);
    field.hidden = hidden;
    field.writeAll();
    invalidate();
  }, [field, layout, timeline, dragId, invalidate]);

  useEffect(() => {
    const targets = new Map<string, number>();
    if (focused) targets.set(focused, PULL.focus);
    if (hovered && !dragId) targets.set(hovered, PULL.hover);
    if (selected) targets.set(selected, PULL.selected);
    field.setPulls(targets, new Set([hovered, selected].filter((id): id is string => Boolean(id) && id !== dragId)));
    invalidate();
  }, [field, focused, hovered, selected, dragId, invalidate]);

  // Keep the focused or opened spine in view, left of the book window.
  useEffect(() => {
    const id = selected ?? focused;
    const s = id ? layoutRef.current.spines.find((x) => x.repo.id === id) : null;
    if (s) useWall.getState().reveal(s.x - 6, s.x + s.w + 6, s.y - WALL.PLANK, s.y + s.h + 30);
  }, [selected, focused, occludeRight, layout]);

  // Pointer: hover, click to open, drag the wood (or any catalog book) to pan with a fling, drag a folder book to move it.
  const ghost = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const el = gl.domElement;
    type Press = { x: number; y: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number; spine: number; mode: 'none' | 'pan' | 'drag' };
    let press: Press | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; zoom: number } | null = null;

    const pick = (e: { clientX: number; clientY: number }) => {
      const p = wallPoint(camera, el, e.clientX, e.clientY);
      return p ? spineAt(layoutRef.current, p.x, p.y) : -1;
    };
    const setHover = (id: string | null) => {
      const st = useShelf.getState();
      if (st.hoveredRepoId !== id) st.hover(id);
    };

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: useWall.getState().target.zoom };
        press = null;
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture?.(e.pointerId);
      press = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0, spine: pick(e), mode: 'none' };
    };

    const move = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      wallView.keyboard = false;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.dist > 0) useWall.getState().zoomAt((pinch.zoom * d) / pinch.dist);
        return;
      }
      const st = useShelf.getState();
      const L = layoutRef.current;
      if (!press) {
        // Only the canvas itself hovers spines; the book window, overlays and toolbar sit above it.
        if (e.target !== el) {
          setHover(null);
          return;
        }
        const i = pick(e);
        const id = i >= 0 ? L.spines[i].repo.id : null;
        setHover(id);
        el.style.cursor = id ? 'pointer' : 'grab';
        invalidate();
        return;
      }
      const dx = e.clientX - press.lastX;
      const dy = e.clientY - press.lastY;
      if (press.mode === 'none' && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) {
        const repo = press.spine >= 0 ? L.spines[press.spine].repo : null;
        if (repo && movable(repo, st)) {
          press.mode = 'drag';
          st.startDrag(repo.id);
          el.style.cursor = 'grabbing';
        } else {
          press.mode = 'pan';
          setHover(null);
          el.style.cursor = 'grabbing';
        }
      }
      const now = performance.now();
      if (press.mode === 'pan') {
        const wall = useWall.getState();
        const z = wall.target.zoom;
        wall.scrollBy(-dx / z, dy / z);
        wallView.snap = true;
        const dt = Math.max(1, now - press.lastT);
        press.vx = press.vx * 0.6 + (dx / dt) * 0.4;
        press.vy = press.vy * 0.6 + (dy / dt) * 0.4;
      } else if (press.mode === 'drag') {
        const p = wallPoint(camera, el, e.clientX, e.clientY);
        const s = press.spine >= 0 ? L.spines[press.spine] : null;
        if (p && s && ghost.current) {
          ghost.current.visible = true;
          ghost.current.position.set(p.x, p.y, 60);
          ghost.current.scale.set(s.w, s.h, WALL.DEPTH);
          st.dragOver(dropTarget(s.repo, L, p.x));
        }
      }
      press.lastX = e.clientX;
      press.lastY = e.clientY;
      press.lastT = now;
      invalidate();
    };

    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!press) return;
      const p = press;
      press = null;
      el.releasePointerCapture?.(e.pointerId);
      const st = useShelf.getState();
      if (p.mode === 'none') {
        if (p.spine >= 0) st.select(layoutRef.current.spines[p.spine].repo.id);
      } else if (p.mode === 'pan') {
        // Fling: carry the release velocity; the camera's easing turns it into a glide.
        if (performance.now() - p.lastT < 90) {
          const z = useWall.getState().target.zoom;
          useWall.getState().scrollBy((-p.vx * 260) / z, (p.vy * 260) / z);
        }
        el.style.cursor = 'grab';
      } else if (p.mode === 'drag') {
        if (ghost.current) ghost.current.visible = false;
        st.endDrag(true);
        el.style.cursor = '';
      }
      invalidate();
    };

    const leave = () => {
      if (!press) setHover(null);
    };
    const dbl = (e: MouseEvent) => {
      const i = pick(e);
      const wall = useWall.getState();
      if (i < 0) {
        wall.resetView();
        return;
      }
      const s = layoutRef.current.spines[i];
      wall.zoomAt(Math.max(2, wall.target.zoom), { x: s.x + s.w / 2, y: s.y + s.h / 2 });
    };
    const ctx = (e: MouseEvent) => e.preventDefault();

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('dblclick', dbl);
    el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('dblclick', dbl);
      el.removeEventListener('contextmenu', ctx);
    };
  }, [gl, camera, invalidate]);

  // Keyboard: arrows walk the wall, Enter opens, Esc closes, +/-/0 zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useShelf.getState();
      if (st.dialog || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const L = layoutRef.current;
      const step = KEY_STEPS[e.key];
      if (step) {
        if (target?.closest?.('.panel .book-right, .panel .page-body')) return;
        if (!L.spines.length) return;
        e.preventDefault();
        const cur = st.focusedRepoId ? L.spines.findIndex((s) => s.repo.id === st.focusedRepoId) : -1;
        const next = cur >= 0 ? stepSpine(L, cur, step) : firstVisible(L);
        wallView.keyboard = true;
        st.hover(null);
        st.setFocused(L.spines[next].repo.id);
        invalidate();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (target?.closest?.('button, a, [role="button"]')) return;
        if (st.focusedRepoId && st.selectedRepoId !== st.focusedRepoId) {
          e.preventDefault();
          st.select(st.focusedRepoId);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (st.selectedRepoId) st.select(null);
        else if (st.focusedRepoId) {
          wallView.keyboard = false;
          st.setFocused(null);
        }
        invalidate();
        return;
      }
      const wall = useWall.getState();
      if (e.key === '+' || e.key === '=') wall.zoomAt(wall.target.zoom * 1.25);
      else if (e.key === '-' || e.key === '_') wall.zoomAt(wall.target.zoom / 1.25);
      else if (e.key === '0') wall.resetView();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [invalidate]);

  // The dragged book follows the pointer with its own large spine texture.
  const ghostMats = useMemo(() => {
    const repo = dragId ? repos.find((r) => r.id === dragId) : null;
    if (!repo) return null;
    const side = new THREE.MeshStandardMaterial({ color: sideColor(repo, staleAfterDays), roughness: 0.8 });
    const front = new THREE.MeshStandardMaterial({ map: bookTextures(repo, staleAfterDays).spine, roughness: 0.75 });
    return [side, side, side, side, front, side];
  }, [dragId, repos, staleAfterDays]);
  useEffect(() => () => ghostMats?.forEach((m) => m.dispose()), [ghostMats]);

  const dropBay = overShelfId ? layout.bays.find((b) => b.shelf.id === overShelfId) : null;
  const frameNo = useRef(0);
  const projected = useRef<ScreenRect>({ left: 0, top: 0, width: 0, height: 0 });

  useFrame((_, delta) => {
    const st = useShelf.getState();
    const L = layoutRef.current;
    frameNo.current++;
    const margin = 260 / Math.max(0.3, wallView.zoom);
    const res = field.update(wallView.x0 - margin, wallView.x1 + margin, frameNo.current, st.instant ? 1e9 : 12, fontsReady.current && wallView.zoom > 0.3);
    if (res.pending > 0) invalidate();
    if (field.animate(delta, st.instant || reducedMotion)) invalidate();

    // Overlay anchors in canvas CSS px.
    const project = (x: number, y: number, z: number) => {
      tmp.set(x, y, z).project(camera);
      return [((tmp.x + 1) / 2) * size.width, ((1 - tmp.y) / 2) * size.height] as const;
    };
    const rectFor = (id: string | null): ScreenRect | null => {
      if (!id) return null;
      const s = L.spines.find((x) => x.repo.id === id);
      if (!s) return null;
      const pull = field.pullOf(id);
      const lift = pull * 0.08;
      const [l, t] = project(s.x, s.y + s.h + lift, pull);
      const [r, b] = project(s.x + s.w, s.y + lift, pull);
      const out = projected.current;
      out.left = l;
      out.top = t;
      out.width = r - l;
      out.height = b - t;
      return { ...out };
    };
    let tipId = st.drag ? null : (st.hoveredRepoId ?? (wallView.keyboard ? st.focusedRepoId : null));
    // The open book already has its window.
    if (tipId && tipId === st.selectedRepoId) tipId = null;
    const tipRect = rectFor(tipId);
    wallView.tip = tipId && tipRect ? { id: tipId, rect: tipRect } : null;
    wallView.ring = wallView.keyboard ? rectFor(st.focusedRepoId) : null;

    const plateWorldY = L.height - WALL.TOP / 2;
    wallView.plateY = project(wallView.x0, plateWorldY, 22)[1];
    // Plates stay in the part of the wall the book window does not cover.
    const visibleRight = wallView.x1 - useWall.getState().occludeRight / wallView.zoom;
    wallView.plates = L.bays.map((bay) => {
      const a = Math.max(bay.x, wallView.x0);
      const b = Math.min(bay.x + bay.width, visibleRight);
      if (b - a < 60 / wallView.zoom) return null;
      return {
        centre: project(bay.x + bay.width / 2, plateWorldY, 22)[0],
        left: project(a, plateWorldY, 22)[0],
        right: project(b, plateWorldY, 22)[0],
      };
    });
    wallView.emit();
  });

  const backMat = useMemo(() => new THREE.MeshLambertMaterial({ map: back }), [back]);
  useEffect(() => () => backMat.dispose(), [backMat]);

  return (
    <group>
      {/* Opaque wood draws after the spines in front of it, so hidden back panels fail the depth test early. */}
      <mesh geometry={structure.back} material={backMat} renderOrder={1} />
      <mesh position={[layout.width / 2, layout.height / 2 + 2000, -WALL.DEPTH - 40]} renderOrder={2}>
        <planeGeometry args={[layout.width + 24000, layout.height + 6000]} />
        <meshBasicMaterial color={room.wall} />
      </mesh>
      <mesh position={[layout.width / 2, 0, -WALL.DEPTH + 20000]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[layout.width + 24000, 40000]} />
        <meshBasicMaterial color={room.floor} />
      </mesh>
      <mesh position={[layout.width / 2, 0.5, 90]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <planeGeometry args={[layout.width + 120, 220]} />
        <meshBasicMaterial color="#000000" map={shadeTexture()} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh geometry={structure.frame} renderOrder={1}>
        {/* Modern is painted: the frame colour without the grain. */}
        <meshLambertMaterial key={caseStyle} map={caseStyle === 'modern' ? null : wood} color={theme.scene.frame} />
      </mesh>
      <mesh geometry={structure.planks} renderOrder={1}>
        <meshLambertMaterial key={caseStyle} map={caseStyle === 'modern' ? null : wood} color={theme.scene.plank} />
      </mesh>
      <mesh geometry={structure.trim} renderOrder={1}>
        <meshBasicMaterial color={trimColor} />
      </mesh>
      {structure.metal && (
        <mesh geometry={structure.metal}>
          <meshStandardMaterial color="#7a6238" metalness={0.65} roughness={0.38} />
        </mesh>
      )}
      <primitive object={field.group} />
      <mesh geometry={structure.shade} renderOrder={2}>
        <meshBasicMaterial color="#000000" map={shadeTexture()} transparent opacity={0.62} depthWrite={false} />
      </mesh>
      {dropBay && (
        <mesh position={[dropBay.x + dropBay.width / 2, (WALL.BOTTOM + layout.height - WALL.TOP) / 2, 3]} renderOrder={3}>
          <planeGeometry args={[dropBay.width, layout.height - WALL.TOP - WALL.BOTTOM]} />
          <meshBasicMaterial color="#f3d9a4" transparent opacity={0.16} depthWrite={false} />
        </mesh>
      )}
      <mesh ref={ghost} visible={false} material={ghostMats ?? undefined} renderOrder={4}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
    </group>
  );
}
