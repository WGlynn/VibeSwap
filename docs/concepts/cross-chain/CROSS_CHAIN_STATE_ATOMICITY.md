# Cross-Chain State Atomicity

**Status**: Pedagogical deep-dive on LayerZero V2 integration + atomicity tradeoffs.
**Audience**: First-encounter with cross-chain concepts is OK.
**Related**: [Cross-Chain Settlement](./CROSS_CHAIN_SETTLEMENT.md), [Rosetta Covenants Cross-Chain](./ROSETTA_COVENANTS_CROSS_CHAIN.md), [Mechanism Composition Algebra](../../architecture/MECHANISM_COMPOSITION_ALGEBRA.md).

---

## The problem, stated simply

You send $100 USDC from Ethereum to Polygon. You want the result: $100 disappeared from Ethereum AND $100 appeared on Polygon. Not one without the other.

This is the cross-chain atomicity problem. What does "atomic" mean when two separate chains are involved? How do we guarantee both sides complete, or neither completes, with no in-between state?

## Why it's hard

On a single blockchain, atomicity is easy. A transaction either commits (all changes happen) or reverts (nothing happens). The chain's consensus guarantees it.

Across two chains, there's no shared consensus. Chain A doesn't know what Chain B did until someone tells it. The messenger (called a "bridge" or "oracle") is a separate system.

Concrete example of what can go wrong: you initiate a transfer. Chain A burns your USDC. The bridge is supposed to tell Chain B to mint. But the bridge has a bug, or is slow, or is compromised. Your USDC is burned on A but never minted on B. Your money is lost.

This is the fundamental cross-chain risk. Solutions differ in how they mitigate it.

## The spectrum of atomicity

Cross-chain operations fall on a spectrum:

### Weak (most of the internet circa 2024)

Chain A executes. A separate system notifies Chain B. Chain B executes. No synchronization; if the notifier fails, you have inconsistent state.

**Concrete failure**: Wormhole hack 2022. Bridge exploit minted 120,000 wETH on Solana without burning ETH on Ethereum. ~$320M stolen.

Most production cross-chain systems sit here. Acceptable for unimportant data; unacceptable for money.

### Optimistic (popular 2024)

Chain A executes. Chain B executes optimistically. A challenge window allows disputes; if challenged and the challenge succeeds, the action is reverted.

**Used by**: Optimism's native bridge, Arbitrum, many rollups.

**Tradeoffs**: operations have delay (7-day challenge windows common). If a fraud is caught, it's caught; but fraud must be detected and challenged within the window.

### ZK-verified (emerging 2025+)

Chain A executes + produces a ZK proof of execution. Chain B verifies the proof; if valid, Chain B executes.

**Advantages**: cryptographic certainty. No challenge window needed; proof suffices.

**Tradeoffs**: ZK proofs are expensive to generate; proof-of-L1-activity is complex.

### Atomic-native (rare)

Two chains share a consensus mechanism that includes both. Transactions span both; consensus treats them as single transactions.

**Examples**: Cosmos IBC with light clients; Polkadot parachain exchange.

**Tradeoffs**: requires coordinated consensus, which limits which chains can participate.

VibeSwap uses LayerZero V2 which operates in the Optimistic tier with some ZK-enhanced features.

## LayerZero V2 primer

LayerZero is a general-purpose messaging protocol that lets contracts on one chain trigger contracts on another.

Conceptually:

1. Contract on Chain A sends a message via LayerZero.
2. LayerZero validators (the "Decentralized Verifier Network") verify the message was sent.
3. LayerZero executors relay the message to Chain B.
4. Contract on Chain B receives the message and executes.

Key properties:
- **Ordering**: messages in a channel arrive in order.
- **Liveness**: messages eventually deliver (bounded latency under normal conditions).
- **Replay resistance**: each message has a unique GUID; double-delivery detected and rejected.
- **Retry semantics**: failed delivery can be retried; consumers must handle idempotently.

These are solid foundations but not atomic. A cross-chain operation using LayerZero is NOT atomic by default — Chain A commits, message is sent, Chain B eventually processes (possibly delayed, possibly retried).

## What VibeSwap does

VibeSwap uses LayerZero for cross-chain operations but layers on atomicity guarantees:

### Pattern 1 — Commitment with reveal

Chain A commits (burn tokens, record intent). LayerZero message is sent. Chain B receives message, verifies, and reveals (mints tokens, completes action).

Atomicity property: if Chain A's commit is final but Chain B's reveal fails (e.g., contract paused), the commit stays on Chain A but is claimable back (recoverable state).

**Concrete example**: user bridges 100 USDC from Ethereum to Polygon.
- Ethereum: `bridgeOut(100, polygonChainId, userAddr)` — USDC is burned.
- LayerZero: `send(polygonChainId, mintMessage)` — message dispatched.
- Polygon: receives message, mints 100 USDC to userAddr.

If Polygon step fails (contract upgrade paused minting), the Ethereum burn is recoverable via `recoverBridge()` after a timeout. Money not lost.

### Pattern 2 — Optimistic execution with challenge

Chain A commits. Chain B executes optimistically. A challenge window (7 days) allows disputes.

Used for: large-value cross-chain operations where speed matters, and challenge-window delay is tolerable.

**Concrete example**: cross-chain Shapley distribution. Compute on Chain A, distribute on Chain B. Challenge window allows disputing if Chain A's computation was incorrect.

### Pattern 3 — ZK-verified

Chain A executes + produces ZK proof. Chain B verifies proof on receipt.

Used for: highest-value operations where immediate certainty is required.

**Concrete example**: cross-chain governance votes. Vote tally on Chain A + ZK-proof of correct counting. Chain B verifies the proof and executes the governance decision.

## The pieces you need

To implement cross-chain atomicity, you need:

### Piece 1 — Message format

A standard structure for cross-chain messages. VibeSwap uses:

```solidity
struct CrossChainMessage {
    uint8  messageType;     // 0=transfer, 1=vote, 2=attestation, etc.
    bytes32 originChain;
    bytes32 originContract;
    bytes32 nonce;          // prevents replay
    bytes   payload;        // type-specific data
}
```

### Piece 2 — Receipt contract

Contract on Chain B that receives messages and dispatches to the right handler:

```solidity
function lzReceive(
    Origin calldata _origin,
    bytes32 _guid,
    bytes calldata _message,
    address _executor,
    bytes calldata _extraData
) internal override {
    // Verify sender
    // Parse message
    // Dispatch to handler
    // Emit event
}
```

### Piece 3 — Recovery contract

Contract on Chain A that handles recovery if Chain B doesn't respond:

```solidity
function recoverBridge(bytes32 messageGuid) external {
    // Verify enough time has passed
    // Verify Chain B didn't complete
    // Refund user
}
```

### Piece 4 — Idempotency guard

Contract on Chain B that prevents double-execution if a message is retried:

```solidity
mapping(bytes32 => bool) public executedMessages;

modifier notAlreadyExecuted(bytes32 guid) {
    require(!executedMessages[guid], "already executed");
    executedMessages[guid] = true;
    _;
}
```

### Piece 5 — Monitoring and alerts

Off-chain monitoring: watch Chain A's outbound messages; watch Chain B's receipts; alert on discrepancies.

## What's easy, what's hard

### Easy to do correctly

- Simple token transfers (mature patterns, well-tested).
- Information-only messages (announcements, state updates).
- Atomic-within-chain operations.

### Medium difficulty

- Cross-chain voting aggregation.
- Cross-chain attestation replication.
- Cross-chain oracle synchronization.

### Hard

- Cross-chain AMM trading (requires synchronized state).
- Cross-chain composed DeFi operations.
- Cross-chain governance where votes span chains.

VibeSwap's current roadmap focuses on medium-difficulty integrations, deferring the hardest to V2+ when the cryptographic primitives mature.

## Security posture

Cross-chain is the #1 attack surface in DeFi (by $ stolen historically). Discipline:

1. **Minimize cross-chain dependencies**. Most value should be chain-local; cross-chain only where coordination demands it.
2. **Use production-hardened messaging**. LayerZero V2 is battle-tested; custom bridges are not.
3. **Always provide recovery paths**. Users should never lose funds due to cross-chain issues.
4. **Monitor continuously**. Watch for discrepancies; investigate anomalies immediately.
5. **Isolate blast radius**. A cross-chain exploit should affect only the cross-chain operation, not the entire protocol.
6. **Audit cross-chain code harder than chain-local**. 2x-3x audit rigor, different audit firms for independent verification.

## The user experience

From user perspective, cross-chain atomicity should be invisible. User says "bridge 100 USDC to Polygon" and:
- Sees estimated time.
- Sees intermediate status (Ethereum burn → message sent → Polygon mint).
- Sees final success or error.

If anything goes wrong, user should get clear error + recovery path. "Transaction failed" is not enough; "Transaction failed on Polygon, your funds are in bridge contract, claim via X" is.

## For students

Exercise: design a cross-chain atomic-swap protocol.

- Alice on Chain A has 1 ETH, wants 100 USDC.
- Bob on Chain B has 100 USDC, wants 1 ETH.
- Design a protocol where both transfers complete, or neither does.

Hints: Hashed-time-lock contracts (HTLCs) are a classical approach. LayerZero or similar messaging is another. ZK-proofs of state are emerging.

Compare your design to production bridges (e.g., AtomicLoans, Thorchain). Where does yours differ? What tradeoffs did you make?

## The lesson

Cross-chain atomicity is a real engineering challenge with multiple solution patterns, each with tradeoffs. No single solution is "best"; architecture depends on:
- Value at stake.
- Speed requirements.
- Liquidity constraints.
- Security tolerance.

VibeSwap's approach: use LayerZero V2 for messaging, layer on pattern-specific atomicity, provide user-facing recovery paths, monitor continuously.

## One-line summary

*Cross-chain atomicity = getting two chains to agree on a shared outcome without shared consensus — spectrum from weak (most existing) to atomic-native (rare). VibeSwap uses LayerZero V2 plus commit-with-reveal / optimistic / ZK patterns per operation. Pedagogical walkthrough: user-story for USDC bridge + recovery pathway + code-structure guide.*
