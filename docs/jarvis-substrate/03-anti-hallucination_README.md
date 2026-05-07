# Layer 3 — Anti-hallucination

> Catch terminology errors at write-time, deterministically, regardless of who's pushing for the term.

The anti-hallucination chain is claim-level discipline enforced at the hook layer. It runs before any LLM call, regardless of context, and fires against the system's own author when warranted.

## The substance gate

A regex-based pattern-matching hook on writes. Each watch-list entry is a flagged term plus a context disambiguator: regex patterns that **must** appear nearby and regex patterns that **must not**. If the disambiguator fails, the write is blocked with a suggested replacement.

This is straightforward static analysis — the same shape as a linter's confusable-word rule, or a style checker that flags "affect" when "effect" was meant. The novelty isn't the mechanism. It's the application: writing partner-facing terminology into Solidity function names or contract identifiers is a permanent on-chain commitment, so catching the mismatch at write-time is the right window.

Born from a real incident: a partner-facing doc said `clawback` but the mechanism was **forfeiture** (claim-layer reduction *before* payout, not fund-layer recovery *after*). Both contain the word "reduction" but the load-bearing distinction is what gets reduced. The substance gate now catches that mismatch.

## The chain

| Mechanism | What it enforces | Where |
|---|---|---|
| **Substance gate** | Flagged terms must have correct context disambiguators | `partner-facing-substance-gate.py` |
| **HIERO format** | Memory writes use operator-density (`⇒ ¬ ∧ ∨ ✓ ✗ →`), not prose | `hiero-gate.py` |
| **Empty-Repo Test** | Descriptions must let a reader reconstruct the artifact from words alone. Architectural words ✓, marketing ✗ | Reviewer-applied |
| **Anti-Stale Feed** | Verify current state before asserting. Never claim from memory alone | Discipline-layer rule (P·anti-stale-feed) |
| **Verify Credentials Before Publishing** | Grep source-of-truth profile memory before writing any credential / title / numerical claim | Discipline-layer rule (F·verify-credentials-before-publishing) |

## What gets watched

Each watch-list entry pairs a suspect term with what would justify or contradict it in surrounding context.

Sample entries (sanitized):

- `clawback` requires recovery-of-already-distributed-funds language nearby; forbidden if "claim-layer" or "before payout" appears. Suggestion: "forfeiture, not clawback."
- `governance` (in actor-context) requires a bounded-by-physics-or-constitution disambiguator. Suggestion: "qualify scope — authority *within* math invariants."
- The list grows when new hallucination classes are caught and named.

## What this catches in practice

- **Terminology drift before it becomes a Solidity 4-byte selector.** A `clawback` function name is a permanent on-chain commitment. Catching it at write-time saves a deploy-time fork.
- **Governance overclaim.** "DAO can change X" written without "within mathematical invariants" implies authority the architecture explicitly bounds.
- **Prose-style memory entries.** Memory is a high-leverage surface; prose entries cost context on every boot. HIERO operator-density compression is hook-enforced.

## The test for "real discipline"

> The HIERO gate blocked one of my own writes earlier today.

A discipline that fires only when you remember it isn't a discipline. A discipline that fires regardless is. Hook-enforced anti-hallucination is the latter.

## Source of truth

- Hook implementations: [`hooks/`](../hooks/) in this repo (sanitized) and `~/.claude/session-chain/` (machine-local, full)
- Worked examples of caught hallucinations: see [`papers/`](../papers/) and the partner-facing repos
