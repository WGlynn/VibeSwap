# TRP Runner Protocol

**Version**: 1.0
**Date**: 2026-03-27
**Purpose**: Execute TRP without crashing the context window.

---

## Problem

TRP invocation loads: CKB (~1000 lines) + MEMORY.md (~200 lines) + SESSION_STATE + WAL + TRP spec (217 lines) + 4 loop docs (~200 lines) + target code + actual recursive operations = context overflow = crash.

## Solution: 4 Mitigations

### Mitigation 1: Staggered Loading

Never load all TRP context at once. The main context is a **coordinator**, not an executor.

**Stage 0 — Preflight** (coordinator only):
- Read THIS file (TRP_RUNNER.md) — you're already here
- Identify the TARGET (contract, module, or subsystem)
- Run context guard (Mitigation 2)

**Stage 1 — Target Acquisition** (coordinator only):
- Read ONLY the target code (the contract/module being improved)
- Do NOT read CKB, do NOT read full TRP spec, do NOT read loop docs
- Summarize target in <10 lines: what it does, key functions, known issues

**Stage 2 — Loop Dispatch** (subagents — Mitigation 4):
- Dispatch each loop to its own subagent
- Each subagent loads ONLY what its loop needs (see Sharding Matrix below)
- Coordinator waits for results

**Stage 3 — Integration** (coordinator only):
- Collect subagent results
- Write findings to SESSION_STATE
- Update memory if non-obvious knowledge discovered
- Score the cycle

### Mitigation 2: Context Guard (50% Rule)

**Before ANY TRP invocation, the coordinator MUST check:**

```
IF session has already consumed significant context (long conversation, many tool calls,
   large files read, multiple agent results received):
   → REFUSE TRP. Tell Will: "Context too hot. Reboot first, then invoke TRP in fresh session."

IF session is fresh (just started, minimal prior conversation):
   → PROCEED with TRP Runner.
```

**Heuristic**: If you've already had >10 back-and-forth exchanges or read >5 large files in this session, you're past 50%. Don't run TRP — reboot.

**Exception**: If Will says "run it anyway" — proceed but warn that quality may degrade.

### Mitigation 3: Minimal Boot Path

When Will says "recursion protocol" or "TRP" at session start, use this boot instead of full session start:

```
TRP MINIMAL BOOT:
1. Check WAL.md               → crash recovery only if ACTIVE
2. Read TRP_RUNNER.md          → this file (the runner, not the full spec)
3. Identify target             → what are we improving?
4. Skip CKB                    → not needed for TRP execution
5. Skip full MEMORY.md read    → only load if a loop needs specific memory
6. Skip SESSION_STATE deep read → just note parent hash
7. Go directly to Stage 1
```

**What gets skipped**: CKB (1000 lines), full memory traversal, alignment primitives, project context.
**What gets loaded**: TRP Runner (this file), target code, loop-specific context (in subagents).

The skipped context isn't lost — it lives in the subagents' context if they need it (they usually don't).

### Mitigation 4: Ergonomic Sharding (Nervos Pattern) — OPTIMIZATION, NOT SAFETY

**Critical insight (2026-03-27)**: Mitigations 1-3 handle crash prevention. Sharding handles PARALLELISM. These are different value propositions. If 1-3 suffice, sharding adds unnecessary tradeoffs — just like how Nervos CKB only uses L1 when verification is necessary and L2 when compute is necessary. Don't use a shared resource when a local one works.

**The principle**: Shard ONLY when parallelism genuinely accelerates the cycle. If the session has capacity, run loops sequentially in the coordinator — it's simpler and the coordinator retains full context of all findings for integration.

**Dispatch Matrix:**

| Loop | Where | Why | Loads |
|------|-------|-----|-------|
| R0 (compress) | **COORDINATOR** | Self-referential — compression optimizes the coordinator's own context. Sharding this makes no sense; you can't compress your desk from someone else's desk. | MEMORY.md, SESSION_STATE |
| R1 (adversarial) | **SUBAGENT (opus)** | Pure compute — run hundreds of attack scenarios, compare outputs, report findings. Coordinator doesn't need to watch. | Target contract, test files, reference model |
| R2 (knowledge) | **HYBRID** | Discovery = subagent (sonnet: scan CKB, find gaps). Verification + integration = coordinator (did we learn something true? write it). | Subagent: CKB + findings. Coordinator: subagent summary. |
| R3 (capability) | **SUBAGENT (opus)** | Pure build — write tools, write tests, produce artifacts. Hand back the finished product. | Target contract, existing tools, coverage gaps |

**Why this is balanced:**
- R0 local: you don't outsource self-improvement of your own workspace
- R1 sharded: adversarial search is embarrassingly parallel and context-hungry
- R2 hybrid: knowledge DISCOVERY is cheap (sonnet scans), knowledge VERIFICATION needs the coordinator's full picture
- R3 sharded: tool building is creative compute, doesn't need alignment context

**Coordinator load**: TRP_RUNNER.md + target summary + R0 context + R2 integration. ~25% of capacity. The heavy compute (R1, R3) is fully offloaded.

---

## Invocation

When Will says any of:
- "recursion protocol"
- "TRP"
- "run the loops"
- "recursive improvement"

**Jarvis responds:**

```
TRP RUNNER v1.0 — PREFLIGHT
├── Context guard: [PASS/FAIL — if FAIL, suggest reboot]
├── Boot mode: [MINIMAL/already booted]
├── Target: [identified target or ask Will]
├── Loops to run: [R0/R1/R2/R3 or subset]
└── Dispatching [N] shards...
```

Then execute Stages 1-3.

---

## Scoring

After each TRP cycle, score on 5 dimensions:

| Dimension | Metric | Score |
|-----------|--------|-------|
| **Survival** | Did the session crash? | PASS/FAIL |
| **R0 (density)** | Bytes saved or context optimized | +/- delta |
| **R1 (adversarial)** | Bugs found / attack surface reduction | count |
| **R2 (knowledge)** | Primitives created or updated | count |
| **R3 (capability)** | Tools built or improved | count |
| **Integration** | Did loops feed each other? | Y/N + description |

**Overall grade**: S (all loops produced findings + integration) / A (3+ loops productive) / B (2 loops) / C (1 loop) / F (crash)

---

## Recovery

If a subagent crashes or times out:
1. Log which loop failed and what it was doing
2. Do NOT retry in same session — that subagent's context is gone
3. Collect results from surviving subagents
4. Score what completed
5. Note failed loop for next session

If coordinator crashes:
- WAL should capture in-flight state (Anti-Amnesia Protocol)
- Subagent results may be lost — this is acceptable, they can be re-run
- Next session: check WAL, see TRP was in-flight, resume from last completed stage

---

## Anti-Patterns

- **DON'T** load the full TRP spec (TRINITY_RECURSION_PROTOCOL.md) during a run. That's reference documentation, not runtime context.
- **DON'T** read all 4 loop docs into the coordinator. Each loop doc goes to its respective subagent only.
- **DON'T** run TRP mid-session after heavy work. Reboot first.
- **DON'T** run all 4 loops sequentially in the main context. That's the old crash pattern.
- **DON'T** load CKB "just in case." If a subagent needs alignment context, it loads it itself.
