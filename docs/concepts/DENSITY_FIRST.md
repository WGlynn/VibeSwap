# Density First

**Status**: Engineering and communication principle.
**Audience**: First-encounter OK.
**Primitive**: [`memory/feedback_density-always-priority.md`](../memory/feedback_density-always-priority.md) <!-- FIXME: ../memory/feedback_density-always-priority.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

---

## A quick thought experiment

Compare these two answers to "Does VibeSwap use Shapley distribution?"

**Answer A** (low density):
*"Thanks for your question! That's a great question actually. So, VibeSwap does indeed use a distribution method. Specifically, the protocol incorporates what's called Shapley value distribution, which is a cooperative game theory concept that was developed by Lloyd Shapley in 1953. This method has several important properties... [continues for 500 words]"*

**Answer B** (high density):
*"Yes. Shapley distribution with Lawson Floor + Novelty Bonus modifier. Each accepted claim earns marginal-contribution share. See [SHAPLEY_REWARD_SYSTEM](shapley/SHAPLEY_REWARD_SYSTEM.md) for detail."*

Both convey the same fact (VibeSwap uses Shapley). Answer B conveys it in 3% of the tokens.

The difference is density — information-per-token.

## The rule

Write for density first. Make the crux clear in as few tokens as possible. Expand only when the reader's next question demands it.

Dense output has:
- Higher bandwidth-per-token (reader gets more signal per time spent reading).
- Better compression under context-window pressure.
- Graceful truncation (reader gets the crux even if they stop early).

Sparse output:
- Buries the crux in scaffolding.
- Forces reader to pay attention to content that doesn't carry information.
- Fails gracefully less well under truncation.

## Why this matters in VibeSwap's pipeline

VibeSwap's work involves many compression steps:

- Human → Claude (prompt).
- Claude → file (output).
- File → context window (for next session).
- Context window → compression (on token-limit).
- Claude → external agent / subagent (delegation).
- External → final output.

Each step is a compression step. Dense intermediates survive compression; sparse ones don't.

Concrete example: a SESSION_STATE.md block that is dense survives reboots and preserves load-bearing context. A sparse one loses the crux and forces re-derivation.

## The density checklist

Before shipping prose, docs, commits, or messages:

### 1. Is the first sentence the crux?

Readers skim. Buried leads get missed. Dense docs put the main claim in the first sentence.

**Bad**: "In this document, we will explore several aspects of..."

**Good**: "Shapley distribution is the unique axiom-compliant fair-distribution rule; VibeSwap uses it."

### 2. Can any sentence be removed without losing the argument?

If yes, remove it. Each retained sentence must earn its place.

### 3. Is every abstraction necessary?

"The system coordinates across multiple participants" → "VibeSwap's 3-branch attestor coordinates across 50+ node-users."

Concrete details are denser than abstractions. Replace the abstract with the specific whenever possible.

### 4. Does the structure let readers skip to their question?

Headers, tables, bold-key-terms — structural density helps selective readers. Structure IS density at the visual level.

## Density vs brevity — different things

Density is NOT the same as shortness.

A 5-line answer burying the crux is LESS DENSE than a 15-line answer that leads with the crux and follows with substantiation.

Density is: maximum information per unit of reader-attention.

Sometimes dense means MORE words (because supporting detail matters). Usually it means FEWER. Goal is the ratio, not the length.

## When density is wrong

When the audience is new to a concept, density can be hostile. Progressive disclosure often needs some redundancy because readers haven't built the mental models.

Rule of thumb:
- Dense for experienced audiences.
- Progressive disclosure for novices.

Choose the register before writing.

## Density and Token Mindfulness

[Token Mindfulness](monetary/TOKEN_MINDFULNESS.md) is the discipline producing density. Density is the quality metric Mindfulness optimizes for.

Related disciplines:
- **Lead with the crux**: first sentence carries the load-bearing claim.
- **No hedging**: "might," "perhaps," "I think" are sparsity multipliers.
- **No padding**: "It is worth noting that..." / "As mentioned above..." are removable.
- **Frank / be human**: direct register is denser than corporate-polite.

All support density.

## The engineering-code parallel

Density applies to code too. Terse, expressive code is denser than verbose abstraction-layer code.

But: terseness that hides intent is SPARSE at the semantic level (harder to read, harder to verify).

Dense code: every line has a clear semantic purpose.
Sparse code: ceremony lines (unnecessary wrappers, indirection layers, comments-that-restate-the-code).

## Density in memory files

[MEMORY.md](../memory/MEMORY.md) is explicitly density-first: <!-- FIXME: ../memory/MEMORY.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->
- Each line under 150 characters.
- One-line hooks, not paragraphs.
- Links to detailed files; summary in the link text.

RECENT / PEOPLE files follow same pattern. Each section serves a specific retrieval pattern.

## Density in commit messages

A commit message's subject line is the most-viewed context. Density matters:

**Low density**: "Made changes to the oracle contract to fix some issues we were having."

**High density**: "oracle: fix C39 commit-reveal aggregation edge case (median of even-length array)."

The second tells you WHAT was fixed, WHICH contract, WHICH cycle, WHAT subsystem.

## For students

Exercise: take a paragraph of text you've written recently. Apply these:

1. Identify the crux. Is it in the first sentence?
2. Remove every sentence that could be removed without losing the argument.
3. Replace abstractions with specifics.
4. Rewrite for density.

Compare original and revised. Count tokens. Does the revised convey the same signal in fewer tokens? If yes, the original had density opportunity.

Iterate this habit. Most writers find 30-60% compression available without loss.

## One-line summary

*Write for density first — maximum information per unit of reader-attention. Lead with the crux; remove sentences that don't carry their weight; structure for selective reading. Dense intermediates survive compression; sparse ones don't. Density ≠ brevity — sometimes more words are needed, but the ratio matters. Related disciplines: Token Mindfulness, Lead with Crux, No Hedging, Frank/Be Human — all support density.*
