# Rosetta Covenants — Cross-Chain Application to VibeSwap

**Status**: Companion to [Rosetta Covenants](./ROSETTA_COVENANTS.md) (Faraday1, March 2026).
**Depth**: How covenant scripts preserve invariants across LayerZero V2 cross-chain deployment.
**Related**: [Cross-Chain Settlement](./CROSS_CHAIN_SETTLEMENT.md), [Mechanism Composition Algebra](./MECHANISM_COMPOSITION_ALGEBRA.md), [ETM Alignment Audit](./ETM_ALIGNMENT_AUDIT.md).

---

## The question

Parent doc ([Rosetta Covenants](./ROSETTA_COVENANTS.md)) establishes the Rosetta Protocol with ten covenants — invariants that protocol actions must preserve. When VibeSwap deploys across multiple chains (Ethereum L1, L2s, LayerZero-connected chains), how do the covenants preserve across chain boundaries?

This is non-trivial. Chains have different finality models, different block times, different transaction ordering guarantees. An invariant that holds on chain A may not obviously hold on chain B + their cross-chain bridge.

This doc addresses the cross-chain composition problem.

## What a covenant is

A covenant is an on-chain invariant that every mechanism operating on the substrate must preserve. Unlike a rule ("don't do X"), a covenant is structural ("X is impossible by construction"). Unlike a simple invariant ("X > Y"), a covenant is a compositional property ("if A and B are valid under the covenant, so is their composition").

The ten Rosetta covenants (per parent doc) cover fairness, attribution, reversibility, type-safety, and related properties. Each is enforced by specific contract-level code; together they form the Rosetta substrate.

## The cross-chain failure modes

### Failure mode 1 — Partial commitment

A transaction starts on chain A and relies on a sibling transaction on chain B. If A commits but B fails (or vice versa), the invariant is broken mid-transaction.

Covenant impact: "atomicity of composed actions" covenant is violated. System may enter a state where partial information exists on one chain but not the other.

### Failure mode 2 — Finality asymmetry

Chain A has 12-block finality; chain B has instant finality; chain C has fraud-proof-window finality. A cross-chain composition relying on "final when seen" means different things on different chains.

Covenant impact: "recoverable-from-any-state" covenant. If a chain reorgs after another chain committed based on it, the downstream chain can't trivially roll back.

### Failure mode 3 — Bridge replay

A LayerZero message delivered twice — rare but possible with replays. Action fires twice on destination chain.

Covenant impact: "no-double-execution" covenant. The destination chain must reject duplicate delivery.

### Failure mode 4 — State divergence

Chain A's view of "correct state" differs from chain B's. A cross-chain query returns inconsistent answers.

Covenant impact: "single-source-of-truth" covenant. Needs one chain to be canonical or all chains to commit to a common Merkle root.

## Cross-chain covenant preservation patterns

### Pattern 1 — Chain-native execution with cross-chain commitment

Action executes entirely on chain A. Chain B receives only a commitment (hash) and a proof, which it verifies. Chain B doesn't re-execute; it trusts the verified commitment.

Example: TPO oracle updates on chain A; chain B receives `(update_hash, signature, Merkle_proof_of_inclusion)`. Chain B verifies the proof; if valid, updates its mirror of the oracle state.

Covenant preservation: **high**. Chain B's invariant check is just "is the commitment verified?" — atomic and deterministic.

### Pattern 2 — Commit-reveal bridging

Chain A commits; chain B can reveal (execute) only after commitment finality. Both chains hold the commit-reveal pattern synchronously.

Example: cross-chain batch auction. Commit on A, reveal on B within the reveal window. The commitment on A is the evidence that allows B's reveal.

Covenant preservation: **high**. Requires finality coordination but the covenants themselves (commit must precede reveal, reveal must match commit) hold natively.

### Pattern 3 — Optimistic bridging with challenge window

Chain A commits; chain B executes optimistically. A challenge window on B allows disputes to roll back the action if chain A's commitment was invalid.

Example: optimistic Shapley distribution — compute on A, distribute on B, challenge on B if the distribution doesn't match A's verifiable computation.

Covenant preservation: **medium**. Challenge window adds latency; during challenge window, the system is in a provisional state. Covenants are provisional-holdings until challenge window closes.

### Pattern 4 — Full cross-chain atomic

Uses LayerZero's atomic cross-chain primitives (where available) to ensure all-or-nothing. Either action commits on both chains or neither.

Covenant preservation: **high in principle, limited in practice**. True atomic cross-chain is expensive; reserved for high-value operations.

## Which covenants VibeSwap needs cross-chain

VibeSwap's planned multichain deployment (L1 + L2s + LayerZero chains) requires preserving these covenants specifically:

### Fairness (P-000 derivative)

Execution fairness must hold regardless of which chain a user connects from. Cross-chain routing should never give some chains preferential outcomes.

Preservation pattern: Pattern 1 — commitments to fairness-parameters propagate across chains; each chain's local execution matches the committed parameters.

### No Extraction (P-001)

Extraction surfaces must be closed on every chain. A chain with weaker defenses becomes an attack vector (route attacks through the weakest chain, profit across the bridge).

Preservation pattern: Pattern 1 + local enforcement. Each chain runs the full defense suite; cross-chain bridge rejects transfers that violated the origin chain's defense.

### Attribution (Lawson Constant)

Contributions credit must trace correctly regardless of which chain the attribution was minted on.

Preservation pattern: Pattern 1 — attestation commitments replicate across chains via LayerZero; lineage queries can span chains via commitment-verification.

### Reversibility (Clawback-compatible)

Clawback Cascade must be able to propagate across chains. Tainted funds that bridge to another chain don't escape the graph.

Preservation pattern: Pattern 3 (optimistic with challenge window). Tainted propagation on the bridge itself; destination chain can be notified + contest.

### Type safety

Token types (JUL / VIBE / CKB-native) must preserve their role identity across chains. A bridged JUL is still monetary, not governance.

Preservation pattern: Pattern 1 — the bridge representation is deterministic from the original; chain-specific wrappers don't change role semantics.

## The LayerZero V2 substrate

LayerZero V2 provides:
- **Arbitrary message passing** between chains.
- **Ordering guarantees** — messages delivered in order within a channel.
- **Retry semantics** — failed deliveries can be retried; consumers must handle idempotently.
- **Replay resistance** — a single message delivery has a unique `guid` preventing double-execution.

These primitives are sufficient for Patterns 1-3. Pattern 4 (full atomic) is not built into LayerZero V2; it requires higher-level protocols.

## The Rosetta-specific composition rule

For a cross-chain VibeSwap action, the composition rule is:

> The action is valid iff its local-chain execution is valid AND its cross-chain commitment is verifiable AND its cross-chain counterpart is either executed or demonstrably-executable.

Three conjoined conditions. Each must hold; none can be relaxed.

Ship-time verification:
1. Local execution: existing tests on single-chain cycles.
2. Commitment verifiability: LayerZero message-format test + signature-verification tests.
3. Counterpart executability: cross-chain integration tests with mocked peer chain.

All three are required to ship. Neither alone is sufficient.

## The covenant tax

Cross-chain covenant preservation has a cost — latency, gas, complexity. Single-chain actions are cheap; cross-chain actions are expensive.

The design response: keep most value-creating activity single-chain, use cross-chain for specific coordination purposes (cross-chain settlement, multi-chain oracle sync, cross-chain attribution replication).

Not every operation goes cross-chain. Only operations that require it. The bias should be "stay on one chain unless necessary to cross."

## Open questions

1. **Finality-model harmonization** — can we define a common finality model across chains (e.g., "wait for largest chain's finality") that all actions respect?
2. **Cost-benefit per covenant** — which covenants are worth cross-chain preservation? Which can be chain-local only?
3. **Bridge resilience metrics** — how do we measure the health of LayerZero integrations? Alert on degradation?

Each is a research + engineering direction.

## Relationship to the broader multichain strategy

VibeSwap's long-term architecture targets multichain deployment. The design choice is HOW to deploy multichain, not whether. Options:

- **Native multichain** — deploy identical contracts on every chain, bridge state via LayerZero. (Current plan.)
- **Hub-and-spoke** — main chain holds canonical state; other chains mirror. (Simpler, but asymmetric.)
- **Fully-federated** — each chain holds its own state; merging happens at query time. (Most complex.)

Native multichain with covenant-preserving bridges is the current trajectory. This doc is part of the design substrate for that trajectory.

## One-line summary

*Cross-chain VibeSwap preserves Rosetta covenants via four patterns (chain-native+commitment, commit-reveal bridging, optimistic with challenge, full atomic) applied per-covenant; LayerZero V2 is sufficient substrate for Patterns 1-3; cross-chain covenant preservation is non-free so bias toward single-chain except where coordination requires cross.*
