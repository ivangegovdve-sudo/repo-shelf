import * as THREE from 'three';
import { SpineAtlas, SPINE_ATLAS, type AtlasEntry, type AtlasPage } from './spineAtlas';
import { spineStyle } from './spineStyle';
import { WALL, type WallLayout } from './wall';

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

/** Stable 0–4 px recess so a row reads as hand-shelved rather than extruded. */
function recess(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 5) * 0.9;
}

function atlasMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, metalness: 0 });
  material.onBeforeCompile = (shader) => {
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
  material.customProgramCacheKey = () => 'spine-atlas-1';
  return material;
}

interface PageMesh {
  mesh: THREE.InstancedMesh;
  rect: THREE.InstancedBufferAttribute;
}

export interface FieldUpdate {
  drawn: number;
  pending: number;
  uploads: number;
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
  private fallbackMat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  private pages: PageMesh[] = [];
  private indexOf = new Map<string, number>();
  private pulls = new Map<string, { cur: number; target: number }>();
  private glow = new Set<string>();
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
    const n = Math.max(1, layout.spines.length);
    if (!this.fallback || this.fallback.instanceMatrix.count < n) {
      if (this.fallback) {
        this.group.remove(this.fallback);
        this.fallback.dispose();
      }
      this.fallback = new THREE.InstancedMesh(UNIT_BOX, this.fallbackMat, Math.ceil(n * 1.25));
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
    tmpP.set(s.x, s.y + lift, pull - recess(id));
    tmpS.set(s.w, s.h, WALL.DEPTH);
    tmpM.compose(tmpP, tmpQ, tmpS);
    const m = this.hidden.has(id) ? ZERO : tmpM;
    const e = this.entryFor(i);
    const stale = this.atlas.get(id);
    if (e) {
      const pm = this.pages[e.page.index];
      pm.mesh.setMatrixAt(e.slot, m);
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
    this.fallback!.instanceMatrix.needsUpdate = true;
  }

  private pageMesh(page: AtlasPage): PageMesh {
    let pm = this.pages[page.index];
    if (pm) return pm;
    const geometry = UNIT_BOX.clone();
    const rect = new THREE.InstancedBufferAttribute(new Float32Array(SPINE_ATLAS.capacity * 4), 4);
    geometry.setAttribute('aRect', rect);
    const mesh = new THREE.InstancedMesh(geometry, atlasMaterial(page.texture), SPINE_ATLAS.capacity);
    mesh.frustumCulled = false;
    mesh.raycast = () => undefined;
    for (let i = 0; i < SPINE_ATLAS.capacity; i++) {
      mesh.setMatrixAt(i, ZERO);
      mesh.setColorAt(i, WHITE);
    }
    pm = { mesh, rect };
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
    const k = instant ? 1 : 1 - Math.exp(-dt * 16);
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

  /** Spines inside [x0, x1] still shown as plain cloth, and how many of those the atlas thinks it has lettered. */
  unlettered(x0: number, x1: number): { count: number; withEntry: number; sample: string[] } {
    const out = { count: 0, withEntry: 0, sample: [] as string[] };
    if (!this.layout) return out;
    for (const s of this.layout.spines) {
      if (s.x + s.w < x0 || s.x > x1) continue;
      if (this.entryFor(s.index)) continue;
      out.count++;
      const e = this.atlas.get(s.repo.id);
      if (e) out.withEntry++;
      if (out.sample.length < 5) out.sample.push(`${s.repo.name}@${Math.round(s.x)} key=${this.atlas.keyFor(s.repo, s.w, s.h, this.staleDays).slice(0, 40)} entry=${e?.key.slice(0, 40)}`);
    }
    return out;
  }

  pullOf(id: string): number {
    return this.pulls.get(id)?.cur ?? 0;
  }

  dispose(): void {
    this.fallback?.dispose();
    this.fallbackMat.dispose();
    for (const pm of this.pages) this.disposePage(pm);
    this.atlas.dispose();
  }
}
