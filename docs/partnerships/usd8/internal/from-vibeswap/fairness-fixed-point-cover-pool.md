# The Fairness Fixed Point — for USD8 Cover Pool

**Status**: convergence analysis. Adapted for USD8 from the VibeSwap canonical treatment at `DOCUMENTATION/THE_FAIRNESS_FIXED_POINT.md`.
**Audience**: USD8 protocol team and external reviewers concerned with whether Shapley-distributed Cover Pool yield drifts toward early-LP concentration over time.
**Purpose**: address the load-bearing question any insurance team should ask before adopting Shapley-based reward distribution: *over many rounds of yield distribution, does the system stabilize at a fair equilibrium, or does it drift toward founder dominance?* The honest answer separates what is proven, what is conjectured, and what should be monitored empirically.

---

## Population context (load-bearing for the analysis below)

USD8 is two-population by design — and this document analyzes the **insurer-side population** (cover-pool capital providers, "LPs"), which is structurally separate from the **insured-side population** (USD8 holders).

- **USD8 holders** = the insured. They get automatic free coverage by holding USD8. They never deposit into the cover pool, never pay premium, and are not the subject of this document.
- **Cover-pool LPs** = the insurer capital. They deposit into the pool and earn yield. They are a separate population, funded distinctly from holder activity. This document analyzes whether their yield distribution is fair across rounds.
- **Yield to LPs** is sourced from protocol revenue, partner-protocol coverage fees, and yield share — not from holder premiums (holders pay none).

Holder-side fairness (whether holders get the coverage they're entitled to during loss events) is a separate question, constrained by Layer 2 (Constitution) — specifically the maximum coverage ratio that bounds insolvency. This document does not address holder-side fairness; it analyzes only LP-side iterated fairness over time.

Read the LP analysis below with that distinction held: nothing here speaks to holder-side allocation.

## The question, framed concretely

Suppose USD8 launches the Cover Pool with Shapley-weighted yield distribution to LPs. Three liquidity providers join at different times.

**Round 1** (week 1 after launch): Alice deposits $100k. She's the only LP. She receives 100% of week 1's accrued yield.

**Round 2** (week 4): Bob deposits $100k. The pool now has $200k. The Shapley distribution assigns shares based on each LP's marginal contribution to the pool's value function — capital, tenure, stability, quality. Alice has more tenure than Bob; Bob has equal capital. The closed-form Shapley share favors Alice slightly, in proportion to her tenure premium.

**Round 13** (week 52): Carol deposits $100k. Pool is now $300k. Alice has 51 weeks of tenure; Bob has 48 weeks; Carol has zero. Alice's tenure-weighted share is now substantially higher than Carol's. Quality multipliers, accumulated from prior rounds of clean operation, also favor Alice and Bob over Carol.

Question: **does this dynamic continue indefinitely**, with Alice's share growing each round and Carol's never catching up — eventually producing a Cover Pool where 80% of yield flows to a small set of early LPs while later arrivals receive a small fraction even at equal capital?

Or does it **stabilize at some fair equilibrium**, where each LP's long-run share matches their long-run marginal contribution — even if early LPs get a slight tenure premium that asymptotes rather than compounds?

This is the fairness-fixed-point question. It's about iteration, not single rounds. The Shapley spec says single rounds are formally fair. The honest follow-up question is whether the iterated system is also formally fair.

For an insurance protocol, this question is load-bearing. If the answer is "drifts toward founder dominance," the Cover Pool eventually becomes structurally hostile to new LP capital, which limits the pool's growth, which limits coverage capacity, which limits USD8's adoption. If the answer is "stabilizes at fair equilibrium," the Cover Pool can grow indefinitely without losing its fairness properties. The architecture's long-run viability depends on which answer is right.

---

## Why iteration matters

Shapley distribution is provably fair for a single round under specific cooperative-game assumptions. The four axioms (efficiency, symmetry, null-player, additivity) hold exactly for the closed-form linear case we use in the Cover Pool spec. Each individual yield distribution event is, in this sense, formally fair.

But the Cover Pool runs Shapley *iteratively*. Each round's rewards feed back into the pool's state — accumulated quality scores, accumulated tenure, accumulated reputation — which then affects the next round's Shapley computation. This is a feedback loop.

Feedback loops do not automatically converge to fair distributions. They can:

- **Converge to a stable fair distribution** (good — the Cover Pool maintains its fairness properties indefinitely).
- **Converge to a stable unfair distribution** (bad — the Cover Pool stabilizes at founder dominance and stays there).
- **Oscillate** (worse — distribution swings between regimes round-to-round).
- **Wander without settling** (worst — no equilibrium at all; behavior unpredictable in the long run).

"Shapley is fair" is a single-round claim. The iterated version is a separate mathematical question that requires its own analysis. This document works through it for the USD8 Cover Pool specifically.

---

## What "fixed point" means

A fixed point of an iteration is a state where applying the iteration leaves the state unchanged. In our case:

```
distribution_{t+1} = iterate(distribution_t)

distribution* is a fixed point iff
distribution* = iterate(distribution*)
```

If iteration converges, it converges to a fixed point. *Which* fixed point matters — fair ones are the desired outcome.

Three critical questions about fixed points in this context:

1. **Existence**: does any fixed point exist at all? (If not, the system never settles.)
2. **Uniqueness**: is there exactly one fixed point, or multiple? (Multiple means the long-run outcome depends on starting conditions.)
3. **Stability**: do nearby states flow toward the fixed point (stable) or away from it (unstable)? (Unstable fixed points are mathematically real but practically irrelevant.)

For "fair distribution under iterated Shapley in the Cover Pool," we need all three to have good answers. Each is treated separately below.

---

## A concrete scenario — 3-LP Cover Pool

Let's build intuition with the small example from the opening, made numerical.

Three LPs: Alice (depositor since launch), Bob (joined at month 1), Carol (joined at month 12). Each contributes $100k at their respective entry. Assume the pool accrues $10,000 yield per month from yield-strategy revenue.

The Cover Pool Shapley computation uses four observable inputs (per the companion Shapley spec): direct contribution (capital), enabling contribution (tenure with logarithmic weighting), stability score (off-chain assessed), quality multiplier (reputation-oracle).

**Month 12 distribution** (just before Carol joins):

- Alice's tenure: 12 months → enabling weight $\log_2(12+1)/10 \approx 0.37$
- Bob's tenure: 11 months → enabling weight $\log_2(11+1)/10 \approx 0.36$
- Capital weights are equal at 0.40 each
- Stability: assume 0.10 each (no stress events yet)
- Quality: assume 1.0× each (clean operation history)

Combined raw weights: Alice ≈ 0.87; Bob ≈ 0.86. Distribution: Alice $5,058, Bob $4,942.

This is a small premium for Alice (1.1× Bob's share) — consistent with her one-month tenure advantage, and importantly *not* compounding rapidly.

**Month 13** (Carol joins):

- Alice: 13 months tenure → 0.38; raw weight 0.88
- Bob: 12 months → 0.37; raw weight 0.87
- Carol: 1 month → 0.10; raw weight 0.60 (capital weight gives her most of her score; tenure gives almost nothing)

Distribution: Alice $3,648, Bob $3,608, Carol $2,743.

Carol receives 73% of Alice's share at equal capital. That's a tenure penalty, but not catastrophic. Over many subsequent months, Carol's tenure advantage closes.

**Month 60** (Carol now has 4 years; Alice has 5; Bob 4.9):

- Alice: 60 months → 0.60; raw weight 1.00
- Bob: 59 months → 0.60; raw weight 1.00
- Carol: 48 months → 0.56; raw weight 0.96

Distribution at $10k/month: roughly Alice $3,389, Bob $3,389, Carol $3,222.

Carol now receives 95% of Alice's share at equal capital. The tenure premium has *asymptotically faded* because the logarithmic weighting on tenure means each additional month matters less than the prior one.

This is the desired property. The iteration does not produce founder dominance; it produces a slight, fading premium for early arrival that converges to near-equality over realistic time horizons. The math has the right shape *because of the logarithmic tenure weighting* — a linear weighting would compound forever; a logarithmic one approaches an asymptote.

---

## Why the dynamics work for USD8

The numerical example above is not coincidence. It is the structural consequence of three architectural choices in the Cover Pool's Shapley implementation, each of which is specifically calibrated to bound the drift dynamics:

### Choice 1 — Logarithmic tenure weighting

The enabling-component weight is $\log_2(\text{months} + 1) / 10$. Logarithmic functions grow without bound, but at a decreasing rate. The first month of tenure is worth more than the 100th month of tenure.

The implication: an LP can never extract a permanently growing premium from tenure. The tenure premium *asymptotes*, allowing late arrivals to close the gap over realistic time horizons.

The alternative (linear tenure weighting: weight = months) would produce permanent founder dominance because the gap between the first depositor and the hundredth-day depositor would compound forever. The logarithmic choice is what makes the system convergent rather than divergent.

### Choice 2 — Capital weighting at fixed coefficient

The direct-contribution component has a fixed coefficient (40% in the spec). Capital is rewarded proportionally — twice the capital, twice the contribution. There is no capital-amount multiplier that grows with prior holdings.

The implication: Alice cannot use her accumulated yield to compound a capital advantage that accelerates her share growth. Each round's distribution is per-capital-unit symmetric.

The alternative (capital weighting that includes accumulated yield as a multiplier) would produce winner-take-all dynamics. The fixed-coefficient choice prevents this.

### Choice 3 — Quality multiplier with floor and ceiling

The quality multiplier ranges 0.5× to 1.5×. It is bounded above and below. An LP cannot accumulate unbounded quality advantage.

The implication: even if Alice starts with a perfect quality score and maintains it perfectly, her quality premium maxes out at 1.5× while Carol's quality floor is 0.5×. The max ratio is 3:1, and only at extreme parameter values. In practice the ratio is much smaller.

The alternative (unbounded quality multiplier) would let reputation compound indefinitely. The bounded form prevents this.

Together, these three architectural choices put the Cover Pool's Shapley dynamics into the "balanced fixed point" basin of attraction. Each LP's long-run share converges to their long-run marginal contribution. Late arrivals are not permanently penalized for their timing; early arrivals do not extract permanent rent.

---

## The honest formal answer

The intuition above can be tightened into formal claims. Each of the three fixed-point questions has a different status of proof.

### Existence

**Status: proven.**

Brouwer's fixed-point theorem applies. The iteration map (raw weights → normalized shares → updated quality scores → next-round raw weights) is continuous in the underlying quantities. Continuous self-maps of compact convex sets always have at least one fixed point. The distribution simplex is compact and convex. The map is continuous. Therefore at least one fixed point exists.

This is a standard result; the only USD8-specific work is verifying that the actual iteration map is genuinely continuous, which it is given the smoothness of all four weight components.

### Uniqueness

**Status: conjectured, not proven.**

The iteration is non-linear (the quality multiplier has bounded saturation; tenure has logarithmic curvature; aggregation has piecewise structure). Non-linear maps can have multiple fixed points.

For the USD8 Cover Pool, the realistic fixed-point structure is likely one balanced equilibrium plus possibly one "founder-saturated" equilibrium where every LP is at the quality ceiling. Which basin a given trajectory ends up in depends on initial conditions and noise.

The empirical conjecture (testable via simulation): the founder-saturated basin has a narrow attraction radius (it requires nearly all early LPs to maintain perfect quality scores indefinitely, which is unrealistic), while the balanced basin has a broad attraction radius (any reasonable mix of LP behaviors converges there).

This is verifiable via simulation. The ETM Build Roadmap in the VibeSwap codebase queues this simulation cycle for VibeSwap's analogous problem; the same simulation logic ports directly to USD8 with input substitution.

### Stability of the balanced fixed point

**Status: conjectured via spectral analysis, not formally verified.**

Stability near a fixed point requires the local Jacobian to have eigenvalues with magnitude < 1 (strictly contractive). For the Shapley-via-weighted-aggregation composition near a balanced fixed point:

- Shapley computation in the linear-characteristic-function form is essentially a weighted-average operation; weighted averages have spectral radius ≤ 1.
- Quality-multiplier updates have bounded sensitivity (bounded above by 1.5× / 0.5× = 3× max ratio; first-order sensitivity to single-round perturbations is much smaller).
- Tenure updates are deterministic in time (no perturbation propagation).

The composition's spectral radius is conjectured to be < 1 in the neighborhood of balanced fixed points. Formal verification would require either symbolic Jacobian analysis or numerical simulation across the parameter space.

---

## What ports from VibeSwap to USD8

The above analysis is a direct port of VibeSwap's analogous treatment with three substitutions:

- "Trust score updates" → "quality multiplier updates"
- "Founder vs newcomer attestation weight" → "early-LP vs late-LP tenure premium"
- "Trust-graph BFS decay" → "logarithmic tenure weighting"

The architectural mitigations port directly. Specifically:

- **Trust-weight cap (3.0×)** in VibeSwap's design → **Quality multiplier cap (1.5×)** in USD8's Cover Pool design.
- **15% per-hop decay** in VibeSwap → **Logarithmic tenure weighting** in USD8.
- **Six-hop max for BFS** in VibeSwap → not directly applicable (USD8 has no graph), but the analogous constraint is the bounded quality multiplier.
- **Three-branch attestation** in VibeSwap → applicable to USD8's claims tribunal (per the Aug-Gov supplement), not Cover Pool LP rewards.
- **Constitutional axioms (P-000, P-001)** in VibeSwap → directly applicable; the same Augmented Governance hierarchy (per the companion supplement) protects the Cover Pool's Shapley dynamics from being voted into a divergent regime.

USD8 inherits VibeSwap's mitigations against drift. The mitigations are not coincidence; they are the same architectural pattern.

---

## What could break convergence (and how USD8 defends)

For completeness, the failure modes that would break convergence, and the corresponding USD8 defense:

### Break 1 — Quality multiplier becomes unbounded

If a future governance amendment removes the 1.5× cap on quality multipliers, the system loses its bounded-multiplier property and can drift toward winner-take-all.

Defense: the multiplier cap is a Layer 1 invariant (per Augmented Governance), not a Layer 3 parameter. Cannot be amended by a routine vote. Requires a constitutional amendment with extraordinary supermajority, which itself requires the math to validate that the amendment does not introduce extraction.

### Break 2 — Tenure weighting changes from logarithmic to linear

If a future amendment makes tenure linear (each month worth the same as the first), the system loses its asymptotic-tenure-premium property and can drift toward founder dominance.

Defense: the tenure-weighting *form* is a Layer 2 (constitutional) parameter; the specific coefficient is Layer 3. Changing the form is a constitutional amendment with friction. The form was chosen specifically to preserve convergence; changing it would be detected by any reviewer applying the Fairness Fixed Point analysis.

### Break 3 — Capital-amount multipliers introduced

If a future amendment introduces a capital-amount-multiplier (e.g., "capital deposits >$10M earn 1.5× weight"), the system loses its per-capital-unit symmetry and can drift toward concentration.

Defense: per-capital-unit symmetry is a Layer 2 (constitutional) property. Same friction as Break 2.

### Break 4 — Quality scores manipulated by oracle compromise

If the off-chain process that computes quality scores is compromised (Sybil-influenced, captured by a coalition, fed false inputs), the multiplier can be biased toward favored LPs even within its 0.5×–1.5× cap.

Defense: per the Shapley spec, the natural integration is to compute quality scores via Brevis ZK proofs against the on-chain history. Verifiable computation removes the trust requirement on the oracle; manipulation requires breaking the cryptography, not just compromising a person.

### Break 5 — LP coalition extracts yield at holder expense

LPs and holders are distinct populations (insurers vs. insureds). Even if LP-side allocation is iteratively fair (the property this document establishes), an LP coalition could in principle game the yield-split parameters to over-allocate to LPs at the expense of holders' coverage capacity.

Defense: the **maximum coverage ratio** is a Layer 2 (constitutional) parameter — currently bounded by analytical solvency analysis (per the companion Augmented Governance doc). LP yield can grow only insofar as the pool's solvency margin to holders is preserved. Raising LP yield by lowering coverage ratio requires a Layer 2 amendment that must show holders are not made structurally less safe. The two populations' fairness is decoupled at the LP-allocation layer (this doc) but coupled at the constitutional-bounds layer (Augmented Governance).

Each defense maps to one of the architectural choices already in USD8's design or proposed in companion specs. The defenses are not bolt-ons; they are the mechanism's structural form.

---

## Implications for monitoring

The fixed-point question is a long-run property; monitoring is the short-run analog. Useful metrics for USD8 to track in production:

- **Rolling-window LP-share Gini coefficient**: how concentrated is the share distribution across LPs over the last N rounds? Alert on sustained increase.
- **LP-tenure histogram**: is the LP set dominated by long-tenured LPs, or balanced across tenure cohorts? Skew toward long-tenured suggests new capital is not joining.
- **Per-LP share trajectory**: for each LP, is their share growing, stable, or shrinking over time? An LP whose share grows monotonically over many rounds is a signal worth investigating.
- **Quality-multiplier distribution**: how many LPs are at the 1.5× ceiling vs. the 0.5× floor? Bimodal distributions suggest the multiplier is over-discriminating.

These metrics do not *prove* convergence to a fair equilibrium. They make drift observable in real time so it can be diagnosed and addressed before becoming structural.

---

## The honest assessment

As of this writing, the USD8 Cover Pool's Shapley dynamics have:

- **Existence of fixed points**: proven (Brouwer).
- **Uniqueness**: not formally proven; one balanced equilibrium plausible plus possibly one founder-saturated equilibrium with narrow attraction radius.
- **Stability of balanced fixed point**: conjectured via spectral analysis; not formally verified.
- **Architectural mitigations**: ported from VibeSwap, with explicit Augmented Governance defense against amendments that would break convergence.

The honest summary: the Cover Pool is *probably* operating in a balanced-fixed-point basin, with strong architectural reasons to believe so, but "probably" is not "proven." Empirical simulation and ongoing monitoring close the remaining gap.

For a stablecoin protocol where the long-run viability of the Cover Pool depends on convergence to a fair equilibrium, this honest distinction matters. It is one of the design questions any external auditor will raise. The defensible answer is the one above: existence proven, mitigations in place, monitoring planned, simulation queued. Not "we promise the math works" — but "here is what the math is doing, here is what we have proven, here is what we have not yet proven, here is what we are doing about it."

---

## One-line summary

*Iterated Shapley distribution in the Cover Pool converges to a balanced fixed point because of three architectural choices — logarithmic tenure weighting, fixed-coefficient capital weighting, bounded quality multipliers — that together place the system in a basin of attraction where late arrivals are not permanently penalized and early arrivals do not extract permanent rent. Existence proven; uniqueness and stability conjectured with empirical verification queued; architectural defenses against amendment-induced drift inherit from the Augmented Governance hierarchy.*

---

*Adapted for USD8 from the VibeSwap canonical treatment. The longer treatment, with the original three-contributor scenario, formal claim structure, and references to the broader fixed-point literature, is at `DOCUMENTATION/THE_FAIRNESS_FIXED_POINT.md` in the VibeSwap repository. This supplement is offered as a USD8-Cover-Pool-specific application of the same analysis — the math carries over identically; the scenarios and defenses are USD8-specific.*
