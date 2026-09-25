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

## Checkpoint log

- [x] Baseline repaired (catalog regenerated), 90/90
- [x] Wall layout + edition encoding + tests
- [x] Spine atlas + budget (worst case 140.1 MiB < 160)
- [x] Wall rendering, camera, input
- [x] Overlays, toolbar
- [x] Fold-out window
- [ ] Full 1,256 build: FPS + cache measured across a full scroll
- [ ] e2e, docs, other viewports and themes
