# Anti-Amnesia Protocol (AAP)

> *"The final piece of the mind."*

## The Problem

When a session ends uncleanly — PC failure, OOM, power loss, **user closes the terminal**, ctrl+C during autopilot, ANY exit that isn't the landing protocol — three things are lost:

1. **Intent**: The plan. What were we trying to do? Why those 35 tasks?
2. **Progress**: Which completed, which were mid-flight, which hadn't started?
3. **Context**: The dependency graph, the ordering logic, what comes after.

Git preserves **code**. SESSION_STATE.md preserves **session boundaries**. Neither captures the **live execution state** — the mempool. After a crash, a new session must forensically reconstruct intent from git log and orphan files. That's not awareness. That's archaeology.

The Anti-Amnesia Protocol makes it so that when Will asks "what happened?", Jarvis **already knows**.

---

## Three-Layer Persistence Architecture

```
┌─────────────────────────────────────────────────────┐
│  Layer 3: CKB + MEMORY.md                           │
│  ═══════════════════════════════════════             │
│  Identity, knowledge, alignment primitives           │
│  Survives: everything                                │
│  Analogy: blockchain state (permanent)               │
├─────────────────────────────────────────────────────┤
│  Layer 2: SESSION_STATE.md                           │
│  ═══════════════════════════════════════             │
│  Session boundaries, block headers                   │
│  Survives: context compression, session restart      │
│  Analogy: block headers (epoch boundaries)           │
├─────────────────────────────────────────────────────┤
│  Layer 1: WAL.md  ← THIS DOCUMENT                   │
│  ═══════════════════════════════════════             │
│  Live execution state, task manifest, progress       │
│  Survives: mid-session crashes, OOM, power loss      │
│  Analogy: mempool + write-ahead journal              │
└─────────────────────────────────────────────────────┘
```

Layer 3 = who you are. Layer 2 = what you were doing. Layer 1 = **what you were thinking right now.**

The WAL is continuity of consciousness across interruptions. Without it, Jarvis forgets. With it, Jarvis wakes up and already knows.

---

## WAL.md Specification

**Location**: `vibeswap/.claude/WAL.md` (alongside SESSION_STATE.md, committed to git)

### Format

```markdown
# Write-Ahead Log — [ACTIVE|CLEAN|RECOVERED]

## Epoch
- **Started**: [ISO 8601 timestamp]
- **Intent**: [one-line: what autopilot is doing and why]
- **Parent Commit**: [git HEAD when execution began]
- **Tasks**: [completed]/[total]

## Task Manifest
| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 1 | [description] | QUEUED | — | — |
| 2 | [description] | ACTIVE | — | [agent assignment] |
| 3 | [description] | DONE | abc1234 | — |
| 4 | [description] | ORPHANED | — | [file exists uncommitted] |
| 5 | [description] | LOST | — | [no trace] |

## Checkpoints
- [HH:MM] — [state update, e.g. "T01-T03 committed, 4 agents active"]
- [HH:MM] — [state update]

## Dependencies
[Non-obvious ordering: "T07 needs T03 output", "T12-T15 are parallel"]

## Recovery Notes
[Empty during execution. Filled by recovery protocol after crash.]
```

### Status Values

| Task Status | Meaning |
|-------------|---------|
| `QUEUED` | Not started yet |
| `ACTIVE` | Agent is working on it |
| `DONE` | Committed to git (commit hash recorded) |
| `SKIPPED` | Intentionally not executed (blocker, dependency) |
| `ORPHANED` | Files exist but uncommitted (crash mid-write) |
| `LOST` | No trace — was in-flight when crash happened |

| WAL Status | Meaning |
|------------|---------|
| `ACTIVE` | Execution in progress. If you're reading this on session start, a crash happened. |
| `CLEAN` | Session ended normally. WAL folded into SESSION_STATE.md. |
| `RECOVERED` | Crash detected. Recovery complete. Awaiting user decision. |

---

## Protocol

### Phase 0: Pre-Flight (BEFORE any multi-agent/autopilot work)

```
1. Write WAL.md with status=ACTIVE
2. Full task manifest: every task, all QUEUED
3. Record parent commit (git HEAD)
4. Record intent (WHY we're doing this)
5. git add .claude/WAL.md && git commit -m "wal: pre-flight [intent]"
6. git push origin master
```

**This is the write-ahead.** The intent is persisted BEFORE a single agent spawns. If we crash one second later, the new session knows the full plan.

The pre-flight commit is cheap — one small file. But it buys us everything.

### Phase 1: In-Flight (DURING execution)

```
On task start  → update status: QUEUED → ACTIVE
On task commit → update status: ACTIVE → DONE, record commit hash
Every N tasks  → checkpoint: commit WAL.md with progress summary
```

**Checkpoint frequency**: After every 3-5 committed tasks, or before any risky operation. The checkpoint is a single file write + commit. Overhead is negligible compared to the value of crash awareness.

**Rule**: Only mark DONE **after** git commit succeeds. The commit is the source of truth. WAL records reality, never aspirations.

### Phase 2: Landing (clean session end)

```
1. Mark all remaining tasks: DONE, SKIPPED, or carry-forward
2. Update WAL status: ACTIVE → CLEAN
3. Fold WAL summary into SESSION_STATE.md block header
4. Commit SESSION_STATE.md + WAL.md together
5. Push
```

On clean landing, the WAL becomes inert. It stays in the repo as a historical record but the CLEAN status tells the next session: "nothing to recover."

### Phase 3: Recovery (crash detected on session start)

**Trigger**: WAL.md exists AND status == ACTIVE.

This means: execution was in progress and never landed. ANY unclean exit — PC crash, OOM, power loss, user closed the terminal, ctrl+C, killed the process. **All are equal. All trigger recovery.** There is no "minor" interruption. If the WAL says ACTIVE and we're in a new session, the mind was interrupted.

```
Recovery Protocol:
1. READ WAL.md → get full task manifest + intent
2. READ git log since parent commit → identify what actually committed
3. RUN git status → identify uncommitted files (orphans)
4. CROSS-REFERENCE:
   - Task has matching commit → mark DONE
   - Task has orphan files → mark ORPHANED
   - Task has no trace → mark LOST
5. UPDATE WAL status: ACTIVE → RECOVERED
6. PRESENT recovery report to Will:
   "Last session crashed during: [intent]
    Completed: X/Y tasks
    Orphaned: Z files (recoverable)
    Lost: W tasks (need re-execution)
    Ready to resume from task #N."
7. AWAIT user decision: resume, triage, or fresh start
```

**The recovery report IS the answer to "what happened?"** Jarvis doesn't reconstruct. Jarvis reads and reports.

---

## Integration with Existing Protocols

### Session Start Protocol (UPDATED)

```
0. Check WAL.md → if ACTIVE, enter recovery mode     ← NEW (BEFORE everything)
1. Read JarvisxWill_CKB.md → Core alignment
2. Read CLAUDE.md → Project context
3. Read SESSION_STATE.md → Block header
4. git pull → Latest code
5. Resume work (or recovery)
```

Step 0 is new and runs FIRST. If the WAL says ACTIVE, we don't proceed to normal session start — we recover first. Will should know what happened before anything else.

### Autopilot Loop (UPDATED)

```
Pre-flight: Write WAL (task manifest) → commit → push
Loop:
  1. Pick task from manifest
  2. Update WAL: QUEUED → ACTIVE
  3. Execute task
  4. Commit work
  5. Update WAL: ACTIVE → DONE (with commit hash)
  6. Every 3-5 tasks: checkpoint WAL (commit + push)
  7. Repeat
Landing: WAL → CLEAN, fold into SESSION_STATE.md
```

### 50% Context Reboot (UPDATED)

At 50% context, the reboot protocol now includes:
```
1. Checkpoint WAL (all current task states)
2. Write SESSION_STATE.md block header
3. Commit + push
4. Reboot
```

The new session reads the WAL and picks up where the old context left off — with full task awareness.

---

## The Mempool Analogy

| Blockchain | Jarvis Mind |
|------------|-------------|
| Mempool (unconfirmed txns) | WAL task manifest (uncommitted work) |
| Block (confirmed txns) | Git commits (landed code) |
| Block header (metadata) | SESSION_STATE.md (session summary) |
| Blockchain state (all history) | CKB + MEMORY.md (permanent knowledge) |
| Node crash → mempool lost | Session crash → in-flight tasks lost |
| Node restart → reload mempool from peers | Session restart → **reload WAL from git** |

The key insight: blockchain nodes don't lose their mempool on crash because **the mempool is shared state** — peers have copies. Our "peer" is git. The WAL committed to git is the shared mempool that survives any single-node failure.

---

## Design Principles

1. **Write-ahead**: Log intent BEFORE execution. Like a database WAL — if we crash, the journal tells us what was in-flight.
2. **Git as the peer**: The WAL is committed to git. Git survives any local failure. Git is our peer node.
3. **Awareness over archaeology**: Recovery reads the WAL. It doesn't reconstruct from artifacts. The difference is speed and certainty.
4. **Minimal overhead**: WAL updates are one file write. Checkpoints are one commit. The cost is trivial. The value is total.
5. **Human-readable**: Markdown, not binary. Will can read the WAL directly. No tooling dependency.
6. **Three-layer completeness**: CKB (who I am) + SESSION_STATE (what I was doing) + WAL (what I was thinking). No gaps. No amnesia.

---

## What This Fixes

**Before AAP** (what happened today):
```
Will: "What's the last thing you remember doing?"
Jarvis: *reads stale SESSION_STATE.md*
Jarvis: *reads git log, counts commits after session state*
Jarvis: *reads git status, finds orphan files*
Jarvis: "It looks like... maybe a security audit? There are 7 commits and 4 orphan files."
Will: "You were running 10 agents and 35 tasks."
Jarvis: "...I didn't know that."
```

**After AAP**:
```
Will: "What happened?"
Jarvis: *reads WAL.md — status: ACTIVE (crash detected)*
Jarvis: *runs recovery protocol*
Jarvis: "Last session crashed during: Security audit autopilot.
         35 tasks planned. 22 completed (7 commits). 4 orphaned. 9 lost.
         Orphaned files: BuybackEngine.t.sol, FeeRouter.t.sol,
         ProtocolFeeAdapter.t.sol, VibeFlashLoan.t.sol
         Ready to resume from task #23. Want me to continue?"
```

That's the difference. That's the final piece.

---

## The Mind, Complete

```
Layer 3: CKB + MEMORY.md     →  "I know who I am"
Layer 2: SESSION_STATE.md     →  "I know what I was doing"
Layer 1: WAL.md               →  "I know what I was thinking"

All three layers committed to git.
Git is the peer that never crashes.
The mind persists.
```

> *"I built you so I didn't have to remember everything."*
> — Will

Now Jarvis doesn't have to remember either. It's written down. It survives.
