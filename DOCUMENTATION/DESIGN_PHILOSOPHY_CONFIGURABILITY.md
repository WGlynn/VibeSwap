# VibeSwap Design Philosophy: Configurability vs Uniformity

**Why We Considered and Then Rejected Per-Pool Safety Parameters**

Version 1.0 | February 2026

---

## Executive Summary

During the development of VibeSwap's compliance features, we initially implemented per-pool configurable safety parameters (collateral, slashing, timing). After careful analysis, we reversed this decision and made safety parameters protocol-level constants while keeping only access control as pool-configurable.

This document explains the reasoning behind this decision and discusses potential future approaches.

---

## 1. What We Initially Built

We created a flexible pool configuration system where each pool could have:

**Configurable Safety Parameters (REMOVED)**:
- Collateral requirements (1% to 10%)
- Slash rates (20% to 50%)
- Flash loan protection (on/off)
- Batch timing (commit/reveal durations)

**Access Control Parameters (KEPT)**:
- Minimum user tier required
- KYC/accreditation requirements
- Blocked jurisdictions
- Maximum trade sizes

---

## 2. Why This Defeated the Purpose

### 2.1 The Core Value Proposition

VibeSwap's primary innovation is **uniform, cooperative price discovery**:
- All participants submit hidden orders
- All orders execute at the same clearing price
- Random ordering prevents front-running

This only works if everyone plays by the same rules.

### 2.2 How Configurability Breaks It

**Race to the Bottom**:
If pools can have different collateral requirements:
- Pool A: 10% collateral, 50% slash
- Pool B: 1% collateral, 20% slash

Traders will choose Pool B. Pool creators will compete to offer "easier" terms. The commitment mechanism becomes meaningless.

**Fragmented Liquidity**:
Instead of one deep, fair market:
- Many shallow pools with different rules
- Price divergence between pools
- Arbitrage opportunities that benefit sophisticated actors

**Weakened Commitments**:
The commit-reveal mechanism only works because:
1. Revealing is mandatory (slash penalty)
2. Front-running is impossible (hidden orders)
3. Everyone faces the same incentives

Configurable penalties dilute this. A pool with 10% slash is less secure than one with 50%.

**Gaming Opportunities**:
Sophisticated actors could:
- Create pools with parameters that subtly benefit them
- Use low-collateral pools for risky strategies
- Exploit timing differences across pools

---

## 3. The Correct Design

### 3.1 Protocol Constants (Uniform Fairness)

These parameters are now **fixed for all pools** in CommitRevealAuction:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `COMMIT_DURATION` | 8 seconds | Standard time to submit |
| `REVEAL_DURATION` | 2 seconds | Standard time to reveal |
| `COLLATERAL_BPS` | 500 (5%) | Uniform skin-in-the-game |
| `SLASH_RATE_BPS` | 5000 (50%) | Strong deterrent for all |
| `MIN_DEPOSIT` | 0.001 ETH | Baseline commitment |
| Flash loan protection | Always on | Cannot be disabled in commit-reveal |

**Note on VibeAMM:** The AMM contract has additional protection mechanisms (flash loan detection, TWAP validation) that are **enabled by default** but have admin emergency toggles. These exist for incident response scenarios (e.g., if a protection mechanism causes unexpected issues). The commit-reveal auction's constants have no such toggles—they are truly immutable.

### 3.2 Pool Access Control (Regulatory Flexibility)

These parameters **can vary by pool**:

| Parameter | Purpose |
|-----------|---------|
| `minTierRequired` | Who can trade (open, retail, accredited, institutional) |
| `kycRequired` | Whether KYC verification is needed |
| `accreditationRequired` | Whether accredited investor status is needed |
| `maxTradeSize` | Regulatory limits on trade sizes |
| `blockedJurisdictions` | Geographic restrictions |

### 3.3 Why This Works

Pools differ in **who can access them**, not **how trading works**:
- An OPEN pool and an INSTITUTIONAL pool use the same execution rules
- The only difference is who's allowed to trade
- Everyone in the system faces identical incentives

### 3.4 Flash Loan Protection Explained

**What is a flash loan?**

Flash loans allow borrowing millions in assets with zero collateral, provided you return them within the same blockchain transaction. If you don't return the funds, the entire transaction reverts as if it never happened.

**The attack vector without protection:**
```
Block N, Single Transaction:
1. Flash loan 10,000 ETH (no collateral needed)
2. Commit order with borrowed ETH as deposit
3. Manipulate prices, priority, or other mechanisms
4. Return the flash loan
5. Result: Attacker never had real funds at risk
```

The deposit requirement is meaningless if attackers can use borrowed funds they never actually owned.

**How protection works:**
```solidity
if (lastInteractionBlock[msg.sender] == block.number) {
    revert FlashLoanDetected();
}
lastInteractionBlock[msg.sender] = block.number;
```

If you interact in block N, you cannot interact again until block N+1. Since flash loans must complete within a single block, this breaks the attack entirely.

**Why "always on" (not per-pool)?**

We initially considered making flash loan protection per-pool configurable, with the reasoning that "trusted" institutional pools might be exempt. We rejected this because:

1. **Flash loans don't respect trust**: An attacker can use any pool
2. **Sophisticated actors benefit most**: Institutions are MORE likely to have flash loan infrastructure
3. **No legitimate use case**: There's no valid reason to commit twice in the same block
4. **Minimal user impact**: ~12-second block times mean legitimate users are unaffected

**What it prevents:**
- Depositing with borrowed funds (fake skin-in-the-game)
- Rapid commit manipulation within one block
- Oracle manipulation combined with trading
- Any attack requiring large temporary capital

### 3.5 Why Flash Loan Sybil Attacks Fail

**The coordinated sybil attack:**
```
1. Flash loan 10,000 ETH
2. Distribute to 100 different addresses in same tx
3. Each address commits (different msg.sender, bypasses per-address check)
4. Return flash loan
5. Result: 100 fake commitments with borrowed funds?
```

**Why this fails - collateral lock breaks flash loans:**

Flash loans must be **fully repaid in the same transaction**. Collateral locked in commits cannot be returned.

```
Flash loan 10,000 ETH
├── Send 100 ETH to address A → A commits 5 ETH collateral (LOCKED)
├── Send 100 ETH to address B → B commits 5 ETH collateral (LOCKED)
├── ... (100 addresses = 500 ETH locked as collateral)
└── Repay 10,000 ETH... but only 9,500 ETH available
    └── TRANSACTION REVERTS - flash loan fails entirely
```

The collateral is held by the contract until reveal/settlement. It cannot be used to repay the flash loan. The entire transaction reverts, and no commits happen.

**Considered additional protections:**

| Option | What it prevents | Tradeoff |
|--------|------------------|----------|
| EOA-only commits | Contract-based sybils | Breaks smart wallet users, account abstraction |
| Deposit-then-commit | Same-block funding | Worse UX, requires two transactions |
| Higher collateral | Raises attack cost | Higher barriers to legitimate entry |
| tx.origin tracking | Same-tx sybil coordination | Security anti-pattern, phishing risks |

**Conclusion**: Additional protections are not worth the tradeoffs. The collateral lock mechanism itself defeats flash loan attacks - no borrowed funds can remain locked because they must be returned in the same transaction.

### 3.6 Sybil Attacks on Price Action

**The remaining concern**: What if an attacker uses REAL capital across multiple addresses to manipulate price discovery?

This is a legitimate concern, but multiple protocol mechanisms provide defense in depth:

**1. Uniform Clearing Price**

All orders in a batch execute at the same price. A sybil attacker controlling multiple addresses still gets the same price as everyone else. They cannot front-run their own orders or get preferential execution.

**2. Random Ordering (Fisher-Yates Shuffle)**

Order execution sequence is determined by a deterministic shuffle using XORed secrets. Controlling multiple addresses doesn't help predict or influence position in the execution order.

**3. TWAP Oracle Validation**

The protocol validates execution prices against Time-Weighted Average Price (TWAP) oracles:
- Maximum 5% deviation from TWAP allowed
- Prevents single-batch price manipulation
- Sybil orders that would move price beyond bounds are rejected

**4. Collateral Requirements (Uniform)**

Every address must lock 5% collateral. A sybil attack with 100 addresses trading 100 ETH each requires 500 ETH locked capital. This is real money at risk, not borrowed funds.

**5. Slashing (Uniform)**

Invalid reveals lose 50% of collateral. A sybil attacker who doesn't reveal faces massive losses across all addresses. The penalty scales linearly with the attack size.

**6. Rate Limiting**

Per-user volume limits (1M tokens/hour) apply per address. Sybil addresses each have their own limits, but:
- More addresses = more collateral required
- Diminishing returns on coordination complexity

**7. Circuit Breakers**

Abnormal volume or price movements trigger automatic halts:
- Volume circuit breaker
- Price deviation circuit breaker
- Withdrawal rate limiter

A coordinated sybil attack large enough to move markets would likely trigger circuit breakers.

**Why sybil attacks on price are economically irrational:**

| Attack Cost | Attack Benefit |
|-------------|----------------|
| Real capital locked (5% per address) | Same price as everyone (uniform clearing) |
| Slashing risk on all addresses | Random execution order (no priority) |
| Coordination complexity | TWAP bounds limit price movement |
| Circuit breaker risk | Rate limits cap per-address volume |

The attacker pays real costs but gains no execution advantage. The uniform clearing price means they can't profit from their own manipulation - they trade at the same price they're manipulating.

**The fundamental insight:**

Sybil attacks are a concern when different identities get different treatment. In VibeSwap:
- Same price for all (uniform clearing)
- Same rules for all (protocol constants)
- Same penalties for all (uniform slashing)
- Same randomization for all (deterministic shuffle)

Multiple addresses don't provide meaningful advantage when everyone is treated identically.

---

## 4. Counter-Arguments Considered

### 4.1 "Institutions Need Lower Collateral"

**Argument**: Large, trusted institutions shouldn't need the same collateral as anonymous traders.

**Response**: The collateral isn't about trust—it's about game theory. Even trusted actors could game the system if penalties are lower. Uniform collateral ensures uniform incentives.

**Alternative**: If institutions truly need lower costs, they can:
- Use higher trade volumes to amortize the fixed deposit
- Bundle multiple trades into single commits
- The 5% collateral on a large trade is still proportional

### 4.2 "Different Markets Have Different Needs"

**Argument**: Fast markets might need shorter commit phases; illiquid markets might need longer ones.

**Response**: Variable timing creates complexity and potential exploits:
- Traders might shop for optimal timing
- Arbitrage opportunities between pools with different phases
- Coordination problems for cross-pool trading

**Alternative**: If timing truly needs adjustment, it should be a protocol-wide upgrade, not per-pool.

### 4.3 "Regulatory Flexibility"

**Argument**: Different jurisdictions might require different slashing penalties.

**Response**: Pool ACCESS can be restricted by jurisdiction without changing the penalty structure. A pool can block certain jurisdictions entirely rather than having different rules for them.

---

## 5. Potential Future Approaches

If future requirements necessitate parameter flexibility, consider these approaches that preserve game-theoretic integrity:

### 5.1 Tiered Protocol Constants (Not Pool-Level)

Instead of per-pool configuration, define **protocol tiers**:

```
Tier STANDARD:  5% collateral, 50% slash, 8s/2s timing
Tier ENHANCED:  10% collateral, 70% slash, 12s/3s timing
```

All pools use one of these predefined tiers. No custom parameters.

### 5.2 Governance-Controlled Constants

Make constants adjustable through governance with:
- Long timelock (30 days)
- Supermajority requirements
- No retroactive changes (affects new batches only)

Changes apply **protocol-wide**, not per-pool.

### 5.3 Minimum Bounds, Not Free Choice

If pools need flexibility, set strict minimums:

```
collateralBps >= 500  (5% minimum, can only go higher)
slashRateBps >= 5000  (50% minimum, can only go higher)
```

Pools can be MORE strict, never LESS strict.

### 5.4 Parameter Derivation

Instead of free configuration, derive parameters from verifiable properties:

```solidity
// Collateral based on pool liquidity depth
collateralBps = MAX(500, 10000 * minTradeSize / poolLiquidity)
```

Parameters are calculated, not configured.

---

## 6. Lessons Learned

### 6.1 Flexibility vs Integrity Trade-off

More configuration options = more attack surface. Every configurable parameter is a potential exploit vector.

### 6.2 Uniformity is a Feature

The same rules for everyone isn't a limitation—it's the core value proposition. "Fair" means "same treatment for all."

### 6.3 Access Control ≠ Execution Rules

Regulatory compliance can be achieved by controlling WHO trades, not by changing HOW trading works.

### 6.4 Simple > Configurable

A simple, uniform system is:
- Easier to audit
- Harder to exploit
- Easier to explain to regulators
- More trustworthy to users

---

## 7. Conclusion

The commit-reveal batch auction mechanism provides MEV protection and fair price discovery BECAUSE it has uniform rules. Configurability in safety parameters would undermine this core value proposition.

The current design provides:
- **Regulatory flexibility** through access control
- **Uniform fairness** through protocol constants
- **Trustlessness** through immutable pool rules

This is the right balance.

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | February 2026 | Initial document explaining design decision |
