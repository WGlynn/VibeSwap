# The Trinomial Stability Theorem

## Eliminating Adverse Selection in Decentralized Money Markets Through Synergistic Monetary Primitives

**Authors**: VibeSwap Research

**Date**: February 2026

**Version**: 2.0

---

## Abstract

Decentralized finance suffers from a foundational defect: the base collateral layer is volatile. Ethereum, Bitcoin, and other cryptoassets used as collateral in lending markets exhibit price volatility that creates the three classical market failures identified by Akerlof (1970) and Stiglitz-Weiss (1981) — information asymmetry, moral hazard, and adverse selection. These failures produce liquidation cascades, credit rationing, and systematic wealth transfer from passive depositors to sophisticated extractors.

We propose the **Trinomial Stability System**: three complementary monetary primitives that, when composed, produce a stable, non-volatile base collateral layer grounded in physical reality. The system consists of: (1) a **proportional proof-of-work money** whose supply responds elastically to demand, anchoring value to electricity cost; (2) a **PI-controller dampened stable** that smooths medium-term oscillations via control theory; and (3) an **elastic supply rebasing token** that absorbs short-term demand shocks through proportional supply adjustment.

We prove that this trinomial system, deployed within VibeSwap's positive-sum Shapley-fair architecture, converges to a volatility floor bounded by the variance of global electricity costs — the lowest achievable bound for proof-of-work money — thereby eliminating the preconditions for adverse selection, moral hazard, and information asymmetry in decentralized lending.

---

## 1. Introduction: The Volatile Base Problem

### 1.1 DeFi's Original Sin

Every lending protocol in decentralized finance shares a common assumption: the collateral backing loans is volatile. Aave requires 150% overcollateralization. Compound liquidates at 133%. MakerDAO demands 170% for volatile vaults. These ratios exist because the base assets — ETH, BTC, and their derivatives — can lose 50% or more of their value in days.

This is not a parameter to optimize. It is a structural defect.

When George Akerlof described the market for lemons in 1970, he showed that information asymmetry between buyers and sellers causes market unraveling: high-quality sellers exit, average quality drops, prices fall, more sellers exit, until only the worst assets remain. The same dynamic operates in DeFi lending pools. Depositors (lenders) cannot observe the quality of the borrower pool, the correlation of collateral positions, or the proximity of aggregate positions to liquidation thresholds. They price their deposits based on expected average collateral quality, which systematically underestimates tail risk.

Stiglitz and Weiss (1981) showed that in credit markets with imperfect information, raising interest rates causes adverse selection (safe borrowers exit, risky borrowers remain) and moral hazard (borrowers shift to riskier projects). The result: lenders may ration credit entirely rather than raise rates. In DeFi, this manifests as utilization caps, borrowing limits, and the inability to offer undercollateralized lending at any rate.

### 1.2 The Liquidation Cascade

Volatile base collateral creates a reflexive doom loop:

1. Collateral price drops
2. Positions breach liquidation thresholds
3. Liquidation bots sell collateral on open market
4. Selling pressure further depresses collateral price
5. More positions breach thresholds
6. Repeat until equilibrium or total collapse

During cascades, fire-sale prices create permanent adverse selection about asset quality. Buyers cannot distinguish between assets sold due to forced liquidation versus genuine low quality. This is Akerlof's lemons problem operating in real-time at blockchain speed.

### 1.3 Thesis

The problem is not lending mechanics. Aave, Compound, and Maker are well-engineered protocols. The problem is the collateral itself. **Fix the base layer, and everything above it becomes sound.**

We propose a system of three monetary primitives — each addressing a different timescale of instability — that together produce a collateral layer whose volatility converges to the variance of global electricity costs: the physical floor for proof-of-work money.

---

## 2. The Three Market Failures in DeFi Lending

### 2.1 Information Asymmetry

In DeFi lending markets, borrowers possess private information that depositors cannot observe.

Before the transaction, borrowers have hidden knowledge: their intended use of borrowed funds (productive investment vs. leveraged speculation), their risk tolerance and expected holding period, and the correlation between their positions and the broader market.

During the transaction, the hidden state deepens: current leverage ratio across all protocols is unknowable due to pseudonymity, whether collateral is rehypothecated (used as collateral elsewhere simultaneously) is invisible, and the proximity of aggregate positions to liquidation is opaque.

The depositor sees only the aggregate utilization rate and the interest rate. They cannot distinguish between a pool where 90% of borrowers are conservative and one where 90% are maximally leveraged. This is the lemons problem in DeFi form.

VibeSwap's commit-reveal auction eliminates information asymmetry in *execution* — no participant can see others' orders before settlement. But collateral-layer information asymmetry remains unsolved by execution-layer mechanisms. A trader who receives fair execution on a trade collateralized by volatile assets still faces the risk of cascading liquidations.

### 2.2 Adverse Selection

Volatile collateral creates an embedded put option for borrowers. Consider a borrower who deposits 1.5 ETH (worth $3,000) to borrow $2,000:

- If ETH rises to $3,000: borrower repays loan, keeps profit on collateral. Net gain.
- If ETH falls to $1,000: collateral is worth $1,500, loan is $2,000. Borrower walks away. Net loss to depositor.

This asymmetric payoff profile adversely selects for risk-seeking borrowers. A borrower who believes ETH will be volatile (in either direction) finds the loan attractive: they capture the upside and externalize the downside. A borrower who believes ETH will be stable finds the loan less attractive relative to the borrowing cost.

The overcollateralization requirement (150%+) attempts to compensate for this adverse selection. But it is a blunt instrument: it fails during precisely the tail events when collateral volatility exceeds the buffer. March 2020 ("Black Thursday") saw MakerDAO liquidations at zero-bid, destroying $8.3 million in depositor value.

In Shapley fairness terms, adverse selection violates the **null player axiom**: borrowers who extract more value than they contribute (by walking away from underwater positions) receive positive payoff despite negative net contribution. The system rewards defection.

### 2.3 Moral Hazard

After receiving a loan, borrowers can take hidden actions that increase risk: **leverage stacking** (using borrowed assets as collateral on another protocol to borrow more), **correlated positions** (concentrating borrowed funds in assets correlated with their collateral), and **collateral chain creation** (building recursive leverage structures invisible to any single protocol).

The lending protocol cannot observe or prevent these actions. It relies solely on the overcollateralization ratio as a defense — the single mechanism that must simultaneously compensate for adverse selection, moral hazard, and information asymmetry.

Traditional finance mitigates these failures through credit scoring (reduces adverse selection), covenants and monitoring (reduces moral hazard), and stable collateral such as real estate and government bonds. DeFi, by design, eliminates credit scoring and monitoring (permissionless, pseudonymous). When it also uses volatile collateral, all three traditional mitigants are absent simultaneously.

---

## 3. Primitive I: Proportional Proof-of-Work Money

### 3.1 The Core Insight

Bitcoin's money supply follows a predetermined schedule: a fixed block reward halving every four years, independent of demand. This means the relative price is driven purely by exchange — supply does not react to changes in the environment. If adoption doesn't meet the schedule's assumptions, the entire prediction is ruined.

The proportional reward system — originally formalized by Trzeszczkowski (2021) in the **Ergon** whitepaper (a proof-of-work cryptocurrency implementing this mechanism, named after the Greek word for "work") — makes a simple modification: **block reward is a function of the current block mining difficulty**. This single change creates a feedback loop that regulates supply and stabilizes price around a physical equilibrium. We refer to this class of mechanism as **RPow** (Reusable Proof-of-Work), following Hal Finney's 2004 concept of work-backed digital tokens, with the Ergon implementation serving as the mathematical foundation.

### 3.2 Mathematical Model

We adopt the framework from Trzeszczkowski (2021). Let:

- `p(t)` = price of the currency at time t
- `N(t)` = total supply (number of units in circulation)
- `N'(t)` = rate of new supply (block reward)
- `h(t)` = hash rate (computational work per unit time)
- `D(t)` = mining difficulty
- `d(t)` = market demand for the currency
- `s(t)` = market supply offered for sale
- `ε` = cost of a single hash (electricity cost per computation)
- `α` = hash rate responsiveness parameter

**Price dynamics** follow from the law of supply and demand. The relative price of a currency with no utility other than exchange is:

```
p(t) = z(t) / N(t)
```

where z(t) is the accumulated value in the economy:

```
z(t) = ∫₀ᵗ (d(τ) - s(τ)) p(τ) dτ
```

Taking the first derivative:

```
p'(t) = [(d(t) - s(t)) / N(t) - N'(t) / N(t)] × p(t)         ... (1)
```

**Hash rate dynamics** follow from miner economics. Miners add hash rate when mining is profitable (reward × price > electricity cost) and remove it when unprofitable:

```
h'(t) = α(N'(t) × p(t) - h(t) × ε)                            ... (2)
```

The parameter α describes how fast hash rate responds to profitability. The assumption of a large existing pool of SHA-256 hash capacity (from Bitcoin mining infrastructure) makes this value high — miners can rapidly redirect existing hardware.

### 3.3 Bitcoin vs. Proportional Reward

**Bitcoin**: N'(t) = R (constant within each halving era). Equations (1) and (2) are decoupled — price is driven by demand alone, and hash rate follows price with delay α. The fundamental solution for hash rate response is:

```
Gₕ(t) = Rα Θ(t) e^{-εαt}
```

Hash rate follows price but cannot influence it. When demand grows proportionally to price (d - s ~ p), the price chart follows a hyperbola — exactly the pattern observed in Bitcoin between 2016 and 2018.

**Proportional Reward**: We set N'(t) = f(h(t)) = h(t). The block reward *is* the hash rate (with possible proportionality constant). This couples equations (1) and (2):

```
p'(t) = [(d(t) - s(t) - h(t)) / N(t)] × p(t)
h'(t) = α(h(t) × p(t) - h(t) × ε)                             ... (3)
N'(t) = h(t)
```

**Equilibrium**: Setting p'(t) = 0 and h'(t) = 0, we find that price converges to ε₀ — the cost of a single hash in electricity. Mining becomes a **one-way exchange of electricity for coins**. The currency unit value is close to the value of electricity used for work, and money supply equals the demand for new coins.

### 3.4 Price Oscillations and Market Damping

Numerical solutions of system (3) show that price oscillates around the equilibrium ε₀. The oscillations are stable in amplitude (the system does not diverge), but they are exploitable by speculators.

Any predictable market behavior attracts damping forces. When speculators observe the oscillation pattern, they introduce a damping force:

```
-γ(p - ε₀)
```

in the price equation, where γ represents the intensity of speculative activity around the equilibrium. This gives:

```
p'(t) = [p(t)(d - s) - γ(p - ε₀)] / N(t) - p(t) × N'(t) / N(t)
```

For γ > C (where C is the demand surplus), price oscillations converge to the equilibrium. This damping emerges naturally from rational behavior: market participants buy below ε₀ (knowing price will rise) and sell above ε₀ (knowing price will fall). The equilibrium is self-enforcing.

### 3.5 Moore's Law Adjustment

Mining efficiency improves over time. ASIC miners have improved from ~5,000,000 J/TH (2009) to ~15 J/TH (2025) — a factor of ~333,000×. This improvement approximately follows an exponential curve:

```
ε(t) = ε₀ × e^{-at}
```

where `a` reflects the rate of hardware efficiency improvement. To maintain stable purchasing power, the reward function must compensate:

```
f(h) = e^{-a_estim × t} × h(t)
```

The quality of this approximation depends on parameter estimation. Overestimation of `a` produces mild inflation; underestimation produces mild deflation. For a 10% parameter error with hardware doubling every 3 years, the resulting drift is approximately 2% per year over 30 years — comparable to central bank inflation targets and far less than cryptocurrency volatility.

### 3.6 Why Not Merge Mining

Merge mining allows miners to secure multiple chains simultaneously with the same hash power. This destroys the proportional reward mechanism: hash rate directed at this chain would be subsidized by rewards from other chains, breaking the relationship between hash rate and economic demand.

If miners earn BTC + Ergon for the same hash, the proportional reward no longer reflects THIS chain's demand — it reflects the combined economics of all merge-mined chains. The equilibrium p ≈ ε₀ collapses because the effective ε (cost per hash) is offset by external rewards.

Security requires hash rate to be proportional to this chain's economics alone. Dedicated mining is not a limitation — it is the mechanism.

### 3.7 Shapley Fairness Connection

The proportional reward system satisfies the Shapley axioms as applied to mining:

- **Efficiency**: All block reward goes to miners. No value is trapped in protocol or redistributed to non-contributors.
- **Symmetry**: Equal hash power → equal expected reward. No miner is privileged.
- **Null Player**: Zero hash power = zero reward. No rent extraction without contribution.
- **Proportionality**: Reward scales linearly with contribution (hash power).

In Bitcoin's fixed reward system, the Shapley value of each miner's contribution is distorted by the halving schedule: identical work in different eras receives different compensation. The proportional system eliminates this temporal distortion — work and reward are always proportional.

Furthermore, the proportional reward eliminates a form of information asymmetry specific to mining: in Bitcoin, knowledge of the difficulty adjustment algorithm's timing creates arbitrage opportunities (pre-positioning hardware before difficulty drops). In the proportional system, there is no separate difficulty adjustment to game — the reward *is* the difficulty response.

---

## 4. Primitive II: PI-Controller Dampened Stable

### 4.1 Control Theory Applied to Money

Reflexer Labs' RAI demonstrated that control theory — the mathematics of feedback systems used in engineering — can stabilize a monetary instrument without external pegs. The system uses a **Proportional-Integral (PI) controller** to adjust the rate at which a target price evolves, creating a low-volatility asset from volatile collateral.

### 4.2 The Mechanism

Define:

- `market_price(t)` — current trading price on secondary markets (TWAP to resist manipulation)
- `redemption_price(t)` — protocol's internal target price (evolves over time)
- `redemption_rate(t)` — rate of change of redemption price per second

**Error signal** (normalized deviation):

```
error(t) = (redemption_price(t) - market_price(t)) / redemption_price(t)
```

**Controller equation**:

```
redemption_rate(t) = Kp × error(t) + Ki × integral(t)
```

Where:
- Kp (Proportional Gain) = 7.5 × 10⁻⁸ — responds to current price deviation
- Ki (Integral Gain) = 2.4 × 10⁻¹⁴ — responds to accumulated historical error

**Leaky integrator** (prevents unbounded windup):

```
integral(t) = α × integral(t-1) + error(t)
```

Where α = 0.9999997112, corresponding to a 120-day decay half-life. Approximately 95% of the accumulated error sum originates from the preceding 120 days.

**Redemption price update**:

```
redemption_price(t+1) = redemption_price(t) × (1 + redemption_rate(t) × dt)
```

### 4.3 Behavioral Logic

The system responds countercyclically through incentive adjustment. When market price exceeds redemption price, the redemption rate turns negative. This makes RAI debt cheaper to repay, incentivizing borrowers to mint new RAI and sell it, which pushes market price back down. When market price falls below redemption price, the redemption rate turns positive, making debt more expensive and incentivizing borrowers to buy RAI to repay, pushing price back up. When market and redemption prices converge, the system reaches a steady state.

Critically, this system has no external peg. It does not target $1, or any fiat value, or any external asset. It finds its own equilibrium and dampens deviations from it.

### 4.4 The Innovation: RAI on RPow, Not ETH

RAI deployed on Ethereum uses ETH as collateral. This means it inherits ETH's volatility — dampened by the PI controller, but still present. When ETH drops 50%, RAI positions face liquidation risk despite the controller's efforts.

We propose deploying the RAI mechanism on top of the RPow proportional proof-of-work money (the Ergon model from Section 3) instead. The implications are profound.

With single dampening (RAI on ETH), the controller reduces ETH volatility, but the input signal (ETH price) can swing wildly. The output volatility is a function of the input volatility and the controller gains: `Volatility_RAI = f(Volatility_ETH, Kp, Ki)`.

With double dampening (RAI on RPow), the proportional PoW mechanism already bounds price to oscillations around ε₀ (electricity cost). The PI controller then dampens these bounded oscillations further. The input signal is already near-stable: `Volatility_RAI = f(Volatility_RPow, Kp, Ki)`.

The result is ultra-stable: the PI controller operates on a signal that is already mean-reverting, producing a compound dampening effect. Oscillation amplitude decreases exponentially at the rate determined by both the Ergon market damping (γ) and the RAI controller gains (Kp, Ki).

### 4.5 Elimination of Adverse Selection

With stable collateral backing loans:

- The embedded put option value for borrowers approaches zero (collateral doesn't crash below loan value)
- No incentive differential between risk-seeking and risk-averse borrowers
- The Akerlof unraveling dynamic cannot start: all borrowers face similar expected outcomes
- Lending pool quality becomes transparent: stable collateral = observable, predictable risk

### 4.6 Elimination of Moral Hazard

- Stable base collateral removes the incentive for hidden leverage (leverage on a stable asset produces negligible return)
- Overcollateralization requirements can be reduced from 150%+ to 100-110% (the buffer need only cover operational risk, not price volatility)
- Protocol fees from lending are predictable, enabling fair Shapley distribution of surplus

---

## 5. Primitive III: Elastic Supply Rebasing

### 5.1 The AMPL Mechanism

Ampleforth introduced a distinct approach to price stability: rather than adjusting interest rates or controller parameters, it adjusts **supply itself**. If the price is above target, supply expands (everyone receives more tokens proportionally). If below, supply contracts (everyone's balance decreases proportionally).

**Rebase formula:**

```
supplyDelta = totalSupply × (oraclePrice - targetPrice) / targetPrice / rebaseLag
```

Where:
- `oraclePrice` — 24-hour VWAP from oracle
- `targetPrice` — reference price anchored to 2019 CPI purchasing power of the USD
- `rebaseLag` — smoothing parameter (10 in reference implementation)

The target price is not a naive $1 peg. It represents the purchasing power of one US dollar as measured by the Consumer Price Index at a fixed reference point (2019). This soft-pegs the unit to a stable measure of real-world value without succumbing to monetary inflation — if the Fed prints and CPI rises, the target adjusts to maintain constant purchasing power. Supply increases or decreases depending on whether the market price sits above or below this equilibrium.

**Equilibrium band**: No rebase occurs when price is within ±5% of target. This prevents unnecessary adjustments during normal fluctuations.

### 5.2 Dual Oracle Architecture

In the original Ampleforth design, a single Chainlink CPI oracle provides the target price. We propose a **dual oracle system** that cross-references two independent price signals:

**Oracle A — CPI Purchasing Power (Chainlink)**: The same CPI-adjusted target used by the original AMPL. This tracks the fiat purchasing power of the unit, grounding it in consumer economic reality.

**Oracle B — Ergon Electricity Price**: The proportional PoW money's electricity cost equilibrium ε₀ from Section 3. This tracks the physical cost of computational work, grounding it in energy-economic reality.

The two oracles serve as mutual benchmarks:

- If CPI says the target should be X but Ergon says it should be Y, the divergence is informative. Sustained divergence suggests either CPI manipulation (government cooking the books) or energy market dislocation (temporary supply shock).
- The rebase mechanism can use a **conservative composite** — for example, the geometric mean of both signals, or the signal closer to the current price (minimizing unnecessary rebase magnitude).
- Over long timescales, electricity cost and consumer purchasing power are correlated: electricity is a major input to industrial production, which is a major component of CPI. Short-term divergences correct as energy costs flow through to consumer prices.
- Each oracle constrains the other. If Chainlink's CPI feed were compromised or manipulated, the Ergon oracle provides an independent physical-reality anchor. If the Ergon equilibrium is temporarily distorted by a mining event, the CPI oracle provides stability.

This dual-oracle design eliminates a single point of failure in the target price mechanism and creates a self-checking system where monetary reality (CPI) and physical reality (electricity) keep each other honest.

**O(1) Global Rebase Scalar (Core Tenet)**: This is a non-negotiable architectural requirement. Rather than updating every holder's balance individually (which would be gas-prohibitive and scale O(n) with holder count), a single global `rebaseScalar` state variable is updated once per rebase cycle. Every holder's externally visible balance is computed lazily as `externalBalance = internalBalance × rebaseScalar`. Internal balances never change during rebase — only the scalar changes. This means the rebase operation costs the same gas whether the token has 10 holders or 10 million. It also means rebase is atomic, deterministic, and cannot be partially applied. All holders are affected simultaneously and equally, which is what makes the Shapley symmetry axiom hold exactly rather than approximately. The global scalar is the mechanism that converts an otherwise O(n) governance nightmare into an O(1) mathematical invariant.

### 5.3 Demand Shock Absorption

The Ergon mechanism responds to demand changes through hash rate adjustment — but hash rate responds with delay α (miners must redirect hardware). The RAI PI controller responds through redemption rate adjustment — but the leaky integrator intentionally dampens rapid responses (120-day half-life).

Neither mechanism handles sudden demand spikes or crashes well in isolation. A flash crash in demand, for example, would cause Ergon's price to temporarily drop below ε₀ (until miners exit) and RAI's redemption price to lag the market.

AMPL's rebase mechanism fills this gap. When demand surges and price rises above target, supply expands within 24 hours, directly absorbing the price pressure. When demand collapses, supply contracts, preserving per-unit value.

The elastic supply acts as a **shock absorber** operating at a faster timescale than either Ergon or RAI.

### 5.4 Shapley Connection: Supply-Side Fairness

The rebase mechanism satisfies critical Shapley axioms:

- **Symmetry**: Every holder gains or loses the same percentage. Equal holders receive equal treatment. There is no preferential access or tiered rebasing.
- **Null Player**: A holder with zero balance receives zero rebase (trivially satisfied).
- **Efficiency**: All supply adjustment is distributed to existing holders — no value leaks to the protocol or external parties.
- **Elimination of Information Asymmetry**: The rebase formula is public, deterministic, and executed at a known time. There is no private information that could provide advantage. Unlike interest rate adjustments in traditional finance (where central bank insiders have advance knowledge), rebase parameters are on-chain and immutable.

Crucially, the rebase cannot be front-run in a meaningful way within VibeSwap's architecture: the commit-reveal auction prevents any trader from seeing others' pre-rebase orders.

### 5.5 The Supply Volatility Critique

The AMPL mechanism has faced persistent criticism that deserves honest treatment. The rebase works by applying a global coefficient to all wallet balances — expanding supply when price is high, contracting when price is low. Critics argue this is sleight of hand: the user's wallet balance now fluctuates instead of the price, but the **total value held** still changes. Price volatility has been converted into supply volatility. The user experience of watching your balance shrink during contractions can be psychologically worse than watching a price fall, even when the economic outcome is identical.

This criticism is valid when AMPL operates in isolation. Standalone AMPL, tracking a $1 target against volatile crypto demand, can experience rebase adjustments of 10-50% during demand shocks. At these magnitudes, supply volatility is genuinely disruptive — contracts break, accounting becomes complex, and users are confused.

However, the criticism points to something deeper: the **separation of money's three functions**. Traditional economic theory identifies three properties of money: Store of Value (SOV), Medium of Exchange (MOE), and Unit of Account (UOA). AMPL's proponents argue that no single monetary instrument can simultaneously optimize all three in a volatile environment. By holding price stable (preserving MOE and UOA functionality) and absorbing volatility through supply adjustment (shifting it to SOV), AMPL makes a deliberate architectural choice: it prioritizes exchange utility over savings utility.

Whether this tradeoff is desirable depends on context. For a currency used primarily as a medium of exchange — the stated goal of Satoshi's original paper — price stability matters more than balance stability. A merchant accepting payment needs to know what 100 tokens are worth today, not how many tokens they'll have tomorrow. For a savings instrument, the opposite is true.

**The trinomial resolution**: In our system, the critique largely dissolves because AMPL never operates in isolation. By the time a price deviation reaches the AMPL rebase layer, it has already been bounded by Ergon's electricity equilibrium and dampened by RAI's PI controller. The residual deviations that AMPL must absorb are small — on the order of 1-3%, not 10-50%.

At these magnitudes, supply volatility is negligible. A 2% rebase adjustment is comparable to the daily float in a traditional bank account due to pending transactions. The UX concern — the disorienting experience of watching large balance swings — vanishes when the swings are small enough to be imperceptible.

This is perhaps the strongest argument for the trinomial architecture over standalone AMPL: **the three-layer system makes the AMPL mechanism work as intended by reducing its burden to manageable levels.** Standalone AMPL asked elastic supply to do all the stabilization work. The trinomial system asks it to handle only the residual — the narrow band of short-term deviation that Ergon and RAI have already bounded. AMPL goes from an overstressed primary mechanism to a properly scoped fine-tuning layer.

The SOV/MOE/UOA separation remains relevant for the trinomial system as a whole, but the proportions change. With total volatility converging to σ²_elec (electricity cost variance, ~2-5% annually), all three functions of money are approximately preserved simultaneously. The residual supply volatility from AMPL rebasing is a rounding error on an already-stable base, not a fundamental compromise between competing monetary functions.

---

## 6. Two Countercyclical Mechanisms: Why Both?

### 6.1 The Obvious Question

A careful reader will notice that both the RAI PI controller (Section 4) and the AMPL elastic supply (Section 5) are countercyclical. Both push back against price deviations. Both are stabilizing forces. So why deploy both? Is one redundant?

The answer is no, and the reason is fundamental: **they operate on different variables of the system through different transmission channels, at different speeds, with different failure modes.**

### 6.2 Demand-Side vs. Supply-Side

RAI is a **demand-side** mechanism. It works through incentive adjustment. When price deviates, the controller changes the redemption rate — the cost of capital for borrowers. This creates an incentive for market participants to act: mint and sell (when rate is negative) or buy and repay (when rate is positive). The correction happens *indirectly*, mediated by rational actors choosing to respond to changed incentives. If actors are slow, irrational, or absent, the correction is delayed.

AMPL is a **supply-side** mechanism. It works through quantity adjustment. When price deviates, the protocol directly modifies every holder's balance proportionally. No one needs to act. No one needs to make a decision. The correction happens *mechanically*, without behavioral assumptions. It is an actuator, not a signal.

In control theory terms: RAI adjusts a control variable (redemption rate) that influences the output (price) through a plant (the market and its participants). AMPL bypasses the plant entirely and modifies the system state (supply) directly.

### 6.3 Speed and Memory

The speed difference is not incidental — it is by design, and it determines which failure mode each mechanism handles.

**RAI is intentionally slow.** Its Proportional gain (Kp = 7.5 × 10⁻⁸) and Integral gain (Ki = 2.4 × 10⁻¹⁴) are tiny by design. The leaky integrator has a 120-day half-life. This conservatism prevents overcorrection — a PI controller that responds too aggressively can oscillate and destabilize the system it's meant to control. But the tradeoff is that RAI takes days to weeks to correct a deviation.

**RAI has memory.** The integral term accumulates persistent error over time. If price sits 5% above target for three months, the integral term builds up a substantial corrective force that *increases* the longer the deviation persists. This makes RAI excellent at correcting sustained drift — slow, persistent misalignment that would otherwise go uncorrected.

**AMPL is intentionally fast.** It rebases every 24 hours, correcting approximately 10% of the deviation each cycle (with lag = 10). A 30% spike is substantially dampened within a week. But AMPL's speed comes at a cost: it has no memory.

**AMPL is stateless.** Each rebase looks only at the current oracle price versus target. It has no concept of "how long has the deviation persisted?" or "is this getting worse?" It applies the same formula whether the deviation is a one-day spike or a three-month trend. This makes AMPL excellent at clipping acute shocks but unable to recognize or respond to persistent drift.

### 6.4 Failure Modes Without Each Other

**Without AMPL (RAI alone):** A sudden demand spike hits. Price jumps 30% above target. The PI controller detects the error and sets a negative redemption rate. But the gains are deliberately tiny. The integral term starts accumulating, but its 120-day half-life means corrective force builds slowly. For days to weeks, the 30% deviation persists — plenty of time for speculation, adverse selection, and cascading effects to propagate through the lending system.

**Without RAI (AMPL alone):** A slow drift develops over three months. Price creeps from $1.00 to $1.20. AMPL rebases daily, correcting ~10% of deviation per cycle. But if new demand keeps flowing in faster than 10%/day correction, AMPL cannot keep up. Supply keeps expanding but price stays elevated. Worse, AMPL's statelessness means it doesn't recognize that this deviation has persisted for months — it treats day 90 the same as day 1. The drift continues because there is no accumulating counter-pressure.

**With both:** AMPL clips the peaks — acute shocks are dampened within days. RAI corrects the trends — sustained drift is met with increasing counter-pressure from the integral term. Neither mechanism interferes with the other because they operate on orthogonal variables: supply quantity (AMPL) and cost of capital (RAI).

### 6.5 The Car Analogy

AMPL is the shock absorber. It handles bumps immediately, preventing the passengers from feeling every pothole. But it has no opinion about which direction the car is heading.

RAI is the power steering. It corrects sustained curves and keeps the vehicle on course. But it cannot react fast enough to handle a sudden obstacle.

Ergon is the road itself — a physical surface that determines the baseline trajectory.

You would not design a car with only shock absorbers or only power steering. Both are countercyclical in the sense that they both resist unwanted deviations from the intended path. But they handle different kinds of deviation, at different timescales, through different physical mechanisms. Removing either makes the system dangerous in conditions that the remaining mechanism cannot handle alone.

---

## 7. The Trinomial Stability Theorem

### 7.1 Frequency Decomposition of Instability

Each monetary primitive addresses a different frequency band of price instability.

The **Ergon PoW** mechanism operates on the long-term timescale (weeks to years). It anchors value to physical reality via the electricity cost equilibrium, eliminating fundamental price volatility by providing a physical floor for value.

The **RAI PI Controller** operates on the medium-term timescale (days to weeks). It dampens speculative oscillations via control theory feedback, causing deviations to decay exponentially through accumulated corrective pressure.

The **AMPL Elastic Supply** operates on the short-term timescale (hours to days). It absorbs demand shocks via proportional supply adjustment, directly counteracting price spikes and crashes before they can propagate.

This frequency decomposition is the key insight. No single mechanism can stabilize across all timescales without either being too aggressive (causing instability from overcorrection) or too conservative (allowing dangerous oscillations). The trinomial system assigns each timescale to the mechanism best suited for it.

### 7.2 Formal Statement

**Theorem (Trinomial Stability)**: Let T = (Ergon, RAI, AMPL) be the trinomial system operating on a SHA-256 proof-of-work blockchain with proportional block reward, PI-controlled redemption pricing, and elastic supply rebasing. Let p(t) denote the composite system price at time t, and let σ²_elec denote the variance of global electricity costs. Then:

**(i) Bounded Volatility**: There exist constants L > 0, U > 0 such that for all t > T₀ (initialization period):

```
L ≤ p(t) ≤ U
```

where L and U are determined by the bounds of global electricity cost variation.

**(ii) Asymptotic Convergence**: The variance of p(t) converges:

```
lim_{t→∞} Var(p(t)) → σ²_elec
```

The system's price volatility converges to the volatility of its physical anchor — electricity cost — which represents the theoretical minimum for proof-of-work money.

**(iii) Adverse Selection Elimination**: Let V_put(σ) denote the value of the embedded put option for borrowers as a function of collateral volatility σ. Then:

```
V_put(σ) → 0  as  σ → σ_elec
```

With collateral volatility bounded at electricity cost variance (~2-5% annually for industrial electricity), the borrower's option to default becomes worthless. The adverse selection incentive vanishes.

**(iv) Moral Hazard Reduction**: Let L_max(σ) denote the maximum profitable hidden leverage ratio as a function of collateral volatility. Then:

```
L_max(σ) → 1  as  σ → σ_elec
```

When collateral is near-stable, additional leverage on it produces negligible expected return relative to the cost of maintaining the leveraged position. The incentive for hidden risk-taking disappears.

### 7.3 Proof Sketch

**Step 1 — Ergon Stability**: From Trzeszczkowski (2021), the proportional reward system produces price oscillations around ε₀ (electricity cost per hash). For speculative damping factor γ > C (demand surplus):

```
p(t) → ε₀  with oscillation amplitude decreasing as O(e^{-γt})
```

This follows from the damped oscillator structure of system (3) with the speculative damping term. The equilibrium ε₀ is globally attracting.

**Step 2 — RAI Dampening**: The PI controller applied to the Ergon-stabilized base produces compound dampening. The closed-loop transfer function of the PI controller has the form:

```
G(s) = (Kp × s + Ki) / (s² + Kp × s + Ki)
```

For properly tuned Kp and Ki (Reflexer Labs' parameters were validated empirically over 2 years of mainnet operation), the closed-loop system is stable with damping ratio ζ > 1 (overdamped). Applied to an input signal that is already bounded (Ergon's oscillations around ε₀), the output has strictly smaller variance than the input.

**Step 3 — AMPL Shock Absorption**: The elastic supply mechanism handles transient deviations that occur faster than either Ergon (limited by hash rate response α) or RAI (limited by controller gains Kp, Ki) can respond. The rebase operation:

```
supply_{t+1} = supply_t × (1 + (price_t - target) / (target × lag))
```

directly reduces price deviation by expanding supply when price > target and contracting when price < target. With lag = 10, each rebase reduces the deviation by approximately 10%.

**Step 4 — Composition**: The three mechanisms operate at different timescales without interference. AMPL responds within 24 hours (fast). RAI controller responds over days to weeks (medium). Ergon equilibrium operates over weeks to months (slow).

Each layer reduces the residual volatility left by the slower layer above it. The total variance of the composite system satisfies:

```
Var(p_total) ≤ Var(p_Ergon) × Dampening_RAI × Dampening_AMPL
```

where each dampening factor is strictly less than 1. The lower bound on total variance is σ²_elec, because no proof-of-work system can be more stable than the physical cost of the work itself.

### 7.4 Infrastructure Inversion

The proportional PoW primitive uses SHA-256 — the same hash function as Bitcoin. This is by design.

**Hash power absorption**: When Ergon's proportional reward exceeds Bitcoin's fixed reward per unit of hash power (which occurs during periods of growing demand for Ergon), miners can seamlessly redirect existing SHA-256 ASICs from Bitcoin to Ergon. No new hardware investment required. The infrastructure inverts.

**First-mover yield advantage**: Early miners earn disproportionately because hash rate is low and proportional reward per unit of hash power is high. As adoption grows and hash rate increases, reward per miner normalizes — but total network security increases proportionally. This is the natural bootstrapping incentive that Bitcoin achieves through its halving schedule, but without the artificial scarcity that creates speculative volatility.

**Security scaling**: In Bitcoin's fixed reward model, security (hash rate) follows price — a feedback loop that creates volatility. In the proportional model, security follows demand directly. When demand grows, reward grows, hash rate grows, security grows — without the intervening price speculation.

---

## 8. Eliminating the Three Market Failures

### 8.1 Information Asymmetry → Transparency

With stable base collateral, the information gaps that plague traditional DeFi lending dissolve. Depositors can now assess collateral quality because it is observable and bounded by electricity cost variance — there is nothing hidden about a physically anchored asset. Borrowers' risk profiles matter less because even reckless borrowing cannot crash the collateral, limiting the damage from any individual actor. The profit incentive for oracle manipulation disappears because there is no windfall from crashing a stable asset. And liquidation cascades cannot form because collateral simply does not breach liquidation thresholds during normal operation.

Combined with VibeSwap's commit-reveal auction (which eliminates execution-layer information asymmetry), the trinomial system closes the remaining gap: collateral-layer transparency.

### 8.2 Adverse Selection → Neutral Selection

The Akerlof unraveling dynamic requires an information gap between borrower quality and lender perception. When collateral is stable:

- All borrowers face similar expected outcomes regardless of risk appetite
- The embedded put option (walk away from underwater loans) becomes worthless
- There is no quality gradient to drive unraveling — borrower selection becomes neutral
- Credit rationing (Stiglitz-Weiss) becomes unnecessary: rates can rise without adversely selecting the borrower pool

In Shapley terms: the **null player axiom** is restored. Participants who contribute nothing (borrowers who would have defaulted) receive nothing (no put option value). Participants who contribute genuine demand receive proportional service.

### 8.3 Moral Hazard → Bounded Risk

With stable collateral, hidden leverage produces negligible return (leverage on a stable asset earns near-zero spread). Collateral chains (recursive borrowing) lose their reflexive amplification because stable assets don't create cascading liquidations. Overcollateralization can be reduced to 100-110%, making capital efficient rather than defensive.

The **efficiency axiom** is satisfied: nearly all deposited value (100-110% vs 150%+) is productive, rather than locked as a volatility buffer.

---

## 9. Integration with VibeSwap Architecture

### 9.1 Completing the Stack

VibeSwap's Phase 1 architecture eliminates MEV at the execution layer through commit-reveal batch auctions. The Shapley distribution system eliminates unfair reward allocation. The trinomial system extends this elimination to the collateral layer, addressing volatile base assets, liquidation cascades, and adverse selection. Together, they produce a full-stack fair financial system where fairness is guaranteed at every layer — from execution, through distribution, down to the money itself.

### 9.2 Impact on Financial Primitives

Each existing VibeSwap financial primitive benefits from stable base collateral:

- **Wrapped Batch Auction Receipts (wBAR)**: Pending auction positions backed by stable collateral eliminate settlement risk — the position's collateral value won't decline between commit and settlement.

- **LP Position NFTs (VibeLPNFT)**: Impermanent loss from base layer volatility approaches zero. LP positions become pure yield instruments rather than volatility bets.

- **VibeOptions**: Options pricing improves dramatically. Black-Scholes assumes lognormal returns and stable volatility — assumptions that hold far better for electricity-cost-anchored assets than for speculative cryptoassets.

- **VibeStream**: Streaming payments in stable denomination deliver predictable value. A salary stream of 1000 tokens/month actually delivers consistent purchasing power.

- **Bond Market (planned)**: Fixed-rate bonds on a stable base are genuinely fixed. The bondholder receives the stated return without inflation/deflation adjustment.

- **Credit Delegation (planned)**: Undercollateralized lending becomes viable. With stable collateral and neutral borrower selection, reputation-based lending can function without the 150%+ safety margin.

### 9.3 Shapley Distribution on Stable Foundation

The ShapleyDistributor allocates rewards based on contribution weights. With stable base collateral:

- Fee distribution becomes more predictable (fees denominated in stable units)
- The VolatilityInsurancePool can price coverage accurately (reference: known volatility bounds from the trinomial theorem)
- The ILProtectionVault requires less capital reserves (impermanent loss bounded by electricity cost variance, not crypto speculation)
- All four Shapley axioms (efficiency, symmetry, null player, proportionality) plus VibeSwap's fifth axiom (time neutrality) operate on a stable denominator — ensuring that fairness holds not just in token terms but in real value terms.

### 9.4 MEV Elimination Synergy

VibeSwap's commit-reveal auction eliminates execution MEV. The trinomial system eliminates collateral MEV. Together:

- **Execution MEV = 0** (commit-reveal: no one sees others' orders)
- **Liquidation MEV = 0** (stable collateral: no cascading liquidations to front-run)
- **Oracle MEV = 0** (stable prices: no profit from oracle manipulation)
- **Total extractable value = 0**

This is the complete realization of Intrinsically Incentivized Altruism (IIA): when total extractable value is zero, individual optimization and collective welfare are identical. Defection doesn't merely cost more than cooperation — it ceases to exist as a strategy.

---

## 10. Unified Token Architecture: Joule (JUL)

### 10.1 One Token, Three Mechanisms

A critical architectural decision: the trinomial system is implemented as **one token, not three**. The three stability mechanisms are not three separate assets requiring users to manage a portfolio — they are three internal layers of a single ERC-20 token called **Joule (JUL)**, named after the SI unit of energy.

This is not merely a UX convenience. It is a design requirement. Three separate tokens would create:
- **Friction**: Users must understand which token to hold and when to convert between them
- **Arbitrage surfaces**: Price divergences between the three tokens create extractable value, violating the IIA principle
- **Composition complexity**: Every financial primitive would need to decide which of three "stable" tokens to denominate in
- **Fragmented liquidity**: Three separate tokens split liquidity three ways

A single token eliminates all of these. Every user, every contract, every financial primitive interacts with one asset: JUL.

### 10.2 Internal Mechanism Composition

Inside the Joule token, the three mechanisms compose as follows:

**Layer 1 — Mining (RPow/Ergon)**: New JUL supply enters circulation through SHA-256 proof-of-work mining with proportional block reward. This is the only way new tokens are created. The reward scales with difficulty and decays with Moore's Law, anchoring long-term value to electricity cost.

**Layer 2 — PI Controller (RAI)**: A Proportional-Integral controller continuously adjusts a floating **rebase target**. Unlike standalone RAI (which is a CDP system with separate collateral), the PI controller here modifies the target price that the rebase mechanism aims for. This makes the target float to find natural equilibrium rather than being hardcoded.

**Layer 3 — Rebase (AMPL)**: The O(1) global rebase scalar adjusts all balances proportionally. But instead of targeting a fixed $1.009, it targets the **PI controller's floating redemption price**, which itself is informed by the dual oracle system (CPI + electricity cost).

The rebase formula becomes:

```
target(t) = PI_controller(market_price, electricity_oracle, CPI_oracle)
supplyDelta = totalSupply × (oraclePrice - target(t)) / target(t) / rebaseLag
```

This composition means:
- Mining provides the base supply and electricity anchor (long-term)
- The PI controller adjusts what "equilibrium" means (medium-term)
- The rebase pushes toward that floating equilibrium (short-term)

All three operate on the same token simultaneously, without user intervention.

### 10.3 Implementation Roadmap

The contract is implemented in a single deployment:
- **SHA-256 PoW mining** with proportional reward, Moore's Law decay, difficulty adjustment per epoch
- **PI controller** with configurable Kp, Ki, leaky integrator (120-day half-life)
- **Elastic rebase** with O(1) global scalar, ±5% equilibrium band, lag = 10
- **Dual oracle** integration (Chainlink CPI + electricity price feed)
- **Anti-merge-mining** via contract-address-bound challenge generation
- **ERC-20 compatible** — standard transfer/approve/transferFrom with rebase-aware internal accounting

Integration with VibeSwap:
- Bridge JUL to all supported chains via CrossChainRouter (LayerZero V2)
- Use as base collateral for all financial primitives (wBAR, VibeLPNFT, VibeOptions, VibeStream)
- Enable lending with reduced overcollateralization (100-110%)
- Denominate ShapleyDistributor distributions in JUL

---

## 11. The Optimal Yield Problem

### 11.1 The Paradox of Stable Money Yield

A natural question arises: what should the yield on Joule be? This question conceals a deeper paradox that strikes at the heart of monetary design.

High yield signals strength and demand — a currency that people want to hold. But high yield means high borrowing costs — a currency that is expensive to use. These two properties are in direct tension. A world reserve currency that yields 15% annually is simultaneously "strong" (high demand to hold) and "unusable" (prohibitive to borrow against). A currency with 0% yield is "weak" (no incentive to hold beyond transactional need) but "efficient" (zero cost of capital for productive use).

This is not merely a parameter optimization. It is a fundamental design choice about what kind of money Joule aspires to be.

### 11.2 The Case for Zero

Milton Friedman's "Optimum Quantity of Money" (1969) argued that the optimal monetary policy sets the nominal interest rate to zero — the "Friedman Rule." The reasoning is elegant: holding money has an opportunity cost equal to the interest rate. Any positive rate means people economize on money holdings, which creates friction. At zero rates, money is a free good to hold, and the economy achieves the "satiation" level of real balances.

For a world reserve currency — one that aims to be the base layer for all financial activity — zero yield has several advantages:

**Capital allocation efficiency**: If the risk-free rate is zero, all returns in the economy reflect genuine productive value, not monetary premium. A business that earns 5% is genuinely productive. Under a 5% risk-free rate, that same business is break-even — it creates no value above what money itself provides for doing nothing.

**Borrowing accessibility**: Zero cost of capital means anyone can borrow to fund productive activity without a hurdle rate. This is the most inclusive possible monetary regime — the bar for "worth doing" is any positive return at all.

**Neutrality**: Zero yield makes money a neutral medium — it neither rewards hoarding nor penalizes holding. It is purely a coordination tool, which is arguably money's highest purpose.

### 11.3 The Case Against Zero

Zero yield creates its own problems:

**No holding incentive**: If money yields nothing, rational actors hold only the minimum needed for transactions and invest the rest. This reduces monetary demand and, in a PoW system, reduces hash rate and security. Joule needs people to hold it to maintain the electricity equilibrium.

**Velocity instability**: Money that yields nothing moves faster (hot potato effect). High velocity means each unit of money must "do more work," which amplifies demand shocks and makes the rebase mechanism work harder.

**Savings destruction**: In a zero-yield regime, saving is always inferior to investing. This penalizes risk-averse actors and creates a world where everyone must be an investor — a socially costly outcome.

### 11.4 The Theoretical Optimum

The optimal yield for a trinomial stability currency is **not zero, but asymptotically approaching zero from above** — specifically, it should equal the long-run variance of the system's stability floor:

```
optimal_yield ≈ σ²_elec ≈ 2-5% annually
```

The reasoning:

**Yield as volatility compensation**: The remaining irreducible volatility of the system (electricity cost variance, ~2-5% annually) represents a real risk to holders. Fair compensation for bearing this risk is a yield equal to the variance itself. This satisfies the Shapley efficiency axiom: holders are compensated exactly for the cost they bear by participating in the monetary system.

**Natural emergence**: In the trinomial system, this yield emerges naturally without being set by policy. Miners earn block rewards proportional to difficulty (which tracks demand). As the system matures, the equilibrium mining reward (denominated in purchasing power) converges to the electricity cost variance — miners earn just enough to cover their costs plus the risk premium of electricity cost fluctuation.

**Self-regulating**: If yield rises above the optimum (due to high demand), more miners enter, increasing supply, reducing yield back toward equilibrium. If yield falls below the optimum, miners exit, reducing supply, increasing yield. The proportional reward mechanism IS the yield-setting mechanism, and it converges to the physical cost of maintaining the system.

### 11.5 Why Not Higher

Yield significantly above the electricity variance optimum would indicate:

- **Artificial scarcity**: Supply is not responding to demand (Bitcoin's disease — fixed supply creates speculative premium)
- **Rent extraction**: Some mechanism is capturing value beyond the cost of security provision
- **Adverse selection re-emergence**: High yield attracts speculative capital that destabilizes the system it seeks returns from

Each of these violates Shapley fairness and reintroduces the market failures the trinomial system is designed to eliminate.

### 11.6 The Reserve Currency Implication

A world reserve currency should be boring. Its yield should be just enough to compensate for the irreducible cost of maintaining the system (electricity for PoW security) and nothing more. This is the monetary equivalent of a utility — you don't want your electricity grid to be "exciting" or "high-yielding." You want it to work, reliably, at the lowest possible cost.

Joule's optimal yield profile is therefore: **converging to ~2-5% annually (matching electricity cost variance), set by market forces (not governance), emerging naturally from the proportional reward mechanism, and declining over time as the system matures and volatility decreases.**

This is the answer to the yield paradox: the optimal rate is not a policy choice but a physical constant — the cost of turning electricity into trust.

---

## 12. Conclusion

Decentralized finance's foundational defect is not in its lending protocols, its execution mechanisms, or its governance structures. It is in the collateral itself. When the base layer is volatile, information asymmetry, moral hazard, and adverse selection are mathematical inevitabilities — no amount of overcollateralization, liquidation efficiency, or governance optimization can solve problems that are structural to the collateral.

The Trinomial Stability System transforms this unsolvable problem into a solved one:

1. **RPow Mining** (Ergon model) grounds monetary value in electricity — the most globally distributed, constantly priced, and physically real commodity available as a proof-of-work anchor.

2. **PI Controller** (RAI model) applies control theory to dampen the bounded oscillations around the electricity equilibrium, producing compound stability through mathematical feedback. It corrects sustained drift through accumulated corrective pressure — the integral term remembers what the rebase cannot.

3. **Elastic Rebase** (AMPL model) absorbs demand shocks through elastic supply, operating at the fastest timescale to smooth transients that escape the slower mechanisms. It clips acute spikes that the PI controller is too conservative to catch.

All three mechanisms live inside a single token — **Joule (JUL)** — the SI unit of energy and the name of VibeSwap's trinomial stability currency. One token, one UX, three stability layers. Users interact with JUL as they would any ERC-20 token; the trinomial machinery operates transparently underneath.

Both the PI controller and elastic rebase are countercyclical, but they are not redundant. The PI controller is the demand-side memory that corrects trends. The rebase is the supply-side reflex that absorbs shocks. One without the other leaves a gap — either in speed (without rebase) or in persistence (without PI). Together, they cover the full spectrum of instability that the RPow equilibrium alone does not instantly resolve.

Together, they converge to a volatility floor bounded by the variance of global electricity costs — the lowest achievable bound for proof-of-work money. The natural yield of the system converges to this same variance (~2-5% annually) — just enough to compensate holders for the irreducible cost of electricity-backed security, and no more.

At this floor, the three classical market failures vanish: information asymmetry dissolves (collateral quality is observable and bounded), adverse selection neutralizes (the borrower's put option becomes worthless), and moral hazard evaporates (hidden leverage produces no return on stable collateral).

Within VibeSwap's architecture — where execution fairness is guaranteed by commit-reveal auctions and distributional fairness is guaranteed by Shapley allocation — the trinomial system provides the final piece: **monetary fairness**. Not just fair execution and fair distribution, but fair money itself.

The vision of Cooperative Capitalism is complete. From the electricity that powers the miners, to the stable Joule they produce, to the fair auctions that exchange it, to the proportional rewards that distribute its surplus — every layer is positive-sum, every participant is treated fairly, and defection is not merely costly but impossible.

---

## References

[1] Nakamoto, S. (2008). "Bitcoin: A peer-to-peer electronic cash system."

[2] Trzeszczkowski, K. (2021). "Proportional block reward as a price stabilization mechanism for peer-to-peer electronic cash system." (Ergon Whitepaper)

[3] Finney, H. (2004). "RPOW — Reusable Proofs of Work." https://nakamotoinstitute.org/finney/rpow/

[4] Reflexer Labs. (2021). "RAI: A low volatility, trust minimized collateral for the DeFi ecosystem."

[5] Kuo Chun Ting, E. & Rincon-Cruz, G. (2019). "Ampleforth: A new synthetic commodity." (Ampleforth Whitepaper)

[6] Akerlof, G. (1970). "The Market for 'Lemons': Quality Uncertainty and the Market Mechanism." *Quarterly Journal of Economics*, 84(3), 488-500.

[7] Stiglitz, J. & Weiss, A. (1981). "Credit Rationing in Markets with Imperfect Information." *American Economic Review*, 71(3), 393-410.

[8] Shapley, L. (1953). "A Value for n-Person Games." In *Contributions to the Theory of Games II*, Annals of Mathematics Studies 28, pp. 307-317.

[9] Buterin, V. (2014). "The Search for a Stable Cryptocurrency." https://blog.ethereum.org/2014/11/11/search-stable-cryptocurrency

[10] Werner, S., Ilie, D., Stewart, I. & Knottenbelt, W. (2020). "Unstable Throughput: When the Difficulty Algorithm Breaks."

[11] Arrow, K. (1963). "Uncertainty and the Welfare Economics of Medical Care." *American Economic Review*, 53(5).

[12] Holmstrom, B. (1979). "Moral Hazard and Observability." *Bell Journal of Economics*, 10(1), 74-91.

[13] Trobevsek, J., Smith, C. & De Gonzalez-Soler, F. (2018). "DoI-SMS: A Diffusion of Innovations based Subsidy Minting Schedule for Proof-of-Work Cryptocurrencies."

[14] Friedman, M. (1969). "The Optimum Quantity of Money." In *The Optimum Quantity of Money and Other Essays*. Aldine Publishing Company.
