// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DAOShelter — Inflation Shelter for CKB-native Holders
 * @notice Nervos DAO equivalent. Deposit CKB-native → receive secondary issuance
 *         proportional to your share → made whole against inflation.
 *
 * @dev The economic insight:
 *      - CKB-native has continuous secondary issuance (inflationary)
 *      - Tokens locked in cells (state rent) cannot enter the shelter
 *      - Tokens in the shelter receive their share of secondary issuance
 *      - Net effect: cell owners pay implicit rent, shelter depositors are made whole
 *      - State cleans itself — if your cell's value < inflation cost, rational to destroy it
 *
 *      Uses Masterchef-style accRewardPerShare for O(1) yield distribution.
 *      SecondaryIssuanceController calls depositYield() each epoch.
 *
 *      Withdrawal timelock prevents flash-deposit attacks on issuance distribution.
 */
contract DAOShelter is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant WITHDRAWAL_TIMELOCK = 7 days;
    uint256 private constant ACC_PRECISION = 1e18;

    // ============ State ============

    /// @notice CKB-native token
    IERC20 public ckbToken;

    /// @notice Per-user deposit info
    struct DepositInfo {
        uint256 amount;
        uint256 rewardDebt;     // Masterchef reward debt
        uint256 depositedAt;
        uint256 pendingWithdrawal;
        uint256 withdrawalUnlockTime;
    }

    mapping(address => DepositInfo) public deposits;

    /// @notice Total CKB-native deposited in the shelter
    uint256 public totalDeposited;

    /// @notice Accumulated reward per share (Masterchef pattern)
    uint256 public accRewardPerShare;

    /// @notice SecondaryIssuanceController address (only caller for depositYield)
    address public issuanceController;

    /// @dev Reserved storage gap
    uint256[50] private __gap;

    // ============ Events ============

    event Deposited(address indexed user, uint256 amount);
    event WithdrawalRequested(address indexed user, uint256 amount, uint256 unlockTime);
    event Withdrawn(address indexed user, uint256 amount);
    event YieldClaimed(address indexed user, uint256 amount);
    event YieldDeposited(uint256 amount, uint256 newAccRewardPerShare);
    event IssuanceControllerUpdated(address indexed controller);

    // ============ Errors ============

    error ZeroAmount();
    error InsufficientDeposit();
    error WithdrawalLocked();
    error NoPendingWithdrawal();
    error Unauthorized();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _ckbToken, address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        ckbToken = IERC20(_ckbToken);
    }

    // ============ Deposit ============

    /**
     * @notice Deposit CKB-native into the shelter
     * @dev Claims any pending yield before updating deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        DepositInfo storage info = deposits[msg.sender];

        // Claim pending yield first
        if (info.amount > 0) {
            uint256 pending = (info.amount * accRewardPerShare) / ACC_PRECISION - info.rewardDebt;
            if (pending > 0) {
                ckbToken.safeTransfer(msg.sender, pending);
                emit YieldClaimed(msg.sender, pending);
            }
        }

        ckbToken.safeTransferFrom(msg.sender, address(this), amount);

        info.amount += amount;
        info.depositedAt = block.timestamp;
        info.rewardDebt = (info.amount * accRewardPerShare) / ACC_PRECISION;
        totalDeposited += amount;

        emit Deposited(msg.sender, amount);
    }

    // ============ Withdrawal (Timelocked) ============

    /**
     * @notice Request withdrawal — starts timelock
     * @dev Cannot withdraw for WITHDRAWAL_TIMELOCK after request
     */
    function requestWithdrawal(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        DepositInfo storage info = deposits[msg.sender];
        if (info.amount < amount) revert InsufficientDeposit();

        // Claim pending yield
        uint256 pending = (info.amount * accRewardPerShare) / ACC_PRECISION - info.rewardDebt;
        if (pending > 0) {
            ckbToken.safeTransfer(msg.sender, pending);
            emit YieldClaimed(msg.sender, pending);
        }

        info.amount -= amount;
        info.rewardDebt = (info.amount * accRewardPerShare) / ACC_PRECISION;
        totalDeposited -= amount;

        info.pendingWithdrawal += amount;
        info.withdrawalUnlockTime = block.timestamp + WITHDRAWAL_TIMELOCK;

        emit WithdrawalRequested(msg.sender, amount, info.withdrawalUnlockTime);
    }

    /**
     * @notice Complete withdrawal after timelock expires
     */
    function completeWithdrawal() external nonReentrant {
        DepositInfo storage info = deposits[msg.sender];
        if (info.pendingWithdrawal == 0) revert NoPendingWithdrawal();
        if (block.timestamp < info.withdrawalUnlockTime) revert WithdrawalLocked();

        uint256 amount = info.pendingWithdrawal;
        info.pendingWithdrawal = 0;
        info.withdrawalUnlockTime = 0;

        ckbToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ============ Yield ============

    /**
     * @notice Claim accumulated yield without withdrawing deposit
     */
    function claimYield() external nonReentrant {
        DepositInfo storage info = deposits[msg.sender];
        if (info.amount == 0) revert ZeroAmount();

        uint256 pending = (info.amount * accRewardPerShare) / ACC_PRECISION - info.rewardDebt;
        if (pending == 0) revert ZeroAmount();

        info.rewardDebt = (info.amount * accRewardPerShare) / ACC_PRECISION;

        ckbToken.safeTransfer(msg.sender, pending);

        emit YieldClaimed(msg.sender, pending);
    }

    /**
     * @notice Deposit yield from secondary issuance (called by SecondaryIssuanceController)
     * @dev Increases accRewardPerShare proportionally.
     *      NCI-006: Validates issuanceController is set and amount > 0.
     */
    function depositYield(uint256 amount) external {
        require(issuanceController != address(0), "Controller not set");
        if (msg.sender != issuanceController) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();
        if (totalDeposited == 0) return; // No depositors — yield goes nowhere

        ckbToken.safeTransferFrom(msg.sender, address(this), amount);
        accRewardPerShare += (amount * ACC_PRECISION) / totalDeposited;

        emit YieldDeposited(amount, accRewardPerShare);
    }

    // ============ Admin ============

    function setIssuanceController(address controller) external onlyOwner {
        issuanceController = controller;
        emit IssuanceControllerUpdated(controller);
    }

    // ============ View Functions ============

    function pendingYield(address user) external view returns (uint256) {
        DepositInfo storage info = deposits[user];
        if (info.amount == 0) return 0;
        return (info.amount * accRewardPerShare) / ACC_PRECISION - info.rewardDebt;
    }

    function getDepositInfo(address user) external view returns (DepositInfo memory) {
        return deposits[user];
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
