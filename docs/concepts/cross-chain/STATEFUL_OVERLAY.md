# Stateful Overlay

**Status**: Architectural pattern.
**Audience**: First-encounter OK. Before/after scenarios throughout.
**Primitive**: [`memory/primitive_stateful-overlay.md`](../memory/primitive_stateful-overlay.md)

---

## Start with a concrete problem

You're working with an LLM assistant on a long coding task. 90 minutes in, a network blip kills the session. When you reconnect, the assistant has no memory of what you were doing. You have to re-explain everything.

This is painful. The LLM substrate has a gap: no persistent memory across session boundaries.

One fix: demand the LLM have persistent memory. But you can't; that's a substrate limitation.

Another fix — the Stateful Overlay approach: build something OUTSIDE the LLM that saves session state before each risky operation and restores it on next session.

Before this fix (without overlay):
- Session dies.
- Next session starts from scratch.
- You re-explain everything.
- Minutes of repeat work per session-death.

After this fix (with overlay):
- Session dies.
- Next session starts fresh.
- Hook reads the previous session's checkpoint from disk.
- LLM continues from where it left off.
- Session-death becomes a soft-failure.

The overlay didn't change the LLM. It wrapped the LLM in a pattern that compensates for the LLM's gap. That's the essence of Stateful Overlay.

## The pattern, stated

Every substrate has gaps. Each gap admits an externalized idempotent overlay that closes the gap without modifying the substrate.

Four required properties for something to qualify as an overlay:

1. **Externalized**: the overlay's state lives outside the substrate it's patching. Not a modification to the substrate itself.
2. **Idempotent**: applying the overlay twice produces the same result as applying it once. Safe under partial failures, retries, concurrent applications.
3. **Read-through and write-through**: the overlay intercepts at a boundary between substrate and user/environment without being a separate entity to remember.
4. **Failure-independent**: if the overlay breaks, the substrate still runs (possibly with degraded guarantees). If the substrate breaks, the overlay can be re-applied on a fresh substrate instance.

## Concrete VibeSwap overlays — before and after

### Overlay 1 — API Death Shield

**The gap**: LLM sessions die. Context is lost.

**Before the overlay**:
- Session dies mid-work.
- Next session has no memory of prior session's work.
- User must re-explain.
- Partially-completed edits may be lost.

**After the overlay** (`~/.claude/hooks/api-death-shield.py` on PreToolUse):
- Before each tool call, overlay writes session-state to `~/.claude/SHIELD_CHECKPOINT.json`:
  - Working tree SHA.
  - Last tool used.
  - In-flight task descriptions.
  - Pending edits.
- When next session starts, overlay reads the checkpoint.
- Session resumes from captured state.
- Session-death becomes a soft-failure, not a terminal event.

**Why it's idempotent**: writing the same state twice = writing once. Atomic file writes. No race conditions.

**Why it's externalized**: the checkpoint is a file on disk, not in the LLM's memory.

**Why it's read-through/write-through**: the LLM doesn't know about the hook. It just works.

**Failure mode if overlay breaks**: LLM continues running normally. Just doesn't get checkpoint-restore on next session (i.e., degraded guarantee).

### Overlay 2 — Admin Event Observability

**The gap**: Smart-contract admin parameter changes happen silently. Observers don't know when they change.

**Before the overlay** (pre-C36-F2):
- Admin calls `setFee(newValue)`.
- Fee is updated.
- No event emitted.
- Off-chain dashboards have no way to know unless they poll.
- Attackers could time fee changes immediately before user transactions; users unaware.

**After the overlay** (~50 setters updated):
- Admin calls `setFee(newValue)`.
- Fee is updated AND event `FeeUpdated(prev, current)` is emitted.
- Off-chain dashboards index the event stream.
- Any change is immediately legible.
- Attackers lose the cover of silent parameter-shifts.

**Why it's idempotent**: emitting the same event twice = still one state change recorded per call.

**Why it's externalized**: the event stream is observer-consumable, not internal to the setter logic.

See [`ADMIN_EVENT_OBSERVABILITY.md`](./ADMIN_EVENT_OBSERVABILITY.md).

### Overlay 3 — Chat-to-DAG Traceability

**The gap**: Contributions outside git (dialogue, framing, design) are invisible to the on-chain DAG.

**Before the overlay**:
- Alice suggests an idea in Telegram.
- The idea becomes a design.
- The design becomes a code change (Bob writes it).
- Bob gets DAG credit for the code.
- Alice — whose idea made it possible — gets nothing.

**After the overlay**:
- Alice's Telegram message is captured as a `[Dialogue]` issue (with Source field).
- Bob's commit references the issue via `Closes #N — ...`.
- `scripts/mint-attestation.sh` creates on-chain attestations linking Alice's contribution to Bob's solution.
- Alice earns DAG credit proportional to her marginal contribution.
- The full lineage (Alice → issue → Bob's commit → Alice's attestation) is reconstructible from any entry point.

**Why it's externalized**: the Source field + issue templates + CI workflow are separate from git and from the ContributionAttestor contract.

**Why it's idempotent**: re-running the mint script produces no duplicate attestations (the contract rejects duplicates).

**Failure mode if overlay breaks**: Bob's code still ships. Alice's contribution just stays invisible (pre-overlay state).

See [`CONTRIBUTION_TRACEABILITY.md`](./CONTRIBUTION_TRACEABILITY.md).

### Overlay 4 — SHIELD-PERSIST-LEAK Defense

**The gap**: LLM workflow can accidentally stage and commit NDA-protected content if the content is in the working tree.

**Before the overlay**:
- NDA-protected material enters the working tree (e.g., via a research session).
- LLM runs `git add .`.
- LLM runs `git commit`.
- Material is in the local git history.
- If push happens, material is on a public remote.
- NDA violation.

**After the overlay** (pre-commit hook + pre-push hook):
- Hook scans staged diff for NDA-protected keywords.
- Match found → abort commit + log to TRUST_VIOLATIONS.md.
- Material never enters the commit.

**Why it's idempotent**: re-scanning the same diff = same decision.

**Why it's externalized**: the hook + keyword list are outside git's core mechanism.

**Failure mode if overlay breaks**: commits proceed normally (including potentially-leaky ones). Degraded guarantee, not protocol failure.

### Overlay 5 — SESSION_STATE + WAL Discipline

**The gap**: Claude's internal context window has limits. Long-running work can exceed it.

**Before the overlay**:
- Session approaches context limit.
- Compression happens.
- Critical context gets compressed or lost.
- Next iteration has incomplete state.

**After the overlay**:
- At 50% context, write SESSION_STATE.md block with current work.
- Writes include: what's done, what's pending, what decisions were made.
- Session reboots with full session-state as input.
- No information lost across compression boundaries.

**Why it's idempotent**: writing the same state block twice = one final state block.

**Why it's externalized**: SESSION_STATE.md is a file on disk, not inside Claude's memory.

**Failure mode if overlay breaks**: session reboots may lose some context. Not catastrophic; recoverable via re-exploration.

## The common pattern

Notice the pattern across all five overlays:

1. **Identify the substrate gap** precisely. "LLM dies on network errors" / "Admin setters don't emit events" / etc.
2. **Find the substrate boundary** where the gap appears. Tool invocation / function call / command execution.
3. **Design minimal externalized state** that closes the gap. Checkpoint file / event emission / attestation record.
4. **Make it idempotent** at that boundary. Safe under retries, failures, re-runs.
5. **Fail gracefully** if the overlay breaks.

That's the recipe. Apply it to any gap in any substrate.

## Why "externalized" matters

Could we not just modify the substrate to fix the gap?

In most cases, no:
- The substrate is a product we don't control (LLM, chain, GitHub).
- The substrate has usage patterns we shouldn't fight (simpler to wrap than to rewrite).
- Modifying the substrate requires its maintainers' cooperation; externalized overlays don't.

Modification approach: "fix the LLM to have persistent memory" — not feasible.
Overlay approach: "write a file before each tool call" — feasible in an afternoon.

## Why "idempotent" matters

Overlays run in the presence of failure. Network drops, tool retries, partial writes — all can cause the overlay to fire twice when it meant to fire once.

If the overlay isn't idempotent:
- Retries create duplicates.
- Partial failures create inconsistent state.
- Debug sessions become nightmares.

Idempotency is the foundational property that makes overlays practically deployable.

## What ISN'T a stateful overlay

Not every wrapper qualifies. Anti-examples:

### Anti-example 1 — Middleware that changes substrate behavior

A middleware that rewrites LLM prompts to add context is NOT an overlay. It modifies what the substrate sees, rather than externalizing state at its boundary.

### Anti-example 2 — Alternative substrate

Building a different LLM with persistent memory is NOT an overlay. It's replacing the substrate entirely.

### Anti-example 3 — State held in volatile memory

Session state held only in RAM is NOT externalized enough. A crash loses it. An overlay's state must survive substrate failures.

### Anti-example 4 — State inside the substrate

LLM context window IS inside the substrate. Any "overlay" that uses the context window as storage isn't externalized.

## The meta-observation

Finding overlays is a specific cognitive skill. Given any substrate with a gap, you can usually find an overlay pattern that closes the gap if you're willing to look.

Look at the gap. Name the substrate boundary where it surfaces. Design the minimum externalized state that closes it. Make it idempotent. Ship.

This is a generalizable skill. Once trained, engineers find overlays quickly. The skill is worth learning.

## Relationship to other primitives

- **Parent**: [Universal-Coverage → Hook](../memory/primitive_universal-coverage-hook.md) — hooks are a specific overlay pattern at tool-call boundaries.
- **Cousin**: [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) — cognition's self-externalization onto blockchain is itself a grand overlay pattern.
- **Instance**: [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) — concrete overlay for chat → DAG.

## For students

Exercise: pick a substrate you use (cloud service, SDK, command-line tool, editor plugin). Find a gap it has. Propose an overlay:

1. Name the gap precisely.
2. Find the substrate boundary.
3. Design the externalized state.
4. Make it idempotent.
5. Describe failure modes.

This exercise teaches the meta-skill.

## One-line summary

*Every substrate has gaps; externalized idempotent overlays close them without modifying the substrate. Four properties (externalized, idempotent, read-through, failure-independent). VibeSwap runs five live overlays (API Death Shield, Admin Event Observability, Chat-to-DAG Traceability, SHIELD-PERSIST-LEAK, SESSION_STATE) each solving a specific gap. Pattern is generalizable; finding overlays is a learnable cognitive skill.*
