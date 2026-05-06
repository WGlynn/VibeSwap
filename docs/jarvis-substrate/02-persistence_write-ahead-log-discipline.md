# Write-Ahead Log Discipline

> The WAL is not a log. It is the atomic-commit boundary of cognitive state.

## The pattern

A traditional write-ahead log is a database primitive: durable record of intended changes, written before the changes execute, used for crash recovery. Layer 2's `WAL.md` borrows the name and the property — but operates on cognitive state rather than database state.

Each session opens an *epoch* in the WAL. Each cycle within the session writes substantive shipped artifacts as an epoch entry. Each session-end either closes the epoch (`CLEAN`) or marks it as `ACTIVE` (next-session-continuation required).

```
# Write-Ahead Log — ACTIVE (session 2026-05-06 GH#18 reification + 300-commit run)

## Epoch — ACTIVE at 2026-05-06 GH#18 bidirectional-reification bootstrap + 300-commit autonomous run
- **Opened**: 2026-05-06 ~15:09Z on Will's "respond: GH#18" + pivot to bidirectional-reification primitive + "300 commits" autonomous run.
- **Branch**: VibeSwap `master` (push to `origin`). Range `7720cb32..HEAD` and counting.
- **Status**: ACTIVE. Run in progress; targeting 300 atomic commits...
```

The shape: each cycle's actual shipped artifacts (interfaces, specs, contracts, tests, papers, docs, primitives) get enumerated. Failures and discoveries get separate sub-sections. Cross-reference to lessons.md for retrospective rows. The WAL is the audit trail.

## The two-directional discipline

### Read on boot (forward)

The first thing on session-start is reading the WAL. If the latest epoch is `ACTIVE`, the session opens by acknowledging unfinished work. If `CLEAN`, the session can decide what to start fresh.

The WAL prevents the most common amnesia failure: opening a session with no idea what the last session was doing. Even if the model has forgotten, the WAL has not. The first read recovers context.

### Write before close (backward)

Before any session-end (compaction, pre-reboot, explicit /end), the WAL must reflect what shipped. This is the [session-state-commit-gate](./README.md) at work: no push without WAL update; no end without WAL update.

The discipline is *write-before-close*, not *write-during-cycle*. Mid-cycle WAL updates fragment attention. End-of-cycle WAL updates concentrate the artifact summary into a single coherent block, with full session context still in working memory.

## What goes in the WAL

| Section | Content |
|---------|---------|
| Epoch header | session date, opening trigger (Will's prompt), branch, status |
| What shipped | enumerated artifacts grouped by theme (TRP cycles, docs, tests, papers) |
| Failure modes | what broke, what was caught, what got persisted as primitive |
| Public discourse | external posts, replies, partner-facing artifacts |
| Latest tally | running commit count (when in autonomous run) |
| Cross-references | lessons.md rows, primitive files written, hooks installed |

What does NOT go in the WAL:
- Per-message dialogue (that's session transcript, not state)
- Speculation about future work (that's SESSION_STATE Pending, not history)
- Detailed design rationale (that's in the design docs, linked from WAL)

The WAL records *what shipped*. Other files record *why* and *what's next*.

## Why epochs, not commits

The WAL doesn't enumerate every git commit. That would be redundant — git already does that. It enumerates *epochs*, which group commits into shipped logical units:

- A TRP cycle (e.g., `C39 — attested-resume default-on for security-load-bearing breakers`) is one epoch entry.
- A docs reorg pass (e.g., `Docs reorg DOCUMENTATION/ → docs/ in 5 commits`) is one entry.
- A TRP burst across many cycles (e.g., the 2026-05-01 79-commit session) is one epoch with sub-entries.

The granularity matches *cognitive units*, not commit boundaries. Future-readers care about the epoch, not which commit added the missing semicolon.

## Composition with SESSION_STATE

| File | Tense | Reads-or-writes |
|------|-------|-----------------|
| WAL.md | past | what shipped (history) |
| SESSION_STATE.md | present + future | what's pending, what's next, active intention |

Both are session-boundary files; both get read on boot; both get updated at session-end. The split is informational: history vs intent. A reader looking for "did we ship X?" reads WAL; a reader looking for "what should I work on next?" reads SESSION_STATE.

## ACTIVE vs CLEAN

The status flag is load-bearing:
- `CLEAN` — last epoch closed cleanly, no continuation required, fresh-start safe.
- `ACTIVE` — work in progress, next-session must reference unfinished items.

A SessionStart hook checks the status. If `ACTIVE`, the boot directive points at the unfinished epoch. If `CLEAN`, the boot directive points at SESSION_STATE for next-priority. Either way, the session opens with directional context.

The protocol: `ACTIVE` when work is in progress, `CLEAN` only when the work is fully shipped. Mid-session crashes leave `ACTIVE` deliberately — the next session sees there was unfinished work and recovers context.

## Anti-pattern: WAL drift

The most common failure is the WAL falling behind reality. Commits pile up; the latest epoch's "what shipped" list lags. Two consequences:

- The `[F·session-state-commit-gate]` discipline says push requires WAL update. Drift means accumulated push debt.
- Boot reads return outdated state. Future sessions start from a stale snapshot of what was shipped.

The fix is mid-run WAL refreshes at natural checkpoint boundaries — not every commit, but every cluster of related work. The 300-commit autonomous run on 2026-05-06 added a refresh at ~50 commits with a `Latest tally:` line. That kind of touchpoint is appropriate; per-commit refreshes are noise.

## Why a markdown file, not a database

The WAL is a markdown file checked into git. Same reasoning as Layer 4 primitive files:

- Greppable from a terminal — `grep "C39" WAL.md` returns hits instantly.
- Diffable — every WAL update is visible in commit history.
- Self-documenting — the WAL itself documents what it is, its conventions, and its consumers.
- Survives any tool change — markdown locks to nothing.

A SaaS project-management tool would offer "richer features" and lock the state behind a vendor. The WAL's value is precisely that it's the simplest possible substrate that captures the property.

## Origin

The discipline was articulated 2026-04-XX during the multi-session VibeSwap build burst when amnesia between sessions was the dominant cost. WAL.md formalized the cognitive-state-WAL pattern; subsequent sessions have refined the conventions (epoch granularity, ACTIVE/CLEAN flags, what-shipped sections) but the core property has held.
