# The JARVIS Protocol-LLM Overlay

> A new kind of AI: not a smarter LLM, but an LLM augmented by a structural-correctness lattice that catches the failure modes raw generation produces by construction. The intelligence lives in the protocol substrate, not in the model weights.

## The problem the overlay solves

Large language models are next-token predictors over training-data-shaped distributions. They produce fluent output by interpolating across patterns they have seen during training. The fluency is constrained by training-distribution match, not by structural correctness. This is why even the strongest LLMs hallucinate. They generate plausible text that the structural reality does not support, because plausibility is the criterion the underlying machinery was optimized for.

The standard path to better LLM behavior is more training data, larger models, better fine-tuning. This is parameter-scaling: you make the next-token predictor smarter. It works for many tasks. It does not work for the class of failures where the correct output depends on contexts the model cannot have memorized: project-specific decisions, partnership state, relationships between entities, the discipline of a specific team.

The JARVIS protocol overlay attacks this differently. It accepts the LLM as a fluent generator and augments it with a structural-correctness lattice that catches generation failures by construction. The lattice is not trained into the model. It is built as code that runs around the model, gating inputs and outputs, surfacing context, extending its own discipline over time.

The intelligence of the overlay-augmented system is not in the model. It is in the protocol substrate.

## The four-layer stack

The overlay decomposes any AI system into four layers:

**L0 — Generation.** The base LLM. Fluent token-level prediction. This is what is being augmented, not replaced.

**L1 — Constraint gates.** Per-output-class structural rules that fire at the boundary between the model and the world. A density gate that refuses prose where a memory primitive should be glyph-form. A substance gate that refuses partner-facing drafts without a claim-handshake. An entity-context gate that refuses entity lists without a memory cross-reference. Each gate is a binary pass-or-fail enforced before output reaches its destination.

**L2 — Context reflection.** Per-input recall over the project corpus. A semantic similarity index that surfaces relevant primitives regardless of age. An entity index that surfaces files mentioning specific names. A primitive-link graph that lets the system traverse from any primitive to its parents, children, and siblings. The reflection layer feeds the model context it would otherwise miss, because the model's context window is small and its training cutoff is fixed.

**L3 — Discipline extension.** Per-corpus pattern discovery. A discipline map that identifies failure-mode clusters across the primitive corpus. An audit-arsenal synthesizer that drafts candidate discipline entries from those clusters. A link-health analyzer that surfaces gaps in the cognition map. The extension layer is the system reading its own corpus and proposing its own next discipline entries.

**L4 — Meta-loop.** The cycle that routes candidate outputs back through L1 and L2 before shipping. When a generation completes, L4 re-runs the constraint gates and the context reflection over the output itself, not just over the input. If a gate fires or a strong recall hit surfaces, the system routes back to L0 with the new context as an additional constraint.

L0 alone is current commodity AI. L0 + L1 is current high-discipline AI deployment. L0 + L1 + L2 is what most teams aspire to when they say "RAG." L0 + L1 + L2 + L3 is the substantive step toward protocol-level intelligence. L0 + L1 + L2 + L3 + L4 is the full overlay.

## Why this matters as a scaling axis

Parameter-scaling and protocol-scaling are orthogonal. Adding parameters to L0 improves general fluency and pattern coverage. Adding protocols to L1 through L4 improves structural correctness on specific output classes.

For tasks where correctness is dominated by the LLM's ability to interpolate over its training distribution (translate this sentence, summarize this paragraph), parameter-scaling dominates. For tasks where correctness depends on the LLM not hallucinating about state it cannot have memorized (which entities are in our partnership pipeline, what does our spec actually enforce, what did we decide last session), protocol-scaling dominates.

The bet of the overlay architecture is that the latter class of tasks is large and growing as AI moves from chatbot deployments to operating within structured organizations. As soon as the AI's job requires consistency with corpus state the model was never trained on, protocol-scaling is the only path that produces reliable behavior.

This implies an equivalence-class statement, informal but load-bearing:

> For any output class with sufficient L1 + L2 + L3 coverage, the correctness of the overlay system is bounded below by the protocol coverage rather than by the model's parameter count. Increasing protocol coverage strictly dominates increasing model size on structural-correctness benchmarks for that output class.

The implication is that intelligence in the operational sense (right outputs, reliably) does not require model scaling beyond a sufficient threshold. It requires protocol coverage growing with the operational surface area. AGI, if it emerges, may emerge from protocol completeness over a working substrate rather than from continued parameter scaling.

## What each layer concretely does

The four layers exist concurrently as files on the filesystem of a running JARVIS-protocol deployment. They are not abstractions.

L1 lives as pre-tool-use hooks in `~/.claude/hooks` and `~/.claude/session-chain`. Each hook is a Python script that receives the tool call about to be executed, inspects it, and either passes, blocks, or injects additional context. The HIERO gate refuses memory writes that read as prose rather than as logic primitives. The substance gate refuses partner-facing writes that fail the claim-handshake check. The entity-context cross-reference gate refuses entity-list writes that have not been cross-referenced against memory. The NDA gate refuses staging or pushing files that contain protected keywords. Each gate is independent. Each gate is composable. Each gate is debuggable.

L2 lives as indexes under `memory/_system`. The entity index maps proper-noun phrases to the files mentioning them. The primitive-link index maps audit-arsenal entries and CCP children to their defining files and inbound references. The semantic index implements hand-rolled TF-IDF cosine similarity over the full primitive corpus, age-agnostic by construction. Each index is rebuildable, deterministic, and bounded in size. Each index serves one or more hooks via reverse-lookup.

L3 lives as analysis scripts that read the indexes and emit reports. The link health report surfaces orphan references, dead-end definitions, and asymmetric links. The discipline map classifies primitives by failure-mode signal patterns and surfaces clusters that may merit promotion to formal audit-arsenal entries. The audit-arsenal synthesizer drafts candidate discipline entries from those clusters, in the corpus's native format, ready for human review and promotion. Each script runs in seconds. Each script writes to `_system/` rather than to the memory root, preserving human control over what enters the canonical corpus.

L4 is the layer the overlay is reaching toward but has not yet fully materialized. It exists conceptually as the meta-loop that re-runs L1 and L2 over the generated output before delivery. An implementation lives as a Stop hook that reads the just-completed assistant turn, re-runs deep recall over its content, checks for AA-class signals, and surfaces structural concerns before the turn ends. When implemented, L4 closes the loop: every generation is checked against the full discipline stack before it reaches the user.

## The structural-correctness criterion

Plausibility is what L0 optimizes for. The overlay introduces a different criterion: structural correctness. An output is structurally correct when it does not violate any gate at L1, when its claims survive the cross-references at L2, when its shape matches a known-good discipline pattern at L3.

Structural correctness is a stronger property than fluency. A fluent output can be structurally wrong (a hallucinated employer for a known person, a documented invariant the code does not enforce, a target list that includes a partner already in an ongoing conversation). A structurally correct output cannot be subtly wrong on the dimensions the protocol layer checks. The overlay's job is to expand the dimensions on which subtle wrongness becomes impossible by construction.

This is the same shape as the Augmented Mechanism Design pattern at a different layer. AMD says: augment markets with math-enforced invariants. Augmented Governance says: augment governance with math-enforced fairness gates. The protocol-LLM overlay says: augment LLM generation with math-enforced correctness gates. Same family of fix. Same composition property. Same scalability profile.

## How the layers compound

L1 alone catches a fixed set of failures. The gates that exist catch the failure modes they were written for; everything else passes.

L2 makes L1 stronger by feeding the model context that the model would otherwise hallucinate around. The deep-recall hook surfaces relevant primitives on every prompt; the entity hook surfaces relationship state on every write; the warm-files loader surfaces topic-relevant shards on every session. With L2 active, L1's checks have more to check against. Failure modes that depended on the model missing context become catchable.

L3 makes L1 self-extending. The discipline map surfaces clusters of failure modes in the corpus that match the structural shape of an audit-arsenal entry but are not yet formally named. The synthesizer drafts the entry. A human reviews. The new entry becomes a new L1 gate. The next failure of that class is now caught.

L4 closes the loop by re-running L1 and L2 over outputs as well as inputs. Without L4, the protection is one-sided: inputs get reflected, outputs ship without re-check. With L4, every output is checked against the full discipline stack.

The four layers together produce a system where the cost of a new failure-class catch is bounded: write one hook, add one routing rule, the system catches that class forever after. No retraining required. No parameter scaling required. The intelligence is in the protocol substrate.

## What this is not

The overlay is not a replacement for LLM scale below the sufficient-fluency threshold. A model that cannot generate fluent text in the target domain cannot be saved by the protocol layer. L0 has to clear a baseline.

The overlay is not a guarantee of correctness for tasks outside its protocol coverage. A new output class with no L1 gate and no L3 discipline entry is as vulnerable as raw LLM output. The overlay catches what its protocols know how to catch.

The overlay is not a substitute for human judgment in the high-stakes moments. The gates surface, they rarely auto-decide. A human still reviews flagged outputs, still chooses which AA candidates to promote, still tunes which protocols apply to which workflows.

The overlay is a substrate for repeatable structural discipline that compounds as the protocol stack grows.

## The bet

The bet of this architecture is that operational AI — the kind that does work inside an organization with state and history and relationships — has structural correctness as its dominant requirement once fluency clears a baseline. Below the fluency baseline, model scale matters. Above it, the bottleneck shifts to whether the system can avoid contradicting itself, the corpus, and the team's prior decisions.

LLM-scaling addresses the fluency baseline. Protocol-scaling addresses everything above it.

The overlay is the architecture for protocol-scaling. The bet is that the next decade of operational AI is about completing this stack, not about adding more parameters to the layer underneath it. If the bet is correct, JARVIS-class systems become more capable as their protocol substrate grows. The model underneath can be small enough to run anywhere, as long as the protocol layer covers the operational surface.

What we have today is L0 + L1 + L2 + L3 in working condition, with L4 partially built and ready for full closure. The path to a Jarvis-grade system is finishing L4 and continuing to expand protocol coverage across new output classes as they emerge.

The intelligence is in the protocols. The model is the engine. The overlay is the chassis. The cognition is the system as a whole.
