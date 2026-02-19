// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPairwiseVerifier
 * @notice CRPC (Commit-Reveal Pairwise Comparison) protocol for verifying
 *         non-deterministic AI outputs on-chain.
 *
 * Absorbed from PsiNet's CRPCValidator — the key insight is that AI outputs
 * are fuzzy and non-deterministic, so traditional hash-based verification fails.
 * CRPC solves this through:
 *
 * Round 1 — WORK COMMIT/REVEAL:
 *   Workers submit hash(work || secret), then reveal work + secret.
 *   Prevents copying: you can't see other work before committing.
 *
 * Round 2 — COMPARISON COMMIT/REVEAL:
 *   Validators compare pairs of revealed work, commit their judgment,
 *   then reveal. Prevents lying: you can't change your mind after seeing others.
 *
 * Settlement:
 *   Workers whose output is consistently preferred get higher rewards.
 *   Validators who agree with consensus earn reputation.
 *
 * VibeSwap integration:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  ReputationOracle    → Pairwise comparison of ADDRESSES         │
 * │  PairwiseVerifier    → Pairwise comparison of WORK OUTPUTS     │
 * │  ContributionAttestor→ Uses verifier for subjective claims     │
 * │  AgentRegistry       → Agents submit work, validators judge    │
 * │  VibeCode            → Verification participation feeds score  │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Think of it as: ReputationOracle rates WHO is trustworthy.
 * PairwiseVerifier rates WHAT output is better.
 */
interface IPairwiseVerifier {

    // ============ Enums ============

    /// @notice Task lifecycle phases
    enum TaskPhase {
        WORK_COMMIT,        // Workers submit hashed work
        WORK_REVEAL,        // Workers reveal work
        COMPARE_COMMIT,     // Validators commit pairwise judgments
        COMPARE_REVEAL,     // Validators reveal judgments
        SETTLED             // Rewards distributed
    }

    /// @notice Pairwise comparison choice
    enum CompareChoice {
        NONE,               // Not yet revealed
        FIRST,              // First submission is better
        SECOND,             // Second submission is better
        EQUIVALENT          // Equal quality
    }

    // ============ Structs ============

    /// @notice A verification task
    struct VerificationTask {
        bytes32 taskId;
        string description;             // What work is being verified
        bytes32 specHash;               // IPFS hash of detailed specification
        address creator;                // Who posted the task
        uint256 rewardPool;             // Total reward for workers + validators
        uint256 validatorRewardBps;     // % of pool for validators (default 3000 = 30%)
        TaskPhase phase;
        uint64 workCommitEnd;
        uint64 workRevealEnd;
        uint64 compareCommitEnd;
        uint64 compareRevealEnd;
        uint256 submissionCount;
        uint256 comparisonCount;
        bool settled;
    }

    /// @notice A work submission
    struct WorkSubmission {
        bytes32 submissionId;
        bytes32 taskId;
        address worker;
        bytes32 commitHash;             // hash(workHash || secret)
        bytes32 workHash;               // IPFS CID of actual work
        bytes32 secret;
        bool revealed;
        uint256 winsCount;              // How many pairwise comparisons won
        uint256 lossCount;
        uint256 tieCount;
        uint256 reward;                 // Computed during settlement
    }

    /// @notice A pairwise comparison by a validator
    struct PairwiseComparison {
        bytes32 comparisonId;
        bytes32 taskId;
        address validator;
        bytes32 submissionA;            // First work being compared
        bytes32 submissionB;            // Second work being compared
        bytes32 commitHash;             // hash(choice || secret)
        CompareChoice choice;
        bytes32 secret;
        bool revealed;
        bool consensusAligned;          // Did this validator agree with majority?
    }

    // ============ Events ============

    event TaskCreated(bytes32 indexed taskId, address indexed creator, uint256 rewardPool);
    event WorkCommitted(bytes32 indexed taskId, bytes32 indexed submissionId, address indexed worker);
    event WorkRevealed(bytes32 indexed taskId, bytes32 indexed submissionId, address indexed worker, bytes32 workHash);
    event ComparisonCommitted(bytes32 indexed taskId, bytes32 indexed comparisonId, address indexed validator);
    event ComparisonRevealed(bytes32 indexed taskId, bytes32 indexed comparisonId, CompareChoice choice);
    event TaskPhaseAdvanced(bytes32 indexed taskId, TaskPhase newPhase);
    event TaskSettled(bytes32 indexed taskId, address indexed winner, uint256 winnerReward);
    event WorkSlashed(bytes32 indexed taskId, bytes32 indexed submissionId, address indexed worker);
    event ValidatorRewarded(bytes32 indexed taskId, address indexed validator, uint256 reward);

    // ============ Errors ============

    error TaskNotFound();
    error WrongPhase(TaskPhase expected, TaskPhase actual);
    error AlreadySubmitted();
    error AlreadyRevealed();
    error InvalidPreimage();
    error SubmissionNotFound();
    error ComparisonNotFound();
    error NotEnoughSubmissions();
    error NotEnoughComparisons();
    error TaskAlreadySettled();
    error InsufficientReward();
    error ZeroAddress();
    error SelfComparison();
    error InvalidPair();

    // ============ Task Management ============

    /// @notice Create a new verification task
    function createTask(
        string calldata description,
        bytes32 specHash,
        uint256 validatorRewardBps,
        uint64 workCommitDuration,
        uint64 workRevealDuration,
        uint64 compareCommitDuration,
        uint64 compareRevealDuration
    ) external payable returns (bytes32 taskId);

    /// @notice Advance task to next phase (permissionless, time-gated)
    function advancePhase(bytes32 taskId) external;

    // ============ Work Phase ============

    /// @notice Worker commits hashed work
    function commitWork(bytes32 taskId, bytes32 commitHash) external returns (bytes32 submissionId);

    /// @notice Worker reveals work
    function revealWork(bytes32 taskId, bytes32 submissionId, bytes32 workHash, bytes32 secret) external;

    // ============ Comparison Phase ============

    /// @notice Validator commits a pairwise comparison
    function commitComparison(
        bytes32 taskId,
        bytes32 submissionA,
        bytes32 submissionB,
        bytes32 commitHash
    ) external returns (bytes32 comparisonId);

    /// @notice Validator reveals comparison
    function revealComparison(
        bytes32 comparisonId,
        CompareChoice choice,
        bytes32 secret
    ) external;

    // ============ Settlement ============

    /// @notice Settle the task — compute winners, distribute rewards
    function settle(bytes32 taskId) external;

    /// @notice Claim reward (pull pattern)
    function claimReward(bytes32 taskId) external;

    // ============ View Functions ============

    function getTask(bytes32 taskId) external view returns (VerificationTask memory);
    function getSubmission(bytes32 submissionId) external view returns (WorkSubmission memory);
    function getComparison(bytes32 comparisonId) external view returns (PairwiseComparison memory);
    function getTaskSubmissions(bytes32 taskId) external view returns (bytes32[] memory);
    function getTaskComparisons(bytes32 taskId) external view returns (bytes32[] memory);
    function getWorkerReward(bytes32 taskId, address worker) external view returns (uint256);
    function getValidatorReward(bytes32 taskId, address validator) external view returns (uint256);
    function totalTasks() external view returns (uint256);
}
