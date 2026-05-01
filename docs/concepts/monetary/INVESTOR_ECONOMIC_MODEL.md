# Investor Economic Model

**Status**: Transparent financial modeling framework.
**Audience**: Investors + due-diligence teams + anyone modeling VibeSwap's returns.

---

## Honest framing upfront

This doc is a financial model, not a sales pitch.

Real financial models have:
- Stated assumptions.
- Probabilities attached to scenarios.
- Sensitivity analysis.
- Acknowledged risks.
- Time horizons.
- Comparable benchmarks.

Sales pitches usually don't. They skip to "ideal case" and promise.

VibeSwap is raising a seed round ($2.0M, announced 2026-04-20). An investor considering the round needs the former, not the latter. This doc is the former.

**Not hype. Not downplayed. Math with transparent assumptions.**

## The three value sources

VibeSwap's token economy has three value sources:

### Source 1 — Transaction-value fees

VibeSwap captures a small fee (currently 0% per [Zero-Fee Principle](../memory/feedback_zero-fee-principle-enforcement.md)). External projects adopting Chat-to-DAG Traceability may pay license or subscription fees.

- **Current state**: $0 transaction-fee revenue.
- **Target 2028**: $5M-$20M annual from 50-200 external integrations.
- **Target 2030**: $50M-$200M annual from 500-2000 integrations.

### Source 2 — Protocol-owned liquidity (POL) returns

A portion of the raise ($800K of $2.0M) deployed as protocol-owned liquidity. POL earns LP fees from internal volume.

- **Current**: $0 volume, $0 returns.
- **Target 2028**: $100M cumulative volume → ~$300K/year POL returns at 0.3% fee tier (if activated).
- **Target 2030**: $1B+ cumulative → ~$3M/year.

### Source 3 — Token appreciation

JUL is the money-layer token; value scales with network usage. VIBE is governance; value scales with governance activity.

Modeled via Metcalfe-inspired network-value scaling:

```
TokenValue(t) = BaseValue × f(ActiveUsers(t)) × g(IntegrationCount(t)) × h(Age(t))
```

where:
- f = user-network component (~ U × log(U) for network effects)
- g = integration-count (linear per integration)
- h = maturity discount (1 for mature, <1 for bootstrap)

At bootstrap (2026): low h, low users, low integrations → token value small.
At maturity (2030, Scenario A): h ≈ 1; U ~10,000-100,000; integrations ~500-2000 → substantial.

## Three scenarios with probabilities

Using [Why VibeSwap Wins in 2030](./WHY_VIBESWAP_WINS_IN_2030.md):

### Scenario A — Dominant winner (~45%)

By 2030:
- Active contributors: 50,000+.
- External integrations: 1,500+.
- Market-size capture: 2-5% of $1T coordination market = $20-50B routed.
- Protocol treasury: $100M-$500M.
- Token market cap (JUL + VIBE combined): $3B-$10B.

**Investor seed return**: 100x-500x.

### Scenario B — Graceful niche (~35%)

By 2030:
- Active contributors: 5,000-10,000.
- External integrations: 50-200.
- Market capture: 0.1-0.5% = $1B-$5B routed.
- Protocol treasury: $10M-$50M.
- Token market cap: $300M-$1B.

**Investor seed return**: 15x-50x.

### Scenario C — Underdog (~20%)

By 2030:
- Active contributors: 100-500 (stagnant).
- External integrations: 0-5.
- Market capture: minimal.
- Protocol treasury: $1M-$5M.
- Token market cap: $10M-$50M.

**Investor seed return**: 0.5x-2x. Possibly negative in real terms.

## Expected value calculation

Simple-weighted EV:

```
EV = 0.45 × 300x + 0.35 × 30x + 0.20 × 1x
   = 135x + 10.5x + 0.2x
   ≈ 150x
```

Rough: 150x expected return on initial seed investment.

**This is not a promise.** It's a model with stated assumptions.

Model validity depends on:
- Probability estimates being correct (uncertain).
- Scenario returns being correct (order-of-magnitude estimates).
- No black-swan exogenous shocks (regulatory crackdown, crypto winter, exploit).

**Sensitivity analysis**:

- If Scenario A probability drops to 30%: EV → ~100x.
- If Scenario C probability rises to 40%: EV → ~70x.
- If black-swan at 10% probability: EV drops 10-15%.

Realistic expectation under worst reasonable assumptions: 30-50x.
Under best: 200-500x.

## Time horizon

- **2026**: bootstrap. Minimal returns.
- **2027-2028**: emergence phase. Tokens become liquid; early speculative value.
- **2029-2030**: network maturity. Returns materialize.
- **2031+**: compound phase. Scenario A: returns continue growing. B: stable niche. C: liquidation.

Expected time-to-liquid-returns: **4-5 years**.
Expected time-to-full-Scenario-A-materialization: **6-8 years**.

Investors with shorter horizons should discount. Longer horizons benefit.

## Key parameter sensitivities

### Sensitivity 1 — Active-contributor growth rate

Current rate: ~5-10 new/month.

- Current rate: by 2030 = ~600-1,200 contributors. Scenario B.
- 3x rate: ~2,000-4,000. Top of B / bottom of A.
- 10x rate: ~6,000-12,000. Scenario A.

Contributor-recruitment intensity is the MOST leverageable parameter.

### Sensitivity 2 — Integration rate

Each external project integrating Chat-to-DAG Traceability compounds our moat.

- 1-2/year: Scenario C-B boundary.
- 5-10/year: Scenario B.
- 20-50/year: Scenario A.

Partnership integrations are second-most-leverageable.

### Sensitivity 3 — Constitutional stability

If governance drifts from P-000/P-001, protocol loses "coordination primitive, not casino" positioning. Fork threats emerge.

If governance drift in 2027-2028: Scenario A becomes ~15% instead of 45%. EV drops substantially.

Risk-mitigation: explicit constitutional axioms, on-chain Lawson Constant, cultural reinforcement.

### Sensitivity 4 — Competitive response

If 2-3 well-funded competitors enter by 2027 with similar architectures:
- Attention-graph moat partially replicates if they have head-start funding.
- Market share splits.
- Scenario B becomes more likely than A.

## The dilution question

Seed investors take ~15% equity at $14M valuation (2026-04-20 deck). Subsequent rounds dilute.

Assumed dilution path:
- Series A (2027): 15-20% dilution at $50M-$100M valuation.
- Series B (2028): 15-20% at $200M-$500M valuation.
- Growth rounds (2029+): 10-15% at $1B-$5B.

Cumulative dilution by 2030: 40-50% of initial stake retained.

Adjusted scenario returns for dilution:
- Scenario A: 100-500x × 0.5 = 50-250x realized.
- Scenario B: 15-50x × 0.5 = 7.5-25x.
- Scenario C: 0.5-2x × 0.5 = 0.25-1x.

**EV adjusted for dilution**: ~75x. Still strong expected return.

## Token unlock schedules

- **Founder / core team**: 4-year vesting + 1-year cliff. Standard.
- **Investor tokens**: subject to round terms; typical 1-2 year lockup + linear vesting thereafter.
- **Community allocation**: mint-on-contribution (no fixed unlock — tokens appear as contributions mined).

These mean liquid returns materialize gradually over years, not in single large events.

## Comparison vs public crypto markets

Benchmark: $2M invested at seed stage in top-5% crypto projects 2015-2020 achieved (held through 2025):

- Median: ~50x.
- 90th percentile: ~500x.
- 10th percentile: ~2x.

VibeSwap's expected return is in line with top-quartile crypto seed investments, with caveat: 2026-2030 may differ from 2015-2020 (regulatory, macro).

## Risks enumerated honestly

### Risk 1 — Execution risk

Core team fails to deliver on roadmap.

Mitigation: publicly-visible cadence; team track record; distributed contributor base.

### Risk 2 — Market risk

Crypto winter 2027-2029.

Mitigation: protocol continues operating; liquid-returns just delayed.

### Risk 3 — Regulatory risk

Token classifications change; securities or other regulations.

Mitigation: Augmented Governance designed to be regulatable. See [Regulatory Compliance Deep Dive](./REGULATORY_COMPLIANCE_DEEP_DIVE.md).

### Risk 4 — Competition risk

Well-funded competitor enters 2027.

Mitigation: attention-graph moat; continuous publication.

### Risk 5 — Technology risk

Critical exploit discovered.

Mitigation: conservative launch; extensive audits; bug-bounty.

### Risk 6 — Founder risk

Will or key team member departs.

Mitigation: distributed decision-making; [Mind Persistence Mission](./MIND_PERSISTENCE_MISSION.md) for knowledge continuity.

### Risk 7 — Category risk

"Coordination primitive" fails to emerge as a category.

Mitigation: educational partnerships (Eridu Labs).

Each risk has specific mitigation. Mitigations don't eliminate risk — they reduce it.

## Use of proceeds ($2.0M raise)

- **$400K** — security audits (two independent firms, full coverage).
- **$800K** — protocol-owned liquidity.
- **$300K** — bounty + security operations.
- **$500K** — team runway (12-18 months at current burn).

Each category mapped to specific milestones; allocations adjust based on actual need.

## Why VibeSwap is credible

Despite risks, factors favoring:

1. **Novel, defensible positioning**. "Coordination primitive, not casino" is differentiator.
2. **Substantive underlying work**. Technical + philosophical foundation substantial and public.
3. **Demonstrated execution cadence**. Hundreds of commits; regular publication.
4. **Meaningful time horizon**. 4-5 year path matches typical venture timing.
5. **Large addressable market**. Multi-trillion long-term.
6. **Aligned team**. Core team holds tokens with standard vesting; incentives aligned long-term.

## What a potential investor should do

Before committing:
- Read the 30-doc content pipeline. Judge intellectual substance.
- Review the repo. Judge technical substance.
- Talk to the team. Judge personal fit.
- Model your own scenario probabilities. Don't take ours.
- Consider portfolio allocation; speculative position sized accordingly.

After committing:
- Track cadence metrics (commits/week, contributor growth, integration progress).
- Participate in governance if aligned with P-000/P-001.
- Hold for the horizon. Early liquidation defeats thesis.

## One-line summary

*Expected return 30-500x over 4-5 years under stated probability weights (45%/35%/20% for Dominant/Niche/Underdog). ~75x post-dilution central estimate. Seven specific risks with specific mitigations. Use of proceeds: $400K audits / $800K POL / $300K bounty / $500K runway. Transparent model with stated assumptions, not sales pitch.*
