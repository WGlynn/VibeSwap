# Recursion 2: Common Knowledge Accumulation

**Type**: Knowledge recursion
**One-liner**: Every session makes the next session smarter. Understanding compounds.

---

## What It Does

Document what you learn — not just what you built, but WHY decisions were made, what was surprising, what the user cares about, what worked and what didn't. Load it next session. Build on it. The AI that starts session 60 knows everything sessions 1-59 discovered.

## How It's Recursive

```
K(n) = extend(K(n-1), discoveries(session_n))
```

Knowledge at step N is defined in terms of knowledge at step N-1 plus new discoveries. Each session's understanding is built on the compressed understanding of all previous sessions. That's recursion — not just accumulation, because old knowledge gets refined, corrected, and deepened by new context.

## What Makes It NOT Just a Log

A log records events chronologically. The knowledge base is a **graph** — primitives reference other primitives, findings connect to decisions, patterns link to implementations. When you learn that "Lawson Floor creates sybil incentives," that links to "SoulboundIdentity prevents sybil" which links to "identity is the foundation of fairness."

The graph grows denser, not just longer. That's the recursive part.

## Evidence

- 50+ memory files across user preferences, feedback, project state, references
- Primitives cross-reference: P-001 → Shapley → cooperative game theory → P-000
- Anti-stale protocol: verify current state before advising based on memory
- Knowledge survives context compression (HOT/WARM/COLD tiers)

## Implementation

1. Structured memory files with frontmatter (name, description, type)
2. Index file (MEMORY.md) with one-line pointers
3. Priority tiers: HOT (always load), WARM (load on topic), COLD (reference)
4. Write new memories when non-obvious knowledge is discovered
5. Verify stale memories against current state before trusting
6. Cross-reference: every primitive should link to related primitives

---

## See Also

- [TRP Core Spec](../../concepts/ai-native/TRINITY_RECURSION_PROTOCOL.md) — Full protocol specification
- [Loop 0: Token Density](loop-0-token-density.md) | [Loop 1: Adversarial](loop-1-adversarial-verification.md) | [Loop 3: Capability](loop-3-capability-bootstrap.md)
- [TRP Pattern Taxonomy (paper)](../../research/papers/trp-pattern-taxonomy.md) — Output of this loop: 12 recurring patterns
