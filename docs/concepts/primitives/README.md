# Design Primitives

This directory crystallizes design primitives that have been *shipped* in VibeSwap contracts and are *generalizable* — i.e., they describe a shape that is reusable beyond the specific cycle that introduced them.

Each primitive has a verified code citation. Primitives that are domain-specific to a single mechanism (e.g., the Shapley novelty multiplier itself, the Fisher-Yates shuffle, etc.) live under their topical subdirectories (`shapley/`, `commit-reveal/`, etc.) — this directory is for the *patterns*, not the *mechanisms*.

## Index

### Storage / state-management primitives

- [Classification-Default with Explicit-Override](./classification-default-with-explicit-override.md) — graduate a per-key boolean from raw opt-in to classification-default-with-override, without breaking existing pins. (C39)
- [Generation-Isolated Commit-Reveal](./generation-isolated-commit-reveal.md) — round-counter mixed into commitment hash + per-round attestation storage; O(1) round rotation, no clear loop. (C42, C43)
- [Pair-Keyed Historical Anchor](./pair-keyed-historical-anchor.md) — symmetric-pair `keccak(min, max)` mapping for relationship history that survives revoke/reset. (Strengthen #3)

### Lifecycle / migration primitives

- [One-Way Graduation Flag](./one-way-graduation-flag.md) — monotonic boolean that decommissions a bootstrap-trust path without contract migration. (C42)
- [Bootstrap-Cycle Dissolution via Post-Mint Lock](./bootstrap-cycle-dissolution-via-post-mint-lock.md) — break a circular construction-time dependency with a permissive default + immutable post-mint setter. (C45)
- [Fail-Closed on Upgrade as Security Default](./fail-closed-on-upgrade.md) — security-relevant features default OFF post-upgrade until explicitly initialized. (C39, C45, C47)
- [Two-Layer Migration Idempotency](./two-layer-migration-idempotency.md) — combine helper-internal completion flag with `reinitializer(N)` so duplicate upgrade-tx and double-mutation are both blocked. (C39, C45)
- [In-Flight State Preservation Across Semantic Flip](./in-flight-state-preservation-across-semantic-flip.md) — when changing slot semantics, pin in-flight entries to the OLD interpretation so they finish under the rules they started under. (C39 migration)

### Dispute / adjudication primitives

- [Bonded Permissionless Contest](./bonded-permissionless-contest.md) — any before-finalization action is gated by permissionless bond + window, with adjudication from existing authority and permissionless default-on-expiry. (C47, OCR V2a)
- [Self-Funding Bug-Bounty Pool](./self-funding-bug-bounty-pool.md) — forfeited losing bonds bootstrap rewards for future winning contests; no recurring treasury subsidy. (C47, OCR V2a)
- [Dual-Path Adjudication Preserving the Existing Oracle](./dual-path-adjudication-preserving-existing-oracle.md) — gate an off-chain authority's inputs/outputs on a math-enforced deadline rather than replace it. (C47)

### EVM-specific failure-mode primitives

- [Revert Wipes Counter — Non-Reverting Twin](./revert-wipes-counter-non-reverting-twin.md) — when you need a metric on a code path that reverts, ship a non-reverting twin entry-point with status-code returns. (Strengthen #3)
- [Phantom-Array Cleanup-DoS](./phantom-array-cleanup-dos.md) — bounded write-side + unbounded cleanup-side = block-gas DoS. Fix is pagination + idempotent partial-progress, not cap-and-revert. (C48-F2)

### Process primitives

- [Observability Before Tuning](./observability-before-tuning.md) — a parameter cannot be tuned with confidence until measured; ship the audit metric in its own PR before any tuning change. (Strengthen #3)

## How to use this directory

When a new audit / cycle / refactor surfaces a design pattern that:

1. Has a verified code citation in this codebase.
2. Could plausibly be reused on a different mechanism, contract, or chain.
3. Has a clear "when to use / when NOT to use" boundary.

…write it up here. Cycle citations link the primitive back to the work that produced it, which preserves the *why* across context-window boundaries.

Primitives that *could* be added in future cycles but lack one of the three properties above belong in `docs/concepts/` proper (mechanism docs) or in the `.claude/` working memory (process notes).
