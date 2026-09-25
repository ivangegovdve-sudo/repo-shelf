import fs from 'node:fs/promises';
import path from 'node:path';
import { catalogToState, parseCatalog } from '../server/catalog.js';
import { buildStaticSite } from '../server/publish.js';

async function main(): Promise<void> {
  const inputArg = process.argv[2];
  if (!inputArg) throw new Error('Usage: npm run build:library:local -- /path/to/catalog.json [output-directory]');

  const root = path.resolve(process.cwd());
  const input = path.resolve(inputArg);
  const output = path.resolve(process.argv[3] ?? path.join(root, 'catalog-full-site'));
  if (output === root || output.startsWith(path.join(root, '.git'))) {
    throw new Error('Refusing to write the local library over the repository or its Git metadata.');
  }

  const document = parseCatalog(JSON.parse(await fs.readFile(input, 'utf8')) as unknown);
  const state = catalogToState(document);
  const result = await buildStaticSite(state, {
    staticDist: path.join(root, 'dist-static'),
    outDir: output,
    owner: 'ivangegovdve-sudo',
    title: "Ivan's complete repository library (local)",
  });
  if (result.repos !== document.repo_count) {
    throw new Error(`Expected ${document.repo_count} books but the local build contains ${result.repos}.`);
  }
  console.log(`Built all ${result.repos} catalog books on ${result.shelves} purpose shelves in ${result.dir}`);
  console.log('Open it with `npm run preview:library:local` (browsers will not load it from file://).');
  console.log('Local-only output may contain non-public repository names. Do not publish it.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
