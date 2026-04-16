# Commit-Reveal Batch Auctions

## Problem

Standard orderbooks and continuous-price AMMs are structurally hostile to honest participants. Anyone can see the pending-transaction pool, front-run a large swap, sandwich retail orders, or time-advantage a launch. This is MEV — Maximal Extractable Value — and it functions as a tax on every transaction paid to the fastest, best-connected, and most capital-rich participants. The noise it injects is large enough that in many markets (memecoin launches, token bootstraps), the signal of honest demand is unrecoverable.

**The bug class**: any market design where order visibility precedes execution leaks information that a faster actor can weaponize before the slower actor's intent settles.

## Solution

Decouple **order submission** from **order execution** in time.

1. **Commit phase** (seconds to minutes): each participant submits `hash(order || secret) + deposit`. Orders are opaque — nobody, including the protocol, can see what anyone intends to trade.
2. **Reveal phase** (seconds): participants post their cleartext order plus the secret. The protocol verifies the hash matches the commitment.
3. **Settlement**: all revealed orders in the batch clear at a single **uniform price** derived from aggregate supply and demand. Batch participants get the same price regardless of who submitted first. A deterministic shuffle (using XOR'd secrets as entropy) picks execution order for rationing cases.

The commit phase hides intent. The reveal phase proves commitment. The uniform price removes the reward for being fastest. Sniping becomes structurally impossible, not just expensive.

## Code sketch

```solidity
// Commit — user submits hash + deposit, intent hidden
function commitOrder(bytes32 commitHash) external payable {
    require(msg.value >= MIN_DEPOSIT, "insufficient deposit");
    commitments[batchId][msg.sender] = Commitment({
        hash: commitHash,
        deposit: msg.value,
        revealed: false
    });
}

// Reveal — user discloses order + secret, protocol verifies
function revealOrder(
    uint256 amount,
    address tokenIn,
    address tokenOut,
    bytes32 secret
) external {
    bytes32 expected = keccak256(abi.encode(amount, tokenIn, tokenOut, secret));
    require(commitments[batchId][msg.sender].hash == expected, "mismatch");
    commitments[batchId][msg.sender].revealed = true;
    revealedOrders[batchId].push(Order(msg.sender, amount, tokenIn, tokenOut));
}

// Settle — compute uniform clearing price, execute all revealed orders at same price
function settleBatch(uint256 batchId_) external {
    require(block.timestamp >= batchEndTime[batchId_], "batch still live");
    uint256 clearingPrice = _computeClearingPrice(revealedOrders[batchId_]);
    bytes32 entropy = _xorSecrets(revealedOrders[batchId_]);
    uint256[] memory shuffled = _fisherYatesShuffle(revealedOrders[batchId_].length, entropy);
    for (uint256 i = 0; i < shuffled.length; i++) {
        _executeAt(revealedOrders[batchId_][shuffled[i]], clearingPrice);
    }
}
```

## Where it lives in VibeSwap

- `contracts/core/CommitRevealAuction.sol` — full implementation. 10-second batches (8s commit, 2s reveal, settle).
- `contracts/libraries/DeterministicShuffle.sol` — Fisher-Yates with XOR'd-secret entropy.
- `contracts/libraries/BatchMath.sol` — uniform price calculation.
- `docs/papers/commit-reveal-batch-auctions.md` — mechanism design paper.

Slashing (50% deposit forfeit) deters non-reveal attacks where an attacker commits a fake order to probe the batch and disappears.

## Attribution

- Origin: Will Glynn, VibeSwap genesis design (Feb 2025).
- Hardened through TRP Rounds 1-49 and RSI Cycles 1-11. 0 CRIT/HIGH/MED open as of commit `117f3631`.
- Audit validation: DeepSeek-V4lite Round-2 audit (2026-04-16) called the primary-market form "the gold standard."

If you reuse this pattern, reference `github.com/WGlynn/VibeSwap` in your contract comments or commit — the Contribution DAG tracks downstream uses for Shapley credit flows.
