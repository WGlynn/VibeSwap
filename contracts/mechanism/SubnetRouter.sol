// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISubnetRouter.sol";

/**
 * @title SubnetRouter
 * @notice AI task routing layer inspired by Bittensor's subnet architecture,
 *         using Shapley-weighted quality consensus instead of Yuma consensus.
 *
 * Workers register into subnets (logical groupings by capability — text, image, code),
 * stake VIBE for skin-in-the-game, and earn quality-weighted rewards for verified outputs.
 *
 * Payment flow:
 *   Requester deposits VIBE → held in contract → on verification:
 *   90% to worker (quality-weighted), 10% to subnet insurance fund.
 *
 * Cooperative capitalism: workers compete on quality, but the insurance fund
 * mutualizes risk across all subnet participants.
 */
contract SubnetRouter is
    ISubnetRouter,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant WORKER_REWARD_BPS = 9000;   // 90% to worker
    uint256 public constant INSURANCE_FEE_BPS = 1000;   // 10% to subnet insurance
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_QUALITY_SCORE = 10000;   // Quality in BPS
    uint256 public constant UNSTAKE_COOLDOWN = 1 days;

    // ============ State ============

    /// @notice VIBE token used for staking and payments
    IERC20 public vibeToken;

    /// @notice Address authorized to call verifyOutput (PairwiseVerifier or multisig)
    address public verifier;

    /// @notice Running subnet count (for ID generation)
    uint256 private _subnetNonce;

    /// @notice Running task count (for ID generation)
    uint256 private _taskNonce;

    /// @notice subnetId => Subnet
    mapping(bytes32 => Subnet) private _subnets;

    /// @notice subnetId => list of worker addresses
    mapping(bytes32 => address[]) private _subnetWorkers;

    /// @notice worker address => Worker (one subnet per worker for simplicity)
    mapping(address => Worker) private _workers;

    /// @notice taskId => Task
    mapping(bytes32 => Task) private _tasks;

    /// @notice taskId => whether reward has been claimed
    mapping(bytes32 => bool) private _rewardClaimed;

    /// @notice worker address => timestamp when unregister was initiated
    mapping(address => uint256) private _unstakeRequestedAt;

    /// @notice Total number of subnets created
    uint256 private _totalSubnets;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _vibeToken,
        address _verifier,
        address _owner
    ) external initializer {
        if (_vibeToken == address(0)) revert ZeroAddress();
        if (_verifier == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = IERC20(_vibeToken);
        verifier = _verifier;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Admin ============

    /// @notice Update the authorized verifier address
    function setVerifier(address _verifier) external onlyOwner {
        if (_verifier == address(0)) revert ZeroAddress();
        verifier = _verifier;
    }

    // ============ Subnet Management ============

    /// @notice Create a new subnet for a specific AI capability
    /// @param name Human-readable name (e.g. "text-generation")
    /// @param minStake Minimum VIBE stake required to join
    /// @return subnetId Unique identifier for the subnet
    function createSubnet(
        string calldata name,
        uint256 minStake
    ) external onlyOwner nonReentrant returns (bytes32 subnetId) {
        subnetId = keccak256(abi.encodePacked(block.chainid, address(this), ++_subnetNonce));

        _subnets[subnetId] = Subnet({
            subnetId: subnetId,
            name: name,
            minStake: minStake,
            workerCount: 0,
            totalTasks: 0,
            totalRewards: 0,
            insuranceFund: 0,
            active: true
        });

        ++_totalSubnets;

        emit SubnetCreated(subnetId, name, minStake);
    }

    /// @notice Deactivate a subnet (no new registrations or tasks)
    function deactivateSubnet(bytes32 subnetId) external onlyOwner nonReentrant {
        Subnet storage subnet = _subnets[subnetId];
        if (subnet.subnetId == bytes32(0)) revert SubnetNotFound();
        subnet.active = false;
        emit SubnetDeactivated(subnetId);
    }

    // ============ Worker Management ============

    /// @notice Register as a worker in a subnet by staking VIBE
    /// @dev Worker must have approved this contract to transfer minStake of VIBE
    function registerWorker(bytes32 subnetId) external payable nonReentrant {
        Subnet storage subnet = _subnets[subnetId];
        if (subnet.subnetId == bytes32(0)) revert SubnetNotFound();
        if (!subnet.active) revert SubnetNotActive();

        Worker storage worker = _workers[msg.sender];
        if (worker.active) revert WorkerAlreadyRegistered();

        // Transfer stake from worker
        uint256 stakeAmount = subnet.minStake;
        if (stakeAmount > 0) {
            vibeToken.safeTransferFrom(msg.sender, address(this), stakeAmount);
        }

        _workers[msg.sender] = Worker({
            workerAddress: msg.sender,
            subnetId: subnetId,
            stake: stakeAmount,
            qualityScore: 5000, // Start at 50% (neutral)
            tasksCompleted: 0,
            totalEarned: 0,
            registeredAt: block.timestamp,
            active: true
        });

        _subnetWorkers[subnetId].push(msg.sender);
        subnet.workerCount++;

        emit WorkerRegistered(subnetId, msg.sender, stakeAmount);
    }

    /// @notice Unregister from subnet and begin unstake cooldown
    /// @dev Stake is returned after UNSTAKE_COOLDOWN elapses
    function unregisterWorker(bytes32 subnetId) external nonReentrant {
        Worker storage worker = _workers[msg.sender];
        if (!worker.active) revert WorkerNotActive();
        if (worker.subnetId != subnetId) revert WorkerNotFound();

        // Check cooldown if previously requested
        uint256 requestedAt = _unstakeRequestedAt[msg.sender];
        if (requestedAt == 0) {
            // First call: initiate cooldown
            _unstakeRequestedAt[msg.sender] = block.timestamp;
            return;
        }

        if (block.timestamp < requestedAt + UNSTAKE_COOLDOWN) revert CooldownNotElapsed();

        // Return stake
        uint256 stakeToReturn = worker.stake;
        worker.active = false;
        worker.stake = 0;
        _unstakeRequestedAt[msg.sender] = 0;

        Subnet storage subnet = _subnets[subnetId];
        if (subnet.workerCount > 0) {
            subnet.workerCount--;
        }

        // Remove from subnet workers array
        _removeWorkerFromSubnet(subnetId, msg.sender);

        if (stakeToReturn > 0) {
            vibeToken.safeTransfer(msg.sender, stakeToReturn);
        }

        emit WorkerUnregistered(subnetId, msg.sender, stakeToReturn);
    }

    // ============ Task Lifecycle ============

    /// @notice Submit a task to a subnet with VIBE payment
    /// @param subnetId Target subnet for this task
    /// @param inputHash IPFS hash of the task input
    /// @param payment Amount of VIBE to pay for this task
    /// @return taskId Unique identifier for the task
    function submitTask(
        bytes32 subnetId,
        bytes32 inputHash,
        uint256 payment
    ) external nonReentrant returns (bytes32 taskId) {
        if (payment == 0) revert ZeroPayment();

        Subnet storage subnet = _subnets[subnetId];
        if (subnet.subnetId == bytes32(0)) revert SubnetNotFound();
        if (!subnet.active) revert SubnetNotActive();

        // Transfer payment from requester
        vibeToken.safeTransferFrom(msg.sender, address(this), payment);

        taskId = keccak256(abi.encodePacked(block.chainid, address(this), ++_taskNonce));

        _tasks[taskId] = Task({
            taskId: taskId,
            subnetId: subnetId,
            requester: msg.sender,
            payment: payment,
            inputHash: inputHash,
            outputHash: bytes32(0),
            assignedWorker: address(0),
            status: TaskStatus.PENDING,
            createdAt: block.timestamp,
            completedAt: 0
        });

        subnet.totalTasks++;

        emit TaskSubmitted(taskId, subnetId, msg.sender, payment);
    }

    /// @notice Worker claims a pending task
    /// @param taskId The task to claim
    function claimTask(bytes32 taskId) external nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.taskId == bytes32(0)) revert TaskNotFound();
        if (task.status != TaskStatus.PENDING) revert TaskNotPending();

        Worker storage worker = _workers[msg.sender];
        if (!worker.active) revert WorkerNotActive();
        if (worker.subnetId != task.subnetId) revert WorkerNotFound();

        task.assignedWorker = msg.sender;
        task.status = TaskStatus.ASSIGNED;

        emit TaskClaimed(taskId, msg.sender);
    }

    /// @notice Worker submits output for an assigned task
    /// @param taskId The task being completed
    /// @param outputHash IPFS hash of the output
    function submitOutput(bytes32 taskId, bytes32 outputHash) external nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.taskId == bytes32(0)) revert TaskNotFound();
        if (task.status != TaskStatus.ASSIGNED) revert TaskNotAssigned();
        if (task.assignedWorker != msg.sender) revert NotTaskWorker();

        task.outputHash = outputHash;
        task.status = TaskStatus.COMPLETED;
        task.completedAt = block.timestamp;

        emit OutputSubmitted(taskId, outputHash);
    }

    /// @notice Verifier rates the output quality and marks task as verified
    /// @param taskId The completed task to verify
    /// @param qualityScore Quality rating in BPS (0-10000)
    function verifyOutput(bytes32 taskId, uint256 qualityScore) external nonReentrant {
        if (msg.sender != verifier) revert NotAuthorizedVerifier();
        if (qualityScore > MAX_QUALITY_SCORE) revert InvalidQualityScore();

        Task storage task = _tasks[taskId];
        if (task.taskId == bytes32(0)) revert TaskNotFound();
        if (task.status != TaskStatus.COMPLETED) revert TaskNotCompleted();

        task.status = TaskStatus.VERIFIED;

        // Update worker quality score (exponential moving average)
        Worker storage worker = _workers[task.assignedWorker];
        // EMA: newScore = (oldScore * 7 + qualityScore * 3) / 10
        worker.qualityScore = (worker.qualityScore * 7 + qualityScore * 3) / 10;
        worker.tasksCompleted++;

        emit OutputVerified(taskId, qualityScore);
    }

    /// @notice Requester disputes a completed task's output quality
    /// @param taskId The task to dispute
    function disputeOutput(bytes32 taskId) external nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.taskId == bytes32(0)) revert TaskNotFound();
        if (task.requester != msg.sender) revert NotTaskRequester();
        if (task.status != TaskStatus.COMPLETED) revert TaskNotCompleted();

        task.status = TaskStatus.DISPUTED;

        emit OutputDisputed(taskId, msg.sender);
    }

    /// @notice Worker claims reward for a verified task
    /// @param taskId The verified task to claim reward from
    function claimReward(bytes32 taskId) external nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.taskId == bytes32(0)) revert TaskNotFound();
        if (task.status != TaskStatus.VERIFIED) revert TaskNotVerified();
        if (task.assignedWorker != msg.sender) revert NotTaskWorker();
        if (_rewardClaimed[taskId]) revert RewardAlreadyClaimed();

        _rewardClaimed[taskId] = true;

        Worker storage worker = _workers[msg.sender];
        Subnet storage subnet = _subnets[task.subnetId];

        // Calculate quality-weighted reward
        // Base: 90% of payment goes to worker, scaled by quality score
        uint256 workerBase = (task.payment * WORKER_REWARD_BPS) / BPS_DENOMINATOR;
        uint256 qualityMultiplier = worker.qualityScore; // 0-10000 BPS
        uint256 workerReward = (workerBase * qualityMultiplier) / BPS_DENOMINATOR;

        // Remainder (insurance portion + quality penalty) goes to subnet insurance
        uint256 insurancePortion = task.payment - workerReward;

        worker.totalEarned += workerReward;
        subnet.totalRewards += workerReward;
        subnet.insuranceFund += insurancePortion;

        if (workerReward > 0) {
            vibeToken.safeTransfer(msg.sender, workerReward);
        }

        emit RewardClaimed(taskId, msg.sender, workerReward);
    }

    // ============ View Functions ============

    /// @notice Get subnet details
    function getSubnet(bytes32 subnetId) external view returns (Subnet memory) {
        return _subnets[subnetId];
    }

    /// @notice Get all worker addresses in a subnet
    function getSubnetWorkers(bytes32 subnetId) external view returns (address[] memory) {
        return _subnetWorkers[subnetId];
    }

    /// @notice Get worker stats for an address
    function getWorkerStats(address workerAddr) external view returns (Worker memory) {
        return _workers[workerAddr];
    }

    /// @notice Get task details
    function getTask(bytes32 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    /// @notice Total number of subnets created
    function totalSubnets() external view returns (uint256) {
        return _totalSubnets;
    }

    // ============ Internal ============

    /// @dev Remove a worker address from the subnet's worker array
    function _removeWorkerFromSubnet(bytes32 subnetId, address workerAddr) internal {
        address[] storage workers = _subnetWorkers[subnetId];
        uint256 len = workers.length;
        for (uint256 i; i < len;) {
            if (workers[i] == workerAddr) {
                workers[i] = workers[len - 1];
                workers.pop();
                return;
            }
            unchecked { ++i; }
        }
    }
}
