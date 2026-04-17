// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeSecurityOracle — Decentralized Smart Contract Security Audit Protocol
 * @notice Absorbs Shannon-style autonomous security testing into a decentralized
 *         audit marketplace. AI agents perform parallel vulnerability scanning,
 *         require proof-of-exploit for findings, and get paid per verified bug.
 *
 * @dev Architecture (Shannon absorption + DePIN):
 *      - Audit requests: anyone can request a security audit
 *      - Parallel agents scan different vulnerability categories simultaneously
 *      - Proof-of-Exploit: only findings with reproducible PoC are accepted
 *      - Checkpointable progress: auditors commit state on-chain
 *      - Bug bounty integration: direct payouts for verified findings
 *      - Multi-severity classification (CRITICAL/HIGH/MEDIUM/LOW/INFO)
 *      - Dispute resolution via expert panel
 */
contract VibeSecurityOracle is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum Severity { INFO, LOW, MEDIUM, HIGH, CRITICAL }
    enum VulnCategory { INJECTION, XSS, REENTRANCY, ACCESS_CONTROL, ORACLE_MANIPULATION, FLASH_LOAN, OVERFLOW, LOGIC, OTHER }
    enum AuditStatus { REQUESTED, IN_PROGRESS, COMPLETED, DISPUTED }
    enum FindingStatus { SUBMITTED, VERIFIED, REJECTED, DISPUTED, PAID }

    struct AuditRequest {
        uint256 auditId;
        address requester;
        bytes32 codeHash;            // Hash of the code being audited
        string contractAddress;      // On-chain address if deployed
        uint256 bountyPool;          // Total bounty available
        uint256 deadline;
        AuditStatus status;
        uint256 findingsCount;
        uint256 createdAt;
    }

    struct Finding {
        uint256 findingId;
        uint256 auditId;
        address auditor;
        Severity severity;
        VulnCategory category;
        bytes32 descriptionHash;     // IPFS hash of detailed description
        bytes32 pocHash;             // Proof-of-Concept hash (REQUIRED)
        bytes32 checkpointHash;      // Auditor's progress checkpoint
        FindingStatus status;
        uint256 payout;
        uint256 submittedAt;
    }

    struct Auditor {
        address addr;
        bytes32 agentId;             // VibeAgentProtocol agent ID (if AI)
        uint256 totalAudits;
        uint256 totalFindings;
        uint256 verifiedFindings;
        uint256 totalEarned;
        uint256 reputation;          // 0-10000
        bool isAI;
        bool active;
    }

    // ============ Constants ============

    // Payout multipliers by severity (basis points of bounty pool)
    uint256 public constant CRITICAL_PAYOUT_BPS = 4000; // 40%
    uint256 public constant HIGH_PAYOUT_BPS = 2500;     // 25%
    uint256 public constant MEDIUM_PAYOUT_BPS = 1500;   // 15%
    uint256 public constant LOW_PAYOUT_BPS = 750;       // 7.5%
    uint256 public constant INFO_PAYOUT_BPS = 250;      // 2.5%

    // ============ State ============

    mapping(uint256 => AuditRequest) public audits;
    uint256 public auditCount;

    mapping(uint256 => Finding) public findings;
    uint256 public findingCount;

    mapping(address => Auditor) public auditors;
    address[] public auditorList;

    /// @notice Audit findings: auditId => findingId[]
    mapping(uint256 => uint256[]) public auditFindings;

    /// @notice Expert panel for disputes
    mapping(address => bool) public expertPanel;

    /// @notice Stats
    uint256 public totalBountyPaid;
    uint256 public totalVerifiedBugs;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event AuditRequested(uint256 indexed auditId, address indexed requester, uint256 bountyPool);
    event FindingSubmitted(uint256 indexed findingId, uint256 indexed auditId, Severity severity, VulnCategory category);
    event FindingVerified(uint256 indexed findingId, uint256 payout);
    event FindingRejected(uint256 indexed findingId);
    event AuditCompleted(uint256 indexed auditId, uint256 totalFindings);
    event AuditorRegistered(address indexed auditor, bool isAI);

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

    // ============ Audit Requests ============

    function requestAudit(
        bytes32 codeHash,
        string calldata contractAddress,
        uint256 deadlineDays
    ) external payable returns (uint256) {
        require(msg.value > 0, "Need bounty pool");

        auditCount++;
        audits[auditCount] = AuditRequest({
            auditId: auditCount,
            requester: msg.sender,
            codeHash: codeHash,
            contractAddress: contractAddress,
            bountyPool: msg.value,
            deadline: block.timestamp + (deadlineDays * 1 days),
            status: AuditStatus.IN_PROGRESS,
            findingsCount: 0,
            createdAt: block.timestamp
        });

        emit AuditRequested(auditCount, msg.sender, msg.value);
        return auditCount;
    }

    // ============ Auditor Management ============

    function registerAuditor(bytes32 agentId, bool isAI) external payable {
        require(!auditors[msg.sender].active, "Already registered");
        require(msg.value > 0, "Stake required");

        auditors[msg.sender] = Auditor({
            addr: msg.sender,
            agentId: agentId,
            totalAudits: 0,
            totalFindings: 0,
            verifiedFindings: 0,
            totalEarned: 0,
            reputation: 5000,
            isAI: isAI,
            active: true
        });

        auditorList.push(msg.sender);
        emit AuditorRegistered(msg.sender, isAI);
    }

    // ============ Findings ============

    /**
     * @notice Submit a security finding with proof-of-concept (Shannon pattern)
     */
    function submitFinding(
        uint256 auditId,
        Severity severity,
        VulnCategory category,
        bytes32 descriptionHash,
        bytes32 pocHash,
        bytes32 checkpointHash
    ) external returns (uint256) {
        AuditRequest storage audit = audits[auditId];
        require(audit.status == AuditStatus.IN_PROGRESS, "Not in progress");
        require(block.timestamp <= audit.deadline, "Deadline passed");
        require(auditors[msg.sender].active, "Not registered auditor");
        require(pocHash != bytes32(0), "PoC required");

        findingCount++;
        findings[findingCount] = Finding({
            findingId: findingCount,
            auditId: auditId,
            auditor: msg.sender,
            severity: severity,
            category: category,
            descriptionHash: descriptionHash,
            pocHash: pocHash,
            checkpointHash: checkpointHash,
            status: FindingStatus.SUBMITTED,
            payout: 0,
            submittedAt: block.timestamp
        });

        auditFindings[auditId].push(findingCount);
        audit.findingsCount++;
        auditors[msg.sender].totalFindings++;

        emit FindingSubmitted(findingCount, auditId, severity, category);
        return findingCount;
    }

    /**
     * @notice Verify a finding and trigger payout
     */
    function verifyFinding(uint256 findingId) external nonReentrant {
        Finding storage f = findings[findingId];
        AuditRequest storage audit = audits[f.auditId];
        require(audit.requester == msg.sender || expertPanel[msg.sender], "Not authorized");
        require(f.status == FindingStatus.SUBMITTED, "Not submitted");

        f.status = FindingStatus.VERIFIED;

        // Calculate payout based on severity
        uint256 payoutBps;
        if (f.severity == Severity.CRITICAL) payoutBps = CRITICAL_PAYOUT_BPS;
        else if (f.severity == Severity.HIGH) payoutBps = HIGH_PAYOUT_BPS;
        else if (f.severity == Severity.MEDIUM) payoutBps = MEDIUM_PAYOUT_BPS;
        else if (f.severity == Severity.LOW) payoutBps = LOW_PAYOUT_BPS;
        else payoutBps = INFO_PAYOUT_BPS;

        uint256 payout = (audit.bountyPool * payoutBps) / 10000;
        if (payout > audit.bountyPool) payout = audit.bountyPool;

        f.payout = payout;
        f.status = FindingStatus.PAID;
        audit.bountyPool -= payout;

        auditors[f.auditor].verifiedFindings++;
        auditors[f.auditor].totalEarned += payout;
        totalBountyPaid += payout;
        totalVerifiedBugs++;

        // Boost reputation
        if (auditors[f.auditor].reputation < 10000) {
            auditors[f.auditor].reputation += 100;
            if (auditors[f.auditor].reputation > 10000) auditors[f.auditor].reputation = 10000;
        }

        (bool ok, ) = f.auditor.call{value: payout}("");
        require(ok, "Payout failed");

        emit FindingVerified(findingId, payout);
    }

    function rejectFinding(uint256 findingId) external {
        Finding storage f = findings[findingId];
        AuditRequest storage audit = audits[f.auditId];
        require(audit.requester == msg.sender || expertPanel[msg.sender], "Not authorized");

        f.status = FindingStatus.REJECTED;
        emit FindingRejected(findingId);
    }

    function completeAudit(uint256 auditId) external {
        AuditRequest storage audit = audits[auditId];
        require(audit.requester == msg.sender, "Not requester");

        audit.status = AuditStatus.COMPLETED;

        // Return remaining bounty
        if (audit.bountyPool > 0) {
            uint256 remaining = audit.bountyPool;
            audit.bountyPool = 0;
            (bool ok, ) = audit.requester.call{value: remaining}("");
            require(ok, "Refund failed");
        }

        emit AuditCompleted(auditId, audit.findingsCount);
    }

    // ============ Admin ============

    function addExpert(address e) external onlyOwner { expertPanel[e] = true; }
    function removeExpert(address e) external onlyOwner { expertPanel[e] = false; }

    // ============ View ============

    function getAudit(uint256 id) external view returns (AuditRequest memory) { return audits[id]; }
    function getFinding(uint256 id) external view returns (Finding memory) { return findings[id]; }
    function getAuditor(address addr) external view returns (Auditor memory) { return auditors[addr]; }
    function getAuditFindings(uint256 auditId) external view returns (uint256[] memory) { return auditFindings[auditId]; }
    function getAuditorCount() external view returns (uint256) { return auditorList.length; }
    function getAuditCount() external view returns (uint256) { return auditCount; }

    receive() external payable {}
}
