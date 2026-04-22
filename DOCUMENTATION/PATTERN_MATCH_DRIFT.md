# Pattern-Match Drift on Novelty

**Status**: Cognitive failure mode. Contributor-facing.
**Primitive**: [`memory/primitive_pattern-match-drift-on-novelty.md`](../memory/primitive_pattern-match-drift-on-novelty.md)
**Sibling**: [Token Mindfulness](./TOKEN_MINDFULNESS.md) — the proactive counter-discipline.

---

## The failure mode

When a VibeSwap primitive resists fitting a familiar analog, that resistance IS the novelty working. The drift is to round the unfamiliar primitive off to the closest familiar thing, which discards what makes the primitive novel in the first place.

Two variants:

### Variant A — Concept drift

The primitive is genuinely new. You've seen something *similar* in another context. You reach for the nearest familiar concept, apply its mental model, and lose the load-bearing distinction.

Examples of frequent concept drift in VibeSwap:

- **Economic Theory of Mind → LRU cache / attention models / Shannon information / analogy.** ETM is none of these. It claims the same math applies to cognition and to blockchain economics. Rounding to LRU discards the economic axis; rounding to "analogy" discards the claim of identity.
- **JUL → bootstrap token / gas token / governance token.** JUL is money and PoW pillar. Rounding to any of the wrong-role framings collapses the three-token separation of powers.
- **NCI → Proof-of-Stake.** NCI combines PoW + PoS + PoM into a weighted sum. Rounding to PoS drops two of three axes.
- **Commit-reveal batch auction → sealed-bid auction / Dutch auction.** Batch auctions have uniform clearing price (no per-trader ordering); sealed-bid and Dutch do not.
- **Shapley distribution → pro-rata split.** Shapley is marginal-contribution; pro-rata is flat. Very different tails.
- **Augmented mechanism design → protocol design / market microstructure.** Augmented design keeps the market functioning and adds invariants; protocol design replaces the market.

### Variant B — Delivery-scope drift

You're asked to build artifact X. You know how to build a similar artifact Y. You drift toward Y because it's more tractable. The delivered artifact is Y-shaped even though the request was X-shaped.

Example: asked for a ~25 KB process spec, delivered a 250 KB philosophy paper (because philosophy papers are more fun to write). Asked for a code fix, delivered a refactor (because refactors feel more impactful).

This variant is detectable by [Token Mindfulness](./TOKEN_MINDFULNESS.md) — at each generation boundary, notice whether the output's shape matches the spec's shape.

## High-drift zones in VibeSwap

The following primitives are particularly prone to concept drift. When any of them is in play, slow down and verify against the source rather than pattern-matching:

- **JUL** — money + PoW pillar. High drift to "utility token / bootstrap / gas".
- **PoM** (Proof of Mind) — high drift to "reputation score".
- **NCI** — high drift to "Nakamoto Consensus" or "PoS with extras".
- **Augmented mechanism design** — high drift to "protocol design".
- **Substrate-geometry match** — high drift to "good engineering sense".
- **Siren Protocol** — high drift to "rate limiter" or "anti-spam filter".
- **Clawback Cascade** — high drift to "slashing".
- **Stateful overlay** — high drift to "middleware".
- **Economic Theory of Mind** — high drift to "cognitive model" or "blockchain analogy".

When any of these appears, the drift-detector fires. Don't pattern-match; verify against primitive or doc.

## How to apply — detecting drift in yourself

When writing about a VibeSwap primitive, ask:

1. **What is the unfamiliar thing I'm trying to describe?**
2. **What familiar thing am I pattern-matching it to?**
3. **What does the familiar thing get wrong about it?** — this is the load-bearing distinction.
4. **Am I preserving that distinction in what I'm writing, or rounding it off?**

If you can't answer 3, you don't yet understand the primitive and are drifting. Go read the primitive file directly.

## How to apply — detecting drift in conversation

When a contributor (or yourself) says "it's like X" and X is a familiar concept, the claim is that the new thing is X-with-extras. Immediately check: is that true? Or does the new thing have a property X doesn't have (and thus isn't "like X" in the load-bearing way)?

Most VibeSwap primitives fail the "like X" test because their load-bearing property is the one that breaks the analogy.

## The counter-discipline

[Token Mindfulness](./TOKEN_MINDFULNESS.md) is the proactive character trait that prevents drift before it happens. Pattern-Match Drift is the reactive failure-mode detector. Use them together.

## Relationship to ETM

[Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) is the clearest example of a high-drift concept. Rounding ETM to any of the familiar models (LRU, Shannon, attention, working-set, analogy) destroys the load-bearing claim. ETM is first in the "What this is NOT" list of its primitive file for exactly this reason.

## One-line summary

*When a primitive resists fitting a familiar analog, the resistance is the novelty — don't round off; verify against source.*
