# EmissionController — VIBE Accumulation Pool

**Technical Design Document** | February 2026 | VibeSwap Operating System (VSOS)

---

## Overview

The EmissionController is the sole minting authority for VIBE tokens. It implements a wall-clock halving emission schedule inspired by Bitcoin, with three distribution sinks: a Shapley accumulation pool for contribution rewards, a LiquidityGauge for LP staking, and a SingleStaking contract for governance staking.

**Contract:** `contracts/incentives/EmissionController.sol`
**Type:** UUPS Upgradeable (OpenZeppelin v5.0.1)
**Test Coverage:** 51 tests (38 unit + 6 fuzz + 7 invariant)

---

## Design Philosophy

### Zero Pre-mine, Zero Team Allocation

Like Bitcoin, VIBE has no initial supply. No pre-mine. No founder allocation at deploy time. No VC backdoor deals. The entire 21M VIBE supply is earned through demonstrated contribution — period.

Founders earn by contributing, same as everyone else. The team's incentive is aligned with the protocol's success because they participate in the same Shapley games as all other contributors. There is no extraction — only participation.

This is not idealism. This is mechanism design. When insiders have pre-mined allocations, their incentive is to pump and dump. When everyone earns through contribution, the incentive is to build.

### Wall-Clock Halving

Bitcoin halves every 210,000 blocks. VIBE halves every 365.25 days of wall-clock time. The emission rate is:

```
rate(era) = BASE_EMISSION_RATE >> era
```

Where `era = (now - genesis) / eraDuration`.

This produces a geometric decay: ~10.5M VIBE in year 1, ~5.25M in year 2, ~2.625M in year 3, converging toward the 21M cap. After 32 halvings, new emissions effectively cease.

### Accumulation Pool

The Shapley pool is not a standard rewards stream. It **accumulates** unclaimed emissions until drained by a contribution game. This creates natural incentive waves:

- Long gaps between games = bigger pool = bigger rewards
- Frequent games = smaller individual rewards but more consistent distribution
- The pool acts as a self-regulating incentive buffer

This is distinct from a gauge or staking reward stream where tokens flow linearly. The accumulation pattern rewards patience and creates punctuated equilibria — periods of building followed by reward events.

---

## Architecture

```
                    Wall Clock
                        │
                        ▼
              ┌─────────────────┐
              │ EmissionController │
              │   drip()          │
              └────────┬──────────┘
                       │ mint VIBE
                       ▼
              ┌─────────────────┐
              │   Budget Split    │
              └──┬─────┬─────┬──┘
                 │     │     │
    50%          │     │     │  15%
    ┌────────────┘     │     └────────────┐
    ▼            35%   ▼                  ▼
┌─────────┐    ┌───────────┐    ┌──────────────┐
│ Shapley │    │ Liquidity │    │  Single      │
│  Pool   │    │   Gauge   │    │  Staking     │
│(accum.) │    │ (stream)  │    │  (periodic)  │
└────┬────┘    └───────────┘    └──────────────┘
     │
     ▼ createContributionGame()
┌─────────────────┐
│ ShapleyDistributor │
│  FEE_DISTRIBUTION  │
│  (no double-halving)│
└─────────────────┘
```

### Sinks

| Sink | Default Share | Behavior | Recipient |
|------|-------------|----------|-----------|
| Shapley Pool | 50% | Accumulates in EmissionController until drained | ShapleyDistributor (on drain) |
| Liquidity Gauge | 35% | Transferred immediately on drip | LiquidityGauge contract |
| Single Staking | 15% | Accumulated as pending, pushed via `fundStaking()` | SingleStaking contract |

---

## Emission Schedule

### Constants

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| MAX_SUPPLY | 21,000,000 VIBE | Bitcoin-aligned hard cap |
| BASE_EMISSION_RATE | 332,880,110,000,000,000 wei/s | ~10.5M VIBE in year 1 |
| ERA_DURATION | 31,557,600 seconds | 365.25 days (1 year) |
| MAX_ERAS | 32 | After 32 halvings, rate is effectively 0 |

### Halving Table

| Era | Rate (VIBE/year) | Cumulative (VIBE) | % of Supply |
|-----|-----------------|-------------------|-------------|
| 0 | ~10,500,000 | ~10,500,000 | 50.0% |
| 1 | ~5,250,000 | ~15,750,000 | 75.0% |
| 2 | ~2,625,000 | ~18,375,000 | 87.5% |
| 3 | ~1,312,500 | ~19,687,500 | 93.75% |
| 4 | ~656,250 | ~20,343,750 | 96.875% |
| 5 | ~328,125 | ~20,671,875 | 98.4375% |
| ... | ... | ... | ... |
| 31 | ~0.005 | ~21,000,000 | ~100% |

### Cross-Era Accrual

When `drip()` is called after a long gap that spans multiple eras, the contract correctly calculates emissions for each partial era:

```
for each era 0..32:
    if era overlaps [lastDripTime, now]:
        overlap = min(now, eraEnd) - max(lastDripTime, eraStart)
        total += (BASE_RATE >> era) * overlap
```

This loop is bounded at 32 iterations, making gas costs predictable regardless of the time gap.

---

## Core Functions

### `drip()` — Permissionless

Anyone can call `drip()` to advance the emission clock. This mints accrued VIBE and splits it to the three sinks.

**Gas:** ~220K (single era) to ~280K (cross-era)

**Flow:**
1. Calculate pending emissions (cross-era aware)
2. Cap at `vibeToken.mintableSupply()` (MAX_SUPPLY guard)
3. Mint VIBE to EmissionController
4. Split: shapleyPool += 50%, transfer 35% to gauge, stakingPending += 15%

### `createContributionGame()` — Authorized Drainers Only

Drains a percentage of the Shapley pool to create a ShapleyDistributor game. The game is created AND settled in one call, making rewards immediately claimable.

**Parameters:**
- `gameId` — Unique game identifier
- `participants` — ShapleyDistributor.Participant[] array
- `drainBps` — Percentage of pool to drain (capped at `maxDrainBps`)

**Minimum drain:** Uses percentage-based minimum (`minDrainBps`, default 1% of pool). This scales naturally with VIBE price — no oracle, no trusted third party needed. An optional absolute floor (`minDrainAmount`, default 0) is available for governance to set if desired.

**Game type:** FEE_DISTRIBUTION (not TOKEN_EMISSION). This avoids double-halving — EmissionController already applies the wall-clock halving to the emission rate, so ShapleyDistributor should distribute the full amount without additional halving.

### `fundStaking()` — Permissionless

Pushes accumulated staking pending to SingleStaking via `approve` + `notifyRewardAmount`. Anyone can call — the protocol should run automatically.

**Requirement:** EmissionController must be the owner of SingleStaking (so `notifyRewardAmount` succeeds).

---

## Configuration

### Budget Split

The budget is adjustable by governance (onlyOwner):

```solidity
ec.setBudget(shapleyBps, gaugeBps, stakingBps);
// Must sum to 10,000 (100%)
```

Default: 5000/3500/1500 (50/35/15).

### Drain Parameters

| Parameter | Default | Purpose |
|-----------|---------|---------|
| maxDrainBps | 5000 | Max 50% of pool per game — prevents single drain from emptying pool |
| minDrainBps | 100 | Min 1% of pool — percentage-based, scales with price |
| minDrainAmount | 0 | Optional absolute floor (governance can set) |

### Staking

| Parameter | Default | Purpose |
|-----------|---------|---------|
| stakingRewardDuration | 7 days | Reward period for each `fundStaking()` call |

---

## Invariants

These hold at all times, verified by 7 invariant tests with 256 runs x 128K calls each:

1. **Supply cap:** `totalEmitted <= MAX_SUPPLY`
2. **Accounting identity:** `shapleyPool + totalShapleyDrained + totalGaugeFunded + stakingPending + totalStakingFunded == totalEmitted`
3. **Solvency:** `VIBE.balanceOf(EmissionController) >= shapleyPool + stakingPending`
4. **Rate monotonicity:** `getCurrentRate() <= BASE_EMISSION_RATE`
5. **Era bound:** `getCurrentEra() <= MAX_ERAS`
6. **Gauge balance:** `VIBE.balanceOf(gauge) == totalGaugeFunded`

---

## Integration

### Deployment Steps

1. Deploy VIBEToken (if not already deployed)
2. Deploy ShapleyDistributor (if not already deployed)
3. Deploy LiquidityGauge with VIBE as reward token
4. Deploy SingleStaking with VIBE as reward token
5. Deploy EmissionController via UUPS proxy:
   ```solidity
   EmissionController impl = new EmissionController();
   ERC1967Proxy proxy = new ERC1967Proxy(
       address(impl),
       abi.encodeCall(EmissionController.initialize, (
           governanceMultisig,
           address(vibeToken),
           address(shapleyDistributor),
           address(liquidityGauge),
           address(singleStaking)
       ))
   );
   ```

### Permission Setup

```solidity
vibeToken.setMinter(address(emissionController), true);
shapleyDistributor.setAuthorizedCreator(address(emissionController), true);
singleStaking.transferOwnership(address(emissionController));
```

### Operational

- Call `drip()` periodically (keepers, MEV bots, or users — anyone can call)
- Call `fundStaking()` weekly (or as staking rewards are needed)
- Call `createContributionGame()` when contribution rounds complete (authorized drainers only)

---

## Security Considerations

1. **No external price dependency** — Emission rate is purely time-based. No oracle manipulation vector.
2. **Bounded gas** — Cross-era loop is O(32) maximum. Cannot be griefed with long time gaps.
3. **MAX_SUPPLY enforced** — Even if emission math produces more, VIBEToken's mint function caps at MAX_SUPPLY.
4. **Reentrancy protection** — All state-changing functions use `nonReentrant`.
5. **UUPS upgradeable** — Can fix bugs without migrating state. Upgrade restricted to owner.
6. **Percentage-based drain minimum** — Cannot be bricked by VIBE price appreciation.

---

## Test Coverage

| Suite | File | Tests | Notes |
|-------|------|-------|-------|
| Unit | `test/EmissionController.t.sol` | 38 | Full function coverage + edge cases |
| Fuzz | `test/fuzz/EmissionControllerFuzz.t.sol` | 6 (256 runs) | Time ranges, budget splits, drain bounds |
| Invariant | `test/invariant/EmissionControllerInvariant.t.sol` | 7 (256 runs, 128K calls) | Accounting, solvency, supply cap |
| **Total** | | **51** | |

---

*EmissionController: Where contribution meets compensation, on a schedule that respects the 21M covenant.*
