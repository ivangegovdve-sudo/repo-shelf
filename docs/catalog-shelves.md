# Purpose shelf derivation

Snapshot analyzed: `repoindex/catalog.json`, generated 2026-09-25 at 07:07 UTC.

The 1,256 capability-card summaries were read as a corpus rather than placed into a language or popularity taxonomy. TF-IDF clustering over summaries plus curated topics exposed repeated purpose groups: agents, speech/audio, creative video and imaging, MCP integrations, model work, memory/search, web automation, developer tooling, infrastructure/data, security, finance, and mobile/device software. Those observed groups became shelf names.

The production builder uses deterministic weighted matching so the same catalog always produces the same library:

- an exact curated topic contributes 8 points;
- a purpose phrase in the one-line card summary contributes 2 points;
- the highest-scoring shelf wins, with the more specific observed groups used as tie-break order;
- zero points always means **Unshelved**.

Language, stars, repository age, and fork status never influence shelf placement. Fork status only changes how a book is presented.

## Snapshot result

| Shelf | Repositories | Purpose |
| --- | ---: | --- |
| MCP & Integrations | 85 | Protocol servers, connectors, gateways, and integrations |
| Voice & Audio | 169 | Speech, sound, transcription, synthesis, music, and audio |
| Video & Creative | 130 | Video, images, animation, 3D, VFX, and design production |
| Finance & Trading | 19 | Markets, portfolios, payments, and financial analysis |
| Security & Privacy | 38 | Security analysis, identity, privacy, and defensive tooling |
| Mobile & Devices | 27 | Mobile, embedded, automotive, and device software |
| Knowledge & Memory | 92 | Search, retrieval, research, documents, and memory |
| Models & Learning | 57 | Training, inference, evaluation, datasets, and ML research |
| Agents & Assistants | 206 | Agents, assistants, planning, and task execution |
| Web & Automation | 163 | Browser control, scraping, websites, and workflow automation |
| Developer Tools | 41 | Writing, understanding, testing, and shipping software |
| Data & Infrastructure | 66 | Databases, storage, cloud platforms, services, and networking |
| Unshelved | 163 | Purpose too ambiguous for a confident placement |

Every repository appears exactly once; tests assert that shelf counts sum to the catalog count. The large Unshelved group is intentional: a visible honest fallback is more useful than forcing ambiguous cards into a plausible-sounding category.

## Display assumptions

- **Reference copy:** a fork with exactly zero commits ahead of its upstream. In this snapshot there are 1,130.
- **Authored fork:** a fork with one or more commits ahead.
- **Original:** not a fork.
- **Alive:** last push was no more than 365 days before the catalog generation timestamp.
- **Dormant:** older than 365 days, missing a last-push date, or carrying an invalid date.
- **Stale card:** copied directly from the published catalog's `stale` value; this concerns the derived card, not repository activity.
- **Unverified:** copied directly from `verification_status`; it is independent of confidence and staleness.

Search intentionally indexes only repository name and the one-line summary, matching the library's visible book information. “Originals only” means `fork: false`; authored forks remain excluded because they are still forks.
