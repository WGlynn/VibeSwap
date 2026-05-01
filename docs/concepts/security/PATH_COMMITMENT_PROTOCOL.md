# Path Commitment Protocol

**Status**: Design protocol. No half-finished middle paths.
**Audience**: First-encounter OK. Walked case studies from actual VibeSwap decisions.

---

## A familiar scenario

Two engineers disagree on how to implement a feature.

**Alice** argues for Approach A: "fast, simple, but we'll have to refactor in 6 months."

**Bob** argues for Approach B: "slow, thorough, but future-proof."

Both argue well. The team doesn't want to upset anyone. The team tries to compromise: "let's do some of A and some of B — a blend."

Six months later: the blend has A's fragility (from taking some shortcuts) AND B's complexity (from taking some thoroughness). Neither engineer is satisfied. The code is worse than either pure approach would have been.

This is the failure mode Path Commitment prevents.

## The rule, stated

When two viable paths are on the table, commit to ONE. The middle path — "a little of both" — is forbidden by default.

## Why the middle is wrong

Two paths are often incompatible at their load-bearing layer. Each path has invariants that compose INTERNALLY. Mixing invariants doesn't compose — you get neither path's coherence.

### Example abstraction

Path A has invariants {A1, A2, A3} — they compose to produce Property P.
Path B has invariants {B1, B2, B3} — they compose to produce Property Q.

Mixing: {A1, B2, A3} or {A1, A2, B3} or other combinations.

These don't compose to produce P (requires all three A invariants). They don't compose to produce Q (requires all three B invariants). They compose to produce... something else. Usually weaker than either P or Q.

The middle-path usually ships as "has some of A's properties AND some of B's properties." In practice it ships as "has neither."

## Case Study 1 — Cycle 32 Content-Availability Sampling

**The design question**: how to verify operator cell-content is available?

Three options surfaced:
- **Option A**: modify `StateRentVault` to include chunk commitments.
- **Option B**: extend OperatorCellRegistry with availability proofs.
- **Option C**: create a new standalone `ContentMerkleRegistry` as sidecar.
- **Option D**: subset of C with specific scope.

### The middle path that seemed tempting

"Let's add chunk commitments to StateRentVault AND add proofs to OperatorCellRegistry AND have a standalone registry for new features."

Three modifications to three contracts. The rationale: cover all bases.

### Why the middle was rejected

- Modifying StateRentVault changes a security-critical contract (high audit risk).
- Extending OCR couples two concerns.
- The standalone registry by itself would work.

The middle path would ship with all three change-sets, producing the COMBINED risk of all three modifications without the clean separation of just-the-standalone.

### The committed path: Option D

Option D (sidecar ContentMerkleRegistry, minimal scope) shipped. ~200 LOC new contract. Clean. Doesn't touch StateRentVault. Doesn't couple OCR. See `contracts/identity/ContentMerkleRegistry.sol`.

### Result

Single clean contract. Audit scope bounded. OCR and StateRentVault unchanged (lower risk). Future extension possible (add more scope to CMR) without re-touching the other contracts.

Clean. One path committed.

## Case Study 2 — Cycle 31 V1 vs V2 Availability Challenges

**The design question**: how to implement availability-challenge for OperatorCellRegistry?

Two options:
- **V1**: admin-authorized slashing. Safe (low-risk). Slower rollout.
- **V2**: fully permissionless availability-challenge. Faster rollout but introduces new attack surfaces (sybil challenges, grief-challenge spam).

### The middle path

"V1.5 — let the admin slash AND let anyone challenge if the admin approves."

This is the middle path. Retains admin discretion (losing V2's permissionless-ness). Adds permissionless-challenge (losing V1's simplicity).

### Why rejected

V1.5 has:
- V1's slower response (admin must approve).
- V2's attack surfaces (grief challenges waste admin time).
- No clear audit scope.

### The committed path: V1 first, V2 scheduled

V1 shipped as clean implementation. V2 scheduled for after V1 audit completes.

Not "V1.5 now then V2 later" — NO, that's still the middle. "V1 now, V2 later" — two distinct paths committed at different times.

## Case Study 3 — NDA Incident Rebase vs. Redaction

**The situation** (2026-04-21): an NDA-protected commit was accidentally created. The commit was NOT yet pushed to remote. Needed to decide: how to clean up?

Two options:
- **Option A — Rebase drop**: remove the commit from the git history entirely.
- **Option B — Redaction commit**: keep the commit, add a later commit that "removes" the content (but history is still there).

### The middle path

"Rebase to obfuscate the commit AND add a redaction to 'really' remove."

Both actions. Wastes effort.

### Why rejected

- If you rebase-drop, the history doesn't contain the NDA content. No redaction needed.
- If you redact, the history still contains the NDA content (just marked as removed). The rebase-drop was the actual removal; redaction is theatrical.

Middle path wastes effort AND doesn't add safety.

### The committed path: rebase-drop

Surgical rebase dropped the commit. History is clean. No redaction needed. Done.

See the NDA-gate mechanism + `api-death-shield.py` pre-commit scanning for the broader defense layer.

## Case Study 4 — Monolith vs. Microservices

This is a familiar software architecture debate. Applied to VibeSwap:

- **Monolithic contract**: one big `VibeSwapCore` handling everything. Simple to deploy. Tight coupling.
- **Microservices**: many small contracts. Harder to coordinate. Better separation.

### The middle

"Somewhat-modular monolith — big core with some extracted services."

Sounds reasonable. Actually: retains monolith coupling AND adds service overhead.

### Why rejected

- Clean microservices: each service owns its state, clear interfaces. Bounded audit scope per service.
- Clean monolith: one audit, simpler deployment.
- Middle: you still have coupled state (because extraction was partial) AND you have multiple deploy artifacts. Worst of both.

### The committed path: service-oriented architecture

VibeSwap ships many small contracts with explicit interfaces. `VibeSwapCore` coordinates; actual work is in domain-specific contracts (OperatorCellRegistry, ContributionAttestor, etc.). Clean separation.

## When the middle IS correct

Rare but real: when the two paths operate on ORTHOGONAL axes — they don't contend for the same invariant — "both" can be the right answer.

### Example where both is correct

- Path A: add Admin Event Observability (events on every setter).
- Path B: add Contract Renunciation (remove admin keys after deployment).

These are ORTHOGONAL. Path A makes admin changes visible. Path B removes admin changes entirely (eventually). They serve different goals on different axes. Both together is fine — the events cover the period before renunciation; renunciation handles the long term.

This is NOT a middle path. Both paths exist; each is committed independently.

### Test: do the two paths contend for the same invariant slot?

If yes (same commit scheme, same threshold, same ordering rule): commit to one.
If no (different concerns, different axes): they may compose independently.

## How to apply — 4 steps

When you identify two paths:

1. **State them clearly**. Path A does X via mechanism M1. Path B does Y via mechanism M2.
2. **Identify where they contend**. Same invariant slot? Same parameter? Same ordering?
3. **If they contend, pick one**. Commit. Document the rationale.
4. **Queue the alternative if still valid**. If Path B's advantages become relevant later, it's a future cycle — not a middle-path ship now.

## The writeup format

A good design memo with path-commitment looks like:

> **Options considered**:
> - Path A: [description]. Pros: [...]. Cons: [...].
> - Path B: [description]. Pros: [...]. Cons: [...].
>
> **Decision**: Path A. Rationale: [substrate-geometry match / upstream-dependency alignment / risk-profile fit].
>
> **Not chosen**: Path B remains viable for a future cycle if [specific triggering condition].

Dense. Explicit. No waffling.

## Why this discipline matters

Design debt accumulates when middle paths ship. A mechanism that implements "some of A, some of B" has no clean decomposition point. Future engineers have to understand both paths to safely modify either.

Clean path-commitment means future refactors can replace the full mechanism if needed. The mechanism is decomposable by its design-author's intent.

## Relationship to Correspondence Triad

Per [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md): the Triad fires BEFORE design decisions. Path Commitment fires AFTER:

1. Triad evaluates candidate paths.
2. Multiple paths may pass the Triad.
3. Path Commitment forces a choice.

Both are part of the design discipline. Triad is the quality filter; Path Commitment is the choice-forcer.

## Relationship to First-Available Trap

[`memory/primitive_first-available-trap.md`](../memory/primitive_first-available-trap.md): default to off-the-shelf is often wrong. Reject the default.

Path Commitment is the opposite failure: having identified two good paths, watering both down into a weaker mix.

Both primitives are about decisive selection:
- First-Available Trap: reject the auto-pick.
- Path Commitment: having rejected the auto-pick, don't split-the-difference.

## For students

Exercise: find a decision where you took the middle path. Analyze:

1. What were the two paths?
2. Did they contend for the same invariant?
3. What did the middle give you that was worse than either path?
4. What would have been different if you'd path-committed?

Apply to any recent decision — technical, career, relationship. Observe how often middle-paths produce worse outcomes than clean commits.

## Relationship to other primitives

- **Fires after**: [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md) filters candidates.
- **Anti-pattern for**: First-Available Trap (opposite failure mode).
- **Related discipline**: [`DENSITY_FIRST.md`](./DENSITY_FIRST.md) — both favor commitment over hedging.

## One-line summary

*Two paths: commit to one. The middle is forbidden unless paths are genuinely orthogonal. Case studies: Cycle 32 (Option D over A+B+C blend), Cycle 31 (V1-then-V2 not V1.5), NDA incident (rebase-drop not rebase-plus-redaction), monolith vs microservices. Design debt accumulates in mixed middles; clean commits enable clean future refactors.*
