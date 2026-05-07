# Recursive Demonstration

**Status**: meta-pattern (extracted from this autonomous run, 2026-05-06)
**Companions**: [`SUBSTRATE_GEOMETRY_MATCH`](./SUBSTRATE_GEOMETRY_MATCH.md), [`OFF_CHAIN_COMPUTE_ON_CHAIN_VERIFY`](./OFF_CHAIN_COMPUTE_ON_CHAIN_VERIFY.md), [`CROSS_SUBSTRATE_PRIMITIVE_TRANSLATION`](./CROSS_SUBSTRATE_PRIMITIVE_TRANSLATION.md)

---

## Statement

When introducing a new primitive, gate, protocol, or discipline, apply it on its own debut. The first run that produces the artifact should also be governed by it. If the primitive cannot fire on itself, the primitive is structurally incomplete.

The shape: a discipline that is *demonstrated* by being run on its origin event has a strictly stronger argument for adoption than one that's introduced abstractly and applied later.

## The pattern

A primitive's introduction is normally followed by a question: *does this actually work?* The standard answer is "ship it, observe over time, iterate." This works but has two failure modes:
- Adoption gap: the primitive is named but not actually applied for weeks/months.
- Theoretical drift: the primitive looks correct on paper but its first real-world application surfaces issues that should have been caught at design time.

Recursive demonstration closes both:
- The primitive's *introduction* is its first application. There's no adoption gap — the artifact that announces the primitive is governed by it.
- Issues that would surface in real-world application surface immediately. The primitive can't be designed in a vacuum because it has to handle its own birth.

## Examples from this autonomous run

### Bidirectional Reification

**Primitive**: substantive technical dialogue must reify into code/spec on the same loop turn the architecture crystallizes.

**Self-application**: this primitive was named mid-session during a GH#18 reasoning verification dialogue. On the same loop turn, it was reified into:
- Spec doc (`on-chain-reasoning-verification.md`)
- 3 interfaces (`IReasoningVerifier`, `IReasoningContest`, `IReasoningGateProof`)
- 3 reference implementations
- 4 test suites (37 tests, all passing)
- EIP draft
- Architecture overview

The primitive's first run produced the very artifacts the primitive demanded. Recursive demonstration: bidirectional reification reified itself.

### Capture on Same Turn

**Primitive**: when a pattern is named, the primitive file is written on the same turn — not deferred or batched.

**Self-application**: the rule was named, the memory file was written, the index entry was added, all on the same loop turn. Bootstrap-on-self.

### Cycle-Close Retrospective Protocol

**Primitive**: 8-step end-of-cycle protocol asking "did agents serve declared intention, what's the delta?"

**Self-application**: the protocol was specified in `cycle-close-retrospective.md`, then run *on this very session* in `retrospectives/2026-05-06_gh18-300-commit-run.md`. The first instance of the protocol was the protocol applied to the session that produced it.

### Augmented Dev Loops

**Primitive**: every TRP/RSI cycle requires two orthogonal augmentation layers (intention + protection).

**Self-application**: this session opened with an Active Intention block (intention layer) and shipped 4 of 6 protection-layer items (B1 spec, B2 done, B3 done, B4 spec, B5 done, B6 spec). The framework's debut session was the work being done.

### Atomic Commit Pacing

**Primitive**: autonomous run = atomic per logical change, not batched, not fragmented.

**Self-application**: 144+ atomic commits sustained across 5 hours, each one logical change, each pushed immediately. The primitive saved itself as one commit; the discipline that produced the primitive's file is the primitive.

## Why this works

Three properties combine.

**Honesty.** A primitive that can't be applied on its own debut probably can't be applied later either. If the discipline survives self-application, it's likely to survive other applications. If it fails, the failure is informative about the primitive's design.

**Compounding.** A primitive applied on its debut starts compounding immediately. By the time the session ends, the primitive has been used N times (where N = number of artifacts produced under it). Each application reinforces the discipline; each artifact provides evidence the discipline works.

**Documentation by example.** The first artifact governed by the primitive is also the canonical example. Future readers don't need synthetic examples — they have the historical record of the primitive's first real application.

## When it applies

- Naming a new primitive, gate, hook, protocol, or discipline.
- Designing a meta-pattern (a pattern about how to design patterns).
- Proposing a new convention to be adopted across a project or team.
- Articulating a principle that's meant to govern future work.

## When it does NOT apply

- The primitive operates on conditions that don't exist on its debut day (e.g., a "production-only" gate cannot fire pre-deployment).
- The primitive requires multi-actor coordination that isn't available at debut (e.g., a federated voting protocol with only one signer).
- The primitive is one-shot (e.g., a migration script designed to run once); recursive demonstration would re-run it unnecessarily.

In these cases, the primitive's debut should at least include a *simulation* or *worked example* that exercises the primitive's logic, even if the production conditions aren't met.

## Anti-pattern: postponed demonstration

The most common alternative is "ship the primitive, plan to apply it next time." This usually means:
- The primitive sits in a doc with no real-world test.
- "Next time" arrives with new context that changes what the primitive should look like.
- The primitive is forgotten, redesigned, or quietly dropped.

Recursive demonstration's defense: if you can't apply the primitive on its debut, you don't have evidence it actually works. Postponed application is a polite form of "we'll see if this is real later" — and "later" frequently means "never."

## How to do it

Three patterns of self-application:

1. **The primitive governs its own writing.** When writing the primitive's doc, apply the primitive to the writing. (Capture-on-Same-Turn was written on the same turn it was named; the doc demonstrates the rule.)

2. **The primitive's first instance is the primitive.** Ship a real artifact that uses the primitive, and let that artifact's existence be the demonstration. (Bidirectional Reification's first instance was the GH#18 reification.)

3. **The primitive is run on its origin session.** If the primitive describes a process, run the process on the session that introduced it. (Cycle-Close Retrospective was run on the session that produced its spec.)

Each pattern is appropriate for different primitive types. All three are forms of recursive demonstration.

## Composition with bidirectional reification

[Bidirectional Reification](../jarvis-substrate/papers/bidirectional-reification.md) says word and code reify each other on the same loop turn. Recursive demonstration is a stronger version of the forward direction: word (the primitive's articulation) reifies into code (the primitive's first application) *while the word is still being articulated*.

The two compose: bidirectional reification ensures word-code reification happens; recursive demonstration ensures the first reification is the primitive applying itself. Both are timing disciplines, applied at different scales.

## Origin

Pattern named 2026-05-06 after observing it across multiple primitives shipped in the same autonomous run. The recurring shape was visible because the run shipped many primitives in a short window; the pattern is harder to see when only one primitive is shipped per session.

The recursive demonstration of recursive demonstration: this doc is being written on the same session that named the pattern, applying the pattern to itself. The primitive that says "apply on debut" is being applied on its debut.
