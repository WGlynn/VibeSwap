# The Uncomputable Marginal

**Status**: Computability analysis with numeric examples of exponential explosion + Monte Carlo approximation.
**Audience**: First-encounter OK. Complexity bounds walked through step-by-step.

---

## An intuition about combinatorial explosion

Imagine you have 2 coins to flip. There are 4 possible outcomes: HH, HT, TH, TT.

3 coins: 8 outcomes.
4 coins: 16 outcomes.
10 coins: 1024 outcomes.
30 coins: ~1 billion outcomes.
50 coins: ~1 quadrillion.
100 coins: 10^30 — vastly more than atoms in the observable universe.

This is **combinatorial explosion**. The growth rate is 2^N where N is the number of coins. For even modest N, 2^N outstrips any computer's capacity.

Shapley value computation has this same explosion. Let's see why.

## Shapley's requirement

Per [Shapley Reward System](./SHAPLEY_REWARD_SYSTEM.md), the Shapley value for contributor `i` is the average over all permutations of their marginal contribution.

For N contributors, the number of permutations is N! (N-factorial). The number of subsets is 2^N.

For each subset, we need to evaluate the characteristic function `v(S)`.

For 10 contributors: 1024 subsets to evaluate + 3.6M permutations to average over.
For 20 contributors: 1M subsets + 2.4×10^18 permutations.
For 50 contributors: 10^15 subsets + way more permutations.
For 100 contributors: 10^30 subsets.
For 1000 contributors (realistic for VibeSwap at scale): 10^300 subsets. Infeasible.

At VibeSwap-scale, exact Shapley is uncomputable.

## Two layers of uncomputability

Actually, Shapley is doubly-uncomputable in practice:

### Uncomputable layer 1 — 2^N subset explosion

As shown above. For N > ~30, computing 2^N subsets exceeds any practical computer's time budget.

### Uncomputable layer 2 — v(S) is counterfactual

Even if we could enumerate all subsets, evaluating `v(S)` for each is expensive.

`v(S)` = "what value would this coalition S have produced?" This is a counterfactual. Nobody knows what S alone would have produced without running the experiment.

Per [The Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md) Gap #1, `v(S)` has 10-30% estimation error even when we can estimate it.

So: the outer sum is infeasibly large, AND each term requires an expensive counterfactual estimate with substantial error.

Exact Shapley = impossible in practice. We must approximate.

## Monte Carlo Shapley — the working solution

Instead of all N! permutations, sample K random permutations. For each sample, compute each contributor's marginal contribution at the position where they appear.

Average over samples. Error decreases as O(1/√K).

### Worked example

Suppose N = 100 contributors. Exact Shapley needs 100! ≈ 9×10^157 permutation evaluations. Infeasible.

Monte Carlo with K = 1,000 samples:
- Each sample: pick a random permutation; evaluate contributions. Cost ~ N × cost(v).
- Total cost: K × N × cost(v) = 1,000 × 100 × cost(v) = 100,000 × cost(v).

That's feasible. 100,000 v(S) evaluations.

Standard error:
- Single-sample variance of marginal contribution per contributor: bounded by [0, max_v].
- Error in the Monte Carlo estimate: O(1/√K).
- For K = 1,000: error ~ 1/√1000 ≈ 3%.

3% error per contributor is acceptable for most distribution decisions.

## Scaling Monte Carlo to VibeSwap

For realistic VibeSwap scenarios:

### Scenario: 100 contributors, $100,000 pool

K = 1,000 samples. Error ~3%.

Each contributor's expected share: $100,000 / 100 = $1,000 (if roughly equal).
Error per contributor: 3% × $1,000 = $30.

Tolerable for most purposes. A contributor receiving $970 instead of $1,000 due to Monte Carlo noise won't notice or complain.

### Scenario: 1,000 contributors, $1,000,000 pool

K = 5,000 samples.
Each sample: 1,000 marginal contributions.
Total: 5M v(S) evaluations.
Error ~1.4%.

Per contributor's expected share: $1,000,000 / 1,000 = $1,000.
Error per contributor: 1.4% × $1,000 = $14.

Even tighter precision.

### Scenario: 10,000 contributors, $10,000,000 pool

K = 10,000 samples.
Error ~1%.

Per contributor: $1,000. Error: $10.

Still tolerable. Scales further but with diminishing returns on precision.

## The sampling budget-versus-accuracy trade-off

More samples = better accuracy but higher gas cost on-chain (or higher compute off-chain).

For on-chain Monte Carlo: 100 samples costs ~2M gas. 1,000 samples costs ~20M gas. 10,000 costs ~200M gas. 10,000 exceeds block gas limits on most chains.

Solution: compute off-chain, commit via Optimistic Shapley ([`OPTIMISTIC_SHAPLEY.md`](./OPTIMISTIC_SHAPLEY.md)). Off-chain Monte Carlo runs in seconds or minutes; commit result via Merkle root; challenge window allows verification.

## The v(S) estimation budget

Monte Carlo bounds the Shapley summation. But v(S) estimation is another source of error.

For each sampled subset, we estimate v(S). Three approaches:

### Approach 1 — Outcome-based

Look at actual coalitions that existed; interpolate from observed values.

Error: O(sample size of historical data). Usually 20-30% for sparse data.

### Approach 2 — Expert-committee

Have a trusted committee estimate v(S) for key subsets.

Error: subjective. 15-30% cross-observer variation (see [The Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md)).

### Approach 3 — Simulation-based

Model the counterfactual via simulation. Requires accurate simulation-model.

Error: depends on model validity. 10-20% typical.

All three introduce substantial error. The composite Shapley error is the Monte Carlo error × v estimation error ≈ 5-30% per contributor.

## The total error bounds, honestly

At best-case (large Monte Carlo sample + accurate v estimation): 5-10% per contributor.

At worst-case (limited Monte Carlo budget + heterogeneous v estimates): 20-30%.

These are per-contributor errors. In aggregate (all contributors), total distribution error may be larger (correlated errors compound).

This is VibeSwap's honest promise: Shapley-shaped distribution within ~10-30% of theoretical ideal.

## The philosophical implication

**Fairness is not a point; it's a region.**

A protocol can be "fair within 10%" but never "fair to a decimal." Decimal-precision claims are false precision. The bottom digits are uncomputable noise; treating them as meaningful is mis-calibrated.

When VibeSwap says "Contributor X receives $0.123 ETH", honest framing would be "receives ~$0.12 ± $0.01 (10%)."

## The alternative-mechanism comparison

Other distribution mechanisms have their own bounds:

- **Pro-rata by stake**: exact but ignores contribution quality. "Error" is structural (wrong function) not computational.
- **Committee-allocated**: bounded by committee size (~5 people). Each estimate is biased; aggregation reduces but doesn't eliminate.
- **Quadratic voting**: computable exactly. Relies on preference estimates which have their own counterfactual issue.

None is exactly computable. All are approximations. Shapley is at least axiomatically well-defined even when approximated; others lack the fairness guarantee even at perfect computation.

## Disclosure discipline

A transparent Shapley-distribution system should publish:

1. Shapley approximation strategy (Monte Carlo? Structured? Proxy?).
2. Sampling budget (K for Monte Carlo).
3. Estimated approximation error.
4. v(S) estimation method.
5. Overall error bound.

VibeSwap's commitment: publish these openly alongside distribution results. Don't claim precision you can't verify.

## Why this is OK

Real cooperative production has its own natural variance. Two similar contributors doing similar work produce slightly different outcomes based on context, timing, mood. The "fair reward" is itself a distribution, not a point.

Monte Carlo error ≈ intrinsic variance of contribution outcomes. Beyond this, extra precision is wasted — computing to the millionth decimal when the real-world signal is noisy at the hundredth.

## For students

Exercise: work through Shapley approximation for a small case.

- N = 5 contributors, pool = $500.
- Characteristic function: v({i}) = 100 for each i; v(pairs) = 200; v(triples) = 300; etc.
- Compute exact Shapley by hand for each contributor.
- Monte Carlo with K = 100 samples. What's the error?
- Monte Carlo with K = 10 samples. What's the error?

Compare to exact. Observe the trade-off between K and accuracy.

## Relationship to other primitives

- **Parent**: [Shapley Reward System](./SHAPLEY_REWARD_SYSTEM.md) — the foundation.
- **Integration**: [Optimistic Shapley](./OPTIMISTIC_SHAPLEY.md) — Monte Carlo off-chain + challenge window on-chain.
- **Related**: [The Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md) — v(S) estimation is one of five gaps.

## One-line summary

*Exact Shapley is doubly-uncomputable at VibeSwap scale — exponential in N (2^N subsets) AND requires counterfactual v(S) estimates per subset. Monte Carlo approximation with K = 1,000-10,000 samples gives 1-3% Shapley error; v(S) estimation adds 10-30% more. Total: 5-30% error per contributor. Fairness is a region (within ~10-30% of theoretical ideal), not a point.*
