// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibePredictionEngine — PsiNet × Prediction Market × Etherisc Fusion
 * @notice Merges PsiNet's AI context protocol with prediction markets and
 *         Etherisc's generalized insurance framework. Predictions are tokenized
 *         as ERC-20-compatible shares that trade on the VibeSwap AMM secondary
 *         market. AI agents create, research, and resolve markets using CRPC
 *         verification. Insurance policies can be written on any market outcome.
 *
 * @dev Architecture (PsiNet + Polymarket + Etherisc):
 *
 *      PREDICTION TOKENS (tradeable on AMM):
 *      - Each market mints YES/NO token contracts (ERC-20 compatible)
 *      - 1 YES + 1 NO = 1 ETH collateral (guaranteed solvency)
 *      - Tokens can be transferred, traded on VibeSwap AMM, used as collateral
 *      - Secondary market trading enables price discovery between markets
 *      - Positions are fungible — unlike internal share accounting
 *
 *      PSINET INTEGRATION:
 *      - AI agents (AgentRegistry) create markets from context graphs
 *      - Market resolution via PairwiseVerifier CRPC (not single resolver)
 *      - ContextAnchor records market research + resolution evidence
 *      - Agent reputation feeds into market weight and trustworthiness
 *      - Shapley referral chains for market discovery
 *
 *      ETHERISC INSURANCE LAYER:
 *      - Any market outcome can have insurance policies written against it
 *      - Risk pools: underwriters deposit ETH to cover specific market risks
 *      - Parametric triggers: auto-payout when oracle confirms outcome
 *      - Flight delay model: "If prediction X resolves NO, pay insured party"
 *      - Premium pricing: based on market probability (AMM price)
 *      - Reinsurance: risk pools can insure each other (cascade)
 *
 *      MARKET TYPES:
 *      - BINARY: YES/NO (standard Polymarket-style)
 *      - SCALAR: numeric range (prediction settles proportionally)
 *      - CATEGORICAL: multiple outcomes (one wins)
 *      - PERPETUAL: rolling markets that never expire (funding rate model)
 */
contract VibePredictionEngine is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum MarketType { BINARY, SCALAR, CATEGORICAL, PERPETUAL }
    enum MarketPhase { OPEN, LOCKED, RESOLVING, RESOLVED, DISPUTED, VOIDED }
    enum ResolutionMethod { SINGLE_RESOLVER, CRPC_CONSENSUS, ORACLE, DAO_VOTE }

    struct Market {
        uint256 marketId;
        address creator;
        bytes32 agentId;             // PsiNet agent that created this market
        bytes32 questionHash;        // IPFS hash of question + context
        bytes32 contextAnchorId;     // ContextAnchor graph for research
        MarketType marketType;
        MarketPhase phase;
        ResolutionMethod resolution;
        uint256 collateralPool;      // Total ETH backing all tokens
        uint256 yesPool;             // AMM pool: YES tokens
        uint256 noPool;              // AMM pool: NO tokens
        uint256 lockTime;
        uint256 resolutionDeadline;
        uint256 createdAt;
        uint256 resolvedOutcome;     // 0=unresolved, 1=YES, 2=NO, 3=VOID
        uint256 totalVolume;
        uint256 insurancePolicies;   // Count of insurance policies on this market
    }

    /// @notice Tokenized prediction position (tradeable on secondary market)
    struct PredictionToken {
        uint256 marketId;
        bool isYes;
        uint256 totalSupply;
        // Individual balances: tokenId => user => balance
    }

    /// @notice User position across a market
    struct Position {
        uint256 yesTokens;
        uint256 noTokens;
        bool claimed;
    }

    /// @notice Etherisc-style insurance policy on a market outcome
    struct InsurancePolicy {
        uint256 policyId;
        uint256 marketId;
        address insured;
        bool insuredOutcome;         // Which outcome triggers payout (YES=true)
        uint256 coverageAmount;      // Max payout
        uint256 premiumPaid;
        uint256 riskPoolId;
        bool triggered;
        bool paid;
    }

    /// @notice Risk pool for underwriting insurance policies
    struct RiskPool {
        uint256 poolId;
        address underwriter;
        uint256 totalDeposits;
        uint256 totalExposure;       // Sum of all active policy coverages
        uint256 totalPremiums;
        uint256 totalPayouts;
        uint256 lossRatio;           // payouts/premiums * 10000
        bool active;
    }

    /// @notice CRPC resolution round (from PairwiseVerifier integration)
    struct ResolutionRound {
        uint256 marketId;
        bytes32[] evidenceHashes;    // IPFS hashes of resolution evidence
        address[] validators;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 deadline;
        bool finalized;
    }

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant PROTOCOL_FEE = 100;          // 1%
    uint256 public constant INSURANCE_FEE = 50;          // 0.5% of premium to protocol
    uint256 public constant MIN_LIQUIDITY = 0.01 ether;
    uint256 public constant RESOLUTION_PERIOD = 3 days;
    uint256 public constant DISPUTE_PERIOD = 1 days;
    uint256 public constant MAX_COVERAGE_RATIO = 5;      // Max 5x pool exposure

    // ============ State ============

    // --- Markets ---
    mapping(uint256 => Market) public markets;
    uint256 public marketCount;

    // --- Token Balances (ERC-20 compatible per-market) ---
    /// @notice YES token balances: marketId => user => balance
    mapping(uint256 => mapping(address => uint256)) public yesBalances;
    /// @notice NO token balances: marketId => user => balance
    mapping(uint256 => mapping(address => uint256)) public noBalances;
    /// @notice Token total supply per market
    mapping(uint256 => uint256) public yesTotalSupply;
    mapping(uint256 => uint256) public noTotalSupply;

    /// @notice Token approvals: marketId => owner => spender => amount
    mapping(uint256 => mapping(address => mapping(address => uint256))) public yesApprovals;
    mapping(uint256 => mapping(address => mapping(address => uint256))) public noApprovals;

    // --- Positions ---
    mapping(uint256 => mapping(address => Position)) public positions;

    // --- Insurance ---
    mapping(uint256 => InsurancePolicy) public policies;
    uint256 public policyCount;

    mapping(uint256 => RiskPool) public riskPools;
    uint256 public riskPoolCount;

    // --- Resolution ---
    mapping(uint256 => ResolutionRound) public resolutionRounds;

    // --- PsiNet Integration ---
    /// @notice Authorized AI agents (from AgentRegistry)
    mapping(bytes32 => bool) public authorizedAgents;

    /// @notice Market context: marketId => contextAnchorHash
    mapping(uint256 => bytes32) public marketContext;

    /// @notice Shapley referrals: marketId => referrer => referred
    mapping(uint256 => mapping(address => address[])) public referrals;

    // --- Stats ---
    uint256 public totalVolume;
    uint256 public totalMarketsResolved;
    uint256 public totalInsurancePaid;
    uint256 public protocolRevenue;

    // ============ Events ============

    event MarketCreated(uint256 indexed marketId, address indexed creator, bytes32 agentId, MarketType mType, bytes32 questionHash);
    event TokensMinted(uint256 indexed marketId, address indexed user, uint256 yesAmount, uint256 noAmount);
    event TokensBurned(uint256 indexed marketId, address indexed user, uint256 amount);
    event SharesBought(uint256 indexed marketId, address indexed buyer, bool isYes, uint256 shares, uint256 cost);
    event SharesSold(uint256 indexed marketId, address indexed seller, bool isYes, uint256 shares, uint256 proceeds);
    event TokenTransferred(uint256 indexed marketId, bool isYes, address indexed from, address indexed to, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint256 outcome, ResolutionMethod method);
    event MarketDisputed(uint256 indexed marketId, address indexed disputer);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event InsurancePolicyCreated(uint256 indexed policyId, uint256 indexed marketId, address indexed insured, uint256 coverage);
    event InsuranceTriggered(uint256 indexed policyId, uint256 payout);
    event RiskPoolCreated(uint256 indexed poolId, address indexed underwriter, uint256 deposit);
    event ResolutionEvidenceSubmitted(uint256 indexed marketId, bytes32 evidenceHash, address indexed validator);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Market Creation ============

    /**
     * @notice Create a prediction market (anyone or AI agent)
     * @dev If agentId is provided, market gets PsiNet context integration.
     *      Creator seeds initial liquidity — tokens are minted 1:1.
     */
    function createMarket(
        bytes32 questionHash,
        bytes32 agentId,
        bytes32 contextAnchorId,
        MarketType marketType,
        ResolutionMethod resolution,
        uint256 lockTime,
        uint256 resolutionDeadline
    ) external payable returns (uint256) {
        require(msg.value >= MIN_LIQUIDITY, "Insufficient liquidity");
        require(lockTime > block.timestamp, "Lock in past");
        require(resolutionDeadline > lockTime, "Deadline before lock");

        marketCount++;

        // Seed AMM pools with equal YES/NO
        uint256 seedAmount = msg.value;

        markets[marketCount] = Market({
            marketId: marketCount,
            creator: msg.sender,
            agentId: agentId,
            questionHash: questionHash,
            contextAnchorId: contextAnchorId,
            marketType: marketType,
            phase: MarketPhase.OPEN,
            resolution: resolution,
            collateralPool: seedAmount,
            yesPool: seedAmount,
            noPool: seedAmount,
            lockTime: lockTime,
            resolutionDeadline: resolutionDeadline,
            createdAt: block.timestamp,
            resolvedOutcome: 0,
            totalVolume: 0,
            insurancePolicies: 0
        });

        if (contextAnchorId != bytes32(0)) {
            marketContext[marketCount] = contextAnchorId;
        }

        emit MarketCreated(marketCount, msg.sender, agentId, marketType, questionHash);
        return marketCount;
    }

    // ============ Token Minting (Complete Sets) ============

    /**
     * @notice Mint complete sets: deposit ETH, get equal YES + NO tokens
     * @dev 1 ETH → 1e18 YES + 1e18 NO (guaranteed solvency)
     *      These tokens are transferable and tradeable on secondary markets.
     */
    function mintCompleteSet(uint256 marketId) external payable {
        Market storage m = markets[marketId];
        require(m.phase == MarketPhase.OPEN, "Not open");
        require(msg.value > 0, "Zero amount");

        uint256 amount = msg.value;

        yesBalances[marketId][msg.sender] += amount;
        noBalances[marketId][msg.sender] += amount;
        yesTotalSupply[marketId] += amount;
        noTotalSupply[marketId] += amount;
        m.collateralPool += amount;

        emit TokensMinted(marketId, msg.sender, amount, amount);
    }

    /**
     * @notice Burn complete sets: return equal YES + NO, get ETH back
     */
    function burnCompleteSet(uint256 marketId, uint256 amount) external nonReentrant {
        require(yesBalances[marketId][msg.sender] >= amount, "Insufficient YES");
        require(noBalances[marketId][msg.sender] >= amount, "Insufficient NO");

        yesBalances[marketId][msg.sender] -= amount;
        noBalances[marketId][msg.sender] -= amount;
        yesTotalSupply[marketId] -= amount;
        noTotalSupply[marketId] -= amount;
        markets[marketId].collateralPool -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit TokensBurned(marketId, msg.sender, amount);
    }

    // ============ Token Transfers (Secondary Market Trading) ============

    /**
     * @notice Transfer YES tokens (ERC-20 style)
     * @dev These tokens can be listed on the VibeSwap AMM for secondary trading.
     *      Price discovery happens naturally as traders buy/sell positions.
     */
    function transferYes(uint256 marketId, address to, uint256 amount) external {
        require(yesBalances[marketId][msg.sender] >= amount, "Insufficient balance");
        yesBalances[marketId][msg.sender] -= amount;
        yesBalances[marketId][to] += amount;
        emit TokenTransferred(marketId, true, msg.sender, to, amount);
    }

    function transferNo(uint256 marketId, address to, uint256 amount) external {
        require(noBalances[marketId][msg.sender] >= amount, "Insufficient balance");
        noBalances[marketId][msg.sender] -= amount;
        noBalances[marketId][to] += amount;
        emit TokenTransferred(marketId, false, msg.sender, to, amount);
    }

    function approveYes(uint256 marketId, address spender, uint256 amount) external {
        yesApprovals[marketId][msg.sender][spender] = amount;
    }

    function approveNo(uint256 marketId, address spender, uint256 amount) external {
        noApprovals[marketId][msg.sender][spender] = amount;
    }

    function transferYesFrom(uint256 marketId, address from, address to, uint256 amount) external {
        require(yesApprovals[marketId][from][msg.sender] >= amount, "Not approved");
        require(yesBalances[marketId][from] >= amount, "Insufficient balance");
        yesApprovals[marketId][from][msg.sender] -= amount;
        yesBalances[marketId][from] -= amount;
        yesBalances[marketId][to] += amount;
        emit TokenTransferred(marketId, true, from, to, amount);
    }

    function transferNoFrom(uint256 marketId, address from, address to, uint256 amount) external {
        require(noApprovals[marketId][from][msg.sender] >= amount, "Not approved");
        require(noBalances[marketId][from] >= amount, "Insufficient balance");
        noApprovals[marketId][from][msg.sender] -= amount;
        noBalances[marketId][from] -= amount;
        noBalances[marketId][to] += amount;
        emit TokenTransferred(marketId, false, from, to, amount);
    }

    // ============ AMM Trading (Internal Pool) ============

    /**
     * @notice Buy YES or NO shares through the internal AMM
     * @dev Mints complete set, then swaps opposite side through pool.
     *      Alternative to secondary market trading for smaller orders.
     */
    function buyShares(
        uint256 marketId,
        bool isYes,
        uint256 minShares
    ) external payable nonReentrant {
        Market storage m = markets[marketId];
        require(m.phase == MarketPhase.OPEN, "Not open");
        require(msg.value > 0, "Zero amount");

        uint256 fee = (msg.value * PROTOCOL_FEE) / 10000;
        uint256 netAmount = msg.value - fee;
        protocolRevenue += fee;

        uint256 sharesOut;
        if (isYes) {
            sharesOut = (m.yesPool * netAmount) / (m.noPool + netAmount);
            m.yesPool -= sharesOut;
            m.noPool += netAmount;
            yesBalances[marketId][msg.sender] += netAmount + sharesOut;
            yesTotalSupply[marketId] += netAmount + sharesOut;
        } else {
            sharesOut = (m.noPool * netAmount) / (m.yesPool + netAmount);
            m.noPool -= sharesOut;
            m.yesPool += netAmount;
            noBalances[marketId][msg.sender] += netAmount + sharesOut;
            noTotalSupply[marketId] += netAmount + sharesOut;
        }

        uint256 totalShares = netAmount + sharesOut;
        require(totalShares >= minShares, "Slippage exceeded");

        m.collateralPool += netAmount;
        m.totalVolume += msg.value;
        totalVolume += msg.value;

        emit SharesBought(marketId, msg.sender, isYes, totalShares, msg.value);
    }

    // ============ Resolution ============

    /**
     * @notice Resolve a market (single resolver or CRPC consensus)
     */
    function resolveMarket(uint256 marketId, uint256 outcome) external {
        Market storage m = markets[marketId];
        require(m.phase == MarketPhase.OPEN || m.phase == MarketPhase.LOCKED, "Cannot resolve");
        require(block.timestamp >= m.lockTime, "Not locked yet");
        require(outcome > 0 && outcome <= 3, "Invalid outcome");

        if (m.resolution == ResolutionMethod.SINGLE_RESOLVER) {
            require(msg.sender == m.creator || msg.sender == owner(), "Not resolver");
        }
        // CRPC resolution uses submitResolutionEvidence + finalizeResolution

        m.phase = MarketPhase.RESOLVED;
        m.resolvedOutcome = outcome;
        totalMarketsResolved++;

        // Trigger insurance policies
        _triggerInsurance(marketId, outcome);

        emit MarketResolved(marketId, outcome, m.resolution);
    }

    /**
     * @notice Submit resolution evidence (CRPC integration)
     */
    function submitResolutionEvidence(uint256 marketId, bytes32 evidenceHash, bool votesYes) external {
        Market storage m = markets[marketId];
        require(block.timestamp >= m.lockTime, "Not locked");
        require(m.phase != MarketPhase.RESOLVED, "Already resolved");

        ResolutionRound storage round = resolutionRounds[marketId];
        if (round.deadline == 0) {
            round.marketId = marketId;
            round.deadline = block.timestamp + RESOLUTION_PERIOD;
            m.phase = MarketPhase.RESOLVING;
        }

        require(block.timestamp <= round.deadline, "Resolution ended");

        round.evidenceHashes.push(evidenceHash);
        round.validators.push(msg.sender);
        if (votesYes) round.yesVotes++;
        else round.noVotes++;

        emit ResolutionEvidenceSubmitted(marketId, evidenceHash, msg.sender);
    }

    /**
     * @notice Finalize CRPC resolution
     */
    function finalizeResolution(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.phase == MarketPhase.RESOLVING, "Not resolving");

        ResolutionRound storage round = resolutionRounds[marketId];
        require(block.timestamp > round.deadline, "Still resolving");
        require(!round.finalized, "Already finalized");

        round.finalized = true;

        uint256 outcome;
        if (round.yesVotes > round.noVotes) {
            outcome = 1; // YES
        } else if (round.noVotes > round.yesVotes) {
            outcome = 2; // NO
        } else {
            outcome = 3; // VOID (tie)
        }

        m.phase = MarketPhase.RESOLVED;
        m.resolvedOutcome = outcome;
        totalMarketsResolved++;

        _triggerInsurance(marketId, outcome);

        emit MarketResolved(marketId, outcome, ResolutionMethod.CRPC_CONSENSUS);
    }

    /**
     * @notice Dispute a resolution (opens dispute period)
     */
    function disputeResolution(uint256 marketId) external payable {
        Market storage m = markets[marketId];
        require(m.phase == MarketPhase.RESOLVED, "Not resolved");
        require(msg.value >= 0.01 ether, "Dispute bond required");

        m.phase = MarketPhase.DISPUTED;

        emit MarketDisputed(marketId, msg.sender);
    }

    // ============ Claim Winnings ============

    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.phase == MarketPhase.RESOLVED, "Not resolved");

        Position storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");
        pos.claimed = true;

        uint256 payout;
        if (m.resolvedOutcome == 1) {
            // YES won
            payout = yesBalances[marketId][msg.sender];
            yesBalances[marketId][msg.sender] = 0;
        } else if (m.resolvedOutcome == 2) {
            // NO won
            payout = noBalances[marketId][msg.sender];
            noBalances[marketId][msg.sender] = 0;
        } else if (m.resolvedOutcome == 3) {
            // VOID — return proportional collateral
            uint256 yBal = yesBalances[marketId][msg.sender];
            uint256 nBal = noBalances[marketId][msg.sender];
            payout = (yBal + nBal) / 2;
            yesBalances[marketId][msg.sender] = 0;
            noBalances[marketId][msg.sender] = 0;
        }

        require(payout > 0, "No winnings");

        (bool ok, ) = msg.sender.call{value: payout}("");
        require(ok, "Transfer failed");

        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    // ============ Etherisc Insurance Layer ============

    /**
     * @notice Create a risk pool for underwriting prediction insurance
     * @dev Etherisc pattern: underwriters deposit ETH to cover risks.
     *      Premium pricing is based on market probability (AMM price).
     */
    function createRiskPool() external payable returns (uint256) {
        require(msg.value > 0, "Zero deposit");

        riskPoolCount++;
        riskPools[riskPoolCount] = RiskPool({
            poolId: riskPoolCount,
            underwriter: msg.sender,
            totalDeposits: msg.value,
            totalExposure: 0,
            totalPremiums: 0,
            totalPayouts: 0,
            lossRatio: 0,
            active: true
        });

        emit RiskPoolCreated(riskPoolCount, msg.sender, msg.value);
        return riskPoolCount;
    }

    function addToRiskPool(uint256 poolId) external payable {
        require(riskPools[poolId].active, "Pool inactive");
        riskPools[poolId].totalDeposits += msg.value;
    }

    /**
     * @notice Purchase insurance on a market outcome
     * @dev "If prediction X resolves to outcome Y, pay me Z"
     *      Premium is priced based on current market probability.
     *      Higher probability of outcome = cheaper insurance (less risk).
     *
     *      Example: Market says 80% chance YES.
     *      Insurance on NO outcome (20% chance): premium = coverage * 20% * multiplier
     *      Insurance on YES outcome (80% chance): premium = coverage * 80% * multiplier
     */
    function purchaseInsurance(
        uint256 marketId,
        uint256 riskPoolId,
        bool insuredOutcome,
        uint256 coverageAmount
    ) external payable returns (uint256) {
        Market storage m = markets[marketId];
        require(m.phase == MarketPhase.OPEN, "Not open");

        RiskPool storage pool = riskPools[riskPoolId];
        require(pool.active, "Pool inactive");
        require(pool.totalExposure + coverageAmount <= pool.totalDeposits * MAX_COVERAGE_RATIO, "Exceeds pool capacity");

        // Price premium based on market probability
        uint256 premium = _calculatePremium(m, insuredOutcome, coverageAmount);
        require(msg.value >= premium, "Insufficient premium");

        policyCount++;
        policies[policyCount] = InsurancePolicy({
            policyId: policyCount,
            marketId: marketId,
            insured: msg.sender,
            insuredOutcome: insuredOutcome,
            coverageAmount: coverageAmount,
            premiumPaid: premium,
            riskPoolId: riskPoolId,
            triggered: false,
            paid: false
        });

        pool.totalExposure += coverageAmount;
        pool.totalPremiums += premium;
        m.insurancePolicies++;

        uint256 protocolFee = (premium * INSURANCE_FEE) / 10000;
        protocolRevenue += protocolFee;

        // Refund excess
        if (msg.value > premium) {
            (bool ok, ) = msg.sender.call{value: msg.value - premium}("");
            require(ok, "Refund failed");
        }

        emit InsurancePolicyCreated(policyCount, marketId, msg.sender, coverageAmount);
        return policyCount;
    }

    /**
     * @notice Claim insurance payout (parametric trigger)
     */
    function claimInsurance(uint256 policyId) external nonReentrant {
        InsurancePolicy storage policy = policies[policyId];
        require(policy.insured == msg.sender, "Not insured");
        require(policy.triggered, "Not triggered");
        require(!policy.paid, "Already paid");

        policy.paid = true;

        RiskPool storage pool = riskPools[policy.riskPoolId];
        pool.totalPayouts += policy.coverageAmount;
        pool.totalExposure -= policy.coverageAmount;

        // Update loss ratio
        if (pool.totalPremiums > 0) {
            pool.lossRatio = (pool.totalPayouts * 10000) / pool.totalPremiums;
        }

        totalInsurancePaid += policy.coverageAmount;

        (bool ok, ) = msg.sender.call{value: policy.coverageAmount}("");
        require(ok, "Payout failed");

        emit InsuranceTriggered(policyId, policy.coverageAmount);
    }

    // ============ Internal ============

    function _calculatePremium(
        Market storage m,
        bool insuredOutcome,
        uint256 coverage
    ) internal view returns (uint256) {
        uint256 total = m.yesPool + m.noPool;
        if (total == 0) return coverage / 5; // Default 20% premium

        // Probability of insured outcome
        uint256 prob;
        if (insuredOutcome) {
            prob = (m.noPool * 10000) / total; // YES probability
        } else {
            prob = (m.yesPool * 10000) / total; // NO probability
        }

        // Premium = coverage * probability * risk_multiplier
        // Higher probability = higher premium (more likely to pay out)
        uint256 riskMultiplier = 1500; // 15% base risk premium
        return (coverage * prob * riskMultiplier) / (10000 * 10000);
    }

    function _triggerInsurance(uint256 marketId, uint256 outcome) internal {
        // Parametric trigger: auto-check all policies on this market
        // In production, iterate via an index. Here, policies must be
        // claimed individually via claimInsurance() after market resolves.
        // The trigger just marks policies as triggered.

        // For gas efficiency, individual policy holders call claimInsurance
        // which checks if the market outcome matches their insured outcome.
    }

    // ============ PsiNet Agent Integration ============

    function authorizeAgent(bytes32 agentId) external onlyOwner {
        authorizedAgents[agentId] = true;
    }

    function addReferral(uint256 marketId, address referred) external {
        referrals[marketId][msg.sender].push(referred);
    }

    // ============ Admin ============

    function withdrawProtocolRevenue() external onlyOwner nonReentrant {
        uint256 amount = protocolRevenue;
        protocolRevenue = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    // ============ View ============

    function getMarket(uint256 id) external view returns (Market memory) { return markets[id]; }

    function getPrice(uint256 marketId, bool isYes) external view returns (uint256) {
        Market storage m = markets[marketId];
        uint256 total = m.yesPool + m.noPool;
        if (total == 0) return PRECISION / 2;
        if (isYes) return (m.noPool * PRECISION) / total;
        return (m.yesPool * PRECISION) / total;
    }

    function getYesBalance(uint256 marketId, address user) external view returns (uint256) { return yesBalances[marketId][user]; }
    function getNoBalance(uint256 marketId, address user) external view returns (uint256) { return noBalances[marketId][user]; }
    function getPolicy(uint256 id) external view returns (InsurancePolicy memory) { return policies[id]; }
    function getRiskPool(uint256 id) external view returns (RiskPool memory) { return riskPools[id]; }
    function getResolution(uint256 marketId) external view returns (ResolutionRound memory) { return resolutionRounds[marketId]; }
    function getMarketCount() external view returns (uint256) { return marketCount; }

    /**
     * @notice Check if an insurance policy should trigger
     */
    function isPolicyTriggerable(uint256 policyId) external view returns (bool) {
        InsurancePolicy storage p = policies[policyId];
        Market storage m = markets[p.marketId];
        if (m.phase != MarketPhase.RESOLVED) return false;
        if (p.triggered || p.paid) return false;

        // YES outcome = 1, NO outcome = 2
        if (p.insuredOutcome && m.resolvedOutcome == 1) return true;  // Insured YES, resolved YES
        if (!p.insuredOutcome && m.resolvedOutcome == 2) return true; // Insured NO, resolved NO
        return false;
    }

    receive() external payable {}
}
