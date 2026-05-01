# Execution-Settlement Separation: Why Your Smart Contract Shouldn't Do Math

*How VibeSwap achieves 92% gas savings by verifying results instead of computing them — and why CKB's cell model is the perfect home for this pattern.*

---

## The Problem

Computing Shapley values for fair reward distribution costs O(2^n) — exponential in the number of participants. On Ethereum, a 10-player game costs ~$50 in gas. A 20-player game is impossible. But checking that a set of Shapley values sums to the total pool? That's O(n). Linear. Pennies.

**Verification is always cheaper than computation.** This asymmetry is the foundation of an architectural pattern we call execution-settlement separation.

## The Pattern

Instead of computing on-chain, we:

1. **Compute off-chain** — full O(2^n) Shapley, trust graph analysis, vote tallying
2. **Submit results with bond** — submitter stakes ETH as a guarantee of correctness
3. **Verify axioms on-chain** — does the result satisfy mathematical invariants?
4. **Dispute window** — anyone can challenge within 1 hour
5. **Finalize** — result becomes canonical, consumed by downstream contracts

The axiom checks are the key innovation. For Shapley values:
- **Efficiency**: Do the allocations sum to the total pool? (Nothing created or destroyed)
- **Lawson Floor**: Does every participant get at least 1% of average? (Fairness guarantee)
- **Merkle proof**: Does the result match the committed computation root?

A result that passes all checks may still be subtly wrong — but the economic bond ensures submitters don't try. A disputer who catches an error gets half the bond. Honesty is profitable; dishonesty is expensive.

## Why CKB Is the Natural Home

Here's where it gets interesting. Every verifier in our system exposes a **pure function** — no storage reads, no state, no account model dependency:

```
verifyShapleyAxioms(participantCount, values, totalPool) → bool
verifyTrustInvariants(participantCount, scores, totalScore) → bool
verifyVoteInvariants(optionVotes, totalVotesCast, registeredVoters, winningOption) → bool
```

These are just math. They work identically on EVM, RISC-V, WASM, or bare metal.

On CKB, these pure functions become **type scripts** in the cell model:

```
CKB State Cell:
├── Lock Script: ownership (who can spend)
├── Type Script: verifyShapleyAxioms() ← THE MATH
└── Data: (participants, values, totalPool)
```

The cell model is uniquely suited for this because:

1. **Type scripts validate data integrity** — exactly what our axiom checks do
2. **Cells are UTXO-like** — verified results are created (finalized) and consumed (claimed), not mutated
3. **RISC-V execution** — our pure functions compile directly to RISC-V cell scripts
4. **State rent model** — verified results that are consumed (claimed) release capacity, keeping the state clean

The EVM account model forces us to store results in mappings and manage lifecycle with status enums. CKB's cell model maps directly to the natural lifecycle: a verified result IS a cell. When it's consumed (rewards claimed), the cell is spent. No cleanup needed.

## What We Built

| Contract | Purpose | Gas Savings |
|----------|---------|-------------|
| ShapleyVerifier | Fair reward allocation | 92.5% |
| TrustScoreVerifier | Reputation scores | 95%+ |
| VoteVerifier | Governance tallies | 90%+ |
| BatchPriceVerifier | Clearing prices | 85%+ |
| VerifierCheckpointBridge | State chain recording | N/A (new) |

All verifiers share a common base (`VerifiedCompute`) with bonded submitters, dispute windows, and Merkle proof verification. The checkpoint bridge pushes finalized results into our VibeStateChain — a CKB-inspired state settlement chain — creating a permanent consensus history.

## The Deeper Insight

The chain is scaffolding. The axioms are the building.

We're currently on Base (Ethereum L2). But the pure verification functions don't know or care about that. They verify mathematical properties of arrays and scalars. When we port to CKB — and we will — the math doesn't change. Only the runtime does.

The protocol's fairness guarantees are not bound to any chain, VM, or account model. They're portable proofs. The Lawson Floor (1% minimum for honest participants) is not a governance parameter that can be voted away — it's a theorem enforced by pure math.

**P-000: Fairness Above All.** Not as policy. As physics.

## Try It

Full implementation: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)

Key files:
- `contracts/settlement/VerifiedCompute.sol` — base pattern
- `contracts/settlement/ShapleyVerifier.sol` — Shapley axiom verification
- `contracts/settlement/VerifierCheckpointBridge.sol` — state chain bridge
- `docs/papers/execution-settlement-separation.md` — formal paper

The pattern is open source and chain-agnostic by design. If you're building something that needs fair computation on CKB, the pure verification functions are ready to compile to RISC-V today.

---

*Will Glynn — VibeSwap (vibeswap.org)*
*"The math persists longer than the chain itself."*
