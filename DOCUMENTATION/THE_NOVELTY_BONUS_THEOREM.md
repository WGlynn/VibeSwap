# The Novelty Bonus Theorem

**Status**: Formal argument with worked numeric example.
**Audience**: First-encounter OK. Numbers walked end-to-end.

---

## Start with a small injustice

Three researchers write papers:

- **Alice** publishes a novel idea. Nobody else has ever written about this topic. Her paper creates a new research direction.
- **Bob** publishes 6 months later. His paper builds directly on Alice's. He acknowledges her but proves something new.
- **Carol** publishes 2 years later. Her paper rehashes what Alice and Bob established. She adds nothing substantive.

All three papers get cited. All three are of similar length and rigor. But only Alice's is genuinely novel; Bob's is substantial incremental progress; Carol's is mostly replicated work.

How much credit does each deserve?

Intuitively: Alice much more than Bob, Bob more than Carol. Novelty matters.

Now suppose you use plain Shapley distribution (the standard axiom-compliant fairness method). It turns out plain Shapley gives all three EQUAL credit — because Shapley is permutation-symmetric. It averages over all orders of arrival, and in some of those orders, Alice is "last" (arrives after Bob and Carol) — in which case her contribution looks like Carol's.

This is a problem. Plain Shapley is fair in a narrow mathematical sense, but it doesn't capture the real-world importance of temporal priority.

That's the concern this theorem addresses.

## The theorem, informally

**No permutation-symmetric distribution mechanism can distinguish "novel first-arriver" from "replication-of-prior-work" contributions.**

Therefore, if you want to reward novelty (which you should in any knowledge-producing system), you need a mechanism that breaks permutation symmetry.

The Novelty Bonus does exactly this.

## A worked numeric example

Let's put numbers on it. Three contributors Alice, Bob, Carol. Each contributes work worth 1 unit. Total pool to distribute: $900.

### Plain Shapley Distribution

Characteristic function (plain):
- v({}) = 0
- v({Alice}) = 1
- v({Bob}) = 1 (same marginal if they happened to be "first")
- v({Carol}) = 1 (ditto)
- v({A, B}) = 2 (one additional 1-unit added)
- v({A, C}) = 2
- v({B, C}) = 2
- v({A, B, C}) = 3

Permutation-averaged Shapley:
- Each contributor's expected marginal contribution across all 6 orderings is 1.
- Total: 3.

Shares:
- Alice: 1/3 × $900 = $300.
- Bob: 1/3 × $900 = $300.
- Carol: 1/3 × $900 = $300.

**All equal** despite the intuitive injustice.

### Applying the Novelty Bonus

The Novelty Bonus is multiplied onto Shapley:

```
reward_i = Shapley(i) × novelty_bonus(i)
```

Where `novelty_bonus(i)` depends on how novel contributor i's work was RELATIVE to the knowledge-set that existed when they arrived.

For our example, let's compute novelty bonuses using semantic-similarity scores:

- **Alice's paper**: similarity to prior = 0 (she arrived when knowledge-set was empty). novelty_bonus = 2.0 (super-linear reward for establishing a field).
- **Bob's paper**: similarity to prior = 0.5 (half-derivable from Alice's). novelty_bonus = 1.3.
- **Carol's paper**: similarity to prior = 0.9 (mostly derivable from Alice + Bob). novelty_bonus = 0.7.

Combined rewards:
- Alice: $300 × 2.0 = $600.
- Bob: $300 × 1.3 = $390.
- Carol: $300 × 0.7 = $210.

**Total = $1,200.** Oops, exceeds our pool.

### Normalizing back to the pool

We need to normalize:
```
normalized_reward_i = total_pool × (raw_reward_i / Σ raw_rewards_j)
```

- Σ raw = 600 + 390 + 210 = 1200.
- Alice: $900 × (600/1200) = $450.
- Bob: $900 × (390/1200) = $292.50.
- Carol: $900 × (210/1200) = $157.50.

**Total = $900.** ✓

Compare to plain Shapley ($300 each):

| Contributor | Plain Shapley | With Novelty Bonus | Δ |
|---|---|---|---|
| Alice | $300 | $450 | +$150 (she's rewarded for novelty) |
| Bob | $300 | $292.50 | −$7.50 (close to Shapley; moderate novelty) |
| Carol | $300 | $157.50 | −$142.50 (penalized for replication) |

The Novelty Bonus shifts rewards toward genuine novelty and away from replication. Alice gets +50% vs her Shapley share; Carol gets -47%.

This is the fair-by-novelty outcome that plain Shapley couldn't produce.

## The theorem, more formally

**Claim**: No permutation-symmetric distribution mechanism M satisfies BOTH:
1. Reward all contributions proportionally to their structural value in the cooperative game.
2. Reward contributions of genuine temporal novelty more than replicable contributions.

**Proof sketch**: Permutation symmetry means: for any two contributors with identical structural roles, M gives them identical rewards, regardless of arrival order.

But "first-to-establish-X" and "Nth-to-replicate-X" have identical structural roles in the cooperative-game formalism (both "contribute 1 unit of knowledge-production to the coalition"). Plain Shapley has no axis to distinguish them.

To distinguish, M must break permutation symmetry. The Novelty Bonus does this explicitly — by depending on the knowledge-set-at-arrival-time, not just the contribution itself.

QED (informally).

## Where the bonus comes from

Important: the Novelty Bonus doesn't inflate the total pool. It re-distributes within the existing pool. High-novelty contributors get more; low-novelty contributors get less. Total unchanged.

This keeps P-001 ([No Extraction Axiom](./NO_EXTRACTION_AXIOM.md)) satisfied. No new value created; existing value just re-allocated with a novelty-weighted measure.

## The similarity function

Computing `similarity_to_prior` is the hard part. Three approaches:

### Approach 1 — Semantic embedding

Embed each contribution into a vector space using a model like sentence-transformers. Compute cosine similarity to prior contributions' embeddings.

**Concrete**: Alice's paper embeds as vector [0.2, 0.5, 0.1]. Bob's paper embeds as [0.3, 0.4, 0.2] (moderately similar). Carol's paper embeds as [0.22, 0.48, 0.12] (very similar to Alice).

Cosine similarity: Alice vs prior (none) = 0. Bob vs Alice = 0.5. Carol vs Alice + Bob = 0.9. Match the numbers we used earlier.

### Approach 2 — Diff-based

Literally: how much of this contribution is derivable from existing ones using standard techniques?

**Concrete**: Alice's paper adds 50,000 tokens of new content. Bob's paper adds 25,000 novel tokens (half derivable from Alice). Carol's paper adds 5,000 novel tokens.

Novelty score = novel content / total content.

### Approach 3 — Expert panel

A tribunal rates each contribution's novelty (0-1 scale).

Scales well when the tribunal has domain expertise. Doesn't scale when the domain is large.

### VibeSwap's approach

A tournament of all three:
- Each produces a novelty score.
- Aggregate via trust-weighted average.
- Commit the function itself via commit-reveal so keepers can't retroactively tune.

The aggregation is ETM-aligned: multi-source consensus via weighted aggregation.

## Why this matters for VibeSwap

The [ETM Build Roadmap](./ETM_BUILD_ROADMAP.md) Gap #2 specifically identifies this: plain Shapley under-rewards novelty. The fix is to extend `ShapleyDistributor.computeShare` with a novelty bonus.

This is not a tuning preference. It's a theorem-consequence:
- Plain Shapley provably fails to distinguish novel from replicated.
- Fix is structural (break permutation symmetry).
- The Novelty Bonus is the specific structural fix.

Implementation planned for C41-C42 per the roadmap.

## What could go wrong

### Failure mode 1 — Similarity-detector gaming

Contributors who know the similarity function can craft content that appears novel but actually replicates.

Mitigation: commit-reveal of the similarity function itself. Keepers can't retroactively tune.

### Failure mode 2 — Tribunal capture

If the novelty-tribunal has a bias (e.g., favors certain research directions), novelty scores are distorted.

Mitigation: tribunal selection is random from high-trust pool; decisions are time-boxed; appeals possible.

### Failure mode 3 — False novelty

Apparent novelty that's actually noise or random variation. Awards high reward to content that shouldn't get it.

Mitigation: peer attestation requirement (high-trust attestors must confirm novelty).

## The bigger principle

The Novelty Bonus isn't just a DeFi mechanism. It's a pattern for any credit-assignment system that needs to reward originality:

- **Academic citation networks**: later papers cite earlier ones. Earlier novel papers should earn more per-citation than latter replications.
- **Code contribution tracking**: the first implementation of a pattern earns more than the 47th copy.
- **Creative work attribution**: the artist who originates a style earns more than those who replicate it.
- **Scientific discovery**: the theorist who first articulates a theory earns more than those who refine it.

VibeSwap's on-chain implementation is one concrete instantiation of this broader pattern.

## For students

Exercise: work through a 4-contributor example by hand:

- Contributors: A, B, C, D
- Shapley shares (plain): each 25%
- Novelty bonuses: A=2.5, B=1.8, C=1.2, D=0.7
- Total pool: $1000

Compute:
1. Raw-novelty-adjusted rewards.
2. Normalized rewards (sum to $1000).
3. Compare to plain Shapley.
4. Interpret: who gets more, who gets less, why?

Do the math by hand; verify the reasoning.

## Relationship to other mechanisms

- **[Shapley Reward System](./SHAPLEY_REWARD_SYSTEM.md)**: the underlying fairness. Novelty Bonus is a modifier on top.
- **[Lawson Floor](./THE_LAWSON_FLOOR_MATHEMATICS.md)**: ensures every attributed contributor gets at least a floor. Composes with Novelty Bonus: floor protects low-novelty contributors from zero-reward; bonus rewards high-novelty above the floor.
- **[Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md)**: provides the source-timestamps needed to compute novelty.

## One-line summary

*Plain Shapley is permutation-symmetric and provably under-rewards novelty. Novelty Bonus breaks permutation symmetry via similarity-to-prior-state computation. Worked example: Alice/Bob/Carol each earn 1/3 under plain Shapley; under Novelty Bonus, Alice gets $450 (novel), Bob $292.50 (moderate), Carol $157.50 (replication). Total preserved; distribution shifted toward originality.*
