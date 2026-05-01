# The Lawson Floor
## Why honest contributors should never get zero

*A two-page primer on VibeSwap's structural fairness invariant — what it is, where it came from, and what it could do for the way we run shared-reward systems.*

---

## The idea in one sentence

The **Lawson Floor** is a mathematical invariant built into VibeSwap's reward distribution that guarantees every honest participant who meets the participation threshold receives a non-zero share of the coalition's output — no matter how small their individual contribution.

## The failure mode it prevents

Most modern reward systems — hackathons, grant programs, open-source bounties, DAO treasuries, even employer bonus pools — are **winner-take-most**. A small group of top performers captures the majority of the reward, and a long tail of sincere contributors walks away with nothing.

A concrete datapoint from the week this document was written: the 2026 MIT Bitcoin Hackathon distributed rewards to 22 of 47 teams. Twenty-five teams built something — invested weekends, wrote code, shipped demos — and received zero. The filter was elegance, not effort or honesty. From the organizer's perspective, this is efficient. From the standpoint of an honest builder who shipped a working prototype against the clock, it is a spit in the face.

Winner-take-most distribution pathologies stack:
- **Discouragement** — first-time contributors see that zero-reward is the modal outcome and stop showing up.
- **Capital concentration** — those who can afford to lose keep trying; those who can't, don't.
- **Sincerity discount** — honest-but-unspectacular work becomes invisible. The system rewards polish over contribution.

The Lawson Floor is the structural rebuttal: if you were sincerely in the coalition, the coalition owes you a share.

## The mechanism, plainly

Given a total reward pot and a set of participants who cleared the honesty/participation threshold:

```
raw_share[i]      = shapley_value(participant_i)         # counterfactual marginal contribution
floor_share       = total_pot × MIN_FLOOR_FRACTION       # e.g., 1% of pot per participant
adjusted_share[i] = max(raw_share[i], floor_share)
```

Above-floor winners are proportionally scaled down to fund the floor guarantee. The relative **ordering** of contributions is preserved — whoever contributed most still receives the largest adjusted share. What changes is that the minimum is not zero; it is a structural positive.

The fraction is tunable. VibeSwap uses 1% per honest participant as its default floor. At 100 participants, the floor saturates the pot and the system converges to pure proportional-Shapley; below that, the floor guarantees minimum attribution.

## Origin: how and why it came about

The Floor takes its name from VibeSwap's Genesis Axiom — `P-000: FAIRNESS_ABOVE_ALL:W.GLYNN:2026`, the cryptographic commitment declared as a constant in the VibeSwap core contracts. The axiom is not decorative. It is a `bytes32` hash checked at runtime in `recalculateTrustScores()`; remove it and the trust-score pipeline reverts, and with it the entire Shapley-reward path collapses. Fairness is load-bearing: the code will not produce reward signals if the fairness commitment is missing from storage.

The Lawson Floor is the operational consequence of that axiom. It emerged from a specific engineering concern — "how do we prevent null-player collapse from zeroing out honest small contributors?" — and generalized into a constitutional commitment: *no honest participant should ever walk away empty-handed from a coalition they helped form.* The axiom is named in durable form so that every future audit round, every fork, every contributor onboarding moment has to reckon with it. It is designed to survive the founder's absence. It becomes part of the protocol's bones, not its decor.

In TRP audit cycles the Floor survived a vulnerability discovery (Lawson Floor sybil vulnerability, closed across 200/200 test rounds) and a quality-weight refinement (F04 fix, capping the floor at 100 participants to prevent pool-overcommit). Both refinements hardened the invariant rather than weakening it.

## What it could do for society

The Floor is general. Anywhere a coalition of sincere contributors produces shared output under a reward pot, the pattern applies. Three examples:

**1. Participatory events (hackathons, grant rounds, innovation challenges).** Instead of "22 of 47 teams win, everyone else eats the cost of having shown up," a Lawson-Floor hackathon distributes a guaranteed participation share to every team that meets objective completion criteria (working demo, honest effort, code shipped), while still weighting the bulk of the pot toward top performers by Shapley judgment. Participation becomes sustainable for builders who can't subsidize their own attempts. Over time, the participant pool grows more diverse, more international, more economically heterogeneous.

**2. Cooperative coalitions (protocol DAOs, worker-owned collectives, federated research groups).** In a Shapley-distributed treasury, a contributor who offers a small insight — a code review, a design-pattern suggestion, a one-hour audit relay — is currently dominated by heavy full-time builders and usually receives nothing. The Floor guarantees that their contribution is registered. The Contribution DAG already traces this attribution; the Floor makes sure the trace produces non-zero output. This changes who can afford to contribute. An independent reviewer in São Paulo, a student in Lagos, a retiree in Maine — each can participate in a coalition without needing to match the throughput of its core team.

**3. Open-source and research bounties.** Most bounty programs pay the final merger and stiff the five people whose insights led to the merge. A Lawson-Floor bounty registers every attributable contribution in the discovery chain — the bug reporter, the reproducer, the proposer of the fix, the final merger — and guarantees each a share. The amount is weighted by counterfactual value, not by who showed up last. Contributors who enabled the result without executing the final step are structurally credited. This is, not incidentally, the same pattern VibeSwap's Contribution DAG is already deploying in production.

## What it means for society

The Lawson Floor is a small piece of Solidity. It is also a statement: **structural fairness is cheaper than structural unfairness, once you build it in early.**

Winner-take-most systems produce short-term efficiency and long-term brittleness. The filter is narrow, the pool shrinks, the ecosystem over-indexes on a small class of participants. Lawson-Floor systems trade a few percentage points of peak reward for a participation curve that stays healthy over time — more contributors return, more new contributors show up, more sincere work is registered. The protocol's bus-factor, talent-pipeline, and cultural legitimacy all improve.

There is also a moral dimension. Coalitions that zero out sincere contributors are telling them their work didn't matter. A coalition that guarantees a minimum share is telling them: *you were here, we saw you, your presence was part of what we built.* This is a different contract between a protocol and its participants. It does not require charity, patronage, or discretion — the Floor is enforced in code, applied mechanically, visible on-chain. It is architecture, not virtue.

The competitive implication is simple: protocols that enforce structural fairness will, over long enough time horizons, attract the contributors that protocols without it filter out. The pool deepens. The ideas compound. The long tail becomes the network.

The MIT Bitcoin Hackathon operates a winner-take-most distribution, and 25 honest teams paid for it with their time. VibeSwap is built on the opposite stance — not because we are more generous, but because we read the math differently. Fairness that costs nothing to maintain and compounds over time isn't charity. It's a better architecture.

---

*The Lawson Floor is structural. It survives Will's absence. It survives forks. It is the cryptographic name we gave to a promise: if you build with us, you will not be zeroed out.*

*Named 2026. Implemented in `contracts/incentives/ShapleyDistributor.sol`. Audited across TRP Rounds 1–49 and RSI Cycles 1–11. Open for external use by any coalition willing to adopt it.*
