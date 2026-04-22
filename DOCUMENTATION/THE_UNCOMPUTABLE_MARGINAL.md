# The Uncomputable Marginal

**Status**: Computability analysis of Shapley value in practice.
**Depth**: Why real-world Shapley is approximation, not exact, and what the approximation bounds mean.
**Related**: [Shapley Reward System](./SHAPLEY_REWARD_SYSTEM.md), [The Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md), [The Novelty Bonus Theorem](./THE_NOVELTY_BONUS_THEOREM.md).

---

## The claim

Shapley value is defined as the expected marginal contribution of an agent across all permutations of coalition formation. For N agents, this requires evaluating the characteristic function `v(S)` for every subset S of the N agents — that's 2^N subsets.

At N = 20, that's 1M evaluations. At N = 50, it's 10^15. At N = 1000 (plausible for VibeSwap), it's 10^300. Combinatorially explosive.

More fundamentally: even evaluating `v(S)` for a single subset S requires knowing what that coalition would have produced, which is counterfactual reasoning over a complex cooperative process. The counterfactual itself is not computable exactly — it depends on what agents would have done if the coalition were different, which is a simulation over bounded rationality.

So exact Shapley value is doubly uncomputable: exponential in N AND requiring uncomputable counterfactuals per subset.

Any real Shapley distribution is approximation. Understanding the approximation bounds is important because fairness claims depend on how close the approximation is to the ideal.

## Why this is a real problem

DeFi projects that use "Shapley-like" distributions often hand-wave the computability issue. They compute some marginal-like metric and call it Shapley. But if the computation is off by more than ~10%, fairness claims erode: a contributor's reward can be 20% or 50% different from true Shapley, and they have no way to verify which.

This matters for:
- **Trust in the mechanism**: if contributors see others getting wildly different rewards for similar work, the protocol looks extractive even if it isn't.
- **Governance legitimacy**: trust-weights derived from Shapley feed voting power; inaccurate Shapley yields incorrect voting distributions.
- **Long-term participation**: contributors who feel under-rewarded leave; the protocol bleeds its most productive members.

An uncomputable-but-approximated Shapley is not disqualifying, but it has to be honest about approximation error.

## Approximation strategies

### Strategy 1 — Random sampling (Monte Carlo Shapley)

Sample K random permutations; for each, compute each agent's marginal contribution at the position where they appear in the permutation; average over samples.

- Complexity: O(K × N) per agent (K samples × N-step coalition buildup).
- Approximation error: O(1/√K) — standard Monte Carlo convergence.
- For 1% error at typical confidence: K ~ 10^4 samples. Feasible for N up to ~10,000 in minutes.

VibeSwap's implementation uses Monte Carlo with K = 5,000 per round. Error bound ~1.4%. Acceptable for most distribution decisions.

### Strategy 2 — Structured approximation

Exploit structure in `v(S)`. If `v` is submodular (diminishing returns — typical for cooperative production), there are polynomial-time approximations with O(1/ε) error.

- Used for: broad Shapley over large N where Monte Carlo would be too slow.
- Limitation: assumes submodularity; real v's may violate it in edge cases (strong complementarities).

### Strategy 3 — Proxy-based

Use a simpler computable proxy instead of true Shapley — e.g., "proportional to attestation weight" is a crude proxy. Much faster but known-biased.

- Error: unbounded. Good for rough ordering; bad for precise distribution.
- VibeSwap uses this only in pre-deployment stubs; production uses Monte Carlo.

## The v(S) estimation problem

Even with efficient approximation of Shapley, we still need to evaluate `v(S)` for many subsets. `v(S)` is "the value this coalition would produce" — counterfactual over what S alone, without the other agents, would have accomplished.

Estimating this requires one of:

### Option A — Outcome-based estimation

Look at actual coalitions that existed historically; interpolate from observed values. Requires enough diverse historical data, which may not exist for new projects.

### Option B — Expert estimation

A committee (or trust-weighted group of attestors) estimates `v(S)` for key subsets. Subjective but grounded in domain knowledge.

### Option C — Simulation-based estimation

Run a counterfactual simulation of what S would have produced. Requires a model of cooperative production; the model itself has error.

### Option D — Hybrid

Combine observed + expert + simulated estimates with trust-weighted aggregation. VibeSwap's approach: attestation branches + tribunal review provide implicit v-estimation through the attestation weights themselves.

All four options have estimation error. The composite error (Shapley approximation × v estimation) bounds the total distribution error.

## The bounds, honestly

At best-case (good Monte Carlo + good v estimation): distribution error ~ 5-10% per contributor.

At worst-case (limited Monte Carlo budget + heterogeneous v estimates): error ~ 20-30%.

These are per-contributor errors. In aggregate, systematic biases can be larger (e.g., consistent under-estimation of non-Code contributions).

This is what VibeSwap promises: Shapley-shaped distribution within ~10-30% of theoretical ideal, with the approximation loop itself verifiable via governance and tribunal escalation.

## The philosophical implication

Fairness is not a point but a region. A protocol can be "fair within 10%" but never "fair to a decimal". The Fairness Fixed Point paper ([`THE_FAIRNESS_FIXED_POINT.md`](./THE_FAIRNESS_FIXED_POINT.md)) analyzes this; the Uncomputable Marginal adds the computational reason.

Practically: precision-claims in distribution should be accompanied by error bars. "Contributor X received 0.12345 ETH" is misleading; "Contributor X received ~0.123 ETH ± 0.01 (10%)" is accurate.

The bottom three decimals of the first number are uncomputable noise. Treating them as meaningful creates false precision.

## Why the error tolerance is OK

Real cooperative production has its own natural variance. Two similar contributors doing similar work will produce slightly different outcomes based on context, timing, mood. The intrinsic "fair reward" is itself a distribution, not a point.

Shapley approximation error is smaller than the intrinsic variance of what's being approximated. Caring about ≥10% error in Shapley computation while ignoring ~30% natural variance in contribution outcomes is mis-calibrated.

This doesn't excuse sloppy computation — it contextualizes what precision is meaningful. VibeSwap aims for Shapley approximation error ≈ intrinsic variance of contribution outcomes. Below that, extra computational precision is wasted.

## The alternative-mechanism comparison

Other distribution mechanisms have their own bounds:

- **Pro-rata by stake**: exact but ignores contribution quality. "Error" is structural, not computational — it's using the wrong function.
- **Committee-allocated**: bounded by committee size (~5 people); each member's estimate is biased, aggregation reduces but doesn't eliminate.
- **Quadratic voting**: computable exactly; relies on voter-preference estimates which have their own counterfactual issue.

Among mechanisms that claim to measure contribution, none is exactly computable. Shapley is at least axiomatically well-defined even when approximated. Others don't have the fairness guarantee even at perfect computation.

## VibeSwap's disclosure

A transparent Shapley-distribution system should publish:

1. The Shapley approximation strategy (Monte Carlo? Structured? Proxy?).
2. The sampling budget (K for Monte Carlo).
3. The estimated approximation error.
4. The v(S) estimation method.
5. The overall error bound.

This is the ship-time-verification-surface ([`memory/feedback_ship-time-verification-surface.md`](../memory/feedback_ship-time-verification-surface.md)) applied to distribution: don't claim precision you can't verify.

## Relationship to substrate incompleteness

[Substrate Incompleteness](./SUBSTRATE_INCOMPLETENESS.md): every mechanism has capture surfaces. One specific type of capture is numerical imprecision — small errors that compound across many distributions.

Uncomputable marginal is a form of substrate incompleteness. We can reduce the error; we can't eliminate it.

## The iteration stability concern

Shapley approximation errors propagate through the fixed-point iteration ([Fairness Fixed Point](./THE_FAIRNESS_FIXED_POINT.md)). A 10% error per round compounds: 10 rounds could produce 30-40% cumulative drift if errors are correlated.

Mitigation: un-correlate error per round via Monte Carlo re-randomization. Still, the iteration's fixed point is a blurry region, not a sharp point.

## Open research

1. **Better structured approximations** for specific cooperative-production forms (code contribution, design, governance).
2. **Bayesian Shapley** — update posteriors over contributor Shapley values as new data arrives, rather than recomputing cold each round.
3. **Differential Shapley** — compute the change in Shapley values between rounds efficiently instead of the absolute values.

All three would improve the error bounds without requiring exponential compute.

## One-line summary

*Exact Shapley is uncomputable at VibeSwap scale (exponential in N plus counterfactual v estimation); real-world Shapley is 5-30% approximation with honest error bounds. Fairness is a region, not a point — and that's OK as long as the region is narrower than contribution-outcome natural variance.*
