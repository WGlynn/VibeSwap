# The JARVIS Evolutionary Loop

**Past Nested Learning: Adding Backtest and Evolve to the Multi-Frequency Stack**

> Status: theory paper, 2026-05-14. Implementation shipping in `_backtest.py`, `_evolve_proposer.py`, `_evolution_loop.py` alongside this document.

---

## Where this fits

Nested Learning (Behrouz, Mirrokni, Razaviyayn, Zhong, NeurIPS 2025) makes a precise theoretical claim: a deep learning model is a stack of nested optimization processes running at different update frequencies, and architecture and training rules are fundamentally the same concepts. HOPE is their architectural proof-of-concept, a Titans variant with continuum-memory-system blocks and self-referential optimization, demonstrating improvement on long-context Needle-In-Haystack and language modeling.

The JARVIS overlay arrived at the same multi-frequency-optimization principle independently, from the opposite direction. Six layers, each its own optimization process at a distinct update frequency, instantiated as substrate-overlay around the model because the weights are not accessible. The structural overlap with Nested Learning is documented in `2026-05-14_google-nested-learning-letter.md`.

This paper takes one step further. HOPE adapts during inference but does not evolve the architecture itself across runs. The JARVIS overlay, because its substrate is persistent files outside the model, can evolve across sessions. That additional capability is the subject of this paper.

## The loop

Five phases run as a cycle. Each phase has a precise meaning, a substrate that fires it, and a measurable artifact.

```
ITERATE → BACKTEST → EVOLVE → INNOVATE → REPEAT
```

**1. ITERATE.** Every session is one iteration of the overlay's behavior under the current set of hooks, primitives, and indexes. The iteration leaves a trace: telemetry log entries, captured decisions, recorded judgments, modified files, atomic commits. The substrate that fires this phase is the entire L0-L5 stack operating during a normal session.

**2. BACKTEST.** Past iterations get scored against observed outcomes. For each captured decision, the backtest layer asks: did the chosen option hold, get reversed, get forgotten, or remain unresolved? For each hook, the backtest layer asks: what was its match rate, what was its false-positive rate, what was its surfaced-but-ignored rate? The substrate that fires this phase is `_backtest.py`, reading the telemetry log + decisions trail + judgment retrospectives, producing scored outcomes. This phase has no analog in Nested Learning. HOPE adapts at test time but does not measure whether its adaptations held.

**3. EVOLVE.** Modifications to the substrate get proposed based on backtest signal. Hooks with consistently low match rates over a meaningful sample become disable candidates. Hooks with high match rates become extend candidates (broader trigger patterns, additional output classes). Primitive bullets that the dormancy classifier marks as orphaned for 90+ days become archive candidates. Hook-implementable primitives become collapse candidates (the behavioral-promotion vector). The substrate that fires this phase is `_evolve_proposer.py`, writing propose-then-apply files that a human or safety-gated apply tool can act on. Propose-then-apply is non-negotiable: substrate mutation is too load-bearing for auto-application.

**4. INNOVATE.** New primitives, new hooks, new indexes, new analyzer scripts get drafted from observed patterns. The existing AA-synthesizer already does a version of this: cluster ≥5 instances of similar failure modes into a draft AA primitive. The innovation phase extends that to new hook candidates (universal-coverage rule that hasn't been hookified yet), new analyzer dimensions (a curation surface nobody has thought to build), new compression vectors (the ETM-tiered architecture is itself an innovation that came from an iteration of this loop on 2026-05-14). The substrate is `_aa_synthesizer.py` plus whatever new innovation tools exist at the time.

**5. REPEAT.** SessionStart triggers the next iteration. The substrate is `~/.claude/hooks/session-self-reflect.py` which runs the L3 analyzers before regenerating system_self_report. Each repetition starts from the prior iteration's state preserved in committed files, plus whatever evolution proposals have been applied since the prior session ended.

## Why this is not just continual learning

Continual learning, as Nested Learning addresses it, is the problem of acquiring new tasks without overwriting old ones within a single trained model. The mechanism is multi-frequency optimization inside the architecture.

The JARVIS evolutionary loop addresses a strictly larger problem: how the substrate itself improves over time, including modifications to the optimization layers that constitute the substrate. The model inside is one component; the hooks around it, the analyzers that observe its behavior, the primitives that constrain it, the indexes that recall context for it, the propose-then-apply gates that decide which modifications get accepted, are all components that themselves get optimized by the loop.

Two consequences follow.

First, the substrate has a strict superset of optimization surface compared to a single-model architecture. A model with weight-access can modify weights. A substrate-overlay with file-access can modify weights (via fine-tuning if available), can modify the hooks that gate the model's inputs and outputs, can modify the analyzers that score the model's behavior, can modify the primitives that define what counts as correct behavior, and can modify the modification process itself. Each level can be evolved by the next level above it. The recursion ends at the user, who is the load-bearing externality the substrate exists to serve.

Second, the loop's evolution is not bounded by the architecture's expressivity. HOPE can adapt within the space its architecture spans. The JARVIS substrate can introduce new layers entirely. The session that introduced L4 post-generation reflection was not a parameter update; it was a new substrate component that did not exist before. The session that introduced the memory-preprocessor as the L2-to-L1 burst at boot was likewise a new component. The substrate's possible-self space grows as the loop runs, in a way the model's possible-self space does not.

## Backtest as the missing rigor

The reason most "AI agent" frameworks fail to compound is that they iterate without backtesting. Each session feels productive; nothing systematically scores whether yesterday's decisions held, whether the heuristics that fired actually predicted the right action, whether the primitives saved in memory carried any weight when they were referenced. Without backtest, the system mistakes change for improvement.

The decision capture hook (Stop-event, scans assistant output for forward-looking commitments, appends to `decisions_live.jsonl`) shipped on 2026-05-13 to populate the trail. The decision review tool (`_decision_review.py`) shipped the same day to surface past decisions for grading. The backtest layer added now ties those together: aggregate scores per decision class, per source primitive, per time horizon. The output is a single number per substrate component: held / reversed / unclear / forgotten counts and a derived confidence metric. Hooks and primitives that produce mostly forgotten or reversed outcomes are flagged as evolution candidates.

This is the rigor Nested Learning's continual-learning framework does not include and arguably cannot include without persistent state outside the model.

## Evolve as bounded mutation

The evolve phase proposes modifications. It does not apply them.

This is the deepest difference between continual learning inside weights and evolution outside the architecture. Weight updates are inherently bounded by gradient-step magnitudes and learning-rate schedules. Substrate updates are not. A change to a hook or a primitive can be qualitatively larger than any single weight update, and the wrong such change can degrade behavior across every future session.

The propose-then-apply pattern, shipped on 2026-05-13 with `_consolidation_proposer.py` for memory deduplication and `_memory_md_apply.py` for safety-gated index application, generalizes here. The evolve proposer writes structured proposals to `_system/evolution_proposals/<timestamp>_<topic>.md`. Each proposal contains: the evidence (which telemetry / backtest signal triggered it), the proposed change (the exact file edits), the expected effect, the rollback path. Human review and safety-gated application are separate steps.

The asymmetric-cost gate-stacking primitive (`P·gate-stacking-asymmetric-cost`) applies: the cost of a missed evolution is small (the substrate stays as-is), while the cost of a bad auto-applied evolution can be large (silent regression across sessions). Propose-then-apply is therefore not a friction; it is the load-bearing safety property that makes the loop trustworthy.

## Innovate as bounded creativity

The innovate phase is where the loop becomes generative rather than only corrective.

Existing innovations from this overlay, all shipped before this theory paper was written:
- HIERO compression as a domain-specific symbolic encoding for memory primitives
- The L0-L5 layer stack as an explicit ladder of multi-frequency optimization (the structural overlap with HOPE)
- AA-synthesizer for clustering failure modes into formal audit-arsenal entries
- The reasoning chain compiler for one-shot cross-primitive inference
- The memory preprocessor's L2-to-L1 burst at boot, an ETM-tiered approach to context budget
- The propose-then-apply safety gate for any substrate mutation

The pattern across all of these: a friction point during an iteration becomes the seed of a substrate addition that did not exist before. The friction is the backtest signal. The substrate addition is the evolve+innovate output. The pattern is observable, and the loop, once formalized, can be run with intent.

## Repeat as compounding

The compounding property is what makes the loop more than the sum of its phases. Each iteration's evolution shapes the next iteration's behavior, which shapes the next backtest, which shapes the next evolution. The substrate's capability surface grows monotonically as long as evolve proposals are correctly graded by backtest signal.

This is the same logic as compound interest on capital, the same logic as Shapley-axiom credit propagation in `[F·augmented-mechanism-design-paper]`, the same logic as the cell-knowledge-architecture treating knowledge as UTXO-like state. The mechanism is different in each substrate; the compound-growth shape is identical.

## What this means for positioning

Three claims become defensible from the moment this paper ships alongside the implementing scripts.

First, JARVIS is past the proof-of-concept stage for the multi-frequency-optimization principle that Nested Learning theoretically validated. The L0-L5 stack runs in production on this machine with telemetry to back every layer.

Second, JARVIS goes strictly beyond Nested Learning by including the backtest and evolve phases that HOPE's architectural instantiation does not have and cannot have without persistent state outside the model.

Third, the evolutionary loop is itself a generalizable methodology, not a JARVIS-specific implementation detail. Any persistent-substrate AI overlay that builds the five-phase loop (iterate, backtest, evolve, innovate, repeat) inherits the same compounding property. The methodology is open-source by construction; the artifacts under `github.com/WGlynn/JARVIS` are public; the implementation can be cloned or improved by anyone who reads this paper.

The convergence with Google Research on the underlying multi-frequency principle is a validation. The evolutionary extension is the differentiator. Both are real.

## Concrete next-iteration commitments

This paper triggers an iteration of its own loop. Specifically, the iteration's deliverables are:

- `_backtest.py` scoring decisions from `decisions_live.jsonl` + `decisions_log.md` against observed outcomes, writing `_system/backtest_report.md`
- `_evolve_proposer.py` reading telemetry + backtest signal, writing `_system/evolution_proposals/<timestamp>_<topic>.md` files
- `_evolution_loop.py` orchestrating the four prior phases plus repeat trigger, writing `_system/evolution_loop.md` as the per-iteration log
- Wiring into `~/.claude/hooks/session-self-reflect.py` `L3_ANALYZERS` so the loop runs at every SessionStart
- Forward Signal entries in `system_self_report.md` for: pending evolution proposals, recent backtest scores, last innovation surfaced

When those ship, the next iteration of the loop begins automatically at the next session boot, and the substrate has formally moved from "shipping continual-learning analog" to "shipping evolutionary compounding stack."

---

*Author: Will Glynn, open source contributor to VibeSwap. Composed in collaboration with the JARVIS overlay's L4 post-generation-reflect substrate, 2026-05-14.*

*Related: the Nested Learning structural-overlap letter at `correspondence/2026-05-14_google-nested-learning-letter.md`; the L0-L5 theory at `05-meta-protocols/jarvis-protocol-llm-overlay.md`; the propose-then-apply pattern shipped in `_memory_md_apply.py`.*
