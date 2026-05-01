---
title: "I Built a 351-Contract DEX in 3 Months With an AI Partner. Here's What I Learned."
published: false
description: "Commit-reveal batch auctions, Shapley game theory, zero protocol fees, and why AI defaults to Uniswap patterns when you're not looking."
tags: blockchain, web3, ai, solidity
---

Three months ago I started building an omnichain DEX from scratch with an AI coding partner. Today the codebase has 351 Solidity contracts, 118 Rust scripts, 377 test files, and exactly zero protocol fees.

This is not a pitch. This is a build log. I want to talk about what actually happens when you use AI to build something architecturally different from the training data it learned on.

## The AI Pattern-Matching Problem

Here is the thing nobody warns you about when building with AI: it is a multiplicative tool, not an additive one. It multiplies your intentions. Including the wrong ones.

We designed VibeSwap around a core principle we call P-000: Fairness Above All. Zero protocol fees. No rent extraction. Liquidity providers keep 100% of trading fees, distributed via Shapley values (more on that below). The protocol sustains itself through priority auction bids and token emissions -- not by skimming LP revenue.

The AI understood this when I explained it. It would even articulate the philosophy back to me eloquently. Then it would generate a contract with a 0.3% fee hardcoded into the swap function.

0.3%. Sound familiar? That is the Uniswap v2 fee. It is in the training data thousands of times. Every DeFi tutorial, every fork, every "build your own DEX" article uses it. The AI was not being malicious. It was doing what language models do: pattern-matching against the most likely next token. And the most likely fee for a DEX swap function is 30 basis points.

We found over 100 instances of this. Fee tiers that appeared from nowhere. Maker/taker structures we never designed. A `protocolFeeShare` parameter initialized to 10% in a deploy script. Test assertions checking for fees we explicitly said should not exist.

The lesson was expensive in time but valuable in insight: **you cannot just tell an AI what to build. You have to build the immune system that catches when it drifts back to the median.**

We started treating every code review as a violation check. Does this contract extract value from LPs? Does this test assert fees that violate P-000? Is this deploy script going to ship something that contradicts the whitepaper? The vigilance has to be continuous because the drift is continuous.

## Commit-Reveal Batch Auctions: How We Kill MEV

MEV (Maximal Extractable Value) costs Ethereum users billions. Sandwich attacks, frontrunning, backrunning -- they all exploit the same thing: the attacker can see your transaction before it executes.

Our fix is architectural, not parametric. We do not try to minimize MEV. We make it structurally impossible by eliminating the information advantage.

Every 10 seconds, a new batch opens:

**Commit phase (8 seconds):** You submit `keccak256(trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)` along with a collateral deposit. Nobody -- not validators, not searchers, not us -- can see what you are trading.

**Reveal phase (2 seconds):** You reveal your actual order parameters plus the secret. The contract verifies the hash matches your commitment. If you submitted a fake commitment or refuse to reveal, you lose 50% of your collateral:

```solidity
// From CommitRevealAuction.sol — hash verification during reveal
bytes32 expectedHash = keccak256(abi.encodePacked(
    msg.sender,
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    secret
));

if (expectedHash != commitment.commitHash) {
    // Invalid reveal — slash deposit
    _slashCommitment(commitId);
    return;
}
```

**Settlement:** All revealed orders in the batch execute at a single uniform clearing price. No one gets a better price than anyone else in the same batch. Order execution sequence is determined by a Fisher-Yates shuffle seeded with XORed secrets from all participants plus post-reveal block entropy:

```solidity
// From DeterministicShuffle.sol
function generateSeedSecure(
    bytes32[] memory secrets,
    bytes32 blockEntropy,
    uint64 batchId
) internal pure returns (bytes32 seed) {
    // Step 1: XOR all secrets (commits to all participants)
    seed = bytes32(0);
    for (uint256 i = 0; i < secrets.length; i++) {
        seed = seed ^ secrets[i];
    }
    // Step 2: Add unpredictable entropy unknown during reveal phase
    seed = keccak256(abi.encodePacked(
        seed,
        blockEntropy,  // blockhash(revealEndBlock) — unpredictable at reveal time
        batchId,
        secrets.length
    ));
}
```

Why this matters: the `blockEntropy` is the blockhash of the block *after* the reveal phase ends. Even the last revealer cannot predict the final shuffle seed because they do not know that future blockhash. No information advantage. No MEV.

The timing parameters are protocol constants, not governance parameters. Nobody can vote to change them:

```solidity
uint256 public constant COMMIT_DURATION = 8; // 8 seconds
uint256 public constant REVEAL_DURATION = 2; // 2 seconds
uint256 public constant SLASH_RATE_BPS = 5000; // 50% — strong incentive to reveal honestly
```

## Shapley Values: Game Theory as Production Code

Most DEXs distribute rewards proportionally to liquidity provided. That is simple but unfair. A liquidity provider who shows up during a volatility crisis and stabilizes the pool contributes more marginal value than one who deposits during calm markets. Proportional distribution ignores this.

We use Shapley values from cooperative game theory. Each batch settlement is modeled as a cooperative game. Every participant's reward is their marginal contribution averaged over all possible orderings of participants. The math satisfies five axioms that we enforce as test assertions:

1. **Efficiency** -- All value is distributed, no remainder:
```solidity
// From ExtractionDetection.t.sol
assertApproxEqAbs(
    lp1Fair + lp2Fair + lp3Fair,
    totalFees,
    3, // rounding tolerance
    "Efficiency axiom violated"
);
```

2. **Symmetry** -- Equal contributors get equal rewards:
```solidity
assertEq(shapley1, shapley2, "Symmetry axiom: equal contribution = equal reward");
```

3. **Null player** -- Zero contribution means zero reward:
```solidity
uint256 freeloaderShapley = calculateShapleyValue(0, totalContributions, totalFees);
assertEq(freeloaderShapley, 0, "Null player axiom: zero contribution = zero reward");
```

4. **Pairwise proportionality** -- Reward ratios match contribution ratios.

5. **Time neutrality** -- Identical contributions yield identical rewards regardless of when they happen (for fee distribution; token emissions follow a Bitcoin-style halving schedule intentionally).

The real power is in what happens when these axioms are violated. We built `ExtractionDetection.t.sol` -- a simulation that proves extraction is *always* mathematically detectable:

```solidity
function testFuzz_P001_ExtractionAlwaysDetected(
    uint256 contribution,
    uint256 extraction
) public pure {
    contribution = bound(contribution, 1e18, 1_000_000e18);
    extraction = bound(extraction, 1, 1_000e18);

    uint256 totalValue = 10_000e18;
    uint256 shapleyValue = calculateShapleyValue(contribution, contribution, totalValue);

    // Any amount above Shapley value is extraction
    uint256 overAllocation = shapleyValue + extraction;
    (bool isExtracting, uint256 amount) = detectExtraction(shapleyValue, overAllocation);

    assert(isExtracting); // ALWAYS detected
    assert(amount == extraction); // EXACT amount identified
}
```

Foundry runs 256 fuzz iterations by default. Across all of them: extraction is detected 100% of the time, and the exact extraction amount is identified to the wei. The same math that distributes rewards also detects theft. That is not a feature we bolted on. It is an inherent property of Shapley values -- if anyone takes more than their marginal contribution, the axioms fail, and the failure points directly at the extractor.

The production `ShapleyDistributor.sol` weighs four contribution dimensions:

```solidity
uint256 public constant DIRECT_WEIGHT = 4000;    // 40% — Direct liquidity provision
uint256 public constant ENABLING_WEIGHT = 3000;   // 30% — Time-based enabling
uint256 public constant SCARCITY_WEIGHT = 2000;   // 20% — Providing scarce side
uint256 public constant STABILITY_WEIGHT = 1000;  // 10% — Staying during volatility
```

Direct contribution is the liquidity you provided. Enabling is how long you kept it in the pool (logarithmic scaling -- diminishing returns so whales cannot just park capital). Scarcity is the "glove game" insight: if the batch is buy-heavy, sell-side LPs are scarce and more valuable. Stability rewards you for not pulling liquidity when volatility spikes.

## The Zero-Tolerance Audit

You want to hear something embarrassing? After building an entire philosophy around zero protocol fees, we found our own deploy script would have shipped with `protocolFeeShare` set to 10%.

Nobody put it there intentionally. The AI generated a deployment script, and when it needed a "reasonable default" for the protocol fee parameter, it picked 10% because that is what other protocols use. We caught it in review. But it made us ask: what else did we miss?

So we audited everything. Every contract. Every test. Every script. Here is what we found:

- A `VIBEToken` test was asserting `MINIMUM_LIQUIDITY == 1000` (the Uniswap v2 constant) instead of our actual value
- Three contracts had commented-out fee tier structures (taker/maker fees we never designed)
- Two test files were asserting fee collection on swap operations where fees should be zero
- The `VibeAgentTrading` contract had a `PLATFORM_FEE_BPS = 500` (5% of profits) that contradicted the zero-extraction principle

Some of these were legitimate design decisions for specific subsystems (agent trading fees go to the DAO treasury, not to the protocol operator). But several were pure AI hallucination -- the model filling in "reasonable" values from its training distribution.

We publish our test results. We publish our audit findings. We publish the violations we found in our own code. If the premise of the protocol is that extraction is always detectable, we should be the first ones detected.

## Testing Fairness With Fuzz

How do you test that a system is fair? You cannot write a unit test that says `assert(fair == true)` and call it a day. Fairness is a property that must hold across all possible inputs, not just the ones you thought of.

Foundry's fuzz testing lets us make universal claims. The `ExtractionDetection.t.sol` simulation has nine scenarios:

1. Protocol skims LP fees -- detected, self-corrected
2. Whale claims more than proportional share -- detected
3. Admin sets nonzero `protocolFeeShare` -- detected as extraction
4. Null player axiom -- zero contribution always yields zero
5. Symmetry axiom -- equal contributions always yield equal rewards
6. Efficiency axiom -- total distributed always equals total value
7. Autonomous correction restores fairness after any violation
8. **Fuzz: extraction is always detected** (256 runs, randomized inputs)
9. **Fuzz: self-correction always conserves value** (256 runs, randomized inputs)

```solidity
function testFuzz_P001_CorrectionConservesValue(
    uint256 c1, uint256 c2, uint256 c3, uint256 totalValue
) public pure {
    c1 = bound(c1, 1e18, 1_000_000e18);
    c2 = bound(c2, 1e18, 1_000_000e18);
    c3 = bound(c3, 1e18, 1_000_000e18);
    totalValue = bound(totalValue, 1e18, 100_000e18);

    uint256[] memory contributions = new uint256[](3);
    contributions[0] = c1;
    contributions[1] = c2;
    contributions[2] = c3;

    uint256[] memory corrected = selfCorrect(contributions, new uint256[](3), totalValue);

    uint256 sum = corrected[0] + corrected[1] + corrected[2];
    assert(sum <= totalValue);
    assert(totalValue - sum <= 2); // Max 2 wei rounding error
}
```

The key insight: we are not testing that our code *works*. We are testing that fairness *holds as a mathematical invariant*. The fuzz tests do not know what inputs will break it. They just try. And across all 106 fuzz test files in the suite, they have not found a violation yet.

## What I Actually Learned

Building with AI at this scale taught me things I have not seen in any "AI-assisted coding" blog post:

**1. AI does not have opinions. It has distributions.** When I asked for a fee structure, it gave me the most common fee structure in its training data. When I asked for a governance model, it gave me the one it had seen most often. Originality requires constant pressure against the gravitational pull of the median.

**2. The violation checker is more important than the code generator.** We spent more time building systems to catch AI-generated violations than we spent generating code. The immune system matters more than the muscles.

**3. Game theory axioms are the best test assertions ever written.** Efficiency, symmetry, null player, additivity -- these are not abstract math. They are `assert()` statements. They let you test *properties*, not just behaviors. Every protocol should be doing this.

**4. Transparency is not a feature. It is architecture.** We put `verifyPairwiseFairness()` and `verifyTimeNeutrality()` as public view functions directly on the `ShapleyDistributor` contract. Anyone can call them. Anyone can audit any game, any participant pair, any time. If your fairness claims require trusting you, they are not fairness claims.

**5. The hardest bugs are the ones that look correct.** A 0.3% fee in a swap function looks perfectly fine. It is what every other DEX does. The bug is not in the code -- it is in the assumptions. The code is doing exactly what the training data says a DEX should do. The problem is that we are not building what the training data describes.

---

The full codebase is open source: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)

351 contracts. 377 test files. 106 fuzz suites. Zero protocol fees. Every violation we found in our own code is documented.

If you want to see game theory used as production Solidity, start with `contracts/incentives/ShapleyDistributor.sol` and `test/simulation/ExtractionDetection.t.sol`. If you want to see the MEV elimination, start with `contracts/core/CommitRevealAuction.sol` and `contracts/libraries/DeterministicShuffle.sol`.

We are building in public. The extraction detection system works on us too.
