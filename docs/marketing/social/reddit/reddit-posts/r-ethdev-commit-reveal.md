# Title: Implementing commit-reveal batch auctions in Solidity — lessons from VibeSwap

## Subreddit: r/ethdev

I spent the past year building VibeSwap, a DEX that eliminates MEV through commit-reveal batch auctions. The mechanism sounds simple in theory — hide orders, reveal them, settle at a uniform price — but the implementation has real subtlety. This post covers the key design decisions, gotchas, and code patterns I landed on after many iterations.

**The mechanism in brief**

Every 10 seconds, a new batch begins:

- **Commit (8s):** Users submit `keccak256(abi.encodePacked(order, secret))` with a collateral deposit
- **Reveal (2s):** Users reveal their plaintext order + secret
- **Settle:** All valid orders execute at one uniform clearing price

**Design Decision 1: Commitment structure**

The naive approach is to hash the entire order struct. The problem: struct encoding in Solidity is not trivially canonical. Different compiler versions or struct layouts can produce different encodings for semantically identical orders.

What worked: define a canonical encoding function and hash that output explicitly.

```solidity
function commitOrder(bytes32 commitHash) external payable {
    require(msg.value >= minDeposit, "Insufficient deposit");
    require(currentPhase() == Phase.COMMIT, "Not in commit phase");
    require(!tx.origin != msg.sender || msg.sender == tx.origin, "EOA only");

    commits[currentBatchId][msg.sender] = Commit({
        hash: commitHash,
        deposit: msg.value,
        timestamp: block.timestamp,
        revealed: false
    });
}
```

The `tx.origin == msg.sender` check blocks smart contract callers, which prevents flash-loan-powered MEV strategies. This is one of the rare cases where `tx.origin` is the correct tool — we genuinely want to restrict participation to EOAs during the commit phase.

**Design Decision 2: The reveal validation problem**

During reveal, you must verify that `keccak256(abi.encodePacked(revealedOrder, secret)) == committedHash`. Straightforward. But what about partial reveals? What about orders that hash-match but contain invalid parameters (zero amounts, non-existent tokens)?

Our approach: validate the hash match first, then validate order parameters separately. If the hash matches but the order is invalid, mark it as revealed (so the user does not get slashed) but exclude it from settlement. This separates "honest but incorrect" from "malicious or absent."

```solidity
function revealOrder(Order calldata order, bytes32 secret) external {
    require(currentPhase() == Phase.REVEAL, "Not in reveal phase");
    Commit storage commit = commits[currentBatchId][msg.sender];
    require(!commit.revealed, "Already revealed");

    bytes32 computedHash = keccak256(abi.encodePacked(
        order.tokenIn, order.tokenOut,
        order.amountIn, order.minAmountOut,
        secret
    ));
    require(computedHash == commit.hash, "Hash mismatch");

    commit.revealed = true;
    // Validate order parameters separately
    if (_isValidOrder(order)) {
        revealedOrders[currentBatchId].push(order);
    }
    // Invalid order = no slash, but no execution
}
```

**Design Decision 3: Slashing economics**

50% slashing for non-reveals is aggressive. We considered 10%, 25%, and 100%. The reasoning:

- Too low (10%): griefing is cheap. Someone can spam commits with no intention of revealing, polluting batches with phantom orders that distort price expectations.
- Too high (100%): honest users who experience network issues or client bugs lose everything. This discourages participation.
- 50%: the expected value of not revealing is always negative (you lose half your deposit), which makes non-reveal a strictly dominated strategy. But honest failures cost half, not everything, so the participation risk is bounded.

The slashed funds go to the protocol treasury, not to other traders in the batch. This prevents perverse incentives where traders might benefit from others failing to reveal.

**Design Decision 4: The shuffle**

Execution order within a settled batch should not be predictable or controllable by any single party. We use Fisher-Yates shuffle seeded with XORed secrets:

```solidity
function _shuffleOrders(
    Order[] memory orders,
    bytes32[] memory secrets
) internal pure returns (Order[] memory) {
    bytes32 seed = secrets[0];
    for (uint i = 1; i < secrets.length; i++) {
        seed = seed ^ secrets[i];
    }

    for (uint i = orders.length - 1; i > 0; i--) {
        uint j = uint(keccak256(abi.encodePacked(seed, i))) % (i + 1);
        (orders[i], orders[j]) = (orders[j], orders[i]);
    }
    return orders;
}
```

The XOR of all secrets means no single participant controls the seed. As long as at least one participant's secret is genuinely random, the shuffle is unpredictable. This is a weaker assumption than requiring all participants to be honest — it only requires one honest participant.

**Design Decision 5: Uniform clearing price computation**

All orders in a batch execute at a single price. We compute this by aggregating buy and sell orders, finding the intersection of supply and demand curves, and setting the clearing price at the point that maximizes matched volume.

The gas cost of this computation scales with batch size. For batches up to ~100 orders, on-chain computation is feasible on L2s like Base. For larger batches, we use a commit-reveal pattern for the price computation itself — a keeper submits the proposed clearing price with a bond, and anyone can challenge it with a fraud proof during a brief dispute window.

**Design Decision 6: TWAP validation**

Every clearing price is validated against a TWAP oracle with a maximum 5% deviation threshold. This prevents batches from settling at manipulated prices. The oracle is internal — it tracks the exponentially weighted moving average of past clearing prices, so it cannot be manipulated via external oracle attacks.

**Gotchas I wish I had known earlier:**

1. **Reentrancy during settlement:** Settlement involves multiple token transfers. A malicious token contract could re-enter during settlement. Use `nonReentrant` on the settle function and do all state changes before transfers (checks-effects-interactions).

2. **Block timestamp manipulation:** Validators can manipulate `block.timestamp` by a few seconds. Our 8s/2s phase boundaries use block numbers as a fallback when timestamp drift exceeds 1 second.

3. **Gas griefing in reveal:** A malicious user could submit a commit with a secret that causes the reveal transaction to consume excessive gas. Bound all reveal computations and reject orders that exceed gas limits.

4. **Empty batch handling:** What happens when a batch has zero reveals? Or one? Define these edge cases explicitly. Single-order batches execute at the oracle price. Zero-reveal batches simply expire.

The full implementation is open source. Happy to discuss any of these decisions in detail — there is a lot more depth to each one than I could fit here.

---

**Links:**

- GitHub: [https://github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)
- Key contracts: `contracts/core/CommitRevealAuction.sol`, `contracts/libraries/DeterministicShuffle.sol`, `contracts/libraries/BatchMath.sol`
- Live app: [https://frontend-jade-five-87.vercel.app](https://frontend-jade-five-87.vercel.app)
- Telegram: [https://t.me/+3uHbNxyZH-tiOGY8](https://t.me/+3uHbNxyZH-tiOGY8)
