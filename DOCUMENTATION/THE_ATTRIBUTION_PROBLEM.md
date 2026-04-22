# The Attribution Problem

**Status**: Analysis. Where VibeSwap's attribution design differs from prior attempts, and where it still has gaps.

---

## The problem

In any cooperative production system — open-source software, DAOs, science, art — credit assignment is fundamental. Who gets paid? Whose reputation grows? Whose proposal has standing? These are not secondary questions; they determine whether the cooperative production continues.

Naive systems fail in specific ways:
- **Equal splits** — under-pay early contributors, over-pay latecomers, destroy incentive for hard initial work.
- **Winner-take-all** — pay only who ships code, ignoring design, research, dialogue, operations.
- **Popularity / upvote** — concentrate in visible contributors, miss load-bearing invisible work.
- **Dictator decides** — vulnerable to capture by whoever the dictator trusts.

Every DeFi-era attempt (SourceCred, Gitcoin, Optimism RetroPGF, CoordiNape) has tried to solve this. None has fully solved it. This doc is honest about where VibeSwap's approach differs and where it inherits unsolved problems.

## What VibeSwap tries

Four mechanisms composed:

### 1. Shapley over cooperative game

[Shapley distribution](./SHAPLEY_REWARD_SYSTEM.md) is the unique credit assignment satisfying symmetry, efficiency, dummy-irrelevance, and additivity. Under cognitive-production-as-cooperative-game, Shapley IS the correct answer — per [ETM Mathematical Foundation](./ETM_MATHEMATICAL_FOUNDATION.md).

**Strength**: axiomatically fair.
**Weakness**: requires a well-defined characteristic function `v(S)` for each coalition — hard to compute empirically for real projects.

### 2. Lawson Constant / attribution preservation

[Lawson Constant](./LAWSON_CONSTANT.md) enforces that attribution is structural, not decorative. Forks that strip attribution break computation.

**Strength**: architectural, not discretionary.
**Weakness**: only enforces that attribution can't be stripped; doesn't compute what the attribution should be in the first place.

### 3. Three-branch attestation

[ContributionAttestor](./CONTRIBUTION_ATTESTOR_EXPLAINER.md)'s executive/judicial/legislative flow means no single branch can capture attribution.

**Strength**: resists any single-branch capture.
**Weakness**: doesn't resist cross-branch coordinated capture (founders who also control tribunal juries and can swing governance votes).

### 4. Chat-to-DAG Traceability

[Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) captures non-code upstream attribution (dialogue, framing, design). Makes the cognitive flow legible on-chain.

**Strength**: enables attribution for work that prior systems couldn't reach.
**Weakness**: requires discipline at the upstream step — missing Source fields break the chain.

## What remains unsolved

Honest accounting of where VibeSwap's stack still has attribution gaps:

### Gap 1 — The characteristic function `v(S)`

Shapley needs `v(S)` for every coalition. In practice this is estimated via marginal-contribution heuristics (how much would the outcome degrade without contribution X?), but the estimate is subjective. Two reasonable observers can disagree on v(S) by 20-50%, which moves final rewards substantially.

**VibeSwap mitigation**: use attestations + tribunals + governance to converge on `v(S)` through social computation. Doesn't eliminate the subjectivity — makes it legible and auditable.

**Not solved**: no mechanism can compute `v(S)` objectively.

### Gap 2 — Collusion among attestors

High-trust founders coordinating attestation weights can move almost any claim past threshold, regardless of merit. The three-branch escalation helps but isn't fireproof.

**VibeSwap mitigation**: heterogeneous branches (executive is peer-weighted, judicial is tribunal-random-jury, legislative is quadratic-voted); collusion that works in one branch often doesn't work in the others.

**Not solved**: enough determined attackers with enough coordination can still bias outcomes.

### Gap 3 — The "unseen but necessary" work

A contributor who quietly prevents five bugs is load-bearing but invisible. The attribution loop only fires when work is surfaced via commit / issue / measurable artifact. Negative-space contributions (not breaking things, staying out of fights, preserving continuity) go uncredited.

**VibeSwap mitigation**: `[Dialogue]` issue templates, `[Meta]` issues for process contributions. Doesn't fully capture unseen work.

**Not solved**: the epistemological problem of crediting what didn't happen.

### Gap 4 — Temporal discounting

A contribution from 2022 that enables a contribution in 2026 — how much credit does 2022-contributor get? Current Shapley treats them equally in cooperative-game math, but inflation and PoM decay may have reduced their on-chain record.

**VibeSwap mitigation**: parent-attestation links (`parentAttestations[]` in [ContributionAttestor](./CONTRIBUTION_ATTESTOR_EXPLAINER.md)). Downstream attestations can cite upstream, partially reconstituting the lineage. The retroactive backfill mechanism in Traceability targets this specifically.

**Not solved**: truly deep lineage (2010s → 2030s → 2050s) needs attribution infrastructure that survives substrate changes.

### Gap 5 — External vs. internal contributions

Someone who writes a paper that inspires a VibeSwap mechanism deserves attribution. But they're not in the ContributionDAG and may be uninterested in on-chain identity. How do you credit them?

**VibeSwap mitigation**: Source field accepts non-chain-bound identifiers (@handle, @anonymous, "Paper: X, Y, Z"); when a contributor claims chain-bound address later, retroactive link is possible.

**Not solved**: unclaimable attribution (e.g., someone who refuses on-chain participation forever) stays as recorded but never accrues value.

## Why not just copy RetroPGF

Optimism's RetroPGF distributes funding retroactively based on measured impact. It's the most serious prior attempt.

Differences:
- **RetroPGF** happens in discrete quarterly rounds with bounded budget; attribution is one-shot per round.
- **VibeSwap** attributes continuously via attestations; no round-gate.

- **RetroPGF** uses voters to score projects; voters are trusted signers.
- **VibeSwap** uses weight-from-DAG × three-branch attestor; capture-resistance is architectural.

- **RetroPGF** is not formally Shapley.
- **VibeSwap** is Shapley-over-the-cooperative-game; has axiomatic justification that RetroPGF doesn't.

The differences are real. VibeSwap could still fail at scale (any new mechanism could). The claim is it fails in different ways, fails slower, and fails with more diagnostic information when it does.

## Why attribution is the hardest DeFi problem

All DeFi primitives ultimately bottom out in "who gets paid?". Lending: who gets paid interest? AMM: who gets paid LP fees? MEV: who should get extracted value redistributed? Insurance: who gets paid claims?

Attribution is the upstream question whose answer settles all downstream distribution. Get attribution right, everything else follows. Get attribution wrong, no amount of clever mechanism design downstream can compensate.

This is why VibeSwap spends outsize effort on attribution infrastructure (ContributionDAG + ContributionAttestor + Traceability + Lawson Constant + Shapley). The investment is proportional to how much downstream depends on it.

## What we still need

1. **Better `v(S)` estimators** — machine-learning-derived marginal-contribution estimators from similar cooperative-production datasets.
2. **Anti-collusion primitives** — random-subset attestor selection, commit-reveal attestation voting.
3. **Dark-work surfacing** — habit of attesting preventive work (deferred issues closed, design memos that narrowed scope, operational labor).
4. **Long-arc lineage** — preservation of attribution across substrate changes (see [Mind Persistence Mission](./MIND_PERSISTENCE_MISSION.md)).

Each of these is an open research direction, not a solved problem.

## One-line summary

*Attribution is the hardest DeFi problem; VibeSwap composes Shapley + Lawson + three-branch + Traceability to approach it; prior systems have failed in specific ways and VibeSwap's stack has specific remaining gaps — honest accounting is part of the architecture.*
