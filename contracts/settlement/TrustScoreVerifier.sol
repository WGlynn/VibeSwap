// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./VerifiedCompute.sol";

/**
 * @title TrustScoreVerifier — Off-Chain Trust, On-Chain Truth
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Verifies off-chain trust/reputation score computations against
 *         on-chain invariants. Trust scoring (PageRank over ContributionDAG,
 *         behavioral analysis, cross-chain reputation) runs off-chain;
 *         this contract cheaply verifies results are internally consistent.
 *
 * @dev On-chain invariant checks:
 *      1. Bounded    — all scores within [0, MAX_SCORE]
 *      2. Normalized — sum of scores == declared totalScore (no inflation)
 *      3. Non-zero   — no participant with interactions has zero score
 *      4. Merkle     — proof verifies against expected root
 *
 *      SoulboundIdentity and ContributionDAG consume verified scores
 *      via getVerifiedScores() instead of trusting off-chain oracles.
 *      P-000: Fairness Above All.
 */
contract TrustScoreVerifier is VerifiedCompute {
    // ============ Types ============

    struct TrustResult {
        address[] participants;
        uint256[] scores;
        uint256 totalScore;
        uint64 epoch;
    }

    // ============ Constants ============

    /// @notice Maximum individual trust score (10000 = 100.00%)
    uint256 public constant MAX_SCORE = 10000;

    /// @notice Minimum score for any active participant (1 = 0.01%)
    /// @dev Mirrors Lawson Floor philosophy — showed up honestly, get something
    uint256 public constant MIN_ACTIVE_SCORE = 1;

    // ============ Errors ============

    error ArrayLengthMismatch();
    error EmptyParticipants();
    error ScoreExceedsBound(uint256 score, uint256 max);
    error TotalScoreMismatch(uint256 sumScores, uint256 declaredTotal);
    error ZeroScoreViolation(address participant);
    error EpochNotFinalized();
    error EpochAlreadySubmitted();
    error ZeroTotalScore();

    // ============ Events ============

    event TrustResultSubmitted(bytes32 indexed epochId, uint256 participantCount, uint64 epoch, address indexed submitter);
    event TrustResultFinalized(bytes32 indexed epochId, uint256 participantCount);

    // ============ State ============

    mapping(bytes32 => TrustResult) internal trustResults;
    mapping(bytes32 => bytes32) public expectedRoots;

    /// @notice Latest finalized epoch ID for sequential consumption
    bytes32 public latestFinalizedEpoch;

    // ============ Init ============

    function initialize(uint256 _disputeWindow, uint256 _bondAmount) external initializer {
        __VerifiedCompute_init(_disputeWindow, _bondAmount);
    }

    // ============ Root Management ============

    function setExpectedRoot(bytes32 epochId, bytes32 root) external onlyOwner {
        expectedRoots[epochId] = root;
    }

    function setExpectedRoots(bytes32[] calldata epochIds, bytes32[] calldata roots) external onlyOwner {
        if (epochIds.length != roots.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < epochIds.length; i++) expectedRoots[epochIds[i]] = roots[i];
    }

    // ============ Trust Score Submission ============

    /// @notice Submit off-chain trust scores for on-chain invariant verification
    function submitTrustResult(
        bytes32 epochId,
        address[] calldata participants,
        uint256[] calldata scores,
        uint256 totalScore,
        uint64 epoch,
        bytes32[] calldata merkleProof
    ) external {
        // --- Input validation ---
        if (participants.length == 0) revert EmptyParticipants();
        if (participants.length != scores.length) revert ArrayLengthMismatch();
        if (totalScore == 0) revert ZeroTotalScore();
        if (results[epochId].status != ResultStatus.None) revert EpochAlreadySubmitted();
        if (!submitters[msg.sender]) revert NotBondedSubmitter();

        // --- Invariant 1: Bounded — all scores within [0, MAX_SCORE] ---
        uint256 sum = 0;
        for (uint256 i = 0; i < scores.length; i++) {
            if (scores[i] > MAX_SCORE) revert ScoreExceedsBound(scores[i], MAX_SCORE);
            sum += scores[i];
        }

        // --- Invariant 2: Normalized — sum matches declared total ---
        if (sum != totalScore) revert TotalScoreMismatch(sum, totalScore);

        // --- Invariant 3: Non-zero — no active participant has zero score ---
        for (uint256 i = 0; i < scores.length; i++) {
            if (scores[i] < MIN_ACTIVE_SCORE) revert ZeroScoreViolation(participants[i]);
        }

        // --- Invariant 4: Merkle proof ---
        bytes32 resultHash = keccak256(abi.encode(epochId, participants, scores, totalScore, epoch));
        bytes32 expectedRoot = _getExpectedRoot(epochId);
        if (!_verifyMerkleProof(resultHash, merkleProof, expectedRoot)) {
            revert InvalidMerkleProof();
        }

        // --- Store result ---
        trustResults[epochId] = TrustResult(participants, scores, totalScore, epoch);
        results[epochId] = ComputeResult({
            resultHash: resultHash, submitter: msg.sender,
            timestamp: block.timestamp, status: ResultStatus.Pending
        });
        emit TrustResultSubmitted(epochId, participants.length, epoch, msg.sender);
        emit ResultSubmitted(epochId, resultHash, msg.sender);
    }

    // ============ Finalization ============

    function finalizeTrustResult(bytes32 epochId) external {
        ComputeResult storage r = results[epochId];
        if (r.status != ResultStatus.Pending) revert ResultNotPending();
        if (block.timestamp < r.timestamp + disputeWindow) revert DisputeWindowActive();
        r.status = ResultStatus.Finalized;
        latestFinalizedEpoch = epochId;
        emit TrustResultFinalized(epochId, trustResults[epochId].participants.length);
        emit ResultFinalized(epochId, r.resultHash);
    }

    // ============ Consumer Interface ============

    /// @dev SoulboundIdentity / ContributionDAG calls this to get verified trust scores
    function getVerifiedScores(bytes32 epochId) external view returns (address[] memory, uint256[] memory) {
        if (results[epochId].status != ResultStatus.Finalized) revert EpochNotFinalized();
        TrustResult storage t = trustResults[epochId];
        return (t.participants, t.scores);
    }

    function getVerifiedTotalScore(bytes32 epochId) external view returns (uint256) {
        if (results[epochId].status != ResultStatus.Finalized) revert EpochNotFinalized();
        return trustResults[epochId].totalScore;
    }

    function getVerifiedEpoch(bytes32 epochId) external view returns (uint64) {
        if (results[epochId].status != ResultStatus.Finalized) revert EpochNotFinalized();
        return trustResults[epochId].epoch;
    }

    // ============ Internal Overrides ============

    function _getExpectedRoot(bytes32 computeId) internal view override returns (bytes32) {
        return expectedRoots[computeId];
    }

    function _validateDispute(bytes32 computeId, bytes calldata evidence) internal override returns (bool) {
        (address[] memory correctParticipants, uint256[] memory correctScores, uint256 correctTotal)
            = abi.decode(evidence, (address[], uint256[], uint256));

        TrustResult storage submitted = trustResults[computeId];
        if (correctParticipants.length != submitted.participants.length) return true;

        for (uint256 i = 0; i < correctScores.length; i++) {
            if (correctScores[i] != submitted.scores[i]) {
                // Verify the disputer's values are internally consistent
                uint256 sum = 0;
                for (uint256 j = 0; j < correctScores.length; j++) {
                    if (correctScores[j] > MAX_SCORE) return false;
                    sum += correctScores[j];
                }
                return sum == correctTotal;
            }
        }
        return false;
    }

    // ============ View ============

    function getTrustResult(bytes32 epochId) external view
        returns (address[] memory, uint256[] memory, uint256, uint64, ResultStatus)
    {
        TrustResult storage t = trustResults[epochId];
        return (t.participants, t.scores, t.totalScore, t.epoch, results[epochId].status);
    }

    // ============ Pure Verification (Account Model Agnostic) ============

    /// @notice Verify trust score invariants — pure math, portable to CKB RISC-V
    function verifyTrustInvariants(
        uint256 participantCount, uint256[] calldata scores, uint256 totalScore
    ) public pure returns (bool) {
        if (participantCount == 0 || scores.length != participantCount) return false;
        uint256 sum = 0;
        for (uint256 i = 0; i < scores.length; i++) {
            if (scores[i] > MAX_SCORE) return false;
            if (scores[i] < MIN_ACTIVE_SCORE) return false;
            sum += scores[i];
        }
        return sum == totalScore;
    }
}
