# VibeSwap Phase 2: Building Out Roadmap

**Status**: Planning
**Started**: February 2026
**Phase 1**: Core protocol (CommitRevealAuction, VibeAMM, CrossChainRouter, governance, incentives, compliance, identity, quantum)
**Phase 2**: Financial primitives, mechanism extensions, protocol framework, DeFi/DeFAI features, aesthetic overhaul

---

## Protocol / Framework

| # | Addition | Description | Priority |
|---|---------|-------------|----------|
| 1 | **Intent-Based Order Routing** | Users express "swap X for best Y" — protocol routes across AMM, auction, or cross-chain paths automatically | |
| 2 | **Modular Pool Factory** | Deploy new pool types (stable, concentrated, weighted) from a single factory with pluggable curves | |
| 3 | **Hook System (Uniswap V4 style)** | Pre/post swap hooks on pools — third parties attach logic (fees, rewards, compliance) without modifying core | |
| 4 | **Keeper Network / Relayer Layer** | Decentralize the settlement trigger — anyone can call `settle()` and earn tips, removes single-operator dependency | |
| 5 | **Gasless Meta-Transactions (EIP-2771)** | Users sign, relayers pay gas — critical for the "abstract crypto away" UX goal | |
| 6 | **Account Abstraction (ERC-4337)** | Smart contract wallets with session keys, batched txns, social recovery — pairs with WebAuthn device wallet | |
| 7 | **Plugin Registry** | On-chain registry of approved extensions (new curve types, oracle adapters, compliance modules) — governed by DAO | |
| 8 | **Timelocked Governance Execution** | All governance proposals execute after a mandatory delay — gives users exit window | |
| 9 | **Protocol-Owned Liquidity (POL)** | Treasury deploys its own LP positions, earning fees perpetually instead of renting liquidity via emissions | |
| 10 | **Versioned Proxy Architecture** | Multiple implementation versions live simultaneously — users opt-in to upgrades rather than forced migration | |

---

## Mechanism Design

| # | Addition | Description | Priority |
|---|---------|-------------|----------|
| 1 | **Dutch Auction Liquidations** | Failing positions auctioned via descending price — more efficient than fixed-discount liquidations | |
| 2 | **Quadratic Voting for Governance** | Cost of votes = n² — prevents whale dominance while maintaining stake-weighted skin-in-the-game | |
| 3 | **Retroactive Public Goods Funding** | Treasury funds projects AFTER they demonstrate value — solves "fund and pray" problem | |
| 4 | **Conviction Voting** | Preference accumulates over time — rewards long-term holders, discourages flash-loan governance attacks | |
| 5 | **Bonding Curves for Token Launches** | New tokens bootstrap liquidity via mathematical price curves — no initial LP required | |
| 6 | **Commit-Reveal Governance** | Apply existing commit-reveal pattern to votes — eliminates bandwagoning and vote-buying during live polls | |
| 7 | **Harberger Tax on Premium Features** | Premium pool slots/featured listings: self-assess value, pay continuous tax — anyone can buy at your price | |
| 8 | **Prediction Market Integration** | Users bet on price direction within auction windows — reveals information, improves price discovery | |
| 9 | **Cooperative MEV Redistribution** | When MEV is captured (priority bids), redistribute pro-rata to LPs and traders — "Cooperative Capitalism" in action | |
| 10 | **Adaptive Batch Timing** | Dynamically adjust 8s/2s commit/reveal window based on congestion and volatility | |

---

## Aesthetic / UX

| # | Addition | Description | Priority |
|---|---------|-------------|----------|
| 1 | **Achievement System** | "First Trade", "100 Swaps", "LP Veteran" — OSRS-style skill milestones tied to SoulboundIdentity | |
| 2 | **Live Order Book Visualization** | Animated depth chart showing bids/offers filling in real-time during commit phase | |
| 3 | **Player Inventory Panel** | Token holdings displayed as items in a grid inventory — drag to trade, hover for stats | |
| 4 | **Pixel Art Token Icons** | 32x32 pixel sprites for every token — OSRS item aesthetic | |
| 5 | **Grand Exchange "Offers" UI** | Active orders displayed as GE-style offer slots with progress bars for partial fills | |
| 6 | **World Chat / Trade Chat** | Forum.sol frontend — channels for general chat, trade offers, LFG | |
| 7 | **Skill Tree for Protocol Features** | Unlock advanced features (limit orders, cross-chain, leverage) as you gain XP — progressive disclosure | |
| 8 | **Sound Effects** | Coin clinks on trades, level-up jingles on achievements, ambient tavern music — toggle-able | |
| 9 | **Seasonal Events** | Time-limited cosmetics, bonus rewards, special pools — drives recurring engagement | |
| 10 | **Minimap / Protocol Dashboard** | Small always-visible widget showing TVL, your positions, active auctions — like the OSRS minimap corner | |

---

## DeFi / DeFAI Features

| # | Addition | Description | Priority |
|---|---------|-------------|----------|
| 1 | **Concentrated Liquidity** | LP in specific price ranges — higher capital efficiency, pairs with volatility oracle for auto-rebalancing | |
| 2 | **AI-Powered Auto-Rebalance** | DeFAI agent monitors positions and rebalances LP ranges based on Kalman filter oracle signals | |
| 3 | **Leveraged LP Positions** | Borrow against LP tokens to increase position — with circuit breaker protection | |
| 4 | **Yield Aggregator Vault** | Auto-compound LP fees + loyalty rewards + Shapley distributions into optimal strategies | |
| 5 | **Cross-Chain Yield Routing** | DeFAI agent scans yield across chains via LayerZero, auto-deploys capital where APY is highest | |
| 6 | **Limit Orders via Auction** | Users set price targets — orders sit until a batch clears at their price or better | |
| 7 | **DCA (Dollar Cost Average) Bot** | Scheduled recurring swaps — executes within auction batches for MEV protection | |
| 8 | **AI Risk Scoring** | DeFAI module scores pool risk (IL exposure, smart contract risk, liquidity depth) before users enter | |
| 9 | **Flash Loan Module** | Single-block uncollateralized loans — with existing EOA-only restriction as opt-in per pool | |
| 10 | **Perpetual Futures** | Synthetic perps settled through batch auctions — MEV-protected derivatives | |

---

## Financial Primitives / Legos (BUILD FIRST)

| # | Primitive | What It Enables | Status |
|---|----------|----------------|--------|
| 1 | **Wrapped Batch Auction Receipts (wBAR)** | ERC-20 tokens representing pending auction positions — tradeable before settlement, creates a pre-market | **Complete** |
| 2 | **LP Position NFTs (ERC-721)** | Each LP position is a unique NFT with metadata (range, fees earned, age) — composable, tradeable, collateral-eligible | **Complete** |
| 3 | **Streaming Payments + FundingPools** | Continuous token flows (salary, vesting) + conviction-weighted multi-recipient distribution with Shapley fairness | **Complete** |
| 4 | **Options Primitives** | On-chain calls/puts priced by volatility oracle — built on top of AMM liquidity | **Complete** |
| 5 | **Yield-Bearing Stablecoins** | Deposit USDC → get vsUSDC that auto-earns from protocol fees — composable yield layer | Planned |
| 6 | **Bond Market** | Fixed-term, fixed-rate deposits — treasury issues bonds to smooth liquidity, users get predictable yield | Planned |
| 7 | **Credit Delegation** | Depositors delegate borrowing power to trusted addresses — undercollateralized lending with reputation oracle | Planned |
| 8 | **Synthetic Assets** | Mint synthetic exposure to any asset using oracle infrastructure — trade TSLA, gold, BTC on any chain | Planned |
| 9 | **Insurance Derivatives** | Tokenized coverage against IL, smart contract exploits, depeg events — extends VolatilityInsurancePool | Planned |
| 10 | **Revenue Share Tokens** | ERC-20 tokens that auto-receive % of protocol revenue — stakeable, tradeable, collateral-eligible | Planned |

---

## Architecture Notes

**The throughline**: Phase 1 established the anti-MEV auction, cooperative incentives, cross-chain messaging, and identity primitives. Phase 2 layers on top to create a **full financial operating system** — not just a DEX, but a platform where every financial primitive is composable, MEV-protected, and game-theoretically sound.

**Build order**: Financial Primitives first (they become the legos everything else composes on top of).

### Existing Contracts (Phase 1 - Complete)
```
Core:       CommitRevealAuction, VibeSwapCore, CircuitBreaker, PoolComplianceConfig
AMM:        VibeAMM, VibeLP
Governance: DAOTreasury, TreasuryStabilizer, AutomatedRegulator, DecentralizedTribunal, DisputeResolver
Incentives: ShapleyDistributor, ILProtectionVault, LoyaltyRewardsManager, IncentiveController,
            PriorityRegistry, SlippageGuaranteeFund, VolatilityInsurancePool
Messaging:  CrossChainRouter
Libraries:  DeterministicShuffle, BatchMath, TWAPOracle, VWAPOracle, SecurityLib, TruePriceLib,
            LiquidityProtection, FibonacciScaling, SHA256Verifier, ProofOfWorkLib, PairwiseFairness
Oracles:    VolatilityOracle, TruePriceOracle, StablecoinFlowRegistry, ReputationOracle
Identity:   SoulboundIdentity, WalletRecovery, AGIResistantRecovery, Forum
Compliance: ComplianceRegistry, ClawbackRegistry, ClawbackVault, FederatedConsensus
Quantum:    QuantumGuard, QuantumVault, LamportLib
Other:      CreatorTipJar
```
