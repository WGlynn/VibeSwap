# Cognitive Rent Economics

**Status**: Theoretical deepening of [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md).
**Depth**: Formalization, not restatement.

---

## The claim

State in a mind is rented, not owned. What stays accessible is what pays attention-rent above the decay-floor. This is structurally identical to CKB state-rent: storage occupies a cell; cells that cannot fund their rent are evicted; the mechanism enforces a maximum steady-state storage footprint without requiring a central eviction authority.

The claim is not metaphor. It is that the mathematics describing CKB state-rent describes cognitive retention in the limit: same equations, same phase transitions, same failure modes when the rent function is mistuned.

## The rent function

Let `R(s, t)` be the retention cost for state `s` at time `t`. Three properties load-bearing:

1. **Monotonic in active surface area.** Cognition has a working-memory budget — more active facts = higher per-fact retention cost. Real working-memory isn't linear; it's convex. `∂R/∂|active| > 0` and `∂²R/∂|active|² > 0`.
2. **Discounted by recency.** Facts recently queried are cheaper to retain than facts dormant — retrieval paths cache. `R(s, t | queried_at_t-k) < R(s, t)` for small k, with convex discount.
3. **Retrieval-cost-coupled.** A fact hard to retrieve is hard to retain (the queries that would refresh it can't find it). This is a negative feedback loop: hard-to-retrieve → high-cost-to-keep → evicted → even harder to retrieve until gone.

CKB's rent function captures properties 1 and 2 directly. Property 3 is weaker in CKB (retrieval cost is flat-gas across state) but emerges in practice when fee-markets price rarely-read state higher.

## The phase transitions

When retention-cost curves are convex, the steady-state exhibits characteristic behaviors:

### Phase 1 — Below knee

Light footprint, rent cost is low, all states self-fund. Mind feels fluent; chain feels cheap.

### Phase 2 — Approaching knee

Footprint growing; convexity kicking in; some states starting to miss rent. Subtle competition. Mind feels full; chain feels like it's approaching gas-crisis.

### Phase 3 — Past the knee

Footprint exceeds sustainable; rent cost compounds; eviction cascades. Mind feels overloaded; chain becomes unusable without gas-market surge.

### Phase 4 — Collapse

Eviction exceeds new-state-rate; substrate contracts. Not catastrophic — just lossy. Previously-funded states are evicted because newer ones outbid. Mind feels like memory-loss; chain feels like historical-state-loss.

These four phases are observable in both substrates. In cognition, they map to relaxed attention / engaged attention / overloaded attention / cognitive burn-out. In CKB, they map to sub-knee / approaching-knee / gas-crisis / eviction-cascade.

## Why the symmetry matters

A mechanism designer wanting to tune retention — in either substrate — can read from one side and apply to the other. The cognitive substrate has centuries of observational data about attention-economics; the chain substrate can inherit the phase-transition theory directly, adjusting only the constants.

VibeSwap's NCI retention-weight function currently uses a linear decay — this IS the Gap #1 from the [ETM Build Roadmap](./ETM_BUILD_ROADMAP.md). The fix is to replace linear with convex, matching the cognitive rent function's observed shape.

## The alpha parameter

If the convex retention cost is `R(t) = base × (1 - (t/T)^α)`:

- `α = 1` is linear (current incorrect form).
- `α < 1` is concave (early states cheap, late states expensive — inverse of observed cognition).
- `α > 1` is convex (late states cheap, early states expensive — matches cognition).

Empirical work on attention decay (Ebbinghaus, modern replications) suggests `α ≈ 1.4-1.7`. The [Augmented Mechanism Design paper §6.4](../memory/feedback_augmented-mechanism-design-paper.md) recommends `α = 1.6` as a starting point for state-rent functions.

Choosing `α = 1.6` is NOT tuning to convenience — it is matching substrate geometry (per [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md)).

## The cognitive substrate's self-regulation

Observation: cognition doesn't run at Phase 3/4 as a steady-state. Agents self-regulate attention — drop tasks, sleep, change context — to return to Phase 1/2. Why?

Because Phase 3/4 has higher retention cost PER fact, and total retention cost is the integral of per-fact costs over all active facts. Past the knee, total cost grows faster than benefit — agents feel the cost and back off.

The chain can't self-regulate this way without governance intervention. Which is why state-rent's MAX_ACTIVE bound is critical: without it, the chain would sit at Phase 4 forever because adding-state is free at the margin while the aggregate cost accrues silently.

In cognition, the regulator is attention-cost felt by the agent. On-chain, the regulator is rent-cost paid by the state-holder. Mechanism-design translation.

## The retrieval-path refresh

When a fact is queried, the cost of retaining it drops (property 2). This means that well-used facts rent themselves cheaply; rarely-used facts rent expensively; disused facts get evicted.

On-chain equivalent: state frequently read via smart-contract calls should have lower rent than state rarely touched. CKB's current rent model doesn't capture this; it's flat-per-cell. This is a refinement candidate for a future CKB-native mechanism and a corresponding ETM-alignment row.

## Relationship to Shapley

Shapley distribution pays proportional to marginal contribution. In cognition, attention paid to a fact now IS the marginal value it creates now. Retention cost = attention allocated. So the rent is marginal contribution, paid in advance, in the inverse direction.

Mechanism symmetry: Shapley is the *outbound* cash flow from the cooperative game; state-rent is the *inbound* cash flow into the retention pool. Both use marginal-contribution math.

## One-line summary

*Cognitive retention is governed by the same rent-with-decay dynamics as CKB state-rent; the four phase-transitions map directly; VibeSwap's NCI should use α≈1.6 convex retention because that's the shape the cognitive substrate uses.*
