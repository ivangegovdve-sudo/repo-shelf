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
- Textures: spines draw lazily into shelf-packed 1024² atlas pages at 320 texels per spine height, with a hard page cap and LRU page eviction. Covers and pages are generated only for the open book, using the existing 8-entry detail cache.
- Clicking a spine opens a floating window with a 3D viewer (the existing hinged book turns from spine to cover, and the cover opens to the first page), plus the description, facts, and links. Clicking another spine swaps the window's contents.

## Checkpoint log

- [x] Baseline repaired (catalog regenerated), 90/90
- [ ] Wall layout + edition encoding + tests
- [ ] Spine atlas + budget
- [ ] Wall rendering, camera, input
- [ ] Overlays, toolbar
- [ ] Fold-out window
- [ ] Full 1,256 build: FPS + cache measured
