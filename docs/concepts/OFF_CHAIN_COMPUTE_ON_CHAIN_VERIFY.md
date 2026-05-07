# Off-Chain Compute, On-Chain Verify

**Status**: meta-pattern (extracted across multiple shipped subsystems, 2026-05-06)
**Companions**: [`verify-by-witness-not-by-execution`](./primitives/verify-by-witness-not-by-execution.md), [`SETTLEMENT_OVERVIEW`](../architecture/SETTLEMENT_OVERVIEW.md), [`REASONING_VERIFICATION_OVERVIEW`](../architecture/REASONING_VERIFICATION_OVERVIEW.md)

---

## Statement

When a property requires expensive computation to determine, do not run the computation on-chain. Instead: have an off-chain prover compute the answer, submit the answer alongside the action, and have the chain verify that the submitted answer is correct. The chain's role is verification, not solution; the prover does the work.

This is one meta-pattern instanced across multiple VibeSwap subsystems. The unification is worth naming because it informs design of any subsystem facing a "this computation is too expensive on-chain" tension.

## Where it appears

| Subsystem | Off-chain compute | On-chain verification |
|-----------|-------------------|----------------------|
| **Reasoning verification** (`contracts/governance/`) | SMT solver finds satisfying assignment for atom chain | substitutes witness into each atom, O(n) check |
| **Batch settlement** (`contracts/settlement/BatchPriceVerifier`) | clearing-price solver, orderbook matcher | bonded contest (cheap accept, expensive only on dispute) |
| **Batch settlement** (`contracts/settlement/BatchProver`) | STARK prover for full batch correctness | constant-gas STARK verification |
| **Shapley distribution** (`contracts/incentives/ShapleyDistributor` + `IShapleyVerifier`) | exponential Shapley value computation | verified-result interface read |
| **VWAP oracle** (`contracts/oracles/VWAPOracle`) | TWAP/VWAP windowed computation | prove-via-cumulator difference |
| **CAT Protocol** (Bitcoin substrate, sibling pattern) | PSBT construction with covenant outputs | covenant Script verification at consensus |

Each subsystem has the same shape: the chain is the verification surface, not the computation engine. Heavy lifting happens off-chain. The result is constrained to a form the chain can check cheaply.

## Why this is necessary

Three reasons make on-chain computation prohibitive at scale:

**Gas cost.** EVM operations are individually cheap but block-bound. A computation that requires `O(n^2)` work for `n = 1000` is impractical at any non-trivial throughput. SMT-style solving is worse — the worst case is exponential.

**Determinism trap.** On-chain compute must be fully deterministic. Most efficient algorithms (heuristic solvers, randomized methods, ML inference) are not. Implementing them with strict determinism leaks performance compared to off-chain equivalents.

**Upgrade brittleness.** A bug in the on-chain solver is a contract bug. Fixing it requires upgrade. An off-chain solver can be upgraded freely as long as the verification logic remains stable. The chain's commitment is to *what counts as a valid answer*, not *how the answer is found*.

The off-chain-compute-on-chain-verify pattern dodges all three: cost is paid by the prover (often nothing, since they can use any compute they have); determinism is in the verification (cheap to make deterministic); upgrades touch the prover side and leave the chain unchanged.

## The asymmetry property

The pattern relies on a structural cost asymmetry: *finding* an answer is hard, *checking* an answer is easy. NP-style problems exhibit this: SAT, integer programming, TSP, optimization, all require search to solve and constant-time-per-clause to verify a candidate solution. Cryptographic problems are similar: signing requires the private key, verifying requires the public key.

When the asymmetry exists, off-chain-compute-on-chain-verify is structurally superior. When it doesn't (e.g., a problem where checking is as hard as solving), the pattern degenerates and other approaches (bonded contest, formal verification) become preferable.

## Variants

The pattern has several variants based on what the prover submits:

### Witness-based verification
Prover submits the *answer* itself plus auxiliary data (a witness) that lets the chain verify. The chain substitutes and checks. Cheap on-chain; deterministic; fail-closed if the witness is wrong.

Examples: reasoning chain consistency, satisfiability proofs, Merkle inclusion proofs.

### Bonded optimistic verification
Prover submits the answer with a bond. The chain accepts optimistically. A challenge window opens; anyone can post a fraud proof. Bond slashes if proof valid; finalizes if window expires unchallenged.

Examples: BatchPriceVerifier, optimistic rollup state roots, IReasoningContest.

### ZK proof
Prover generates a succinct zero-knowledge proof attesting to the computation's correctness. The chain runs a constant-gas verifier. Privacy-preserving (the underlying data can be hidden); strong (cryptographically sound).

Examples: BatchProver (STARK), zk-rollups, IReasoningGateProof.

### Formal verification attestation
Prover (a formal-verification tool like Halmos) produces a proof certificate that the contract bytecode satisfies given invariants. The certificate is committed on-chain as an attestation bound to the bytecode hash.

Examples: high-assurance Tier 5 of reasoning verification, Certora-style attestation registries.

Each variant trades off prover cost, verifier cost, privacy, and strength. The protocol picks the variant that fits its risk-cost-throughput requirements.

## When the pattern applies

- The computation has structural cost asymmetry (NP-style, cryptographic).
- The result of the computation is small enough to fit in a transaction.
- The verification check is `O(n)` or constant-gas.
- The protocol can revert on verification failure (the action is not forced).

## When it does NOT apply

- The computation is itself the action (e.g., a bid in an auction *is* the answer; there's no separate computation to outsource).
- The verification is as expensive as the original problem (no asymmetry).
- The off-chain compute is too dynamic to bind to a verifiable claim (e.g., "the LLM's reasoning was good" — no clear verification surface).
- The latency overhead of off-chain round-trip exceeds the action's tolerance.

## Composition with other patterns

- **[Bonded permissionless contest](./primitives/bonded-permissionless-contest.md)**: the pattern's optimistic variant.
- **[Verify by witness, not by execution](./primitives/verify-by-witness-not-by-execution.md)**: the pattern's structured-witness variant.
- **[Dual-path adjudication](./primitives/dual-path-adjudication-preserving-existing-oracle.md)**: meta-pattern where two verification variants coexist (witness-cheap-default + ZK-or-contest-escalation).
- **[Expressibility as the gate](./EXPRESSIBILITY_AS_THE_GATE.md)**: the grammar restriction that makes verification cheap in the first place.

## Cross-substrate observation

CAT Protocol on Bitcoin instances the same pattern: off-chain SDK constructs Partially Signed Bitcoin Transactions with covenant outputs; on-chain (Bitcoin Script execution) verifies. The chain is the verification surface; the SDK is the prover. Different substrate, same shape.

This means the meta-pattern is *substrate-independent*. Any chain that has a verification primitive (Script, EVM, custom VM) and a way to bind off-chain compute to on-chain consequences (signature, hash, proof) can apply it. The pattern is not EVM-specific; it's a property of how to design protocols that need expensive computation under bounded gas.

## Implication for protocol design

When designing a new subsystem, ask: *what is the most expensive thing this needs to compute, and can the cost be shifted to a prover?*

If yes:
- Write the computation as off-chain SDK code (any language).
- Define the verification interface as the on-chain commitment.
- Pick the verification variant (witness, bonded, ZK, formal) that fits the cost-strength-privacy requirements.
- The on-chain contract is then small, auditable, and upgrade-stable.

If no, you may need to redesign the problem. Most "expensive on-chain" problems have an off-chain-compute-on-chain-verify decomposition; finding the decomposition is the design work.

## Origin

Pattern named 2026-05-06 after observing it across reasoning verification, batch settlement, Shapley distribution, oracle composition, and the CAT Protocol analysis. The unification was visible in retrospect because the discipline of writing down primitives across the autonomous run made the recurrence visible. Recursive demonstration: the discipline that produced the primitives is itself an off-chain-prover (Will + Claude reasoning) producing artifacts (markdown files) that the substrate (filesystem + git) verifies (commits land or don't, tests pass or don't).
