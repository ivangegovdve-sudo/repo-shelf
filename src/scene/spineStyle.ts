import type { Repo } from '../types';
import { bookColor, editionOf, isStale, languageOf, type Edition } from '../derive';

/**
 * How a spine announces its edition with no hover and no cover. Three
 * redundant channels, so it survives at 16 px wide:
 *  - luminance: reference copies are pale archival buckram; Ivan's work is dark cloth
 *  - hue + lettering: originals burgundy with gilt, adapted forks navy with cream
 *    (red vs blue stays distinct under deuteranopia)
 *  - marks: gilt rules + ornament / copper head band + fork glyph / call-number sticker
 */
export interface SpineStyle {
  edition: Edition;
  cloth: string;
  ink: string;
  /** Head decoration. */
  head: 'gilt-rules' | 'copper-band' | 'rule' | 'none';
  /** Foot decoration. */
  foot: 'ornament' | 'fork' | 'call-number' | 'none';
  accent: string;
}

export const EDITION_CLOTH: Record<Exclude<Edition, 'plain'>, readonly string[]> = {
  original: ['#6d1f2f', '#5f1b2a', '#772532', '#661f36'],
  adapted: ['#1f3459', '#253c63', '#1b2f51', '#2a3f62'],
  reference: ['#e5e1d6', '#dde0da', '#e4dccd', '#dadfe4'],
};

export const EDITION_INK: Record<Exclude<Edition, 'plain'>, string> = {
  original: '#e6c77c',
  adapted: '#f2e9d4',
  reference: '#26282d',
};

export const EDITION_ACCENT: Record<Exclude<Edition, 'plain'>, string> = {
  original: '#d9b560',
  adapted: '#cf7c3c',
  reference: '#8a4a3c',
};

export const EDITION_LABEL: Record<Edition, string> = {
  original: "Ivan's original",
  adapted: 'Adapted fork',
  reference: 'Reference copy',
  plain: 'Repository',
};

const LEATHER = ['#5b2f23', '#3b4a3a', '#2f3f5a', '#6a4a1f', '#4a2f4a', '#2f5248'];

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stale repos fade: half the saturation, a little lighter. */
function faded(color: string): string {
  const [r, g, b] = rgb(color);
  const grey = (r + g + b) / 3;
  const mix = (c: number) => Math.round((c * 0.45 + grey * 0.55) * 0.82 + 255 * 0.18);
  return `#${[mix(r), mix(g), mix(b)].map((c) => Math.min(255, c).toString(16).padStart(2, '0')).join('')}`;
}

export function spineStyle(repo: Repo, staleDays: number): SpineStyle {
  const edition = editionOf(repo);
  if (edition !== 'plain') {
    const family = EDITION_CLOTH[edition];
    return {
      edition,
      cloth: family[hash(repo.id || repo.name) % family.length],
      ink: EDITION_INK[edition],
      head: edition === 'original' ? 'gilt-rules' : edition === 'adapted' ? 'copper-band' : 'rule',
      foot: edition === 'original' ? 'ornament' : edition === 'adapted' ? 'fork' : 'call-number',
      accent: EDITION_ACCENT[edition],
    };
  }
  if (repo.doc) return { edition, cloth: LEATHER[hash(repo.name) % LEATHER.length], ink: '#e6c77c', head: 'gilt-rules', foot: 'none', accent: '#d9b560' };
  const base = bookColor(languageOf(repo));
  const color = !repo.virtual && isStale(repo, staleDays) ? faded(base) : base;
  return { edition, cloth: color, ink: '#f6f4ee', head: 'rule', foot: 'none', accent: '#f6f4ee' };
}

/** Parse #rgb / #rrggbb / hsl(h s% l%) into 0-255 channels. */
export function rgb(color: string): [number, number, number] {
  const hsl = color.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  if (hsl) {
    const h = Number(hsl[1]) / 360;
    const s = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t: number) => {
      const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((c) => Math.round(c * 255)) as [number, number, number];
  }
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function hueOf(color: string): number {
  const [r, g, b] = rgb(color).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
