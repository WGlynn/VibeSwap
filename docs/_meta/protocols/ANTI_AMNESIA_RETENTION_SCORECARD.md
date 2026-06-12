# Anti-Amnesia Protocol — Retention Scorecard

> Audit of how well the [Anti-Amnesia Protocol](./ANTI_AMNESIA_PROTOCOL.md) concept is retained
> in the live JARVIS substrate. Verified against the running system (boot hooks, memory corpus,
> session-chain), 2026-06-12.

**Honest scorecard: this is one of the rare cases where the live system surpassed the spec.
Retention at the principle level is ~9/10.**

## Retained, near-verbatim

- The whole **three-layer model** (Layer 3 MEMORY = who I am / Layer 2 SESSION_STATE = what I was
  doing / Layer 1 WAL = what I was thinking) is intact and canonical in
  `primitive_anti-amnesia-protocol.md`, including the WHY (the 2026-03-26 35-task crash) and the
  recovery vocabulary (`ACTIVE/CLEAN/RECOVERED`, `ORPHANED/LOST` — those exact terms still appear
  across 25/11 memory files).
- **WAL-first boot (Step 0)** survived and is referenced in CLAUDE.md's BOOT chain.

## Where it got stronger (superseded the doc)

- The original was a **manual** protocol — Jarvis had to *remember* to write the WAL. It's now
  **hook-enforced**: this very session's boot auto-injected `[WAL.md status — latest epoch]` via a
  SessionStart hook. The discipline became a gate (Universal-Coverage→Hook). The protocol grew up.
- The **session hash-chain** (23,462 blocks, one per checkpoint) is a new layer the doc never
  imagined — a cryptographic, tamper-evident version of its "git is the peer that never crashes."
  The per-checkpoint granularity the task-manifest table was reaching for is now automatic.
- It's **actively maintained, not fossilized**: a 2026-06-11 reconciliation note merges the WAL
  crash-check with SESSION_STATE-as-directive priority. Live, still being refined.

## Honest drift (what did not retain)

- The strict **Task Manifest table** (per-task rows: `# | Task | Status | Commit`) drifted. The live
  WAL uses an epoch-prose format now, and the granular per-task tracking migrated to the
  session-chain + the Task/Todo tools. Function retained, format abandoned.
- The WAL is still **vibeswap-scoped** (`vibeswap/.claude/WAL.md`), never generalized to a
  JARVIS-wide WAL even though JARVIS is the general substrate now. Mild coupling-drift.
- `Mitosis k/cap/acc` fields are vestigial autopilot-era.

## Bottom line

Nothing was lost, the mempool idea got a better implementation. The one thing worth fixing is the
format drift — the doc still promises a task-manifest table the system no longer keeps.
