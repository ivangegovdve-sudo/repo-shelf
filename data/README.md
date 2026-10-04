# Catalog data

`catalog.public.json` contains the complete live public GitHub inventory, including
archived projects. Private repositories never enter the public catalog. Existing
capability-card summaries and curated topics are preserved. New repos use their
GitHub descriptions and topics and are marked as having unverified cards.

Refresh with `GH_TOKEN` supplied in memory from a named GCP Secret Manager credential
(never paste credentials into source or command arguments):

```sh
npm run catalog:refresh
```

The refresh paginates the complete inventory, obtains each fork's parent and compares
its default branch against the current upstream default-branch SHA. Unrelated
histories or unavailable upstream branches produce an unverified fork. Other API
failures abort without replacing the catalog. A push after a capability card's
generation marks the card stale. Dates, language, stars and archive state are current.

`src/taxonomy.ts` defines six broad shelves and thirteen smaller purpose categories.
The smaller purpose is derived from each card's summary/topics and stored on the
book as `catalog.subCategory`, supplying consistent spine, cover and swatch colors.
