# Execution-Settlement Separation: Off-Chain Compute, On-Chain Truth

**William T. Glynn & JARVIS**
**VibeSwap Protocol — March 2026**

---

## Abstract

On-chain computation is expensive, slow, and architecturally wasteful. Shapley value distribution over n participants costs O(2^n). Binary search for clearing prices costs O(n log n). Trust score aggregation across a social graph costs O(V + E). Yet these computations are **deterministic** — given the same inputs, they always produce the same outputs.

We present an **execution-settlement separation** pattern that moves heavy computation off-chain while preserving the trust guarantees of on-chain verification. Instead of recomputing results on-chain, we verify that submitted results satisfy fundamental mathematical invariants (axioms) and are backed by Merkle proofs against a committed root. Submitters are economically bonded; anyone can dispute incorrect results within a time window, triggering slashing.

This pattern achieves 90%+ gas savings while maintaining trustlessness. The verification functions are **pure** — stateless, account-model agnostic — making them directly portable from EVM to CKB RISC-V cell scripts. The math is the kernel; the chain is just the first instantiation.

---

## 1. The Problem: Computation Doesn't Belong On-Chain

### 1.1 The Cost of On-Chain Math

Ethereum's execution model charges gas for every opcode. Complex mathematical operations — which are essential for fair protocol operation — become prohibitively expensive:

| Operation | On-Chain Cost | Off-Chain Cost |
|-----------|--------------|----------------|
| Shapley values (10 players) | ~2M gas (~$50) | <1ms |
| Clearing price (1000 orders) | ~500K gas (~$12) | <10ms |
| Trust score (10K node graph) | Impossible | ~100ms |
| Quadratic vote tally (1000 voters) | ~300K gas (~$7) | <5ms |

The fundamental insight: **verification is always cheaper than computation**. Checking that a set of Shapley values sums to the total pool (O(n)) is trivial. Computing those values from scratch (O(2^n)) is exponential. This asymmetry is the basis for the entire pattern.

### 1.2 Existing Approaches and Their Limitations

**Optimistic Rollups** separate execution from settlement at the chain level. Our pattern operates at the application level — within a single chain, individual computations are separated. This is finer-grained and composable with any L1/L2.

**ZK Proofs** provide mathematical certainty but are expensive to generate and require specialized circuits. Our approach uses economic security (bonded submitters + slashing) rather than cryptographic proofs, trading mathematical certainty for practical sufficiency at a fraction of the cost.

**Oracles** import off-chain data but require trust in the oracle operator. Our pattern requires no trusted parties — submitters are economically incentivized, and anyone can dispute.

---

## 2. Architecture

### 2.1 Three-Layer Model

```
Layer 3: Off-Chain Compute
│   Jarvis shards, AI agents, community scoring
│   Full O(2^n) Shapley, PageRank, vote tallying
│   Produces: results + Merkle proofs
│
Layer 2: Verified Compute (On-Chain)
│   Axiom checking, Merkle verification
│   Bond + dispute window → finalization
│   O(n) verification of O(2^n) computation
│
Layer 1: Settlement (On-Chain)
    Token custody, pool reserves, claim execution
    Consumes finalized results from Layer 2
    Permissionless: anyone can trigger claims
```

### 2.2 The VerifiedCompute Base Pattern

Every verifier shares the same lifecycle:

```
Submit (bonded) → Pending → [dispute window] → Finalize
                           → Dispute (slash) → Void
```

**Submitters** must post a bond before submitting results. The bond is slashed (50%) if a dispute succeeds. This creates economic skin-in-the-game: submitting incorrect results is unprofitable.

**Dispute windows** provide a time-bounded challenge period. During this window, anyone can submit evidence that the result is incorrect. After the window closes without successful dispute, the result becomes canonical.

**Finalization** is permissionless — anyone can call `finalize()` after the dispute window. No trusted party is needed for the result to become available to consumers.

### 2.3 Axiom-Based Verification

Each verifier defines domain-specific invariants that correct results must satisfy. These are necessary conditions, not sufficient conditions — a result that passes all axiom checks may still be subtly wrong, but a result that fails any axiom check is definitely wrong.

#### ShapleyVerifier Axioms

| Axiom | Check | Complexity |
|-------|-------|------------|
| Efficiency | sum(values) == totalPool | O(n) |
| Sanity | ∀i: values[i] ≤ totalPool | O(n) |
| Lawson Floor | ∀i: values[i] ≥ 1% of average | O(n) |
| Merkle | proof verifies against root | O(log n) |

The **Lawson Fairness Floor** is the enforcement of P-000 (Fairness Above All): no participant who contributed honestly walks away with less than 1% of the average allocation. This is a protocol invariant, not a governance parameter — it cannot be voted away.

#### TrustScoreVerifier Invariants

| Invariant | Check | Complexity |
|-----------|-------|------------|
| Bounded | ∀i: scores[i] ∈ [0, 10000] | O(n) |
| Normalized | sum(scores) == declaredTotal | O(n) |
| Non-zero | ∀i: scores[i] ≥ 1 (active participants) | O(n) |
| Merkle | proof verifies against root | O(log n) |

#### VoteVerifier Invariants

| Invariant | Check | Complexity |
|-----------|-------|------------|
| Conservation | sum(optionVotes) == totalVotesCast | O(k) |
| No Inflation | totalVotesCast ≤ registeredVoters | O(1) |
| Quorum | totalVotesCast ≥ quorumRequired | O(1) |
| Winner | ∀i: votes[winner] ≥ votes[i] | O(k) |
| Merkle | proof verifies against root | O(log n) |

---

## 3. Security Model

### 3.1 Economic Security

The security of the system rests on a simple economic argument: **it costs more to submit false results than to submit correct ones**.

Let B be the bond amount and p be the probability of a successful dispute. The expected cost of submitting a false result is:

```
E[cost_false] = p × (B × 0.5)    [slashing]
E[cost_true]  = 0                  [bond returned on finalization]
```

As long as p > 0 (i.e., at least one honest monitor exists), submitting false results has negative expected value. The dispute reward (receiving the slashed bond) creates an incentive for monitoring.

### 3.2 Dispute Evidence

Each verifier defines what constitutes valid dispute evidence via `_validateDispute()`. For Shapley values, the disputer must provide an alternative allocation that:
1. Differs from the submitted allocation
2. Is internally consistent (sum == total)

The on-chain contract does not determine which allocation is "correct" — it only checks internal consistency. The economic incentive ensures that submitters compute correctly in the first place, and disputers only challenge genuinely incorrect submissions.

### 3.3 Liveness

If no submitter provides results, the system simply waits. There is no liveness failure — the protocol degrades gracefully to "results pending." This is preferable to forcing on-chain computation, which may be prohibitively expensive or impossible for large participant sets.

Multiple submitters can be bonded simultaneously. If one submitter goes offline, others can fill the gap. The system is permissionless — anyone willing to post a bond can become a submitter.

---

## 4. CKB Portability: Pure Functions as the Kernel

### 4.1 The Portability Principle

Each verifier exposes a `pure` verification function that takes no storage reads, emits no events, and has no side effects:

```solidity
function verifyShapleyAxioms(
    uint256 participantCount, uint256[] calldata values, uint256 totalPool
) public pure returns (bool)

function verifyTrustInvariants(
    uint256 participantCount, uint256[] calldata scores, uint256 totalScore
) public pure returns (bool)

function verifyVoteInvariants(
    uint256[] calldata optionVotes, uint256 totalVotesCast,
    uint256 registeredVoters, uint8 winningOption
) public pure returns (bool)
```

These functions are **account model agnostic**. They verify mathematical properties of arrays and scalars — nothing more. This means they can be compiled to any execution environment:

| Target | Compilation Path |
|--------|-----------------|
| EVM (Ethereum, Base, etc.) | Native Solidity |
| CKB RISC-V | Compile to C → RISC-V cell script |
| WASM | Compile to Rust → WASM |
| Native | Compile to C → any architecture |

### 4.2 CKB Cell Script Architecture

On Nervos CKB, the pure verification functions become **type scripts** that validate state cell transitions:

```
CKB State Cell:
├── Lock Script: Who can consume this cell (ownership)
├── Type Script: verifyShapleyAxioms() → validates data integrity
└── Data: (participants, values, totalPool) — the Shapley result
```

A transaction that creates a cell with Shapley distribution data must satisfy the type script — the same axiom checks that run on EVM. The math is identical; only the runtime differs.

### 4.3 The Deeper Point

The chain is scaffolding. The axioms are the building.

Ethereum may evolve, fork, or be superseded. CKB may adopt new VM versions. L2s will come and go. But the mathematical property that "fair allocations must sum to the total pool, with no participant receiving less than 1% of the average" is timeless. It's not a smart contract — it's a theorem.

By expressing these invariants as pure functions, we ensure that the protocol's fairness guarantees are not bound to any single chain, VM, or account model. They are portable proofs that can be verified anywhere computation exists.

---

## 5. The VerifierCheckpointBridge: Settlement Meets State

Finalized verifier results are bridged into the VibeStateChain — a CKB-inspired state settlement chain that provides permanent consensus history. The bridge is permissionless (Grade A DISSOLVED): anyone can push a finalized result into the state chain.

```
ShapleyVerifier     ─┐
TrustScoreVerifier  ─┤→ VerifierCheckpointBridge → VibeStateChain
VoteVerifier        ─┤                              (permanent record)
BatchPriceVerifier  ─┘
```

Each checkpoint carries:
- **Source identifier**: which verifier produced the result
- **Decision hash**: the result's content hash (Merkle root)
- **Round ID**: sequential checkpoint counter

The state chain is the shared reality. Consensus modules produce decisions; the chain records them. The checkpoint bridge ensures that verified computation results — not just validator attestations — become part of the permanent consensus history.

---

## 6. Implementation Status

| Contract | Lines | Status |
|----------|-------|--------|
| VerifiedCompute.sol | 192 | Deployed (abstract base) |
| ShapleyVerifier.sol | 196 | Deployed, wired to ShapleyDistributor |
| TrustScoreVerifier.sol | 216 | Deployed |
| VoteVerifier.sol | 275 | Deployed |
| BatchPriceVerifier.sol | 150 | Deployed |
| VerifierCheckpointBridge.sol | 162 | Deployed, 4 verifiers registered |
| DeploySettlement.s.sol | 195 | Ready (deploys all 6 as UUPS proxies) |

**Gas savings estimate**: For a 10-participant Shapley game, on-chain computation costs ~2M gas. Submission + axiom verification costs ~150K gas. **92.5% reduction**.

---

## 7. Conclusion

Execution-settlement separation is not a performance optimization — it's an architectural principle. Computation belongs where it's cheap (off-chain). Verification belongs where it's trustworthy (on-chain). The bridge between them is economics: bonded submitters with slashing ensure honesty without requiring every node to recompute.

The pure verification functions are the load-bearing innovation. They express protocol invariants in a form that is chain-agnostic, VM-agnostic, and time-agnostic. When the chain evolves, the math remains. When the VM changes, the axioms persist.

The math is the kernel. Everything else is runtime.

---

## References

1. Shapley, L.S. (1953). "A Value for n-Person Games." Contributions to the Theory of Games, Vol. II.
2. Buterin, V. (2014). "Ethereum: A Next-Generation Smart Contract and Decentralized Application Platform."
3. Nervos CKB. "CKB Cell Model." https://docs.nervos.org/
4. Glynn, W.T. (2026). "Atomized Shapley: Universal Fair Measurement for Decentralized Systems."
5. Glynn, W.T. (2026). "Time-Neutral Tokenomics." VibeSwap DOCUMENTATION.
