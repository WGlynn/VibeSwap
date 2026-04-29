# USD8 ← VibeSwap — Partner Supplements

**Purpose**: this folder contains four deep supplements adapted from the VibeSwap codebase and content corpus for USD8 audience-readability. They complement, but do not replace, the partner deliverables already shared (initial concepts brief, Cover Pool Shapley spec, marketing-mechanism-design memo, history-compression spec, cooperative-game-elicitation-stack research paper, boosters-NFT audit).

The supplements here address questions that came up after the initial brief was sent and that warranted standalone treatment rather than inclusion in further new specs.

---

## What's in this folder

### `augmented-mechanism-design-usd8.md`

The methodology supplement. Names the design philosophy underneath USD8's existing copy ("incentives are carefully aligned using capitalism and game theory") and gives the team a concrete checklist for designing future mechanisms in the same register. Four invariant types (structural, economic, temporal, verification) with USD8-specific examples for each, plus three real USD8 mechanisms that compose multiple invariant types as worked examples. Adapted from `vibeswap/DOCUMENTATION/AUGMENTED_MECHANISM_DESIGN.md`.

**Read this first** if you want to understand the methodological frame the other supplements descend from.

### `augmented-governance-usd8.md`

The governance-architecture supplement. Walks through the three-layer authority hierarchy (Physics > Constitution > Governance) that defends USD8 against the failure mode that has destroyed every prior decentralized stablecoin. Includes three specific governance-capture scenarios with the augmented response in each (Cover Pool fee redirect, treasury drain, coverage parameter manipulation). Extends the Walkaway Test commitment from operational continuity to institutional continuity. Adapted from `vibeswap/DOCUMENTATION/AUGMENTED_GOVERNANCE.md`.

**Read this** if you want to make the governance-capture defense story explicit and external-reviewer-defensible.

### `fairness-fixed-point-cover-pool.md`

The convergence-analysis supplement. Addresses the load-bearing question any insurance team should ask before adopting Shapley-based reward distribution: *over many rounds of yield distribution, does the Cover Pool drift toward early-LP capture, or does it stabilize at a fair equilibrium?* The honest answer separates what is proven (existence of fixed points), what is conjectured with strong reason (uniqueness and stability), and what should be monitored empirically. Walks through a concrete 3-LP scenario over 60 months. Adapted from `vibeswap/DOCUMENTATION/THE_FAIRNESS_FIXED_POINT.md`.

**Read this** if your team or external reviewers ask whether iterated Shapley is structurally fair, not just round-by-round fair. The answer is "yes, with three architectural caveats, and here is the math."

### `portable-primitives-menu.md`

The contracts-side reference. A systematic inventory of `vibeswap/contracts/` ranked by portability to USD8. Eight HIGH-portability primitives (most notably CircuitBreaker, VerifiedCompute, TWAPOracle, IssuerReputationRegistry — none of which were in the prior partner deliverables), five MEDIUM-portability primitives, four already-proposed primitives listed for completeness, and a transparent list of what was deliberately not recommended with reasons. Per-primitive: location, USD8 use case, port classification, effort estimate, audit posture.

**Read this** when your team is ready to start picking which primitives to adopt and in which order. The recommended priority sequence is at the end.

---

## How these relate to the partner deliverables already shared

The earlier deliverables (PDFs on Will's side) are the primary specs. The supplements here are the deeper context that makes the specs more defensible.

| Earlier deliverable | Supplement that deepens it |
|---|---|
| `initial-concepts.pdf` (5-concept brief) | All four supplements deepen the corresponding concepts |
| `shapley-fee-routing-spec.pdf` (Cover Pool Shapley spec) | `fairness-fixed-point-cover-pool.md` answers the iterated-fairness question; `portable-primitives-menu.md` lists the underlying contract |
| `history-compression-spec.pdf` (Cover Score history compression) | `portable-primitives-menu.md` covers the IncrementalMerkleTree and related primitives |
| `marketing-mechanism-design.pdf` (strategic memo) | `augmented-mechanism-design-usd8.md` provides the protocol-side parallel to the marketing-side primitives |
| `cooperative-game-elicitation-stack.pdf` (research paper) | `fairness-fixed-point-cover-pool.md` is the application of the elicitation-stack to a specific iterated-fairness question |
| `boosters-nft-audit.pdf` (TRP audit) | `portable-primitives-menu.md` cites the audit-history of each portable primitive |

There is no replacement here — every supplement strengthens an existing deliverable rather than substituting for it.

---

## Suggested reading order for Rick's team

Different team members will care about different supplements. A reasonable ordering by role:

**For the protocol architects** (Rick + technical co-founders):
1. `augmented-mechanism-design-usd8.md` — the methodology
2. `augmented-governance-usd8.md` — the governance architecture
3. `portable-primitives-menu.md` — the integration menu

**For external reviewers / auditors**:
1. `fairness-fixed-point-cover-pool.md` — the iterated-fairness analysis
2. `augmented-governance-usd8.md` — the formal-properties argument
3. `portable-primitives-menu.md` — the audit-posture per primitive

**For implementation engineers**:
1. `portable-primitives-menu.md` — what to lift, in what order, with what effort estimate
2. `augmented-mechanism-design-usd8.md` — the methodology to apply when designing wrappers and adapters

**For partner / business team**:
1. `augmented-governance-usd8.md` — the governance-capture-resistance story (this is the differentiating defensible claim USD8 can make)
2. `augmented-mechanism-design-usd8.md` — the methodology behind everything else

---

## Voice and register

All supplements match the manifesto-academic register established in the existing partner deliverables. Each ends with a one-line summary and an explicit pointer back to the longer VibeSwap canonical treatment for readers who want maximum depth.

The supplements are partner-facing, not internal. They cite VibeSwap source as "the longer treatment" rather than as our codebase, because the substance is the math and the architecture rather than the specific repository.

---

## Status

These supplements are working drafts offered for refinement under critique. Specific phrasings, examples, and emphasis can shift based on feedback. The core architectural claims are stable and inherit the audit history of the VibeSwap implementation.

If your team wants additional depth on any specific topic, or wants any of these supplements rewritten in a different register (more academic, more accessible, more presentation-grade), the source material is well-indexed in the VibeSwap `DOCUMENTATION/` folder and we can produce the variants on request.

---

*Folder maintained by William Glynn with primitive-assist from JARVIS. Source materials at `vibeswap/DOCUMENTATION/` (content corpus) and `vibeswap/contracts/` (code surface), both in the public VibeSwap repository.*
