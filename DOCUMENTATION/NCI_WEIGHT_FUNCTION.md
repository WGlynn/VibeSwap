# NCI Weight Function — Formal Treatment

**Status**: Live in `contracts/consensus/NakamotoConsensusInfinity.sol`.
**Audience**: First-encounter OK. Formula walked with numerical examples.

---

## Start with an observation about consensus

Bitcoin pioneered one kind of consensus: Proof of Work. Mine hash puzzles. Longest chain wins. Elegant but energy-intensive.

Ethereum moved to another: Proof of Stake. Stake ETH. Validators chosen proportional to stake. Less energy but introduces plutocracy risk (richest validators have most influence).

Most newer chains pick ONE of these. The framing "PoW vs PoS" treats them as rival alternatives.

VibeSwap rejects this framing. PoW and PoS aren't rivals. Neither is PoM (Proof of Mind). They're three DISTINCT axes of legitimate authority. A durable consensus should weigh all three, not arbitrarily pick one.

That's what NCI does.

## The formula

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

The `log₂` on PoW and PoM is load-bearing. Stake is linear.

## Walk through an example

Let me compute W for a specific validator.

**Validator Alice**:
- Cumulative PoW: 1,000,000 work units mined.
- Staked VIBE: 1,000 units.
- Mind score: 100 attestations-weight.

### PoW component

`log₂(1 + 1,000,000) ≈ log₂(1,000,001) ≈ 19.93`

Weighted: `0.10 × 19.93 = 1.99`

### PoS component

`stake × POS_SCALE` — suppose POS_SCALE normalizes to same units as PoW component. Let's say `POS_SCALE = 0.01` such that 1000 stake = 10 in weighted units.

Weighted: `0.30 × 10 = 3.00`

### PoM component

`log₂(1 + 100) ≈ log₂(101) ≈ 6.66`

Weighted: `0.60 × 6.66 = 3.99`

### Total

W(Alice) = 1.99 + 3.00 + 3.99 = **8.98**

## Compare two validators

Let me compare Alice to a pure-stake validator Bob.

**Bob**:
- Cumulative PoW: 0 (never mined).
- Staked VIBE: 10,000 units (much more than Alice).
- Mind score: 0 (no attestations received).

W(Bob) calculations:

- PoW: `0.10 × log₂(1) = 0` ← log₂ of 1 is 0, so Bob's PoW contribution = 0.
- PoS: `0.30 × 100 = 30` (10x Alice's stake → 10x weighted)
- PoM: `0.60 × 0 = 0`

W(Bob) = 0 + 30 + 0 = **30**.

**Bob has much higher weight than Alice despite 0 PoW and 0 PoM.**

That's the PoS-dominant pattern. Bob is a whale; he dominates via capital.

### Now compare Alice to a PoM-heavy validator

**Carol**:
- Cumulative PoW: 1,000,000 (same as Alice).
- Staked VIBE: 1,000 (same as Alice).
- Mind score: 10,000 (100x Alice's).

W(Carol):
- PoW: `0.10 × log₂(1,000,001) ≈ 1.99`
- PoS: `0.30 × 10 = 3.00`
- PoM: `0.60 × log₂(10,001) ≈ 0.60 × 13.29 ≈ 7.97`

Total: 1.99 + 3.00 + 7.97 = **12.96**

**Carol has higher weight than Alice due to her mind-score.** But her mind-score is 100x Alice's, and her final weight is only ~1.5x higher. The `log₂` scaling prevents disproportionate influence.

## Why PoM dominates (60%)

VibeSwap's value proposition is cognitive-economy externalization. The mind pillar IS the value-creating axis.

Weighting it below the other pillars would signal VibeSwap is not really different from prior PoW/PoS projects.

60% is dominant but not absolute. A validator with PURE PoM and no PoW/PoS (Carol with zero stake, zero PoW) would max out at: `0.60 × log₂(1 + mindScore)` = substantial but not infinite.

At `mindScore = 10^6`: `0.60 × log₂(10^6) ≈ 0.60 × 20 = 12`.

A pure-PoM validator with 1M attestations has weight ~12. Alice (balanced) has ~9. Bob (pure-PoS whale at 10,000 stake) has 30.

Pure-PoM dominance requires astronomical attestation accumulation. At realistic scales, balanced validators outweigh specialists.

## Why PoS is middle (30%)

Stake has real cost (capital locked + slashing risk) so it signals commitment. But stake without work or mind means ABSENTEE CAPITAL — validator who locked tokens but doesn't participate.

30% weight: stake matters but doesn't dominate. Even a large staker can be outweighed by a modest-stake validator contributing substantially in PoW and PoM.

## Why PoW is lowest (10%)

PoW here is contribution to network computation (oracle work, JUL backing), not Bitcoin-style hash racing.

10% is meaningful but not decisive. Prevents pure-PoM validators from completely dominating (PoW + PoS together = 40%, requiring real resource commitment).

## The log₂ choice

Why log₂ on PoW and PoM, and linear on stake?

### PoW log₂ rationale

Bitcoin's lesson: linear PoW leads to mining concentration. Largest miners dominate regardless of security value delivered.

Log₂ scaling: miner with 4× computational power has 2× weight (not 4×). Concentration dampened.

At extremes:
- 10^9 cumulative PoW: weight ≈ 30.
- 10^4 cumulative PoW: weight ≈ 13.
- Ratio: 30:13 (far less extreme than raw 10^9:10^4 = 100,000:1).

### PoM log₂ rationale

Same. Without log₂, a heavily-cited contributor accumulates arbitrary PoM weight through cumulative attestations. Log₂ caps growth; no single contributor becomes consensus dictator through reputation alone.

### Stake linear rationale

Stake has natural limits — validators can only commit capital they own. Natural scarcity bounds concentration without needing mathematical dampening.

Linear is also simpler for slashing accounting.

## The pillar-balance equilibrium

A balanced validator — equally committed across pillars — has highest effective weight per unit of total commitment.

- Weight grows as log in PoW + PoM, linearly in PoS.
- Over-invest in one pillar (e.g., huge stake, minimal work/mind) → diminishing returns from that pillar, nothing from others.
- Under-invest hurts 10/30/60 balance — missing dominant pillar costs 60% of potential.

This INCENTIVIZES multi-dimensional participation. Pure speculators (all stake) under-weighted. Pure idealists (all mind, no stake or work) under-weighted. Balanced validators structurally advantaged.

## Slashing parameters

- **EQUIVOCATION_STAKE_SLASH_BPS** = 5000 (50%)
- **EQUIVOCATION_MIND_SLASH_BPS** = 7500 (75%)
- **PoW** is NOT slashed (cumulative work; can't un-do).

Mind is slashed harder than stake — 75% vs 50%. Why?

Mind is social. A validator caught equivocating damages the trust-graph's integrity. The cognitive-economic substrate's "trust capital" is most violated; mind-slash reflects this.

Equivocation also slashes unbonding amounts (validators requesting withdrawal mid-attack don't escape).

## Phase behavior

### Phase 1 — Bootstrap (current, 2026-04-22)

- Few validators (<100).
- Mostly unbalanced — early validators have high stake (founders) or high PoM (early contributors) but not yet both.
- Total weight concentrated in few nodes.

NCI behaves approximately as PoM-dominated (founders have high PoM from early contribution credit).

### Phase 2 — Growth (6-18 months)

- Validator count grows to ~500-2000.
- Pillar distribution diversifies.
- Total weight spreads; no single validator dominates.

### Phase 3 — Saturation (3+ years)

- Thousands of validators.
- log₂ scaling means even largest-pillar validators have bounded weight.
- Consensus broad; single-actor capture infeasible.

## Failure modes analyzed

### Cartel coordination

Several high-stake validators coordinate off-chain. Together their stakes might dominate PoS pillar.

Mitigation:
- 30% max on PoS means even 100% stake control = 30% total weight.
- log₂ on PoW and PoM prevent cartel from also dominating those pillars.
- Governance can override extreme cases.

### Mind-score inflation

High-PoM validators attest each other's contributions.

Mitigation:
- Three-branch attestation ([`CONTRIBUTION_ATTESTOR_EXPLAINER.md`](./CONTRIBUTION_ATTESTOR_EXPLAINER.md)) — cartel in executive branch doesn't capture others.
- [Novelty Bonus](./THE_NOVELTY_BONUS_THEOREM.md) penalizes replication.
- log₂ dampens inflation payoff.

### Sybil PoW

Attacker splits PoW across many identities.

Actually doesn't help under log₂. N validators each with C PoW sum to `N × log₂(1+C)`, which is less than `log₂(1+N×C)` for meaningful N and C (Jensen's inequality). Splitting is strictly penalized.

### Absentee validators

Validators with large stake (high PoS weight) but no active participation.

Mitigation: active-validator requirement. `totalActiveWeight` tracking only counts actively-participating validators. Absentees lose active status over time.

## Gap #1 in ETM Alignment Audit — reconciled 2026-04-23

**Earlier drafts of this doc (and [`COGNITIVE_RENT_ECONOMICS.md`](./COGNITIVE_RENT_ECONOMICS.md), and [`ETM_BUILD_ROADMAP.md`](./ETM_BUILD_ROADMAP.md)) asserted that NCI currently applies linear time-decay: `retentionWeight(t) = base - k × t`. Verification against the contract contradicts that.**

Actual on-chain state in `contracts/consensus/NakamotoConsensusInfinity.sol`:
- `cumulativePoW` is monotone-cumulative. No time-decay applied.
- `mindScore` is refresh-on-demand via `refreshMindScore()`. No time-decay applied.
- `stakedVibe` is linear in stake. No time-decay applied (and should not have one — active capital, not historical record).
- `totalActiveWeight` is an O(1) running total; no time-decay sweep exists.

So the gap is not "linear → convex." It's "retention not implemented; add convex where cognitive substrate demands it."

The confusion was load-bearing for a reason — it matters WHERE retention belongs. Not every pillar needs it:
- **PoW should decay**: cognitive parallel is mined-work-as-proof; relevance fades with time.
- **PoM should decay**: cognitive parallel is attention-to-prior-contributions; the exact substrate Ebbinghaus measured.
- **PoS should NOT decay**: stake is present-tense locked capital. Decay would double-count slashing/unbonding.

Retention is a PoW-and-PoM primitive, not a universal weight modifier.

### Shipped C40 (2026-04-23)

- **C40a — Pure primitive landed**: `calculateRetentionWeight(uint256 elapsedSec, uint256 horizonSec)` — returns retention in basis points (0 = fully decayed, 10000 = fresh).
- **α = 1.6 hardcoded** (paper §6.4). Implemented via cubic polynomial approximation `0.1744·x + 1.116·x² − 0.2904·x³`, max error ~3% vs exact `x^1.6` on [0, 1].
- **C40b — Wired into `vote()`**: per-vote weight now retention-adjusts the PoW+PoM portion (decayable record of historical relevance) while leaving the PoS portion untouched (locked capital is present-tense). Six design decisions from the C40a "deferred" list resolved:
  1. Decay anchor: `v.lastHeartbeat` (already stored).
  2. No per-pillar timestamps added.
  3. Query-time at single call site (`vote()`), not persisted.
  4. Horizon: `RETENTION_HORIZON_DEFAULT = 365 days`.
  5. `totalActiveWeight` stays O(1) (base weight); retention only affects accumulated `p.weightFor` / `p.weightAgainst`. Threshold unchanged.
  6. No migration; lastHeartbeat-as-anchor applies naturally for existing validators.
- **Governance-tunable α deferred** to C40c. When a real tuning need appears, the polynomial is swapped for a general-α formulation.

### Consensus dynamics after C40b

A stale validator's vote contributes LESS toward supermajority than a fresh one, but the 2/3 threshold denominator (total active weight) stays at base. Practical implication: if enough validators go stale, supermajority becomes structurally harder to reach — the network "wants" fresh heartbeats. This IS the intended ETM alignment; stale work cannot silently retain political weight.

A pure-stake validator (PoM=PoW=0) is unaffected by retention — they vote with constant PoS weight regardless of heartbeat age. Consistent with the principle that locked capital is not a historical record.

## Relationship to Shapley

NCI's weight determines CONSENSUS power. Shapley determines REWARD distribution.

Different concerns, related inputs. Both use cumulative contribution signals (PoW, PoS, PoM) but for different purposes.

A validator with high NCI weight gets more say in consensus. A contributor with high Shapley values gets more rewards. Same person can be both; mechanisms route contributions differently.

## Relationship to ETM

[Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) frames consensus as aggregated belief from heterogeneous agents. NCI IS the aggregation formula for heterogeneous-agent consensus — each agent type contributes with appropriate weighting.

Pure-PoW: only hash-crunching agents count.
Pure-PoS: only capital-holders count.
NCI: work + capital + mind all count, with mind dominating.

## For students

Exercise: compute W(v) for three validators with different pillar profiles:

**Validator 1**: heavy PoW (10M), modest stake (100), modest mind (50).
**Validator 2**: modest PoW (1K), heavy stake (10K), no mind.
**Validator 3**: modest PoW (1K), modest stake (100), heavy mind (10K).

Compare who has highest weight. Observe how the 10/30/60 weighting + log₂ scaling shapes outcomes.

## One-line summary

*NCI aggregates PoW + PoS + PoM with coefficients 0.10 / 0.30 / 0.60. log₂ on PoW and PoM prevents concentration (Bitcoin's lesson inverted); linear on stake (natural capital limit). Alice (balanced) beats Bob (pure-whale stake) in long run. Slashing 50% stake / 75% mind / 0% PoW — mind-slash is hardest because trust-capital is most damaged. Multi-dimensional consensus as cognitive-economy mirror.*
