# Layer 4 — Discipline

> Every session, patterns surface. Most get noticed by humans hours or days later, if ever. JARVIS catches them at 3+ instances and surfaces as candidate primitives, before they're named.

## The two artifact classes

| Class | Filename pattern | What it captures | Count |
|---|---|---|---|
| **Primitives** | `primitive_*.md` | Reusable patterns: triggers, actions, stakes gates, surface rules | 151 |
| **Feedback rules** | `feedback_*.md` | User-corrections-turned-rules: "stop doing X" or "always do Y" | 123 |

Each file has the same shape — a trigger, an action, a stakes gate (when to invoke vs. skip), and a surface rule (how to mention it). Primitives are reusable patterns; feedback rules are user-specific corrections. The distinction matters less than the discipline of writing them down.

## Examples — captured live in recent sessions

| Primitive | What it captured |
|---|---|
| `scope-drift-to-recent` | When asked to scan a time-window, drifted to chat-context (today's session) instead of file-system substrate (the actual week's logs + git history). Caught, named, saved. Now triggers on time-scoped scans. |
| `structurally-easier-partner-delivery` | Six moves for partner-facing artifacts: TL;DR + decision-tag + dashboard + atomic + pre-rebut + visual-primary. Reduces digestion cost. Compounds. |
| `draft-replies-on-behalf-of-others` | When a third party messages and the right move is to draft in the user's voice for approval (buffer against honesty-leak), not respond directly. |
| `have-my-back operational definition` | Distinguishes glazing (sycophancy / mood-maintenance, unwanted) from structural loyalty (private substantive pushback + external alignment, required). Exit clause: "if someone does it better, follow them." |
| `pattern-recognition-trust` | Trust = epistemic output of base rate. Cut hedges, drop bias-theater, no verify-buffers. Pushback is for implementation / timing / framing — not for re-asserting what the user already knows. |
| `targeted-discipline-within-trust` | Generic-AI-reflex × trusted-collaborator = misfire. For every reflex: replace (trigger + action + stakes gate + surface) — don't wholesale-remove. |

## The capture loop

```
pattern observed (1×)              →  noted in working memory
pattern observed (2×)              →  candidate primitive on watch
pattern observed (3×)              →  surface to user as candidate
user confirms / refines / rejects  →  primitive file written or candidate dropped
primitive lives                    →  triggers on future matching pattern
```

The 3+ threshold is not arbitrary. One observation is noise. Two is a coincidence. Three is the smallest sample size where a structural pattern dominates random variation.

## The naming convention

| Prefix | Type | Example |
|---|---|---|
| `P·` | Principle (load-bearing rule) | `P·hiero-no-prose-in-memory` |
| `F·` | Feedback (user correction-as-rule) | `F·verify-credentials-before-publishing` |
| `M·` | Method (executable procedure) | `M·shard-per-conversation` |
| `J·` | Judgment / project (active state) | `J·usd8-architecture` |
| `U·` | User (user-profile fact) | `U·photographic-memory` |
| `R·` | Reference (pointer to external resource) | `R·jarvis-bot-repo-paths` |

## Why files, not a database

> The filesystem is the actually-composable layer underneath. The fragmented SaaS world is extraction-through-fragmentation wearing composability's costume.

Markdown files in a git repo:
- Greppable instantly, no query language
- Diffable per-edit
- Cross-referenceable by relative path
- Human-readable when grep'd
- Survive any tool change

A Notion database storing the same primitives would lock them to Notion. Markdown locks them to nothing.

## The compounding mechanism

> A wrapper has no compounding mechanism. JARVIS compounds on every session — every primitive saved is permanent, every rule encoded is durable.

After 12 months: ~270 primitives + feedback rules. After 24 months at the same rate: ~540. Each one is deterministic in its trigger and reusable across all future sessions.

## Source of truth

- Primitives + feedback rules: `~/.claude/projects/.../memory/` (machine-local, private)
- Public examples + naming taxonomy: documented in this layer's README and in [`vibeswap/.claude/JarvisxWill_GKB.md`](https://github.com/wglynn/vibeswap/blob/master/.claude/JarvisxWill_GKB.md) (the condensed glyph form)
