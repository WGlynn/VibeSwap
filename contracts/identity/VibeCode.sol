// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IVibeCode.sol";

/**
 * @title VibeCode
 * @notice Your account IS your vibe code. Deterministic identity fingerprint
 *         derived from on-chain contribution data.
 *
 * The vibe code hash:
 * - Changes as you contribute → your avatar evolves
 * - Deterministic from inputs → anyone can verify
 * - Decomposable → see WHY someone has their score
 * - Self-validating → impossible to fake, derived from on-chain state
 *
 * Score computation uses log2 scaling so breadth beats depth:
 * A user with 100x more funding gets ~2x the score, not 100x.
 *
 * @dev Non-upgradeable. Authorized sources (ContributionAttestor, CYT, DAG)
 *      record contributions. Anyone can trigger refresh.
 */
contract VibeCode is IVibeCode, Ownable {

    // ============ Constants ============

    uint256 public constant MAX_SCORE = 10000;
    uint256 public constant BUILDER_MAX = 3000;
    uint256 public constant FUNDER_MAX = 2000;
    uint256 public constant IDEATOR_MAX = 1500;
    uint256 public constant COMMUNITY_MAX = 2000;
    uint256 public constant LONGEVITY_MAX = 1500;

    /// @notice Scale factor for value → score conversion
    uint256 public constant PRECISION = 1e18;

    /// @notice Builder points per log2 level
    uint256 public constant BUILDER_PER_LEVEL = 200;

    /// @notice Funder points per log2 level
    uint256 public constant FUNDER_PER_LEVEL = 140;

    /// @notice Community points per log2 level
    uint256 public constant COMMUNITY_PER_LEVEL = 140;

    /// @notice Ideator points per idea (linear, capped at IDEATOR_MAX)
    uint256 public constant IDEATOR_PER_IDEA = 150;

    /// @notice Longevity points per day (capped at LONGEVITY_MAX)
    uint256 public constant LONGEVITY_PER_DAY = 4;

    // ============ State ============

    /// @notice Vibe profiles per user
    mapping(address => VibeProfile) private _profiles;

    /// @notice Per-category cumulative values: user → category → cumulative value
    mapping(address => mapping(ContributionCategory => uint256)) private _categoryValues;

    /// @notice Authorized contribution sources (ContributionAttestor, CYT, DAG, etc.)
    mapping(address => bool) public authorizedSources;

    /// @notice Total active profiles (users with at least 1 contribution)
    uint256 public activeProfileCount;

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        if (!authorizedSources[msg.sender] && msg.sender != owner()) revert UnauthorizedSource();
        _;
    }

    // ============ Core Functions ============

    /// @inheritdoc IVibeCode
    function recordContribution(
        address user,
        ContributionCategory category,
        uint256 value,
        bytes32 evidenceHash
    ) external onlyAuthorized {
        if (user == address(0)) revert ZeroAddress();
        if (value == 0) revert ZeroValue();

        VibeProfile storage profile = _profiles[user];

        // First contribution — initialize profile
        if (profile.firstActiveAt == 0) {
            profile.firstActiveAt = block.timestamp;
            activeProfileCount++;
        }

        _categoryValues[user][category] += value;
        profile.totalContributions++;
        profile.lastActiveAt = block.timestamp;

        emit ContributionRecorded(user, category, value, evidenceHash);
    }

    /// @inheritdoc IVibeCode
    function refreshVibeCode(address user) external {
        if (user == address(0)) revert ZeroAddress();

        VibeProfile storage profile = _profiles[user];
        if (profile.firstActiveAt == 0) revert NoProfile();

        bytes32 oldCode = profile.vibeCode;

        // Compute dimension scores
        profile.builderScore = _computeBuilderScore(user);
        profile.funderScore = _computeFunderScore(user);
        profile.ideatorScore = _computeIdeatorScore(user);
        profile.communityScore = _computeCommunityScore(user);
        profile.longevityScore = _computeLongevityScore(user);

        // Composite score (sum of dimensions, naturally capped)
        profile.reputationScore = profile.builderScore
            + profile.funderScore
            + profile.ideatorScore
            + profile.communityScore
            + profile.longevityScore;

        // Deterministic vibe code hash
        profile.vibeCode = keccak256(abi.encodePacked(
            user,
            profile.builderScore,
            profile.funderScore,
            profile.ideatorScore,
            profile.communityScore,
            profile.longevityScore,
            profile.totalContributions,
            profile.firstActiveAt
        ));

        profile.lastRefreshed = block.timestamp;

        emit VibeCodeRefreshed(user, oldCode, profile.vibeCode, profile.reputationScore);
    }

    // ============ View Functions ============

    /// @inheritdoc IVibeCode
    function getVibeCode(address user) external view returns (bytes32) {
        return _profiles[user].vibeCode;
    }

    /// @inheritdoc IVibeCode
    function getProfile(address user) external view returns (VibeProfile memory) {
        return _profiles[user];
    }

    /// @inheritdoc IVibeCode
    function getReputationScore(address user) external view returns (uint256) {
        return _profiles[user].reputationScore;
    }

    /// @inheritdoc IVibeCode
    function getVisualSeed(address user) external view returns (VisualSeed memory) {
        bytes32 code = _profiles[user].vibeCode;
        if (code == bytes32(0)) return VisualSeed(0, 0, 0, 0, 0, 0);

        return VisualSeed({
            hue: uint32(uint256(code) % 360),
            pattern: uint32((uint256(code) >> 32) % 16),
            border: uint32((uint256(code) >> 64) % 16),
            glow: uint32((uint256(code) >> 96) % 16),
            shape: uint32((uint256(code) >> 128) % 16),
            background: uint32((uint256(code) >> 160) % 16)
        });
    }

    /// @inheritdoc IVibeCode
    function getDisplayCode(address user) external view returns (bytes4) {
        return bytes4(_profiles[user].vibeCode);
    }

    /// @inheritdoc IVibeCode
    function getCategoryValue(address user, ContributionCategory category) external view returns (uint256) {
        return _categoryValues[user][category];
    }

    /// @inheritdoc IVibeCode
    function isActive(address user) external view returns (bool) {
        return _profiles[user].firstActiveAt != 0;
    }

    /// @inheritdoc IVibeCode
    function getActiveProfileCount() external view returns (uint256) {
        return activeProfileCount;
    }

    // ============ Admin ============

    function setAuthorizedSource(address source, bool authorized) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        authorizedSources[source] = authorized;
        emit SourceAuthorized(source, authorized);
    }

    // ============ Internal: Score Computation ============

    /**
     * @notice Builder score: CODE + EXECUTION + REVIEW contributions
     * @dev log2(totalBuilderValue / 1e18 + 1) * BUILDER_PER_LEVEL, capped at BUILDER_MAX
     */
    function _computeBuilderScore(address user) internal view returns (uint256) {
        uint256 rawValue = _categoryValues[user][ContributionCategory.CODE]
            + _categoryValues[user][ContributionCategory.EXECUTION]
            + _categoryValues[user][ContributionCategory.REVIEW];

        uint256 scaled = rawValue / PRECISION; // Convert to whole units
        uint256 logVal = _log2(scaled + 1);
        uint256 score = logVal * BUILDER_PER_LEVEL;
        return score > BUILDER_MAX ? BUILDER_MAX : score;
    }

    /**
     * @notice Funder score: IDEA category contributions (funding/IT holdings)
     * @dev log2(totalFunderValue / 1e18 + 1) * FUNDER_PER_LEVEL, capped at FUNDER_MAX
     */
    function _computeFunderScore(address user) internal view returns (uint256) {
        uint256 rawValue = _categoryValues[user][ContributionCategory.IDEA];

        uint256 scaled = rawValue / PRECISION;
        uint256 logVal = _log2(scaled + 1);
        uint256 score = logVal * FUNDER_PER_LEVEL;
        return score > FUNDER_MAX ? FUNDER_MAX : score;
    }

    /**
     * @notice Ideator score: Count of ideas created (from IDEA category, counted as events)
     * @dev Linear: ideasCreated * IDEATOR_PER_IDEA, capped at IDEATOR_MAX
     *      We track ideas as count of IDEA contribution events with value=1e18 each
     */
    function _computeIdeatorScore(address user) internal view returns (uint256) {
        // Ideator is count-based: each DESIGN contribution = 1 idea created
        // IDEA = funding (funder), DESIGN = creation (ideator)
        uint256 ideaCount = _categoryValues[user][ContributionCategory.DESIGN];
        uint256 scaled = ideaCount / PRECISION; // 1e18 per idea
        uint256 score = scaled * IDEATOR_PER_IDEA;
        return score > IDEATOR_MAX ? IDEATOR_MAX : score;
    }

    /**
     * @notice Community score: ATTESTATION + GOVERNANCE + COMMUNITY contributions
     * @dev log2(totalCommunityValue / 1e18 + 1) * COMMUNITY_PER_LEVEL, capped at COMMUNITY_MAX
     */
    function _computeCommunityScore(address user) internal view returns (uint256) {
        uint256 rawValue = _categoryValues[user][ContributionCategory.ATTESTATION]
            + _categoryValues[user][ContributionCategory.GOVERNANCE]
            + _categoryValues[user][ContributionCategory.COMMUNITY];

        uint256 scaled = rawValue / PRECISION;
        uint256 logVal = _log2(scaled + 1);
        uint256 score = logVal * COMMUNITY_PER_LEVEL;
        return score > COMMUNITY_MAX ? COMMUNITY_MAX : score;
    }

    /**
     * @notice Longevity score: days since first activity
     * @dev Linear: daysSinceFirst * LONGEVITY_PER_DAY, capped at LONGEVITY_MAX
     */
    function _computeLongevityScore(address user) internal view returns (uint256) {
        uint256 firstActive = _profiles[user].firstActiveAt;
        if (firstActive == 0 || block.timestamp <= firstActive) return 0;

        uint256 daysSinceFirst = (block.timestamp - firstActive) / 1 days;
        uint256 score = daysSinceFirst * LONGEVITY_PER_DAY;
        return score > LONGEVITY_MAX ? LONGEVITY_MAX : score;
    }

    // ============ Internal: Math ============

    /**
     * @notice Integer log2 (floor)
     * @dev Returns 0 for input 0. For n > 0, returns floor(log2(n)).
     *      Used for logarithmic scaling: breadth > depth.
     *      1→0, 2→1, 4→2, 8→3, 16→4, 1024→10, 1M→19
     */
    function _log2(uint256 n) internal pure returns (uint256 result) {
        if (n <= 1) return 0;
        // Use bit-shift counting
        while (n > 1) {
            n >>= 1;
            result++;
        }
    }
}
