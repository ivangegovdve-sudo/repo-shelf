# Progress: spine-out wall

Branch `claude/repo-shelf-spine-out-b0ylc0`, built on PR #1 (`codex/static-purpose-library-20260925`).
Target: every book spine-out, at least 150 legible spines in one window, edition readable from the spine alone.

## Checkpoint 1: baseline and design (2026-09-25)

**Baseline found on a fresh clone of PR #1: 88/90 tests, not 90.**

- `data/catalog.public.json` was corrupted in the commit itself. It was garbled from line 9709 onward, and only 472 of its 1,192 entries were intact. It was regenerated from repoindex's `catalog.json`, intersected with the owner's 1,194 public repositories, which gives exactly 1,192. The 472 intact entries match the regenerated file in the same order. `refresh-public-catalog.ts` gained `--public-names <file>` because unauthenticated `api.github.com` returns 403 from the cloud container.
- `renameRepo > rewrites ssh remotes too` fails only because the cloud container injects a git `url.*.insteadOf git@github.com:` rewrite through `GIT_CONFIG_PARAMETERS`. Without the injected rewrite, the file passes 21/21. No code change.
- With both fixed: 90/90.

**Baseline density:** one shelf row per screen, about 33 spines visible at 1920×1080 (screenshot kept locally, not committed).

**Design decisions**

- The wall stays 3D (R3F, `frameloop="demand"`). Each category is a *bay*: a vertical section with real divider boards, a cornice plate, and N shelf rows. N is derived from the canvas height, with a minimum row pitch of 200 px. Bays sit side by side and the wall scrolls horizontally.
- Spine widths are fixed in CSS pixels, so text size never depends on the window. Only heights follow the row pitch.
- The edition is carried by three redundant channels that survive at 16–46 px per spine:
  1. **Luminance.** Reference copies are pale archival buckram with dark ink. Ivan's work is dark cloth.
  2. **Hue and lettering.** Originals are burgundy with gilt lettering, gilt head and tail rules, and a gilt ornament. Adapted forks are navy with cream lettering, a copper head band, and a fork glyph. Red and blue stay distinct under deuteranopia.
  3. **Silhouette.** Originals are the widest and tallest, reference copies the narrowest and shortest. Reference copies carry a library call-number sticker at the foot.
  Within each bay, originals come first, then adapted forks, then reference copies.
- Upstream attribution: the hover and keyboard-focus tooltip for any fork names the upstream. For a reference copy the tooltip leads with "Reference copy of owner/name, not Ivan's work". The fold-out window, the cover, and the screen-reader index repeat it.
- Textures: spines draw lazily into shelf-packed 1024² atlas pages at 256 texels per spine height, capped at 16 pages with LRU page eviction. Covers and pages are generated only for the open book, in a detail cache cut from 8 entries to 6.
- Clicking a spine opens a floating window with a 3D viewer (the existing hinged book turns from spine to cover, and the cover opens to the first page), plus the description, facts, and links. Clicking another spine swaps the window's contents.

## Checkpoint 2: the wall works end to end

All numbers below come from the full local build of all 1,256 books (`npm run build:library:local`), rendered at 1920×1080.

- **Density:** four rows at a 220 px pitch, with 283–342 whole spines in any window along the wall (worst window 296 for the 1,192-book public catalog). At 1440×900 the worst window holds 163, and at 1366×768 it holds 153.
- **Draw calls:** 9 for the whole wall: structure, planks, bookends, back, shade, one fallback instanced mesh, and one instanced mesh per atlas page.
- **Lazy lettering:** the first view letters 366 spines into 4 atlas pages (21.3 MiB) in 12 uploads, with about 0.35 ms of CPU paint per spine.
- **Interactions checked in a browser (Playwright with Chromium, SwiftShader):** hover tooltip naming the upstream; click opens the window; clicking another spine swaps it; the cover opens to the first page; arrows move a gold focus ring with a live-region announcement; Enter opens and Esc closes.
- **Tests:** 109/109, the original 90 plus 19 new (wall layout, density at three screen sizes, edition from spine, texture budget).

## Checkpoint 3: measured on the full local-only build of all 1,256 books

Command: `npm run build:library:local -- catalog.json <dir>`, with `catalog.json` from repoindex `codex/publish-static-catalog-20260925` (1,256 repos: 89 originals, 37 adapted forks, 1,130 reference copies). The page was served locally and driven with Playwright in Chromium at 1920×1080, DPR 1. The full scroll glides from the first bay to the last over 24 s. Two runs gave the same numbers.

| Measure | Result |
| --- | --- |
| Whole spines on screen, 1920×1080 (canvas 1920×979) | 314 at the start, 283–342 along the wall |
| Whole spines on screen, 1440×900 / 1366×768 | 172 / 163 |
| Wall | 7,613 px wide, 13 bays, 4 rows |
| Draw calls, whole wall | 9 at first view, 20 after every page is lettered |
| Triangles | 37,064 |
| Atlas after a full scroll | 1,256 of 1,256 spines lettered, 13 pages, **69.3 MiB** (cap 85.3), 0 evictions, 0 unlettered |
| CPU spent lettering all 1,256 spines | 269–277 ms total, over about 50 page uploads |
| Cover/page cache after opening 12 books | 6 entries (the cap), **26.7 MiB** |
| All textures, after the scroll plus 12 books | **96.0 MiB** (budget 160; tested worst case 140.1) |
| Frame rate during the full scroll | **1.3 fps**, see the note below |
| `gl.render` CPU time per frame | p50 7.1–7.3 ms, p95 12.6–16.6 ms |

**The frame rate is a software-rasterizer number, not a GPU number.** This cloud container has no GPU; Chromium renders WebGL through SwiftShader on the CPU. Under exactly the same conditions:
- the old face-out build scores 1.0 fps, with a `gl.render` p50 of 19.8 ms;
- the wall scores 1.3 fps, with a `gl.render` p50 of about 7.2 ms, so it costs less than half the old CPU time per frame;
- at 960×540 the wall scores 2.3 fps, which shows the cost is fill rate, the thing a real GPU does in parallel.

A real-GPU frame rate cannot be measured here. Run `await __measureWall()` in the console of the built shelf on a real machine to get it; the function uses the same method as this table.

What changed to get here:
- Lambert shading instead of PBR (1.3 fps vs 0.9 fps before it).
- Opaque wood draws after the spines, so hidden back panels fail the depth test early.
- DPR capped at 1.5, since the atlas carries about 1.5 texels per CSS px anyway.
- Lettering in batches of at least 12 spines per page upload.

## Also fixed along the way

- e2e was broken on PR #1 itself: the fixture API merged the 1,192 catalog books into its three-repo fixture, so 6 of 8 specs failed. `playwright.config.ts` now points `SHELF_CATALOG` at a missing file for the fixture. 8/8 pass, plus 6 new wall specs.
- The wall map only attached its pointer handlers if a layout existed on its first render; it now attaches whenever it appears.

## Checkpoint log

- [x] Baseline repaired (catalog regenerated), 90/90
- [x] Wall layout + edition encoding + tests
- [x] Spine atlas + budget (worst case 140.1 MiB < 160)
- [x] Wall rendering, camera, input
- [x] Overlays, toolbar
- [x] Fold-out window
- [x] Full 1,256 build: FPS + cache measured across a full scroll
- [x] e2e (14/14), README and AGENTS.md, other viewports, themes and bookcase builds
- [x] First real CI run: fixed the `wall.ts`/`Wall.tsx` case-only clash (TS1149 on Windows/macOS, now `wallLayout.ts`) and the missing git identity in `pages.yml`. All green on `76556c9`.
- [x] Codex review, round 1: an on-disk clone of a cataloged repo was dropped by the catalog merge (`mergeCatalog`), and the folder filters were hidden beside the catalog (`filterChips`).
- [x] Codex review, round 2:
  - Shelfie and rewind exports clamped to the 0.2 interactive zoom floor, so the 9,480 px public wall was cropped at 1440 px. `useWall.frameAll()` now fits the whole wall; a Shelfie at 1440×900 frames it at zoom 0.149.
  - Keyboard-focus tooltips were hidden on `hover: none` devices; only pointer tips are hidden there now.
  - 115/115 unit tests, 15/15 e2e.
- [x] Codex review, round 3:
  - A shelf-only rescan (after a GitHub visibility, archive or delete action) re-added GitHub duplicates of catalog books. The server now keeps the local shelves separately and merges the catalog on every scan.
  - Folding a GitHub-shelf duplicate into its catalog book now carries the live visibility, archive state, creation date and metadata, and the book keeps the owner-checked GitHub actions.
  - Publishing with pages no longer makes about six `gh api` calls for each of the 1,192 catalog books.
  - Rewind replays only dated books and leaves undated catalog books on the shelf; it is disabled when nothing is dated.
  - 122/122 unit tests, 15/15 e2e.
- [x] Codex review, round 4:
  - Guide books that share a catalog slug are kept.
  - Catalog repos deleted on GitHub from the app are remembered in `.cache/catalog-deleted.json` and stay off the wall.
  - `pages.yml` concurrency is per ref, so a PR run cannot cancel the main deploy.
  - 125/125 unit tests, 15/15 e2e.
- [x] Codex review, round 5:
  - Empty configured shelves keep their bay beside the catalog, so they stay drop targets; only empty catalog bays are left out.
  - The Shelves dialog lists only configured shelves.
  - Catalog books managed through a GitHub shelf can be dragged to change visibility or clone.
  - The local full library is served with `npm run preview:library:local`, because browsers block its modules over `file://`.
  - 130/130 unit tests, 15/15 e2e.
- [ ] Real-GPU frame rate: needs `await __measureWall()` on Ivan's machine
