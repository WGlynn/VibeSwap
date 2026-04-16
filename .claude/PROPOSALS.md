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

## P4 scratch inventory — 2026-04-16T10:58:50.886199+00:00
**Session**: `ea7bb041-d517-4709-a8f7-c9ce32d566fa`
**Status**: proposed

**P4 scratch inventory** (all in `vibeswap/.claude/`):

| File | Age | Size | Recommendation |
|------|-----|------|----------------|
| `TOMORROW_PLAN.md` | 5 wk | 4.5K | Archive — "tomorrow" is 5 wks ago |
| `TOMORROW_PROMPTS.md` | 5 wk | 2.2K | Archive — same |
| `Jarvis context retrieval Will's manual.txt` | 5 wk | 4.7K | Likely superseded by SKB — check before delete |
| `Jarvis context retrieval Will's manual2.txt` | 5 wk | 19.6K | Same |
| `claude context 3.txt` | 5 wk | 16.5K | Same |
| `freedom context.txt` | 5 wk | 1.4K | Personal — your call |
| `refinery-log.md` | 5 wk | ? | Unknown — inspect first |
| `LIVE_SESSION.md` | 2 wk | 7.3K | Superseded by SESSION_STATE |
| `MIT_HACKATHON_BOOT.md` | 4 d | 8.9K | Event past, archive |
| `AGENT_CONTEXT.md` | 3 wk | 0.9K | Inspect before decision |
| `TRUST_VIOLATIONS.md` | 3 wk | 1.0K | Personal, leave |
| `alison-armstrong-transcript.md` | 5 wk | 165K | Personal, leave |

I cannot delete personal files. Options:
1. **Archive sweep**: move the obvious-stale ones (`TOMORROW_*`, `LIVE_SESSION`, `MIT_HACKATHON_BOOT`, old `.txt` context dumps) into `.claude/archive/YYYY-MM/` — reversible, keeps history searchable.
2. **Surgical**: pick specific files to delete or keep.
3. **Skip P4 entirely**: cleanup not worth the blast radius.

What's your call?

---

## Cleanup duty — status — 2026-04-16T11:28:15.956641+00:00
**Session**: `ea7bb041-d517-4709-a8f7-c9ce32d566fa`
**Status**: proposed

## Cleanup duty — status

- **P1** ✅ WAL + SESSION_STATE rewritten for 2026-04-16, PROPOSALS.md committed (`11382542`)
- **P2** ✅ Stash triage reported — **stash@{0} has real unmerged work**, not dropping without your call. stash@{1} is cosmetic docs.
- **P3** ✅ Deferrals reviewed — 1 finding upgraded: **`VibeFeeDistributor._distributeToStakers` is a latent bug, not a TODO** (stakers' fee share silently zeroed). Recommendations for C9/C10/C11 LOW/INFO items provided.
- **P4** ✅ Stale scratch moved to `.claude/archive/2026-04/` (`e6a6f037` or similar). Personal files untouched.
- **P5** ✅ No-op — SKB/GKB/round-summaries don't track Full Stack cycles; `project_full-stack-rsi.md` already current.

**Your outstanding decisions**:
1. **stash@{0}**: create a branch for review, or park indefinitely?
2. **VibeFeeDistributor bug**: fix now, file ticket, or park?
3. **C11-AUDIT-14** cell-existence cross-ref: design cycle on your calendar?
4. Push the cleanup commits?

---
