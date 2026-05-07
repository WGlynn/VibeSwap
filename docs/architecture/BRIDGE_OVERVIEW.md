# Bridge Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/bridge/`
**Companions**: [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md), `contracts/incentives/ShapleyDistributor.sol`

---

## What this subsystem does

A single contract: `AttributionBridge`. Bridges off-chain Jarvis attribution data (passive contribution tracking from blogs, videos, papers, code, social, conversation, sessions) to on-chain Shapley distribution.

The thesis: a lot of valuable contribution happens *outside* git history. Reading a blog post that informs a downstream design, watching a video that shapes a strategy, having a conversation that produces an idea — these are real contributions but invisible to standard on-chain reward systems. The bridge makes them visible.

## File map

```
contracts/bridge/
└── AttributionBridge.sol
```

One contract. One concern. The `bridge/` directory is single-purpose by design.

## What `AttributionBridge` does

The bridge is a Merkle-proof acceptor. Off-chain, Jarvis runs `passive-attribution.js` to compute attribution scores: who contributed what, how much, with what derivation chain. The script outputs `(address, score)` pairs. Operator computes a Merkle root over the pairs and submits the root on-chain.

Contributors then prove their inclusion via Merkle proof and claim Shapley rewards. The flow:

```
1. Jarvis computes attribution scores off-chain (passive-attribution.js)
   sources: blog, video, paper, code, social, conversation, session
   derivations: code written using source knowledge
   outputs: shipped features that trace back to sources
   │
   ▼
2. Operator submits Merkle root of (address, score) pairs to AttributionBridge
   │
   ▼
3. Contributors submit Merkle proofs to claim inclusion
   │
   ▼
4. Bridge creates a ShapleyDistributor game with proven contributors
   │
   ▼
5. ShapleyDistributor pays out per Shapley value computation
```

The bridge is *thin*. It doesn't compute Shapley; that's `ShapleyDistributor`'s job. It doesn't compute attribution; that's the off-chain script. Its single concern: make off-chain attribution data on-chain-claimable through a Merkle-proof gate.

## Why a bridge, not on-chain attribution

Attribution computation is genuinely complex:
- Source weighting (a blog read 6 months ago vs a paper read yesterday).
- Derivation tracing (which line of code uses which knowledge from which source).
- Output attribution (which shipped feature traces back to which derivations).
- Fairness (no double-counting, no over-attribution to popular sources).

Doing this on-chain would require either:
- A massive amount of state (full attribution graph stored on-chain), OR
- A large amount of computation (recomputing attribution scores per claim).

Both are gas-prohibitive. The bridge sidesteps by computing off-chain (via `passive-attribution.js`), then committing only the `(address, score)` pairs as a Merkle root. The on-chain check is `O(log n)` per claim.

This is the [off-chain compute, on-chain verify](../concepts/OFF_CHAIN_COMPUTE_ON_CHAIN_VERIFY.md) pattern applied to attribution. The bridge is the verification surface; Jarvis is the prover.

## Trust assumption

The bridge inherits the `passive-attribution.js` correctness — if the script computes attributions wrongly, the on-chain rewards reflect that. This is acknowledged: the operator submitting the Merkle root is trusted to run the script honestly.

Mitigations:
- Multiple operators (federated submission with quorum) reduces single-operator capture.
- Open-source attribution script lets anyone re-run and challenge.
- Bonded contest layer could be added (currently not present): challengers can post fraud proofs of incorrect attribution; bond slashes if proven.

The current design accepts the operator-trust assumption; future versions may layer bonded contest on top to reduce it. The structural shape is parametric: replace operator with consensus or with cryptographic proof, and the bridge logic doesn't change.

## Composition with broader stack

| External contract | Used for |
|-------------------|----------|
| `ShapleyDistributor` | reward distribution after attribution claim |
| `RewardLedger` (identity/) | tracks claimed rewards per contributor over time |
| `ContributionAttestor` (identity/) | optional governance gate on bridge submissions |

The bridge sits at the boundary between off-chain knowledge work and on-chain reward distribution. Adjacent contracts handle the on-chain side.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| Operator authorization | curated | who can submit Merkle roots |
| Submission deadline | configurable | how long contributors have to claim |
| Bond requirement (future) | not yet | for bonded contest extension |

## Why this is a separate subsystem

The bridge could live in `incentives/` (alongside ShapleyDistributor) or `identity/` (alongside RewardLedger). It's separate because it has a unique role: *it's the substrate boundary*. Most VibeSwap contracts handle on-chain logic; the bridge handles the seam between off-chain data and on-chain consequence.

Future bridges may emerge for other off-chain data types (oracle data, social-signal data, IoT sensor data). The `bridge/` directory anticipates this — it's the home for "off-chain-to-on-chain" boundary contracts.

## Related

- [`OFF_CHAIN_COMPUTE_ON_CHAIN_VERIFY.md`](../concepts/OFF_CHAIN_COMPUTE_ON_CHAIN_VERIFY.md) — meta-pattern this contract instances.
- `contracts/incentives/ShapleyDistributor.sol` — reward distribution consumer.
- [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md) — `RewardLedger` integration.
- [`AIRGAP_PROBLEM_ONEPAGER`](../research/papers/airgap-problem-onepager.md) — substrate-level framing of off-chain ↔ on-chain boundaries.
