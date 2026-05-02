# Commit-Reveal

> The commit-reveal protocol family — variants and pairwise applications.

## What lives here

Commit-reveal is VibeSwap's MEV-elimination primitive: users commit `hash(order || secret)` in the commit phase, then reveal in the reveal phase, and orders settle at a uniform clearing price. This folder collects protocol variants beyond the core auction — including pairwise-comparison applications where the same primitive is used to elicit honest preferences without front-running.

## Highlights

| Document | Covers |
|---|---|
| [thu_feb_12_2026_commit_reveal_pairwise_comparison_protocol_overview.md](thu_feb_12_2026_commit_reveal_pairwise_comparison_protocol_overview.md) | Commit-reveal applied to pairwise-comparison preference elicitation |

## Cross-references

- Up: [../README.md](../README.md) — concepts directory overview
- Architecture: [../../architecture/](../../architecture/) — core auction integration
- Related concepts:
  - [../oracles/](../oracles/) — [COMMIT_REVEAL_FOR_ORACLES.md](../oracles/COMMIT_REVEAL_FOR_ORACLES.md) applies the same primitive to oracle reporters
  - [../security/](../security/) — slashing for invalid reveals, defense layer
  - [../protocols/](../protocols/) — sibling protocol specs
