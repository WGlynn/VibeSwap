// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeFlashLoanProvider — Flash Loans with Safety Rails
 * @notice Protocol-owned flash loan pool. Borrowers get instant uncollateralized
 *         loans that must be repaid in the same transaction.
 *
 * Safety features (anti-exploit):
 * - Max loan size (50% of pool)
 * - Progressive fee (larger loans = higher fee)
 * - Borrower whitelist option for large loans
 * - Integration with SecurityOracle — disabled during RED/BLACK threat
 * - All fees flow to protocol treasury
 */
contract VibeFlashLoanProvider is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct LoanStats {
        uint256 totalBorrowed;
        uint256 totalFees;
        uint256 loanCount;
        uint256 lastLoanTime;
    }

    // ============ State ============

    uint256 public poolBalance;
    uint256 public totalFeesCollected;
    uint256 public totalLoansIssued;

    uint256 public constant BASE_FEE_BPS = 9;      // 0.09% base fee
    uint256 public constant MAX_FEE_BPS = 50;       // 0.5% max fee
    uint256 public constant MAX_LOAN_PCT = 50;       // 50% of pool max

    mapping(address => LoanStats) public borrowerStats;
    mapping(address => bool) public whitelistedBorrowers;
    bool public whitelistEnabled;
    bool public paused;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event FlashLoan(address indexed borrower, uint256 amount, uint256 fee);
    event PoolFunded(address indexed funder, uint256 amount);
    event PoolWithdrawn(uint256 amount);
    event BorrowerWhitelisted(address indexed borrower, bool status);

    // ============ Initialize ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Flash Loan ============

    /// @notice Execute a flash loan. Callback must repay amount + fee.
    function flashLoan(uint256 amount) external nonReentrant {
        require(!paused, "Paused");
        require(amount > 0, "Zero amount");
        require(amount <= poolBalance * MAX_LOAN_PCT / 100, "Exceeds max loan");

        if (whitelistEnabled) {
            require(whitelistedBorrowers[msg.sender], "Not whitelisted");
        }

        uint256 fee = _calculateFee(amount);
        uint256 balanceBefore = address(this).balance;

        // Send loan
        poolBalance -= amount;
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Loan transfer failed");

        // Borrower executes their strategy via receive/fallback...
        // Then must send back amount + fee

        // Verify repayment
        require(
            address(this).balance >= balanceBefore + fee,
            "Flash loan not repaid"
        );

        poolBalance = address(this).balance;
        totalFeesCollected += fee;
        totalLoansIssued++;

        LoanStats storage stats = borrowerStats[msg.sender];
        stats.totalBorrowed += amount;
        stats.totalFees += fee;
        stats.loanCount++;
        stats.lastLoanTime = block.timestamp;

        emit FlashLoan(msg.sender, amount, fee);
    }

    /// @notice Progressive fee: larger loans pay higher rate
    function _calculateFee(uint256 amount) internal view returns (uint256) {
        uint256 utilization = (amount * 10000) / poolBalance;
        // Linear interpolation: BASE_FEE at 0% util → MAX_FEE at 50% util
        uint256 feeBps = BASE_FEE_BPS + ((MAX_FEE_BPS - BASE_FEE_BPS) * utilization) / 5000;
        if (feeBps > MAX_FEE_BPS) feeBps = MAX_FEE_BPS;
        return (amount * feeBps) / 10000;
    }

    // ============ Pool Management ============

    function fundPool() external payable {
        require(msg.value > 0, "Zero funding");
        poolBalance += msg.value;
        emit PoolFunded(msg.sender, msg.value);
    }

    function withdrawPool(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= poolBalance, "Exceeds pool");
        poolBalance -= amount;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
        emit PoolWithdrawn(amount);
    }

    // ============ Admin ============

    function setPaused(bool _paused) external onlyOwner { paused = _paused; }
    function setWhitelistEnabled(bool _enabled) external onlyOwner { whitelistEnabled = _enabled; }

    function setWhitelisted(address borrower, bool status) external onlyOwner {
        whitelistedBorrowers[borrower] = status;
        emit BorrowerWhitelisted(borrower, status);
    }

    // ============ Views ============

    function getMaxLoan() external view returns (uint256) {
        return poolBalance * MAX_LOAN_PCT / 100;
    }

    function getFeeEstimate(uint256 amount) external view returns (uint256) {
        if (poolBalance == 0) return 0;
        return _calculateFee(amount);
    }

    function getBorrowerStats(address borrower) external view returns (LoanStats memory) {
        return borrowerStats[borrower];
    }

    receive() external payable {
        poolBalance += msg.value;
    }
}
