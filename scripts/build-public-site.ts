import fs from 'node:fs/promises';
import path from 'node:path';
import { catalogToState } from '../server/catalog.js';
import { buildStaticSite } from '../server/publish.js';
import { refreshPublicMetadata } from '../src/githubLive.js';
import { publicLibraryState, readPublicLibrary } from './public-library.js';

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  // Preserve every deployed book, and keep public catalog refreshes able to add new ones.
  const snapshot = await readPublicLibrary(root);
  const catalog = catalogToState(JSON.parse(await fs.readFile(path.join(root, 'data', 'catalog.public.json'), 'utf8')) as unknown);
  const state = publicLibraryState(snapshot, catalog);
  if (process.env.SHELF_SKIP_GITHUB_REFRESH !== '1') {
    state.repos = await refreshPublicMetadata(state.repos, snapshot.owner);
  }
  const result = await buildStaticSite(state, {
    staticDist: path.join(root, 'dist-static'),
    outDir: path.join(root, 'dist-pages'),
    owner: snapshot.owner,
    title: snapshot.title,
    pagesFor: async (repo) => snapshot.pages?.[repo.id] ?? null,
  });
  console.log(`Built ${result.repos} books on ${result.shelves} purpose shelves in ${result.dir}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
