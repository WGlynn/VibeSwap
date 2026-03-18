// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibePointsEngine — On-Chain Points & Achievement System
 * @notice Gamified engagement system that tracks and rewards user activity.
 *
 * Points are non-transferable (soulbound) but redeemable for:
 * - Fee discounts
 * - Priority access to launches
 * - Governance weight multipliers
 * - NFT achievements
 *
 * Activities that earn points:
 * - Swapping: 1 point per $1 volume
 * - Providing liquidity: 3 points per $1 TVL per day
 * - Staking: 2 points per $1 staked per day
 * - Referrals: 10% of referred user's points
 * - Streaks: Bonus for consecutive days of activity
 * - Bug reports: 1000 points per valid report
 */
contract VibePointsEngine is OwnableUpgradeable, UUPSUpgradeable {

    struct UserPoints {
        uint256 totalPoints;
        uint256 lifetimePoints;
        uint256 level;
        uint256 streak;
        uint256 lastActivity;
        uint256 pointsRedeemed;
    }

    struct Achievement {
        string name;
        string description;
        uint256 pointsRequired;
        uint256 bonusPoints;
        bool active;
    }

    // ============ State ============

    mapping(address => UserPoints) public userPoints;
    mapping(uint256 => Achievement) public achievements;
    uint256 public achievementCount;
    mapping(address => mapping(uint256 => bool)) public unlockedAchievements;

    // Points sources (authorized contracts that can award points)
    mapping(address => bool) public pointsSources;

    uint256 public totalPointsIssued;

    // Level thresholds
    uint256 public constant LEVEL_2 = 1000;
    uint256 public constant LEVEL_3 = 5000;
    uint256 public constant LEVEL_4 = 25000;
    uint256 public constant LEVEL_5 = 100000;

    // Streak bonus multiplier (in basis points above 10000)
    uint256 public constant STREAK_BONUS_PER_DAY = 100; // +1% per day, max 30%
    uint256 public constant MAX_STREAK_BONUS = 3000;

    // ============ Events ============

    event PointsAwarded(address indexed user, uint256 amount, string reason);
    event PointsRedeemed(address indexed user, uint256 amount, string purpose);
    event LevelUp(address indexed user, uint256 newLevel);
    event AchievementUnlocked(address indexed user, uint256 achievementId, string name);
    event StreakUpdated(address indexed user, uint256 newStreak);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        // Create initial achievements
        _createAchievement("First Swap", "Complete your first swap", 0, 100);
        _createAchievement("Liquidity Provider", "Provide liquidity for the first time", 0, 250);
        _createAchievement("Staker", "Stake tokens for the first time", 0, 250);
        _createAchievement("Referrer", "Refer your first friend", 0, 500);
        _createAchievement("Week Warrior", "7-day activity streak", 0, 1000);
        _createAchievement("Power Trader", "Trade $10,000 in volume", 10000, 2000);
        _createAchievement("Diamond Hands", "Hold for 30 days without selling", 0, 5000);
        _createAchievement("Bug Hunter", "Report a valid bug", 0, 10000);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Point Awards ============

    /// @notice Award points to a user (only from authorized sources)
    function awardPoints(address user, uint256 amount, string calldata reason) external {
        require(pointsSources[msg.sender] || msg.sender == owner(), "Not authorized");
        require(user != address(0), "Zero user");

        UserPoints storage up = userPoints[user];

        // Update streak
        if (up.lastActivity > 0) {
            uint256 daysSinceLastActivity = (block.timestamp - up.lastActivity) / 1 days;
            if (daysSinceLastActivity <= 1) {
                up.streak++;
                emit StreakUpdated(user, up.streak);
            } else {
                up.streak = 1; // Reset streak
            }
        } else {
            up.streak = 1;
        }

        // Apply streak bonus
        uint256 streakBonus = up.streak * STREAK_BONUS_PER_DAY;
        if (streakBonus > MAX_STREAK_BONUS) streakBonus = MAX_STREAK_BONUS;
        uint256 bonusAmount = (amount * streakBonus) / 10000;
        uint256 totalAmount = amount + bonusAmount;

        up.totalPoints += totalAmount;
        up.lifetimePoints += totalAmount;
        up.lastActivity = block.timestamp;
        totalPointsIssued += totalAmount;

        emit PointsAwarded(user, totalAmount, reason);

        // Check level up
        _checkLevelUp(user);

        // Check achievements
        _checkAchievements(user);
    }

    /// @notice Redeem points for perks
    function redeemPoints(address user, uint256 amount, string calldata purpose) external {
        require(pointsSources[msg.sender] || msg.sender == owner(), "Not authorized");
        UserPoints storage up = userPoints[user];
        require(up.totalPoints >= amount, "Insufficient points");

        up.totalPoints -= amount;
        up.pointsRedeemed += amount;

        emit PointsRedeemed(user, amount, purpose);
    }

    // ============ Achievement Management ============

    function createAchievement(
        string calldata name,
        string calldata description,
        uint256 pointsRequired,
        uint256 bonusPoints
    ) external onlyOwner {
        _createAchievement(name, description, pointsRequired, bonusPoints);
    }

    function _createAchievement(
        string memory name,
        string memory description,
        uint256 pointsRequired,
        uint256 bonusPoints
    ) internal {
        uint256 id = achievementCount++;
        achievements[id] = Achievement({
            name: name,
            description: description,
            pointsRequired: pointsRequired,
            bonusPoints: bonusPoints,
            active: true
        });
    }

    /// @notice Manually unlock an achievement (for off-chain verified ones)
    function unlockAchievement(address user, uint256 achievementId) external {
        require(pointsSources[msg.sender] || msg.sender == owner(), "Not authorized");
        require(!unlockedAchievements[user][achievementId], "Already unlocked");

        Achievement storage a = achievements[achievementId];
        require(a.active, "Inactive achievement");

        unlockedAchievements[user][achievementId] = true;
        if (a.bonusPoints > 0) {
            userPoints[user].totalPoints += a.bonusPoints;
            userPoints[user].lifetimePoints += a.bonusPoints;
        }

        emit AchievementUnlocked(user, achievementId, a.name);
    }

    // ============ Internal ============

    function _checkLevelUp(address user) internal {
        UserPoints storage up = userPoints[user];
        uint256 newLevel;

        if (up.lifetimePoints >= LEVEL_5) newLevel = 5;
        else if (up.lifetimePoints >= LEVEL_4) newLevel = 4;
        else if (up.lifetimePoints >= LEVEL_3) newLevel = 3;
        else if (up.lifetimePoints >= LEVEL_2) newLevel = 2;
        else newLevel = 1;

        if (newLevel > up.level) {
            up.level = newLevel;
            emit LevelUp(user, newLevel);
        }
    }

    function _checkAchievements(address user) internal {
        for (uint256 i = 0; i < achievementCount; i++) {
            if (unlockedAchievements[user][i]) continue;
            Achievement storage a = achievements[i];
            if (!a.active) continue;
            if (a.pointsRequired > 0 && userPoints[user].lifetimePoints >= a.pointsRequired) {
                unlockedAchievements[user][i] = true;
                if (a.bonusPoints > 0) {
                    userPoints[user].totalPoints += a.bonusPoints;
                    userPoints[user].lifetimePoints += a.bonusPoints;
                }
                emit AchievementUnlocked(user, i, a.name);
            }
        }
    }

    // ============ Admin ============

    function addPointsSource(address source) external onlyOwner {
        pointsSources[source] = true;
    }

    function removePointsSource(address source) external onlyOwner {
        pointsSources[source] = false;
    }

    // ============ Views ============

    function getPoints(address user) external view returns (UserPoints memory) {
        return userPoints[user];
    }

    function getLevel(address user) external view returns (uint256) {
        return userPoints[user].level;
    }

    function getStreak(address user) external view returns (uint256) {
        return userPoints[user].streak;
    }

    function hasAchievement(address user, uint256 id) external view returns (bool) {
        return unlockedAchievements[user][id];
    }

    function getFeeDiscount(address user) external view returns (uint256) {
        // 5% discount per level (max 25% at level 5)
        return userPoints[user].level * 500;
    }

    receive() external payable {}
}
