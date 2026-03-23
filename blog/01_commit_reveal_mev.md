# How Commit-Reveal Batch Auctions Eliminate MEV

Every swap you make on Uniswap, SushiSwap, or any continuous-execution DEX is visible to the entire network before it lands. Your pending transaction sits in the mempool like a poker hand played face-up. Searchers see your trade, calculate the profit available from front-running it, and pay block builders to sandwich your order between theirs. You get worse execution. They pocket the difference. Over $1 billion per year flows from regular users to MEV extractors through this exact mechanism.

This is not a bug in any particular DEX. It is a structural consequence of sequential order execution. And it can be eliminated entirely.

I built [VibeSwap](https://github.com/wglynn/vibeswap) to prove it. This post walks through the mechanism design -- commit-reveal batch auctions with deterministic shuffling and uniform clearing prices -- and explains why it makes sandwich attacks mathematically impossible rather than merely difficult.

## Why Sandwich Attacks Exist

A sandwich attack has three ingredients:

1. **Visibility** -- the attacker can see your pending swap before it executes
2. **Ordering control** -- the attacker can place transactions before and after yours
3. **Price impact** -- your swap moves the price, creating a spread the attacker captures

The attacker front-runs your buy (pushing the price up), lets your swap execute at the inflated price, then back-runs by selling (pocketing the difference). The math is simple: if your swap moves the price by 0.3%, the attacker captures most of that 0.3% minus gas.

The critical insight is that all three ingredients depend on one thing: **sequential execution with observable ordering**. If you remove either the observability or the ordering, the attack collapses.

Commit-reveal batch auctions remove both.

## The Mechanism: Three Phases, Ten Seconds

VibeSwap processes trades in discrete 10-second batches. Each batch has three phases:

```
 COMMIT (8 seconds)        REVEAL (2 seconds)        SETTLE
 +-----------------+       +-----------------+       +-----------------+
 | hash(order|sec) |       | order + secret  |       | shuffle orders  |
 | hash(order|sec) |  -->  | order + secret  |  -->  | find uniform    |
 | hash(order|sec) |       | order + secret  |       |   clearing price|
 | ...             |       | ...             |       | execute all     |
 +-----------------+       +-----------------+       +-----------------+
   Orders hidden             Orders visible            Single price
   No information leak        Too late to act           No ordering advantage
```

**Commit phase (8 seconds).** Users submit a cryptographic commitment: `keccak256(trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)`. The contract stores only this hash. Nobody -- not other traders, not validators, not MEV searchers -- can see the order details. The user also posts a deposit (minimum 0.001 ETH or 5% of trade value) as collateral.

**Reveal phase (2 seconds).** Users reveal their actual order parameters along with their secret. The contract verifies `keccak256(revealed params) == stored hash`. If verification fails, the deposit is slashed 50%. This creates a strong incentive to commit honestly and always reveal.

**Settlement.** All revealed orders execute simultaneously at a single uniform clearing price. There is no ordering within the batch because execution order is irrelevant when everyone gets the same price.

Here is the core of the commit function from [CommitRevealAuction.sol](https://github.com/wglynn/vibeswap/blob/master/contracts/core/CommitRevealAuction.sol):

```solidity
function commitOrderToPool(
    bytes32 poolId,
    bytes32 commitHash,
    uint256 estimatedTradeValue
) public payable nonReentrant inPhase(BatchPhase.COMMIT) returns (bytes32 commitId) {
    if (commitHash == bytes32(0)) revert InvalidHash();

    // Flash loan protection - same-block interaction guard
    if (lastInteractionBlock[msg.sender] == block.number) {
        revert FlashLoanDetected();
    }
    lastInteractionBlock[msg.sender] = block.number;

    // Collateral: 5% of trade value or minimum deposit
    uint256 collateralRequired = (estimatedTradeValue * COLLATERAL_BPS) / 10000;
    uint256 requiredDeposit = collateralRequired > MIN_DEPOSIT
        ? collateralRequired : MIN_DEPOSIT;
    if (msg.value < requiredDeposit) revert InsufficientDeposit();

    commitments[commitId] = OrderCommitment({
        commitHash: commitHash,
        batchId: currentBatchId,
        depositAmount: msg.value,
        depositor: msg.sender,
        status: CommitStatus.COMMITTED
    });
}
```

The `inPhase(BatchPhase.COMMIT)` modifier enforces timing at the protocol level. You literally cannot submit a commit during the reveal phase or vice versa. These are not configurable parameters -- they are protocol constants.

## The Fisher-Yates Shuffle: Why Execution Order Cannot Be Gamed

Even with hidden orders and uniform pricing, you might worry about edge cases where order *position* matters -- partial fills during liquidity constraints, for example. VibeSwap eliminates this vector too, using a deterministic Fisher-Yates shuffle seeded by participants' own secrets.

During the reveal phase, every participant submits a `bytes32 secret`. At settlement, these secrets are XORed together and combined with unpredictable block entropy to produce a shuffle seed:

```solidity
function generateSeedSecure(
    bytes32[] memory secrets,
    bytes32 blockEntropy,
    uint64 batchId
) internal pure returns (bytes32 seed) {
    // XOR all participant secrets
    seed = bytes32(0);
    for (uint256 i = 0; i < secrets.length; i++) {
        seed = seed ^ secrets[i];
    }
    // Mix with post-reveal block entropy (unknown during reveal phase)
    seed = keccak256(abi.encodePacked(
        seed,
        blockEntropy,   // blockhash from after reveal ended
        batchId,
        secrets.length
    ));
}
```

The `blockEntropy` parameter is the blockhash of the block *after* the reveal phase ends. This is the key security property: even the last person to reveal cannot predict the final shuffle seed, because it depends on a future blockhash that does not exist yet at reveal time. The seed is then fed into a standard Fisher-Yates shuffle to determine execution order.

This means no participant can choose or predict their position in the execution queue. The shuffle is deterministic (anyone can verify it), but unpredictable at commitment time. The ordering attack surface drops to zero.

## Uniform Clearing Price: The Final Nail

The most important piece is the clearing price algorithm. Rather than executing each order sequentially against the AMM curve (where each trade moves the price for the next one), VibeSwap computes a single price at which supply meets demand across the entire batch.

The `BatchMath` library uses binary search to find this equilibrium:

1. Aggregate all buy orders willing to pay at or above a candidate price
2. Aggregate all sell orders willing to accept at or below that price
3. Adjust the candidate price until buy volume equals sell volume
4. Execute **all** orders at this single clearing price

This is the mechanism that kills sandwich attacks outright. A sandwich requires the attacker's front-run trade to move the price *before* your trade executes. When all trades in a batch settle at the same price simultaneously, there is no "before" and "after." The attack is not just unprofitable -- it is structurally impossible. There is no sequential price impact to exploit because there is no sequence.

If an attacker submits a large buy order hoping to inflate the price, that order is simply included in the batch. It affects the clearing price, but the attacker gets the same clearing price as everyone else. They cannot buy low and sell high within the same batch because the price is uniform.

## What About the Costs?

There are real trade-offs to this design. Batch auctions introduce latency -- you wait up to 10 seconds instead of getting instant execution. The commit-reveal pattern requires two transactions instead of one (though the reveal can be automated client-side). And the 50% slashing penalty for failed reveals means you need to stay online through the reveal window or risk losing your deposit.

These are deliberate design choices, not oversights. The 10-second batch window is short enough to be practical for most trading but long enough to aggregate meaningful order flow. The two-transaction cost is the price of information hiding -- there is no way to hide order details in a single atomic transaction on a transparent blockchain. And the slashing penalty is what makes the commitment credible; without it, users could commit speculatively and selectively reveal only when favorable.

## Implications for DEX Design

The broader lesson here is that MEV is not an inevitable feature of decentralized trading. It is a consequence of specific mechanism choices -- continuous execution, observable mempools, sequential ordering -- that most DEXs inherited from centralized exchange models without questioning whether those models fit a transparent blockchain environment.

Commit-reveal batch auctions demonstrate that you can preserve the permissionless, non-custodial properties of DeFi while eliminating the information asymmetries that make extraction profitable. The key principles:

- **Temporal decoupling**: separate the moment of commitment from the moment of information revelation
- **Batch execution**: replace sequential processing with simultaneous settlement
- **Uniform pricing**: give every participant in a batch the same execution price
- **Collaborative randomness**: let participants collectively determine execution ordering through contributed entropy

These are not theoretical constructs. The contracts are deployed, tested with fuzz testing suites, and [open source](https://github.com/wglynn/vibeswap). MEV resistance is not a feature you bolt on after the fact. It is a property that emerges from getting the mechanism design right from the start.

---

*Will Glynn is a smart contract engineer and mechanism designer building VibeSwap, an omnichain DEX on LayerZero V2. The full protocol specification is available in the [VibeSwap whitepaper](https://github.com/wglynn/vibeswap).*
