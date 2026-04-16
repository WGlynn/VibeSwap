# Fractalized Shapley Attribution

## Problem

How do you distribute rewards (tokens, fees, revenue) across a coalition of contributors proportionally to their **marginal contribution** — fairly, efficiently, and in real-time? Standard Shapley-value attribution is mathematically exact but computationally expensive: exact Shapley requires enumerating all coalitions, which is factorial in contributor count and useless for any real system with more than ~10 participants. Most protocols fall back to proportional-to-stake or proportional-to-activity — both of which overreward the capital-rich or the spammy at the expense of the genuinely contributory.

**The bug class**: any reward distribution that ignores counterfactual contribution. If removing Alice would've cost the coalition 40% of its output, Alice is owed 40% — not her capital share, not her transaction count.

## Solution

Compose three techniques:

1. **Streaming Shapley approximation** — compute marginal contribution per-epoch over a sliding window rather than enumerating full coalitions. Known technique from federated-learning contribution accounting. Real-time incentive signal with deferred exact settlement at epoch boundaries. The approximation is unbiased over time.
2. **Fractalization** — nested coalitions. Contributors at any level (individuals within teams, teams within protocols, protocols within ecosystems) get Shapley-weighted credit within their local coalition, recursively composed up the tree. Attribution compounds fractally.
3. **Lawson Floor** — a minimum-positive-share invariant for any honest participant who meets participation thresholds. Protects honest-but-unlucky contributors from winner-take-most collapse (see [`LAWSON_FLOOR_FAIRNESS.md`](../../DOCUMENTATION/LAWSON_FLOOR_FAIRNESS.md)).

Net result: a distribution where every sincere contributor gets a non-zero, proportional, counterfactually-justified share — within real-time budgets.

## Code sketch

```solidity
// Streaming Shapley approximation over a sliding window
struct ContributionWindow {
    mapping(address => uint256) marginalContribution;
    uint256 totalMarginal;
    uint256 epochStart;
}

function updateStreamingShapley(
    address contributor,
    uint256 addedValue
) external onlyController {
    ContributionWindow storage w = currentWindow;
    // Marginal = value the coalition wouldn't have without this contributor's work
    // In practice: delta in objective metric (revenue, liquidity depth, canonicality score)
    w.marginalContribution[contributor] += addedValue;
    w.totalMarginal += addedValue;
}

// Settle at epoch boundary — distribute epoch pot by streaming-approximated share
function settleEpoch(uint256 epochPot) external {
    ContributionWindow storage w = currentWindow;
    for (uint256 i = 0; i < contributors.length; i++) {
        address c = contributors[i];
        uint256 rawShare = (epochPot * w.marginalContribution[c]) / w.totalMarginal;
        // Lawson Floor: every honest participant who met thresholds gets at least
        // LAWSON_FLOOR_BPS of the pot, drawn pro-rata from above-floor winners.
        uint256 share = _applyLawsonFloor(rawShare, c);
        claimable[c] += share;
    }
    _rollEpoch();
}
```

## Where it lives in VibeSwap

- `contracts/incentives/ShapleyDistributor.sol` — core distributor with Lawson Floor cap at 100 (F04 fix). Recursive coalition support via nested distributor addresses.
- `contracts/incentives/FractalShapley.sol` — fractalization layer. Coalition of coalitions.
- `docs/papers/atomized-shapley.md` — streaming approximation + settlement paper.
- `docs/papers/shapley-value-distribution.md` — full-Shapley baseline.

## Attribution

- Streaming approximation: adapted from federated-learning contribution accounting literature (Ghorbani & Zou, 2019; Wang et al., 2020).
- Fractalization + Lawson Floor: Will Glynn, VibeSwap design (2026-03).
- F04 quality-weight fix on Lawson Floor: TRP R23, commit-trail in `docs/trp/round-summaries/round-23.md`.
- Audit validation: DeepSeek-V4lite (Round 2, 2026-04-16) — "Streaming Shapley is used in federated learning for contribution accounting. The deferred exact settlement is acceptable if the approximation is unbiased over time."

If you reuse this pattern, reference the implementation commit. The Contribution DAG credits both Will and the upstream federated-learning researchers whose streaming-Shapley work we composed with.
