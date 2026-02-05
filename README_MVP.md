# VibeSwap MVP - Testing Guide

## Overview

VibeSwap is an omnichain DEX using LayerZero V2 with a commit-reveal auction system for MEV-resistant trading.

## Why Batch Auctions?

**The problem with continuous trading:** Front-running, sandwich attacks, information asymmetry. Manipulated prices aren't true prices—they're distorted by exploiter advantage. Manipulation is noise.

**The batch auction solution:** Orders are collected, hidden (commit-reveal), then settled simultaneously at a uniform clearing price. No one can see your order and trade ahead. Everyone gets the same price.

**The result:** MEV-resistant batch auctions don't just produce *fairer* prices—they produce more *accurate* prices. The clearing price reflects genuine supply and demand, not who has the fastest bot. Remove the noise, get closer to signal.

**0% noise. 100% signal.**

## AMM + Batch Auction: How They Work Together

VibeSwap isn't purely order-matching. The batch auction sits on top of an AMM (x*y=k).

**How orders execute:**
1. Orders in a batch first try to match with each other (coincidence of wants)
2. Remaining orders trade against AMM liquidity
3. Everything settles at the uniform clearing price

**Why this matters:**
- **No counterparty? No problem.** The AMM provides passive liquidity as a backstop.
- **Counterparty exists? Even better.** Direct matching means less slippage than AMM alone.
- **Fair price either way.** Batch auction ensures uniform clearing price regardless of execution path.

This is similar to CowSwap's model: try to match users first (better prices), fall back to AMM liquidity (guaranteed execution).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VibeSwapCore                             │
│  (Main entry point - orchestrates all subsystems)                │
└─────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│CommitReveal │ │   VibeAMM   │ │ DAOTreasury │ │CrossChain   │
│  Auction    │ │   (x*y=k)   │ │ (Backstop)  │ │  Router     │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

## Swap Flow (10-second batches)

```
COMMIT PHASE (8s)        REVEAL PHASE (2s)        SETTLEMENT
─────────────────────────────────────────────────────────────────
1. User commits hash     2. User reveals order    3. Orders shuffled
   + deposits ETH           + optional priority   4. Execute at
   + deposits tokens           bid                   clearing price
                                                  5. Funds distributed
```

## Quick Start

### Prerequisites

1. Install Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. Clone repo and install deps: `forge install`

### Deployment

```bash
# Set environment variables
export PRIVATE_KEY=your_private_key
export RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY

# Deploy all contracts
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast

# Deploy test tokens
forge script script/Deploy.s.sol:DeployTestTokens --rpc-url $RPC_URL --broadcast

# Setup MVP (create pools, add liquidity)
export VIBESWAP_CORE=0x...  # from deployment output
export VIBESWAP_AMM=0x...
export WETH=0x...
export USDC=0x...
forge script script/SetupMVP.s.sol --rpc-url $RPC_URL --broadcast
```

### Testing a Swap

#### Step 1: Commit (during COMMIT phase - first 8 seconds of batch)

```solidity
// Approve tokens first
IERC20(weth).approve(vibeSwapCore, amountIn);

// Commit swap with 0.01 ETH deposit
bytes32 secret = keccak256("my_secret");
bytes32 commitId = vibeSwapCore.commitSwap{value: 0.01 ether}(
    weth,           // tokenIn
    usdc,           // tokenOut
    1 ether,        // amountIn
    1800 * 1e6,     // minAmountOut (1800 USDC)
    secret          // your secret
);
```

#### Step 2: Reveal (during REVEAL phase - seconds 8-10 of batch)

```solidity
// Reveal your order
vibeSwapCore.revealSwap(commitId, 0); // 0 = no priority bid

// Or with priority bid for execution priority
vibeSwapCore.revealSwap{value: 0.001 ether}(commitId, 0.001 ether);
```

#### Step 3: Settle (after REVEAL phase ends)

```solidity
// Anyone can call this
uint64 batchId = auction.getCurrentBatchId();
vibeSwapCore.settleBatch(batchId);
```

#### Step 4: Withdraw Deposit

```solidity
// Get your 0.01 ETH deposit back
auction.withdrawDeposit(commitId);
```

## API Reference

### VibeSwapCore

| Function | Description |
|----------|-------------|
| `commitSwap(tokenIn, tokenOut, amountIn, minAmountOut, secret)` | Commit a swap order |
| `revealSwap(commitId, priorityBid)` | Reveal a committed order |
| `settleBatch(batchId)` | Settle a completed batch |
| `getCurrentBatch()` | Get current batch info |
| `getPoolInfo(tokenA, tokenB)` | Get pool reserves/price |
| `getQuote(tokenIn, tokenOut, amountIn)` | Get swap quote |

### VibeAMM

| Function | Description |
|----------|-------------|
| `addLiquidity(poolId, amount0, amount1, min0, min1)` | Add liquidity |
| `removeLiquidity(poolId, liquidity, min0, min1)` | Remove liquidity |
| `swap(poolId, tokenIn, amountIn, minOut, recipient)` | Direct swap |
| `getPool(poolId)` | Get pool info |
| `getSpotPrice(poolId)` | Get current price |

### CommitRevealAuction

| Function | Description |
|----------|-------------|
| `getCurrentBatchId()` | Current batch number |
| `getCurrentPhase()` | COMMIT/REVEAL/SETTLING/SETTLED |
| `getTimeUntilPhaseChange()` | Seconds until next phase |
| `getBatch(batchId)` | Get batch info |

## Security Features

### Enabled by Default

- **Flash Loan Protection**: Same-block interactions blocked
- **TWAP Validation**: Price checked against 10-min TWAP
- **Rate Limiting**: 1M tokens/hour per user
- **EOA Requirement**: Only EOAs can commit (contracts blocked)
- **Circuit Breakers**: Auto-pause on anomalies

### Circuit Breakers

| Breaker | Trigger | Cooldown |
|---------|---------|----------|
| Volume | >$10M/hour | 1 hour |
| Price | >50% deviation | 30 min |
| Withdrawal | >25% TVL/hour | 2 hours |

### Emergency Functions

```solidity
// Guardian can pause
vibeSwapCore.emergencyPause();

// Owner can unpause
vibeSwapCore.unpause();

// Reset tripped breaker (after cooldown)
vibeAMM.resetBreaker(VOLUME_BREAKER);
```

## Testnet Deployments

| Chain | Core | AMM | Auction |
|-------|------|-----|---------|
| Sepolia | TBD | TBD | TBD |
| Arbitrum Sepolia | TBD | TBD | TBD |

## Common Issues

### "Invalid phase" Error
- You're trying to commit during REVEAL or vice versa
- Check `getCurrentPhase()` and wait for correct phase

### "Rate limit exceeded"
- You've swapped too much this hour
- Wait for next hour or contact admin to increase limit

### "Price deviation too high"
- Large swap would move price >5% from TWAP
- Split into smaller trades or wait for price stabilization

### "Flash loan detected"
- You're calling from a contract
- Use an EOA or get contract whitelisted

## Running Tests

```bash
# Run all tests
forge test -vvv

# Run specific test file
forge test --match-path test/VibeAMM.t.sol -vvv

# Run with gas report
forge test --gas-report
```

## Contact

For issues or questions, please open a GitHub issue.
