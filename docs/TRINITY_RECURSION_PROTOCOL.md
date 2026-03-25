# Trinity Recursion Protocol (TRP)

**Version**: 1.0
**Authors**: Faraday1 (Will Glynn) & JARVIS
**Date**: 2026-03-25
**Status**: Running in production. First cycle completed.

---

## Abstract

The Trinity Recursion Protocol defines three independent, mutually reinforcing feedback loops that enable recursive self-improvement in AI-augmented software systems. Each loop operates autonomously but amplifies the other two. Together they produce a system that is strictly better after every cycle — a property we call **monotonic improvement**.

This protocol is LLM-agnostic. Any sufficiently capable language model can implement it.

---

## The Three Loops

### Loop 1: Adversarial Verification (Code Recursion)

**Purpose**: The system discovers and fixes its own bugs.

```
reference model (exact arithmetic)
    → adversarial search (hill-climbing, coalition, sybil)
        → discovers profitable deviations
            → exports as regression tests
                → fix applied to contract + model
                    → re-run adversarial search
                        → fewer deviations (monotonic improvement)
```

**Requirements**:
- A **reference model** that mirrors the production system with exact arithmetic
- An **adversarial search harness** with multiple strategies (mutation, coalition, position gaming, floor exploitation)
- A **cross-layer comparison** pipeline: reference output → production output → diff
- **Automated regression**: every finding becomes a permanent test

**Key Property**: Each cycle strictly reduces the attack surface. The fix for finding N cannot reintroduce finding N-1 because N-1's test is permanent.

**Transportability**: Any LLM can implement this by:
1. Reading the production code
2. Writing an equivalent in a language with exact arithmetic (Python `fractions`, Rust `num-rational`)
3. Generating random inputs and comparing outputs
4. Mutating inputs to search for profitable deviations
5. Exporting deviations as tests in the production language

### Loop 2: Common Knowledge Accumulation (Knowledge Recursion)

**Purpose**: Understanding deepens with every session.

```
session with human
    → discoveries documented (primitives, findings, patterns)
        → next session loads knowledge base
            → builds on prior understanding
                → generates deeper insights
                    → knowledge base deepens
                        → next session is strictly more capable
```

**Requirements**:
- A **persistent knowledge base** with structured memory (types: user, feedback, project, reference)
- **Hierarchical organization**: HOT (always load) > WARM (load on topic) > COLD (reference only)
- **Cross-referencing**: primitives reference other primitives, forming a knowledge graph
- **Verification**: memories are checked against current state before being trusted

**Key Property**: Knowledge is additive. New insights don't destroy old ones — they contextualize them. The graph grows denser, not larger.

**Transportability**: Any LLM can implement this by:
1. Maintaining a `MEMORY.md` index with pointers to memory files
2. Each memory has frontmatter (name, description, type)
3. Loading HOT memories at session start
4. Writing new memories when non-obvious knowledge is discovered
5. Verifying stale memories against current state

### Loop 3: Capability Bootstrapping (Turing Recursion)

**Purpose**: The builder builds better tools for building.

```
LLM writes code
    → code creates testing infrastructure
        → testing infrastructure validates code
            → validation reveals patterns
                → patterns improve how LLM writes code
                    → LLM writes better testing infrastructure
                        → better infrastructure reveals deeper patterns
```

**Requirements**:
- **Meta-awareness**: the LLM must recognize when it's building tools that improve its own workflow
- **Formalization**: when a pattern works, encode it as a protocol (not just a habit)
- **Parallel execution**: multiple loops can run simultaneously (e.g., adversarial search + test writing + documentation)

**Key Property**: The capability ceiling rises with each cycle. What was impossible in cycle N becomes routine in cycle N+1.

**Transportability**: Any LLM can implement this by:
1. Noticing when a manual process could be automated
2. Building the automation
3. Using the automation to discover new manual processes
4. Repeat

---

## Convergence Theorem (Informal)

The three loops converge because:

1. **Loop 1** (adversarial) produces **findings**
2. **Loop 2** (knowledge) **contextualizes** findings within the broader system understanding
3. **Loop 3** (capability) builds **better tools** for Loop 1 to use in the next cycle

Without Loop 2, Loop 1 rediscovers the same classes of bugs (no learning).
Without Loop 1, Loop 2 accumulates unvalidated beliefs (no grounding).
Without Loop 3, Loops 1 and 2 are bottlenecked by manual execution (no scaling).

The convergence is monotonic: each triple-cycle produces a system that is:
- Harder to exploit (Loop 1)
- Better understood (Loop 2)
- Faster to improve (Loop 3)

---

## Implementation Checklist

For any new project, implement TRP by:

- [ ] **L1 Reference Model**: Mirror the core logic in exact arithmetic
- [ ] **L1 Test Vectors**: Generate JSON inputs/outputs for cross-language replay
- [ ] **L1 Adversarial Search**: At least 4 strategies (mutation, coalition, position, sybil/floor)
- [ ] **L1 Regression Pipeline**: Every finding becomes a permanent test
- [ ] **L2 Memory System**: Persistent, structured, with hot/warm/cold tiers
- [ ] **L2 Session Protocol**: Load at start, save at end, verify before trusting
- [ ] **L2 Primitive Documentation**: Non-obvious insights get their own files
- [ ] **L3 Coverage Matrix**: Per-property map of what's tested where
- [ ] **L3 Test Runner**: Single command for all layers
- [ ] **L3 Pattern Formalization**: Working patterns become protocols

---

## Evidence

First cycle completed 2026-03-25 on VibeSwap's ShapleyDistributor:

| Metric | Value |
|--------|-------|
| Python tests | 68 passing |
| Solidity tests | 14 passing |
| Adversarial runs | 433 per cycle |
| Bugs found by Loop 1 | 3 (null player dust, sybil floor, scarcity boundary) |
| Bugs fixed by Loop 1 | 1 (null player dust — contract + model updated) |
| Findings documented by Loop 2 | 6 |
| Tools built by Loop 3 | 7 (reference model, adversarial search, vector generator, replay tests, conservation tests, coverage matrix, test runner) |

---

## License

This protocol is public domain. Use it, extend it, improve it. If the three loops work for us, they'll work for anyone building mechanism-heavy systems with AI assistance.

> "The true mind can weather all lies and illusions without being lost."
> — The Lion Turtle
