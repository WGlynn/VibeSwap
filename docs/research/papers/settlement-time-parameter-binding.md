# Settlement-Time Parameter Binding: Eliminating DeFi's TOCTOU Vulnerability

*Will Glynn, 2026*

## Abstract

We identify a pervasive vulnerability class in decentralized finance protocols: parameters that determine economic outcomes are bound at creation time rather than settlement time, creating a manipulation window analogous to the classic TOCTOU (time-of-check to time-of-use) race condition. We formalize this as **settlement-time parameter binding**, demonstrate its occurrence across multiple contract types in a production DeFi protocol (VibeSwap), and propose architectural mitigations. Our analysis draws from 53 rounds of adversarial review that independently discovered this pattern in three separate contracts.

## 1. Introduction

In traditional computer security, TOCTOU (time-of-check to time-of-use) describes a race condition where the state checked by a security validation changes before the operation that depends on it executes. The canonical example: checking file permissions, then opening the file — an attacker changes permissions between the check and the open.

DeFi protocols face an analogous vulnerability that has not been formally identified in the literature. When a protocol creates an economic game (auction, reward distribution, liquidity pool), it binds parameters that determine how value flows. If these parameters are mutable between creation and settlement, any actor who can modify them gains an asymmetric advantage.

We call this **settlement-time parameter binding** and argue it represents a fundamental design constraint for any protocol with delayed settlement.

## 2. The Vulnerability

### 2.1 Formal Definition

Let $G$ be a game created at time $t_0$ with parameters $P = \{p_1, p_2, ..., p_n\}$. Let $t_s > t_0$ be the settlement time. If any $p_i$ is mutable in the interval $(t_0, t_s)$ and affects the distribution of value at $t_s$, then there exists a **creation-time binding vulnerability**.

The manipulation window $W = t_s - t_0$ determines the exposure. The severity depends on:
- **Who** can modify $p_i$ during $W$ (admin, participant, external actor)
- **What** $p_i$ controls (fee rate, weight multiplier, halving schedule, price oracle)
- **How much** value is at stake in $G$

### 2.2 Why This Matters in DeFi

Traditional TOCTOU exploits require nanosecond-scale race conditions. DeFi's TOCTOU operates on block-scale timing (seconds to hours), making it systematically exploitable:

1. **Batch auctions**: Parameters set at batch creation persist through the batch window (seconds)
2. **Reward distributions**: Weight multipliers set at game creation persist until settlement (hours to days)
3. **Governance proposals**: Voting parameters set at proposal creation persist until execution (days to weeks)

The longer the settlement window, the larger the manipulation surface.

## 3. Empirical Evidence

### 3.1 Discovery Context

During 53 rounds of the Trinity Recursion Protocol (TRP) — an adversarial self-improvement framework — we independently discovered settlement-time binding vulnerabilities in three separate contracts within the VibeSwap protocol.

### 3.2 Case 1: Halving Schedule (ShapleyDistributor)

**Finding**: TRP R24 (N06), MEDIUM severity.

The ShapleyDistributor applies a halving decay to reward weights based on the elapsed time since the halving epoch. This halving was computed at **game creation time**, not settlement time.

**Attack vector**: A game creator times game creation to straddle an era boundary. Participants who committed before the boundary receive halved rewards, while the creator (who controls creation timing) can optimize their position.

**Fix**: Move halving computation from `createGame()` to `settleGame()`. The halving schedule now reflects the state at the moment rewards are actually distributed.

```solidity
// Before (creation-time binding — vulnerable)
function createGame(...) {
    game.halvingMultiplier = _computeHalving(block.timestamp);
}

// After (settlement-time binding — fixed)
function settleGame(uint256 gameId) {
    uint256 halvingMultiplier = _computeHalving(block.timestamp);
    // Apply at distribution time
}
```

### 3.3 Case 2: Quality Weights (ShapleyDistributor)

**Finding**: TRP R24 (N03), HIGH severity.

Game creators set quality weight scores for participants. These scores were mutable after game creation but before settlement, allowing the creator to front-run the settlement transaction by adjusting weights in their favor.

**Attack vector**: Creator observes settlement transaction in the mempool, submits a weight update with higher gas to execute first, then benefits from the modified distribution.

**Fix**: Snapshot quality weights at game creation. Any modifications after creation are applied only to future games.

### 3.4 Case 3: Collateral Pricing (CommitRevealAuction)

**Finding**: TRP R38, MEDIUM severity.

The commit-reveal auction prices collateral requirements based on parameters set at auction creation. Between creation and reveal, market conditions could shift, making the collateral insufficient to deter manipulation.

**Fix**: Validate collateral at reveal time with a 2x tolerance factor, ensuring the economic deterrent remains effective regardless of price movement during the commitment window.

## 4. Taxonomy of Binding Strategies

We identify four strategies for parameter binding in delayed-settlement protocols:

### 4.1 Creation-Time Binding (Vulnerable)

Parameter is set at $t_0$ and never updated. Simple but exploitable if the parameter is observable and the game creator has timing control.

**When acceptable**: Immutable protocol constants (e.g., maximum supply cap).

### 4.2 Settlement-Time Binding (Preferred)

Parameter is read at $t_s$ from current state. The latest value applies uniformly to all participants.

**When acceptable**: Parameters that should reflect the current state of the world (oracle prices, fee rates, halving schedules).

**Risk**: If the parameter is manipulable at $t_s$ itself (e.g., via flash loan), settlement-time binding shifts the vulnerability from TOCTOU to flash-loan manipulation. Combine with TWAP or multi-block averaging.

### 4.3 Commitment-Time Binding (Snapshot)

Parameter is snapshotted at the moment each participant commits. Each participant's parameters are frozen at their commitment time.

**When acceptable**: Parameters that determine individual contribution weight (quality scores, conviction metrics). Prevents post-commitment manipulation.

**Risk**: Different participants see different parameter values (no uniform treatment). Acceptable for per-participant metrics, unacceptable for global settlement parameters.

### 4.4 Governance-Locked Binding

Parameter is set via governance with a timelock. Cannot be changed faster than the governance delay allows.

**When acceptable**: System-wide configuration (fee rates, circuit breaker thresholds). The governance delay must exceed the maximum settlement window.

## 5. Design Principles

From the empirical evidence and taxonomy, we derive three design principles:

### Principle 1: Bind at the Latest Defensible Moment

Read parameters as close to the moment of value distribution as possible. The "defensible" qualifier means: the parameter must not itself be manipulable at that moment (e.g., via flash loans). Use TWAP or multi-block averaging when reading at settlement time.

### Principle 2: Separate Mutable from Economic

If a parameter is mutable by any actor, it must not affect value distribution for games already in progress. Mutations apply only to future games. This is the "snapshot at commitment" pattern.

### Principle 3: Bound the Window

The manipulation window $W = t_s - t_0$ is the attack surface. Minimize $W$ by design. VibeSwap's 10-second batch window (8s commit + 2s reveal) limits the maximum TOCTOU exposure to 10 seconds — orders of magnitude less than governance proposals or vesting schedules.

## 6. Related Work

Settlement-time binding relates to several known DeFi vulnerability classes:

- **Oracle manipulation** (Euler Finance, Mango Markets): Price oracles read at a manipulable moment. Settlement-time binding generalizes this beyond oracles to any economic parameter.
- **Governance attacks** (Beanstalk): Flash-loaned governance tokens modify parameters before execution. This is creation-time binding of governance weights.
- **Sandwich attacks**: Technically a different primitive (ordering manipulation), but share the temporal exploitation pattern. Uniform clearing price eliminates this vector.

The formal TOCTOU literature in systems security (Bishop & Dilger 1996, Cai et al. 2009) provides the theoretical foundation. Our contribution is demonstrating that this class of vulnerability is endemic in DeFi, not merely analogous.

## 7. Conclusion

Settlement-time parameter binding is a pervasive and underrecognized vulnerability class in DeFi protocols. Any system with delayed settlement and mutable parameters is potentially affected. Our empirical discovery of this pattern across three independent contracts during 53 rounds of adversarial review suggests it is structural — arising from the architecture of delayed-settlement systems — rather than incidental.

The fix is straightforward: bind economic parameters at the latest defensible moment, snapshot per-participant metrics at commitment time, and minimize the settlement window. These principles compose naturally with other DeFi security primitives (rate-of-change guards, collateral path independence, batch invariant verification) to form a comprehensive defense architecture.

---

## References

1. Bishop, M., & Dilger, M. (1996). "Checking for Race Conditions in File Accesses." *Computing Systems*, 9(2).
2. Cai, X., et al. (2009). "Exploiting Unix File-System Races via Algorithmic Complexity Attacks." *IEEE S&P*.
3. Daian, P., et al. (2020). "Flash Boys 2.0: Frontrunning in Decentralized Exchanges." *IEEE S&P*.
4. Qin, K., et al. (2022). "Quantifying Blockchain Extractable Value: How dark is the forest?" *IEEE S&P*.
5. Glynn, W. (2026). "TRP Pattern Taxonomy — 53 Rounds of Adversarial Review." VibeSwap Technical Report.
6. Glynn, W. (2026). "From MEV to GEV: An Architecture for Generalized Extractable Value Resistance." VibeSwap Technical Report.

---

*Built in a cave, with a box of scraps.*
