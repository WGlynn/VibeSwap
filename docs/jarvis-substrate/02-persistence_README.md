# Layer 2 — Persistence

> Sessions reset. State doesn't.

The model is amnesic between sessions. The system is not. Persistence is what makes JARVIS coherent across reboots, context limits, and provider failures.

## Six tiers

| Tier | File | Role | Read on |
|---|---|---|---|
| 1 | `SESSION_STATE.md` | Current session state, pending items, next-session continuation point | Boot (mandatory first read) |
| 2 | `WAL.md` | Write-ahead log of cycle epochs (RSI cycles), ACTIVE / CLEAN status, orphan commit capture | Boot, after every cycle |
| 3 | `JarvisxWill_SKB.md` | Session Knowledge Base — fresh-boot read, topic-organized | Boot |
| 4 | `JarvisxWill_GKB.md` | Glyph Knowledge Base — condensed form, ~80% smaller than SKB. Topic-sharded: CANON / VSOS / MECH / STACK / SHAPLEY / TOKENS / LAYERS / 7AX | Post-compression boot |
| 5 | `MEMORY.md` | Persistent memory index, always loaded | Every session, automatic |
| 6 | `memory/primitive_*.md` + `memory/feedback_*.md` | Topic files — 151 primitives + 123 feedback rules at last count | On-demand from MEMORY.md pointers |

## What "primitive" means

Each primitive is one markdown file with **four fields**:

- **trigger** — the pattern that activates the rule
- **action** — what to do when triggered
- **stakes gate** — when to invoke versus when to skip
- **surface rule** — how to surface this to the user

When a pattern repeats 3+ times in a session, it gets named, captured into a primitive file, and added to MEMORY.md's index. Every primitive is permanent.

## Source of truth

- VibeSwap-side persistence: [`vibeswap/.claude/`](https://github.com/wglynn/vibeswap/tree/master/.claude) — `SESSION_STATE.md`, `WAL.md`, `JarvisxWill_SKB.md`, `JarvisxWill_GKB.md` are git-tracked here.
- Personal memory: `~/.claude/projects/.../memory/` — private by design.

## The reboot test

> When I close a session at 5% context and reboot fresh, none of this conversation survives in Claude's context. *All* of it survives in the persistence layer. The new session opens by reading SESSION_STATE and continues exactly where the old one left off — including which fly app I was just trying to identify, which commit hash I just pushed, and what's blocked on what.

This is what the wrapper accusation misses. The model is amnesic. The system is not.

## HIERO compression

`MEMORY.md` was compressed from **31.8 KB → 21.3 KB (33% reduction)** by rewriting prose-style entries in HIERO operator-density format. Detail preserved in the linked topic files; index shrunk so more of it fits in the boot context window.

The compression is auditable: `git log -p MEMORY.md` shows the exact diff. Density beats prose-parse-cost for index entries; prose can live in the linked detail files where it's not loaded every boot.

## What "stateful overlay" means as a principle

> Every LLM substrate gap admits an externalized idempotent overlay.

The substrate forgets. The overlay remembers. The overlay is files. Files are git-tracked. Git is the substrate's substrate.
