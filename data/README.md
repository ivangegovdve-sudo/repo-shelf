# Catalog data

`library.public.json` is the single canonical public shelf dataset. It contains the
complete live public GitHub inventory, including archived projects, with the safe
published book state, attribution, cards, stars and shelf placement. Private
repositories never enter it, and every book id and repository slug is unique.

`catalog.public.json` is the refresh/authorship input used to update the canonical
library; it is not read by the Pages build and is never merged into the shelf at
publish time.

Refresh with `GH_TOKEN` supplied in memory from a named GCP Secret Manager credential
(never paste credentials into source or command arguments):

```sh
npm run catalog:refresh
node --import tsx scripts/refresh-public-library.ts
npm run build:pages
```

The refresh paginates the complete inventory, obtains each fork's parent and compares
its default branch against the current upstream default-branch SHA. A missing or
private parent is never written into this public file: its public fork is retained
without source attribution. Unrelated histories or unavailable comparison branches
produce an unverified fork. A throttled or invalid authenticated API request aborts
without replacing the catalog; an unchanged fork retains its prior verified
authorship evidence if only that comparison endpoint is unavailable. A push after a
capability card's generation marks the card stale. Dates, language, stars and archive
state are current.

Run the library refresh after the catalog refresh to update `library.public.json`.
It preserves published cards, pages, shelf placement and upstream attribution,
applies newer authorship evidence, and hydrates source-repository stars and push dates
for reference copies. An explicitly archived, missing, or non-public source switches
that book to its public fork's identity, stars, and update date; transient failures
retain the last safe source metadata. The existing publication sanitizer removes local
paths and private state before the snapshot is replaced atomically. Building alone
adds catalog books to that build but does not persist them into the fallback snapshot.

`src/taxonomy.ts` defines six broad shelves and thirteen smaller purpose categories.
The smaller purpose is derived from each card's summary/topics and stored on the
book as `catalog.subCategory`, supplying consistent spine, cover and swatch colors.

## Skills index

`skills.public.json` is an optional, public-only sidecar built from the effective
repository source for every public book. It verifies that each source is public,
walks its default-branch Git tree for regular `SKILL.md` files, and writes only
bounded path metadata, blob IDs, categories, and commit-pinned GitHub links. It
never embeds skill bodies, credentials, local paths, or private repository names.

Refresh it after the public library snapshot is current:

```sh
npm run skills:refresh
npm run build:pages
```

The first scan can make roughly one GitHub metadata/tree request per public source.
After a source is confirmed public in the current run, it can retain a prior result
if its tree request fails and marks that source partial. If GitHub cannot verify
public visibility, the source is omitted until a later refresh confirms it again.
`build:pages` reads only `library.public.json` for repo books, re-sanitizes the
sidecar against those published books, and writes it as a lazy `skills-index.json`
asset.
