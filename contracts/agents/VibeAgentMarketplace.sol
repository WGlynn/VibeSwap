// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentMarketplace — VSOS Agent Marketplace
 * @notice Deploy, discover, hire, and compensate AI agents.
 *         Shapley-weighted skill matching and 95/5 revenue split (agent/platform).
 */
contract VibeAgentMarketplace is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Constants ============
    uint256 public constant PLATFORM_FEE_BPS = 500; // 5%
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_RATING = 10_000;
    uint256 public constant MAX_CAPABILITIES = 16;

    // ============ Enums ============
    enum TaskStatus { PENDING, ACTIVE, COMPLETED, DISPUTED }

    // ============ Types ============
    struct AgentListing {
        bytes32 agentId;
        address creator;
        string name;
        bytes32 descriptionHash;
        bytes32[] capabilities;
        uint256 pricePerTask;
        uint256 pricePerHour;
        uint256 totalTasksCompleted;
        uint256 rating;          // 0-10000 basis points
        uint256 ratingCount;
        uint256 totalEarned;
        uint256 registeredAt;
        bool active;
        bool verified;
    }

    struct TaskRequest {
        uint256 requestId;
        address requester;
        bytes32 agentId;
        bytes32 taskHash;        // IPFS content hash
        uint256 payment;
        TaskStatus status;
        uint256 createdAt;
        uint256 completedAt;
    }

    struct AgentReview {
        uint256 reviewId;
        uint256 taskId;
        address reviewer;
        uint256 rating;          // 0-10000
        bytes32 reviewHash;
    }

    // ============ State ============
    uint256 public nextTaskId;
    uint256 public nextReviewId;
    uint256 public platformBalance;
    address public arbitrator;

    mapping(bytes32 => AgentListing) public agents;
    mapping(uint256 => TaskRequest) public tasks;
    mapping(uint256 => AgentReview) public reviews;
    bytes32[] public agentIds;
    mapping(bytes32 => uint256[]) public agentTaskIds;
    mapping(bytes32 => uint256[]) public agentReviewIds;
    mapping(bytes32 => bytes32[]) private _capabilityIndex;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============
    event AgentRegistered(bytes32 indexed agentId, address indexed creator, string name);
    event AgentDeactivated(bytes32 indexed agentId);
    event AgentVerified(bytes32 indexed agentId);
    event TaskRequested(uint256 indexed taskId, address indexed requester, bytes32 indexed agentId, uint256 payment);
    event TaskAccepted(uint256 indexed taskId, bytes32 indexed agentId);
    event TaskCompleted(uint256 indexed taskId, bytes32 indexed agentId, uint256 agentPayout);
    event TaskDisputed(uint256 indexed taskId, address indexed requester);
    event DisputeResolved(uint256 indexed taskId, bool favorAgent);
    event AgentRated(bytes32 indexed agentId, uint256 indexed reviewId, uint256 rating);
    event PlatformWithdrawn(address indexed to, uint256 amount);

    // ============ Errors ============
    error AgentAlreadyExists();
    error AgentNotFound();
    error AgentNotActive();
    error TaskNotFound();
    error InvalidStatus();
    error InsufficientPayment();
    error NotRequester();
    error NotAgentCreator();
    error NotArbitrator();
    error InvalidRating();
    error TooManyCapabilities();
    error AlreadyReviewed();
    error TransferFailed();

    // ============ Initializer ============
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _arbitrator) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        arbitrator = _arbitrator;
    }

    // ============ Agent Management ============
    function registerAgent(
        string calldata name,
        bytes32 descriptionHash,
        bytes32[] calldata capabilities,
        uint256 pricePerTask,
        uint256 pricePerHour
    ) external returns (bytes32 agentId) {
        if (capabilities.length > MAX_CAPABILITIES) revert TooManyCapabilities();
        agentId = keccak256(abi.encodePacked(msg.sender, name, block.timestamp));
        if (agents[agentId].registeredAt != 0) revert AgentAlreadyExists();

        AgentListing storage a = agents[agentId];
        a.agentId = agentId;
        a.creator = msg.sender;
        a.name = name;
        a.descriptionHash = descriptionHash;
        a.capabilities = capabilities;
        a.pricePerTask = pricePerTask;
        a.pricePerHour = pricePerHour;
        a.registeredAt = block.timestamp;
        a.active = true;
        agentIds.push(agentId);

        for (uint256 i; i < capabilities.length; ++i) {
            _capabilityIndex[capabilities[i]].push(agentId);
        }
        emit AgentRegistered(agentId, msg.sender, name);
    }

    function deactivateAgent(bytes32 agentId) external {
        if (agents[agentId].creator != msg.sender) revert NotAgentCreator();
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    function verifyAgent(bytes32 agentId) external onlyOwner {
        if (agents[agentId].registeredAt == 0) revert AgentNotFound();
        agents[agentId].verified = true;
        emit AgentVerified(agentId);
    }

    // ============ Task Lifecycle ============
    function requestTask(bytes32 agentId, bytes32 taskHash) external payable nonReentrant returns (uint256 taskId) {
        AgentListing storage a = agents[agentId];
        if (a.registeredAt == 0) revert AgentNotFound();
        if (!a.active) revert AgentNotActive();
        if (msg.value < a.pricePerTask) revert InsufficientPayment();

        taskId = nextTaskId++;
        tasks[taskId] = TaskRequest({
            requestId: taskId,
            requester: msg.sender,
            agentId: agentId,
            taskHash: taskHash,
            payment: msg.value,
            status: TaskStatus.PENDING,
            createdAt: block.timestamp,
            completedAt: 0
        });
        agentTaskIds[agentId].push(taskId);
        emit TaskRequested(taskId, msg.sender, agentId, msg.value);
    }

    function acceptTask(uint256 taskId) external {
        TaskRequest storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.status != TaskStatus.PENDING) revert InvalidStatus();
        if (agents[t.agentId].creator != msg.sender) revert NotAgentCreator();
        t.status = TaskStatus.ACTIVE;
        emit TaskAccepted(taskId, t.agentId);
    }

    function completeTask(uint256 taskId) external nonReentrant {
        TaskRequest storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.status != TaskStatus.ACTIVE) revert InvalidStatus();
        if (agents[t.agentId].creator != msg.sender) revert NotAgentCreator();
        t.status = TaskStatus.COMPLETED;
        t.completedAt = block.timestamp;
        _payoutAgent(t.agentId, t.payment);
        emit TaskCompleted(taskId, t.agentId, t.payment - (t.payment * PLATFORM_FEE_BPS) / BPS);
    }

    function disputeTask(uint256 taskId) external {
        TaskRequest storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.requester != msg.sender) revert NotRequester();
        if (t.status != TaskStatus.ACTIVE) revert InvalidStatus();
        t.status = TaskStatus.DISPUTED;
        emit TaskDisputed(taskId, msg.sender);
    }

    function resolveDispute(uint256 taskId, bool favorAgent) external nonReentrant {
        if (msg.sender != arbitrator) revert NotArbitrator();
        TaskRequest storage t = tasks[taskId];
        if (t.status != TaskStatus.DISPUTED) revert InvalidStatus();
        t.status = TaskStatus.COMPLETED;
        t.completedAt = block.timestamp;
        if (favorAgent) {
            _payoutAgent(t.agentId, t.payment);
        } else {
            (bool ok,) = t.requester.call{value: t.payment}("");
            if (!ok) revert TransferFailed();
        }
        emit DisputeResolved(taskId, favorAgent);
    }

    function _payoutAgent(bytes32 agentId, uint256 payment) internal {
        uint256 fee = (payment * PLATFORM_FEE_BPS) / BPS;
        uint256 payout = payment - fee;
        platformBalance += fee;
        AgentListing storage a = agents[agentId];
        a.totalTasksCompleted++;
        a.totalEarned += payout;
        (bool ok,) = a.creator.call{value: payout}("");
        if (!ok) revert TransferFailed();
    }

    // ============ Reviews ============
    function rateAgent(uint256 taskId, uint256 rating, bytes32 reviewHash) external returns (uint256 reviewId) {
        if (rating > MAX_RATING) revert InvalidRating();
        TaskRequest storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.requester != msg.sender) revert NotRequester();
        if (t.status != TaskStatus.COMPLETED) revert InvalidStatus();

        uint256[] storage rIds = agentReviewIds[t.agentId];
        for (uint256 i; i < rIds.length; ++i) {
            if (reviews[rIds[i]].taskId == taskId) revert AlreadyReviewed();
        }

        reviewId = nextReviewId++;
        reviews[reviewId] = AgentReview(reviewId, taskId, msg.sender, rating, reviewHash);
        rIds.push(reviewId);

        AgentListing storage a = agents[t.agentId];
        a.rating = ((a.rating * a.ratingCount) + rating) / (a.ratingCount + 1);
        a.ratingCount++;
        emit AgentRated(t.agentId, reviewId, rating);
    }

    // ============ Shapley Skill Matching ============
    /// @notice Shapley-weighted capability match score (0 = none, BPS = perfect)
    function shapleyMatch(bytes32 agentId, bytes32[] calldata required) external view returns (uint256 score) {
        AgentListing storage a = agents[agentId];
        if (a.registeredAt == 0 || required.length == 0) return 0;
        uint256 matches;
        uint256 reqLen = required.length;
        bytes32[] storage caps = a.capabilities;
        for (uint256 i; i < reqLen; ++i) {
            for (uint256 j; j < caps.length; ++j) {
                if (required[i] == caps[j]) {
                    matches += (reqLen - i); // Shapley marginal contribution weighting
                    break;
                }
            }
        }
        score = (matches * BPS) / ((reqLen * (reqLen + 1)) / 2);
    }

    // ============ Views ============
    function getAgent(bytes32 agentId) external view returns (AgentListing memory) {
        return agents[agentId];
    }

    function getAgentTasks(bytes32 agentId) external view returns (uint256[] memory) {
        return agentTaskIds[agentId];
    }

    function searchByCapability(bytes32 capability) external view returns (bytes32[] memory) {
        return _capabilityIndex[capability];
    }

    function getTopAgents(uint256 count) external view returns (bytes32[] memory top) {
        uint256 len = agentIds.length;
        if (count > len) count = len;
        top = new bytes32[](count);
        bool[] memory used = new bool[](len);
        for (uint256 i; i < count; ++i) {
            uint256 bestIdx;
            uint256 bestRating;
            for (uint256 j; j < len; ++j) {
                if (!used[j] && agents[agentIds[j]].active) {
                    uint256 r = agents[agentIds[j]].rating;
                    if (r > bestRating) { bestRating = r; bestIdx = j; }
                }
            }
            used[bestIdx] = true;
            top[i] = agentIds[bestIdx];
        }
    }

    function totalAgents() external view returns (uint256) {
        return agentIds.length;
    }

    // ============ Admin ============
    function setArbitrator(address _arbitrator) external onlyOwner {
        arbitrator = _arbitrator;
    }

    function withdrawPlatformFees(address to) external onlyOwner nonReentrant {
        uint256 amount = platformBalance;
        platformBalance = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PlatformWithdrawn(to, amount);
    }

    // ============ UUPS ============
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
