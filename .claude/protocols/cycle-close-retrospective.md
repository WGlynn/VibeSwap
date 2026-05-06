# Cycle-Close Retrospective Protocol

**Status**: spec (closes B6 of `[P·augmented-dev-loops]` backlog)
**Origin**: 2026-05-06 SESSION_STATE bootstrap loop, item B6
**Companions**: `lessons.md`, `agent-reputation.json`, `[P·augmented-dev-loops]`

---

## Purpose

End-of-loop step that asks two questions:

1. **Did the agents (or this run) serve the declared intention?** — direction check
2. **What's the delta between what we set out to do and what we did?** — drift measurement

Output: one row in `lessons.md`, with the appropriate tag, plus updates to `agent-reputation.json` if any cycle-class produced a clean-ship / reverted-ship / blocked-by-gate signal.

The retrospective is **mandatory**. A cycle without retrospective is structurally incomplete; the next session opens with the same blind spots as the last one.

## When it fires

- End of an autonomous run (e.g., the 300-commit run wraps, target reached or session-end declared)
- End of a TRP/RSI cycle (per loop convention)
- End of a session, before final SESSION_STATE write
- Triggered explicitly by Will: "retrospective", "what's the delta", "did we serve the intention"

The protocol does NOT fire on every individual atomic commit — that's noise. It fires on cycle/run/session boundaries.

## Inputs

The retrospective reads:

- `SESSION_STATE.md` Active Intention block — what was declared
- `git log --oneline <range>` — what shipped
- `lessons.md` (last N rows) — what was already known
- `agent-reputation.json` — what scope-size each agent class was running
- Any `[INTENT-FAIL]` / `[STRUCT-FAIL]` events surfaced during the run

## Procedure

1. **Restate the declared intention verbatim.** Copy the Active Intention block. The retrospective measures against this exact wording, not a paraphrase.
2. **List what shipped.** From the git log, group commits by theme. A theme is "all commits serving sub-goal X."
3. **Map shipped → declared.** For each shipped theme, mark:
   - `served-intention` — directly advances declared intention
   - `tangent-but-aligned` — different sub-goal, same direction
   - `drift` — different direction, opportunistic value
   - `noise` — fixes / cleanups not in scope
4. **Compute delta.** What was declared but not done? What was done but not declared? The intersection is your "matched" set; the symmetric difference is the delta.
5. **Identify root causes.** For each `[INTENT-FAIL]` row generated this session, ask:
   - Was this a structural gap (no gate / no hook / no primitive existed)? → propose gate/hook/primitive
   - Was this a discipline gap (the rule existed but wasn't applied)? → propose hook to enforce, OR record as repeat-offense
6. **Append lessons.** Write one row per significant finding to `lessons.md`. Don't rebuild rows that are already there.
7. **Update reputation.** For each agent class that ran this cycle, append an outcome record to `agent-reputation.json` history. Recompute tallies.
8. **Recommend next-cycle scope.** Based on reputation tallies + lessons, suggest scope-size for the next cycle's agents.

## Output template

```markdown
## Retrospective — <session label>

**Declared intention**: <verbatim from SESSION_STATE Active Intention>

**What shipped**:
- <theme 1>: <served-intention | tangent-but-aligned | drift | noise>
- <theme 2>: ...

**Delta**:
- Declared but undone: <list>
- Done but undeclared: <list>

**Failure modes surfaced**:
- <[INTENT-FAIL] / [STRUCT-FAIL] entries>
- root cause: <structural gap | discipline gap>
- proposed: <gate / hook / primitive / nothing>

**Reputation updates**:
- (model, scope, cycle_type) → +1 clean / reverted / blocked

**Next-cycle recommendation**:
- scope-size: <small | medium | large>
- focus: <list>
```

## Why "did we serve the intention" is load-bearing

Without retrospective:
- Drift compounds session over session — each cycle's tangent becomes the next cycle's normal.
- Lessons aren't generalized — the same failure recurs because no one notices.
- Reputation isn't tracked — agent scope-sizing stays static regardless of evidence.

The retrospective is the protective layer of `[P·augmented-dev-loops]` (paired with the intention declaration as the directional layer). Both must fire for the loop to be augmented; without retrospective, intention is just a slogan.

## Composition with `[F·diagnose-on-stop]`

`[F·diagnose-on-stop]` fires per-stop-event (mid-run): "why did you stop?" The retrospective fires per-cycle (end-of-run): "did the run serve its intention?" Different granularities, same family.

A robust autonomous loop has both: stop-events get diagnosed in real time, cycle-completion gets retrospected at the boundary. Either alone leaves a class of failures unobserved.

## Bootstrap on this session

This session's retrospective:

- **Declared intention**: "Bidirectional reification at scale — reify GH discussion #18 into spec + interfaces + reference impls + tests + EIP draft + architecture overview, then sustain a 300-commit autonomous run."
- **What shipped**: spec doc, EIP draft, 3 interfaces, 3 reference impls, 3 test suites, architecture overview, 3 concept docs, agent-reputation.json, 3 lessons.md rows, this protocol — all served intention.
- **Delta**: declared 300 commits, shipped ~28 at retrospective time. Open run, not yet closed.
- **Failure modes surfaced**: idle-after-reply (`[F·diagnose-on-stop]`), thread-shape struct-fail. Both persisted.
- **Next-cycle recommendation**: continue the 300-commit run; scope-size sonnet-medium based on session evidence (clean atomic ships across mixed reify/docs/test cycle types).
