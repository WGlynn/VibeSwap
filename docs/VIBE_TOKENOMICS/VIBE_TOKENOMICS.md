# VIBE Tokenomics — Zero Pre-mine Emission Design

**VibeSwap Operating System (VSOS)** | February 2026

---

## The Covenant

**21,000,000 VIBE.** Hard cap. Never increased. Every single token earned through contribution. No exceptions.

This is not a marketing choice. This is a design choice. The incentive structure of a token is determined at genesis — and we chose Bitcoin's.

---

## Why Zero Pre-mine

Every major token scandal in crypto history traces back to the same root cause: insiders held tokens they didn't earn. Pre-mined allocations, team vesting, VC deals — these create a class of holders whose economic interest is extraction, not building.

Bitcoin solved this in 2009. The solution was radical simplicity: **you want coins, you mine them.** The founder mined alongside everyone else. No special treatment. No backdoor deals.

VIBE follows this principle exactly:

| | Bitcoin | VIBE |
|---|---------|------|
| Max Supply | 21,000,000 BTC | 21,000,000 VIBE |
| Pre-mine | Zero | Zero |
| Team Allocation | Zero | Zero |
| VC Allocation | Zero | Zero |
| Treasury Allocation | Zero at genesis | Zero at genesis |
| Emission | Block rewards | Wall-clock emission |
| Halving | Every 210,000 blocks | Every 365.25 days |
| Earned by | Mining (PoW) | Contributing (Shapley) |

The difference: Bitcoin measures work in hash computations. VIBE measures work in marginal contribution to the cooperative game — liquidity provision, code commits, governance participation, market-making during volatility. The Shapley value ensures that each participant's reward is proportional to their actual contribution, verified through on-chain pairwise fairness checks.

---

## Emission Schedule

### Wall-Clock Halving

```
Era 0 (Year 1):  ~10,500,000 VIBE  (50.00% of supply)
Era 1 (Year 2):   ~5,250,000 VIBE  (75.00% cumulative)
Era 2 (Year 3):   ~2,625,000 VIBE  (87.50% cumulative)
Era 3 (Year 4):   ~1,312,500 VIBE  (93.75% cumulative)
Era 4 (Year 5):     ~656,250 VIBE  (96.88% cumulative)
...
Era 31 (Year 32):        ~0 VIBE  (~100% cumulative)
```

The base emission rate is `332,880,110,000,000,000 wei/second` (~0.333 VIBE/sec). Every 365.25 days, the rate halves. After 32 halvings, the rate is effectively zero.

This schedule means:
- **50% of all VIBE** is emitted in the first year — rewarding early contributors generously
- **75%** emitted by end of year 2
- **93.75%** emitted by end of year 4
- The remaining ~6% trickles out over the next 28 years

Early contributors earn more per unit of contribution. This is intentional — the bootstrapping incentive. Just like Bitcoin's early miners got 50 BTC per block while today's miners get 3.125 BTC, early VIBE contributors earn at the highest rate. The difference is deliberate, transparent, and immutable.

### Why Wall-Clock, Not Block-Count

Bitcoin uses block count for halving because blocks are the unit of work in Proof of Work. VIBE uses wall-clock time because contribution is measured in real-world impact, not computational cycles.

Wall-clock halving means:
- No "fast-mining" exploits — time passes at the same rate for everyone
- Predictable schedule — anyone can calculate exactly when the next halving occurs
- Cross-chain compatible — works the same regardless of block time on any chain

---

## Distribution: Three Sinks

Every VIBE minted flows through one of three sinks:

### 1. Shapley Accumulation Pool (50%)

The primary distribution channel. VIBE accumulates in a pool until drained by a contribution game. When drained, the tokens flow to a ShapleyDistributor game where participants earn based on their marginal contribution.

**Why accumulation, not streaming?** Streaming creates a constant drip that rewards time-in-protocol above all else. Accumulation creates incentive waves — the pool grows during quiet periods and rewards contributors who act when it matters. This mirrors how real value creation works: bursty, not continuous.

**Game type:** FEE_DISTRIBUTION (time-neutral). The EmissionController already applies wall-clock halving. The ShapleyDistributor distributes the pool proportionally without additional halving — no double-discounting.

### 2. Liquidity Gauge (35%)

Streamed directly to the LiquidityGauge contract, which distributes to LP stakers based on gauge weights set by governance. This is the standard Curve-style incentive mechanism for liquidity provision.

LPs stake their LP tokens in gauges. Governance votes on which pools get what percentage of emissions. Emissions distribute proportionally to staked LP within each gauge.

### 3. Single Staking (15%)

Accumulated and periodically pushed to the SingleStaking contract via `notifyRewardAmount`. Stakers who lock VIBE for governance earn additional VIBE rewards.

This creates a flywheel: earn VIBE through contribution → stake VIBE for governance → earn more VIBE → participate in governance decisions that affect the protocol's direction.

---

## The Drain Mechanism

### Percentage-Based Minimum (Trustless Price Scaling)

The minimum drain amount is defined as a **percentage of the pool** (default: 1%), not a fixed token amount.

**Why?** A fixed minimum (e.g., 100 VIBE) becomes a barrier if VIBE appreciates significantly. At $10,000/VIBE, a 100 VIBE minimum means $1M minimum per contribution game — effectively bricking the system. A percentage minimum scales naturally:

- Pool of 10,000 VIBE → min drain 100 VIBE (1%)
- Pool of 100 VIBE → min drain 1 VIBE (1%)
- VIBE goes from $1 to $10,000 → minimum scales proportionally

No oracle needed. No trusted third party. No governance vote required to adjust. The mechanism is self-scaling by construction.

### Maximum Drain Cap

Maximum 50% of the pool can be drained per game (`maxDrainBps = 5000`). This ensures no single contribution game empties the pool, preserving incentives for future contributors. Even the largest drain leaves half the pool for the next round.

---

## Governance Parameters

All emission parameters are adjustable by the protocol owner (ultimately transferred to decentralized governance):

| Parameter | Default | Range | Purpose |
|-----------|---------|-------|---------|
| shapleyBps | 5000 | 0-10000 | Shapley pool share (must sum to 10000 with others) |
| gaugeBps | 3500 | 0-10000 | Gauge share |
| stakingBps | 1500 | 0-10000 | Staking share |
| maxDrainBps | 5000 | 0-10000 | Max pool drain per game |
| minDrainBps | 100 | 0-10000 | Min drain as % of pool |
| minDrainAmount | 0 | 0-inf | Optional absolute drain floor |
| stakingRewardDuration | 7 days | >0 | Reward period per staking notify |

---

## Two-Token Model

VIBE exists alongside JUL (Joule) in a complementary two-token system:

| | VIBE | JUL |
|---|------|-----|
| **Purpose** | Governance + Contribution Rewards | Stable Liquidity Asset |
| **Supply** | 21M hard cap | Elastic (PI controller rebase) |
| **Issuance** | Shapley-distributed, halving | RPow mining (SHA-256 PoW) |
| **Value Anchor** | Contribution (Shapley values) | Electricity cost (PoW) |
| **Composability** | Stake JUL → earn VIBE | Stake VIBE → earn JUL |

The two tokens serve different economic functions:
- **VIBE** captures governance power and contribution value — it's scarce, deflationary-trending, and earned through demonstrated impact
- **JUL** provides the stable liquidity layer — it rebases to maintain purchasing power, mined through proof of work that anchors value to physical cost

Together, they form the Trinomial Stability System (TSS): PoW-anchored stability (JUL) + contribution-weighted governance (VIBE) + mutualized risk (insurance pools, treasury stabilization).

---

## Time Neutrality

VIBE's emission design deliberately distinguishes between two types of fairness:

### Time-Neutral: Fee Distribution

When trading fees are distributed via Shapley games, the distribution is **time-neutral**: identical contributions yield identical rewards regardless of when they occur. Fee distribution games use the `FEE_DISTRIBUTION` type — no halving applied.

This satisfies the Time Neutrality axiom: a contributor who provides $1000 of liquidity today earns the same fee share as someone who provides $1000 of liquidity next year, all else equal.

### Time-Intentional: Token Emission

Token emissions follow the halving schedule. This is **intentionally not time-neutral** — early contributors earn more per unit of contribution. This is the bootstrapping incentive, identical in purpose to Bitcoin's decreasing block rewards.

The EmissionController applies halving through its wall-clock rate. The ShapleyDistributor receives the already-halved amount and distributes it proportionally (FEE_DISTRIBUTION type, no additional halving).

---

## Security Properties

1. **No external dependencies** — Emission rate is purely time-based. No oracle, no external price feed, no governance vote needed for the schedule to execute.

2. **MAX_SUPPLY is absolute** — The VIBEToken contract enforces the 21M cap independently of the EmissionController. Even a buggy emission calculation cannot exceed the cap.

3. **Bounded computation** — Cross-era emission calculation loops through at most 32 iterations. Gas costs are predictable regardless of how long between drips.

4. **Self-scaling minimums** — Percentage-based drain minimum means the system cannot be bricked by price appreciation.

5. **Permissionless operation** — `drip()` and `fundStaking()` can be called by anyone. The protocol doesn't depend on any single entity to keep emissions flowing.

---

## Contract Addresses

*To be filled at deployment*

| Contract | Address | Chain |
|----------|---------|-------|
| VIBEToken | — | — |
| EmissionController | — | — |
| ShapleyDistributor | — | — |
| LiquidityGauge | — | — |
| SingleStaking | — | — |

---

*"Your keys, your bitcoin. Not your keys, not your bitcoin." The same applies to token distribution: your contribution, your VIBE. No contribution, no VIBE. No exceptions.*
