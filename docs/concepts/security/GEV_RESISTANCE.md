# GEV Resistance — The Architecture

**Status**: Positioning doc with walked attack → mitigation scenarios.
**Audience**: First-encounter OK. Each GEV class walked with concrete attacker intent + defense.

---

## The framing that changes everything

You've probably heard of **MEV — Maximal Extractable Value**. It's the profit a block producer can extract by choosing transaction ordering. DeFi accepts MEV as a permanent fixture; projects like Flashbots and MEV-boost tax and redistribute it.

Here's the trick: MEV is only ONE KIND of extraction. Many other extractions exist.

- A trader with early information about an oracle update extracts value.
- A malicious operator changing fees ahead of user trades extracts value.
- A governance participant who bribes other voters extracts value.
- A frontend operator who shows you a slightly-worse exchange rate extracts value.

All of these are the same underlying pattern: someone with positional or informational advantage extracts value disproportionate to what they created.

**GEV — Generalized Extractable Value — is the full class.** MEV is one instance.

The DeFi industry obsesses over MEV because it's been measured and named. It mostly ignores other GEV because they're harder to measure and they've lacked a unifying term.

VibeSwap is architected to prevent the CATEGORY, not just the specific instance.

## Why this reframing matters

If you design a protocol to be "MEV-resistant," you focus on block-ordering attacks. You might add encrypted mempools, private orderflow, or threshold encryption. The specific attack is blocked.

But the attacker moves to a different extraction vector. Oracle manipulation. Admin-setter drift. Flash-loan attacks. Informational asymmetry. Each is a distinct GEV variant. Your MEV-only defense doesn't address them.

Result: a protocol claiming "MEV-resistant" often has unaddressed extraction surfaces elsewhere.

VibeSwap's architecture aims for GEV-resistance. Every extraction surface has a math-enforced mitigation. When an attacker tries one, they hit a wall. They try another — another wall. They try a less-obvious vector — still a wall.

## Walk through eight specific attacks

Let me walk through specific attacks attackers actually try. For each, the concrete scenario + VibeSwap's defense.

### Attack 1 — Block-ordering MEV (sandwich attack)

**Attacker intent**: see a large buy order pending in the mempool. Front-run it (buy before it executes) and back-run it (sell after the price rises due to the victim's trade). Extract the slippage.

**Traditional defense**: encrypted mempools, private orderflow. Partial.

**VibeSwap's defense**: [commit-reveal batch auction](../oracles/TRUE_PRICE_ORACLE_DEEP_DIVE.md). All orders in a batch commit before any reveal. Orders in the same batch clear at the same uniform price. Fisher-Yates shuffle on XORed secrets determines any ordering needed.

Result: the attacker can't see the victim's intent during commit phase. Can't front-run (doesn't know the victim's order). Can't back-run (same batch pricing; no slippage to capture).

Mathematically impossible within a batch. Structural invariant.

### Attack 2 — Oracle manipulation

**Attacker intent**: move the oracle price temporarily to exploit a liquidation threshold or AMM price. Profit from the temporary mis-pricing.

**Historical example**: the Mango Markets exploit (Oct 2022) — manipulated MNGO oracle via low-liquidity markets. ~$100M extracted.

**VibeSwap's defense**: commit-reveal oracle aggregation ([`OracleAggregationCRA`](../oracles/TRUE_PRICE_ORACLE_DEEP_DIVE.md)). Multiple operators submit hash(price) commitments; reveal; aggregate via median. No single operator can manipulate because they commit before seeing others.

Plus fork-aware EIP-712 domain separator (C37 work): if an attacker gets a signed oracle update from a forked chain, it won't validate on the real chain.

### Attack 3 — Flash-loan attack

**Attacker intent**: borrow a huge amount atomically (flash loan), use it to distort pool prices, execute another op that profits from the distortion, repay the loan. All in one transaction. Risk-free if successful.

**Historical example**: multiple flash-loan attacks have drained $100Ms across DeFi. Cream Finance, Beanstalk, etc.

**VibeSwap's defense**:
- Same-block interaction guard in AMM — contract tracks whether the same user has interacted this block.
- TWAP validation — trades execute at TWAP-anchored prices; large deviations revert.
- K-invariant preservation in the AMM — liquidity pool invariants checked on every trade.

Result: flash-loan-driven price distortion fails the k-invariant check. Transaction reverts.

### Attack 4 — Admin-setter drift

**Attacker intent**: a privileged admin changes parameters (e.g., fee schedule from 0.3% to 0.5%) seconds before user trades. Users' trades execute at worse rates; admin captures the difference.

**Traditional defense**: multisig + timelock. Helpful but still requires trust.

**VibeSwap's defense**: [`AdminEventObservability`](./ADMIN_EVENT_OBSERVABILITY.md). Every privileged setter emits `XUpdated(prev, current)` event. Off-chain dashboards alert on any change. Users can abort trades if admin changes fire immediately before their transaction.

Plus timelock on high-sensitivity parameters (governance-required for major changes).

Result: admin drift becomes legible in real-time. Not prevented structurally but made transparent + contestable.

### Attack 5 — Proposal-order gaming in governance

**Attacker intent**: in governance, whoever proposes first anchors the outcome. Strategic proposers time their submissions for maximum bias.

**Traditional defense**: first-past-the-post voting. Vulnerable.

**VibeSwap's defense**: quadratic voting. Diminishes returns for coordinated voting. Plus constitutional axioms (P-000, P-001) that override governance outcomes if they'd violate fairness.

Plus the Constitutional order (Physics > Constitution > Governance per [`AUGMENTED_GOVERNANCE.md`](../../architecture/AUGMENTED_GOVERNANCE.md)). Governance can't override mathematical invariants via voting.

Result: proposal-ordering matters less because governance scope is constrained.

### Attack 6 — Dispute-escalation capture

**Attacker intent**: in challenge-response systems, repeatedly escalate disputes. Defender runs out of resources first.

**Historical example**: some optimistic rollups have been attacked this way at small scale.

**VibeSwap's defense**: paper-§6.5-sized bonds + 50/50 slash splits + Compensatory Augmentation. The economics are sized so challenger's loss exceeds gain.

Plus [`ClawbackCascade`](./CLAWBACK_CASCADE_MECHANICS.md) for recovery if extraction does occur.

Result: challengers price out of frivolous attacks.

### Attack 7 — Shapley extraction

**Attacker intent**: fake contributions to claim disproportionate Shapley share.

**VibeSwap's defense**:
- Three-branch attestation ([`CONTRIBUTION_ATTESTOR_EXPLAINER.md`](../identity/CONTRIBUTION_ATTESTOR_EXPLAINER.md)) requires peer-validation at Executive, adjudication at Judicial, or supreme override at Legislative.
- Fractal Shapley preserves fairness axioms even across sub-games.
- Lawson Constant anchors attribution structurally.

Result: fake contributions fail all three branches. Real contributors attest; fake ones can't get attestations through.

### Attack 8 — Sybil via fake contributions

**Attacker intent**: create many pseudo-identities to inflate attestation weight or Shapley share.

**VibeSwap's defense**: [`SoulboundIdentity`] (Sybil-resistant identity). Plus OperatorCellRegistry requires bond per cell (10e18 CKB); N fake identities cost N × bond.

Sybil attackers have to actually pay to create each identity. Attack cost scales with attack size.

Result: Sybil becomes economically unprofitable.

## The full GEV-resistance table

| Extraction surface | VibeSwap mitigation | Invariant type |
|---|---|---|
| Block-ordering MEV | CRA + uniform price + Fisher-Yates shuffle | Structural + Temporal |
| Frontrunning visible mempool | Commit-reveal window | Temporal |
| Oracle manipulation | OracleAggregationCRA + fork-aware EIP-712 | Verification + Structural |
| Flash-loan attacks | Same-block guard + TWAP + k-invariant | Structural |
| Admin-setter drift | AdminEventObservability + timelock | Verification |
| Proposal-order gaming | Quadratic voting + constitutional order | Structural |
| Dispute-escalation capture | Paper-sized bonds + 50/50 splits | Economic |
| Shapley extraction | Three-branch attestation + Lawson Constant | Structural + Verification |
| Sybil contributions | SoulboundIdentity + OperatorCellRegistry bonds | Economic + Temporal |
| Frontend-operator middle-attack | Trustless price discovery + multiple frontends | Structural |

Each row is a distinct extraction vector with a specific mitigation.

## What the competition doesn't do

- **CoW Swap**: MEV-resistant via batch auctions. Doesn't address oracle, admin-setter, dispute-escalation GEV. Category: partial MEV coverage.
- **Flashbots**: taxes MEV, doesn't eliminate it. Still vulnerable to oracle + admin GEV. Category: MEV redistribution.
- **Sealed-bid orderflow auctions**: fix frontrunning on specific channels. Leave informational asymmetry elsewhere.
- **Private mempools**: shift extraction surface from block-producer to mempool-operator. Same pattern, different beneficiary.

VibeSwap is the first DEX built to eliminate GEV as a category. Not by solving each attack individually (though it does), but by ensuring EVERY extraction surface has a specific math-enforced mitigation.

## Why this is marketable

When a sophisticated investor asks "how is this different from [X competing DEX]?":

- Most answers: "we have [specific feature X]." Narrow differentiation.
- VibeSwap's answer: "we address extraction as a CATEGORY, not per-instance. X addresses block-ordering MEV. Y addresses oracle. Z addresses flash-loans. We address all nine identified GEV surfaces with specific structural mitigations. Here's the table."

The table is the differentiation.

## Why this is ethically important

GEV is value extracted from users by operators with positional advantages. Each extracted dollar is a dollar the user lost to the operator's better information/positioning. Over time, users notice. Protocols that extract repeatedly lose their user base.

VibeSwap's commitment to P-001 ([`NO_EXTRACTION_AXIOM.md`](../NO_EXTRACTION_AXIOM.md)) isn't just slogan. It's structural: the architecture has no extraction surfaces to leverage.

Users can trust the protocol to not extract from them. That's a competitive advantage over casino-style DeFi.

## The Composition Algebra connection

Each of these attacks maps to the composition analysis ([`MECHANISM_COMPOSITION_ALGEBRA.md`](../../architecture/MECHANISM_COMPOSITION_ALGEBRA.md)):

- Structural invariants compose orthogonally (Case A) or serially (Case B).
- Economic invariants compose additively — multiple defenses stack costs on attacker.
- Temporal invariants overlap — attackers face multiple time-constraints.
- Verification invariants AND — attackers must forge ALL.

The layered defense is deliberately multi-invariant. Attackers have to defeat ALL relevant invariants to succeed. Most can't defeat even one.

## Relationship to ETM

Under [Economic Theory of Mind](../etm/ECONOMIC_THEORY_OF_MIND.md), GEV is the cognitive-economy analog of *attention capture* — agents extracting resources disproportionate to value created via positional advantage.

The cognitive substrate has defenses: memory decay of bad actors, trust-score compounding against extractors. VibeSwap implements these defenses at the chain layer.

GEV-resistance is ETM applied to economic security. Not a marketing concept; an ETM-aligned architectural commitment.

## For students

Exercise: pick a DeFi protocol you know. Identify its extraction surfaces. For each:

1. What's the attack intent?
2. What's the current defense (if any)?
3. Would a VibeSwap-style mitigation work?
4. What invariant type does that mitigation belong to?

Compare to VibeSwap's 10-row GEV table. Note: many protocols don't map to all rows because they don't address all extraction surfaces.

## Relationship to other primitives

- **Parent**: ETM — extraction is a cognitive-economy pathology.
- **Substrate**: [No Extraction Axiom](../NO_EXTRACTION_AXIOM.md) — the constitutional commitment enforced by GEV-resistance.
- **Instances**: specific mechanisms referenced above (CRA, Oracle, Siren, etc.).

## One-line summary

*MEV is one instance of extraction; GEV is the category. VibeSwap's architecture addresses GEV as a category via ten specific extraction-surface-mitigation pairs (sandwich attack → CRA; oracle manipulation → CommitReveal Aggregation; flash loans → k-invariant; admin drift → Event Observability; etc.). Every extraction vector has a math-enforced invariant closing it. Competitors address subsets; VibeSwap addresses the category.*
