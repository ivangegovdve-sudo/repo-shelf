import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCatalogSite } from '../../scripts/build-catalog-site';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('catalog static build', () => {
  it('emits one file:// compatible HTML document with embedded data and assets', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-shelf-catalog-'));
    temporary.push(outDir);
    const result = await buildCatalogSite(path.resolve('tests/fixtures/catalog.sample.json'), outDir);
    const html = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
    expect(result).toMatchObject({ repos: 4, files: 1 });
    expect(html).toContain('window.__REPO_CATALOG__');
    expect(html).toContain('example/council');
    expect(html).toContain('<style>');
    expect(html).not.toContain('type="module"');
    expect(html).not.toMatch(/(?:src|href)=["'](?:https?:|\.\/)/);
  });

  it('rejects a count mismatch instead of silently dropping books', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-shelf-bad-catalog-'));
    temporary.push(root);
    const catalogPath = path.join(root, 'catalog.json');
    const fixture = JSON.parse(await fs.readFile('tests/fixtures/catalog.sample.json', 'utf8'));
    fixture.repo_count = 99;
    await fs.writeFile(catalogPath, JSON.stringify(fixture));
    await expect(buildCatalogSite(catalogPath, path.join(root, 'out'))).rejects.toThrow(/declares 99 repositories/);
  });
});
