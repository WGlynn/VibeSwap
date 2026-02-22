// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IIncentiveController.sol";
import "./interfaces/IVolatilityOracle.sol";
import "./interfaces/IILProtectionVault.sol";
import "./interfaces/ILoyaltyRewardsManager.sol";
import "./interfaces/ISlippageGuaranteeFund.sol";
import "./interfaces/IShapleyDistributor.sol";

// Minimal interface for querying AMM LP state (avoids circular import)
interface IAMMLiquidityQuery {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }
    function liquidityBalance(bytes32 poolId, address user) external view returns (uint256);
    function getPool(bytes32 poolId) external view returns (Pool memory);
}

/**
 * @title IncentiveController
 * @notice Central coordinator for all VibeSwap incentive mechanisms
 * @dev Routes fees and proceeds to appropriate vaults, provides unified claim interface
 *
 * Supports two distribution modes:
 * - Pro-rata: Simple proportional distribution by liquidity (default)
 * - Shapley: Fair distribution based on marginal contribution (opt-in per pool)
 *
 * Shapley distribution implements cooperative game theory where each economic
 * event (batch settlement) is treated as an independent game. Rewards reflect:
 * - Direct contribution (liquidity provided)
 * - Enabling contribution (time in pool)
 * - Scarcity contribution (providing the scarce side)
 * - Stability contribution (staying during volatility)
 */
contract IncentiveController is
    IIncentiveController,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant PRECISION = 1e18;

    // ============ State ============

    // Core contract references
    address public vibeAMM;
    address public vibeSwapCore;
    address public treasury;

    // Incentive vault references
    IVolatilityOracle public volatilityOracle;
    address public volatilityInsurancePool;
    IILProtectionVault public ilProtectionVault;
    ISlippageGuaranteeFund public slippageGuaranteeFund;
    ILoyaltyRewardsManager public loyaltyRewardsManager;
    IShapleyDistributor public shapleyDistributor;

    // Shapley distribution settings
    mapping(bytes32 => bool) public useShapleyDistribution; // poolId => use Shapley

    // Default configuration
    IncentiveConfig public defaultConfig;

    // Pool-specific overrides
    mapping(bytes32 => IncentiveConfig) public poolConfigs;
    mapping(bytes32 => bool) public hasPoolConfig;

    // Auction proceeds distribution
    mapping(bytes32 => uint256) public poolAuctionProceeds; // poolId => accumulated proceeds
    mapping(bytes32 => mapping(address => uint256)) public lpAuctionClaims; // poolId => lp => claimed

    // Authorized callers
    mapping(address => bool) public authorizedCallers;

    // ============ Errors ============

    error Unauthorized();
    error ZeroAddress();
    error InvalidConfig();
    error InvalidAmount();
    error NothingToClaim();

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyAMM() {
        if (msg.sender != vibeAMM) revert Unauthorized();
        _;
    }

    modifier onlyCore() {
        if (msg.sender != vibeSwapCore) revert Unauthorized();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _vibeAMM,
        address _vibeSwapCore,
        address _treasury
    ) external initializer {
        if (_vibeAMM == address(0) || _vibeSwapCore == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeAMM = _vibeAMM;
        vibeSwapCore = _vibeSwapCore;
        treasury = _treasury;

        authorizedCallers[_vibeAMM] = true;
        authorizedCallers[_vibeSwapCore] = true;

        // Set default config
        defaultConfig = IncentiveConfig({
            volatilityFeeRatioBps: 10000,   // 100% of extra fees to volatility pool
            auctionToLPRatioBps: 10000,     // 100% of auction proceeds to LPs
            ilProtectionCapBps: 8000,       // 80% max IL coverage
            slippageGuaranteeCapBps: 200,   // 2% max slippage coverage
            loyaltyBoostMaxBps: 20000       // 2x max loyalty boost
        });
    }

    // ============ Fee Routing ============

    /**
     * @notice Route volatility fees to insurance pool
     * @param poolId Pool identifier
     * @param token Fee token
     * @param amount Fee amount
     */
    function routeVolatilityFee(
        bytes32 poolId,
        address token,
        uint256 amount
    ) external override onlyAMM {
        if (amount == 0) return;

        IncentiveConfig memory config = _getConfig(poolId);

        // Calculate portion for volatility pool
        uint256 toVolatilityPool = (amount * config.volatilityFeeRatioBps) / BPS_PRECISION;

        if (toVolatilityPool > 0 && volatilityInsurancePool != address(0)) {
            // Transfer to this contract first, then forward
            IERC20(token).safeTransferFrom(msg.sender, address(this), toVolatilityPool);

            // Approve and deposit to volatility pool
            IERC20(token).forceApprove(volatilityInsurancePool, toVolatilityPool);

            // Deposit into volatility insurance pool — revert on failure to prevent tokens getting stuck
            (bool success, ) = volatilityInsurancePool.call(
                abi.encodeWithSignature(
                    "depositFees(bytes32,address,uint256)",
                    poolId,
                    token,
                    toVolatilityPool
                )
            );
            require(success, "Volatility pool deposit failed");

            emit VolatilityFeeRouted(poolId, token, toVolatilityPool);
        }
    }

    /**
     * @notice Distribute auction proceeds to LPs
     * @param batchId Batch identifier
     * @param poolIds Pools involved in batch
     * @param amounts Amounts per pool
     */
    function distributeAuctionProceeds(
        uint64 batchId,
        bytes32[] calldata poolIds,
        uint256[] calldata amounts
    ) external payable override onlyCore {
        if (poolIds.length != amounts.length) revert InvalidConfig();

        uint256 totalDistributed;

        for (uint256 i = 0; i < poolIds.length; i++) {
            if (amounts[i] > 0) {
                poolAuctionProceeds[poolIds[i]] += amounts[i];
                totalDistributed += amounts[i];
            }
        }

        // Verify we received enough
        if (msg.value < totalDistributed) revert InvalidAmount();

        // Refund excess
        if (msg.value > totalDistributed) {
            (bool success, ) = msg.sender.call{value: msg.value - totalDistributed}("");
            require(success, "Refund failed");
        }

        emit AuctionProceedsDistributed(batchId, totalDistributed);
    }

    // ============ LP Lifecycle Hooks ============

    /**
     * @notice Called when liquidity is added
     * @param poolId Pool identifier
     * @param lp LP address
     * @param liquidity Amount of liquidity
     * @param entryPrice TWAP at deposit
     */
    function onLiquidityAdded(
        bytes32 poolId,
        address lp,
        uint256 liquidity,
        uint256 entryPrice
    ) external override onlyAMM {
        // Register with IL Protection
        if (address(ilProtectionVault) != address(0)) {
            ilProtectionVault.registerPosition(poolId, lp, liquidity, entryPrice, 0);
        }

        // Register with Loyalty Rewards
        if (address(loyaltyRewardsManager) != address(0)) {
            loyaltyRewardsManager.registerStake(poolId, lp, liquidity);
        }

        emit LiquidityAdded(poolId, lp, liquidity, entryPrice);
    }

    /**
     * @notice Called when liquidity is removed
     * @param poolId Pool identifier
     * @param lp LP address
     * @param liquidity Amount removed
     */
    function onLiquidityRemoved(
        bytes32 poolId,
        address lp,
        uint256 liquidity
    ) external override onlyAMM {
        // Record unstake and get penalty
        if (address(loyaltyRewardsManager) != address(0)) {
            loyaltyRewardsManager.recordUnstake(poolId, lp, liquidity);
        }

        emit LiquidityRemoved(poolId, lp, liquidity);
    }

    // ============ Execution Tracking ============

    /**
     * @notice Record trade execution for slippage tracking
     * @param poolId Pool identifier
     * @param trader Trader address
     * @param amountIn Input amount
     * @param amountOut Output received
     * @param expectedMinOut Expected minimum output
     */
    function recordExecution(
        bytes32 poolId,
        address trader,
        uint256 amountIn,
        uint256 amountOut,
        uint256 expectedMinOut
    ) external override onlyAMM returns (bytes32 claimId) {
        emit ExecutionRecorded(poolId, trader, amountIn, amountOut);

        // Record with slippage guarantee fund if shortfall
        if (address(slippageGuaranteeFund) != address(0) && amountOut < expectedMinOut) {
            // Get quote token from pool (token1 is the output side by convention)
            IAMMLiquidityQuery.Pool memory pool = IAMMLiquidityQuery(vibeAMM).getPool(poolId);
            address quoteToken = pool.token1;
            claimId = slippageGuaranteeFund.recordExecution(poolId, trader, quoteToken, expectedMinOut, amountOut);
        }

        return claimId;
    }

    // ============ Claims ============

    /**
     * @notice Claim IL protection
     * @param poolId Pool identifier
     */
    function claimILProtection(bytes32 poolId) external override nonReentrant returns (uint256 amount) {
        if (address(ilProtectionVault) == address(0)) revert NothingToClaim();

        amount = ilProtectionVault.claimProtection(poolId, msg.sender);

        if (amount > 0) {
            emit ILProtectionClaimed(poolId, msg.sender, amount);
        }
    }

    /**
     * @notice Claim slippage compensation
     * @param claimId Claim identifier
     */
    function claimSlippageCompensation(bytes32 claimId) external override nonReentrant returns (uint256 amount) {
        if (address(slippageGuaranteeFund) == address(0)) revert NothingToClaim();

        amount = slippageGuaranteeFund.processClaim(claimId);

        if (amount > 0) {
            emit SlippageCompensationClaimed(claimId, msg.sender, amount);
        }
    }

    /**
     * @notice Claim loyalty rewards
     * @param poolId Pool identifier
     */
    function claimLoyaltyRewards(bytes32 poolId) external override nonReentrant returns (uint256 amount) {
        if (address(loyaltyRewardsManager) == address(0)) revert NothingToClaim();

        amount = loyaltyRewardsManager.claimRewards(poolId, msg.sender);

        if (amount > 0) {
            emit LoyaltyRewardsClaimed(poolId, msg.sender, amount);
        }
    }

    /**
     * @notice Claim auction proceeds
     * @param poolId Pool identifier
     */
    function claimAuctionProceeds(bytes32 poolId) external override nonReentrant returns (uint256 amount) {
        uint256 totalProceeds = poolAuctionProceeds[poolId];
        uint256 claimed = lpAuctionClaims[poolId][msg.sender];

        if (totalProceeds <= claimed) revert NothingToClaim();

        // Pro-rata share based on LP's liquidity in the pool
        IAMMLiquidityQuery amm = IAMMLiquidityQuery(vibeAMM);
        uint256 lpBalance = amm.liquidityBalance(poolId, msg.sender);
        IAMMLiquidityQuery.Pool memory pool = amm.getPool(poolId);

        if (lpBalance == 0 || pool.totalLiquidity == 0) revert NothingToClaim();

        // LP's proportional share of total unclaimed proceeds
        uint256 proRataShare = (totalProceeds * lpBalance) / pool.totalLiquidity;

        if (proRataShare <= claimed) revert NothingToClaim();

        amount = proRataShare - claimed;
        lpAuctionClaims[poolId][msg.sender] = proRataShare;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        return amount;
    }

    // ============ View Functions ============

    function getPoolIncentiveStats(bytes32 poolId) external view override returns (PoolIncentiveStats memory stats) {
        // Query vault balances (ETH held as reserve proxy)
        stats = PoolIncentiveStats({
            volatilityReserve: volatilityInsurancePool != address(0)
                ? volatilityInsurancePool.balance : 0,
            ilReserve: address(ilProtectionVault) != address(0)
                ? address(ilProtectionVault).balance : 0,
            slippageReserve: address(slippageGuaranteeFund) != address(0)
                ? address(slippageGuaranteeFund).balance : 0,
            totalLoyaltyStaked: address(loyaltyRewardsManager) != address(0)
                ? address(loyaltyRewardsManager).balance : 0,
            totalAuctionProceedsDistributed: poolAuctionProceeds[poolId]
        });
    }

    function getPoolConfig(bytes32 poolId) external view override returns (IncentiveConfig memory) {
        return _getConfig(poolId);
    }

    function getPendingILClaim(bytes32 poolId, address lp) external view override returns (uint256) {
        if (address(ilProtectionVault) == address(0)) return 0;
        return ilProtectionVault.getClaimableAmount(poolId, lp);
    }

    function getPendingLoyaltyRewards(bytes32 poolId, address lp) external view override returns (uint256) {
        if (address(loyaltyRewardsManager) == address(0)) return 0;
        return loyaltyRewardsManager.getPendingRewards(poolId, lp);
    }

    function getPendingAuctionProceeds(bytes32 poolId, address lp) external view override returns (uint256) {
        uint256 totalProceeds = poolAuctionProceeds[poolId];
        uint256 claimed = lpAuctionClaims[poolId][lp];

        // Pro-rata share based on LP's liquidity
        IAMMLiquidityQuery amm = IAMMLiquidityQuery(vibeAMM);
        uint256 lpBalance = amm.liquidityBalance(poolId, lp);
        IAMMLiquidityQuery.Pool memory pool = amm.getPool(poolId);

        if (lpBalance == 0 || pool.totalLiquidity == 0) return 0;

        uint256 proRataShare = (totalProceeds * lpBalance) / pool.totalLiquidity;
        return proRataShare > claimed ? proRataShare - claimed : 0;
    }

    // ============ Internal Functions ============

    function _getConfig(bytes32 poolId) internal view returns (IncentiveConfig memory) {
        if (hasPoolConfig[poolId]) {
            return poolConfigs[poolId];
        }
        return defaultConfig;
    }

    // ============ Admin Functions ============

    function setPoolConfig(bytes32 poolId, IncentiveConfig calldata config) external override onlyOwner {
        poolConfigs[poolId] = config;
        hasPoolConfig[poolId] = true;
    }

    function setDefaultConfig(IncentiveConfig calldata config) external override onlyOwner {
        defaultConfig = config;
    }

    function setVolatilityOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        volatilityOracle = IVolatilityOracle(_oracle);
    }

    function setVolatilityInsurancePool(address _pool) external onlyOwner {
        volatilityInsurancePool = _pool;
    }

    function setILProtectionVault(address _vault) external onlyOwner {
        ilProtectionVault = IILProtectionVault(_vault);
    }

    function setSlippageGuaranteeFund(address _fund) external onlyOwner {
        slippageGuaranteeFund = ISlippageGuaranteeFund(_fund);
    }

    function setLoyaltyRewardsManager(address _manager) external onlyOwner {
        loyaltyRewardsManager = ILoyaltyRewardsManager(_manager);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setShapleyDistributor(address _distributor) external onlyOwner {
        shapleyDistributor = IShapleyDistributor(_distributor);
    }

    /**
     * @notice Enable or disable Shapley distribution for a pool
     * @dev When enabled, rewards are distributed based on marginal contribution
     *      When disabled, simple pro-rata distribution is used
     * @param poolId Pool identifier
     * @param enabled Whether to use Shapley distribution
     */
    function setShapleyEnabled(bytes32 poolId, bool enabled) external onlyOwner {
        useShapleyDistribution[poolId] = enabled;
    }

    // ============ Shapley Distribution ============

    /**
     * @notice Create a Shapley game for batch fee distribution
     * @dev Called after batch settlement to distribute fees fairly
     * @param batchId Batch identifier
     * @param poolId Pool identifier
     * @param totalFees Total fees to distribute
     * @param token Fee token
     * @param participants LP participants with contribution data
     */
    function createShapleyGame(
        uint64 batchId,
        bytes32 poolId,
        uint256 totalFees,
        address token,
        IShapleyDistributor.Participant[] calldata participants
    ) external onlyAuthorized {
        if (address(shapleyDistributor) == address(0)) return;
        if (!useShapleyDistribution[poolId]) return;

        bytes32 gameId = keccak256(abi.encodePacked(batchId, poolId));

        // Transfer fees to Shapley distributor
        if (token != address(0)) {
            IERC20(token).safeTransfer(address(shapleyDistributor), totalFees);
        }

        // Create and compute game
        shapleyDistributor.createGame(gameId, totalFees, token, participants);
        shapleyDistributor.computeShapleyValues(gameId);
    }

    /**
     * @notice Claim Shapley-distributed rewards from a batch
     * @param batchId Batch identifier
     * @param poolId Pool identifier
     */
    function claimShapleyReward(uint64 batchId, bytes32 poolId) external nonReentrant returns (uint256) {
        if (address(shapleyDistributor) == address(0)) revert NothingToClaim();

        bytes32 gameId = keccak256(abi.encodePacked(batchId, poolId));
        return shapleyDistributor.claimReward(gameId);
    }

    /**
     * @notice Get pending Shapley reward for a batch
     * @param batchId Batch identifier
     * @param poolId Pool identifier
     * @param lp LP address
     */
    function getPendingShapleyReward(
        uint64 batchId,
        bytes32 poolId,
        address lp
    ) external view returns (uint256) {
        if (address(shapleyDistributor) == address(0)) return 0;

        bytes32 gameId = keccak256(abi.encodePacked(batchId, poolId));
        return shapleyDistributor.getPendingReward(gameId, lp);
    }

    /**
     * @notice Check if pool uses Shapley distribution
     * @param poolId Pool identifier
     */
    function isShapleyEnabled(bytes32 poolId) external view returns (bool) {
        return useShapleyDistribution[poolId] && address(shapleyDistributor) != address(0);
    }

    // ============ Receive ETH ============

    receive() external payable {}

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
