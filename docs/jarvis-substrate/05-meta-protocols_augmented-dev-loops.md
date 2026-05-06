# Augmented Dev Loops

> Two orthogonal augmentation layers required on every development cycle: intention (direction) and protection (safety).

## The protocol

The augmented-mechanism-design pattern at Layer 5 says: augment markets/governance with math-enforced invariants; don't replace. Augmented dev loops applies the same shape one substrate up — to the development process itself. Every TRP (Test/Review/Persist) or RSI (Recursive Self-Improvement) cycle must run *two* orthogonal augmentation layers in addition to the work itself.

```
Standard cycle: do work → ship.
Augmented cycle: declare intention → do work (under protection gates) → cycle-close retrospective → ship.
```

The two layers are not redundant; they verify orthogonal properties.

## Layer 1 — Intention (direction)

Per cycle, before work starts:

- **Declared intention**: a stated objective for this cycle, written verbatim into `SESSION_STATE.md` Active Intention block.
- **Backlog ranking**: candidate work units ordered by intention-fit. Each agent or sub-cycle pulls from this ordered list, not from arbitrary scope.
- **Agent-prompt conditioning**: every agent spawn includes intention-context: "this cycle serves the declared intention by closing X."

Without intention declaration, work drifts to "generic productive" — agents produce *something*, but not necessarily what the run was meant to produce. Drift is the failure mode this layer prevents.

## Layer 2 — Protection (safety)

Per cycle, while work is happening:

- **Changeset-hash pre-commit gate**: agents declare expected file list + invariants in a manifest BEFORE work; pre-commit hash check refuses commits that drift from declaration.
- **Pre-review automated check pipeline**: targeted forge tests + storage-layout diff + slither + full-build, run before human review. Block on failure.
- **Agent reputation tracker**: per-(model, scope_size, cycle_type) tally of clean-ship vs reverted-ship vs blocked-by-gate. Used to scope-size next cycle's agents.
- **Lessons.md schema**: row-per-failure log with INTENT-FAIL / STRUCT-FAIL tags. Inputs to retrospective.
- **Cycle-close retrospective protocol**: 8-step procedure asking *did the cycle serve the declared intention, and what's the delta?*

Without protection, errors compound silently. Drift goes undetected until human review, by which time the next cycle has already started building on faulty foundations.

## Why both layers, not one

The argument for either layer alone fails:

**Intention without protection.** The user declares the right objective; agents work toward it; nothing checks whether the work shipped is structurally sound. Result: the right thing is attempted, but errors accumulate. The team thinks they've shipped; reality is they've shipped buggy code in the right direction.

**Protection without intention.** Agents work under strict integrity gates; nothing bad ships; but the work doesn't necessarily serve any specific declared goal. Result: buildable, testable code that doesn't advance the cycle's actual purpose. The team is busy and not making progress.

Both layers together: the right thing is attempted (intention layer) AND the work is structurally sound (protection layer). The augmentation is orthogonal. The math invariants of each layer enforce a different property; neither can substitute for the other.

This is the same fractal as Augmented Mechanism Design (markets + math invariants) and Augmented Governance (governance + math invariants). One substrate up: dev loops + augmentation invariants.

## The bootstrap loop

The pattern was first applied recursively: the framework's debut session was the work being done. Day 1 of augmented dev loops had only the *discipline* of the protection layer (gates not yet built); subsequent sessions inherit each ship.

Sequencing:

| Item | Status (post-bootstrap) | What it closes |
|------|-------------------------|----------------|
| B1 Changeset-hash pre-commit gate | spec; impl pending | silent-scope-drift |
| B2 Intention declaration template | DONE (SESSION_STATE) | generic-productive failure mode |
| B3 Agent reputation tracker | DONE (JSON schema + tally) | static scope-sizing across sessions |
| B4 Pre-review automated check pipeline | spec; impl pending | orchestrator-judgment surface |
| B5 Lessons.md schema + entries | DONE (3 rows) | repeated failure modes |
| B6 Cycle-close retrospective protocol | DONE (spec) | drift compounding session-to-session |

The recursion is visible: this protocol's *own* bootstrap is documented in `lessons.md` per the discipline it prescribes.

## Composition with other meta-protocols

- **Augmented Mechanism Design**: same shape, market substrate. Augmented dev loops is AMD applied to the development process.
- **Augmented Governance**: same shape, governance substrate. Both intention layer (declared purpose) and protection layer (math-enforced gates) preserve Physics > Constitution > Governance hierarchy at the dev-process level.
- **Trinity Placement (P·trinity-placement-for-critical-primitives)**: critical primitives plant simultaneously at hook + memory + global CLAUDE.md. The augmented-dev-loops protocol itself is one such primitive — the intention block goes in SESSION_STATE (memory), the gates go in `.claude/protocols/` (hook substrate), the rule goes in CLAUDE.md (global).

## Anti-pattern: open-loop without intention

Running an autonomous cycle without a declared intention is the failure mode this protocol explicitly tracks. Detection: any TRP/RSI session where SESSION_STATE.md lacks an Active Intention block. The protocol calls this *open-loop-without-intention* and treats it as memory-tracked failure mode.

The corollary: the *first* commit of any new cycle should be writing the intention. Not writing the intention is itself a structural failure surfaced by the missing-block check.

## Why files, not policy

The whole framework lives as files in the project's `.claude/` directory: `SESSION_STATE.md`, `lessons.md`, `agent-reputation.json`, `protocols/cycle-close-retrospective.md`, etc. None of it is encoded as policy in a server or as configuration in an external tool. Reasons:

- **Greppable**: any file is searchable from a terminal. No query language.
- **Diffable**: changes to the framework are visible in git history.
- **Composable**: subdirectories nest naturally; new protocols add files, no schema migration.
- **Survivable**: outlasts any specific tool; markdown locks to nothing.

The fragmented SaaS world is extraction-through-fragmentation wearing composability's costume. Augmented dev loops, like the rest of JARVIS, refuses that frame. Files are the substrate.

## Origin

2026-05-06 SESSION_STATE bootstrap loop. The 300-commit autonomous run that prompted this protocol's articulation also produced its 6-item backlog (B1-B6) and shipped 4 of the items in the same session. The recursive demonstration is intentional: a discipline that fires on its own debut is a discipline strong enough to fire on subsequent debuts.
