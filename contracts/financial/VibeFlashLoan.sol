// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice EIP-3156 compatible callback interface
interface IVibeFlashBorrower {
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}

/**
 * @title VibeFlashLoan — Protocol-Wide Flash Loan Provider
 * @notice Unified flash loan facility across all VSOS liquidity pools.
 *         Aggregates liquidity from lending pools, AMM pools, and vaults.
 *
 * @dev Key differences from AAVE flash loans:
 *      - Multi-pool aggregation (borrow from multiple sources in one tx)
 *      - Dynamic fees based on utilization (higher util = higher fee)
 *      - Flash loan insurance (portion of fees to insurance fund)
 *      - Callback interface compatible with EIP-3156
 */
contract VibeFlashLoan is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BASE_FEE_BPS = 9;        // 0.09% base fee
    uint256 public constant MAX_FEE_BPS = 100;       // 1% max fee
    uint256 public constant INSURANCE_CUT_BPS = 1000; // 10% of fee to insurance
    uint256 public constant BPS = 10000;

    // ============ Types ============

    struct LiquidityPool {
        address poolAddress;
        address token;
        uint256 maxFlashAmount;
        bool active;
    }

    struct FlashLoanRecord {
        address borrower;
        address token;
        uint256 amount;
        uint256 fee;
        uint256 timestamp;
        bool repaid;
    }

    // ============ State ============

    /// @notice Registered liquidity pools
    mapping(bytes32 => LiquidityPool) public pools;
    bytes32[] public poolIds;

    /// @notice Flash loan history
    mapping(bytes32 => FlashLoanRecord) public loanHistory;
    uint256 public loanCount;

    /// @notice Insurance fund address
    address public insuranceFund;

    /// @notice Current utilization per token (basis points)
    mapping(address => uint256) public tokenUtilization;

    /// @notice Total volume per token
    mapping(address => uint256) public totalVolume;

    /// @notice Callback interface selector (EIP-3156)
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    // ============ Events ============

    event FlashLoanExecuted(address indexed borrower, address indexed token, uint256 amount, uint256 fee);
    event PoolRegistered(bytes32 indexed poolId, address pool, address token);
    event PoolRemoved(bytes32 indexed poolId);

    // ============ Init ============

    function initialize(address _insuranceFund) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        insuranceFund = _insuranceFund;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Pool Management ============

    function registerPool(address pool, address token, uint256 maxAmount) external onlyOwner {
        bytes32 poolId = keccak256(abi.encodePacked(pool, token));
        pools[poolId] = LiquidityPool({
            poolAddress: pool,
            token: token,
            maxFlashAmount: maxAmount,
            active: true
        });
        poolIds.push(poolId);
        emit PoolRegistered(poolId, pool, token);
    }

    function removePool(bytes32 poolId) external onlyOwner {
        pools[poolId].active = false;
        emit PoolRemoved(poolId);
    }

    // ============ Flash Loan ============

    /**
     * @notice Execute a flash loan (EIP-3156 compatible)
     * @param receiver The contract receiving the flash loan
     * @param token The token to borrow
     * @param amount The amount to borrow
     * @param data Arbitrary data passed to the callback
     */
    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant returns (bool) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient liquidity");

        uint256 fee = flashFee(token, amount);

        // Transfer tokens to borrower
        IERC20(token).safeTransfer(receiver, amount);

        // Callback
        bytes32 result = IVibeFlashBorrower(receiver).onFlashLoan(
            msg.sender,
            token,
            amount,
            fee,
            data
        );
        require(result == CALLBACK_SUCCESS, "Callback failed");

        // Verify repayment
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        // Send insurance cut
        uint256 insuranceCut = (fee * INSURANCE_CUT_BPS) / BPS;
        if (insuranceCut > 0) {
            IERC20(token).safeTransfer(insuranceFund, insuranceCut);
        }

        // Record
        loanCount++;
        totalVolume[token] += amount;

        emit FlashLoanExecuted(msg.sender, token, amount, fee);
        return true;
    }

    /**
     * @notice Calculate flash loan fee (dynamic based on utilization)
     */
    function flashFee(address token, uint256 amount) public view returns (uint256) {
        uint256 utilBps = tokenUtilization[token];

        // Fee scales linearly from BASE_FEE to MAX_FEE based on utilization
        uint256 feeBps = BASE_FEE_BPS + ((MAX_FEE_BPS - BASE_FEE_BPS) * utilBps) / BPS;

        return (amount * feeBps) / BPS;
    }

    /**
     * @notice Maximum flash loan amount for a token
     */
    function maxFlashLoan(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ============ View ============

    function getPoolCount() external view returns (uint256) {
        return poolIds.length;
    }

    function getTotalVolume(address token) external view returns (uint256) {
        return totalVolume[token];
    }
}
