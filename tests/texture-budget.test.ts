import { describe, expect, it } from 'vitest';
import { BOOK_TEXTURE_BUDGET } from '../src/scene/textures';

describe('book texture budget', () => {
  it('keeps the worst-case cached texture estimate below 160 MiB', () => {
    const mipFactor = 4 / 3;
    const spineBytes = BOOK_TEXTURE_BUDGET.spines * 128 * 512 * 4 * mipFactor;
    const detailBytes = BOOK_TEXTURE_BUDGET.details * 2 * 512 * 768 * 4 * mipFactor;
    expect((spineBytes + detailBytes) / 1024 / 1024).toBeLessThan(160);
  });
});
