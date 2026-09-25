import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildLibrary, type CatalogDocument } from '../src/catalog/model';

export interface CatalogBuildResult {
  outDir: string;
  repos: number;
  shelves: number;
  referenceCopies: number;
  files: number;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export async function buildCatalogSite(catalogPath: string, outDir: string): Promise<CatalogBuildResult> {
  const raw = await fs.readFile(catalogPath, 'utf8');
  const catalog = JSON.parse(raw) as CatalogDocument;
  const library = buildLibrary(catalog);
  const result = await build({
    entryPoints: [path.resolve('src/catalog/main.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
    outdir: 'catalog-assets',
  });
  const js = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text;
  if (!js || !css) throw new Error('Catalog bundle did not produce JavaScript and CSS.');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="A purpose-shelved library of ${catalog.repo_count} repositories." />
    <title>Ivan's Repository Library</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__REPO_CATALOG__=${safeJson(catalog)};</script>
    <script>${js}</script>
  </body>
</html>
`;
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  return {
    outDir,
    repos: library.books.length,
    shelves: library.shelves.length,
    referenceCopies: library.books.filter((book) => book.referenceCopy).length,
    files: 1,
  };
}

function parseArgs(args: string[]): { catalogPath: string; outDir: string } {
  const catalogPath = args[0];
  if (!catalogPath) throw new Error('Usage: npm run build:catalog -- <catalog.json> [--out <directory>]');
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : 'catalog-site';
  if (!outDir) throw new Error('--out requires a directory.');
  return { catalogPath: path.resolve(catalogPath), outDir: path.resolve(outDir) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { catalogPath, outDir } = parseArgs(process.argv.slice(2));
  buildCatalogSite(catalogPath, outDir)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
