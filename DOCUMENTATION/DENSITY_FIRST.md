# Density First

**Status**: Engineering and communication principle.
**Primitive**: [`memory/feedback_density-always-priority.md`](../memory/feedback_density-always-priority.md)

---

## The rule

Write for density first. Make the crux clear in as few tokens as possible; expand only when the reader's next question demands it.

Dense output has higher bandwidth-per-token, compresses better under context-window pressure, and survives truncation gracefully. Sparse output buries the crux in scaffolding and forces the reader to pay for content that doesn't carry information.

## Why this matters in a multi-agent pipeline

VibeSwap's development loop involves humans + Claude + subagents + external reviewers + future-self sessions. Every intermediate representation is a compression step. Dense intermediates survive compression; sparse ones don't.

Concrete example: session-state. A dense SESSION_STATE.md block survives compression and reboots without losing load-bearing context. A sparse one loses the crux and forces re-derivation.

## Density checklist

Before shipping prose, docs, commits, or messages:

1. **Is the first sentence the crux?** Readers skim; buried leads get missed.
2. **Can any sentence be removed without losing the argument?** If yes, remove it.
3. **Is every abstraction necessary?** "The system coordinates across multiple participants" vs. "VibeSwap's 3-branch attestor coordinates across 50+ node-users". Concreteness is dense.
4. **Does the structure let a reader skip to their question?** Headers, tables, bold-key-terms — structural density helps selective readers.

## Density vs. brevity

Density is not the same as shortness. A 5-line answer that buries the crux is less dense than a 15-line answer that leads with the crux and follows with substantiation.

Density is: *maximum information per unit of reader-attention*. Sometimes that means more words. Usually it means fewer.

## Density and [Token Mindfulness](./TOKEN_MINDFULNESS.md)

Token Mindfulness is the discipline that produces density. Density is the quality metric that Mindfulness optimizes for.

Related:
- **Lead with the crux** — the first sentence carries the load-bearing claim.
- **No hedging** — "might", "perhaps", "I think" are sparsity multipliers.
- **No padding** — "It is worth noting that..." / "As mentioned above..." are removable.
- **Frank / be human** — direct registers are denser than corporate-polite ones.

## When density is wrong

When the audience is new to a concept, density can be hostile. Onboarding docs often need some redundancy because readers haven't built the mental models that make dense prose legible.

Rule of thumb: dense for experienced audiences, progressive-disclosure for novices. Choose the register before writing.

## The engineering-code parallel

Density applies to code too. Terse, expressive code is denser than verbose abstraction-layer code. But terseness that hides intent is sparse at the semantic level (harder to read, harder to verify).

Dense code: every line has a clear semantic purpose. Sparse code: some lines exist for ceremony (unnecessary wrappers, indirection layers, comment-that-restates-the-code).

## Density in memory files

[MEMORY_FORMAT_SPEC.md](../memory/MEMORY_FORMAT_SPEC.md) is explicitly density-first: primitive files have a fixed skeleton (rule, why, how-to-apply), RECENT/PEOPLE files have 1-line entries, MEMORY.md index has 1-line hooks. Every section serves a retrieval pattern; no section carries scaffolding alone.

## One-line summary

*Lead with the crux; remove everything that doesn't carry its weight; structure for selective reading — density is maximum information per unit of reader-attention.*
