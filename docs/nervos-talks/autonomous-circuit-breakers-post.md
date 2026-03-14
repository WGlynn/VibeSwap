# Autonomous Circuit Breakers: How VibeSwap Defends Itself Without Humans in the Loop

*Nervos Talks Post — Faraday1*
*March 2026*

---

## TL;DR

DeFi has lost over $800 million to exploits where the attack executed in seconds but the response took hours. Euler Finance ($197M), Mango Markets ($114M), Wormhole ($320M) — same pattern every time. Attack lands in one block. Multisig coordination takes hours. Money is gone before the pause transaction lands. VibeSwap replaces human-dependent security with five autonomous circuit breakers — volume, price, withdrawal, true price (Kalman filter), and cross-validation — that detect and respond in the same block. Instead of binary pauses, the system applies graduated fee surcharges that make extractive behavior economically irrational while honest trading continues. The protocol defends itself. No multisig. No governance vote. No Discord alert chain.

---

## The Fundamental Problem: Humans Are Too Slow

| Phase | Duration | What Happens |
|---|---|---|
| Attack execution | 1 block (12s) | Flash loan, oracle manipulation, drain |
| Detection by monitoring | 5-30 min | Off-chain bots flag anomaly |
| Alert reaches team | 15-60 min | PagerDuty, Discord, Twitter |
| Multisig coordination | 1-6 hours | Gather signers across timezones |
| **Total response** | **1.5-7 hours** | **Funds already gone** |

The attack operates at machine speed. The defense operates at organizational speed. This is not a parameter to optimize — it is a structural flaw to eliminate.

Euler ($197M): single transaction, multisig pause came hours later. Mango ($114M): oracle manipulated 10x over minutes, governance too slow. Wormhole ($320M): went undetected for hours. These are talented teams. The problem is structural: **any security mechanism requiring human coordination is too slow.**

---

## The Five Breakers

All five share a common accumulator architecture: values accumulate within rolling windows, and the breaker trips when accumulated value crosses a threshold. This catches both sudden spikes and gradual drainage.

### Breaker 1: Volume

Accumulates total swap volume within 1-hour window. Trips at $10M equivalent. Normal pools rarely exceed $10M/hour organically. Flash loans move enormous capital in single transactions.

**Misses:** Low-and-slow attacks under threshold. Small strategic trades.

### Breaker 2: Price (TWAP Deviation)

Monitors spot price deviation from 10-minute on-chain TWAP. Trips if cumulative deviation exceeds 50% within 15 minutes. Organic intra-block movements rarely exceed 2-3%.

**Misses:** Slow manipulation that poisons the TWAP itself. This is exactly what Breaker 4 addresses.

### Breaker 3: Withdrawal Rate

Monitors percentage of TVL withdrawn within rolling window. Trips at 25% in 1 hour. A quarter of TVL leaving signals either panic (pause gives time to communicate) or coordinated extraction (pause prevents further damage).

**Misses:** Pure swap exploits without LP removal.

### Breaker 4: True Price (Kalman Filter)

The most advanced signal. The True Price Oracle uses an off-chain Kalman filter — a Bayesian state-space model that estimates the "true" equilibrium price as a hidden variable.

Traditional oracles faithfully transmit manipulated prices. The Kalman filter maintains a model of what price **should** be, flagging when reality diverges. It tracks regime classification (NORMAL, TREND, HIGH_LEVERAGE, MANIPULATION, CASCADE, LOW_VOLATILITY) by monitoring the **innovation sequence** — when predicted-vs-observed differences become non-Gaussian, the filter detects regime change.

**Regime-adjusted deviation bounds:**

| Regime | Effective Bound |
|---|---|
| CASCADE | 3% (tightest — maximum suspicion) |
| MANIPULATION | 3.5% |
| HIGH_LEVERAGE | 4.25% |
| NORMAL | 5% (baseline) |
| TREND | 5.75% |
| LOW_VOLATILITY | 6.5% (loosest) |

### Breaker 5: Cross-Validation

Compares two independent oracles observing the market through different lenses:

- **True Price Oracle**: Bayesian, forward-looking (what should price be?)
- **Volatility Oracle**: Frequentist, backward-looking (how much has price moved?)

When they **disagree**, the disagreement itself is information:

```
                     Volatility Oracle
                     LOW/MED     HIGH/EXTREME
True Price  DANGER   STEALTH     CONFIRMED
Oracle      NORMAL   CALM        ORGANIC
```

**Stealth Manipulation** (DANGER + LOW vol): Most dangerous. Price is manipulated through small trades that individually look normal. TWAP drifts. Vol stays low. But the Kalman filter detects systematic bias. Response: bounds tighten 30%, +50% fee surcharge.

**Confirmed Danger** (DANGER + HIGH vol): Both oracles agree on distress. Response: bounds tighten 15%.

**Organic Volatility** (NORMAL + HIGH vol): Genuine market event, no manipulation. Response: bounds **widen** 15%. This is the false positive reduction case — without cross-validation, high volatility would trigger aggressive damping on honest traders.

**Calm Markets** (NORMAL + LOW vol): No adjustment needed.

---

## Fee Surcharges: Punishment, Not Pauses

Binary pauses are blunt — protocol is either running or stopped. Fee surcharges provide graduated response that scales with threat severity.

Three independent sources compound:

**Regime-Based:** NORMAL +0%, HIGH_LEVERAGE +50%, MANIPULATION +100%, CASCADE +200%.

**Manipulation Probability:** >80% adds +200% of base fee, >50% adds +100%.

**Cross-Validation (stealth only):** +50% of base fee when danger regime + low volatility detected.

Worst case (CASCADE + >80% manipulation + stealth): 27.5 bps total, well under the 500 bps hard cap. A 5.5x multiplier on base fees.

### The Virtuous Cycle

Surplus fees route to the insurance pool:

1. Attacker trades during adverse conditions
2. Surcharges accumulate
3. Surplus flows to insurance
4. Insurance compensates LPs for impermanent loss
5. **The attacker funds the defense of the system they attack**

---

## Five-Level Graduated Response

```
Level 0: Normal — base fees, full bounds
Level 1: Fee Surcharge — trading continues, extractive behavior costs more
Level 2: Golden Ratio Damping — clearing price pulled toward True Price via phi
Level 3: Tightened Bounds — cross-validation narrows the corridor
Level 4: Breaker Trip — hard stop, cooldown enforced
Level 5: Global Pause — guardian emergency only, last resort
```

**The design goal: almost never reach Level 4.** Surcharges make attacks unprofitable at Level 1. Damping limits effectiveness at Level 2. Tightened bounds catch sophistication at Level 3. By Level 4, the attack has already been economically neutralized.

---

## Attack Scenarios

**Flash Loan Oracle Manipulation:** 100M USDC borrowed, price spiked. Caught first by flash loan protection (same-block interaction blocked). Attack stops before reaching breakers. Even without that: volume breaker ($10M), price breaker (5% TWAP), True Price breaker (CASCADE regime).

**Slow Oracle Manipulation (Multi-Block):** Many small trades over 30 minutes, each under TWAP deviation. TWAP drifts with manipulation. Volume breaker may not trigger. **This is what TWAP alone misses.** Kalman filter detects systematic bias — MANIPULATION regime flagged. Fee surcharges activate. If realized volatility stays low, cross-validation detects stealth manipulation. Bounds collapse to 49% of base. Margin erodes to zero.

**Liquidation Cascade:** Not an attack — automated liquidations cascading. Fee surcharges slow it by making each subsequent liquidation more expensive. Golden ratio damping reduces each price impact. Cascade dissipates before hard stops. System absorbs the shock.

**Bank Run:** Withdrawal breaker trips at 25% TVL outflow/hour. 2-hour cooldown gives time to communicate and address concerns.

---

## CKB Substrate Analysis

### Type Script Composition for Security

On Ethereum, circuit breaker logic lives inside the trading contract. A bug in one affects the other. On CKB, the breaker could be a **separate type script** composing with the trading type script:

```
Pool Cell:
  Lock Script:  standard or PoW lock
  Type Script:  trading-logic + circuit-breaker-type (composable)
  Data:         reserves, TWAP buffer, breaker state
```

Upgrading breaker logic does not require touching trading logic. Separation of concerns is structural on CKB, not emulated.

### Oracle as Cell State

Oracle updates as independent cells consumed by settlement:

```
Oracle Cell:
  Lock Script:  authorized-signer-lock
  Type Script:  oracle-type
  Data:         price, confidence, regime, manipulation_prob, timestamp
```

The trading type script reads oracle as cell dep (no consumption for reads). Staleness enforced by timestamp comparison against header dep. If oracle is stale, type script falls back to TWAP-only. Cleaner than Ethereum's `try/catch` — oracle availability is a verifiable cell property.

### Graceful Degradation Is Natural

On Ethereum, graceful degradation requires `try/catch`. On CKB, it is structural: if the oracle cell does not exist (oracle down), the cross-validator type script simply does not run (no cell dep to validate against). Remaining validators continue independently. Missing inputs mean missing validation — degradation is implicit in the cell model.

---

## Comparison

| Feature | VibeSwap | Uniswap v3 | Aave v3 | Chainlink Breaker |
|---|---|---|---|---|
| Autonomous detection | 5 types | No | Partial | 1 type |
| Multi-dimensional | 5 dimensions | No | No | No |
| Fee surcharge | Regime-based | No | No | No |
| Cross-validation | 2 oracles | No | No | No |
| Graduated response | 5 levels | No | Partial | Binary |
| Kalman filter | Yes | No | No | No |

---

## Discussion

Questions for the community:

1. **Type script composition for security layers.** Has anyone deployed composable type scripts where multiple independent validators must all succeed? What are the practical challenges?

2. **Oracle cells as cell deps.** Reading without consumption is efficient but means the oracle cell is never "used up." How does this interact with CKB's state rent model? Should oracle cells have explicit expiry?

3. **Could a simplified Kalman filter run in CKB-VM?** Recursive least squares via fixed-point arithmetic. Has anyone benchmarked numerically intensive computation in CKB-VM?

4. **Should surcharge routing go to NervosDAO, protocol insurance, or affected LPs?** What is the most natural flow on CKB?

5. **Using disagreement between independent oracles as signal.** This principle generalizes beyond price. Any system with two independent information sources can extract value from divergence. What CKB applications could benefit?

6. **Should the Nervos community develop a shared circuit breaker type script as a public good?** A composable safety primitive for any CKB DeFi application?

Full paper: `docs/papers/autonomous-circuit-breakers.md`

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*

*Full paper: [autonomous-circuit-breakers.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/autonomous-circuit-breakers.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
