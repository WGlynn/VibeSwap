# Cross-Chain Settlement Guarantees: Unified Fairness Across Every Chain

## How VibeSwap Extends Commit-Reveal Batch Auctions Across Chains via LayerZero V2

**Author**: Faraday1
**Date**: March 2026
**Version**: 1.0

---

## Abstract

Cross-chain decentralized exchanges typically sacrifice fairness properties when bridging between networks. Same-chain guarantees — atomic execution, uniform pricing, MEV resistance — degrade into probabilistic promises once messages must traverse bridge infrastructure. Users on "remote" chains receive second-class execution: higher latency, weaker price guarantees, and exposure to bridge-specific attack vectors.

VibeSwap eliminates this asymmetry. By extending its commit-reveal batch auction mechanism to cross-chain participation via LayerZero V2, VibeSwap ensures that a trader on Arbitrum committing to a batch settling on Ethereum receives identical fairness properties to a trader on Ethereum itself: the same uniform clearing price, the same random execution ordering, the same collateral requirements, and the same slashing penalties. Cross-chain orders are first-class citizens in every batch.

This paper describes the message flow architecture, replay prevention mechanisms, rate limiting, settlement atomicity, graceful degradation under bridge failure, and the protocol's unconditional 0% bridge fee policy. We compare VibeSwap's approach to existing cross-chain DEX architectures (THORChain, deBridge, Across) and demonstrate that commit-reveal batching provides strictly stronger cross-chain fairness guarantees.

---

## Table of Contents

1. [The Cross-Chain Fairness Problem](#1-the-cross-chain-fairness-problem)
2. [VibeSwap's Approach: Extending Commit-Reveal](#2-vibeswaps-approach-extending-commit-reveal)
3. [Message Types and Flow](#3-message-types-and-flow)
4. [Replay Prevention](#4-replay-prevention)
5. [Rate Limiting](#5-rate-limiting)
6. [Settlement Atomicity](#6-settlement-atomicity)
7. [Bridged Deposit Security](#7-bridged-deposit-security)
8. [Graceful Degradation](#8-graceful-degradation)
9. [Zero Bridge Fees — Always](#9-zero-bridge-fees--always)
10. [Comparison with Existing Cross-Chain DEXs](#10-comparison-with-existing-cross-chain-dexs)
11. [Conclusion](#11-conclusion)

---

## 1. The Cross-Chain Fairness Problem

### 1.1 What Same-Chain DEXs Guarantee

On a single chain, VibeSwap's batch auction provides the following properties:

| Property | Mechanism |
|----------|-----------|
| **Uniform clearing price** | All orders in a batch settle at the same price |
| **MEV resistance** | Commit-reveal prevents front-running; random ordering prevents positional advantage |
| **Atomic settlement** | Entire batch settles as one transaction — all or nothing |
| **Collateral enforcement** | 5% collateral required for every commit |
| **Slashing deterrence** | 50% penalty for invalid or missing reveals |

### 1.2 How Cross-Chain DEXs Typically Fail

When trading crosses chain boundaries, these properties degrade:

**Latency asymmetry**: A trader on Chain A submits an order that must be relayed to Chain B. During relay, conditions change. The order may be stale by the time it arrives. Same-chain traders have a temporal advantage.

**Price asymmetry**: If the cross-chain order arrives after the price has moved, the remote trader either gets worse execution or the order fails. Same-chain traders get the current price; remote traders get the delayed price.

**Settlement non-atomicity**: If the trade settles on Chain B but the asset transfer back to Chain A fails, the remote trader has exposure without settlement. This creates a window of vulnerability that same-chain traders do not face.

**MEV on the bridge**: Bridge relayers can observe cross-chain messages and front-run them on the destination chain. The bridge itself becomes an MEV extraction point.

### 1.3 The Design Requirement

VibeSwap's cross-chain architecture must satisfy a strict invariant:

> **Cross-Chain Fairness Invariant**: A cross-chain order must receive identical treatment to a same-chain order in every measurable dimension — price, ordering, collateral, slashing, and settlement timing.

If this invariant does not hold, rational traders will always prefer same-chain trading, fragmenting liquidity and undermining the omnichain value proposition.

---

## 2. VibeSwap's Approach: Extending Commit-Reveal

### 2.1 Architecture Overview

VibeSwap deploys a `CrossChainRouter` contract on every supported chain. Each router is a LayerZero V2 OApp that communicates with its peers on other chains. The router relays commit and reveal messages to the destination chain's `CommitRevealAuction` contract, which treats them identically to local orders.

```
Chain A (Source)                          Chain B (Destination)
┌──────────────────┐                     ┌──────────────────┐
│ User commits     │                     │                  │
│ on Chain A       │                     │                  │
│       │          │                     │                  │
│       ▼          │                     │                  │
│ CrossChainRouter │ ── ORDER_COMMIT ──► │ CrossChainRouter │
│                  │    (LayerZero V2)   │       │          │
│                  │                     │       ▼          │
│                  │                     │ CommitRevealAuction │
│                  │                     │ (treats as local)│
│                  │                     │       │          │
│ User reveals     │                     │       │          │
│ on Chain A       │                     │       │          │
│       │          │                     │       │          │
│       ▼          │                     │       │          │
│ CrossChainRouter │ ── ORDER_REVEAL ──► │ CrossChainRouter │
│                  │                     │       │          │
│                  │                     │       ▼          │
│                  │                     │ Batch settles    │
│                  │                     │       │          │
│                  │ ◄─ BATCH_RESULT ─── │ CrossChainRouter │
│ User receives    │                     │                  │
│ settlement       │                     │                  │
└──────────────────┘                     └──────────────────┘
```

### 2.2 Why Commit-Reveal Is Ideal for Cross-Chain

The commit-reveal mechanism provides a natural time buffer that accommodates cross-chain message latency:

- **Commit phase**: 8 seconds. A cross-chain commit must arrive within this window. LayerZero V2 typical delivery time is 1-3 seconds on most chains.
- **Reveal phase**: 2 seconds. A cross-chain reveal must arrive within this window. This is tight but achievable with pre-staged messages.
- **Settlement**: Occurs after the reveal phase closes. No time pressure — results are broadcast to all chains after settlement completes.

The batch structure means that cross-chain latency is absorbed by the phase duration, not imposed on other participants. A cross-chain order that arrives at t=7s during the commit phase is treated identically to a local order that arrived at t=0s.

### 2.3 Peer Configuration

Each `CrossChainRouter` maintains a mapping of verified peer contracts on other chains:

```solidity
/// @notice Peer contracts on other chains (eid => peer address)
mapping(uint32 => bytes32) public peers;
```

Only messages from verified peers are processed. This prevents unauthorized contracts from injecting fake orders into the system.

---

## 3. Message Types and Flow

### 3.1 Message Type Enumeration

The `CrossChainRouter` supports five message types:

```solidity
enum MessageType {
    ORDER_COMMIT,      // Source → Destination: Submit a commit hash
    ORDER_REVEAL,      // Source → Destination: Reveal order details
    BATCH_RESULT,      // Destination → All: Settlement results
    LIQUIDITY_SYNC,    // Bidirectional: Reserve state synchronization
    ASSET_TRANSFER     // Source → Destination: Token transfer via OFT
}
```

### 3.2 Message Flow Detail

**ORDER_COMMIT (Source → Destination)**

A user on the source chain calls `sendCommit` with their commit hash. The router encodes the commit data — including the depositor's address, deposit amount, source chain ID, destination chain ID, and source timestamp — and sends it via LayerZero to the destination chain's router.

```solidity
struct CrossChainCommit {
    bytes32 commitHash;
    address depositor;
    uint256 depositAmount;
    uint32 srcChainId;
    uint32 dstChainId;     // Destination chain for replay prevention
    uint256 srcTimestamp;   // Timestamp from source chain
}
```

On the destination chain, the router reconstructs the commit ID deterministically from the same parameters and stores the pending commit.

**ORDER_REVEAL (Source → Destination)**

After the commit phase, the user reveals their order on the source chain. The router relays the reveal data — including the commit ID, token addresses, amounts, secret, and priority bid — to the destination chain.

```solidity
struct CrossChainReveal {
    bytes32 commitId;
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minAmountOut;
    bytes32 secret;
    uint256 priorityBid;
    uint32 srcChainId;
}
```

The destination router calls `revealOrderCrossChain` on the local `CommitRevealAuction`, which validates the reveal against the previously stored commit.

**BATCH_RESULT (Destination → All)**

After settlement, the batch results — clearing price, filled traders, filled amounts — are broadcast to all connected chains:

```solidity
struct BatchResult {
    uint64 batchId;
    bytes32 poolId;
    uint256 clearingPrice;
    address[] filledTraders;
    uint256[] filledAmounts;
}
```

This enables each source chain to reconcile fills and trigger asset transfers.

**LIQUIDITY_SYNC (Bidirectional)**

Reserve state is synchronized across chains to enable accurate pricing and slippage estimation:

```solidity
struct LiquiditySync {
    bytes32 poolId;
    uint256 reserve0;
    uint256 reserve1;
    uint256 totalLiquidity;
}
```

**ASSET_TRANSFER (Source → Destination)**

Actual token transfers use LayerZero's OFT (Omnichain Fungible Token) standard, which handles the lock-and-mint or burn-and-mint mechanics of cross-chain token movement.

---

## 4. Replay Prevention

### 4.1 Message-Level Replay Prevention

Every LayerZero message has a unique GUID (Global Unique Identifier). The router tracks processed GUIDs:

```solidity
/// @notice Processed message GUIDs (prevent replay)
mapping(bytes32 => bool) public processedMessages;
```

On receipt, the router checks and marks the GUID:

```solidity
if (processedMessages[_guid]) revert AlreadyProcessed();
processedMessages[_guid] = true;
```

### 4.2 Cross-Chain Replay Prevention

A commit intended for Chain B must not be replayable on Chain C. The commit ID includes both the source and destination chain IDs:

```solidity
bytes32 commitId = keccak256(abi.encodePacked(
    msg.sender,
    commitHash,
    block.chainid,      // Source chain
    dstEid,             // Destination chain
    srcTimestamp
));
```

The destination router independently verifies that the message's destination chain matches its own chain ID:

```solidity
require(commit.dstChainId == uint32(block.chainid), "Wrong destination chain");
```

This two-layer check — unique commit ID incorporating both chains, plus explicit destination verification — makes cross-chain replay attacks impossible. A commit for Ethereum cannot be replayed on Arbitrum because:

1. The commit ID would differ (different `dstEid`)
2. The destination check would fail (`commit.dstChainId != block.chainid`)

---

## 5. Rate Limiting

### 5.1 Per-Source-Chain Rate Limits

The router enforces a maximum number of messages per source chain per hour:

```solidity
/// @notice Rate limiting: messages per chain per hour
mapping(uint32 => uint256) public messageCount;
mapping(uint32 => uint256) public lastResetTime;
uint256 public maxMessagesPerHour; // Default: 1000
```

### 5.2 Sliding Window Design

The rate limiter uses a sliding window to prevent hour-boundary doubling attacks (where an attacker sends `maxMessages` at 59:59 and again at 60:01):

```solidity
function _checkRateLimit(uint32 srcEid) internal {
    uint256 currentTime = block.timestamp;
    uint256 lastReset = lastResetTime[srcEid];

    if (currentTime > lastReset + 1 hours) {
        messageCount[srcEid] = 0;
        lastResetTime[srcEid] = currentTime;
    }

    if (messageCount[srcEid] >= maxMessagesPerHour) {
        revert RateLimited();
    }

    messageCount[srcEid]++;
}
```

### 5.3 Why 1,000 Messages Per Hour

At 10-second batch intervals, there are 360 batches per hour. Even with 100% cross-chain participation and multiple orders per batch, 1,000 messages per source chain per hour provides substantial headroom while preventing flooding attacks.

| Scenario | Messages/Hour | Within Limit? |
|----------|--------------|---------------|
| 1 cross-chain order per batch | 360 | Yes |
| 2 orders per batch + reveals | 720 | Yes |
| Normal operation with liquidity syncs | ~800 | Yes |
| Flooding attack | 10,000+ | Rejected |

---

## 6. Settlement Atomicity

### 6.1 On-Chain Atomicity

Within the destination chain, the batch settles as a single transaction. All orders — both local and cross-chain — are processed together. Either every order in the batch settles, or none do. This is the standard EVM atomicity guarantee.

### 6.2 Cross-Chain Settlement Flow

After on-chain settlement:

1. The `CommitRevealAuction` resolves the batch with a uniform clearing price
2. The `CrossChainRouter` broadcasts `BATCH_RESULT` to all connected chains
3. Each source chain receives the results and reconciles fills
4. Asset transfers are initiated via OFT for cross-chain fills

### 6.3 Failure Handling

If a cross-chain reveal fails (e.g., the commit was not found or was invalid), the router emits an event but does not revert the entire message:

```solidity
try auctionContract.revealOrderCrossChain{value: priorityBidToSend}(
    reveal.commitId,
    commit.depositor,
    reveal.tokenIn,
    reveal.tokenOut,
    reveal.amountIn,
    reveal.minAmountOut,
    reveal.secret,
    priorityBidToSend
) {
    // Success
} catch {
    emit CrossChainRevealFailed(reveal.commitId, srcEid, "Reveal rejected");
}
```

This graceful failure prevents a single invalid cross-chain reveal from blocking the processing of other valid messages.

---

## 7. Bridged Deposit Security

### 7.1 The Deposit Problem

Cross-chain commits include a deposit amount, but the actual funds must be bridged separately (via OFT or other asset bridge). The router must track expected deposits and prevent use of unbridged funds.

### 7.2 Bridged Deposit Tracking

```solidity
/// @notice Verified bridged deposits per commit
mapping(bytes32 => uint256) public bridgedDeposits;

/// @notice Timestamp when bridged deposit was created
mapping(bytes32 => uint256) public bridgedDepositTimestamp;

/// @notice Total bridged deposits awaiting processing
uint256 public totalBridgedDeposits;
```

When a commit message arrives, the expected deposit amount is recorded. The actual deposit must be funded separately via `fundBridgedDeposit()`, which follows the Checks-Effects-Interactions (CEI) pattern:

```solidity
function fundBridgedDeposit(bytes32 commitId) external payable onlyAuthorized nonReentrant {
    // Checks
    require(msg.value >= commit.depositAmount, "Insufficient deposit");
    require(bridgedDeposits[commitId] > 0, "Already funded or not pending");

    // Effects (before external calls)
    bridgedDeposits[commitId] = 0;
    totalBridgedDeposits -= depositAmount;

    // Interactions
    ICommitRevealAuction(auction).commitOrder{value: depositAmount}(commit.commitHash);
}
```

### 7.3 Deposit Recovery

If a bridged deposit is not funded within the expiry period (default 24 hours), the original depositor or the contract owner can recover it:

```solidity
function recoverExpiredDeposit(bytes32 commitId) external nonReentrant {
    // ... validation ...
    // Transfer ETH back to depositor
    (bool success, ) = commit.depositor.call{value: depositAmount}("");
    require(success, "Recovery transfer failed");
}
```

This ensures that cross-chain deposits are never permanently lost, even if the bridging process fails.

---

## 8. Graceful Degradation

### 8.1 What Happens When LayerZero Goes Offline?

Bridge infrastructure can experience downtime. VibeSwap is designed to degrade gracefully:

| Failure Mode | Impact | Mitigation |
|-------------|--------|------------|
| LayerZero offline | Cross-chain orders cannot be submitted | Same-chain trading continues unaffected |
| Single chain offline | Orders from that chain are queued | Other chains continue normally |
| Delayed messages | Cross-chain orders miss their batch | Orders can be included in the next batch; deposits are recoverable |
| Partial relay | Commit delivered, reveal not | Unrevealed commit is slashed (50%) — same as same-chain behavior |

### 8.2 The Independence Property

Each chain's `CommitRevealAuction` operates independently. Cross-chain orders are enhancements, not dependencies. If all cross-chain infrastructure fails simultaneously, every chain continues to operate its batch auctions with local orders only. There is no single point of failure.

### 8.3 Liquidity State During Outage

During a cross-chain outage, `LIQUIDITY_SYNC` messages stop flowing. Each chain's view of remote liquidity becomes stale. The system handles this by treating stale liquidity data conservatively — widening slippage estimates and reducing available cross-chain trade sizes until synchronization resumes.

---

## 9. Zero Bridge Fees — Always

### 9.1 The Policy

VibeSwap charges 0% protocol fees on all cross-chain transfers. This is a design principle, not a promotional offer.

### 9.2 Rationale

Bridge fees create perverse incentives:

1. **Liquidity fragmentation**: If cross-chain trading costs more than same-chain, liquidity pools fragment by chain. This reduces depth and increases slippage for everyone.

2. **Fairness violation**: Charging different fees based on the user's chain of origin violates P-000 (Fairness Above All). A trader on Arbitrum should not pay more than a trader on Ethereum for the same execution.

3. **Extraction**: Bridge fees are pure rent — the protocol extracts value from users who happen to be on a different chain, without providing additional value beyond the cross-chain relay (which is already paid for via LayerZero gas).

### 9.3 Cost Coverage

Users pay only the underlying LayerZero gas fees required to relay messages between chains. These fees go to LayerZero validators, not to VibeSwap. The protocol adds no additional surcharge.

---

## 10. Comparison with Existing Cross-Chain DEXs

### 10.1 THORChain

THORChain uses a continuous liquidity pool model with Tendermint-based consensus. Cross-chain swaps are routed through RUNE as an intermediary asset.

| Dimension | THORChain | VibeSwap |
|-----------|-----------|----------|
| Settlement model | Continuous (CLOB-like) | Batch auction (10s batches) |
| MEV resistance | Partial (slip-based) | Full (commit-reveal + random ordering) |
| Bridge dependency | Native bridge (bifrost) | LayerZero V2 (modular) |
| Intermediary asset | RUNE (required) | None (direct pair settlement) |
| Cross-chain fees | Outbound fee + slip | 0% protocol fee |
| Fairness guarantee | None (speed matters) | Uniform clearing price |

### 10.2 deBridge

deBridge uses a validation network to relay cross-chain messages and execute orders on the destination chain.

| Dimension | deBridge | VibeSwap |
|-----------|----------|----------|
| Settlement model | Intent-based with solvers | Batch auction |
| MEV resistance | Solver competition | Commit-reveal + shuffle |
| Bridge dependency | deBridge validators | LayerZero V2 validators |
| Order flow | Solvers compete for fills | Uniform clearing price |
| Cross-chain fees | Variable (market-driven) | 0% protocol fee |
| Fairness guarantee | Best-execution (solver dependent) | Uniform price (mechanism guaranteed) |

### 10.3 Across Protocol

Across uses a relayer network with optimistic verification for fast cross-chain transfers.

| Dimension | Across | VibeSwap |
|-----------|--------|----------|
| Settlement model | Relayer fills, optimistic verification | Batch auction, deterministic settlement |
| MEV resistance | None (relayers can front-run) | Full (commit-reveal) |
| Speed | Fast (~seconds) | Batch-aligned (10s cycles) |
| Cross-chain fees | Relayer spread + LP fee | 0% protocol fee |
| Capital efficiency | Relayers must front capital | No intermediary capital required |
| Fairness guarantee | Market-driven pricing | Uniform clearing price |

### 10.4 Summary

| Property | THORChain | deBridge | Across | **VibeSwap** |
|----------|-----------|----------|--------|-------------|
| Uniform pricing | No | No | No | **Yes** |
| MEV resistance | Partial | Partial | No | **Full** |
| Zero protocol fees | No | No | No | **Yes** |
| Batch settlement | No | No | No | **Yes** |
| Random ordering | No | No | No | **Yes** |
| Replay prevention | Chain-specific | Nonce-based | Hash-based | **Dual-chain commit ID** |
| Graceful degradation | Partial | Partial | Yes | **Yes** |

---

## 11. Conclusion

VibeSwap's cross-chain settlement architecture achieves a property that no existing cross-chain DEX provides: **identical fairness guarantees for cross-chain and same-chain orders**. A trader on Arbitrum receives the same uniform clearing price, the same random execution ordering, the same collateral requirements, and the same slashing penalties as a trader on Ethereum.

This is possible because the commit-reveal batch auction model naturally accommodates cross-chain latency. The 8-second commit window and 2-second reveal window provide sufficient time for LayerZero message delivery, while the batch structure ensures that all orders — regardless of origin — are settled together.

The architecture is secured by dual-chain commit IDs (preventing replay), per-source-chain rate limiting (preventing flooding), CEI-pattern deposit tracking (preventing fund misuse), and graceful degradation (ensuring same-chain continuity during bridge outages).

Cross-chain trading is not a second-class experience. It is the same experience, on every chain, for every user. And it costs 0% in protocol fees — always.

**P-000: Fairness Above All.** Fairness does not stop at chain boundaries.

---

## References

1. LayerZero Labs. "LayerZero V2: Omnichain Interoperability Protocol." LayerZero Documentation, 2024.
2. THORChain. "THORChain Technical Documentation." thorchain.org, 2023.
3. deBridge. "deBridge Protocol Specification." debridge.finance, 2024.
4. Across Protocol. "Across Protocol Documentation." across.to, 2024.
5. VibeSwap. "CrossChainRouter.sol." VibeSwap Protocol, 2026.
6. VibeSwap. "CommitRevealAuction.sol." VibeSwap Protocol, 2026.
