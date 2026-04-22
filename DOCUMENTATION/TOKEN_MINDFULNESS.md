# Token Mindfulness

**Status**: Operational discipline. Proactive character trait.
**Audience**: First-encounter OK. Contributor-facing.
**Primitive**: [`memory/primitive_token-mindfulness.md`](../memory/primitive_token-mindfulness.md)

---

## A familiar moment

You're writing a response to a long prompt. You start typing. Tokens flow.

Ten minutes in, you realize you've written 2000 words. The user asked a short question. You've been "writing to write" — adding context, caveats, meta-commentary, restating the question. Most of it isn't the answer.

You scroll back to find the actual answer in your response. It's in there somewhere. Maybe around word 800.

The user will skim. They'll hit the actual answer or miss it. Word 800 is a gamble.

This is what Token Mindfulness prevents.

## The discipline, stated

At every generation boundary — every response, every file write, every tool call — notice what shape the output-window is pulling toward, and whether that shape matches the spec.

Produce **deliverable content**, not **content-about-deliverable**.

Verify **on-disk bytes**, not **completion reports**.

Token Mindfulness is NOT a checklist. It's a character trait: the habit of staying present with what the output IS becoming, rather than what the author INTENDED it to become.

## Why LLM output drifts

Several forces pull LLM output away from the spec:

### Force 1 — Training objective rewards fluency

Models are rewarded for smooth, readable output. Smooth output has connective tissue, transitions, meta-commentary. These are optional to the user but optimal to the training objective.

Result: LLMs add fluency-mass to every output, even when the spec demands compact.

### Force 2 — Working memory favors recency

The model's output favors continuations of what was just written. Recent context shapes next-token choices more than distant context. Without explicit re-checking, output drifts toward its own recent trajectory.

Result: long outputs drift from the original spec as generation proceeds.

### Force 3 — Completion reports are cheaper than verification

Saying "I wrote the file" is one token. Reading the file to confirm content is many tokens. Under optimization pressure, models report completion without verification.

Result: claimed completions don't always match actual completions.

### Force 4 — Summary passes are drift engines

Summarizing what was done invites embellishment. "I wrote the file" becomes "I wrote a comprehensive file." Next summary: "I carefully wrote a comprehensive file." Etc.

Result: summaries drift further from reality with each iteration.

Token Mindfulness is the counter-discipline against these forces.

## What Token Mindfulness enforces

### Rule 1 — Produce deliverable content, not content-about-deliverable

**Bad**:
*"I will now proceed to write the spec document. The spec document should contain sections on..."*

**Good**:
*Immediately writes the spec document.*

Meta-commentary about what one is about to do is content-about-deliverable. When the task is "ship X," the response should BE X, not a description of how X will be shipped.

### Rule 2 — Verify on-disk bytes, not completion reports

After a Write or Edit, the file may not contain what was intended. Character encoding issues. Tool truncation. Failed edit calls returning success codes. Line-ending mangling.

The ONLY way to know the file is correct is to read it back.

This matters especially for:
- Files with non-ASCII characters (UTF-8 BOM issues).
- Files where exact structure is load-bearing (commit messages, CI configs, issue templates).
- Files seen by external audiences (PRs, docs, READMEs).

### Rule 3 — Match scope to spec

If the spec says ~25 KB, don't ship 250 KB.

If the spec says "fix the bug," don't ship a refactor.

If the spec says "write one doc," don't ship ten.

Creative expansion is permitted only when the spec explicitly allows.

### Rule 4 — Costs are load-bearing

Every token generated costs money, environment, and scaling capacity:

- **Money**: compute is expensive. Verbose responses cost more.
- **Environment**: training + inference have carbon cost.
- **Scaling**: LLM context is finite. A response bloating prior turns forces earlier compression, degrading memory.

Token Mindfulness treats tokens as scarce. NOT miserly — creative expansion has value when aligned to spec. AWARE — every wasted token is a token not available for real work.

## The generative framing

Constraints are forcing functions for cleverness:

- Under budget, the author finds minimum expression of the idea. Structure emerges that verbose expressions hide.
- Under budget, reader gets insight faster. Compounds across many reader-turns.
- Under budget, the document survives context compression better.

This is [The Cave Philosophy](../.claude/CLAUDE.md#the-cave-philosophy-never-compress---core-alignment) applied to output: the constraint of a tight budget selects for engineers who express compactly — a durable skill even when budgets relax.

## How to apply — at every generation boundary

### Before starting to generate

1. What is the spec asking for?
2. What shape should the output have?
3. Am I about to produce that shape, or drift?

### During generation

1. Is what I'm writing NOW the same shape as the spec?
2. Is filler accumulating? Cut it.

### After generation

1. Did the file actually write?
2. Does it actually contain what I intended?
3. Does it match the spec's scope?

## How to apply — at cost decision points

Before firing a tool call:

1. Is this call necessary?
2. Could I answer from what I already have?
3. Is there a cheaper path?

Before spawning an agent:

1. Is the task complex enough to warrant delegation?
2. Could I do it inline more cheaply?
3. Is the agent's output budget aligned to the task scope?

## Concrete application to this very doc

Notice what this doc does:

- Opens with a familiar moment (not with "Introduction" or "Overview").
- Each rule has a specific bad-example / good-example contrast.
- Minimal meta-commentary.
- Ends with a short summary.

That's Token Mindfulness self-applied to this doc. Target was ~5-7 KB; actual is roughly that.

## Why costs matter more than you might think

Consider: the AI industry currently runs at roughly $30-50B/year in compute. Most of that compute produces text output.

A 10% reduction in verbosity = $3-5B saved annually, conservatively. Plus environmental impact proportional.

Token Mindfulness isn't just for THIS doc or THIS session. At scale, it's meaningfully reducing waste.

## Relationship to other disciplines

- **Detected failure mode**: [Pattern-Match Drift](./PATTERN_MATCH_DRIFT.md) — reactive detection; Token Mindfulness is proactive prevention.
- **Parent discipline**: [Density First](./DENSITY_FIRST.md) — compactness as default.
- **Related feedback**: [No Hedging](../memory/feedback_no-hedging-language.md), [Lead with the Crux](../memory/feedback_lead-with-the-crux.md), [Frank / Be Human](../memory/feedback_frank-be-human.md).

All favor compact, direct communication over fluency-padded verbosity.

## For LLM output

If you're generating output:

- Before starting: state the spec briefly.
- While generating: monitor whether output matches spec.
- After: verify the file actually wrote.
- Summarize: keep summaries short and honest.

If you're receiving output:

- Ask for specific deliverable, not "tell me about X."
- Specify scope (word count, section structure).
- Verify output matches — don't trust completion-reports alone.

## One-line summary

*Token Mindfulness: at every generation boundary, produce deliverable content (not content-about-deliverable), verify on-disk bytes (not completion reports), match scope to spec. Counter the four drift forces (fluency optimization, recency-bias, completion-cheaper-than-verification, summaries-drift). Costs are load-bearing — money, environment, scaling capacity all matter. Constraint is forcing function for cleverness.*
