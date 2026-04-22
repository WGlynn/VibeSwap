# ETM — Mathematical Foundation

**Status**: Formal foundations for [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md).
**Depth**: Formal isomorphism, not analogy.

---

## The bijection

ETM's load-bearing claim is not that mind and blockchain are similar. It is that specific cognitive processes and specific crypto-economic mechanisms share the same mathematical type — there exists a bijection between them under which the processes are computationally equivalent.

This document sketches the bijections. Details in supporting papers; here we state the correspondences.

## Bijection 1 — Belief update ↔ Walrasian clearing

**Setup**: Agent holds prior belief `p(x)`. Evidence `e` arrives. Updates to `p(x | e) ∝ p(e | x) × p(x)`. This is Bayesian inference.

**Parallel**: Batch auction. Orders `O = {o_i}` arrive in commit phase. Clearing price `π` is the unique value clearing aggregate demand against aggregate supply at `π`. This is Walrasian clearing.

**Bijection**: A Bayesian update under a log-normal likelihood with precision-weighted aggregation IS a Walrasian clearing over a specific class of utility functions. The prior plays the role of the reserve price; evidence plays the role of new orders; posterior plays the role of clearing price.

Specifically: if each order `o_i` expresses a belief about the true price with precision `σ_i^{-2}`, the clearing price under uniform-quantity-weighted matching equals the precision-weighted Bayesian posterior over the true price.

This is why commit-reveal batch auctions feel like *consensus formation* rather than market matching — they are consensus formation on the true price, with trades as the mechanism by which agents exchange their posterior-weighted commitments.

## Bijection 2 — Marginal attention credit ↔ Shapley value

**Setup**: Cooperative game `v: 2^N → R` assigns value to every coalition of N agents. Shapley value `φ_i(v)` is the expected marginal contribution of agent i, averaged over all permutations of arrival.

**Parallel**: Novelty-weighted credit assignment. Agent 1 contributes insight X when the knowledge set is empty; credit = full marginal. Agent 2 arrives with similar insight when X is already known; credit = reduced marginal. Averaged over all orders of arrival.

**Bijection**: Shapley value is exactly the cognitive-novelty credit function when the characteristic function `v(S) = size of the derivable-knowledge-closure of S`. This is a specific class of cooperative game (monotone submodular) and Shapley has a closed form under these conditions.

Implication: distributing rewards according to Shapley is not a mechanism-design choice — it is the unique credit assignment satisfying basic fairness axioms for the cognitive-contribution problem. Any other distribution violates one of: symmetry, efficiency, dummy, additivity.

## Bijection 3 — Memory decay ↔ State-rent eviction

**Setup**: Cognitive memory decays over time without rehearsal. The retention probability at `t` is `exp(-λ × t × footprint)` — Ebbinghaus-like curve.

**Parallel**: CKB state-rent eviction. State not paid for after `T` is removed. Rent cost is proportional to cell size (footprint).

**Bijection**: The memory-decay process IS a continuous-time-rent-payment process with rent paid in attention-surface-area × time, and eviction when cumulative unpaid-rent exceeds the rent-reserve. Mapping: unpaid-rent = decay-probability; rent-reserve = rehearsal-intensity. Fund the rent via rehearsal, retention holds; starve the rent, eviction fires.

## Bijection 4 — Agent consensus ↔ NCI weight function

**Setup**: Multiple agents independently reason about a question. The confidence in the converged answer scales with the agent count, their individual accuracy, and the independence of their reasoning.

**Parallel**: Nakamoto Consensus Infinity weight function combining PoW (computational work), PoS (stake), and PoM (attestation): `W = α_W × W_work + α_S × W_stake + α_M × W_mind`.

**Bijection**: NCI's weighted-sum is the consensus-aggregation rule for a specific ensemble where agents have heterogeneous types (computational, economic, attention-bound). The weights (α_W, α_S, α_M) are the relative trust-budgets across types. Under Condorcet-jury assumptions, NCI's aggregate confidence is bounded below by the best single-type's confidence and approaches 1.0 as any type's count grows.

## Bijection 5 — Attention budget ↔ Gas budget

**Setup**: A cognitive agent has finite attention per unit time. Tasks cost attention proportional to complexity and urgency.

**Parallel**: A transaction has finite gas. Operations cost gas proportional to storage / computation / bandwidth.

**Bijection**: The attention economy within a mind is a local gas market. Attention is paid forward; expensive tasks displace cheaper ones; urgency (priority fee) reorders the queue.

Implication: the mechanism-design patterns used to protect chains from gas-exhaustion attacks (rate limiting, DoS caps, tiered pricing) translate directly to cognitive attention-exhaustion defenses (task switching hygiene, interrupt rate limiting, context switching costs). This is why `FibonacciScaling.sol` rate-limiting "feels right" to use-designers — it mirrors a pattern the user's attention system already implements.

## Why bijections, not analogies

An analogy is suggestive but non-committal: X is like Y, interpret loosely. A bijection is a formal claim: there exists a mapping under which specific mathematical statements on side A are theorems on side B, and vice versa.

ETM's value comes from the bijections being real enough to USE. You can derive mechanism-design choices on-chain from observations about cognition, with quantitative transfer — not just "cognition does this so the chain should maybe do something similar".

## What's NOT bijective

- **Consciousness** ↔ nothing on-chain. The chain has no subjective experience (as far as we can specify). The bijection is on the computational structure of cognitive processes, not on phenomenal consciousness.
- **Embodiment** ↔ nothing on-chain. Cognitive processes are shaped by body-substrate constraints that chains don't have.
- **Affect** ↔ nothing currently on-chain. Emotional valences inform real decisions; chain mechanisms don't have affect-equivalents beyond crude approximations.

These non-bijective areas are the edges where ETM as a complete theory of mind fails. ETM is a theory of the cognitive-economic processes, which is a subset of cognition — but the subset that a trust-minimized chain can meaningfully reflect.

## Implication for mechanism design

Given a cognitive process P with known structure, ETM predicts:
- Mechanisms that implement P correctly will exhibit the same phase-transitions, trade-offs, and failure modes.
- Parameters tuned empirically on one side transfer to the other.
- Pathologies of P (attention capture, anchoring bias, confirmation bias) are pathologies the mechanism must architecturally resist.

VibeSwap architecture is substantially derived from this process: find the cognitive process, find its bijection, implement the bijection with augmentation invariants.

## One-line summary

*ETM claims formal bijections (not analogies) between cognitive and crypto-economic processes — Bayesian update ↔ Walrasian clearing, marginal credit ↔ Shapley, memory decay ↔ state-rent, consensus ↔ NCI, attention ↔ gas — enabling quantitative transfer between substrates.*
