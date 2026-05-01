# Entropy Preservation in the DAG

**Status**: Information-theoretic fidelity analysis with concrete N-bit accounting.
**Audience**: First-encounter OK. Entropy concept introduced from scratch.

---

## Start with a question about recordings

You record a concert. You can:

**Option A — Full-fidelity audio**: lossless recording preserves every acoustic detail. Files are huge. You need expensive storage.

**Option B — Compressed audio**: mp3 or similar. Most people can't tell the difference. Files are much smaller.

**Option C — Summary notes**: just write down "Concert on Tuesday; the piano solo in middle was great." Files are tiny.

Each preserves LESS information than the previous. But which is "enough"?

Depends on use case. If you want to re-experience the concert, Option A is needed. If you want to remember it, Option B suffices. If you want to prove the concert happened, Option C is fine.

Information theory quantifies this trade-off. This doc applies it to attribution chains.

## Entropy, plainly

**Entropy** = the information content of a thing. Measured in bits.

More formally: entropy is the minimum number of bits needed to describe something uniquely.

- A coin flip: 1 bit (heads or tails).
- A die roll: log₂(6) ≈ 2.6 bits.
- A specific word from a 10,000-word dictionary: log₂(10,000) ≈ 13.3 bits.
- A specific book of 80,000 words from the 10,000-word vocabulary: 80,000 × 13.3 ≈ 1 million bits (~128 KB).

Entropy is NOT the size of the thing. It's the minimum size of any description that uniquely identifies it. A wall-colored-white video is huge in bytes but has low entropy (same color every frame).

## Attribution chains as entropic objects

An attribution chain is a graph of contributions. Each contribution is a node. Each parent-reference is an edge. Each node has metadata.

What's the entropy of this graph?

### Structural entropy — the graph itself

The shape of the graph. Which contributions exist. Which ones cite which. Timestamps. Contributors.

For N contributions and average fan-in of p parents per contribution: structural entropy ≈ O(N × log N) bits.

For 10,000 contributions: ~10,000 × 14 = 140,000 bits ≈ 17 KB for structure.

### Content entropy — what each contribution IS

For each contribution: the actual content (document, commit, design). Typically much larger than structure.

For a 1000-word contribution: content entropy ~5,000 bits (log₂ of possible 1000-word sequences).

For 10,000 contributions averaging 1000 words each: ~50 million bits = 5 MB for content.

### The big difference

**Structural entropy scales as N × log N** (sub-linear in total bits).
**Content entropy scales as N × content_per_item** (linear in total bits).

Content dominates at scale. Structure is relatively cheap.

## What the DAG preserves losslessly

VibeSwap's DAG (ContributionDAG + ContributionAttestor) preserves STRUCTURAL entropy losslessly:

- Every contribution's contributor, type, timestamp, parent references, claim-status are all stored on-chain.
- Cryptographic commitments (evidenceHash) commit to content but don't store it.
- Trust-weights and attestations are indexed explicitly.

For the 10,000-contribution chain: ~17 KB structure, all on-chain. Preserved forever (subject to chain survival).

## What the DAG does NOT preserve losslessly

Content entropy is NOT preserved on-chain. Instead:

- Each contribution has an evidenceHash (32 bytes) committing to the content.
- The content itself lives off-chain (IPFS, GitHub, Arweave, etc.).
- If the off-chain content is lost, the commitment is orphaned — verifies nothing retrievable.

This is a deliberate choice. Storing 5 MB of content per chain on-chain is too expensive. Storing 32 bytes of commitment per contribution is affordable.

## The trade-off, quantified

### Scenario A — Preserve everything

Store both structure and content on-chain. 5 MB per 10,000-contribution chain. At ~$0.01/KB-year storage: ~$600/year. Expensive.

### Scenario B — Preserve structure, commit content

Store structure + evidence-hashes. 50 KB per 10,000-contribution chain. ~$6/year. Affordable.

### Scenario C — Preserve only summary

Store aggregate statistics. Very small. Not usable for fairness-verification (can't audit individual claims).

VibeSwap uses Scenario B. Structural entropy losslessly preserved; content entropy committed-but-not-retained.

## Why this trade-off works

The information needed to run Shapley distribution is STRUCTURAL. Shapley math needs:
- Who contributed.
- In what order.
- With what marginal value (estimated).
- Which were accepted.

All structural. Content entropy (the actual text of a contribution) is not needed for Shapley math. It's nice-to-have for auditability but not required.

So preserving structure + committing content is sufficient for the core mechanism. Lost content degrades auditability but doesn't break fairness computation.

## Where content-loss matters

### Case 1 — Retroactive re-adjudication

Alice claims "Bob's work built on my earlier contribution; I deserve partial credit."

If Alice's earlier contribution's content is lost, she can't prove the influence. Re-adjudication impossible; original distribution stands.

Mitigation: long-lived off-chain storage (Arweave, multiple IPFS replicas). Off-chain redundancy reduces but doesn't eliminate content-loss risk.

### Case 2 — Dispute resolution

A tribunal is evaluating a disputed claim. They need to see the original content to judge.

If lost, the dispute can't be resolved. Judgment defaults to status quo.

Mitigation: same — redundant off-chain storage + Merkle-anchored content that survives even when primary storage fails.

### Case 3 — Historical analysis

Researchers 20 years later want to understand the protocol's evolution. They need to read old contributions.

If content is lost, the history becomes skeletal — structure without texture.

Mitigation: periodic snapshots to long-term archives.

## The Merkle-chain preservation pattern

VibeSwap uses incremental Merkle trees for content integrity. Each content piece is a leaf; the root is published on-chain.

Later, anyone can prove "this content IS what was recorded at that time" by providing:
- The content itself.
- The Merkle path from the leaf to the root.
- The on-chain root.

If content is lost off-chain but the Merkle proof is kept, you can't reconstruct content but you can verify IF someone else holds a copy that their copy is authentic.

Partial preservation — commitment survives when content fades.

## The dignity-of-storage problem

A protocol that collects contributions and then loses them is breaking an implicit commitment. Contributors reasonably expect their work to be preserved.

Four tiers of preservation:

### Tier 1 — Structural (on-chain)

100% reliable. Survives chain-existence. ~17 KB per 10K-chain. Cheap.

### Tier 2 — Content on fast storage (IPFS, Arweave)

~95% reliable over 10 years. 5 MB per 10K-chain. Moderately expensive.

### Tier 3 — Content on cold archive

~99% reliable over 100 years. Requires active archive maintenance.

### Tier 4 — Content on multiple independent archives

~99.9%+ reliable. Redundancy reduces risk further.

VibeSwap's target: Tier 2 by default, Tier 4 for high-value claims. Good trade-off of cost vs. preservation.

## The eviction-is-correct argument

In cognition, memory decay is ADAPTIVE. Forgetting outdated information frees capacity for new learning.

Applied to DAG: should we plan for some contributions to fade from detailed storage over time? Yes.

Planned eviction:
- Hot storage: recent + actively-attested contributions. Full detail.
- Warm: middle-age, less-attested. Commitment + partial content.
- Cold: old, dormant. Commitment only.
- Eviction: claims that no longer earn attestations over long periods can be pruned.

This is deliberate information-management. Not catastrophic loss; adaptive forgetting.

## Natural vs. accidental loss

**Natural loss** (eviction via state-rent mechanism): deliberate. Claims that no longer earn fresh attestations pay the cost; those that do have their storage funded.

**Accidental loss** (off-chain content disappears from IPFS): undesired. Should be prevented via replication + archival.

Architecture prevents accidental loss while permitting natural eviction. Infrastructure difference, not just philosophical.

## For students

Exercise: compute entropy of a specific contribution chain.

- 100 contributions.
- Each has: contributor (from 10 possible), type (9 options), parent attestation count (0-3).
- Content averaging 500 bytes per contribution.

Compute:
1. Structural entropy per contribution (bits).
2. Content entropy per contribution.
3. Total for the chain.
4. Compare to on-chain storage required.

Observe: structure is cheap; content dominates.

## Relationship to ETM

Under [Economic Theory of Mind](etm/ECONOMIC_THEORY_OF_MIND.md), cognitive memory has temperature tiers: vivid episodic (high-entropy, short-lived), semantic generalizations (medium-entropy, medium-lived), procedural skills (low-entropy, long-lived).

The DAG's hot/warm/cold storage tiers mirror this. Cognition doesn't preserve entropy uniformly; it compresses over time. Same pattern.

## Relationship to other primitives

- **Companion**: [Kolmogorov Complexity of Attribution](../research/theorems/KOLMOGOROV_COMPLEXITY_OF_ATTRIBUTION.md) — Kolmogorov gives the storage lower bounds; entropy preservation is about which parts we keep.
- **Instance**: [ContributionAttestor](identity/CONTRIBUTION_ATTESTOR_EXPLAINER.md) — stores the structural layer.
- **Enabling**: [Chat-to-DAG Traceability](identity/CONTRIBUTION_TRACEABILITY.md) — captures source content that then goes to off-chain tiers.

## One-line summary

*The DAG preserves STRUCTURAL entropy losslessly (who, when, parents, claim-status) but COMMITS to content via evidenceHash rather than storing it. Structure is cheap (~17 KB per 10K chain); content is expensive (~5 MB). Four preservation tiers (on-chain, fast off-chain, cold archive, redundant). Deliberate eviction via state-rent is correct (matches cognitive memory temperature); accidental loss is prevented via redundant archival.*
