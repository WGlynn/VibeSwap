# Anti-Hallucination Protocol (AHP)

**Status**: Assertion-verification discipline. Live.
**Primitive**: [`memory/primitive_anti-hallucination-protocol.md`](../memory/primitive_anti-hallucination-protocol.md)
**Skill**: `~/.claude/skills/anti-hallucination/` (invoked via `/ahp`).

---

## The problem

LLMs generate plausible-but-false assertions. In a project where correctness is load-bearing (contract audits, mechanism-design memos, SEC engagement letters), a plausible-but-false claim that gets cited can break a chain of work weeks later.

AHP is the discipline that breaks the generation-assertion feedback loop: before asserting a non-trivial claim, verify it.

## The deeper claim

Hallucination is not a defect of LLMs specifically — it is a failure mode of *any* system that generates content faster than it can verify. Humans hallucinate when they're confident + under pressure + rewarded for fluency. LLMs are this pattern scaled up.

The mitigation isn't "LLMs are untrustworthy, humans aren't" — it's "before any system asserts a claim, the system must link the assertion to a verification step." This applies to LLMs, to humans, and to any future agent substrate.

AHP is one specific instantiation of [Stateful Overlay](./STATEFUL_OVERLAY.md) applied to the cognition substrate's hallucination-gap: externalize the verification step so the assertion-layer can't bypass it.

## The protocol — four checks

### Check 1 — Source existence

Claims that cite an external source (a paper, a commit, a comment in a file, a prior session) must be verifiable: the source exists, is at the claimed location, and says what the claim says it says.

Before citing `commit e71e0ea9 fixes X`, verify:
- Does the commit exist? (`git show e71e0ea9`)
- Does it actually touch the files / change the behavior claimed?

Before citing `the paper says α=1.6`, verify:
- Does the paper exist?
- Does it say α=1.6 in the claimed section?
- Is that value load-bearing in the paper's argument or an off-hand example?

### Check 2 — Primitive vs. pattern-match

When asserting "this IS an instance of primitive P", verify:

- The primitive is actually in memory (not hallucinated).
- The current case actually satisfies the primitive's structural requirements.
- The load-bearing distinction of the primitive is preserved in the current case.

This is the inverse of [Pattern-Match Drift](./PATTERN_MATCH_DRIFT.md) — drift applies a familiar primitive that doesn't quite fit; AHP refuses to assert the primitive applies without checking.

### Check 3 — Current state vs. remembered state

Memory records can become stale. A primitive that existed when the memory was written may have been renamed, deleted, or superseded. Before acting on a memory-derived claim:

- If the memory names a file path: check the file exists at that path.
- If the memory names a function or flag: grep for it.
- If the memory summarizes repo state: prefer `git log` for current state.

The [CLAUDE.md auto-memory section's "Before recommending from memory" rule](../.claude/CLAUDE.md) is the canonical form.

### Check 4 — Chain of inference

Multi-step inferences compound error. If step N depends on step N-1, and step N-1 has a 5% error rate, an 8-step chain has ~34% error rate.

Before asserting a chain-of-inference conclusion:
- List the steps explicitly.
- Verify the weakest step.
- If the weakest step isn't verifiable, hold the conclusion as provisional.

## When to invoke

AHP fires automatically when any of these conditions hold:

- The assertion links to external state (a commit, a file, a doc, a tool output).
- The assertion is about primitive / pattern membership.
- The assertion is based on memory.
- The assertion is a chain-of-inference conclusion.

Most non-trivial assertions trigger at least one condition.

## The skill

`/ahp` invokes the protocol as an explicit gate. Use it when:
- The next action depends on a specific claim being true.
- The user will act on the claim downstream.
- The cost of the claim being wrong is larger than the cost of verification.

## What AHP does not do

AHP does not prevent hallucination at the generation step — LLMs will still propose plausible-but-false content. AHP is a filter at the assertion step: before the plausible-but-false content becomes a committed claim, verification gates it.

Think of it as the difference between "brainstorming" and "publishing". Brainstorming generates broadly; publishing filters for correctness. AHP is the filter.

## Relationship to other protocols

- Parent of [Citation Hygiene Gate](../memory/primitive_citation-hygiene-gate.md) — when the claim is a citation specifically, the hygiene gate is the specific sub-protocol.
- Sibling of [P-001 Extraction Gate](../memory/feedback_p001-extraction-gate.md) — extraction gate checks "does this action extract value"; AHP checks "does this assertion hold up."
- Child of [Stateful Overlay](./STATEFUL_OVERLAY.md) — AHP is externalized verification applied to the assertion-generation substrate.

## One-line summary

*Before asserting, verify — source existence, primitive fit, current state, and chain of inference. The verification step is non-skippable.*
