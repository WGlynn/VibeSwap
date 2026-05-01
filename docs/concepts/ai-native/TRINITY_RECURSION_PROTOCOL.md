# Trinity Recursion Protocol (TRP)

**Version**: 1.0
**Authors**: Faraday1 (Will Glynn) & JARVIS
**Date**: 2026-03-25
**Status**: Running in production. First cycle completed.

---

## Abstract

The Trinity Recursion Protocol defines three independent, mutually reinforcing feedback loops that enable recursive system improvement in AI-augmented software development. Each loop operates autonomously but amplifies the other two. Together they produce a system that is strictly better after every cycle — a property we call **monotonic improvement**, which is enforced by the growing regression test suite, not inherent.

**Important distinction**: TRP achieves **weight augmentation without weight modification**. The model's frozen weights don't change — but the effective capability does, because context IS computation. Loading 50 primitives, 60 sessions of knowledge, and 7 custom tools into the context window makes the model behave as if it were a fundamentally more capable model. Same weights, different manifold.

This is stronger than modifying weights directly. Weight changes can be destructive (catastrophic forgetting, mode collapse). Context augmentation is purely additive — you never lose capability, you only gain it. That's why the monotonic improvement property holds structurally, not just empirically.

The four recursions are weight augmentation through four channels:
- **R0** (compression): fit more augmentation into the same context window
- **R1** (adversarial): augment with "don't make THESE verified mistakes"
- **R2** (knowledge): augment with "here's what 60 sessions already figured out"
- **R3** (capability): augment with "here's a tool that does this hard thing for you"

True ASI would require modifying the LLM itself. TRP can't do that. But the trajectory is clear: if the effective capability ceiling rises with every cycle, and the cycles are recursive (not just repetitive), then the gap between frozen weights and ASI-equivalent behavior narrows with each iteration.

This protocol requires an LLM capable of: code generation in multiple languages, persistent state across sessions, adversarial reasoning, and exact-arithmetic equivalence modeling. Currently Claude/GPT-4 class.

---

## The Four Loops

### Loop 0: Token Density Compression (Substrate Recursion)

**Purpose**: More capability per token. The medium through which all other loops communicate.

```
context_n (raw)
    → compress (prune, tier, structure)
        → denser representation
            → more capability per session (deeper search, more knowledge loaded, more tools built)
                → more output to compress
                    → compress(context_{n+1}) with better compression heuristics
```

**Requirements**:
- **Tiered memory**: HOT (always load) > WARM (load on topic) > COLD (reference only)
- **Structured compression**: block headers, session state, Verkle-style context trees
- **Pruning**: filler dies, decisions survive, relationships survive if load-bearing
- **Self-referential**: compression heuristics improve from observing what was useful vs wasted

**Key Property**: Information per token increases monotonically. The same context window holds more meaning in cycle N+1 than cycle N.

**Why Loop 0 (not Loop 4)**: Token density is the substrate on which Loops 1-3 operate. Denser knowledge (Loop 2) means more context loaded → better adversarial search (Loop 1) → more tools built per session (Loop 3). It doesn't run alongside the other loops — it runs BENEATH them, amplifying all three simultaneously.

**Transportability**: Any LLM can implement this by:
1. Structuring persistent memory with priority tiers
2. Summarizing sessions into block headers (not full transcripts)
3. Pruning stale/redundant memories on access
4. Tracking which memories were actually used vs loaded-but-ignored

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

Three recursions + one meta-recursion. Loop 0 is the substrate; Loops 1-3 are the actors.

```
Loop 0 (density) amplifies ALL of:
    Loop 1 (adversarial) → produces findings
    Loop 2 (knowledge)   → contextualizes findings
    Loop 3 (capability)  → builds better tools for Loop 1
```

**Loop 0 is the accelerant**: denser context → more loaded per session → deeper search (L1), richer knowledge (L2), more tools built (L3) → more output to compress → denser context. The meta-recursion makes the other three recursions faster with every cycle.

**Without each loop**:
- Without Loop 0: context window fills with noise, all three loops degrade per-session
- Without Loop 1: Loop 2 accumulates unvalidated beliefs (no grounding)
- Without Loop 2: Loop 1's search strategy doesn't evolve (regression tests prevent re-discovery, but search doesn't generalize)
- Without Loop 3: Loops 1 and 2 are bottlenecked by manual execution (no scaling)

The convergence is monotonic: each triple-cycle produces a system that is:
- Harder to exploit (Loop 1)
- Better understood (Loop 2)
- Faster to improve (Loop 3)

**Caveat**: Monotonicity is enforced by the regression test suite, not inherent. A fix CAN introduce new bugs — the tests catch that. Without running the test suite after every fix, monotonicity does not hold. The first attempt at the null player fix broke efficiency; the tests caught it immediately.

---

## Implementation Checklist

For any new project, implement TRP by:

- [ ] **L0 Memory Tiers**: HOT/WARM/COLD persistent memory with structured frontmatter
- [ ] **L0 Session Compression**: Block headers, not full transcripts
- [ ] **L0 Pruning Protocol**: Remove stale, merge redundant, keep load-bearing
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
| Adversarial runs | ~430 per cycle (seed-dependent) |
| Issues found by automated testing | 1 genuine bug (null player dust), 1 design limitation (sybil floor), 1 behavior documented (scarcity boundary) |
| Bugs fixed by Loop 1 | 1 (null player dust — contract + reference model updated in lockstep) |
| Findings documented by Loop 2 | 6 |
| Tools built by Loop 3 | 7 (reference model, adversarial search, vector generator, replay tests, conservation tests, coverage matrix, test runner) |

---

## License

This protocol is public domain. Use it, extend it, improve it. If the three loops work for us, they'll work for anyone building mechanism-heavy systems with AI assistance.

> "The true mind can weather all lies and illusions without being lost."
> — The Lion Turtle

---

## See Also

- [TRP Explained](../../_meta/trp-existing/TRP-EXPLAINED.md) — Accessible introduction to TRP's three recursions
- [TRP Runner Protocol](../../_meta/trp-existing/TRP_RUNNER.md) — Execution protocol with crash mitigation
- [TRP Runner Paper](../../research/papers/trp-runner/trp-runner-paper.md) — Academic treatment of crash-resilient recursive improvement
- [Loop 0: Token Density](../../_meta/trp-existing/loop-0-token-density.md) — Context compression recursion
- [Loop 1: Adversarial Verification](../../_meta/trp-existing/loop-1-adversarial-verification.md) — Code review recursion
- [Loop 2: Common Knowledge](../../_meta/trp-existing/loop-2-common-knowledge.md) — Knowledge extraction recursion
- [Loop 3: Capability Bootstrap](../../_meta/trp-existing/loop-3-capability-bootstrap.md) — Tool-building recursion
- [Efficiency Heat Map](../../_meta/trp-existing/efficiency-heatmap.md) — Per-contract discovery yield tracking
- [TRP Verification Report](../../_meta/trp/TRP_VERIFICATION_REPORT.md) — Anti-hallucination audit of TRP claims
- [TRP Empirical RSI (paper)](../../research/papers/trp-empirical-rsi.md) — 53-round empirical evidence for LLM RSI
- [TRP Pattern Taxonomy (paper)](../../research/papers/trp-pattern-taxonomy.md) — 12 recurring vulnerability patterns
- [TRP (DOCUMENTATION copy)](../DOCUMENTATION/TRINITY_RECURSION_PROTOCOL.md) — Canonical copy in DOCUMENTATION/ <!-- FIXME: ../DOCUMENTATION/TRINITY_RECURSION_PROTOCOL.md — multiple candidates: docs/concepts/ai-native/TRINITY_RECURSION_PROTOCOL.md, NOTE: auto-repair would self-link -->
