// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IVolatilityOracle.sol";

/**
 * @title VolatilityInsurancePool
 * @notice Receives excess fees during high volatility and pays out during extreme events
 * @dev Insurance for LPs against volatility-induced losses during circuit breaker events
 */
contract VolatilityInsurancePool is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant PRECISION = 1e18;

    // ============ Structs ============

    struct PoolInsurance {
        uint256 reserveBalance;        // Current reserve for this pool's token
        uint256 targetReserve;         // Target reserve level
        uint256 totalDeposited;        // Total fees deposited
        uint256 totalClaimsPaid;       // Total claims paid out
        uint64 lastClaimTimestamp;     // Last claim for cooldown
    }

    struct LPCoverage {
        uint256 liquidityAtRisk;       // LP's liquidity eligible for coverage
        uint256 lastUpdateTimestamp;   // Last time coverage was updated
        uint256 claimedAmount;         // Amount already claimed
    }

    struct ClaimEvent {
        bytes32 poolId;
        uint64 timestamp;
        uint256 totalPayout;
        uint256 triggerPrice;
        bool processed;
    }

    // ============ State ============

    IVolatilityOracle public volatilityOracle;
    address public incentiveController;

    // Pool ID => Token => Insurance data
    mapping(bytes32 => mapping(address => PoolInsurance)) public poolInsurance;

    // Pool ID => LP Address => Coverage
    mapping(bytes32 => mapping(address => LPCoverage)) public lpCoverage;

    // Pool ID => Total LP liquidity covered
    mapping(bytes32 => uint256) public totalCoveredLiquidity;

    // Claim events for circuit breaker triggers
    ClaimEvent[] public claimEvents;
    mapping(bytes32 => uint256[]) public poolClaimEvents; // poolId => event indices

    // Per-event claim tracking: user => eventIndex => claimed
    mapping(address => mapping(uint256 => bool)) public hasClaimedEvent;

    // Configuration
    uint256 public claimCooldownPeriod;
    uint256 public maxClaimPercentBps;    // Max % of reserve per claim
    uint256 public minVolatilityTierForClaim; // Minimum tier to trigger claims

    // ============ Events ============

    event FeesDeposited(bytes32 indexed poolId, address indexed token, uint256 amount);
    event ClaimTriggered(bytes32 indexed poolId, uint256 eventIndex, uint256 totalPayout);
    event InsuranceClaimed(bytes32 indexed poolId, address indexed lp, uint256 amount);
    event CoverageUpdated(bytes32 indexed poolId, address indexed lp, uint256 liquidity);
    event TargetReserveSet(bytes32 indexed poolId, address indexed token, uint256 target);

    // ============ Errors ============

    error Unauthorized();
    error InsufficientReserves();
    error ClaimCooldownActive();
    error NoCoverageAvailable();
    error AlreadyClaimed();
    error InvalidAmount();
    error ZeroAddress();

    // ============ Modifiers ============

    modifier onlyController() {
        if (msg.sender != incentiveController) revert Unauthorized();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _volatilityOracle,
        address _incentiveController
    ) external initializer {
        if (_volatilityOracle == address(0) || _incentiveController == address(0)) {
            revert ZeroAddress();
        }

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        volatilityOracle = IVolatilityOracle(_volatilityOracle);
        incentiveController = _incentiveController;

        claimCooldownPeriod = 24 hours;
        maxClaimPercentBps = 5000; // 50% of reserves max per claim
        minVolatilityTierForClaim = uint256(IVolatilityOracle.VolatilityTier.EXTREME);
    }

    // ============ External Functions ============

    /**
     * @notice Deposit volatility fees into insurance pool
     * @param poolId Pool identifier
     * @param token Token address
     * @param amount Amount to deposit
     */
    function depositFees(
        bytes32 poolId,
        address token,
        uint256 amount
    ) external onlyController {
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        PoolInsurance storage insurance = poolInsurance[poolId][token];
        insurance.reserveBalance += amount;
        insurance.totalDeposited += amount;

        emit FeesDeposited(poolId, token, amount);
    }

    /**
     * @notice Register LP coverage
     * @param poolId Pool identifier
     * @param lp LP address
     * @param liquidity Liquidity amount to cover
     */
    function registerCoverage(
        bytes32 poolId,
        address lp,
        uint256 liquidity
    ) external onlyController {
        LPCoverage storage coverage = lpCoverage[poolId][lp];
        uint256 oldLiquidity = coverage.liquidityAtRisk;

        // Atomic update: only modify totalCoveredLiquidity if value changed
        if (oldLiquidity != liquidity) {
            if (oldLiquidity > 0) {
                totalCoveredLiquidity[poolId] -= oldLiquidity;
            }
            totalCoveredLiquidity[poolId] += liquidity;
            coverage.liquidityAtRisk = liquidity;
        }

        coverage.lastUpdateTimestamp = block.timestamp;
        emit CoverageUpdated(poolId, lp, liquidity);
    }

    /**
     * @notice Remove LP coverage when they withdraw
     * @param poolId Pool identifier
     * @param lp LP address
     */
    function removeCoverage(
        bytes32 poolId,
        address lp
    ) external onlyController {
        LPCoverage storage coverage = lpCoverage[poolId][lp];

        if (coverage.liquidityAtRisk > 0) {
            totalCoveredLiquidity[poolId] -= coverage.liquidityAtRisk;
            coverage.liquidityAtRisk = 0;
        }

        emit CoverageUpdated(poolId, lp, 0);
    }

    /**
     * @notice Trigger insurance claim event (called when circuit breaker trips)
     * @param poolId Pool identifier
     * @param token Token for payout
     * @param triggerPrice Price at trigger
     */
    function triggerClaimEvent(
        bytes32 poolId,
        address token,
        uint256 triggerPrice
    ) external onlyController nonReentrant returns (uint256 eventIndex) {
        PoolInsurance storage insurance = poolInsurance[poolId][token];

        // Check cooldown
        if (block.timestamp < insurance.lastClaimTimestamp + claimCooldownPeriod) {
            revert ClaimCooldownActive();
        }

        // Check volatility tier
        IVolatilityOracle.VolatilityTier tier = volatilityOracle.getVolatilityTier(poolId);
        if (uint256(tier) < minVolatilityTierForClaim) {
            revert NoCoverageAvailable();
        }

        // Calculate payout (capped at maxClaimPercent of reserves)
        uint256 maxPayout = (insurance.reserveBalance * maxClaimPercentBps) / BPS_PRECISION;
        uint256 payout = maxPayout; // Could be based on actual losses

        if (payout > insurance.reserveBalance) {
            payout = insurance.reserveBalance;
        }

        // Create claim event
        eventIndex = claimEvents.length;
        claimEvents.push(ClaimEvent({
            poolId: poolId,
            timestamp: uint64(block.timestamp),
            totalPayout: payout,
            triggerPrice: triggerPrice,
            processed: false
        }));

        poolClaimEvents[poolId].push(eventIndex);
        insurance.lastClaimTimestamp = uint64(block.timestamp);

        emit ClaimTriggered(poolId, eventIndex, payout);
    }

    /**
     * @notice Claim insurance payout for an LP
     * @param eventIndex Claim event index
     * @param token Token to claim
     */
    function claimInsurance(
        uint256 eventIndex,
        address token
    ) external nonReentrant returns (uint256 amount) {
        // Per-event claim tracking — prevents double-claims AND ensures each event pays independently
        if (hasClaimedEvent[msg.sender][eventIndex]) revert AlreadyClaimed();

        ClaimEvent storage claimEvent = claimEvents[eventIndex];
        bytes32 poolId = claimEvent.poolId;

        LPCoverage storage coverage = lpCoverage[poolId][msg.sender];
        if (coverage.liquidityAtRisk == 0) revert NoCoverageAvailable();

        // Calculate pro-rata share for THIS event
        uint256 totalCovered = totalCoveredLiquidity[poolId];
        if (totalCovered == 0) revert NoCoverageAvailable();

        amount = (claimEvent.totalPayout * coverage.liquidityAtRisk) / totalCovered;

        PoolInsurance storage insurance = poolInsurance[poolId][token];
        if (amount > insurance.reserveBalance) {
            amount = insurance.reserveBalance;
        }

        if (amount == 0) revert InsufficientReserves();

        // Update state — mark event as claimed BEFORE transfer (CEI pattern)
        hasClaimedEvent[msg.sender][eventIndex] = true;
        coverage.claimedAmount += amount;
        insurance.reserveBalance -= amount;
        insurance.totalClaimsPaid += amount;

        // Transfer
        IERC20(token).safeTransfer(msg.sender, amount);

        emit InsuranceClaimed(poolId, msg.sender, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Get insurance data for a pool
     * @param poolId Pool identifier
     * @param token Token address
     */
    function getPoolInsurance(
        bytes32 poolId,
        address token
    ) external view returns (PoolInsurance memory) {
        return poolInsurance[poolId][token];
    }

    /**
     * @notice Get LP coverage
     * @param poolId Pool identifier
     * @param lp LP address
     */
    function getLPCoverage(
        bytes32 poolId,
        address lp
    ) external view returns (LPCoverage memory) {
        return lpCoverage[poolId][lp];
    }

    /**
     * @notice Get pending claim amount for LP
     * @param poolId Pool identifier
     * @param lp LP address
     * @param token Token address
     */
    function getPendingClaim(
        bytes32 poolId,
        address lp,
        address token
    ) external view returns (uint256) {
        LPCoverage storage coverage = lpCoverage[poolId][lp];
        uint256 totalCovered = totalCoveredLiquidity[poolId];

        if (coverage.liquidityAtRisk == 0 || totalCovered == 0) {
            return 0;
        }

        // Sum up unclaimed events for this pool
        uint256[] storage eventIndices = poolClaimEvents[poolId];
        uint256 totalUnclaimed;

        for (uint256 i = 0; i < eventIndices.length; i++) {
            uint256 eventIdx = eventIndices[i];
            if (!hasClaimedEvent[lp][eventIdx]) {
                ClaimEvent storage claimEvent = claimEvents[eventIdx];
                totalUnclaimed += (claimEvent.totalPayout * coverage.liquidityAtRisk) / totalCovered;
            }
        }

        return totalUnclaimed;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set target reserve for a pool
     * @param poolId Pool identifier
     * @param token Token address
     * @param target Target reserve amount
     */
    function setTargetReserve(
        bytes32 poolId,
        address token,
        uint256 target
    ) external onlyOwner {
        poolInsurance[poolId][token].targetReserve = target;
        emit TargetReserveSet(poolId, token, target);
    }

    /**
     * @notice Set claim parameters
     * @param _cooldownPeriod Cooldown between claims
     * @param _maxClaimPercentBps Max claim percentage
     * @param _minTier Minimum volatility tier for claims
     */
    function setClaimParameters(
        uint256 _cooldownPeriod,
        uint256 _maxClaimPercentBps,
        uint256 _minTier
    ) external onlyOwner {
        claimCooldownPeriod = _cooldownPeriod;
        maxClaimPercentBps = _maxClaimPercentBps;
        minVolatilityTierForClaim = _minTier;
    }

    /**
     * @notice Set incentive controller
     * @param _controller New controller address
     */
    function setIncentiveController(address _controller) external onlyOwner {
        if (_controller == address(0)) revert ZeroAddress();
        incentiveController = _controller;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
