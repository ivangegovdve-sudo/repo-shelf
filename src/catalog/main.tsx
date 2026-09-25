import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CatalogApp } from './App';
import type { CatalogDocument } from './model';

declare global {
  interface Window {
    __REPO_CATALOG__?: CatalogDocument;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Catalog root element is missing.');

if (!window.__REPO_CATALOG__) {
  root.innerHTML = '<main class="build-error"><h1>Catalog data is missing.</h1><p>Rebuild this file from repoindex/catalog.json.</p></main>';
} else {
  createRoot(root).render(
    <StrictMode>
      <CatalogApp catalog={window.__REPO_CATALOG__} />
    </StrictMode>,
  );
}
