# VibeSwap - Omnichain DEX

An omnichain decentralized exchange built on LayerZero V2 featuring Sidepit-inspired fair price discovery with a hybrid commit-reveal + auction system.

## Features

- **MEV Protection**: Commit-reveal mechanism hides order details until reveal phase
- **Fair Ordering**: Deterministic Fisher-Yates shuffle using XORed secrets as entropy
- **Priority Auction**: Users can bid for execution priority
- **Uniform Clearing Price**: Batch swaps execute at a single clearing price
- **Cross-Chain**: LayerZero V2 OApp for unified liquidity across chains
- **DAO Treasury**: Protocol fees and backstop liquidity for store-of-value assets

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VibeSwapCore                             │
│  (Orchestrates batch lifecycle, integrates all subsystems)       │
└─────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│CommitReveal │ │   VibeAMM   │ │ DAOTreasury │ │CrossChain   │
│  Auction    │ │   (x*y=k)   │ │ (Backstop)  │ │  Router     │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

## Batch Processing Flow (1-second batches)

```
COMMIT PHASE (800ms)     REVEAL PHASE (200ms)      SETTLEMENT
─────────────────────────────────────────────────────────────────
Users submit             Users reveal orders       1. Generate shuffle seed
commit hashes    ──►     + priority bids     ──►   2. Finalize auction
                                                   3. Order execution:
                                                      - Priority winners first
                                                      - Shuffled regular orders
                                                   4. Execute against AMM
                                                   5. Send proceeds to DAO
```

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Git

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/vibeswap.git
cd vibeswap

# Install dependencies
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.0.1 --no-commit
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.0.1 --no-commit

# Build
forge build

# Run tests
forge test -vvv
```

## Project Structure

```
contracts/
├── core/
│   ├── CommitRevealAuction.sol    # Batch commit-reveal + auction
│   ├── VibeSwapCore.sol           # Main entry point
│   └── interfaces/
│       ├── ICommitRevealAuction.sol
│       ├── IVibeAMM.sol
│       └── IDAOTreasury.sol
├── amm/
│   ├── VibeAMM.sol                # Constant product AMM
│   └── VibeLP.sol                 # LP token
├── governance/
│   └── DAOTreasury.sol            # Treasury + backstop
├── messaging/
│   └── CrossChainRouter.sol       # LayerZero V2 OApp
└── libraries/
    ├── DeterministicShuffle.sol   # Fisher-Yates shuffle
    └── BatchMath.sol              # Clearing price math

test/
├── CommitRevealAuction.t.sol
├── VibeAMM.t.sol
├── DAOTreasury.t.sol
├── CrossChainRouter.t.sol
└── integration/
    └── VibeSwap.t.sol

script/
├── Deploy.s.sol
└── ConfigurePeers.s.sol
```

## Contracts

### CommitRevealAuction

Implements the commit-reveal mechanism with priority auction:

- **Commit Phase (800ms)**: Users submit hashed order commitments with deposits
- **Reveal Phase (200ms)**: Users reveal orders and optionally submit priority bids
- **Settlement**: Orders are shuffled deterministically and executed

### VibeAMM

Constant product AMM (`x*y=k`) with batch execution:

- Uniform clearing price calculation
- Batch swap execution
- LP token management
- Protocol fee collection

### DAOTreasury

DAO treasury with backstop functionality:

- Receives protocol fees and auction proceeds
- Price smoothing for store-of-value assets
- Timelock-controlled withdrawals
- Backstop liquidity provision

### CrossChainRouter

LayerZero V2 OApp for cross-chain operations:

- Cross-chain order submission
- Liquidity state synchronization
- Batch result propagation
- Rate limiting per chain

## Deployment

### Local Testing

```bash
# Start local Anvil node
anvil

# Deploy to local node
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

### Testnet Deployment

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your values

# Deploy to Sepolia
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --verify

# Configure peers after deploying on multiple chains
forge script script/ConfigurePeers.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
```

## Testing

```bash
# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test file
forge test --match-path test/VibeAMM.t.sol

# Run specific test
forge test --match-test test_fullSwapFlow

# Gas report
forge test --gas-report

# Coverage
forge coverage
```

## Security Considerations

1. **MEV Protection**: Commit-reveal hides orders; uniform clearing price prevents sandwich attacks
2. **Fair Ordering**: Deterministic shuffle using XORed secrets as entropy
3. **Replay Prevention**: Unique commit hashes, processed message tracking
4. **Slashing**: Invalid reveals forfeit 50% of deposits
5. **Rate Limiting**: Per-chain message rate limits
6. **Upgradeability**: UUPS with timelock

## License

MIT
