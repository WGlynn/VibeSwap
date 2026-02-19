// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IPairwiseVerifier.sol";
import "./interfaces/IAgentRegistry.sol";

/**
 * @title PairwiseVerifier
 * @notice CRPC (Commit-Reveal Pairwise Comparison) — PsiNet × VibeSwap merge.
 *
 * Verifies non-deterministic AI outputs on-chain through 4-phase protocol:
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  Phase 1: WORK_COMMIT    │ Workers hash(work || secret)      │
 * │  Phase 2: WORK_REVEAL    │ Workers reveal work + secret      │
 * │  Phase 3: COMPARE_COMMIT │ Validators hash(choice || secret) │
 * │  Phase 4: COMPARE_REVEAL │ Validators reveal pairwise votes  │
 * │  Settlement              │ Winners get 70%, validators 30%   │
 * └──────────────────────────────────────────────────────────────┘
 *
 * This is the missing piece that makes AI governance possible.
 * ReputationOracle answers: "WHO is trustworthy?"
 * PairwiseVerifier answers: "WHICH output is better?"
 *
 * Use cases:
 * - Verify AI-generated code quality for ContributionAttestor
 * - Compare governance proposal analyses
 * - Validate oracle price feeds from AI agents
 * - Settle disputes about subjective contribution value
 */
contract PairwiseVerifier is IPairwiseVerifier, OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {

    // ============ Constants ============

    uint256 public constant BPS = 10_000;
    uint256 public constant DEFAULT_VALIDATOR_REWARD_BPS = 3000;    // 30%
    uint256 public constant MIN_SUBMISSIONS = 2;
    uint256 public constant MAX_SUBMISSIONS = 20;
    uint256 public constant MIN_COMPARISONS_PER_PAIR = 3;
    uint256 public constant SLASH_RATE_BPS = 5000;                  // 50% for non-reveal

    // ============ State ============

    uint256 private _taskNonce;
    uint256 private _submissionNonce;
    uint256 private _comparisonNonce;

    // Task storage
    mapping(bytes32 => VerificationTask) private _tasks;

    // Submissions per task
    mapping(bytes32 => bytes32[]) private _taskSubmissions;         // taskId → submissionIds
    mapping(bytes32 => WorkSubmission) private _submissions;
    mapping(bytes32 => mapping(address => bool)) private _hasSubmitted; // taskId → worker → bool

    // Comparisons per task
    mapping(bytes32 => bytes32[]) private _taskComparisons;         // taskId → comparisonIds
    mapping(bytes32 => PairwiseComparison) private _comparisons;
    mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) private _hasCompared; // taskId → pairHash → validator → bool

    // Rewards (pull pattern)
    mapping(bytes32 => mapping(address => uint256)) private _rewards; // taskId → address → reward
    mapping(bytes32 => mapping(address => bool)) private _claimed;

    // External
    IAgentRegistry public agentRegistry;

    // ============ Initializer ============

    function initialize(address _agentRegistry) external initializer {
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        agentRegistry = IAgentRegistry(_agentRegistry);
        _taskNonce = 1;
        _submissionNonce = 1;
        _comparisonNonce = 1;
    }

    // ============ Task Management ============

    /// @inheritdoc IPairwiseVerifier
    function createTask(
        string calldata description,
        bytes32 specHash,
        uint256 validatorRewardBps,
        uint64 workCommitDuration,
        uint64 workRevealDuration,
        uint64 compareCommitDuration,
        uint64 compareRevealDuration
    ) external payable returns (bytes32 taskId) {
        if (msg.value == 0) revert InsufficientReward();
        if (validatorRewardBps > BPS) validatorRewardBps = DEFAULT_VALIDATOR_REWARD_BPS;

        taskId = keccak256(abi.encodePacked(msg.sender, _taskNonce++, block.timestamp));

        uint64 now64 = uint64(block.timestamp);
        _tasks[taskId] = VerificationTask({
            taskId: taskId,
            description: description,
            specHash: specHash,
            creator: msg.sender,
            rewardPool: msg.value,
            validatorRewardBps: validatorRewardBps,
            phase: TaskPhase.WORK_COMMIT,
            workCommitEnd: now64 + workCommitDuration,
            workRevealEnd: now64 + workCommitDuration + workRevealDuration,
            compareCommitEnd: now64 + workCommitDuration + workRevealDuration + compareCommitDuration,
            compareRevealEnd: now64 + workCommitDuration + workRevealDuration + compareCommitDuration + compareRevealDuration,
            submissionCount: 0,
            comparisonCount: 0,
            settled: false
        });

        emit TaskCreated(taskId, msg.sender, msg.value);
    }

    /// @inheritdoc IPairwiseVerifier
    function advancePhase(bytes32 taskId) external {
        VerificationTask storage task = _tasks[taskId];
        if (task.rewardPool == 0) revert TaskNotFound();
        if (task.settled) revert TaskAlreadySettled();

        uint64 now64 = uint64(block.timestamp);
        TaskPhase currentPhase = task.phase;

        if (currentPhase == TaskPhase.WORK_COMMIT && now64 >= task.workCommitEnd) {
            task.phase = TaskPhase.WORK_REVEAL;
        } else if (currentPhase == TaskPhase.WORK_REVEAL && now64 >= task.workRevealEnd) {
            task.phase = TaskPhase.COMPARE_COMMIT;
        } else if (currentPhase == TaskPhase.COMPARE_COMMIT && now64 >= task.compareCommitEnd) {
            task.phase = TaskPhase.COMPARE_REVEAL;
        } else if (currentPhase == TaskPhase.COMPARE_REVEAL && now64 >= task.compareRevealEnd) {
            task.phase = TaskPhase.SETTLED;
        } else {
            revert WrongPhase(TaskPhase(uint8(currentPhase) + 1), currentPhase);
        }

        emit TaskPhaseAdvanced(taskId, task.phase);
    }

    // ============ Work Phase ============

    /// @inheritdoc IPairwiseVerifier
    function commitWork(bytes32 taskId, bytes32 commitHash) external returns (bytes32 submissionId) {
        VerificationTask storage task = _tasks[taskId];
        if (task.rewardPool == 0) revert TaskNotFound();
        if (task.phase != TaskPhase.WORK_COMMIT) revert WrongPhase(TaskPhase.WORK_COMMIT, task.phase);
        if (_hasSubmitted[taskId][msg.sender]) revert AlreadySubmitted();
        if (task.submissionCount >= MAX_SUBMISSIONS) revert AlreadySubmitted();

        submissionId = keccak256(abi.encodePacked(taskId, msg.sender, _submissionNonce++));
        _hasSubmitted[taskId][msg.sender] = true;

        _submissions[submissionId] = WorkSubmission({
            submissionId: submissionId,
            taskId: taskId,
            worker: msg.sender,
            commitHash: commitHash,
            workHash: bytes32(0),
            secret: bytes32(0),
            revealed: false,
            winsCount: 0,
            lossCount: 0,
            tieCount: 0,
            reward: 0
        });

        _taskSubmissions[taskId].push(submissionId);
        task.submissionCount++;

        emit WorkCommitted(taskId, submissionId, msg.sender);
    }

    /// @inheritdoc IPairwiseVerifier
    function revealWork(
        bytes32 taskId,
        bytes32 submissionId,
        bytes32 workHash,
        bytes32 secret
    ) external {
        VerificationTask storage task = _tasks[taskId];
        if (task.rewardPool == 0) revert TaskNotFound();
        if (task.phase != TaskPhase.WORK_REVEAL) revert WrongPhase(TaskPhase.WORK_REVEAL, task.phase);

        WorkSubmission storage sub = _submissions[submissionId];
        if (sub.worker != msg.sender) revert SubmissionNotFound();
        if (sub.revealed) revert AlreadyRevealed();

        // Verify preimage
        bytes32 expectedHash = keccak256(abi.encodePacked(workHash, secret));
        if (expectedHash != sub.commitHash) revert InvalidPreimage();

        sub.workHash = workHash;
        sub.secret = secret;
        sub.revealed = true;

        emit WorkRevealed(taskId, submissionId, msg.sender, workHash);
    }

    // ============ Comparison Phase ============

    /// @inheritdoc IPairwiseVerifier
    function commitComparison(
        bytes32 taskId,
        bytes32 submissionA,
        bytes32 submissionB,
        bytes32 commitHash
    ) external returns (bytes32 comparisonId) {
        VerificationTask storage task = _tasks[taskId];
        if (task.rewardPool == 0) revert TaskNotFound();
        if (task.phase != TaskPhase.COMPARE_COMMIT) revert WrongPhase(TaskPhase.COMPARE_COMMIT, task.phase);
        if (submissionA == submissionB) revert SelfComparison();

        // Verify both submissions exist and are revealed
        WorkSubmission storage subA = _submissions[submissionA];
        WorkSubmission storage subB = _submissions[submissionB];
        if (!subA.revealed || !subB.revealed) revert SubmissionNotFound();
        if (subA.taskId != taskId || subB.taskId != taskId) revert InvalidPair();

        // Prevent duplicate comparisons from same validator for same pair
        bytes32 pairHash = _pairHash(submissionA, submissionB);
        if (_hasCompared[taskId][pairHash][msg.sender]) revert AlreadySubmitted();
        _hasCompared[taskId][pairHash][msg.sender] = true;

        comparisonId = keccak256(abi.encodePacked(taskId, msg.sender, _comparisonNonce++));

        _comparisons[comparisonId] = PairwiseComparison({
            comparisonId: comparisonId,
            taskId: taskId,
            validator: msg.sender,
            submissionA: submissionA,
            submissionB: submissionB,
            commitHash: commitHash,
            choice: CompareChoice.NONE,
            secret: bytes32(0),
            revealed: false,
            consensusAligned: false
        });

        _taskComparisons[taskId].push(comparisonId);
        task.comparisonCount++;

        emit ComparisonCommitted(taskId, comparisonId, msg.sender);
    }

    /// @inheritdoc IPairwiseVerifier
    function revealComparison(
        bytes32 comparisonId,
        CompareChoice choice,
        bytes32 secret
    ) external {
        PairwiseComparison storage comp = _comparisons[comparisonId];
        if (comp.validator != msg.sender) revert ComparisonNotFound();
        if (comp.revealed) revert AlreadyRevealed();

        VerificationTask storage task = _tasks[comp.taskId];
        if (task.phase != TaskPhase.COMPARE_REVEAL) {
            revert WrongPhase(TaskPhase.COMPARE_REVEAL, task.phase);
        }

        // Verify preimage
        bytes32 expectedHash = keccak256(abi.encodePacked(uint8(choice), secret));
        if (expectedHash != comp.commitHash) revert InvalidPreimage();

        comp.choice = choice;
        comp.secret = secret;
        comp.revealed = true;

        emit ComparisonRevealed(comp.taskId, comparisonId, choice);
    }

    // ============ Settlement ============

    /// @inheritdoc IPairwiseVerifier
    function settle(bytes32 taskId) external nonReentrant {
        VerificationTask storage task = _tasks[taskId];
        if (task.rewardPool == 0) revert TaskNotFound();
        if (task.settled) revert TaskAlreadySettled();
        // Allow settlement after compare reveal ends
        require(
            task.phase == TaskPhase.SETTLED ||
            (task.phase == TaskPhase.COMPARE_REVEAL && block.timestamp >= task.compareRevealEnd),
            "Not ready to settle"
        );

        task.settled = true;
        task.phase = TaskPhase.SETTLED;

        bytes32[] storage submissions = _taskSubmissions[taskId];
        bytes32[] storage comparisons = _taskComparisons[taskId];

        // Tally wins/losses from revealed comparisons
        for (uint256 i = 0; i < comparisons.length; i++) {
            PairwiseComparison storage comp = _comparisons[comparisons[i]];
            if (!comp.revealed) continue;

            WorkSubmission storage subA = _submissions[comp.submissionA];
            WorkSubmission storage subB = _submissions[comp.submissionB];

            if (comp.choice == CompareChoice.FIRST) {
                subA.winsCount++;
                subB.lossCount++;
            } else if (comp.choice == CompareChoice.SECOND) {
                subB.winsCount++;
                subA.lossCount++;
            } else if (comp.choice == CompareChoice.EQUIVALENT) {
                subA.tieCount++;
                subB.tieCount++;
            }
        }

        // Calculate worker rewards (proportional to win rate)
        uint256 workerPool = task.rewardPool * (BPS - task.validatorRewardBps) / BPS;
        uint256 validatorPool = task.rewardPool - workerPool;

        uint256 totalWinScore = 0;
        for (uint256 i = 0; i < submissions.length; i++) {
            WorkSubmission storage sub = _submissions[submissions[i]];
            if (!sub.revealed) continue;
            // Win score: wins * 2 + ties * 1
            totalWinScore += sub.winsCount * 2 + sub.tieCount;
        }

        // Distribute worker rewards proportionally
        address winner = address(0);
        uint256 highestScore = 0;
        if (totalWinScore > 0) {
            for (uint256 i = 0; i < submissions.length; i++) {
                WorkSubmission storage sub = _submissions[submissions[i]];
                if (!sub.revealed) continue;

                uint256 winScore = sub.winsCount * 2 + sub.tieCount;
                sub.reward = workerPool * winScore / totalWinScore;
                _rewards[taskId][sub.worker] += sub.reward;

                if (winScore > highestScore) {
                    highestScore = winScore;
                    winner = sub.worker;
                }
            }
        }

        // Determine consensus for each comparison pair
        // For each pair, majority choice is consensus
        _markConsensusAligned(taskId, comparisons);

        // Distribute validator rewards to consensus-aligned validators
        uint256 alignedCount = 0;
        for (uint256 i = 0; i < comparisons.length; i++) {
            if (_comparisons[comparisons[i]].revealed && _comparisons[comparisons[i]].consensusAligned) {
                alignedCount++;
            }
        }

        if (alignedCount > 0) {
            uint256 perValidator = validatorPool / alignedCount;
            for (uint256 i = 0; i < comparisons.length; i++) {
                PairwiseComparison storage comp = _comparisons[comparisons[i]];
                if (comp.revealed && comp.consensusAligned) {
                    _rewards[taskId][comp.validator] += perValidator;
                    emit ValidatorRewarded(taskId, comp.validator, perValidator);
                }
            }
        }

        if (winner != address(0)) {
            emit TaskSettled(taskId, winner, _rewards[taskId][winner]);
        }
    }

    /// @inheritdoc IPairwiseVerifier
    function claimReward(bytes32 taskId) external nonReentrant {
        uint256 reward = _rewards[taskId][msg.sender];
        if (reward == 0) revert InsufficientReward();
        if (_claimed[taskId][msg.sender]) revert AlreadySubmitted();

        _claimed[taskId][msg.sender] = true;
        (bool sent,) = msg.sender.call{value: reward}("");
        require(sent, "Transfer failed");
    }

    // ============ View Functions ============

    /// @inheritdoc IPairwiseVerifier
    function getTask(bytes32 taskId) external view returns (VerificationTask memory) {
        if (_tasks[taskId].rewardPool == 0) revert TaskNotFound();
        return _tasks[taskId];
    }

    /// @inheritdoc IPairwiseVerifier
    function getSubmission(bytes32 submissionId) external view returns (WorkSubmission memory) {
        if (_submissions[submissionId].taskId == bytes32(0)) revert SubmissionNotFound();
        return _submissions[submissionId];
    }

    /// @inheritdoc IPairwiseVerifier
    function getComparison(bytes32 comparisonId) external view returns (PairwiseComparison memory) {
        if (_comparisons[comparisonId].taskId == bytes32(0)) revert ComparisonNotFound();
        return _comparisons[comparisonId];
    }

    /// @inheritdoc IPairwiseVerifier
    function getTaskSubmissions(bytes32 taskId) external view returns (bytes32[] memory) {
        return _taskSubmissions[taskId];
    }

    /// @inheritdoc IPairwiseVerifier
    function getTaskComparisons(bytes32 taskId) external view returns (bytes32[] memory) {
        return _taskComparisons[taskId];
    }

    /// @inheritdoc IPairwiseVerifier
    function getWorkerReward(bytes32 taskId, address worker) external view returns (uint256) {
        return _rewards[taskId][worker];
    }

    /// @inheritdoc IPairwiseVerifier
    function getValidatorReward(bytes32 taskId, address validator) external view returns (uint256) {
        return _rewards[taskId][validator];
    }

    /// @inheritdoc IPairwiseVerifier
    function totalTasks() external view returns (uint256) {
        return _taskNonce - 1;
    }

    // ============ Admin ============

    function setAgentRegistry(address _agentRegistry) external onlyOwner {
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // ============ Internal ============

    /// @dev Create a canonical pair hash (order-independent)
    function _pairHash(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Mark comparisons as consensus-aligned based on majority per pair
    function _markConsensusAligned(bytes32, bytes32[] storage comparisonIds) internal {
        // Build pair → choice tally
        // For gas efficiency, iterate comparisons and group by pair
        uint256 len = comparisonIds.length;

        for (uint256 i = 0; i < len; i++) {
            PairwiseComparison storage comp = _comparisons[comparisonIds[i]];
            if (!comp.revealed) continue;

            bytes32 pHash = _pairHash(comp.submissionA, comp.submissionB);

            // Count votes for this pair
            uint256 firstVotes = 0;
            uint256 secondVotes = 0;
            uint256 equivVotes = 0;

            for (uint256 j = 0; j < len; j++) {
                PairwiseComparison storage other = _comparisons[comparisonIds[j]];
                if (!other.revealed) continue;

                bytes32 otherPair = _pairHash(other.submissionA, other.submissionB);
                if (otherPair != pHash) continue;

                // Normalize choice based on pair ordering
                CompareChoice normalizedChoice = other.choice;
                if (other.submissionA != comp.submissionA && other.choice != CompareChoice.EQUIVALENT) {
                    // Pair is flipped — reverse choice
                    normalizedChoice = other.choice == CompareChoice.FIRST
                        ? CompareChoice.SECOND
                        : CompareChoice.FIRST;
                }

                if (normalizedChoice == CompareChoice.FIRST) firstVotes++;
                else if (normalizedChoice == CompareChoice.SECOND) secondVotes++;
                else equivVotes++;
            }

            // Determine consensus
            CompareChoice consensus;
            if (firstVotes >= secondVotes && firstVotes >= equivVotes) {
                consensus = CompareChoice.FIRST;
            } else if (secondVotes >= firstVotes && secondVotes >= equivVotes) {
                consensus = CompareChoice.SECOND;
            } else {
                consensus = CompareChoice.EQUIVALENT;
            }

            // Normalize this comparison's choice for alignment check
            CompareChoice normalizedSelf = comp.choice;
            if (comp.submissionA > comp.submissionB && comp.choice != CompareChoice.EQUIVALENT) {
                normalizedSelf = comp.choice == CompareChoice.FIRST
                    ? CompareChoice.SECOND
                    : CompareChoice.FIRST;
            }

            comp.consensusAligned = (normalizedSelf == consensus);
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
