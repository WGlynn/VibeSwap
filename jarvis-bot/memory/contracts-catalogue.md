# VibeSwap Contracts Catalogue

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

> **Purpose**: Quick-reference for all contract signatures, imports, and interfaces.
> **Usage**: Read this INSTEAD of reading full contract files when building new contracts.
> **Last updated**: 2026-02-19 (IdeaMarketplace + ContributionDAG referral exclusion)

---

## How to Use This File

When building a new contract:
1. Check the **Pattern Templates** section for the right skeleton
2. Look up **dependency contracts** for exact import paths and function signatures
3. Copy the **common imports block** for your contract type
4. Only read full contract files if you need implementation detail (rare)

**This file eliminates 80%+ of pre-build file reads.**

---

## Pattern Templates (Copy-Paste Skeletons)

### ERC-721 Financial Primitive (VibeOptions, VibeStream, VibeCredit pattern)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IContractName.sol";

contract ContractName is ERC721, Ownable, ReentrancyGuard, IContractName {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    // ============ State ============
    // ============ Constructor ============
    constructor(address _dep) ERC721("Name", "SYM") Ownable(msg.sender) {
        if (_dep == address(0)) revert ZeroAddress();
    }
    // ============ Core Functions ============
    // ============ View Functions ============
    // ============ Internal ============
    // ============ ERC721 Overrides ============
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = super._update(to, tokenId, auth);
        // custom logic here
        return from;
    }
}
```

### ERC-1155 Financial Primitive (VibeBonds pattern)
```solidity
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
// Same section headers, Ownable(msg.sender), ReentrancyGuard
```

### Upgradeable Contract (Core/Governance pattern)
```solidity
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract Name is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    constructor() { _disableInitializers(); }
    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

### Interface File Pattern
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IContractName {
    // ============ Enums ============
    // ============ Structs ============ (slot-packed, comment bytes)
    // ============ Events ============ (indexed id first, indexed addresses next)
    // ============ Errors ============ (no parameters, descriptive names)
    // ============ Core Functions ============
    // ============ View Functions ============
}
```

### Test File Pattern
```solidity
import "forge-std/Test.sol";
import "../contracts/financial/ContractName.sol";
import "../contracts/financial/interfaces/IContractName.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract ContractNameTest is Test {
    // Actors: alice, bob, charlie, treasury (makeAddr)
    // setUp: deploy mocks, deploy contract, mint tokens, approve max
    // Helpers: _helperName() with leading underscore
    // Tests: test_functionName_condition()
}
```

---

## Common Constants
```solidity
uint256 private constant BPS = 10_000;           // basis points denominator
uint256 private constant SECONDS_PER_YEAR = 31_557_600;
uint256 private constant PRECISION = 1e18;
```

---

## CORE CONTRACTS

### CommitRevealAuction
- **Path**: `contracts/core/CommitRevealAuction.sol`
- **Type**: Upgradeable (Initializable + Ownable + ReentrancyGuard)
- **Init**: `initialize(address _owner, address _treasury, address _complianceRegistry)`
- **Key deps**: `IReputationOracle`, `PoolComplianceConfig`, `DeterministicShuffle`, `ProofOfWorkLib`
- **Key functions**: `commitOrder()`, `commitOrderToPool()`, `revealOrder()`, `advancePhase()`, `settleBatch()`, `getCurrentBatchId()`, `getCurrentPhase()`

### VibeSwapCore
- **Path**: `contracts/core/VibeSwapCore.sol`
- **Type**: Upgradeable (UUPS)
- **Init**: `initialize(address _owner, address _auction, address _amm, address _treasury, address _router)`
- **Key deps**: `ICommitRevealAuction`, `IVibeAMM`, `IDAOTreasury`, `IwBAR`, `CircuitBreaker`, `CrossChainRouter`, `SecurityLib`, `ClawbackRegistry`
- **Key functions**: `commitSwap()`, `revealSwap()`, `settleBatch()`, `createPool()`, `getQuote()`

### CircuitBreaker
- **Path**: `contracts/core/CircuitBreaker.sol`
- **Type**: Abstract mixin (OwnableUpgradeable)
- **Breaker types**: `VOLUME_BREAKER`, `PRICE_BREAKER`, `WITHDRAWAL_BREAKER`, `LOSS_BREAKER`, `TRUE_PRICE_BREAKER`
- **Key functions**: `setGlobalPause()`, `emergencyPauseAll()`, `configureBreaker()`, `isOperational()`

### wBAR
- **Path**: `contracts/core/wBAR.sol`
- **Inherits**: `ERC20, Ownable, ReentrancyGuard, IwBAR`
- **Constructor**: `constructor(address _auction, address _vibeSwapCore)`
- **Immutables**: `auction` (ICommitRevealAuction), `vibeSwapCore` (address)
- **Key functions**: `mint()`, `transferPosition()`, `settle()`, `redeem()`, `getPosition()`

---

## AMM CONTRACTS

### VibeAMM
- **Path**: `contracts/amm/VibeAMM.sol`
- **Type**: Upgradeable + CircuitBreaker
- **Init**: `initialize(address _owner, address _vibeSwapCore)`
- **Key functions**: `createPool()`, `addLiquidity()`, `removeLiquidity()`, `swap()`, `executeBatchSwap()`, `quote()`, `getPool()`, `getPoolId()`, `getLPToken()`

### VibeLP
- **Path**: `contracts/amm/VibeLP.sol`
- **Inherits**: `ERC20, Ownable`
- **Constructor**: `constructor(address _token0, address _token1, address _owner)`
- **Key functions**: `mint()`, `burn()`

### VibeLPNFT
- **Path**: `contracts/amm/VibeLPNFT.sol`
- **Inherits**: `ERC721, Ownable, ReentrancyGuard, IVibeLPNFT`
- **Constructor**: `constructor(address _vibeAMM)`
- **Key functions**: `mint()`, `increaseLiquidity()`, `decreaseLiquidity()`, `collect()`, `burn()`, `getPosition()`

### VibePoolFactory
- **Path**: `contracts/amm/VibePoolFactory.sol`
- **Inherits**: `Ownable, ReentrancyGuard`
- **Constructor**: `constructor(address _hookRegistry)` — hookRegistry optional (address(0) ok)
- **Constants**: `DEFAULT_FEE_RATE=5`, `MAX_FEE_RATE=1000`
- **Key structs**: `FactoryPool` (token0/1, curveId, feeRate, reserves, totalLiquidity, curveParams), `CreatePoolParams` (tokenA/B, curveId, feeRate, curveParams, hook, hookFlags)
- **Pool ID**: `keccak256(abi.encodePacked(token0, token1, curveId))` — same pair can have multiple curve types
- **Key functions**: `registerCurve()`, `deregisterCurve()`, `createPool()`, `quoteAmountOut()`, `quoteAmountIn()`, `getPool()`, `getLPToken()`, `getPoolId()`, `getAllPools()`, `getPoolCount()`, `isCurveApproved()`, `getApprovedCurves()`
- **Hook integration**: try/catch on `hookRegistry.attachHook()` — graceful degradation
- **Tests**: Unit (43)

### IPoolCurve (Interface)
- **Path**: `contracts/amm/interfaces/IPoolCurve.sol`
- **Functions**: `curveId()`, `curveName()`, `getAmountOut()`, `getAmountIn()`, `validateParams()`
- **curveParams**: generic `bytes` — each curve decodes its own format

### ConstantProductCurve
- **Path**: `contracts/amm/curves/ConstantProductCurve.sol`
- **Inherits**: `IPoolCurve`
- **curveId**: `keccak256("CONSTANT_PRODUCT")`
- **curveParams**: empty (ignored)
- **Math**: Byte-identical to BatchMath.getAmountOut/getAmountIn

### StableSwapCurve
- **Path**: `contracts/amm/curves/StableSwapCurve.sol`
- **Inherits**: `IPoolCurve`
- **curveId**: `keccak256("STABLE_SWAP")`
- **curveParams**: `abi.encode(uint256 amplificationCoefficient)` — A range [1, 10000]
- **Math**: Curve.fi invariant (n=2), Newton's method, max 255 iterations, 1 wei convergence

---

## FINANCIAL CONTRACTS

### VibeBonds
- **Path**: `contracts/financial/VibeBonds.sol`
- **Inherits**: `ERC1155Supply, Ownable, ReentrancyGuard, IVibeBonds`
- **Constructor**: `constructor(address _julToken)`
- **Immutables**: `julToken` (IERC20)
- **Key functions**: `createSeries()`, `placeBid()`, `claimBonds()`, `claimCoupon()`, `redeemBonds()`

### VibeOptions
- **Path**: `contracts/financial/VibeOptions.sol`
- **Inherits**: `ERC721, Ownable, ReentrancyGuard, IVibeOptions`
- **Constructor**: `constructor(address _amm, address _volatilityOracle)`
- **Immutables**: `amm` (IVibeAMM), `volatilityOracle` (IVolatilityOracle)
- **Key functions**: `writeOption()`, `purchase()`, `exercise()`, `reclaim()`, `cancel()`, `suggestPremium()`

### VibeStream
- **Path**: `contracts/financial/VibeStream.sol`
- **Inherits**: `ERC721, Ownable, ReentrancyGuard, IVibeStream`
- **Constructor**: `constructor()`
- **Key functions**: `createStream()`, `createFundingPool()`, `withdraw()`, `cancelStream()`, `castSignal()`, `withdrawFromPool()`

### VibeCredit
- **Path**: `contracts/financial/VibeCredit.sol`
- **Inherits**: `ERC721, Ownable, ReentrancyGuard, IVibeCredit`
- **Constructor**: `constructor(address _julToken, address _reputationOracle)`
- **Immutables**: `julToken` (IERC20), `reputationOracle` (IReputationOracle)
- **LTV tiers**: 0=0%, 1=25%, 2=50%, 3=75%, 4=90% (+5% JUL bonus)
- **Key functions**: `createCreditLine()`, `borrow()`, `repay()`, `liquidate()`, `reclaimCollateral()`, `closeCreditLine()`, `creditLimit()`, `isLiquidatable()`

### VibeSynth
- **Path**: `contracts/financial/VibeSynth.sol`
- **Inherits**: `ERC721, Ownable, ReentrancyGuard, IVibeSynth`
- **Constructor**: `constructor(address _julToken, address _reputationOracle, address _collateralToken)`
- **Immutables**: `julToken` (IERC20), `reputationOracle` (IReputationOracle), `collateralToken` (IERC20)
- **C-ratio reduction per tier**: T0=0, T1=500, T2=1000, T3=1500, T4=2000 BPS (+500 JUL bonus)
- **Key functions**: `registerSynthAsset()`, `openPosition()`, `mintSynth()`, `burnSynth()`, `addCollateral()`, `withdrawCollateral()`, `closePosition()`, `liquidate()`, `updatePrice()`, `collateralRatio()`, `isLiquidatable()`

### VibeInsurance
- **Path**: `contracts/financial/VibeInsurance.sol`
- **Inherits**: `ERC721, Ownable, ReentrancyGuard, IVibeInsurance`
- **Constructor**: `constructor(address _julToken, address _reputationOracle, address _collateralToken)`
- **Immutables**: `julToken` (IERC20), `reputationOracle` (IReputationOracle), `collateralToken` (IERC20)
- **Premium discount per tier**: T0=0, T1=500, T2=1000, T3=1500, T4=2000 BPS (+500 JUL bonus, capped at 50%)
- **Constants**: `SETTLEMENT_GRACE=30 days`, `KEEPER_TIP=10 ether`
- **Key functions**: `createMarket()`, `resolveMarket()`, `settleMarket()`, `underwrite()`, `withdrawCapital()`, `buyPolicy()`, `claimPayout()`, `effectivePremium()`, `policyPayout()`, `underwriterPayout()`, `availableCapacity()`
- **Tests**: Unit (59), Fuzz (12), Invariant (9)

### VibeRevShare
- **Path**: `contracts/financial/VibeRevShare.sol`
- **Inherits**: `Ownable, ReentrancyGuard, IVibeRevShare`
- **Constructor**: `constructor(address _julToken, address _reputationOracle)`
- **Immutables**: `julToken` (IERC20), `reputationOracle` (IReputationOracle)
- **Pattern**: Synthetix accumulator (rewardPerTokenStored), ERC-20 staking
- **Dependencies**: ReputationOracle, JUL token
- **Key functions**: `stake()`, `unstake()`, `claimRewards()`, `notifyRewardAmount()`, `earned()`, `rewardPerToken()`
- **Tests**: Unit (46), Fuzz (10), Invariant (7)

---

## GOVERNANCE CONTRACTS

### DAOTreasury
- **Path**: `contracts/governance/DAOTreasury.sol`
- **Type**: Upgradeable
- **Init**: `initialize(address _owner, address _vibeAMM)`
- **Key functions**: `receiveAuctionProceeds()`, `receiveProtocolFees()`, `requestWithdrawal()`, `executeWithdrawal()`, `addLP()`, `removeLP()`

### TreasuryStabilizer
- **Path**: `contracts/governance/TreasuryStabilizer.sol`
- **Type**: Upgradeable (UUPS + Pausable)
- **Init**: `initialize(address _owner, address _vibeAMM, address _daoTreasury, address _volatilityOracle)`
- **Key functions**: `assessMarket()`, `deployBackstop()`, `recallBackstop()`, `setTokenConfig()`

### DecentralizedTribunal
- **Path**: `contracts/governance/DecentralizedTribunal.sol`
- **Type**: Upgradeable (UUPS)
- **Key functions**: `initiateTrial()`, `summonJury()`, `submitEvidence()`, `voteOnVerdict()`, `renderVerdict()`, `appealVerdict()`

### DisputeResolver
- **Path**: `contracts/governance/DisputeResolver.sol`
- **Type**: Upgradeable (UUPS)
- **Key functions**: `fileDispute()`, `submitEvidence()`, `assignArbitrator()`, `renderDecision()`, `appealDispute()`

### AutomatedRegulator
- **Path**: `contracts/governance/AutomatedRegulator.sol`
- **Key functions**: Rule creation, enforcement, violation tracking

---

## INCENTIVES CONTRACTS

### ShapleyDistributor
- **Path**: `contracts/incentives/ShapleyDistributor.sol`
- **Type**: Upgradeable (UUPS)
- **Init**: `initialize(address _owner, address _rewardToken, address _priorityRegistry)`
- **Key functions**: `recordGameEvent()`, `claim()`, `getCurrentEra()`, `getHalvingSchedule()`

### IncentiveController
- **Path**: `contracts/incentives/IncentiveController.sol`
- **Type**: Upgradeable (UUPS)
- **Interfaces**: Defines `IAMMLiquidityQuery` (for pro-rata LP queries against VibeAMM)
- **Init**: `initialize(address _owner, address _vibeAMM, address _vibeSwapCore, address _treasury)`
- **Key functions**: `notifySwapExecuted()`, `notifyLiquidityChange()`, `claimLPRewards()`, `claimAuctionProceeds(poolId)` (pro-rata by LP share), `recordExecution(poolId, trader, expectedMinOut, amountOut)` (wired to SlippageGuaranteeFund), `getPoolIncentiveStats(poolId)` (queries vault ETH balances)
- **Session 29 fixes**: Pro-rata auction proceeds (was first-come-first-served), slippage recording wired, pool stats return real balances

### LoyaltyRewardsManager
- **Path**: `contracts/incentives/LoyaltyRewardsManager.sol`
- **Type**: Upgradeable (UUPS)
- **Init**: `initialize(address _owner, address _incentiveController, address _treasury, address _rewardToken)`
- **Key functions**: `recordLPDeposit()`, `recordLPWithdrawal()`, `claimLoyaltyRewards()`, `getLoyaltyTier()`

### SlippageGuaranteeFund
- **Path**: `contracts/incentives/SlippageGuaranteeFund.sol`
- **Type**: Upgradeable (UUPS)
- **Init**: `initialize(address _owner, address _incentiveController)`
- **Key functions**: `processClaim()`, `claimCompensation()`, `fundReserve()`

### ILProtectionVault, PriorityRegistry, VolatilityInsurancePool
- See respective files in `contracts/incentives/`

---

## COMPLIANCE & IDENTITY

### ComplianceRegistry
- **Path**: `contracts/compliance/ComplianceRegistry.sol`
- **Type**: Upgradeable (UUPS)
- **Enums**: `UserTier` (BLOCKED→EXEMPT), `AccountStatus` (ACTIVE→TERMINATED)
- **Key functions**: `setUserProfile()`, `updateUserKYC()`, `freezeAccount()`, `isAccredited()`, `isInGoodStanding()`

### ClawbackRegistry
- **Path**: `contracts/compliance/ClawbackRegistry.sol`
- **Type**: Upgradeable (UUPS)
- **Init**: `initialize(address _owner, address _federatedConsensus, address _julToken)`
- **Key functions**: `flagWallet()`, `recordTransaction()`, `executeCascade()`, `getWalletTaint()`, `isBlocked()`

### SoulboundIdentity
- **Path**: `contracts/identity/SoulboundIdentity.sol`
- **Type**: Upgradeable (ERC721Upgradeable + UUPS)
- **Key functions**: `createIdentity()`, `addContribution()`, `upvoteContribution()`, `getIdentity()`, `hasIdentity()`

### ContributionDAG
- **Path**: `contracts/identity/ContributionDAG.sol`
- **Inherits**: `IContributionDAG, Ownable, ReentrancyGuard`
- **Constructor**: `constructor(address _soulbound)` — address(0) disables identity check
- **Constants**: `PRECISION=1e18`, `MAX_VOUCH_PER_USER=10`, `MIN_VOUCHES_FOR_TRUSTED=2`, `TRUST_DECAY_PER_HOP=1500` (15% BPS), `MAX_TRUST_HOPS=6`, `HANDSHAKE_COOLDOWN=1 day`, `MAX_FOUNDERS=20`
- **Multipliers**: FOUNDER=30000 (3x), TRUSTED=20000 (2x), PARTIAL_TRUST=15000 (1.5x), UNTRUSTED=5000 (0.5x)
- **Structs**: `Vouch { timestamp, messageHash }`, `Handshake { user1, user2, timestamp }`, `TrustScore { score, hopsFromFounder, isFounder, trustChain }`
- **Key functions**: `addVouch()`, `revokeVouch()`, `recalculateTrustScores()` (BFS, 256-node queue), `getTrustScore()`, `getVotingPowerMultiplier()`, `calculateReferralQuality()`, `calculateDiversityScore()`
- **Referral exclusion**: `mapping(address => bool) public referralExcluded` — excluded addresses get 100% penalty (no referral bonuses)
- **Referral functions**: `setReferralExclusion(address, bool)` (onlyOwner), `isReferralExcluded(address) returns (bool)` (view)
- **Referral event**: `ReferralExclusionSet(address indexed account, bool excluded)`
- **Admin**: `addFounder()`, `removeFounder()`, `setSoulboundIdentity()`, `setReferralExclusion()`
- **Integration**: Reads SoulboundIdentity.hasIdentity() via staticcall; feeds trust multipliers into RewardLedger + ShapleyDistributor
- **Tests**: Unit (41)

### RewardLedger
- **Path**: `contracts/identity/RewardLedger.sol`
- **Inherits**: `IRewardLedger, Ownable, ReentrancyGuard`
- **Constructor**: `constructor(address _rewardToken, address _contributionDAG)` — reverts on zero rewardToken
- **Constants**: `ACTOR_BASE_SHARE=5000` (50% BPS), `CHAIN_DECAY=6000` (60% BPS), `MAX_REWARD_DEPTH=5`, quality weight bounds [0.1, 2.0]
- **Enums**: `EventType { CONTRIBUTION, MECHANISM_DESIGN, CODE, TRADE, REFERRAL, GOVERNANCE }`
- **Structs**: `ValueEvent { eventId, eventType, actor, value, trustChain, timestamp, distributed }`
- **Two modes**: Retroactive (owner-submitted pre-launch) + Active (authorized callers real-time)
- **Key functions**: `recordRetroactiveContribution()`, `finalizeRetroactive()`, `recordValueEvent()`, `distributeEvent()`, `claimRetroactive()`, `claimActive()`
- **Shapley**: 50% actor base, remaining decays 60% per hop, quality-weighted from ContributionDAG, normalized (efficiency axiom)
- **Admin**: `setAuthorizedCaller()`, `setContributionDAG()`, `setRewardToken()`
- **Tests**: Unit (36)

### ContributionYieldTokenizer
- **Path**: `contracts/identity/ContributionYieldTokenizer.sol`
- **Inherits**: `IContributionYieldTokenizer, Ownable, ReentrancyGuard`
- **Constructor**: `constructor(address _rewardToken, address _rewardLedger)` — 2 params (ContributionDAG dependency removed), reverts on zero rewardToken
- **Constants**: `DEFAULT_STALE_DURATION=14 days`, `STALE_DECAY_RATE_BPS=1000`, `MAX_STREAMS_PER_IDEA=10`
- **State**: `_unclaimedRewards` mapping for proper settlement tracking
- **Includes**: `IdeaToken` (ERC20, mint/burn controlled by tokenizer) — deployed per idea
- **Two primitives**:
  - **Idea Token (IT)**: Instant full-value tokenization of an idea. 1:1 with reward tokens. Transferable, never expires.
  - **Execution Stream (ES)**: Free market execution — streams auto-flow, equal share, no gatekeeping. Decays on stale.
- **Design**: Conviction voting REMOVED — free market execution model instead
- **Idea functions**: `createIdea()` (deploys new IdeaToken ERC20), `fundIdea()` (transfers reward tokens, mints IT 1:1)
- **Stream functions**: `proposeExecution()`, `reportMilestone()`, `claimStream()`, `completeStream()`
- **Stale/redirect**: `checkStale()` → STALLED after staleDuration; `redirectStream()` requires IT balance
- **Admin**: `setRewardLedger()`
- **Tests**: Unit (44)

### ContributionAttestor
- **Path**: `contracts/identity/ContributionAttestor.sol`
- **Interface**: `contracts/identity/interfaces/IContributionAttestor.sol`
- **Inherits**: `IContributionAttestor, Ownable, ReentrancyGuard`
- **Purpose**: 3-body contribution attestation governance — cumulative credibility-weighted attestations
- **Constructor**: `constructor(address _contributionDAG, uint256 _acceptanceThreshold, uint256 _claimTTL)`
- **Constants**: `MAX_ATTESTATIONS_PER_CLAIM=50`, `MIN_CLAIM_TTL=1 day`
- **Enums**: `ClaimStatus { Pending, Accepted, Contested, Rejected, Expired }`, `ContributionType { Code, Design, Research, Community, Marketing, Security, Governance, Inspiration, Other }`
- **Events**: ClaimSubmitted, ClaimAttested, ClaimContested, ClaimAccepted, ClaimRejected, ClaimExpired
- **Key functions**: `submitClaim()`, `attest()`, `contest()`, `checkExpiry()`, `getCumulativeWeight()`, `previewAttestationWeight()`, `getClaim()`, `getAttestations()`, `hasAttested()`, `getClaimsByContributor()`, `getClaimCount()`
- **Admin**: `setAcceptanceThreshold()`, `setClaimTTL()`, `rejectClaim()`, `setContributionDAG()`
- **Integration**: Reads ContributionDAG.getTrustScore() for credibility-weighted attestation
- **Tests**: Unit (48), Fuzz (12), Invariant (8)

### VibeCode
- **Path**: `contracts/identity/VibeCode.sol`
- **Interface**: `contracts/identity/interfaces/IVibeCode.sol`
- **Inherits**: `IVibeCode, Ownable`
- **Purpose**: Deterministic identity fingerprint from on-chain contributions — visual + numeric reputation encoding
- **Constructor**: `constructor()` — `Ownable(msg.sender)`, no args
- **Constants**: `MAX_SCORE=10000`, `BUILDER_MAX=3000`, `FUNDER_MAX=2000`, `IDEATOR_MAX=1500`, `COMMUNITY_MAX=2000`, `LONGEVITY_MAX=1500`, `PRECISION=1e18`
- **State**: `_profiles` mapping, `_categoryValues` mapping, `authorizedSources` mapping, `activeProfileCount`
- **Enums** (interface): `ContributionCategory { CODE, REVIEW, IDEA, EXECUTION, ATTESTATION, GOVERNANCE, COMMUNITY, DESIGN }`
- **Structs** (interface): `VibeProfile` (score breakdown + metadata), `VisualSeed` (deterministic visual identity data)
- **Events**: VibeCodeRefreshed, ContributionRecorded, SourceAuthorized, ExternalSourceUpdated
- **Errors**: ZeroAddress, UnauthorizedSource, NoProfile, ZeroValue
- **Core functions**: `recordContribution(user, category, value, evidenceHash)`, `refreshVibeCode(user)`
- **View functions**: `getVibeCode(user)`, `getProfile(user)`, `getReputationScore(user)`, `getVisualSeed(user)`, `getDisplayCode(user)`, `getCategoryValue(user, category)`, `isActive(user)`, `getActiveProfileCount()`
- **Admin**: `setAuthorizedSource(source, authorized)`
- **Internal**: `_computeBuilderScore()`, `_computeFunderScore()`, `_computeIdeatorScore()`, `_computeCommunityScore()`, `_computeLongevityScore()`, `_log2()`

### AgentRegistry
- **Path**: `contracts/identity/AgentRegistry.sol`
- **Interface**: `contracts/identity/interfaces/IAgentRegistry.sol`
- **Inherits**: `IAgentRegistry, OwnableUpgradeable, UUPSUpgradeable`
- **Type**: Upgradeable (UUPS) — ERC-8004 compatible AI agent registry (PsiNet x VibeSwap merge)
- **Init**: `initialize()` — sets owner to msg.sender, _nextAgentId=1
- **Constants**: `MAX_CAPABILITIES=7`, `MAX_DELEGATIONS_PER_AGENT=10`, `MAX_NAME_LENGTH=64`
- **Enums** (interface): `AgentPlatform { CLAUDE, CHATGPT, GEMINI, LLAMA, CUSTOM, MULTI }`, `AgentStatus { ACTIVE, INACTIVE, SUSPENDED, MIGRATING }`, `CapabilityType { TRADE, GOVERN, ATTEST, MODERATE, ANALYZE, CREATE, DELEGATE }`
- **Structs** (interface): `AgentIdentity` (agentId, name, platform, status, operator, creator, contextRoot, modelHash, registeredAt, lastActiveAt, totalInteractions), `Capability` (capType, grantedBy, grantedAt, expiresAt, revoked), `Delegation` (fromAgentId, toAgentId, capType, delegatedAt, expiresAt, revoked)
- **Events**: AgentRegistered, AgentStatusChanged, AgentOperatorChanged, ContextRootUpdated, CapabilityGranted, CapabilityRevoked, CapabilityDelegated, DelegationRevoked, AgentInteraction, AgentVouchedByHuman
- **Errors**: AgentNotFound, AgentAlreadyExists, NotAgentOperator, NotAgentCreator, AgentNotActive, AgentSuspended, CapabilityNotGranted, CapabilityExpired, CapabilityAlreadyGranted, DelegationNotAllowed, DelegateCapabilityRequired, SelfDelegation, NameTaken, EmptyName, ZeroAddress, InvalidPlatform
- **Registration**: `registerAgent(name, platform, operator, modelHash)`, `transferOperator(agentId, newOperator)`, `setAgentStatus(agentId, status)`, `updateContextRoot(agentId, newRoot)`, `recordInteraction(agentId, interactionHash)`
- **Capabilities**: `grantCapability(agentId, capType, expiresAt)`, `revokeCapability(agentId, capType)`, `delegateCapability(fromAgentId, toAgentId, capType, expiresAt)`, `revokeDelegation(fromAgentId, toAgentId, capType)`
- **Trust bridge**: `vouchForAgent(agentId, messageHash)` — human with SoulboundIdentity vouches for agent, bridges to ContributionDAG
- **View**: `getAgent(agentId)`, `getAgentByOperator(operator)`, `isAgent(addr)`, `hasCapability(agentId, capType)` (checks direct + delegated), `getCapabilities(agentId)`, `getDelegationsFrom(agentId)`, `getDelegationsTo(agentId)`, `totalAgents()`, `getAgentVibeCode(agentId)`, `hasIdentity(addr)` (checks agent OR SoulboundIdentity), `getHumanVouchers(agentId)`
- **Admin**: `setVibeCode(address)`, `setContributionDAG(address)`, `setSoulboundIdentity(address)`, `setAuthorizedRecorder(recorder, authorized)`
- **Integration**: Reads SoulboundIdentity.hasIdentity() via staticcall for vouch verification; bridges human→agent trust through ContributionDAG.addVouch(); reads VibeCode.getVibeCode() for agent reputation
- **Design**: AI agents are NOT soulbound — transferable (operator handoff), delegatable capabilities, deactivatable. Humans = SoulboundIdentity, Agents = AgentRegistry, both feed VibeCode + ContributionDAG

### ContextAnchor
- **Path**: `contracts/identity/ContextAnchor.sol`
- **Interface**: `contracts/identity/interfaces/IContextAnchor.sol`
- **Inherits**: `IContextAnchor, OwnableUpgradeable, UUPSUpgradeable`
- **Type**: Upgradeable (UUPS) — on-chain anchor for IPFS context graphs
- **Init**: `initialize(address _agentRegistry)` — sets owner, _graphNonce=1, _mergeNonce=1
- **Constants**: `MAX_ACCESS_GRANTS=50`, `MAX_MERGE_HISTORY=100`
- **Enums** (interface): `GraphType { CONVERSATION, KNOWLEDGE, DECISION, COLLABORATION, ARCHIVE }`, `StorageBackend { IPFS, ARWEAVE, HYBRID }`
- **Structs** (interface): `ContextGraph` (graphId, ownerAgentId, ownerAddress, graphType, backend, merkleRoot, contentCID, nodeCount, edgeCount, createdAt, lastUpdatedAt, version), `MergeRecord` (mergeId, sourceGraphId, targetGraphId, resultRoot, mergedBy, timestamp, nodesAdded, conflictsResolved), `AccessGrant` (grantee, granteeAgentId, grantedAt, expiresAt, canMerge, revoked)
- **Events**: GraphCreated, GraphUpdated, GraphMerged, AccessGranted, AccessRevoked, GraphArchived, ContextContributionRecorded
- **Errors**: GraphNotFound, NotGraphOwner, GraphAlreadyExists, AccessDenied, MergeNotAllowed, InvalidMerkleProof, ZeroRoot, ZeroCID, GraphIsArchived
- **Core**: `createGraph(ownerAgentId, graphType, backend, merkleRoot, contentCID, nodeCount, edgeCount)`, `updateGraph(graphId, newMerkleRoot, newContentCID, newNodeCount, newEdgeCount)`, `mergeGraphs(sourceGraphId, targetGraphId, resultRoot, resultCID, nodesAdded, conflictsResolved)`, `archiveGraph(graphId, arweaveTxId)`
- **Access control**: `grantAccess(graphId, grantee, granteeAgentId, canMerge, expiresAt)`, `revokeAccess(graphId, grantee)`
- **Verification**: `verifyContextNode(graphId, nodeHash, proof)` — standard Merkle proof (sorted pair hashing)
- **View**: `getGraph(graphId)`, `getGraphsByAgent(agentId)`, `getGraphsByOwner(ownerAddr)`, `getMergeHistory(graphId)`, `hasAccess(graphId, user)`, `getAccessGrants(graphId)`, `totalGraphs()`
- **Admin**: `setAgentRegistry(address)`
- **Design**: O(1) on-chain storage (Merkle roots only), O(log n) verification. CRDT-compatible merges. Graphs owned by agents (via AgentRegistry) or humans (direct address). Off-chain data on IPFS/Arweave.

### PairwiseVerifier
- **Path**: `contracts/identity/PairwiseVerifier.sol`
- **Interface**: `contracts/identity/interfaces/IPairwiseVerifier.sol`
- **Inherits**: `IPairwiseVerifier, OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable`
- **Type**: Upgradeable (UUPS) — CRPC protocol for verifying non-deterministic AI outputs
- **Init**: `initialize(address _agentRegistry)` — sets owner, _taskNonce=1, _submissionNonce=1, _comparisonNonce=1
- **Constants**: `BPS=10_000`, `DEFAULT_VALIDATOR_REWARD_BPS=3000` (30%), `MIN_SUBMISSIONS=2`, `MAX_SUBMISSIONS=20`, `MIN_COMPARISONS_PER_PAIR=3`, `SLASH_RATE_BPS=5000` (50%)
- **Enums** (interface): `TaskPhase { WORK_COMMIT, WORK_REVEAL, COMPARE_COMMIT, COMPARE_REVEAL, SETTLED }`, `CompareChoice { NONE, FIRST, SECOND, EQUIVALENT }`
- **Structs** (interface): `VerificationTask` (taskId, description, specHash, creator, rewardPool, validatorRewardBps, phase, workCommitEnd, workRevealEnd, compareCommitEnd, compareRevealEnd, submissionCount, comparisonCount, settled), `WorkSubmission` (submissionId, taskId, worker, commitHash, workHash, secret, revealed, winsCount, lossCount, tieCount, reward), `PairwiseComparison` (comparisonId, taskId, validator, submissionA, submissionB, commitHash, choice, secret, revealed, consensusAligned)
- **Events**: TaskCreated, WorkCommitted, WorkRevealed, ComparisonCommitted, ComparisonRevealed, TaskPhaseAdvanced, TaskSettled, WorkSlashed, ValidatorRewarded
- **Errors**: TaskNotFound, WrongPhase(expected, actual), AlreadySubmitted, AlreadyRevealed, InvalidPreimage, SubmissionNotFound, ComparisonNotFound, NotEnoughSubmissions, NotEnoughComparisons, TaskAlreadySettled, InsufficientReward, ZeroAddress, SelfComparison, InvalidPair
- **Task management**: `createTask(description, specHash, validatorRewardBps, workCommitDuration, workRevealDuration, compareCommitDuration, compareRevealDuration) payable`, `advancePhase(taskId)` — permissionless, time-gated
- **Work phase**: `commitWork(taskId, commitHash)`, `revealWork(taskId, submissionId, workHash, secret)` — commit-reveal prevents copying
- **Compare phase**: `commitComparison(taskId, submissionA, submissionB, commitHash)`, `revealComparison(comparisonId, choice, secret)` — commit-reveal prevents lying
- **Settlement**: `settle(taskId)` — tallies wins/losses, distributes worker rewards proportional to win score (wins*2 + ties*1), validator rewards to consensus-aligned validators; `claimReward(taskId)` — pull pattern
- **View**: `getTask(taskId)`, `getSubmission(submissionId)`, `getComparison(comparisonId)`, `getTaskSubmissions(taskId)`, `getTaskComparisons(taskId)`, `getWorkerReward(taskId, worker)`, `getValidatorReward(taskId, validator)`, `totalTasks()`
- **Admin**: `setAgentRegistry(address)`
- **Internal**: `_pairHash(a, b)` — canonical order-independent pair hash; `_markConsensusAligned(taskId, comparisonIds)` — majority vote per pair determines consensus
- **Design**: 4-phase commit-reveal protocol — ReputationOracle rates WHO is trustworthy, PairwiseVerifier rates WHICH output is better. Workers get 70% of pool, validators get 30%. Consensus-aligned validators rewarded equally.

---

## ORACLE CONTRACTS

### ReputationOracle
- **Path**: `contracts/oracle/ReputationOracle.sol`
- **Type**: Upgradeable (UUPS)
- **Init**: `initialize(address _owner, address _soulboundIdentity, address _shapleyDistributor)`
- **Interface**: `IReputationOracle` at `contracts/oracle/IReputationOracle.sol`
- **Key functions**: `getTrustTier(address) → uint8`, `getTrustScore(address) → uint256`, `isEligible(address, uint8) → bool`
- **Tier thresholds**: T1=2000, T2=4000, T3=6000, T4=8000 (score in BPS out of 10000)

### TruePriceOracle
- **Path**: `contracts/oracles/TruePriceOracle.sol`
- **Type**: Upgradeable (UUPS)
- **Key functions**: `updateTruePrice()`, `getTruePrice()`, `getPriceHistory()`

### VolatilityOracle
- **Path**: `contracts/oracles/VolatilityOracle.sol`
- **Interface**: `IVolatilityOracle` at `contracts/incentives/interfaces/IVolatilityOracle.sol`

---

## COMMUNITY CONTRACTS

### IdeaMarketplace
- **Path**: `contracts/community/IdeaMarketplace.sol` (814 lines)
- **Interface**: `contracts/core/interfaces/IIdeaMarketplace.sol` (222 lines)
- **Inherits**: `IIdeaMarketplace, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable`
- **Type**: Upgradeable (UUPS) — Freedom's Idea Marketplace for non-coder idea submission + builder execution + Shapley reward splits
- **Init**: `initialize(address _vibeToken, address _contributionDAG, address _treasury)`
- **Imports**:
  ```solidity
  import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
  import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
  import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
  import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
  import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
  import "../core/interfaces/IIdeaMarketplace.sol";
  import "../identity/interfaces/IContributionDAG.sol";
  ```
- **Constants**: `BPS_PRECISION=10000`, `MAX_SCORE=10`, `AUTO_REJECT_THRESHOLD=15`, `AUTO_APPROVE_THRESHOLD=24`, `MAX_TOTAL_SCORE=30`
- **Enums** (interface):
  - `IdeaStatus { OPEN, CLAIMED, IN_PROGRESS, REVIEW, COMPLETED, REJECTED, DISPUTED }`
  - `IdeaCategory { UX, PROTOCOL, TOOLING, GROWTH, SECURITY }`
- **Structs** (interface):
  - `Idea { id, author, title, descriptionHash, category, bountyAmount, status, builder, createdAt, claimedAt, completedAt, score, proofHash }`
  - `IdeaScore { feasibility, impact, novelty }` (each uint8, 0-10)
- **Key state**:
  - `IERC20 public vibeToken`
  - `IContributionDAG public contributionDAG`
  - `uint256 public minIdeaStake` (default 100e18)
  - `uint256 public builderCollateralBps` (default 1000 = 10%)
  - `uint256 public buildDeadline` (default 7 days)
  - `uint256 public defaultIdeatorShareBps` (default 4000 = 40%)
  - `uint256 public defaultBuilderShareBps` (default 6000 = 60%)
  - `uint256 public minScorers` (default 3)
  - `mapping(address => bool) public scorers`
  - `mapping(uint256 => uint256) public ideatorShareOverride`
  - `mapping(uint256 => uint256) public builderCollateral`
  - `mapping(uint256 => uint256) public ideatorStake`
  - `address public treasury`
- **Core functions**:
  - `submitIdea(string title, bytes32 descriptionHash, IdeaCategory category) returns (uint256 ideaId)` — stakes VIBE, checks referral exclusion
  - `scoreIdea(uint256 ideaId, uint8 feasibility, uint8 impact, uint8 novelty)` — onlyScorer, auto-threshold after minScorers
  - `fundBounty(uint256 ideaId, uint256 amount)` — anyone can fund
  - `claimBounty(uint256 ideaId)` — builder stakes collateral, gets exclusive rights + deadline
  - `startWork(uint256 ideaId)` — CLAIMED -> IN_PROGRESS
  - `submitWork(uint256 ideaId, bytes32 proofHash)` — must be within deadline
  - `approveWork(uint256 ideaId)` — onlyOwner, Shapley split + return collateral + return stake
  - `disputeWork(uint256 ideaId, bytes32 reasonHash)` — ideator or builder
  - `cancelClaim(uint256 ideaId)` — builder loses collateral, idea reopens
  - `reclaimExpired(uint256 ideaId)` — anyone, after deadline passed
  - `resolveDispute(uint256 ideaId, bool approve)` — onlyOwner, approve or reopen
- **View functions**: `getIdea()`, `getIdeasByStatus(status, offset, limit)`, `getIdeasByCategory(category, offset, limit)`, `getIdeasByAuthor(author)`, `getIdeasByBuilder(builder)`, `getDeadline(ideaId)`, `totalIdeas()`, `hasScored(ideaId, scorer)`, `getScorerCount(ideaId)`, `getScore(ideaId, scorer)`
- **Admin functions**: `setScorer(address, bool)`, `setMinIdeaStake(uint256)`, `setBuilderCollateralBps(uint256)`, `setBuildDeadline(uint256)`, `setDefaultSplit(uint256, uint256)`, `setIdeaSplit(uint256, uint256)`, `setMinScorers(uint256)`, `setTreasury(address)`, `setContributionDAG(address)`
- **Events**: `IdeaSubmitted(ideaId, author, category, title, bountyAmount)`, `IdeaScored(ideaId, scorer, feasibility, impact, novelty, totalScore)`, `IdeaAutoApproved(ideaId, totalScore)`, `IdeaAutoRejected(ideaId, totalScore)`, `BountyClaimed(ideaId, builder, collateralStaked, deadline)`, `WorkSubmitted(ideaId, builder, proofHash)`, `WorkApproved(ideaId, builder, ideatorReward, builderReward)`, `IdeaDisputed(ideaId, disputedBy, reasonHash)`, `ClaimCancelled(ideaId, builder, collateralSlashed)`, `ScorerUpdated(scorer, authorized)`, `BountyFunded(ideaId, funder, amount)`
- **Errors**: `IdeaNotFound`, `InvalidStatus`, `NotAuthor`, `NotBuilder`, `NotScorer`, `AlreadyScored`, `AlreadyClaimed`, `DeadlineExpired`, `DeadlineNotExpired`, `InsufficientStake`, `InsufficientCollateral`, `ReferralExcluded`, `InvalidScore`, `ZeroAddress`, `EmptyTitle`, `SelfClaim`
- **Integration**: Reads `ContributionDAG.isReferralExcluded()` for anti-sybil checks on submit + claim; uses VIBE token (IERC20) for staking and bounties
- **Flow**: Submit (stake) -> Score (auto-threshold) -> Fund -> Claim (collateral) -> Build -> Submit proof -> Approve (Shapley split 40/60)

---

## MESSAGING

### CrossChainRouter
- **Path**: `contracts/messaging/CrossChainRouter.sol`
- **Type**: Upgradeable (LayerZero V2 OApp)
- **Init**: `initialize(address _owner, address _vibeSwapCore)`
- **Key functions**: `sendCommit()`, `sendReveal()`, `lzReceive()`

---

## MONETARY

### Joule (JUL)
- **Path**: `contracts/monetary/Joule.sol`
- **Inherits**: `Ownable, ReentrancyGuard, IJoule`
- **Constructor**: `constructor()`
- **Type**: Custom ERC-20 with PoW mining + rebase
- **Key functions**: `mine()`, `claimMiningRewards()`, `rebase()`, standard ERC-20

---

## QUANTUM

### QuantumGuard
- **Path**: `contracts/quantum/QuantumGuard.sol`
- **Type**: Abstract mixin
- **Key functions**: `registerQuantumKey()`, `rotateQuantumKey()`, `verifyQuantumAuth()`

### LamportLib
- **Path**: `contracts/quantum/LamportLib.sol`
- **Type**: Library — Lamport signature verification

---

## KEY LIBRARIES

| Library | Path | Key Functions |
|---------|------|--------------|
| DeterministicShuffle | `contracts/libraries/DeterministicShuffle.sol` | `shuffle()` — Fisher-Yates |
| BatchMath | `contracts/libraries/BatchMath.sol` | Batch arithmetic |
| TWAPOracle | `contracts/libraries/TWAPOracle.sol` | Time-weighted pricing |
| VWAPOracle | `contracts/libraries/VWAPOracle.sol` | Volume-weighted pricing |
| SecurityLib | `contracts/libraries/SecurityLib.sol` | Rate limiting, security checks |
| ProofOfWorkLib | `contracts/libraries/ProofOfWorkLib.sol` | PoW validation |
| LiquidityProtection | `contracts/libraries/LiquidityProtection.sol` | IL protection math |
| FibonacciScaling | `contracts/libraries/FibonacciScaling.sol` | Fibonacci scaling |
| PairwiseFairness | `contracts/libraries/PairwiseFairness.sol` | Comparison fairness |

---

## PROTOCOL/FRAMEWORK CONTRACTS (VSOS)

### VibeHookRegistry
- **Path**: `contracts/hooks/VibeHookRegistry.sol`
- **Inherits**: `Ownable, ReentrancyGuard`
- **Key functions**: `attachHook()`, `detachHook()`, `updateHookFlags()`, `executeHook()`, `setPoolOwner()`
- **Tests**: Unit + Fuzz + Invariant

### VibePluginRegistry
- **Path**: `contracts/governance/VibePluginRegistry.sol`
- **Inherits**: `Ownable, ReentrancyGuard, IVibePluginRegistry`
- **Lifecycle**: PROPOSED → APPROVED → (grace period) → ACTIVE → DEPRECATED/DEACTIVATED
- **Tests**: Unit + Fuzz + Invariant

### VibeKeeperNetwork
- **Path**: `contracts/governance/VibeKeeperNetwork.sol`
- **Tests**: Unit + Fuzz + Invariant

### VibeTimelock
- **Path**: `contracts/governance/VibeTimelock.sol`
- **Tests**: Unit + Fuzz + Invariant

### VibeForwarder
- **Path**: `contracts/metatx/VibeForwarder.sol`
- **Type**: EIP-2771 meta-transaction forwarder
- **Tests**: Unit + Fuzz + Invariant

### VibeSmartWallet
- **Path**: `contracts/account/VibeSmartWallet.sol`
- **Type**: ERC-4337 account abstraction
- **Tests**: Unit + Fuzz + Invariant

### VibeVersionRouter
- **Path**: `contracts/proxy/VibeVersionRouter.sol`
- **Tests**: Unit + Fuzz + Invariant

### VibeIntentRouter
- **Path**: `contracts/framework/VibeIntentRouter.sol`
- **Inherits**: `Ownable, ReentrancyGuard, IVibeIntentRouter`
- **Constructor**: `constructor(address _vibeAMM, address _auction, address _crossChainRouter, address _poolFactory)`
- **State**: `routeEnabled` mapping (4 paths), `pendingIntents` mapping, venue addresses, `intentNonce`
- **Routing**: Queries AMM/Factory/Auction/CrossChain, sorts by `expectedOut` descending, executes best
- **AMM**: Uses low-level `call` for `swap()` (not in IVibeAMM interface)
- **Factory**: Uses low-level `staticcall` for `quoteAmountOut()` and `getPoolId()`
- **Auction**: Stores pending intent for later reveal via `revealPendingIntent()`
- **Key functions**: `submitIntent()`, `quoteIntent()`, `cancelIntent()`, `revealPendingIntent()`, `setRouteEnabled()`, `setVibeAMM()`, `setAuction()`, `setCrossChainRouter()`, `setPoolFactory()`
- **Tests**: Unit (29), Fuzz (8), Invariant (5)

### VibeProtocolOwnedLiquidity
- **Path**: `contracts/framework/VibeProtocolOwnedLiquidity.sol`
- **Inherits**: `Ownable, ReentrancyGuard, IVibeProtocolOwnedLiquidity`
- **Constructor**: `constructor(address _vibeAMM, address _daoTreasury, address _revShare, address _revenueToken)`
- **State**: `positions` mapping, `positionIds` array, `positionExists` mapping, `activePositionCount`, `maxPositions` (default 50)
- **Key functions**: `deployLiquidity()`, `withdrawLiquidity()`, `collectFees()`, `collectAllFees()`, `rebalance()`, `emergencyWithdrawAll()`, `recoverToken()`, `setMaxPositions()`
- **Pattern**: Uses `safeIncreaseAllowance` for AMM approvals (not pre-approve with max)
- **Fee collection**: v1 emits event only (fees realized on withdrawal), deposits to RevShare if configured
- **Tests**: Unit (37), Fuzz (7), Invariant (6)

---

## ALL INTERFACE PATHS (for imports)

```solidity
// Core
import "../core/interfaces/ICommitRevealAuction.sol";
import "../core/interfaces/IVibeAMM.sol";
import "../core/interfaces/IDAOTreasury.sol";
import "../core/interfaces/IwBAR.sol";

// AMM
import "../amm/interfaces/IVibeLPNFT.sol";
import "../amm/interfaces/IPoolCurve.sol";

// Financial
import "./interfaces/IVibeBonds.sol";
import "./interfaces/IVibeOptions.sol";
import "./interfaces/IVibeStream.sol";
import "./interfaces/IVibeCredit.sol";
import "./interfaces/IVibeSynth.sol";
import "./interfaces/IVibeInsurance.sol";
import "./interfaces/IVibeRevShare.sol";

// Governance
import "../governance/interfaces/ITreasuryStabilizer.sol";
import "../governance/interfaces/IVibeTimelock.sol";
import "../governance/interfaces/IVibeKeeperNetwork.sol";
import "../governance/interfaces/IVibePluginRegistry.sol";

// Incentives
import "../incentives/interfaces/IIncentiveController.sol";
import "../incentives/interfaces/IShapleyDistributor.sol";
import "../incentives/interfaces/ILoyaltyRewardsManager.sol";
import "../incentives/interfaces/ISlippageGuaranteeFund.sol";
import "../incentives/interfaces/IVolatilityOracle.sol";
import "../incentives/interfaces/IILProtectionVault.sol";

// Oracle
import "../oracle/IReputationOracle.sol";
import "../oracles/interfaces/ITruePriceOracle.sol";
import "../oracles/interfaces/IStablecoinFlowRegistry.sol";

// Hooks
import "../hooks/interfaces/IVibeHookRegistry.sol";
import "../hooks/interfaces/IVibeHook.sol";

// Account / MetaTx / Proxy
import "../account/interfaces/IVibeSmartWallet.sol";
import "../metatx/interfaces/IVibeForwarder.sol";
import "../proxy/interfaces/IVibeVersionRouter.sol";

// Framework
import "../framework/interfaces/IVibeIntentRouter.sol";
import "../framework/interfaces/IVibeProtocolOwnedLiquidity.sol";

// Identity
import "../identity/interfaces/IContributionDAG.sol";
import "../identity/interfaces/IRewardLedger.sol";
import "../identity/interfaces/IContributionYieldTokenizer.sol";
import "../identity/interfaces/IContributionAttestor.sol";
import "../identity/interfaces/IVibeCode.sol";
import "../identity/interfaces/IAgentRegistry.sol";
import "../identity/interfaces/IContextAnchor.sol";
import "../identity/interfaces/IPairwiseVerifier.sol";

// Community
import "../core/interfaces/IIdeaMarketplace.sol";

// Monetary
import "../monetary/interfaces/IJoule.sol";
```

---

## CKB RUST CRATES (Nervos Cell Model Port)

> **Purpose**: Quick-reference for all CKB Rust crate APIs — lock/type scripts, math libraries, SDK.
> **VM**: CKB-VM (RISC-V) — Rust compiled to `riscv64imac-unknown-none-elf`
> **Workspace**: `ckb/Cargo.toml` — 13 implementation crates + 1 test crate
> **Tests**: 167 total (59 in test crate + 108 inline across library/script crates)
> **Last updated**: 2026-02-18 (CKB Phase 7 — all tests green)

---

### vibeswap-math (Library)
- **Path**: `ckb/lib/vibeswap-math/src/lib.rs`
- **Purpose**: Port of BatchMath, DeterministicShuffle, TWAPOracle from Solidity + 256-bit wide arithmetic
- **Constants**: `PRECISION=1e18`, `MAX_ITERATIONS=100`, `BPS_DENOMINATOR=10_000`, Fibonacci ratios (PHI, FIB_236..FIB_786)
- **Error**: `MathError { InvalidReserves, InsufficientInput, InsufficientLiquidity, InvalidAmounts, InsufficientInitialLiquidity, Overflow, PositionOutOfBounds }`

**Module: batch_math**
- **Struct**: `Order { amount: u128, limit_price: u128 }`
- `calculate_clearing_price(&[Order], &[Order], u128, u128) -> Result<(u128, u128), MathError>` — binary search clearing
- `get_amount_out(amount_in, reserve_in, reserve_out, fee_rate_bps) -> Result<u128, MathError>`
- `get_amount_in(amount_out, reserve_in, reserve_out, fee_rate_bps) -> Result<u128, MathError>`
- `calculate_optimal_liquidity(amount0, amount1, reserve0, reserve1) -> Result<(u128, u128), MathError>`
- `calculate_liquidity(amount0, amount1, reserve0, reserve1, total_supply) -> Result<u128, MathError>`
- `calculate_fees(amount, fee_rate_bps, protocol_share_bps) -> (u128, u128)`
- `apply_golden_ratio_damping(value, target, alpha) -> u128`
- `golden_ratio_mean(a, b) -> u128`

**Module: shuffle**
- `generate_seed(&[[u8; 32]]) -> [u8; 32]` — XOR of secrets
- `generate_seed_secure(&[[u8; 32]], &[u8; 32], u64) -> [u8; 32]` — XOR + entropy + batch_id
- `shuffle_indices(length, &[u8; 32]) -> Vec<usize>` — Fisher-Yates
- `get_shuffled_index(index, length, &[u8; 32]) -> Result<usize, MathError>`
- `verify_shuffle(length, &[usize], &[u8; 32]) -> bool`
- `partition_and_shuffle(buy_count, sell_count, &[u8; 32]) -> Vec<usize>`

**Module: twap**
- **Structs**: `Observation { block_number, price_cumulative }`, `OracleState { observations, index, cardinality, cardinality_next }`
- `OracleState::new(cardinality) -> Self`
- `OracleState::initialize(&mut self, price, block_number)`
- `OracleState::write(&mut self, price, block_number)`
- `OracleState::consult(&self, period, current_block) -> Result<u128, MathError>`

**Top-level (wide arithmetic)**
- `sqrt(x: u128) -> u128` — Newton's method (fixed: `x/2+1` not `(x+1)/2` for u128::MAX)
- `wide_mul(a, b) -> (u128, u128)` — 256-bit multiplication
- `mul_cmp(a, b, c, d) -> Ordering` — compare a*b vs c*d without overflow
- `sqrt_product(a, b) -> u128` — sqrt(a*b) via wide_mul
- `mul_div(a, b, c) -> u128` — (a*b)/c via wide arithmetic

---

### mmr (Merkle Mountain Range)
- **Path**: `ckb/lib/mmr/src/lib.rs`
- **Purpose**: Recursive MMR for commit accumulation — O(log n) proofs, append-only
- **Structs**:
  - `MMR { leaf_count, peaks, nodes, size }` — the accumulator
  - `MMRProof { leaf_index, leaf_hash, siblings, peaks, leaf_count }` — membership proof
- `MMR::new() -> Self`
- `MMR::root(&self) -> [u8; 32]`
- `MMR::append(&mut self, data: &[u8]) -> u64`
- `MMR::append_hash(&mut self, hash: [u8; 32]) -> u64`
- `MMR::generate_proof(&self, leaf_index) -> Option<MMRProof>`
- `MMR::peak_count(&self) -> u32`
- `verify_proof(&MMRProof, &[u8; 32]) -> bool`
- `compute_root_from_peaks(&[[u8; 32]], leaf_count) -> [u8; 32]`
- `hash_leaf(data: &[u8]) -> [u8; 32]`, `hash_branch(left, right) -> [u8; 32]`
- `compress_roots(roots: &[[u8; 32]]) -> [u8; 32]`

---

### pow (Proof-of-Work)
- **Path**: `ckb/lib/pow/src/lib.rs`
- **Purpose**: SHA-256 PoW verification, difficulty adjustment, mining (std feature)
- **Constants**: `BASE_DIFFICULTY=8`, `MAX_DIFFICULTY=255`, `TARGET_TRANSITION_BLOCKS=5`, `ADJUSTMENT_WINDOW=10`, `MAX_ADJUSTMENT_FACTOR=4`
- **Struct**: `PoWProof { challenge: [u8; 32], nonce: [u8; 32] }`
- `verify(&PoWProof, difficulty) -> bool`
- `verify_and_get_difficulty(&PoWProof) -> u8`
- `compute_hash(challenge, nonce) -> [u8; 32]`
- `count_leading_zero_bits(hash) -> u8`
- `adjust_difficulty(current, actual_blocks, target_blocks) -> u8`
- `difficulty_to_target(difficulty) -> [u8; 32]`
- `meets_target(hash, target) -> bool`
- `generate_challenge(pair_id, batch_id, prev_state_hash) -> [u8; 32]`
- `generate_challenge_with_window(pair_id, batch_id, prev_state_hash, window_start, window_end) -> [u8; 32]`
- `difficulty_to_value(difficulty, base_reward) -> u64`
- `difficulty_to_fee_discount(difficulty, base_fee) -> u64`
- `estimate_hashes(difficulty) -> u64`
- `mine(challenge, difficulty, max_iterations) -> Option<[u8; 32]>` — **std feature only**

---

### vibeswap-types (Shared Types)
- **Path**: `ckb/lib/types/src/lib.rs`
- **Purpose**: Cell data structures with little-endian binary serialization (no molecule dependency)
- **Phase constants**: `PHASE_COMMIT=0`, `PHASE_REVEAL=1`, `PHASE_SETTLING=2`, `PHASE_SETTLED=3`
- **Order types**: `ORDER_BUY=0`, `ORDER_SELL=1`
- **Config defaults**: `DEFAULT_COMMIT_WINDOW_BLOCKS=40`, `DEFAULT_REVEAL_WINDOW_BLOCKS=10`, `DEFAULT_SLASH_RATE_BPS=5000`, `DEFAULT_FEE_RATE_BPS=5`, `DEFAULT_MIN_POW_DIFFICULTY=16`, `MINIMUM_LIQUIDITY=1000`

**Cell Data Structs** (all have `serialize() -> [u8; N]` and `deserialize(&[u8]) -> Option<Self>`):

| Struct | Size | Key Fields |
|--------|------|------------|
| `AuctionCellData` | 217B | phase, batch_id, commit_mmr_root, commit_count, reveal_count, xor_seed, clearing_price, fillable_volume, difficulty_target, prev_state_hash, phase_start_block, pair_id |
| `CommitCellData` | 136B | order_hash, batch_id, deposit_ckb, token_type_hash, token_amount, block_number, sender_lock_hash |
| `RevealWitness` | 77B | order_type, amount_in, limit_price, secret, priority_bid, commit_index |
| `PoolCellData` | 218B | reserve0, reserve1, total_lp_supply, fee_rate_bps, twap_price_cum, twap_last_block, k_last, minimum_liquidity, pair_id, token0_type_hash, token1_type_hash |
| `LPPositionCellData` | 72B | lp_amount, entry_price, pool_id, deposit_block |
| `ComplianceCellData` | 108B | blocked_merkle_root, tier_merkle_root, jurisdiction_root, last_updated, version |
| `ConfigCellData` | 67B | commit/reveal windows, slash/deviation/trade BPS, rate limits, circuit breakers, min_pow_difficulty |
| `OracleCellData` | 89B | price, block_number, confidence, source_hash, pair_id |
| `PoWLockArgs` | 33B | pair_id, min_difficulty |
| `MerkleProof` | var | leaf, path (Vec), indices — `.verify(root) -> bool` |

---

### pow-lock (Lock Script)
- **Path**: `ckb/scripts/pow-lock/src/main.rs`
- **Purpose**: PoW-gated write access to shared cells (auction + pool)
- **Error**: `LockError { InvalidArgs, InvalidWitness, InvalidProofStructure, InvalidChallenge, InsufficientDifficulty, InvalidDifficultyAdjustment }`
- `verify_pow_lock(lock_args, witness, cell_data, prev_cell_data, blocks_since_last_transition) -> Result<(), LockError>`

---

### batch-auction-type (Type Script)
- **Path**: `ckb/scripts/batch-auction-type/src/lib.rs`
- **Purpose**: Commit/reveal/settle state machine + forced inclusion enforcement
- **Error**: `AuctionTypeError` — 33 variants (InvalidCellData, ForcedInclusionViolation, InvalidPhaseTransition, CommitWindowNotElapsed, RevealWindowNotElapsed, InvalidXORSeed, ZeroClearingPrice, etc.)
- `verify_batch_auction_type(old_data, new_data, commit_cells, reveal_witnesses, compliance_data, config_data, block_number, block_entropy, pending_commit_count) -> Result<(), AuctionTypeError>`
- `compute_state_hash(state: &AuctionCellData) -> [u8; 32]`

---

### commit-type (Type Script)
- **Path**: `ckb/scripts/commit-type/src/lib.rs`
- **Purpose**: Validate commit cell creation and consumption
- **Error**: `CommitTypeError { InvalidCellData, ZeroOrderHash, InsufficientDeposit, ZeroTokenAmount, LockHashMismatch, BatchIdMismatch, WrongPhase, InvalidTypeArgs, NoAuctionCellInTx }`
- `verify_commit_type(is_creation, cell_data, type_args, input_lock_hash, auction_cell_data, min_deposit) -> Result<(), CommitTypeError>`

---

### amm-pool-type (Type Script)
- **Path**: `ckb/scripts/amm-pool-type/src/lib.rs`
- **Purpose**: Constant product AMM validation (create, addLiquidity, removeLiquidity, swap)
- **Error**: `PoolTypeError` — 31 variants (ExcessiveOutput checked BEFORE KInvariantViolation in swap validation)
- `verify_amm_pool_type(old_data, new_data, config, oracle_price, block_number) -> Result<(), PoolTypeError>`

---

### lp-position-type (Type Script)
- **Path**: `ckb/scripts/lp-position-type/src/main.rs`
- **Purpose**: LP position cell validation
- **Error**: `LPPositionError { InvalidCellData, ZeroLPAmount, InvalidPoolId, Overflow, EntryPriceDeviation }`
- `verify_lp_position_type(is_creation, cell_data, pool_data) -> Result<(), LPPositionError>`

---

### compliance-type (Type Script)
- **Path**: `ckb/scripts/compliance-type/src/main.rs`
- **Purpose**: Compliance registry cell + Merkle proof address blocking
- **Error**: `ComplianceTypeError { InvalidCellData, Unauthorized, VersionNotIncremented, StaleUpdate }`
- `verify_compliance_type(is_creation, old_data, new_data, is_governance_authorized) -> Result<(), ComplianceTypeError>`
- `verify_blocked_address(compliance, lock_hash, proof_path, proof_indices) -> bool`

---

### config-type (Type Script)
- **Path**: `ckb/scripts/config-type/src/main.rs`
- **Purpose**: Protocol configuration cell management
- **Error**: `ConfigTypeError { InvalidCellData, Unauthorized, InvalidCommitWindow, InvalidRevealWindow, InvalidSlashRate, InvalidPriceDeviation, InvalidMinDifficulty }`
- `verify_config_type(is_creation, old_data, new_data, is_governance_authorized) -> Result<(), ConfigTypeError>`

---

### oracle-type (Type Script)
- **Path**: `ckb/scripts/oracle-type/src/main.rs`
- **Purpose**: Oracle price feed validation
- **Error**: `OracleTypeError { InvalidCellData, Unauthorized, ZeroPrice, InvalidConfidence, FutureBlock, StaleData, InvalidPairId, NotNewer, PairIdChanged, ExcessivePriceChange }`
- `verify_oracle_type(is_creation, old_data, new_data, is_authorized_relayer, current_block) -> Result<(), OracleTypeError>`

---

### vibeswap-sdk (Transaction Builder + Mining Client)
- **Path**: `ckb/sdk/src/lib.rs` + `ckb/sdk/src/miner.rs`
- **Purpose**: CKB transaction construction + PoW mining for cell access
- **Error**: `SDKError { InvalidAmounts, InsufficientLiquidity, Overflow, MiningFailed }`

**Transaction types**: `UnsignedTransaction`, `CellDep`, `CellInput`, `CellOutput`, `Script`, `DeploymentInfo`, `Order`

**SDK methods** (`VibeSwapSDK::new(deployment) -> Self`):
- `create_commit(order, secret, deposit_ckb, token_amount, token_type_hash, pair_id, batch_id, user_lock, user_input) -> UnsignedTransaction`
- `create_reveal(order, secret, commit_index) -> Vec<u8>` — returns witness bytes
- `add_liquidity(pool_outpoint, pool_data, amount0, amount1, user_lock, user_inputs, block_number) -> Result<UnsignedTransaction, SDKError>`
- `remove_liquidity(pool_outpoint, pool_data, lp_outpoint, lp_position, user_lock, block_number) -> Result<UnsignedTransaction, SDKError>`

**Miner** (`ckb/sdk/src/miner.rs`):
- **Structs**: `MinerConfig`, `MinerState`, `PendingCommit`, `MiningStats`, `MiningEstimate`
- `mine_for_cell(pair_id, batch_id, prev_state_hash, difficulty, max_iterations) -> Option<PoWProof>`
- `build_aggregation_tx(auction_state, pending_commits, compliance_data, pow_proof, deployment, miner_lock) -> UnsignedTransaction`
- `estimate_profitability(difficulty, pending_commit_count, base_reward_ckb, hash_rate) -> MiningEstimate`
- `track_difficulty(current_difficulty, recent_transition_blocks, target_blocks_per_transition) -> u8`

---

### vibeswap-tests (Test Crate)
- **Path**: `ckb/tests/src/lib.rs`
- **Modules**: `integration` (10), `adversarial` (12), `math_parity` (20), `fuzz` (16) — **59 tests total**
- **Combined with inline tests**: 167 total across all crates

---

## DeFi/DeFAI Layer (Session 33)

### StrategyVault (`contracts/financial/StrategyVault.sol`)
- **Type**: ERC-4626 vault | **Inherits**: ERC4626, Ownable, ReentrancyGuard
- **Purpose**: Automated yield vault with pluggable strategies
- **Key Functions**: `proposeStrategy(address)`, `activateStrategy()`, `harvest()`, `setFeeRouter(address)`
- **Interface**: IStrategyVault + IStrategy (pluggable yield strategy)
- **Constants**: MAX_PERFORMANCE_FEE=3000 (30%), MAX_MANAGEMENT_FEE=500 (5%), DEFAULT_TIMELOCK=2 days
- **Integration**: Optional FeeRouter for cooperative fee distribution

### LiquidityGauge (`contracts/incentives/LiquidityGauge.sol`)
- **Type**: Incentive mechanism | **Inherits**: Ownable, ReentrancyGuard
- **Purpose**: Curve-style vote-directed LP incentives with Synthetix reward accumulator
- **Key Functions**: `createGauge(bytes32, address)`, `stake(bytes32, uint256)`, `withdraw(bytes32, uint256)`, `claimRewards(bytes32)`, `updateWeights(bytes32[], uint256[])`, `advanceEpoch()`, `setEmissionRate(uint256)`
- **Interface**: ILiquidityGauge
- **Constants**: MAX_GAUGES=100, PRECISION=1e18

### FeeRouter (`contracts/core/FeeRouter.sol`)
- **Type**: Revenue distribution | **Inherits**: Ownable, ReentrancyGuard
- **Purpose**: Central protocol fee collector and distributor
- **Key Functions**: `collectFee(address, uint256)`, `distribute(address)`, `distributeMultiple(address[])`, `updateConfig(FeeConfig)`, `authorizeSource(address)`, `emergencyRecover(address, uint256, address)`
- **Interface**: IFeeRouter
- **Default Split**: 40% treasury, 20% insurance, 30% revshare, 10% buyback

### ProtocolFeeAdapter (`contracts/core/ProtocolFeeAdapter.sol`)
- **Type**: Adapter/bridge | **Inherits**: Ownable, ReentrancyGuard
- **Purpose**: Bridge fee-generating contracts to FeeRouter (set as VibeAMM treasury)
- **Key Functions**: `forwardFees(address)`, `forwardETH()`, `setFeeRouter(address)`, `recoverToken(address, uint256, address)`
- **Interface**: IProtocolFeeAdapter

## Revenue & Distribution Primitives (Session 34)

### BuybackEngine (`contracts/core/BuybackEngine.sol`)
- **Type**: Revenue mechanism | **Inherits**: Ownable, ReentrancyGuard
- **Purpose**: Automated buyback-and-burn — FeeRouter's 10% buyback allocation swaps for protocol token via VibeAMM and burns
- **Key Functions**: `executeBuyback(address)`, `executeBuybackMultiple(address[])`, `setMinBuybackAmount(address, uint256)`, `setSlippageTolerance(uint256)`, `setCooldown(uint256)`, `setProtocolToken(address)`, `setBurnAddress(address)`, `emergencyRecover(address, uint256, address)`
- **Interface**: IBuybackEngine
- **Constants**: MAX_SLIPPAGE_BPS=2000, DEAD_ADDRESS=0x...dEaD
- **Integration**: Set as FeeRouter's buyback target → receives tokens → swaps via VibeAMM → burns

### MerkleAirdrop (`contracts/incentives/MerkleAirdrop.sol`)
- **Type**: Distribution mechanism | **Inherits**: Ownable, ReentrancyGuard
- **Purpose**: Gas-efficient token distribution via Merkle proofs with multiple rounds
- **Key Functions**: `createDistribution(address, bytes32, uint256, uint256)`, `claim(uint256, address, uint256, bytes32[])`, `deactivateDistribution(uint256)`, `reclaimUnclaimed(uint256, address)`, `emergencyRecover(address, uint256, address)`
- **Interface**: IMerkleAirdrop
- **Leaf Format**: `keccak256(abi.encodePacked(keccak256(abi.encode(account, amount))))` (double-hash, OZ standard)

### VestingSchedule (`contracts/financial/VestingSchedule.sol`)
- **Type**: Financial primitive | **Inherits**: Ownable, ReentrancyGuard
- **Purpose**: Token vesting with cliff + linear unlock for team/contributors
- **Key Functions**: `createSchedule(address, address, uint256, uint256, uint256, uint256, bool)`, `claim(uint256)`, `revoke(uint256)`, `vestedAmount(uint256)`, `claimableAmount(uint256)`, `schedulesOf(address)`, `emergencyRecover(address, uint256, address)`
- **Interface**: IVestingSchedule
- **Vesting**: startTime → cliff (0% vested) → linear unlock → 100% vested. Revocable schedules return unvested to owner.

## Concrete Implementations (Session 34)

### SimpleYieldStrategy (`contracts/financial/strategies/SimpleYieldStrategy.sol`)
- **Type**: IStrategy implementation | **Inherits**: IStrategy, Ownable
- **Purpose**: Reference strategy for StrategyVault — holds assets, owner injects yield, harvest returns profit
- **Key Functions**: `deposit(uint256)`, `withdraw(uint256)`, `harvest()`, `emergencyWithdraw()`, `injectYield(uint256)`
- **Views**: `totalAssets()`, `deployed()`, `pendingYield()`, `asset()`, `vault()`
- **Integration**: Plugs into StrategyVault as first concrete strategy

### DynamicFeeHook (`contracts/hooks/DynamicFeeHook.sol`)
- **Type**: IVibeHook implementation | **Inherits**: IVibeHook, Ownable
- **Purpose**: Dynamic fee adjustment based on trading volume (surge pricing)
- **Hook Points**: BEFORE_SWAP (returns fee recommendation) + AFTER_SWAP (records volume)
- **Key Functions**: `beforeSwap(bytes32, bytes)`, `afterSwap(bytes32, bytes)`, `setParameters(...)`, `setWindowDuration(uint256)`, `calculateFeeForVolume(uint256)`
- **Fee Logic**: fee = baseFee below threshold, fee = baseFee + surge increase above threshold, capped at maxFee

### EmissionController (`contracts/incentives/EmissionController.sol`)
- **Type**: Emission controller | **Inherits**: OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable
- **Purpose**: Wall-clock halving emission controller — mints VIBE and splits to three sinks (50% Shapley pool / 35% LiquidityGauge / 15% SingleStaking)
- **Key Functions**: `drip()` (permissionless), `createContributionGame(bytes32, Participant[], uint256)` (onlyDrainer), `fundStaking()` (permissionless)
- **Views**: `getCurrentEra()`, `getCurrentRate()`, `pendingEmissions()`, `getEmissionInfo()`
- **Admin**: `setBudget(uint256, uint256, uint256)`, `setMaxDrainBps(uint256)`, `setMinDrain(uint256, uint256)`, `setAuthorizedDrainer(address, bool)`, `setLiquidityGauge(address)`, `setSingleStaking(address)`, `setShapleyDistributor(address)`, `setStakingRewardDuration(uint256)`
- **Constants**: MAX_ERAS=32, BASE_EMISSION_RATE=332,880,110,000,000,000 (~0.333 VIBE/sec), DEFAULT_ERA_DURATION=31,557,600 (365.25 days)
- **Emission Math**: `rate = BASE_RATE >> era`, cross-era accrual O(32) bounded loop, MAX_SUPPLY cap via vibeToken.mintableSupply()
- **Accumulation Pool**: shapleyShare accrues in pool, drained via createContributionGame(), FEE_DISTRIBUTION game type (no double-halving)
- **Security**: nonReentrant on all 3 core functions, CEI pattern, zero-drain guard, percentage-based min drain (trustless price scaling)
- **Interfaces Used**: IVIBEMintable (mint, mintableSupply, MAX_SUPPLY), IShapleyCreate (createGameTyped, computeShapleyValues), ISingleStakingNotify (notifyRewardAmount)
- **Tests**: 92 total (38 unit + 6 fuzz + 7 invariant + 41 security)
- **Size**: 7,485 bytes (31% of 24KB Base limit)

### SingleStaking (`contracts/incentives/SingleStaking.sol`)
- **Type**: Incentive primitive | **Inherits**: ISingleStaking, Ownable, ReentrancyGuard
- **Purpose**: Synthetix-style single-sided staking — stake any ERC-20, earn reward tokens proportional to share × time
- **Key Functions**: `stake(uint256)`, `withdraw(uint256)`, `claimReward()`, `exit()`, `notifyRewardAmount(uint256, uint256)`
- **Views**: `stakingToken()`, `rewardToken()`, `totalStaked()`, `stakeOf(address)`, `earned(address)`, `rewardRate()`, `rewardPerTokenStored()`, `lastUpdateTime()`, `periodFinish()`, `rewardDuration()`
- **Reward Math**: `rewardPerToken` accumulator for O(1) distribution. Owner calls `notifyRewardAmount(amount, duration)` to start/extend reward period
- **Solvency**: Checks reward rate doesn't exceed balance/duration; supports same-token staking+rewards

---

## Stats

- **~132 .sol files** total (contracts + interfaces)
- **~76 implementation contracts**
- **~49 interfaces**
- **~11 libraries**
- Core: 8 | AMM: 6 (+ 2 curves) | Financial: 9 | Governance: 8 | Incentives: 11 | Compliance: 4 | Identity: 11 (+ 7 interfaces) | Community: 1 | Messaging: 1 | Oracle: 4 | Quantum: 3 | Account: 2 | MetaTx: 1 | Proxy: 1 | Hooks: 1 | Monetary: 1 | Framework: 2
- **14 Rust crates** (CKB): 4 libraries + 8 scripts + 1 SDK + 1 test crate | **190 Rust tests**
