# The Attribution Problem

**Status**: Honest analysis of the hardest problem in cooperative-production systems.
**Audience**: First-encounter OK. Historical failures named concretely.

---

## The problem, framed through history

In 1960s-70s science, researchers argued over who deserves Nobel Prize credit for specific discoveries. DNA structure (Watson, Crick, Franklin, Wilkins). RNA interference (Fire, Mello... and many collaborators disputed). String theory breakthroughs (many contributors, few laureates).

In 2010s open source, similar disputes: Linux kernel contributors who did 30% of the work got 1% of recognition. GitHub star-count favored charismatic founders over quiet maintainers. Early-stage contributors to projects like Ethereum got less visible credit than later-VCs who funded ecosystem growth.

In 2020s DeFi, multiple attempts at "contribution attribution" have been made:

- **SourceCred** (~2019-2022): tried quantitative attribution via upvotes + GitHub metadata. Went through many iterations; ultimately didn't achieve wide adoption.
- **Gitcoin Passport + grants** (~2020-present): quadratic-funding rounds to distribute grant money based on public attestations. Helpful but partial.
- **Optimism RetroPGF** (~2023-present): retroactive grants committee-voted. Higher-profile successes but still limited scope.
- **CoordiNape** (~2020-2022): peer-to-peer allocation. Requires manual coordination; doesn't scale.

Each is a partial solution. None established full end-to-end attribution-as-infrastructure.

Why is this so hard?

## The five gaps

Attribution has at least five specific gaps that no mechanism has fully closed. VibeSwap's approach addresses each to varying degrees; this doc is honest about remaining debt.

### Gap 1 — The characteristic function is unknowable in general

Shapley distribution requires computing `v(S)` for every subset S. In real projects, "what would this specific coalition have produced?" is a counterfactual that nobody knows.

**Concrete example**: Alice wrote a design doc. Bob wrote the implementation. Without Bob, the design might have been implemented by someone else (less well). Without Alice, Bob might have designed his own (perhaps differently). What's v({Alice, Bob}) vs v({Alice}) vs v({Bob})?

Three reasonable observers produce estimates differing by 2x. The Shapley computation propagates these differences.

**VibeSwap mitigation**: use attestations + tribunals + governance to converge on v(S) through social computation. Legible and auditable, but doesn't eliminate the subjectivity.

**Remaining gap**: 10-30% estimation error per contributor. Multiple observers help reduce but can't fully close.

### Gap 2 — Collusion among attestors

Attestors weighted by trust-score can coordinate to bias outcomes.

**Historical example**: 1970s academic citation rings — authors citing each other's papers to inflate apparent impact. Crossed administrative boundaries; hard to prevent.

**Contemporary example**: bot-driven upvote rings in Reddit/Twitter. Coordinated up-voting of low-quality content to amplify it.

**VibeSwap concern**: high-trust founders coordinating attestation weights. Can move almost any claim past threshold.

**VibeSwap mitigation**: three-branch heterogeneous attestation (executive, judicial, legislative). Collusion in one branch doesn't capture the others.

**Remaining gap**: enough determined attackers with enough coordination can still bias outcomes. Fundamentally, attestation depends on attestor honesty.

### Gap 3 — The "unseen but necessary" work

A contributor who quietly prevents bugs is load-bearing but invisible. The attribution loop only fires when work is surfaced; negative-space contributions go uncredited.

**Historical example**: Margaret Hamilton's software for Apollo 11. Her rigorous error-checking code prevented a critical mission failure. Her contribution was invisible to most observers at the time. Recognized decades later.

**Contemporary example**: Linux kernel maintainers who spend hours on bug-triage. Never a commit, no visibility. Essential work.

**VibeSwap mitigation**: `[Dialogue]` issue templates, `[Meta]` issues for process contributions. Makes some negative-space recordable.

**Remaining gap**: the epistemological problem of crediting what didn't happen.

### Gap 4 — Temporal discounting

A contribution from 2022 that enables a contribution in 2026 — how much credit does 2022-contributor get?

Under plain Shapley: equal (permutation symmetric). Ignores temporal priority.

Under Novelty Bonus (see [`THE_NOVELTY_BONUS_THEOREM.md`](../theorems/THE_NOVELTY_BONUS_THEOREM.md)): 2022 gets priority bonus. Better.

But even then: if the 2022 contribution is forgotten by 2032, no one is left to credit it. Lineage fades.

**Historical example**: foundational papers in computer science. Tony Hoare's quicksort paper (1960s) informed every algorithm textbook since. Hoare's contribution is credited in one-time awards but isn't compensated per-citation.

**Contemporary example**: Satoshi Nakamoto's whitepaper. Early-network contributor, unidentified. Massive ongoing influence on every blockchain, yet no ongoing compensation.

**VibeSwap mitigation**: parent-attestation links. Downstream attestations can cite upstream, partially reconstituting the lineage. Retroactive backfill addresses this explicitly.

**Remaining gap**: truly deep lineage (2020s → 2050s → 2080s) needs attribution infrastructure that survives substrate changes. This is what [The Long Now of Contribution](./THE_LONG_NOW_OF_CONTRIBUTION.md) addresses.

### Gap 5 — External vs. internal contributions

Someone who writes a paper that inspires a VibeSwap mechanism deserves attribution. But they're not in the ContributionDAG.

**Historical example**: Nash's equilibrium papers (1950s) underpin much modern mechanism design. Nash never participated in any specific DeFi project but informs all of them. How do you credit him?

**Contemporary example**: a VibeSwap design idea informed by a Twitter DM from someone who doesn't hold crypto. They deserve credit; they won't claim it.

**VibeSwap mitigation**: Source field accepts non-chain-bound identifiers. When the contributor claims chain-bound address later, retroactive link is possible.

**Remaining gap**: unclaimable attribution (e.g., someone who refuses on-chain participation) stays as recorded but never accrues value.

## Why prior attempts failed

Let's look at specific failures to understand what VibeSwap must avoid.

### SourceCred's limits

SourceCred tried to quantify contribution via GitHub event streams + weighted social signals. Ran into several problems:
- Events are easily gamed (spam commits, automated activity).
- Weighted social signals (likes, reactions) have low signal-to-noise.
- The "cred" output was illegible to many contributors.

VibeSwap learns: use cryptographic commitment to events (evidence-hash), not just event counts. Use Shapley-weighted math that's interpretable.

### RetroPGF's limits

Optimism's retroactive-public-goods-funding uses committee voting. Effective for high-profile projects; struggles with:
- Small/niche contributions that don't reach committee attention.
- Voter biases toward visible projects.
- Committee rotation + turnover creates inconsistency.

VibeSwap learns: use multi-branch attestation with explicit constitutional axioms; avoid pure committee-dependence.

### Gitcoin Grants' limits

Quadratic funding distributes based on small-donor-count. Effective for funding diversity; struggles with:
- Sybil attacks (fake donors) can bias quadratic calculations.
- Governance capture of grant categories.
- Short-duration grants don't compound long-arc contribution.

VibeSwap learns: pair Sybil resistance with persistent attribution. Grants are one-shot; attestation is continuous.

### CoordiNape's limits

Peer-to-peer allocation requires coordination + trust. Works for small groups; struggles with:
- Scaling beyond ~20 people.
- Power dynamics affecting allocations.
- Lack of cross-group comparability.

VibeSwap learns: mechanize the allocation via Shapley + trust-graph. Groups of any size work.

## The composition VibeSwap attempts

VibeSwap's attribution stack combines multiple mechanisms:

1. **Chat-to-DAG Traceability** ([doc](../../concepts/identity/CONTRIBUTION_TRACEABILITY.md)): captures non-code upstream attribution.
2. **ContributionAttestor** ([doc](../../concepts/identity/CONTRIBUTION_ATTESTOR_EXPLAINER.md)): substrate for claim-based attestation with three-branch resolution.
3. **Shapley Distribution** ([doc](../../concepts/shapley/SHAPLEY_REWARD_SYSTEM.md)): axiomatically-fair reward distribution.
4. **Lawson Constant** ([doc](../proofs/LAWSON_CONSTANT.md)): attribution preserved structurally.
5. **Lawson Floor** ([doc](../proofs/THE_LAWSON_FLOOR_MATHEMATICS.md)): low-novelty contributors still receive economic acknowledgment.
6. **Novelty Bonus** ([doc](../theorems/THE_NOVELTY_BONUS_THEOREM.md)): temporal priority is rewarded.
7. **ContributionDAG** ([doc](../../concepts/identity/CONTRIBUTION_DAG_EXPLAINER.md)): trust-weighted verification of attestations.

Each addresses part of the attribution problem. Together they're the most complete stack anyone has built.

## Why attribution is the hardest DeFi problem

All DeFi primitives ultimately bottom out in "who gets paid?". Lending: who gets paid interest? AMM: who gets paid LP fees? MEV: who should get extracted value redistributed?

Attribution is the upstream question whose answer settles all downstream distribution. Get attribution right, everything else follows. Get attribution wrong, no clever mechanism design downstream can compensate.

This is why VibeSwap spends outsize effort on attribution infrastructure. The investment is proportional to how much downstream depends on it.

## What we still need

Research directions, not yet solved:

### Direction 1 — Better v(S) estimators

Machine-learning-derived marginal-contribution estimators trained on similar cooperative-production datasets. 2025+ work.

### Direction 2 — Anti-collusion primitives

Random-subset attestor selection. Commit-reveal attestation voting. Reduce cartel efficiency. 2026-2027 target.

### Direction 3 — Dark-work surfacing

Habit of attesting preventive work (deferred issues closed, design memos that narrowed scope, operational labor). Partly cultural, partly mechanism.

### Direction 4 — Long-arc lineage preservation

Substrate-independent preservation of attribution. See [`MIND_PERSISTENCE_MISSION.md`](../../concepts/ai-native/MIND_PERSISTENCE_MISSION.md) + [`THE_LONG_NOW_OF_CONTRIBUTION.md`](./THE_LONG_NOW_OF_CONTRIBUTION.md).

Each is an open research direction. VibeSwap doesn't solve all of them. It makes honest progress on each and names the unsolved portions clearly.

## The honest framing

VibeSwap's attribution stack isn't claimed to be complete. It's claimed to:

1. Be the best current attempt (substantively addresses all five gaps).
2. Fail in different ways than prior systems (diversified risk).
3. Fail with more diagnostic information (auditable failure modes).
4. Improve over time (research directions are explicit, not implicit).

That's a defensible position. It's not "we solved attribution". It's "we attempted attribution seriously, here's what works and what's still open."

## For students

Exercise: pick a real historical attribution dispute (Nobel, patent, paper authorship). Analyze it through the 5-gap lens:

1. Which gap(s) caused the dispute?
2. Could VibeSwap's stack have resolved it? How?
3. What gap(s) remain unaddressed?

This exercise teaches that attribution is complex, historical, and genuinely hard.

## Relationship to other primitives

- **Root cause**: [Lawson Constant](../proofs/LAWSON_CONSTANT.md) — attribution as structural. The axiom this problem exists to satisfy.
- **Infrastructure**: [Chat-to-DAG Traceability](../../concepts/identity/CONTRIBUTION_TRACEABILITY.md) — workflow capturing attribution at source.
- **Substrate**: [ContributionAttestor](../../concepts/identity/CONTRIBUTION_ATTESTOR_EXPLAINER.md) — on-chain ledger of claims.
- **Distribution**: [Shapley Reward System](../../concepts/shapley/SHAPLEY_REWARD_SYSTEM.md) + Novelty Bonus + Lawson Floor — fair distribution based on attribution.

## One-line summary

*Attribution is the hardest DeFi problem — five identified gaps (v(S) unknowable, collusion, unseen work, temporal discounting, external contributions). Historical failures (SourceCred, RetroPGF, Gitcoin, CoordiNape) illustrate what doesn't work. VibeSwap composes Lawson Constant + Traceability + three-branch attestation + Shapley + Lawson Floor + Novelty Bonus + ContributionDAG — most complete stack anyone has built, but honest about remaining debt.*
