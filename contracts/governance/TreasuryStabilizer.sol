// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ITreasuryStabilizer.sol";
import "../incentives/interfaces/IVolatilityOracle.sol";
import "../core/interfaces/IVibeAMM.sol";
import "../core/interfaces/IDAOTreasury.sol";

/**
 * @title TreasuryStabilizer
 * @notice Counter-cyclical treasury operations for market stabilization
 * @dev Monitors market conditions and deploys treasury backstop during bear markets
 */
contract TreasuryStabilizer is
    ITreasuryStabilizer,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant PRECISION = 1e18;
    uint64 public constant MIN_ASSESSMENT_PERIOD = 1 hours;
    uint64 public constant MAX_DEPLOYMENT_PERIOD = 7 days;

    // ============ State ============

    IVibeAMM public vibeAMM;
    IDAOTreasury public daoTreasury;
    IVolatilityOracle public volatilityOracle;

    // Token => Config
    mapping(address => StabilizerConfig) public tokenConfigs;

    // Token => Market state
    mapping(address => MarketState) public tokenMarketStates;

    // Token => Deployment history
    mapping(address => DeploymentRecord[]) public deploymentHistory;

    // Emergency mode per token
    mapping(address => bool) public emergencyMode;

    // Token => Main pool ID (for TWAP price queries)
    mapping(address => bytes32) public tokenMainPool;

    // TWAP periods for trend calculation
    uint32 public shortTermPeriod;
    uint32 public longTermPeriod;

    // ============ Errors ============

    error Unauthorized();
    error InvalidConfig();
    error InvalidAmount();
    error CooldownActive();
    error NotBearMarket();
    error DeploymentLimitReached();
    error EmergencyModeActive();
    error ZeroAddress();
    error AssessmentTooSoon();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _vibeAMM,
        address _daoTreasury,
        address _volatilityOracle
    ) external initializer {
        if (_vibeAMM == address(0) || _daoTreasury == address(0) || _volatilityOracle == address(0)) {
            revert ZeroAddress();
        }

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        vibeAMM = IVibeAMM(_vibeAMM);
        daoTreasury = IDAOTreasury(_daoTreasury);
        volatilityOracle = IVolatilityOracle(_volatilityOracle);

        shortTermPeriod = 1 hours;
        longTermPeriod = 7 days;
    }

    // ============ Market Assessment ============

    /**
     * @notice Assess market conditions for a token
     * @param token Token to assess
     */
    function assessMarketConditions(address token) external override whenNotPaused {
        StabilizerConfig storage config = tokenConfigs[token];
        if (!config.enabled) revert InvalidConfig();

        MarketState storage state = tokenMarketStates[token];

        // Check assessment cooldown
        if (block.timestamp < state.lastAssessment + config.assessmentPeriod) {
            revert AssessmentTooSoon();
        }

        // Get price data from volatility oracle or AMM
        // For simplicity, using a mock calculation
        // In production, would query TWAP oracle

        bytes32 poolId = _getMainPool(token);
        if (poolId == bytes32(0)) revert InvalidConfig();

        // Calculate price trend
        // Negative trend indicates price decline
        int256 trend = _calculateTrend(poolId);

        // Determine bear market
        bool wasBearMarket = state.isBearMarket;
        state.isBearMarket = trend < -int256(config.bearMarketThresholdBps);
        state.currentTrend = trend;
        state.lastAssessment = uint64(block.timestamp);

        // Reset period if transitioning to bull
        if (wasBearMarket && !state.isBearMarket) {
            state.deployedThisPeriod = 0;
            state.periodStart = uint64(block.timestamp);
        }

        emit MarketAssessed(token, trend, state.isBearMarket);
    }

    /**
     * @notice Check if token is in bear market
     * @param token Token to check
     */
    function isBearMarket(address token) external view override returns (bool) {
        return tokenMarketStates[token].isBearMarket;
    }

    /**
     * @notice Get market state for token
     * @param token Token address
     */
    function getMarketState(address token) external view override returns (MarketState memory) {
        return tokenMarketStates[token];
    }

    // ============ Deployment ============

    /**
     * @notice Check if backstop should be deployed
     * @param token Token to check
     * @return should Whether deployment should occur
     * @return amount Recommended deployment amount
     */
    function shouldDeployBackstop(address token) external view override returns (bool should, uint256 amount) {
        if (emergencyMode[token]) return (false, 0);

        StabilizerConfig storage config = tokenConfigs[token];
        MarketState storage state = tokenMarketStates[token];

        if (!config.enabled || !state.isBearMarket) {
            return (false, 0);
        }

        // Check cooldown
        DeploymentRecord[] storage history = deploymentHistory[token];
        if (history.length > 0) {
            DeploymentRecord storage lastDeployment = history[history.length - 1];
            if (block.timestamp < lastDeployment.timestamp + config.deploymentCooldown) {
                return (false, 0);
            }
        }

        // Check period limit
        if (block.timestamp > state.periodStart + MAX_DEPLOYMENT_PERIOD) {
            // Reset period
            // Note: can't modify state in view function, so this is informational
        }

        if (state.deployedThisPeriod >= config.maxDeploymentPerPeriod) {
            return (false, 0);
        }

        // Calculate deployment amount
        uint256 treasuryBalance = IERC20(token).balanceOf(address(daoTreasury));
        amount = (treasuryBalance * config.deploymentRateBps) / BPS_PRECISION;

        // Cap at remaining period limit
        uint256 remaining = config.maxDeploymentPerPeriod - state.deployedThisPeriod;
        if (amount > remaining) {
            amount = remaining;
        }

        return (amount > 0, amount);
    }

    /**
     * @notice Execute backstop deployment
     * @param token Token to deploy
     * @param poolId Target pool
     */
    function executeDeployment(
        address token,
        bytes32 poolId
    ) external override nonReentrant whenNotPaused returns (uint256 deployed) {
        if (emergencyMode[token]) revert EmergencyModeActive();

        StabilizerConfig storage config = tokenConfigs[token];
        MarketState storage state = tokenMarketStates[token];

        if (!config.enabled) revert InvalidConfig();
        if (!state.isBearMarket) revert NotBearMarket();

        // Check cooldown
        DeploymentRecord[] storage history = deploymentHistory[token];
        if (history.length > 0) {
            DeploymentRecord storage lastDeployment = history[history.length - 1];
            if (block.timestamp < lastDeployment.timestamp + config.deploymentCooldown) {
                revert CooldownActive();
            }
        }

        // Reset period if needed
        if (block.timestamp > state.periodStart + MAX_DEPLOYMENT_PERIOD) {
            state.deployedThisPeriod = 0;
            state.periodStart = uint64(block.timestamp);
        }

        // Check period limit
        if (state.deployedThisPeriod >= config.maxDeploymentPerPeriod) {
            revert DeploymentLimitReached();
        }

        // Calculate deployment amount
        uint256 treasuryBalance = IERC20(token).balanceOf(address(daoTreasury));
        deployed = (treasuryBalance * config.deploymentRateBps) / BPS_PRECISION;

        // Cap at remaining period limit
        uint256 remaining = config.maxDeploymentPerPeriod - state.deployedThisPeriod;
        if (deployed > remaining) {
            deployed = remaining;
        }

        if (deployed == 0) revert InvalidAmount();

        // Calculate token1 amount from pool ratio
        uint256 token1Amount;
        try vibeAMM.getPool(poolId) returns (IVibeAMM.Pool memory pool) {
            if (pool.reserve0 > 0) {
                token1Amount = (deployed * pool.reserve1) / pool.reserve0;
            } else {
                token1Amount = deployed; // First deposit: 1:1 ratio
            }
        } catch {
            token1Amount = deployed; // Fallback: 1:1 ratio
        }

        // Request treasury to provide liquidity
        // This requires treasury to have authorized this contract
        daoTreasury.provideBackstopLiquidity(poolId, deployed, token1Amount);

        // Record deployment
        uint256 lpTokens = 0; // Would get from treasury.lpPositions
        history.push(DeploymentRecord({
            poolId: poolId,
            amount: deployed,
            timestamp: uint64(block.timestamp),
            lpTokensReceived: lpTokens
        }));

        state.deployedThisPeriod += deployed;
        state.totalDeployed += deployed;

        emit BackstopDeployed(token, poolId, deployed);
    }

    /**
     * @notice Withdraw deployed backstop liquidity
     * @param token Token to withdraw
     * @param poolId Pool to withdraw from
     * @param lpAmount LP tokens to burn
     */
    function withdrawDeployment(
        address token,
        bytes32 poolId,
        uint256 lpAmount
    ) external override onlyOwner nonReentrant returns (uint256 received) {
        // Request treasury to remove backstop liquidity
        try daoTreasury.removeBackstopLiquidity(poolId, lpAmount, 0, 0) returns (uint256 amount) {
            received = amount;
        } catch {
            received = 0;
        }

        emit BackstopWithdrawn(token, poolId, received);
    }

    // ============ View Functions ============

    function getConfig(address token) external view override returns (StabilizerConfig memory) {
        return tokenConfigs[token];
    }

    function getDeploymentHistory(address token) external view override returns (DeploymentRecord[] memory) {
        return deploymentHistory[token];
    }

    function getAvailableForDeployment(address token) external view override returns (uint256) {
        StabilizerConfig storage config = tokenConfigs[token];
        MarketState storage state = tokenMarketStates[token];

        if (!config.enabled || !state.isBearMarket) {
            return 0;
        }

        uint256 treasuryBalance = IERC20(token).balanceOf(address(daoTreasury));
        uint256 maxDeployment = (treasuryBalance * config.deploymentRateBps) / BPS_PRECISION;

        uint256 remaining = config.maxDeploymentPerPeriod > state.deployedThisPeriod
            ? config.maxDeploymentPerPeriod - state.deployedThisPeriod
            : 0;

        return maxDeployment < remaining ? maxDeployment : remaining;
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculate price trend for a pool
     * @param poolId Pool identifier
     * @return trend Trend in basis points (negative = declining)
     */
    function _calculateTrend(bytes32 poolId) internal view returns (int256 trend) {
        // Compare short-term vs long-term price via AMM TWAP
        try vibeAMM.getTWAP(poolId, shortTermPeriod) returns (uint256 shortTWAP) {
            try vibeAMM.getTWAP(poolId, longTermPeriod) returns (uint256 longTWAP) {
                if (longTWAP > 0 && shortTWAP > 0) {
                    // Trend = (shortTWAP - longTWAP) / longTWAP as BPS
                    if (shortTWAP >= longTWAP) {
                        trend = int256(((shortTWAP - longTWAP) * 10000) / longTWAP);
                    } else {
                        trend = -int256(((longTWAP - shortTWAP) * 10000) / longTWAP);
                    }
                    return trend;
                }
            } catch {}
        } catch {}

        // Fallback: use volatility as proxy when TWAP unavailable
        try volatilityOracle.getVolatilityData(poolId) returns (uint256 volatility, IVolatilityOracle.VolatilityTier, uint64) {
            if (volatility > 5000) {
                trend = -int256((volatility - 5000) * 2);
            } else {
                trend = int256(5000 - volatility);
            }
        } catch {
            trend = 0;
        }
    }

    /**
     * @notice Get main pool for a token
     * @param token Token address
     * @return poolId Main pool identifier
     */
    function _getMainPool(address token) internal view returns (bytes32 poolId) {
        poolId = tokenMainPool[token];
    }

    // ============ Admin Functions ============

    /**
     * @notice Configure stabilizer for a token
     * @param token Token address
     * @param config Configuration
     */
    function setConfig(address token, StabilizerConfig calldata config) external override onlyOwner {
        if (config.assessmentPeriod < MIN_ASSESSMENT_PERIOD) revert InvalidConfig();
        if (config.bearMarketThresholdBps == 0 || config.bearMarketThresholdBps > BPS_PRECISION) {
            revert InvalidConfig();
        }

        tokenConfigs[token] = config;

        // Initialize market state if needed
        if (tokenMarketStates[token].periodStart == 0) {
            tokenMarketStates[token].periodStart = uint64(block.timestamp);
        }

        emit ConfigUpdated(token, config);
    }

    /**
     * @notice Set the main AMM pool for a token (used for TWAP price queries)
     * @param token Token address
     * @param poolId VibeAMM pool identifier
     */
    function setMainPool(address token, bytes32 poolId) external onlyOwner {
        tokenMainPool[token] = poolId;
    }

    /**
     * @notice Set emergency mode for a token
     * @param token Token address
     * @param enabled Enable or disable
     */
    function setEmergencyMode(address token, bool enabled) external override onlyOwner {
        emergencyMode[token] = enabled;

        if (enabled) {
            emit EmergencyModeActivated(token);
        } else {
            emit EmergencyModeDeactivated(token);
        }
    }

    /**
     * @notice Set TWAP periods
     * @param _shortTerm Short term period
     * @param _longTerm Long term period
     */
    function setTWAPPeriods(uint32 _shortTerm, uint32 _longTerm) external onlyOwner {
        shortTermPeriod = _shortTerm;
        longTermPeriod = _longTerm;
    }

    /**
     * @notice Update contract references
     */
    function setVibeAMM(address _vibeAMM) external onlyOwner {
        if (_vibeAMM == address(0)) revert ZeroAddress();
        vibeAMM = IVibeAMM(_vibeAMM);
    }

    function setDAOTreasury(address _daoTreasury) external onlyOwner {
        if (_daoTreasury == address(0)) revert ZeroAddress();
        daoTreasury = IDAOTreasury(_daoTreasury);
    }

    function setVolatilityOracle(address _volatilityOracle) external onlyOwner {
        if (_volatilityOracle == address(0)) revert ZeroAddress();
        volatilityOracle = IVolatilityOracle(_volatilityOracle);
    }

    /**
     * @notice Pause stabilizer
     */
    function pause() external override onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause stabilizer
     */
    function unpause() external override onlyOwner {
        _unpause();
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
