// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISlippageGuaranteeFund.sol";

/**
 * @title SlippageGuaranteeFund
 * @notice Covers execution shortfall for traders when actual output < expected minimum
 * @dev Provides compensation up to configured limits per user and per trade
 */
contract SlippageGuaranteeFund is
    ISlippageGuaranteeFund,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant DAY_SECONDS = 86400;

    // ============ State ============

    address public incentiveController;

    // Claim ID => Claim data
    mapping(bytes32 => SlippageClaim) public claims;

    // User => Claim state
    mapping(address => UserClaimState) public userStates;

    // Token => Reserve balance
    mapping(address => uint256) public reserves;

    // Configuration
    FundConfig public config;

    // Stats
    uint256 public totalClaimsProcessed;
    uint256 public totalCompensationPaid;
    uint256 public claimNonce;

    // ============ Errors ============

    error Unauthorized();
    error InvalidAmount();
    error ClaimNotFound();
    error ClaimAlreadyProcessed();
    error ClaimExpiredError();
    error ClaimNotExpired();
    error InsufficientReserves();
    error UserLimitExceeded();
    error ShortfallBelowMinimum();
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
        address _incentiveController
    ) external initializer {
        if (_incentiveController == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        incentiveController = _incentiveController;

        // Default configuration
        config = FundConfig({
            maxClaimPercentBps: 200,      // 2% of trade value max
            userDailyLimitBps: 500,       // 5% of daily trade volume
            claimWindow: 1 hours,
            minShortfallBps: 50           // 0.5% minimum shortfall
        });
    }

    // ============ External Functions ============

    /**
     * @notice Record an execution for potential slippage claim
     * @param poolId Pool identifier
     * @param trader Trader address
     * @param token Token for compensation
     * @param expectedOut Expected output amount
     * @param actualOut Actual output received
     */
    function recordExecution(
        bytes32 poolId,
        address trader,
        address token,
        uint256 expectedOut,
        uint256 actualOut
    ) external override onlyController returns (bytes32 claimId) {
        require(token != address(0), "Invalid token");

        // Only create claim if there's a shortfall
        if (actualOut >= expectedOut) {
            return bytes32(0);
        }

        uint256 shortfall = expectedOut - actualOut;
        uint256 shortfallBps = (shortfall * BPS_PRECISION) / expectedOut;

        // Check minimum shortfall threshold
        if (shortfallBps < config.minShortfallBps) {
            return bytes32(0);
        }

        // Generate claim ID
        claimId = keccak256(abi.encodePacked(
            poolId,
            trader,
            block.timestamp,
            claimNonce++
        ));

        // Calculate eligible compensation
        uint256 maxCompensation = (expectedOut * config.maxClaimPercentBps) / BPS_PRECISION;
        uint256 eligibleCompensation = shortfall > maxCompensation ? maxCompensation : shortfall;

        claims[claimId] = SlippageClaim({
            trader: trader,
            poolId: poolId,
            token: token,
            expectedOutput: expectedOut,
            actualOutput: actualOut,
            shortfall: shortfall,
            eligibleCompensation: eligibleCompensation,
            timestamp: uint64(block.timestamp),
            processed: false,
            expired: false
        });

        emit ExecutionRecorded(claimId, poolId, trader, shortfall);
    }

    /**
     * @notice Process a slippage claim
     * @param claimId Claim identifier
     */
    function processClaim(
        bytes32 claimId
    ) external override nonReentrant returns (uint256 compensation) {
        SlippageClaim storage claim = claims[claimId];

        if (claim.trader == address(0)) revert ClaimNotFound();
        if (claim.processed) revert ClaimAlreadyProcessed();
        if (claim.expired) revert ClaimExpiredError();

        // Check claim window
        if (block.timestamp > claim.timestamp + config.claimWindow) {
            claim.expired = true;
            emit ClaimExpired(claimId);
            revert ClaimExpiredError();
        }

        // Only trader or controller can process
        if (msg.sender != claim.trader && msg.sender != incentiveController) {
            revert Unauthorized();
        }

        // Check user daily limit
        UserClaimState storage userState = userStates[claim.trader];
        uint256 currentDay = block.timestamp / DAY_SECONDS;

        if (userState.lastClaimDay < currentDay) {
            // Reset for new day
            userState.claimedToday = 0;
            userState.lastClaimDay = uint64(currentDay);
        }

        // Calculate remaining daily allowance as % of fund reserves
        uint256 dailyLimit = (reserves[claim.token] * config.userDailyLimitBps) / BPS_PRECISION;
        if (dailyLimit == 0) dailyLimit = 1; // Minimum 1 wei to prevent permanent lockout
        if (userState.claimedToday >= dailyLimit) {
            revert UserLimitExceeded();
        }

        compensation = claim.eligibleCompensation;
        uint256 remainingDailyLimit = dailyLimit - userState.claimedToday;
        if (compensation > remainingDailyLimit) {
            compensation = remainingDailyLimit;
        }

        // Check reserves
        if (reserves[claim.token] < compensation) {
            compensation = reserves[claim.token];
        }

        if (compensation == 0) revert InsufficientReserves();

        // Update state
        claim.processed = true;
        userState.claimedToday += compensation;
        userState.totalLifetimeClaims += compensation;
        reserves[claim.token] -= compensation;
        totalClaimsProcessed++;
        totalCompensationPaid += compensation;

        // Transfer compensation
        IERC20(claim.token).safeTransfer(claim.trader, compensation);

        emit ClaimProcessed(claimId, claim.trader, compensation);
    }

    /**
     * @notice Expire an unclaimed claim
     * @param claimId Claim identifier
     */
    function expireClaim(bytes32 claimId) external override {
        SlippageClaim storage claim = claims[claimId];

        if (claim.trader == address(0)) revert ClaimNotFound();
        if (claim.processed) revert ClaimAlreadyProcessed();
        if (claim.expired) return; // Already expired

        if (block.timestamp <= claim.timestamp + config.claimWindow) {
            revert ClaimNotExpired();
        }

        claim.expired = true;
        emit ClaimExpired(claimId);
    }

    // ============ View Functions ============

    function getClaim(bytes32 claimId) external view override returns (SlippageClaim memory) {
        return claims[claimId];
    }

    function getUserState(address user) external view override returns (UserClaimState memory) {
        return userStates[user];
    }

    function getUserRemainingLimit(address user) external view override returns (uint256) {
        UserClaimState storage userState = userStates[user];
        uint256 currentDay = block.timestamp / DAY_SECONDS;

        if (userState.lastClaimDay < currentDay) {
            return 1e18; // Full daily limit
        }

        uint256 dailyLimit = 1e18;
        if (userState.claimedToday >= dailyLimit) {
            return 0;
        }

        return dailyLimit - userState.claimedToday;
    }

    function getConfig() external view override returns (FundConfig memory) {
        return config;
    }

    function getTotalReserves(address token) external view override returns (uint256) {
        return reserves[token];
    }

    function canClaim(bytes32 claimId) external view override returns (bool eligible, string memory reason) {
        SlippageClaim storage claim = claims[claimId];

        if (claim.trader == address(0)) {
            return (false, "Claim not found");
        }
        if (claim.processed) {
            return (false, "Already processed");
        }
        if (claim.expired) {
            return (false, "Claim expired");
        }
        if (block.timestamp > claim.timestamp + config.claimWindow) {
            return (false, "Claim window closed");
        }
        if (reserves[claim.token] == 0) {
            return (false, "Insufficient reserves");
        }

        return (true, "Eligible");
    }

    // ============ Admin Functions ============

    /**
     * @notice Set fund configuration
     */
    function setConfig(FundConfig calldata _config) external override onlyOwner {
        config = _config;
        emit ConfigUpdated(
            _config.maxClaimPercentBps,
            _config.userDailyLimitBps,
            _config.claimWindow
        );
    }

    /**
     * @notice Deposit funds into guarantee pool
     */
    function depositFunds(address token, uint256 amount) external override {
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        reserves[token] += amount;

        emit FundsDeposited(token, amount);
    }

    /**
     * @notice Withdraw excess funds
     */
    function withdrawExcess(
        address token,
        uint256 amount,
        address recipient
    ) external override onlyOwner {
        if (reserves[token] < amount) revert InsufficientReserves();

        reserves[token] -= amount;
        IERC20(token).safeTransfer(recipient, amount);
    }

    /**
     * @notice Set incentive controller
     */
    function setIncentiveController(address _controller) external onlyOwner {
        if (_controller == address(0)) revert ZeroAddress();
        incentiveController = _controller;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
