# P-001 — The No-Extraction Axiom

**Status**: Constitutional axiom. Physics > Constitution > Governance; this is the Constitution tier.
**Primitive**: [`memory/primitive_no-extraction-self-correction.md`](../memory/primitive_no-extraction-self-correction.md)
**Related**: [P-000 Lawson Constant](./LAWSON_CONSTANT.md), [Augmented Governance](./AUGMENTED_GOVERNANCE.md), [GEV Resistance](./GEV_RESISTANCE.md).

---

## The axiom

**P-001 (No Extraction)**: No mechanism in VibeSwap may extract value from participants disproportionate to the value the mechanism creates for them. Extraction is the failure mode; VibeSwap's architecture exists to eliminate it as a category.

This is an axiom — not a guideline, not a governance parameter. It cannot be voted away because the mathematical invariants that implement it are Physics, and Physics > Governance.

## Why axiomatic

A system that permits extraction as a tolerated-but-discouraged behavior drifts toward extraction as a normalized one. The path is:

1. "We discourage extraction, but the market does what it does."
2. "A little extraction is fine if it funds something beneficial."
3. "Our extraction is the cost of running the network."
4. "Everyone else extracts, so we'd be disadvantaged if we didn't."
5. "Extraction is how we make money."

Every DeFi extraction-tolerating project has walked this path. Fee schedules grow; extraction surfaces are rationalized; users are educated that extraction is normal.

The axiom short-circuits the path at step 0. P-001 is not a preference; it is a definitional claim about what VibeSwap is. A VibeSwap with extraction is not VibeSwap.

## Relationship to P-000 (Lawson Constant)

P-000 (Fairness Above All): attribution is structural, not decorative. The greatest idea cannot be stolen because its authorship is part of it.

P-001 (No Extraction): no mechanism extracts value disproportionate to what it creates. Extraction is banned.

These are the two constitutional axioms. P-000 is the positive statement (what must exist); P-001 is the negative statement (what must not exist). Together they constrain the design space.

## What counts as extraction

Not every non-zero transfer is extraction. The axiom applies where the transfer is disproportionate to value created. Examples:

### Is extraction

- Frontrunning: trader extracts from other traders via ordering advantage; creates no value.
- Oracle manipulation: price manipulator extracts from AMM LP; creates no value.
- Flash-loan attack: attacker extracts from pool arbitrage; creates negative value (pool broken, trust damaged).
- Admin-setter drift: privileged admin extracts from users by retiming fee changes; creates no value.

### Not extraction

- LP fees for providing liquidity: LP creates value (execution availability), fee compensates proportionately. Proportionate = ok.
- Gas fees paid to block producer: producer creates value (inclusion, ordering verifiability), fee compensates proportionately.
- Governance-vote reward: voter creates value (coordination labor), reward compensates proportionately.
- Contribution attribution: contributor creates value (the contribution itself), DAG credit compensates proportionately.

The test is always: *does the recipient of the transfer create value commensurate with the transfer?* If yes, it's a transaction. If no, it's extraction.

## The self-correction duty

When any participant identifies a proposed mechanism as extractive, the proposal must halt, the extraction path must be redesigned, and the redesign re-submitted. No exceptions for "this is the easy path" or "we need the revenue".

Self-correction is an audit primitive applied to mechanism design. The [P-001 compliance check](../memory/feedback_p001-extraction-gate.md) skill (`/p001-check`) runs this audit on any proposed mechanism.

## How P-001 is enforced

1. **Code review** — every contract change is reviewed against P-001. Extractive patterns are rejected.
2. **The Correspondence Triad** ([doc](./CORRESPONDENCE_TRIAD.md)) — check 2 ("augmentation not replacement") is essentially P-001 at the design-gate.
3. **Governance constraint** — governance cannot vote in an extractive mechanism because P-001 is constitutional. A vote that proposed such a mechanism would be rejected at contract level (the fairness invariants would not pass).
4. **External audit** — public audits test against P-001 as a correctness criterion, not just a code-quality one.

## Why this is marketable

DeFi users and investors are increasingly aware that "MEV-resistant" or "fair-launch" projects often contain extraction surfaces they didn't advertise. P-001 as an explicit, constitutional commitment — one that can be tested and verified by anyone — is differentiable positioning.

The tagline operationalizes it: *A coordination primitive, not a casino.* A casino extracts by design; a coordination primitive doesn't. [GEV Resistance](./GEV_RESISTANCE.md) is P-001 applied to the full category of extraction surfaces.

## What P-001 does not claim

- Does not claim the protocol is free to run — gas and inclusion fees exist; they're not extraction because the block-producer provides commensurate service.
- Does not claim zero-fee trading — LP fees are proportional compensation for liquidity provision.
- Does not claim all participants benefit equally — Shapley distribution is proportional, not equal, and inequality can be large when contributions are large.

The axiom is narrower than "everyone wins" and specific: *no mechanism extracts disproportionate to value created*. Proportionate transactions are fine.

## Relationship to ETM

In [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognitive extraction (attention-capture, brain-rot optimization, predatory engagement loops) is the cognitive-economy pathology. P-001 is the on-chain constitutional commitment that the reflected-on-chain economy must not replicate that pathology.

If VibeSwap allowed extraction, it would be a faithful reflection of the broken attention-economy — which would disprove ETM's generative value. By prohibiting extraction structurally, VibeSwap demonstrates that the cognitive economy *could* run without extractive pathologies if re-built with correct invariants.

## One-line summary

*P-001: no mechanism may extract value disproportionate to what it creates. Constitutional, not negotiable — extraction is categorically disallowed and VibeSwap's architecture implements the ban structurally.*
