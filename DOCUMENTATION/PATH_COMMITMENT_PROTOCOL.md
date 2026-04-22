# Path Commitment Protocol

**Status**: Design protocol. No half-finished middle paths.
**Primitive**: [`memory/protocol_path-commitment.md`](../memory/protocol_path-commitment.md)

---

## The rule

When two viable paths are on the table, commit to one. The middle path — "a little of both" — is forbidden by default.

## Why

Two paths are often incompatible at their load-bearing layer. Path A has invariants A1, A2, A3 that compose correctly. Path B has invariants B1, B2, B3. Path "mixing A and B" has invariants {A1 or B1} ∪ {A2 or B2} ∪ ..., which usually composes incorrectly — the mix doesn't preserve either path's coherence.

Examples from VibeSwap's design history:

- **Option D vs Option A-C for Content-Availability Sampling** (Cycle 32): three paths modified StateRentVault; Option D was a sidecar. Mixing would've touched vault + added sidecar = more complexity than either standalone. Shipped Option D.
- **V1 admin-slashing vs V2 permissionless availability challenges** (Cycle 31): V2 was the eventual target but introduced risk pre-audit. V1 was safe but had failure modes. Shipped V1, scheduled V2 for after audit — NOT "V1.5".
- **Dropping the contaminated commit via rebase vs keeping it and adding redaction** (NDA incident, 2026-04-21): rebase-drop was clean; redact-and-keep was partial. Shipped rebase-drop.

In each case, "a little of both" would've been strictly worse than the chosen path, because it would've preserved downsides of both without preserving upsides of either.

## When the middle IS correct

Rare but real: when the two paths are actually composable — they operate on orthogonal axes and don't contend for the same invariant — then "both" can be the right answer. This is [Why Not Both](../memory/feedback_why-not-both.md) — the exception to path-commitment that applies to orthogonal additions, not to contending design choices.

Example: adding event observability (admin-event pattern) does not conflict with adding contract-renunciation logic — both serve governance accountability on different axes. Both together is fine.

Not example: choosing SHA-256 vs Keccak-256 for a specific hash-commitment — mixing would mean some commitments verify differently from others, breaking composability.

The test: do the two paths contend for the same invariant slot (commit scheme, bond size, threshold, ordering rule)? If yes, commit to one. If no, they may compose.

## The decision step

When you identify two paths:

1. **State them clearly.** Path A does X via mechanism M1. Path B does Y via mechanism M2.
2. **Identify where they contend.** Same invariant slot? Same parameter? Same ordering?
3. **If they contend, pick one.** The decision is binding for this cycle. Document the rationale.
4. **Queue the alternative if it's still valid.** If Path B's advantages become relevant later, it's a future cycle — not a middle-path ship now.

## Why this matters for VibeSwap

Design debt accumulates when middle paths ship. A mechanism that implements "some of A, some of B" makes future refactors harder because the mix has no clean decomposition point. Future engineers have to understand both paths to safely modify either.

Clean path-commitment means future refactors can replace the full mechanism if needed. The mechanism is decomposable by its design-author's intent.

## Relationship to [Correspondence Triad](./CORRESPONDENCE_TRIAD.md)

The Triad fires on design-level decisions. Path Commitment is what happens after the Triad: if both paths pass the Triad, Path Commitment forces a choice rather than a compromise.

## Relationship to [First-Available Trap](../memory/primitive_first-available-trap.md)

First-Available Trap warns against picking the ecosystem-default without checking substrate-match. Path Commitment warns against the opposite failure: having identified two good paths, watering both down into a weaker mix.

Both primitives are about decisive selection. First-Available: reject the auto-pick. Path Commitment: having rejected the auto-pick, don't now split-the-difference.

## How it reads in a design memo

A design memo with path commitment looks like:

> **Options considered**:
> - Path A: X via M1. Pros: ... Cons: ...
> - Path B: Y via M2. Pros: ... Cons: ...
>
> **Decision**: Path A. Rationale: [substrate-geometry match, upstream-dependency alignment, risk-profile fit for this cycle].
>
> **Not chosen**: Path B remains viable for a future cycle if [specific triggering condition].

The memo is density-first (see [Density First](./DENSITY_FIRST.md)) and explicit about what's in-cycle vs. deferred.

## One-line summary

*Two paths, commit to one — the middle is forbidden unless the paths are genuinely orthogonal; design debt accumulates in mixed middles.*
