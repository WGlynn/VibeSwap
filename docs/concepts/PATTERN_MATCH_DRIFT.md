# Pattern-Match Drift on Novelty

**Status**: Cognitive failure mode. Contributor-facing.
**Audience**: First-encounter OK. Concrete drift examples from VibeSwap primitives.
**Primitive**: [`memory/primitive_pattern-match-drift-on-novelty.md`](../memory/primitive_pattern-match-drift-on-novelty.md) <!-- FIXME: ../memory/primitive_pattern-match-drift-on-novelty.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

---

## A recognition you might have had

You're reading about a novel concept. You sense it's new. You're trying to understand it.

Your brain searches for the closest familiar concept. It finds one. You think: "Ah, this is like X."

You now hold the new concept as "X + small differences." You can talk about it. You can apply it.

Except... the "small differences" are exactly what makes the new concept novel. By reducing it to "X + adjustments," you've lost the load-bearing distinction.

You'll now use the new concept wrongly. Your actions will treat it as X, producing X-appropriate behavior when the actual concept required different action.

This is pattern-match drift on novelty. It's a specific failure mode of the very pattern-matching that makes learning possible.

## The rule, stated

When a VibeSwap primitive resists fitting a familiar analog, **the resistance IS the novelty working**. Stopping and recognizing this is what preserves the novelty.

Rounding the novel to the familiar is easy — and wrong.

## Two variants

### Variant A — Concept drift

The primitive is genuinely new. You've seen something SIMILAR in another context. You reach for the nearest familiar concept, apply its mental model, and lose the load-bearing distinction.

### Variant B — Delivery-scope drift

You're asked to build artifact X. You know how to build a similar artifact Y. You drift toward Y because it's more tractable. The delivered artifact is Y-shaped when the request was X-shaped.

Variant B is detectable by [Token Mindfulness](monetary/TOKEN_MINDFULNESS.md) — at each generation boundary, notice whether output shape matches request shape.

## Variant A in practice — specific drift warnings

### ETM drifts to these (stop and re-read if you find yourself saying):

**"ETM is like LRU cache."** Wrong. LRU evicts by recency. State-rent evicts by payment. The economic axis is load-bearing. Rounding loses the economic structure.

**"ETM is Shannon information theory."** Wrong. Information theory measures. ETM is generative — it predicts what mechanisms should exist.

**"ETM is working memory model."** Wrong. Working-memory models are observational; ETM is about the economic dynamic producing the observation.

**"ETM is analogy between mind and markets."** Wrong. Analogies are suggestive but non-committal. ETM claims IDENTICAL mathematics — specific bijections.

**"ETM is 'blockchain is like the brain.'"** Wrong. The claim is the REVERSE. Brain is like an economy; blockchain is the first transparent instance of that economy.

### JUL drifts to:

**"JUL is the VibeSwap token (singular)."** Wrong. There are three tokens. No single one IS VibeSwap.

**"JUL is utility token."** Wrong/vague. JUL is money + PoW pillar. "Utility" obscures the specific roles.

**"JUL is bootstrap."** Wrong. JUL is permanent; coexists with VIBE and CKB-native indefinitely.

**"JUL is like gas."** Wrong. Gas is paid in CKB-native. JUL is unit of account.

### NCI drifts to:

**"NCI is Proof-of-Stake."** Wrong. NCI combines PoW + PoS + PoM. Pure PoS is a subset.

**"NCI is Bitcoin consensus with extras."** Wrong. Bitcoin is pure PoW. NCI weights three pillars.

**"NCI is Ethereum's PoS."** Wrong for similar reasons.

### Siren Protocol drifts to:

**"Siren is rate limiter."** Wrong. Rate limiters block. Siren engages-and-exhausts (honeypot + economic cost-scaling).

**"Siren is anti-spam filter."** Wrong. Filters decide what's spam. Siren doesn't judge content; it charges rent.

**"Siren is blacklist."** Wrong. Blacklists exclude. Siren includes-but-makes-expensive.

### Shapley drifts to:

**"Shapley is pro-rata split."** Wrong. Pro-rata is flat (linear). Shapley is marginal-contribution-based (usually non-linear).

**"Shapley is upvote aggregation."** Wrong. Upvotes are binary; Shapley is continuous.

**"Shapley is fairness score."** Too vague — Shapley is specifically the unique axiom-compliant fair distribution.

### Stateful Overlay drifts to:

**"It's middleware."** Wrong. Middleware modifies substrate behavior. Overlay externalizes without modifying.

**"It's a wrapper."** Wrong. Wrappers hide complexity; overlays add durability at substrate-boundary.

### Augmented Mechanism Design drifts to:

**"It's protocol design."** Wrong. Protocol design often REPLACES markets. Augmented design AUGMENTS them.

**"It's market microstructure."** Partially true at the trading layer; doesn't capture the broader methodology.

### Lawson Constant drifts to:

**"It's attribution policy."** Wrong. Policy is preference; Constant is structural (hardcoded in bytecode).

**"It's a fairness rule."** Wrong. Rules are discretionary; Constant is unchangeable.

## High-drift zones in VibeSwap (memorize the list)

When ANY of these concepts is in play, pattern-match drift is most likely. Slow down. Verify against the source primitive before framing it:

- **ETM** (Economic Theory of Mind)
- **JUL** (monetary layer)
- **NCI** (Nakamoto Consensus Infinity)
- **PoM** (Proof of Mind)
- **Augmented Mechanism Design**
- **Substrate-Geometry Match**
- **Siren Protocol**
- **Clawback Cascade**
- **Stateful Overlay**
- **Lawson Constant / P-000**
- **Shapley Distribution**

If you're talking about any of these and you notice you're using a familiar framing ("it's like X"), check whether X captures the load-bearing distinction. Usually it doesn't.

## How to apply — detecting drift in yourself

When writing about a VibeSwap primitive:

1. **What is the unfamiliar thing I'm trying to describe?**
2. **What familiar thing am I pattern-matching it to?**
3. **What does the familiar thing get wrong about it?** This is the load-bearing distinction.
4. **Am I preserving the distinction, or rounding it off?**

If you can't answer 3, you don't yet understand the primitive. Go read the source primitive directly.

## How to apply — detecting drift in conversation

When a contributor says "it's like X" where X is familiar, immediately check:

- Is it really like X?
- What property does the new thing have that X doesn't?
- Is that property load-bearing?

Most VibeSwap primitives fail "like X" tests because the load-bearing property is the one breaking the analogy.

## The counter-discipline

[Token Mindfulness](monetary/TOKEN_MINDFULNESS.md) is the proactive character trait preventing drift. Pattern-Match Drift is the reactive failure-mode detector. Together:

- Token Mindfulness prevents drift.
- Pattern-Match Drift detects drift after it's happened.

Use them together.

## Why this is load-bearing

Without this discipline, the design conversation drifts into the bag of familiar concepts. Every novel primitive gets softened to its closest familiar neighbor. The design loses its load-bearing distinctions.

Over time, the "novel" project becomes just-another-DeFi with a theme. The differentiation dies.

Preserving the distinctions is how the novelty survives. It's how VibeSwap stays VibeSwap rather than drifting into "another DEX + tokenomics."

## For students

Exercise: pick a VibeSwap concept you've read about. Try to explain it without using the phrase "it's like X." Ask a friend to challenge your explanation.

If the friend understands without the familiar-analog, you've preserved the novelty.

If the friend says "that sounds like X" — either your explanation missed the key distinction, or you rounded off while explaining.

Iterate until the distinction is clear without analogy.

## Relationship to ETM

ETM is the clearest example of high-drift concept. Rounding ETM to any of the bullets above destroys the load-bearing claim.

The "What this is NOT" section of ETM's docs exists specifically to pre-empt rounding. If you find yourself explaining ETM using any of those bullets, Pattern-Match Drift is firing.

## Relationship to other primitives

- **Prevented by**: [Token Mindfulness](monetary/TOKEN_MINDFULNESS.md).
- **Detected by**: this primitive (Pattern-Match Drift itself).
- **Example high-drift zone**: [Economic Theory of Mind](etm/ECONOMIC_THEORY_OF_MIND.md).

## One-line summary

*When a VibeSwap primitive resists fitting familiar analogs, the resistance IS the novelty. Rounding the novel to the familiar loses load-bearing distinctions. Two variants: concept drift (ETM → LRU, JUL → utility token, Siren → rate limiter) and delivery-scope drift (build Y when asked for X). High-drift zone list — slow down when any of ETM/JUL/NCI/Shapley/Siren/Clawback/Lawson Constant/Augmented Design is in play.*
