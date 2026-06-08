# ZK Router Verifier — CKB Cell Spec

**Spec layer**: extends `contracts/core/CommitRevealAuction.sol` with verified external-DEX routing
**Port classification**: BUILD-NEW
**Status**: Spec draft. Extension 2 of the match-or-beat-CoW plan. Heaviest lift; last in sequence.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

When the batch's residual (after Extensions 1, 3, and 4 have done their work) still needs routing through external DEX liquidity, allow off-chain solvers to propose a routing, but only accept it if the solver attaches a ZK proof that:

- The routing's quoted prices match the external pools' state at a specific block on each relevant chain.
- The routing produces the claimed output amounts (the math is correct).
- No better routing exists within a bounded search space defined by a relaxation parameter ε (proof of approximate optimality).

The settlement type-script verifies the proof. If valid, the routing is accepted and the solver receives a fee proportional to the surplus captured.

The structural property: solvers compete to find the best routing, but they cannot lie about what they found. The trust assumption shrinks from "we trust the solver's honesty" to "we verify the solver's proof." CoW Protocol relies on the former; we replace it with the latter.

This is the heaviest piece of the match-or-beat-CoW plan because it requires a ZK proving system that fits within CKB-VM's cycle budget for verification. Multiple unknowns; the spec is the design; the implementation depends on choosing the right proving system and validating its cycle cost.

## Cell architecture

**SolverProposalCell**: proposes a routing with attached ZK proof. Created off-chain (by the solver) and submitted on-chain.

**RoutingProofVerifierCell**: holds the verifying-key cell-data for the ZK system in use. Read via cell-dep by the settlement type-script.

**SolverBondCell**: solver's stake. Slashable if a proof is submitted that doesn't verify (anti-spam).

**SolverRewardCell**: created on successful proof acceptance, releases the solver's earned fee.

## Mechanism

**Solver workflow** (off-chain):
1. Solver observes the batch's residual after Path A and Path B have been computed
2. Solver searches over external DEX pools (Uniswap V2/V3, Balancer, Curve, etc. on supported chains) for the best routing
3. Solver constructs a ZK proof attesting to the routing's correctness and approximate optimality
4. Solver submits a SolverProposalCell on-chain with the proposed routing + proof

**On-chain workflow**:
1. The settlement transaction reads SolverProposalCells for this batch via cell-dep
2. For each proposal, the settlement type-script verifies the proof using the RoutingProofVerifierCell's verifying key
3. The best valid proof (highest output amount for Path C-eligible trades) is selected
4. The selected routing's output amounts are credited to the relevant traders' positions
5. The solver's SolverRewardCell is created with the earned fee

## Per-cell specifications

### SolverProposalCell

**Data layout** (cell-data):
- `version: u8`
- `batch_id: u64`
- `solver_lock_hash: [u8; 32]`
- `proposed_routing: Routing`
- `claimed_output_per_trader: Vec<(OutPoint, u128)>` (reveal_outpoint → output amount)
- `claimed_external_state_block: u64` (block height on each external chain at which the proof is rooted)
- `relaxation_epsilon_bps: u16` (claimed optimality up to ε)
- `zk_proof: Vec<u8>` (the proof blob)
- `solver_bond_outpoint: OutPoint` (the solver's bonded stake)

**Lock-script**: Permissionless creation.

**Type-script invariants** (at creation):
- `claimed_external_state_block` is recent (within `MAX_PROOF_STALENESS_BLOCKS`)
- `relaxation_epsilon_bps` is within `MAX_EPSILON_BPS` (default 100 = 1% relaxation)
- `solver_bond_outpoint` references an existing SolverBondCell with sufficient bond

**Type-script invariants** (at consumption by settlement transaction):
- The settlement transaction consuming this proposal verifies the ZK proof
- If proof verifies and proposal is selected: solver earns fee
- If proof fails to verify: solver's bond is slashed; the proposal is discarded
- If proof verifies but proposal is not selected (a better one was chosen): no slashing, no reward, the cell is consumed without effect

### RoutingProofVerifierCell

**Data layout** (cell-data):
- `version: u8`
- `proving_system: ProvingSystem` (enum: SP1 / Halo2 / Groth16 / custom)
- `verifying_key: Vec<u8>` (the VK blob)
- `current_circuit_hash: [u8; 32]` (commitment to the circuit's logic)
- `previous_circuit_hash: Option<[u8; 32]>` (for migration tracking)

**Lock-script**: Governance-gated. Upgrades require NCI ProtocolDecisionCell authorization.

**Type-script invariants**:
- Verifying key is well-formed for the declared proving system
- Circuit hash matches a published circuit specification
- Upgrades follow the governance path (preserving the previous_circuit_hash for in-flight proposals)

### SolverBondCell

**Data layout** (cell-data):
- `version: u8`
- `solver_lock_hash: [u8; 32]`
- `bond_amount: u128`
- `slashed: bool`
- `bonded_at_block: u64`

**Lock-script**: Solver's lock. Spendable only if unbonded and not slashed.

**Type-script invariants**:
- Bond amount above minimum (Lawson constants)
- Slashing only on submitted proof that fails verification or attestation of dishonest behavior
- Unbonding requires a period elapsed without active proposals

## Cycle-budget analysis

ZK proof verification cost on CKB-VM is the binding constraint. Different proving systems have different verification costs:

- **SP1 (Succinct Labs)**: Plonky3-based, recursive STARK. Verification typically expensive (~millions of cycles), but bounded.
- **Halo2**: PLONK-based. Verification expensive but well-studied. Open question whether it fits CKB-VM budget for typical batch sizes.
- **Groth16**: Cheapest verification but requires trusted setup per circuit. Possible if circuit is stable.
- **Custom STARK with FRI**: tunable verification cost via FRI parameters.

**Decision deferred until spike**: which proving system, and whether the verification fits within CKB-VM cycle budget for typical batches. This is the largest unknown in the entire match-or-beat-CoW plan.

If verification doesn't fit on-chain, alternatives:

- **Off-chain verification with bonded validators**: BLS-aggregated attestations from a validator set replace the on-chain proof verification. Less trust-minimized but tractable.
- **Optimistic with challenge window**: solver submits proof, anyone with the proof can challenge during a window. If unchallenged, accepted. Adds latency.
- **Recursive proof + batched verification**: amortize verification across multiple batches.

Each fallback is documented as a contingency. The spec lands the design; implementation chooses based on spike results.

## Proof claims (the ZK circuit's job)

The ZK circuit attests to:

1. **External state correctness**: the prices and reserves quoted for each external pool match the actual on-chain state at the specified block. The proof reads cross-chain state via a light-client / state-commitment trick (e.g., Ethereum state root committed via the canonical messaging system).

2. **Routing math correctness**: given the quoted state, the routing produces the claimed output amounts for each trader. Each hop's swap math (constant-product, UniV3 ticks, Curve invariant, etc.) is executed correctly in-circuit.

3. **Approximate optimality**: within a relaxation parameter ε, no better routing exists in the searched space. The circuit verifies that the routing dominates all other routings the solver considered. This bounds the "honest search" claim without requiring an exhaustive proof.

The relaxation ε is what makes the proof tractable. ε = 1% means "the proof attests that no routing exists that's more than 1% better than the proposed one in the searched space." Tighter ε = more expensive proof generation. Looser ε = cheaper but less optimal guarantee.

## Composition with other extensions

**Composable resolution paths (Extension 3)**: Path C consumes the ZK-verified routing. If no valid proposal exists for a batch, Path C falls back to Path B.

**Batch cycle resolver (Extension 1)**: cycle decomposition runs first; only post-cycle residual is eligible for Path C routing.

**Multi-curve AMM (Extension 4a)**: internal multi-hop happens via Path B before Path C considers external routing.

**MessagingHub (existing spec)**: external chain state attestations flow through the canonical burn-and-mint messaging system, providing the trust anchor for ZK proofs to commit against.

## Beats CoW (where it lands)

CoW Protocol's solver competition: solvers are bonded, but the protocol assumes the winning solver searched honestly. There's no verification that the solver actually found the best routing.

VibeSwap's ZK-verified solver: solvers are bonded AND verified. The proof bounds the "honest search" claim mathematically. A solver who tries to cheat fails verification and loses their bond.

This is a structural trust reduction. CoW assumes solvers are honest in their search; we verify their proof. The bonded-solver economic incentive remains; the trust assumption that depended on it shrinks.

## Property preservation

**Trust-minimized**: proof verification replaces solver-honesty assumption.

**Permissionless solving**: any solver can submit a proposal. Best valid proposal wins.

**Bonded incentive structure**: solvers stake; bad-faith proposals get slashed; honest solvers earn fees.

**Bounded optimality claim**: ε-relaxation makes the proof tractable while still constraining the solver's search-quality claim.

**Graceful fallback**: if Path C is unavailable (no valid proposals, proving infra not ready, etc.), Path B is the natural fallback. Traders aren't blocked; they just get a less-optimal execution.

## Transaction shapes

**Solver bond transaction**: solver-initiated.
- Inputs: solver's CanonicalTokenCell, capacity
- Outputs: SolverBondCell

**Proposal submission**: solver-initiated (one per batch, or multiple competing proposals).
- Inputs: capacity, solver's SolverBondCell (referenced via cell-dep)
- Outputs: SolverProposalCell

**Settlement with Path C**: extends the standard settlement transaction.
- Inputs: all RevealCells, relevant PoolCells, SolverProposalCells (consumed if accepted)
- Outputs: BatchSettlementCell with Path C consumption noted, SolverRewardCell for accepted solver

**Slashing**: permissionless, evidence-driven.
- Inputs: SolverProposalCell with provably-invalid proof + slashing evidence
- Outputs: SolverBondCell with `slashed: true`, slashed amount to slashing pool

## Upstream pulls

**From a chosen ZK proving system**: SP1 or Halo2 or alternative. Pulls the verifier as a no_std Rust crate (or compiled-to-RISC-V CKB binary).

**From `ckb-std`**: standard syscalls, witness parsing.

**From MessagingHub spec**: cross-chain state attestation infrastructure.

**From `batch-cycle-resolver.md`** and **`multi-curve-amm.md`**: the prior-paths' computations that the residual is routed against.

## Build new

**`vibeswap-ckb-zk-router-verifier-type-script`**: Rust crate. Reads the SolverProposalCell, the RoutingProofVerifierCell, the relevant external-chain state attestations; runs the ZK verifier; emits accept/reject.

**`vibeswap-ckb-solver-bond-type-script`**: Rust crate. Standard bonding cell with slashing condition.

**`vibeswap-ckb-routing-circuit`**: the ZK circuit definition. Likely in a separate language (Halo2's DSL, SP1's Rust, Circom, etc.). The compiled verifier is what lives on-chain.

**Off-chain solver SDK**: a development kit so solvers can build proposals against the canonical circuit. Reference implementation in Rust.

## Open questions

- **ZK proving system choice**: the biggest unknown. Requires spike. Decision likely made on (a) verification cycle cost, (b) proof generation time, (c) supported circuit complexity.
- **External chain state attestation**: how do we get UniV3 or Curve pool state into our ZK circuit? Likely via Merkle proofs against state roots committed through the canonical messaging system. Adds complexity to the circuit.
- **Optimality relaxation ε calibration**: too loose = solvers can game; too tight = expensive proof. Empirical question.
- **Solver bond size**: enough to deter bad-faith proposals, not so large that solvers are priced out. Calibrate based on expected fees.
- **Off-chain coordination**: solvers need to know which batches to compete on. Coordination is off-chain; protocol design TBD.
- **Fallback timeline**: until ZK verification is proven tractable in CKB-VM, Path C falls back to Path B. Document this fallback as the live state until further spike.

## Cross-references

- Parent specs: `commit-reveal-auction.md`, `composable-resolution-paths.md`
- Depends on: `multi-curve-amm.md` (curve formulas in-circuit), MessagingHub (cross-chain state attestation)
- Plan doc: `Desktop/vibeswap-match-or-beat-cow-mechanism-plan-2026-06-08.md` (Extension 2)
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·honesty-as-structural-load-bearing-property]` (ZK proof makes solver-honesty structurally enforced), `[F·dont-default-concede-verify-first]` (replacement of CoW's trust assumption is a structural improvement, not parity)
