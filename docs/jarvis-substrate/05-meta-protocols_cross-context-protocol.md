# Cross-Context Protocol

> Every output reconciles against the contexts that could invalidate it before delivery. The reconciliation IS the structural enforcer of the output's correctness, not the author's recall.

## The protocol

The Augmented Mechanism Design pattern at Layer 5 says: augment markets and governance with math-enforced invariants rather than replacing them. The Augmented Dev Loops pattern at the same layer says: augment development cycles with intention and protection invariants. Cross-Context Protocol (CCP) applies the same shape one substrate further up, to the cognitive layer that produces outputs.

The protocol states:

> For every output (a list, a draft, a decision, a code change, a public artifact), enumerate the contexts whose state could invalidate the output. Cross-reference each. Deliver only after reconciliation. The reconciliation is the structural enforcer. Author recall is the floor, not the ceiling.

Without CCP, outputs depend silently on whether the author happened to recall the right context at the right moment. With CCP, the recall is replaced by a routing problem: given output type X, query context indexes Y and Z. The cost shifts from "remember the right thing" to "trigger the right lookup," and the latter scales with memory size while the former does not.

## The failure mode CCP exists to close

A protocol's documentation can name a property the implementation does not enforce. A target list can include an entity whose memory file would have disqualified it. A public artifact can repeat a credential the author once revised. A code change can drop a parent's invariant the child quietly inherits.

Every one of these failures shares a structural property: the author had memory access to the disqualifying context but did not apply it at output time. The output passed review only because the reviewer happened to remember the same context. As memory size grows, the probability of recall failure approaches one. At sufficient scale, recall-dependent outputs ship vulnerabilities by default.

CCP names this class and routes around it. The reconciliation step makes the cross-reference structural, which means it does not depend on author state at output time.

## Four routing tiers

CCP admits a routing table from output type to context-to-reconcile. The categorization is not exhaustive; new output types extend the table. The v0 routing covers the most-common cases:

- **Entity-listing outputs** (target lists, contact lists, mention lists, citation lists) route to memory containing entity-relationship state: employer mappings, prior interactions, abandoned partnerships, non-disclosure flags, in-flight conversations on the same target by another team member.
- **Claim outputs** (documentation asserting code properties, papers naming protocol guarantees, public artifacts citing performance numbers) route to the code or measurement that should structurally enforce the claim. The reconciliation step constructs the worst-case input and checks whether the formula rejects it.
- **Decision outputs** (architectural choices, strategic pivots, scope shifts) route to prior-decision rationales: session state files, write-ahead logs, retrospective notes, conflicting prior choices. The reconciliation surfaces continuity gaps.
- **Memory-write outputs** (new primitives, new index entries, new pointer files) route to existing memory for duplicate detection and reciprocal-link verification. A new primitive should not duplicate an existing one and should reciprocally link to its siblings and parents.

A given output may belong to more than one tier. A public artifact making a credential claim is both a claim output (route to verification) and an entity-listing output (route to relationship memory). The reconciliation runs over both routings.

## The audit-arsenal children

CCP is the parent class of an audit-arsenal that has been growing as the failure modes have been named. Each entry routes a specific output class to its cross-reference contexts:

- **AA#1 (fork-loses-hardness)**: any fork or refactor routes to the parent's rejection branches and surrounding semantic clauses. The failure mode is the child silently dropping a constraint the parent enforced. Without explicit cross-reference, the child looks complete while having a quieter attack surface.
- **AA#2 (claim-needs-structural-enforcer)**: any claim of a safety or fairness property routes to the code that should enforce it. The failure mode is a property living in documentation while the formula admits an input that violates it. Worst-case adversarial input construction is the reconciliation procedure.
- **AA#3 (entity-context-cross-reference)**: any list of named entities routes to memory containing entity-relationship state. The failure mode is including an entity whose memory file would disqualify it from this context (an employer of a team member, a recently-abandoned partnership, an NDA-locked engagement).

Beyond the audit-arsenal proper, several existing protocol primitives reveal themselves as CCP instances when read through this lens:

- **Text-to-code-verify-first**: text describing code routes to the code itself, via grep. Failure mode: text describing future-work as if it were present, or describing a deprecated mechanism as if current.
- **Verify-credentials-before-publishing**: public drafts mentioning a credential, title, or count for a person route to the profile memory for that person. Failure mode: conversation drift produces a stale or fabricated credential that survives into publication.
- **Anti-amnesia-protocol**: session-boundary work routes to write-ahead log and session-state files. Failure mode: a new session contradicting a decision made in the prior session.
- **Handshake-math-terminology-determinism**: any claim with required or forbidden terminology signatures routes to the handshake-signature memory. Failure mode: claim phrasing that drifts away from terminology consensus.

All of these are CCP children operating on different output classes with different cross-reference routings.

## Three implementation tiers

CCP admits three enforcement tiers, mirroring the structural-enforcement hierarchy from the parent Augmented Mechanism Design family.

The **memory-level tier** is the cheapest: a documented pre-flight rule that names the cross-reference requirement. This is the rule appearing in PRE-FLIGHT memory; the author reads it on every session start and is supposed to apply it on every relevant output. This is the floor. It works when the author reads and applies. It fails when the author is in a flow state, when the relevant memory is buried, or when the output type was not anticipated by the rule. The memory-level tier alone is insufficient against the failure mode it names.

The **workflow-level tier** dispatches a cross-reference agent as a pre-flight step before any entity-list, document-update, or decision output. This is the same shape as dispatching an audit-sweep agent before a sensitive code commit. The agent loads the relevant memory contexts, scans the candidate output, and surfaces matches. The author reconciles. This works when the workflow gate is honored. It fails when the workflow is bypassed for speed or convenience.

The **hook-level tier** is load-bearing. A pre-tool-use hook fires automatically on writes and edits that match entity-list or claim signal patterns, greps the memory directory for matched entities and claims, and injects matched snippets back to the assistant via additional context. The cross-reference becomes structurally unavoidable for outputs in scope. This is the version that closes the failure mode by construction. The cost is one-time hook implementation; the benefit is every relevant output thereafter is checked without depending on author or workflow state.

The three tiers compose: the memory rule documents intent, the workflow gate operationalizes intent for high-stakes outputs, and the hook enforces intent for all outputs in scope.

## Indexed memory

The hook-level tier works without infrastructure for memory sizes in the low hundreds of files. As memory grows toward the thousands, per-invocation grep over the full memory directory becomes the bottleneck.

The optimization is a reverse index. Memory files mention entities, claims, and decisions. An index keyed by entity name, claim signature, or decision identifier, mapping to the list of memory files referencing each, makes lookup O(matches) rather than O(memory-size). The index can be rebuilt incrementally on memory writes or periodically as a snapshot.

The current sharded-warm-files structure (memory partitioned by topic, loaded by trigger) is halfway to a reverse index. The warm-files give you topic-level pre-loading; the reverse index gives you entity-level pre-loading. The two compose: a warm-file load brings in topic context, then the reverse-index lookup surfaces specific entity references within and beyond the loaded warm file.

Indexed memory turns the hook from a useful but slow gate into a fast structural enforcer. The latency budget for a pre-tool-use hook is a few hundred milliseconds; without the index, large memory directories blow this budget on every relevant write.

## Why this scales when ad-hoc reconciliation does not

The ad-hoc version of cross-reference is: read all the relevant memory, write the output, hope the right context was loaded. Cost per output: O(memory-size) to load plus O(output-size) to write. As memory size grows, the load cost dominates and the author starts skipping the load step. Once the load step is skipped, the cross-reference does not happen; the output ships on whatever the author happened to remember.

The structural version of cross-reference is: write the output, the hook scans it against the index, surfaces matched contexts, the author reconciles. Cost per output: O(output-size) plus O(matches) where matches is bounded by the entities or claims in the output, not by the total memory size. This is the cost profile that scales.

The argument generalizes beyond memory size. Any time the relevant context is some structured corpus (a codebase, a decision log, a knowledge graph), the reverse-index pattern works: index the corpus, scan the output, surface matches, reconcile. The protocol is the same shape regardless of which corpus is the context.

## Origin

CCP was named after an entity-list output shipped with two preventable context vulnerabilities. The output was an outreach target list. Two of the entities had memory files that would have disqualified them: one was an employer of a team member, the other was a recently-abandoned partnership. The author had memory access to both contexts but did not apply either at output time. The output shipped, the vulnerabilities surfaced in human review, and 6 of 50 entries needed retroactive correction.

The retroactive correction was a 12 percent error rate. The expected error rate for a structurally-enforced output is zero. The gap between 12 percent and 0 is the value of moving cross-reference from author-recall to structural enforcement.

The naming moment was the recognition that the entity-list output was one instance of a broader class. Code claims have the same shape (the AA#2 pattern). Forks have the same shape (the AA#1 pattern). Public artifacts repeating credentials have the same shape. The class needed a parent. The parent is CCP.

## What CCP changes about how outputs ship

Outputs shipped without CCP depend on the author having reconciled the relevant contexts at output time. The reconciliation is invisible: it leaves no trace in the artifact, no enforced step in the workflow, no automatic check in the tooling. The output appears clean. Its cleanliness is conditional on author state, which is not auditable.

Outputs shipped under CCP are visibly reconciled. The cross-reference step produces a check-record: which contexts were queried, what matches surfaced, how each match was handled. The output appears clean for a reason that is auditable: the reconciliation happened and is visible in the artifact's lineage.

This makes outputs cheaper to review, cheaper to challenge, and cheaper to defend. A reviewer can ask "did the cross-reference happen?" and verify the answer by inspecting the check-record. An adversary can ask the same question and verify the same answer. A future maintainer can trust that the output's claims survived a structural check, not a memory roll of the dice.

That is the property CCP delivers. It is the property the cognitive layer needs in order to scale past the size where author-recall stops being reliable.
