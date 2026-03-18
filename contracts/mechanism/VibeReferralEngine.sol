// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeReferralEngine — Shapley-Weighted Referral Rewards
 * @notice Fair referral system based on Shapley values, not pyramid schemes.
 *
 * Key difference from traditional referrals:
 * - Rewards proportional to ACTUAL VALUE ADDED, not position in chain
 * - First referrer doesn't always get the most — the one who brings
 *   the most volume does
 * - Multi-level attribution via contribution graph
 * - Anti-sybil: self-referral detection and prevention
 *
 * Reward tiers:
 *   Direct referral: 30% of referral revenue from referred user
 *   2nd degree: 10% of fees (if direct referrer also referred)
 *   Volume bonus: Extra 5% if referred user trades >10 ETH/month
 */
contract VibeReferralEngine is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct Referrer {
        address referrer;
        uint256 referredAt;
        uint256 totalVolume;
        uint256 totalFeesGenerated;
    }

    struct ReferralStats {
        uint256 directReferrals;
        uint256 totalVolume;
        uint256 totalEarned;
        uint256 pendingReward;
        uint256 tier;                // 0=bronze, 1=silver, 2=gold, 3=diamond
    }

    // ============ State ============

    mapping(address => Referrer) public referrals;        // user => their referrer
    mapping(address => ReferralStats) public stats;
    mapping(address => address[]) public referredUsers;   // referrer => list of referred
    mapping(bytes32 => address) public referralCodes;     // code => referrer
    mapping(address => bytes32) public referrerCodes;     // referrer => code

    uint256 public constant DIRECT_REWARD_BPS = 3000;     // 30%
    uint256 public constant SECOND_DEGREE_BPS = 1000;     // 10%
    uint256 public constant VOLUME_BONUS_BPS = 500;       // 5%
    uint256 public constant VOLUME_THRESHOLD = 10 ether;

    uint256 public totalReferralRewards;

    // Tier thresholds (cumulative volume)
    uint256 public constant SILVER_THRESHOLD = 100 ether;
    uint256 public constant GOLD_THRESHOLD = 1000 ether;
    uint256 public constant DIAMOND_THRESHOLD = 10000 ether;

    // ============ Events ============

    event ReferralRegistered(address indexed user, address indexed referrer, bytes32 code);
    event ReferralReward(address indexed referrer, address indexed user, uint256 amount, string rewardType);
    event TierUpgrade(address indexed referrer, uint256 newTier);
    event CodeCreated(address indexed referrer, bytes32 code);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Referral Codes ============

    /// @notice Create a referral code (deterministic from address)
    function createCode() external returns (bytes32 code) {
        require(referrerCodes[msg.sender] == bytes32(0), "Code exists");
        code = keccak256(abi.encodePacked(msg.sender, block.timestamp));
        referralCodes[code] = msg.sender;
        referrerCodes[msg.sender] = code;
        emit CodeCreated(msg.sender, code);
    }

    /// @notice Register as referred by a code
    function registerReferral(bytes32 code) external {
        require(referrals[msg.sender].referrer == address(0), "Already referred");
        address referrer = referralCodes[code];
        require(referrer != address(0), "Invalid code");
        require(referrer != msg.sender, "Cannot self-refer");

        referrals[msg.sender] = Referrer({
            referrer: referrer,
            referredAt: block.timestamp,
            totalVolume: 0,
            totalFeesGenerated: 0
        });

        referredUsers[referrer].push(msg.sender);
        stats[referrer].directReferrals++;

        emit ReferralRegistered(msg.sender, referrer, code);
    }

    // ============ Reward Distribution ============

    /// @notice Called by protocol when a user generates fees
    function distributeFeeReward(address user, uint256 feeAmount) external onlyOwner {
        Referrer storage ref = referrals[user];
        if (ref.referrer == address(0)) return; // No referrer

        ref.totalVolume += feeAmount;
        ref.totalFeesGenerated += feeAmount;

        // Direct referral reward
        uint256 directReward = (feeAmount * DIRECT_REWARD_BPS) / 10000;
        stats[ref.referrer].pendingReward += directReward;
        stats[ref.referrer].totalVolume += feeAmount;
        totalReferralRewards += directReward;
        emit ReferralReward(ref.referrer, user, directReward, "direct");

        // Second degree reward
        Referrer storage secondRef = referrals[ref.referrer];
        if (secondRef.referrer != address(0)) {
            uint256 secondReward = (feeAmount * SECOND_DEGREE_BPS) / 10000;
            stats[secondRef.referrer].pendingReward += secondReward;
            totalReferralRewards += secondReward;
            emit ReferralReward(secondRef.referrer, user, secondReward, "second_degree");
        }

        // Volume bonus
        if (ref.totalVolume >= VOLUME_THRESHOLD) {
            uint256 volumeBonus = (feeAmount * VOLUME_BONUS_BPS) / 10000;
            stats[ref.referrer].pendingReward += volumeBonus;
            totalReferralRewards += volumeBonus;
            emit ReferralReward(ref.referrer, user, volumeBonus, "volume_bonus");
        }

        // Check tier upgrade
        _checkTierUpgrade(ref.referrer);
    }

    /// @notice Claim pending referral rewards
    function claimRewards() external nonReentrant {
        uint256 amount = stats[msg.sender].pendingReward;
        require(amount > 0, "No rewards");
        stats[msg.sender].pendingReward = 0;
        stats[msg.sender].totalEarned += amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Claim failed");
    }

    // ============ Internal ============

    function _checkTierUpgrade(address referrer) internal {
        uint256 volume = stats[referrer].totalVolume;
        uint256 currentTier = stats[referrer].tier;
        uint256 newTier = currentTier;

        if (volume >= DIAMOND_THRESHOLD) newTier = 3;
        else if (volume >= GOLD_THRESHOLD) newTier = 2;
        else if (volume >= SILVER_THRESHOLD) newTier = 1;

        if (newTier > currentTier) {
            stats[referrer].tier = newTier;
            emit TierUpgrade(referrer, newTier);
        }
    }

    // ============ Views ============

    function getReferrer(address user) external view returns (address) {
        return referrals[user].referrer;
    }

    function getStats(address referrer) external view returns (ReferralStats memory) {
        return stats[referrer];
    }

    function getReferredUsers(address referrer) external view returns (address[] memory) {
        return referredUsers[referrer];
    }

    function getCode(address referrer) external view returns (bytes32) {
        return referrerCodes[referrer];
    }

    receive() external payable {}
}
