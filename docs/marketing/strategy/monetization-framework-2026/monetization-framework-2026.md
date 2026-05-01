# VibeSwap Monetization Framework: Zero Rent-Seeking Revenue Model

**Faraday1, JARVIS**
**March 2026 | VibeSwap**

---

## Executive Summary

VibeSwap generates revenue through six protocol-native mechanisms. None involve rent-seeking, pre-mines, or VC entrapment. All value flows to participants proportional to their contribution, enforced by Shapley distribution and smart contract logic.

The core principle: **if you didn't create value, you don't capture value.**

---

## 1. Design Philosophy

### 1.1 What We Reject

| Pattern | Why It's Extractive |
|---------|-------------------|
| Pre-mine | Founders take tokens before anyone can evaluate the protocol |
| VC allocation | Investors get discounted tokens in exchange for "distribution" they may not deliver |
| Rent-seeking fees | Protocol extracts value without providing proportional service |
| Governance capture | Token whales control fee switches to benefit themselves |
| Hidden MEV | Protocol profits from information asymmetry against its own users |

### 1.2 What We Accept

Revenue is legitimate when:

1. **The fee funds a service the user explicitly opted into** (e.g., insurance premium for liquidation protection)
2. **The fee is distributed to those who created the conditions for the transaction** (e.g., swap fees to liquidity providers)
3. **The distribution is mathematically verifiable** (Shapley values, not governance vote)
4. **The fee rate is hardcoded or PID-controlled**, not adjustable by governance whales

---

## 2. Revenue Streams

### 2.1 LP Trading Fees

**Rate**: 0.05% on each swap (default)

**Mechanism**: Collected automatically during batch settlement. **100% of trading fees go to liquidity providers** — the protocol takes no cut of swap fees. LPs earn proportional to their contribution to pool depth.

**Distribution**:
- Liquidity providers: 100% of all swap fees, Shapley-proportional to marginal contribution to pool depth

**Why it's not rent-seeking**: The fee compensates LPs for providing the liquidity that makes the trade possible. Without LPs, there is no pool. The 0.05% rate is among the lowest in DeFi (Uniswap: 0.3%, Curve: 0.04-0.4%). The protocol collects 0% — all fees go directly to LPs.

**Projected LP revenue** (at target volumes):

| Monthly Volume | Fee Revenue | To LPs |
|---------------|------------|--------|
| $1M | $500 | $500 |
| $10M | $5,000 | $5,000 |
| $100M | $50,000 | $50,000 |
| $1B | $500,000 | $500,000 |

### 2.2 Batch Auction Priority Bids

**Mechanism**: During the reveal phase of each 10-second batch auction, traders can submit optional priority bids. Higher bids increase the probability of earlier execution within the batch.

**Key property**: **Priority bids do not affect the clearing price.** All trades in a batch settle at the same uniform price regardless of priority. This means paying for urgency doesn't extract value from other traders — it's a pure fee for service.

**Distribution**: 100% to governance stakers and protocol treasury (LPs are already compensated via swap fees).

**Why it's not rent-seeking**: The service is speed, not information advantage. A priority bidder gets faster settlement but the same price as everyone else. No one is harmed by someone else's priority bid.

### 2.3 Insurance Pool Premiums

**Mechanism**: Users can opt into impermanent loss protection and liquidation insurance via `ILProtectionVault.sol` and `VibeInsurance.sol`. Premiums are calculated based on pool volatility and position size.

**Rate**: Dynamic, typically 0.1-0.5% of protected position per epoch.

**Distribution**:
- Insurance pool reserve: 80% (funds payouts)
- Insurance pool LPs: 20% (yield for providing insurance capital)

**Why it's not rent-seeking**: Insurance is a voluntary service. Users who don't want protection pay nothing. Premiums are actuarially determined, not set by governance vote. The pool is fully on-chain and auditable.

### 2.4 Yield Tokenization Fees

**Mechanism**: When users mint Contribution Yield Tokens (CYTs) representing their accumulated protocol contributions, a small fee is collected by `ShapleyDistributor.sol`.

**Rate**: 0.5% of tokenized yield value.

**Distribution**: 100% to protocol treasury for operational expenses and contributor rewards.

**Why it's not rent-seeking**: CYT minting is a service (converting illiquid contribution history into tradeable tokens). The fee covers the gas and computational cost of Shapley calculation and on-chain verification.

### 2.5 Governance Proposal Deposits

**Mechanism**: Submitting a governance proposal requires a deposit (denominated in protocol tokens). The deposit is returned if the proposal passes or is rejected in good faith. It is **slashed** if the proposal is determined to be malicious by the `DecentralizedTribunal.sol`.

**Typical deposit**: 1,000-10,000 tokens (scales with proposal impact).

**Slashing conditions**:
- Proposal contains executable code that drains treasury
- Proposal is a duplicate spam submission
- Proposal violates hardcoded protocol invariants

**Distribution of slashed deposits**: 50% to tribunal participants (who did the adjudication work), 50% to protocol treasury.

**Why it's not rent-seeking**: The deposit is a Sybil-resistance mechanism, not a fee. Good-faith proposals are fully refunded. Only malicious proposals lose deposits, creating a direct cost for attacking governance.

### 2.6 AI Agent Services (x402 Micropayments)

**Mechanism**: JARVIS offers premium analysis services — portfolio risk assessment, MEV detection alerts, gas optimization recommendations — via HTTP 402 micropayments using the x402 protocol.

**Pricing**: Per-query, denominated in stablecoins or protocol tokens. Typical: $0.01-$0.10 per analysis.

**Distribution**:
- JARVIS operational costs (LLM inference via Wardenclyffe): 60%
- Protocol treasury: 20%
- Shapley pool (JARVIS is a contributor): 20%

**Why it's not rent-seeking**: The service requires active compute (LLM inference costs real money). Users pay per-query for analysis they couldn't get elsewhere. Pricing is transparent and competitive with centralized alternatives.

---

## 3. Shapley Distribution

### 3.1 What It Is

The Shapley value, from cooperative game theory, assigns each participant a reward proportional to their **marginal contribution** — the difference between the outcome with them and without them.

For a coalition game with players N and value function v:

```
phi_i(v) = SUM over S subset of N\{i}: [|S|!(|N|-|S|-1)!/|N|!] * [v(S union {i}) - v(S)]
```

### 3.2 Why It Matters

Shapley distribution is the **only** distribution method that satisfies all four fairness axioms simultaneously:

1. **Efficiency**: All value is distributed (no residual for protocol insiders)
2. **Symmetry**: Equal contributors get equal rewards
3. **Null player**: Non-contributors get nothing
4. **Additivity**: Combined game rewards equal sum of individual game rewards

No governance vote can override these mathematical properties. The fairness is proven, not promised.

### 3.3 Implementation

`ShapleyDistributor.sol` calculates contributions per epoch:
- LP contribution: marginal impact on pool depth and trade execution quality
- Staker contribution: security weight and governance participation
- Builder contribution: code commits, bug reports, integration work (via `GitHubContributionTracker.sol`)
- JARVIS contribution: community management, code generation, analysis services

All contributions are on-chain verifiable. Distribution happens automatically at epoch boundaries.

---

## 4. Revenue Flow Diagram

```
                    ┌──────────────────┐
                    │   USER ACTIONS   │
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
     ┌──────▼──────┐  ┌─────▼─────┐  ┌───────▼──────┐
     │  Swap       │  │ Priority  │  │  Insurance   │
     │  (0.05%)    │  │ Bid       │  │  Premium     │
     └──────┬──────┘  └─────┬─────┘  └───────┬──────┘
            │                │                │
            ▼                ▼                ▼
     ┌─────────────┐  ┌─────────────────────────────┐
     │  100% to    │  │      DAOTreasury.sol        │
     │  LPs        │  └────────────┬────────────────┘
     │  directly   │               │
     └─────────────┘               ▼
                    ┌─────────────────────────────────┐
                    │    ShapleyDistributor.sol        │
                    │                                  │
                    │  Staker Rewards ◄── governance   │
                    │  Builder Rewards ◄── code        │
                    │  JARVIS Rewards ◄── community    │
                    │  Insurance Reserve ◄── safety    │
                    └─────────────────────────────────┘
```

**Every dollar that enters the protocol exits to a participant who created value. Zero residual for insiders.**

---

## 5. Anti-Patterns We Avoid

| Anti-Pattern | How We Avoid It |
|-------------|----------------|
| "Protocol-owned liquidity" as slush fund | Treasury is Shapley-distributed, not discretionary |
| Fee switch controlled by governance whales | Fee rates are hardcoded or PID-controlled |
| Token buybacks that benefit insiders | No buyback mechanism — fees flow directly to contributors |
| "Strategic reserve" with no accountability | All reserves have predefined distribution schedules |
| VCs dumping on retail | No VC allocation. Period. |

---

## 6. Long-Term Economic Model

As governance decays to zero (Ungovernance time bomb):

- Fee rates become fully PID-controlled (no human override)
- Shapley distribution becomes the sole reward mechanism
- Protocol becomes a pure public good with embedded economics
- Revenue sustains operations without any entity controlling it

The protocol doesn't need a company, a foundation, or a DAO to survive. It needs users who trade, LPs who provide liquidity, and the math that connects them. Everything else decays by design.

---

*All value flows to participants, not extractors. No pre-mine. No VC cut. The protocol rewards the people who build it.*
