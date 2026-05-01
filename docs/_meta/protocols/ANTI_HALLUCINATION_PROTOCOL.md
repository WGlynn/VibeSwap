# Anti-Hallucination Protocol (AHP)

**Status**: Assertion-verification discipline. Live.
**Audience**: First-encounter OK. Walked AHP invocation examples.
**Primitive**: [`memory/primitive_anti-hallucination-protocol.md`](../memory/primitive_anti-hallucination-protocol.md)
**Skill**: `~/.claude/skills/anti-hallucination/` (invoked via `/ahp`).

---

## A common failure mode

You ask Claude: "Does the `NakamotoConsensusInfinity` contract have a `slashValidator` function?"

Claude replies: "Yes, `slashValidator(address validator, uint256 amount)` is in the contract at line 432."

You trust this. You write code that calls `slashValidator`. It compiles-tests-ships.

Production: the call reverts. The function doesn't exist. Claude hallucinated.

This is the failure AHP prevents.

## Why LLMs hallucinate

LLMs generate plausible-sounding content. Sometimes that content corresponds to truth; sometimes it doesn't. The generation process doesn't distinguish — it produces tokens based on training-pattern-matching.

When asked about specific code, an LLM generates what "sounds like" the answer. If the truth is uncommon (an edge case, a recent change, a specific-project detail), the generation might drift to the statistically-average answer instead.

For production-quality work, this is unacceptable. But LLMs are economically valuable even with hallucinations IF we can verify claims before acting on them.

AHP is the verification discipline.

## The deeper claim

Hallucination is NOT an LLM-specific defect. It's a failure mode of ANY system that generates content faster than it can verify. Humans hallucinate when they're:
- Confident.
- Under pressure.
- Rewarded for fluency.

LLMs are this pattern scaled up.

The mitigation isn't "LLMs are untrustworthy." It's: "before any system asserts a claim, link the assertion to a verification step."

AHP is one specific instantiation of [Stateful Overlay](./STATEFUL_OVERLAY.md) applied to the cognition substrate's hallucination-gap: externalize the verification step so the assertion-layer can't bypass it.

## The four checks

When assertions matter (next steps depend on truth of claim), AHP fires the following:

### Check 1 — Source existence

Claims that cite an external source (paper, commit, comment, prior session) must be verifiable.

**Example**:
- Claim: "commit e71e0ea9 fixes X."
- Check: `git show e71e0ea9`. Does it exist? Does it touch the files claimed? Does it change the behavior claimed?

**Fails if**: commit doesn't exist OR doesn't do what claim says.

### Check 2 — Primitive membership

Claims that "this IS an instance of primitive P" must verify:

- The primitive exists in `memory/`.
- The current case satisfies the primitive's structural requirements.
- The load-bearing distinction of the primitive is preserved.

**Example**:
- Claim: "this mechanism is a Stateful Overlay."
- Check: does it satisfy all four properties (externalized, idempotent, read-through, failure-independent)?

**Fails if**: the case doesn't satisfy the primitive's structural requirements.

### Check 3 — Current state vs remembered state

Memory records can become stale. Before acting on memory-derived claims:

- If the memory names a file path: check the file exists.
- If it names a function or flag: grep for it.
- If it summarizes repo state: prefer `git log` for current.

**Example**:
- Memory says: "Gap #1 is NCI convex retention."
- Action needed: check the Gap #1 doc. Check NCI source code. Verify the memory is still current.

**Fails if**: the memory is stale (primitive renamed, file moved, mechanism superseded).

### Check 4 — Chain of inference

Multi-step inferences compound error. Step 4 of a 10-step chain might only be 5% likely to be wrong; but if steps 1-3 are each 5% wrong, cumulative error is ~20%.

**Example**:
- Claim: "Since X implies Y, and Y implies Z, the mechanism needs Z."
- Check: is X true? Is the X→Y inference correct? Y→Z? Each step verifiable?

**Fails if**: any step in the chain is uncertain or wrong.

## Walked AHP invocation example

Let's see AHP in practice.

### Setup

I'm working on a VibeSwap cycle. I want to claim: "The C35 cycle fixes the shardId-burn invariant in ShardOperatorRegistry, and it's documented as AUDIT-10 INFO closure."

### Without AHP

I make the claim. Write code that depends on it. Ship. Maybe it's right, maybe not.

### With AHP

I invoke AHP:

**Check 1 — Source existence**:
- `git log --grep="C35"` → yes, commit `8219d77b` references C35.
- `git show 8219d77b` → yes, touches ShardOperatorRegistry.sol.
- Does it fix shardId-burn invariant? Let me read the commit message and diff. Yes.
- Is it documented as AUDIT-10 closure? Check memory for AUDIT-10. Yes, found in `memory/project_rsi-backlog.md`.

Source exists ✓.

**Check 2 — Primitive membership**: N/A for this claim.

**Check 3 — Current state**: 
- Check ShardOperatorRegistry source. Does the shardId-burn invariant still hold? `grep` for the relevant code.
- Result: code is there; tests are there.

Current state matches ✓.

**Check 4 — Inference chain**: N/A (direct claim, not inferred).

All checks pass. Claim verified. Safe to proceed.

## When to invoke /ahp explicitly

AHP fires automatically on claims that trigger any of the four checks. Explicit invocation (`/ahp`) is useful when:

- The next action depends on a specific claim being true.
- The user will act on the claim downstream.
- The cost of the claim being wrong is larger than the cost of verification.

For high-stakes claims, running `/ahp` explicitly is cheap insurance.

## What AHP does NOT do

AHP doesn't prevent hallucination at generation. LLMs will still propose plausible-but-false content.

AHP is a FILTER at the assertion step. Before plausible-but-false content becomes a committed claim, verification gates it.

Think of it as the difference between brainstorming and publishing. Brainstorming generates broadly; publishing filters for correctness. AHP is the filter.

## Common AHP misses

### Miss 1 — Partial verification

"The file X exists" might not be enough. "The file X exists AND contains function Y AND function Y does Z" is the full claim. Verify all parts.

### Miss 2 — Pattern-match-driven verification

If AHP checks pattern-match against memory, it can confirm things that aren't quite true (near-misses). Explicit verification ("did I actually see this specific code?") is safer.

### Miss 3 — Stale memory blessed by AHP

Memory reads might satisfy AHP checks but still be outdated. Current state should be checked even if memory agrees.

These are known failure modes. Human-review still matters for high-stakes claims.

## The meta-principle

*Before asserting, verify.*

Source existence. Primitive fit. Current state. Chain of inference.

If any check fails, pause. Don't assert; investigate.

If all pass, assert. Downstream actions can proceed with confidence.

## Relationship to other primitives

- **Parent of**: [Citation Hygiene Gate](../memory/primitive_citation-hygiene-gate.md) — citation-specific sub-protocol.
- **Sibling of**: [P-001 Extraction Gate](../memory/feedback_p001-extraction-gate.md) — both are "check before act" patterns.
- **Instance of**: [Stateful Overlay](./STATEFUL_OVERLAY.md) — externalized verification applied to the assertion-generation substrate.

## For users

If you're working with Claude on VibeSwap:

- Invoke `/ahp` before high-stakes claims.
- Ask Claude to run AHP on its own outputs.
- Verify specific details (SHAs, function names, file paths) before depending on them.

AHP doesn't slow down work meaningfully. It just prevents expensive mistakes.

## One-line summary

*Anti-Hallucination Protocol fires four checks before accepting claims (source existence, primitive membership, current-state, chain-of-inference). Walked example (C35 cycle claim) shows verification flow. Doesn't prevent generation; filters assertions. Invokable via /ahp for high-stakes claims. Substrate-independent pattern — applies to any system generating faster than it verifies.*
