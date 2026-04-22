# Investor Economic Model

**Status**: Financial modeling framework for VibeSwap equity + token returns.
**Depth**: Rigorous scenario analysis with stated assumptions, parameter sensitivity, and honest limitations.
**Related**: [Why VibeSwap Wins in 2030](./WHY_VIBESWAP_WINS_IN_2030.md), [The Coordination Primitive Market](./THE_COORDINATION_PRIMITIVE_MARKET.md), [Three-Token Economy](./THREE_TOKEN_ECONOMY.md).

---

## The ask

VibeSwap is raising a seed round ($2.0M, announced 2026-04-20). An investor considering the round needs an economic model for potential returns. This document is the formal model — assumptions stated, parameters disclosed, honest about uncertainty.

**Not hype. Not downplayed. Just math with transparent assumptions.**

## The value-drivers

VibeSwap's token economy has three value sources:

### 1. Transaction-value fees

VibeSwap captures a small fee (currently 0% — see [Zero-Fee Principle](../memory/feedback_zero-fee-principle-enforcement.md)) but other protocols' transaction value routes through VibeSwap's infrastructure. External projects adopting Chat-to-DAG Traceability may pay license or subscription fees.

Current state: $0 transaction-fee revenue.
Target state (2028): $5M-$20M annual from 50-200 external integrations.
Target state (2030): $50M-$200M annual from 500-2000 integrations.

### 2. Protocol-owned liquidity (POL) returns

A portion of the raise ($800K of the $2.0M) is deployed as protocol-owned liquidity in VibeSwap's own markets. POL earns LP fees from internal trading volume.

Current state: $0 volume, $0 POL returns.
Target state (2028): $100M cumulative traded volume → ~$300K/year POL returns at 0.3% fee tier (if fees are activated).
Target state (2030): $1B+ cumulative volume → ~$3M/year POL returns.

### 3. Token appreciation (JUL + VIBE)

JUL is the money-layer token; its value scales with network usage. VIBE is the governance token; its value scales with governance activity.

Modeled using Metcalfe-inspired network-value scaling, adjusted for the coordination-primitive category:

```
TokenValue(t) = BaseValue × f(ActiveUsers(t)) × g(IntegrationCount(t)) × h(Age(t))
```

Where:
- f = user-network component (proportional to U × log(U) for network effects)
- g = integration-count component (linear in integrations since each integration adds fixed value)
- h = age / maturity discount (1 for mature protocols, <1 for bootstrap phase)

At bootstrap (2026): low h, low users, low integrations → token value is small.
At maturity (2030, Scenario A): h approaches 1; U is ~10,000-100,000; integrations ~500-2000 → substantial token value.

## The three scenarios

Using the [Why VibeSwap Wins in 2030](./WHY_VIBESWAP_WINS_IN_2030.md) scenarios:

### Scenario A — Dominant winner (45% probability)

By 2030:
- Active contributors: 50,000+
- External integrations: 1,500+
- Market-size capture: 2-5% of $1T coordination market = $20B-$50B routed
- Protocol treasury: $100M-$500M
- Token market cap (JUL + VIBE combined): $3B-$10B

Investor seed return: 100x-500x+ on initial investment.

### Scenario B — Graceful niche (35% probability)

By 2030:
- Active contributors: 5,000-10,000
- External integrations: 50-200
- Market-size capture: 0.1-0.5% of market = $1B-$5B routed
- Protocol treasury: $10M-$50M
- Token market cap: $300M-$1B

Investor seed return: 15x-50x.

### Scenario C — Underdog (20% probability)

By 2030:
- Active contributors: 100-500 (stagnant)
- External integrations: 0-5
- Market-size capture: minimal
- Protocol treasury: $1M-$5M
- Token market cap: $10M-$50M

Investor seed return: 0.5x-2x. Possibly negative in real terms.

## Expected value calculation

Using simple-weighted expected-value:

```
EV = 0.45 × 300x + 0.35 × 30x + 0.20 × 1x
   = 135x + 10.5x + 0.2x
   = 145.7x
```

Rough expected return: ~150x on initial seed investment.

**This is not a promise.** It's a model with stated assumptions. The model's validity depends on:
- Probability estimates being correct (they're estimated from pattern-matching to similar-stage protocols; highly uncertain).
- Scenario returns being correct (they're order-of-magnitude estimates; depend on many parameters).
- No black-swan exogenous shocks (regulatory crackdown, crypto winter, catastrophic exploit).

Sensitivity to probability re-estimation:
- If Scenario A probability drops to 30%, EV becomes ~100x.
- If Scenario C probability rises to 40%, EV becomes ~70x.
- If black-swan probability is included at 10% (total loss), EV drops another 10-15%.

Realistic expectation under worst reasonable assumptions: 30-50x. Under best reasonable assumptions: 200-500x.

## The time horizon

- **2026**: bootstrap. Minimal returns; protocol building.
- **2027-2028**: emergence phase. Tokens become liquid; early speculative value.
- **2029-2030**: network maturity. Returns materialize.
- **2031+**: compound phase. If Scenario A, returns continue growing; if B, stable niche; if C, liquidation or wind-down.

Expected time-to-return: 4-5 years to liquid returns; 6-8 years to full scenario-A materialization.

Investors with shorter horizons should discount accordingly. Investors with longer horizons benefit.

## Key parameter sensitivities

### Sensitivity 1 — Active-contributor growth rate

Current: ~5-10 new contributors/month.

- At current rate, by 2030: ~600-1,200 contributors. Scenario B.
- At 3x current rate (~15-30/month), by 2030: ~2,000-4,000. Top of Scenario B / bottom of Scenario A.
- At 10x current rate (~50-100/month), by 2030: ~6,000-12,000. Scenario A.

Contributor-recruitment intensity is the most leverageable parameter.

### Sensitivity 2 — Integration rate

Each external project integrating Chat-to-DAG Traceability adds compounding value (their users join the attention-graph).

- 1-2 integrations/year: Scenario C-B boundary.
- 5-10/year: Scenario B.
- 20-50/year: Scenario A.

Integration partnerships are the second-most-leverageable parameter.

### Sensitivity 3 — Constitutional stability

If governance drifts from P-000/P-001 (extraction normalizes), the protocol loses its "coordination primitive, not casino" positioning. Fork threats emerge; constitutional-fork exception fires.

Scenario: if governance drift occurs in 2027-2028, Scenario A becomes ~15% instead of 45%. EV drops substantially.

Risk-mitigation via explicit constitutional axioms, on-chain Lawson Constant, and cultural reinforcement.

### Sensitivity 4 — Competitive response

If 2-3 well-funded competitors enter by 2027 with similar architectures:

- Attention-graph moat partially replicates if they have head-start funding.
- Market share splits; each scenario's probability adjusts downward.
- Risk: Scenario B becomes more likely than A (graceful niche vs. dominant).

## The dilution question

Seed investors take ~15% of total equity at a $14M valuation (2026-04-20 deck). Subsequent rounds will dilute.

Assumed subsequent dilution path:
- Series A (2027): 15-20% dilution at $50M-$100M valuation.
- Series B (2028): 15-20% at $200M-$500M valuation.
- Growth rounds (2029+): 10-15% at $1B-$5B valuation.

Cumulative dilution by 2030: 40-50% of initial stake retained.

Adjusting scenario returns for dilution:
- Scenario A: 100-500x × 0.5 retention = 50-250x realized.
- Scenario B: 15-50x × 0.5 = 7.5-25x.
- Scenario C: 0.5-2x × 0.5 = 0.25-1x.

EV adjusted for dilution: ~75x. Still strong expected return.

## Token unlock schedules

Founder / core team tokens: 4-year vesting with 1-year cliff. Standard.

Investor tokens: subject to vesting per round terms; typical 1-2 year lockup + linear vesting thereafter.

Community allocation: mint-on-contribution (per Chat-to-DAG Traceability minting), so no fixed unlock schedule — tokens appear as contributions are made.

These schedules mean investor liquid-returns materialize gradually over years, not in single large events.

## Comparison vs. public crypto markets

Benchmark: $2M invested at seed stage in top-5% crypto projects 2015-2020 achieved:
- Median: ~50x (if held through 2025).
- 90th percentile: ~500x.
- 10th percentile: ~2x.

VibeSwap's expected return is in line with top-quartile crypto seed investments, with the caveat that crypto-market conditions 2026-2030 may differ from 2015-2020 (regulatory, macro).

## The risks

Honest enumeration:

1. **Execution risk**: core team fails to deliver on roadmap. Mitigation: publicly-visible cadence; team track record; distributed contributor base.
2. **Market risk**: crypto winter 2027-2029. Mitigation: protocol continues operating; just liquid-returns delayed.
3. **Regulatory risk**: token classifications change. Mitigation: Augmented Governance hierarchy designed for regulatability.
4. **Competition risk**: well-funded competitor enters 2027. Mitigation: attention-graph moat; continuous publication.
5. **Technology risk**: critical exploit. Mitigation: conservative launch; extensive audits; bug-bounty program.
6. **Founder risk**: Will or key team member departs. Mitigation: distributed decision-making; [Mind Persistence Mission](./MIND_PERSISTENCE_MISSION.md) for knowledge continuity.
7. **Category risk**: "coordination primitive" fails to emerge as a category. Mitigation: educational partnerships via Eridu Labs.

Each risk has specific mitigation, but mitigations don't eliminate risk — they reduce it.

## Use of proceeds ($2.0M raise)

- $400K — security audits (two independent firms, full coverage).
- $800K — protocol-owned liquidity deployment.
- $300K — bounty + security operations.
- $500K — team runway (12-18 months at current burn).

Each category mapped to specific milestones; allocations adjust based on actual need.

## Why VibeSwap is a credible investment

Despite risks, several factors favor this investment:

1. **Novel, defensible positioning**. "Coordination primitive, not casino" is a real differentiator.
2. **Substantive underlying work**. The technical + philosophical foundation is substantial and public.
3. **Demonstrated execution cadence**. Hundreds of commits; regular publication; consistent discipline.
4. **Meaningful time horizon**. 4-5 year path to liquid returns matches typical venture timing.
5. **Large addressable market**. Coordination-primitive market is multi-trillion long-term.
6. **Aligned team**. Core team holds tokens with standard vesting; incentives aligned with long-term success.

## What a potential investor should do

Before committing:
- Read the 30-doc content pipeline (this set). Judge the intellectual substance.
- Review the repo (public). Judge the technical substance.
- Talk to the team. Judge personal fit.
- Model your own scenario probabilities. Don't take ours.
- Consider your portfolio allocation; a single speculative position should be sized accordingly.

After committing:
- Track cadence metrics (commits per week, contributor count growth, integration progress).
- Participate in governance if aligned with P-000 and P-001.
- Hold for the time horizon; early liquidation defeats the thesis.

## One-line summary

*Expected return 30-500x over 4-5 years under stated probability weights (45% dominant / 35% niche / 20% underdog); ~75x post-dilution central estimate; material risks in execution, market, regulation, competition, technology, founder, category — each with specific mitigation. Not a promise; a transparent model with stated assumptions.*
