import path from 'node:path';
import { buildStaticSite } from '../server/publish.js';
import { refreshPublicMetadata } from '../src/githubLive.js';
import type { AppState } from '../server/types.js';
import { readPublicLibrary, readPublicSkills } from './public-library.js';
import { refreshPublicUpstreams } from './github-upstream.js';

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  // The checked-in public library is the one canonical repo dataset used by Pages.
  // catalog.public.json is an updater input, not a second build-time shelf source.
  const snapshot = await readPublicLibrary(root);
  const skills = await readPublicSkills(root);
  const state: AppState = {
    shelves: snapshot.shelves,
    repos: snapshot.repos,
    github: { available: false, login: snapshot.owner },
    config: { staleAfterDays: 365 },
  };
  if (process.env.SHELF_SKIP_GITHUB_REFRESH !== '1') {
    state.repos = await refreshPublicMetadata(state.repos, snapshot.owner);
    const upstreams = await refreshPublicUpstreams(state.repos);
    state.repos = upstreams.repos;
    console.log(`Upstream stars: ${upstreams.refreshed} refreshed, ${upstreams.cached} cached, ${upstreams.unavailable} unavailable (${upstreams.requested} public upstreams).`);
  }
  const result = await buildStaticSite(state, {
    staticDist: path.join(root, 'dist-static'),
    outDir: path.join(root, 'dist-pages'),
    owner: snapshot.owner,
    title: snapshot.title,
    pagesFor: async (repo) => snapshot.pages?.[repo.id] ?? null,
    skills,
  });
  console.log(`Built ${result.repos} books on ${result.shelves} purpose shelves with ${result.skills} skills in ${result.dir}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
