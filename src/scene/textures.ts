import * as THREE from 'three';
import type { Repo } from '../types';
import { bookColor, displayName, hasGoldBand, hasRedTab, isStale, languageOf } from '../derive';
import type { Theme } from '../themes';

const cache = new Map<string, { key: string; spine: THREE.CanvasTexture; cover: THREE.CanvasTexture; page: THREE.CanvasTexture }>();
const MAX_BOOK_TEXTURES = 240;

function visualKey(r: Repo, staleDays: number): string {
  return [r.name, languageOf(r), r.dirtyCount > 0, r.github?.stars ?? 0, r.virtual ? 'link' : isStale(r, staleDays), r.github?.description ?? '', r.visibility, r.archived, r.catalog?.kind, r.catalog?.upstream, r.catalog?.cardStale, r.catalog?.verificationStatus, r.catalog?.alive, r.lastCommitAt].join('|');
}

function desaturate(hex: string, amount = 0.55): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * (1 - amount), Math.min(0.8, hsl.l + 0.18));
  return `#${c.getHexString()}`;
}

function darken(hex: string, amount = 0.25): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, hsl.l * (1 - amount)));
  return `#${c.getHexString()}`;
}

const LEATHER = ['#5b2f23', '#3b4a3a', '#2f3f5a', '#6a4a1f', '#4a2f4a', '#2f5248'];

function leatherFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return LEATHER[h % LEATHER.length];
}

export function baseColor(r: Repo, staleDays: number): string {
  if (r.doc) return leatherFor(r.name);
  if (r.catalog) return catalogColors(r).cloth;
  const c = bookColor(languageOf(r));
  if (r.virtual) return c;
  return isStale(r, staleDays) ? desaturate(c) : c;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number, minPx: number, family: string, weight = 600): number {
  let px = startPx;
  while (px > minPx) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 2;
  }
  return px;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

const SERIF = '"Manrope", "Inter", system-ui, sans-serif';
const SANS = '"Inter", system-ui, sans-serif';
const BOOK_SERIF = '"Iowan Old Style", Baskerville, Georgia, serif';

const PURPOSE_LABELS: Record<string, string> = {
  'mcp-integrations': 'MCP & INTEGRATIONS', 'voice-audio': 'VOICE & AUDIO', 'video-creative': 'VIDEO & CREATIVE',
  'finance-trading': 'FINANCE & TRADING', 'security-privacy': 'SECURITY & PRIVACY', 'mobile-devices': 'MOBILE & DEVICES',
  'knowledge-memory': 'KNOWLEDGE & MEMORY', 'models-learning': 'MODELS & LEARNING', 'agents-assistants': 'AGENTS & ASSISTANTS',
  'web-automation': 'WEB & AUTOMATION', 'developer-tools': 'DEVELOPER TOOLS', 'data-infrastructure': 'DATA & INFRASTRUCTURE',
  unshelved: 'UNSHELVED COLLECTION',
};

const PURPOSE_COLORS: Record<string, [string, string]> = {
  'mcp-integrations': ['#173f53', '#66d4c5'], 'voice-audio': ['#672f3a', '#ef9b79'], 'video-creative': ['#4a356b', '#e7bf63'],
  'finance-trading': ['#244d3c', '#d6b65d'], 'security-privacy': ['#313840', '#e06757'], 'mobile-devices': ['#145a62', '#e5c954'],
  'knowledge-memory': ['#253e63', '#d8c99d'], 'models-learning': ['#493b73', '#8fd2d0'], 'agents-assistants': ['#65382e', '#e2b765'],
  'web-automation': ['#28547a', '#e99058'], 'developer-tools': ['#315742', '#a7c86a'], 'data-infrastructure': ['#354b5c', '#6ec0c2'],
  unshelved: ['#5a4a3e', '#c9b28d'],
};

function seedOf(value: string): number {
  let seed = 2166136261;
  for (let index = 0; index < value.length; index += 1) seed = Math.imul(seed ^ value.charCodeAt(index), 16777619);
  return seed >>> 0;
}

function catalogColors(r: Repo): { cloth: string; accent: string; paper: string; ink: string } {
  const [cloth, accent] = PURPOSE_COLORS[r.shelfId] ?? PURPOSE_COLORS.unshelved;
  if (r.catalog?.kind === 'reference-copy') return { cloth: desaturate(cloth, 0.72), accent: '#9d5547', paper: '#e9e2d3', ink: '#303338' };
  if (r.catalog?.kind === 'authored-fork') return { cloth: '#714822', accent, paper: '#f0e6d2', ink: '#29231d' };
  return { cloth, accent, paper: '#f2ead8', ink: '#25231f' };
}

function clothBackground(ctx: CanvasRenderingContext2D, width: number, height: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,.035)';
  for (let x = 0; x < width; x += 4) ctx.fillRect(x, 0, 1, height);
  ctx.fillStyle = 'rgba(0,0,0,.055)';
  for (let y = 0; y < height; y += 5) ctx.fillRect(0, y, width, 1);
  const shade = ctx.createRadialGradient(width * 0.52, height * 0.42, width * 0.1, width * 0.5, height * 0.5, height * 0.72);
  shade.addColorStop(0, 'rgba(255,255,255,.08)');
  shade.addColorStop(1, 'rgba(0,0,0,.22)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
}

function catalogMotif(ctx: CanvasRenderingContext2D, r: Repo, cx: number, cy: number, radius: number, accent: string): void {
  const seed = seedOf(r.name);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((seed % 31) - 15) * Math.PI / 180);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, radius * 0.018);
  ctx.globalAlpha = 0.88;
  const sides = 3 + (seed % 5);
  for (let ring = 0; ring < 3; ring += 1) {
    const rr = radius * (0.42 + ring * 0.22);
    ctx.beginPath();
    for (let point = 0; point <= sides; point += 1) {
      const angle = (point / sides) * Math.PI * 2 + ring * 0.18;
      const x = Math.cos(angle) * rr;
      const y = Math.sin(angle) * rr;
      if (point === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.32;
  for (let line = -2; line <= 2; line += 1) {
    ctx.beginPath();
    ctx.moveTo(-radius, line * radius * 0.22);
    ctx.lineTo(radius, -line * radius * 0.15);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCatalogSpine(r: Repo): HTMLCanvasElement {
  const W = 128;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const colors = catalogColors(r);
  clothBackground(ctx, W, H, colors.cloth);
  const reference = r.catalog!.kind === 'reference-copy';
  if (reference) {
    ctx.fillStyle = colors.paper;
    ctx.fillRect(18, 58, W - 36, H - 116);
    ctx.strokeStyle = 'rgba(48,51,56,.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 58, W - 36, H - 116);
  } else {
    ctx.fillStyle = colors.accent;
    ctx.fillRect(0, 24, W, 8);
    ctx.fillRect(0, H - 32, W, 8);
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    for (const y of [62, H - 68]) ctx.fillRect(0, y, W, 3);
  }
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(0,0,0,.35)');
  grad.addColorStop(.45, 'rgba(255,255,255,.08)');
  grad.addColorStop(1, 'rgba(0,0,0,.3)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = reference ? colors.ink : '#f7f0df';
  const title = displayName(r.name);
  const px = fitText(ctx, title, H - 190, 42, 18, BOOK_SERIF, 700);
  ctx.font = `700 ${px}px ${BOOK_SERIF}`;
  ctx.fillText(title, 0, -5);
  ctx.font = `600 13px ${SANS}`;
  ctx.fillStyle = colors.accent;
  const edition = reference ? 'REFERENCE EDITION' : r.catalog!.kind === 'authored-fork' ? 'ADAPTED EDITION' : "IVAN'S ORIGINAL";
  ctx.fillText(edition, 0, px / 2 + 17);
  ctx.restore();
  ctx.fillStyle = reference ? colors.accent : '#f4ead4';
  ctx.font = `700 12px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText((PURPOSE_LABELS[r.shelfId] ?? 'COLLECTION').split(' ')[0], W / 2, H - 12);
  if (r.catalog!.cardStale || r.catalog!.verificationStatus === 'unverified') {
    ctx.fillStyle = '#a33f35';
    ctx.fillRect(W - 12, 0, 12, H);
  }
  return canvas;
}

function drawCatalogCover(r: Repo): HTMLCanvasElement {
  const W = 512;
  const H = 768;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const colors = catalogColors(r);
  const meta = r.catalog!;
  const reference = meta.kind === 'reference-copy';
  clothBackground(ctx, W, H, colors.cloth);
  ctx.strokeStyle = reference ? 'rgba(48,51,56,.35)' : colors.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(32, 32, W - 64, H - 64);
  ctx.strokeRect(42, 42, W - 84, H - 84);

  if (reference) {
    ctx.fillStyle = colors.paper;
    ctx.fillRect(62, 90, W - 124, H - 180);
    ctx.strokeStyle = 'rgba(48,51,56,.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(62, 90, W - 124, H - 180);
  } else {
    catalogMotif(ctx, r, W / 2, 450, 100, colors.accent);
    if (meta.kind === 'authored-fork') {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(42, 42, 30, H - 84);
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = colors.accent;
  ctx.font = `700 15px ${SANS}`;
  ctx.fillText(PURPOSE_LABELS[r.shelfId] ?? 'REPOSITORY COLLECTION', W / 2, 82);

  ctx.fillStyle = reference ? colors.ink : '#f7f0df';
  ctx.textBaseline = 'top';
  const title = displayName(r.name);
  let px = 58;
  ctx.font = `700 ${px}px ${BOOK_SERIF}`;
  let lines = wrap(ctx, title, W - (reference ? 170 : 115));
  while (lines.length > 3 && px > 30) {
    px -= 4;
    ctx.font = `700 ${px}px ${BOOK_SERIF}`;
    lines = wrap(ctx, title, W - (reference ? 170 : 115));
  }
  let y = reference ? 140 : 120;
  for (const line of lines.slice(0, 3)) {
    ctx.fillText(line, W / 2, y);
    y += px * 1.02;
  }

  if (reference) {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(110, y + 16);
    ctx.lineTo(W - 110, y + 16);
    ctx.stroke();
    ctx.fillStyle = colors.accent;
    ctx.font = `700 16px ${SANS}`;
    ctx.fillText('REFERENCE EDITION', W / 2, y + 34);
    ctx.fillStyle = colors.ink;
    ctx.font = `500 17px ${SANS}`;
    const source = `SOURCE · ${meta.upstream ?? 'UNKNOWN'}`;
    const sourcePx = fitText(ctx, source, W - 170, 17, 11, SANS, 500);
    ctx.font = `500 ${sourcePx}px ${SANS}`;
    ctx.fillText(source, W / 2, y + 72);
    catalogMotif(ctx, r, W / 2, 475, 60, colors.accent);
  } else {
    ctx.fillStyle = 'rgba(247,240,223,.82)';
    ctx.font = `500 16px ${SANS}`;
    const byline = meta.kind === 'original' ? 'AN ORIGINAL REPOSITORY BY IVAN GEGOV' : `ADAPTED FROM ${meta.upstream}`;
    const bylinePx = fitText(ctx, byline, W - 130, 16, 11, SANS, 500);
    ctx.font = `500 ${bylinePx}px ${SANS}`;
    ctx.fillText(byline, W / 2, y + 22);
  }

  const summary = r.summary ?? r.github?.description ?? '';
  ctx.font = `400 18px ${BOOK_SERIF}`;
  ctx.fillStyle = reference ? colors.ink : 'rgba(247,240,223,.88)';
  ctx.textBaseline = 'top';
  let summaryY = 570;
  for (const line of wrap(ctx, summary, W - 150).slice(0, 3)) {
    ctx.fillText(line, W / 2, summaryY);
    summaryY += 24;
  }

  const status = `${meta.alive ? 'ACTIVE' : 'DORMANT'} · PUSH ${r.lastCommitAt?.slice(0, 10) ?? 'UNKNOWN'}`;
  ctx.fillStyle = reference ? colors.ink : '#f7f0df';
  ctx.font = `600 13px ${SANS}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(status, W / 2, 706);
  const trust = [meta.cardStale ? 'STALE CARD' : '', meta.verificationStatus === 'unverified' ? 'UNVERIFIED' : ''].filter(Boolean).join(' · ');
  if (trust) {
    ctx.fillStyle = '#a33f35';
    ctx.font = `800 12px ${SANS}`;
    ctx.fillText(trust, W / 2, 732);
  }
  return canvas;
}

function drawSpine(r: Repo, staleDays: number): HTMLCanvasElement {
  if (r.catalog) return drawCatalogSpine(r);
  const W = 256;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const color = baseColor(r, staleDays);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  // subtle cloth texture: horizontal hairlines
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  // spine rounding: soft highlight down the middle
  const hl = ctx.createLinearGradient(0, 0, W, 0);
  hl.addColorStop(0, 'rgba(255,255,255,0)');
  hl.addColorStop(0.5, 'rgba(255,255,255,0.10)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, W, H);
  // edge shading
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.28)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(0.88, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // decorative bands top and bottom
  ctx.fillStyle = 'rgba(246,244,238,0.85)';
  ctx.fillRect(28, 52, W - 56, 4);
  ctx.fillRect(28, H - 56, W - 56, 4);
  // raised bands like a bound spine
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (const y of [H * 0.2, H * 0.8]) ctx.fillRect(0, y, W, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (const y of [H * 0.2 - 3, H * 0.8 - 3]) ctx.fillRect(0, y, W, 3);

  if (hasGoldBand(r)) {
    ctx.fillStyle = '#d9b545';
    ctx.fillRect(0, 80, W, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 100, W, 4);
  }
  if (hasRedTab(r)) {
    ctx.fillStyle = '#c8352b';
    ctx.beginPath();
    ctx.moveTo(W - 60, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, 60);
    ctx.closePath();
    ctx.fill();
  }

  // title, rotated to read top to bottom
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f6f4ee';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  const title = displayName(r.name);
  const px = fitText(ctx, title, H - 340, 80, 32, SERIF, 700);
  ctx.font = `700 ${px}px ${SERIF}`;
  ctx.fillText(title, 0, -8);
  ctx.shadowBlur = 0;
  ctx.font = `500 30px ${SANS}`;
  ctx.fillStyle = 'rgba(246,244,238,0.7)';
  const foot = r.doc ? 'GUIDE' : r.virtual ? (r.repoSlug ? (r.visibility === 'private' ? '🔒 PRIVATE' : 'PUBLIC  ↗') : 'LINK  ↗') : languageOf(r).toUpperCase();
  ctx.fillText(foot, 0, px / 2 + 32);
  if (r.archived) {
    ctx.font = `700 22px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('ARCHIVED', 0, -px / 2 - 34);
  }
  ctx.restore();
  if (r.virtual) {
    // dotted border: this book is not on disk yet
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(246,244,238,0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.setLineDash([]);
  }
  return canvas;
}

function drawCover(r: Repo, staleDays: number): HTMLCanvasElement {
  if (r.catalog) return drawCatalogCover(r);
  const W = 768;
  const H = 1152;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const color = baseColor(r, staleDays);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  // spine-side shadow
  const g = ctx.createLinearGradient(0, 0, 90, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 90, H);
  // board edge highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  // frame
  ctx.strokeStyle = 'rgba(246,244,238,0.7)';
  ctx.lineWidth = 4;
  ctx.strokeRect(70, 70, W - 140, H - 140);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(246,244,238,0.75)';
  ctx.font = `500 30px ${SANS}`;
  const attribution = r.doc ? 'HERMES AGENT · GUIDE' : r.virtual ? (r.repoSlug ? (r.visibility === 'private' ? '🔒 PRIVATE ON GITHUB' : 'PUBLIC ON GITHUB') : 'LINK  ↗') : languageOf(r).toUpperCase();
  ctx.fillText(attribution, W / 2, 165);

  ctx.fillStyle = '#f6f4ee';
  ctx.textBaseline = 'top';
  const title = displayName(r.name);
  let px = 90;
  ctx.font = `700 ${px}px ${SERIF}`;
  let lines = wrap(ctx, title, W - 210);
  while (lines.length > 3 && px > 44) {
    px -= 8;
    ctx.font = `700 ${px}px ${SERIF}`;
    lines = wrap(ctx, title, W - 210);
  }
  let y = 255;
  for (const line of lines.slice(0, 3)) {
    ctx.fillText(line, W / 2, y);
    y += px * 1.15;
  }

  const desc = r.github?.description ?? r.summary ?? '';
  if (desc) {
    ctx.font = `400 33px ${SANS}`;
    ctx.fillStyle = 'rgba(246,244,238,0.85)';
    const dl = wrap(ctx, desc, W - 225).slice(0, 5);
    y += 45;
    for (const line of dl) {
      ctx.fillText(line, W / 2, y);
      y += 45;
    }
  }

  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 33px ${SANS}`;
  ctx.fillStyle = 'rgba(246,244,238,0.8)';
  const foot: string[] = [];
  if (r.commitCount) foot.push(`${r.commitCount} commits`);
  if (r.github?.stars) foot.push(`★ ${r.github.stars.toLocaleString()}`);
  if (r.dirtyCount) foot.push(`${r.dirtyCount} uncommitted`);
  if (r.virtual) foot.push('not cloned yet');
  const footText = foot.join('  ·  ');
  const footPx = fitText(ctx, footText, W - 150, 33, 18, SANS, 500);
  ctx.font = `500 ${footPx}px ${SANS}`;
  ctx.fillText(footText, W / 2, H - 165);

  if (hasGoldBand(r)) {
    ctx.fillStyle = '#d9b545';
    ctx.fillRect(0, 90, W, 21);
  }
  return canvas;
}

/** First page inside the cover: title, description, a few facts. Shown when the book opens. */
function drawPage(r: Repo): HTMLCanvasElement {
  const W = 512;
  const H = 768;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4efe3';
  ctx.fillRect(0, 0, W, H);
  // faint ruled lines + gutter shadow
  ctx.fillStyle = 'rgba(0,0,0,0.045)';
  for (let y = 120; y < H - 60; y += 26) ctx.fillRect(56, y, W - 112, 1);
  const g = ctx.createLinearGradient(0, 0, 40, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 40, H);

  ctx.fillStyle = '#2a2622';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const title = displayName(r.name);
  let px = 44;
  ctx.font = `700 ${px}px ${SERIF}`;
  let lines = wrap(ctx, title, W - 140);
  while (lines.length > 3 && px > 24) {
    px -= 4;
    ctx.font = `700 ${px}px ${SERIF}`;
    lines = wrap(ctx, title, W - 140);
  }
  let y = 90;
  for (const line of lines.slice(0, 3)) {
    ctx.fillText(line, W / 2, y);
    y += px * 1.15;
  }
  ctx.font = `500 16px ${SANS}`;
  ctx.fillStyle = '#7a7268';
  ctx.fillText((r.repoSlug ?? r.name).toUpperCase(), W / 2, y + 6);
  y += 44;
  const desc = r.github?.description ?? r.summary ?? '';
  if (desc) {
    ctx.font = `400 19px ${SANS}`;
    ctx.fillStyle = '#3f3a34';
    for (const line of wrap(ctx, desc, W - 150).slice(0, 6)) {
      ctx.fillText(line, W / 2, y);
      y += 26;
    }
  }
  ctx.font = `500 15px ${SANS}`;
  ctx.fillStyle = '#7a7268';
  const facts: string[] = [];
  if (r.commitCount) facts.push(`${r.commitCount} commits`);
  if (r.branch) facts.push(`branch ${r.branch}`);
  if (r.github?.stars) facts.push(`${r.github.stars.toLocaleString()} stars`);
  if (r.visibility) facts.push(r.visibility);
  ctx.fillText(facts.join('  ·  '), W / 2, H - 120);
  ctx.font = `400 14px ${SANS}`;
  if (r.catalog?.upstream) {
    ctx.fillStyle = '#9a4d40';
    ctx.font = `700 14px ${SANS}`;
    ctx.fillText(`UPSTREAM SOURCE · ${r.catalog.upstream}`.toUpperCase(), W / 2, H - 88);
    ctx.fillStyle = '#7a7268';
    ctx.font = `400 13px ${SANS}`;
    ctx.fillText(r.catalog.kind === 'reference-copy' ? 'Zero commits ahead · catalogued as reference, not original work' : `${r.catalog.commitsAhead} commits ahead in Ivan's fork`, W / 2, H - 62);
  } else {
    ctx.fillText(r.catalog ? "Original repository by Ivan Gegov" : 'README, commits, issues and pull requests are on the pages to the right', W / 2, H - 88);
  }
  return canvas;
}

function makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export function bookTextures(r: Repo, staleDays: number): { spine: THREE.CanvasTexture; cover: THREE.CanvasTexture; page: THREE.CanvasTexture } {
  const key = visualKey(r, staleDays);
  const hit = cache.get(r.id);
  if (hit && hit.key === key) {
    cache.delete(r.id);
    cache.set(r.id, hit);
    return hit;
  }
  if (hit) {
    hit.spine.dispose();
    hit.cover.dispose();
    hit.page.dispose();
  }
  const entry = { key, spine: makeTexture(drawSpine(r, staleDays)), cover: makeTexture(drawCover(r, staleDays)), page: makeTexture(drawPage(r)) };
  cache.set(r.id, entry);
  while (cache.size > MAX_BOOK_TEXTURES) {
    const oldestId = cache.keys().next().value as string | undefined;
    if (!oldestId || oldestId === r.id) break;
    const oldest = cache.get(oldestId);
    cache.delete(oldestId);
    oldest?.spine.dispose();
    oldest?.cover.dispose();
    oldest?.page.dispose();
  }
  return entry;
}

export function sideColor(r: Repo, staleDays: number): string {
  return darken(baseColor(r, staleDays), 0.3);
}

let edgeTex: THREE.CanvasTexture | null = null;
/** Cream page stack with fine lines, used on the three exposed page edges. */
export function pageEdgeTexture(): THREE.CanvasTexture {
  if (edgeTex) return edgeTex;
  const W = 64;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#efe7d3';
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) {
    ctx.fillStyle = `rgba(120,100,70,${0.10 + Math.random() * 0.14})`;
    ctx.fillRect(0, y, W, 1);
  }
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.18)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  edgeTex = makeTexture(canvas);
  edgeTex.wrapS = THREE.RepeatWrapping;
  edgeTex.wrapT = THREE.RepeatWrapping;
  return edgeTex;
}

let woodTex: THREE.CanvasTexture | null = null;
export function woodTexture(): THREE.CanvasTexture {
  if (woodTex) return woodTex;
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#b9b0a4';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 120; i++) {
    const y = Math.random() * H;
    ctx.strokeStyle = `rgba(60,50,40,${0.12 + Math.random() * 0.22})`;
    ctx.lineWidth = 0.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 32) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 2.5);
    ctx.stroke();
  }
  const t = makeTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  woodTex = t;
  return t;
}

const backTexCache = new Map<string, THREE.CanvasTexture>();
export function backPanelTexture(theme: Theme): THREE.CanvasTexture {
  const hit = backTexCache.get(theme.id);
  if (hit) return hit;
  const W = 512;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(W / 2, H * 0.45, 20, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, theme.scene.back[0]);
  g.addColorStop(0.6, theme.scene.back[1]);
  g.addColorStop(1, theme.scene.back[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
  const tex = makeTexture(canvas);
  backTexCache.set(theme.id, tex);
  return tex;
}
