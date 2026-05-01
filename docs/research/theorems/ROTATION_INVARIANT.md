# The Rotation Invariant

> *A parking lot without turnover is a junkyard. A library without rotation is a storage room. A blockchain state without rotation is a museum of abandoned contracts.*

This doc extracts an invariant underlying multiple VibeSwap mechanisms: **any mechanism that occupies a shared finite surface must enable rotation — the replacement of one occupant by another over time.** Without rotation, the surface ossifies. With rotation, the surface remains productive.

## The parking lot

Consider two parking lots:

**Parking Lot A**: 100 spots. No time limits. First-come-first-served. The first 100 cars to arrive get spots and keep them forever. Eventually: the cars that aren't moved become landmarks. The lot is always "full" but never used — the cars don't move. The lot has lost its purpose.

**Parking Lot B**: 100 spots. 2-hour time limit. Cars rotate throughout the day. Over a year, thousands of distinct cars use the lot. The lot serves its purpose — providing parking service for the neighborhood.

The surface (100 spots) is the same. The DIFFERENCE is the rotation policy.

The rotation invariant claims: mechanisms resembling Lot A eventually fail to serve their purpose. Mechanisms resembling Lot B remain productive.

## The invariant, stated precisely

**Rotation Invariant**: any finite shared surface S used by a mechanism M must satisfy at least one of:

- **Passive rotation**: occupancy has an intrinsic time-limit after which the claimant is released (parking meter style).
- **Price-driven rotation**: rent grows over time such that occupancy becomes economically unattractive.
- **Active eviction**: governance/process can evict occupants who aren't using the surface productively.

Surfaces lacking any of the three will ossify: early claimants capture all capacity, new claimants are locked out, the surface becomes rent-seeking property.

## Where rotation matters in VibeSwap

### CKB state-rent

Blockchain storage slots ARE the classic ossification hazard. Early contracts grab slots and hold them forever; new contracts pay gas to write but nothing happens to old slots.

CKB state-rent (see [`COGNITIVE_RENT_ECONOMICS.md`](../../concepts/monetary/COGNITIVE_RENT_ECONOMICS.md)) implements **price-driven rotation**: rent grows convexly with slot age (see [`ATTENTION_SURFACE_SCALING.md`](../../concepts/ATTENTION_SURFACE_SCALING.md)). Old claimants face accelerating costs. Eventually they release; the slot rotates.

Without state-rent, Ethereum-style chains gradually fill with abandoned contracts. The chain's effective capacity shrinks over time.

### Contribution-DAG handshake slots

Each user has a finite daily handshake bandwidth. This surface rotates via **passive rotation**: yesterday's handshakes have used their window; today is fresh capacity.

Without passive rotation, early adopters could flood handshakes to lock in endorsements and prevent later entrants from receiving any.

### NCI retention weight

A contributor's retention weight for each claim is a form of surface — the claim takes up a "slot" in the contributor's active-weight pool. Convex retention decay (Gap #1 C40) implements **price-driven rotation**: old claims have decreasing weight, eventually zero. The contributor's portfolio rotates as old claims age out and new ones take their place.

### Committee seats (governance)

If governance committees could be held indefinitely, early voters lock in forever. Mitigation: bounded terms + open elections. This is **active rotation** — governance process evicts occupants after N terms.

### Commit-Reveal Auction (8s + 2s window)

Each batch is a short-lived "surface" for orders. Automatic rotation: every 10 seconds, new batch. Passive rotation at maximum frequency.

## Why ossification happens without rotation

Markets + economic incentives favor incumbents. Without explicit rotation pressure:

1. **Rent extraction**: once a claimant holds the surface, they can extract rent from those who want access. This rent flow has no upper bound.
2. **Exclusionary equilibrium**: rational new entrants don't try to acquire the surface (it's unavailable), so they go elsewhere. The surface becomes one-party-only.
3. **Dead-weight loss**: even if the claimant doesn't actively use the surface, they won't release it (sunk-cost + optionality). The surface is held but unproductive.
4. **Political calcification**: early claimants become stakeholders in the status quo. They resist changes that might dilute their holding.

These dynamics are universal. They appear in:
- Land economics (slumlords, absentee landlords).
- Regulatory capture (incumbent industries).
- Academic tenure (post-tenure productivity decline in some cases).
- Blockchain storage (abandoned contracts).

VibeSwap's mechanisms explicitly ROTATE to avoid all four dynamics.

## The three rotation types, compared

### Passive rotation (time limit)

Mechanism: after time T, occupancy releases automatically.

Examples: parking meters, NCI retention (claim-level), CRA batch windows.

Pros: simple, predictable, no governance intervention needed.
Cons: some surfaces benefit from longer occupancy if productive (a tenant who pays and uses well shouldn't be evicted at a fixed time).

### Price-driven rotation (convex rent)

Mechanism: rent grows over time; occupant releases when rent exceeds value.

Examples: CKB state-rent, DAG handshake gradient (proposed), NCI weight (aggregate).

Pros: productive occupants can stay longer by paying; unproductive occupants naturally release.
Cons: requires functioning price discovery. Volatile token prices disrupt calibration.

### Active rotation (governance/process eviction)

Mechanism: governance votes or process rules force eviction.

Examples: committee term limits, protocol upgrades that deprecate modules.

Pros: can respond to qualitative signals (e.g., "this occupant isn't acting in good faith").
Cons: requires governance participation. Political risks (capture, procedural gridlock).

The three types are complementary. Most VibeSwap mechanisms use one. Some (e.g., CKB state-rent) could combine passive (absolute-max duration) + price-driven.

## When rotation is NOT appropriate

Not every surface should rotate.

### SoulboundIdentity

A user's soulbound identity token is a lifetime claim. It ROTATING makes no sense — rotating an identity means giving it to someone else, which destroys its purpose.

Identity is a non-rotating surface. It doesn't need to (nor should) implement the rotation invariant.

### Audit trails

Immutable records of past events. Rotation would mean overwriting history. Cryptographic commitments explicitly prevent this.

Audit trails are append-only surfaces. Rotation doesn't apply.

### Honoraria / achievements

Recognition of past work. A PhD degree shouldn't "rotate" to someone else after 10 years.

Honoraria are lifetime surfaces. They don't rotate.

## Classifying surfaces

To apply the rotation invariant, classify each surface:

| Surface | Finite? | Shared? | Productive-use-per-period? | Rotate? |
|---|---|---|---|---|
| Storage slot (CKB) | Yes | Yes | Yes | YES (price-driven) |
| Parking spot | Yes | Yes | Yes | YES (passive) |
| SoulboundIdentity | Yes (1 per user) | No | No (identity is state) | NO |
| Audit record | No (append-only) | No | No | NO |
| Committee seat | Yes | Yes | Yes | YES (active) |
| Commit-reveal window | Yes | Yes | Yes | YES (passive, 10s) |
| DAG handshake slot | Yes | Yes | Yes | YES (passive, 24h) |
| NCI retention claim | Yes | Yes | Yes (fading) | YES (price-driven via convex decay) |

Surfaces with YES in all first three columns MUST implement rotation. Surfaces with NO in any should justify why rotation isn't applicable.

## Anti-patterns

### Anti-pattern 1 — Nominal rotation that doesn't rotate

A mechanism claims "you can release this and someone else takes it," but the release cost is so high that nobody ever releases. Effectively ossified.

Example: a CKB state slot where release gas > accumulated rent. Rational holders would rather keep paying than release.

Fix: calibrate release cost < rent-outflow cost.

### Anti-pattern 2 — Rotation at wrong time-scale

Rotation happens but too slowly or too quickly for the surface's purpose.

Example: 10-minute CRA batch windows would be too slow (market freezes). 1-second batches would be too fast (no time for human intents).

Fix: calibrate rotation speed to match substrate. CRA at 10s is calibrated to human attention characteristic (see [`ATTENTION_SURFACE_SCALING.md`](../../concepts/ATTENTION_SURFACE_SCALING.md)).

### Anti-pattern 3 — Soft cap, hard reality

A "2-hour parking limit" with no enforcement is functionally unlimited. Same on-chain: a "voluntary" release with no incentive to comply is just a suggestion.

Fix: automate enforcement. Contract-level timers, automatic slashing, permissionless release.

### Anti-pattern 4 — Forgetting to rotate

New mechanism proposals sometimes describe occupation but not release. Review gate: "what is the rotation mechanism?" must be answered.

Fix: add rotation-invariant check to design-gate hooks.

## Student exercises

1. **Classify a new mechanism.** Suppose VibeSwap adds a "pinned order" feature where users can mark orders as high-priority. Should pinned orders rotate? Which rotation type applies? Design the mechanism.

2. **Identify ossification risk.** Look at VibeSwap's existing contracts. Find a surface that SHOULD rotate but currently doesn't. Propose a rotation mechanism.

3. **Ossification metrics.** How would you measure whether a surface is ossifying? Propose three metrics.

4. **Rotation vs lifetime tradeoffs.** A user holds governance tokens for years. Is governance voting power a rotating surface? If yes, how does it rotate? If no, what prevents ossification?

5. **Write the design-gate check.** Write pseudocode for an automated check that flags mechanism proposals without a rotation spec.

## Connection to governance

Rotation policy is a governance decision:

- **What's the time-limit for passive rotation?**
- **What's the rent-curve for price-driven rotation?**
- **What's the term-limit for active rotation?**

These parameters have defaults but are tunable via governance within math-enforced bounds (see [`AUGMENTED_GOVERNANCE.md`](../../architecture/AUGMENTED_GOVERNANCE.md)).

Changes to rotation policy require careful review: aggressive rotation discourages long-term investment; passive rotation enables ossification. Governance should understand the tradeoff before tuning.

## Integration with design-gate hooks

Proposed addition to `triad-check-injector.py`: a "rotation check" that fires on design-level proposals.

When the hook detects a proposal involving a finite shared surface, it prompts:

> "Rotation check: does this mechanism describe how occupants are replaced over time? If yes, which type (passive/price-driven/active)? If no, justify why rotation doesn't apply (non-rotating surface: identity, audit trail, honoraria)."

This forces the rotation question to be answered explicitly, not forgotten.

## Future work — concrete code cycles this primitive surfaces

### Queued for un-scheduled cycles

- **CKB state-rent audit** — verify the rent-curve calibration implements price-driven rotation per this invariant. See [`ATTENTION_SURFACE_SCALING.md`](../../concepts/ATTENTION_SURFACE_SCALING.md) Place 2.

- **DAG handshake gradient** — upgrade from step-function (passive rotation at T_floor) to convex gradient (price-driven rotation). See Attention-Surface doc for the shape.

- **Committee term-limit implementation** — if governance committees don't currently have term limits, add them. Active rotation for governance surfaces.

- **Abandoned-contract cleanup** — proposal for removing long-abandoned CKB storage. Aggressive price-driven rotation case.

### Design-gate integration

- **Rotation-check hook** — add to design-gate hook chain. Triggers on "mechanism" keyword + finite-surface indicators.

### Primitive extraction

Extract this to `memory/primitive_rotation-invariant.md` as a design-gate: every finite-shared-surface mechanism must answer the rotation question.

## Relationship to other primitives

- **Attention-Surface Scaling** (see [`ATTENTION_SURFACE_SCALING.md`](../../concepts/ATTENTION_SURFACE_SCALING.md)) — price-driven rotation is the primary rotation type for VibeSwap's attention-surface mechanisms.
- **Augmented Governance** (see [`AUGMENTED_GOVERNANCE.md`](../../architecture/AUGMENTED_GOVERNANCE.md)) — governance tunes rotation parameters within math-enforced bounds.
- **Correspondence Triad** (see [`CORRESPONDENCE_TRIAD.md`](../../concepts/CORRESPONDENCE_TRIAD.md)) — rotation is one way substrate-geometry-match manifests (cognitive surfaces rotate via forgetting; VibeSwap surfaces rotate via rent/time).
- **First-Available Trap** (see [`FIRST_AVAILABLE_TRAP.md`](../../concepts/FIRST_AVAILABLE_TRAP.md)) — a common first-available pattern is "permanent claim, no rotation." This invariant explicitly rules that pattern out for shared surfaces.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Extracts the rotation invariant explicitly.
2. Classifies existing surfaces.
3. Queues audit cycles for surfaces whose rotation may be mis-calibrated.
4. Proposes a rotation-check design-gate hook.

The hook itself is a code cycle (Python script extending `triad-check-injector.py`). Audit cycles feed back into future docs (e.g., "CKB state-rent audit findings"). The loop runs.

## One-line summary

*Rotation Invariant is the rule that finite shared surfaces must enable replacement of occupants over time, via passive rotation (time limit), price-driven rotation (convex rent), or active rotation (governance eviction). Without rotation, surfaces ossify: rent extraction, exclusionary equilibrium, dead-weight loss, political calcification. Not all surfaces should rotate (identity, audit trails, honoraria) — classify before applying.*
