# Optimistic Shapley — Distribution at Scale

**Status**: Design proposal for gas-efficient Shapley at production scale.
**Depth**: Pedagogical-accessible; concrete mechanism design.
**Related**: [Shapley Reward System](./SHAPLEY_REWARD_SYSTEM.md), [The Uncomputable Marginal](./THE_UNCOMPUTABLE_MARGINAL.md), [Mechanism Composition Algebra](./MECHANISM_COMPOSITION_ALGEBRA.md).

---

## The problem

Shapley distribution on-chain has a gas problem. Computing per-contributor Shapley values for N contributors requires evaluating many subsets (see [The Uncomputable Marginal](./THE_UNCOMPUTABLE_MARGINAL.md)). Even with Monte Carlo approximation, N = 1,000 contributors requires ~5,000 Monte Carlo samples × 1,000 coalition evaluations = 5,000,000 operations per distribution round.

At Ethereum L1 gas prices, that's tens of thousands of dollars per distribution round. Too expensive for weekly / monthly distribution cadences.

We need a way to compute Shapley values off-chain (cheap) while ensuring the on-chain reward distribution actually matches the computation (trustworthy).

Optimistic rollups solve this exact pattern for general-purpose computation. We adapt the pattern for Shapley.

## The pattern, stated in one paragraph

**Optimistic Shapley**: an off-chain keeper computes Shapley values and commits the resulting distribution to the chain as a Merkle root. A challenge window opens. During the window, any party can dispute the distribution by submitting a counter-proof. If challenged, the computation is re-run on-chain for the disputed piece, at the challenger's gas expense. If the challenger is right, the keeper is slashed; if wrong, the challenger loses their bond. After the window closes without successful challenge, the distribution finalizes.

This pattern is called **interactive-fraud-proof-with-bonded-challenge**. It's how optimistic rollups verify off-chain computation.

## The specific construction for Shapley

### Step 1 — Off-chain keeper computes Shapley

A designated keeper (trust-weighted, stake-bonded) collects all contributions for a round, runs Monte Carlo Shapley computation off-chain, and generates per-contributor allocations.

### Step 2 — Keeper commits via Merkle root

The allocations are organized into a Merkle tree (one leaf per contributor). The root is committed to a ChallengeableDistribution contract:

```solidity
function commitDistribution(
    bytes32 merkleRoot,
    uint256 totalAmount,
    uint256 roundNumber
) external;
```

The contract records the root, totalAmount, and the commit timestamp. The challenge window (default 7 days) starts.

### Step 3 — Challenge window opens

During the window, anyone can:

- **Verify independently** — recompute the keeper's Shapley off-chain; check it matches.
- **Dispute** — if their verification differs, submit a proof showing the specific discrepancy.

A dispute requires:
- A Merkle proof against the committed root showing the keeper's claimed allocation.
- An alternative allocation the challenger claims is correct.
- Evidence (computational proof) showing the alternative matches the actual contribution data.
- A stake bond to prevent frivolous challenges.

### Step 4 — On-chain adjudication

The chain executes the specific sub-computation at dispute. This could be:
- Recomputing a specific contributor's Shapley value.
- Re-running the Monte Carlo seed the keeper claimed.
- Verifying a specific coalition's characteristic function evaluation.

The on-chain verification is expensive (hence we delay it to challenges only) but feasible for a single disputed item.

### Step 5 — Outcome

- **Keeper was right**: challenger's bond is slashed; keeper gets part of the bond as reward; the distribution remains.
- **Challenger was right**: keeper is slashed; the Merkle root is reverted; a new keeper re-computes; the wrongful keeper's reputation is permanently damaged.

### Step 6 — Finalization

After 7 days without successful challenge, the distribution finalizes. Contributors can claim via Merkle proof.

## Why this works

The structure has specific cryptographic-economic properties:

**Safety**: a malicious keeper can't get a bad distribution through because any party with correct computation can challenge successfully. The keeper's bond exceeds the largest possible gain from misallocation; rational keepers behave.

**Liveness**: the challenge window is bounded; after 7 days, the distribution executes. No single adversary can block progress indefinitely.

**Cost**: gas is paid only on actual challenges (rare, since keeper is incentivized to be correct). For the common case (honest keeper, no challenges), gas cost is minimal (one Merkle root commitment per round).

**Auditability**: all historical commitments remain on-chain. An auditor can re-verify any past round at any time.

## The keeper's role

The keeper is a trusted-yet-bonded role. Specifically:

- **Selected** via governance (elected keeper, term-limited).
- **Bonded** to put up collateral far exceeding the potential gain from misbehavior.
- **Slashable** via successful challenge.
- **Rotatable** — governance can replace keeper without chain disruption.

This is a specific intermediary position — see [Disintermediation Grades](./DISINTERMEDIATION_GRADES.md). Optimistic Shapley introduces an intermediary role but with bounded accountability.

Grade 5 goal: permissionless keepers — anyone can commit; market-based selection. Harder to bootstrap; may come in V2.

## Comparison with alternatives

### Alternative 1 — Pure on-chain Shapley

Pros: no keeper, no challenge window, immediate finality.
Cons: expensive (as analyzed above); slow; may exceed block gas limits at scale.

### Alternative 2 — Pure off-chain Shapley

Pros: cheap; any keeper can compute.
Cons: no verification; trust required in keeper; no way to challenge.

### Alternative 3 — ZK-Shapley

Keeper computes Shapley and produces a ZK proof that the computation is correct. Submits root + proof.

Pros: verification on-chain is cheap (ZK-proof verification); no challenge window needed.
Cons: ZK-proof generation is expensive for complex Shapley; proving cost may exceed challenge-window approach for medium N.

Choice: Optimistic Shapley for medium N (100-10,000); ZK-Shapley when generation cost drops or N becomes very large (10,000+).

## Practical gas estimates

For N = 1,000 contributors:

- **Pure on-chain**: ~20M gas per distribution × ~$20/M gas = ~$400 per round.
- **Optimistic (no challenges)**: ~100K gas per distribution × ~$20/M gas = ~$2 per round.
- **Optimistic (1 challenge per 100 rounds)**: avg ~$2.20 per round (challenge gas amortized).
- **ZK-Shapley**: proof generation ~$5, verification ~$5, ~$10 per round.

Optimistic is 200x cheaper than pure on-chain for typical operation. Amortized cost is small even including occasional challenges.

## The honest framing

Optimistic Shapley isn't free. It has trade-offs:

- **Finalization delay**: 7 days from commit to claim availability. For some uses (immediate rewards), this is too slow.
- **Keeper dependency**: the mechanism depends on at least one honest keeper being willing to serve. Incentives should be aligned; long-term keeper health is an active concern.
- **Challenge cost asymmetry**: successful challenges are profitable for challengers; unsuccessful ones are expensive. A well-coordinated adversary might spam frivolous challenges to exhaust keeper's counter-response budget. Mitigations (challenge-bond scaling, rate limiting) needed.

None of these disqualifies the pattern. Each is a solvable engineering problem. Honest framing keeps expectations correct.

## The parallel to optimistic rollups

Optimistic rollups (Optimism, Arbitrum, etc.) use the same pattern for general computation. Our use here is a specific application: Shapley-distribution-as-computation.

Key lessons from rollup experience:
- Challenge windows in production are 7 days. Shorter windows have been proposed; 7 is the current equilibrium.
- Fraud-proof-game design is subtle; recursive proofs ("is the prover's proof of their fraud proof valid?") add complexity.
- Keepers / sequencers do get challenged; the mechanism fires in practice.

All of these lessons transfer to Optimistic Shapley.

## Future directions

### Aggregated Shapley

Instead of computing Shapley each round from scratch, maintain incremental Shapley state. When new contributions arrive, update the Shapley values via differential calculation rather than re-computing.

Requires: stable ordering of contributions, bounded update windows. Complexity increases but amortized cost drops further.

### Hybrid computation

Combine ZK-proof for specific sub-computations (the expensive part) with optimistic commitment for the rest. Gets the gas-efficiency of optimistic + the immediate-verification of ZK.

### Per-contributor subscription

Contributors pay a small subscription fee to keep their Shapley-involvement active. Passive contributors are pruned from the round; computation scales with active participants only.

## Integration with existing mechanisms

Optimistic Shapley is compatible with:

- **Lawson Floor** ([math doc](./THE_LAWSON_FLOOR_MATHEMATICS.md)) — floor is computed alongside Shapley and committed in the same Merkle root.
- **Novelty Bonus** ([theorem doc](./THE_NOVELTY_BONUS_THEOREM.md)) — novelty modifier applied in the off-chain computation; verified during challenges.
- **Contribution Traceability** ([main doc](./CONTRIBUTION_TRACEABILITY.md)) — round-by-round claims feed into Shapley computation.

Composes cleanly; no interference. [Mechanism Composition Algebra](./MECHANISM_COMPOSITION_ALGEBRA.md) Case A (orthogonal) for most interactions.

## Educational framing for Eridu

For a 2-week course segment:

- **Week 1**: Optimistic rollups as a pattern. How they work. Why they're the state-of-the-art for L2 scaling.
- **Week 2**: Optimistic Shapley as a specific application. Detailed mechanism walk. Exercises: design an optimistic-distribution mechanism for a different use case.

Concrete, buildable, broadly applicable beyond VibeSwap.

## One-line summary

*Optimistic Shapley: keeper computes distribution off-chain, commits Merkle root, 7-day challenge window with fraud-proof-game; 200x cheaper than on-chain, finality delayed, introduces bonded keeper intermediary. Same pattern as optimistic rollups, specific application to contribution distribution.*
