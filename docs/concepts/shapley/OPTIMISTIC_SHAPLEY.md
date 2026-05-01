# Optimistic Shapley — Distribution at Scale

**Status**: Design proposal for gas-efficient Shapley at production scale.
**Audience**: First-encounter OK. Pattern walked with specific gas estimates.

---

## Start with a familiar gas problem

You want to distribute rewards to 1,000 contributors. Fair distribution requires Shapley computation — which requires evaluating 2^1000 subsets.

On-chain, this is impossible. Even at Monte Carlo approximation with 5,000 samples × 1,000 coalition evaluations per sample = 5M operations per distribution round.

Rough gas cost: ~20M gas per distribution at 2024 prices. At $20/M gas: **$400 per distribution round**. Weekly rounds: ~$20K/year in gas alone. Monthly rounds: ~$5K/year.

Too expensive for routine distribution.

We need a way to do Shapley **off-chain** (cheap) while maintaining trust — **on-chain**.

The solution is optimistic rollups applied to Shapley.

## The pattern borrowed from rollups

Optimistic rollups (Optimism, Arbitrum) solve EXACTLY this pattern for general computation:

1. **Sequencer computes off-chain** (cheap).
2. **Commits result Merkle-root to L1** (one on-chain tx).
3. **Challenge window opens** (typically 7 days).
4. **Anyone can dispute**: submit fraud-proof showing sequencer was wrong.
5. **If dispute succeeds**: sequencer slashed, sequence reverted.
6. **If window expires without successful dispute**: result finalizes.

This is **interactive-fraud-proof-with-bonded-challenge**. It's how rollups verify off-chain computation trustlessly.

We apply the same pattern to Shapley distribution.

## Optimistic Shapley, stated

An off-chain keeper computes Shapley values and commits the resulting distribution to the chain as a Merkle root. Challenge window opens. Any party can dispute. If challenged, computation re-runs on-chain for disputed piece (challenger's gas). If challenger right: keeper slashed. If wrong: challenger loses bond. After window closes without successful challenge, distribution finalizes.

Same pattern as rollup; specific to distribution.

## Step-by-step flow

### Step 1 — Off-chain Shapley computation

A designated keeper (trust-weighted + stake-bonded) collects all contributions for the round. Runs Monte Carlo Shapley off-chain. Generates per-contributor allocations.

### Step 2 — Commit Merkle root

Allocations organized into Merkle tree (one leaf per contributor). Root committed:

```solidity
function commitDistribution(
    bytes32 merkleRoot,
    uint256 totalAmount,
    uint256 roundNumber
) external;
```

Contract records root, totalAmount, commit timestamp. Challenge window (default 7 days) starts.

### Step 3 — Challenge window opens

During the window, anyone can:
- **Verify independently** — recompute keeper's Shapley off-chain; check match.
- **Dispute** — if verification differs, submit fraud-proof.

A dispute requires:
- Merkle proof against committed root showing keeper's claimed allocation.
- Alternative allocation challenger claims is correct.
- Evidence (computational proof) showing alternative matches actual contribution data.
- Stake bond to prevent frivolous challenges.

### Step 4 — On-chain adjudication

The chain executes the specific sub-computation at dispute. Could be:
- Recomputing specific contributor's Shapley value.
- Re-running Monte Carlo seed keeper claimed.
- Verifying specific coalition's characteristic function evaluation.

Expensive but feasible for a single disputed item (we don't re-verify ALL — just the disputed).

### Step 5 — Outcome

- **Keeper was right**: challenger's bond slashed. Keeper gets part as reward. Distribution remains.
- **Challenger was right**: keeper slashed. Merkle root reverted. New keeper re-computes. Wrongful keeper's reputation damaged.

### Step 6 — Finalization

After 7 days without successful challenge, distribution finalizes. Contributors claim via Merkle proof.

## Gas estimates — worked

For N = 1,000 contributors:

### Pure on-chain Shapley
- ~20M gas per distribution × $20/M gas = **$400/round**.

### Optimistic (no challenges, typical)
- Keeper computes off-chain (free).
- One Merkle-root commit: ~100K gas.
- $20/M × 100K = **$2/round**.

### Optimistic (1 challenge per 100 rounds)
- 99 rounds at $2 = $198.
- 1 round with challenge: $2 commit + ~20M gas re-computation = $402.
- Average over 100: **$6/round**. Still ~100x cheaper than pure on-chain.

### ZK-Shapley (for comparison)
- Proof generation: ~$5.
- On-chain verification: ~$5.
- **~$10/round**.

**Optimistic is 200x cheaper than pure on-chain for typical operation.**

## Why this works

Specific cryptographic-economic properties:

**Safety**: malicious keeper can't get bad distribution through because any party with correct computation can successfully challenge. Keeper's bond exceeds max gain from misallocation. Rational keepers behave.

**Liveness**: challenge window is bounded. After 7 days, distribution executes. No single adversary can block progress indefinitely.

**Cost**: gas paid only on actual challenges (rare, keeper incentivized to be correct). Common case: minimal gas.

**Auditability**: all historical commitments remain on-chain. Auditor can re-verify any past round anytime.

## The keeper's role

Bonded-yet-trusted intermediary:

- **Selected** via governance (elected keeper, term-limited).
- **Bonded** with collateral far exceeding potential gain from misbehavior.
- **Slashable** via successful challenge.
- **Rotatable** — governance can replace keeper without chain disruption.

This introduces a specific intermediary role. See [Disintermediation Grades](../DISINTERMEDIATION_GRADES.md). Optimistic Shapley is Grade 4 (bonded intermediary with accountability), not Grade 5 (permissionless).

Grade 5 goal: permissionless keepers. Harder to bootstrap; may come in V2.

## Comparison with alternatives

### Alternative 1 — Pure on-chain Shapley

- Pros: no keeper, no challenge window, immediate finality.
- Cons: $400/round at N=1000. Way too expensive at scale.

### Alternative 2 — Pure off-chain Shapley

- Pros: cheap; any keeper can compute.
- Cons: no verification; trust required in keeper; no way to challenge misbehavior.

### Alternative 3 — ZK-Shapley

Keeper computes Shapley + produces ZK proof of correct computation. Submits root + proof.

- Pros: verification on-chain is cheap (ZK-proof verification); no challenge window needed.
- Cons: ZK-proof generation expensive for complex Shapley; proving cost may exceed challenge-window approach for medium N.

Choice: **Optimistic Shapley for medium N (100-10,000). ZK-Shapley when generation cost drops or N becomes very large (10,000+).**

## Practical honest tradeoffs

Optimistic Shapley isn't free. Specific tradeoffs:

### Finalization delay

7 days from commit to claim availability. Some uses (immediate rewards) too slow.

### Keeper dependency

Mechanism depends on at least one honest keeper willing to serve. Incentives aligned; long-term keeper health is concern.

### Challenge cost asymmetry

Successful challenges profitable; unsuccessful expensive. Well-coordinated adversary might spam frivolous challenges to exhaust keeper's counter-response budget.

Mitigations: challenge-bond scaling, rate limiting.

None disqualifies the pattern. Each is solvable engineering.

## The parallel to optimistic rollups

Optimistic rollups (Optimism, Arbitrum) use exactly this pattern for general computation. Our use: specific application to Shapley.

Key lessons from rollup experience:
- Challenge windows in production are 7 days. Shorter proposed; 7 is equilibrium.
- Fraud-proof-game design subtle; recursive proofs ("is prover's proof of their fraud proof valid?") add complexity.
- Keepers/sequencers DO get challenged; mechanism fires in practice.

All lessons transfer to Optimistic Shapley.

## Future directions

### Aggregated Shapley

Maintain incremental Shapley state. When new contributions arrive, update via differential calculation rather than re-computing from scratch.

### Hybrid computation

ZK-proof for specific sub-computations (expensive part) + optimistic commitment for rest. Gas-efficiency of optimistic + immediate-verification of ZK.

### Per-contributor subscription

Contributors pay subscription fee to keep Shapley-involvement active. Passive contributors pruned; computation scales with active participants.

## Integration with existing mechanisms

Composes cleanly (per [Mechanism Composition Algebra](../../architecture/MECHANISM_COMPOSITION_ALGEBRA.md)):

- **Lawson Floor** computed alongside Shapley; committed in same Merkle root.
- **Novelty Bonus** modifier applied off-chain; verified during challenges.
- **Contribution Traceability** feeds claims into Shapley computation.

Case A (orthogonal) for most interactions.

## For students

Exercise: design an optimistic-distribution mechanism for a different use case.

Pick: voting on governance proposals, grant-making, research-paper review, content curation.

Apply the framework:
1. What's the expensive computation?
2. Who's the keeper?
3. What's the challenge mechanism?
4. What are the tradeoffs vs alternatives?

Design your mechanism. Compare to Optimistic Shapley.

## Educational framing for Eridu

2-week course segment:
- **Week 1**: Optimistic rollups as a pattern. How they work. State-of-the-art for L2 scaling.
- **Week 2**: Optimistic Shapley as specific application. Detailed walk. Student exercise: design an optimistic-distribution mechanism.

Concrete, buildable, broadly applicable beyond VibeSwap.

## One-line summary

*Optimistic Shapley borrows from optimistic rollups: keeper computes Shapley off-chain, commits Merkle root + totalAmount, 7-day challenge window with fraud-proof-game on disputed claims. 200x cheaper than pure on-chain (~$2 vs $400 per round at N=1000). Introduces bonded keeper intermediary (Grade 4 in disintermediation scale). Finalization delayed; keeper dependency. Same pattern as L2 rollups, specific to contribution distribution.*
