# Cooperative Emission Design: What If Bitcoin's Halving Rewarded Builders, Not Miners?

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Every token launch in DeFi follows the same script: pre-mine tokens, allocate to insiders, launch with a fraction for the public. Bitcoin proved this is unnecessary -- every BTC was earned through computation. We built an emission mechanism that extends Bitcoin's principle to contribution-based distribution: **zero pre-mine, wall-clock halving, and Shapley accumulation pools that reward bursty participation over passive holding.** The mechanism provably satisfies five invariants (supply cap, accounting identity, solvency, rate monotonicity, era bound) across 51 tests including fuzz and invariant suites. And here is why I am posting this in Nervos Talks: **CKB's own emission model -- secondary issuance feeding the NervosDAO -- is the closest thing in production to what we are building.** The substrate understands cooperative emission.

---

## The Pre-Mine Problem

Let me be direct about something the DeFi industry does not discuss honestly.

The dominant token launch model:

1. Pre-mint tokens
2. Allocate to team (15-25%), investors (10-20%), treasury (20-30%)
3. Launch with a fraction available to the public
4. Insiders have tokens before the protocol proves value
5. Rational insider strategy: extract value, not build it

This creates an information asymmetry that poisons the entire system. The team has tokens before there is a product. Investors have tokens before there are users. The public arrives last, buying tokens that insiders got for free.

Bitcoin's innovation was not just proof of work. It was the **elimination of this asymmetry**. Satoshi mined alongside everyone else. No special allocations. No backdoor deals. Every bitcoin was earned.

VIBE extends this principle: instead of hash computations, tokens are earned through demonstrated contribution to the cooperative game.

---

## The Mechanism: Three Layers

### Layer 1: Wall-Clock Halving

The base emission rate is calibrated to emit approximately half the supply in the first era (one year):

```
R_0 = MAX_SUPPLY / (2 * ERA_DURATION)
    = 21,000,000 * 10^18 / (2 * 31,557,600)
    ~ 332,880,110,000,000,000 wei/second
```

For era `e`, the rate is:

```
R(e) = R_0 >> e    (bit-shift for gas efficiency)
```

The total emission converges to MAX_SUPPLY:

```
Sum = R_0 * ERA_DURATION * (1 + 1/2 + 1/4 + ...) = R_0 * ERA_DURATION * 2 = MAX_SUPPLY
```

Why wall-clock instead of block-count? Block times vary. Mining difficulty adjustments create unpredictable emission schedules. Wall-clock halving is deterministic -- you can compute the exact emission rate at any future timestamp without knowing the block height.

### Layer 2: Three Distribution Sinks

Each drip produces amount `P`, split into three sinks:

```
shapleyShare  = P * shapleyBps / 10000
gaugeShare    = P * gaugeBps   / 10000
stakingShare  = P - shapleyShare - gaugeShare   (remainder, avoids dust)
```

The remainder assignment to staking is deliberate: `shapleyShare + gaugeShare + stakingShare = P` always. No dust. No rounding errors. No lost tokens.

| Sink | Purpose | Distribution Model |
|------|---------|-------------------|
| **Shapley Pool** | Contribution rewards | Accumulation + Shapley games |
| **Liquidity Gauge** | LP incentives | Curve-style gauge voting |
| **Staking Rewards** | Token holder alignment | Synthetix-style streaming |

### Layer 3: The Accumulation Pool

This is the piece that matters most, and where we diverge from every existing emission model.

Standard reward streaming (Synthetix-style) distributes tokens linearly over time. A liquidity provider who shows up for one second earns the same rate as one who provides liquidity during a market crash. Time-in-protocol is the only variable. This rewards passive holding, not active contribution.

The accumulation pool introduces a different dynamic:

```
On drip():   shapleyPool += shapleyShare
On drain():  game created with pool contents
```

Tokens accrue during quiet periods. When the pool is drained, the `EmissionController` transfers the accumulated VIBE to the `ShapleyDistributor`, which creates a cooperative game and computes Shapley values for all contributors.

This creates **incentive waves**:

```
Time ─────────────────────────────────────────>

Pool size:   ▁▂▃▄▅▆▇█  drain  ▁▂▃▅▇█  drain  ▁▃▆█  drain
                      ↓              ↓             ↓
             Game 1 settled   Game 2 settled  Game 3 settled
             (large pool)     (large pool)    (medium pool)
```

The waves create three properties that linear streaming cannot:

1. **Natural timing**: Games happen when there is enough to distribute. No arbitrary schedule.
2. **Anti-mercenary**: You cannot flash-provide liquidity to capture a stream. The pool accumulates between games; you need sustained contribution to earn Shapley rewards.
3. **Bursty participation**: Real value creation is not continuous. It is punctuated -- a bug fix during a crisis, liquidity during a crash, a governance proposal at a critical moment. The accumulation pool rewards bursts of genuine contribution.

---

## The Drain Mechanism: Percentage-Based, Not Absolute

When the Shapley pool is drained, the drain amount is bounded:

```
minDrainBps / 10000 * S <= drainAmount <= maxDrainBps / 10000 * S
```

This is percentage-based, not absolute. Why does this matter?

Consider a minimum drain of 100 VIBE (absolute). If VIBE trades at $0.01, the minimum drain is $1. Fine. If VIBE trades at $10,000, the minimum drain is $1,000,000. The mechanism becomes unusable without a governance vote to adjust the parameter.

Percentage-based minimums scale naturally with both pool size and token price. No oracle dependency. No governance intervention. No trusted third party.

---

## The Double-Halving Trap

A subtle but critical design detail: when the pool is drained and a game is created, the `EmissionController` creates a `FEE_DISTRIBUTION` game, not a `TOKEN_EMISSION` game.

Why? The `EmissionController` has already applied wall-clock halving to the emission rate. If the `ShapleyDistributor` also applied its own game-count halving (which it does for `TOKEN_EMISSION` games), the effective reward would be halved twice.

```
WRONG:  R_0 >> era  →  pool  →  ShapleyDistributor  →  >> gameEra  →  double-halved
RIGHT:  R_0 >> era  →  pool  →  ShapleyDistributor  →  (no halving) →  correctly halved
```

Halving must happen exactly once. The EmissionController owns the halving schedule. The ShapleyDistributor computes Shapley values on whatever it receives. Separation of concerns.

---

## Five Invariants, Formally Proven

The mechanism satisfies five invariants verified through 7 invariant tests (256 runs, 128K calls each):

### 1. Supply Cap
`totalEmitted <= MAX_SUPPLY`

Enforced at two independent layers: `drip()` caps emissions at `vibeToken.mintableSupply()`, and the VIBEToken's mint function independently reverts if the cap would be exceeded.

### 2. Accounting Identity
```
shapleyPool + totalShapleyDrained + totalGaugeFunded + stakingPending + totalStakingFunded == totalEmitted
```

Every VIBE minted is added to exactly one accumulator. Every VIBE transferred decreases one accumulator and increases another. No tokens created or destroyed outside these paths.

### 3. Solvency
```
VIBE.balanceOf(EmissionController) >= shapleyPool + stakingPending
```

The contract always holds enough tokens to cover its obligations. Drains reduce both the balance and the obligation simultaneously.

### 4. Rate Monotonicity
`getCurrentRate() <= BASE_EMISSION_RATE`

Right-shifting a positive integer by a non-negative amount always produces a result less than or equal to the original. The emission rate can only decrease.

### 5. Era Bound
`getCurrentEra() <= MAX_ERAS`

Explicitly capped at 32 eras. After era 32, the emission rate is `R_0 >> 32`, which for practical purposes is zero.

---

## Cross-Era Accrual: O(1) Gas

When `drip()` is called after a long gap spanning multiple eras, the contract computes:

```
pending = Sum_{e=0}^{MAX_ERAS} R(e) * overlap(e, lastDripTime, now)
```

Where `overlap` computes the time intersection between the drip window and each era. The loop is bounded at MAX_ERAS = 32 iterations. Whether you call `drip()` every second or once per decade, gas cost is O(1).

This is important for a permissionless mechanism. Anyone can call `drip()`. If a long gap makes `drip()` expensive, the mechanism requires someone to monitor and call it regularly. With O(1) gas, there is no penalty for infrequent calls.

---

## Comparison

| Mechanism | Pre-mine | Halving | Distribution | Price Dependency |
|-----------|----------|---------|-------------|-----------------|
| Bitcoin | None | Block-count | Mining (PoW) | None |
| Synthetix SNX | 100M pre-mint | None | Staking rewards | None |
| Curve CRV | 3.03B (62% community) | Epoch-based | Gauge voting | None |
| Pendle PENDLE | Pre-allocated | Weekly decay | LP + vePENDLE | None |
| **VIBE** | **None** | **Wall-clock** | **Shapley + Gauge + Staking** | **None** |

Key differentiators:
- **Zero pre-mine** (unlike Curve, Synthetix, Pendle)
- **Shapley-based distribution** (contribution-proportional, not time-proportional)
- **Accumulation pool** (bursty rewards, not linear streaming)
- **Percentage-based minimums** (self-scaling, no oracle dependency)

---

## Gas Analysis

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| `drip()` (single era) | ~220K | Mint + transfer + storage updates |
| `drip()` (cross-era) | ~280K | Additional iterations in accrual loop |
| `createContributionGame()` | ~380K | Transfer + game creation + settlement |
| `fundStaking()` | ~330K | Approve + notifyRewardAmount |
| `pendingEmissions()` (view) | ~25K | Pure computation, no state changes |

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

The parallel is not superficial. Both systems split emission into multiple sinks with distinct purposes. Both avoid concentrating all emission into a single recipient type. Both create feedback loops where the emission benefits the entities that make the system work.

### State Rent as Implicit Cooperative Emission

CKB's state rent model is a form of cooperative emission that most chains lack entirely. When you occupy state on CKB, you lock CKB that would otherwise earn NervosDAO returns. This implicit cost funds the commons -- miners who validate the chain, the NervosDAO that compensates holders, the treasury that funds development.

VIBE's accumulation pool follows the same logic: protocol fees (the "rent" paid by traders) accumulate in the Shapley pool and are distributed to contributors. Traders pay. Contributors earn. The mechanism connects the two through cooperative game theory rather than through direct accounting.

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
