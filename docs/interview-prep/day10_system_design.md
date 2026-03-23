# Day 10: System Design Interview Prep

> Structured outlines you can practice delivering verbally in 5 minutes each.
> For each: problem framing, architecture, key components, security, and your VibeSwap references.

---

## Design 1: "Design a DEX"

### Opening (30 seconds)

> "I'll design a decentralized exchange optimized for fairness and MEV resistance. I've built exactly this -- VibeSwap is a 360+ contract omnichain DEX. Let me walk through the key design decisions."

### Step 1: Clarifying Questions (30 seconds)

Ask the interviewer:
- What chain(s)? Single-chain or cross-chain?
- What trading model? AMM (passive liquidity) or order book (active market makers)?
- What's the priority: capital efficiency, simplicity, MEV resistance, or throughput?
- Who are the users? Retail, institutional, or both?

### Step 2: Core AMM Design (1 minute)

**Constant Product Market Maker (x * y = k):**
- Two-token pools. Price determined by reserve ratio: `price = reserve_y / reserve_x`
- Swap: `amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)` minus fee
- LP tokens represent proportional share of reserves

**Key Parameters:**
- Fee: 0.05% (VibeSwap) vs 0.3% (Uniswap V2) vs variable (V3). Lower fee because batch auctions reduce IL.
- Minimum liquidity locked on first deposit to prevent first-depositor manipulation: `MINIMUM_LIQUIDITY = 10000` in `VibeAMM.sol`
- Max trade size as % of reserves: 10% cap prevents excessive single-trade slippage

**VibeSwap Reference:**
- `VibeAMM.sol`: Constant product AMM with batch execution, TWAP oracle, 5% deviation checks
- `VibeLP.sol`: ERC-20 LP tokens, `VibeLPNFT.sol` for position NFTs
- `VibePoolFactory.sol`: Pool creation factory
- `VibeRouter.sol`: Multi-hop routing

### Step 3: Order Flow and MEV Protection (1 minute)

**The Problem:** On a traditional DEX, pending swaps are visible in the mempool. Bots extract value via sandwich attacks, frontrunning, and backrunning.

**Batch Auction Solution:**
1. **Commit Phase (8 seconds):** Users submit `hash(order || secret)` with collateral. Orders are invisible.
2. **Reveal Phase (2 seconds):** Users reveal actual orders. Invalid reveals get 50% deposit slashed.
3. **Settlement:** All orders execute at a uniform clearing price. Execution order determined by Fisher-Yates shuffle seeded with XORed secrets + future block entropy.

**Why This Kills MEV:**
- No order visibility during commit (can't frontrun what you can't see)
- Uniform clearing price means no "before/after" price differential (sandwich has no profit)
- Random execution order (can't guarantee position)
- Priority auction: users who WANT priority bid for it, and bids go to LPs (MEV redistributed cooperatively)

**VibeSwap Reference:**
- `CommitRevealAuction.sol`: Full implementation with pool-level compliance configs
- `DeterministicShuffle.sol`: Fisher-Yates shuffle with `generateSeedSecure()` using future block entropy

### Step 4: Cross-Chain Architecture (1 minute)

**Approach: Message-passing via LayerZero V2 (OApp pattern)**
- Each chain has a `CrossChainRouter` that sends/receives messages through LayerZero endpoints
- Message types: `ORDER_COMMIT`, `ORDER_REVEAL`, `BATCH_RESULT`, `LIQUIDITY_SYNC`, `ASSET_TRANSFER`
- Users on Chain A can trade against liquidity on Chain B without bridging first

**Security Layers:**
- Peer validation: only accept messages from known routers on known chains
- Rate limiting per chain: prevents message flood from a compromised chain
- Nonce tracking: prevents replay attacks
- Destination chain in commit struct: prevents cross-chain replay

**Liquidity Model:**
- Option A: Unified liquidity (virtual reserves synced across chains) -- higher capital efficiency, more complex
- Option B: Separate pools per chain with arbitrage keeping prices aligned -- simpler, fragmented
- VibeSwap: Unified via `LiquiditySync` messages that broadcast reserve states

**VibeSwap Reference:**
- `CrossChainRouter.sol` (`contracts/messaging/CrossChainRouter.sol`): LayerZero V2 integration with message rate limiting
- RPC endpoints configured for Mainnet, Sepolia, Arbitrum, Optimism, Base in `foundry.toml`
- `ConfigurePeers.s.sol` deployment script for cross-chain peer setup

### Step 5: Governance and Treasury (30 seconds)

- DAO treasury receives auction proceeds, penalty fees (slashing), and optionally a configurable protocol fee share
- Counter-cyclical stabilization: treasury deploys backstop liquidity during bear markets
- Timelock on all withdrawals: min 1 hour, default 2 days
- Upgrade path: owner -> timelock -> DAO -> renounced (where safe)

**VibeSwap Reference:**
- `DAOTreasury.sol`: Backstop configs, timelocked withdrawals, emergency guardian
- `TreasuryStabilizer.sol`: Monitors market conditions, deploys treasury during downturns
- `VibeGovernanceHub.sol`, `VibeTimelock.sol`: Governance infrastructure

### Step 6: Security (30 seconds)

Defense in depth -- never rely on one mechanism:
1. Reentrancy guards on every state-changing function
2. Circuit breakers (volume, price, withdrawal, loss thresholds)
3. Rate limiting (100K tokens/hour/user)
4. TWAP validation (5% max deviation from time-weighted average)
5. Flash loan detection (tx.origin heuristic)
6. Slashing for misbehavior (50% for invalid reveals)
7. Donation attack detection (balance consistency checks)
8. Fuzz testing (256 runs) and invariant testing (256 runs, depth 500)

**VibeSwap Reference:**
- `CircuitBreaker.sol`: 5 breaker types, per-function pause, guardian system
- `SecurityLib.sol`: Flash loan detection, price deviation checks, balance consistency, slippage protection, rate limiting
- `TransactionFirewall.sol`, `WalletGuardian.sol` in `contracts/security/`

---

## Design 2: "Design a Lending Protocol"

### Opening (30 seconds)

> "I'll design an overcollateralized lending protocol with liquidation protection and robust oracle integration. While VibeSwap is primarily a DEX, I've built several components that directly apply: oracle systems, insurance vaults, circuit breakers, and treasury stabilization."

### Step 1: Core Lending Mechanics (1 minute)

**Supply Side:**
- Lenders deposit assets (ETH, USDC, etc.) into pools
- Receive interest-bearing tokens (like Aave's aTokens or Compound's cTokens)
- Interest accrues per block based on utilization rate

**Borrow Side:**
- Borrowers deposit collateral, borrow against it
- Collateral factor: e.g., ETH has 80% LTV -> deposit $1000 ETH, borrow up to $800
- Must maintain health factor > 1.0 (collateral value / debt value > threshold)

**Key Design Choices:**
- Pool-based (Aave/Compound style) vs isolated pairs (Silo/Euler style)
- Pool-based: more capital efficient, but risk is shared. Isolated: safer per-pair, but fragmented liquidity.

### Step 2: Interest Rate Model (1 minute)

**Utilization-Based Curve:**
```
utilization = totalBorrows / totalDeposits

if utilization < optimalUtilization (e.g., 80%):
    rate = baseRate + (utilization / optimal) * slope1

if utilization >= optimalUtilization:
    rate = baseRate + slope1 + ((utilization - optimal) / (1 - optimal)) * slope2
```

- Below optimal: gentle slope incentivizes borrowing
- Above optimal (kink): steep slope incentivizes repayment and more deposits
- This is the standard "kinked" interest rate model (Compound V2, Aave V2)

**Advanced:**
- Reactive rates: Aave V3 uses a variable slope that adjusts based on market conditions
- Per-asset risk parameters: volatile assets get steeper curves, stablecoins get flatter

### Step 3: Liquidation Mechanism (1 minute)

**When:**
Health factor drops below 1.0 (collateral no longer covers debt with safety margin).

**How (Options):**
1. **Fixed-price liquidation** (Compound V2): Liquidator repays part of debt, receives collateral at a discount (e.g., 5-10%). Simple but creates MEV (bots race for profitable liquidations).
2. **Dutch auction liquidation**: Price starts high, decreases over time until someone bites. Fairer price discovery, less MEV.
3. **Gradual liquidation**: Don't liquidate 50% at once -- liquidate small portions to give borrowers time to add collateral. Reduces cascading liquidation risk.

**Bad Debt:**
When collateral value drops below debt value (underwater position). Options:
- Socialized loss across lenders (Aave's Safety Module model)
- Insurance fund covers the gap
- Protocol treasury backstop

**VibeSwap Reference:**
- `ILProtectionVault.sol`: Insurance vault with tiered coverage -- same pattern applies to liquidation insurance
- `TreasuryStabilizer.sol`: Counter-cyclical deployment -- would serve as the treasury backstop for bad debt
- `DAOTreasury.sol`: Backstop liquidity pool, analogous to a lending protocol's safety module
- `VolatilityInsurancePool.sol` (`contracts/incentives/VolatilityInsurancePool.sol`): Mutualized risk pool

### Step 4: Oracle Design (1 minute)

**Requirements:**
- Reliable price feed for all collateral and borrowed assets
- Manipulation-resistant (can't be moved by flash loans)
- Fresh enough for timely liquidations

**Multi-Layer Approach:**
1. **Primary:** Chainlink / Pyth price feeds (off-chain aggregation, battle-tested)
2. **Secondary:** On-chain TWAP from major AMMs (backup if Chainlink goes down)
3. **Validation:** Max deviation between primary and secondary (e.g., 5%). If exceeded, circuit breaker pauses new borrows.

**VibeSwap Reference:**
- `TWAPOracle.sol`: Ring buffer with 65535 observations, configurable TWAP windows (5 min to 24h)
- `VWAPOracle.sol`: Volume-weighted average price for additional manipulation resistance
- `SecurityLib.checkPriceDeviation()`: Exact pattern needed for cross-oracle deviation checks
- `CircuitBreaker.sol` with `PRICE_BREAKER` and `TRUE_PRICE_BREAKER`: Halts operations when prices are anomalous
- `VibeSecurityOracle.sol` (`contracts/security/VibeSecurityOracle.sol`): Security-focused oracle

### Step 5: Security Considerations (30 seconds)

- **Reentrancy:** Liquidation calls external contracts (selling collateral). Must use reentrancy guards + CEI pattern.
- **Oracle manipulation:** Flash loan -> manipulate oracle -> self-liquidate or avoid liquidation. TWAP and multi-source oracles prevent this.
- **Interest rate griefing:** Whale deposits and withdraws to manipulate utilization rate (and thus interest rates). Rate smoothing and minimum borrow sizes help.
- **Governance attacks:** Flash loan governance tokens -> pass malicious proposal -> drain protocol. Timelock + token lockup period before voting.
- **Token compatibility:** Fee-on-transfer tokens, rebasing tokens, tokens with hooks (ERC-777). Strict allowlist or explicit handling.

---

## Design 3: "Design a Bridge"

### Opening (30 seconds)

> "I'll design a cross-chain bridge for arbitrary message passing and token transfers, with defense-in-depth security. VibeSwap's CrossChainRouter is built on LayerZero V2, so I've implemented exactly this pattern."

### Step 1: Trust Models (1 minute)

**The fundamental question:** Who validates that a message from Chain A is authentic on Chain B?

| Model | Trust Assumption | Examples | Security |
|-------|-----------------|----------|----------|
| **Externally validated** | Honest majority of validators | Multichain (RIP), Wormhole (pre-guardian) | Only as secure as the validator set |
| **Optimistic** | At least 1 honest watcher in the fraud-proof window | Across, Connext, Optimism native bridge | 7-day finality (or shorter with fast paths) |
| **Locally validated** | Both parties verify (atomic swaps, HTLCs) | THORChain (TSS), HTLC bridges | Strongest trust assumption but limited functionality |
| **Natively validated** | Consensus of the source chain verified on destination | IBC (Cosmos), L1<->L2 rollup bridges | Trustless but expensive (light client on-chain) |
| **Modular** | Configurable per-app (choose your own validators + verifiers) | LayerZero V2 | Flexible -- security is as good as configuration |

**VibeSwap's Choice: LayerZero V2 (Modular)**
- Security Stack = DVN (Decentralized Verifier Networks) + Executor
- Each OApp (like CrossChainRouter) configures which DVNs it trusts
- Not locked into a single validator set -- can require 2-of-3 DVNs for critical messages

### Step 2: Message Passing Architecture (1 minute)

**Components:**
1. **Source Contract:** Encodes message + calls endpoint's `send()`
2. **Transport Layer:** Relayers pick up the message, DVNs verify it
3. **Destination Contract:** `lzReceive()` is called with verified message + origin info

**Message Types (from VibeSwap):**
- `ORDER_COMMIT`: Submit a commit hash from Chain A to Chain B's auction
- `ORDER_REVEAL`: Reveal an order cross-chain
- `BATCH_RESULT`: Broadcast settlement results back to source chains
- `LIQUIDITY_SYNC`: Synchronize reserve states across chains
- `ASSET_TRANSFER`: Actual token movement (lock on source, mint on destination)

**Token Transfer Patterns:**
- **Lock and Mint:** Lock real tokens on source, mint wrapped tokens on destination. Simplest, but wrapped tokens have counterparty risk.
- **Burn and Mint:** Burn native tokens on source, mint on destination. Requires mint authority on both chains.
- **Liquidity pools:** Deposit on source, withdraw from pool on destination. No wrapped tokens but requires pre-funded pools on every chain.

### Step 3: Finality and Confirmation (1 minute)

**The Finality Problem:**
A message sent from Chain A might reference a transaction that later gets reorged. The bridge must wait for sufficient finality.

| Chain | Finality Time | Mechanism |
|-------|--------------|-----------|
| Ethereum | 12-15 min (2 epochs) | Casper FFG finality |
| Arbitrum | ~1 week (optimistic) / instant (soft) | Fraud proof window |
| Optimism | ~1 week (optimistic) / instant (soft) | Fraud proof window |
| Base | Same as Optimism | OP Stack |
| Solana | ~13 seconds | Tower BFT |

**Design Choices:**
- **Conservative:** Wait for full finality. Slowest but safest.
- **Optimistic fast path:** Process immediately with fraud-proof window. If challenged, roll back. Faster but riskier.
- **Hybrid:** Small transfers processed fast, large transfers wait for finality. Risk-adjusted.

### Step 4: Security Architecture (1 minute)

**Attack Vectors:**

| Attack | Description | Mitigation |
|--------|-------------|------------|
| **Fake message injection** | Attacker forges a message claiming Chain A sent funds | Peer validation (only accept from known contracts), DVN verification |
| **Replay attack** | Same message processed twice | Nonce tracking per source chain + sender |
| **Cross-chain replay** | Message for Chain B replayed on Chain C | Include destination chain ID in message (VibeSwap: `dstChainId` in `CrossChainCommit`) |
| **Griefing** | Flood destination with garbage messages | Rate limiting per source chain, minimum message fees |
| **Relayer censorship** | Relayer refuses to deliver messages | Multiple relayer redundancy, permissionless relay |
| **Oracle/DVN collusion** | Verifiers collude to approve fake messages | Require multiple independent DVNs (2-of-3 threshold) |
| **Reorg exploitation** | Send message, reorg source chain, double-spend | Wait for finality before processing |

**Defense in Depth:**
1. Peer address validation on every incoming message
2. Nonce sequencing (detect gaps and replays)
3. Rate limiting per chain per time window
4. Maximum message value limits (large transfers require multi-block confirmation)
5. Circuit breakers that halt the bridge on anomaly detection
6. Emergency pause capability with guardian multi-sig

**VibeSwap Reference:**
- `CrossChainRouter.sol`: Implements peer validation, nonce tracking, rate limiting, message type routing
- `CrossChainCommit.dstChainId`: Destination chain field prevents cross-chain replay
- `CrossChainCommit.srcTimestamp`: Source timestamp for consistent commit ID generation
- `CircuitBreaker.sol`: Provides the emergency stop framework
- `RateLimiter.sol` (referenced in README): Per-chain message rate limiting

### Step 5: Wrap-Up Talking Points (30 seconds)

> "The hardest part of bridge design is getting the trust model right. Every bridge hack in history comes from either validator compromise (Ronin, Wormhole) or incorrect message validation (Nomad). VibeSwap uses LayerZero V2 because the modular security model lets us choose and upgrade our verifier set without changing the application contracts. The CrossChainRouter implements every defense I mentioned -- peer validation, nonce tracking, rate limiting, destination chain binding -- because in cross-chain, defense in depth isn't optional."

---

## General System Design Interview Tips

### Structure Your Answer

1. **Clarify** (30s): Ask 2-3 questions to scope the problem
2. **High-level architecture** (1 min): Draw/describe the major components
3. **Deep dive on the hardest part** (2 min): The interviewer cares about depth, not breadth
4. **Security / failure modes** (1 min): What can go wrong? How do you handle it?
5. **Tradeoffs** (30s): What did you optimize for and what did you sacrifice?

### Always Mention

- **Upgradeability plan**: How do you fix bugs post-deployment?
- **Monitoring**: How do you detect exploits in real-time? (Circuit breakers, anomaly detection)
- **Failure modes**: What happens when an oracle goes down? When a chain reorgs? When the admin key is compromised?
- **Gas costs**: Is this economically viable for users? What's the per-transaction cost?
- **Testing strategy**: Fuzz testing, invariant testing, formal verification scope

### Connect Everything to VibeSwap

When they ask "have you built this?" -- you have:
- **360+ Solidity contracts** across 30 modules
- **370+ test files** (unit, fuzz, invariant, integration, security)
- **UUPS upgradeable proxy architecture** with documented disintermediation roadmap
- **LayerZero V2 cross-chain** with 5 chain RPC endpoints configured
- **Original mechanism design research**: 49 published papers covering batch auctions, Shapley values, Kalman filter oracles, cooperative game theory
- **Defense-in-depth security**: reentrancy guards, circuit breakers, rate limiting, TWAP validation, flash loan detection, slashing, donation attack detection
- **Full-stack**: Solidity + React 18 + Python oracle + Foundry testing

### Your Edge

Most candidates have used protocols. You BUILT one from scratch -- sole engineer, no funding, 360+ contracts. You understand not just what the patterns are but WHY they exist, because you had to solve the problems that created them. The commit-reveal batch auction is original mechanism design. The Shapley value distribution is original game theory applied to DeFi. These aren't things you imported from a library -- you designed them, implemented them, tested them, and wrote the papers.
