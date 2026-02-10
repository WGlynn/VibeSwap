// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../compliance/FederatedConsensus.sol";

/**
 * @title DisputeResolver
 * @notice On-chain equivalent of lawyers and arbitration systems
 * @dev Replaces off-chain LEGAL role in FederatedConsensus. Implements:
 *      - Dispute filing by any party (replaces hiring a lawyer)
 *      - Evidence-based argumentation (claimant vs respondent)
 *      - Staked arbitrators with reputation tracking
 *      - Structured resolution process with deadlines
 *      - Automatic FederatedConsensus voting based on resolution
 *
 *      This contract IS a FederatedConsensus authority. When a dispute
 *      resolves in favor of the claimant, it casts an ONCHAIN_ARBITRATION
 *      vote automatically.
 *
 *      Infrastructural inversion: Today, people hire lawyers to file claims.
 *      Eventually, they file disputes directly on-chain. The smart contract
 *      enforces procedural fairness that lawyers currently provide.
 *      The legal system references on-chain rulings, not the other way around.
 */
contract DisputeResolver is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    // ============ Enums ============

    enum DisputePhase {
        FILING,            // Claimant submits claim + evidence
        RESPONSE,          // Respondent submits defense + evidence
        ARBITRATION,       // Arbitrator reviews and decides
        RESOLVED,          // Decision rendered
        APPEALED           // Escalated to DecentralizedTribunal
    }

    enum Resolution {
        PENDING,
        CLAIMANT_WINS,     // Clawback should proceed
        RESPONDENT_WINS,   // Case dismissed
        SETTLED,           // Parties settled (partial resolution)
        ESCALATED          // Sent to DecentralizedTribunal for jury trial
    }

    // ============ Structs ============

    struct Dispute {
        bytes32 disputeId;
        bytes32 caseId;                // Associated clawback case
        bytes32 consensusProposalId;   // FederatedConsensus proposal to vote on
        address claimant;              // The victim or authority filing
        address respondent;            // The accused
        string claimSummary;
        DisputePhase phase;
        Resolution resolution;
        uint64 phaseDeadline;
        uint256 claimAmount;
        address token;
        address assignedArbitrator;
        uint256 filingFee;
    }

    struct Evidence {
        address submitter;
        string ipfsHash;
        uint64 submittedAt;
        bool isClaimant;               // true = claimant's evidence, false = respondent's
    }

    struct Arbitrator {
        bool registered;
        uint256 stake;
        uint256 casesHandled;
        uint256 correctRulings;        // Rulings not overturned on appeal
        uint256 reputation;            // correctRulings / casesHandled * 10000
        bool suspended;
    }

    // ============ State ============

    /// @notice FederatedConsensus contract
    FederatedConsensus public consensus;

    /// @notice Disputes by ID
    mapping(bytes32 => Dispute) public disputes;

    /// @notice Evidence per dispute
    mapping(bytes32 => Evidence[]) public disputeEvidence;

    /// @notice Registered arbitrators
    mapping(address => Arbitrator) public arbitrators;

    /// @notice Active arbitrator list (for assignment)
    address[] public activeArbitrators;

    /// @notice Dispute counter
    uint256 public disputeCount;

    /// @notice Filing fee (ETH)
    uint256 public filingFee;

    /// @notice Minimum arbitrator stake
    uint256 public minArbitratorStake;

    /// @notice Phase durations
    uint256 public responseDuration;
    uint256 public arbitrationDuration;

    /// @notice Arbitrator assignment index (round-robin)
    uint256 public assignmentIndex;

    // ============ Events ============

    event DisputeFiled(bytes32 indexed disputeId, bytes32 indexed caseId, address indexed claimant, address respondent);
    event ResponseSubmitted(bytes32 indexed disputeId, address indexed respondent);
    event ArbitratorAssigned(bytes32 indexed disputeId, address indexed arbitrator);
    event EvidenceAdded(bytes32 indexed disputeId, address indexed submitter, string ipfsHash);
    event DisputeResolved(bytes32 indexed disputeId, Resolution resolution);
    event ArbitratorRegistered(address indexed arbitrator, uint256 stake);
    event DisputeEscalated(bytes32 indexed disputeId);
    event ConsensusVoteCast(bytes32 indexed disputeId, bytes32 indexed proposalId, bool approved);

    // ============ Errors ============

    error DisputeNotFound();
    error WrongPhase();
    error NotClaimant();
    error NotRespondent();
    error NotAssignedArbitrator();
    error InsufficientFee();
    error InsufficientStake();
    error ArbitratorSuspended();
    error PhaseNotExpired();
    error AlreadyRegistered();

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _consensus
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        consensus = FederatedConsensus(_consensus);

        filingFee = 0.01 ether;
        minArbitratorStake = 1 ether;
        responseDuration = 7 days;
        arbitrationDuration = 14 days;
    }

    // ============ Arbitrator Registration ============

    /**
     * @notice Register as an arbitrator (stake required)
     * @dev On-chain equivalent of passing the bar / getting arbitration certification
     */
    function registerArbitrator() external payable nonReentrant {
        if (arbitrators[msg.sender].registered) revert AlreadyRegistered();
        if (msg.value < minArbitratorStake) revert InsufficientStake();

        arbitrators[msg.sender] = Arbitrator({
            registered: true,
            stake: msg.value,
            casesHandled: 0,
            correctRulings: 0,
            reputation: 10000, // Start with perfect reputation
            suspended: false
        });

        activeArbitrators.push(msg.sender);
        emit ArbitratorRegistered(msg.sender, msg.value);
    }

    // ============ Dispute Filing ============

    /**
     * @notice File a dispute (on-chain equivalent of filing a legal claim)
     * @param caseId Associated clawback case
     * @param consensusProposalId FederatedConsensus proposal to vote on when resolved
     * @param respondent The accused wallet
     * @param claimAmount Amount in dispute
     * @param token Token address
     * @param claimSummary Human-readable claim
     * @param initialEvidenceHash IPFS hash of initial evidence
     */
    function fileDispute(
        bytes32 caseId,
        bytes32 consensusProposalId,
        address respondent,
        uint256 claimAmount,
        address token,
        string calldata claimSummary,
        string calldata initialEvidenceHash
    ) external payable nonReentrant returns (bytes32 disputeId) {
        if (msg.value < filingFee) revert InsufficientFee();

        disputeCount++;
        disputeId = keccak256(abi.encodePacked(caseId, msg.sender, disputeCount));

        disputes[disputeId] = Dispute({
            disputeId: disputeId,
            caseId: caseId,
            consensusProposalId: consensusProposalId,
            claimant: msg.sender,
            respondent: respondent,
            claimSummary: claimSummary,
            phase: DisputePhase.RESPONSE,
            resolution: Resolution.PENDING,
            phaseDeadline: uint64(block.timestamp + responseDuration),
            claimAmount: claimAmount,
            token: token,
            assignedArbitrator: address(0),
            filingFee: msg.value
        });

        // Record initial evidence
        disputeEvidence[disputeId].push(Evidence({
            submitter: msg.sender,
            ipfsHash: initialEvidenceHash,
            submittedAt: uint64(block.timestamp),
            isClaimant: true
        }));

        emit DisputeFiled(disputeId, caseId, msg.sender, respondent);
    }

    /**
     * @notice Submit defense as respondent
     */
    function submitResponse(
        bytes32 disputeId,
        string calldata evidenceHash
    ) external {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.caseId == bytes32(0)) revert DisputeNotFound();
        if (dispute.phase != DisputePhase.RESPONSE) revert WrongPhase();
        if (msg.sender != dispute.respondent) revert NotRespondent();

        disputeEvidence[disputeId].push(Evidence({
            submitter: msg.sender,
            ipfsHash: evidenceHash,
            submittedAt: uint64(block.timestamp),
            isClaimant: false
        }));

        emit ResponseSubmitted(disputeId, msg.sender);
        emit EvidenceAdded(disputeId, msg.sender, evidenceHash);
    }

    /**
     * @notice Advance to arbitration (after response period)
     * @dev Assigns an arbitrator round-robin from the active pool
     */
    function advanceToArbitration(bytes32 disputeId) external {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.phase != DisputePhase.RESPONSE) revert WrongPhase();
        if (block.timestamp < dispute.phaseDeadline) revert PhaseNotExpired();

        // Assign arbitrator round-robin
        require(activeArbitrators.length > 0, "No arbitrators available");
        address assigned = activeArbitrators[assignmentIndex % activeArbitrators.length];
        assignmentIndex++;

        // Skip suspended arbitrators
        while (arbitrators[assigned].suspended && assignmentIndex < activeArbitrators.length * 2) {
            assigned = activeArbitrators[assignmentIndex % activeArbitrators.length];
            assignmentIndex++;
        }

        dispute.assignedArbitrator = assigned;
        dispute.phase = DisputePhase.ARBITRATION;
        dispute.phaseDeadline = uint64(block.timestamp + arbitrationDuration);

        emit ArbitratorAssigned(disputeId, assigned);
    }

    /**
     * @notice Submit additional evidence during any phase (except resolved)
     */
    function addEvidence(bytes32 disputeId, string calldata evidenceHash) external {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.phase == DisputePhase.RESOLVED) revert WrongPhase();

        bool isClaimant = msg.sender == dispute.claimant;
        require(isClaimant || msg.sender == dispute.respondent, "Not a party");

        disputeEvidence[disputeId].push(Evidence({
            submitter: msg.sender,
            ipfsHash: evidenceHash,
            submittedAt: uint64(block.timestamp),
            isClaimant: isClaimant
        }));

        emit EvidenceAdded(disputeId, msg.sender, evidenceHash);
    }

    // ============ Resolution ============

    /**
     * @notice Arbitrator renders decision
     * @dev Also casts ONCHAIN_ARBITRATION vote in FederatedConsensus
     */
    function resolveDispute(
        bytes32 disputeId,
        Resolution resolution
    ) external {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.phase != DisputePhase.ARBITRATION) revert WrongPhase();
        if (msg.sender != dispute.assignedArbitrator) revert NotAssignedArbitrator();
        require(
            resolution == Resolution.CLAIMANT_WINS ||
            resolution == Resolution.RESPONDENT_WINS ||
            resolution == Resolution.SETTLED,
            "Invalid resolution"
        );

        dispute.resolution = resolution;
        dispute.phase = DisputePhase.RESOLVED;

        // Update arbitrator stats
        Arbitrator storage arb = arbitrators[msg.sender];
        arb.casesHandled++;

        emit DisputeResolved(disputeId, resolution);

        // Cast vote in FederatedConsensus (the on-chain legal system speaks)
        if (dispute.consensusProposalId != bytes32(0)) {
            bool approve = resolution == Resolution.CLAIMANT_WINS;
            consensus.vote(dispute.consensusProposalId, approve);
            emit ConsensusVoteCast(disputeId, dispute.consensusProposalId, approve);
        }
    }

    /**
     * @notice Escalate to DecentralizedTribunal (on-chain appeal)
     * @dev Either party can escalate if they disagree with arbitrator ruling
     */
    function escalateToTribunal(bytes32 disputeId) external payable {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.phase != DisputePhase.RESOLVED) revert WrongPhase();
        require(
            msg.sender == dispute.claimant || msg.sender == dispute.respondent,
            "Not a party"
        );

        // Escalation fee (2x filing fee)
        require(msg.value >= filingFee * 2, "Insufficient escalation fee");

        dispute.phase = DisputePhase.APPEALED;
        dispute.resolution = Resolution.ESCALATED;

        // If this appeal overturns the ruling, arbitrator reputation decreases
        emit DisputeEscalated(disputeId);
    }

    /**
     * @notice Record appeal outcome (called by tribunal or owner)
     * @dev Updates arbitrator reputation based on whether ruling was overturned
     */
    function recordAppealOutcome(
        bytes32 disputeId,
        bool rulingOverturned
    ) external onlyOwner {
        Dispute storage dispute = disputes[disputeId];
        Arbitrator storage arb = arbitrators[dispute.assignedArbitrator];

        if (!rulingOverturned) {
            arb.correctRulings++;
        }

        // Update reputation: correctRulings / casesHandled * 10000
        if (arb.casesHandled > 0) {
            arb.reputation = (arb.correctRulings * 10000) / arb.casesHandled;
        }

        // Suspend arbitrators with <50% correct rulings after 5+ cases
        if (arb.casesHandled >= 5 && arb.reputation < 5000) {
            arb.suspended = true;
        }
    }

    // ============ Default Judgment ============

    /**
     * @notice Default judgment if respondent doesn't respond
     * @dev On-chain equivalent of "default judgment" in civil law.
     *      If the respondent ignores the claim, claimant wins by default.
     */
    function defaultJudgment(bytes32 disputeId) external {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.phase != DisputePhase.RESPONSE) revert WrongPhase();
        if (block.timestamp < dispute.phaseDeadline) revert PhaseNotExpired();

        // Check if respondent submitted any evidence
        bool responded = false;
        Evidence[] storage evidence = disputeEvidence[disputeId];
        for (uint256 i = 0; i < evidence.length; i++) {
            if (!evidence[i].isClaimant) {
                responded = true;
                break;
            }
        }

        if (!responded) {
            // Default judgment: claimant wins
            dispute.resolution = Resolution.CLAIMANT_WINS;
            dispute.phase = DisputePhase.RESOLVED;

            emit DisputeResolved(disputeId, Resolution.CLAIMANT_WINS);

            // Auto-vote in consensus
            if (dispute.consensusProposalId != bytes32(0)) {
                consensus.vote(dispute.consensusProposalId, true);
                emit ConsensusVoteCast(disputeId, dispute.consensusProposalId, true);
            }
        }
    }

    // ============ View Functions ============

    function getDispute(bytes32 disputeId) external view returns (Dispute memory) {
        return disputes[disputeId];
    }

    function getEvidence(bytes32 disputeId) external view returns (Evidence[] memory) {
        return disputeEvidence[disputeId];
    }

    function getArbitrator(address arb) external view returns (Arbitrator memory) {
        return arbitrators[arb];
    }

    function getActiveArbitratorCount() external view returns (uint256) {
        return activeArbitrators.length;
    }

    // ============ Admin ============

    function setFees(uint256 _filingFee, uint256 _minArbitratorStake) external onlyOwner {
        filingFee = _filingFee;
        minArbitratorStake = _minArbitratorStake;
    }

    function setDurations(uint256 _responseDuration, uint256 _arbitrationDuration) external onlyOwner {
        responseDuration = _responseDuration;
        arbitrationDuration = _arbitrationDuration;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    receive() external payable {}
}
