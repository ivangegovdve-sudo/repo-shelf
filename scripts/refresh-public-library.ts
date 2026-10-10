import fs from 'node:fs/promises';
import path from 'node:path';
import { catalogToState, parseCatalog } from '../server/catalog.js';
import { sanitizeForPublish } from '../server/publish.js';
import { refreshPublicMetadata } from '../src/githubLive.js';
import { publicLibraryState, readPublicLibrary } from './public-library.js';
import { refreshPublicUpstreams } from './github-upstream.js';

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  const snapshot = await readPublicLibrary(root);
  const document = parseCatalog(JSON.parse(await fs.readFile(path.join(root, 'data', 'catalog.public.json'), 'utf8')) as unknown);
  const state = publicLibraryState(snapshot, catalogToState(document), document.generated_at);
  const accountRepos = await refreshPublicMetadata(state.repos, snapshot.owner);
  const upstreams = await refreshPublicUpstreams(accountRepos);
  const published = sanitizeForPublish({ ...state, repos: upstreams.repos }, snapshot.owner);
  console.log(`Upstream stars: ${upstreams.refreshed} refreshed, ${upstreams.cached} cached, ${upstreams.unavailable} unavailable (${upstreams.requested} public upstreams).`);
  const file = path.join(root, 'data', 'library.public.json');
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify({ ...snapshot, ...published, generatedAt: new Date().toISOString() })}\n`, 'utf8');
  await fs.rename(`${file}.tmp`, file);
  console.log(`Saved the complete public library: ${published.repos.length} books, including ${Math.max(0, published.repos.length - snapshot.repos.length)} additions; published cards, pages and attribution preserved.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
