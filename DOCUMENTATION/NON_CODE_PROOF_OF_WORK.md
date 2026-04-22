# Non-Code Proof of Work

**Status**: Argument. Why dialogue, design, and framing contributions constitute *computational* work.

---

## The claim

Non-code contributions to a technical project are not auxiliary to code — they are the computational substrate that produces code. Dialogue that explores a design space IS work; framing that narrows an ill-posed problem IS work; audit prompts that name a vulnerability IS work. Treating code as the only provable work-output misdescribes how the work actually gets done.

This is the justification for PoM (Proof of Mind) being a valid consensus pillar alongside PoW and PoS.

## Why this matters

DeFi projects default to rewarding code-visible work. GitHub commits. Tokens allocated to devs. This produces a systematic bias: people who do upstream work that enables the code (research, architecture, framing, audit, debugging support, emotional labor holding the group together) are under-credited relative to the marginal value they create.

Under-crediting upstream work has a predictable effect: upstream work gets under-supplied, which bottlenecks the project. Most DeFi project failures are not failures of code — they are failures of upstream work that code execution couldn't substitute for.

VibeSwap's bet is that properly crediting upstream work (Proof of Mind) produces a project that accumulates upstream-work advantage — a compounding moat that pure-PoW and pure-PoS projects can't replicate.

## What work means, formally

Work in the computational sense: a process that, given inputs, produces outputs that weren't trivially derivable from the inputs. Complexity-theoretic.

A code commit produces a new state given the prior codebase plus the commit diff. This is work. Measurable: the diff exists; the state change is verifiable; the output took real compute to produce.

But the diff didn't write itself. Upstream of the diff:
- **Problem recognition** — noticing that a thing needs changing. Given all the inputs, the non-trivial output is the identification of which input-element is the problem. This is search work.
- **Design framing** — converting "the thing needs changing" into "here's the shape of the solution". Given a problem statement, the non-trivial output is a solution-shape that isn't pre-determined by the problem. This is model-selection work.
- **Solution validation** — reasoning that the solution-shape actually works before coding. Given a proposed solution, the non-trivial output is the correctness argument. This is proof-search work.
- **Dialogue iteration** — refining a solution across multiple minds. Given a proposed solution and critiques, the non-trivial output is the revised solution. This is social-computation work.

Each of these is work in the computational sense. The output took compute. The compute happened in a brain rather than a CPU but the substrate doesn't change the work-status.

## The bijection back to chain PoW

In cryptocurrency PoW, "work" is hashing — a computation whose output (a nonce satisfying a difficulty bound) is expensive to produce and cheap to verify. The asymmetry is what makes it valuable: the prover invests; the verifier cheaply confirms.

Non-code contributions have the same asymmetry:
- **Design work** produces a solution shape; verifying a solution-shape's correctness is cheaper than deriving it.
- **Audit work** produces a vulnerability report; verifying the vulnerability is cheaper than finding it.
- **Framing work** produces a problem statement; using the frame is cheaper than coming up with it.

PoM proposes that these asymmetries should accumulate credit on-chain just like PoW does. The verifier-asymmetry pattern is the same; the substrate is different.

## Why not just weight everyone equally

Equal-weight contribution recording (post to issue, get credit) fails because:
- Bots and Sybils inflate contribution counts arbitrarily.
- High-quality contributions are drowned in low-quality noise.
- Real contributors disengage when they see their work undifferentiated from spam.

PoM-weighted attribution requires:
- Evidence of the contribution (the idea, the audit, the framing, produced on a verifiable date via a traceable channel).
- Attestation by trust-weighted peers that the contribution is real and valuable.
- Resistance to capture (multi-branch attestation, see [ContributionAttestor Explainer](./CONTRIBUTION_ATTESTOR_EXPLAINER.md)).

This raises the cost of faking contributions to prohibitive levels while leaving the cost of real contributions natural.

## The three PoM pillars

PoM in NCI combines:

1. **Attestation weight** — the cumulative trust-weighted attestation mass a contributor has received.
2. **DAG lineage depth** — the number of downstream contributions that cite this one, decayed by distance.
3. **Persistence** — contributor's participation over time, decayed by dormancy.

A contributor with only attestations is a one-shot. A contributor with only lineage depth is influence-without-recent-action. A contributor with only persistence is activity-without-impact. Combining all three weighs cognitive contributors in the same multi-dimensional way PoW chains weigh computational miners.

## What PoM is NOT

- **Not reputation score.** Reputation is a summary; PoM is work-measure with economic consequence.
- **Not upvotes.** Upvotes are costless; PoM attestations have staking and slashing.
- **Not identity.** Identity (SoulboundIdentity) is the substrate PoM attestations live on; PoM is the aggregate work-measure.
- **Not a replacement for PoW or PoS.** NCI weight function is a sum; PoM is one axis. Dominance is bounded.

## Implications for audits

An audit prompt ("have you considered oracle manipulation from a stale-feed angle?") that leads to a HIGH-severity finding and a shipped fix IS computational work. It took expertise and time. It prevented a real loss. Under PoW-only crediting, the auditor gets paid only if they write the fix themselves — which they often can't (different codebase, different expertise profile).

Under PoM, the auditor gets credited proportional to the value of the prompt. The person who writes the fix gets credited for the code-level work. Both get paid; the total allocated matches the total value created.

This changes the economics of audit. Good auditors can specialize in prompt-work (their comparative advantage) rather than trying to be full-stack code-contributors. Projects get better audit coverage.

## Relationship to Lawson Constant

[Lawson Constant](./LAWSON_CONSTANT.md): "the greatest idea cannot be stolen because part of it is admitting who came up with it." This formalizes as: non-code provenance is first-class attribution data.

The Lawson Constant is the philosophical statement; PoM is its operational mechanism; NCI is its integration into consensus; [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) is its workflow.

## One-line summary

*Dialogue, design, and framing ARE computational work in the complexity-theoretic sense; PoM records them with the same verifier-asymmetry pattern PoW uses for hashes, producing a compounding upstream-work advantage that code-only-crediting projects can't replicate.*
