# Capture on Same Turn

> The discipline that makes the discipline layer work.

Layer 4's job is to surface patterns at three observations and write them as primitives or feedback rules. The capture loop is documented in the layer README. What's not documented there, but is load-bearing, is *when* the capture happens within a session.

Two failure modes in primitive capture timing:

**Capture-deferred.** Pattern observed in turn N, noted but not written. Session ends or compresses; the working-memory note evaporates. Future-you does not have the primitive. The 3+ threshold is met, but the artifact isn't.

**Capture-batched.** Patterns accumulate across turns; user dumps them all at session-end. The result is a flood of half-formed primitive files that need editing later. Most of them rot because the dialogue context that produced them has compressed away.

Both modes are dominant in practice without explicit discipline against them.

## The rule

When a pattern is named — by the user or surfaced by JARVIS — the primitive file is written **on the same turn**. Not after a few more exchanges. Not at session-end. Not "I'll save this when I get a chance." On the same turn.

The cost of capture-on-same-turn is small (one file write, ~200 tokens). The cost of capture-deferred is the entire primitive (lost when the conversation closes). The asymmetry is large; the discipline is to default to the cheap side.

## Why this works

Three properties combine.

**The dialogue is still in context.** A primitive captured on the turn it's named has access to the exact dialogue that produced it — the user's words, the example that triggered the recognition, the nuance distinguishing this pattern from adjacent ones. Captured five turns later, all of that has decayed; the primitive becomes a vague summary instead of a precise rule.

**The naming moment is the discrimination moment.** Three observations is the threshold; the third observation is where pattern-from-noise becomes structurally distinguishable. Capturing at the third observation means the rule is written when the pattern's edges are sharpest. Wait, and the edges blur — adjacent patterns get conflated, the rule generalizes too far or too narrowly.

**No state-management overhead.** Batching primitive captures requires tracking a backlog of pending primitives across turns. Each batched primitive needs context restoration — re-reading the dialogue that produced it. The same-turn rule eliminates the backlog: capture happens in the same context that produced it, no replay needed.

## What captures look like

Same-turn capture is small and tight. A primitive file is structurally:

```markdown
---
name: <CamelCaseName>
description: <one-line what-it-captures, used for relevance matching>
type: <primitive | feedback | project | reference | user>
---

**[<sigil>]** — terse rule statement.

> *"<user's exact words, if applicable>"* — <user>, <date>

## Why
- <load-bearing reason>
- <distinguishing edge vs adjacent patterns>

## Trigger
- <conditions that fire this primitive>

## Action
- <what to do when triggered>

## Origin
- <session date + brief context>
```

Five sections, each terse. The whole file is usually under 50 lines. Writing one takes 1-2 minutes from inside an active dialogue. The cost discipline is that this is *cheap* — there's no excuse for deferring.

## The bootstrap on this primitive itself

The instance that named this primitive: 2026-05-06, mid-session, the user named the bidirectional-reification rule. JARVIS's response: write the memory file, write the index entry, ship the spec doc + interfaces + reference impls all on the same turn. Bootstrap-on-self.

The discipline applied to itself: *capture-on-same-turn captured itself on the same turn it was named*. The primitive that says "write rules immediately" was written immediately. Recursive demonstration that the cost is small and the value is large.

## Composition with other discipline patterns

- `[F·apply-rule-just-wrote]` — once captured, the rule must apply to subsequent actions in the same session. Capture without immediate application is incomplete.
- `[F·bidirectional-reification]` — capturing the rule (word) is paired with reifying it as runnable hook code or applied to next action (code). Word and code reify each other.
- `[P·hiero-no-prose-in-memory]` — when capturing, write in the dense glyph form, not prose. Capture must be both immediate AND format-correct.

The three primitives together produce: *terse, immediate, format-correct primitive capture, with the rule firing on subsequent actions in the same session*. That's what Layer 4 looks like in operation.

## Anti-pattern: "save for later"

The most common deferral is "I'll save this primitive at session-end during the cleanup pass." This sounds disciplined and is structurally unhelpful. By session-end, the dialogue context that informed the primitive has decayed; the primitive is back-filled from memory rather than written from observation. The result is a less precise rule with more drift.

A primitive worth capturing is worth capturing now. A primitive not worth capturing now is probably not worth capturing. There is no third category.

## Implication for the substrate

Capture-on-same-turn is the property that makes Layer 4 work as a *substrate*, not just a habit. A substrate has the property that its operation is automatic — it doesn't require remembering to do the right thing. The same-turn discipline is what makes the substrate automatic: capture happens in the natural rhythm of a session, not as a special end-of-session ritual.

For projects that intend to compound primitives over months or years, the discipline of immediate capture is the difference between an asset that grows continuously and a graveyard of half-finished captures. Layer 4 is the asset only when capture-on-same-turn is the default.
