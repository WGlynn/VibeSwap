# Rosetta Covenants — Cross-Chain Application

**Status**: Companion to [Rosetta Covenants](./ROSETTA_COVENANTS.md) (Faraday1, March 2026).
**Audience**: First-encounter OK. Covenant-preservation patterns walked with LayerZero specifics.

---

## The problem framed

You've built a sophisticated mechanism. It works on chain A. You want to deploy across multiple chains via LayerZero V2.

Concern: cross-chain coordination is hard. What holds on chain A may not hold when chain A talks to chain B. Invariants can break at the boundary.

Specifically: the Rosetta Covenants (ten invariants your mechanism must preserve) — how do they behave across chain boundaries?

This doc addresses the cross-chain composition problem.

## What a Covenant is (refresher)

A **covenant** is an on-chain invariant that every mechanism operating on the substrate must preserve.

Unlike rule ("don't do X"): structural ("X is impossible by construction").
Unlike simple invariant ("X > Y"): compositional ("if A and B valid under covenant, so is their composition").

The ten Rosetta covenants (per parent doc) cover fairness, attribution, reversibility, type-safety, and related properties. Each is enforced by specific contract-level code. Together: the Rosetta substrate.

## The cross-chain failure modes

Four failure modes breaking covenants at chain boundaries:

### Failure 1 — Partial commitment

Transaction starts on chain A. Relies on sibling transaction on chain B. If A commits but B fails (or vice versa), the invariant breaks mid-transaction.

**Concrete example**: bridge USDC from Ethereum to Polygon. Ethereum burns USDC. Message sent to Polygon to mint. Polygon contract upgrade-paused; mint fails. Ethereum-burn is permanent; Polygon-mint never happens. USDC effectively lost.

### Failure 2 — Finality asymmetry

Chain A has 12-block finality. Chain B has instant finality. Chain C has fraud-proof-window finality. Cross-chain composition using "final when seen" means different things on different chains.

**Covenant violated**: "recoverable-from-any-state." If a chain reorgs after another committed based on it, the downstream can't trivially roll back.

### Failure 3 — Bridge replay

A LayerZero message delivered twice — rare but possible. Action fires twice on destination.

**Covenant violated**: "no-double-execution." Destination chain must reject duplicate delivery.

### Failure 4 — State divergence

Chain A's view of "correct state" differs from chain B's. Cross-chain query returns inconsistent answers.

**Covenant violated**: "single-source-of-truth." Needs one chain canonical or all committing to common Merkle root.

## Four covenant-preservation patterns

### Pattern 1 — Chain-native execution with cross-chain commitment

Action executes entirely on chain A. Chain B receives only a commitment (hash) and a proof, which it verifies. Chain B doesn't re-execute; it trusts the verified commitment.

**Concrete example**: TPO oracle updates on chain A; chain B receives `(update_hash, signature, Merkle_proof)`. Chain B verifies the proof; if valid, updates its mirror of oracle state.

Covenant preservation: **high**. Chain B's invariant check is "is the commitment verified?" — atomic and deterministic.

### Pattern 2 — Commit-reveal bridging

Chain A commits; chain B can reveal (execute) only after A's commitment finalizes. Both chains hold commit-reveal synchronously.

**Concrete example**: cross-chain batch auction. Commit on A, reveal on B within window. Commitment on A is evidence enabling B's reveal.

Covenant preservation: **high**. Requires finality coordination but covenants themselves (commit precedes reveal, reveal matches commit) hold natively.

### Pattern 3 — Optimistic bridging with challenge window

Chain A commits; chain B executes optimistically. Challenge window on B allows disputes to roll back action if A's commitment was invalid.

**Concrete example**: optimistic Shapley distribution — compute on A, distribute on B, challenge on B if distribution doesn't match A's verifiable computation.

Covenant preservation: **medium**. Challenge window adds latency; during window, system is in provisional state. Covenants are provisional-holdings until window closes.

### Pattern 4 — Full cross-chain atomic

Uses LayerZero's atomic cross-chain primitives (where available) to ensure all-or-nothing. Either commits on both or neither.

Covenant preservation: **high in principle, limited in practice**. True atomic cross-chain is expensive; reserved for high-value operations.

## VibeSwap's covenant needs mapped to patterns

VibeSwap's planned multichain deployment (L1 + L2s + LayerZero chains) requires preserving specific covenants.

### Fairness (P-000 derivative)

Execution fairness must hold regardless of which chain a user connects from. Cross-chain routing should never give some chains preferential outcomes.

**Pattern used**: 1 (Chain-native + cross-chain commitment). Commitments to fairness-parameters propagate; each chain's local execution matches.

### No Extraction (P-001)

Extraction surfaces must be closed on every chain. A chain with weaker defenses becomes attack vector.

**Pattern used**: 1 + local enforcement. Each chain runs full defense suite; cross-chain bridge rejects transfers that violated origin chain's defense.

### Attribution (Lawson Constant)

Contributions credit must trace correctly regardless of which chain the attribution was minted on.

**Pattern used**: 1 — attestation commitments replicate across chains via LayerZero; lineage queries span chains via commitment-verification.

### Reversibility (Clawback-compatible)

Clawback Cascade must propagate across chains. Tainted funds bridging to another chain don't escape graph.

**Pattern used**: 3 (optimistic with challenge). Tainted propagation on bridge itself; destination chain notified + can contest.

### Type safety

Token types (JUL / VIBE / CKB-native) must preserve their role identity across chains. Bridged JUL is still monetary, not governance.

**Pattern used**: 1 — bridge representation is deterministic from original; chain-specific wrappers don't change role semantics.

## The LayerZero V2 substrate

LayerZero V2 provides:
- **Arbitrary message passing** between chains.
- **Ordering guarantees** — messages delivered in order within channel.
- **Retry semantics** — failed deliveries retriable; consumers handle idempotently.
- **Replay resistance** — each message has unique GUID.

These primitives sufficient for Patterns 1-3. Pattern 4 (full atomic) isn't built into LayerZero V2; requires higher-level protocols.

## The Rosetta-specific composition rule

For a cross-chain VibeSwap action, composition rule:

> The action is valid iff its local-chain execution is valid AND its cross-chain commitment is verifiable AND its cross-chain counterpart is either executed or demonstrably-executable.

Three conjoined conditions. Each must hold; none relaxable.

Ship-time verification:
1. Local execution: existing tests on single-chain cycles.
2. Commitment verifiability: LayerZero message-format test + signature-verification.
3. Counterpart executability: cross-chain integration tests with mocked peer chain.

All three required to ship.

## The covenant tax

Cross-chain covenant preservation has cost — latency, gas, complexity. Single-chain actions are cheap; cross-chain actions are expensive.

Design response: keep most value-creating activity single-chain. Use cross-chain only for specific coordination (cross-chain settlement, multi-chain oracle sync, cross-chain attribution replication).

Not every operation goes cross-chain. Only those requiring it. Bias: "stay on one chain unless necessary to cross."

## Walk through a specific cross-chain scenario

Let's trace a specific cross-chain Shapley distribution.

### Setup

- Chain A: VibeSwap main deployment. Where Shapley computation happens.
- Chain B: secondary deployment where rewards flow to specific contributors.
- Contributors on both chains.

### Step 1 — Compute on A

Keeper computes Shapley off-chain (per [Optimistic Shapley](../shapley/OPTIMISTIC_SHAPLEY.md)). Commits Merkle root on chain A.

### Step 2 — Cross-chain message

Chain A sends LayerZero message to Chain B: "Here's the Merkle root for Round #47. Total amount: X. Finalized after 7 days without challenge."

### Step 3 — Chain B receives

Chain B verifies LayerZero message. Stores the root. Opens its own 7-day window synchronized with A's.

### Step 4 — Challenge window

During window, parties on either chain can dispute. Dispute-resolution happens on chain A (where computation lives), but chain B is party to the outcome.

### Step 5 — Finalization

After 7 days without successful dispute, chain B's stored root becomes final. Contributors on chain B claim rewards via Merkle proofs.

This uses Pattern 3 (optimistic with challenge). Chain A does the expensive work; Chain B trusts the commitment after verification period.

## Future directions

### Cross-chain ZK-proofs

When ZK-proof generation cost drops enough, Pattern 4 becomes viable. Chain B verifies ZK-proof directly; no challenge window needed.

### Cross-chain trust-graph replication

Currently ContributionDAG is per-chain. Cross-chain replication via Merkle anchoring would allow trust-portability.

### Cross-chain settlement atomicity

For DEX-like cross-chain operations, full atomicity would improve UX. Research direction.

## For students

Exercise: design a cross-chain mechanism for a different domain.

Pick: cross-chain voting, cross-chain lending, cross-chain NFT ownership.

Apply framework:
1. What covenants need preservation?
2. Which failure modes are relevant?
3. Which pattern (1-4) fits best?
4. What LayerZero primitives are needed?
5. What's the covenant-tax tradeoff?

Design your mechanism. Compare to VibeSwap's approach.

## Relationship to other primitives

- **Parent**: [Rosetta Covenants](./ROSETTA_COVENANTS.md) — the ten covenants this extends.
- **Infrastructure**: LayerZero V2 — the messaging substrate.
- **Pattern application**: [Cross-Chain State Atomicity](./CROSS_CHAIN_STATE_ATOMICITY.md) — related.

## One-line summary

*Cross-chain VibeSwap preserves Rosetta covenants via four patterns: chain-native+commitment (1), commit-reveal bridging (2), optimistic with challenge (3), full atomic (4). LayerZero V2 sufficient for 1-3. Each VibeSwap covenant mapped to specific pattern. Covenant tax is real; bias toward single-chain except where coordination requires. Walked cross-chain Shapley distribution example using Pattern 3. Ship-time verification requires all three: local + commitment + counterpart.*
