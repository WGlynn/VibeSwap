# Economic Theory of Mind

**Status**: Meta-principle, Axis 0 of the VibeSwap design stack.
**Audience**: First-encounter OK. No prior familiarity with mechanism design or crypto-economics required.
**Primitive**: [`memory/primitive_economic-theory-of-mind.md`](../memory/primitive_economic-theory-of-mind.md) <!-- FIXME: ../memory/primitive_economic-theory-of-mind.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

---

## Start with a question

You're reading this doc. At the same moment, you're NOT reading 10,000 other docs that exist online. Your attention is currently on this text. The reading has a cost (time, mental effort). The text is taking up "working memory slots" that other ideas could occupy.

You already experience your mind as an economy. Every moment, some finite resources (attention, working memory, focus) are allocated across options. Some ideas earn their place; others are evicted. You don't plan this economy consciously — but it runs.

This is the entire point of the Economic Theory of Mind (ETM): your mind IS an economy. Not like an economy. *Is*. The same math that governs markets also governs how you think.

Then the big claim: blockchain is the first substrate we've built where this cognitive economy can exist *visibly*. Not inside one skull. Out in the open, where multiple minds can participate, verify, and build on each other's contributions.

## Why this matters

Most projects that build on blockchains design their mechanisms by analogy. They copy traditional finance (AMMs for trading), or traditional voting (DAOs), or traditional reputation (upvotes). The mechanisms are imported from elsewhere and wrapped in crypto.

ETM takes a different starting point: what does the mind do, and how does the mind do it? Then: implement those mechanisms on-chain faithfully.

Concrete example. How does your mind decide what to remember tomorrow versus forget?

- Facts you reviewed today are cheaper to keep; facts you ignored are expensive.
- Facts that connect to many other facts compound their value.
- Facts tied to strong experiences (emotional weight) stay even without review.

On-chain equivalent — CKB state-rent:
- State that pays its rent stays; state that doesn't gets evicted.
- State connected to active contracts sees its retrieval cost amortized across many uses.
- State tied to load-bearing invariants is protected from eviction by design.

Same structure in both cases. Not "similar" — the same mathematical pattern in two different substrates.

## The four direct correspondences

Let's name specific places the same math appears:

### Correspondence 1 — Updating beliefs ↔ Clearing prices

When you change your mind about something after new evidence arrives, you're doing Bayesian update:

```
(Your new belief) ∝ (What evidence tells you) × (Your old belief)
```

When a batch auction clears, orders meet at a single price derived from all bidders' positions. The math is identical — a weighted combination where each input's weight is its precision.

Concrete example. You believed ETH was "probably worth around $2000". You see news that suggests $2,500. Your new belief shifts — but not all the way to $2,500, because your prior information hasn't evaporated. You update, weighted by the reliability of each source. A batch auction does this mathematically: aggregate many bids into one clearing price, weighted by precision.

### Correspondence 2 — Memory decay ↔ State-rent eviction

Your memory decays exponentially without review (Ebbinghaus curve). Rehearsal postpones decay.

CKB-style state-rent: storage costs ongoing rent. Unpaid state is evicted. Payment postpones eviction.

Same pattern. Both systems charge for retention; both evict when payment fails.

Concrete example. You learned a Spanish vocab word last week. You haven't reviewed it. By next month, you've forgotten it (unpaid rent → eviction). If you review it daily (rent paid), it stays indefinitely.

A smart contract works the same way. State with fresh attestations stays; state that no one renews is subject to eviction.

### Correspondence 3 — Credit for contribution ↔ Shapley distribution

You worked on a group project. Who deserves credit? Your fair share depends on what you added that wouldn't exist without you. If three people edit the same paragraph, they don't each get full credit — they share it somehow.

Mathematically, the fair share = your expected marginal contribution across all orderings of joining the group. This is the Shapley value.

It's the ONLY distribution that satisfies basic fairness axioms (equal reward for equal work, zero reward for contributing nothing, addition property for multiple projects).

Concrete example. Alice writes a design doc (high novelty). Bob implements what she designed (medium novelty, requires skill). Carol writes tests (lower novelty, but essential). Each's Shapley share = their expected marginal contribution averaged over all permutations of arrival. Alice's design is load-bearing, so Alice has the highest Shapley weight. Bob and Carol follow. Specific numbers depend on the counterfactual — how much could Bob have done without Alice's doc? How much could Carol have tested without Bob's implementation?

### Correspondence 4 — Agent consensus ↔ NCI weight function

When multiple people agree on something after independent thought, your confidence rises. When they disagree, confidence drops. Your brain does this intuitively.

Mathematically, confidence scales with the number of independent observers, each observer's individual accuracy, and the independence of their reasoning.

VibeSwap's Nakamoto Consensus Infinity (NCI) weight function does this explicitly:

```
W(v) = 0.10 × log₂(1 + work)      // how much computation you've contributed
     + 0.30 × stake                // how much capital you've locked
     + 0.60 × log₂(1 + mindScore)  // how much attested contribution
```

See [`NCI_WEIGHT_FUNCTION.md`](../identity/NCI_WEIGHT_FUNCTION.md) for the full mechanism. The point here: this weighted aggregation is the same math your brain uses when evaluating multi-observer consensus.

## What this is NOT (important — don't round off)

This concept is genuinely novel. The natural move is to round it off to something familiar. Please don't.

ETM is **NOT**:

- **Not "LRU cache"**. LRU evicts by recency. State-rent evicts by payment. The economic axis is load-bearing.
- **Not "Shannon information theory"**. Information theory measures; ETM describes a dynamic where agents produce, exchange, and retire state under constraint.
- **Not "working memory model"**. Cognitive psychologists describe; ETM generates — it predicts what mechanisms should exist.
- **Not "blockchain is like the brain"**. The claim is the reverse: the brain is like an economy, and blockchain is the first transparent instance.
- **Not an analogy**. ETM claims the same mathematics. A Kullback-Leibler divergence IS a Shapley computation under specific conditions.

If you find yourself explaining ETM using the bullets above, the pattern-match-drift reflex is firing. Pause and re-read this doc.

See [`PATTERN_MATCH_DRIFT.md`](../PATTERN_MATCH_DRIFT.md) for more on why novel concepts get rounded to familiar ones.

## How VibeSwap uses ETM

Each mechanism in the stack is designed by asking "what cognitive-economic property should this mirror?" — then implementing the bijection.

| Cognitive property | VibeSwap mechanism |
|---|---|
| Working memory rent | CKB state-rent |
| Marginal-contribution credit | Shapley distribution ([`SHAPLEY_REWARD_SYSTEM.md`](../shapley/SHAPLEY_REWARD_SYSTEM.md)) |
| Evidence-weighted belief update | Commit-reveal batch auction ([`TRUE_PRICE_ORACLE_DEEP_DIVE.md`](../oracles/TRUE_PRICE_ORACLE_DEEP_DIVE.md)) |
| Multi-agent consensus | NCI weight function |
| Reputation / trust | ContributionDAG + SoulboundIdentity |
| Attribution (Lawson Constant) | ContributionAttestor ([`CONTRIBUTION_ATTESTOR_EXPLAINER.md`](../identity/CONTRIBUTION_ATTESTOR_EXPLAINER.md)) |
| Self-monitoring | Circuit breakers + TWAP validation |
| Memory decay | Unbonding delay + state eviction |
| Attention-capture defense | Siren Protocol ([`SIREN_PROTOCOL.md`](../security/SIREN_PROTOCOL.md)) |

Every row is a cognitive-economic property implemented on-chain. Not by accident — by design.

## The directionality claim (load-bearing)

Mind is primary; blockchain is the reflection.

NOT: "blockchain is a new way to think about markets."

The directionality matters because it determines what informs what. Under the correct direction:

- Cognitive science observations inform on-chain mechanism design.
- Philosophical disputes about mind become engineering questions.
- Mechanisms can be calibrated against observable cognitive behavior.

Under the wrong direction (blockchain → mind):
- Mechanisms become arbitrary.
- "Cognition" is a rhetorical decoration, not a design input.
- The theory collapses to "crypto is cool".

VibeSwap's commitment to the correct direction is not aesthetic. It's what makes the architecture testable.

## What follows from ETM

Four practical consequences:

### Consequence 1 — Every mechanism should have a named cognitive property it mirrors

If a mechanism doesn't map to a cognitive-economic property, either the theory is incomplete or the mechanism is arbitrary. Fix whichever is wrong.

Concrete example: [ETM Alignment Audit](./ETM_ALIGNMENT_AUDIT.md) classified 19 VibeSwap mechanisms. 16 MIRRORS (faithful reflection), 3 PARTIALLY MIRRORS (refinement needed), 0 FAILS. The audit enforces this consequence.

### Consequence 2 — Mirror faithfulness is the correctness criterion

A mechanism can compile and pass tests while distorting the cognitive property it claims to externalize. Compilation and tests check CODE correctness; ETM-alignment checks CONCEPTUAL correctness.

Concrete example: NCI's retention weight is currently linear (weight decays proportionally with time). Cognitive retention is convex (weight decays faster as total load increases). Gap #1 in [ETM Build Roadmap](./ETM_BUILD_ROADMAP.md). The current implementation tests clean but mis-mirrors the cognitive property. Fix planned for C40.

### Consequence 3 — Design backward from the property

Don't design a mechanism and then ask "what does it model?" The direction is cognitive-property → mechanism. Backward-design ensures the mechanism actually serves the cognitive economy.

Concrete example: [Siren Protocol](../security/SIREN_PROTOCOL.md) was designed by asking "how does a cognitive system defend itself against exploitative parasites?" The answer (progressive cost-scaling against attack-signals, never blacklist) mapped to the on-chain mechanism.

### Consequence 4 — Gaps are data

When a mechanism imperfectly mirrors a cognitive property, the gap itself is informative. Either the mechanism needs refinement or the cognitive-economic theory needs updating.

Tracked in [ETM Build Roadmap](./ETM_BUILD_ROADMAP.md) — each gap becomes a specific RSI cycle.

## For students

If you're encountering ETM for the first time in an educational setting, here's the progression that typically works:

**Week 1** — Your own cognitive economy. Track your attention across a day; notice what earns it, what gets evicted, what stays. Notice you can't attend to everything — attention is rival.

**Week 2** — Simple correspondences. Memory decay ↔ state-rent. Draw both on a whiteboard; mark where they're identical.

**Week 3** — The Shapley concept. Work through a small Shapley calculation by hand. Feel the fairness axioms.

**Week 4** — Bayesian update ↔ batch auction clearing. Work through a simple example on each side.

**Week 5** — VibeSwap's mechanism stack. Read [`ETM_MATHEMATICAL_FOUNDATION.md`](./ETM_MATHEMATICAL_FOUNDATION.md) for the formal treatment.

**Week 6+** — Read the 30-doc content pipeline. Pick your depth.

## For practitioners

If you're designing a mechanism:

1. Name the cognitive-economic property you're implementing.
2. Find the mathematical structure of that property in cognitive science.
3. Implement the same structure on-chain.
4. Verify the mirror is faithful (use [`CORRESPONDENCE_TRIAD.md`](../CORRESPONDENCE_TRIAD.md) as the design-gate).

The mechanism stack grows by adding faithful mirrors, not by inventing.

## One-line summary

*Your mind is an economy — the same math that governs markets governs how you think. Blockchain is the first substrate where this cognitive economy can run visibly, composably, at scale. Every VibeSwap mechanism is designed by asking "what cognitive property should this mirror?" and implementing the bijection. ETM is the generative frame; mechanism design is the execution.*
