// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeCode
 * @notice Deterministic identity fingerprint derived from on-chain contribution data.
 *
 * Your VibeCode IS your account identity on the network:
 * - bytes32 hash that changes as you contribute → seeds deterministic avatar
 * - Reputation score decomposed into 5 dimensions
 * - Self-validating: derived entirely from on-chain state, impossible to fake
 *
 * Data sources:
 * ┌───────────────────────────────────────────────────────────────┐
 * │  ContributionDAG    → Trust score, vouches (community)        │
 * │  RewardLedger       → Shapley rewards (builder)               │
 * │  CYT (IdeaTokens)   → IT holdings, ideas created (funder)    │
 * │  ContributionAttestor→ Attestation history (community)        │
 * │  SoulboundIdentity   → Verification status                   │
 * └───────────────────────────────────────────────────────────────┘
 *
 * Score weights (max 10000 BPS):
 *   Builder (30%) + Funder (20%) + Ideator (15%) + Community (20%) + Longevity (15%)
 *
 * Logarithmic scaling prevents whales from dominating — breadth > depth.
 */
interface IVibeCode {

    // ============ Enums ============

    enum ContributionCategory {
        CODE,          // Commits, PRs, smart contracts
        REVIEW,        // Code reviews, audits, security
        IDEA,          // Ideas created/funded on CYT
        EXECUTION,     // Execution streams completed
        ATTESTATION,   // Vouches given/received
        GOVERNANCE,    // Voting, proposals, tribunal
        COMMUNITY,     // Forum posts, support, onboarding
        DESIGN         // UI/UX, branding, art
    }

    // ============ Structs ============

    /// @notice A user's complete vibe profile
    struct VibeProfile {
        bytes32 vibeCode;           // Deterministic identity hash (seeds avatar)
        uint256 reputationScore;    // Composite score (0-10000 BPS)
        uint256 builderScore;       // Code + execution (max 3000)
        uint256 funderScore;        // IT held + ideas funded (max 2000)
        uint256 ideatorScore;       // Ideas created (max 1500)
        uint256 communityScore;     // Trust + attestations (max 2000)
        uint256 longevityScore;     // Time-weighted participation (max 1500)
        uint256 totalContributions; // All recorded events
        uint256 firstActiveAt;      // First contribution timestamp
        uint256 lastActiveAt;       // Most recent activity
        uint256 lastRefreshed;      // When vibe code was last recomputed
    }

    /// @notice Visual properties derived from vibe code hash (for frontend avatar)
    struct VisualSeed {
        uint32 hue;           // Primary color hue (0-360)
        uint32 pattern;       // Pattern type (0-15)
        uint32 border;        // Border style (0-15)
        uint32 glow;          // Glow intensity (0-15)
        uint32 shape;         // Shape variant (0-15)
        uint32 background;    // Background (0-15)
    }

    // ============ Events ============

    event VibeCodeRefreshed(address indexed user, bytes32 oldCode, bytes32 newCode, uint256 reputationScore);
    event ContributionRecorded(address indexed user, ContributionCategory indexed category, uint256 value, bytes32 evidenceHash);
    event SourceAuthorized(address indexed source, bool authorized);
    event ExternalSourceUpdated(string sourceName, address sourceAddress);

    // ============ Errors ============

    error ZeroAddress();
    error UnauthorizedSource();
    error NoProfile();
    error ZeroValue();

    // ============ Core Functions ============

    /// @notice Record a contribution for a user (authorized sources only)
    /// @param user The contributor
    /// @param category Type of contribution
    /// @param value Magnitude (e.g., reward tokens, count)
    /// @param evidenceHash Link to proof (IPFS/commit hash)
    function recordContribution(
        address user,
        ContributionCategory category,
        uint256 value,
        bytes32 evidenceHash
    ) external;

    /// @notice Refresh a user's vibe code (permissionless — recomputes from profile)
    /// @dev Also pulls live data from external contracts if configured
    function refreshVibeCode(address user) external;

    // ============ View Functions ============

    /// @notice Get a user's vibe code hash
    function getVibeCode(address user) external view returns (bytes32);

    /// @notice Get full profile
    function getProfile(address user) external view returns (VibeProfile memory);

    /// @notice Get reputation score (0-10000 BPS)
    function getReputationScore(address user) external view returns (uint256);

    /// @notice Get visual seed for deterministic avatar generation
    function getVisualSeed(address user) external view returns (VisualSeed memory);

    /// @notice Get short display code (first 4 bytes of vibe code as hex)
    function getDisplayCode(address user) external view returns (bytes4);

    /// @notice Get raw category values for a user
    function getCategoryValue(address user, ContributionCategory category) external view returns (uint256);

    /// @notice Check if user has any activity
    function isActive(address user) external view returns (bool);

    /// @notice Get total number of active profiles
    function getActiveProfileCount() external view returns (uint256);
}
