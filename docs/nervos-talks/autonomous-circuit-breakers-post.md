# Autonomous Circuit Breakers: How VibeSwap Defends Itself Without Humans in the Loop

*Nervos Talks Post — W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

DeFi has lost over $800 million to exploits where the attack executed in seconds but the response took hours. Euler Finance ($197M), Mango Markets ($114M), Wormhole ($320M) — same pattern every time. Attack lands in one block. Alert reaches the team in 30 minutes. Multisig coordination takes hours. By the time the pause transaction lands, the money is gone. VibeSwap replaces human-dependent security with five autonomous circuit breakers — volume, price, withdrawal, true price (Kalman filter), and cross-validation — that detect and respond to attacks in the same block. Instead of binary pauses that freeze the entire protocol, the system applies graduated fee surcharges that make extractive behavior economically irrational while honest trading continues uninterrupted. The protocol defends itself. No multisig. No governance vote. No Discord alert chain.

---

## The Fundamental Problem: Humans Are Too Slow

Here is the anatomy of a typical DeFi exploit:

| Phase | Duration | What Happens |
|---|---|---|
| Attack execution | 1 block (12s) | Flash loan, oracle manipulation, drain |
| Detection by monitoring | 5-30 min | Off-chain bots flag anomaly |
| Alert reaches team | 15-60 min | PagerDuty, Discord, Twitter |
| Multisig coordination | 1-6 hours | Gather 3/5 or 4/7 signers across timezones |
| Pause transaction | 12s | Finally lands on-chain |
| **Total response** | **1.5-7 hours** | **Funds already gone** |

The attack operates at machine speed. The defense operates at organizational speed. This is not a parameter to optimize — it is a structural flaw to eliminate.

**Euler Finance (March 2023, $197M):** Single transaction. Flash loan oracle manipulation. The multisig pause came hours after the entire lending pool was drained.

**Mango Markets (October 2022, $114M):** MNGO-PERP oracle price manipulated upward by 10x over several minutes. Borrowed against inflated collateral. Governance could not respond in time. A TWAP deviation breaker tripping at 5% would have caught it within seconds.

**Wormhole (February 2022, $320M):** Bridge exploit went undetected for hours. A withdrawal breaker monitoring outflow rates would have tripped when TVL drained beyond 25% within a single window.

The common thread is not technical incompetence. These are talented teams with sophisticated monitoring. The problem is structural: **any security mechanism that requires human coordination is too slow for on-chain adversaries.**

---

## The Five Breakers: Orthogonal Coverage

VibeSwap implements five circuit breaker types, each monitoring a distinct attack surface. They share a common accumulator architecture — values accumulate within rolling windows, and the breaker trips when accumulated value crosses a threshold.

```
struct BreakerConfig {
    bool enabled;
    uint256 threshold;        // Trip threshold
    uint256 cooldownPeriod;   // How long breaker stays active
    uint256 windowDuration;   // Rolling window for accumulation
}

struct BreakerState {
    bool tripped;
    uint256 trippedAt;
    uint256 windowStart;
    uint256 windowValue;      // Accumulator within window
}
```

The accumulator pattern is critical: it catches both sudden spikes (one large trade) and gradual drainage (many small trades summing to danger).

### Breaker 1: Volume

**What it catches:** Flash loan attacks, wash trading, liquidity drains.

Accumulates total swap volume within a 1-hour rolling window. Trips at $10M equivalent. Normal DEX pools rarely exceed $10M/hour in organic volume. Flash loans, by definition, move enormous capital in single transactions. A pool processing $10M in an hour is either under attack or experiencing a black swan event — both warrant protection.

**What it misses:** Low-and-slow attacks that stay under threshold. Price manipulation via small but strategic trades.

### Breaker 2: Price (TWAP Deviation)

**What it catches:** Oracle manipulation, price feed attacks, large market manipulation.

Monitors spot price deviation from the 10-minute on-chain TWAP. Trips if cumulative deviation exceeds 50% within 15 minutes (individual deviations of 5% accumulate).

Empirical analysis shows organic intra-block price movements rarely exceed 2-3%. A 5% deviation from a 10-minute TWAP is strong evidence of manipulation. The threshold is deliberately tight because the batch auction already provides MEV resistance — any remaining deviation is suspicious.

**What it misses:** Slow manipulation that moves price gradually, poisoning the TWAP itself. This is exactly what the True Price Breaker addresses.

### Breaker 3: Withdrawal Rate

**What it catches:** Bank runs, smart contract bugs causing mass withdrawal, governance attack preludes.

Monitors the percentage of total pool liquidity withdrawn within a rolling window. Trips if withdrawals exceed 25% of TVL in 1 hour. A quarter of TVL leaving in an hour signals either panic (the pause gives time to communicate) or coordinated extraction (the pause prevents further damage).

**What it misses:** Attacks that do not involve withdrawals — pure swap exploits, price manipulation without LP removal.

### Breaker 4: True Price (Kalman Filter)

**What it catches:** Sophisticated manipulation that evades TWAP detection.

This is the most advanced signal. The True Price Oracle receives updates from an off-chain Kalman filter — a Bayesian state-space model that maintains a statistical estimate of the "true" equilibrium price as a hidden variable.

Traditional oracles report market price as-is, which means they faithfully transmit manipulated prices. The Kalman filter does something fundamentally different: it maintains a model of what the price **should** be based on all prior observations, and flags when reality diverges from the model.

The filter tracks five signals:

- **Price**: Best estimate of true equilibrium
- **Confidence**: Posterior confidence interval width
- **Deviation Z-Score**: Standard deviations from true price
- **Regime**: Classified market state (NORMAL, TREND, HIGH_LEVERAGE, MANIPULATION, CASCADE, LOW_VOLATILITY)
- **Manipulation Probability**: Bayesian probability of manipulation (0-1)

Regime detection works by monitoring the **innovation sequence** — the difference between predicted and observed prices. When innovations become non-Gaussian (systematically biased in one direction, or showing patterns inconsistent with random market noise), the filter flags a regime change.

**Regime-adjusted deviation bounds:**

| Regime | Deviation Multiplier | Effective Bound |
|---|---|---|
| CASCADE | 60% | 3% (tightest) |
| MANIPULATION | 70% | 3.5% |
| HIGH_LEVERAGE | 85% | 4.25% |
| NORMAL | 100% | 5% (baseline) |
| TREND | 115% | 5.75% |
| LOW_VOLATILITY | 130% | 6.5% (loosest) |

During cascade or manipulation regimes, the system tightens bounds — any price movement is treated with greater suspicion. During confirmed trends, bounds loosen to avoid false positives.

### Breaker 5: Cross-Validation (The Fifth Dimension)

**What it catches:** The attacks that neither oracle catches alone.

The system compares two independent signals that observe the market through fundamentally different lenses:

- **True Price Oracle**: Bayesian, forward-looking (what should the price be?)
- **Volatility Oracle**: Frequentist, backward-looking (how much has the price moved?)

The Volatility Oracle computes realized volatility from a ring buffer of 24 price observations at 5-minute intervals. Four tiers: LOW (<20% annualized), MEDIUM (20-50%), HIGH (50-100%), EXTREME (>100%).

When these two oracles **disagree**, the disagreement itself is information:

```
                     Volatility Oracle
                     LOW/MED     HIGH/EXTREME
True Price  DANGER   STEALTH     CONFIRMED
Oracle      NORMAL   CALM        ORGANIC
```

**Stealth Manipulation (DANGER + LOW volatility):** The most dangerous case. The Kalman filter detects manipulation, but realized volatility is low. The attacker is moving price via many small trades that each look normal. The TWAP drifts with the manipulation. The Volatility Oracle sees low variance. But the Kalman filter detects the systematic bias in the innovation sequence.

Response: Tighten bounds by 30%. Add 50% fee surcharge. The attacker's room to maneuver collapses.

**Confirmed Danger (DANGER + HIGH volatility):** Both oracles agree the market is in distress. Response: Tighten bounds by 15%. Less aggressive than stealth because the attack is visible — participants can see it.

**Organic Volatility (NORMAL + HIGH volatility):** Genuine market event. No manipulation, just news. Response: Widen bounds by 15%. Without cross-validation, the high volatility alone would trigger aggressive damping and impede legitimate price discovery. This is the false positive reduction case.

**Calm Markets (NORMAL + LOW volatility):** Both oracles agree the market is healthy. No adjustment.

The information-theoretic argument: each oracle sees the market through a different lens. Agreement confirms. **Disagreement reveals what neither sees alone.** This is the principle: 100% signal, 0% noise.

---

## Fee Surcharges: Punishment, Not Pauses

Binary pauses are blunt instruments. The protocol is either running or stopped. Fee surcharges provide graduated response — extractive behavior gets progressively more expensive while honest trading continues.

### The Surcharge Stack

Three independent sources compound:

**Regime-Based Surcharge:**
```
NORMAL         → +0%    (5 bps base fee)
HIGH_LEVERAGE  → +50%   (7.5 bps)
MANIPULATION   → +100%  (10 bps)
CASCADE        → +200%  (15 bps)
```

**Manipulation Probability Surcharge:**
```
>80% probability → +200% of base (+10 bps)
>50% probability → +100% of base (+5 bps)
<50% probability → +0%
```

**Cross-Validation Surcharge (stealth only):**
```
Stealth manipulation detected → +50% of base (+2.5 bps)
```

### Worst Case Scenario

CASCADE regime + >80% manipulation probability + stealth manipulation:

```
Base fee:                          5 bps
CASCADE surcharge (+200%):       +10 bps
Manipulation >80% (+200%):      +10 bps
Stealth tax (+50%):              + 2.5 bps
                                 --------
Raw total:                        27.5 bps
Hard cap:                         500 bps (5%)
```

The maximum practical surcharge is a 5.5x multiplier on base fees. Harsh but not ruinous. An attacker paying 27.5 bps per trade in a multi-trade manipulation faces compounding costs:

```
Net profit = Expected_MEV - (N_trades * Volume * Surcharge_rate)
```

As surcharges increase, the break-even number of trades that makes the attack unprofitable **decreases**. During a CASCADE+high-manipulation regime, surcharges raise effective fees by 5-6x, reducing the attacker's viable trade count proportionally.

### The Virtuous Cycle

Surcharge fees above the base rate route to the insurance pool:

1. Attacker trades during adverse conditions
2. Surcharge fees accumulate
3. Surplus flows to insurance pool
4. Insurance compensates LPs for impermanent loss caused by the attack
5. **The attacker funds the defense of the system they attack**

---

## The Five-Level Graduated Response

The system almost never needs to actually pause. Each level absorbs threat before it escalates:

```
Level 0: Normal Operation
  No breakers, no surcharges, base fees, full bounds.

Level 1: Fee Surcharge
  True Price detects adverse regime. Trading continues.
  Extractive behavior costs more. Surplus to insurance.

Level 2: Golden Ratio Damping
  Clearing price deviates beyond bounds. Instead of rejecting,
  price is pulled toward True Price using phi (1.618) interpolation.
  Batch executes at damped price. Trading continues.

Level 3: Tightened Bounds + Surcharge
  Cross-validation detects mismatch. Bounds tighten 15-30%.
  Surcharges increase. Damping corridor narrows.
  Attacker's room to maneuver shrinks.

Level 4: Breaker Trip
  Accumulated threshold exceeded. Affected operations revert.
  Cooldown period enforced. This is the hard stop.

Level 5: Global Pause
  All operations halted. Guardian emergency action only.
  Last resort. Never required for autonomous defense.
```

**The design goal: the system should almost never reach Level 4.** Fee surcharges (Level 1) make attacks unprofitable. Damping (Level 2) limits manipulation effectiveness. Tightened bounds (Level 3) catch sophisticated attacks. By Level 4, the attack has already been economically neutralized through Levels 1-3.

---

## Attack Scenarios: What Gets Caught and How

### Flash Loan Oracle Manipulation

Attacker borrows 100M USDC, swaps into TOKEN to spike price, borrows against inflated collateral.

**What catches it first:** Flash loan protection. Same-block interaction blocked. Attack stops before it reaches any breaker. Even if it somehow bypassed flash loan protection: volume breaker (100M > $10M threshold), price breaker (5% TWAP deviation), True Price breaker (CASCADE regime from magnitude and speed).

### Slow Oracle Manipulation (Multi-Block)

Attacker makes many small trades over 30 minutes, each under 5% TWAP deviation, gradually moving price 40%.

**What catches it:** The TWAP drifts with the manipulation. The volume breaker may not trigger (small individual trades). This is the attack that TWAP alone misses. The Kalman filter detects systematic bias in the innovation sequence — MANIPULATION regime flagged. Fee surcharges activate (+100%). Deviation bounds tighten to 70%.

If realized volatility stays low (small individual trades), cross-validation detects stealth manipulation. Bounds tighten further to 70% * 70% = 49% of base. Additional +50% fee surcharge. The attacker's margin erodes to zero.

### Liquidation Cascade

Not an attack — automated liquidations driving price down, causing more liquidations.

**Graduated response:** Fee surcharges slow the cascade by making each subsequent liquidation more expensive. Golden ratio damping pulls clearing price toward True Price, reducing each price impact. The cascade dissipates before the volume breaker trips. The system absorbs the shock without pausing.

### Bank Run

Mass LP withdrawal from rumor or panic.

**What catches it:** Withdrawal breaker trips at 25% TVL outflow in 1 hour. 2-hour cooldown gives the protocol time to communicate with LPs and address the concern. The pause is protective, not punitive.

---

## CKB Substrate Analysis

The autonomous circuit breaker model has natural extensions on CKB:

### Type Script Enforcement

On Ethereum, circuit breaker logic lives inside the same contract as trading logic. A bug in one affects the other. On CKB, the circuit breaker could be a **separate type script** that must validate alongside the trading type script. The breaker logic is composable and independently auditable.

```
Pool Cell:
  Lock Script:  standard or PoW lock
  Type Script:  trading-logic + circuit-breaker-type (composable)
  Data:         reserves, TWAP buffer, breaker state
```

The breaker type script validates that:
- Accumulated volume/price/withdrawal values are within thresholds
- Fee surcharges are correctly applied based on regime
- Cooldown periods are respected

Because type scripts compose independently, upgrading the breaker logic does not require touching the trading logic. This separation of concerns is structural on CKB, not emulated.

### Oracle as Cell State

On CKB, oracle updates could be independent cells consumed by the settlement transaction. The True Price Oracle would post its Kalman filter state as a cell:

```
Oracle Cell:
  Lock Script:  authorized-signer-lock
  Type Script:  oracle-type
  Data:         price, confidence, regime, manipulation_prob, timestamp
```

The trading type script reads the oracle cell as a cell dep (no consumption needed for reads). Staleness is enforced by the type script comparing the oracle cell's timestamp against the transaction's header dep. If the oracle is stale (>5 minutes), the type script falls back to TWAP-only validation.

This is cleaner than Ethereum's `try/catch` pattern because the oracle availability is a verifiable cell property, not a runtime exception.

### Cross-Validation as Independent Scripts

The cross-validation logic — comparing True Price regime with Volatility Oracle tier — could be a third independent type script:

```
Settlement Transaction:
  Cell Deps: Oracle Cell, Volatility Cell
  Type Scripts: trading-type, breaker-type, cross-validator-type
```

Three independent pieces of logic, each auditable separately, composing to produce the full protection stack. This is CKB's composability model applied to security — not "one big contract" but "multiple independent verification scripts."

### Graceful Degradation Is Natural

On Ethereum, graceful degradation requires `try/catch` wrappers — if the oracle call reverts, catch the error and continue without protection. On CKB, this is structural: if the oracle cell does not exist (oracle is down), the cross-validator type script simply does not run (it has no cell dep to validate against). The trading type script and breaker type script still run. Degradation is implicit in the cell model — missing inputs mean missing validation, and the remaining validators continue independently.

---

## Comparison with Existing Approaches

| Feature | VibeSwap | Uniswap v3 | Aave v3 | Chainlink Circuit Breaker |
|---|---|---|---|---|
| Autonomous detection | 5 types | No | Partial | 1 type (price) |
| Multi-dimensional | 5 dimensions | No | No | No |
| Fee surcharge | Regime-based | No | No | No |
| Cross-validation | 2 independent oracles | No | No | No |
| Graduated response | 5 levels | No | Partial | Binary pause |
| Flash loan protection | Structural | No | Partial | N/A |
| Kalman filter regime | Yes | No | No | No |
| False positive mitigation | Cross-validation | N/A | N/A | No |

The gap is not incremental. Most DeFi protocols have zero autonomous circuit breakers. The ones that do have a single dimension (price feed monitoring) with binary response (pause everything or do nothing). VibeSwap's system is five-dimensional with graduated response. The cross-validation between Bayesian and frequentist oracles — producing information from their disagreement — appears to be novel in the DeFi space.

---

## Limitations and Honest Assessment

**Oracle dependency.** The True Price Breaker relies on off-chain Kalman filter updates with a 5-minute staleness window. During oracle downtime, this layer is inactive. Fully on-chain Kalman filter approximation using recursive least squares is future work.

**Gas costs.** Cross-validation adds approximately 30,000 gas per swap (two external oracle calls). Negligible on L2s. On L1 Ethereum at high gas prices, it may matter. On CKB, this translates to additional cycles in CKB-VM — benchmarking is needed.

**Parameter tuning.** The thresholds (5% deviation, 25% withdrawal, $10M volume) are based on empirical analysis of existing DeFi exploits but have not been tested against live adversarial conditions.

**Collusion risk.** A compromised oracle signer could submit false regime data to trigger surcharges on honest traders. The 10% max price jump per update limits this, but multi-signer oracle consensus is future work.

---

## Discussion

Questions for the community:

1. **Type script composition for security layers is a powerful CKB pattern.** Has anyone deployed composable type scripts where multiple independent validation scripts must all succeed? What are the practical challenges — ordering, data sharing, cycle budget allocation?

2. **Oracle cells as cell deps versus cell inputs.** Reading oracle state without consuming the cell (cell dep) is efficient but means the oracle cell is never "used up." How does this interact with CKB's state rent model? Should oracle cells have explicit expiry?

3. **The Kalman filter is currently off-chain with signed updates.** Could a simplified version run entirely in CKB-VM? Recursive least squares requires floating point approximation via fixed-point arithmetic. Has anyone benchmarked numerically intensive computation in CKB-VM?

4. **Graduated fee surcharges as an alternative to pauses.** In CKB's economic model, should surcharges flow to NervosDAO, to a protocol insurance pool, or to affected liquidity providers? What is the most natural routing on CKB?

5. **Cross-validation between independent oracles — using disagreement as signal.** This principle generalizes beyond price oracles. Any system with two independent information sources can extract signal from their divergence. What other CKB applications could benefit from this pattern?

6. **The 5-level graduated response model could be a CKB standard for DeFi protocols.** Should the Nervos community develop a shared circuit breaker type script that any DeFi application can compose into its validation stack? A public good for CKB DeFi safety?

The full paper with implementation details, attack scenario analysis, and game-theoretic properties: `docs/papers/autonomous-circuit-breakers.md`

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*

*Full paper: [autonomous-circuit-breakers.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/autonomous-circuit-breakers.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
