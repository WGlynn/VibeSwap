# ETM — Mathematical Foundation

**Status**: Formal foundations for [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md).
**Audience**: First-encounter OK. Each bijection introduced with concrete prior-example before formal statement.

---

## Why this document exists

The parent doc ([Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md)) makes a bold claim: mind and crypto-economics share identical mathematical structure. Four specific bijections are named.

A bold claim needs rigor. "Analogous" is cheap; "bijective" is expensive. This doc works through what "bijective" means for each correspondence.

If you're new to the formalism: don't worry. Each bijection is introduced with a concrete everyday example first. The formal statement comes after the intuition.

## What "bijection" means (if you haven't seen it)

A bijection is a 1-to-1 mapping between two sets such that every element on one side corresponds to exactly one element on the other. If you know element X on side A, you can find its exact twin Y on side B, and vice versa.

**Concrete example**: there's a bijection between "hours of the day" (0-23) and "times we describe" (midnight, 1AM, 2AM, ..., 11PM). Every hour maps to exactly one time; every time to exactly one hour. Perfect correspondence.

For ETM, we claim bijections between cognitive processes and crypto-economic mechanisms. Not analogies — the same mathematical type.

## Bijection 1 — Belief Update ↔ Walrasian Clearing

### Prior intuition

You're deciding what to believe about the weather tomorrow.

Your prior belief: "probably partly cloudy, 70% chance no rain."

You check the forecast. It says: "80% chance of rain."

You update. Your new belief: somewhere between yours and the forecast's, weighted by how reliable each is. Maybe "50% chance of rain" — reducing your initial high-confidence-no-rain after seeing the forecast.

This is Bayesian update. Your new belief is a weighted combination of prior and evidence, weights reflecting each source's reliability.

### Market parallel

A batch auction. Multiple traders submit orders for ETH. Some want to buy at $2,000. Others at $1,995. Others at $2,010. Each has their own level of conviction.

The auction "clears" at a single price. Everyone in the same batch pays/receives the same price. The price is a weighted combination of all bidders' positions.

### The bijection

Mathematically, they're the same operation:

- **Bayesian update** combines prior and evidence via precision-weighted averaging.
- **Walrasian clearing** combines bids and asks via bid-size-weighted averaging.

Under a specific class of utility functions (log-normal likelihoods), the clearing price IS the Bayesian posterior mean. Not "like"; the same formula.

### Implication for VibeSwap

The commit-reveal batch auction clears at a uniform price. Each trader's position contributes to the consensus. No individual trader can bias outcome beyond their position.

Why does it feel like "consensus-formation" rather than "market-matching"? Because it IS consensus-formation. The trader-level reveals mathematically ARE Bayesian-style aggregation of beliefs about the true price.

## Bijection 2 — Marginal Credit ↔ Shapley Value

### Prior intuition

Three friends collaborate on a recipe. Alice shops for ingredients. Bob prepares them. Carol cooks.

At the end, they share the meal. How much credit does each deserve?

If Alice's ingredients were unusual, Bob needed specific skill to prep them. If Bob's prep was sloppy, Carol's cooking can't save the dish. If Carol's cooking is expert, the ingredients and prep get utilized well.

Fair share depends on marginal contribution: what would change if that person weren't there? Alice without ingredients → no meal. Bob without skills → wasted ingredients. Carol without cooking → meal doesn't happen. All three are essential but at different levels of marginal-value.

### The formal version

For a cooperative game with N players and a characteristic function `v(S)` (value of subset S), the Shapley value of player i is:

```
φ_i(v) = (1/n!) × Σ over permutations P
        [ v(predecessors of i in P ∪ {i}) - v(predecessors of i in P) ]
```

Plain English: average over all orders of joining the coalition. For each order, the player's contribution is what they add when they join. Average across all orders.

This has a theorem: Shapley is the UNIQUE distribution satisfying four axioms:

1. **Symmetry** — two players with identical marginal contributions get the same share.
2. **Dummy** — a player who adds nothing gets zero share.
3. **Additivity** — for combined games, share in combined = share in first + share in second.
4. **Efficiency** — total shares sum to total value.

Any other distribution violates at least one of these. Shapley is the one fair answer.

### The bijection

In cognition, when an idea is novel (adds to the knowledge-set), it deserves more credit than an idea that's replicable from priors.

Exactly what Shapley says formally: marginal contribution to the cooperative game of knowledge-production.

### Implication for VibeSwap

VibeSwap distributes rewards via Shapley. Not an arbitrary choice; it's the axiomatically-unique fair answer for distributing over cooperative production.

This is WHY VibeSwap uses Shapley and not, say, equal-splits or vote-counts. Shapley is the only answer that's fair by structural guarantee.

## Bijection 3 — Memory Decay ↔ State-Rent Eviction

### Prior intuition

You learn a new fact. You don't think about it for a week. When you try to recall it, you can't.

Why did you lose it? Because your brain charges ongoing "rent" on facts. Facts you review pay their rent (attention) and stay. Facts you ignore don't; they get evicted.

The decay isn't random. It follows roughly Ebbinghaus's curve: retention drops rapidly immediately after learning, then levels off.

### CKB state-rent

On a blockchain like CKB, smart-contract storage costs ongoing fees. You deposit tokens to fund your state's "rent". Every N blocks, the rent is charged against your deposit. When the deposit runs out, the state is evicted.

Rate parameters are adjustable; the structure is fixed.

### The bijection

Same mathematical pattern. Both use "pay rent to persist; eviction on payment failure."

In cognition: rent = attention allocation (rehearsal). Payment-failure = attention never returns to this fact.

In CKB: rent = tokens. Payment-failure = deposit runs out.

### Where it matters

VibeSwap uses state-rent-like mechanics in the [NCI Weight Function](../identity/NCI_WEIGHT_FUNCTION.md). Contributor mind-scores decay without activity; active contribution refreshes them. Same pattern as cognitive memory.

## Bijection 4 — Multi-Agent Consensus ↔ NCI Weight Function

### Prior intuition

A group of friends are trying to decide where to eat. Some are enthusiastic about Italian. Some want Thai. Some want burgers.

How do you form consensus? One option: vote. But votes don't capture intensity of preference (Alice REALLY doesn't want Italian; Bob is ambivalent).

More fair: weighted aggregation. Stronger preferences get more weight; ambivalent ones less. Different types of opinion (enthusiasm, knowledge about the cuisine, recent experience with the restaurant) get weighted by their relevance.

### The formal version

VibeSwap's Nakamoto Consensus Infinity (NCI) combines three pillars:

```
W(v) = 0.10 × log₂(1 + cumulative_PoW)        // work pillar
     + 0.30 × stake × POS_SCALE                 // capital pillar
     + 0.60 × log₂(1 + mindScore)               // attestation pillar
```

Each pillar represents a different axis of legitimate authority. Work (computational effort). Stake (capital at risk). Mind (attested contributions).

### The bijection

In cognition, consensus formation uses similar weighted aggregation. Multiple sources, each weighted by type:
- **Direct observation** (high weight): the person actually saw it.
- **Expert inference** (medium weight): the person reasoned about it.
- **Hearsay** (low weight): someone reported it secondhand.

Multi-source consensus adjusts confidence based on source diversity AND source reliability. NCI does this explicitly.

### Implication

Consensus in VibeSwap isn't majority-vote. It's weighted aggregation across heterogeneous agent types with log-scaled dampening. Directly reflects how cognitive consensus actually forms.

## What's NOT bijective

Important. ETM doesn't claim all of mind maps to crypto-economics. Specifically:

### Non-bijection 1 — Consciousness

Subjective experience isn't captured by any known formal operation. There's no provable mapping from "what it's like to think" to any on-chain computation.

ETM operates on the computational structure of cognitive processes (which ARE bijective), not the phenomenal experience (which may or may not be).

### Non-bijection 2 — Embodiment

Human cognition is shaped by body-substrate (pain, fatigue, balance). Blockchain-substrate has no body. The cognitive-body interaction has no crypto-economic analog.

### Non-bijection 3 — Affective states

Emotions, moods, attachments — these may be part of cognition but don't map cleanly to crypto-economic primitives.

These non-bijective areas are the edges where ETM as a complete theory of mind fails. ETM is a theory of the cognitive-economic processes — which is a subset of cognition but a substantial one.

## Why bijections and not analogies

An analogy is suggestive. "The mind is like a market" — interesting but non-committal. You can't derive mechanism-design decisions from an analogy; you can only vibe with it.

A bijection is a formal claim. It says: specific mathematical statements on side A are theorems on side B. You CAN derive mechanism-design from a bijection.

ETM's value comes from the bijections being real enough to USE. You can:
- Derive on-chain mechanism design from cognitive-science observations.
- Calibrate parameters quantitatively from observable cognitive behavior.
- Test whether the bijection holds via empirical measurement.

Analogy would let none of those.

## How to tell if a "bijection" is real

Criteria:

1. **The mathematical types are the same.** Not "similar" — the same formal object (same functional form, same domain/range).
2. **Specific theorems transfer.** If a theorem holds on one side, the corresponding theorem should hold on the other.
3. **Parameters transfer quantitatively.** Empirically-estimated parameters on one side should be valid on the other (or bias in predictable direction).
4. **Failure modes transfer.** If the mathematical structure has a pathology, both sides should exhibit the pathology.

For ETM's four bijections:
- Same types: precision-weighted averaging / Shapley axiom-compliant / exponential decay / log-sum aggregation. ✓
- Theorem transfer: Bayesian theorems ↔ Walrasian theorems. Shapley axioms ↔ fairness axioms on distribution. ✓
- Parameter transfer: Ebbinghaus decay constants ↔ state-rent parameters. Substrate-specific but correlated. Some ✓.
- Failure mode transfer: overloaded cognition ↔ overwhelmed state-rent. Same pathology shape. ✓

The bijections pass the test, though not all to the same depth.

## For students learning this

Suggested progression:

**Week 1**: Read the parent doc ([`ECONOMIC_THEORY_OF_MIND.md`](./ECONOMIC_THEORY_OF_MIND.md)). Get the intuition.

**Week 2**: Read this doc. Work through one bijection in detail. Compute a small Shapley value by hand; check it satisfies the four axioms.

**Week 3**: Walk through a Bayesian update and a batch auction clearing. Notice they're the same operation on different inputs.

**Week 4**: Test parameter transfer. Find an empirical decay rate in cognitive psychology. Compare to a state-rent parameter.

**Week 5**: Write up a short analysis of what ETM does and doesn't explain. Bring to a study group.

## For practitioners

If you're designing a mechanism, the bijections help you:

1. Identify what cognitive process the mechanism is supposed to mirror.
2. Find the mathematical structure of that cognitive process.
3. Implement the same structure on-chain.
4. Test the bijection holds via regression.

Example walkthrough: you want to design a "reputation decay" mechanism.

1. Cognitive process: memory decay of confidence in a source.
2. Mathematical structure: exponential decay with rehearsal resetting.
3. On-chain implementation: reputation score that decays over time; attestations reset.
4. Regression test: after simulated inactivity, reputation should drop; after attestation, should rise.

This is ETM-driven mechanism design.

## One-line summary

*ETM claims four bijections between cognitive and crypto-economic processes — Bayesian update ↔ Walrasian clearing, marginal credit ↔ Shapley, memory decay ↔ state-rent, multi-agent consensus ↔ NCI weight function. Each is the same mathematical type in different substrates; theorems transfer; parameters transfer quantitatively. Consciousness, embodiment, affect are NOT bijective — ETM is the computational-structural subset of mind.*
