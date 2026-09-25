import fs from 'node:fs/promises';
import path from 'node:path';
import { catalogToState } from '../server/catalog.js';
import { buildStaticSite } from '../server/publish.js';

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'data', 'catalog.public.json'), 'utf8')) as unknown;
  const state = catalogToState(catalog);
  const result = await buildStaticSite(state, {
    staticDist: path.join(root, 'dist-static'),
    outDir: path.join(root, 'dist-pages'),
    owner: 'ivangegovdve-sudo',
    title: "Ivan's 3D repository library",
  });
  console.log(`Built ${result.repos} books on ${result.shelves} purpose shelves in ${result.dir}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
