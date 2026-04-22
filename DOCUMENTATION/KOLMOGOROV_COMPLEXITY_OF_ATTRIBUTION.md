# Kolmogorov Complexity of Attribution

**Status**: Information-theoretic analysis. What's the minimum description length for a reconstructable attribution chain?
**Depth**: Formal lower bounds with practical storage/retrieval implications.
**Related**: [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md), [The Long Now of Contribution](./THE_LONG_NOW_OF_CONTRIBUTION.md), [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md).

---

## The question

Attribution chains ([Chat-to-DAG Traceability](./CONTRIBUTION_TRACEABILITY.md)) accumulate over time. Alice's 2026 insight → Bob's 2028 design → Carla's 2030 implementation → ... Each link requires some amount of information to encode the causal dependency.

What's the minimum information needed to reconstruct an N-link attribution chain? Can we encode it compactly enough that a 50-year chain remains navigable? What are the information-theoretic storage costs and retrieval costs?

These aren't merely academic. Chain length × cost-per-link determines whether VibeSwap's attribution infrastructure is sustainable at decade-plus timescales.

## Kolmogorov complexity refresher

The Kolmogorov complexity K(x) of a string x is the length of the shortest program that outputs x. It's the formal lower bound on lossless compression.

For attribution chains, K tells us: given all the metadata, what's the minimum information needed to reconstruct the causal-dependency graph exactly? Anything less loses information; anything more is redundant.

Practical consequence: we can't compress attribution below K(chain). We CAN design the attribution format to have low K(chain) by choosing what to include and what to reference-only.

## The structure of an attribution link

A single attribution link (one claim) contains:

- Contributor address (20 bytes)
- ContributionType enum (1 byte — but really ~3-4 bits needed for 9 values)
- evidenceHash (32 bytes — a commitment to off-chain content)
- description string (variable — typically 50-200 bytes)
- value (32 bytes)
- timestamp (8 bytes)
- parentAttestations[] (variable — 0 or more 32-byte hashes)
- claimId (32 bytes — derived; could be recomputed)

Naive storage per link: ~200-500 bytes. N-link chain at average 300 bytes: 300 × N bytes.

For N = 10,000 (decade of modest contribution): 3 MB. Easily affordable.

For N = 1,000,000 (multi-decade high-volume): 300 MB. Still tractable but starting to matter for full-node storage.

For N = 1,000,000,000 (long-arc global scale, multiple successor projects): 300 GB. Tractable for archives, prohibitive for on-chain storage.

Storage-per-link is critical at large N. The format must be minimal.

## What's compressible

Several parts of the attribution format have structure we can exploit:

### Structure 1 — Repeated contributors

The same contributor address appears across many claims. A 20-byte address repeated 10,000 times is 200 KB; a 4-byte address-table-index repeated 10,000 times plus a 20-byte table entry per unique contributor is 40 KB + 200 × unique-count bytes. For ~1000 unique contributors: 60 KB. ~3x savings.

### Structure 2 — Time ordering

Claim timestamps are monotonic by block ordering. Storing deltas from previous timestamp instead of absolute timestamps: 4 bytes (per-claim delta) vs 8 bytes (absolute). 2x savings.

### Structure 3 — Parent-attestation patterns

parentAttestations frequently reference recent claims rather than distant ones. Index-from-recent instead of full 32-byte hash: 4 bytes (index) vs 32 bytes (hash) per parent. ~8x savings for chained attributions.

### Structure 4 — Description similarity

Description strings often have repeated structure ("Issue #N — <title>"). Template-based encoding with fill-ins: ~50-80% compression on descriptions.

### Combined

Naive: ~300 bytes/link. Compressed: ~40-60 bytes/link for typical patterns. 5-7x savings.

Post-compression: N = 10^9 chain becomes ~50 GB. Still large but within archival feasibility.

## The irreducible minimum

What can't we compress?

- The evidenceHash (32 bytes) is cryptographically-committed; can't compress without breaking the commitment.
- The value (32 bytes) has high entropy in general (different rewards for different contributions); some compression possible via delta-encoding against averages but limited.
- The contribution structure itself (what depends on what) has structural entropy determined by the actual graph; can't go below the information needed to reconstruct the graph.

Realistic lower bound: ~40 bytes/link for the structural components + the evidenceHash. Below this, we lose reconstructability.

## The retrieval-cost trade-off

Compressed storage has two modes:

### Mode 1 — Read-intensive

Every retrieval decompresses. Cheap to write (just append compressed link); expensive to read (decompress + look up). Good if writes >> reads.

### Mode 2 — Write-intensive

Every write maintains a decompressed "hot" copy alongside the compressed archive. Expensive to write (maintain both); cheap to read (hot copy is directly accessible). Good if reads >> writes.

VibeSwap's pattern is predominantly read-intensive at decade timescales: claims are written rarely (contributions per contributor) and read often (retrieval for every governance vote, Shapley round, audit).

Implication: Mode 1. Compressed archive + decompression on read. The cost of decompression is a per-read cost, which scales with retrieval count.

## The path-query cost

Navigating an attribution chain from node N back to its originating Source means:

- Look up N's parentAttestations (1 read)
- For each parent, recurse
- Terminal condition: parent list is empty (Source-level attribution)

In the worst case, a contribution's full lineage depth could be O(log total-claims) — because each claim cites O(1) parents and the tree branches. Practically, lineage depth for a typical claim is 1-10 hops, not 100.

A query for full lineage of a claim: ~10 reads × ~5 ms/read = ~50 ms. Acceptable for one-off queries.

For bulk analyses (e.g., "compute all Shapley values in a round"), the read cost can be substantial:

- N claims to process.
- Each requires lineage lookup (~10 reads × ~5 ms).
- Total: N × 50 ms.

For N = 10,000: 500 seconds = 8 minutes. Tolerable.

For N = 1,000,000: 50,000 seconds = 14 hours. Problematic.

Bulk analysis at large N needs either bulk indexing (materialize a summary) or pagination (process N in chunks).

## The archival problem

On-chain storage is expensive. A 300-byte claim at ~20 gwei = ~$0.03 in gas on Ethereum L1 (2024 prices). For 10^6 claims: $30,000 in just-writing fees. Too expensive for bulk attribution.

Solution: most claims live on cheaper substrates (L2, IPFS, dedicated sidechain) with L1 anchoring via Merkle roots. The commitment anchor makes the archival content tamper-evident; the actual data lives where storage is cheaper.

This is already the pattern in [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md): evidenceHash commits the off-chain artifact; the artifact itself lives off-chain.

Scaling to long-arc: the anchor substrate must also scale. L1 Ethereum's scaling roadmap (rollups, danksharding) suggests this is viable for the next 10-20 years. Beyond, substrate migration may be necessary — hence [Mind Persistence Mission](./MIND_PERSISTENCE_MISSION.md)'s emphasis on substrate-independence.

## The Kolmogorov bound on chain length

Claim: the maximum reconstructable chain length is bounded by total information capacity of the archival substrate.

At ~40 bytes/claim compressed, 50 GB storage holds ~1.25 × 10^9 claims. This is roughly the total contribution count at current human-scale over a century — feasible.

Above this, we must either:
- Accept partial-reconstructability (some chains are lost; some attributions become unverifiable).
- Compress harder (lossy, if we can afford it).
- Scale storage substrates commensurately.

The Kolmogorov bound tells us what's theoretically possible. Engineering tells us what's practically affordable.

## The dignity-of-storage argument

There's an ethical flavor: if VibeSwap's attribution promises to contributors are on the order of "your contribution is remembered forever", the storage cost to honor that promise is real. A protocol that collects attributions and then garbage-collects them at 10 years is breaking an implicit commitment.

This is not free: honoring the promise requires sustained storage budget. Budget comes from either protocol treasury, state-rent fees, or a purpose-specific endowment. The economic-sustainability question is non-trivial.

VibeSwap's CKB-native state-rent model ([Three-Token Economy](./THREE_TOKEN_ECONOMY.md)) provides a partial answer: claims that continue earning attestation-weight continue paying their own rent. Claims that don't earn fresh attestations over time get evicted. Survival-of-the-fittest applied to attribution.

This is actually desirable: it means the chain naturally prunes to the claims that continue to matter. Attribution-length decay is not a failure; it's a feature that keeps storage tractable while preserving the most-load-bearing attributions.

## The temperature metaphor

Think of attribution as having a "temperature" — hot claims (recently attested, frequently cited, actively paid rent on) stay in active storage. Warm claims (occasionally referenced) migrate to slower but cheaper storage. Cold claims (no fresh activity) can be archived or evicted.

Three-tier storage:
- **Hot** (on-chain): ~10^5 recent claims. Cheap read, expensive write.
- **Warm** (L2 anchored): ~10^7 mid-age claims. Moderate cost both ways.
- **Cold** (IPFS archive + Merkle commitment): ~10^9 historical claims. Cheap write, expensive read but rarely needed.

Eviction from hot → warm → cold is natural. Re-activation (hot again) on renewed attestation is also natural. This matches the cognitive-economic model of memory: recently-used facts are cheaply accessible; long-dormant facts are expensive to retrieve but not lost.

## Relationship to ETM

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognitive memory has the same temperature-tiered structure. Working memory = hot; episodic long-term = warm; implicit procedural = cold. Retrieval cost scales with temperature.

VibeSwap's three-tier storage is the on-chain mirror of cognitive temperature-tiering. Same dynamics, different substrates. The ETM bijection holds at this layer too.

## Open questions

1. **What's the optimal compression scheme for attribution-chain bytecode?** Something beyond generic gzip that exploits the graph structure.
2. **How do we handle attributions that span storage tiers?** If a warm claim cites a cold parent, retrieval spans tiers — need caching strategy.
3. **What's the right eviction policy?** Random expiration? Attestation-weight-based? Activity-based? Each has tradeoffs.

These shape the long-arc feasibility of VibeSwap's attribution stack.

## One-line summary

*Attribution chains have irreducible information cost ~40 bytes/link; at compressed ~50 GB total they hold 10^9 claims (centuries of human-scale contribution); three-tier hot/warm/cold storage keeps retrieval tractable — matches cognitive-memory temperature-tiering per ETM.*
