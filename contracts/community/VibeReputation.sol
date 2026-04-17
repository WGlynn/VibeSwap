// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeReputation — On-Chain Reputation Aggregator
 * @notice Aggregates reputation signals across all VSOS modules into
 *         a unified reputation score. Soulbound — cannot be transferred.
 *
 * @dev Reputation sources:
 *      - Governance participation (proposals, votes)
 *      - Trading history (volume, no manipulation)
 *      - Lending (repayment rate, no defaults)
 *      - LP provision (duration, consistency)
 *      - Mind contributions (PoM score)
 *      - Community endorsements (web of trust)
 *      - Dispute record (wins/losses)
 */
contract VibeReputation is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct ReputationProfile {
        uint256 totalScore;
        uint256 governanceScore;
        uint256 tradingScore;
        uint256 lendingScore;
        uint256 lpScore;
        uint256 mindScore;
        uint256 communityScore;
        uint256 disputeScore;
        uint256 lastUpdated;
        uint256 assessmentCount;
    }

    struct Endorsement {
        address endorser;
        address endorsee;
        uint256 weight;
        string category;
        uint256 timestamp;
    }

    // ============ State ============

    /// @notice Reputation profiles
    mapping(address => ReputationProfile) public profiles;

    /// @notice Endorsements given: endorser => endorsee => endorsed
    mapping(address => mapping(address => bool)) public hasEndorsed;

    /// @notice Endorsement count
    mapping(address => uint256) public endorsementCount;

    /// @notice Authorized score reporters (protocol modules)
    mapping(address => bool) public authorizedReporters;

    /// @notice Score categories and weights (basis points, total = 10000)
    uint256 public constant GOVERNANCE_WEIGHT = 1500;
    uint256 public constant TRADING_WEIGHT = 1500;
    uint256 public constant LENDING_WEIGHT = 1500;
    uint256 public constant LP_WEIGHT = 1500;
    uint256 public constant MIND_WEIGHT = 2000;
    uint256 public constant COMMUNITY_WEIGHT = 1000;
    uint256 public constant DISPUTE_WEIGHT = 1000;

    /// @notice Total profiles
    uint256 public totalProfiles;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ScoreUpdated(address indexed account, string category, uint256 newScore);
    event Endorsed(address indexed endorser, address indexed endorsee, string category);
    event ReporterAuthorized(address indexed reporter);
    event ProfileCreated(address indexed account);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Score Reporting ============

    /**
     * @notice Report a score update from an authorized module
     */
    function reportScore(
        address account,
        string calldata category,
        uint256 score
    ) external {
        require(authorizedReporters[msg.sender], "Not authorized");

        ReputationProfile storage profile = profiles[account];
        if (profile.lastUpdated == 0) {
            totalProfiles++;
            emit ProfileCreated(account);
        }

        bytes32 catHash = keccak256(abi.encodePacked(category));

        if (catHash == keccak256("governance")) profile.governanceScore = score;
        else if (catHash == keccak256("trading")) profile.tradingScore = score;
        else if (catHash == keccak256("lending")) profile.lendingScore = score;
        else if (catHash == keccak256("lp")) profile.lpScore = score;
        else if (catHash == keccak256("mind")) profile.mindScore = score;
        else if (catHash == keccak256("dispute")) profile.disputeScore = score;

        profile.lastUpdated = block.timestamp;
        profile.assessmentCount++;
        _recalculateTotal(account);

        emit ScoreUpdated(account, category, score);
    }

    // ============ Endorsements ============

    /**
     * @notice Endorse another account's reputation
     */
    function endorse(address endorsee, string calldata category) external {
        require(msg.sender != endorsee, "Cannot self-endorse");
        require(!hasEndorsed[msg.sender][endorsee], "Already endorsed");

        hasEndorsed[msg.sender][endorsee] = true;
        endorsementCount[endorsee]++;

        // Community score increases with endorsements
        ReputationProfile storage profile = profiles[endorsee];
        profile.communityScore += 1;
        profile.lastUpdated = block.timestamp;
        _recalculateTotal(endorsee);

        emit Endorsed(msg.sender, endorsee, category);
    }

    // ============ Admin ============

    function authorizeReporter(address reporter) external onlyOwner {
        authorizedReporters[reporter] = true;
        emit ReporterAuthorized(reporter);
    }

    // ============ View ============

    function getTotalScore(address account) external view returns (uint256) {
        return profiles[account].totalScore;
    }

    function getProfile(address account) external view returns (
        uint256 total,
        uint256 governance,
        uint256 trading,
        uint256 lending,
        uint256 lp,
        uint256 mind,
        uint256 community,
        uint256 dispute
    ) {
        ReputationProfile storage p = profiles[account];
        return (p.totalScore, p.governanceScore, p.tradingScore, p.lendingScore,
                p.lpScore, p.mindScore, p.communityScore, p.disputeScore);
    }

    function getEndorsementCount(address account) external view returns (uint256) {
        return endorsementCount[account];
    }

    // ============ Internal ============

    function _recalculateTotal(address account) internal {
        ReputationProfile storage p = profiles[account];
        p.totalScore = (
            (p.governanceScore * GOVERNANCE_WEIGHT) +
            (p.tradingScore * TRADING_WEIGHT) +
            (p.lendingScore * LENDING_WEIGHT) +
            (p.lpScore * LP_WEIGHT) +
            (p.mindScore * MIND_WEIGHT) +
            (p.communityScore * COMMUNITY_WEIGHT) +
            (p.disputeScore * DISPUTE_WEIGHT)
        ) / 10000;
    }
}
