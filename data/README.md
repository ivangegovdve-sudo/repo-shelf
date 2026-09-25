# Catalog data

`catalog.public.json` is a public-only snapshot derived from the `catalog.json`
published by repoindex PR #8. The refresh script intersects that catalog with
GitHub's public repository inventory before writing this directory, so private
repository names never enter this public repository.

Refresh from sibling clones:

```sh
npm run catalog:refresh -- ../repoindex-work/catalog.json
```

Purpose shelves are derived at runtime from card summaries and curated topics.
Fork attribution, commits-ahead, card generation dates, staleness, confidence,
and verification status remain verbatim from the published catalog.
