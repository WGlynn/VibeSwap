# VibeSwap Off-Chain Storage Refactor

**Trigger**: Will, 2026-04-27, after USD8 history-compression-spec was corrected to off-chain-storage + on-chain-commitment: *"i agree vibeswap needs the same architecture to scale. good catch. immediate fix needed."*

**Cross-reference**: [`vibeswap/docs/usd8/history-compression-spec.md`](../partnerships/usd8/internal/history-compression-spec.md) — the USD8 spec is the architectural template; this doc applies the same template to VibeSwap's three highest-pressure on-chain-storage surfaces.

**Status**: refactor plan. Not blocking any current work. Phase 1 (indexer setup) requires zero contract changes.

---

## What this is

VibeSwap currently stores significant per-event state on-chain across three contracts. The design envelopes are appropriate for the current scale (curated contributors, low-thousands of vouches, dozens of attestations per claim), but they are explicit ceilings that will bind under Cognitive-Economy-Thesis adoption pressure. This document specifies the same off-chain-storage + on-chain-commitment refactor we just specified for USD8, applied to VibeSwap's specific contract surfaces.

Good news for sequencing: the contracts already emit per-event events. Phase 1 of the refactor is purely off-chain (set up indexer against existing events) and requires zero contract changes. Phases 2-4 are real upgrades and require staged rollout under VibeSwap's UUPS upgrade pattern.

---

## Section I — The three bottleneck surfaces

### 1. ContributionDAG.sol (686 LOC)

**On-chain storage**:
- `mapping(address => mapping(address => Vouch)) public vouches` — vouch struct + IPFS hash per directed edge
- `Handshake[] _handshakes` array + `mapping(bytes32 => uint256) _handshakeMap` for O(1) lookup
- `mapping(address => TrustScore) trustScores` — TrustScore includes full `address[] trustChain` array (path from founder)
- `IncrementalMerkleTree.Tree _vouchTree` — append-only audit trail

**Scaling markers (the explicit envelope)**:
- `MAX_TRUST_HOPS = 6` (line 48)
- BFS queue capped at 1024 nodes (line 285-287)
- `RECALC_COOLDOWN = 1 hour` (line 244) — prevents griefing of unbounded BFS
- Trust chain stored in full per scored user (O(hops) per scored entry)

**Where it breaks under load**:
- Vouch graph beyond ~1024 reachable nodes per recalc → BFS truncates
- Trust-chain memory allocation cost compounds with depth × users
- IncrementalMerkleTree at depth 20 = 1M leaves total → caps the audit trail

**What needs to move off-chain**:
- The vouch graph itself (vouches mapping)
- The handshake registry (handshakes array)
- The trust-score computation (BFS + chain storage)

**What stays on-chain**:
- Vouch event emissions (`VouchAdded`, `VouchRevoked`, `HandshakeConfirmed`, `HandshakeRevoked`) — these are the canonical source for off-chain reconstruction
- Per-snapshot commitment of trust-graph state (sparse Merkle root)
- Founder registry (small, bounded set)

### 2. ContributionAttestor.sol (508 LOC)

**On-chain storage**:
- `mapping(claimId => Attestation[])` — bounded by `MAX_ATTESTATIONS_PER_CLAIM = 50` (line 80)
- `mapping(claimId => Claim)` — claim state per claimId
- Tribunal jury state, governance escalation state

**Scaling markers**:
- `MAX_ATTESTATIONS_PER_CLAIM = 50` is an explicit cap
- `getCumulativeWeight(claimId)` is O(attestations.length) linear scan

**Where it breaks under load**:
- High-controversy claims requiring more than 50 attestors
- High claim volume (each claim's array storage compounds)

**What moves off-chain**:
- Attestation arrays themselves (bulk per-attestation data)
- Cumulative weight computation

**What stays on-chain**:
- Attestation event emissions (already present)
- Per-claim final-state commitment (claim resolution, tribunal verdict, governance override)
- Claim state machine transitions

### 3. GitHubContributionTracker.sol (342 LOC)

**On-chain storage**:
- `IncrementalMerkleTree.Tree _contributionTree` — depth 20 = 1M contributions
- `mapping(address => ContributorStats)` — per-contributor counters

**Scaling markers**:
- Depth-20 Merkle tree caps total contributions at ~1M
- ~40-55k gas per contribution insertion

**Where it breaks under load**:
- More than 1M total contributions
- High insertion frequency (gas burn on every recordContribution)

**What moves off-chain**:
- The contribution Merkle tree itself
- Per-contribution leaf storage

**What stays on-chain**:
- Contribution event emissions
- Per-snapshot tree-root commitment
- Replay protection (`processedEvents` mapping — small, bounded by event hash space)

---

## Section II — The refactor architecture

Same shape as USD8's history-compression-spec. Each of the three contracts gets:

- **Off-chain indexer layer**: ingest events from chain, reconstruct full state per-actor or per-claim. Sharded by actor address-prefix or claim ID-prefix for parallel processing.
- **On-chain commitment layer**: per-snapshot sparse Merkle root summarizing the off-chain state. Snapshotter posts root in single transaction (~50k gas).
- **Brevis-or-similar verification**: when on-chain consumers need to query the state (e.g., to check trust score for a vote), they submit a proof against the committed root. Proof verification is constant-time on-chain.

**Storage location pivots; mechanism designs do not.** The state machines, the rate-limited recalculation discipline, the replay protection, the founder registry, the per-claim resolution flow — all stay where they are. Only the bulk per-event data moves off-chain.

---

## Section III — Phased rollout

VibeSwap is live with deployed contracts. The refactor must be staged to preserve operational continuity and allow rollback at each phase.

### Phase 1 — Indexer infrastructure (no contract changes)

**Scope**: build sharded off-chain indexer that consumes existing event emissions from all three contracts.

**Why this is safe**: zero contract changes; runs alongside existing on-chain storage. If the indexer fails or proves wrong-shaped, no on-chain state is affected. Indexer is a derivative; chain remains canonical.

**Concrete work**:
- Set up Subgraph (or Ponder, or custom) per contract
- Define entity schemas matching the on-chain structures
- Backfill from genesis using historical event logs
- Deploy redundant indexer instances for fault tolerance
- API endpoints for per-actor queries + Merkle witness generation

**Effort**: 1-2 weeks for a single engineer
**Risk**: low (off-chain infra; no on-chain side effects)
**Reversibility**: trivial (turn off the indexer)

### Phase 2 — Snapshot commitment contracts

**Scope**: deploy three new lightweight contracts (one per bottleneck) that store per-snapshot Merkle root commitments.

```solidity
// Example shape — applies to each of the three bottlenecks with substrate-appropriate naming
contract VouchStateCommitter {
    struct Snapshot {
        uint64 timestamp;
        bytes32 stateRoot;     // sparse Merkle root over vouch graph
    }

    mapping(uint64 => Snapshot) public snapshots;
    uint64 public lastSnapshotIndex;
    IncrementalMerkleTree.Tree internal _snapshotRootTree;

    function commitSnapshot(uint64 snapshotIndex, uint64 timestamp, bytes32 stateRoot)
        external onlySnapshotter { /* ... */ }
}
```

**Why this is safe**: new contracts; existing contracts untouched. Snapshotter is keyed; revocable. The committed roots have no consumers yet — purely observational.

**Effort**: 3-5 days per committer (3 committers total) + tests + audit checkpoint
**Risk**: low (additive only)
**Reversibility**: moderate (can pause snapshotter; root history persists but is benign)

### Phase 3 — Off-chain proof verification on consumers

**Scope**: add proof-verification entry points to contracts that consume on-chain trust scores or attestations. Initially these new entry points run in parallel with the existing on-chain reads.

**Why this is the inflection point**: the first time on-chain logic depends on off-chain proofs. Requires Brevis (or chosen zk-coprocessor) integration. Audit attention concentrated here.

**Effort**: 2-3 weeks per consumer integration + Brevis circuit work + audit
**Risk**: medium (real contract changes; proof-verifier bugs would gate state transitions)
**Reversibility**: harder (consumers can fall back to on-chain reads if both are maintained, but at the cost of double work)

### Phase 4 — Deprecate on-chain bulk storage

**Scope**: stop writing per-vouch / per-attestation / per-contribution data to on-chain mappings and arrays. Existing data stays in storage (for safety/audit) but is no longer the source of truth.

**Why this is last**: irreversible without contract upgrade. Should only happen after Phase 3 has run successfully for an extended observation window (months, not weeks).

**Effort**: contract upgrade per affected contract + migration script + audit
**Risk**: high (the data-source-of-truth pivot; off-chain layer must be reliable)
**Reversibility**: low (would require restoring on-chain writes; old storage may be partially decommissioned)

### Phase 5 — Old storage cleanup (optional)

After Phase 4 has run for an additional observation window, the now-unused on-chain storage can be cleared as part of a future contract upgrade. Storage refunds offset gas cost.

---

## Section IV — Migration strategy

Unlike USD8 (which would launch with this architecture), VibeSwap has live contracts with real user state. Migration considerations:

**No data loss**: every existing on-chain entry is observable via prior event emissions. The off-chain indexer can reconstruct everything from chain log alone, regardless of when the indexer is brought online. No special migration code needed for the indexer.

**Snapshot continuity**: when Phase 2 launches, the first snapshot contains all current state. There is no "pre-refactor" gap.

**Consumer cutover**: in Phase 3, consumers can read from both old (on-chain) and new (proof-verified) sources, with feature flags to switch primary source. Allows extended A/B observation before committing.

**Rollback path**: through Phase 3, rollback is possible by switching consumers back to on-chain reads. Phase 4 closes that door; before Phase 4, consider a longer Phase 3 observation than feels strictly necessary.

---

## Section V — Open questions

1. **Indexer infra choice**. Subgraph (most common, decentralized via The Graph), Ponder (lighter, more flexible), Subsquid (high-throughput), or custom? Affects ops cost and decentralization properties.

2. **Snapshotter authorization**. Single trusted snapshotter (simplest)? Multi-sig? Permissionless with bond + dispute (most decentralized, most complex)? Same question structure as USD8.

3. **Snapshot cadence**. Daily for ContributionDAG (vouch graph changes slowly); per-claim-resolution for ContributionAttestor (event-driven); daily for GitHubContributionTracker. May not be uniform across the three.

4. **Brevis vs alternatives**. We've already proposed Brevis for USD8. VibeSwap should probably use the same coprocessor (audit cost amortization, team familiarity). Reconsider if there's a substrate-specific reason to differ.

5. **Phase 4 timing**. How long should Phase 3 run before Phase 4 commits? Recommendation: minimum 3 months of clean Phase 3 operation, longer for ContributionDAG (highest-stakes consumer).

6. **Audit budget**. Phase 1 = no audit needed (off-chain). Phase 2 = light audit (additive contracts). Phase 3 = significant audit (proof verifiers + circuits). Phase 4 = audit per upgraded contract. Total audit budget across the refactor probably ~$100-200k assuming a Pashov / Spearbit / OpenZeppelin engagement.

7. **Order of bottleneck attack**. Three bottlenecks: ContributionDAG, ContributionAttestor, GitHubContributionTracker. Recommended order = highest-scaling-pressure first = GitHubContributionTracker (depth-20 ceiling is most concrete), then ContributionDAG (curated graph but BFS-bound), then ContributionAttestor (lowest current pressure). Each bottleneck's full refactor is independent; can run in parallel if engineering capacity allows.

---

## Section VI — Pin point for next session

**Phase 1 is the immediate next step** — and it's clean: zero contract changes, builds operational infrastructure, validates the indexer pattern before any on-chain risk is taken.

Concrete first commit (when implementation begins):
- Set up indexer scaffolding for `GitHubContributionTracker` (smallest, simplest, lowest risk)
- Define entity schema for contribution events
- Backfill from contract genesis
- Validate against on-chain reads (sanity check)

This is ~3 days of work and unlocks the architecture. Subsequent indexer additions for `ContributionDAG` and `ContributionAttestor` are similar shapes with substrate-specific schemas.

The full refactor is ~3-6 months wall-clock for a small team. The plan above is the roadmap; execution order is in Will's hands.

---

*Refactor plan triggered by 2026-04-27 USD8 history-compression-spec correction. The architectural template is the off-chain-storage + on-chain-commitment pattern documented in the USD8 spec; this doc applies it to VibeSwap's three highest-pressure on-chain-storage surfaces. Phase 1 requires zero contract changes and can begin whenever Will greenlights. Full refactor is multi-month staged work.*
