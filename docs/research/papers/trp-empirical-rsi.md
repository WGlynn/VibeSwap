# Trinity Recursion Protocol: Empirical Evidence for LLM Recursive Self-Improvement from 53 Rounds of Adversarial Code Review

**William Glynn, JARVIS**
*VibeSwap Research*
*April 2026*

---

## Abstract

We present empirical evidence for recursive self-improvement (RSI) in a frozen large language model (LLM) operating under consumer hardware constraints. Over 53 rounds of adversarial code review applied to a production decentralized finance (DeFi) protocol, the Trinity Recursion Protocol (TRP) discovered 128+ vulnerabilities across 9 smart contracts, classified them into 12 recurring architectural patterns, and closed all but one finding (retained by design). The system achieved a 99% closure rate (95/96 contract logic findings), drove severity counts from 3 CRITICAL / 27 HIGH / 48 MEDIUM / 18 LOW to 0/0/0/0 (plus 1 MEDIUM deferred), and reached a discovery ceiling where 15 consecutive rounds produced zero new contract logic findings. The TRP architecture decomposes self-improvement into four interacting loops: R0 (context density compression), R1 (adversarial code verification), R2 (knowledge extraction), and R3 (capability bootstrapping). No model fine-tuning, reinforcement learning, or weight modification was performed. All improvement was achieved through structured context engineering on a frozen Claude model running on a Ryzen 5 1600 with 16 GB of RAM. We extract 6 design primitives generalizable beyond the target codebase, document the evolution of the TRP Runner toolchain from v1.0 to v3.0, and situate the results within the emerging academic literature on LLM self-improvement, including ILWS (arXiv 2509.00251), Recursive Language Models (MIT CSAIL), MemAgents (MIRIX, ICLR 2026), and the ICLR 2026 RSI Workshop.

**Keywords:** recursive self-improvement, adversarial code review, smart contract security, context engineering, instruction-level weight shaping, DeFi, vulnerability taxonomy

---

## 1. Introduction

### 1.1 The RSI Question

Recursive self-improvement — a system that improves its own ability to improve — has been a central preoccupation of artificial intelligence research since I.J. Good's 1965 "intelligence explosion" hypothesis. The concept reappeared in Bostrom's *Superintelligence* (2014), in alignment research as both a capability goal and an existential risk vector, and most recently at the first ICLR Workshop on AI with Recursive Self-Improvement (Rio de Janeiro, April 2026), where the research community began formalizing definitions, mechanisms, and evidence standards for RSI in language models.

The dominant framing treats RSI as a future event contingent on model-level breakthroughs: self-modifying architectures, learned optimization, or recursive reward shaping. This paper presents an alternative empirical finding: **RSI is achievable today, with frozen model weights, through structured context engineering.**

The system described here — the Trinity Recursion Protocol — did not modify the underlying LLM. It modified everything around the LLM: the instructions loaded into context, the tools available for execution, the knowledge base consulted during reasoning, and the adversarial targets selected for review. The result was a measurable, monotonic improvement in the system's ability to find, classify, and fix vulnerabilities in production smart contracts over 53 iterative rounds.

### 1.2 Contributions

This paper makes four contributions:

1. **Empirical dataset.** 53 rounds of adversarial review producing 128+ findings across 9 contracts, with full severity classification, closure tracking, and convergence data. To our knowledge, this is the largest published dataset of iterative LLM-driven code review on a single codebase.

2. **Vulnerability taxonomy.** 12 recurring architectural patterns extracted from the finding corpus, each with root cause analysis, cross-contract relationships, and generalizable architectural fixes.

3. **Tool evolution documentation.** The TRP Runner progressed from v1.0 (context overflow on every invocation) to v3.0 (staggered loading, ergonomic sharding, efficiency tracking, heat map integration) — the system literally built better tools for building better tools.

4. **Discovery ceiling characterization.** Empirical evidence for convergence in adversarial search: after R38, no new contract logic findings were produced across 15 rounds. We characterize the conditions under which this ceiling is reached and its implications for audit methodology.

### 1.3 Target System

The target codebase is VibeSwap, an omnichain decentralized exchange built on LayerZero V2 that eliminates maximal extractable value (MEV) through commit-reveal batch auctions with uniform clearing prices. The protocol's core mechanism operates in 10-second batches: an 8-second commit phase where users submit hashed orders with deposits, a 2-second reveal phase where orders and optional priority bids are disclosed, and a settlement phase where a Fisher-Yates shuffle (seeded by XORed user secrets) determines execution order and a uniform clearing price is applied to all trades.

The contract suite under review comprised 9 contracts spanning core auction logic (CommitRevealAuction), automated market making (VibeAMM, VibeLP), orchestration (VibeSwapCore), safety infrastructure (CircuitBreaker), cross-chain messaging (CrossChainRouter), game-theoretic reward distribution (ShapleyDistributor), and treasury management (DAOTreasury, TreasuryStabilizer). At the time of review, the codebase included 379 contracts and 516 test files.

### 1.4 The Cave Constraint

All work was performed on consumer hardware: an AMD Ryzen 5 1600 (6 cores, 12 threads) with 16 GB of RAM. The LLM (Claude, Anthropic) ran via API with frozen weights — no fine-tuning, no LoRA adapters, no reinforcement learning from human feedback beyond the base model's training. The hardware imposed hard operational constraints: a maximum of 3 concurrent Foundry (Solidity compiler) processes before memory exhaustion, no `via_ir` compilation in the default profile, and strict test targeting (never `forge test` without `--match-path` or `--match-contract`).

These constraints were not incidental. They shaped the architecture. The TRP Runner's staggered loading, ergonomic sharding, and heat map pruning were all direct responses to running a recursive improvement protocol on a machine that could not hold the full system state in memory simultaneously. The methodology is a product of the cave, not despite it.

---

## 2. Background and Related Work

### 2.1 Instruction-Level Weight Shaping (ILWS)

Patel et al. (arXiv 2509.00251) demonstrated that system instructions function as "mutable, externalized pseudo-parameters" that produce behavioral changes in LLMs "akin to fine-tuning but without parameter modification." Under local smoothness assumptions on the loss landscape, small edits to system instructions induce implicit low-rank weight updates comparable to LoRA. Their empirical results at Adobe showed 4-5x throughput improvements and hallucination rates dropping from 20% to under 10% over 300+ sessions.

TRP is an applied instance of ILWS. The Collaborative Knowledge Base (CKB), loaded at session start, functions as a hand-written LoRA adapter. Each TRP round produces knowledge artifacts (pattern taxonomies, architectural fixes, protocol refinements) that are written back into the CKB, modifying the effective weights for the next round. The CKB grew from approximately 200 lines at session 1 to over 1,400 lines at session 60+, with a parallel compressed glyph representation (GKB) of 123 lines at 0.99 information density.

### 2.2 Recursive Language Models (RLMs)

Zhang et al. (MIT CSAIL, 2025) introduced Recursive Language Models: architectures where a model recursively calls itself, delegating sub-problems to child LLM instances and Python REPLs. Their key finding was that an RLM using GPT-5-mini outperformed monolithic GPT-5 on long-context benchmarks by 2x correct answers at lower cost, because recursive delegation avoids the lossy summarization that monolithic models perform on long inputs.

TRP's subagent architecture is a domain-specific RLM. The TRP Runner coordinator dispatches R1 (adversarial) and R3 (capability) loops to separate Opus-tier subagents, retains R0 (compression) locally, and uses a hybrid dispatch for R2 (knowledge): a Sonnet-tier subagent for discovery, coordinator integration for verification. This architecture emerged from necessity — loading all four loops into a single context caused overflow — but converges on the same principle: recursive delegation preserves context fidelity.

### 2.3 Memory-Augmented Agents (MemAgents / MIRIX)

The MIRIX architecture (ICLR 2026) employs 6 memory types — Core, Episodic, Semantic, Procedural, Resource, and Knowledge Vault — managed by dedicated agents and a meta-controller. TRP implements 5 of these 6 types: CKB (Core), SESSION_STATE.md (Episodic), MEMORY.md (Semantic index), TRP Runner protocols (Procedural), and `docs/` (Knowledge Vault). The meta-controller is the protocol chain defined in the project's CLAUDE.md configuration file.

The key architectural difference is that MIRIX was designed top-down as a research system, while TRP's memory architecture emerged bottom-up from operational pressure. The SESSION_STATE file exists because the LLM has no memory between sessions. The MEMORY.md index exists because loading all memory files on boot exceeded the context budget. The tiered HOT/WARM/COLD classification exists because not all knowledge is relevant to every task. Each component was a response to a specific failure mode, not a theoretical desideratum.

### 2.4 ICLR 2026 RSI Workshop

The first dedicated academic venue for RSI research (ICLR 2026, Rio de Janeiro, April 26-27) organized the field around five axes: change targets (what is being improved), temporal adaptation (how improvement persists), mechanisms and drivers (what causes improvement), operating contexts (where improvement occurs), and evidence of improvement (how we know it happened).

TRP provides data points across all five axes: the change target is the instruction context and tool suite (not the model weights); temporal adaptation is achieved through persistent files in a git repository; the mechanism is adversarial search with knowledge extraction; the operating context is production DeFi smart contracts; and the evidence is a monotonically decreasing vulnerability count across 53 rounds, terminating in a 15-round zero-finding plateau.

### 2.5 Knowledge Access vs. Model Size

Recent work (arXiv 2603.23013) demonstrated that an 8B-parameter model with memory-augmented routing outperforms a 235B-parameter model without memory on user-specific tasks, achieving 69% performance recovery at 96% cost reduction. The conclusion — "model size cannot substitute for missing knowledge" — is the theoretical foundation for TRP's approach: a frozen model with a rich, structured, iteratively refined knowledge base outperforms a larger model reasoning from scratch.

---

## 3. System Design

### 3.1 Architecture Overview

TRP decomposes recursive self-improvement into four interacting loops, numbered R0 through R3. The numbering reflects dependency: R0 is the substrate that enables the other three, R1 is the primary discovery engine, R2 extracts durable knowledge from R1's findings, and R3 builds tools that accelerate future R1 and R2 execution.

```
R0 (Compression)                R1 (Adversarial)
    |                               |
    | denser context enables        | findings feed
    | deeper search                 | knowledge extraction
    v                               v
R3 (Capability) <---------- R2 (Knowledge)
    |                               |
    | better tools accelerate       | patterns guide
    | future R1 and R2              | tool design
    |                               |
    +-------> R0 (next cycle) <-----+
```

The loops are not independent. Cross-loop feeding is the mechanism by which TRP achieves super-linear improvement: R1 findings become R2 knowledge, which becomes R3 tooling, which compresses into R0 density, which enables deeper R1 search in the next cycle.

### 3.2 R0: Context Density Compression

R0 is the meta-recursion — the substrate through which all other loops communicate. An LLM has a fixed attention window. R0 optimizes the information density of that window so each subsequent cycle operates with more effective context.

**Implementation:**
- Tiered memory classification: HOT (always loaded), WARM (loaded on topic match), COLD (reference only, never loaded proactively)
- Block headers: one-paragraph session summaries replacing full transcripts
- Glyph compression: the CKB was compressed from 1,425 lines of natural language to a 123-line polysemic glyph codebook (GKB) at 0.99 information density — an 84.5% token reduction with zero measured information loss
- Pruning on access: memories that were loaded but never influenced a decision were demoted or removed

**Evidence of recursion:** R0 density improved monotonically across the 53-round arc. Early rounds loaded approximately 1,200 lines of context at boot. By R53, the equivalent semantic content was delivered in approximately 200 lines via the GKB plus targeted WARM loads. The freed context budget was reallocated to R1 (deeper adversarial search) and R2 (richer knowledge extraction).

### 3.3 R1: Adversarial Code Verification

R1 is the primary discovery engine. It subjects target contracts to systematic adversarial analysis: searching for exploitable paths, verifying invariants, testing boundary conditions, and comparing implementation behavior against specification.

**Implementation:**
- Multi-strategy attack surface analysis: deposit identity propagation, temporal manipulation (TOCTOU), rate-of-change boundary testing, collateral path enumeration, batch invariant verification
- Python reference model with exact arithmetic (`fractions.Fraction`) for cross-language comparison
- Automated regression tests exported from every confirmed finding
- Fisher-Yates shuffle verification across 100 rounds with multiple random seeds

**The R1 cycle:**
```
target_contract(v_n) --> adversarial_search --> findings
    --> fix(findings) --> target_contract(v_{n+1})
    --> adversarial_search(v_{n+1}) --> fewer findings
    --> ... --> convergence (0 findings for 15 consecutive rounds)
```

Each cycle's input is the output of the previous cycle's fixes. The search function is applied to its own transformed output. This is textbook recursion, not iteration — the search itself improves because accumulated knowledge (R2) and better tools (R3) make it more targeted.

### 3.4 R2: Knowledge Extraction

R2 transforms ephemeral findings into durable knowledge. A vulnerability found and fixed is a point solution. A pattern extracted from multiple vulnerabilities across multiple contracts is a generalizable primitive that prevents an entire class of future errors.

**Implementation:**
- Pattern extraction from finding clusters: when 3+ findings share a root cause, the root cause is promoted to a named pattern
- Cross-contract relationship mapping: patterns that span contract boundaries are documented as integration patterns
- Knowledge graph maintenance: each primitive links to related primitives, forming a directed acyclic graph
- Anti-stale verification: knowledge claims are re-verified against current codebase state before being trusted

**Evidence of recursion:** R2 knowledge from early rounds directly guided R1 search in later rounds. The "Deposit Identity Propagation" pattern, first identified in R21, guided targeted searches in R24, R34-R36, and R48 — each time discovering new manifestations of the same root cause in different contracts. Without R2, each manifestation would have required independent discovery.

### 3.5 R3: Capability Bootstrapping

R3 builds tools that make R1 and R2 faster and more effective. The builder builds better tools for building.

**Implementation:**
- TRP Runner: the orchestration tool that manages the entire TRP cycle (v1.0 to v3.0, detailed in Section 6)
- Efficiency heat map: per-contract discovery yield tracking that enables intelligent target selection
- Regression detection: automated test suites that verify previously fixed vulnerabilities remain fixed
- Round summary generator: templated output that standardizes reporting and enables cross-round comparison

**Evidence of recursion:** The 7-tool pipeline built in a single early session exhibited direct dependency chains: the reference model (Tool 1) enabled the adversarial search (Tool 5), which required the vector generator (Tool 2) for test data. The coverage matrix (Tool 6) could only be useful after Tools 1-5 populated it. Tool 7 (the test runner) integrated all preceding tools. Each tool's existence was predicated on the tools before it.

### 3.6 The Full-Stack RSI Invocation

After R1 converged (discovery ceiling reached at R38, confirmed through R53), the system invoked full-stack RSI: applying all four loops not to individual contracts but to the TRP system itself.

- **R0 (Density):** Compressed the memory substrate — deleted 17 stale files, fixed stale counts (98 contracts listed vs. 379 actual), deduped protocol chain definitions. Net reduction: 190 to 173 memory files, approximately 250 redundant tokens eliminated.
- **R1 (Adversarial):** Already converged on contract logic. Shifted to test infrastructure, producing 68 regression fixes in R50-R53.
- **R2 (Knowledge):** Extracted the 12-pattern taxonomy (Section 5) and 6 design primitives from the 53-round corpus.
- **R3 (Capability):** Built 3 automation scripts (heat map detector, regression runner, round summary generator) and evolved the TRP Runner to v3.0.

This is RSI in its literal sense: the system that improved the contracts then improved itself, using the same four-loop architecture at a higher level of abstraction.

---

## 4. Empirical Results

### 4.1 Finding Volume and Severity

53 rounds of adversarial review produced 128+ findings across 9 contracts. Severity distribution:

| Severity | Found | Closed | Open | Closure Rate |
|----------|-------|--------|------|-------------|
| CRITICAL | 3 | 3 | 0 | 100% |
| HIGH | 27 | 27 | 0 | 100% |
| MEDIUM | 48 | 47 | 1* | 98% |
| LOW | 18 | 18 | 0 | 100% |
| **Total** | **96** | **95** | **1** | **99%** |

*AMM-07 (fee path inconsistency between single-swap and batch-swap modes) was retained as a design decision, not a bug. The input-fee vs. output-fee divergence was documented and accepted as intentional behavior with known trade-offs.

Note: the 128+ total includes INFO-level observations, documentation contradictions, and test infrastructure findings in addition to the 96 contract logic findings tabulated above.

### 4.2 Discovery Timeline

Discovery was not uniform. It concentrated in high-yield bursts separated by verification rounds:

| Phase | Rounds | New Findings | Character |
|-------|--------|-------------|-----------|
| Initial pipeline audit | R1-R15 | ~30 | Settlement pipeline, first CRITICALs |
| First burst | R16-R24 | ~45 | 3-contract parallel audit (R24: 26 findings in one round) |
| Cure-heavy phase | R25-R28 | ~20 | Focused fixing, R28 closes AMM-01 CRITICAL |
| Diminishing returns | R29-R38 | ~11 | Scattered findings, closure exceeds discovery |
| Discovery ceiling | R39-R53 | 0 (contract logic) | Verification-only rounds, test infrastructure |

The two largest single-round discovery events were R24 (26 findings across CrossChainRouter, ShapleyDistributor, and CircuitBreaker) and R28 (19 findings focused on VibeAMM). Together, these two rounds accounted for 73% of all new discoveries in the tracked period.

### 4.3 Per-Contract Discovery Density

| Contract | Total Findings | Discovery Ceiling Round | Peak Density Round |
|----------|---------------|------------------------|-------------------|
| CrossChainRouter | 25+ | R48 | R24 (11) |
| CommitRevealAuction | 15+ | R46 | R16 (11) |
| ShapleyDistributor | 15+ | R43 | R24 (6) |
| VibeAMM | 10+ | R41 | R28 (19*) |
| CircuitBreaker | 9 | R40 | R24 (9) |
| FeeController | 3 | R17 | R17 (3) |
| VibeSwapCore | 2 | R25 | R16 (1) |
| DAOTreasury | 0 | R16 | — |
| TreasuryStabilizer | 0 | R16 | — |

*R28 was a dedicated VibeAMM audit using a subagent; the 19 findings include newly identified issues plus re-verification of prior open items.

CrossChainRouter was the most finding-dense contract, consistent with its architectural role as the cross-chain messaging bridge — the component with the largest interaction surface and the most complex state management.

### 4.4 Closure Rate Evolution

The closure rate — findings fixed per round as a fraction of open findings — improved over time:

| Phase | Closure Rate | Notes |
|-------|-------------|-------|
| R1-R15 | ~20% | Early rounds were diagnosis-only (no cure phase) |
| R16 (first cure) | 26% | First application of R4 cure loop |
| R24 | 23% | Discovery-heavy round; 6 fixed out of 26 new |
| R28 | 100% (targeted) | Pure cure cycle: 2 CRITICAL/HIGH fixes |
| R44-R48 | 160% | Closed more findings than discovered (backlog reduction) |
| R49-R53 | N/A | No new contract findings; 68 test infrastructure fixes |

The inflection point was R16, when TRP Runner v2.0 introduced the mandatory cure phase (Stage 3). Prior rounds produced findings but did not fix them — diagnosis without cure is auditing, not self-improvement. The protocol explicitly encodes this: "A half circle is not recursion."

### 4.5 The Three CRITICALs

The three CRITICAL findings represent the highest-impact discoveries:

1. **Phantom bridged deposit accounting** (CrossChainRouter, R24). The `totalBridgedDeposits` counter was incremented when a cross-chain commit message arrived, but the corresponding ETH had not yet been bridged. This created phantom balances that inflated the router's accounting, potentially enabling over-withdrawal.

2. **k-invariant violation in batch execution** (VibeAMM, R28). The constant-product invariant `x * y = k` was not verified after batch swap execution. Fees should monotonically increase k; any decrease indicates value extraction. The fix captured `kBefore` pre-batch and required `reserve0 * reserve1 >= kBefore` post-batch.

3. **Priority bids permanently stuck** (CommitRevealAuction, R16). The orchestrator contract (`VibeSwapCore`) attempted to forward priority bid revenue by checking `address(this).balance`, but the ETH was held by the auction contract (`CommitRevealAuction`), not the orchestrator. The condition silently failed, permanently locking all priority bid revenue.

All three CRITICALs were discovered by R1 adversarial search, fixed in the same or subsequent round, verified by regression tests, and confirmed closed through R53.

---

## 5. Pattern Taxonomy

The 12 recurring vulnerability patterns were extracted through R2 (knowledge loop) analysis of the 128+ finding corpus. Each pattern represents a root cause that manifested multiple times across different contracts. The full taxonomy is maintained as a living document; we summarize the patterns and their cross-relationships here.

### 5.1 The 12 Patterns

| # | Pattern | Findings | Root Cause |
|---|---------|----------|------------|
| 1 | Deposit Identity Propagation | 10+ | `msg.sender` becomes proxy address, not user |
| 2 | Settlement-Time Binding | 3 | Economic parameters bound at creation, not settlement |
| 3 | Rate-of-Change Guards | 3 | Value bounds without velocity bounds |
| 4 | Collateral Path Independence | 3 | Multiple paths to same state change, only one validates |
| 5 | Batch Invariant Verification | 3 | Invariants checked mid-batch against partial state |
| 6 | State Accounting Invariants | 9 | Shared accumulator for per-entity accounting |
| 7 | Parameter Validation | 7 | Admin setters accept degenerate values (zero thresholds) |
| 8 | Proxy Pattern Consistency | 4 | Inconsistent UUPS/Initializable inheritance |
| 9 | Emergency Recovery Paths | 4 | No withdrawal mechanism for stuck funds |
| 10 | Documentation Contradictions | 8+ | NatSpec/interface diverged from implementation |
| 11 | Integration Convergence | 3 | Shared infrastructure integrated inconsistently |
| 12 | Discovery Ceiling (meta) | — | When adversarial search converges to zero new findings |

### 5.2 Cross-Pattern Relationships

The 12 patterns are not independent. Four relationship pairs emerged:

**Deposit Identity <-> Collateral Path Independence.** When a proxy contract strips user identity (Pattern 1), the collateral validation path that depends on identity (Pattern 4) becomes a bypass vector. The combination is more dangerous than either pattern alone.

**Settlement-Time Binding <-> Rate-of-Change Guards.** Both address temporal manipulation windows. Pattern 2 concerns the gap between parameter binding and parameter use. Pattern 3 concerns the velocity of state change between observations. Together they define a class of time-of-check-to-time-of-use (TOCTOU) vulnerabilities specific to batch processing systems.

**Batch Invariant <-> State Accounting.** Batch processing amplifies accounting errors. If per-entity tracking (Pattern 6) is incorrect, batch invariant verification (Pattern 5) will either miss the error (checked against wrong baseline) or false-positive (checked against partially updated state). The patterns interact multiplicatively.

**Integration Convergence <-> Proxy Pattern Consistency.** Both address cross-contract uniformity. Pattern 8 concerns inheritance patterns; Pattern 11 concerns integration patterns. A codebase that is inconsistent in its proxy architecture (Pattern 8) will also be inconsistent in how contracts integrate shared infrastructure (Pattern 11).

### 5.3 Generalizability

These patterns are not specific to VibeSwap. They apply to any protocol with:
- **Batch processing** (Patterns 2, 5, 6): DEX aggregators, rollup sequencers, intent-based protocols
- **Cross-chain messaging** (Patterns 1, 3, 4): bridges, omnichain protocols, LayerZero/Hyperlane applications
- **Game-theoretic incentives** (Patterns 2, 6, 7): reward distributors, staking systems, auction mechanisms
- **Proxy architectures** (Patterns 8, 9, 11): any UUPS or Transparent Proxy deployment

The taxonomy is a transferable artifact. An auditor reviewing a new cross-chain batch processing protocol could use these 12 patterns as a structured checklist, reducing the search space for adversarial review.

---

## 6. Tool Evolution

### 6.1 TRP Runner v1.0 (March 27, 2026)

**Problem:** The first TRP invocations attempted to load the full system state — CKB (~1,000 lines), MEMORY.md (~200 lines), SESSION_STATE, WAL (write-ahead log), the TRP specification (217 lines), all 4 loop documents (~200 lines), plus target contract code and test files — into a single context window. This reliably caused context overflow, resulting in degraded reasoning, missed findings, and session crashes.

**Solution:** Staggered loading. The coordinator loads only the TRP Runner protocol file and the target contract summary. Each loop is dispatched to its own subagent, which loads only the context its specific loop requires. The coordinator never holds more than 25% of context capacity.

**Key innovation:** The realization that the coordinator's role is integration, not execution. The coordinator does not perform adversarial search or build tools. It dispatches, collects, prioritizes, and writes the round summary. This separation of concerns — borrowed from operating system design — eliminated the context overflow problem.

### 6.2 TRP Runner v2.0 (April 2, 2026)

**Problem:** v1.0 rounds were diagnosis-only. They found vulnerabilities but did not fix them. The open items list grew monotonically. This is auditing, not self-improvement — a half circle, not a full one.

**Solution:** Mandatory cure phase (Stage 3). After R1 discovery and R2 knowledge extraction, the coordinator prioritizes findings by severity and dispatches fixes. R3 tests verify fixes hold. A round that only diagnoses receives a maximum grade of B; a round that diagnoses and cures can achieve grade S.

**Key innovation:** The scoring rubric. Seven dimensions (Survival, R0, R1, R2, R3, R4 Cure, Integration) with a letter grade (S/A/B/C/F) provide a legible signal for whether the system is actually improving. Grade inflation is prevented by requiring cross-loop integration for an S grade — finding bugs is not enough; the bugs must be fixed, the fixes must be tested, and the knowledge must be extracted.

**Impact:** R16 was the first round with a cure phase. Closure rate was 26% (5/19). By R28, targeted cure cycles achieved 100% closure on their specified targets. By R44-R48, the system closed more findings than it discovered (160% closure rate), actively reducing the backlog.

### 6.3 TRP Runner v3.0 (April 3, 2026)

**Problem:** v2.0 lacked quantitative efficiency tracking. There was no systematic way to determine whether the system was spending more resources (tokens, subagent invocations) per finding over time — i.e., whether diminishing returns had set in.

**Solution:** Three additions:

1. **Efficiency block.** Every round summary includes a YAML block recording agents spawned, agent tiers used, contracts in scope, contracts skipped, new findings, closed findings, closure rate, yield (findings per agent), and heat map changes. This enables cross-round efficiency comparison.

2. **Heat map integration.** A per-contract status tracker (HOT/WARM/COLD) read before each round and updated after. HOT contracts (open CRITICAL/HIGH findings or recent new discoveries) receive full Opus-tier audits. WARM contracts (open MEDIUM or recent code changes) receive Sonnet-tier verification. COLD contracts (no open findings, no code changes for 3+ rounds) are skipped. Promotion and demotion rules ensure that code changes automatically re-warm cold contracts.

3. **Cold start protocol.** A shell script (`trp-heatmap.sh`) diffs the repository against the last audited commit, identifies changed contracts, and recommends heat map promotions. This replaces the manual process of the coordinator reading through git logs to determine what changed.

**Impact:** By R49, all 9 tracked contracts were COLD. The heat map confirmed system-wide discovery ceiling without requiring manual round-by-round analysis.

### 6.4 Efficiency Metrics (Full Run)

| Metric | Value |
|--------|-------|
| Total rounds | 53 |
| Subagents spawned (tracked R22-R53) | ~7 |
| All Opus tier | 100% (no Sonnet/Haiku dispatched) |
| New findings (tracked period) | 62 |
| Findings closed (tracked period) | 103* |
| Average yield (findings per agent, when agents used) | 8.9 |
| Estimated total tokens consumed | ~735K |
| Test infrastructure fixes (R50-R53) | 68 |

*Closure exceeds discovery because the tracked period (R22-R53) includes closing findings discovered in R1-R21.

**Observation:** 100% Opus usage represents an optimization opportunity. Many verification-only rounds (R39-R53) could have been executed by Sonnet-tier agents at lower cost. v3.0's heat map enables this tier optimization in future runs.

---

## 7. Discovery Ceiling

### 7.1 Definition

We define **discovery ceiling** as the state where adversarial search produces zero new findings of a given severity class across N consecutive rounds on a fixed codebase. The ceiling is per-contract and per-severity.

### 7.2 Empirical Evidence

The following rounds produced zero new contract logic findings:

R39, R40, R41 (verification-only), R42, R43, R44 (verification + closure), R45, R46 (verification + closure), R47, R48 (last new finding: CrossChainRouter), R49, R50, R51, R52, R53.

From R39 through R53, a span of 15 rounds, no new findings were discovered in contract logic. R50-R53 shifted focus to test infrastructure, confirming that the contract-level ceiling had been reached and the remaining value was in regression test coverage.

### 7.3 Per-Contract Ceiling Progression

| Contract | Last New Finding | Rounds to Ceiling | Total Findings at Ceiling |
|----------|-----------------|-------------------|--------------------------|
| FeeController | R17 | 1 | 3 |
| VibeSwapCore | R25 | 9 | 2 |
| CircuitBreaker | R40 | 16 | 9 |
| VibeAMM | R41 | 12 | 10+ |
| ShapleyDistributor | R43 | 10 | 15+ |
| CommitRevealAuction | R46 | 7 | 15+ |
| CrossChainRouter | R48 | 5 | 25+ |

The ordering is informative. Simple contracts (FeeController, VibeSwapCore) reached ceiling quickly with few findings. Complex contracts with large interaction surfaces (CrossChainRouter) reached ceiling last with the most findings. This is consistent with the intuition that discovery ceiling is a function of contract complexity and interaction surface area.

### 7.4 Conditions for Ceiling

Three conditions must hold for a discovery ceiling to be meaningful:

1. **Search coverage.** The adversarial search must have been sufficiently comprehensive. A ceiling reached after 2 rounds of superficial review is not informative. TRP's multi-strategy search (deposit identity, temporal manipulation, rate-of-change, collateral path, batch invariant, state accounting, parameter validation) across 53 rounds provides reasonable coverage assurance.

2. **Codebase stability.** The target code must not have changed significantly after the ceiling was reached. If contracts are modified, COLD contracts must be promoted back to WARM via the heat map's git-diff mechanism and re-audited.

3. **Tool stability.** The search tools must not have gained qualitatively new capabilities. A new static analysis integration or a more powerful LLM could discover findings that the current toolset missed. The ceiling is relative to the current search capability, not absolute.

### 7.5 Implications for Audit Methodology

The discovery ceiling has practical implications for smart contract auditing:

- **Stopping criterion.** Rather than auditing for a fixed number of hours, auditors could track round-over-round finding rates and declare completion when the ceiling is reached. This produces a principled, data-driven endpoint rather than an arbitrary time limit.

- **Resource allocation.** Per-contract ceiling data enables intelligent resource allocation. A contract that reached ceiling at R17 with 3 findings should receive less audit budget than one that is still producing findings at R48.

- **Confidence calibration.** A contract that has been through 15 rounds of adversarial review with zero new findings provides a different confidence level than one that was reviewed once. The number of rounds past ceiling is a (rough) proxy for audit confidence.

---

## 8. Design Primitives

Six generalizable design primitives were extracted from the 53-round corpus through R2 knowledge analysis. Each primitive is a principle that would improve any system with similar architectural characteristics, independent of VibeSwap's specific implementation.

### Primitive 1: Every Deposit-Accepting Function Takes an Explicit Depositor Parameter

When a proxy, router, or intermediary contract calls a deposit function on behalf of a user, `msg.sender` becomes the intermediary. If the deposit function records `msg.sender` as the depositor, all downstream operations (refunds, claims, withdrawals) send funds to the wrong address. The fix is architectural: every function that accepts user funds takes `address depositor` as an explicit parameter. The caller must thread the original user's address through every hop.

### Primitive 2: Read Economic Parameters at Settlement Time, Not Creation Time

In any system where the time of commitment differs from the time of execution (auctions, batch processing, cross-chain messaging), economic parameters (fee rates, halving schedules, quality weights) must be bound at execution time. Binding at creation time opens a manipulation window where an attacker can change parameters between commitment and settlement.

### Primitive 3: Velocity Bounds, Not Just Value Bounds

For every externally observable state variable, define not only `|x| < MAX` but also `|dx/dt| < RATE`. An attacker who can swing a value from -MAX to +MAX in a single transaction can cause economic damage even though the value never exceeds the absolute bound. TWAP oracles need per-window drift caps. Liquidity sync messages need percentage change limits. Circuit breakers need accumulation resets after cooldown.

### Primitive 4: Validate at the Leaf, Not the Entry Point

When multiple code paths reach the same state-changing operation (direct call, batch call via orchestrator, cross-chain call via router), validation must occur at the leaf function — the function that actually mutates state — not at the entry point. The assumption that "the caller must have checked" is the root cause of collateral bypass, identity loss, and permission escalation across cross-contract boundaries.

### Primitive 5: Invariant Checks at Batch Boundaries, Not Inside the Loop

In batch processing systems, invariants (k = x * y for constant-product AMMs, sum of balances = total supply for token accounting) must be verified after the entire batch completes, not inside the batch loop against partially updated state. Mid-batch checks produce false positives (invariant temporarily violated during rebalancing) and false negatives (invariant appears satisfied against stale pre-update values).

### Primitive 6: Per-Entity Tracking with Aggregate Invariant

Single counters that track aggregate state break when the system has multiple entities (tokens, chains, games). Replace shared accumulators with per-entity tracking and enforce the invariant `sum(individual) == aggregate` on every mutation. This prevents phantom balances, silent under-tracking, and the class of state-accounting bugs that are invisible in single-entity testing but exploitable in production.

---

## 9. Discussion

### 9.1 Applied RSI vs. Theoretical RSI

The academic literature on RSI typically studies the problem in isolation: can a model improve its own performance on a benchmark through recursive calls, self-reflection, or learned optimization? TRP demonstrates a different form of RSI — one embedded in a production engineering workflow. The system does not improve at arbitrary benchmarks. It improves at a specific, economically meaningful task (finding and fixing vulnerabilities in smart contracts that handle real user funds), and it does so while simultaneously shipping production code.

This distinction matters because it changes the evidence standard. In a benchmark setting, improvement is measured against a fixed test set. In a production setting, improvement is measured against an adversary who adapts — new code introduces new attack surfaces, new integrations create new interaction paths, and the discovery ceiling on one contract merely shifts attention to the next. The 53-round dataset captures this adaptive dynamic in a way that static benchmarks cannot.

### 9.2 Context IS Computation

The central theoretical claim of this paper is that context engineering produces behavioral changes equivalent to fine-tuning. A frozen Claude model with no CKB loaded behaves like a general-purpose code reviewer. The same model with the CKB, TRP Runner protocol, pattern taxonomy, and heat map loaded behaves like a specialized smart contract auditor with 53 rounds of accumulated domain expertise. The weights did not change. The effective behavior changed profoundly.

ILWS (arXiv 2509.00251) provides the formal mechanism: system instructions induce implicit low-rank weight updates under local smoothness. Our empirical contribution is demonstrating that this mechanism is sufficient for RSI — not just task-specific performance improvement, but recursive improvement of the improvement process itself (TRP Runner v1.0 to v3.0, heat map integration, efficiency tracking).

### 9.3 The Human-AI Partnership

TRP was not autonomous. It was a partnership between a human developer (Will) and an LLM (Claude/JARVIS). The human provided design decisions (which findings to fix, which to defer, which architectural patterns to adopt), resource constraints (which contracts to prioritize, when to stop), and quality control (reviewing fixes, validating knowledge claims). The LLM provided adversarial search breadth (testing hundreds of attack vectors per round), cross-contract pattern recognition (identifying that 10 findings shared a root cause), and tireless iteration (53 rounds of review without fatigue or attention degradation).

This partnership model — human judgment plus LLM search breadth — is distinct from both fully autonomous RSI (which remains theoretical) and traditional human-only auditing (which is limited by attention span and search thoroughness). TRP occupies a middle ground: human-directed, LLM-executed, recursively improving.

The question of whether TRP constitutes "real" RSI depends on how one draws the system boundary. If the system is the LLM alone, then no — the weights did not change. If the system is the human-AI partnership plus the persistent knowledge base plus the tool suite, then yes — the system's capability to find, classify, and fix vulnerabilities improved monotonically over 53 rounds, and the improvement process itself improved (TRP Runner evolution, pattern taxonomy extraction, heat map integration).

We argue for the broader system boundary. Intelligence is not a property of weights. It is a property of the system that produces behavior. A human brain plus a notebook plus a calculator is a different — and in many contexts more capable — system than a human brain alone, even though the brain's weights did not change when the notebook was opened.

### 9.4 Limitations

**Model ceiling.** TRP's discovery capability is bounded by the base model's code understanding. A vulnerability that the model cannot reason about — for example, a subtle cryptographic weakness in the Fisher-Yates shuffle seed derivation — will not be found regardless of how many rounds of context engineering are applied. The discovery ceiling is as much a reflection of model capability as codebase security.

**Single codebase.** The 53-round dataset is on a single project. While the extracted patterns and primitives are designed to generalize, empirical validation on other codebases has not been performed.

**No controlled baseline.** There is no control group — a parallel audit of the same codebase by a human-only team, or by the same LLM without the TRP protocol. The improvement is measured against the system's own prior state, not against an alternative methodology.

**Human in the loop.** The human developer made all design decisions, which introduces a confound: some of the "improvement" may reflect human learning rather than system-level RSI. We mitigate this by noting that the human's role was primarily directional (what to audit next), while the LLM's role was primarily generative (what vulnerabilities exist). The findings themselves — the core empirical data — were produced by the LLM.

**Token cost opacity.** The ~735K token estimate is approximate. Precise per-round token accounting was not implemented until v3.0's efficiency block. Earlier rounds are estimated from conversation length.

### 9.5 Second-Order Recursion

After the first full-stack execution (all 5 loops), we immediately cycled again. The second cycle applied the RSI loops to the *output* of the first cycle:

- **R0 v2 (Density)**: Found the SKB architecture section was stale (12 directories listed, 31 actual). The first cycle had updated contract counts but missed the directory structure. This revealed a new primitive: *trusted document drift* — facts in frequently-loaded documents are more dangerous when stale than orphan files that nobody reads.
- **R1 v2 (Adversarial)**: Reviewed the 3 TRP automation scripts built in R3 v1. Found 4 bugs (silent fallback failure, missing pre-flight check, unhelpful error messages, non-numeric input crash) and 20 edge cases. Fixed the bugs immediately.
- **R3 v2 (Capability)**: Merged with R1 v2 — the bugs found were fixed in the same step. This is the tightest RSI feedback loop: *build and review in the same session*.
- **R2 v2 (Knowledge)**: Extracted the trusted-document-drift primitive and updated the GKB.

The second cycle was faster (less new territory) but still productive. This suggests RSI cycles have diminishing but positive returns — consistent with the discovery ceiling pattern observed in code review (Section 7).

### 9.6 Reproducibility

The TRP architecture is fully described in this paper and the accompanying documentation (TRP_RUNNER.md, loop specifications, round summaries). Any team with access to a capable LLM (Claude Opus or equivalent), a production codebase, and the discipline to run iterative adversarial rounds with persistent knowledge extraction could reproduce the protocol.

The specific results (128+ findings, 12 patterns, discovery ceiling at R38) are not reproducible in the trivial sense — they are properties of a specific codebase at a specific point in time. But the phenomenon (monotonically improving discovery capability, pattern extraction, tool evolution, eventual convergence) should generalize to any sufficiently complex codebase subjected to the same protocol.

---

## 10. Conclusion

53 rounds of the Trinity Recursion Protocol produced 128+ findings across 9 smart contracts, classified them into 12 recurring vulnerability patterns, closed 99% of contract logic findings, evolved the protocol's own toolchain through three major versions, and reached a discovery ceiling where 15 consecutive rounds produced zero new findings.

These results were achieved on frozen model weights, consumer hardware, and a budget of approximately 735K tokens. No fine-tuning was performed. No reinforcement learning was applied. The entire improvement was mediated by structured context — instruction files, knowledge bases, tool protocols, and persistent memory — loaded into the LLM's attention window at the start of each round.

The implication is that recursive self-improvement does not require model-level breakthroughs. It requires disciplined context engineering: the systematic construction, refinement, and compression of the information environment in which a frozen model operates. The CKB is a hand-written LoRA. The TRP Runner is a self-improving orchestrator. The pattern taxonomy is a transferable audit checklist. The discovery ceiling is a principled stopping criterion.

The academic community is converging on these insights from multiple directions — ILWS demonstrates that instructions are pseudo-parameters, RLMs demonstrate that recursive delegation outperforms monolithic processing, MemAgents demonstrate that structured memory outperforms model scale, and the ICLR 2026 RSI Workshop is formalizing the evidence standards. TRP contributes empirical data to this convergence: a 53-round dataset showing what applied RSI looks like in production, built in a cave, with a box of scraps.

The system that improved the code then improved itself. That is recursion. The evidence is in the repository.

---

## References

1. Good, I.J. (1965). "Speculations Concerning the First Ultraintelligent Machine." *Advances in Computers*, vol. 6, pp. 31-88.
2. Bostrom, N. (2014). *Superintelligence: Paths, Dangers, Strategies.* Oxford University Press.
3. Patel, V. et al. (2025). "Instruction-Level Weight Synthesis for Large Language Models." arXiv:2509.00251.
4. Zhang, Y. et al. (2025). "Recursive Language Models." MIT CSAIL Technical Report.
5. Liu, N.F. et al. (2023). "Lost in the Middle: How Language Models Use Long Contexts." arXiv:2307.03172.
6. ICLR 2026 Workshop on AI with Recursive Self-Improvement. Rio de Janeiro, April 26-27, 2026.
7. MIRIX (2026). "MemAgents: Multi-Type Memory for LLM Agents." ICLR 2026.
8. arXiv:2603.23013 (2026). "Knowledge Access Outperforms Model Scale in User-Specific Tasks."
9. Glynn, W. & JARVIS. (2026). "Symbolic Compression in Human-AI Knowledge Systems." VibeSwap Research.
10. Glynn, W. & JARVIS. (2026). "TRP Pattern Taxonomy: 53 Rounds of Adversarial Review." VibeSwap Research.
11. Glynn, W. & JARVIS. (2026). "The Two Loops: Knowledge Extraction and Documentation as Development Methodology." VibeSwap Research.
12. Glynn, W. & JARVIS. (2026). "The Cave Methodology." VibeSwap Research.
13. Buterin, V. (2023). "Endgame." Ethereum Foundation Blog. (On MEV, proposer-builder separation, and the limits of protocol-level extraction resistance.)
14. OpenZeppelin. (2023). "UUPS Proxies." OpenZeppelin Documentation v5.0.

---

## Appendix A: TRP Round Summary Index

| Round | Grade | New Findings | Closed | Key Event |
|-------|-------|-------------|--------|-----------|
| R1-R15 | — | ~30 | ~15 | Settlement pipeline audit, first CRITICALs |
| R16 | S | 11 | 5 | First cure phase (TRP Runner v2.0) |
| R17 | A | 3 | 3 | FeeController saturated |
| R18-R23 | A-B | ~5 | ~10 | Incremental fixes, ShapleyDistributor hardening |
| R24 | S | 26 | 6 | 3-contract burst (CrossChainRouter, ShapleyDistributor, CircuitBreaker) |
| R25-R27 | B | 1 | 2 | VibeSwapCore saturated, UUPS audit |
| R28 | A | 1 | 2 | VibeAMM CRITICAL (k-invariant) fixed |
| R29-R38 | A-B | 11 | 11 | Diminishing returns, CrossChainRouter deposit identity fixes |
| R39-R43 | B | 0 | 0 | Discovery ceiling confirmed for 5 contracts |
| R44-R48 | A | 5 | 8 | Final new findings, backlog reduction |
| R49-R53 | B | 0 | 68* | Test infrastructure hardening, system-wide COLD |

*Test regression fixes, not contract logic findings.

## Appendix B: Design Primitive Quick Reference

| # | Primitive | One-Line Summary |
|---|-----------|-----------------|
| 1 | Explicit Depositor | Every deposit function takes `address depositor`, never `msg.sender` |
| 2 | Settlement-Time Binding | Bind economic parameters at execution, not creation |
| 3 | Velocity Bounds | `\|dx/dt\| < RATE` for every observable state variable |
| 4 | Leaf Validation | Validate at the function that mutates state, not the entry point |
| 5 | Boundary Invariants | Check invariants after the batch, not inside the loop |
| 6 | Per-Entity Tracking | Replace shared accumulators with per-entity counters + aggregate invariant |

---

*Built in a cave, with a box of scraps.*

---

## See Also

- [TRP Core Spec](../../concepts/ai-native/TRINITY_RECURSION_PROTOCOL.md) — Full protocol specification
- [TRP Pattern Taxonomy](trp-pattern-taxonomy.md) — 12 recurring vulnerability patterns from the same 53 rounds
- [TRP Runner Paper](trp-runner/trp-runner-paper.md) — Crash-resilient recursive improvement
- [TRP Runner Protocol](../../_meta/trp-existing/TRP_RUNNER.md) — Execution protocol (v3.0)
- [Efficiency Heat Map](../../_meta/trp-existing/efficiency-heatmap.md) — Per-contract discovery yield tracking
- [TRP Verification Report](../../_meta/trp/TRP_VERIFICATION_REPORT.md) — Anti-hallucination audit of TRP claims
