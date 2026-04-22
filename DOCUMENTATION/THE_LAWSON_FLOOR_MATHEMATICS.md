# The Lawson Floor Mathematics

**Status**: Formal composition of two Lawson primitives.
**Depth**: How Lawson Floor (distribution) and Lawson Constant (attribution) compose mathematically.
**Related**: [Lawson Floor Fairness](./LAWSON_FLOOR_FAIRNESS.md) (distribution-layer), [Lawson Constant](./LAWSON_CONSTANT.md) (attribution-axiom), [Shapley Reward System](./SHAPLEY_REWARD_SYSTEM.md).

---

## The two Lawsons

The "Lawson" name carries two distinct but complementary primitives:

1. **Lawson Floor** — a distribution mechanism. Guarantees every attributed contributor receives at least a floor amount, preventing winner-take-all collapse of Shapley distributions.
2. **Lawson Constant** — an attribution axiom. Ensures the greatest idea cannot be stolen because authorship is structural.

They're named after the same person and share a principle (Fairness Above All, P-000) but operate at different layers:

- Lawson Constant → attribution layer (who did what).
- Lawson Floor → distribution layer (how much they receive).

This doc establishes the mathematical composition: given a contribution recorded under Lawson Constant, how does Lawson Floor guarantee a fair share?

## The composition

Let the total distributable surplus in a round be `S`. Let there be `N` attributed contributors with Shapley values `φ_1, ..., φ_N`. Naive distribution:

```
reward_i = (φ_i / Σφ_j) × S
```

Problem: if `φ_i` is very small for contributor `i`, `reward_i` → 0. Edge-case contributors get nothing even though their attribution is valid. Winner-take-all failure.

Lawson Floor adds a floor `F`:

```
reward_i = max(F, (φ_i / Σφ_j) × S)
```

With a budget constraint: `Σ reward_i ≤ S` must still hold. The floor reallocates a small portion from high-Shapley contributors to low-Shapley-but-attributed contributors.

The math:

```
F = S × α / N
```

where `α` is the floor fraction (default 0.1, meaning 10% of the total pool is reserved for floors). Each of `N` attributed contributors gets at least `F`. The remaining `S × (1 - α)` is distributed by Shapley proportion.

## Why both Lawsons are needed

Lawson Constant alone gives attribution but no economic weight. A contribution can be perfectly attributed yet receive zero reward if Shapley math assigns it near-zero marginal value.

Lawson Floor alone gives distributional fairness but no attribution substrate. A floor-guaranteeing mechanism without Lawson Constant can be gamed — fake contributions earn the floor; real contributions get diluted.

Composed:
- Lawson Constant ensures the contribution is recorded truthfully.
- Lawson Floor ensures the recorded contribution receives a minimum economic acknowledgment.

Together: every legitimate contribution gets meaningful economic acknowledgment, and no contribution can be stolen or erased from the record.

## The attestation-threshold gate

Lawson Floor doesn't give EVERY claim the floor. Only claims accepted by the [three-branch attestation flow](./CONTRIBUTION_ATTESTOR_EXPLAINER.md). Unaccepted claims (insufficient attestation weight, TTL expired, rejected by tribunal) don't receive the floor.

This prevents gaming: a bad-faith contributor can't submit trivial claims just to collect the floor. They have to pass attestation threshold, which costs time and attention from trust-weighted attestors.

## The floor fraction `α`

α = 0.1 (10%) is the default. Tradeoffs:

- **α too low** (e.g., 0.01): floor is nominal; extreme-tail contributors still receive near-zero. Winner-take-all reasserts.
- **α too high** (e.g., 0.5): floors consume most of the pool; high-Shapley contributors underrewarded relative to marginal value. Shapley's fairness weakens.

10% balances: meaningful floor for low-Shapley contributors; most of the pool still routed by marginal-contribution math.

Governance can tune α — but bounded by constitutional axioms (P-000). Raising α to 0.9 would effectively eliminate Shapley; that's a constitutional change, not a governance parameter adjustment.

## Math for N contributors

Given α = 0.1, S = 1000, N = 10 contributors with diverse Shapley values:

```
Contributor  Shapley_raw  Shapley_normalized  Floor   Final Reward
---         0.50         50.0%               10      max(10, 900*0.50) = 450
A           0.20         20.0%               10      max(10, 900*0.20) = 180
B           0.10         10.0%               10      max(10, 900*0.10) = 90
C           0.05          5.0%               10      max(10, 900*0.05) = 45
D           0.04          4.0%               10      max(10, 900*0.04) = 36
E           0.03          3.0%               10      max(10, 900*0.03) = 27
F           0.02          2.0%               10      max(10, 900*0.02) = 18
G           0.03          3.0%               10      max(10, 900*0.03) = 27
H           0.02          2.0%               10      max(10, 900*0.02) = 18
I           0.01          1.0%               10      max(10, 900*0.01) = 10 (floored!)
Total:      1.00         100%                                       1001
```

Note: sum is ~1001, slightly over 1000. This is the floor cost — low-Shapley contributors received MORE than their Shapley share. The ~1 excess is deducted proportionally from high-Shapley contributors.

After proportional deduction: total = 1000 (budget constraint holds).

Contributor I would have received 10 under Shapley alone; they received 10 under Lawson Floor. The floor protected their attribution from being economically nullified.

## Why this isn't a Universal Basic Income analogue

A skeptic might analogize: "isn't this UBI — guaranteeing minimum to everyone?"

Not quite. UBI gives everyone (citizen, contributor, bystander) a minimum. Lawson Floor gives attributed-contributors a floor — and attribution requires active contribution + attestation. Bystanders get nothing.

The comparison that's closer: earned-income-tax-credit. Low earners receive a floor only if they earn income at all. Non-earners receive nothing.

Lawson Floor is the on-chain analog. You must contribute (earn attribution) to be floor-eligible. The floor then protects your contribution from being economically nullified.

## The governance interaction

Lawson Floor is operationally a parameter (α, N_floor = number of attributed contributors). Both are visible to governance.

Governance can:
- Adjust α within range [0.05, 0.30] (bounded by constitutional law).
- Tune the "minimum contribution threshold" below which a claim doesn't qualify for floor (prevents spam micro-contributions from diluting).

Governance cannot:
- Eliminate the floor entirely (violates P-000 Fairness Above All).
- Reduce α below 0.05 (effectively eliminates; also constitutional).
- Target specific addresses for exclusion (violates attribution-is-structural axiom).

## Relationship to the Novelty Bonus Theorem

[Novelty Bonus Theorem](./THE_NOVELTY_BONUS_THEOREM.md): permutation-symmetric Shapley under-rewards novelty. The novelty bonus adds super-linear rewards to genuinely-novel contributions.

Composition with Lawson Floor:

```
reward_i = max(F, novelty_bonus(i) × (φ_i / Σφ_j) × S × (1-α))
```

Floor still applies. Novelty bonus shifts the Shapley-proportional portion. Together they produce:
- High-novelty, high-Shapley: heavily rewarded.
- High-novelty, low-Shapley: floor-protected, modest reward.
- Low-novelty, low-Shapley: floor-protected, minimum reward (barely above floor).
- Low-novelty, high-Shapley: Shapley-proportional but without novelty boost.

The composition is additive-then-capped-by-floor, preserving both mechanisms' intents.

## Implementation notes

On-chain, the floor calculation fires during reward distribution rounds. Gas cost scales linearly with N (attributed-contributor count).

Storage: each round's (α, S, N, F) is recorded for audit. Historical floors can be queried to verify past rounds respected the floor.

Edge case: if `S < N × F`, the total pool is less than the sum of floors. In this rare case, everyone receives `S / N` — effectively a uniform distribution for this round. Per-contributor fairness is preserved; Shapley weighting is suppressed for that round. Signal to governance that reward pool may be insufficient.

## Relationship to cognitive economy

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognition has its own version of floor-guaranteeing: even minor contributions to the knowledge-set retain some persistence-weight (they don't immediately evict). The cognitive floor prevents the knowledge-substrate from losing diverse-but-small contributions to pure-dominance dynamics.

VibeSwap's Lawson Floor is the on-chain mirror. Every attributed contribution retains some economic weight, preserving diversity over pure-marginal-dominance.

## One-line summary

*Lawson Floor ensures every attributed contribution receives α=10% of the pool's N-share, composed with Shapley's marginal allocation — together they prevent winner-take-all economic nullification without undermining Shapley's proportionality; floor-with-attribution = earned-minimum, not UBI.*
