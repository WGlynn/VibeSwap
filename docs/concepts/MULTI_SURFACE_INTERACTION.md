# Multi-Surface Interaction

> *A single parking meter is straightforward — pay, park, leave. Two overlapping meters for the same spot (one for tourists, one for locals) create edge cases: who pays which? When does one take precedence? What happens when both fire simultaneously?*

This doc addresses a design question that surfaces as VibeSwap's mechanisms compose: **when a user occupies multiple surfaces simultaneously, how do their rents, rotations, and phase transitions interact?** Single-surface analysis (Attention-Surface Scaling, Rotation Invariant) is a foundation; multi-surface composition is where real mechanism complexity emerges.

## The compositional problem

A VibeSwap contributor might simultaneously occupy:

- **NCI retention slots** for their past contributions (temporal occupancy).
- **CKB state-rent slots** for smart contracts they deployed (storage occupancy).
- **DAG handshake slots** for endorsements they've given (social occupancy).
- **Commit-reveal auction capacity** for orders they place (market occupancy).
- **Governance attention** for votes they participate in (political occupancy).

Each surface has its own rent, its own rotation, its own phase transition. When interactions arise (e.g., "is your DAG handshake weight diluted by your NCI-retention age?"), composition matters.

Without explicit composition rules, interactions emerge by accident. Small calibration decisions compound unpredictably. Users and auditors struggle to reason about the aggregate incentive structure.

## The primitive, stated

**Multi-Surface Interaction** is the discipline of explicitly specifying how surfaces compose:

- **Independence**: default. Each surface's rent is computed independently. Total rent = sum of per-surface rents.
- **Coupling**: specific surfaces affect each other (e.g., NCI weight amplifies DAG handshake weight). Coupling is EXPLICIT, not implicit.
- **Bounded aggregation**: total user rent across all surfaces is bounded to prevent runaway. No user pays >N% of their total balance in aggregate rent per period.
- **Order-independence**: composition rules are commutative. "Pay NCI rent then CKB rent" should give the same result as "Pay CKB rent then NCI rent."
- **Phase-transition synchronization**: when phase transitions should be coordinated across surfaces, they're explicitly wired. When not, they fire independently.

## Four composition patterns

### Pattern 1: Independence (default)

Most surfaces are independent. A user's NCI retention doesn't affect their CKB storage rent, and vice versa.

Math: `total_rent(user) = Σ rent_surface(user, surface)` for each surface they occupy.

Pros: simple to reason about. Each surface can be analyzed in isolation.
Cons: aggregate rent can be high if user occupies many surfaces. Needs bounded-aggregation check.

### Pattern 2: Multiplicative coupling

Two surfaces' effects multiply rather than add. Example: a user's reputation score might multiply their Shapley rewards.

Math: `reward(user) = base_reward × reputation(user) × novelty(user)`.

Pros: can express "compound advantages" naturally.
Cons: multipliers explode quickly; hard to reason about extreme values.

Multiplicative coupling requires caps. A multiplier can't exceed a specific max value.

### Pattern 3: Competitive allocation

Multiple surfaces compete for the same user attention/resource. User must allocate across surfaces.

Example: a user has 1000 governance tokens. They can stake on rate-limit insurance OR on circuit-breaker insurance OR on liquidity insurance — but one token can't stake on multiple simultaneously.

Math: `Σ allocations_surface = total_budget`. Each surface receives a share.

Pros: explicit tradeoff surfaces user choices.
Cons: adds complexity. Users may make suboptimal allocations.

### Pattern 4: Waterfall composition

Surfaces cascade — the output of one becomes the input to another. Example: NCI retention weight flows into Shapley share, which flows into reward distribution.

Math: `output_N = f_N(output_{N-1}, ...)`.

Pros: models actual dependencies naturally.
Cons: debugging cascades is hard. A change upstream affects all downstream.

## Where interactions matter in VibeSwap

### NCI → Shapley (existing)

A contributor's NCI retention weight affects their Shapley share. Composition type: **waterfall**.

```
NCI_weight(t) → Shapley_input(user, t) → reward(user, t)
```

Each stage is clear. Changes to NCI (Gap #1 C40) flow to Shapley automatically.

### NCI + similarity → Shapley (Gap #2, C42)

Gap #2 adds similarity into the composition:

```
(NCI_weight(t), similarity(C, S)) → Shapley_input(user, t, C) → reward(user, t, C)
```

Waterfall extended. Similarity is a NEW INPUT, not a replacement. Composition type: **still waterfall, now with two sources**.

Risk: if NCI weight changes shape (linear→convex) and similarity also contributes, total variance in reward amount could exceed intended. Calibration check needed after Gap #1 and Gap #2 both ship.

### Circuit breakers ↔ Rate limits

Both affect whether a user can submit orders. Composition: **competitive gating**.

If circuit breaker is tripped: no orders allowed at all.
If rate limit is binding: orders allowed but throttled.
If both: circuit breaker dominates.

Explicit precedence prevents silent inconsistency. Without precedence, a user might hit rate-limit-throttling while also circuit-broken, with confusing UX.

### DAG handshakes ↔ NCI weight

Proposed interaction: handshakes from high-NCI contributors carry more weight than from low-NCI contributors. Composition: **multiplicative**.

```
handshake_weight(A → B) = base_handshake × NCI(A)
```

Not currently implemented. If implemented, must cap: `handshake_weight ≤ MAX`. Otherwise a high-NCI user's handshake dominates all others.

### Governance voting ↔ NCI weight

Proposed interaction: governance voting power proportional to both token holdings AND NCI-weighted contribution history. Composition: **multiplicative**.

```
vote_power(user) = tokens(user) × (1 + NCI(user) / NCI_norm)
```

Creates incentive to contribute actively, not just hold tokens. But multiplier must be bounded — a whale with high NCI would dominate otherwise.

### CKB state-rent → contract deployment incentive

The higher the CKB rent, the less likely contracts are deployed. Composition: **market-clearing**.

If rent is too high, new contracts don't launch. If rent is too low, abandoned contracts squat. Governance tunes rent to clear the market.

## Anti-patterns

### Anti-pattern 1: Unbounded multiplication

Multiplicative couplings without caps. A user with high reputation × high NCI × high handshake weight could accumulate outsized rewards/power.

Fix: cap all multipliers. Explicit bounds checked at calibration.

### Anti-pattern 2: Order-dependent composition

Composition that gives different results based on processing order. Example: "pay NCI first, then update weights" vs "update weights first, then pay NCI."

Fix: design composition to be commutative. Batch all reads, compute all writes, apply atomically.

### Anti-pattern 3: Implicit coupling

Two surfaces interact through some accidentally-shared state. Example: a rate limit and a circuit breaker both read from the same volume counter, and updating one affects the other unintentionally.

Fix: explicit data flow. Each surface has its own inputs; shared reads are documented.

### Anti-pattern 4: Aggregate rent explosion

User occupies 10 surfaces, each with modest rent. Aggregate is 10× individual — potentially unsustainable.

Fix: bounded-aggregation rule. Total rent per period capped at percentage of balance. Graceful degradation when cap is hit.

## The bounded-aggregation rule

Formalized:

```solidity
function computeTotalRent(address user, uint256 period) public view returns (uint256) {
    uint256 total = 0;
    for each surface S in user's occupancies:
        total += computeRent(user, S, period);
    uint256 balance = getTokenBalance(user);
    uint256 cap = balance * MAX_RENT_PERCENT_PER_PERIOD / 100;
    return total > cap ? cap : total;
}
```

Default MAX_RENT_PERCENT_PER_PERIOD: 10% (conservative). Governance-tunable within [5%, 20%].

When cap is hit:
- User pays the cap.
- Payment is distributed PROPORTIONALLY to each surface's nominal rent.
- User is flagged "in arrears" — some surfaces may enter degraded states (e.g., NCI retention reduced faster).

This prevents "rent death spiral" where users can't afford aggregate obligations.

## Visibility and explainability

Multi-surface interactions are a common audit finding: "a user's outcome depends on K different variables; no single view shows them all."

Fix: a `userDashboard(address)` view function returns all active occupancies + current rents per surface + aggregate. Users (and auditors) can see the full picture.

```solidity
struct OccupancyView {
    bytes32 surfaceType;
    uint256 claimedAmount;
    uint256 currentRent;
    uint256 ageDays;
    uint256 nextPhaseTransition;
}

function userDashboard(address user) public view returns (OccupancyView[] memory);
```

UI consumes this to show users their commitments.

## Student exercises

1. **Compute aggregate rent.** A user has NCI retention at day 90 (weight 894), CKB slot at day 200 (rent 50 tokens), and 3 DAG handshakes (each costing 5 tokens). Total rent this period?

2. **Design a composition.** Suppose you add "fairness insurance" — users stake tokens to be eligible for fairness-dispute compensation. How does it compose with existing surfaces? Specify composition type.

3. **Detect unbounded multiplier.** Review VibeSwap's existing mechanisms. Find a multiplicative coupling. Check if it has a cap. If not, propose one.

4. **Hysteresis across surfaces.** If both circuit breaker AND rate limit use hysteresis, how do their hysteresis loops interact? Design a coherent policy.

5. **Cap calibration.** MAX_RENT_PERCENT_PER_PERIOD = 10%. What happens if it's 30%? 5%? Reason through scenarios.

## Interaction matrix

A compact reference for composition between surface pairs. Rows = reader; columns = writer.

|            | NCI | CKB | DAG | CRA | GOV |
|------------|-----|-----|-----|-----|-----|
| NCI        | —   | ∅   | w   | ∅   | ∅   |
| CKB        | ∅   | —   | ∅   | ∅   | ∅   |
| DAG        | m   | ∅   | —   | ∅   | ∅   |
| CRA        | ∅   | ∅   | ∅   | —   | ∅   |
| GOV        | m   | ∅   | ∅   | ∅   | —   |

Legend: ∅ = independent, w = waterfall (input), m = multiplicative.

**Gaps in the matrix represent DESIGN CHOICES.** Each "∅" is an explicit decision to keep surfaces independent, not an accident.

## Future work — concrete code cycles

### Queued for un-scheduled cycles

- **userDashboard view function** — implement the all-surfaces overview. File: `contracts/view/UserDashboard.sol`.

- **Bounded-aggregation check** — implement the MAX_RENT_PERCENT_PER_PERIOD rule. Fold into the per-surface rent collection.

- **Interaction matrix constants** — codify the current composition rules as contract constants. Prevents silent composition-rule drift.

- **Interaction audit** — review each pairwise interaction, document composition type, add regression test.

### Queued for post-launch

- **Cross-surface phase transition coordination** — if multiple surfaces' phase transitions would coincide by accident, stagger them.

- **Interaction tests** — integration tests with users occupying K surfaces simultaneously, verify bounded-aggregation holds.

### Primitive extraction

If N > 3 mechanisms involve cross-surface composition, extract to `memory/primitive_multi-surface-interaction.md`.

## Relationship to other primitives

- **Attention-Surface Scaling** (see [`ATTENTION_SURFACE_SCALING.md`](./ATTENTION_SURFACE_SCALING.md)) — single-surface rent curve. Multi-surface is what happens when many are composed.
- **Rotation Invariant** (see [`ROTATION_INVARIANT.md`](./ROTATION_INVARIANT.md)) — each surface rotates independently; composition must preserve rotation guarantees.
- **Augmented Governance** — composition rules are governance-tunable within bounds.
- **Phase Transition Design** — phase transitions may need cross-surface coordination.

## How this doc feeds the Code↔Text Inspiration Loop

This doc specifies how existing and future VibeSwap mechanisms compose. Each proposed composition (NCI × reputation, governance × NCI, etc.) is a candidate code cycle. The userDashboard view is a specific code deliverable that surfaces the aggregate picture to users.

## One-line summary

*Multi-Surface Interaction is the discipline of explicitly specifying how VibeSwap's independently-designed surfaces compose when users occupy multiple at once. Four patterns: independence, multiplicative, competitive, waterfall. Bounded aggregation rule (≤10% balance per period) prevents rent explosion. Visibility via userDashboard. Interaction matrix codifies which surfaces couple, which stay independent.*
