// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISubnetRouter
 * @notice AI task routing layer inspired by Bittensor's subnet architecture,
 *         using Shapley-weighted quality consensus instead of Yuma consensus.
 *
 * Routes AI compute tasks to registered workers organized into subnets
 * (logical groupings by capability). Workers stake VIBE for skin-in-the-game,
 * and earn Shapley-weighted rewards based on verified output quality.
 *
 * Integration with VibeSwap identity layer:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  SubnetRouter      → Routes tasks to workers, holds payments   │
 * │  PairwiseVerifier   → Rates output quality (CRPC consensus)    │
 * │  AgentRegistry      → Worker identity (ERC-8004 agents)        │
 * │  ShapleyDistributor → Fair reward computation                  │
 * │  ReputationOracle   → Worker reputation feeds routing          │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Payment flow:
 *   Requester deposits VIBE → held in contract → on verification:
 *   90% to worker (quality-weighted via Shapley), 10% to subnet insurance fund.
 */
interface ISubnetRouter {

    // ============ Enums ============

    enum TaskStatus { PENDING, ASSIGNED, COMPLETED, VERIFIED, DISPUTED }

    // ============ Structs ============

    struct Subnet {
        bytes32 subnetId;
        string name;                // "text-generation", "code-review", "image-gen"
        uint256 minStake;           // Minimum stake to join
        uint256 workerCount;
        uint256 totalTasks;
        uint256 totalRewards;
        uint256 insuranceFund;      // Accumulated 10% insurance pool
        bool active;
    }

    struct Worker {
        address workerAddress;
        bytes32 subnetId;
        uint256 stake;              // Staked VIBE
        uint256 qualityScore;       // 0-10000 BPS (updated by PairwiseVerifier)
        uint256 tasksCompleted;
        uint256 totalEarned;
        uint256 registeredAt;
        bool active;
    }

    struct Task {
        bytes32 taskId;
        bytes32 subnetId;
        address requester;
        uint256 payment;            // VIBE paid for this task
        bytes32 inputHash;          // IPFS hash of input
        bytes32 outputHash;         // IPFS hash of output (set by worker)
        address assignedWorker;
        TaskStatus status;
        uint256 createdAt;
        uint256 completedAt;
    }

    // ============ Events ============

    event SubnetCreated(bytes32 indexed subnetId, string name, uint256 minStake);
    event SubnetDeactivated(bytes32 indexed subnetId);
    event WorkerRegistered(bytes32 indexed subnetId, address indexed worker, uint256 stake);
    event WorkerUnregistered(bytes32 indexed subnetId, address indexed worker, uint256 stakeReturned);
    event TaskSubmitted(bytes32 indexed taskId, bytes32 indexed subnetId, address indexed requester, uint256 payment);
    event TaskClaimed(bytes32 indexed taskId, address indexed worker);
    event OutputSubmitted(bytes32 indexed taskId, bytes32 outputHash);
    event OutputVerified(bytes32 indexed taskId, uint256 qualityScore);
    event OutputDisputed(bytes32 indexed taskId, address indexed requester);
    event RewardClaimed(bytes32 indexed taskId, address indexed worker, uint256 amount);

    // ============ Errors ============

    error SubnetNotFound();
    error SubnetNotActive();
    error SubnetAlreadyExists();
    error WorkerNotFound();
    error WorkerNotActive();
    error WorkerAlreadyRegistered();
    error InsufficientStake();
    error TaskNotFound();
    error TaskNotPending();
    error TaskNotAssigned();
    error TaskNotCompleted();
    error TaskNotVerified();
    error TaskAlreadyDisputed();
    error NotTaskWorker();
    error NotTaskRequester();
    error NotAuthorizedVerifier();
    error CooldownNotElapsed();
    error ZeroAddress();
    error ZeroPayment();
    error InvalidQualityScore();
    error RewardAlreadyClaimed();
    error TransferFailed();

    // ============ Subnet Management ============

    function createSubnet(string calldata name, uint256 minStake) external returns (bytes32 subnetId);
    function deactivateSubnet(bytes32 subnetId) external;

    // ============ Worker Management ============

    function registerWorker(bytes32 subnetId) external payable;
    function unregisterWorker(bytes32 subnetId) external;

    // ============ Task Lifecycle ============

    function submitTask(bytes32 subnetId, bytes32 inputHash, uint256 payment) external returns (bytes32 taskId);
    function claimTask(bytes32 taskId) external;
    function submitOutput(bytes32 taskId, bytes32 outputHash) external;
    function verifyOutput(bytes32 taskId, uint256 qualityScore) external;
    function disputeOutput(bytes32 taskId) external;
    function claimReward(bytes32 taskId) external;

    // ============ View Functions ============

    function getSubnet(bytes32 subnetId) external view returns (Subnet memory);
    function getSubnetWorkers(bytes32 subnetId) external view returns (address[] memory);
    function getWorkerStats(address worker) external view returns (Worker memory);
    function getTask(bytes32 taskId) external view returns (Task memory);
    function totalSubnets() external view returns (uint256);
}
