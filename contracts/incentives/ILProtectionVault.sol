// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IILProtectionVault.sol";
import "./interfaces/IVolatilityOracle.sol";

/**
 * @title ILProtectionVault
 * @notice Provides impermanent loss protection for LPs with tiered coverage
 * @dev Tracks LP positions, calculates IL, and processes claims based on coverage tiers
 */
contract ILProtectionVault is
    IILProtectionVault,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant PRECISION = 1e18;
    uint8 public constant MAX_TIER = 2; // 0, 1, 2

    // ============ State ============

    IVolatilityOracle public volatilityOracle;
    address public incentiveController;
    address public vibeAMM;

    // Pool ID => LP => Position
    mapping(bytes32 => mapping(address => LPPosition)) public positions;

    // Tier => Config
    mapping(uint8 => TierConfig) public tierConfigs;

    // Token => Reserve balance
    mapping(address => uint256) public reserves;

    // Pool ID => Token (for claims)
    mapping(bytes32 => address) public poolQuoteTokens;

    // Stats
    uint256 public totalILPaid;
    uint256 public totalPositionsRegistered;

    // ============ Errors ============

    error Unauthorized();
    error InvalidTier();
    error InvalidAmount();
    error NoPosition();
    error MinDurationNotMet();
    error InsufficientReserves();
    error ZeroAddress();
    error PositionAlreadyExists();

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
        address _incentiveController,
        address _vibeAMM
    ) external initializer {
        if (_volatilityOracle == address(0) ||
            _incentiveController == address(0) ||
            _vibeAMM == address(0)) {
            revert ZeroAddress();
        }

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        volatilityOracle = IVolatilityOracle(_volatilityOracle);
        incentiveController = _incentiveController;
        vibeAMM = _vibeAMM;

        // Initialize default tiers
        tierConfigs[0] = TierConfig({
            coverageRateBps: 2500,      // 25% coverage
            minDuration: 0,              // No minimum
            active: true
        });

        tierConfigs[1] = TierConfig({
            coverageRateBps: 5000,      // 50% coverage
            minDuration: 30 days,
            active: true
        });

        tierConfigs[2] = TierConfig({
            coverageRateBps: 8000,      // 80% coverage
            minDuration: 90 days,
            active: true
        });
    }

    // ============ External Functions ============

    /**
     * @notice Register a new LP position
     * @param poolId Pool identifier
     * @param lp LP address
     * @param liquidity Liquidity amount
     * @param entryPrice TWAP price at entry
     * @param tier Protection tier (0-2)
     */
    function registerPosition(
        bytes32 poolId,
        address lp,
        uint256 liquidity,
        uint256 entryPrice,
        uint8 tier
    ) external override onlyController {
        if (tier > MAX_TIER) revert InvalidTier();
        if (liquidity == 0) revert InvalidAmount();

        LPPosition storage position = positions[poolId][lp];

        // If position exists, update it instead
        if (position.liquidity > 0) {
            // Weight-average the entry price
            uint256 totalLiquidity = position.liquidity + liquidity;
            position.entryPrice = (
                (position.entryPrice * position.liquidity) +
                (entryPrice * liquidity)
            ) / totalLiquidity;
            position.liquidity = totalLiquidity;
        } else {
            position.liquidity = liquidity;
            position.entryPrice = entryPrice;
            position.depositTimestamp = uint64(block.timestamp);
            position.protectionTier = tier;
            totalPositionsRegistered++;
        }

        emit PositionRegistered(poolId, lp, liquidity, entryPrice, tier);
    }

    /**
     * @notice Update position liquidity (for additions)
     * @param poolId Pool identifier
     * @param lp LP address
     * @param newLiquidity New total liquidity
     */
    function updatePosition(
        bytes32 poolId,
        address lp,
        uint256 newLiquidity
    ) external override onlyController {
        LPPosition storage position = positions[poolId][lp];
        if (position.liquidity == 0) revert NoPosition();

        position.liquidity = newLiquidity;
        emit PositionUpdated(poolId, lp, newLiquidity);
    }

    /**
     * @notice Close position and calculate compensation
     * @param poolId Pool identifier
     * @param lp LP address
     * @param exitPrice Current price at exit
     */
    function closePosition(
        bytes32 poolId,
        address lp,
        uint256 exitPrice
    ) external override onlyController returns (uint256 ilAmount, uint256 compensation) {
        LPPosition storage position = positions[poolId][lp];
        if (position.liquidity == 0) revert NoPosition();

        // Calculate IL
        uint256 ilBps = calculateIL(position.entryPrice, exitPrice);
        ilAmount = (position.liquidity * ilBps) / BPS_PRECISION;

        // Check tier eligibility
        TierConfig storage tierConfig = tierConfigs[position.protectionTier];
        uint256 timeStaked = block.timestamp - position.depositTimestamp;

        if (timeStaked >= tierConfig.minDuration && tierConfig.active) {
            // Calculate compensation
            uint256 coverableIL = (ilAmount * tierConfig.coverageRateBps) / BPS_PRECISION;
            compensation = coverableIL > position.ilClaimed
                ? coverableIL - position.ilClaimed
                : 0;
        }

        // Update position
        position.ilAccrued = ilAmount;

        emit PositionClosed(poolId, lp, ilAmount, compensation);
    }

    /**
     * @notice Calculate IL between two prices
     * @param entryPrice Entry price
     * @param exitPrice Exit price
     * @return ilBps IL in basis points
     */
    function calculateIL(
        uint256 entryPrice,
        uint256 exitPrice
    ) public pure override returns (uint256 ilBps) {
        if (entryPrice == 0 || exitPrice == 0) return 0;

        // IL formula: 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
        // Returns the percentage loss compared to holding

        uint256 priceRatio;
        if (exitPrice >= entryPrice) {
            priceRatio = (exitPrice * PRECISION) / entryPrice;
        } else {
            priceRatio = (entryPrice * PRECISION) / exitPrice;
        }

        // sqrt(priceRatio) using Babylonian method
        uint256 sqrtRatio = _sqrt(priceRatio * PRECISION);

        // 2 * sqrt / (1 + ratio) - scaled to avoid precision loss
        uint256 numerator = 2 * sqrtRatio;
        uint256 denominator = PRECISION + priceRatio;

        uint256 value = (numerator * PRECISION) / denominator;

        // IL = 1 - value (if value < 1)
        if (value < PRECISION) {
            ilBps = ((PRECISION - value) * BPS_PRECISION) / PRECISION;
        } else {
            ilBps = 0;
        }
    }

    /**
     * @notice Calculate current IL for a position
     * @param poolId Pool identifier
     * @param lp LP address
     */
    function calculateCurrentIL(
        bytes32 poolId,
        address lp
    ) external view override returns (uint256 ilBps) {
        LPPosition storage position = positions[poolId][lp];
        if (position.liquidity == 0) return 0;

        // Get current price from volatility oracle (which queries AMM)
        (uint256 volatility, , ) = volatilityOracle.getVolatilityData(poolId);
        // For simplicity, assume we'd need to get current price from AMM
        // This is a view function, so we return stored IL if any
        return position.ilAccrued > 0
            ? (position.ilAccrued * BPS_PRECISION) / position.liquidity
            : 0;
    }

    /**
     * @notice Claim IL protection
     * @param poolId Pool identifier
     * @param lp LP address (caller must be LP or controller)
     */
    function claimProtection(
        bytes32 poolId,
        address lp
    ) external override nonReentrant returns (uint256 amount) {
        // Allow LP to claim for themselves or controller to claim on behalf
        if (msg.sender != lp && msg.sender != incentiveController) {
            revert Unauthorized();
        }

        LPPosition storage position = positions[poolId][lp];
        if (position.liquidity == 0) revert NoPosition();

        TierConfig storage tierConfig = tierConfigs[position.protectionTier];

        // Check minimum duration
        uint256 timeStaked = block.timestamp - position.depositTimestamp;
        if (timeStaked < tierConfig.minDuration) revert MinDurationNotMet();

        // Calculate claimable
        uint256 coverableIL = (position.ilAccrued * tierConfig.coverageRateBps) / BPS_PRECISION;
        amount = coverableIL > position.ilClaimed ? coverableIL - position.ilClaimed : 0;

        if (amount == 0) return 0;

        // Get payout token
        address token = poolQuoteTokens[poolId];
        if (token == address(0)) revert InvalidAmount();

        if (reserves[token] < amount) revert InsufficientReserves();

        // Update state
        position.ilClaimed += amount;
        reserves[token] -= amount;
        totalILPaid += amount;

        // Transfer
        IERC20(token).safeTransfer(lp, amount);

        emit ProtectionClaimed(poolId, lp, amount);
    }

    /**
     * @notice Get claimable amount for LP
     */
    function getClaimableAmount(
        bytes32 poolId,
        address lp
    ) external view override returns (uint256) {
        LPPosition storage position = positions[poolId][lp];
        if (position.liquidity == 0) return 0;

        TierConfig storage tierConfig = tierConfigs[position.protectionTier];

        uint256 timeStaked = block.timestamp - position.depositTimestamp;
        if (timeStaked < tierConfig.minDuration) return 0;

        uint256 coverableIL = (position.ilAccrued * tierConfig.coverageRateBps) / BPS_PRECISION;
        return coverableIL > position.ilClaimed ? coverableIL - position.ilClaimed : 0;
    }

    // ============ View Functions ============

    function getPosition(
        bytes32 poolId,
        address lp
    ) external view override returns (LPPosition memory) {
        return positions[poolId][lp];
    }

    function getTierConfig(uint8 tier) external view override returns (TierConfig memory) {
        return tierConfigs[tier];
    }

    function getTotalReserves(address token) external view override returns (uint256) {
        return reserves[token];
    }

    // ============ Admin Functions ============

    /**
     * @notice Configure a protection tier
     */
    function configureTier(
        uint8 tier,
        uint256 coverageRateBps,
        uint64 minDuration
    ) external override onlyOwner {
        if (tier > MAX_TIER) revert InvalidTier();
        if (coverageRateBps > BPS_PRECISION) revert InvalidAmount();

        tierConfigs[tier] = TierConfig({
            coverageRateBps: coverageRateBps,
            minDuration: minDuration,
            active: true
        });

        emit TierConfigured(tier, coverageRateBps, minDuration);
    }

    /**
     * @notice Deposit funds into protection pool
     */
    function depositFunds(address token, uint256 amount) external override {
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        reserves[token] += amount;

        emit FundsDeposited(token, amount);
    }

    /**
     * @notice Set quote token for a pool
     */
    function setPoolQuoteToken(bytes32 poolId, address token) external onlyOwner {
        poolQuoteTokens[poolId] = token;
    }

    /**
     * @notice Set incentive controller
     */
    function setIncentiveController(address _controller) external onlyOwner {
        if (_controller == address(0)) revert ZeroAddress();
        incentiveController = _controller;
    }

    // ============ Internal Functions ============

    /**
     * @notice Integer square root
     */
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
