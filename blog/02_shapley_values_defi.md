# Shapley Values in DeFi: Fair Reward Distribution Without Trust

*Will Glynn | March 2026*

---

Every DEX on the planet distributes fees the same way: pro-rata by liquidity. You own 10% of the pool, you get 10% of the fees. Simple. And deeply unfair.

Pro-rata distribution treats a dollar deposited five minutes ago the same as a dollar that survived three liquidation cascades. It treats the abundant side of a lopsided market the same as the scarce side that actually enabled trades to clear. It rewards capital, period — not timing, not commitment, not the economic function that capital performed.

I spent a year studying cooperative game theory to find something better. The answer has existed since 1953. Lloyd Shapley just never had to put it on a blockchain.

## The Glove Game

Here is the simplest cooperative game that exposes the flaw in pro-rata thinking.

Three players walk into a room. Alice has a left glove. Bob has a left glove. Carol has a right glove. A matched pair sells for $1. Unmatched gloves are worthless.

Pro-rata says: three participants, split the dollar three ways. Everyone gets $0.33.

But think about what actually happens when you form coalitions. Alice alone: $0. Bob alone: $0. Carol alone: $0. Alice + Bob: $0 (two left gloves, no pair). Alice + Carol: $1 (a pair). Bob + Carol: $1 (a pair). Alice + Bob + Carol: $1 (still one pair — Carol is the bottleneck).

Carol is the scarce resource. Without her, nobody makes money. She should get more than a third. Alice and Bob are interchangeable — removing either one still leaves a viable pair. They should get less.

The Shapley value computes the average marginal contribution of each player across all possible orderings. When you work through it: Carol gets $0.67. Alice gets $0.17. Bob gets $0.17. That is the unique allocation satisfying four axioms — efficiency (everything is distributed), symmetry (equal contributors get equal shares), null player (zero contribution means zero reward), and additivity (consistent across combined games).

This is not an opinion about fairness. It is the only mathematically consistent definition.

## How This Maps to a DEX

Replace gloves with liquidity. In a batch auction, a pool receives 80 ETH of buy orders and 20 ETH of sell orders. Only 20 ETH of matched volume can actually clear. The sell-side LPs are Carol — they are the scarce resource that enabled 20 ETH of real economic activity. The buy-side LPs are Alice and Bob — abundant, partially interchangeable, and less individually critical to the match.

Pro-rata ignores this entirely. VibeSwap does not.

Every batch settlement creates an independent cooperative game. Each LP's reward is computed from four weighted contribution components:

**Direct Contribution (40%)** — Raw liquidity provided. This is the baseline, and the part pro-rata gets right. A larger position means more capital at risk, more market depth, and a proportionally larger claim on fees.

**Enabling Contribution (30%)** — How long you have been in the pool. An LP who has been present for 30 days enabled hundreds of batches to settle. One who arrived 10 seconds ago enabled nothing yet. The scoring uses logarithmic scaling — 1 day gives a 1.0x multiplier, 7 days gives 1.9x, 30 days gives 2.7x, a full year gives 4.2x. Diminishing returns, because the first week matters more than the fiftieth.

**Scarcity Contribution (20%)** — Are you on the scarce side of the market? In an 80/20 buy/sell imbalance, sell-side LPs receive a scarcity bonus because they are the constraining factor on matched volume. This is the glove game in production. The protocol computes an imbalance ratio from the batch's buy and sell volumes, then scores each participant based on which side they sit on and how much of the scarce side they represent.

**Stability Contribution (10%)** — Did you stay during volatility? When ETH drops 15% in an hour, most mercenary capital runs. The LPs who stay are the ones keeping the market functional. The stability score tracks whether you maintained your position during high-volatility epochs, rewarding the commitment that matters most when it matters most.

## A Concrete Example

A batch settles with 80 ETH of buys and 20 ETH of sells. Total fees: 0.3 ETH. Three LPs participated:

| LP | Liquidity | Time in Pool | Side | Stayed in Volatility? |
|----|-----------|-------------|------|-----------------------|
| Alice | 50 ETH | 30 days | Buy | Yes |
| Bob | 30 ETH | 2 days | Buy | No |
| Carol | 20 ETH | 14 days | Sell | Yes |

Under pro-rata, Alice gets 0.15 ETH, Bob gets 0.09 ETH, Carol gets 0.06 ETH. Purely proportional to liquidity. Carol, who provided 100% of the scarce side that enabled the entire batch to settle, gets the smallest share.

Under Shapley distribution, the weighted contribution calculation changes the picture. Carol's scarcity score is high (~7500 BPS) because she is the entire sell side. Her stability score is maxed. Her time score is solid. Alice has the largest direct contribution but sits on the abundant side with a lower scarcity score. Bob has less liquidity, almost no time score, and bailed during volatility.

The result: Alice gets ~0.12 ETH, Carol gets ~0.12 ETH, Bob gets ~0.06 ETH. Carol's reward nearly doubles compared to pro-rata despite having the smallest position, because her liquidity was the bottleneck. Bob's reward drops because he contributed little beyond raw capital and abandoned the pool when it mattered.

## The Solidity

The core of the weighted contribution calculation in `ShapleyDistributor.sol`:

```solidity
uint256 public constant DIRECT_WEIGHT = 4000;      // 40%
uint256 public constant ENABLING_WEIGHT = 3000;    // 30%
uint256 public constant SCARCITY_WEIGHT = 2000;    // 20%
uint256 public constant STABILITY_WEIGHT = 1000;   // 10%

// Weighted sum
uint256 weighted = (
    (directScore * DIRECT_WEIGHT) +
    (timeScore * ENABLING_WEIGHT) +
    (scarcityNorm * SCARCITY_WEIGHT) +
    (stabilityNorm * STABILITY_WEIGHT)
) / BPS_PRECISION;
```

Computing exact Shapley values is O(2^n) — you need to evaluate every possible coalition. With 100 LPs in a pool, that is 2^100 coalitions. Obviously impossible on-chain. The weighted approximation above runs in O(n), and the four-component decomposition preserves the properties that matter: efficiency (all fees are distributed), proportionality (higher contribution means higher reward), and the null player property (zero contribution means zero reward).

The scarcity score calculation implements the glove game directly:

```solidity
function calculateScarcityScore(
    uint256 buyVolume,
    uint256 sellVolume,
    bool participantSide,
    uint256 participantVolume
) external pure returns (uint256 scarcityScore) {
    uint256 totalVolume = buyVolume + sellVolume;
    uint256 buyRatio = (buyVolume * BPS_PRECISION) / totalVolume;
    bool scarceIsSell = buyRatio > 5000;

    if (participantSide == scarceIsSell) {
        // Abundant side: reduced score
        uint256 imbalance = scarceIsSell ? buyRatio - 5000 : 5000 - buyRatio;
        scarcityScore = 5000 - (imbalance / 2);
    } else {
        // Scarce side: boosted score
        uint256 imbalance = scarceIsSell ? buyRatio - 5000 : 5000 - buyRatio;
        scarcityScore = 5000 + (imbalance / 2);
    }
}
```

There is also a minimum reward floor — the Lawson Fairness Floor — guaranteeing that any participant who showed up and acted honestly receives at least 1% of the pool. Nobody who contributed walks away with zero.

## Why This Matters

The standard argument for pro-rata is that it is simple, transparent, and hard to game. All true. But "hard to game" is a low bar when the baseline allocation is already wrong. You do not need to game a system that hands you an unfair share by default.

Shapley distribution makes cooperation the dominant strategy, not a moral aspiration. If you are an LP deciding where to park capital, the rational choice is to go where your marginal contribution is highest — which means providing liquidity on the scarce side of imbalanced markets, staying through volatility instead of pulling out, and committing for longer durations. These are precisely the behaviors that make a DEX function well.

Traditional DeFi is a Prisoner's Dilemma: defection (mercenary capital, just-in-time liquidity, volatility flight) is individually rational even though it degrades the system. Shapley values transform it into an Assurance Game: cooperation is rational when others cooperate, because the reward structure reflects your actual economic contribution rather than just the size of your balance.

Rewards cannot exceed revenue. Compounding is limited to realized events. And cooperation is rational, not moral. That is the entire design philosophy in three sentences.

The code is open source at [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap). The math is in the contracts. The proofs are in the whitepaper. I would rather you verify than trust.

---

*This is the second post in a series on VibeSwap's mechanism design. The full incentives whitepaper and Shapley implementation are available in the repository.*
