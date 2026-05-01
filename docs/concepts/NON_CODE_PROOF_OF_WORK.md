# Non-Code Proof of Work

**Status**: Argument. Why dialogue, design, framing constitute *computational* work.
**Audience**: First-encounter OK. Grounded in examples from CS theory + VibeSwap practice.

---

## Start with an injustice you've seen

You're on a team. Someone — let's call her Alice — has a way of asking questions that reframes problems elegantly. She rarely writes code. But when she's in the room, design decisions go faster and better.

The team ships. In the git log, 95% of commits are from the engineers who wrote the code. Alice shows up occasionally with comments and reviews.

At compensation time, bonuses go to "biggest contributors." Alice gets a small bonus. The engineers get big ones.

Alice's framing-work was essential. It enabled the engineers. But it didn't appear in git; it didn't have her name attached to code; it's invisible to the compensation system.

This is the pattern Non-Code Proof of Work addresses.

## The claim

Non-code contributions to a technical project are not auxiliary to code — they are the **computational substrate** that produces code.

Dialogue that explores a design space IS work. Framing that narrows an ill-posed problem IS work. Audit prompts that name vulnerabilities ARE work.

Treating code as the only provable work-output misdescribes how the work actually gets done.

This is the justification for PoM (Proof of Mind) being a valid consensus pillar alongside PoW and PoS.

## Why this matters

DeFi projects default to rewarding code-visible work. GitHub commits. Tokens allocated to devs. This produces a systematic bias: people who do upstream work (research, architecture, framing, audit, debugging support, emotional labor) are under-credited relative to value created.

Under-crediting upstream work has a predictable effect: upstream work gets under-supplied, which bottlenecks the project. Most DeFi project failures are failures of upstream work that code couldn't substitute for.

VibeSwap's bet: properly crediting upstream work produces compounding upstream-work advantage — a moat that pure-PoW and pure-PoS projects can't replicate.

## What counts as "work," formally

Work in the computational sense: a process that, given inputs, produces outputs that weren't trivially derivable from the inputs.

A code commit produces a new state given prior codebase + diff. This is work — measurable: diff exists, state change verifiable, compute was real.

But the diff didn't write itself. Upstream of the diff:

### Work 1 — Problem recognition

Noticing that a thing needs changing. Given all inputs, the non-trivial output is IDENTIFYING which input-element is the problem.

This is **search work** — searching the space of possible-problems to find the actual one.

**Concrete**: a user reports "my transaction failed." The support person diagnoses: "Oh, you're hitting the per-pool rate limit because of Sybil-attack from address X." The diagnosis is work. Not trivial.

### Work 2 — Design framing

Converting "the thing needs changing" into "here's the shape of the solution."

This is **model-selection work** — choosing a solution-shape that isn't pre-determined by the problem.

**Concrete**: given "rate-limiting feels too aggressive," the designer proposes "damping curve instead of cliff" (Fibonacci Scaling approach). The proposal is work — not derivable from the problem alone.

### Work 3 — Solution validation

Reasoning that the solution actually works before coding.

This is **proof-search work** — walking the space of correctness arguments.

**Concrete**: the designer also produces the invariant check: "after this change, the rate limiter preserves attack-resistance while not affecting normal users." That reasoning is work.

### Work 4 — Dialogue iteration

Refining a solution across multiple minds.

This is **social-computation work** — computation distributed across multiple agents.

**Concrete**: a pair programming session that yields a better solution than either could have produced alone. The session IS work, even though no single person "solved it."

Each of these is computational work. Different from code-writing but mathematically equivalent (input → non-trivial output).

## The PoW asymmetry works for non-code too

Cryptocurrency PoW hashing: the prover invests compute; the verifier cheaply confirms. Asymmetry makes the commitment credible.

Non-code contributions have the same asymmetry:

- **Design work**: produces a solution-shape. Verifying the shape is cheaper than deriving it.
- **Audit work**: produces a vulnerability report. Verifying the vulnerability is cheaper than finding it.
- **Framing work**: produces a problem statement. Using the frame is cheaper than coming up with it.

PoM proposes that these asymmetries should accumulate credit on-chain just like PoW does. Same verifier-asymmetry pattern; different substrate.

## Why not just weight everyone equally

Equal-weight contribution recording (post to issue, get credit) fails:

- Bots and Sybils inflate contribution counts arbitrarily.
- High-quality contributions drowned in low-quality noise.
- Real contributors disengage when their work is undifferentiated from spam.

PoM-weighted attribution requires:

- **Evidence**: the contribution was produced (verifiable via source/date/channel).
- **Attestation**: trust-weighted peers confirm the contribution is real and valuable.
- **Resistance to capture**: multi-branch attestation prevents single-actor bias.

This raises the cost of faking contributions to prohibitive levels while leaving the cost of real contributions natural.

## The three PoM pillars

PoM in NCI combines:

1. **Attestation weight**: cumulative trust-weighted attestations received.
2. **DAG lineage depth**: downstream contributions citing this one (decayed by distance).
3. **Persistence**: contributor's participation over time (decayed by dormancy).

A contributor with only attestations is a one-shot. Only lineage depth is influence-without-recent-action. Only persistence is activity-without-impact. Combining all three weighs cognitive contributors multi-dimensionally, mirroring how PoW chains weigh miners.

## Implications for audits

An audit prompt ("have you considered oracle manipulation from a stale-feed angle?") that leads to a HIGH-severity finding and a shipped fix IS computational work. It took expertise and time. It prevented a real loss.

Under PoW-only crediting: the auditor gets paid only if they write the fix themselves — which they often CAN'T (different codebase, different expertise).

Under PoM: the auditor gets credited proportional to the value of the prompt. The code-writer gets credited for the code-level work. Both get paid; total allocated matches total value created.

This changes audit economics. Good auditors specialize in prompt-work (their comparative advantage) rather than trying to be full-stack contributors. Projects get better audit coverage.

## What PoM is NOT

Careful to distinguish:

### NOT reputation score

Reputation is a summary; PoM is work-measure with economic consequence.

### NOT upvotes

Upvotes are costless; PoM attestations have staking and slashing.

### NOT identity

Identity (SoulboundIdentity) is the substrate PoM attestations live on; PoM is the aggregate work-measure.

### NOT a replacement for PoW or PoS

NCI is a sum of all three. PoM is one axis. Dominance is bounded.

## Concrete scenario — audit prompt compensation

Let me walk a specific case.

**Day 1**: Alice is a security researcher. She reads VibeSwap contracts. She notices a specific oracle-manipulation vector. She posts a `[Dialogue]` issue with the observation.

**Day 2**: Bob (VibeSwap engineer) reads the issue. He investigates. It's real. He writes a fix.

**Day 3**: Bob ships the fix. His commit references `Closes #42 — Alice's audit observation on oracle feed staleness`.

**Day 5**: The attestation mints for both:
- Alice: `Security` type contribution, `value = 5e18` (Audit base).
- Bob: `Code` type contribution, `value = 3e18` (Feature base).

**Day 30**: Shapley distribution round fires. Alice and Bob both receive rewards. Alice's Shapley share reflects the marginal value of her observation. Bob's reflects the implementation.

Both are proportionally compensated. Alice's observation, which would have been UNCOMPENSATED in a code-only system, is now worth its actual marginal contribution.

This is PoM in practice. Non-code work → on-chain credit → economic reward.

## Relationship to the Lawson Constant

[Lawson Constant](../research/proofs/LAWSON_CONSTANT.md): "the greatest idea cannot be stolen because part of it is admitting who came up with it."

Applied: non-code provenance is first-class attribution data. An idea attributed to Alice earns her credit; removing the attribution would violate the Lawson Constant (hardcoded in bytecode).

The Constant is the philosophical statement; PoM is its operational mechanism; NCI is its integration into consensus; [Contribution Traceability](identity/CONTRIBUTION_TRACEABILITY.md) is its workflow.

## For external contributors

If you're an external contributor thinking "I don't code; do I have anything to offer VibeSwap?":

Yes. If you:
- Notice patterns others miss.
- Frame problems clearly.
- Ask audit-relevant questions.
- Bring expertise in cognitive science / economics / mechanism design / game theory / etc.

All of these are computational work. All of these are DAG-creditable. All of these earn rewards proportional to marginal contribution.

[Contribution Traceability](identity/CONTRIBUTION_TRACEABILITY.md) is the workflow that makes your contribution visible. Start there.

## For students

Exercise: audit a recent technical discussion you were in (meeting, thread, chat). Identify:

1. The specific problem being discussed.
2. Who contributed what:
   - Who identified the problem?
   - Who proposed solutions?
   - Who validated proposals?
   - Who synthesized decisions?
3. Under code-only crediting, who would get credit?
4. Under PoM, who would get credit?

Compare the two distributions. Note the ones under-credited by code-only.

## Relationship to other primitives

- **Parent**: ETM — cognitive-economic processes are the substrate.
- **Applied via**: [Contribution Traceability](identity/CONTRIBUTION_TRACEABILITY.md) — how non-code work gets attributed.
- **Counter-evidence for**: "only code counts" frame.

## One-line summary

*Dialogue, design, framing, audit are computational work — produce non-trivial outputs from inputs, with the same verifier-asymmetry that makes PoW credible. Under code-only crediting, upstream work is under-supplied. PoM records them with same pattern PoW uses; NCI combines PoM with PoW + PoS. Alice's audit observation + Bob's implementation both earn proportional credit. This is the compounding upstream-work moat that code-only systems don't have.*
