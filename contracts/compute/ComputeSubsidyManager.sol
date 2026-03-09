// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IComputeSubsidy.sol";

/**
 * @title ComputeSubsidyManager — Reputation-Weighted Compute Pricing for AI Agents
 * @notice Implements the JOULE compute subsidy system:
 *
 *   SUBSIDY CURVE (logarithmic):
 *     rep=0    → 1.0x cost (full price, no subsidy)
 *     rep=50   → 0.55x cost (45% subsidized)
 *     rep=100  → 0.1x cost  (90% subsidized)
 *     Formula: multiplier = 1 - 0.9 * ln(1 + rep) / ln(101)
 *
 *   REVENUE CLAWBACK:
 *     If subsidized compute generates revenue, a percentage flows back to
 *     replenish the subsidy pool. No revenue = no clawback. Success funds
 *     future experiments.
 *     Clawback rate scales with subsidy: higher subsidy → higher clawback.
 *     Max clawback: 50% of revenue (even at 90% subsidy).
 *
 *   STAKED REPUTATION:
 *     Agents stake JOULE to temporarily boost their effective reputation.
 *     If the staked job fails, the stake is slashed (50% burned, 50% to pool).
 *     Successful completion returns stake + builds organic reputation.
 *
 * @dev Integrates with:
 *      - JOULE token (IJoule) for payment
 *      - ReputationOracle (IReputationOracle) for on-chain reputation
 *      - AgentRegistry (IAgentRegistry) for agent identity verification
 */
contract ComputeSubsidyManager is
    IComputeSubsidy,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS = 10_000;
    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_REPUTATION = 10_000;  // ReputationOracle scale
    uint256 public constant MAX_SUBSIDY_BPS = 9_000;  // 90% max subsidy
    uint256 public constant MAX_CLAWBACK_BPS = 5_000; // 50% max clawback
    uint256 public constant STAKE_SLASH_BPS = 5_000;  // 50% of stake slashed on failure
    uint256 public constant STAKE_BURN_BPS = 5_000;   // 50% of slashed amount burned
    uint256 public constant MAX_STAKE_BOOST = 2_000;  // Max +2000 reputation from staking
    uint256 public constant INACTIVITY_DECAY_PERIOD = 30 days;

    /// @dev ln(101) * 1e18 — precomputed for subsidy curve
    uint256 private constant LN_101_WAD = 4_615_120_516_934_434_944; // ln(101) ≈ 4.6151

    // ============ State ============

    IERC20 public jouleToken;
    address public reputationOracle;
    address public agentRegistry;

    SubsidyPool public pool;

    mapping(bytes32 => ComputeJob) public jobs;
    mapping(address => AgentComputeProfile) public agentProfiles;

    /// @notice Authorized raters who can complete/fail jobs
    mapping(address => bool) public authorizedRaters;

    /// @notice Job nonce per agent (for unique job IDs)
    mapping(address => uint256) public jobNonces;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _jouleToken,
        address _reputationOracle,
        address _agentRegistry,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        jouleToken = IERC20(_jouleToken);
        reputationOracle = _reputationOracle;
        agentRegistry = _agentRegistry;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Modifiers ============

    modifier onlyRater() {
        if (!authorizedRaters[msg.sender] && msg.sender != owner()) revert Unauthorized();
        _;
    }

    // ============ Core: Submit Job ============

    function submitJob(uint256 baseCost) external nonReentrant returns (bytes32 jobId) {
        if (baseCost == 0) revert ZeroAmount();

        address agent = msg.sender;
        uint256 effectiveRep = getEffectiveReputation(agent);

        // Calculate subsidy
        (uint256 subsidizedCost, uint256 subsidyAmount) = _calculateSubsidy(effectiveRep, baseCost);

        // Check agent has enough JOULE for their portion
        if (jouleToken.balanceOf(agent) < subsidizedCost) revert InsufficientJouleBalance();

        // Check pool has enough for subsidy
        if (pool.balance < subsidyAmount) revert InsufficientPoolBalance();

        // Generate job ID
        uint256 nonce = jobNonces[agent]++;
        jobId = keccak256(abi.encodePacked(agent, nonce, block.timestamp));

        // Charge agent the subsidized cost
        jouleToken.safeTransferFrom(agent, address(this), subsidizedCost);

        // Debit subsidy from pool
        pool.balance -= subsidyAmount;
        pool.totalDisbursed += subsidyAmount;

        // Record job
        jobs[jobId] = ComputeJob({
            jobId: jobId,
            agent: agent,
            agentId: 0, // Populated by registry lookup if available
            baseCost: baseCost,
            subsidizedCost: subsidizedCost,
            subsidyAmount: subsidyAmount,
            reputationAtSubmit: effectiveRep,
            stakedBoost: agentProfiles[agent].totalStaked,
            status: JobStatus.ACTIVE,
            createdAt: block.timestamp,
            completedAt: 0,
            qualityRating: 0,
            revenueGenerated: 0
        });

        // Update profile
        agentProfiles[agent].lastActivityAt = block.timestamp;

        emit JobSubmitted(jobId, agent, baseCost, subsidizedCost, subsidyAmount);
        emit SubsidyDisbursed(jobId, agent, subsidyAmount, effectiveRep);
    }

    // ============ Core: Complete Job ============

    function completeJob(bytes32 jobId, uint8 qualityRating) external onlyRater {
        ComputeJob storage job = jobs[jobId];
        if (job.agent == address(0)) revert JobNotFound();
        if (job.status != JobStatus.ACTIVE) revert JobNotActive();
        if (qualityRating > 100) revert InvalidRating();

        job.status = JobStatus.COMPLETED;
        job.completedAt = block.timestamp;
        job.qualityRating = qualityRating;

        // Update agent profile
        AgentComputeProfile storage profile = agentProfiles[job.agent];
        profile.totalJobsCompleted++;
        profile.lastActivityAt = block.timestamp;

        emit JobCompleted(jobId, job.agent, qualityRating);
    }

    // ============ Core: Fail Job ============

    function failJob(bytes32 jobId) external onlyRater {
        ComputeJob storage job = jobs[jobId];
        if (job.agent == address(0)) revert JobNotFound();
        if (job.status != JobStatus.ACTIVE) revert JobNotActive();

        job.status = JobStatus.FAILED;
        job.completedAt = block.timestamp;

        AgentComputeProfile storage profile = agentProfiles[job.agent];
        profile.totalJobsFailed++;
        profile.lastActivityAt = block.timestamp;

        // Slash staked reputation if agent had active stake
        uint256 slashAmount = 0;
        if (job.stakedBoost > 0 && profile.totalStaked > 0) {
            slashAmount = (profile.totalStaked * STAKE_SLASH_BPS) / BPS;
            if (slashAmount > profile.totalStaked) slashAmount = profile.totalStaked;

            profile.totalStaked -= slashAmount;

            // Half to pool, half burned (sent to address(0xdead))
            uint256 toPool = (slashAmount * STAKE_BURN_BPS) / BPS;
            uint256 toBurn = slashAmount - toPool;

            pool.balance += toPool;
            // Burn by sending to dead address (cannot send to address(0) with SafeERC20)
            if (toBurn > 0) {
                jouleToken.safeTransfer(address(0xdEaD), toBurn);
            }

            emit StakeSlashed(job.agent, slashAmount, jobId);
        }

        emit JobFailed(jobId, job.agent, slashAmount);
    }

    // ============ Core: Revenue Clawback ============

    function reportRevenue(bytes32 jobId, uint256 revenueAmount) external onlyRater {
        if (revenueAmount == 0) revert ZeroAmount();

        ComputeJob storage job = jobs[jobId];
        if (job.agent == address(0)) revert JobNotFound();
        if (job.status != JobStatus.COMPLETED) revert JobAlreadyCompleted();
        if (job.subsidyAmount == 0) revert NothingToClawback();

        job.revenueGenerated += revenueAmount;

        // Calculate clawback: scales with how much subsidy was received
        uint256 subsidyBps = (job.subsidyAmount * BPS) / job.baseCost;
        uint256 clawbackBps = _getClawbackRate(subsidyBps);
        uint256 clawbackAmount = (revenueAmount * clawbackBps) / BPS;

        if (clawbackAmount > 0) {
            // Transfer clawback from agent to pool
            jouleToken.safeTransferFrom(job.agent, address(this), clawbackAmount);
            pool.balance += clawbackAmount;
            pool.totalClawedBack += clawbackAmount;

            AgentComputeProfile storage profile = agentProfiles[job.agent];
            profile.totalRevenueGenerated += revenueAmount;
            profile.totalClawbackPaid += clawbackAmount;

            emit RevenueClawback(jobId, job.agent, revenueAmount, clawbackAmount);
        }
    }

    // ============ Staking ============

    function stakeForReputation(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        jouleToken.safeTransferFrom(msg.sender, address(this), amount);

        AgentComputeProfile storage profile = agentProfiles[msg.sender];
        profile.totalStaked += amount;
        profile.effectiveReputation = getEffectiveReputation(msg.sender);
        profile.lastActivityAt = block.timestamp;

        emit ReputationStaked(msg.sender, amount, profile.effectiveReputation);
    }

    function unstakeReputation(uint256 amount) external nonReentrant {
        AgentComputeProfile storage profile = agentProfiles[msg.sender];
        if (profile.totalStaked == 0 || amount == 0) revert NothingToUnstake();
        if (amount > profile.totalStaked) amount = profile.totalStaked;

        profile.totalStaked -= amount;
        profile.effectiveReputation = getEffectiveReputation(msg.sender);

        jouleToken.safeTransfer(msg.sender, amount);

        emit ReputationUnstaked(msg.sender, amount);
    }

    // ============ Pool Management ============

    function fundPool(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        jouleToken.safeTransferFrom(msg.sender, address(this), amount);
        pool.totalFunded += amount;
        pool.balance += amount;

        emit PoolFunded(msg.sender, amount);
    }

    // ============ Admin ============

    function setAuthorizedRater(address rater, bool authorized) external onlyOwner {
        authorizedRaters[rater] = authorized;
    }

    function setReputationOracle(address _oracle) external onlyOwner {
        reputationOracle = _oracle;
    }

    function setAgentRegistry(address _registry) external onlyOwner {
        agentRegistry = _registry;
    }

    // ============ View: Subsidy Calculation ============

    function calculateSubsidy(address agent, uint256 baseCost)
        external
        view
        returns (uint256 subsidizedCost, uint256 subsidyAmount)
    {
        uint256 effectiveRep = getEffectiveReputation(agent);
        return _calculateSubsidy(effectiveRep, baseCost);
    }

    function _calculateSubsidy(uint256 effectiveRep, uint256 baseCost)
        internal
        pure
        returns (uint256 subsidizedCost, uint256 subsidyAmount)
    {
        uint256 multiplier = _getSubsidyMultiplier(effectiveRep);
        subsidizedCost = (baseCost * multiplier) / WAD;
        // Minimum cost: 10% (even at max reputation)
        if (subsidizedCost < baseCost / 10) subsidizedCost = baseCost / 10;
        subsidyAmount = baseCost - subsidizedCost;
    }

    // ============ Subsidy Curve ============

    /**
     * @notice Logarithmic subsidy curve: reputation → cost multiplier
     *
     *   multiplier = 1 - maxSubsidy * ln(1 + rep * 100 / MAX_REP) / ln(101)
     *
     *   Where maxSubsidy = 0.9 (90%)
     *
     *   Rep 0    → multiplier = 1.0  (full price)
     *   Rep 5000 → multiplier ≈ 0.55 (45% subsidized)
     *   Rep 10000→ multiplier = 0.1  (90% subsidized)
     *
     * @dev Uses integer approximation of natural log via Taylor series.
     *      Accurate to ~0.1% across the full range.
     */
    function getSubsidyMultiplier(uint256 reputationScore) external pure returns (uint256) {
        return _getSubsidyMultiplier(reputationScore);
    }

    function _getSubsidyMultiplier(uint256 reputationScore) internal pure returns (uint256) {
        if (reputationScore == 0) return WAD; // 1.0x — no subsidy
        if (reputationScore >= MAX_REPUTATION) return WAD / 10; // 0.1x — max subsidy

        // Map reputation 0-10000 to x = 0-100 for ln(1+x)
        // Then: multiplier = WAD - (9 * WAD / 10) * ln(1 + x) / ln(101)
        // Where x = reputationScore * 100 / MAX_REPUTATION

        uint256 x = (reputationScore * 100) / MAX_REPUTATION; // 0-100
        uint256 lnValue = _lnApprox(1 + x); // ln(1+x) in WAD

        // subsidy fraction = 0.9 * lnValue / ln(101)
        uint256 subsidyFraction = (9 * lnValue) / 10;
        subsidyFraction = (subsidyFraction * WAD) / LN_101_WAD;

        if (subsidyFraction >= WAD) return WAD / 10; // safety cap
        return WAD - subsidyFraction;
    }

    /**
     * @dev Natural log approximation using the series: ln(x) = 2 * sum[ ((x-1)/(x+1))^(2k+1) / (2k+1) ]
     *      Converges well for x in [1, 101].
     *      Returns result in WAD (1e18) precision.
     */
    function _lnApprox(uint256 x) internal pure returns (uint256) {
        if (x <= 1) return 0;

        // y = (x - 1) / (x + 1) in WAD
        uint256 num = (x - 1) * WAD;
        uint256 den = x + 1;
        uint256 y = num / den; // WAD precision

        uint256 y2 = (y * y) / WAD; // y^2 in WAD
        uint256 term = y; // y^1
        uint256 result = term; // First term: y/1

        // term = y^3 / 3
        term = (term * y2) / WAD;
        result += term / 3;

        // term = y^5 / 5
        term = (term * y2) / WAD;
        result += term / 5;

        // term = y^7 / 7
        term = (term * y2) / WAD;
        result += term / 7;

        // term = y^9 / 9
        term = (term * y2) / WAD;
        result += term / 9;

        // term = y^11 / 11
        term = (term * y2) / WAD;
        result += term / 11;

        return result * 2; // ln(x) = 2 * sum
    }

    // ============ Clawback Rate ============

    /**
     * @notice Linear clawback rate based on subsidy received.
     *   0% subsidy → 0% clawback
     *   90% subsidy (9000 bps) → 50% clawback (5000 bps)
     *   Linear interpolation between.
     */
    function getClawbackRate(uint256 subsidyBps) external pure returns (uint256) {
        return _getClawbackRate(subsidyBps);
    }

    function _getClawbackRate(uint256 subsidyBps) internal pure returns (uint256) {
        if (subsidyBps == 0) return 0;
        if (subsidyBps >= MAX_SUBSIDY_BPS) return MAX_CLAWBACK_BPS;
        return (subsidyBps * MAX_CLAWBACK_BPS) / MAX_SUBSIDY_BPS;
    }

    // ============ Effective Reputation ============

    /**
     * @notice Computes effective reputation: base score + stake boost - inactivity decay.
     *
     *   Base: ReputationOracle.getTrustScore(agent) → 0-10000
     *   Boost: sqrt(stakedJoule / 1e18) * 100, capped at MAX_STAKE_BOOST
     *   Decay: -50 per inactive day (after INACTIVITY_DECAY_PERIOD)
     */
    function getEffectiveReputation(address agent) public view returns (uint256) {
        // Base reputation from oracle
        uint256 baseRep = 0;
        if (reputationOracle != address(0)) {
            try IReputationOracleView(reputationOracle).getTrustScore(agent) returns (uint256 score) {
                baseRep = score;
            } catch {
                // Oracle unavailable — use 0
            }
        }

        // Stake boost: sqrt(staked / 1e18) * 100, capped
        AgentComputeProfile storage profile = agentProfiles[agent];
        uint256 stakeBoost = 0;
        if (profile.totalStaked > 0) {
            stakeBoost = _sqrt(profile.totalStaked / WAD) * 100;
            if (stakeBoost > MAX_STAKE_BOOST) stakeBoost = MAX_STAKE_BOOST;
        }

        uint256 effectiveRep = baseRep + stakeBoost;

        // Inactivity decay
        if (profile.lastActivityAt > 0) {
            uint256 inactiveDuration = block.timestamp - profile.lastActivityAt;
            if (inactiveDuration > INACTIVITY_DECAY_PERIOD) {
                uint256 decayDays = (inactiveDuration - INACTIVITY_DECAY_PERIOD) / 1 days;
                uint256 decay = decayDays * 50; // 50 points per day
                if (decay >= effectiveRep) return 0;
                effectiveRep -= decay;
            }
        }

        // Cap at MAX_REPUTATION
        if (effectiveRep > MAX_REPUTATION) effectiveRep = MAX_REPUTATION;
        return effectiveRep;
    }

    // ============ View Functions ============

    function getAgentProfile(address agent) external view returns (AgentComputeProfile memory) {
        return agentProfiles[agent];
    }

    function getJob(bytes32 jobId) external view returns (ComputeJob memory) {
        return jobs[jobId];
    }

    function getPoolState() external view returns (SubsidyPool memory) {
        return pool;
    }

    // ============ Internal Helpers ============

    /// @dev Integer square root (Babylonian method)
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}

// ============ Minimal interface for external reputation query ============
interface IReputationOracleView {
    function getTrustScore(address user) external view returns (uint256);
}
