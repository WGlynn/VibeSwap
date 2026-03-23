# VibeSwap

**An omnichain decentralized exchange that eliminates MEV through commit-reveal batch auctions with uniform clearing prices.** Built on LayerZero V2, VibeSwap replaces the adversarial transaction ordering of traditional DEXs with a cooperative mechanism where price emerges from genuine aggregate supply and demand — not from who bribes validators first.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-orange)](https://book.getfoundry.sh/)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-v5.0.1-purple)](https://www.openzeppelin.com/contracts)
[![LayerZero](https://img.shields.io/badge/LayerZero-V2%20OApp-green)](https://layerzero.network/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Architecture

VibeSwap is composed of **30 contract modules** spanning MEV-resistant trading, cross-chain messaging, game-theoretic rewards, governance, and DeFi infrastructure:

```
                            ┌──────────────────────┐
                            │     VibeSwapCore      │
                            │  (Batch Orchestrator)  │
                            └──────────┬───────────┘
               ┌───────────────┬───────┴───────┬───────────────┐
               ▼               ▼               ▼               ▼
      ┌────────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────┐
      │ CommitReveal   │ │ VibeAMM  │ │ DAOTreasury  │ │ CrossChain   │
      │ Auction        │ │ (x·y=k)  │ │ (Backstop)   │ │ Router (LZ)  │
      └────────────────┘ └──────────┘ └──────────────┘ └──────────────┘
               │                              │               │
               ▼                              ▼               ▼
      ┌────────────────┐              ┌──────────────┐ ┌──────────────┐
      │ Shapley        │              │ Treasury     │ │ Settlement   │
      │ Distributor    │              │ Stabilizer   │ │ Verifiers    │
      └────────────────┘              └──────────────┘ └──────────────┘
```

### Core Systems

| System | What It Does | Key Contracts |
|--------|-------------|---------------|
| **Batch Auction** | Commit-reveal + priority auction eliminates MEV | `CommitRevealAuction`, `VibeSwapCore` |
| **AMM** | Constant product market maker with batch execution | `VibeAMM`, `VibeLP` |
| **Fair Distribution** | Shapley value rewards based on marginal contribution | `ShapleyDistributor`, `IncentiveController` |
| **Cross-Chain** | Unified liquidity across chains via LayerZero V2 OApp | `CrossChainRouter` |
| **Governance** | DAO treasury with counter-cyclical stabilization | `DAOTreasury`, `TreasuryStabilizer` |
| **Security** | Circuit breakers, rate limiting, flash loan protection | `CircuitBreaker`, `RateLimiter` |
| **Settlement** | On-chain verification of Shapley, trust scores, votes | `ShapleyVerifier`, `TrustScoreVerifier`, `VoteVerifier` |
| **Oracle** | TWAP validation + Python Kalman filter for price discovery | `VolatilityOracle`, `TWAPOracle` |
| **Incentives** | IL protection, loyalty rewards, slippage guarantees | `ILProtectionVault`, `LoyaltyRewardsManager` |
| **Identity** | Account abstraction + WebAuthn device wallets | `SmartAccount`, `SessionKeyManager` |

---

## How It Works

**The MEV Problem:** On traditional DEXs, your pending swap is visible in the mempool. Bots frontrun you, backrun you, and extract value from every trade.

**VibeSwap's Solution — 10-second batch auctions:**

```
  COMMIT (8s)              REVEAL (2s)              SETTLEMENT
  ─────────────            ─────────────            ──────────────────────
  Submit hash of order     Reveal actual order      1. Priority auction winners
  (nobody sees what        + optional priority      2. Fisher-Yates shuffle
   you're trading)         bid for early execution  3. All at uniform clearing price
```

1. **Commit Phase (8s):** Users submit `hash(order || secret)` with a deposit. Orders are invisible.
2. **Reveal Phase (2s):** Users reveal orders. Optional priority bids for guaranteed early execution. Batch seals — no new orders.
3. **Settlement:** Priority winners execute first (bids go to LPs). Remaining orders are shuffled using Fisher-Yates with XORed user secrets as the seed. Everyone gets the same uniform clearing price.

**Why sandwich attacks die:** A sandwich needs a "before" and "after" price. In a batch auction there's only ONE price. The attack vector doesn't exist.

---

## Technical Highlights

| Metric | Value |
|--------|-------|
| Solidity contracts | **360+** across 30 modules |
| Test files | **370+** (unit, fuzz, invariant, integration, security) |
| Proxy architecture | UUPS upgradeable (OpenZeppelin v5.0.1) |
| Cross-chain | LayerZero V2 OApp — unified liquidity across Ethereum, Arbitrum, Optimism, Base |
| Fair ordering | Deterministic Fisher-Yates shuffle with XORed secrets |
| Reward distribution | Shapley values from cooperative game theory |
| Research papers | **49** published mechanism design documents |
| Frontend | React 18 + Vite 5 + ethers.js v6 — [live demo](https://frontend-jade-five-87.vercel.app) |
| Oracle | Python Kalman filter for true price discovery |

---

## Security Architecture

Defense-in-depth with multiple independent protection layers:

| Layer | Mechanism | Implementation |
|-------|-----------|----------------|
| **MEV Protection** | Commit-reveal hides orders until batch seals | `CommitRevealAuction.sol` |
| **Fair Ordering** | Fisher-Yates shuffle — no single participant controls the seed | `DeterministicShuffle.sol` |
| **Flash Loan Guard** | Same-block interaction detection prevents atomic exploits | `VibeSwapCore.sol` |
| **Circuit Breakers** | Volume, price, and withdrawal anomaly detection | `CircuitBreaker.sol` |
| **TWAP Validation** | Max 5% deviation from time-weighted average price | `VibeAMM.sol`, `TWAPOracle.sol` |
| **Rate Limiting** | 100K tokens/hour/user, per-chain message limits | `RateLimiter.sol`, `CrossChainRouter.sol` |
| **Slashing** | 50% deposit forfeited for invalid reveals | `CommitRevealAuction.sol` |
| **Reentrancy Guards** | `nonReentrant` on every state-changing external function | All contracts |
| **Upgradeability** | UUPS with timelock — no unilateral upgrades | Proxy architecture |
| **Settlement Verification** | On-chain Shapley, trust score, and vote verification | `ShapleyVerifier.sol` |

---

## Tech Stack

```
Contracts:    Solidity 0.8.20  ·  Foundry  ·  OpenZeppelin v5.0.1  ·  LayerZero V2
Frontend:     React 18  ·  Vite 5  ·  Tailwind CSS  ·  ethers.js v6  ·  WebAuthn
Oracle:       Python 3.9+  ·  Kalman filter  ·  Bayesian estimation
Testing:      Foundry (unit + fuzz + invariant)  ·  Slither  ·  380 test files
Deployment:   Anvil (local)  ·  Sepolia/Mainnet  ·  Vercel (frontend)
```

---

## Quick Start

```bash
# Clone
git clone https://github.com/wglynn/vibeswap.git
cd vibeswap

# Install Foundry dependencies
forge install

# Build contracts (first build uses via-ir, may take a few minutes)
forge build

# For faster iteration during development:
FOUNDRY_PROFILE=fast forge build

# Run tests
forge test -vvv

# Start frontend
cd frontend && npm install && npm run dev
```

### Deployment

```bash
# Local (Anvil)
anvil
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Testnet (Sepolia)
cp .env.example .env  # Configure RPC URLs and keys
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --verify

# Configure cross-chain peers
forge script script/ConfigurePeers.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
```

---

## Project Structure

```
vibeswap/
├── contracts/                 # 360+ Solidity files
│   ├── core/                  #   CommitRevealAuction, VibeSwapCore, CircuitBreaker
│   ├── amm/                   #   VibeAMM (x·y=k), VibeLP
│   ├── governance/            #   DAOTreasury, TreasuryStabilizer
│   ├── incentives/            #   ShapleyDistributor, ILProtection, LoyaltyRewards
│   ├── messaging/             #   CrossChainRouter (LayerZero V2)
│   ├── settlement/            #   ShapleyVerifier, TrustScoreVerifier, VoteVerifier
│   ├── identity/              #   SmartAccount, SessionKeyManager
│   ├── oracle/                #   VolatilityOracle
│   ├── security/              #   CircuitBreaker, RateLimiter
│   ├── libraries/             #   DeterministicShuffle, BatchMath, TWAPOracle
│   └── ... (30 modules total)
├── test/                      # 370+ test files (unit, fuzz, invariant, integration)
├── script/                    # Deployment scripts
├── frontend/                  # React 18 + Vite 5 application
│   ├── src/components/        #   330+ React components
│   ├── src/hooks/             #   70 custom hooks
│   └── src/utils/
├── oracle/                    # Python Kalman filter price oracle
├── DOCUMENTATION/             # 49 research papers and whitepapers
└── docs/                      # Additional documentation and proposals
```

---

## Research & Publications

VibeSwap is backed by original mechanism design research:

| Paper | Topic |
|-------|-------|
| [VibeSwap Whitepaper](DOCUMENTATION/VIBESWAP_WHITEPAPER.md) | Complete protocol specification |
| [Mechanism Design](DOCUMENTATION/VIBESWAP_COMPLETE_MECHANISM_DESIGN.md) | Batch auctions, Fibonacci scaling, Shapley distribution |
| [Incentives Whitepaper](DOCUMENTATION/INCENTIVES_WHITEPAPER.md) | Game theory, IL protection, loyalty rewards |
| [True Price Oracle](DOCUMENTATION/TRUE_PRICE_ORACLE.md) | Kalman filter, Bayesian estimation, regime detection |
| [Security Mechanism Design](DOCUMENTATION/SECURITY_MECHANISM_DESIGN.md) | Anti-fragile security, cryptoeconomic defense |
| [Formal Fairness Proofs](DOCUMENTATION/FORMAL_FAIRNESS_PROOFS.md) | Mathematical proofs of mechanism fairness properties |

See [`DOCUMENTATION/`](DOCUMENTATION/) for all 49 papers.

---

## Game Theory: Why Cooperation Is Rational

VibeSwap transforms adversarial DeFi mechanics into cooperative ones using Shapley values from cooperative game theory:

- **Shapley distribution** rewards marginal contribution, not just liquidity size
- **Priority auctions** let arbitrageurs pay for execution priority — bids go to LPs, not validators
- **Insurance pools** mutualize risk (IL protection, slippage guarantees, treasury stabilization)
- **No extraction** — 100% of trading fees go to LPs. Zero to protocol.

Traditional DeFi is a Prisoner's Dilemma (defection is rational). VibeSwap is an Assurance Game (cooperation is rational when others cooperate). The mechanism makes virtue the optimal strategy.

> *"Rewards cannot exceed revenue. Compounding is limited to realized events. Cooperation is rational, not moral."*

---

## Philosophy: The First Fair Protocol

VibeSwap was built from scratch by one engineer with no funding, no team, and no permission. The patterns developed for managing AI limitations during this build may become foundational for AI-augmented development tomorrow.

**Core principles:**
- **Fairness Above All** — if the system is unfair, amend the code
- **No Extraction Ever** — Shapley math detects extraction; the system self-corrects
- **Unstealable Ideas** — attribution is structural, not legal

> *"Tony Stark was able to build this in a cave. With a box of scraps."*

---

## License

MIT
