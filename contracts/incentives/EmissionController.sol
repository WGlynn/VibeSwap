// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ============ Minimal Interfaces ============

interface IVIBEMintable {
    function mint(address to, uint256 amount) external;
    function mintableSupply() external view returns (uint256);
    function MAX_SUPPLY() external view returns (uint256);
}

interface IShapleyCreate {
    struct Participant {
        address participant;
        uint256 directContribution;
        uint256 timeInPool;
        uint256 scarcityScore;
        uint256 stabilityScore;
    }

    function createGameTyped(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        uint8 gameType,
        Participant[] calldata participants
    ) external;

    function computeShapleyValues(bytes32 gameId) external;
}

interface ISingleStakingNotify {
    function notifyRewardAmount(uint256 amount, uint256 duration) external;
}

/**
 * @title EmissionController — VIBE Accumulation Pool
 * @notice Wall-clock emission controller that mints VIBE and splits to three sinks:
 *         Shapley accumulation pool (50%), LiquidityGauge (35%), SingleStaking (15%).
 *
 * @dev Core mechanism:
 *
 *   Wall Clock → baseEmissionRate >> era → drip() mints VIBE → split by budget
 *                                           ├─ 50% → Shapley Pool (compounds until drained)
 *                                           ├─ 35% → LiquidityGauge (streamed directly)
 *                                           └─ 15% → SingleStaking (periodic notify)
 *
 *   Emission math:
 *     - Wall-clock halving: era = (now - genesis) / eraDuration, rate = baseRate >> era
 *     - Cross-era accrual: loop through partial eras (max 32 iterations, bounded gas)
 *     - MAX_SUPPLY guard: cap mint at vibeToken.mintableSupply()
 *
 *   Accumulation pool:
 *     - Shapley share accrues into shapleyPool (not streamed)
 *     - createContributionGame() drains min(drainBps, maxDrainBps)% of pool
 *     - Uses FEE_DISTRIBUTION game type (avoids double-halving)
 *
 *   Bitcoin alignment:
 *     - Zero pre-mine, zero team allocation
 *     - All VIBE earned through contribution
 *     - 21M hard cap enforced by VIBEToken
 */
contract EmissionController is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MAX_ERAS = 32;
    uint256 public constant BPS = 10_000;

    /// @notice Base emission rate: ~10.5M VIBE in Era 0 (year 1)
    /// @dev 10,500,000e18 / 31,557,600s ≈ 332,880,110,000,000,000 wei/s
    uint256 public constant BASE_EMISSION_RATE = 332_880_110_000_000_000;

    /// @notice Default era duration: 1 year (365.25 days = 31,557,600 seconds)
    uint256 public constant DEFAULT_ERA_DURATION = 31_557_600;

    // ============ External Contracts ============

    IVIBEMintable public vibeToken;
    address public shapleyDistributor;
    address public liquidityGauge;
    ISingleStakingNotify public singleStaking;

    // ============ Emission Parameters ============

    uint256 public genesisTime;
    uint256 public eraDuration;
    uint256 public shapleyBps;
    uint256 public gaugeBps;
    uint256 public stakingBps;
    uint256 public maxDrainBps;
    uint256 public minDrainBps;
    uint256 public minDrainAmount;
    uint256 public stakingRewardDuration;

    // ============ Emission State ============

    uint256 public lastDripTime;
    uint256 public shapleyPool;
    uint256 public stakingPending;
    uint256 public totalEmitted;
    uint256 public totalShapleyDrained;
    uint256 public totalGaugeFunded;
    uint256 public totalStakingFunded;

    // ============ Authorization ============

    mapping(address => bool) public authorizedDrainers;

    // ============ Events ============

    event Dripped(uint256 amount, uint256 shapleyShare, uint256 gaugeShare, uint256 stakingShare, uint256 era);
    event ContributionGameCreated(bytes32 indexed gameId, uint256 drainAmount, uint256 participantCount);
    event StakingFunded(uint256 amount, uint256 duration);
    event DrainerUpdated(address indexed drainer, bool authorized);
    event BudgetUpdated(uint256 shapleyBps, uint256 gaugeBps, uint256 stakingBps);
    event MaxDrainUpdated(uint256 maxDrainBps);
    event MinDrainUpdated(uint256 minDrainBps, uint256 minDrainAmount);
    event StakingDurationUpdated(uint256 duration);
    event SinkUpdated(string sink, address addr);

    // ============ Errors ============

    error InvalidBudget();
    error InsufficientPool();
    error DrainTooSmall();
    error DrainTooLarge();
    error NothingToDrip();
    error NothingToFund();
    error Unauthorized();
    error ZeroAddress();
    error InvalidDuration();
    error InvalidBps();

    // ============ Modifiers ============

    modifier onlyDrainer() {
        if (!authorizedDrainers[msg.sender] && msg.sender != owner()) revert Unauthorized();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _vibeToken,
        address _shapleyDistributor,
        address _liquidityGauge,
        address _singleStaking
    ) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        if (_vibeToken == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = IVIBEMintable(_vibeToken);
        shapleyDistributor = _shapleyDistributor;
        liquidityGauge = _liquidityGauge;
        singleStaking = ISingleStakingNotify(_singleStaking);

        genesisTime = block.timestamp;
        lastDripTime = block.timestamp;
        eraDuration = DEFAULT_ERA_DURATION;

        // Default budget: 50/35/15
        shapleyBps = 5000;
        gaugeBps = 3500;
        stakingBps = 1500;

        // Drain parameters — percentage-based minimum (trustless, price-independent)
        maxDrainBps = 5000;
        minDrainBps = 100; // 1% of pool — scales naturally with VIBE price
        minDrainAmount = 0; // No fixed floor by default (governance can set one)

        // Staking reward period
        stakingRewardDuration = 7 days;
    }

    // ============ Core Functions ============

    /**
     * @notice Advance emission clock, mint accrued VIBE, split to sinks
     * @dev Anyone can call. Mints VIBE proportional to wall-clock time elapsed,
     *      with rate halving every eraDuration. Cross-era accrual handled correctly.
     * @return minted Total VIBE minted in this drip
     */
    function drip() external nonReentrant returns (uint256 minted) {
        uint256 pending = pendingEmissions();
        if (pending == 0) revert NothingToDrip();

        // Cap at mintable supply
        uint256 mintable = vibeToken.mintableSupply();
        if (pending > mintable) {
            pending = mintable;
        }
        if (pending == 0) revert NothingToDrip();

        // Update state before external calls
        lastDripTime = block.timestamp;
        totalEmitted += pending;

        // Mint to self
        vibeToken.mint(address(this), pending);

        // Split by budget
        uint256 shapleyShare = (pending * shapleyBps) / BPS;
        uint256 gaugeShare = (pending * gaugeBps) / BPS;
        uint256 stakingShare = pending - shapleyShare - gaugeShare; // remainder avoids dust

        // Shapley: accumulate in pool
        shapleyPool += shapleyShare;

        // Gauge: stream directly (if configured), else redirect to Shapley pool
        if (liquidityGauge != address(0) && gaugeShare > 0) {
            IERC20(address(vibeToken)).safeTransfer(liquidityGauge, gaugeShare);
            totalGaugeFunded += gaugeShare;
        } else if (gaugeShare > 0) {
            // No gauge configured — redirect to contribution rewards (prevents orphaned tokens)
            shapleyPool += gaugeShare;
        }

        // Staking: accumulate pending
        stakingPending += stakingShare;

        emit Dripped(pending, shapleyShare, gaugeShare, stakingShare, getCurrentEra());
        return pending;
    }

    /**
     * @notice Drain Shapley pool to create a ShapleyDistributor game
     * @dev Transfers VIBE to ShapleyDistributor and creates a FEE_DISTRIBUTION game
     *      (not TOKEN_EMISSION — EmissionController already applies wall-clock halving).
     *      Also settles the game immediately so rewards are claimable.
     * @param gameId Unique game identifier
     * @param participants Participant array for the Shapley game
     * @param drainBps Percentage of pool to drain (in basis points, capped at maxDrainBps)
     */
    function createContributionGame(
        bytes32 gameId,
        IShapleyCreate.Participant[] calldata participants,
        uint256 drainBps
    ) external onlyDrainer nonReentrant {
        if (drainBps > maxDrainBps) revert DrainTooLarge();

        uint256 drainAmount = (shapleyPool * drainBps) / BPS;
        if (drainAmount == 0) revert DrainTooSmall();

        // Percentage-based minimum (trustless, scales with VIBE price)
        uint256 percentMin = (shapleyPool * minDrainBps) / BPS;
        // Use the higher of percentage minimum and absolute floor
        uint256 effectiveMin = percentMin > minDrainAmount ? percentMin : minDrainAmount;
        if (drainAmount < effectiveMin) revert DrainTooSmall();

        // Update pool
        shapleyPool -= drainAmount;
        totalShapleyDrained += drainAmount;

        // Transfer VIBE to ShapleyDistributor (so claimReward can transfer to participants)
        IERC20(address(vibeToken)).safeTransfer(shapleyDistributor, drainAmount);

        // Create game with FEE_DISTRIBUTION (uint8(0)) to avoid double-halving
        IShapleyCreate(shapleyDistributor).createGameTyped(
            gameId,
            drainAmount,
            address(vibeToken),
            0, // FEE_DISTRIBUTION
            participants
        );

        // Settle immediately so rewards are claimable
        IShapleyCreate(shapleyDistributor).computeShapleyValues(gameId);

        emit ContributionGameCreated(gameId, drainAmount, participants.length);
    }

    /**
     * @notice Fund SingleStaking with accumulated pending rewards
     * @dev Approves SingleStaking and calls notifyRewardAmount.
     *      Requires EmissionController to be the owner of SingleStaking.
     *      Anyone can call — permissionless protocol operation.
     */
    function fundStaking() external nonReentrant {
        uint256 amount = stakingPending;
        if (amount == 0) revert NothingToFund();

        stakingPending = 0;
        totalStakingFunded += amount;

        // Approve and notify
        IERC20(address(vibeToken)).forceApprove(address(singleStaking), amount);
        singleStaking.notifyRewardAmount(amount, stakingRewardDuration);

        emit StakingFunded(amount, stakingRewardDuration);
    }

    // ============ View Functions ============

    /**
     * @notice Get current wall-clock era (0-32)
     */
    function getCurrentEra() public view returns (uint256) {
        if (eraDuration == 0) return 0;
        uint256 elapsed = block.timestamp - genesisTime;
        uint256 era = elapsed / eraDuration;
        return era > MAX_ERAS ? MAX_ERAS : era;
    }

    /**
     * @notice Get current emission rate (baseRate >> era)
     */
    function getCurrentRate() public view returns (uint256) {
        uint256 era = getCurrentEra();
        if (era >= MAX_ERAS) return 0;
        return BASE_EMISSION_RATE >> era;
    }

    /**
     * @notice Calculate unminted emissions since last drip
     * @dev Loops through eras, calculating time overlap with [lastDripTime, now].
     *      Bounded at MAX_ERAS iterations (32), so gas is predictable.
     */
    function pendingEmissions() public view returns (uint256 total) {
        uint256 lastTime = lastDripTime;
        uint256 currentTime = block.timestamp;
        if (currentTime <= lastTime) return 0;

        uint256 genesis = genesisTime;
        uint256 dur = eraDuration;

        for (uint256 era = 0; era <= MAX_ERAS; era++) {
            uint256 rate = BASE_EMISSION_RATE >> era;
            if (rate == 0) break;

            uint256 eraStart = genesis + era * dur;
            uint256 eraEnd = genesis + (era + 1) * dur;

            // Skip eras fully before lastTime
            if (eraEnd <= lastTime) continue;
            // Stop if era starts after currentTime
            if (eraStart >= currentTime) break;

            uint256 start = lastTime > eraStart ? lastTime : eraStart;
            uint256 end = currentTime < eraEnd ? currentTime : eraEnd;

            total += rate * (end - start);
        }
    }

    /**
     * @notice Full emission dashboard
     */
    function getEmissionInfo() external view returns (
        uint256 currentEra,
        uint256 currentRate,
        uint256 pool,
        uint256 pending,
        uint256 emitted,
        uint256 remaining
    ) {
        currentEra = getCurrentEra();
        currentRate = getCurrentRate();
        pool = shapleyPool;
        pending = pendingEmissions();
        emitted = totalEmitted;
        remaining = vibeToken.mintableSupply();
    }

    // ============ Admin Functions ============

    function setBudget(uint256 _shapleyBps, uint256 _gaugeBps, uint256 _stakingBps) external onlyOwner {
        if (_shapleyBps + _gaugeBps + _stakingBps != BPS) revert InvalidBudget();
        shapleyBps = _shapleyBps;
        gaugeBps = _gaugeBps;
        stakingBps = _stakingBps;
        emit BudgetUpdated(_shapleyBps, _gaugeBps, _stakingBps);
    }

    function setMaxDrainBps(uint256 _maxDrainBps) external onlyOwner {
        if (_maxDrainBps > BPS) revert InvalidBps();
        maxDrainBps = _maxDrainBps;
        emit MaxDrainUpdated(_maxDrainBps);
    }

    function setMinDrain(uint256 _minDrainBps, uint256 _minDrainAmount) external onlyOwner {
        if (_minDrainBps > BPS) revert InvalidBps();
        minDrainBps = _minDrainBps;
        minDrainAmount = _minDrainAmount;
        emit MinDrainUpdated(_minDrainBps, _minDrainAmount);
    }

    function setStakingRewardDuration(uint256 _duration) external onlyOwner {
        if (_duration == 0) revert InvalidDuration();
        stakingRewardDuration = _duration;
        emit StakingDurationUpdated(_duration);
    }

    function setAuthorizedDrainer(address drainer, bool authorized) external onlyOwner {
        if (drainer == address(0)) revert ZeroAddress();
        authorizedDrainers[drainer] = authorized;
        emit DrainerUpdated(drainer, authorized);
    }

    function setLiquidityGauge(address _gauge) external onlyOwner {
        liquidityGauge = _gauge;
        emit SinkUpdated("gauge", _gauge);
    }

    function setSingleStaking(address _staking) external onlyOwner {
        singleStaking = ISingleStakingNotify(_staking);
        emit SinkUpdated("staking", _staking);
    }

    function setShapleyDistributor(address _shapley) external onlyOwner {
        if (_shapley == address(0)) revert ZeroAddress();
        shapleyDistributor = _shapley;
        emit SinkUpdated("shapley", _shapley);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
