import * as THREE from 'three';
import { SpineAtlas, SPINE_ATLAS, type AtlasEntry, type AtlasPage } from './spineAtlas';
import { spineStyle } from './spineStyle';
import { starsOf } from '../repoFilters';
import { WALL, type WallLayout, type WallStep } from './wallLayout';

/** How far a spine slides toward the reader, in CSS px. */
export const PULL = { focus: 10, hover: 20, selected: 36, drop: 0 } as const;

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, -0.5);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
const tmpC = new THREE.Color();

export interface CullState {
  /** Current and desired visibility, independent of hover / selection pulls. */
  cur: number;
  target: number;
  delay: number;
}

/** Frame-rate-independent easing; retargeting preserves the current pose. */
export function advanceCull(state: CullState, dt: number, instant: boolean): boolean {
  if (instant) {
    state.cur = state.target;
    state.delay = 0;
    return false;
  }
  const elapsed = Math.max(0, dt);
  const activeDt = Math.max(0, elapsed - state.delay);
  state.delay = Math.max(0, state.delay - elapsed);
  state.cur += (state.target - state.cur) * (1 - Math.exp(-activeDt * 11));
  if (Math.abs(state.target - state.cur) < 0.001) state.cur = state.target;
  return state.delay > 0 || state.cur !== state.target;
}

/** Navigation follows shelf positions, skipping books that no longer match. */
export function stepEligibleSpine(layout: WallLayout, index: number, step: WallStep, eligible: (id: string) => boolean): number {
  const slots = layout.spines;
  const available = slots.filter((s) => eligible(s.repo.id));
  if (!available.length) return -1;
  const first = available[0].index;
  const last = available[available.length - 1].index;
  if (step === 'home') return first;
  if (step === 'end') return last;
  const current = slots[index];
  if (!current || !eligible(current.repo.id)) return first;
  if (step === 'left' || step === 'right') {
    const direction = step === 'left' ? -1 : 1;
    for (let i = index + direction; i >= 0 && i < slots.length; i += direction) if (eligible(slots[i].repo.id)) return i;
    return index;
  }
  if (step === 'up' || step === 'down') {
    const direction = step === 'up' ? -1 : 1;
    const centre = current.x + current.w / 2;
    for (let row = current.row + direction; row >= 0 && row < layout.metrics.rows; row += direction) {
      const candidates = available.filter((s) => s.bay === current.bay && s.row === row);
      if (!candidates.length) continue;
      return candidates.reduce((best, slot) => Math.abs(slot.x + slot.w / 2 - centre) < Math.abs(best.x + best.w / 2 - centre) ? slot : best).index;
    }
    return index;
  }
  const inBay = available.filter((s) => s.bay === current.bay);
  if (step === 'prev-bay' && inBay[0].index < index) return inBay[0].index;
  const direction = step === 'prev-bay' ? -1 : 1;
  for (let bay = current.bay + direction; bay >= 0 && bay < layout.bays.length; bay += direction) {
    const firstInBay = available.find((s) => s.bay === bay);
    if (firstInBay) return firstInBay.index;
  }
  return index;
}

/** Stable 0–4 px recess so a row reads as hand-shelved rather than extruded. */
function recess(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 5) * 0.9;
}

function spineMaterial(texture?: THREE.Texture): THREE.MeshLambertMaterial {
  // Lambert, not PBR: cloth needs no specular, and 1,256 spines cover most of the screen.
  const material = new THREE.MeshLambertMaterial({ map: texture ?? null });
  material.onBeforeCompile = (shader) => {
    // Opaque, screen-door fading keeps correct depth / draw ordering with thousands
    // of instances; no transparent mesh sorting or extra draw calls are needed.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aVisibility;\nvarying float vVisibility;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVisibility = aVisibility;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vVisibility;')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        if (vVisibility < 1.0) {
          float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (vVisibility <= grain) discard;
        }`);
    if (!texture) return;
    shader.uniforms.uTexel = { value: 1 / SPINE_ATLAS.page };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nuniform float uTexel;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        // Front face: this spine's slot. Sides and top: the swatch column beside it (cloth above, page block below).
        float swatchU = aRect.x + aRect.z + 1.5 * uTexel;
        if (normal.z > 0.5) vMapUv = aRect.xy + uv * aRect.zw;
        else if (normal.y > 0.5) vMapUv = vec2(swatchU, aRect.y + aRect.w * 0.25);
        else vMapUv = vec2(swatchU, aRect.y + aRect.w * 0.75);`,
      );
  };
  material.customProgramCacheKey = () => texture ? 'spine-atlas-cull-2' : 'spine-cloth-cull-2';
  return material;
}

interface PageMesh {
  mesh: THREE.InstancedMesh;
  rect: THREE.InstancedBufferAttribute;
  visibility: THREE.InstancedBufferAttribute;
}

export interface FieldUpdate {
  drawn: number;
  pending: number;
  uploads: number;
}

export interface CullingStats {
  threshold: number;
  visible: number;
  targetVisible: number;
  animating: number;
}

/**
 * Every spine on the wall in a handful of draw calls: one instanced mesh of
 * plain cloth boxes for spines not lettered yet, plus one instanced mesh per
 * atlas page for lettered ones. A spine is always in exactly one of them.
 */
export class SpineField {
  group = new THREE.Group();
  atlas = new SpineAtlas();
  layout: WallLayout | null = null;
  staleDays = 90;
  private fallback: THREE.InstancedMesh | null = null;
  private fallbackMat = spineMaterial();
  private fallbackVisibility: THREE.InstancedBufferAttribute | null = null;
  private pages: PageMesh[] = [];
  private indexOf = new Map<string, number>();
  private pulls = new Map<string, { cur: number; target: number }>();
  private glow = new Set<string>();
  private culls = new Map<string, CullState>();
  private minStars = 0;
  hidden = new Set<string>();

  constructor() {
    this.group.name = 'spines';
    this.bindAtlas();
  }

  private bindAtlas(): void {
    this.atlas.onEvict = (page, evicted) => {
      const pm = this.pages[page.index];
      if (pm) for (let i = 0; i < SPINE_ATLAS.capacity; i++) pm.mesh.setMatrixAt(i, ZERO);
      if (pm) pm.mesh.instanceMatrix.needsUpdate = true;
      for (const e of evicted) {
        const i = this.indexOf.get(e.repoId);
        if (i !== undefined) this.write(i);
      }
    };
  }

  /** Drop every lettered spine (e.g. the spine typeface arrived late) and letter again as they come into view. */
  resetAtlas(): void {
    for (const pm of this.pages) this.disposePage(pm);
    this.pages = [];
    this.atlas.dispose();
    this.atlas = new SpineAtlas();
    this.bindAtlas();
    this.writeAll();
  }

  private disposePage(pm: PageMesh): void {
    this.group.remove(pm.mesh);
    pm.mesh.geometry.dispose();
    (pm.mesh.material as THREE.Material).dispose();
    pm.mesh.dispose();
  }

  setLayout(layout: WallLayout): void {
    this.layout = layout;
    this.indexOf = new Map(layout.spines.map((s) => [s.repo.id, s.index]));
    const kept = new Map<string, CullState>();
    for (const s of layout.spines) {
      const target = starsOf(s.repo) >= this.minStars ? 1 : 0;
      const previous = this.culls.get(s.repo.id);
      kept.set(s.repo.id, previous ? { ...previous, target, delay: previous.target === target ? previous.delay : 0 } : { cur: target, target, delay: 0 });
    }
    this.culls = kept;
    for (const id of this.pulls.keys()) if (!this.indexOf.has(id)) this.pulls.delete(id);
    const n = Math.max(1, layout.spines.length);
    if (!this.fallback || this.fallback.instanceMatrix.count < n) {
      if (this.fallback) {
        this.group.remove(this.fallback);
        this.fallback.geometry.dispose();
        this.fallback.dispose();
      }
      const capacity = Math.ceil(n * 1.25);
      const geometry = UNIT_BOX.clone();
      this.fallbackVisibility = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      geometry.setAttribute('aVisibility', this.fallbackVisibility);
      this.fallback = new THREE.InstancedMesh(geometry, this.fallbackMat, capacity);
      this.fallback.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.fallbackVisibility.setUsage(THREE.DynamicDrawUsage);
      this.fallback.frustumCulled = false;
      this.fallback.raycast = () => undefined;
      this.group.add(this.fallback);
    }
    this.fallback.count = layout.spines.length;
    for (const s of layout.spines) {
      this.fallback.setColorAt(s.index, tmpC.set(spineStyle(s.repo, this.staleDays).cloth));
    }
    if (this.fallback.instanceColor) this.fallback.instanceColor.needsUpdate = true;
    this.writeAll();
  }

  /** Recompute every instance transform (layout change, rewind, drag). */
  writeAll(): void {
    if (!this.layout) return;
    for (const pm of this.pages) {
      for (let i = 0; i < SPINE_ATLAS.capacity; i++) pm.mesh.setMatrixAt(i, ZERO);
      pm.mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < this.layout.spines.length; i++) this.write(i);
  }

  private entryFor(i: number): AtlasEntry | null {
    const s = this.layout!.spines[i];
    const e = this.atlas.get(s.repo.id);
    return e && e.key === this.atlas.keyFor(s.repo, s.w, s.h, this.staleDays) ? e : null;
  }

  private write(i: number): void {
    const s = this.layout!.spines[i];
    const id = s.repo.id;
    const pull = this.pulls.get(id)?.cur ?? 0;
    const lift = pull > 0 ? pull * 0.08 : 0;
    const visibility = this.culls.get(id)?.cur ?? 1;
    const gone = 1 - visibility;
    // A book slips forward and down as it dissolves, while its shelf slot stays
    // put. Hover / focus / selected pulls compose with this reversible movement.
    const width = s.w * (1 - gone * 0.15);
    tmpP.set(s.x + (s.w - width) / 2, s.y + lift - 32 * gone * gone, pull + gone * 36 - recess(id));
    tmpS.set(width, s.h * (1 - gone * 0.08), WALL.DEPTH * (1 - gone * 0.08));
    tmpM.compose(tmpP, tmpQ, tmpS);
    const m = this.hidden.has(id) || visibility === 0 ? ZERO : tmpM;
    const e = this.entryFor(i);
    const stale = this.atlas.get(id);
    if (e) {
      const pm = this.pages[e.page.index];
      pm.mesh.setMatrixAt(e.slot, m);
      pm.visibility.setX(e.slot, visibility);
      pm.visibility.needsUpdate = true;
      pm.mesh.setColorAt(e.slot, this.glow.has(id) ? tmpC.setRGB(1.13, 1.1, 1.04) : WHITE);
      pm.mesh.instanceMatrix.needsUpdate = true;
      if (pm.mesh.instanceColor) pm.mesh.instanceColor.needsUpdate = true;
      this.fallback!.setMatrixAt(i, ZERO);
    } else {
      if (stale) {
        const pm = this.pages[stale.page.index];
        if (pm) {
          pm.mesh.setMatrixAt(stale.slot, ZERO);
          pm.mesh.instanceMatrix.needsUpdate = true;
        }
      }
      this.fallback!.setMatrixAt(i, m);
    }
    this.fallbackVisibility!.setX(i, visibility);
    this.fallbackVisibility!.needsUpdate = true;
    this.fallback!.instanceMatrix.needsUpdate = true;
  }

  private pageMesh(page: AtlasPage): PageMesh {
    let pm = this.pages[page.index];
    if (pm) return pm;
    const geometry = UNIT_BOX.clone();
    const rect = new THREE.InstancedBufferAttribute(new Float32Array(SPINE_ATLAS.capacity * 4), 4);
    const visibility = new THREE.InstancedBufferAttribute(new Float32Array(SPINE_ATLAS.capacity), 1);
    geometry.setAttribute('aRect', rect);
    geometry.setAttribute('aVisibility', visibility);
    const mesh = new THREE.InstancedMesh(geometry, spineMaterial(page.texture), SPINE_ATLAS.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    visibility.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.raycast = () => undefined;
    for (let i = 0; i < SPINE_ATLAS.capacity; i++) {
      mesh.setMatrixAt(i, ZERO);
      mesh.setColorAt(i, WHITE);
    }
    pm = { mesh, rect, visibility };
    this.pages[page.index] = pm;
    this.group.add(mesh);
    return pm;
  }

  /**
   * Letter the spines in view, nearest the centre first, within a time budget,
   * and recycle pages nobody has seen for longest when the cap is reached.
   */
  update(x0: number, x1: number, frame: number, budgetMs: number, allowDraw: boolean): FieldUpdate {
    const layout = this.layout;
    if (!layout) return { drawn: 0, pending: 0, uploads: 0 };
    const queue: number[] = [];
    for (const bay of layout.bays) {
      if (bay.x + bay.width < x0 || bay.x > x1) continue;
      for (let i = bay.first; i < bay.end; i++) {
        const s = layout.spines[i];
        if (s.x + s.w < x0 || s.x > x1) continue;
        if (this.hidden.has(s.repo.id) || this.visibilityOf(s.repo.id) === 0) continue;
        const e = this.entryFor(i);
        if (e) e.page.lastSeen = frame;
        else queue.push(i);
      }
    }
    let drawn = 0;
    if (allowDraw && queue.length) {
      const mid = (x0 + x1) / 2;
      queue.sort((a, b) => Math.abs(layout.spines[a].x - mid) - Math.abs(layout.spines[b].x - mid));
      const t0 = performance.now();
      for (const i of queue) {
        // Letter in batches: each dirty page is uploaded once per frame, so a few spines per frame would re-upload it constantly.
        if (drawn >= 12 && performance.now() - t0 > budgetMs) break;
        const s = layout.spines[i];
        const before = this.atlas.get(s.repo.id);
        if (before) {
          const old = this.pages[before.page.index];
          old?.mesh.setMatrixAt(before.slot, ZERO);
          if (old) old.mesh.instanceMatrix.needsUpdate = true;
        }
        const e = this.atlas.draw(s.repo, s.w, s.h, this.staleDays, frame);
        if (!e) break;
        const pm = this.pageMesh(e.page);
        pm.rect.setXYZW(e.slot, ...e.rect);
        pm.rect.needsUpdate = true;
        this.write(i);
        drawn++;
      }
    }
    return { drawn, pending: allowDraw ? queue.length - drawn : 0, uploads: this.atlas.flush() };
  }

  /** Ease pulls toward their targets. Returns true while anything is still moving. */
  animate(dt: number, instant: boolean): boolean {
    let moving = false;
    // Demand rendering can wake after seconds of inactivity. Its first delta
    // must not fast-forward a newly requested transition straight to the end.
    const animationDt = Math.min(Math.max(0, dt), 0.05);
    const k = instant ? 1 : 1 - Math.exp(-animationDt * 16);
    for (const [id, state] of this.culls) {
      if (state.cur === state.target && state.delay === 0) continue;
      const previous = state.cur;
      if (advanceCull(state, animationDt, instant)) moving = true;
      const i = this.indexOf.get(id);
      if (i !== undefined && previous !== state.cur) this.write(i);
    }
    for (const [id, p] of this.pulls) {
      p.cur += (p.target - p.cur) * k;
      if (Math.abs(p.target - p.cur) < 0.05) p.cur = p.target;
      else moving = true;
      const i = this.indexOf.get(id);
      if (i !== undefined) this.write(i);
      if (p.cur === 0 && p.target === 0) this.pulls.delete(id);
    }
    return moving;
  }

  setPulls(targets: Map<string, number>, glow: Set<string>): void {
    for (const [id, p] of this.pulls) if (!targets.has(id)) p.target = 0;
    for (const [id, target] of targets) {
      const p = this.pulls.get(id);
      if (p) p.target = target;
      else this.pulls.set(id, { cur: 0, target });
    }
    const changed = [...this.glow, ...glow];
    this.glow = glow;
    for (const id of changed) {
      const i = this.indexOf.get(id);
      if (i !== undefined) this.write(i);
    }
  }

  /** Adjust only instance targets; the shelf geometry and texture atlas survive scrubbing. */
  setStarThreshold(threshold: number, instant = false): void {
    this.minStars = Number.isFinite(threshold) ? Math.max(0, Math.floor(threshold)) : 0;
    if (!this.layout) return;
    const leaving = this.layout.spines.filter((s) => starsOf(s.repo) < this.minStars && this.culls.get(s.repo.id)?.target === 1);
    const tiers = [...new Set(leaving.map((s) => starsOf(s.repo)))].sort((a, b) => a - b);
    const tierOrder = new Map(tiers.map((stars, i) => [stars, i]));
    for (const slot of this.layout.spines) {
      const state = this.culls.get(slot.repo.id)!;
      const target = starsOf(slot.repo) >= this.minStars ? 1 : 0;
      if (state.target !== target) {
        state.target = target;
        // Only newly departing, stationary books wait. A reversal always starts
        // immediately from the current pose, even during fast slider scrubbing.
        state.delay = target === 0 && state.cur === 1 && tiers.length > 1 ? (tierOrder.get(starsOf(slot.repo)) ?? 0) / (tiers.length - 1) * 0.22 : 0;
      }
      if (instant) {
        state.cur = target;
        state.delay = 0;
        this.write(slot.index);
      }
    }
  }

  visibilityOf(id: string): number {
    return this.culls.get(id)?.cur ?? 0;
  }

  /** Filtered books stop accepting input immediately, including while fading out. */
  canInteract(id: string): boolean {
    return !this.hidden.has(id) && this.culls.get(id)?.target === 1;
  }

  cullingStats(): CullingStats {
    let visible = 0;
    let targetVisible = 0;
    let animating = 0;
    for (const [id, state] of this.culls) {
      if (this.hidden.has(id)) continue;
      if (state.cur > 0) visible++;
      if (state.target === 1) targetVisible++;
      if (state.cur !== state.target || state.delay > 0) animating++;
    }
    return { threshold: this.minStars, visible, targetVisible, animating };
  }

  /** Spines inside [x0, x1] still shown as plain cloth (not lettered yet). */
  unlettered(x0: number, x1: number): number {
    if (!this.layout) return 0;
    return this.layout.spines.filter((s) => s.x + s.w >= x0 && s.x <= x1 && !this.hidden.has(s.repo.id) && this.visibilityOf(s.repo.id) > 0 && !this.entryFor(s.index)).length;
  }

  pullOf(id: string): number {
    return this.pulls.get(id)?.cur ?? 0;
  }

  dispose(): void {
    this.fallback?.geometry.dispose();
    this.fallback?.dispose();
    this.fallbackMat.dispose();
    for (const pm of this.pages) this.disposePage(pm);
    this.atlas.dispose();
  }
}
