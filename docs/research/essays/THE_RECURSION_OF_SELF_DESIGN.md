# The Recursion of Self-Design

**Status**: Meta-stability analysis with concrete scenarios.
**Audience**: First-encounter OK. Walk through specific failure modes + stability conditions.

---

## The uncomfortable situation

Suppose you decide to build a mechanism that rewards contributions. You spend 6 months designing the mechanism. Now you deploy it.

Here's the awkward question: *should you get credit for designing the mechanism?*

If yes, the mechanism is paying you for designing itself. That's recursion: the rules you built reward the work of building them.

If no, you get nothing for 6 months of design work. That seems unfair.

Both answers feel wrong. The recursion-of-self-design problem is navigating this intuition.

## Why it matters

Most projects dodge this question. Founders just allocate themselves tokens based on their own judgment. "Founders get 30%". No mathematical justification; just precedent.

VibeSwap can't dodge it. The protocol's values (fairness, anti-extraction, attribution-as-structural) make the usual answer ("founders just get X%") incompatible. We have to confront the recursion honestly.

## The basic tension

A system that rewards contributions has a mechanism. Someone designed the mechanism. Should they get credit for that design under the mechanism's own rules?

If YES → recursion. The mechanism is rewarding the work of its own design. This looks circular.

If NO → the designer is effectively working for free. And the design itself is a contribution. Unrewarded contribution violates P-000 (Fairness).

Neither pure yes nor pure no works. The answer must be a bounded yes.

## What the naive answer fails

Suppose you just let design credit flow without constraint.

**Scenario**: Alice designs VibeSwap's reward mechanism. She's the sole designer. The mechanism pays out based on marginal contribution. She claims the design work was load-bearing (true) and assigns herself, say, 80% of all future rewards.

Problems:
- 80% to a single person is extractive.
- Later contributors see 80% go to founder; they underinvest.
- Governance can't really check this (she designed the governance too).
- The recursion runs away.

This is why naive yes doesn't work.

## What's required for stability

The recursion is stable iff specific conditions hold:

### Condition 1 — Initial design credit is Shapley-bounded

Design credit for the mechanism itself is computed via Shapley over the cooperative game that includes ALL contributors (not just the designer).

Alice gets her marginal-contribution share. If the design was crucial and unique, her share is high. If others also contributed substantially, her share is lower.

**Concrete**: Alice designed the core mechanism. Bob wrote tests. Carol did UX. Dana did governance. Shapley values might be: Alice 50%, Bob 20%, Carol 15%, Dana 15%. Alice still gets the most but not 80%.

### Condition 2 — Constitutional axioms block self-amplification

P-000 (Fairness) and P-001 (No Extraction) are constitutional — NOT governance parameters. Alice cannot vote to make them "except in her case". See [`NO_EXTRACTION_AXIOM.md`](../../concepts/NO_EXTRACTION_AXIOM.md).

If a future Alice tries to game the mechanism for self-benefit, the constitutional axioms block it. Amendment requires amending the Constitution, which requires the Constitution to allow it — which P-000 explicitly forbids.

### Condition 3 — Founder-weight decay

Alice (founder) has trust-multiplier 3.0x in ContributionDAG. But trust decays 15% per hop. At hop 3 from Alice, effective multiplier is `3.0 × 0.85^3 ≈ 1.84`. At hop 6, `3.0 × 0.85^6 ≈ 1.13`.

Alice's direct influence is substantial but dilutes organically as the graph grows. Over 3 years with ~5000 active contributors, Alice's actual weight in distributions is a bounded fraction.

### Condition 4 — Three-branch attestation resists capture

Accepting a claim requires either executive (trust-weighted peers), judicial (tribunal), or legislative (governance). Alice alone cannot swing all three branches. See [`CONTRIBUTION_ATTESTOR_EXPLAINER.md`](../../concepts/identity/CONTRIBUTION_ATTESTOR_EXPLAINER.md).

Even if Alice could bias executive branch (she has high trust-weight), tribunal jury selection is random and governance requires quadratic voting. No single actor can capture all three.

### What these four conditions ensure

Under all four conditions, recursion converges:
- Design credit is bounded (Shapley-limited).
- Founder voting power is bounded (3.0x with decay).
- Constitutional axioms are immutable.
- Multi-branch capture is infeasible.

Alice gets fair credit for design work. She doesn't accumulate unbounded wealth or power. Over time, her advantage dilutes as contributors compound.

Convergent, not divergent. Recursion is safe.

## Concrete scenario — year 5 of the protocol

Let's project forward to see this play out.

**Year 0 (launch)**: Alice is sole designer. Shapley share for initial mechanism design: say, 25% of early-stage rewards. Founder multiplier: 3.0x.

**Year 1**: ~50 active contributors. Shapley distribution shifts — new contributors add 5% each collectively. Alice's effective rewards: now ~15% of ongoing rewards (her 25% of year-0 pool + smaller share of year-1 pool).

**Year 3**: ~500 active contributors. Alice's ongoing share: ~5% of each year's pool. Her accumulated wealth is substantial but her influence dilutes.

**Year 5**: ~5,000 active contributors. Alice's share: ~1-2% of each year's pool. Her founder-multiplier is still 3.0x but only 5-10 contributors are at hop-0 from her; most of the graph has diluted her influence.

**Year 10**: ~50,000 active contributors. Alice's share: negligible per-year. She's retained her original cumulative allocation but the protocol is no longer "hers" in any controlling sense.

This trajectory is stable — Alice fades into ordinary participant status over time. Sustainable over decades.

The alternative (naive 80% forever): extractive, unsustainable, protocol dies.

## What could break stability

Even with the four conditions, specific attacks could break convergence:

### Attack 1 — Self-attestation via sockpuppets

Alice creates 20 pseudo-identity accounts and has them attest her work to inflate her Shapley share.

**Counter**: 
- SoulboundIdentity prevents Sybil accumulation (only one identity per real human).
- Quadratic voting dampens coordinated vote patterns.
- Attestation weight scales with attestor trust, so low-trust sockpuppets barely boost.

Net: sockpuppet attacks cost more than they gain. Not a real threat.

### Attack 2 — Pre-governance capture

Alice deploys the protocol with governance-captured configurations (e.g., quorum thresholds set to favor her). Years later she uses this to block amendments that would fix her advantage.

**Counter**:
- Initial governance config is published transparently before launch.
- Community can fork if Alice misuses.
- Constitutional axioms (P-000, P-001) are not governance parameters.

Fork-threat is a real constraint. Alice can't just ignore community if community holds accumulated attention-graph.

### Attack 3 — Mechanism ossification

Alice refuses to allow mechanism updates that would dilute her advantage. "Can't change this; too much work already done."

**Counter**:
- Governance has explicit amendment paths.
- Tribunal escalation is possible.
- External pressure (community, investors, competitors) forces adaptation.

Ossification is mitigable, though it's a real risk in concentrated-founder protocols.

## The "test against external design" principle

A useful mental test: if the mechanism had been designed by strangers and then applied to Alice, would Alice find it fair?

If yes → the mechanism is symmetric (not biased toward Alice).

If no → Alice is getting special treatment that wouldn't pass external review.

Apply to VibeSwap:
- Shapley distribution: applies equally to designers and non-designers. Symmetric. ✓
- Founder multiplier: 3.0x for Alice. But same 3.0x would apply to any non-Alice founder. Symmetric. ✓
- Constitutional axioms: constrain everyone equally. ✓

Alice's position in VibeSwap's mechanism is not privileged beyond what any equivalent contributor would receive. Test passes.

## Why this matters for positioning

External skeptics see "Will created VibeSwap, wouldn't he get all the benefits?" This doc is the answer: the recursion is bounded by the four conditions, the test-against-external-design passes, the trajectory is Will-fading-to-ordinary-contributor, and this is auditable.

Serious investors will ask this question. Serious contributors will care about the answer. Having an explicit, honest response builds trust.

## Why this matters beyond VibeSwap

Every cooperative-production system that tries to build a reward mechanism hits this paradox. Most fail to address it. The ones that address it best end up with protocols that survive the founder.

VibeSwap's approach is transferable:
- Shapley-bounded initial credit.
- Constitutional axioms that block self-amplification.
- Founder-weight decay.
- Multi-branch capture-resistance.

Apply these four conditions to any credit-assignment system. They produce stable recursion.

## The meta-recursion

This doc is itself a contribution. Writing this doc earned DAG credit. The mechanism for earning DAG credit for docs is described within this doc. One more level of recursion.

Stable because: credit is proportional to marginal contribution (is this doc clarifying the stack?) not to self-assertion (is this doc claiming credit?). Recursive, yes. Divergent, no. The same four conditions apply.

## Relationship to the Lawson Constant

The Lawson Constant (see [`LAWSON_CONSTANT.md`](../proofs/LAWSON_CONSTANT.md)) ensures attribution is preserved across successive rounds of design. You can always trace who did what when.

This is what makes recursion auditable. Without attribution-preservation, recursion becomes invisible; drift compounds undetected. With attribution-preservation, each recursive round is legible; drift can be detected and corrected.

The Lawson Constant is the structural guarantee that recursion-audit is possible.

## For students

Exercise: propose a credit mechanism for a small project (e.g., a study group's collaborative project). Apply the recursion-of-self-design analysis:

1. Identify the designer (maybe yourself).
2. What would Shapley-bounded credit for your design look like?
3. What constitutional axioms would you need?
4. How would founder-weight decay in your graph?
5. What attestation branches would resist capture?

Work through the four conditions for your proposed mechanism. Can you make the recursion convergent?

## One-line summary

*Recursion-of-self-design: the mechanism rewards its own designers. This is convergent (not divergent) iff four conditions hold: Shapley-bounded initial credit + constitutional axioms blocking self-amplification + founder-weight decay + three-branch attestation capture-resistance. Concrete year-0-through-year-10 projection shows Alice fading to ordinary contributor; pattern is transferable to any cooperative-production system.*
