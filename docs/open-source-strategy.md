# Open Source Visibility Strategy

## The Insight

There are ZERO results for "cooperative game theory solidity" and "mev protection solidity" on GitHub. We don't need to contribute to other repos — we need to make ours the one everyone finds.

## Strategy: Extractable Libraries

Package our unique components as standalone, importable libraries. This is how OpenZeppelin grew — useful building blocks that everyone depends on.

### Library 1: PairwiseFairness.sol (Ready Now)
- On-chain fairness verification: proportionality, efficiency, null player, time neutrality
- No dependency on VibeSwap — pure library, any project can use it
- Publish as Foundry package: `forge install WGlynn/pairwise-fairness`

### Library 2: BatchAuctionLib.sol (Extract from CommitRevealAuction)
- Commit-reveal with Fisher-Yates shuffle using XORed secrets
- Any DEX or NFT marketplace can use batch auctions
- The MEV dissolution primitive

### Library 3: ShapleyDistribution.sol (Extract core logic)
- Weighted contribution → proportional distribution → Lawson floor
- Any protocol with reward distribution can use this instead of simple pro-rata

### Library 4: CircuitBreakerLib.sol (Extract from CircuitBreaker)
- Volume/price/withdrawal thresholds with automatic cooldown
- Every DeFi protocol needs this and most roll their own

## Execution Plan

1. Extract PairwiseFairness into its own repo with README + examples
2. Submit to awesome-solidity lists
3. Write a Medium article: "On-Chain Fairness Verification in Solidity"
4. Cross-post to ethresear.ch
5. The library pulls people to VibeSwap organically

## Why This Beats Contributing to Other Repos

- Contributing a PR to Uniswap gets you one checkmark
- Publishing a library that Uniswap COULD use gets you an ecosystem
- OpenZeppelin didn't get big by contributing to other projects — they built the standard
