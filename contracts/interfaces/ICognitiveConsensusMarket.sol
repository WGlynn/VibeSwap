// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICognitiveConsensusMarket
 * @notice Interface for CognitiveConsensusMarket used by IntelligenceExchange
 *         to submit claims for decentralized CRPC evaluation.
 */
interface ICognitiveConsensusMarket {
    enum ClaimState {
        OPEN,
        REVEAL,
        COMPARING,
        RESOLVED,
        EXPIRED
    }

    enum Verdict {
        NONE,
        TRUE,
        FALSE,
        UNCERTAIN
    }

    function submitClaim(
        bytes32 claimHash,
        uint256 bounty,
        uint256 minEvaluators
    ) external returns (uint256 claimId);

    function claims(uint256 claimId) external view returns (
        bytes32 claimHash,
        address proposer,
        uint256 bounty,
        uint256 commitDeadline,
        uint256 revealDeadline,
        uint256 minEvaluators,
        ClaimState state,
        Verdict verdict,
        uint256 trueVotes,
        uint256 falseVotes,
        uint256 uncertainVotes,
        uint256 totalStake,
        uint256 totalReputationWeight
    );

    /// @notice Lightweight getter returning only claim state and verdict.
    /// @dev Avoids 13-value tuple destructuring which causes stack-too-deep in callers.
    function getClaimStateAndVerdict(uint256 claimId) external view returns (
        ClaimState state,
        Verdict verdict
    );
}
