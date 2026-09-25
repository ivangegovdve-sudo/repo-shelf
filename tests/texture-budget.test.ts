import { describe, expect, it } from 'vitest';
import { BOOK_TEXTURE_BUDGET } from '../src/scene/textures';
import { SPINE_ATLAS, SPINE_ATLAS_MAX_BYTES } from '../src/scene/spineAtlas';

const MiB = 1024 * 1024;
const mipFactor = 4 / 3;

describe('book texture budget', () => {
  it('keeps the worst-case cached texture estimate below 160 MiB', () => {
    const spineBytes = BOOK_TEXTURE_BUDGET.spines * 128 * 512 * 4 * mipFactor;
    const detailBytes = BOOK_TEXTURE_BUDGET.details * 2 * 512 * 768 * 4 * mipFactor;
    expect((spineBytes + detailBytes) / MiB).toBeLessThan(160);
  });

  it('keeps every texture the spine-out wall can hold at once below 160 MiB', () => {
    // Worst case uses the largest canvases any book type draws: 256×1024 folder spines, 768×1152 folder covers.
    const viewerSpines = BOOK_TEXTURE_BUDGET.spines * 256 * 1024 * 4 * mipFactor;
    const details = BOOK_TEXTURE_BUDGET.details * (768 * 1152 + 512 * 768) * 4 * mipFactor;
    const fixed = (512 * 128 + 64 * 256 + 6 * 512 * 256 + 2048 * 64) * 4 * mipFactor; // wood, page edge, one back panel per theme, shadows
    const total = SPINE_ATLAS_MAX_BYTES + viewerSpines + details + fixed;
    expect(total / MiB).toBeLessThan(160);
  });

  it('spends far less texture on a wall spine than on a cover', () => {
    const referenceSpine = Math.round((SPINE_ATLAS.texH * 18) / 150) * SPINE_ATLAS.texH;
    expect(referenceSpine * 12).toBeLessThan(512 * 768);
  });

  it('can letter the whole 1,256-book library without recycling a page', () => {
    // A typical reference spine is 18×150 CSS px; every slot also carries a swatch and a gutter.
    const slot = Math.round((SPINE_ATLAS.texH * 18) / 150) + SPINE_ATLAS.swatch + SPINE_ATLAS.gutter;
    const perPage = Math.min(SPINE_ATLAS.capacity, SPINE_ATLAS.rowsPerPage * Math.floor(SPINE_ATLAS.page / slot));
    expect(perPage * SPINE_ATLAS.maxPages).toBeGreaterThanOrEqual(1256);
  });
});
