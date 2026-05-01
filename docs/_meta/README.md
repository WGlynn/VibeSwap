# _meta

> Repo-internal — protocols, session reports, KPIs, RSI, TRP, roadmaps.

## What lives here

The leading underscore signals **internal / non-canonical** to outside readers. This is where the project documents *itself* — protocols (Anti-Amnesia, Anti-Hallucination), build summaries, KPIs, session reports, RSI logs, TRP verifications, roadmaps. These artifacts support the work but are not part of the public-facing protocol story. External readers should mostly skip this directory; contributors and future Claude sessions live here.

## Highlights

| Document | What it covers |
|---|---|
| [protocols/ANTI_AMNESIA_PROTOCOL.md](protocols/ANTI_AMNESIA_PROTOCOL.md) | AAP — recovery from session crash / context loss |
| [protocols/ANTI_HALLUCINATION_PROTOCOL.md](protocols/ANTI_HALLUCINATION_PROTOCOL.md) | AHP — verify before asserting |
| [SYSTEM_TAXONOMY.md](SYSTEM_TAXONOMY.md) | System-wide taxonomy of components and primitives |
| [JARVIS_VIBESWAP_CONVERGENCE.md](JARVIS_VIBESWAP_CONVERGENCE.md) | JARVIS-VibeSwap convergence note |
| [PREVENTATIVE_CARE_PROTOCOL.md](PREVENTATIVE_CARE_PROTOCOL.md) | Preventative-care protocol |
| [TRUST_VIOLATIONS.md](TRUST_VIOLATIONS.md) | Log of trust violations and corrective measures |
| [DAILY_SCHEDULE.md](DAILY_SCHEDULE.md) | Daily working schedule |
| [build-summaries/VIBESWAP_BUILD_SUMMARY.md](build-summaries/VIBESWAP_BUILD_SUMMARY.md) | Cross-cutting build summary |
| [trp/TRP_VERIFICATION_REPORT.md](trp/TRP_VERIFICATION_REPORT.md) | TRP verification report |
| [kpi/KPI_TRACKER.csv](kpi/KPI_TRACKER.csv) | KPI tracker (CSV) |
| [open-source-strategy.md](open-source-strategy.md) | Open-source strategy |

## Subfolders

- `protocols/` — Anti-Amnesia, Anti-Hallucination, and related disciplines
- `session-reports/`, `session-reports-existing/` — per-session work logs
- `rsi/`, `rsi-existing/` — recursive self-improvement reports
- `trp/`, `trp-existing/` — TRP verification artifacts
- `roadmap/`, `roadmap-existing/` — roadmaps (numbered)
- `kpi/` — KPI trackers (CSV)
- `build-summaries/` — periodic build summaries
- `changelogs/` — session changelogs
- `incident-reports/`, `incident-reports-existing/` — operational incidents
- `team-marketing-assignments/` — team assignment specs

## When NOT to look here

- Public protocol design → [`../architecture/`](../architecture/), [`../research/`](../research/)
- User-facing or partner-facing content → [`../marketing/`](../marketing/), [`../partnerships/`](../partnerships/)
- Long-form historical / scratch material → [`../_archive/`](../_archive/)
- Per-mechanism primitives → [`../concepts/`](../concepts/)

Top-level entry: [`../README.md`](../README.md). External readers should generally start at the top-level README, not here.
