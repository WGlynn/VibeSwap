# GEV Resistance — The Architecture

**Status**: Positioning doc. Public-facing reframe of the MEV-resistance thesis.
**Primitive**: [`memory/primitive_gev-resistance.md`](../memory/primitive_gev-resistance.md)
**Related**: [Extractive Load](./EXTRACTIVE_LOAD.md) (public-facing name), [Cooperative Markets Philosophy](./COOPERATIVE_MARKETS_PHILOSOPHY.md).

---

## What GEV is

**MEV** — Maximal Extractable Value — is a narrow technical term: the profit a block producer (or transaction-ordering authority) can extract by choosing ordering. The DeFi ecosystem has accepted MEV as a permanent fixture, building auction markets (Flashbots, MEV-boost, orderflow auctions) to tax and redistribute it.

**GEV** — Generalized Extractable Value — is the full class. Any mechanism where an intermediary with information, timing, or authority advantages extracts value *not* proportional to the value they create. MEV is one instance. Others:

- **Frontrunning** in any informational asymmetry (chain, dark pool, API firehose, private orderflow).
- **Oracle manipulation** — timing a trade against a stale price feed.
- **Flash-loan attacks** — leveraging atomicity to extract from mispriced pools.
- **Admin-setter drift** — operators changing fee schedules just ahead of user trades.
- **Proposal-order gaming** in governance — choosing which proposal to submit first to anchor outcomes.
- **Dispute-escalation capture** — actors who can always afford the next escalation win by attrition.

The extractive pattern generalizes. Naming it MEV hides the generalization.

## Why "GEV-resistance" not "MEV-resistance"

VibeSwap is architected for GEV-resistance, not MEV-resistance. The distinction is load-bearing:

- **MEV-resistance** = fix the block-ordering advantage. Narrow scope. Typical solutions: encrypted mempools, orderflow auctions, sealed-bid systems.
- **GEV-resistance** = every extractive pattern is addressed by structural invariant, not patched per-class. Broad scope. Solutions are the full [Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md) stack.

MEV-focused solutions fix one extraction surface but leave the others open (common: sealed-bid MEV-proof systems are still oracle-manipulable, still flash-loanable, still admin-draftable). GEV-focused architecture treats extraction as a category and addresses the category.

## VibeSwap's GEV-resistance stack

| Extraction surface | Mitigation | Invariant type |
|---|---|---|
| Block-ordering MEV | Commit-reveal batch + XOR-secret shuffle + uniform clearing price | Structural + Temporal |
| Frontrunning via visible mempool | Commit phase hides order content until reveal | Temporal |
| Oracle manipulation | Fork-aware EIP-712 + commit-reveal oracle aggregation (C39 FAT-AUDIT-2) | Verification + Structural |
| Flash-loan attacks | Same-block interaction guard + TWAP validation | Structural |
| Admin-setter drift | `XUpdated(prev, next)` events on every privileged setter ([`ADMIN_EVENT_OBSERVABILITY.md`](./ADMIN_EVENT_OBSERVABILITY.md)) | Verification |
| Proposal-order gaming | Constitutional order (P-000 > P-001 > DAO votes) ([`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md)) | Structural |
| Dispute-escalation capture | Paper-§6.5-sized bonds + 50/50 slash splits + Compensatory Augmentation | Economic |
| Shapley extraction (claiming disproportionate share) | Fractal Shapley + Lawson Constant + contribution attestation | Structural + Verification |
| Sybil via fake contributions | Bond-per-cell + assignment challenges | Economic + Temporal |

Every row is a specific invariant from the [Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md) toolkit applied to a specific extraction surface.

## What the competition doesn't do

- **CoW Swap** — MEV-resistant via batch auctions; doesn't address oracle, admin-setter, or dispute-escalation GEV.
- **Flashbots** — taxes MEV, doesn't eliminate it. Still vulnerable to oracle and admin GEV.
- **Sealed-bid orderflow auctions** — fix frontrunning on specific channels; leave informational asymmetry elsewhere.
- **Private mempools** — shift the extraction surface from block-producer to mempool-operator. Same pattern, different beneficiary.

VibeSwap is the first DEX built to eliminate GEV as a category, not just MEV as an instance.

## Why this is marketable

"MEV-resistant DEX" is a crowded claim. At least 15 DEXes make it. All with varying degrees of patched-per-class solutions.

"GEV-resistant DEX" is a clearer positioning because it reframes the whole market: every competitor addresses a subset; VibeSwap addresses the category. When a sophisticated investor asks "how is this different from X?", the answer is structural — the architecture addresses extraction at the category level, not per-instance.

See also [Cooperative Markets Philosophy](./COOPERATIVE_MARKETS_PHILOSOPHY.md) and the tagline: *A coordination primitive, not a casino.* GEV-resistance is how the tagline is enforced structurally.

## Relationship to ETM

In [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), GEV is the cognitive-economy analog of *attention capture* — agents extracting resources disproportionate to the value they create, by positional advantage. The cognitive substrate has defenses (memory decay of bad actors, trust-score compounding against extractors); VibeSwap implements those defenses at the chain layer.

## One-line summary

*GEV is the category; MEV is one instance. VibeSwap is architected to eliminate GEV structurally — every extraction surface has a math-enforced invariant that closes it.*
