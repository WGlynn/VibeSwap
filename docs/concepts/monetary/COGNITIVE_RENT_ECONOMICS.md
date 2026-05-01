# Cognitive Rent Economics

**Status**: Theoretical deepening of [Economic Theory of Mind](../etm/ECONOMIC_THEORY_OF_MIND.md).
**Audience**: First-encounter OK. Numbers walked through with linear-vs-convex contrast.

---

## An everyday observation

You learn five new Spanish words on Monday. By Wednesday, you can recall three. By Friday, two. By next Monday, one.

You learn five new Spanish words on a quiet vacation day. By Wednesday (one day later), you can recall all five. By Friday, three. By next Monday, two.

Same five words. Same time elapsed. Different retention rates.

Why? Because during the busy week, your attention was heavily loaded. Retaining the Spanish words competed with many other things for limited attention-budget. During the vacation, there was more attention-budget per fact.

This is cognitive rent economics. State in your mind pays rent in the form of attention. When total active state exceeds budget, some state must get evicted.

## The direct parallel

CKB state-rent works the same way:

- Storage costs ongoing fees.
- Accounts with funded deposits pay rent.
- Unpaid storage gets evicted.
- Total state-on-chain is bounded by aggregate rent-paying capacity.

Your mind is rent-charging attention on active facts. CKB is rent-charging tokens on active state. Same pattern; different substrates.

## The theoretical claim

The mathematics governing both systems is identical. Specifically:

- **Retention cost is a monotonically-increasing function of current active load.** More state active = each state costs more to retain.
- **Retention cost is convex in load.** Doubling active state more-than-doubles per-state cost.
- **Eviction fires when cumulative unpaid-rent exceeds some threshold.**

These three properties together describe:
- Cognitive memory.
- CKB state-rent.
- Computer CPU cache (LRU with adjustable thresholds).
- Server-storage economics with usage fees.

The pattern is universal for rent-based eviction systems.

## Why convexity is load-bearing

Let's make this concrete. Suppose retention cost is:

```
R(load) = base × (load/capacity)^α
```

where α is the "convexity exponent".

### Linear case (α = 1)

Load = 10% of capacity → cost = 10% of base.
Load = 50% → cost = 50%.
Load = 90% → cost = 90%.

Linear scaling. Doubling load doubles cost.

### Convex case (α = 1.6)

Load = 10% → cost = 10%^1.6 ≈ 4% of base.
Load = 50% → cost = 50%^1.6 ≈ 33%.
Load = 90% → cost = 90%^1.6 ≈ 84%.

Convex scaling. Below 50% load, cost is sub-linear (cheap). Above 90%, cost is nearly maxed out.

### Phase behavior of each

**Linear**: Retention cost grows predictably. No phase transitions. Evictions happen at a steady rate.

**Convex**: Below the "knee" (around 50-70% load), retention is cheap and plentiful. Above the knee, retention cost rises sharply and evictions accelerate.

**Which matches cognition?**

Observation: when your mind is lightly loaded, you remember almost everything. When heavily loaded, you forget much and get cognitive overload. The transition is NOT gradual — it's sudden.

This is the convex pattern. α ≈ 1.4-1.7 empirically. Matches Ebbinghaus and modern replications.

## Why VibeSwap's NCI currently has a gap here (reconciled 2026-04-23)

**Earlier drafts said NCI applies linear retention `base - k × t`. Verification against the contract shows no time-decay is applied at all — `cumulativePoW` is monotone-cumulative and `mindScore` is refresh-on-demand.**

The real gap is: ABSENT. Where cognitive substrate demands convex retention on the work-and-mind pillars, NCI has nothing.

The fix per [ETM Build Roadmap](../etm/ETM_BUILD_ROADMAP.md) Gap #1 is to add convex decay where it belongs (PoW and PoM — not PoS, since stake is present-tense locked capital, not a historical record):

```
retentionWeight(t) = base × (1 - (t/T)^α)
```

with α ≈ 1.6. This matches cognitive substrate geometry per paper §6.4.

### Shipped C40 (2026-04-23)

Pure primitive `calculateRetentionWeight(elapsedSec, horizonSec)` landed in NCI with α hardcoded at 1.6 via cubic polynomial approximation. Returns basis-points weight; max ~3% error vs exact. Not yet wired into per-pillar weight recompute — see [NCI_WEIGHT_FUNCTION.md](../identity/NCI_WEIGHT_FUNCTION.md#shipped-c40-2026-04-23) for the six design decisions gating integration (C40b).

## Worked example — the linear-vs-convex difference

Suppose a contributor's mindScore is 1000 (max). It decays over T = 365 days.

### Under linear (current, incorrect)

Day 1: 1000 × (1 - 1/365) ≈ 997.3
Day 30: 1000 × (1 - 30/365) ≈ 917.8
Day 180: 1000 × (1 - 180/365) ≈ 506.8
Day 365: 1000 × (1 - 365/365) = 0

Linear decay. Half-remembered at 6 months.

### Under convex (α = 1.6, proposed)

Day 1: 1000 × (1 - (1/365)^1.6) ≈ 999.98
Day 30: 1000 × (1 - (30/365)^1.6) ≈ 986
Day 180: 1000 × (1 - (180/365)^1.6) ≈ 662
Day 365: 1000 × (1 - (365/365)^1.6) = 0

Convex decay. Much slower initial decay; sharper drop in final months.

**Key differences**:
- At 1 month, convex retains 986 vs linear's 918. (Convex is kinder to recent contributions.)
- At 6 months, convex retains 662 vs linear's 507. (Convex still more generous.)
- At 11 months, convex accelerates; drops closer to zero.

Convex matches observed cognitive decay. Linear doesn't.

## Why this matters for VibeSwap

The bug has a real cost. Under linear:
- Short-term contributors get slightly less credit than they should.
- Mid-term contributors get much more than they should.
- The decay doesn't accelerate in final months; old contributions persist longer than their real value.

Fix shipping in C40 (per Build Roadmap). After the fix, retention-weight function matches the cognitive substrate's actual geometry.

## The four phases (observable in both substrates)

When retention cost is convex, the system exhibits four characteristic phases:

### Phase 1 — Below the knee (underloaded)

**Cognitive**: mind feels spacious. Can add more facts without strain.

**On-chain**: state-rent is cheap. Lots of storage available per dollar.

### Phase 2 — Approaching the knee (moderate load)

**Cognitive**: mind feels full. Adding more facts starts to feel effortful.

**On-chain**: state-rent is ramping up. Users start to feel the cost.

### Phase 3 — Past the knee (overloaded)

**Cognitive**: mind feels overloaded. Eviction cascades start; some important facts slip.

**On-chain**: gas-crisis. Users can't afford the rent. Eviction threats accelerate.

### Phase 4 — Collapse (severely overloaded)

**Cognitive**: cognitive burnout. Substrate contracts; even recently-funded state gets evicted.

**On-chain**: eviction-cascade. Even funded state gets evicted because the system's aggregate capacity is exceeded.

These four phases are observable empirically in both substrates. Same mathematics; same dynamics.

## The α parameter's empirical grounding

Why α = 1.6? Because that's approximately what Ebbinghaus observed for human memory decay, across multiple replications over a century.

This is NOT a tuning choice. It's matching the substrate's geometry per [Substrate-Geometry Match](../SUBSTRATE_GEOMETRY_MATCH.md). If we choose α = 1.0, we get linear — mismatched to cognition. If we choose α = 3.0, we get super-convex — also mismatched (too steep).

Paper [`memory/feedback_augmented-mechanism-design-paper.md`](../memory/feedback_augmented-mechanism-design-paper.md) §6.4 recommends α = 1.6 based on these observations. <!-- FIXME: ../memory/feedback_augmented-mechanism-design-paper.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

## The retrieval-cost coupling

A secondary effect: when a fact is recently retrieved, its retention cost drops. Queries "refresh" the rent.

In cognition: thinking about a fact pays its rent for a while. Review cements memory.

In CKB: reading state refreshes its access-count. Frequently-read state is implicitly funded (assuming read-gas contributes back to rent).

VibeSwap doesn't currently implement this retrieval-coupling. It's a future refinement (not currently in the Build Roadmap; would be a V2+ consideration).

## The meta-observation

Cognitive rent economics isn't just a theory about brains. It's a pattern about ANY system with:
- Finite active capacity.
- Cost per unit capacity.
- Eviction when cost exceeds budget.

Examples of the pattern:
- **Brains**: attention budget, forget-without-rehearsal.
- **Chains**: storage budget, lose-state-without-rent.
- **CPU caches**: cache line budget, LRU eviction.
- **Humans in organizations**: attention budget; boring work gets forgotten.
- **Files on a laptop**: disk budget; backup gets deleted.

Recognizing the pattern lets you design mechanisms that match. Miss the pattern and you design linear mechanisms for convex substrates — which break at the knee.

## For students

Exercise: pick a retention system you use (your memory, your phone's storage, your Git repo, whatever). Characterize:

1. The budget (what's the total capacity?).
2. The per-unit cost (what does one unit of retention cost?).
3. The eviction trigger (what forces eviction?).
4. The convexity (how sharply does cost rise with load?).

Then plot: retention vs. load. Is it linear? Convex? Super-convex?

Compare to cognitive retention + CKB state-rent. Are the patterns similar?

## Relationship to other primitives

- **Parent**: [Economic Theory of Mind](../etm/ECONOMIC_THEORY_OF_MIND.md) — ETM's first bijection (memory decay ↔ state-rent) is what this doc elaborates.
- **Fix in the roadmap**: [ETM Build Roadmap](../etm/ETM_BUILD_ROADMAP.md) Gap #1 — NCI retention weight should be convex.
- **Instance**: NCI weight function ([`NCI_WEIGHT_FUNCTION.md`](../identity/NCI_WEIGHT_FUNCTION.md)).

## One-line summary

*Cognitive retention is governed by the same rent-with-convex-cost dynamics as CKB state-rent — four phases observable in both (underloaded, approaching-knee, overloaded, collapse). α ≈ 1.6 matches Ebbinghaus decay. VibeSwap's NCI currently uses linear (α=1); convex fix in C40. Pattern generalizes to any budget-constrained retention system.*
