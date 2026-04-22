# Entropy Preservation in the DAG

**Status**: Information-theoretic fidelity analysis of contribution recording.
**Depth**: Does the DAG preserve the information of the contribution-stream, or is it lossy?
**Related**: [ContributionDAG Explainer](./CONTRIBUTION_DAG_EXPLAINER.md), [Kolmogorov Complexity of Attribution](./KOLMOGOROV_COMPLEXITY_OF_ATTRIBUTION.md), [The Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md).

---

## The question

Contributions enter VibeSwap's DAG as attestations. Each attestation carries metadata (contributor, type, evidenceHash, description, value). The DAG indexes this metadata and layers it with trust-scores and lineage.

When an auditor, a future contributor, or an off-chain analyst examines the DAG, how faithfully does the DAG preserve the information of what actually happened? Is the recording lossless, lossy-but-bounded, or lossy-unbounded?

Information-theoretically: what's the entropy of the actual contribution-stream, vs the entropy of what the DAG records? The difference is the loss.

## Why this matters

If the DAG is lossless: auditors can fully reconstruct the contribution history from DAG data. Attribution is honest.

If the DAG is lossy-but-bounded: some detail is lost but the load-bearing information (who contributed what, when, with what downstream effects) is preserved. Attribution is defensible.

If the DAG is lossy-unbounded: detail loss is unpredictable; some contributions are effectively erased over time. Attribution breaks.

Most DeFi attribution systems are lossy-unbounded because they didn't consider information theory at design time. VibeSwap's architecture aims for lossy-but-bounded with explicit loss accounting.

## The contribution-stream's entropy

Raw contribution-stream information per event:

- Who did it (identity of contributor): ~log₂(N_contributors) bits; for 10,000 contributors ≈ 14 bits.
- What they did (content of contribution): highly variable — a 1000-word memo is ~8,000 bits; a single code commit ~50,000 bits; a tweet ~300 bits.
- When (time): ~40 bits at second precision over a decade.
- Context (what prior state they were responding to): variable, depends on how much of the causal chain is relevant.

Total per contribution: dominated by content, typically 1,000 - 100,000 bits (125 bytes - 12 KB of raw information).

Over 10^4 contributions: 10^7 to 10^9 bits = 1.25 MB to 125 MB of raw information.

## The DAG's recording entropy

What the DAG actually stores per attestation:

- Contributor (address hash): 20 bytes = 160 bits.
- ContributionType (enum): 4 bits.
- evidenceHash (commits to off-chain content): 32 bytes = 256 bits.
- Description (short title, not content): ~50 bytes = 400 bits (typical).
- Value: 32 bytes = 256 bits.
- Timestamp: 8 bytes = 64 bits.
- Parent attestations: variable, typically 0-2 at 32 bytes each.

Total per attestation: ~200-300 bytes = ~1,600-2,400 bits on average.

This is substantially less than the raw contribution's information content. The DAG is committing to an evidenceHash of the content rather than the content itself — lossless for verification purposes (hash change = content change detected) but lossy for retrieval (the hash doesn't let you reconstruct the content).

## The off-chain tier

The DAG stores the commitment; the actual content lives off-chain. Ideal case: off-chain content is preserved; DAG's evidenceHash still verifies it; retrieval combines both.

Real case: off-chain content decays. Telegram messages get deleted. Private repos become inaccessible. IPFS content ages out. The commitment survives; the content doesn't.

When off-chain content is lost:
- The evidenceHash is orphaned — it verifies nothing retrievable.
- The attestation's "what was done" is now unknown.
- The attestation's value, contributor, lineage are still recorded.
- Partial information preserved; full reconstruction impossible.

This is lossy-but-bounded: we know what's lost (content) vs what's retained (structure).

## Structural vs content entropy

The DAG preserves structural entropy: the graph of who-contributed-to-what-when, with lineage. This is the lower-entropy, higher-durability slice of the original information.

The DAG loses content entropy: the specific words, code, design decisions of each contribution. This is the higher-entropy, lower-durability slice.

Is this the right tradeoff? Generally yes. The structural entropy is what powers the fairness math (Shapley needs structure, not content). The content entropy is nice-to-have for deep audits but not essential for rewards.

But the tradeoff has a failure mode: if you ever need to re-adjudicate a past reward (e.g., someone retroactively disputes attribution), you need the content. If the content is lost, re-adjudication is impossible.

## The Merkle-chain preservation pattern

Mitigation: anchor content-hash commitments in an incremental Merkle tree. `ContributionDAG` already does this (`getVouchTreeRoot`, `isKnownVouchRoot`). The Merkle-root evolves over time; any leaf can be Merkle-proven against a root captured historically.

Combined with off-chain archival (IPFS, Arweave, etc.), this gives: structural entropy permanent on-chain; content entropy probabilistically preserved off-chain with Merkle-verifiable integrity.

Realistic loss rate: ~5-20% of very-old content becomes unretrievable over 10+ years. Structural entropy loss: ~0% (on-chain is permanent given the chain survives).

## The "who cares" argument

A skeptic might say: why preserve entropy? Old contributions fade in relevance; the newest are what matters.

Counter-argument: the whole point of attribution is long-term. A contributor's 2026 insight may pay out in 2036 through downstream citations. If we erase the 2026 insight's structural record, we erase the citation chain; the 2036 payout has nowhere to route.

Under [The Long Now of Contribution](./THE_LONG_NOW_OF_CONTRIBUTION.md), attribution durability across decades is load-bearing. Structural entropy preservation is the key property.

## What breaks at low entropy

If DAG structural entropy drops substantially (e.g., due to aggressive pruning or storage limits), specific pathologies emerge:

- **Lineage inversion**: downstream contributions cite parents that no longer exist in DAG; lineage becomes orphans.
- **Fairness drift**: Shapley computation's v(S) estimation gets worse because the historical record used to calibrate is degraded.
- **Attribution disputes**: "I contributed X in 2028" — unverifiable because the record is partial.
- **Trust-graph degradation**: BFS-decay in trust scores computed from a degraded graph gives unrepresentative trust-levels.

Each pathology degrades the protocol's load-bearing properties. Preserving structural entropy is defensive infrastructure against these failures.

## The minimum viable entropy

What's the minimum structural entropy the DAG needs to preserve for fairness-math to function?

Per-attestation, the irreducible:
- Contributor (who): 160 bits.
- Timestamp (when): 64 bits.
- Parent reference (to what): 256 bits (hash) or ~20 bits (index-in-DAG).
- Type (in what mode): 4 bits.

Total: ~500 bits for 0-1 parent attestations, up to ~1000 for 2-3 parents. This is the non-negotiable core.

Beyond this (description, evidenceHash, value): valuable for audit and verification but not strictly needed for Shapley computation or graph navigation.

VibeSwap's current storage (~1600-2400 bits/attestation) is comfortably above this minimum. Substantial room for compression without crossing into loss-of-function.

## The forgetting-on-purpose angle

In cognition, forgetting is not purely a failure — some forgetting is adaptive (pruning outdated information frees capacity for new). [Cognitive Rent Economics](./COGNITIVE_RENT_ECONOMICS.md) models this via state-rent: info that can no longer fund its rent gets evicted.

Applied to DAG: should we plan for some contributions to fade from full-detail storage over time? Yes — but deliberately, not accidentally.

Deliberate fading:
- Hot storage for recent / actively-attested contributions.
- Warm storage for middle-age.
- Cold storage (commitment only, content archived externally) for old.
- Eviction from commitment only after content-replication to multiple archives.

Accidental loss:
- Content disappears from off-chain while commitment remains on-chain (orphaned commitment).
- Chain loses state during upgrade or substrate migration.
- Network splits and loses history.

Deliberate is fine; accidental is not. The infrastructure should be designed to prevent accidental while embracing deliberate.

## Entropy and iteration

Shapley iteration ([Fairness Fixed Point](./THE_FAIRNESS_FIXED_POINT.md)) depends on historical DAG structure. If entropy is preserved, iteration is stable. If entropy is lost (especially recent-past entropy), iteration becomes unstable because historical references dangle.

This is another reason to prefer deliberate-fading over accidental-loss: we control which information degrades, so we can ensure the recent-past remains fully-preserved while slightly-older content can tier to warm storage.

## Relationship to ETM

[Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md)'s cognitive-economy model has entropy tiers: vivid episodic memories (high-entropy, short-lived), semantic generalizations (medium-entropy, medium-lived), procedural skills (low-entropy, long-lived). Cognition doesn't preserve entropy uniformly; it compresses over time.

VibeSwap's tiered storage mirrors this. Fresh attestations get full-detail; aging attestations get structural-only. The entropy fade is gradual and controlled.

## Open questions

1. **Optimal tier-transition timing**: when should an attestation demote from hot → warm? Should it be time-based, attention-based, or rent-based?
2. **Content archival redundancy**: how many off-chain replicas are needed for acceptable content-preservation probability?
3. **Entropy-verification tools**: can we publish metrics about how much content is reachable from how old? Make the entropy fade auditable.

These inform the long-arc architecture.

## One-line summary

*The DAG preserves structural entropy (graph, lineage, trust) losslessly while committing to but not retaining content entropy; deliberate tier-based fading of old content is correct (matches cognitive memory per ETM), accidental loss is not — architecture prevents the latter.*
