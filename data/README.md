# Catalog data

`catalog.public.json` contains the complete live public GitHub inventory, including
archived projects. Private repositories never enter the public catalog. Existing
capability-card summaries and curated topics are preserved. New repos use their
GitHub descriptions and topics and are marked as having unverified cards.

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

Run the library refresh after the catalog refresh to add newly discovered public
repositories to `library.public.json`, the complete fallback used by the website.
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
