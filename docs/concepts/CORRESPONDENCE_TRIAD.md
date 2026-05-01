# The Correspondence Triad

**Status**: Design-gate. Runs before any significant design decision.
**Audience**: First-encounter OK. Includes a worked example.
**Parents**: [Economic Theory of Mind](etm/ECONOMIC_THEORY_OF_MIND.md) (Axis 0), [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md) (Axis 1).

---

## A short story

Imagine you're on a design team. Someone proposes a clever new mechanism for VibeSwap — say, a tiered reward system where users earn bonuses for early adoption.

The proposal is technically sound. The code is clean. Tests pass. The team is about to approve and ship it.

The Correspondence Triad is the gate that fires BEFORE this approval. It asks three questions:

1. Does the mechanism match the substrate's geometry?
2. Does it augment the market/governance with math-enforced invariants (not replace them)?
3. Does it preserve Physics > Constitution > Governance?

If all three yes → approve.
If any no → redesign before approving.

Most "clever" mechanisms fail one of these three. The Triad catches them before they ship.

## Why three checks specifically

Each check catches a distinct failure mode.

### Check 1 failure — Substrate mismatch

Mechanism is linear where substrate is power-law. Shows up at the tail: extreme users (either extreme-contributor or extreme-attacker) experience the mechanism differently than intended.

**Example**: A flat 10-cent fee per swap. Users making tiny swaps ($1) pay 10% in fees; users making huge swaps ($10,000) pay 0.001%. Mismatch to power-law distribution of trade sizes. Penalizes small users, barely taxes whales.

### Check 2 failure — Replacement instead of augmentation

Mechanism centralizes decision-making in an operator/committee/admin. The market stops functioning autonomously; an intermediary now makes decisions.

**Example**: "Our admin decides which tokens are tradeable." Centralizes the listing decision. The market can't discover desirable tokens autonomously; the admin's discretion is a bottleneck + attack surface.

### Check 3 failure — Governance override of Physics

Mechanism lets DAO votes override mathematical invariants (fairness, anti-extraction, attribution).

**Example**: "Governance can adjust the Shapley distribution percentage for specific users." Now governance can over-reward favorites. Math-enforced fairness becomes governance-tunable; the invariant is gone.

Each mode is subtle. A design team can easily ship a mechanism that "feels fine" while failing one of the checks. The Triad forces the explicit evaluation.

## A full worked example

Let's walk through the Triad on a specific proposed design.

**The proposal**: "Add a 5-minute cooldown to the handshake protocol in ContributionDAG. Users can only form a new handshake once every 5 minutes, preventing Sybil-attack patterns where attackers rapidly form many fake handshakes."

Let's Triad-check this.

### Check 1 — Does the mechanism match substrate geometry?

The substrate here is **social handshake timing** — how frequently do humans actually form meaningful social trust relationships?

Empirical answer: hours-to-days. A meaningful handshake (two people vouching for each other) is a deliberate action taking significant attention and consideration. In natural settings, such acts happen at most a few times per day per person.

5 minutes is way too short. A human can easily form 12+ handshakes per hour at this cooldown. The cooldown doesn't slow down real attackers (who can script actions) and barely inconveniences real users (who rarely hit it).

The VibeSwap default is `1 day` — based on this substrate observation. 5 minutes is a massive mismatch.

**Check 1: FAILS** (substrate says 1-day range; mechanism proposes 5-minute).

### Check 2 — Does it augment via math-enforced invariants, not replace?

The proposed mechanism doesn't centralize decision-making. It's a timing constraint, not an intermediary gate. The market (participants deciding who to vouch for) still functions; the constraint just times it.

Formal check: is the constraint an invariant (always-holds mathematical property) or a rule (discretionary action)? A cooldown is an invariant — "at least 5 minutes between handshakes" can be verified mathematically.

**Check 2: PASSES**.

### Check 3 — Does it preserve Physics > Constitution > Governance?

The proposed cooldown is Physics — enforced on-chain via timestamp checks. It doesn't depend on governance decisions, doesn't depend on constitutional axioms, doesn't violate the hierarchy.

Specifically:
- Physics: timing constraint, enforced in `Handshake.requestHandshake()` via `require(block.timestamp - lastHandshakeTime[msg.sender] >= COOLDOWN)`.
- Constitution: doesn't alter any constitutional axiom.
- Governance: could adjust the cooldown value via governance, but governance CAN'T eliminate the cooldown entirely (that would require removing the code).

**Check 3: PASSES**.

### Summary

The proposal failed Check 1. Design action: redesign. Change the cooldown from 5 minutes to 1 day (or something empirically grounded). Resubmit with the corrected duration.

Had the proposal passed all three checks, approval would flow. Had it failed multiple checks, more substantial redesign.

## What the Triad does NOT do

The Triad doesn't check code correctness. That's what tests and audits do. The Triad checks conceptual correctness — whether the mechanism is mathematically aligned with ETM.

The Triad doesn't check market competitiveness. That's what market analysis does. The Triad checks whether the mechanism is well-founded, not whether users will love it.

The Triad doesn't check gas efficiency. That's what profiling does. Etc.

The Triad is a specific filter at the specific abstraction level of design intent.

## How to apply in practice

Before typing or coding a design decision, walk through the 3 checks. If any feels unclear, stop and investigate:

- For Check 1: What's the substrate? What's its empirically-observed geometry?
- For Check 2: Does this constrain the market or centralize decisions? If centralizes, reconsider.
- For Check 3: Is this Physics, Constitution, or Governance? If your answer is "all three", dig deeper — each one needs clarity.

If checks are unclear: the design might be premature. The Triad surfaces conceptual gaps that the design needs to address.

If all three clearly pass: proceed to implementation.

## When the Triad fires

The Triad fires on:
- New contracts.
- New parameters (especially numeric values).
- New primitives.
- Architecture changes.
- Major refactors.

It does NOT fire on:
- Line-level refactors.
- Variable renames.
- Test additions.
- Bug fixes that don't change mechanism intent.

The division is: if the design intent is affected, the Triad fires. If only the implementation is affected, the Triad doesn't.

## Relationship to the rest of the stack

The Triad is the gate that ensures ETM-alignment throughout the design stack. Without it, individual designers might ship mechanisms that pass their own tests but drift from the cognitive-economic theory the protocol depends on.

Pipeline:
1. Design proposal drafted.
2. Triad gate applied. Fail any check → redesign.
3. Test suite developed.
4. Security audit (for high-stakes mechanisms).
5. Ship.

Each step has a role; the Triad is the conceptual-correctness step.

## Why these three specifically

Could we have four checks? Five?

Possibly. But adding checks without clear distinct failure modes dilutes the gate. The three checks are the minimal set that catches each of:
- Mismatch to substrate (what the mechanism operates on).
- Replacement of market/governance with intermediaries (what the mechanism does to existing systems).
- Violation of Physics > Constitution > Governance (how the mechanism interacts with the layered authority).

Each check is distinct. A mechanism passing all three has demonstrated it's well-founded at the design-intent level.

Extensions (hypothetical additions, unstrict):

- **Check 4 (proposed by 2026-04-22 Dignity Gradient essay)**: Does the mechanism preserve participants' dignity? See [`THE_DIGNITY_GRADIENT.md`](../research/essays/THE_DIGNITY_GRADIENT.md). Not yet in the official Triad; might be added if adoption proves valuable.

## For students

Exercise: propose a design for a VibeSwap mechanism you're curious about (or critique an existing one). Walk through the Triad on your design. Document which checks pass and fail. For failures, propose redesigns.

This exercise applied to a real proposal teaches the Triad's use.

## The honest limit

The Triad is a pre-ship filter, not a sufficiency proof. A design passing the Triad is not guaranteed to work well in production. It's guaranteed to be conceptually well-founded.

Production validation still requires testing, deployment, monitoring, and iteration. The Triad is necessary, not sufficient.

## One-line summary

*Three checks before any significant design decision: (1) substrate-geometry match, (2) math-enforced augmentation instead of replacement, (3) Physics > Constitution > Governance preserved. Worked example (5-minute handshake cooldown proposal) shows Check 1 failing and redesign flowing. Conceptual-correctness filter, not sufficiency proof.*
