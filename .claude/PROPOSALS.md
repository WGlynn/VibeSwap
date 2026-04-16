# Proposals Ledger

Canonical store for options/alternatives proposed to Will for decision. Survives session crashes.
Appended by `~/.claude/session-chain/proposal-scraper.py` (Stop hook) and by the Propose→Persist primitive.

Format per entry:
```
## <topic> — <timestamp>
**Session**: <session-id>
**Status**: proposed | acted-on | superseded

<options content>
```

---

## Full-Stack RSI — Cycle 11 options — 2026-04-15 04:54 UTC (RECOVERED)

**Session**: `5ba12ced-49bc-424a-9145-a73ee63cbeb6` (crashed on API 500)
**Status**: acted-on — Will chose A + D before crash
**Recovered by**: transcript-mining on 2026-04-15 from JSONL line 1120

- **C11-A**: Fresh scope — audit NCI again (rebase-invariant accounting may have crept into consensus paths)
- **C11-B**: Property-based fuzzing — offCirculation invariants under registration churn, challenge-response edge cases
- **C11-C**: Meta-audit — review the C9/C10 fixes themselves for regressions (the adversarial-recursion pattern)
- **C11-D**: Extend challenge-response pattern to other self-reported metrics (TWAP, uptime, fee multipliers) — generalization loop

**Will's selection**: A + D (parallel — fresh scope + generalization loop)

## Highly personal — do NOT share — 2026-04-15T22:47:10.342227+00:00
**Session**: `5d3519f7-3db7-410c-be60-f32912c41edd`
**Status**: proposed

What "Jarvis" actually is on this system (quick scan):

**Highly personal — do NOT share**:
- `~/.claude/JarvisxWill_CKB.md` — personal knowledge base
- `~/.claude/nervos-intel.md` — business intel
- `~/.claude/PROPOSALS.md` — active
- `vibeswap/.claude/TRUST_VIOLATIONS.md` — flagged issues
- `vibeswap/.claude/alison-armstrong-transcript.md` — personal transcript
- `vibeswap/.claude/freedom context.txt` — personal
- `vibeswap/.claude/MIT_HACKATHON_BOOT.md` — your playbook
- `vibeswap/.claude/TOMORROW_PLAN.md` — personal scheduling
- `vibeswap/.claude/LIVE_SESSION.md` / `SESSION_STATE.md` — active state
- 235 memory files — mix: many contain names (Ashwin, Tadija, Vedant, Will=Tet), business decisions, financial state, job search notes

**Shareable with scrubbing (the actual "system")**:
- `vibeswap/.claude/session-chain/` scripts — proposal-scraper.py, replay-proposal.py, other hook plumbing
- Hook scripts (`.claude/hooks/` if present)
- Generic primitive memory files (Claude-facing rules, not Will-facing facts)
- Template versions of SKB / GKB / MEMORY.md / SESSION_STATE.md / WAL.md / CLAUDE.md
- `JarvisxWill_GKB.md` — the Generalized Knowledge Base (substrate-agnostic by design, but needs scrubbing review)

**Three paths, pick one**:

1. **`jarvis-template` new repo** — I scrub and extract the shareable layer (scripts + primitive files + templates) into a new public repo. ~30-60 min. Clean, safe, working.
2. **Scripts + GKB only** — minimal, fast. Just `session-chain/` + scrubbed GKB. ~15 min.
3. **JARVIS.md only** — already done, already public. No new work.

Which? If 1, want it at `wglynn/jarvis-template` or append to vibeswap repo under a `jarvis/` dir?

---
