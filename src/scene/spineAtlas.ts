import * as THREE from 'three';
import type { Repo } from '../types';
import { displayName } from '../derive';
import { spineStyle, type SpineStyle } from './spineStyle';
import { visualKey } from './textures';

/**
 * Wall spines are drawn lazily into shared atlas pages, never one texture per
 * book. A spine is lettered at SPINE_ATLAS.texH texels tall (1.4 to 1.7
 * texels per CSS px on a 1080p wall), about a fifteenth of the pixels of a
 * 512×768 cover. Pages are allocated only when a spine first comes into
 * view, and the least recently seen page is recycled once `maxPages` is
 * reached, so memory has a hard ceiling whatever the library size.
 */
export const SPINE_ATLAS = {
  page: 1024,
  texH: 256,
  rowsPerPage: 4,
  /** Gap between spines in a page, so mipmaps do not bleed neighbours together. */
  gutter: 4,
  /** Solid colour column after each spine: sampled by the book's sides and top. */
  swatch: 3,
  /** Instances per page mesh. */
  capacity: 128,
  maxPages: 16,
} as const;

export const SPINE_FONT = '"Barlow Semi Condensed", "Inter", system-ui, sans-serif';
const PAGE_BYTES = SPINE_ATLAS.page * SPINE_ATLAS.page * 4 * (4 / 3);

export interface AtlasEntry {
  key: string;
  repoId: string;
  page: AtlasPage;
  slot: number;
  /** u0, v0, du, dv of the spine face in the page texture. */
  rect: [number, number, number, number];
}

export interface AtlasPage {
  index: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  cursors: number[];
  slots: (AtlasEntry | null)[];
  lastSeen: number;
  dirty: boolean;
}

export interface AtlasStats {
  pages: number;
  spines: number;
  bytes: number;
  maxBytes: number;
  drawn: number;
  evictions: number;
  /** Total time spent lettering spines on the CPU, ms. */
  paintMs: number;
  uploads: number;
}

function mix(color: string, target: string, t: number): string {
  const a = new THREE.Color(color);
  a.lerp(new THREE.Color(target), t);
  return `#${a.getHexString()}`;
}

function fitTitle(ctx: CanvasRenderingContext2D, text: string, maxLen: number, size: number, minSize: number, weight: number): { text: string; size: number } {
  let px = size;
  ctx.font = `${weight} ${px}px ${SPINE_FONT}`;
  while (ctx.measureText(text).width > maxLen && px > minSize) {
    px = Math.max(minSize, px - 0.5);
    ctx.font = `${weight} ${px}px ${SPINE_FONT}`;
  }
  if (ctx.measureText(text).width <= maxLen) return { text, size: px };
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut).trimEnd()}…`).width > maxLen) cut--;
  return { text: `${text.slice(0, cut).trimEnd()}…`, size: px };
}

/**
 * Paint one spine in CSS px units: (0,0) is the top-left of the spine face,
 * w×h its size on the wall. The caller scales the context to texels.
 */
export function paintSpine(ctx: CanvasRenderingContext2D, repo: Repo, style: SpineStyle, w: number, h: number): void {
  const { cloth, ink, accent, edition } = style;
  const pale = edition === 'reference';
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, w, h);

  // Book cloth weave: fine vertical threads and a faint horizontal grain.
  ctx.fillStyle = pale ? 'rgba(90,80,60,0.05)' : 'rgba(255,255,255,0.035)';
  for (let x = 0.5; x < w; x += 1.5) ctx.fillRect(x, 0, 0.5, h);
  ctx.fillStyle = pale ? 'rgba(60,50,30,0.04)' : 'rgba(0,0,0,0.06)';
  for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 0.5);

  // Rounded spine: darker edges, a soft highlight a third of the way across.
  const round = ctx.createLinearGradient(0, 0, w, 0);
  round.addColorStop(0, pale ? 'rgba(40,30,20,0.28)' : 'rgba(0,0,0,0.45)');
  round.addColorStop(0.18, 'rgba(0,0,0,0.04)');
  round.addColorStop(0.36, pale ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)');
  round.addColorStop(0.62, 'rgba(0,0,0,0)');
  round.addColorStop(1, pale ? 'rgba(40,30,20,0.3)' : 'rgba(0,0,0,0.5)');
  ctx.fillStyle = round;
  ctx.fillRect(0, 0, w, h);
  // Worn head and tail.
  const wear = ctx.createLinearGradient(0, 0, 0, h);
  wear.addColorStop(0, 'rgba(0,0,0,0.22)');
  wear.addColorStop(0.035, 'rgba(0,0,0,0)');
  wear.addColorStop(0.965, 'rgba(0,0,0,0)');
  wear.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = wear;
  ctx.fillRect(0, 0, w, h);

  let top = 12;
  let bottom = h - 12;
  const inset = Math.max(1.5, w * 0.1);

  if (style.head === 'gilt-rules') {
    ctx.fillStyle = accent;
    for (const y of [7, 10.5]) ctx.fillRect(inset, y, w - inset * 2, 1.1);
    for (const y of [h - 11.5, h - 8]) ctx.fillRect(inset, y, w - inset * 2, 1.1);
    top = 17;
    bottom = h - 17;
  } else if (style.head === 'copper-band') {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 6, w, 13);
    ctx.fillStyle = 'rgba(255,240,210,0.55)';
    ctx.fillRect(0, 6, w, 0.8);
    ctx.fillRect(0, 18.2, w, 0.8);
    ctx.fillStyle = accent;
    ctx.fillRect(inset, h - 9, w - inset * 2, 1.2);
    top = 25;
    bottom = h - 14;
  } else if (style.head === 'rule') {
    ctx.fillStyle = pale ? 'rgba(38,40,45,0.55)' : 'rgba(246,244,238,0.7)';
    ctx.fillRect(inset, 8, w - inset * 2, 0.9);
    top = 14;
  }

  if (style.foot === 'ornament') {
    // Gilt lozenge.
    const cx = w / 2;
    const cy = h - 24;
    const r = Math.min(4, w * 0.16);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.75, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.75, cy);
    ctx.closePath();
    ctx.fill();
    bottom = h - 32;
  } else if (style.foot === 'fork') {
    // Fork glyph: two branches joining into one stem.
    const cx = w / 2;
    const cy = h - 24;
    const s = Math.min(5, w * 0.2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s);
    ctx.quadraticCurveTo(cx - s, cy, cx, cy + s * 0.2);
    ctx.moveTo(cx + s, cy - s);
    ctx.quadraticCurveTo(cx + s, cy, cx, cy + s * 0.2);
    ctx.moveTo(cx, cy + s * 0.2);
    ctx.lineTo(cx, cy + s * 1.2);
    ctx.stroke();
    bottom = h - 33;
  } else if (style.foot === 'call-number') {
    // Library call-number sticker: this copy is archived reference material.
    const sw = Math.max(8, w - 5);
    const sx = (w - sw) / 2;
    const sy = h - 27;
    ctx.fillStyle = '#fbf8f0';
    ctx.fillRect(sx, sy, sw, 17);
    ctx.strokeStyle = 'rgba(38,40,45,0.55)';
    ctx.lineWidth = 0.7;
    ctx.strokeRect(sx + 0.35, sy + 0.35, sw - 0.7, 16.3);
    ctx.fillStyle = accent;
    ctx.fillRect(sx + 2, sy + 4, sw - 4, 1.6);
    ctx.fillStyle = 'rgba(38,40,45,0.6)';
    ctx.fillRect(sx + 2, sy + 8.5, (sw - 4) * 0.8, 1);
    ctx.fillRect(sx + 2, sy + 11.5, (sw - 4) * 0.55, 1);
    bottom = h - 33;
  }

  if (edition === 'plain' && !repo.doc) {
    if ((repo.github?.stars ?? 0) > 0) {
      ctx.fillStyle = '#d9b545';
      ctx.fillRect(0, 14, w, 5);
      top = Math.max(top, 23);
    }
    if (repo.dirtyCount > 0) {
      ctx.fillStyle = '#c8352b';
      ctx.beginPath();
      ctx.moveTo(w - Math.min(10, w * 0.5), 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, Math.min(10, w * 0.5));
      ctx.closePath();
      ctx.fill();
    }
    if (repo.virtual) {
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = 'rgba(246,244,238,0.5)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
      ctx.setLineDash([]);
    }
  }
  if (repo.catalog && (repo.catalog.cardStale || repo.catalog.verificationStatus === 'unverified')) {
    ctx.fillStyle = '#b8402f';
    ctx.fillRect(w - 1.6, 0, 1.6, h);
  }

  // Title, reading top to bottom like an English-language spine.
  const title = displayName(repo.name);
  const weight = edition === 'reference' ? 600 : 700;
  const size = Math.min(15, Math.max(10.5, w * 0.58));
  const fit = fitTitle(ctx, title, bottom - top, size, Math.max(10, size * 0.84), weight);
  ctx.save();
  ctx.translate(w / 2, (top + bottom) / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${weight} ${fit.size}px ${SPINE_FONT}`;
  if (edition === 'original' || repo.doc) {
    // Stamped gilt: a dark impression under the foil.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(fit.text, 0.5, 0.6);
  } else if (!pale) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(fit.text, 0.4, 0.5);
  }
  ctx.fillStyle = ink;
  ctx.fillText(fit.text, 0, 0);
  ctx.restore();
}

export class SpineAtlas {
  pages: AtlasPage[] = [];
  entries = new Map<string, AtlasEntry>();
  drawn = 0;
  evictions = 0;
  paintMs = 0;
  uploads = 0;
  /** Called when a page is recycled so its instances can be hidden. */
  onEvict: ((page: AtlasPage, evicted: AtlasEntry[]) => void) | null = null;

  get(repoId: string): AtlasEntry | undefined {
    return this.entries.get(repoId);
  }

  keyFor(repo: Repo, w: number, h: number, staleDays: number): string {
    return `${w}x${h}|${visualKey(repo, staleDays)}`;
  }

  /**
   * Letter one spine into the atlas. Returns null when every page is full
   * and all of them hold spines seen this frame (the caller shows a plain
   * cloth spine until something scrolls away).
   */
  draw(repo: Repo, w: number, h: number, staleDays: number, frame: number): AtlasEntry | null {
    const key = this.keyFor(repo, w, h, staleDays);
    const existing = this.entries.get(repo.id);
    if (existing?.key === key) return existing;
    if (existing) this.release(existing);

    const { page: size, texH, rowsPerPage, gutter, swatch } = SPINE_ATLAS;
    const tw = Math.max(8, Math.round((texH * w) / h));
    const need = tw + swatch + gutter;
    const place = this.findSpace(need, frame);
    if (!place) return null;
    const { page, row } = place;
    const rowH = Math.floor(size / rowsPerPage);
    const sx = page.cursors[row];
    const sy = row * rowH + Math.floor((rowH - texH) / 2);
    page.cursors[row] += need;

    const t0 = performance.now();
    const ctx = page.ctx;
    const style = spineStyle(repo, staleDays);
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, tw, texH);
    ctx.clip();
    ctx.translate(sx, sy);
    ctx.scale(tw / w, texH / h);
    paintSpine(ctx, repo, style, w, h);
    ctx.restore();
    // Swatch: top half is the cloth for the book's sides, bottom half the page block for its top.
    ctx.fillStyle = mix(style.cloth, '#000000', 0.38);
    ctx.fillRect(sx + tw, sy, swatch, texH / 2);
    ctx.fillStyle = '#e9e0cb';
    ctx.fillRect(sx + tw, sy + texH / 2, swatch, texH / 2);
    this.paintMs += performance.now() - t0;

    const slot = page.slots.indexOf(null);
    const entry: AtlasEntry = {
      key,
      repoId: repo.id,
      page,
      slot: slot >= 0 ? slot : page.slots.length,
      rect: [sx / size, 1 - (sy + texH) / size, tw / size, texH / size],
    };
    if (slot >= 0) page.slots[slot] = entry;
    else page.slots.push(entry);
    page.dirty = true;
    page.lastSeen = frame;
    this.entries.set(repo.id, entry);
    this.drawn++;
    return entry;
  }

  private release(entry: AtlasEntry): void {
    entry.page.slots[entry.slot] = null;
    this.entries.delete(entry.repoId);
  }

  private findSpace(need: number, frame: number): { page: AtlasPage; row: number } | null {
    for (const page of this.pages) {
      if (page.slots.filter(Boolean).length >= SPINE_ATLAS.capacity) continue;
      const row = page.cursors.findIndex((x) => x + need <= SPINE_ATLAS.page);
      if (row >= 0) return { page, row };
    }
    if (this.pages.length < SPINE_ATLAS.maxPages) {
      const page = this.newPage();
      return { page, row: 0 };
    }
    const victim = [...this.pages].filter((p) => p.lastSeen < frame).sort((a, b) => a.lastSeen - b.lastSeen)[0];
    if (!victim) return null;
    this.recycle(victim);
    return { page: victim, row: 0 };
  }

  private newPage(): AtlasPage {
    const canvas = document.createElement('canvas');
    canvas.width = SPINE_ATLAS.page;
    canvas.height = SPINE_ATLAS.page;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    const page: AtlasPage = {
      index: this.pages.length,
      canvas,
      ctx,
      texture,
      cursors: Array.from({ length: SPINE_ATLAS.rowsPerPage }, () => 0),
      slots: [],
      lastSeen: 0,
      dirty: true,
    };
    this.pages.push(page);
    return page;
  }

  private recycle(page: AtlasPage): void {
    const evicted = page.slots.filter((e): e is AtlasEntry => e !== null);
    for (const e of evicted) this.entries.delete(e.repoId);
    page.slots = [];
    page.cursors = page.cursors.map(() => 0);
    page.ctx.clearRect(0, 0, SPINE_ATLAS.page, SPINE_ATLAS.page);
    page.dirty = true;
    this.evictions++;
    this.onEvict?.(page, evicted);
  }

  /** Upload pages lettered since the last frame. */
  flush(): number {
    let uploads = 0;
    for (const page of this.pages) {
      if (!page.dirty) continue;
      page.texture.needsUpdate = true;
      page.dirty = false;
      uploads++;
      this.uploads++;
    }
    return uploads;
  }

  dispose(): void {
    for (const page of this.pages) page.texture.dispose();
    this.pages = [];
    this.entries.clear();
  }

  stats(): AtlasStats {
    return {
      pages: this.pages.length,
      spines: this.entries.size,
      bytes: this.pages.length * PAGE_BYTES,
      maxBytes: SPINE_ATLAS.maxPages * PAGE_BYTES,
      drawn: this.drawn,
      evictions: this.evictions,
      paintMs: Math.round(this.paintMs),
      uploads: this.uploads,
    };
  }
}

export const SPINE_ATLAS_MAX_BYTES = SPINE_ATLAS.maxPages * PAGE_BYTES;
