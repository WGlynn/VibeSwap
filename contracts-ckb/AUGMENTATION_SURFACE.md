# Augmentation Surface

The set of changes VibeSwap makes to upstream Nervos CKB. Every entry here is justified, scoped, and revisable. Anything not listed here uses upstream code unmodified.

This is the load-bearing document for keeping the sovereign-pivot honest. The smaller this file stays, the more credibly we're building on Nervos rather than rewriting it. PR-shape upstream first; fork only what we must.

---

## Discipline rules

1. **Nothing on this surface unless required.** If a VibeSwap requirement can be expressed as a user-deployable cell with type-script and lock-script logic, it goes to user-space. Substrate augmentation is the last resort.
2. **Every entry has a justification.** A VibeSwap requirement, named, that cannot be served from user-space. No "nice-to-have" augmentations.
3. **Upstream merges happen.** We track Nervos CKB releases and merge them into our fork on a regular cadence. The augmentation set is rebased onto upstream, not the other way around.
4. **Anything proposed gets a PR-shape draft to Nervos upstream first.** If they'd accept it, we contribute and use upstream. If not, we fork it here with a written explanation of why upstream wouldn't take it.
5. **The surface is auditable.** Each entry maps to a specific file or set of files in our fork, with a diff against the upstream commit it derives from.

---

## Current augmentations (none yet — pre-fork)

Status: zero augmentations. We have not yet forked Nervos CKB source. This document describes the *expected* surface so we can decide whether each item lives here or moves to user-space before we start.

When the fork lands, each accepted augmentation gets a section below with: name, justification, scope, upstream files touched, our patch summary, and a link to the rejected/pending upstream PR if applicable.

---

## Expected surface (pre-fork analysis)

The following are the augmentation candidates identified in the architectural statement. Each gets evaluated for "does this really need substrate-level change, or can it live in user-space?"

### Genesis configuration

**Status**: Required, low-risk, standard practice for any L1 fork.
**Scope**: Network ID, initial cell allocation, native token launch parameters, genesis block fields.
**Upstream files**: `ckb/specs/dev.toml` and equivalent network specs.
**Justification**: Any sovereign chain needs its own genesis. This is not a code augmentation, it's a configuration augmentation. Lowest-risk entry on this surface.
**User-space alternative**: None. Genesis is by definition substrate-level.

### Native token model (three-token separation)

**Status**: Open question. Lean toward user-space.
**Scope**: VibeSwap's JUL (money) / VIBE (governance) / CKB-native (state-rent capital) separation at the chain level.
**Upstream files**: Potentially `ckb/util/types/` token primitives and consensus reward distribution if we want all three tokens minted at consensus level.
**Justification**: Three-token consensus is one of VibeSwap's defining structural properties.
**User-space alternative**: Implement JUL and VIBE as sUDT/xUDT tokens, keep CKB-native as the only consensus-level asset. State-rent stays priced in CKB-native. JUL and VIBE participate in protocol mechanics as cell-tokens.
**Decision**: Default to user-space unless a load-bearing mechanism cannot be expressed that way. Open question for design review.

### NCI consensus integration

**Status**: Open question. Lean toward user-space.
**Scope**: VibeSwap's NCI (PoW 10% / PoS 30% / PoM 60%) three-token consensus weighting either replaces or composes with NC-Max upstream.
**Upstream files**: If replacement: substantial parts of `ckb/consensus/` and `ckb/verification/`. If composition: minimal or zero.
**Justification**: NCI is a defining protocol property; if it lives at consensus level, it's substrate-deep.
**User-space alternative**: NCI lives as application-layer cells that consume PoW outputs (block hashes, transaction inclusion proofs) and PoM attestations and PoS validator signatures. Aggregate the three signals into a consensus-finality cell that downstream mechanisms read. This keeps NC-Max upstream untouched.
**Decision**: Default to user-space unless rate or finality requirements make application-layer NCI infeasible. Significant design work needed before committing.

### System scripts for VibeSwap primitives

**Status**: Probably not needed. Default to deployable scripts.
**Scope**: Pre-installed system scripts that any cell can reference without deploying its own code-cell.
**Upstream files**: `ckb/system-scripts/` if we wanted to add to that set.
**Justification**: None compelling. Most VibeSwap primitives are application-layer.
**User-space alternative**: Deploy as user code-cells, reference by hash like any other script.
**Decision**: Default to user-deployable. Surface stays clean.

### Network parameters tuned for commit-reveal timing

**Status**: Likely required, low-risk, configuration-only.
**Scope**: Block time, capacity per block, transaction throughput targets calibrated for 10-second commit-reveal batches.
**Upstream files**: Consensus parameters, no code changes.
**Justification**: VibeSwap's batch-auction mechanism timing depends on block-time predictability. NC-Max's variable block time may need parameterization for our use case.
**User-space alternative**: Application-layer batching that tolerates variable block time. Possible but adds complexity.
**Decision**: Configuration parameter, not code change. Low-risk if upstream consensus stays intact.

### Capacity floor and dust threshold

**Status**: Likely required, configuration-only.
**Scope**: Per-cell minimum capacity (dust threshold) tuned for the size of VibeSwap cells (commit-cells, reveal-cells, pool-cells, etc.).
**Upstream files**: Consensus parameters.
**Justification**: Default CKB dust thresholds may not match VibeSwap's cell sizes. We need cell creation costs that allow legitimate auction participation without inviting spam.
**User-space alternative**: Constrain cell sizes to fit upstream thresholds. Possible but limits expressiveness.
**Decision**: Configuration, defer until we have concrete cell-size data from the worked-example specs.

---

## Net summary

If all "lean toward user-space" decisions land in user-space, the augmentation surface reduces to:

- Genesis configuration (configuration-only)
- Network parameters: block time and capacity tuned for commit-reveal timing (configuration-only)
- Possibly dust threshold (configuration-only)

That is a configuration-only fork, no code changes to upstream. That is the most credible version of "Nervos CKB augmented to meet VibeSwap specifications."

If NCI consensus or three-token model require substrate-level integration, the surface grows to include parts of consensus and reward distribution. That is still a tractable fork, but it puts us in active-maintenance territory against upstream changes.

The decision-tree for each item is the same: can this live in user-space? If yes, it does. If no, the augmentation is named here with justification and scope.

---

## How to add an entry

When a new augmentation is proposed:

1. State the VibeSwap requirement it serves
2. State the user-space alternative and why it fails
3. State the upstream files touched
4. Draft the upstream PR equivalent and either submit it or document why it would be rejected
5. Add the section here, with the eventual diff against upstream

When an augmentation is removed (moved back to user-space):

1. State the user-space implementation that replaced it
2. Move the section to the "Retired augmentations" archive at the bottom

---

## Retired augmentations

(None yet.)
