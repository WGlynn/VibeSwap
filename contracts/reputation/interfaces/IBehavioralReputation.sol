// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../oracle/IReputationOracle.sol";

/**
 * @title IBehavioralReputation
 * @notice Extended reputation interface for CogProof behavioral analysis.
 * @dev Extends IReputationOracle so it plugs directly into CommitRevealAuction's
 *      existing setReputationOracle() slot — zero changes to existing contracts.
 *
 *      CogProof JS origin: cogproof/src/trust/behavior-analyzer.js
 *      See: docs/COGPROOF_INTEGRATION.md for full parameter crosswalk.
 */
interface IBehavioralReputation is IReputationOracle {
    // ============ Enums ============

    /// @notice Fraud flag types matching CogProof's 6 detectors
    enum FraudFlag {
        NONE,
        SELECTIVE_REVEAL,    // reveal rate < 40% of commits
        SYBIL_TIMING,        // commits within 2s of each other
        COLLUSION_RING,      // 90%+ co-occurrence in batches
        PLAGIARISM,          // 70%+ Jaccard similarity on outputs
        REPUTATION_CHURN,    // 5+ burn/revoke cycles
        VELOCITY_SPIKE       // 3x normal activity from dormant account
    }

    /// @notice Flag severity levels
    enum Severity {
        INFO,       // -1 trust score
        WARNING,    // -5 trust score
        HIGH,       // -15 trust score
        CRITICAL    // -30 trust score
    }

    /// @notice Trust tiers matching CogProof's behavior-analyzer.js
    enum TrustTier {
        FLAGGED,     // 0-19
        SUSPICIOUS,  // 20-39
        CAUTIOUS,    // 40-59
        NORMAL,      // 60-79
        TRUSTED      // 80-100
    }

    // ============ Structs ============

    struct BehaviorReport {
        uint256 trustScore;       // 0-100
        TrustTier tier;
        uint64 epoch;             // when this was computed
        uint16 totalFlags;
        uint16 criticalFlags;
        bytes32 reportHash;       // Merkle leaf for verification
    }

    // ============ Events ============

    event BehaviorEpochSubmitted(uint64 indexed epoch, bytes32 merkleRoot, address indexed submitter);
    event BehaviorEpochFinalized(uint64 indexed epoch, uint256 userCount);
    event FraudFlagRecorded(address indexed user, FraudFlag flag, Severity severity);
    event ActionRecorded(address indexed user, uint256 epochActionCount);

    // ============ Errors ============

    error EpochAlreadySubmitted();
    error EpochNotSubmitted();
    error ReportArrayMismatch();
    error InvalidTrustScore();
    error RateLimited();

    // ============ Functions ============

    function getBehaviorReport(address user) external view returns (BehaviorReport memory);
    function hasActiveFlag(address user, FraudFlag flag) external view returns (bool);
    function getFlagCount(address user, Severity minSeverity) external view returns (uint16);
    function isRateLimited(address user) external view returns (bool);
    function recordAction(address user) external;
}
