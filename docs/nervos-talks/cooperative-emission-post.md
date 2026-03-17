# Cooperative Emission Design: What If Bitcoin's Halving Rewarded Builders, Not Miners?

*Nervos Talks Post -- Faraday1*
*March 2026*

---

## TL;DR

Every token launch in DeFi follows the same script: pre-mine tokens, allocate to insiders, launch with a fraction for the public. Bitcoin proved this is unnecessary -- every BTC was earned through computation. We built an emission mechanism that extends Bitcoin's principle to contribution-based distribution: **zero pre-mine, wall-clock halving, and Shapley accumulation pools that reward bursty participation over passive holding.** The mechanism provably satisfies five invariants (supply cap, accounting identity, solvency, rate monotonicity, era bound) across 51 tests including fuzz and invariant suites. And here is why I am posting this in Nervos Talks: **CKB's own emission model -- secondary issuance feeding the NervosDAO -- is the closest thing in production to what we are building.** The substrate understands cooperative emission.

---

## The Pre-Mine Problem

The dominant token launch: pre-mint, allocate to insiders, launch with a fraction for the public. Insiders have tokens before the protocol proves value. Rational strategy: extract, not build.

Bitcoin eliminated this asymmetry. Satoshi mined alongside everyone else. Every bitcoin was earned.

VIBE extends the principle: instead of hash computations, tokens are earned through demonstrated contribution to the cooperative game -- liquidity provision, code development, governance participation.

---

## The Mechanism: Three Layers

### Layer 1: Wall-Clock Halving

```
R_0 = 21,000,000 * 10^18 / (2 * 31,557,600) ~ 332.88 trillion wei/second
R(era) = R_0 >> era     (bit-shift halving, gas efficient)
Total  = R_0 * ERA_DURATION * 2 = MAX_SUPPLY  (geometric series converges)
```

Wall-clock instead of block-count because block times vary. Wall-clock halving is deterministic -- compute the exact rate at any future timestamp.

### Layer 2: Three Distribution Sinks

Each drip splits into three sinks (remainder to staking avoids dust):

| Sink | Purpose | Model |
|------|---------|-------|
| **Shapley Pool** | Contribution rewards | Accumulation + Shapley games |
| **Liquidity Gauge** | LP incentives | Curve-style gauge voting |
| **Staking Rewards** | Holder alignment | Synthetix-style streaming |

### Layer 3: The Accumulation Pool

This is where we diverge from every existing emission model. Standard streaming (Synthetix-style) distributes linearly over time -- rewards passive holding, not active contribution.

The accumulation pool is different: tokens accrue during quiet periods and are distributed in punctuated Shapley games.

```
Pool:  ▁▂▃▄▅▆▇█  drain  ▁▂▃▅▇█  drain  ▁▃▆█  drain
                    ↓              ↓             ↓
           Game 1 settled   Game 2 settled  Game 3 settled
```

Three properties linear streaming cannot provide:

1. **Anti-mercenary**: Cannot flash-provide liquidity to capture a stream. Need sustained contribution.
2. **Natural timing**: Games happen when there is enough to distribute.
3. **Bursty participation**: Real value creation is punctuated. The pool rewards genuine bursts.

---

## Design Details

**Percentage-based drain bounds**: `minDrainBps/10000 * S <= drainAmount <= maxDrainBps/10000 * S`. An absolute minimum of 100 VIBE becomes a $1M barrier at $10,000/VIBE. Percentage minimums scale naturally. No oracle. No governance.

**The double-halving trap**: The EmissionController creates `FEE_DISTRIBUTION` games, not `TOKEN_EMISSION`. Wall-clock halving is already applied. If ShapleyDistributor also applied game-count halving, rewards would be halved twice. Halving must happen exactly once. Separation of concerns.

---

## Five Invariants

Verified through 7 invariant tests (256 runs, 128K calls each):

| Invariant | Statement |
|-----------|-----------|
| **Supply Cap** | `totalEmitted <= MAX_SUPPLY` (two independent enforcement layers) |
| **Accounting** | `shapleyPool + totalShapleyDrained + totalGaugeFunded + stakingPending + totalStakingFunded == totalEmitted` |
| **Solvency** | `VIBE.balanceOf(controller) >= shapleyPool + stakingPending` |
| **Rate Monotonicity** | `getCurrentRate() <= BASE_EMISSION_RATE` (right-shift can only decrease) |
| **Era Bound** | `getCurrentEra() <= 32` |

---

Cross-era accrual is O(1) gas: the loop is bounded at 32 iterations regardless of time gap. Anyone can call `drip()` permissionlessly with no penalty for infrequent calls.

---

## Comparison

| Mechanism | Pre-mine | Halving | Distribution | Price Dependency |
|-----------|----------|---------|-------------|-----------------|
| Bitcoin | None | Block-count | Mining (PoW) | None |
| Synthetix SNX | 100M pre-mint | None | Staking rewards | None |
| Curve CRV | 3.03B (62% community) | Epoch-based | Gauge voting | None |
| Pendle PENDLE | Pre-allocated | Weekly decay | LP + vePENDLE | None |
| **VIBE** | **None** | **Wall-clock** | **Shapley + Gauge + Staking** | **None** |

Key differentiators: zero pre-mine, Shapley-based distribution, accumulation pool, percentage-based minimums. Gas: `drip()` ~220K, `createContributionGame()` ~380K.

---

## Why CKB's Emission Model Is the Precedent

This is the section for this community. CKB's economic model is the closest production precedent for cooperative emission design.

### Secondary Issuance as Cooperative Emission

CKB has two issuance layers:

1. **Base issuance**: Fixed schedule, halves every 4 years. Rewards miners. This is Bitcoin's model.
2. **Secondary issuance**: Fixed annual rate (1.344B CKB/year). Distributed to miners, NervosDAO depositors, and the treasury.

The secondary issuance is cooperative emission. State occupants pay implicit rent (dilution from secondary issuance). NervosDAO depositors are compensated for that dilution. The mechanism redistributes value from state consumers to long-term holders -- cooperation encoded in the emission schedule itself.

Compare this to VIBE's three sinks:

| VIBE Sink | CKB Equivalent | Purpose |
|-----------|---------------|---------|
| Shapley Pool | Treasury fund | Reward contribution |
| Liquidity Gauge | Miner reward (secondary) | Incentivize infrastructure |
| Staking Rewards | NervosDAO compensation | Align long-term holders |

Both systems split emission into multiple sinks, avoid concentrating into one recipient type, and create feedback loops where emission benefits the entities that make the system work.

CKB's state rent deepens the parallel: state occupants pay implicit rent (locked CKB foregoes NervosDAO returns), funding the commons. VIBE's accumulation pool follows the same logic: priority bid revenue accumulates in the Shapley pool and distributes to contributors. Traders pay. Contributors earn.

### Cell Model for Emission Tracking

Each of VIBE's three sinks maps naturally to CKB cells:

```
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Shapley Pool   │  │ Gauge Budget   │  │ Staking Budget │
│ Cell           │  │ Cell           │  │ Cell           │
│                │  │                │  │                │
│ data: amount   │  │ data: amount   │  │ data: amount   │
│ type: emission │  │ type: emission │  │ type: emission │
│       rules    │  │       rules    │  │       rules    │
│ lock: drain    │  │ lock: gauge    │  │ lock: staking  │
│       auth     │  │       vote     │  │       contract │
└────────────────┘  └────────────────┘  └────────────────┘
```

Each sink is an independent cell with its own lock script (who can drain it) and type script (what emission rules apply). The accounting identity invariant becomes a type script constraint: the sum of all sink cells must equal total emitted. CKB verifies this at the transaction level, not the application level.

### Since-Based Era Enforcement

The `Since` field could enforce era boundaries structurally. A "Shapley Pool" cell created in era 0 includes a `Since` constraint that makes it consumable only after the era boundary. No `block.timestamp` comparisons. No off-by-one errors. The substrate enforces the temporal boundary.

---

## Test Coverage

51 tests across three suites:

| Suite | Tests | Coverage |
|-------|-------|----------|
| Unit tests | 38 | Function coverage, edge cases, access control, event emission |
| Fuzz tests | 6 (256 runs each) | Time ranges, budget splits, drain bounds, sequential operations |
| Invariant tests | 7 (256 runs, 128K calls each) | All five invariants verified under random call sequences |

---

## Discussion

Questions for the Nervos community:

1. **CKB's secondary issuance splits emission between miners, NervosDAO, and treasury.** How does the community evaluate whether these proportions are correct? Is there a formal framework, or is it calibrated empirically?

2. **The accumulation pool creates incentive waves instead of linear streaming.** Has anyone explored similar bursty reward patterns on CKB? The cell model seems naturally suited -- a "reward cell" that accumulates value and is consumed in a single game transaction.

3. **Percentage-based drain minimums avoid oracle dependency.** CKB's state rent is also oracle-free (denominated in CKB, not dollars). Is this a conscious design principle in Nervos -- avoiding external price dependencies in core economic mechanisms?

4. **The double-halving trap (EmissionController halves, then ShapleyDistributor halves again).** This is a composability hazard. When multiple contracts each apply their own economic adjustments, the combined effect can be unexpected. How does the CKB community handle composability of economic logic across cell types?

5. **Zero pre-mine is a strong constraint.** CKB's base issuance is zero pre-mine (all mined). But the Nervos Foundation received an allocation from the genesis block. How does the community view the tradeoff between zero pre-mine purity and pragmatic funding needs?

6. **Wall-clock vs. block-count halving.** CKB uses block-count halving (like Bitcoin). We chose wall-clock for determinism. What are the tradeoffs the Nervos community considered?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [cooperative-emission-design.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/cooperative-emission-design.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
