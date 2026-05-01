# Kolmogorov Complexity of Attribution

**Status**: Information-theoretic analysis with concrete compression examples.
**Audience**: First-encounter OK. Kolmogorov complexity introduced from scratch.

---

## An intuition from file storage

You have a 100 MB photo. You email it to a friend. The email takes 10 seconds.

You have a 100 MB video of a quiet wall. Same color throughout. You email it. The email takes 0.1 seconds because compression reduces it to a few KB.

Why the difference? The photo contains rich detail — each pixel is different. High "information content". The wall-video contains almost no detail — every frame is nearly identical. Low information content.

Information content is formal. It's called **Kolmogorov complexity**.

## Kolmogorov complexity, stated plainly

The Kolmogorov complexity `K(x)` of a string `x` is the length of the shortest program that outputs `x`.

Not the length of `x` itself — the length of the shortest description of `x`.

For the wall-video: K is tiny because "output 100MB of color C for each frame, for N frames" is a very short program.

For the photo: K is close to its length — there's no shorter description than the photo itself.

Kolmogorov complexity tells us: how much can this data be compressed, losslessly?

## Why this applies to attribution

Attribution chains are data. They live on-chain (expensive) or off-chain (cheaper). Either way, they have some information content. We want to know: can we store attribution chains efficiently?

If K(attribution) is small, we can compress. If K is large, we can't.

Let's figure out what K(attribution) looks like.

## The structure of one attribution

Per [`CONTRIBUTION_ATTESTOR_EXPLAINER.md`](./CONTRIBUTION_ATTESTOR_EXPLAINER.md), each claim has:

- Contributor address: 20 bytes.
- ContributionType enum: 1 byte (but really 3-4 bits needed for 9 values).
- evidenceHash: 32 bytes (cryptographic commitment).
- Description string: variable — typically 50-200 bytes.
- Value: 32 bytes.
- Timestamp: 8 bytes (unix epoch).
- Parent attestations: variable; 0 or more 32-byte hashes each.
- ClaimId: 32 bytes (derived, can be recomputed).

Naive storage per attestation: ~200-500 bytes.

For a 10,000-attestation chain: 2-5 MB.
For a 1M-attestation chain: 200-500 MB.
For a 10^9 chain (long-arc global): 200-500 GB.

The big question: how much can we compress?

## What can be compressed

### Compression 1 — Contributor address interning

Many attestations share contributors. If Alice attests 50 claims, her 20-byte address repeats 50 times = 1000 bytes.

With address interning: store the 20-byte address once, reference it via a 2-byte index 50 times = 120 bytes. ~8x compression for that part.

For a typical contribution graph with ~500 unique contributors and ~10000 attestations: address interning saves ~80% on the contributor field.

### Compression 2 — Timestamp delta encoding

Timestamps are monotonic (generally increasing). Instead of storing absolute 8-byte timestamps, store 2-byte deltas from previous.

A delta ranging from 0 to ~16 hours fits in 2 bytes. For most attestations, this works. For rare cases where the delta exceeds 16 hours, use a flag bit + extended encoding.

Savings: ~75% on the timestamp field.

### Compression 3 — Parent-attestation index-from-recent

Parent attestations frequently reference recent claims. Instead of storing 32-byte parent hashes, store 2-byte indices pointing to recent claims in the chain.

For typical chains where parents are within the last 10^6 claims: indices are 3-4 bytes.

Savings: ~8x per parent attestation.

### Compression 4 — Description templating

Many descriptions have common structure. "Issue #42 — Bug fix for X" appears thousands of times.

Template + fill-in: "{ISSUE_TEMPLATE} | 42 | Bug fix for X" where {ISSUE_TEMPLATE} is a 2-byte pointer to the template.

For typical chains with ~20 common templates: descriptions compress by 70-80%.

### Combined compression

Naive: 300 bytes/claim average.
After compression: ~40-50 bytes/claim for typical patterns.

Compression ratio: ~6-7x.

For 10^9 claims: 40-50 GB compressed. Still large but feasible for archival.

## What cannot be compressed

Some parts of the attestation structure have high intrinsic entropy:

### Incompressible 1 — evidenceHash

Cryptographic commitments are designed to be indistinguishable from random. 32 bytes of high-entropy data. No compression possible.

### Incompressible 2 — ClaimId

Derived from a hash; also high-entropy. Incompressible.

### Incompressible 3 — Large-value fields

If values are well-distributed (as they should be under proper Shapley), they can't compress well below ~20 bits precision. 32 bytes (256 bits) is over-allocated; 3-4 bytes suffices.

Savings: minor.

The incompressible parts floor at ~40 bytes/claim. Below this, you lose ability to reconstruct.

## The irreducible minimum

After all compression:

- ~2-4 bytes address-index + 1-2 bytes contribType + 2-4 bytes timestamp-delta + 32 bytes evidenceHash + 10-30 bytes description-template-plus-fill + 3-4 bytes parent-index + 2-3 bytes value.

Total: ~55-80 bytes/claim irreducible.

Less than that and we've lost reconstructability. The Kolmogorov lower bound for attribution is ~50 bytes/claim.

## The retrieval-cost trade-off

Compression has two costs:

### Cost 1 — Decompression latency per read

Every read requires decompression. For a lineage query walking back 10 hops: 10 decompressions × ~0.1 ms = ~1 ms overhead. Acceptable for interactive queries.

For bulk analysis (compute Shapley over 1M claims): 1M decompressions = 1000 seconds = 16 minutes. Possibly too slow.

### Cost 2 — Write-time complexity

Writing a compressed chain requires address-interning (lookup), timestamp-delta computation, parent-indexing, description-templating. Writes become ~2-3x slower.

Most chains are read-heavy (many reads per write). Compression is net-positive.

## Storage-tier architecture

For VibeSwap's long-arc storage, three tiers:

### Hot tier

~10^5 recent claims. Stored fully decompressed in on-chain state. Accessible in O(1) via mapping.

Cost: expensive per claim but few claims.

### Warm tier

~10^7 middle-age claims. Stored compressed but on readily-accessible L2 or sidechain. Decompression on read.

Cost: moderate both ways.

### Cold tier

~10^9 historical claims. Stored compressed on IPFS/Arweave. Merkle-commitments on-chain for verification.

Cost: cheap to store, expensive to retrieve but rarely needed.

Transition between tiers: claims that aren't recently-accessed migrate hot → warm → cold over time.

## Temperature analogy

Think of claims as having temperature:

- **Hot**: frequently accessed. In active cache.
- **Warm**: occasionally accessed. In nearby storage.
- **Cold**: rarely accessed. In archival.

Three-tier storage matches this temperature gradient.

Cognitive parallel: your working memory (hot), episodic long-term (warm), implicit procedural (cold). Same structure in cognitive substrate. Matches ETM's cognitive-economic mirror.

## For students

Exercise: compute the Kolmogorov complexity of some simple strings:

- "aaaaaaaaaa" (10 a's): K ≈ length of "print 'a' 10 times" ≈ very small.
- "2718281828": K = small ( e truncated).
- Random 10 characters: K ≈ 10 bytes (no compression).

Apply to attribution: imagine you're archiving 100 claims. Estimate:
- Naive storage size.
- Compressed storage size.
- Compression ratio.

Do the arithmetic by hand. Observe the savings.

## The dignity-of-storage argument

There's an ethical dimension to long-arc attribution storage. If the protocol promises contributors that their attestations are "remembered forever", the storage cost to honor that promise is real.

A protocol that collects attributions and then garbage-collects them at 10 years is breaking an implicit commitment.

VibeSwap's three-tier architecture + CKB state-rent model ([Three-Token Economy](./THREE_TOKEN_ECONOMY.md)) provides a sustainable answer:

- Hot tier claims stay on-chain with state-rent.
- Warm tier migrated to L2 + Merkle-anchored.
- Cold tier archived; retrievable but slow.
- Eviction happens only for unfunded claims whose state-rent can't be paid.

Claims that continue earning attestation-weight continue paying their own rent. Claims that don't earn fresh attestations over time eventually evict.

This is natural filtering: the chain keeps what continues mattering.

## Open questions

1. **Optimal compression scheme** — something beyond generic gzip exploiting graph structure specifically.
2. **Cross-tier caching** — when a warm claim cites a cold parent, retrieval spans tiers; what's the right caching strategy?
3. **Eviction policy** — activity-based? Attestation-weight-based? Random? Each has tradeoffs.

## One-line summary

*Attribution chains have irreducible storage floor ~40-50 bytes/claim after contributor-address interning + timestamp deltas + parent indexing + description templating. 10^9 claims → ~50 GB compressed. Three-tier storage (hot/warm/cold) mirrors cognitive memory temperature gradient per ETM. Natural eviction is correct — not a failure mode.*
