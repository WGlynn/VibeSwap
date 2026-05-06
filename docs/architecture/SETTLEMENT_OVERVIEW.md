# Settlement Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/settlement/`
**Companions**: [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md), [`RECURSIVE_BATCH_AUCTIONS.md`](./RECURSIVE_BATCH_AUCTIONS.md), [`ASYMMETRIC_COST_CONSENSUS.md`](./ASYMMETRIC_COST_CONSENSUS.md)

---

## What this subsystem does

Settlement-layer primitives for VibeSwap's batch auction. Three contracts handle the post-batch verification surface:

- **BatchPriceVerifier** — accept pre-computed clearing prices, verify in O(1) via bonded-contest pattern.
- **BatchProver** — coordinate ZK proof verification of batch settlement (STARK proofs of correct clearing, matching, shuffle fairness).
- **IShapleyVerifier** — interface for consuming verified off-chain Shapley computations.

Common shape: **off-chain compute, on-chain verify**. None of these contracts re-runs the expensive computation. They consume the result of off-chain work and check that the result is correct (via bond + dispute, or via succinct proof, or via verifier interface).

This is the [verify-by-witness-not-by-execution](../concepts/primitives/verify-by-witness-not-by-execution.md) primitive applied at the settlement boundary.

## File map

```
contracts/settlement/
├── BatchPriceVerifier.sol   ← bonded clearing-price submission with dispute window
├── BatchProver.sol          ← STARK proof coordination for batch correctness
└── IShapleyVerifier.sol     ← interface for verified-off-chain Shapley results
```

## Per-component role

### BatchPriceVerifier — O(1) clearing-price acceptance

Standard batch-auction settlement requires solving for the clearing price: the price `p*` such that aggregate buy demand = aggregate sell supply at `p*`. Naive on-chain solving is `O(n log n)` via binary search over the orderbook (see `libraries/BatchMath.sol`).

`BatchPriceVerifier` shifts the cost: an off-chain solver computes `p*`, posts a bond, and submits the answer. The contract accepts the answer optimistically. A challenge window opens. Anyone can post a fraud proof showing `p*` doesn't actually clear the batch — bond slashes to challenger; correct clearing recomputed on-chain (one-shot, expensive but rare).

If the window expires unchallenged, the price finalizes. Settlement proceeds.

The economic shape: typical case is `O(1)` (just accept the submitter's answer); contested case is `O(n log n)` (recompute), but only paid when fraud is alleged. Cost asymmetry favors honest submission.

This is the [bonded-permissionless-contest](../concepts/primitives/bonded-permissionless-contest.md) pattern applied to clearing-price computation.

### BatchProver — STARK proof of batch correctness

A more powerful tier: instead of bonded-contest dispute, use a ZK proof that the entire batch was settled correctly. The proof attests:
- The clearing price was computed correctly given the orderbook.
- The Fisher-Yates shuffle (using XORed reveal secrets) produced the correct ordering.
- Matched orders fill at the clearing price.
- Unmatched orders are returned without bias.

The actual STARK verification is delegated to an external verifier contract (e.g., a precompile or a registered verifier from `EIP-D` style registry). `BatchProver` coordinates the lifecycle: who submitted, when, what proof, against which batch.

Once the proof verifies, the batch is finalized — no challenge window needed. The proof is constant-size; verification is constant-gas regardless of batch size.

This is the gold-standard settlement: every property of correct batch processing is structurally proven, not bonded-disputed. The trade-off is prover cost (off-chain STARK generation is expensive) vs verifier cost (on-chain is cheap). For high-stakes batches, the proof is worth it.

### IShapleyVerifier — abstracted verification interface

`ShapleyDistributor.sol` distributes batch fees (and other reward pools) using Shapley values. Computing Shapley values on-chain for `n` participants is `O(2^n)` — exponential. Off-chain computation produces the values; an `IShapleyVerifier` implementation attests to their correctness.

The interface:
```solidity
function getVerifiedValues(bytes32 gameId) external view returns (address[] memory, uint256[] memory);
function getVerifiedTotalPool(bytes32 gameId) external view returns (uint256);
function isFinalized(bytes32 gameId) external view returns (bool);
```

A consuming contract (`ShapleyDistributor`) calls these methods to get verified results. The interface deliberately abstracts over *how* verification happens. Implementations may use:
- Bonded contest (similar to `BatchPriceVerifier`).
- ZK proof (similar to `BatchProver`).
- Federated authority (similar to `FederatedConsensus`).
- Hybrid approaches.

The decoupling is the property: `ShapleyDistributor` doesn't know which verifier shipped; it consumes the same interface regardless. Verifier upgrades happen without redeploying the distributor.

## Composition flow (batch settlement)

```
1. Commit phase ends, reveal phase ends — orderbook is finalized
   │
   ▼
2. Off-chain solver computes clearing price + matching + shuffle output
   │
   ▼
3a. (cheap path) BatchPriceVerifier:
   - submitter posts bond + clearing price
   - accepts optimistically
   - challenge window opens
   │
   ▼
3b. (high-stakes path) BatchProver:
   - prover generates STARK proof of correct settlement
   - submits proof + public inputs
   - external STARK verifier checks
   - on success: batch finalized immediately
   │
   ▼
4. ShapleyDistributor:
   - reads from IShapleyVerifier (specific impl chosen at deploy)
   - distributes fees per Shapley values
   │
   ▼
5. Settled — funds flow per matched orders
```

The two settlement paths (3a and 3b) are alternatives, not sequential. A protocol deployment chooses one based on its risk tolerance and gas budget. High-frequency batches favor 3a (cheap, occasionally contested). High-stakes batches favor 3b (expensive prover, no challenge window).

## Why three contracts, not one

Each contract addresses a different property of "verify off-chain compute on-chain":

- **BatchPriceVerifier**: verification via dispute. Game-theoretic, slow worst-case, cheap typical-case.
- **BatchProver**: verification via succinct proof. Cryptographic, fast worst-case, expensive typical-case.
- **IShapleyVerifier**: abstracted *interface* over the verification choice, so consumers don't depend on which path was taken.

Splitting them allows:
- Different batches to use different verification paths (some cheap-with-dispute, some prove-heavy).
- Verifier-implementation upgrades without consumer changes (interface is the stable surface).
- Game-theoretic and cryptographic verification to coexist in the same protocol — each appropriate for its situation.

The pattern matches the [dual-path-adjudication](../concepts/primitives/dual-path-adjudication-preserving-existing-oracle.md) primitive: don't replace one verification mode with another; let them coexist with the consumer choosing per-batch.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| `BatchPriceVerifier.bondAmount` | configurable | minimum bond for clearing-price submission |
| `BatchPriceVerifier.disputeWindow` | configurable | seconds after submission before finalization |
| `BatchProver.verifierContract` | settable | which STARK verifier to use (allows upgrade) |
| `IShapleyVerifier` impl choice | per-deployment | bonded-contest, ZK, federated, or hybrid |

All contracts UUPS-upgradeable; bond/window parameters tunable by governance.

## Why this matters

The settlement boundary is where computation expense meets gas budget. Without these primitives, batch auctions either:
- Pay full gas cost for clearing price + shuffle + matching on-chain (gas-prohibitive at scale), OR
- Accept off-chain settlement on trust (defeats the auction's MEV-resistance property).

The verify-not-execute split keeps both budget-friendly AND trust-minimized. The structural property is preserved: the chain validates settlement; off-chain compute does the heavy lifting; correct settlement is enforceable by anyone.

## Related

- [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md) — the broader 6-mechanism consensus stack within which settlement sits.
- [`RECURSIVE_BATCH_AUCTIONS.md`](./RECURSIVE_BATCH_AUCTIONS.md) — the auction format being settled.
- [`verify-by-witness-not-by-execution`](../concepts/primitives/verify-by-witness-not-by-execution.md) — the primitive this subsystem instances.
- [`bonded-permissionless-contest`](../concepts/primitives/bonded-permissionless-contest.md) — sibling pattern used by BatchPriceVerifier.
- [`dual-path-adjudication-preserving-existing-oracle`](../concepts/primitives/dual-path-adjudication-preserving-existing-oracle.md) — meta-pattern of two verification paths coexisting.
