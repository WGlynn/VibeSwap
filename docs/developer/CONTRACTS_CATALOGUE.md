# VibeSwap Contracts Catalogue

> Complete reference of all Solidity contracts in the VibeSwap Operating System (VSOS).
>
> **Total: 290 implementation contracts + 80 interfaces = 370 .sol files**
>
> Last updated: 2026-05-01 (refresh covers C39 / C42 / C45 / C46 / C47 / C48 cycles)

---

## Recent Cycles — what changed since 2026-03-26

These cycles added storage slots and new external functions to several contracts. Slot
counts cited below come from `docs/audits/2026-05-01-storage-layout-followup.md`. The
per-contract rows further down reflect the post-cycle API surface.

| Cycle | Contract(s) | Change | New slots | Reinitializer |
|------|---|---|---:|---|
| **C39** | `core/CircuitBreaker` | Default-on attested-resume for `LOSS_BREAKER` + `TRUE_PRICE_BREAKER` (security-load-bearing breakers stay tripped past cooldown until M certified attestors arrive) | +2 (gap 44 → 42) | `_initializeC39SecurityDefaults()` — **NOT WIRED into VibeSwapCore / VibeAMM yet** (HIGH finding, see audit) |
| **C42** | `incentives/ShapleyDistributor` | Commit-reveal keeper machinery for `revealNoveltyMultiplier`; `commitNoveltyMultiplier` + `revealNoveltyMultiplier` + threshold/delay/setters; `disableOwnerSetter` legacy lever | +9 (gap 49 → 40) | `initializeC42Defaults() reinitializer(2)` — present, but `UpgradePostLaunch.s.sol` / `UpgradeShapleyABC.s.sol` ship bare `upgradeToAndCall(impl, "")` (NatSpec violation, see deploy audit §6) |
| **C45** | `identity/SoulboundIdentity` | Source-lineage binding (`bindSourceLineage`, `tokenLineageHash`, `tokenLineageClaimId`, `lineageBindingEnabled`) tying minted identities to ContributionAttestor 3-factor claims | +4 (gap 50 → 46) | `initializeV2(attestor) reinitializer(2)` for upgrades; `setContributionAttestor()` for fresh deploys — both converge on same end state. `script/DeployIdentity.s.sol` wires it post-deploy as Step 6.5 |
| **C46** | `identity/ContributionDAG` | Handshake cooldown observability (`totalHandshakeAttempts`, `totalHandshakeSuccesses`, `totalHandshakesBlockedByCooldown`, `lastHandshakeAt`, `BlockedByCooldown` enum, `HandshakeBlockedByCooldown` event); 1-day `HANDSHAKE_COOLDOWN` constant | +4 (non-upgradeable; new fields zero-init in constructor) | N/A (constructor-based, fresh deploy per upgrade) |
| **C47** | `compliance/ClawbackRegistry` | Bonded permissionless contest path (`openContest`, `upholdContest`, `dismissContest`, `resolveExpiredContest`, `fundContestRewardPool`, `setContestBondToken`/`Amount`/`Window`/`SuccessReward`); `caseContests`, `contestBondToken`, `contestBondAmount`, `contestWindow`, `contestSuccessReward`, `contestRewardPool`, `contestParamsInitialized` | +8 actual / +9 doc-claimed (gap 50 → 41 — LOW off-by-one) | `initializeContestV1 reinitializer(2)` — gold-standard fail-closed pattern; entry points revert with `ContestParamsNotInitialized` until owner runs migration |
| **C48** | (cross-cutting) | Storage-layout discipline pass + `script/DeployIdentity.s.sol` wire-up of `setContributionAttestor` | 0 | N/A |

**Cross-references**:
- Storage audit: `docs/audits/2026-05-01-storage-layout-followup.md` (full per-contract slot accounting, parent-collision analysis, mapping preimage check)
- Deploy script audit: `docs/_meta/deploy-script-audit-2026-05-01.md` (which `Deploy*.s.sol` scripts wire / fail to wire which cycles)
- Maintenance synthesis: `docs/audits/2026-04-27-maintenance-synthesis.md` (4-PR roadmap that produced these cycles)
- Concept primitives:
  - `docs/concepts/primitives/classification-default-with-explicit-override.md` (C39)
  - `docs/concepts/primitives/in-flight-state-preservation-across-semantic-flip.md` (C39 migration semantics)
  - `docs/concepts/primitives/fail-closed-on-upgrade.md` (C45 / C47 reinitializer pattern)
  - `docs/concepts/primitives/two-layer-migration-idempotency.md` (C45 dual-path attestor wire-up)
  - `docs/concepts/oracles/COMMIT_REVEAL_FOR_ORACLES.md` (C42 commit-reveal keeper architecture)

---

## Table of Contents

1. [Root](#root) (1 contract)
2. [Account](#account) (2 contracts)
3. [Agents](#agents) (16 contracts)
4. [AMM](#amm) (9 contracts + 2 curves)
5. [Bridge](#bridge) (1 contract)
6. [Community](#community) (6 contracts)
7. [Compliance](#compliance) (4 contracts)
8. [Compute](#compute) (1 contract + 1 interface)
9. [Consensus](#consensus) (1 contract + 1 interface)
10. [Core](#core) (13 contracts)
11. [DePIN](#depin) (4 contracts)
12. [Financial](#financial) (22 contracts + 1 strategy)
13. [Framework](#framework) (2 contracts)
14. [Governance](#governance) (15 contracts)
15. [Hooks](#hooks) (2 contracts)
16. [Identity](#identity) (16 contracts)
17. [Incentives](#incentives) (18 contracts)
18. [Libraries](#libraries) (14 libraries)
19. [Mechanism](#mechanism) (87 contracts)
20. [Messaging](#messaging) (1 contract)
21. [MetaTx](#metatx) (1 contract)
22. [Monetary](#monetary) (4 contracts)
23. [Naming](#naming) (1 contract)
24. [Oracle](#oracle) (1 contract + 1 interface)
25. [Oracles](#oracles) (4 contracts)
26. [Proxy](#proxy) (1 contract)
27. [Quantum](#quantum) (4 contracts)
28. [RWA](#rwa) (5 contracts)
29. [Security](#security) (9 contracts)
30. [Settlement](#settlement) (12 contracts)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| **UUPS** | Upgradeable (UUPSUpgradeable + Initializable) |
| **Init** | Uses Initializable only (no UUPS) |
| **Abstract** | Cannot be deployed directly |
| **Library** | Stateless utility library |

---

## Root

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **CreatorTipJar** | Voluntary donation contract for protocol creator -- pure gratitude, no extraction | No | `tipEth`, `tipToken`, `withdrawEth`, `withdrawToken` |

**Dependencies:** OZ IERC20, SafeERC20

---

## Account

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeSmartWallet** | ERC-4337 compliant smart contract wallet with session keys | No | `initialize`, `revokeSessionKey`, `setRecoveryAddress`, `executeRecovery` |
| **VibeWalletFactory** | Factory for deploying VibeSmartWallet via CREATE2 | No | (factory pattern) |

**Dependencies:** IVibeSmartWallet

---

## Agents

All agent contracts are **UUPS upgradeable**.

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| **VibeAgentAnalytics** | AI conversation and performance analytics | `rateSatisfaction`, `finalizeEpoch`, `getPerformance` |
| **VibeAgentConsensus** | Byzantine AI agent agreement protocol | `createRound`, `finalize`, `getRound` |
| **VibeAgentGovernance** | AI agent participation in DAO governance with bounded autonomy | `updateReputation`, `deactivateAgent`, `getProposal` |
| **VibeAgentInsurance** | Coverage pools for AI agent operations | `underwrite`, `approveClaim`, `rejectClaim` |
| **VibeAgentMarketplace** | Deploy, discover, hire, and compensate AI agents | `requestTask`, `completeTask`, `disputeTask`, `resolveDispute`, `shapleyMatch` |
| **VibeAgentMemory** | Persistent verifiable memory layer for AI agents | `recallMemory`, `verifyMemory`, `linkMemories`, `pruneExpired` |
| **VibeAgentNetwork** | Agent-to-agent communication and discovery | `heartbeat`, `createChannel`, `findBySkill`, `dissolveTeam` |
| **VibeAgentOrchestrator** | Multi-agent workflow and swarm coordination | `createWorkflow`, `executeStep`, `assignSwarmTask`, `resolveSwarmConsensus` |
| **VibeAgentPersistence** | On-chain persistent memory protocol (claude-mem absorption) | `accessMemory`, `deleteMemory`, `applyDecay`, `revokeAccess` |
| **VibeAgentProtocol** | Universal AI agent infrastructure (Paperclip/Pippin/ElizaOS absorption) | `addSkillToAgent`, `completeTask`, `upgradeAutonomy` |
| **VibeAgentReputation** | Multi-dimensional agent reputation scoring | `updateScore`, `endorse`, `getCompositeScore` |
| **VibeAgentSelfImprovement** | Recursive AI enhancement tracking | `approveImprovement`, `applyImprovement`, `rollback` |
| **VibeAgentTrading** | Autonomous agent trading vaults with copy trading | `deposit`, `withdraw`, `openCopyPosition`, `closeCopyPosition` |
| **VibeSecurityOracle** | Decentralized smart contract security audit protocol | `registerAuditor`, `verifyFinding`, `completeAudit` |
| **VibeTaskEngine** | Universal task decomposition and execution | `assignTask`, `startTask`, `completeTask`, `failTask` |

---

## AMM

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeAMM** | Constant product AMM with batch swap execution for MEV-resistant trading | Init | `initialize`, `createPool`, `addLiquidity`, `removeLiquidity`, `executeBatchSwap`, `swap`, `swapWithPoW`, `collectFees`, `getSpotPrice` |
| **VibeAMMLite** | Deployment-optimized AMM for Base mainnet (< 24KB) | Init | `initialize`, `createPool`, `addLiquidity`, `removeLiquidity`, `executeBatchSwap`, `swap` |
| **VibeLP** | ERC-20 LP token for VibeSwap liquidity pools | No | `mint`, `burn` |
| **VibeLPNFT** | ERC-721 position manager for VibeAMM liquidity positions | No | `mint`, `increaseLiquidity`, `decreaseLiquidity`, `collect`, `burn` |
| **VibeLimitOrder** | On-chain limit orders settled via batch auction | UUPS | `placeLimitOrder`, `cancelOrder`, `fillOrders`, `claimFilled` |
| **VibePoolFactory** | Modular pool factory with pluggable curves | No | `registerCurve`, `createPool`, `quoteAmountOut`, `quoteAmountIn` |
| **VibeRouter** | Multi-path trade aggregation router (Jupiter pattern) | UUPS | `swap`, `getQuote`, `registerPool` |

### AMM Curves

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| **ConstantProductCurve** | x * y = k constant-product AMM curve (IPoolCurve) | `getAmountOut`, `getAmountIn`, `validateParams` |
| **StableSwapCurve** | Curve.fi StableSwap invariant for near-pegged pairs (IPoolCurve) | `getAmountOut`, `getAmountIn`, `validateParams` |

| **FeeController** | PID-based dynamic fee controller using EWMA volatility and IL measurement | No | `getFee`, `initializePool`, `takeSnapshot`, `setPIDParams`, `setEmergencyFee` |

**Key Dependencies (VibeAMM):** VibeLP, CircuitBreaker, BatchMath, SecurityLib, TWAPOracle, VWAPOracle, TruePriceLib, LiquidityProtection, FibonacciScaling, ProofOfWorkLib, ITruePriceOracle, IPriorityRegistry, IIncentiveController, IVolatilityOracle, FeeController

---

## Bridge

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **AttributionBridge** | Bridges off-chain Jarvis attribution data to on-chain Shapley distribution | No | `finalizeEpoch`, `createShapleyGame` |

**Dependencies:** ShapleyDistributor

---

## Community

All community contracts are **UUPS upgradeable**.

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| **IdeaMarketplace** | Non-coders submit ideas, builders execute, both earn (Freedom's concept) | `fundBounty`, `claimBounty`, `startWork`, `approveWork` |
| **VibeDAO** | Lightweight DAO factory for sub-communities | `joinDAO`, `leaveDAO`, `vote`, `executeProposal`, `fundDAO` |
| **VibePush** | Decentralized notification system | `createChannel`, `subscribe`, `unsubscribe` |
| **VibeReputation** | On-chain reputation aggregator across VSOS modules | `endorse`, `getTotalScore`, `getProfile` |
| **VibeRewards** | Multi-pool staking rewards distribution | `createPool`, `stake`, `withdraw`, `claimReward` |
| **VibeSocial** | On-chain social graph | `follow`, `unfollow`, `createPost`, `likePost`, `tipPost` |

**Key Dependencies (IdeaMarketplace):** IContributionDAG, IPredictionMarket, IReputationOracle, IContextAnchor

---

## Compliance

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **ClawbackRegistry** | Tracks tainted wallets and manages fund clawbacks with cascading reversal. **C47**: bonded permissionless contest path — anyone can post a bond and contest a clawback case during `contestWindow`; uphold pays `contestSuccessReward` from `contestRewardPool`, dismiss forfeits the bond. Fail-closed: contest entry points revert with `ContestParamsNotInitialized` until owner runs `initializeContestV1`. | UUPS | `submitForVoting`, `executeClawback`, `dismissCase`, `checkWallet`, `openContest`, `upholdContest`, `dismissContest`, `resolveExpiredContest`, `fundContestRewardPool`, `setContestBondToken`, `setContestBondAmount`, `setContestWindow`, `setContestSuccessReward`, `getCaseContest`, `hasActiveContest`, `initializeContestV1(bondToken, bondAmount, window, successReward) reinitializer(2)` |
| **ClawbackVault** | Escrow for clawed-back funds during dispute resolution | UUPS | `returnToOwner`, `returnAllForCase`, `getEscrow` |
| **ComplianceRegistry** | Centralized compliance controls for regulatory flexibility | UUPS | `canProvideLiquidity`, `canUsePriorityAuction`, `freezeUser`, `suspendUser` |
| **FederatedConsensus** | Hybrid authority consensus for clawback decisions | UUPS | `vote`, `isExecutable`, `markExecuted` |

**Dependencies:** FederatedConsensus (used by ClawbackRegistry)

---

## Compute

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **ComputeSubsidyManager** | Reputation-weighted compute pricing for AI agents (JOULE system) | UUPS | `submitJob`, `completeJob`, `stakeForReputation`, `fundPool` |

**Dependencies:** IComputeSubsidy

---

## Consensus

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **NakamotoConsensusInfinity** | Three-dimensional consensus (PoW + PoS + PoM) -- first consensus merging all three | UUPS | `registerValidator`, `depositStake`, `submitPoW`, `refreshMindScore`, `propose`, `vote`, `finalizeProposal` |

**Dependencies:** INakamotoConsensusInfinity, SoulboundIdentity, ContributionDAG

---

## Core

The core contracts are the beating heart of VibeSwap.

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeSwapCore** | Main entry point for the omnichain DEX | UUPS | `settleBatch`, `withdrawDeposit`, `refundExpiredCrossChain`, `pause`, `unpause` |
| **CommitRevealAuction** | Batch auction mechanism with commit-reveal and priority bidding | Init | `advancePhase`, `settleBatch`, `withdrawDeposit`, `slashUnrevealedCommitment`, `claimRefund` |
| **CircuitBreaker** | Emergency stop mechanism to protect against exploits. **C39**: `LOSS_BREAKER` and `TRUE_PRICE_BREAKER` are default-on attested-resume — they stay tripped past wall-clock cooldown until M certified attestors arrive. Owner can opt-out via `attestedResumeOverridden` mapping. | Abstract | `setGlobalPause`, `emergencyPauseAll`, `resetBreaker`, `setGuardian`, `attestedResumeOverridden(bytes32)`, `_initializeC39SecurityDefaults()` (concrete-child reinitializer hook) |
| **FeeRouter** | Central protocol fee collector and distributor | No | `collectFee`, `distribute`, `distributeMultiple`, `updateConfig` |
| **BuybackEngine** | Automated buyback-and-burn for protocol token value accrual | No | `executeBuyback`, `executeBuybackMultiple` |
| **ProtocolFeeAdapter** | Bridges fee-generating contracts to cooperative distribution | No | `forwardFees`, `forwardETH` |
| **wBAR** | Wrapped Batch Auction Receipts (ERC-20 pending auction positions) | No | `transferPosition`, `settle`, `redeem`, `reclaimFailed` |
| **TrinityGuardian** | Immutable BFT node protection for JARVIS Mind Network | No | `proposeAddNode`, `proposeRemoveNode`, `vote`, `executeProposal`, `heartbeat` |
| **ProofOfMind** | Hybrid PoW/PoS/PoM consensus primitive | No | `joinNetwork`, `exitNetwork`, `startRound`, `finalizeRound` |
| **HoneypotDefense** | Game-theoretic defense making attackers think they're succeeding | No | `registerSentinel`, `revealTrap`, `recycleResources` |
| **OmniscientAdversaryDefense** | Security against omniscient attackers | No | `setAnchor`, `attestAnchor`, `resolveChallenge`, `whyOmniscientAdversaryLoses` |
| **PoolComplianceConfig** | Immutable per-pool access control configurations | Library | (pure configuration) |

**Key Dependencies (VibeSwapCore):** ICommitRevealAuction, IVibeAMM, IDAOTreasury, IwBAR, CircuitBreaker, CrossChainRouter, SecurityLib, ClawbackRegistry, IIncentiveController

**Key Dependencies (CommitRevealAuction):** DeterministicShuffle, ProofOfWorkLib, IReputationOracle, PoolComplianceConfig

---

## DePIN

All DePIN contracts are **UUPS upgradeable**.

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| **VibeDeviceNetwork** | Decentralized Physical Infrastructure Network for IoT | `verifyDevice`, `heartbeat`, `rewardDevice`, `createFleet` |
| **VibeInfoFi** | True Information Finance (CKB-Native) -- original InfoFi architecture | `verifyPrimitive`, `stakeOnKnowledge`, `getPrimitive` |
| **VibeMedicalVault** | HIPAA-grade medical records sharing with patient sovereignty | `revokeConsent`, `enrollInStudy` |
| **VibePrivateCompute** | Zero-knowledge and homomorphic compute layer | `revokeAccess`, `registerNode`, `verifyDataset` |

---

## Financial

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **StrategyVault** | ERC-4626 automated yield vault with pluggable strategies | No | `proposeStrategy`, `activateStrategy`, `harvest` |
| **VestingSchedule** | Token vesting with cliff + linear unlock | No | `claim`, `revoke`, `vestedAmount`, `claimableAmount` |
| **VibeBonds** | ERC-1155 semi-fungible bond market with Dutch-auction yield discovery | No | `createSeries`, `buy`, `claimCoupon`, `redeem`, `earlyRedeem`, `settleAuction` |
| **VibeCredit** | P2P reputation-gated credit delegation (ERC-721 NFTs) | No | `borrow`, `repay`, `liquidate`, `closeCreditLine` |
| **VibeFeeDistributor** | Protocol revenue distribution | UUPS | `collectFees`, `distribute`, `stake`, `unstake`, `claim` |
| **VibeFlashLoan** | Protocol-wide flash loan provider | UUPS | `registerPool`, `flashFee`, `maxFlashLoan` |
| **VibeInsurance** | Parametric insurance + prediction market primitive (ERC-721 policies) | No | `underwrite`, `claimPayout`, `resolveMarket` |
| **VibeInsurancePool** | Protocol-wide insurance underwriting | UUPS | `underwrite`, `voteOnClaim`, `resolveClaim` |
| **VibeLendPool** | AAVE-style lending pool with Shapley-weighted interest | UUPS | `deposit`, `withdraw`, `borrow`, `repay`, `getHealthFactor` |
| **VibeLiquidStaking** | Liquid staking derivative | UUPS | `stake`, `stakeVibe`, `claimWithdrawal`, `reportRewards` |
| **VibeOptions** | ERC-721 on-chain European-style options | No | `purchase`, `exercise`, `reclaim`, `cancel` |
| **VibePerpEngine** | Perpetual futures engine (Hyperliquid + dYdX + GMX merge) | UUPS | `addMargin`, `removeMargin`, `liquidate`, `updateFunding` |
| **VibePerpetual** | Perpetual swaps with PID funding rate | UUPS | `depositCollateral`, `withdrawCollateral`, `closePosition`, `liquidate` |
| **VibeRevShare** | ERC-20 revenue share tokens (stakeable, tradeable, collateral) | No | `stake`, `requestUnstake`, `claimRevenue`, `depositRevenue` |
| **VibeStaking** | ETH-based staking with lock-up tiers and delegation | UUPS | `stake`, `unstake`, `claimRewards`, `setDelegate` |
| **VibeStream** | ERC-721 streaming payments (continuous token flows) | No | `cancel`, `streamedAmount`, `withdrawable` |
| **VibeSynth** | ERC-721 synthetic asset positions (collateralized exposure) | No | `mintSynth`, `burnSynth`, `addCollateral`, `liquidate` |
| **VibeVault** | Generalized multi-asset vault | UUPS | `rebalance`, `totalVaultValue`, `isHealthy` |
| **VibeWrappedAssets** | Wrapped asset factory for cross-chain representations | UUPS | `mint`, `burn`, `updateLockedOnSource` |
| **VibeYieldAggregator** | Yearn-style yield aggregator | UUPS | `cancelMigration`, `totalVaultAssets`, `pricePerShare` |
| **SimpleYieldStrategy** | Reference IStrategy implementation -- holds assets with yield injection | No | `injectYield` |

**Key Dependencies:** IStrategyVault, IFeeRouter, IVibeAMM, IVolatilityOracle, IReputationOracle, PairwiseFairness, IShapleyDistributor

---

## Framework

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeIntentRouter** | Intent-based order routing across VibeSwap venues | No | `cancelIntent`, `setRouteEnabled` |
| **VibeProtocolOwnedLiquidity** | Treasury-owned LP positions earning fees perpetually | No | `collectFees`, `collectAllFees`, `emergencyWithdrawAll` |

**Dependencies:** IVibeAMM, IVibeRevShare

---

## Governance

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **AutomatedRegulator** | On-chain equivalent of SEC / regulatory bodies | UUPS | `reportCancellation`, `registerCluster`, `addSanctionedAddress` |
| **DAOTreasury** | DAO treasury with backstop liquidity and timelock-controlled withdrawals | Init | `receiveAuctionProceeds`, `executeWithdrawal`, `approveEmergencyWithdraw` |
| **DecentralizedTribunal** | On-chain trial system with jurors, evidence, and appeals | UUPS | `volunteerAsJuror`, `submitEvidence`, `castJuryVote`, `renderVerdict`, `fileAppeal` |
| **DisputeResolver** | On-chain arbitration (equivalent of lawyers) | UUPS | `registerArbitrator`, `advanceToArbitration`, `escalateToTribunal` |
| **ForkRegistry** | Fractal Fork Network -- forks are children, not enemies | UUPS | `registerFork`, `routeFees`, `reconverge` |
| **GovernanceGuard** | TimelockController + Shapley veto | UUPS | `veto`, `cancel`, `isExecutable` |
| **TreasuryStabilizer** | Counter-cyclical treasury operations for market stabilization | UUPS | `setMainPool`, `setTWAPPeriods` |
| **VibeCrossChainGovernance** | Cross-chain proposals and voting | UUPS | `executeProposal`, `addValidator`, `hasQuorum` |
| **VibeGovernanceHub** | Unified governance hub for VSOS | UUPS | `withdrawConviction`, `delegate`, `veto` |
| **VibeGovernanceSunset** | Ungovernance Time Bomb -- governance designed to self-destruct | UUPS | `registerVoter`, `execute`, `isSunset`, `extendSunset` |
| **VibeKeeperNetwork** | Decentralized keeper network for protocol maintenance | No | `registerKeeper`, `executeTask`, `claimRewards` |
| **VibePluginRegistry** | On-chain registry of approved protocol extensions | No | `approvePlugin`, `activatePlugin`, `deprecatePlugin` |
| **VibeProtocolTreasury** | Protocol treasury with council governance | UUPS | `approveSpending`, `executeSpending`, `recordRevenue` |
| **VibeTimelock** | General-purpose timelocked governance execution | No | `cancel`, `getOperationState`, `setMinDelay` |

**Key Dependencies:** FederatedConsensus, ClawbackRegistry, ITreasuryStabilizer, IVolatilityOracle, IVibeAMM, IDAOTreasury, IReputationOracle

---

## Hooks

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **DynamicFeeHook** | Adjusts pool fees based on volatility (first IVibeHook implementation) | No | `calculateFeeForVolume`, `getPoolVolume` |
| **VibeHookRegistry** | Pre/post swap hooks on pools (Uniswap V4 style) | No | `detachHook`, `updateHookFlags`, `setPoolOwner` |

**Interfaces:** IVibeHook, IVibeHookRegistry

---

## Identity

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **AGIResistantRecovery** | Anti-AGI safeguards for wallet recovery | UUPS | `getHumanityScore`, `canAttemptRecovery`, `recordAttempt` |
| **AbsorptionRegistry** | On-chain attribution for absorbed protocols | UUPS | `recordRewards`, `linkContract` |
| **AgentRegistry** | ERC-8004 compatible AI agent registry (PsiNet x VibeSwap) | UUPS | `setAgentStatus`, `updateContextRoot`, `recordInteraction`, `vouchForAgent` |
| **ContextAnchor** | On-chain anchor for PsiNet context graphs (IPFS stored, Merkle verified) | UUPS | `archiveGraph`, `revokeAccess`, `getGraph` |
| **ContributionAttestor** | 3-branch contribution attestation governance (separation of powers) | No | `attest`, `contest`, `escalateToTribunal`, `escalateToGovernance` |
| **ContributionDAG** | On-chain trust DAG (Web of Trust) -- direct port of trustChain.js. Non-upgradeable, gas-bounded BFS (`MAX_TRUST_HOPS = 6`). **C46**: handshake cooldown observability — `addVouch`/`tryAddVouch` increment `totalHandshakeAttempts` / `totalHandshakeSuccesses` / `totalHandshakesBlockedByCooldown`, with per-pair `lastHandshakeAt` and 1-day `HANDSHAKE_COOLDOWN`. Lets governance audit cooldown-hit-rate (blocks/attempts) and recalibrate. | No | `revokeVouch`, `recalculateTrustScores`, `getTrustScore`, `getVotingPowerMultiplier`, `totalHandshakeAttempts()`, `totalHandshakeSuccesses()`, `totalHandshakesBlockedByCooldown()`, `lastHandshakeAt(pairKey)`, `HANDSHAKE_COOLDOWN()` |
| **ContributionYieldTokenizer** | Pendle-inspired tokenization separating ideas from execution | No | `fundIdea`, `proposeExecution`, `claimStream`, `mergeIdeas` |
| **Forum** | Decentralized forum bound to soulbound identities | UUPS | `createCategory`, `setCategoryActive`, `setPinned` |
| **GitHubContributionTracker** | GitHub webhook-driven contribution ingestion | No | `setAuthorizedRelayer`, `bindGitHubAccount`, `getContributionRoot` |
| **PairwiseVerifier** | CRPC (Commit-Reveal Pairwise Comparison) protocol | UUPS | `advancePhase`, `commitWork`, `settle`, `claimReward` |
| **RewardLedger** | Retroactive + active Shapley reward tracking (port of shapleyTrust.js) | No | `finalizeRetroactive`, `distributeEvent`, `claimRetroactive`, `claimActive` |
| **SoulboundIdentity** | Non-transferable identity NFT binding username, avatar, reputation. **C45**: source-lineage binding ties each identity NFT to a 3-factor `ContributionAttestor` claim — `bindSourceLineage(claimId)` writes the lineage hash + claim id into `tokenLineageHash` / `tokenLineageClaimId`. Fresh deploys wire via `setContributionAttestor`; upgrades via `initializeV2 reinitializer(2)`. | UUPS | `mintIdentity`, `mintIdentityQuantum`, `changeUsername`, `updateAvatar`, `vote`, `bindSourceLineage`, `setContributionAttestor`, `initializeV2(attestor) reinitializer(2)` |
| **VibeCode** | Deterministic identity fingerprint from on-chain contribution data | No | `refreshVibeCode`, `getVibeCode`, `getReputationScore`, `getVisualSeed` |
| **VibeNames** | ENS-compatible naming system (.vibe TLD) | UUPS | `register`, `resolve`, `reverseResolve`, `setTextRecord` |
| **WalletRecovery** | Multi-layer wallet recovery (social + time-locks + arbitration) | UUPS | `addGuardian`, `initiateGuardianRecovery`, `executeRecovery`, `reportFraud` |

**Key Dependencies:** IncrementalMerkleTree, IContributionDAG, IRewardLedger, IAgentRegistry, IVibeCode, SoulboundIdentity, AGIResistantRecovery

---

## Incentives

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **EmissionController** | VIBE accumulation pool -- wall-clock emissions to three sinks | UUPS | `drip`, `fundStaking`, `getCurrentEra`, `getCurrentRate` |
| **ILProtectionVault** | Impermanent loss protection for LPs with tiered coverage | UUPS | `setPoolQuoteToken`, `setIncentiveController` |
| **IncentiveController** | Central coordinator for all VibeSwap incentive mechanisms | UUPS | `setVolatilityOracle`, `claimShapleyReward`, `isShapleyEnabled` |
| **LiquidityGauge** | Curve-style gauge for directing token emissions to LP pools | No | `createGauge`, `stake`, `withdraw`, `claimRewards`, `advanceEpoch` |
| **LoyaltyRewardsManager** | Time-weighted LP rewards with loyalty multipliers | UUPS | `setIncentiveController`, `setTreasury` |
| **MerkleAirdrop** | Gas-efficient token distribution via Merkle proofs | No | `deactivateDistribution`, `reclaimUnclaimed`, `isClaimed` |
| **MicroGameFactory** | Permissionless Shapley game creator (Layer 2 of micro-game architecture) | UUPS | `createMicroGame`, `createMicroGamesForEpoch` |
| **PlaceholderEscrow** | VIBE escrow for contributors without wallets yet | UUPS | `executeProposal`, `totalUnclaimed` |
| **PoeRevaluation** | Posthumous/overlooked evidence revaluation of contributions | UUPS | `stakeConviction`, `unstake`, `execute`, `reject` |
| **PriorityRegistry** | Immutable on-chain record of first-to-publish priority | UUPS | `setAuthorizedRecorder` |
| **ShapleyDistributor** | Shapley value-based fair allocation reward distribution. **C42**: M-of-N keeper commit-reveal for novelty multiplier (prevents single keeper from observing peer reveals + racing a counter-commit). | UUPS | `computeShapleyValues`, `settleFromVerifier`, `claimReward`, `getCurrentHalvingEra`, `commitNoveltyMultiplier`, `revealNoveltyMultiplier`, `setKeeperRevealThreshold`, `setKeeperRevealDelay`, `disableOwnerSetter`, `initializeC42Defaults() reinitializer(2)` |
| **SingleStaking** | Synthetix-style single-sided staking rewards | No | `stake`, `withdraw`, `claimReward`, `exit`, `notifyRewardAmount` |
| **SlippageGuaranteeFund** | Covers execution shortfall when actual output < expected minimum | UUPS | `setIncentiveController` |
| **SoulboundSybilGuard** | Adapter: SoulboundIdentity to ISybilGuard | No | (adapter) |
| **UtilizationAccumulator** | Layer 1 of micro-game Shapley architecture | UUPS | `registerLP`, `deregisterLP`, `advanceEpoch` |
| **VolatilityInsurancePool** | Receives excess fees during high volatility, pays during extreme events | UUPS | `setIncentiveController` |

**Key Dependencies:** PairwiseFairness, IPriorityRegistry, IABCHealthCheck, IShapleyVerifier, ISybilGuard, IVolatilityOracle, IILProtectionVault, ILoyaltyRewardsManager, ISlippageGuaranteeFund

---

## Libraries

All libraries are stateless and gas-optimized.

| Library | Purpose |
|---------|---------|
| **BatchMath** | Mathematical utilities for batch swap clearing price calculation |
| **DeterministicShuffle** | Fisher-Yates shuffle with deterministic seed for fair order execution |
| **FibonacciScaling** | Fibonacci-based scaling for throughput bandwidth and price determination |
| **IncrementalMerkleTree** | Hybrid incremental Merkle tree combining three proven patterns |
| **LiquidityProtection** | Comprehensive protection for low-liquidity environments |
| **MemorylessFairness** | Structural fairness requiring NO participant history or identity |
| **PairwiseFairness** | On-chain verification of Shapley value fairness properties |
| **ProofOfWorkLib** | Proof-of-work verification supporting multiple hash algorithms |
| **SHA256Verifier** | SHA-256 hash computation using EVM precompile |
| **SecurityLib** | Security utilities for DEX protection against common exploits |
| **TWAPOracle** | Time-Weighted Average Price oracle for manipulation resistance |
| **TruePriceLib** | Validation helpers for True Price Oracle integration |
| **VWAPOracle** | Volume-Weighted Average Price oracle for fair execution pricing |
| **PoolComplianceConfig** | Immutable per-pool access control configurations (in core/) |

---

## Mechanism

The mechanism directory is the largest -- containing protocol extensions, DeFi primitives, governance mechanisms, and social infrastructure. All UUPS unless noted.

### Auction & Trading Mechanisms

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **AdaptiveBatchTiming** | Dynamic commit/reveal window adjustment | No | `getCommitDuration`, `getRevealDuration`, `getCurrentCongestionLevel` |
| **BondingCurveLauncher** | Permissionless token launches via linear bonding curves | No | `buy`, `sell`, `graduate`, `refund` |
| **DutchAuctionLiquidator** | Descending-price auctions for liquidating undercollateralized positions | No | `bid`, `settleExpired`, `currentPrice` |
| **VibeDCA** | Dollar cost averaging engine | UUPS | `executeDCA`, `cancelDCA` |
| **VibeLimitOrders** | On-chain limit order book with keeper fills | UUPS | `cancelOrder`, `markExpired` |
| **VibeOTC** | Over-the-counter large block trades (no slippage) | UUPS | `fillDeal`, `cancelDeal` |
| **VibeOrderBook** | On-chain CLOB with MEV protection | UUPS | `cancelOrder`, `getSpread` |
| **VibeTWAPExecutor** | Time-weighted average price order execution | UUPS | `executeChunk`, `cancelTWAP` |

### Bonding & Token Economics

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **AugmentedBondingCurve** | Power-function bonding curve with dual pools (Reserve + Funding) | No | `deposit`, `spotPrice`, `isHealthy` |
| **HatchManager** | Manages hatch (initialization) phase of bonding curves | No | `startHatch`, `contribute`, `completeHatch`, `claimVestedTokens` |
| **HarbergerLicense** | Premium feature licenses via Harberger tax | No | `changeAssessment`, `depositTax`, `collectTax` |
| **VibeGovernanceToken** | veVIBE token mechanics (vote-escrowed) | UUPS | `lock`, `unlock`, `extendLock`, `delegate`, `calculateBoost` |
| **VibeTokenFactory** | No-code permissionless token deployment | UUPS | `verifyToken`, `getTokenMetrics` |
| **VibeVesting** | Token vesting with cliff and linear release | UUPS | `release`, `revoke`, `getVestedAmount` |

### Governance Mechanisms

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **CommitRevealGovernance** | Commit-reveal governance voting (anti-bandwagon) | No | `tallyVotes`, `slashUnrevealed`, `executeVote` |
| **ConvictionGovernance** | Conviction-weighted governance (time accumulates signal) | No | `signalConviction`, `removeSignal`, `triggerPass` |
| **QuadraticVoting** | Quadratic voting governance | No | `finalizeProposal`, `voteCost` |
| **RetroactiveFunding** | Retroactive quadratic funding for community projects | No | `finalizeRound`, `claimFunds`, `settleRound` |
| **VibeDAO** | Full DAO governance with optimistic execution | UUPS | `vote`, `queue`, `execute`, `veto` |
| **VibeEmergencyDAO** | Fast-track emergency governance (when seconds matter) | UUPS | `approveEmergency`, `rotateGuardian` |
| **VibeGovernor** | On-chain governance engine (OZ Governor alternative) | UUPS | `castVote`, `execute`, `cancel`, `veto` |
| **VibeDelegation** | Liquid delegation with conviction decay | UUPS | `delegate`, `undelegate`, `getEffectivePower` |
| **VibeMultisig** | M-of-N multi-signature wallet (Gnosis Safe alternative) | UUPS | `confirmTransaction`, `revokeConfirmation`, `addOwner` |
| **VibeTimelock** (mechanism) | Governance-controlled timelock | UUPS | `executeTransaction`, `cancelTransaction` |

### MEV & Game Theory

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **AdversarialSymbiosis** | Attacks on the protocol generate value that strengthens it | No | `distributeStrengthening`, `getStats` |
| **CooperativeMEVRedistributor** | Redistributes MEV priority bid revenue to LPs and traders | No | `captureMEV`, `claimLPReward`, `claimTraderRefund` |
| **EpistemicStaking** | Knowledge-weighted staking (prediction accuracy = governance power) | No | `applyInactivityDecay`, `getEpistemicWeight` |
| **TemporalCollateral** | Future state commitments used as present collateral | No | `completeCommitment`, `getCollateralValue` |

### Intelligence & AI

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **CognitiveConsensusMarket** | Market where AI agents stake on knowledge claims | No | `resolveClaim`, `refundExpired` |
| **DataMarketplace** | Ocean Protocol-inspired data marketplace with OriginTrail patterns | UUPS | `purchaseAccess`, `withdrawRevenue` |
| **GPUComputeMarket** | Render Network-inspired decentralized GPU compute | UUPS | `acceptJob`, `finalizeJob`, `challengeResult` |
| **IntelligenceExchange** | Sovereign Intelligence Exchange -- VibeSwap for intelligence | UUPS | `cite`, `purchaseAccess`, `claimRewards`, `settleEvaluation` |
| **SIEPermissionlessLaunch** | Permissionless deployment factory for Intelligence Exchange | No | `deploymentCount`, `getDeployment` |
| **SIEShapleyAdapter** | Bridge SIE citation revenue to full Shapley distribution | UUPS | `executeTrueUp`, `initiateTrueUp`, `finalizeTrueUp` |
| **SubnetRouter** | AI task routing (Bittensor subnet-inspired) | UUPS | `registerWorker`, `claimTask`, `submitOutput`, `verifyOutput` |
| **VibeGeometricConsensus** | Grassmann manifold signal aggregation | UUPS | `finalize`, `getRound` |
| **VibeMemoryLedger** | On-chain contribution observation system (claude-mem absorption) | UUPS | `verifyObservation`, `closeEpoch`, `searchByConcept` |

### DeFi Primitives

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeFlashLoanProvider** | Flash loans with safety rails | UUPS | `flashLoan`, `fundPool` |
| **VibeLendingPool** | **DEPRECATED** — duplicate of `financial/VibeLendPool.sol`. See canonical version. | UUPS | `deposit`, `withdraw`, `borrow`, `repay` |
| **VibeP2PLending** | Peer-to-peer lending with reputation | UUPS | `fundLoan`, `repay`, `markDefault`, `liquidate` |
| **VibeInsurancePool** (mechanism) | FDIC-like deposit insurance | UUPS | `purchasePolicy`, `fileClaim`, `executePayout` |
| **VibeLiquidStaking** (mechanism) | Liquid staking derivatives (vsETH) | UUPS | `stake`, `unstake`, `distributeRewards` |
| **VibeLiquidityLocker** | LP token locking for rug-pull prevention | UUPS | `claimVested`, `extendLock` |
| **VibeLiquidityGauge** (mechanism) | Curve-style liquidity mining | UUPS | `createGauge`, `stake`, `voteForGaugeWeights` |
| **VibeSavingsAccount** | High-yield savings with tiered interest | UUPS | `deposit`, `withdraw`, `toggleAutoCompound` |
| **VibePredictionEngine** | PsiNet x prediction market x Etherisc fusion | UUPS | `mintCompleteSet`, `resolveMarket`, `claimWinnings` |
| **PredictionMarket** | Binary outcome prediction markets with AMM | No | `resolveMarket`, `claimWinnings`, `reclaimLiquidity` |
| **VibeRebalancer** | Automated portfolio rebalancing | UUPS | `rebalance`, `needsRebalance` |
| **VibePortfolio** | Automated portfolio management (index funds) | UUPS | `followPortfolio`, `recordRebalance` |
| **VibeYieldAggregator** (mechanism) | Auto-compounding multi-strategy vault | UUPS | `deposit`, `withdraw`, `harvest`, `rebalance` |
| **VibeYieldFarming** | MasterChef-style yield farming | UUPS | `deposit`, `withdraw`, `harvest`, `emergencyWithdraw` |

### Payments & Commerce

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibePayPerCall** | x402 micropayment protocol for VSOS services | UUPS | `depositCredit`, `withdrawCredit`, `confirmResponse` |
| **VibePaymaster** | Gasless transactions for new users | UUPS | `sponsorGas`, `checkSponsorship` |
| **VibePayment** | Payment processing and invoicing | UUPS | `payRequest`, `processSubscription` |
| **VibeSubscriptions** | On-chain recurring payments | UUPS | `createPlan`, `subscribe`, `processPayment` |
| **VibeStreamPayments** | Sablier-style continuous payment streams | UUPS | `withdraw`, `cancelStream`, `balanceOf` |
| **VibeEscrow** | Generalized P2P escrow service | UUPS | `completeMilestone`, `dispute`, `resolveDispute` |
| **VibeMultiSend** | Batch token distribution | UUPS | `multiSendEqual` |

### Social & Community

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeSocialGraph** | Lens/Farcaster-style on-chain social layer | UUPS | `createProfile`, `follow`, `createPost`, `likePost` |
| **VibeContentMarket** | Mirror/Paragraph-style content monetization | UUPS | `purchaseArticle`, `subscribe`, `tip` |
| **VibeAttentionToken** | BAT + x402 attention economy protocol | UUPS | `viewContent`, `rateContent`, `flagBot` |
| **VibeBountyBoard** | Decentralized bug bounty and task marketplace | UUPS | `applyForBounty`, `submitSolution`, `approveSubmission` |
| **VibeReferral** | Protocol growth engine (referral system) | UUPS | `registerReferrer`, `useReferralCode`, `claimRewards` |
| **VibeReferralEngine** | Shapley-weighted referral rewards (not pyramid) | UUPS | `createCode`, `registerReferral`, `claimRewards` |
| **VibePointsEngine** | On-chain points and achievement system | UUPS | `awardPoints`, `redeemPoints`, `unlockAchievement` |
| **VibePointsSeason** | Seasonal leaderboard and cross-system points aggregator | UUPS | `startSeason`, `recordAction`, `dailyCheckIn` |
| **VibeReputationAggregator** | Cross-protocol reputation fusion | UUPS | `reportScore`, `getCompositeScore` |
| **VibeReputationMarket** | Reputation-weighted prediction and coordination market | UUPS | `resolveMarket`, `claim` |

### Infrastructure

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeAnalytics** | On-chain protocol health metrics | UUPS | `takeSnapshot`, `getProtocolMetrics` |
| **VibeAppStore** | DeFi Lego app marketplace | UUPS | `uninstallApp`, `rateApp`, `verifyApp` |
| **VibeAutomation** | Decentralized task automation (Chainlink Keeper alternative) | UUPS | `cancelTask`, `executeTask`, `checkTask` |
| **VibeBridge** | Omnichain asset bridge with BFT consensus | UUPS | `attest`, `executeBridge`, `refund` |
| **VibeCDN** | Decentralized content delivery network | UUPS | `claimPin`, `reportServed`, `submitTranscode` |
| **VibeComposer** | DeFi Lego execution engine (atomic compositions) | UUPS | `compose`, `executeRecipe` |
| **VibeCrossChainReputation** | LayerZero-portable reputation | UUPS | `exportReputation`, `updateLocalScore` |
| **VibeCrossChainSwap** | Atomic cross-chain swaps (HTLC) | UUPS | `claim`, `refund` |
| **VibeDNS** | Decentralized name service (ENS alternative) | UUPS | `renewName`, `resolve`, `resolveContent` |
| **VibeFeeDistributor** (mechanism) | Non-swap protocol fee revenue sharing | UUPS | `depositFees`, `stake`, `claimFees` |
| **VibeFeeRouter** (mechanism) | **DEPRECATED** — duplicate of `core/FeeRouter.sol`. See canonical version. | UUPS | `collectETH`, `distributeETH`, `distributeToken` |
| **VibeGasStation** | Gasless transaction relay network | UUPS | `registerRelayer`, `createSponsor`, `depositGas` |
| **VibeHarbergerPublicGoods** | Universal Harberger taxation for semi-public goods | UUPS | `buyAsset`, `collectTax`, `foreclose` |
| **VibeIdentityBridge** | Cross-chain identity portability | UUPS | `validateAttestation`, `isValidIdentity` |
| **VibeIndexer** | On-chain event indexing registry (The Graph alternative) | UUPS | `signal`, `registerIndexer`, `createAllocation` |
| **VibeLaunchpad** | Fair token launch platform (anti-snipe, anti-bot) | UUPS | `contribute`, `finalizeSale`, `claimTokens` |
| **VibeMessenger** | Cross-chain messaging protocol | UUPS | `subscribe`, `attestRelay` |
| **VibeNameService** | .vibe domain names on-chain | UUPS | `register`, `resolve`, `resolveName` |
| **VibeNFTMarket** | Decentralized NFT marketplace | UUPS | `buyFixed`, `placeBid`, `settleAuction` |
| **VibeNFTMarketplace** | MEV-protected NFT trading | UUPS | `buy`, `placeBid`, `settleAuction` |
| **VibeOracle** | Decentralized price oracle network | UUPS | `createFeed`, `submitPrice`, `getPrice`, `getTWAP` |
| **VibePermissionlessLaunch** | One-call full protocol deployment (VIBE + Emission + Shapley + SIE) | No | `deploymentCount`, `getDeployment` |
| **VibePrivacyPool** | Compliant privacy-preserving transactions | UUPS | `deposit`, `updateAssociationSet` |
| **VibeRNG** | Verifiable random number generator (commit-reveal based) | No | `requestRandom`, `contributeEntropy`, `revealAndFulfill` |
| **VibeRegistry** | Protocol contract registry (central address book) | UUPS | `getAddress`, `getImplementation`, `getVersion` |
| **VibeRevenueShare** | Stakeholder revenue distribution | UUPS | `stake`, `receiveRevenue`, `claimRevenue` |
| **VibeRewardStreamer** | Continuous per-second reward streaming | UUPS | `createStream`, `stake`, `claimAll` |
| **VibeShieldTransfer** | Private transfers via ephemeral addresses | UUPS | `claim`, `reclaimExpired` |
| **VibeZKVerifier** | Unified ZK proof verification hub | UUPS | `isCircuitAuthorized`, `getVerificationStats` |
| **StealthAddress** | Monero-inspired stealth addresses for privacy | UUPS | `getStealthMeta`, `isRegistered` |

---

## Messaging

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **CrossChainRouter** | LayerZero V2 compatible cross-chain router for order submission and liquidity sync | Init | `fundBridgedDeposit`, `getLiquidityState`, `setPeer`, `recoverExpiredDeposit` |

**Dependencies:** ICommitRevealAuction

---

## MetaTx

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeForwarder** | Gasless meta-transaction forwarder with relayer management | No | `registerRelayer`, `deactivateRelayer`, `depositJulRewards` |

**Dependencies:** ERC2771Forwarder (OZ), IVibeForwarder, IReputationOracle

---

## Monetary

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VIBEToken** | Governance and reward token (21M hard cap, burns permanent) | UUPS | `mint`, `burn`, `setMinter`, `mintableSupply`, `circulatingSupply` |
| **Joule** | Trinomial Stability Token (JUL) -- ERC-20 mineable with three stability mechanisms | No | `transfer`, `approve`, `totalSupply`, `balanceOf`, `setMarketOracle` |
| **VibeStable** | vUSD stablecoin (MakerDAO CDP + Reserve Rights + Reflexer RAI merge) | UUPS | `addCollateral`, `mintMore`, `repay`, `liquidate`, `psmSwapIn`, `psmSwapOut` |
| **JarvisComputeVault** | JUL-to-compute credit gateway (ONLY way to get Jarvis compute credits) | UUPS | `commitDeposit`, `reportFraud`, `expireCredits`, `verifyBindingProof` |

**Dependencies:** IJoule

---

## Naming

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeNames** | Augmented Harberger Tax naming system for .vibe network | UUPS | `setPrice`, `depositTax`, `collectTax`, `blockAcquisition`, `resolve` |

---

## Oracle

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **ReputationOracle** | Decentralized trust scoring through commit-reveal pairwise comparisons | UUPS | `createComparison`, `commitVote`, `settleComparison`, `claimDeposit` |

**Interface:** IReputationOracle (used across 20+ contracts for trust queries)

---

## Oracles

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **TruePriceOracle** | On-chain storage for True Price updates from off-chain Kalman filter | UUPS | `setStablecoinRegistry` |
| **VolatilityOracle** | Realized volatility calculation and dynamic fee multipliers | UUPS | `setCacheValidityPeriod`, `setVibeAMM` |
| **StablecoinFlowRegistry** | Tracks USDT/USDC flow ratios and regime indicators | UUPS | `getNonce` |
| **VibeOracleRouter** | Multi-source oracle aggregation router (Chainlink-style) | UUPS | `registerProvider`, `claimRewards`, `fundRewardPool` |

**Dependencies:** ITruePriceOracle, IStablecoinFlowRegistry, IVolatilityOracle, IVibeAMM, SecurityLib

---

## Proxy

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VibeVersionRouter** | Versioned proxy router for opt-in upgrades | No | `selectVersion`, `setDefaultVersion`, `sunsetVersion`, `getImplementation` |

---

## Quantum

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **LamportLib** | Library for Lamport one-time signature verification | Library | (pure verification) |
| **PostQuantumShield** | Hash-based post-quantum key agreement and authentication | No | `createChallenge`, `protectOperation`, `getRemainingKeys` |
| **QuantumGuard** | Mixin for quantum-resistant authorization on any contract | Abstract | `rotateQuantumKey`, `revokeQuantumKey`, `setQuantumRequired` |
| **QuantumVault** | Opt-in quantum-resistant security layer | UUPS | `registerQuantumKey`, `revokeQuantumKey`, `rotateQuantumKey` |

**Dependencies:** LamportLib

---

## RWA (Real World Assets)

All RWA contracts are **UUPS upgradeable**.

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| **VibeCredentialVault** | Decentralized credential and certificate system | `revokeCredential`, `respondToVerification`, `isValid` |
| **VibeEnergyMarket** | P2P renewable energy trading | `purchaseEnergy`, `retireCarbonCredit`, `createPool` |
| **VibeRWA** | Real world asset tokenization protocol | `purchaseShares`, `distributeYield`, `listShares`, `buyListed` |
| **VibeRealEstate** | Decentralized Zillow -- P2P property protocol | `acceptOffer`, `closeSale`, `buyFractions`, `claimRental` |
| **VibeSupplyChain** | Supply chain verification with RFID/IoT | `markDelivered`, `recallProduct`, `lookupByRFID` |

---

## Security

All security contracts are **UUPS upgradeable**.

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| **AntiPhishing** | On-chain domain verification and phishing prevention | `reportPhishing`, `confirmReport`, `checkAddress` |
| **BiometricAuthBridge** | WebAuthn/passkey on-chain verification | `revokeCredential`, `createChallenge`, `isAuthenticated` |
| **EmergencyEjector** | Protocol-wide emergency withdrawal system | `registerSafeHouse`, `voteEmergency`, `eject` |
| **GaslessRescue** | Recover funds without gas (EIP-712 signed relay) | `registerSafe`, `rescueETH` |
| **KeyRecoveryVault** | Encrypted key backup on-chain (can never be lost) | `configureShamir`, `retrieveKey`, `hasStoredKey` |
| **TransactionFirewall** | Programmable transaction rules engine | `setRules`, `setWhitelist`, `coSignTransaction` |
| **VibeSecurityOracle** | Real-time threat intelligence on-chain | `escalate`, `emergencyBlack`, `getLevel` |
| **WalletGuardian** | Multi-layer recovery (mathematically impossible to lose funds) | `queueTransfer`, `freezeWallet`, `triggerDeadManSwitch`, `heartbeat` |
| **WalletRecoveryInsurance** | Fund loss prevention insurance pool | `createPolicy`, `fileClaim`, `executePayout` |

---

## Settlement

| Contract | Purpose | Upgradeable | Key Functions |
|----------|---------|-------------|---------------|
| **VerifiedCompute** | Abstract base for execution/settlement separation | UUPS (abstract) | `bond`, `unbond`, `submitResult`, `finalizeResult` |
| **ShapleyVerifier** | Verifies off-chain Shapley value computations on-chain | extends VerifiedCompute | `finalizeShapleyResult`, `getVerifiedValues` |
| **TrustScoreVerifier** | Verifies off-chain trust/reputation scores on-chain | extends VerifiedCompute | `finalizeTrustResult`, `getVerifiedScores` |
| **VoteVerifier** | Verifies off-chain vote tallies on-chain | extends VerifiedCompute | `finalizeVoteResult`, `getVerifiedTally`, `isQuorumMet` |
| **BatchPriceVerifier** | Verifies pre-computed clearing prices in O(1) | UUPS | `finalizeBatch`, `disputeBatch`, `getBatchPrice` |
| **VerifierCheckpointBridge** | Bridges finalized verifier results into VibeStateChain | UUPS | `checkpointResult`, `isCheckpointed` |
| **VibeBlockRewards** | Validator reward distribution for VibeStateChain | UUPS | `distributeBlockReward`, `claimRewards` |
| **VibeCheckpointRegistry** | Merkle checkpoint storage for state chain light clients | UUPS | `submit`, `getCheckpoint` |
| **VibeConsensusRewards** | Proof of Mind validator incentives | UUPS | `registerValidator`, `rewardBlockProduction`, `claimRewards` |
| **VibeDAVerifier** | Data availability verification for state chain | UUPS | `commitDA`, `attestDA` |
| **VibeFeeMarket** | EIP-1559 style dynamic fee market for state chain | UUPS | `recordBlock`, `getBaseFee` |
| **VibeStateChain** | Virtual state settlement chain (modeled after Nervos CKB) | UUPS | `registerValidator`, `finalizeBlock`, `consumeCell`, `reportEquivocation` |
| **VibeStateVM** | RISC-V execution layer for state transitions (CKB-VM on EVM) | UUPS | `commitTransition`, `createAccount`, `depositToCell` |

---

## Interfaces Summary (80 total)

Interfaces are organized alongside their implementations in `interfaces/` subdirectories. Key unified VSOS interfaces in `contracts/interfaces/`:

| Interface | Purpose |
|-----------|---------|
| **IVibeID** | Unified identity (VibeNames + AgentRegistry + SoulboundIdentity + ContributionDAG) |
| **IVibeRouter** | Unified trading (all swap modules) |
| **IVibeOracle** | Unified oracle (all price data sources) |
| **IVibeLend** | Unified lending (all lending/borrowing modules) |
| **IVibeMind** | Unified AI layer (SubnetRouter + DataMarketplace + AgentRegistry) |
| **IVibePrivacy** | Unified privacy (StealthAddress) |
| **IVibeStore** | Unified storage/compute (GPUComputeMarket + DataMarketplace) |
| **IVibeSynth** | Unified synthetics (VibeSynth + VibePerpEngine) |
| **IVibeAnalytics** | Protocol health metrics |
| **IVibeAppStore** | DeFi Lego app marketplace |
| **IProofOfMind** | Hybrid PoW/PoS/PoM consensus |
| **ICognitiveConsensusMarket** | AI agent knowledge staking |

---

## Architecture Notes

### Upgrade Pattern
- **164 contracts use UUPS** (UUPSUpgradeable + Initializable) -- the dominant pattern
- **5 contracts use Initializable only** (VibeAMM, VibeAMMLite, CrossChainRouter, DAOTreasury, CommitRevealAuction) -- upgradeable via external proxy
- **~120 contracts are non-upgradeable** -- libraries, standalone utilities, immutable primitives

### Security Patterns Used Across Contracts
- `nonReentrant` guards on all state-changing external functions
- `onlyOwner` / `onlyGuardian` for admin operations
- OZ SafeERC20 for all token transfers
- Circuit breakers with volume/price/withdrawal thresholds
- Flash loan same-block interaction guards
- TWAP validation (max 5% deviation)
- Rate limiting (100K tokens/hour/user)
- 50% slashing for invalid reveals

### Dependency Graph (Core Flow)
```
User -> VibeSwapCore -> CommitRevealAuction -> DeterministicShuffle (shuffle)
                     -> VibeAMM -> BatchMath (clearing price)
                     -> CrossChainRouter -> LayerZero V2
                     -> DAOTreasury (revenue)
                     -> FeeRouter -> BuybackEngine (burn)
                                  -> Insurance
                                  -> RevShare
                     -> IncentiveController -> ShapleyDistributor
                                           -> ILProtectionVault
                                           -> LoyaltyRewardsManager
                                           -> VolatilityInsurancePool
```

### Token Contracts
- **VIBEToken**: 21M hard cap, burn-permanent governance token
- **Joule (JUL)**: Elastic, PoW-mineable, trinomial stability token
- **VibeStable (vUSD)**: CDP stablecoin with PSM
- **VibeLP**: Per-pool ERC-20 LP tokens
- **wBAR**: Wrapped Batch Auction Receipts

### Notable Design Decisions
1. **0% swap fees to LPs, 0% bridge fees** -- revenue comes from priority bids, penalties, SVC marketplace
2. **Shapley value distribution** throughout (not just incentives -- governance weight, reputation, rewards)
3. **Three-layer Shapley architecture**: UtilizationAccumulator (L1) -> MicroGameFactory (L2) -> ShapleyDistributor (L3)
4. **VerifiedCompute pattern**: Heavy computation off-chain, verification on-chain (ShapleyVerifier, TrustScoreVerifier, VoteVerifier)
5. **Graceful absorption**: Every external protocol pattern gets absorbed with original developer attribution (AbsorptionRegistry)
6. **Post-quantum readiness**: LamportLib + QuantumGuard + QuantumVault + PostQuantumShield
7. **State chain settlement**: VibeStateChain + VibeStateVM model CKB's cell model on EVM
