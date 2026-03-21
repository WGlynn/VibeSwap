// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./VerifiedCompute.sol";

/**
 * @title ShapleyVerifier — Off-Chain Shapley, On-Chain Truth
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Verifies off-chain Shapley value computations against on-chain
 *         invariants. O(2^n) game theory math runs off-chain; this contract
 *         cheaply verifies results satisfy the Shapley axioms.
 *
 * @dev On-chain axiom checks:
 *      1. Efficiency  — sum(values) == totalPool
 *      2. Sanity      — no single value > totalPool
 *      3. Lawson Floor — no value < 1% of average (P-000 fairness floor)
 *      4. Merkle      — proof verifies against expected root
 *
 *      ShapleyDistributor calls getVerifiedValues() instead of computing
 *      on-chain — execution/settlement separation in action.
 */
contract ShapleyVerifier is VerifiedCompute {
    // ============ Types ============

    struct ShapleyResult {
        address[] participants;
        uint256[] values;
        uint256 totalPool;
    }

    // ============ Errors ============

    error ArrayLengthMismatch();
    error EmptyParticipants();
    error EfficiencyViolation(uint256 sumValues, uint256 totalPool);
    error SanityViolation(uint256 value, uint256 totalPool);
    error LawsonFloorViolation(uint256 value, uint256 floor);
    error GameNotFinalized();
    error GameAlreadySubmitted();
    error ZeroTotalPool();

    // ============ Events ============

    event ShapleyResultSubmitted(bytes32 indexed gameId, uint256 participantCount, uint256 totalPool, address indexed submitter);
    event ShapleyResultFinalized(bytes32 indexed gameId, uint256 participantCount);

    // ============ State ============

    uint256 public constant LAWSON_FLOOR_BPS = 100; // 1% of average
    mapping(bytes32 => ShapleyResult) internal shapleyResults;
    mapping(bytes32 => bytes32) public expectedRoots;

    // ============ Init ============

    function initialize(uint256 _disputeWindow, uint256 _bondAmount) external initializer {
        __VerifiedCompute_init(_disputeWindow, _bondAmount);
    }

    // ============ Root Management ============

    function setExpectedRoot(bytes32 gameId, bytes32 root) external onlyOwner {
        expectedRoots[gameId] = root;
    }

    function setExpectedRoots(bytes32[] calldata gameIds, bytes32[] calldata roots) external onlyOwner {
        if (gameIds.length != roots.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < gameIds.length; i++) expectedRoots[gameIds[i]] = roots[i];
    }

    // ============ Shapley Submission ============

    /// @notice Submit off-chain Shapley values for on-chain axiom verification
    function submitShapleyResult(
        bytes32 gameId,
        address[] calldata participants,
        uint256[] calldata values,
        uint256 totalPool,
        bytes32[] calldata merkleProof
    ) external {
        // --- Input validation ---
        if (participants.length == 0) revert EmptyParticipants();
        if (participants.length != values.length) revert ArrayLengthMismatch();
        if (totalPool == 0) revert ZeroTotalPool();
        if (results[gameId].status != ResultStatus.None) revert GameAlreadySubmitted();
        if (!submitters[msg.sender]) revert NotBondedSubmitter();

        // --- Axiom 1: Efficiency — sum(values) == totalPool ---
        uint256 sum = 0;
        for (uint256 i = 0; i < values.length; i++) sum += values[i];
        if (sum != totalPool) revert EfficiencyViolation(sum, totalPool);

        // --- Axiom 2: Sanity — no value > totalPool ---
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] > totalPool) revert SanityViolation(values[i], totalPool);
        }

        // --- Axiom 3: Lawson Floor — no value < 1% of average ---
        uint256 average = totalPool / participants.length;
        uint256 floor = (average * LAWSON_FLOOR_BPS) / BASIS_POINTS;
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] < floor) revert LawsonFloorViolation(values[i], floor);
        }

        // --- Axiom 4: Merkle proof ---
        bytes32 resultHash = keccak256(abi.encode(gameId, participants, values, totalPool));
        bytes32 expectedRoot = _getExpectedRoot(gameId);
        if (!_verifyMerkleProof(resultHash, merkleProof, expectedRoot)) {
            revert InvalidMerkleProof();
        }

        // --- Store result ---
        shapleyResults[gameId] = ShapleyResult(participants, values, totalPool);
        results[gameId] = ComputeResult({
            resultHash: resultHash, submitter: msg.sender,
            timestamp: block.timestamp, status: ResultStatus.Pending
        });
        emit ShapleyResultSubmitted(gameId, participants.length, totalPool, msg.sender);
        emit ResultSubmitted(gameId, resultHash, msg.sender);
    }

    // ============ Finalization ============

    function finalizeShapleyResult(bytes32 gameId) external {
        ComputeResult storage r = results[gameId];
        if (r.status != ResultStatus.Pending) revert ResultNotPending();
        if (block.timestamp < r.timestamp + disputeWindow) revert DisputeWindowActive();
        r.status = ResultStatus.Finalized;
        emit ShapleyResultFinalized(gameId, shapleyResults[gameId].participants.length);
        emit ResultFinalized(gameId, r.resultHash);
    }

    // ============ Consumer Interface ============

    /// @dev Integration point: ShapleyDistributor calls this instead of computing on-chain
    function getVerifiedValues(bytes32 gameId) external view returns (address[] memory, uint256[] memory) {
        if (results[gameId].status != ResultStatus.Finalized) revert GameNotFinalized();
        ShapleyResult storage s = shapleyResults[gameId];
        return (s.participants, s.values);
    }

    function getVerifiedTotalPool(bytes32 gameId) external view returns (uint256) {
        if (results[gameId].status != ResultStatus.Finalized) revert GameNotFinalized();
        return shapleyResults[gameId].totalPool;
    }

    // ============ Internal Overrides ============

    function _getExpectedRoot(bytes32 computeId) internal view override returns (bytes32) {
        return expectedRoots[computeId];
    }

    function _validateDispute(bytes32 computeId, bytes calldata evidence) internal override returns (bool) {
        (address[] memory correctParticipants, uint256[] memory correctValues, uint256 correctTotal)
            = abi.decode(evidence, (address[], uint256[], uint256));
        ShapleyResult storage submitted = shapleyResults[computeId];
        if (correctParticipants.length != submitted.participants.length) return true;
        for (uint256 i = 0; i < correctValues.length; i++) {
            if (correctValues[i] != submitted.values[i]) {
                uint256 sum = 0;
                for (uint256 j = 0; j < correctValues.length; j++) sum += correctValues[j];
                return sum == correctTotal;
            }
        }
        return false;
    }

    // ============ View ============

    function getShapleyResult(bytes32 gameId) external view
        returns (address[] memory, uint256[] memory, uint256, ResultStatus)
    {
        ShapleyResult storage s = shapleyResults[gameId];
        return (s.participants, s.values, s.totalPool, results[gameId].status);
    }

    // ============ Pure Verification (Account Model Agnostic) ============

    /// @notice Verify Shapley axioms — pure math, portable to CKB RISC-V cell scripts
    function verifyShapleyAxioms(
        uint256 participantCount, uint256[] calldata values, uint256 totalPool
    ) public pure returns (bool) {
        uint256 sum = 0;
        for (uint256 i = 0; i < values.length; i++) {
            sum += values[i];
            if (values[i] > totalPool) return false;
        }
        if (sum != totalPool) return false;
        if (participantCount > 0) {
            uint256 floor = (totalPool / participantCount * LAWSON_FLOOR_BPS) / BASIS_POINTS;
            for (uint256 i = 0; i < values.length; i++) {
                if (values[i] < floor) return false;
            }
        }
        return true;
    }
}
