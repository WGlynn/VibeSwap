# Session Tip — 2026-03-25

## Block Header
- **Session**: Three-layer testing framework + recursive self-improvement loop
- **Parent**: `aa0edab` (Martin call session)
- **Branch**: `master` @ `51d8ac0`
- **Status**: Three-layer framework built AND running. First recursive self-improvement cycle completed: adversarial search found bug → contract fixed → tests confirmed. 82 new tests, 11 commits.

## What Exists Now

### Layer 2: Python Reference Model
- `oracle/backtest/shapley_reference.py` — Exact arithmetic mirror of ShapleyDistributor.sol + HalvingSchedule
- `oracle/backtest/generate_vectors.py` — 11 JSON vectors for Foundry replay
- `oracle/tests/test_shapley_reference.py` — 25 tests: axioms, rounding, edge cases
- `oracle/tests/test_halving_schedule.py` — 21 tests: era, multiplier, supply cap
- `oracle/tests/test_property_exhaustive.py` — 15 tests: 500-round exhaustive checks + scarcity model

### Layer 3: Adversarial Search
- `oracle/backtest/adversarial_search.py` — 4 strategies: mutation, coalition, position, sybil
- `oracle/tests/test_adversarial_search.py` — 6 tests: reproducibility, key findings

### Layer 1: Solidity Cross-Layer
- `test/crosslayer/ShapleyReplay.t.sol` — 10 replay tests from Python vectors
- `test/crosslayer/ConservationInvariant.t.sol` — 5 conservation/position/baseline tests

### Infrastructure
- `test/vectors/*.json` — 11 test vectors + adversarial report
- `docs/MECHANISM_COVERAGE_MATRIX.md` — per-property verification matrix
- `scripts/test_all_layers.sh` — single command for all layers

## Key Findings & Fixes

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | PairwiseFairness NatSpec misleading (tolerance) | Low | FIXED (docs corrected, contract was already right) |
| 2 | Lawson Floor sybil (2 accounts = 2x floor) | Medium | KNOWN (mitigated by SoulboundIdentity) |
| 3 | Null player + dust collection conflict | Medium | **FIXED** (contract + reference model updated) |
| 4 | Balanced market scarcity = 5500 not 5000 | Low | KNOWN (strict > at buyRatio boundary) |
| 5 | Position independence PROVEN | N/A (positive) | 0/50 deviations — mechanism is order-independent |
| 6 | Input integrity is load-bearing | N/A (validation) | onlyAuthorized prevents 232 trivial exploits |

## Recursive Self-Improvement
First full cycle completed:
1. Adversarial search found null player dust bug (92/500 games)
2. Root cause identified: dust goes to last participant regardless of weight
3. Fix: dust recipient = last non-zero-weight participant
4. Both contract and reference model updated in lockstep
5. Re-tested: 0/500 violations. 82/82 tests green.

## Manual Queue (Will does these)
1. Post GitHub discussion reply (drafted, ready)
2. Follow up with Martin (~2 weeks)
3. Blog post #3 (Security, Tue Apr 1)
4. Create Code4rena/Sherlock/Cantina accounts
5. Deploy VIBE emission on Base

## Next Session
- Run second adversarial search cycle (search for new deviations post-fix)
- Certora/Halmos formal verification specs
- Canonical FeeRouter decision
- Wire SoulboundIdentity to ShapleyDistributor for Lawson floor sybil defense
