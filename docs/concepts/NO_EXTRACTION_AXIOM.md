# P-001 — The No-Extraction Axiom

**Status**: Constitutional axiom. Physics > Constitution > Governance; this is the Constitution tier.
**Audience**: First-encounter OK. Historical extraction cases walked concretely.

---

## The axiom, stated

**P-001 (No Extraction)**: No mechanism in VibeSwap may extract value from participants disproportionate to the value the mechanism creates for them. Extraction is the failure mode; VibeSwap's architecture exists to eliminate it as a category.

## Why we care enough to make this axiomatic

Some rules are preferences. Some are requirements. Some are constitutional — they define what the system IS. P-001 is the last.

A VibeSwap that permits extraction isn't VibeSwap. It would be a different project wearing VibeSwap's name. Constitutional axioms protect against the drift where small compromises accumulate into systemic change.

To understand why this matters, look at what happens WITHOUT this axiom.

## Historical extraction cases — concrete

Let's walk through specific DeFi projects that drifted into extraction. These aren't hypothetical.

### Case 1 — Early DEX fee schedules

Ethereum's earliest DEXes (2017-2018) started with 0.1-0.3% fee schedules. The fees were explicitly labeled "protocol income to fund development."

By 2021-2022, many DEXes had fee schedules of 0.3-1.0% with explicit profit-extraction to token-holders. Users paid the higher fees. The extraction was normalized.

The drift wasn't a single decision. Each incremental fee increase was "justified." Over 3-5 years, extraction became the business model.

VibeSwap's default fee: 0% (explicit in [`ZERO_FEE_PRINCIPLE_ENFORCEMENT.md`](../memory/feedback_zero-fee-principle-enforcement.md)). Fees for specific purposes (gas, oracle compute) are allowed; fees as revenue extraction are constitutional-violations. <!-- FIXME: ../memory/feedback_zero-fee-principle-enforcement.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

### Case 2 — Terra/Luna (May 2022)

Terra's UST stablecoin was marketed as "algorithmic stablecoin." In reality, maintaining the peg required constant subsidy from the parent ecosystem. When the subsidy couldn't keep up, the peg broke catastrophically.

What went wrong: the mechanism extracted stability from Luna token holders. As long as Luna's price rose, Terra's peg held. When Luna fell, the extraction accelerated. $40B+ value evaporated.

The extraction was invisible until it wasn't. Early users benefited from the apparent stability; late users lost everything.

VibeSwap's equivalent: JUL is PoW-backed, not algorithmic. Value comes from underlying computational work, not from subsidy chains. When one holder loses, others don't automatically benefit. No extraction mechanism baked in.

### Case 3 — FTX / Alameda (Nov 2022)

FTX was a centralized exchange. Unlike the other cases, its extraction was explicit-but-hidden. User deposits were borrowed by Alameda (FTX's sister fund) at extremely favorable terms. When Alameda couldn't repay, user funds evaporated.

This is extraction via operator discretion. The operator had authority to move user funds; they moved them for their own benefit.

VibeSwap's equivalent: NO operator has the authority to move user funds. All user actions are enforced by structural invariants. No operator can extract because there's no operator-level power to extract with.

### Case 4 — Uniswap V3 fee optimization

Uniswap V3 allowed liquidity providers to choose custom price ranges. This enabled better capital efficiency BUT also enabled sophisticated LPs to extract more from less-sophisticated traders.

Not explicit extraction, but concentrated advantage: LPs with better analytics tools extracted more-per-dollar than LPs without. Users paid for the LP sophistication.

This is subtler extraction. Not malicious — just information-asymmetric. Sophisticated participants capture more; unsophisticated participants effectively subsidize the sophisticated ones.

VibeSwap's commit-reveal batch auction neutralizes this: same clearing price for everyone in a batch. No sophistication advantage at the trading layer. Sophistication can still earn in other substrates (research, audit) but not via trade-timing.

### Case 5 — Tornado Cash ecosystem fund management

Tornado Cash's governance token (TORN) had a "fund" that grew from usage fees. Over time, fund management became concentrated. Proposals to use the fund often benefited specific stakeholders.

Extraction via governance capture. Not illegal, but the fund's value drifted away from broad token-holders toward concentrated governance participants.

VibeSwap's equivalent: three-branch attestation + quadratic voting prevent concentrated-capture. Constitutional axioms make "redirect funds for our benefit" votes categorically impossible.

## Why extraction normalizes

Looking across these cases, a pattern emerges:

1. **Initial stance**: "we discourage extraction, but the market does what it does."
2. **Early fees**: "a little extraction is fine — we need to fund development."
3. **Normalization**: "our extraction IS the cost of running the network."
4. **Institutionalization**: "everyone else extracts; we'd be disadvantaged if we didn't."
5. **Terminal**: "extraction IS how we make money."

Each step seems incremental. Over years, the system drifts from stance 1 to stance 5. Users accept the new normal; few remember the original promise.

The axiom breaks this path at step 0. P-001 is not a preference; it's a definitional claim. A VibeSwap that drifts into stance 2+ is no longer VibeSwap.

## What counts as extraction (and what doesn't)

Not every non-zero transfer is extraction. The axiom applies where the transfer is **disproportionate** to value created.

### Clear extraction

- **Frontrunning**: trader extracts from other traders via ordering advantage. No value created.
- **Oracle manipulation**: manipulator extracts from AMM LP. No value created.
- **Flash-loan attacks**: attacker extracts from arbitrage. Negative value (pool broken, trust damaged).
- **Admin-setter drift**: privileged admin extracts from users by retiming fees. No value created.

### Clearly NOT extraction

- **LP fees for providing liquidity**: LP creates value (execution availability); fee compensates proportionately.
- **Gas fees paid to block producer**: producer creates value (inclusion, ordering); fee compensates.
- **Governance-vote reward**: voter creates value (coordination labor); reward compensates.
- **Contribution attribution**: contributor creates value (the contribution); DAG credit compensates proportionately.

The test is always: *does the recipient create value commensurate with the transfer?* If yes, it's a transaction. If no, it's extraction.

### Ambiguous cases

- **Tips to operators**: user voluntarily pays extra. Not coerced, so voluntary transaction. But is the tip disproportionate to the operator's service? Depends on context.
- **Affiliate fees**: frontend operator takes a cut. If small and disclosed, transaction. If hidden or coerced, extraction.

Ambiguous cases get adjudicated via tribunal. Constitutional axiom guides the judgment: can you defend this transfer on proportionality grounds?

## How P-001 is enforced

Four enforcement layers:

### Layer 1 — Code review

Every contract change is reviewed for extraction surface. Reviewers trained to spot proportionality violations.

Example: a proposed mechanism that grants admin 0.1% fee on every transaction — reviewer flags as potential extraction. Requires justification on proportionality grounds before accepting.

### Layer 2 — Correspondence Triad

Per [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md) Check 2 (augmentation not replacement): mechanisms that replace markets with intermediaries are flagged. Intermediaries often enable extraction.

Design-gate catches extraction at the architecture level.

### Layer 3 — Governance scope

Governance cannot vote to create extractive mechanisms because P-001 is constitutional. A proposed extractive mechanism would be rejected at contract level (fairness invariants would fail).

### Layer 4 — External audit + community vigilance

Public audits specifically test against P-001 as a correctness criterion. Community can flag suspected extraction for tribunal review.

Post-deployment detection is the last line of defense.

## Why this is marketable

Sophisticated investors know that DeFi extraction is common. They've seen Terra, FTX, and many others. They want confidence that the project they back won't drift into extraction.

P-001 as an explicit, constitutional commitment provides that confidence. It's auditable — anyone can verify the mechanisms respect the axiom.

When asked "how is VibeSwap different from [X competing protocol]?":
- Most protocols: "we have [specific feature Y]." Competes on features.
- VibeSwap: "we have a constitutional commitment against extraction that the architecture structurally enforces." Competes on trust.

Trust at this level is rare in DeFi. It's a differentiator.

## Why this is ethically important

Extraction is theft at the architectural level. The ethical argument:

- Users trusted the system with their value.
- The system extracted disproportionately.
- The difference is theft (regardless of whether it's legal).

P-001 is the commitment to not steal. Not because it's illegal; because it's wrong.

This matches users' intuitions. Users know when they've been extracted from. Over time, extractive protocols lose their user base. P-001-aligned protocols retain trust.

## What P-001 does NOT claim

- Does not claim the protocol is free to run — gas fees exist; they're not extraction.
- Does not claim zero-fee trading — LP fees are proportional compensation.
- Does not claim all participants benefit equally — Shapley is proportional, not equal. Inequality can be large when contributions are large.

The axiom is specific: *no mechanism extracts disproportionate to value created*. Proportionate transactions are fine.

## Relationship to the tagline

"A coordination primitive, not a casino."

Casinos extract by design. They are the canonical example of extraction-as-business-model. The tagline positions VibeSwap as the OPPOSITE — infrastructure for cooperative value-routing, not extraction.

The axiom operationalizes the tagline at the architectural level.

## Relationship to ETM

Under [Economic Theory of Mind](etm/ECONOMIC_THEORY_OF_MIND.md), cognitive extraction (attention-capture, engagement-farming, shame-based addiction loops) is the cognitive-economy pathology.

P-001 is the on-chain constitutional commitment that the externalized economy doesn't replicate these pathologies. If VibeSwap allowed extraction, it would be a faithful reflection of the broken attention-economy — which would disprove ETM's generative value. By prohibiting extraction structurally, VibeSwap demonstrates the cognitive economy CAN run without extractive pathologies if re-built with correct invariants.

## For students

Exercise: pick a crypto / DeFi project you know. Identify any extraction patterns:

1. Who pays what to whom?
2. What value is created at each transfer?
3. Is the transfer proportionate to the value?

Apply this analysis to:
- A DEX (fees to LPs + protocol).
- A lending platform (interest split).
- A governance token (voting rewards + delegations).
- An NFT marketplace (creator royalty + platform fee).

Classify each transfer as: transaction, ambiguous, or extraction.

## Relationship to other primitives

- **Sibling axiom**: [Lawson Constant / P-000](../research/proofs/LAWSON_CONSTANT.md) — attribution is structural. Positive statement. P-001 is the negative (no extraction).
- **Enforcer**: [Augmented Governance](../architecture/AUGMENTED_GOVERNANCE.md) — Physics > Constitution > Governance hierarchy. P-001 sits in Constitution layer.
- **Consequence**: [GEV Resistance](security/GEV_RESISTANCE.md) — P-001 applied to the full category of extraction surfaces.

## One-line summary

*P-001: no mechanism may extract value disproportionate to what it creates. Constitutional, not negotiable — extraction is categorically disallowed. Five historical extraction cases (Early DEX fee creep, Terra/Luna, FTX, Uniswap V3 concentration, Tornado Cash governance) show what VibeSwap avoids. Four enforcement layers (code review, Correspondence Triad, governance scope, external audit) structurally protect the axiom.*
