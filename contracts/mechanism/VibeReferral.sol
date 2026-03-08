// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeReferral — Protocol Growth Engine
 * @notice Referral and affiliate system for organic protocol growth.
 *         Multi-tier referral rewards with anti-sybil protections.
 *
 * @dev Features:
 *      - Referral codes (unique per user)
 *      - Tier 1: 30% of referred user's fees (direct)
 *      - Tier 2: 10% of 2nd-degree referrals
 *      - Anti-sybil: minimum activity threshold before earning
 *      - Leaderboard tracking
 */
contract VibeReferral is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant TIER1_SHARE_BPS = 3000; // 30%
    uint256 public constant TIER2_SHARE_BPS = 1000; // 10%
    uint256 public constant BPS = 10000;
    uint256 public constant MIN_ACTIVITY_THRESHOLD = 3; // Min trades before earning

    // ============ Types ============

    struct Referrer {
        bytes32 referralCode;
        address referrerAddress;
        uint256 totalReferred;
        uint256 totalEarned;
        uint256 tier1Count;
        uint256 tier2Count;
        uint256 activityCount;
        bool active;
    }

    struct ReferralRelation {
        address referred;
        address referrer;       // Tier 1
        address grandReferrer;  // Tier 2
        uint256 joinedAt;
        uint256 volumeGenerated;
    }

    // ============ State ============

    /// @notice Referrer profiles
    mapping(address => Referrer) public referrers;

    /// @notice Code → referrer address
    mapping(bytes32 => address) public codeToReferrer;

    /// @notice Referral relationships
    mapping(address => ReferralRelation) public relations;

    /// @notice Pending rewards
    mapping(address => uint256) public pendingRewards;

    /// @notice Total stats
    uint256 public totalReferrals;
    uint256 public totalRewardsDistributed;
    uint256 public totalReferrers;

    // ============ Events ============

    event ReferrerRegistered(address indexed referrer, bytes32 code);
    event ReferralUsed(address indexed referred, address indexed referrer, bytes32 code);
    event ReferralRewardAccrued(address indexed referrer, uint256 amount, uint256 tier);
    event RewardsClaimed(address indexed referrer, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Registration ============

    /**
     * @notice Register as a referrer and get a unique code
     */
    function registerReferrer(string calldata codeStr) external {
        require(!referrers[msg.sender].active, "Already registered");

        bytes32 code = keccak256(abi.encodePacked(codeStr));
        require(codeToReferrer[code] == address(0), "Code taken");

        referrers[msg.sender] = Referrer({
            referralCode: code,
            referrerAddress: msg.sender,
            totalReferred: 0,
            totalEarned: 0,
            tier1Count: 0,
            tier2Count: 0,
            activityCount: 0,
            active: true
        });

        codeToReferrer[code] = msg.sender;
        totalReferrers++;

        emit ReferrerRegistered(msg.sender, code);
    }

    /**
     * @notice Use a referral code (called once per new user)
     */
    function useReferralCode(bytes32 code) external {
        require(relations[msg.sender].referrer == address(0), "Already referred");
        address referrer = codeToReferrer[code];
        require(referrer != address(0), "Invalid code");
        require(referrer != msg.sender, "Self-referral");

        // Set up tier 1
        address grandReferrer = relations[referrer].referrer;

        relations[msg.sender] = ReferralRelation({
            referred: msg.sender,
            referrer: referrer,
            grandReferrer: grandReferrer,
            joinedAt: block.timestamp,
            volumeGenerated: 0
        });

        referrers[referrer].tier1Count++;
        referrers[referrer].totalReferred++;

        // Tier 2 tracking
        if (grandReferrer != address(0)) {
            referrers[grandReferrer].tier2Count++;
        }

        totalReferrals++;

        emit ReferralUsed(msg.sender, referrer, code);
    }

    // ============ Rewards ============

    /**
     * @notice Record a fee event and distribute referral rewards
     * @param user The user who generated the fee
     * @param feeAmount The fee amount to split
     */
    function recordFee(address user, uint256 feeAmount) external payable {
        require(msg.value >= feeAmount, "Insufficient fee");

        ReferralRelation storage rel = relations[user];
        if (rel.referrer == address(0)) return;

        rel.volumeGenerated += feeAmount;

        // Tier 1 reward
        address tier1 = rel.referrer;
        if (referrers[tier1].active && referrers[tier1].activityCount >= MIN_ACTIVITY_THRESHOLD) {
            uint256 tier1Reward = (feeAmount * TIER1_SHARE_BPS) / BPS;
            pendingRewards[tier1] += tier1Reward;
            referrers[tier1].totalEarned += tier1Reward;
            emit ReferralRewardAccrued(tier1, tier1Reward, 1);
        }

        // Tier 2 reward
        address tier2 = rel.grandReferrer;
        if (tier2 != address(0) && referrers[tier2].active && referrers[tier2].activityCount >= MIN_ACTIVITY_THRESHOLD) {
            uint256 tier2Reward = (feeAmount * TIER2_SHARE_BPS) / BPS;
            pendingRewards[tier2] += tier2Reward;
            referrers[tier2].totalEarned += tier2Reward;
            emit ReferralRewardAccrued(tier2, tier2Reward, 2);
        }
    }

    /**
     * @notice Record activity (anti-sybil)
     */
    function recordActivity(address user) external {
        if (referrers[user].active) {
            referrers[user].activityCount++;
        }
    }

    /**
     * @notice Claim pending referral rewards
     */
    function claimRewards() external nonReentrant {
        uint256 amount = pendingRewards[msg.sender];
        require(amount > 0, "No rewards");

        pendingRewards[msg.sender] = 0;
        totalRewardsDistributed += amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit RewardsClaimed(msg.sender, amount);
    }

    // ============ View ============

    function getReferrer(address user) external view returns (address) {
        return relations[user].referrer;
    }

    function getReferralStats(address referrer) external view returns (
        uint256 tier1Count,
        uint256 tier2Count,
        uint256 totalEarned,
        uint256 pending
    ) {
        Referrer storage ref = referrers[referrer];
        return (ref.tier1Count, ref.tier2Count, ref.totalEarned, pendingRewards[referrer]);
    }

    function isReferred(address user) external view returns (bool) {
        return relations[user].referrer != address(0);
    }

    receive() external payable {}
}
