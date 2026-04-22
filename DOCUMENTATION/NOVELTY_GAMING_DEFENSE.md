# Novelty Gaming Defense

> *Any reward function can be gamed. Point-per-kill games produce kill-stealing; citation-count incentives produce citation rings; novelty-weighted Shapley produces pseudo-novelty. Before shipping Gap #2, we must map the attack space.*

This doc catalogs attacks on novelty-weighted Shapley (Gap #2, C41-C42) and the defenses VibeSwap employs. It's an adversarial companion to [`TIME_INDEXED_MARGINAL_CREDIT.md`](./TIME_INDEXED_MARGINAL_CREDIT.md) and [`SIMILARITY_KEEPER_DESIGN.md`](./SIMILARITY_KEEPER_DESIGN.md).

## Why novelty gaming matters

Gap #2's novelty multiplier creates a financial incentive to appear novel. The mechanism is as strong as its defense against false novelty. Without defenses, incentives reverse: contributors optimize for AI-detectable novelty rather than genuine insight.

Adversarial game-theoretic: what can a malicious contributor do to inflate their novelty score? How do we prevent each attack?

## Attack catalog

### Attack 1: Obfuscation

A contributor copies prior art and obfuscates the language (synonyms, paraphrasing, reordering) to make embedding similarity low.

Example: Alice publishes insight X. Bob copies Alice's insight, rewords it, and publishes as Bob's insight. Embedding similarity: 0.3 (low). Novelty multiplier: 1.7x (high). Bob gets elevated credit for near-redundant content.

Defense: **semantic embeddings, not surface embeddings.** `all-mpnet-base-v2` trains on semantic-similarity pairs — rephrased versions of the same meaning map to similar vectors. Bob's paraphrase still has cosine similarity ~0.85 to Alice's.

Residual risk: extremely skilled paraphrasing might fool the embedding. Mitigation: human spot-check + attestor review.

### Attack 2: Dimension padding

Contributor adds irrelevant content to dilute the semantic center. Adding 500 words of filler around a core idea shifts the embedding centroid.

Example: Bob's paper is "X [plus 3 pages of tangential background reading]." Embedding similarity to Alice's "just X" is lower due to the background content's contribution.

Defense: **anchor on the key claim, not the full document.** Contributions include a `subjectHash` field (see [`ATTESTATION_CLAIM_SCHEMA.md`](./ATTESTATION_CLAIM_SCHEMA.md)) that binds the claim to specific content. Similarity computation uses the claim's core content, not surrounding padding.

Residual risk: defining "core content" is fuzzy. Mitigation: governance-approved content summarization methods; attestor review for borderline cases.

### Attack 3: Temporal gaming

Contributor observes prior art, then submits their work with a FALSIFIED earlier timestamp (e.g., by backdating through a malicious keeper).

Defense: **on-chain timestamps are block timestamps.** Can't be backdated. The similarity keeper reads block timestamps, not user-provided timestamps. This attack is structurally prevented.

### Attack 4: Sybil rings

Contributor creates 10 accounts. Each account submits similar content near-simultaneously. When any of them gets credit, the others claim "we were first too" and the cost of individual novelty is spread.

Defense: **Sybil-resistance via SoulboundIdentity.** Attestations require SBT. Creating 10 SBTs requires 10 distinct KYC/proof flows (or whatever gate the SBT uses). This attack is bounded by SBT issuance friction.

### Attack 5: Keeper collusion

Contributor bribes the similarity keeper to return favorable scores. Contributors willing to pay get 2.0x multiplier regardless of actual similarity.

Defense: **commit-reveal of similarity function + lazy verification.** Per [`COMMIT_REVEAL_FOR_ORACLES.md`](./COMMIT_REVEAL_FOR_ORACLES.md), the function is publicly committed. Anyone can re-compute any score using the committed function. If the keeper produces a score inconsistent with the committed function, slashing happens.

Residual risk: attestor might collude AND decide not to enforce. Mitigation: multi-keeper consensus (future); anyone can challenge and earn slashed bond as reward.

### Attack 6: Prior-state manipulation

Contributor manipulates the "prior state" perceived by the keeper. If the keeper reads state from a specific source, and that source can be manipulated...

Example: contributor A posts low-quality content on a parallel forum. The similarity keeper considers the forum as "prior state." When A publishes on VibeSwap, similarity to this forum content is high. A appears not-novel.

Defense: **prior-state is defined as VibeSwap's own content DAG**, not external sources. External similarity doesn't factor in. This limits the attack surface to VibeSwap's own state, which is cryptographically anchored.

### Attack 7: Early-publication arbitrage

Contributor publishes half-baked ideas early to claim priority, then develops them later with bonuses.

Example: Bob publishes "X might be true" in January (low quality, high novelty → 2.0x multiplier). In June, Bob publishes "X is true and here's why" (same subject, high quality, lower novelty due to Bob's own prior → only 1.2x). Total: 2.0 × (Jan reward) + 1.2 × (June reward).

Compare to: Bob publishes "X is true with full argument" in June only: 2.0 × (June reward).

Early-publication arbitrage shifts rewards backward in time. Bob gets more total rewards by publishing early+later than by publishing once.

Defense: **this isn't actually gaming.** Bob's early "X might be true" is genuinely novel. His later "here's why" is genuinely less novel (he already posted it). The mechanism correctly credits both contributions.

If this creates noise (half-baked content floods the DAG), governance can increase content-quality requirements or attestor-review standards.

### Attack 8: Cross-domain gaming

Novelty computed within a domain. Contributor uses multi-domain submission to claim novelty in each domain independently.

Example: Alice's insight applies to both code and governance. Alice publishes twice — once to code-domain DAG, once to governance-domain DAG. In each, similarity to prior domain-state is low (the other domain hasn't seen this idea). Two 2.0x multipliers.

Defense: **cross-domain awareness.** The similarity keeper can be configured to compute similarity to the GLOBAL state (all DAGs), not just the current domain's. Trade-off: cross-domain computation is more expensive.

Hybrid: global similarity dominates; domain-specific similarity contributes a smaller term.

## The bug-bounty approach

Novel attacks will emerge. VibeSwap sets a formal bug-bounty for novelty-gaming:

- Submit a proof-of-concept attack.
- If reproducible and the defense breaks, receive bounty (tokens + reputation).
- Bounty submissions routed through ContributionAttestor with special claim type.

This institutionalizes adversarial review. The protocol pays to discover its own weaknesses.

## Detection metrics

Governance monitors:
- Distribution of novelty multipliers over time. Shifting distributions may indicate gaming.
- Correlation between novelty score and contributor's token holdings. If wealthier contributors get higher novelty scores, possible keeper collusion.
- Handshake patterns around high-novelty claims. Sybil rings show up as tight clusters.

Dashboards publish these metrics. Anomalies trigger investigations.

## Slashing responses

Detected gaming → slashing:

- Tier 1 (attempted gaming, caught): Warning + 10% bond slash. Attestations from attacker marked suspect.
- Tier 2 (repeated or severe): 50% bond slash + attestation pool removal.
- Tier 3 (catastrophic, e.g., keeper corruption): Governance slash + potentially full bond burn.

## Relationship to Lawson Floor

The Lawson Floor (see [`THE_LAWSON_FLOOR_MATHEMATICS.md`](./THE_LAWSON_FLOOR_MATHEMATICS.md)) ensures replicated contributions still receive credit. This is sometimes attacked as "replicators gaming the floor." Defense:

- Lawson Floor multiplier is low (0.2x). Replication is credited but much less than original.
- High volume of pure replication would require many accounts (Sybil cost dominates).
- Replication-only contributors have low aggregate Shapley shares due to multiplier.

The Lawson Floor doesn't open a gaming surface — it prevents legitimate replicators from being zero'd.

## Student exercises

1. **Design a novel attack.** Think adversarially. What attack on novelty-weighted Shapley haven't I listed? Spec it + propose a defense.

2. **Quantify Sybil cost.** If creating an SBT costs $X, what's the break-even for running 10 Sybil accounts if each earns $Y in novelty bonuses? Work out the inequality.

3. **Design the detection dashboard.** Three most-important metrics for monitoring novelty-gaming. Sketch UI.

4. **Bug-bounty payout structure.** Given a bounty fund of Z, how do you price POC attacks by severity? Tier the bounties.

5. **Legitimate vs gaming edge case.** A contributor's approach feels like gaming but is technically within rules. Describe such a case. Propose how governance should handle.

## Philosophy: gaming as signal

Some level of gaming attempts is inevitable. The goal is not zero gaming but asymmetric cost: gaming should be MORE EXPENSIVE than legitimate contribution.

If the mechanism achieves this, the mechanism is robust. Occasional successful gaming is tolerated as noise; systematic gaming is detected and slashed.

## Future work — concrete code cycles

### Queued as part of C41-C42

- **Keeper slashing logic** — in CommitRevealOracle, add slashing path for inconsistent scores. File: `contracts/oracle/CommitRevealOracle.sol`.

- **Sybil-resistance gating** — require SBT for high-value novelty claims. Low-value claims may bypass (to avoid chilling casual contributions).

### Queued for un-scheduled cycles

- **Bug-bounty program** — formal program for submitting attacks. Governance vote + reputation pool.

- **Multi-keeper M-of-N** — require keeper consensus on high-stakes scores.

- **Cross-domain similarity** — extend keeper to compute global similarity, not just per-domain.

### Primitive extraction

If multiple novelty-gaming defenses emerge, extract to `memory/primitive_novelty-gaming-defense.md`.

## Relationship to other primitives

- **Time-Indexed Marginal Credit** — the target mechanism.
- **Similarity Keeper Design** — the infrastructure this defends.
- **Commit-Reveal For Oracles** — the primary defense.
- **Lawson Floor Mathematics** — floor prevents zero-replication rewards.
- **Adaptive Immunity** (memory primitive) — failure → gate → immunity loop. Each detected attack becomes a new defense.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Exposes the attack surface.
2. Queues specific defense implementations.
3. Proposes bug-bounty as institutionalized adversarial review.

Every successful attack report becomes a new code cycle. The mechanism evolves through adversarial pressure.

## One-line summary

*Novelty Gaming Defense catalogs 8 attacks on Gap #2 novelty-weighted Shapley (obfuscation, padding, temporal, Sybil, keeper collusion, prior-state manip, early-publication arbitrage, cross-domain) and specifies defenses. Asymmetric-cost goal: gaming costs > legitimate-contribution cost. Bug-bounty institutionalizes adversarial review.*
