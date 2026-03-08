// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibePaymaster — Gasless Transactions for New Users
 * @notice Sponsors gas fees for first-time users to eliminate onboarding friction.
 *
 * "If your mom can't use it, it's not ready."
 *
 * Policy:
 * - First 5 transactions: fully sponsored (free gas)
 * - Next 10: 50% gas subsidy
 * - After that: user pays their own gas
 * - JUL holders get permanent 20% gas discount
 * - Daily gas budget prevents abuse
 */
contract VibePaymaster is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct UserGasProfile {
        uint256 totalSponsored;
        uint256 txCount;
        uint256 lastTxTime;
        bool isJULHolder;
    }

    // ============ State ============

    mapping(address => UserGasProfile) public profiles;
    uint256 public dailyBudget;
    uint256 public dailySpent;
    uint256 public dailyResetTime;
    uint256 public totalSponsored;
    uint256 public totalUsers;

    uint256 public constant FREE_TX_LIMIT = 5;
    uint256 public constant SUBSIDIZED_TX_LIMIT = 15;   // 5 free + 10 half-price
    uint256 public constant SUBSIDY_BPS = 5000;          // 50%
    uint256 public constant JUL_DISCOUNT_BPS = 2000;     // 20%

    mapping(address => bool) public whitelistedContracts;

    // ============ Events ============

    event GasSponsored(address indexed user, uint256 amount, uint256 txNumber);
    event GasSubsidized(address indexed user, uint256 amount, uint256 subsidy);
    event BudgetUpdated(uint256 newBudget);
    event UserOnboarded(address indexed user);

    // ============ Initialize ============

    function initialize(uint256 _dailyBudget) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        dailyBudget = _dailyBudget > 0 ? _dailyBudget : 1 ether;
        dailyResetTime = block.timestamp;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Gas Sponsorship ============

    /// @notice Check if a user qualifies for gas sponsorship
    function checkSponsorship(address user, uint256 gasCost) external view returns (
        bool eligible,
        uint256 sponsoredAmount,
        string memory reason
    ) {
        UserGasProfile storage p = profiles[user];

        if (p.txCount < FREE_TX_LIMIT) {
            return (true, gasCost, "Free gas for new users");
        }

        if (p.txCount < SUBSIDIZED_TX_LIMIT) {
            uint256 subsidy = (gasCost * SUBSIDY_BPS) / 10000;
            return (true, subsidy, "50% gas subsidy");
        }

        if (p.isJULHolder) {
            uint256 discount = (gasCost * JUL_DISCOUNT_BPS) / 10000;
            return (true, discount, "JUL holder discount");
        }

        return (false, 0, "No sponsorship available");
    }

    /// @notice Sponsor gas for a user transaction
    function sponsorGas(address user) external payable nonReentrant {
        require(whitelistedContracts[msg.sender] || msg.sender == owner(), "Not authorized");

        _resetDailyIfNeeded();

        UserGasProfile storage p = profiles[user];
        uint256 gasCost = tx.gasprice * gasleft();
        uint256 sponsored = 0;

        if (p.txCount == 0) {
            totalUsers++;
            emit UserOnboarded(user);
        }

        if (p.txCount < FREE_TX_LIMIT) {
            sponsored = gasCost;
        } else if (p.txCount < SUBSIDIZED_TX_LIMIT) {
            sponsored = (gasCost * SUBSIDY_BPS) / 10000;
        } else if (p.isJULHolder) {
            sponsored = (gasCost * JUL_DISCOUNT_BPS) / 10000;
        }

        if (sponsored > 0 && dailySpent + sponsored <= dailyBudget) {
            p.txCount++;
            p.totalSponsored += sponsored;
            p.lastTxTime = block.timestamp;
            dailySpent += sponsored;
            totalSponsored += sponsored;

            emit GasSponsored(user, sponsored, p.txCount);
        }
    }

    // ============ Admin ============

    function setDailyBudget(uint256 newBudget) external onlyOwner {
        dailyBudget = newBudget;
        emit BudgetUpdated(newBudget);
    }

    function whitelistContract(address contractAddr) external onlyOwner {
        whitelistedContracts[contractAddr] = true;
    }

    function setJULHolder(address user, bool isHolder) external onlyOwner {
        profiles[user].isJULHolder = isHolder;
    }

    function _resetDailyIfNeeded() internal {
        if (block.timestamp > dailyResetTime + 1 days) {
            dailySpent = 0;
            dailyResetTime = block.timestamp;
        }
    }

    // ============ Views ============

    function getProfile(address user) external view returns (UserGasProfile memory) {
        return profiles[user];
    }

    function getRemainingBudget() external view returns (uint256) {
        if (block.timestamp > dailyResetTime + 1 days) return dailyBudget;
        return dailyBudget > dailySpent ? dailyBudget - dailySpent : 0;
    }

    function getFreeTxRemaining(address user) external view returns (uint256) {
        uint256 txCount = profiles[user].txCount;
        return txCount < FREE_TX_LIMIT ? FREE_TX_LIMIT - txCount : 0;
    }

    receive() external payable {}
}
