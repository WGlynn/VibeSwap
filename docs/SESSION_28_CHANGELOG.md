# Session 28 Changelog — EmissionController Build

**Date:** February 21, 2026
**Duration:** Single session
**Builder:** JARVIS (Claude Opus 4.6) + Will

---

## Summary

Built the EmissionController contract — the missing piece that connects VIBEToken minting to the incentive layer. Before this session, VIBE existed as a token with a 21M cap and authorized minters, but nothing actually minted or distributed it. Now it has a complete wall-clock halving emission system with three distribution sinks.

---

## New Contract

### `contracts/incentives/EmissionController.sol`
- **Type:** UUPS Upgradeable
- **Lines:** ~290 Solidity
- **Dependencies:** VIBEToken (mint), ShapleyDistributor (games), LiquidityGauge (fund), SingleStaking (notify)

**Core functions:**
- `drip()` — Permissionless. Mints accrued VIBE, splits 50/35/15
- `createContributionGame()` — Authorized. Drains Shapley pool → creates + settles game
- `fundStaking()` — Permissionless. Pushes pending staking rewards

**Key features:**
- Wall-clock halving (baseRate >> era, 365.25 day eras, 32 max)
- Cross-era accrual (bounded O(32) loop)
- Accumulation pool (not streaming — creates incentive waves)
- Percentage-based drain minimum (trustless price scaling)
- MAX_SUPPLY guard (double-enforced: EC + VIBEToken)

---

## New Tests

### `test/EmissionController.t.sol` — 38 unit tests
- Initialization, drip mechanics, cross-era, MAX_SUPPLY cap
- Contribution game creation, drain limits, authorization
- Staking funding, multiple drip accumulation
- View functions (era, rate, pending, dashboard)
- Admin functions, budget validation, access control
- Accounting invariant after mixed operations

### `test/fuzz/EmissionControllerFuzz.t.sol` — 6 fuzz tests (256 runs each)
- Drip at any time gap (1s to 50 years)
- MAX_SUPPLY cap under extreme time ranges
- Cross-era accrual correctness (manual verification)
- Budget split accounting (any valid split)
- Game creation with valid drain bounds
- Sequential drips maintain accounting identity

### `test/invariant/EmissionControllerInvariant.t.sol` — 7 invariant tests (256 runs, 128K calls)
- `totalEmitted <= MAX_SUPPLY`
- `shapleyPool + totalShapleyDrained + totalGaugeFunded + stakingPending + totalStakingFunded == totalEmitted`
- EC balance covers shapleyPool + stakingPending
- Rate <= BASE_EMISSION_RATE
- Era <= MAX_ERAS
- Gauge balance == totalGaugeFunded
- Call summary (operational health)

**Total new tests: 51 (all passing)**

---

## New Documentation

1. **`docs/emission-controller.md`** — Full technical design document
2. **`docs/VIBE_TOKENOMICS.md`** — Comprehensive tokenomics: zero pre-mine manifesto, halving schedule, two-token model, time neutrality
3. **`docs/papers/cooperative-emission-design.md`** — Academic-style research paper with proofs of all 5 invariants
4. **`docs/explainers/vibe-emission-explainer.md`** — Simple community-facing explainer
5. **`docs/VIBESWAP_BUILD_SUMMARY.md`** — Updated with EmissionController, test counts
6. **`docs/SESSION_28_CHANGELOG.md`** — This file

---

## Design Decisions

### 1. Zero Team Allocation (Will's directive)
Bitcoin didn't have team allocations. VIBE doesn't either. Founders earn through the same Shapley games as everyone else. "fuck that that's a premine" — Will

### 2. Percentage-Based Drain Minimum (Will's insight)
Fixed minimum (100 VIBE) is a ticking time bomb at high prices ($10K/VIBE = $1M minimum). Changed to `minDrainBps = 100` (1% of pool). Scales naturally. No oracle, no trusted third party. Optional absolute floor available for governance if needed.

### 3. FEE_DISTRIBUTION Game Type
EmissionController already applies wall-clock halving. Using TOKEN_EMISSION in ShapleyDistributor would apply halving again = double-halving. Using FEE_DISTRIBUTION (no halving in Shapley) avoids this.

### 4. Accumulation Over Streaming
Shapley pool accumulates rather than streams. This creates incentive waves: longer gaps = bigger pools = bigger rewards. Mirrors real value creation patterns (bursty, not continuous).

### 5. Separate fundStaking()
SingleStaking's `notifyRewardAmount` is `onlyOwner`. Rather than making drip() fail when staking isn't configured, staking rewards accumulate as `stakingPending` and are pushed separately via `fundStaking()`.

---

## Security Hardening (Session 28 continued)

### Bugs Found & Fixed

1. **Orphaned Tokens (MEDIUM)** — When `liquidityGauge == address(0)`, gaugeShare was minted but untracked, breaking accounting invariant. **Fix:** Redirect gaugeShare to Shapley pool when no gauge configured (1 `else if` branch added).

2. **Zero-Drain Game Creation (LOW)** — Empty pool + any drainBps = 0-value game creation attempt. **Fix:** Added explicit `if (drainAmount == 0) revert DrainTooSmall()` (1 line).

### New Security Test Suite

**`test/security/EmissionControllerSecurity.t.sol`** — 41 adversarial tests:
- 3 reentrancy attacks (malicious VIBEToken, ShapleyDistributor, SingleStaking)
- 2 game ID collision / double-drain tests
- 4 unauthorized access tests
- 4 accounting invariant tests under adversarial conditions
- 4 drain edge cases (zero max, min > max, rapid-fire, exhaustion)
- 3 MAX_SUPPLY boundary tests
- 2 cross-era overflow safety tests
- 3 external contract failure mode tests
- 2 front-running / timing attack tests
- 3 parameter boundary tests
- 2 zero-value edge cases
- 3 initialization safety tests
- 2 token flow integrity tests
- 2 upgrade safety tests
- 2 drainer revocation tests

### New Documentation

1. **`docs/security/emission-controller-security-audit.md`** — Full security audit report with all findings
2. **`docs/security/protocol-wide-security-posture.md`** — Protocol-wide security architecture overview

---

## Codebase Stats (Post-Session)

- **Solidity contracts:** 122 (+1)
- **Test files:** 136 (+4)
- **Tests passing:** 1200+ (+92)
- **Documentation files:** 8 new
- **Contract size:** 7.6KB (31% of 24KB Base limit)

---

## Integration Requirements (Post-Deploy)

```solidity
// 1. Authorize EmissionController as VIBE minter
vibeToken.setMinter(address(emissionController), true);

// 2. Authorize EmissionController as Shapley game creator
shapleyDistributor.setAuthorizedCreator(address(emissionController), true);

// 3. Transfer SingleStaking ownership to EmissionController
singleStaking.transferOwnership(address(emissionController));

// 4. Authorize drainers (governance, keeper contracts)
emissionController.setAuthorizedDrainer(address(governance), true);
```

---

*Session 28: The faucet is built, hardened, and tamperproof. VIBE flows from contribution, not allocation.*
