# The Correspondence Triad

**Status**: Design-gate. Runs before committing any mechanism / parameter / new primitive / architecture / refactor-beyond-line-level.
**Parents**: [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) (Axis 0), [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md) (Axis 1).
**Enforcement**: `triad-check-injector.py` hook reinforces on keyword matches; gate fires on every design-level response regardless of keyword.

---

## The three checks

Before committing any design-level decision, answer all three:

### Check 1 — Does it match substrate geometry?

*Does this mechanism's shape (curves, windows, thresholds, scaling) match the substrate it operates on?*

Reject if: the mechanism is linear where the substrate is power-law, Gaussian where the substrate is fat-tailed, round-number-tuned where the substrate has natural golden-ratio breakpoints.

See [`SUBSTRATE_GEOMETRY_MATCH.md`](./SUBSTRATE_GEOMETRY_MATCH.md) for the principle and [`FIBONACCI_SCALING.md`](./FIBONACCI_SCALING.md) for a concrete example.

### Check 2 — Does it augment via math-enforced invariants, not replace?

*Does this mechanism add mathematical constraints that make fairness structural, leaving the underlying market/governance free to function — rather than replacing the underlying process with a top-down rule?*

Reject if: the mechanism takes discretion away from the participants and hands it to a committee (whether human or automated). Reject if: the mechanism's "fairness" depends on an operator's good behavior rather than a verifiable invariant.

Accept if: the mechanism adds a constraint (invariant, bond, commit-reveal, challenge window) that the market navigates around while behaving self-interestedly, and fairness emerges from the shape of the constraint.

See [`AUGMENTED_MECHANISM_DESIGN.md`](./AUGMENTED_MECHANISM_DESIGN.md).

### Check 3 — Does it preserve Physics > Constitution > Governance?

*Is the mechanism layered correctly in the hierarchy?*

- **Physics** (math-enforced invariants — Shapley, k-invariant, batch-determinism) must fire independent of governance. Ungovernable.
- **Constitution** (P-000 fairness, P-001 no-extraction) must beat every governance outcome.
- **Governance** (DAO votes) is free action within the Physics + Constitution bounds.

Reject if: the mechanism lets governance override Physics (fairness-invariants are a governance knob). Reject if: the mechanism encodes a constitutional axiom as a governance vote (now the axiom is mutable, defeating its purpose).

Accept if: Physics enforces itself, Constitution overrides Governance when they conflict, Governance has real freedom but only within the other two's bounds.

See [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md) for the layered model.

## Why all three, not some

Each check catches a distinct failure:

- **Check 1 failure**: mechanism bleeds at the tail (Gaussian assumption on fat-tailed substrate).
- **Check 2 failure**: mechanism captures value into operator-discretion (an intermediary replaces the market).
- **Check 3 failure**: governance capture (the most-voted-for outcome overrides the fairness invariant; the system drifts toward whoever-has-the-most-votes instead of whoever's-right).

A mechanism that passes 2 of 3 still has one open failure mode. All three must pass for a design to be load-bearing.

## When does the gate fire?

**Always**, on design-level decisions. The hook `triad-check-injector.py` reinforces on keyword matches (mechanism, parameter, primitive, architecture, refactor), but the gate is conceptual — if the response includes a design decision, the triad applies even if no keyword matched.

Not fired on: line-level refactors, variable renames, test additions that don't change mechanism, documentation updates that don't add new mechanism semantics.

Fired on: every new contract, every parameter value that's not obviously dictated by the mechanism's math, every new primitive, every architecture change, every refactor-beyond-line-level.

## Example application

Suppose the design choice is: "add a 5-minute cooldown to the handshake protocol in ContributionDAG."

- **Check 1**: 5 minutes is a round-number choice. Is the substrate (social handshake attention-span) naturally 5 minutes? Look at data — actual social handshake turnaround is on the order of hours-to-days in natural settings, and 1-day is already the VibeSwap default. 5 minutes would be geometrically-wrong. **Check 1 fails.**
- **Check 2**: Even if 5-minute matched the substrate, is it an invariant the market navigates, or a hard top-down constraint? It's a hard constraint. But constraints are fine in augmented-design as long as the market is still free *around* the constraint. The handshake is one discrete action; gating its timing doesn't capture discretion into an intermediary. **Check 2 passes.**
- **Check 3**: Is the cooldown Physics, Constitution, or Governance? It's Physics — enforced on-chain, no vote. Is Physics enforcing itself or depending on governance? It's ungovernable (hardcoded). **Check 3 passes.**

Result: design fails Check 1. Keep the 1-day cooldown, not the 5-minute.

## How to apply in practice

Before typing the design decision, ask:

1. What is the substrate?
2. What geometry does it have? (power-law? Gaussian? fractal?)
3. Does my mechanism's shape match?
4. Does my mechanism augment the market or replace it?
5. Am I layering Physics/Constitution/Governance correctly?

If any answer is "no" or "unclear", pause. Check primitives in memory. Cite the [Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md) paper for parameter lookups. Fix before proceeding.

## Relationship to ETM

The Triad is the operational gate for [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) alignment. ETM says "the chain should mirror the cognitive economy"; the Triad is the three-check filter that enforces it at every design step.

## One-line summary

*Three checks — substrate-geometry match, math-enforced augmentation not replacement, Physics > Constitution > Governance — must all pass before a design-level decision commits.*
