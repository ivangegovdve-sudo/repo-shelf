import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCatalog } from '../server/catalog.js';

const OWNER = 'ivangegovdve-sudo';

async function publicRepoNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/users/${OWNER}/repos?per_page=100&page=${page}&type=owner&sort=full_name`;
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'repo-shelf-catalog-refresh' } });
    if (!response.ok) throw new Error(`GitHub public repository list failed (${response.status}) on page ${page}.`);
    const rows = await response.json() as Array<{ full_name?: string }>;
    for (const row of rows) if (row.full_name) names.add(row.full_name.toLowerCase());
    if (rows.length < 100) return names;
  }
}

async function main(): Promise<void> {
  const input = path.resolve(process.argv[2] ?? '../repoindex-work/catalog.json');
  const output = path.resolve(process.argv[3] ?? 'data/catalog.public.json');
  const source = parseCatalog(JSON.parse(await fs.readFile(input, 'utf8')) as unknown);
  const publicNames = await publicRepoNames();
  const repos = source.repos.filter((repo) => publicNames.has(repo.full_name.toLowerCase()));
  if (repos.length === 0) throw new Error('Public filtering produced an empty catalog. Refusing to overwrite output.');
  const filtered = {
    ...source,
    source: `${source.source}; filtered against GitHub public repository inventory`,
    repo_count: repos.length,
    repos,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(filtered, null, 2)}\n`, 'utf8');
  const references = repos.filter((repo) => repo.fork && repo.commits_ahead === 0).length;
  console.log(`Wrote ${repos.length} public repositories (${references} zero-ahead reference forks) to ${output}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
