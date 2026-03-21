// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./VerifiedCompute.sol";

/**
 * @title VoteVerifier — Off-Chain Tallying, On-Chain Truth
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Verifies off-chain vote tallies against on-chain invariants.
 *         Complex voting schemes (quadratic, conviction, Shapley-weighted)
 *         are computed off-chain; this contract verifies the results
 *         satisfy fundamental democratic invariants.
 *
 * @dev On-chain invariant checks:
 *      1. Conservation  — totalVotesCast == sum(optionVotes)
 *      2. No inflation  — totalVotesCast <= registeredVoters
 *      3. Quorum        — totalVotesCast >= quorumThreshold
 *      4. No zero opts  — at least one option received votes
 *      5. Merkle        — proof verifies against expected root
 *
 *      DAOTreasury and governance contracts consume verified tallies
 *      via getVerifiedTally() instead of trusting off-chain governance.
 *      P-000: Fairness Above All.
 */
contract VoteVerifier is VerifiedCompute {
    // ============ Types ============

    struct VoteResult {
        bytes32 proposalId;
        uint256[] optionVotes;
        uint256 totalVotesCast;
        uint256 registeredVoters;
        uint256 quorumRequired;
        uint8 winningOption;
        bool quorumMet;
    }

    // ============ Errors ============

    error EmptyOptions();
    error ConservationViolation(uint256 sumVotes, uint256 declaredTotal);
    error InflationViolation(uint256 totalVotes, uint256 registeredVoters);
    error QuorumNotMet(uint256 totalVotes, uint256 quorumRequired);
    error NoVotesCast();
    error ProposalNotFinalized();
    error ProposalAlreadySubmitted();
    error ZeroRegisteredVoters();
    error InvalidWinningOption(uint8 declared, uint8 actual);

    // ============ Events ============

    event VoteResultSubmitted(bytes32 indexed proposalId, uint256 optionCount, uint256 totalVotes, address indexed submitter);
    event VoteResultFinalized(bytes32 indexed proposalId, uint8 winningOption, bool quorumMet);

    // ============ State ============

    mapping(bytes32 => VoteResult) internal voteResults;
    mapping(bytes32 => bytes32) public expectedRoots;

    /// @notice Default quorum as basis points of registered voters (e.g., 1000 = 10%)
    uint256 public defaultQuorumBps;

    // ============ Init ============

    function initialize(
        uint256 _disputeWindow,
        uint256 _bondAmount,
        uint256 _defaultQuorumBps
    ) external initializer {
        __VerifiedCompute_init(_disputeWindow, _bondAmount);
        defaultQuorumBps = _defaultQuorumBps;
    }

    // ============ Root Management ============

    function setExpectedRoot(bytes32 proposalId, bytes32 root) external onlyOwner {
        expectedRoots[proposalId] = root;
    }

    function setExpectedRoots(bytes32[] calldata proposalIds, bytes32[] calldata roots) external onlyOwner {
        if (proposalIds.length != roots.length) revert EmptyOptions();
        for (uint256 i = 0; i < proposalIds.length; i++) expectedRoots[proposalIds[i]] = roots[i];
    }

    // ============ Types (Submission) ============

    struct VoteSubmission {
        bytes32 proposalId;
        uint256[] optionVotes;
        uint256 totalVotesCast;
        uint256 registeredVoters;
        uint256 quorumRequired;
        uint8 winningOption;
    }

    // ============ Vote Result Submission ============

    /// @notice Submit off-chain vote tally for on-chain invariant verification
    function submitVoteResult(
        VoteSubmission calldata sub,
        bytes32[] calldata merkleProof
    ) external {
        // --- Input validation ---
        if (sub.optionVotes.length == 0) revert EmptyOptions();
        if (sub.registeredVoters == 0) revert ZeroRegisteredVoters();
        if (sub.totalVotesCast == 0) revert NoVotesCast();
        if (results[sub.proposalId].status != ResultStatus.None) revert ProposalAlreadySubmitted();
        if (!submitters[msg.sender]) revert NotBondedSubmitter();

        // --- Invariant 1: Conservation — sum(optionVotes) == totalVotesCast ---
        uint256 sum = 0;
        for (uint256 i = 0; i < sub.optionVotes.length; i++) sum += sub.optionVotes[i];
        if (sum != sub.totalVotesCast) revert ConservationViolation(sum, sub.totalVotesCast);

        // --- Invariant 2: No inflation — totalVotesCast <= registeredVoters ---
        if (sub.totalVotesCast > sub.registeredVoters) revert InflationViolation(sub.totalVotesCast, sub.registeredVoters);

        // --- Invariant 3: Quorum — totalVotesCast >= quorumRequired ---
        if (sub.totalVotesCast < sub.quorumRequired) revert QuorumNotMet(sub.totalVotesCast, sub.quorumRequired);

        // --- Invariant 4: Winning option is actually the highest ---
        if (sub.winningOption >= sub.optionVotes.length) revert InvalidWinningOption(sub.winningOption, 0);
        for (uint256 i = 0; i < sub.optionVotes.length; i++) {
            if (sub.optionVotes[i] > sub.optionVotes[sub.winningOption]) {
                revert InvalidWinningOption(sub.winningOption, uint8(i));
            }
        }

        // --- Invariant 5: Merkle proof ---
        bytes32 resultHash = keccak256(abi.encode(
            sub.proposalId, sub.optionVotes, sub.totalVotesCast,
            sub.registeredVoters, sub.quorumRequired, sub.winningOption
        ));
        bytes32 expectedRoot = _getExpectedRoot(sub.proposalId);
        if (!_verifyMerkleProof(resultHash, merkleProof, expectedRoot)) {
            revert InvalidMerkleProof();
        }

        // --- Store result ---
        voteResults[sub.proposalId] = VoteResult({
            proposalId: sub.proposalId,
            optionVotes: sub.optionVotes,
            totalVotesCast: sub.totalVotesCast,
            registeredVoters: sub.registeredVoters,
            quorumRequired: sub.quorumRequired,
            winningOption: sub.winningOption,
            quorumMet: true // Already verified quorum above
        });
        results[sub.proposalId] = ComputeResult({
            resultHash: resultHash, submitter: msg.sender,
            timestamp: block.timestamp, status: ResultStatus.Pending
        });
        emit VoteResultSubmitted(sub.proposalId, sub.optionVotes.length, sub.totalVotesCast, msg.sender);
        emit ResultSubmitted(sub.proposalId, resultHash, msg.sender);
    }

    // ============ Finalization ============

    function finalizeVoteResult(bytes32 proposalId) external {
        ComputeResult storage r = results[proposalId];
        if (r.status != ResultStatus.Pending) revert ResultNotPending();
        if (block.timestamp < r.timestamp + disputeWindow) revert DisputeWindowActive();
        r.status = ResultStatus.Finalized;

        VoteResult storage v = voteResults[proposalId];
        emit VoteResultFinalized(proposalId, v.winningOption, v.quorumMet);
        emit ResultFinalized(proposalId, r.resultHash);
    }

    // ============ Consumer Interface ============

    /// @dev DAOTreasury / governance calls this for verified vote outcomes
    function getVerifiedTally(bytes32 proposalId) external view
        returns (uint256[] memory optionVotes, uint8 winningOption, bool quorumMet)
    {
        if (results[proposalId].status != ResultStatus.Finalized) revert ProposalNotFinalized();
        VoteResult storage v = voteResults[proposalId];
        return (v.optionVotes, v.winningOption, v.quorumMet);
    }

    function getVerifiedWinner(bytes32 proposalId) external view returns (uint8) {
        if (results[proposalId].status != ResultStatus.Finalized) revert ProposalNotFinalized();
        return voteResults[proposalId].winningOption;
    }

    function isQuorumMet(bytes32 proposalId) external view returns (bool) {
        if (results[proposalId].status != ResultStatus.Finalized) revert ProposalNotFinalized();
        return voteResults[proposalId].quorumMet;
    }

    function getVoterTurnout(bytes32 proposalId) external view returns (uint256 turnoutBps) {
        if (results[proposalId].status != ResultStatus.Finalized) revert ProposalNotFinalized();
        VoteResult storage v = voteResults[proposalId];
        if (v.registeredVoters == 0) return 0;
        return (v.totalVotesCast * BASIS_POINTS) / v.registeredVoters;
    }

    // ============ Internal Overrides ============

    function _getExpectedRoot(bytes32 computeId) internal view override returns (bytes32) {
        return expectedRoots[computeId];
    }

    function _validateDispute(bytes32 computeId, bytes calldata evidence) internal override returns (bool) {
        (uint256[] memory correctVotes, uint256 correctTotal, uint8 correctWinner)
            = abi.decode(evidence, (uint256[], uint256, uint8));

        VoteResult storage submitted = voteResults[computeId];

        // Check if disputer's data differs and is internally consistent
        if (correctVotes.length != submitted.optionVotes.length) return true;

        bool differs = false;
        uint256 sum = 0;
        for (uint256 i = 0; i < correctVotes.length; i++) {
            sum += correctVotes[i];
            if (correctVotes[i] != submitted.optionVotes[i]) differs = true;
        }

        if (!differs) return false;

        // Verify disputer's values are consistent
        if (sum != correctTotal) return false;
        if (correctTotal > submitted.registeredVoters) return false;
        if (correctWinner >= correctVotes.length) return false;
        for (uint256 i = 0; i < correctVotes.length; i++) {
            if (correctVotes[i] > correctVotes[correctWinner]) return false;
        }
        return true;
    }

    // ============ Admin ============

    function setDefaultQuorumBps(uint256 _bps) external onlyOwner {
        defaultQuorumBps = _bps;
    }

    // ============ View ============

    function getVoteResult(bytes32 proposalId) external view
        returns (uint256[] memory, uint256, uint256, uint256, uint8, bool, ResultStatus)
    {
        VoteResult storage v = voteResults[proposalId];
        return (
            v.optionVotes, v.totalVotesCast, v.registeredVoters,
            v.quorumRequired, v.winningOption, v.quorumMet,
            results[proposalId].status
        );
    }

    // ============ Pure Verification (Account Model Agnostic) ============

    /// @notice Verify vote invariants — pure math, portable to CKB RISC-V
    function verifyVoteInvariants(
        uint256[] calldata optionVotes,
        uint256 totalVotesCast,
        uint256 registeredVoters,
        uint8 winningOption
    ) public pure returns (bool) {
        if (optionVotes.length == 0) return false;
        if (totalVotesCast == 0) return false;
        if (totalVotesCast > registeredVoters) return false;
        if (winningOption >= optionVotes.length) return false;

        uint256 sum = 0;
        for (uint256 i = 0; i < optionVotes.length; i++) {
            sum += optionVotes[i];
            if (optionVotes[i] > optionVotes[winningOption]) return false;
        }
        return sum == totalVotesCast;
    }
}
