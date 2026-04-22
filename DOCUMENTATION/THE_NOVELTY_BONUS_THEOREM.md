# The Novelty Bonus Theorem

**Status**: Formal argument. Why early contributors need super-linear rewards to counter late free-riding.

---

## The claim

Under cooperative production with multiple contributors arriving at different times, a distribution mechanism that pays equal shares per contribution will systematically under-reward early contributors and over-reward late ones, even when late contributions are trivially derivable from early ones.

To prevent this drift, the distribution mechanism must include a time-indexed novelty bonus that pays early contributors super-linearly relative to their nominal share.

## The setup

N contributors arrive sequentially. Each contributes `x_i` at time `t_i`. The system's state at time `t` is a function `S(t) = f(x_1, ..., x_k)` where the x's are all contributions with `t_i ≤ t`.

Value created at time `t` is `V(S(t)) - V(S(t-1))` — the marginal value added by the latest contribution.

## The naive distribution

Pay each contributor a fraction proportional to their nominal contribution:

```
share_i = x_i / Σ_j x_j
```

Problem: this ignores *order of arrival*. Suppose `x_1 = x_2 = x_3 = 1` unit each, but `x_1` alone builds `V(S(1)) = 10`, `x_2` adds nothing novel (it's equivalent to `x_1`), and `x_3` adds nothing novel.

Under naive distribution, each gets 1/3 of total value = 10/3. But `x_2` and `x_3` added nothing — they free-rode on `x_1`'s novelty. Equal shares mis-compensate.

## The Shapley fix

[Shapley value](./SHAPLEY_REWARD_SYSTEM.md) averages marginal contributions over all permutations. Computing Shapley for the above:

- Permutation [x_1, x_2, x_3]: x_1 marginal = 10, x_2 marginal = 0, x_3 marginal = 0.
- Permutation [x_2, x_1, x_3]: x_2 marginal = 10 (first arrival establishes value), x_1 marginal = 0, x_3 marginal = 0.
- ... (all 6 permutations symmetrically).

Averaged: each gets 10/3. Back to equal shares.

Why? Because Shapley is *permutation-averaged*. In the cooperative-game formalism, each contributor is credited for "what they add when they arrive at a random permutation". Duplicates get equal shares because the permutation-averaging smooths over arrival order.

This is axiomatically fair under the cooperative-game model. But it under-values *actual temporal priority* — the fact that `x_1` really did arrive first, which gave `x_2` and `x_3` the ability to exist at all.

## The problem with pure Shapley

In the real world, late arrivers free-ride on early ones. A late arriver sees `x_1`'s value and can replicate it. Under permutation-symmetric Shapley, the late arriver gets equal credit for a replication that took no novel work.

In the cooperative-game world, this is fine — every contribution that could've been "first" gets equal credit. In the real world, contributions are actually-ordered, and actually-first contributions deserve more credit because they can't be replicated from priors (there were no priors when they arrived).

## The novelty bonus

To correct for this, pair Shapley with a time-indexed novelty bonus:

```
share_i = Shapley(v, i) × novelty_bonus(t_i, context)
```

Where `novelty_bonus(t, context) > 1` when the contribution at time t adds to the knowledge-set-at-t (i.e., genuinely novel), and `= 1` or less when replicable from prior knowledge-set.

Practically:

```
novelty_bonus(x_i, t_i) = max(1, (1 + earliness_weight × (1 - similarity_to_prior(x_i, S(t_i-))))))
```

Where `similarity_to_prior` is computed off-chain (via hash similarity, semantic comparison, etc.) and committed on-chain.

If `x_i` has high similarity to prior state → `similarity_to_prior → 1` → bonus → 1 (no bonus). If low similarity → bonus >> 1 (super-linear reward).

## The theorem

**Theorem**: Under a cooperative-production setting with sequential arrivals, no permutation-symmetric distribution mechanism (including plain Shapley) can simultaneously:
1. Reward all contributions proportionally to their structural value in the cooperative game.
2. Reward contributions of genuine temporal novelty more than replicable contributions.

**Proof sketch**: Permutation symmetry implies that for any two contributions that play structurally-identical roles in the cooperative game, their Shapley values are equal regardless of when they arrived. But "first contribution that establishes a novel pattern" and "Nth contribution replicating the pattern" play structurally-identical roles in the cooperative-game formalism (they're both "contributors to the coalition"). So plain Shapley pays them equally.

To distinguish, you need to break permutation symmetry. The novelty bonus does that — it's an asymmetric modifier that depends on arrival order relative to the knowledge-set at arrival time.

## Consequence for VibeSwap

Plain Shapley underweights true-novelty contributions. VibeSwap's [ETM Build Roadmap Gap #2](./ETM_BUILD_ROADMAP.md) specifically names this: *Shapley distribution's time-indexed marginal*. The fix is to extend `ShapleyDistributor.computeShare` with a time-indexed multiplier that reduces late-replication rewards.

This is not a tuning preference. It is a theorem-consequence: plain Shapley provably fails to distinguish novel from replicated, so the fix is structural.

## Where the bonus comes from

The bonus is paid from the same pool as Shapley itself (not an additional reward pool). High-novelty contributors' bonus is funded by lower-than-Shapley shares to low-novelty contributors. Total payout unchanged; distribution re-weighted toward novelty.

This keeps P-001 (no-extraction) satisfied — no new value is created or extracted; existing value is just allocated with a novelty-sensitive weight.

## The similarity function

Computing `similarity_to_prior` is the hard part. Three approaches:

1. **Semantic embedding** — embed each contribution into a vector space, measure distance from prior-state-embedding.
2. **Code diff / topic modeling** — more literal: how much of this contribution is derivable from prior contributions by standard techniques?
3. **Expert panel** — a tribunal or committee rates novelty.

All three have tradeoffs. Semantic embedding is objective but imperfect. Code diff is exact but narrow. Expert panel is thorough but slow and gameable.

VibeSwap's planned approach: tournament of all three. Each contributes a score; aggregate via trust-weighted average; commit the function itself via commit-reveal so keepers can't retroactively tune.

## Why prior reward systems didn't do this

- **SourceCred** and **Gitcoin** used upvote-based weighting → captures popularity, not novelty.
- **Optimism RetroPGF** used committee voting → captures committee preferences, not algorithmic novelty measure.
- **Plain Shapley** is permutation-symmetric → provably fails to capture novelty.

VibeSwap's time-indexed Shapley aims to be the first mechanism that formally addresses the theorem's constraint.

## Relationship to the Lawson Constant

[Lawson Constant](./LAWSON_CONSTANT.md): "the greatest idea cannot be stolen." This theorem is the economic teeth: if idea-originators are systematically under-credited, they rationally under-produce ideas. The novelty bonus realigns incentives so idea-originators are proportionally-rewarded, making ideas economically viable to produce.

## One-line summary

*Plain Shapley is permutation-symmetric and provably under-rewards novelty relative to replication; the fix is a time-indexed novelty bonus that breaks permutation symmetry — a theorem-consequence, not a tuning choice.*
