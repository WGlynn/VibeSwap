# NCI Weight Function — Formal Treatment

**Status**: Live in `contracts/consensus/NakamotoConsensusInfinity.sol`.
**Depth**: Mathematical form, pillar balance rationale, phase behavior, failure modes.
**Related**: [Why Three Tokens Not Two](./WHY_THREE_TOKENS_NOT_TWO.md), [Non-Code Proof of Work](./NON_CODE_PROOF_OF_WORK.md), [Augmented Governance](./AUGMENTED_GOVERNANCE.md), [ETM Build Roadmap](./ETM_BUILD_ROADMAP.md).

---

## The function

For validator `v`:

```
W(v) = 0.10 × log₂(1 + cumulative_PoW_v)       // work pillar
     + 0.30 × stakedVIBE_v × POS_SCALE           // stake pillar (linear)
     + 0.60 × log₂(1 + mindScore_v)              // mind pillar
```

Weights in basis points:
- **POW_WEIGHT_BPS** = 1000 (10%)
- **POS_WEIGHT_BPS** = 3000 (30%)
- **POM_WEIGHT_BPS** = 6000 (60%)

Total: 10,000 basis points = 100%.

The `log₂` on PoW and PoM is load-bearing — diminishing returns prevent unbounded concentration. Stake is linear because stake already has a cost proxy (opportunity cost + slashing risk).

## The paradigm NCI breaks

*"Consensus is about picking one pillar: PoW or PoS."*

Bitcoin chose PoW. Ethereum chose PoS. The conventional framing is PoW-vs-PoS, as if they're rival alternatives. Projects pick one.

NCI rejects this. PoW and PoS and PoM aren't rivals — they're **distinct axes** of legitimate authority, and a durable consensus weighs all three. A validator with high work commitment but no stake is suspect (Sybil risk). A validator with high stake but no work is suspect (absentee). A validator with both but no mind-contribution is missing the cognitive-economic pillar VibeSwap exists to capture.

Three pillars, one formula, heterogeneous types welcomed.

## Why the three coefficients

**10/30/60** — why these specific weights?

### Why PoM dominates (60%)

VibeSwap's value proposition is cognitive-economy externalization. The mind pillar IS the value-creating axis. Weighting it below the other pillars would signal that VibeSwap is not really different from prior PoW/PoS projects.

60% is dominant but not absolute. A validator with pure PoM and no PoW/PoS can't reach the highest weights — some material stake and work commitment are required to participate legitimately. Pure "idea guys" without skin in the game don't dominate.

### Why PoS is middle (30%)

Stake has real cost (capital locked + slashing risk) so it genuinely signals commitment. But stake without work or mind means absentee capital — validator who locked tokens but doesn't participate substantively.

30% weight means stake matters but doesn't dominate. Even a large staker can be outweighed by a modest-stake validator who contributes substantially in PoW and PoM.

### Why PoW is lowest (10%)

PoW in VibeSwap context is different from Bitcoin PoW. It's computational work contributing to the network (e.g., running oracle computation, contributing to the PoW-mining that backs JUL). Not a pillar in and of itself but a signal of infrastructure commitment.

10% is meaningful but not decisive. It prevents pure-PoM validators from completely dominating (PoW + PoS together = 40%, requires real resource commitment).

## The log₂ choice

PoW and PoM use log₂ scaling; stake is linear. Why?

### PoW log₂

Bitcoin's lesson: linear PoW leads to mining concentration. The largest miners dominate regardless of security value delivered. Log₂ scaling means a miner with 4× the computational power has 2× the weight, not 4×. Concentration is dampened.

In the limit: a miner with 10^9 cumulative PoW has weight ≈ 30 (log₂(10^9) ≈ 30). A miner with 10^4 cumulative PoW has weight ≈ 13. The ratio of weights (30:13) is far less extreme than the ratio of raw PoW (10^9 : 10^4 = 100,000:1).

### PoM log₂

Same reasoning. Without log₂, a heavily-cited contributor would accumulate arbitrary PoM weight through cumulative attestations. Log₂ caps the growth, preventing any single contributor from becoming a consensus dictator through reputation alone.

### Stake linear

Stake has natural limits — validators can only commit capital they own. The natural scarcity bounds concentration without needing mathematical dampening.

Linear is also the simpler accounting. Slashing at N% of stake is clear. Log₂ would make slashing non-obvious.

## The pillar-balance equilibrium

A balanced validator — one equally committed across pillars — has the highest effective weight per unit of total commitment. Specifically:

- Weight grows as log in PoW and PoM, linearly in PoS.
- A validator who over-invests in one pillar (e.g., huge stake, minimal work and mind) sees diminishing total returns.
- A validator who under-invests hurts the 10/30/60 mixture — missing the dominant pillar (PoM) costs 60% of potential.

This incentivizes multi-dimensional participation. Pure speculators (all stake, no work or mind) are relatively under-weighted. Pure idealists (all mind, no stake or work) are similarly under-weighted. Balanced validators — stake + work + mind — are structurally advantaged.

## Slashing parameters

- **EQUIVOCATION_STAKE_SLASH_BPS** = 5000 (50%)
- **EQUIVOCATION_MIND_SLASH_BPS** = 7500 (75%)
- **PoW** is NOT slashed (it's cumulative work; can't un-do).

Mind is slashed harder than stake — 75% vs 50%. Why?

Because mind is social. A validator caught equivocating damages the trust-graph's integrity. The cognitive-economic substrate's "trust capital" is what's most violated; the mind-slash penalty reflects that.

Equivocation also slashes unbonding amounts (validators who request withdrawal mid-attack don't escape the penalty).

## Phase behavior

### Phase 1 — Bootstrap (current, 2026-04-22)

- Few validators (<100).
- Mostly unbalanced — early validators have high stake (founders) or high PoM (early contributors) but not yet both.
- Total weight is concentrated in a few nodes.

NCI behaves approximately as PoM-dominated under these conditions (founders have high PoM from early contribution credit).

### Phase 2 — Growth (6-18 months)

- Validator count grows to ~500-2000.
- Pillar distribution diversifies — new validators may enter with different pillar mixes.
- Total weight spreads; no single validator dominates.

### Phase 3 — Saturation (3+ years)

- Thousands of validators.
- log₂ scaling means even the largest-pillar validators have bounded weight.
- Consensus is broad; single-actor capture is infeasible.

The three phases are predicted, not observed. Validation against empirical data is ongoing.

## Failure modes

### Failure mode 1 — Cartel coordination

Several high-stake validators coordinate off-chain. Together their stakes might dominate the 30% PoS pillar.

Mitigation:
- 30% max on PoS pillar means even 100% stake control = 30% total weight.
- Log₂ on PoW and PoM prevent cartel from also dominating those pillars.
- Governance can override in extreme cases via the legislative branch.

### Failure mode 2 — Mind-score inflation

High-PoM validators attest each other's contributions, inflating their collective mind-score.

Mitigation:
- [Three-branch attestation](./CONTRIBUTION_ATTESTOR_EXPLAINER.md) — cartel in executive branch doesn't capture tribunal or governance.
- [Novelty Bonus](./THE_NOVELTY_BONUS_THEOREM.md) penalizes replication (coordinated attestations of similar-looking claims get reduced marginal credit).
- log₂ dampens the payoff from inflation.

### Failure mode 3 — Sybil PoW

Attacker splits their PoW contribution across many identities to get more per-unit credit.

Actually doesn't help under log₂: N validators each with C PoW sum to `N × log₂(1+C)`, which is less than `log₂(1+N×C)` for meaningful N and C (by Jensen's inequality). Concentration is already penalized; splitting compounds the penalty.

### Failure mode 4 — Absentee validators

Validators with large stake (high PoS weight) but no active participation.

Mitigation: active-validator requirement — the `totalActiveWeight` tracking only counts validators who actively participate in epoch operations. Absentees lose active status over time.

## Gap #1 in ETM Alignment Audit

Current retention-weight function uses linear decay. [ETM Build Roadmap Gap #1](./ETM_BUILD_ROADMAP.md) notes this should be convex (state-rent-like) with α ≈ 1.6.

This is a separate dimension from the NCI weight function itself — the NCI formula combines pillars; the retention-weight-decay is a time-modifier that should be applied to each pillar's cumulative. Current implementation has it applied linearly; target is convex.

Fix planned for C40 per the Roadmap.

## Relationship to Shapley

NCI's weight function determines consensus power. Shapley's value determines reward distribution. They're different but related — both use the accumulated contribution signals (PoW, PoS, PoM) as input but for different purposes.

A validator with high NCI weight gets more say in consensus decisions. A contributor with high Shapley values gets more rewards. The same person can be both; the mechanisms route their contributions differently.

## Relationship to ETM

[Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) frames consensus as aggregated belief from heterogeneous agents. The NCI weight function IS the aggregation formula for heterogeneous-agent consensus — each agent type contributes to the aggregate with appropriate weighting.

Pure-PoW consensus = only hash-crunching agents count. Pure-PoS = only capital-holders count. NCI = work + capital + mind all count, with mind dominating per VibeSwap's thesis.

## One-line summary

*W = 0.10×log₂(1+PoW) + 0.30×stake + 0.60×log₂(1+mindScore) — three heterogeneous pillars, mind dominates, log₂ prevents concentration, 50/75/0 slashing makes mind the most-penalized for misbehavior. Multi-dimensional consensus as the cognitive-economy mirror.*
