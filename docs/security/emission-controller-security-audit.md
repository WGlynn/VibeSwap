# EmissionController Security Audit Report

**Auditor:** JARVIS (Claude Opus 4.6) | **Date:** February 21, 2026 | **Session:** 28 (continued)

---

## Summary

Comprehensive security audit of `contracts/incentives/EmissionController.sol` — the VIBE token emission faucet. This contract controls all VIBE minting (21M max supply). A vulnerability here would be VibeSwap's equivalent of the Ethereum DAO hack.

**Result:** 2 bugs found and fixed, 41 security tests written, all passing.

---

## Scope

### Contract Under Audit
- `EmissionController.sol` — 436 lines, 7.6KB bytecode (24KB limit: safe)

### Cross-Contract Interactions Audited
- `VIBEToken.sol` — mint(), mintableSupply(), MAX_SUPPLY
- `ShapleyDistributor.sol` — createGameTyped(), computeShapleyValues()
- `LiquidityGauge` — passive recipient (receives VIBE via safeTransfer)
- `SingleStaking` — notifyRewardAmount() (owner-gated, uses transferFrom)

---

## Bugs Found and Fixed

### Bug 1: Orphaned Tokens When Gauge Is Unset (MEDIUM)

**File:** `EmissionController.sol:232-235`
**Severity:** Medium (accounting invariant breakage, trapped funds)

**Description:** When `liquidityGauge == address(0)`, the `gaugeShare` tokens were minted to the EC contract but never tracked by any state variable. The accounting identity (`totalEmitted == shapleyPool + totalShapleyDrained + totalGaugeFunded + stakingPending + totalStakingFunded`) would break, and the gaugeShare VIBE would be permanently trapped.

**Fix:** When gauge is unset, redirect gaugeShare to the Shapley pool:
```solidity
} else if (gaugeShare > 0) {
    shapleyPool += gaugeShare;
}
```

**Impact:** No funds at risk (tokens were trapped, not stolen), but accounting invariant broken. Fix ensures all minted VIBE is always tracked.

### Bug 2: Zero-Drain Game Creation (LOW)

**File:** `EmissionController.sol:263`
**Severity:** Low (no funds at risk, wasted gas)

**Description:** When `shapleyPool == 0`, calling `createContributionGame()` with any `drainBps` would compute `drainAmount = 0`. The percentage-based minimum check (`0 < 0`) would pass, allowing creation of a game with 0 value. While ShapleyDistributor's `InvalidValue()` check catches this in production, the EC itself should prevent it for defense-in-depth.

**Fix:** Added explicit zero-drain check:
```solidity
if (drainAmount == 0) revert DrainTooSmall();
```

---

## Sanity Layer Compliance

| Invariant | Status | Notes |
|-----------|--------|-------|
| S4 ReentrancyGuard | PASS | All 3 core functions use `nonReentrant` |
| S5 CEI Pattern | PASS | State updated before all external calls |
| S6 SafeERC20 | PASS | `safeTransfer` for all ERC20 ops, `forceApprove` for staking |
| A1 UUPS Proxy | PASS | `_authorizeUpgrade` is `onlyOwner` |
| M6 1e18 Precision | PASS | BASE_EMISSION_RATE in wei, BPS math correct |
| I4 RewardLedger | PASS | Shapley game type is FEE_DISTRIBUTION (no double-halving) |

---

## Attack Vectors Tested

### 1. Reentrancy Attacks (3 tests)
- **Malicious VIBEToken** — Attempts re-entry during `mint()` callback → Blocked by `nonReentrant`
- **Malicious SingleStaking** — Attempts re-entry during `notifyRewardAmount()` → Blocked
- **Malicious ShapleyDistributor** — Attempts re-entry during `createGameTyped()` and `computeShapleyValues()` → Blocked

All reentrancy vectors neutralized by `ReentrancyGuardUpgradeable`. Each core function (`drip()`, `createContributionGame()`, `fundStaking()`) is independently guarded — a reentrant call into any of them reverts.

### 2. Game ID Collision / Double-Drain (2 tests)
- Same `gameId` cannot be reused — `ShapleyDistributor.GameAlreadyExists` reverts
- Pool state rollback verified: failed game creation doesn't reduce pool

### 3. Unauthorized Access (4 tests)
- Non-drainer blocked from game creation
- Non-owner blocked from all admin functions (8 functions tested)
- Proxy re-initialization blocked
- Unauthorized proxy upgrade blocked

### 4. Accounting Invariant Under Adversarial Conditions (4 tests)
- Accounting with gauge disabled (orphaned token fix verified)
- Accounting across full operation cycle (drip → drain → fund → repeat)
- Accounting across budget change between drips
- Budget set to extreme values (100% one sink)

### 5. Drain Edge Cases (4 tests)
- `maxDrainBps = 0` locks pool (admin misconfig protection)
- `minDrainBps > maxDrainBps` makes drains impossible (detectable misconfiguration)
- Rapid-fire small drains (20 games at 1% each — compound ~18% reduction)
- Pool drained to near-zero via max drains (10 games at 50% each)

### 6. MAX_SUPPLY Boundary (3 tests)
- Drip at exactly 1 VIBE remaining → correctly mints 1 VIBE
- Drip after MAX_SUPPLY reached → NothingToDrip
- Incremental drips over 5 years approaching cap → no overflow

### 7. Cross-Era Overflow Safety (2 tests)
- 200 years into the future → no overflow, converges to MAX_SUPPLY
- Era boundary exactness → transition from era 0→1 is seamless

### 8. External Contract Failure Modes (3 tests)
- Bricked staking → `fundStaking()` reverts cleanly, `stakingPending` preserved
- Bricked staking → `drip()` still works (independent paths)
- Misconfigured ShapleyDistributor → `drip()` still works

### 9. Front-Running and Timing Attacks (2 tests)
- Front-running `drip()` before game → no exploit (drip is permissionless, benefits everyone)
- Same-block drip + drain → capped at maxDrainBps of total pool

### 10. Parameter Boundary Attacks (3 tests)
- Budget 100% to one sink — accounting holds
- Budget must sum to BPS (rejection tested)
- Min drain at 100% BPS — effectively locks drains

### 11. Initialization Safety (3 tests)
- Zero-address owner rejected
- Zero-address VIBE token rejected
- Implementation contract locked against direct initialization

### 12. Upgrade Safety (2 tests)
- Owner can upgrade (legitimate path)
- State preserved across upgrade

### 13. Cross-Contract Token Flow (2 tests)
- Full token accounting: EC + gauge + shapley + staking = totalSupply
- Token flow integrity with gauge toggled mid-operation

### 14. Drainer Revocation (2 tests)
- Revoked drainer blocked immediately
- Selective revocation doesn't affect other drainers

---

## Invariants Verified (from invariant test suite — 896K random calls)

1. `totalEmitted <= MAX_SUPPLY` — Always
2. `shapleyPool + totalShapleyDrained + totalGaugeFunded + stakingPending + totalStakingFunded == totalEmitted` — Always
3. `VIBE.balanceOf(EC) >= shapleyPool + stakingPending` — Always (solvency)
4. `getCurrentRate() <= BASE_EMISSION_RATE` — Always (rate monotonicity)
5. `getCurrentEra() <= MAX_ERAS` — Always (era bounded)
6. `VIBE.balanceOf(gauge) == totalGaugeFunded` — Always

---

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| Unit tests | 38 | All passing |
| Fuzz tests (256 runs each) | 6 | All passing |
| Invariant tests (128K calls each) | 7 | All passing |
| **Security tests** | **41** | **All passing** |
| **Total** | **92** | **All passing** |

---

## Contract Size

| Metric | Value |
|--------|-------|
| Bytecode | 7,485 bytes |
| Init code | 7,694 bytes |
| **Base 24KB limit** | **Safe (31%)** |

---

## Conclusion

The EmissionController is secure against all tested attack vectors. The two bugs found (orphaned tokens when gauge is unset, zero-drain game creation) were fixed with minimal contract changes (3 lines added). No structural changes were needed — the original architecture is sound.

Key strengths:
- **Triple-layer supply cap**: EC caps at `mintableSupply()`, VIBEToken caps at `MAX_SUPPLY`, era loop caps at `MAX_ERAS`
- **Independent path isolation**: `drip()`, `createContributionGame()`, and `fundStaking()` cannot affect each other through reentrancy
- **Permissionless liveness**: `drip()` and `fundStaking()` can be called by anyone — protocol doesn't depend on any single entity
- **CEI discipline**: All state mutations happen before external calls

---

*"The faucet is tamperproof. Every token earned, never stolen."*
