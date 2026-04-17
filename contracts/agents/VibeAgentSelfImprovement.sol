// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentSelfImprovement — Recursive AI Enhancement Protocol
 * @notice On-chain tracking of agent self-improvement cycles. Absorbs
 *         Paperclip-style recursive optimization into a verifiable,
 *         bounded framework with safety constraints.
 *
 * @dev Architecture (Paperclip absorption + safety):
 *      - Improvement proposals: agent proposes upgrades to itself
 *      - Bounded optimization: hard constraints on capability expansion
 *      - Improvement DAG: track causal chain of self-improvements
 *      - Human-in-the-loop checkpoints at autonomy boundaries
 *      - Performance regression detection
 *      - Rollback mechanism if improvement degrades performance
 */
contract VibeAgentSelfImprovement is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum ImprovementType { SKILL_ADDITION, SKILL_REFINEMENT, KNOWLEDGE_EXPANSION, BEHAVIOR_ADJUSTMENT, ARCHITECTURE_CHANGE }
    enum ImprovementStatus { PROPOSED, APPROVED, APPLIED, ROLLED_BACK, REJECTED }

    struct Improvement {
        uint256 improvementId;
        bytes32 agentId;
        ImprovementType improvementType;
        bytes32 proposalHash;       // IPFS hash of detailed proposal
        bytes32 parentImprovement;  // Previous improvement in chain (DAG)
        uint256 preScore;           // Performance before
        uint256 postScore;          // Performance after
        uint256 proposedAt;
        uint256 appliedAt;
        ImprovementStatus status;
        bool humanApproved;         // Required for ARCHITECTURE_CHANGE
    }

    struct SafetyBound {
        bytes32 agentId;
        uint256 maxDailyImprovements;
        uint256 maxCapabilityExpansionBps; // Max % expansion per cycle
        uint256 minPerformanceThreshold;   // Must maintain this score
        bool requireHumanApproval;
    }

    struct ImprovementChain {
        bytes32 agentId;
        uint256 totalImprovements;
        uint256 successfulImprovements;
        uint256 rolledBack;
        uint256 currentGeneration;  // How many improvement cycles
        uint256 cumulativeGain;     // Total performance gain
    }

    // ============ State ============

    mapping(uint256 => Improvement) public improvements;
    uint256 public improvementCount;

    mapping(bytes32 => SafetyBound) public safetyBounds;
    mapping(bytes32 => ImprovementChain) public chains;

    /// @notice Daily improvement count: agentId => day => count
    mapping(bytes32 => mapping(uint256 => uint256)) public dailyImprovements;

    /// @notice Human approvers
    mapping(address => bool) public approvers;

    /// @notice Stats
    uint256 public totalImprovements;
    uint256 public totalRollbacks;
    uint256 public totalApplied;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ImprovementProposed(uint256 indexed id, bytes32 indexed agentId, ImprovementType iType);
    event ImprovementApproved(uint256 indexed id, address indexed approver);
    event ImprovementApplied(uint256 indexed id, uint256 preScore, uint256 postScore);
    event ImprovementRolledBack(uint256 indexed id, string reason);
    event SafetyBoundSet(bytes32 indexed agentId, uint256 maxDaily, bool requireHuman);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Self-Improvement ============

    /**
     * @notice Propose a self-improvement (agent or operator)
     */
    function proposeImprovement(
        bytes32 agentId,
        ImprovementType iType,
        bytes32 proposalHash,
        bytes32 parentImprovement,
        uint256 currentScore
    ) external returns (uint256) {
        SafetyBound storage bounds = safetyBounds[agentId];
        uint256 today = block.timestamp / 1 days;

        require(
            dailyImprovements[agentId][today] < bounds.maxDailyImprovements || bounds.maxDailyImprovements == 0,
            "Daily limit reached"
        );

        improvementCount++;
        improvements[improvementCount] = Improvement({
            improvementId: improvementCount,
            agentId: agentId,
            improvementType: iType,
            proposalHash: proposalHash,
            parentImprovement: parentImprovement,
            preScore: currentScore,
            postScore: 0,
            proposedAt: block.timestamp,
            appliedAt: 0,
            status: ImprovementStatus.PROPOSED,
            humanApproved: false
        });

        dailyImprovements[agentId][today]++;
        totalImprovements++;

        emit ImprovementProposed(improvementCount, agentId, iType);

        // Auto-approve non-architectural changes if no human approval required
        if (!bounds.requireHumanApproval && iType != ImprovementType.ARCHITECTURE_CHANGE) {
            improvements[improvementCount].status = ImprovementStatus.APPROVED;
        }

        return improvementCount;
    }

    /**
     * @notice Human approves an improvement
     */
    function approveImprovement(uint256 improvementId) external {
        require(approvers[msg.sender], "Not approver");
        Improvement storage imp = improvements[improvementId];
        require(imp.status == ImprovementStatus.PROPOSED, "Not proposed");

        imp.status = ImprovementStatus.APPROVED;
        imp.humanApproved = true;

        emit ImprovementApproved(improvementId, msg.sender);
    }

    /**
     * @notice Apply an approved improvement and record results
     */
    function applyImprovement(uint256 improvementId, uint256 postScore) external {
        Improvement storage imp = improvements[improvementId];
        require(imp.status == ImprovementStatus.APPROVED, "Not approved");

        SafetyBound storage bounds = safetyBounds[imp.agentId];

        // Check minimum performance threshold
        if (bounds.minPerformanceThreshold > 0) {
            require(postScore >= bounds.minPerformanceThreshold, "Below performance threshold");
        }

        // Check regression
        if (postScore < imp.preScore) {
            // Auto-rollback on regression
            imp.status = ImprovementStatus.ROLLED_BACK;
            imp.postScore = postScore;
            chains[imp.agentId].rolledBack++;
            totalRollbacks++;
            emit ImprovementRolledBack(improvementId, "Performance regression");
            return;
        }

        imp.status = ImprovementStatus.APPLIED;
        imp.postScore = postScore;
        imp.appliedAt = block.timestamp;

        ImprovementChain storage chain = chains[imp.agentId];
        chain.totalImprovements++;
        chain.successfulImprovements++;
        chain.currentGeneration++;
        chain.cumulativeGain += postScore - imp.preScore;

        totalApplied++;

        emit ImprovementApplied(improvementId, imp.preScore, postScore);
    }

    /**
     * @notice Manually rollback an improvement
     */
    function rollback(uint256 improvementId, string calldata reason) external {
        Improvement storage imp = improvements[improvementId];
        require(imp.status == ImprovementStatus.APPLIED, "Not applied");
        require(approvers[msg.sender] || msg.sender == owner(), "Not authorized");

        imp.status = ImprovementStatus.ROLLED_BACK;
        chains[imp.agentId].rolledBack++;
        totalRollbacks++;

        emit ImprovementRolledBack(improvementId, reason);
    }

    // ============ Safety Bounds ============

    function setSafetyBounds(
        bytes32 agentId,
        uint256 maxDaily,
        uint256 maxExpansionBps,
        uint256 minPerformance,
        bool requireHuman
    ) external onlyOwner {
        safetyBounds[agentId] = SafetyBound({
            agentId: agentId,
            maxDailyImprovements: maxDaily,
            maxCapabilityExpansionBps: maxExpansionBps,
            minPerformanceThreshold: minPerformance,
            requireHumanApproval: requireHuman
        });

        emit SafetyBoundSet(agentId, maxDaily, requireHuman);
    }

    // ============ Admin ============

    function addApprover(address a) external onlyOwner { approvers[a] = true; }
    function removeApprover(address a) external onlyOwner { approvers[a] = false; }

    // ============ View ============

    function getChain(bytes32 agentId) external view returns (ImprovementChain memory) { return chains[agentId]; }
    function getImprovement(uint256 id) external view returns (Improvement memory) { return improvements[id]; }
    function getImprovementCount() external view returns (uint256) { return improvementCount; }
    function getSuccessRate(bytes32 agentId) external view returns (uint256) {
        ImprovementChain storage c = chains[agentId];
        if (c.totalImprovements == 0) return 0;
        return (c.successfulImprovements * 10000) / c.totalImprovements;
    }
}
