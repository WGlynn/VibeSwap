# Session Tip — 2026-03-25

## Block Header
- **Session**: Three-layer testing architecture — Shapley reference model, adversarial search, coverage matrix
- **Parent**: `aa0edab` (Martin call session)
- **Branch**: `master` @ `d590bb8`
- **Status**: Three-layer testing framework built. 52 Python tests passing. Forge compiling (446 files, slow machine). 6 commits today.

## What Exists Now
- `oracle/backtest/shapley_reference.py` — Exact arithmetic mirror of ShapleyDistributor.sol (dual mode: Fraction + Solidity-emulated integer)
- `oracle/backtest/adversarial_search.py` — Layer 3 adversarial search with 4 strategies
- `oracle/backtest/generate_vectors.py` — Generates JSON test vectors for Foundry replay
- `oracle/tests/test_shapley_reference.py` — 25 tests: axiom verification, rounding analysis, edge cases
- `oracle/tests/test_adversarial_search.py` — 6 tests: position independence, sybil, input integrity
- `oracle/tests/test_halving_schedule.py` — 21 tests: era calc, multiplier, supply cap convergence
- `test/crosslayer/ShapleyReplay.t.sol` — Foundry replay of Python vectors (awaiting compilation)
- `test/crosslayer/ConservationInvariant.t.sol` — Cross-contract value conservation proofs
- `test/vectors/*.json` — 10 test vectors + adversarial report + manifest
- `docs/MECHANISM_COVERAGE_MATRIX.md` — Per-property verification matrix across all layers
- `scripts/test_all_layers.sh` — Single command for all three layers

## Key Findings
1. **Position independence PROVEN**: 0 deviations across 50 rounds — mechanism is order-independent
2. **Lawson Floor sybil vulnerability**: splitting accounts doubles floor subsidy. Mitigated by SoulboundIdentity.
3. **Input integrity is load-bearing**: onlyAuthorized access control prevents 232 trivial exploits
4. **PairwiseFairness NatSpec was misleading**: contract uses totalWeight tolerance (correct), docs said numParticipants
5. **Halving schedule matches exact arithmetic**: all 32 eras produce identical results

## Context: GitHub Discussion
- Someone gave expert feedback on three-layer testing for mechanism-heavy Solidity
- Their framework: L1 (Solidity invariants) + L2 (off-chain reference) + L3 (adversarial search)
- Will crafted reply showing existing coverage + gaps + open question about approximation vs exact
- This session implements their entire framework

## Fixes Applied
- EmissionController tests updated for 6-param initialize (_genesisTime)
- PairwiseFairness.sol NatSpec corrected

## Manual Queue (Will does these)
1. Post GitHub discussion reply (drafted, ready to paste)
2. Follow up with Martin in ~2 weeks
3. Publish blog post #3 (Security, Tue Apr 1)
4. Create accounts: Code4rena, Sherlock, Cantina
5. Deploy VIBE emission on Base

## Next Session
- Verify Foundry cross-layer tests pass (forge compilation pending)
- Wire SoulboundIdentity check into ShapleyDistributor for Lawson floor sybil defense
- Add Certora/Halmos specs for conservation + monotonicity (FV column in matrix)
- Respond to GitHub discussion if they reply to Will's post
- Canonical FeeRouter decision still outstanding
