# Mechanism Coverage Matrix

Per-property verification coverage across three layers.
Makes gaps visible. Gaps are bugs waiting to happen.

## Layer Legend

| Layer | Tool | What It Catches |
|-------|------|-----------------|
| **L1** | Foundry (Solidity) | Axiom violations, gas, reentrancy, access control |
| **L2** | Python reference model | Rounding drift, truncation, exact vs integer divergence |
| **L3** | Adversarial search | Adaptive attacks, coalition exploits, profitable deviations |
| **FV** | Certora/Halmos | Conservation, monotonicity, bounded payoff (local lemmas) |

## Shapley Distribution

| Property | L1 | L2 | L3 | FV | Notes |
|----------|:--:|:--:|:--:|:--:|-------|
| **Efficiency** (sum = total) | `ShapleyFuzz.t.sol` | `shapley_reference.py` | - | TODO | Dust collection on last participant |
| **Symmetry** (equal in = equal out) | `ShapleyGameTheory.t.sol` | `shapley_reference.py` | - | TODO | Pre-dust only |
| **Null Player** (zero in = zero out) | `ShapleyGameTheory.t.sol` | `shapley_reference.py` | - | TODO | |
| **Pairwise Proportionality** | `PairwiseFairness.sol` (on-chain) | `shapley_reference.py` | - | TODO | **FINDING**: tolerance = n is too tight when weights are 1e18-scale. Cross-mult amplifies 1 wei to ~1e18 deviation. |
| **Time Neutrality** | `PairwiseFairness.sol` | - | - | TODO | Only for FEE_DISTRIBUTION type |
| **Lawson Floor** (1% minimum) | `ShapleyGameTheory.t.sol` | `shapley_reference.py` | - | TODO | Floor + efficiency interaction |
| **Rounding subsidy** (no micro-arb) | - | `shapley_reference.py` | TODO | TODO | **GAP**: no Solidity test for this |
| **Monotonic contribution** (more in = more out) | - | - | TODO | TODO | **GAP**: not tested anywhere |
| **Quality weight truncation** | - | `shapley_reference.py` | - | - | 3-way integer division |
| **Pioneer bonus cap** (2x max) | - | `shapley_reference.py` | - | TODO | |
| **Halving schedule correctness** | - | - | - | TODO | **GAP**: no reference model for halving |

## Batch Auction (Commit-Reveal)

| Property | L1 | L2 | L3 | FV | Notes |
|----------|:--:|:--:|:--:|:--:|-------|
| **Order invariance** (shuffle fairness) | `MEVGameTheory.t.sol` | `batch_auction.py` | `agents.py` | - | Fisher-Yates + XORed entropy |
| **Uniform clearing price** | `CommitRevealAuction.t.sol` | `batch_auction.py` | - | TODO | |
| **Commit binding** (can't change after commit) | `CommitRevealAuction.t.sol` | - | - | TODO | Hash preimage |
| **Invalid reveal slashing** (50%) | `CommitRevealAuction.t.sol` | - | TODO | TODO | **GAP**: monotonic slashing not proven |
| **Frontrunning resistance** | `MEVGameTheory.t.sol` | `agents.py` (frontrunner type) | - | - | |
| **Sandwich resistance** | `MEVGameTheory.t.sol` | `agents.py` (sandwich type) | - | - | |
| **Strategy-proofness** | `MEVGameTheory.t.sol` | `engine.py` (full suite) | - | - | All agent types converge |

## Cross-Contract Flow (Auction -> Settlement -> Distribution)

| Property | L1 | L2 | L3 | FV | Notes |
|----------|:--:|:--:|:--:|:--:|-------|
| **Conservation of value** | `MoneyFlowTest.t.sol` | - | - | TODO | **GAP**: no cross-contract formal proof |
| **No actor above honest baseline** | - | - | TODO | TODO | **GAP**: not tested anywhere |
| **Monotonic slashing** | - | - | TODO | TODO | **GAP**: stronger deviation can't reduce punishment |
| **No rounding subsidy across flow** | - | - | TODO | TODO | **GAP**: rounding checked per-contract, not end-to-end |

## AMM (VibeAMM)

| Property | L1 | L2 | L3 | FV | Notes |
|----------|:--:|:--:|:--:|:--:|-------|
| **Constant product (x*y=k)** | `AMMInvariant.t.sol` | `amm.py` | - | TODO | Ghost variables track |
| **TWAP validation** (5% max deviation) | `TruePriceOracle.t.sol` | - | - | TODO | |
| **Flash loan protection** | `ReentrancyTest.t.sol` | - | - | - | Same-block guard |
| **Rate limiting** | `StressTest.t.sol` | - | - | - | 100K tokens/hour/user |
| **LP share fairness** | `VibeAMM.t.sol` | - | - | TODO | |

## Circuit Breakers

| Property | L1 | L2 | L3 | FV | Notes |
|----------|:--:|:--:|:--:|:--:|-------|
| **Volume threshold** | `CircuitBreaker.t.sol` | - | - | - | |
| **Price threshold** | `CircuitBreaker.t.sol` | - | - | - | |
| **Withdrawal threshold** | `CircuitBreaker.t.sol` | - | - | - | |
| **Recovery behavior** | `CircuitBreakerFuzz.t.sol` | - | - | TODO | |

## ABC (Augmented Bonding Curve)

| Property | L1 | L2 | L3 | FV | Notes |
|----------|:--:|:--:|:--:|:--:|-------|
| **Conservation invariant** | `ABCHealthCheck.t.sol` | - | - | TODO | Gates all Shapley distribution |
| **Seal immutability** | `ShapleyABCSeal.t.sol` | - | - | TODO | One-way seal, can't unseal |
| **Health gate enforcement** | `ShapleyABCSeal.t.sol` | - | - | - | |

---

## Summary

| Layer | Coverage | Status |
|-------|----------|--------|
| **L1 (Solidity)** | ~70% of properties | STRONG — axiom tests, fuzz, invariants |
| **L2 (Reference)** | ~25% of properties | IN PROGRESS — Shapley model done, need cross-contract |
| **L3 (Adversarial)** | ~10% of properties | TODO — agent types exist but no guided search |
| **FV (Formal)** | 0% | TODO — Certora/Halmos for local lemmas |

## Critical Gaps (Priority Order)

1. **No actor above honest baseline** — not tested in any layer
2. **Monotonic slashing** — not proven anywhere
3. **Cross-contract conservation** — tested per-contract but not end-to-end
4. **Rounding subsidy across full flow** — Python catches per-contract, not pipeline
5. **Pairwise tolerance scaling** — current tolerance too tight for 1e18-scale values
