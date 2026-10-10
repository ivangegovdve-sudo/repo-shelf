import fs from 'node:fs/promises';
import path from 'node:path';
import { refreshPublicMetadata } from '../src/githubLive.js';
import { readPublicLibrary } from './public-library.js';
import { refreshPublicUpstreams } from './github-upstream.js';

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  const snapshot = await readPublicLibrary(root);
  const accountRepos = await refreshPublicMetadata(snapshot.repos, snapshot.owner);
  const upstreams = await refreshPublicUpstreams(accountRepos);
  const repos = upstreams.repos;
  console.log(`Upstream stars: ${upstreams.refreshed} refreshed, ${upstreams.cached} cached, ${upstreams.unavailable} unavailable (${upstreams.requested} public upstreams).`);
  if (repos === snapshot.repos) {
    console.log('GitHub metadata unavailable; kept the complete public library snapshot.');
    return;
  }
  const file = path.join(root, 'data', 'library.public.json');
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify({ ...snapshot, generatedAt: new Date().toISOString(), repos })}\n`, 'utf8');
  await fs.rename(`${file}.tmp`, file);
  console.log(`Refreshed public metadata for the existing ${repos.length} books; all attribution and shelves preserved.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
