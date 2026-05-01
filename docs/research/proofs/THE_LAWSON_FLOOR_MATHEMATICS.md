# The Lawson Floor Mathematics

**Status**: Formal composition of two Lawson primitives.
**Audience**: First-encounter OK. Walked arithmetic with worked examples.

---

## Start with a fairness problem

Ten people collaborate on a project. Five are heavily involved; five are modestly involved.

Project succeeds. $1000 in rewards to distribute.

**Option A — Equal split**: each gets $100. Feels fair at first but ignores actual contribution.

**Option B — Pure proportional (Shapley)**: heavily involved might get $200 each, modestly involved might get $0 each.

The problem with Option B: those who contributed modestly still contributed something. Getting $0 feels punitive.

Option A over-credits the modest. Option B under-credits them.

**Option C — Lawson Floor**: everyone gets AT LEAST $X (the floor). Remaining distribution is proportional.

With floor = $50:
- Everyone: $50 each = $500 allocated.
- Remaining $500 distributed proportionally to heavy contributors.
- Each modestly involved person: $50.
- Each heavily involved person: $50 + bonus proportional to their share of the remaining $500.

Balanced. The modest aren't ignored; the heavy are still credited disproportionately.

This is the Lawson Floor concept — and it's a specific mathematical mechanism.

## The two Lawson primitives

"Lawson" carries two distinct but complementary primitives:

1. **Lawson Constant** — attribution axiom. Ensures the greatest idea cannot be stolen because authorship is structural. See [Lawson Constant doc](./LAWSON_CONSTANT.md).

2. **Lawson Floor** — distribution mechanism. Guarantees every attributed contributor receives at least a floor amount. This doc.

Named after the same person (Lawson). Share a principle (Fairness Above All, P-000). Operate at different layers:

- Lawson Constant: attribution layer (WHO did what).
- Lawson Floor: distribution layer (HOW MUCH they receive).

This doc establishes the mathematical composition of both.

## The composition formula

Let the total distributable surplus in a round be `S`. Let there be `N` attributed contributors with Shapley values `φ_1, ..., φ_N`.

**Naive distribution** (no floor):

```
reward_i = (φ_i / Σ φ_j) × S
```

Problem: if `φ_i` is small, `reward_i` → 0.

**With Lawson Floor**:

```
reward_i = max(F, (φ_i / Σ φ_j) × S)
```

Where `F = S × α / N` and `α` is the floor fraction (default 0.1, meaning 10% of pool reserved for floors).

The math ensures every attributed contributor gets at least `F`. Budget constraint: `Σ reward_i ≤ S` must still hold. Floor reallocates small portion from high-Shapley to low-Shapley.

## Worked numeric example

Suppose `S = $900` (pool size) and `α = 0.1` (10% floor).

With 10 contributors:

```
F = $900 × 0.1 / 10 = $9 per contributor (minimum).
```

Now suppose 10 contributors have Shapley values (normalized):

| Contributor | Shapley % | Shapley-only reward | With Floor reward |
|---|---|---|---|
| Alice | 50% | $450 | $450 (no floor needed) |
| Bob | 20% | $180 | $180 |
| Carol | 10% | $90 | $90 |
| Dave | 5% | $45 | $45 |
| Eve | 4% | $36 | $36 |
| Frank | 3% | $27 | $27 |
| Grace | 2% | $18 | $18 |
| Henry | 3% | $27 | $27 |
| Ivy | 2% | $18 | $18 |
| Jack | 1% | $9 | $9 (floor) |

All 10 have φ ≥ 1%, so Shapley-only gives: $450, $180, $90, $45, $36, $27, $18, $27, $18, $9.

Total: ~$900 (within rounding).

Jack's Shapley reward is already $9, matching the floor. Everyone above threshold gets Shapley-proportional.

### A case where floor actually fires

Suppose Jack's Shapley was actually 0.5% (not 1%):

Shapley-only: Jack gets $4.50.

Lawson Floor kicks in: Jack gets $9.

The $9 - $4.50 = $4.50 extra comes proportionally from everyone else. Alice's $450 might be reduced slightly to $447; similar for others.

Total preserved: $900. Jack protected.

### Fairness interpretation

Jack contributed genuinely but marginally. Under Shapley-only, his reward ($4.50) barely compensates the effort. He'd exit the protocol after this round.

Under Lawson Floor ($9), he gets enough to justify continued participation. The protocol retains his participation for future rounds.

Long-term: Jack might become heavily-involved. Retaining him through floor is strategically valuable.

## Why both Lawsons are needed

### Lawson Constant alone (no Floor)

Attribution preserved; economic weight can still be zero. A contribution perfectly attributed can receive no reward if Shapley assigns near-zero.

Problem: attribution is symbolic if economic weight is absent.

### Lawson Floor alone (no Constant)

Economic floor guaranteed; attribution can be gamed. Fake contributions earn the floor; real contributions diluted.

Problem: without attribution guarantee, floor incentivizes gaming.

### Composed

Lawson Constant ensures contribution is recorded truthfully.
Lawson Floor ensures recorded contribution receives minimum economic acknowledgment.

Together: every legitimate contribution gets meaningful economic credit + no contribution can be stolen or erased.

## The attestation-threshold gate

Lawson Floor doesn't give EVERY claim the floor. Only claims ACCEPTED by the [three-branch attestation flow](../../concepts/identity/CONTRIBUTION_ATTESTOR_EXPLAINER.md).

- Pending claims: not eligible.
- Rejected claims: not eligible.
- Expired claims (TTL): not eligible.
- Accepted claims (Executive/Judicial/Legislative): eligible for floor.

Prevents gaming: bad-faith contributor can't submit trivial claims just to collect the floor. Must pass attestation threshold (cost + attention of real attestors).

## The floor fraction α

α = 0.1 (10%) is default. Tradeoffs:

- **α too low** (e.g., 0.01): floor is nominal; extreme-tail contributors still receive near-zero. Winner-take-all reasserts.
- **α too high** (e.g., 0.5): floors consume most of pool; high-Shapley contributors underrewarded. Shapley's fairness weakens.

10% balances: meaningful floor for low-Shapley + Shapley still routes most of pool.

Governance can tune α — bounded by constitutional axioms (P-000). Raising α to 0.9 effectively eliminates Shapley; that's a constitutional-amendment, not governance tuning.

## Why this isn't UBI

Universal Basic Income gives everyone (citizen, contributor, bystander) a minimum.

Lawson Floor gives ATTRIBUTED contributors a floor — and attribution requires active contribution + attestation. Bystanders get nothing.

The comparison that's closer: earned-income-tax-credit. Low earners receive a floor only if they earn income. Non-earners get nothing.

Lawson Floor is the on-chain analog. Contribute (earn attribution) to be eligible. Floor then protects your contribution from economic nullification.

## The governance interaction

Lawson Floor is operationally a parameter (α, N_floor = attributed-contributor count). Both visible to governance.

Governance CAN:
- Adjust α within [0.05, 0.30] range.
- Tune minimum contribution threshold for floor eligibility.

Governance CANNOT:
- Eliminate floor entirely (violates P-000 Fairness Above All).
- Reduce α below 0.05 (effectively eliminates; constitutional).
- Target specific addresses for exclusion (violates attribution-is-structural).

## Relationship to Novelty Bonus Theorem

[Novelty Bonus Theorem](../theorems/THE_NOVELTY_BONUS_THEOREM.md): permutation-symmetric Shapley under-rewards novelty. Novelty Bonus adds super-linear rewards to novel contributions.

Composition with Lawson Floor:

```
reward_i = max(F, novelty_bonus(i) × (φ_i / Σ φ_j) × S × (1-α))
```

Floor still applies. Novelty bonus shifts Shapley-proportional portion.

Together they produce:
- High-novelty, high-Shapley: heavily rewarded.
- High-novelty, low-Shapley: floor-protected, modest bonus-enhanced reward.
- Low-novelty, low-Shapley: floor-protected (minimum).
- Low-novelty, high-Shapley: Shapley-proportional without novelty boost.

The composition is additive-then-capped-by-floor, preserving both mechanisms' intents.

## Implementation notes

On-chain, the floor calculation fires during reward distribution rounds. Gas cost scales linearly with N (attributed-contributor count).

Storage: each round's (α, S, N, F) recorded for audit. Historical floors queriable to verify past rounds respected the floor.

Edge case: if `S < N × F`, total pool < sum of floors. In this rare case, everyone receives `S / N` — uniform distribution for this round. Per-contributor fairness preserved; Shapley weighting suppressed for that round. Signal to governance that reward pool may be insufficient.

## Relationship to cognitive economy

Under [Economic Theory of Mind](../../concepts/etm/ECONOMIC_THEORY_OF_MIND.md), cognition preserves minor contributions from evict-dominance. Even small memory items retain some persistence-weight. Lawson Floor is the on-chain mirror.

Diverse-but-small contributions are preserved over pure-marginal-dominance. Matches cognitive substrate geometry.

## For students

Exercise: work through a distribution scenario with specific numbers.

- Pool: $1000.
- 5 contributors with Shapley percentages: 60%, 20%, 10%, 8%, 2%.
- α = 0.1.

Compute:
1. Floor F.
2. Shapley-only rewards.
3. Post-floor rewards.
4. Identify who had floor fire.

Then adjust: contributor 5 at 0.5% instead of 2%. Re-compute. Observe how floor affects distribution.

## One-line summary

*Lawson Floor composition: reward_i = max(F, Shapley × (1-α)) where F = S × α / N, α = 0.1 default. Protects low-Shapley contributors from economic nullification (not UBI — earned-income-tax-credit analog). Constitutional bounds on α [0.05, 0.30]. Composes with Novelty Bonus (additive then capped). Cognitive parallel: memory preserves minor items from evict-dominance. Both Lawson primitives (Constant + Floor) needed — attribution preservation + economic preservation.*
