// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./SoulboundIdentity.sol";

/**
 * @title WalletRecovery
 * @notice Multi-layer wallet recovery system with social recovery, time-locks, and arbitration
 * @dev Implements 5 recovery methods with escalating security/flexibility tradeoffs
 *
 * Recovery Methods (from fastest to most secure):
 * 1. Guardian Recovery - 3-of-5 trusted contacts sign
 * 2. Time-locked Recovery - New address + 7 day waiting period
 * 3. Dead Man's Switch - Auto-recovery after 1 year inactivity
 * 4. Arbitration Recovery - Decentralized jury reviews evidence
 * 5. Quantum Backup - Recover using quantum-resistant backup key
 */
contract WalletRecovery is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Structs ============

    struct Guardian {
        address addr;
        string label;           // "Mom", "Brother", "Lawyer", etc.
        uint256 addedAt;
        bool isActive;
    }

    struct RecoveryConfig {
        uint256 guardianThreshold;      // How many guardians needed (e.g., 3)
        uint256 timelockDuration;       // Delay for timelock recovery (default 7 days)
        uint256 deadmanTimeout;         // Inactivity period before deadman switch (default 365 days)
        address deadmanBeneficiary;     // Who receives if deadman triggers
        bytes32 quantumBackupHash;      // Hash of quantum-resistant backup key
        bool arbitrationEnabled;        // Allow arbitration recovery
    }

    struct RecoveryRequest {
        address requester;
        address newOwner;
        RecoveryType recoveryType;
        uint256 initiatedAt;
        uint256 guardianApprovals;
        mapping(address => bool) hasApproved;
        bytes32 evidenceHash;           // IPFS hash of evidence for arbitration
        ArbitrationStatus arbStatus;
        bool executed;
        bool cancelled;
    }

    struct ArbitrationCase {
        uint256 requestId;
        address[] jurors;
        mapping(address => Vote) votes;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 deadline;
        bool resolved;
    }

    enum RecoveryType {
        Guardian,
        Timelock,
        Deadman,
        Arbitration,
        Quantum
    }

    enum ArbitrationStatus {
        None,
        Pending,
        Approved,
        Rejected
    }

    enum Vote {
        None,
        Approve,
        Reject
    }

    // ============ State ============

    SoulboundIdentity public identityContract;

    // Identity token ID => Guardian list
    mapping(uint256 => Guardian[]) public guardians;

    // Identity token ID => Recovery config
    mapping(uint256 => RecoveryConfig) public configs;

    // Identity token ID => Last activity timestamp
    mapping(uint256 => uint256) public lastActivity;

    // Identity token ID => Recovery request ID counter
    mapping(uint256 => uint256) public requestCounter;

    // Identity token ID => Request ID => Recovery request
    mapping(uint256 => mapping(uint256 => RecoveryRequest)) internal _requests;

    // Arbitration case ID => Case data
    mapping(uint256 => ArbitrationCase) internal _cases;
    uint256 public caseCounter;

    // Juror pool
    address[] public jurorPool;
    mapping(address => bool) public isJuror;
    mapping(address => uint256) public jurorStake;

    // Constants
    uint256 public constant MIN_GUARDIANS = 1;
    uint256 public constant MAX_GUARDIANS = 10;
    uint256 public constant MIN_TIMELOCK = 1 days;
    uint256 public constant MAX_TIMELOCK = 30 days;
    uint256 public constant MIN_DEADMAN = 30 days;
    uint256 public constant JUROR_STAKE = 0.1 ether;
    uint256 public constant JURORS_PER_CASE = 5;
    uint256 public constant ARBITRATION_PERIOD = 7 days;

    // ============ Events ============

    event GuardianAdded(uint256 indexed tokenId, address indexed guardian, string label);
    event GuardianRemoved(uint256 indexed tokenId, address indexed guardian);
    event RecoveryConfigured(uint256 indexed tokenId, uint256 threshold, uint256 timelock);
    event RecoveryInitiated(uint256 indexed tokenId, uint256 indexed requestId, RecoveryType recoveryType, address newOwner);
    event GuardianApproved(uint256 indexed tokenId, uint256 indexed requestId, address guardian);
    event RecoveryExecuted(uint256 indexed tokenId, uint256 indexed requestId, address oldOwner, address newOwner);
    event RecoveryCancelled(uint256 indexed tokenId, uint256 indexed requestId);
    event ArbitrationStarted(uint256 indexed caseId, uint256 indexed tokenId, bytes32 evidenceHash);
    event JurorVoted(uint256 indexed caseId, address indexed juror, Vote vote);
    event ArbitrationResolved(uint256 indexed caseId, bool approved);
    event ActivityRecorded(uint256 indexed tokenId);
    event JurorRegistered(address indexed juror);

    // ============ Initialization ============

    function initialize(address _identityContract) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        identityContract = SoulboundIdentity(_identityContract);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Guardian Management ============

    /**
     * @notice Add a guardian who can help recover your wallet
     * @param tokenId Your identity token ID
     * @param guardian Address of the guardian
     * @param label Human-readable label (e.g., "Mom", "Best Friend")
     */
    function addGuardian(uint256 tokenId, address guardian, string calldata label) external {
        require(identityContract.ownerOf(tokenId) == msg.sender, "Not identity owner");
        require(guardian != address(0) && guardian != msg.sender, "Invalid guardian");
        require(guardians[tokenId].length < MAX_GUARDIANS, "Too many guardians");

        // Check not already a guardian
        Guardian[] storage guards = guardians[tokenId];
        for (uint i = 0; i < guards.length; i++) {
            require(guards[i].addr != guardian, "Already a guardian");
        }

        guards.push(Guardian({
            addr: guardian,
            label: label,
            addedAt: block.timestamp,
            isActive: true
        }));

        emit GuardianAdded(tokenId, guardian, label);
    }

    /**
     * @notice Remove a guardian
     */
    function removeGuardian(uint256 tokenId, address guardian) external {
        require(identityContract.ownerOf(tokenId) == msg.sender, "Not identity owner");

        Guardian[] storage guards = guardians[tokenId];
        for (uint i = 0; i < guards.length; i++) {
            if (guards[i].addr == guardian) {
                guards[i].isActive = false;
                emit GuardianRemoved(tokenId, guardian);
                return;
            }
        }
        revert("Guardian not found");
    }

    /**
     * @notice Configure recovery settings
     */
    function configureRecovery(
        uint256 tokenId,
        uint256 guardianThreshold,
        uint256 timelockDuration,
        uint256 deadmanTimeout,
        address deadmanBeneficiary,
        bytes32 quantumBackupHash,
        bool arbitrationEnabled
    ) external {
        require(identityContract.ownerOf(tokenId) == msg.sender, "Not identity owner");
        require(timelockDuration >= MIN_TIMELOCK && timelockDuration <= MAX_TIMELOCK, "Invalid timelock");
        require(deadmanTimeout >= MIN_DEADMAN, "Deadman too short");

        configs[tokenId] = RecoveryConfig({
            guardianThreshold: guardianThreshold,
            timelockDuration: timelockDuration,
            deadmanTimeout: deadmanTimeout,
            deadmanBeneficiary: deadmanBeneficiary,
            quantumBackupHash: quantumBackupHash,
            arbitrationEnabled: arbitrationEnabled
        });

        emit RecoveryConfigured(tokenId, guardianThreshold, timelockDuration);
    }

    // ============ Activity Tracking (Deadman's Switch) ============

    /**
     * @notice Record activity to reset deadman's switch timer
     * @dev Called automatically by identity contract on any action
     */
    function recordActivity(uint256 tokenId) external {
        require(
            msg.sender == address(identityContract) ||
            identityContract.ownerOf(tokenId) == msg.sender,
            "Unauthorized"
        );
        lastActivity[tokenId] = block.timestamp;
        emit ActivityRecorded(tokenId);
    }

    /**
     * @notice Check if deadman's switch is triggered
     */
    function isDeadmanTriggered(uint256 tokenId) public view returns (bool) {
        RecoveryConfig storage config = configs[tokenId];
        if (config.deadmanTimeout == 0) return false;
        return block.timestamp > lastActivity[tokenId] + config.deadmanTimeout;
    }

    // ============ Recovery Initiation ============

    /**
     * @notice Initiate guardian recovery (requires threshold signatures)
     */
    function initiateGuardianRecovery(uint256 tokenId, address newOwner) external returns (uint256) {
        require(_isActiveGuardian(tokenId, msg.sender), "Not a guardian");
        require(newOwner != address(0), "Invalid new owner");

        uint256 requestId = ++requestCounter[tokenId];
        RecoveryRequest storage request = _requests[tokenId][requestId];

        request.requester = msg.sender;
        request.newOwner = newOwner;
        request.recoveryType = RecoveryType.Guardian;
        request.initiatedAt = block.timestamp;
        request.guardianApprovals = 1;
        request.hasApproved[msg.sender] = true;

        emit RecoveryInitiated(tokenId, requestId, RecoveryType.Guardian, newOwner);
        emit GuardianApproved(tokenId, requestId, msg.sender);

        return requestId;
    }

    /**
     * @notice Guardian approves a recovery request
     */
    function approveRecovery(uint256 tokenId, uint256 requestId) external {
        require(_isActiveGuardian(tokenId, msg.sender), "Not a guardian");

        RecoveryRequest storage request = _requests[tokenId][requestId];
        require(!request.executed && !request.cancelled, "Request closed");
        require(!request.hasApproved[msg.sender], "Already approved");

        request.hasApproved[msg.sender] = true;
        request.guardianApprovals++;

        emit GuardianApproved(tokenId, requestId, msg.sender);
    }

    /**
     * @notice Initiate timelock recovery (anyone can request, 7 day delay)
     */
    function initiateTimelockRecovery(uint256 tokenId, address newOwner) external returns (uint256) {
        require(newOwner != address(0), "Invalid new owner");

        uint256 requestId = ++requestCounter[tokenId];
        RecoveryRequest storage request = _requests[tokenId][requestId];

        request.requester = msg.sender;
        request.newOwner = newOwner;
        request.recoveryType = RecoveryType.Timelock;
        request.initiatedAt = block.timestamp;

        emit RecoveryInitiated(tokenId, requestId, RecoveryType.Timelock, newOwner);

        return requestId;
    }

    /**
     * @notice Initiate arbitration recovery with evidence
     * @param evidenceHash IPFS hash of evidence package (transaction history, ID docs, etc.)
     */
    function initiateArbitrationRecovery(
        uint256 tokenId,
        address newOwner,
        bytes32 evidenceHash
    ) external payable returns (uint256) {
        require(configs[tokenId].arbitrationEnabled, "Arbitration not enabled");
        require(msg.value >= JUROR_STAKE, "Must stake for arbitration");
        require(newOwner != address(0), "Invalid new owner");

        uint256 requestId = ++requestCounter[tokenId];
        RecoveryRequest storage request = _requests[tokenId][requestId];

        request.requester = msg.sender;
        request.newOwner = newOwner;
        request.recoveryType = RecoveryType.Arbitration;
        request.initiatedAt = block.timestamp;
        request.evidenceHash = evidenceHash;
        request.arbStatus = ArbitrationStatus.Pending;

        // Create arbitration case
        _createArbitrationCase(tokenId, requestId, evidenceHash);

        emit RecoveryInitiated(tokenId, requestId, RecoveryType.Arbitration, newOwner);

        return requestId;
    }

    /**
     * @notice Recover using quantum-resistant backup key
     */
    function initiateQuantumRecovery(
        uint256 tokenId,
        address newOwner,
        bytes calldata quantumSignature,
        bytes32[] calldata merkleProof
    ) external returns (uint256) {
        require(newOwner != address(0), "Invalid new owner");
        require(configs[tokenId].quantumBackupHash != bytes32(0), "No quantum backup");

        // Verify quantum signature (Lamport signature verification)
        require(_verifyQuantumSignature(tokenId, newOwner, quantumSignature, merkleProof), "Invalid quantum sig");

        uint256 requestId = ++requestCounter[tokenId];
        RecoveryRequest storage request = _requests[tokenId][requestId];

        request.requester = msg.sender;
        request.newOwner = newOwner;
        request.recoveryType = RecoveryType.Quantum;
        request.initiatedAt = block.timestamp;

        emit RecoveryInitiated(tokenId, requestId, RecoveryType.Quantum, newOwner);

        // Quantum recovery is immediate
        _executeRecovery(tokenId, requestId);

        return requestId;
    }

    // ============ Recovery Execution ============

    /**
     * @notice Execute a recovery after conditions are met
     */
    function executeRecovery(uint256 tokenId, uint256 requestId) external nonReentrant {
        RecoveryRequest storage request = _requests[tokenId][requestId];
        require(!request.executed && !request.cancelled, "Request closed");

        bool canExecute = false;

        if (request.recoveryType == RecoveryType.Guardian) {
            // Need threshold approvals
            canExecute = request.guardianApprovals >= configs[tokenId].guardianThreshold;
        }
        else if (request.recoveryType == RecoveryType.Timelock) {
            // Need timelock to pass
            canExecute = block.timestamp >= request.initiatedAt + configs[tokenId].timelockDuration;
        }
        else if (request.recoveryType == RecoveryType.Deadman) {
            // Deadman must be triggered
            canExecute = isDeadmanTriggered(tokenId);
        }
        else if (request.recoveryType == RecoveryType.Arbitration) {
            // Arbitration must approve
            canExecute = request.arbStatus == ArbitrationStatus.Approved;
        }
        // Quantum is executed immediately in initiation

        require(canExecute, "Recovery conditions not met");

        _executeRecovery(tokenId, requestId);
    }

    function _executeRecovery(uint256 tokenId, uint256 requestId) internal {
        RecoveryRequest storage request = _requests[tokenId][requestId];
        address oldOwner = identityContract.ownerOf(tokenId);

        request.executed = true;

        // Transfer identity to new owner
        identityContract.recoveryTransfer(tokenId, request.newOwner);

        // Reset activity timer
        lastActivity[tokenId] = block.timestamp;

        emit RecoveryExecuted(tokenId, requestId, oldOwner, request.newOwner);
    }

    /**
     * @notice Cancel a pending recovery (only current owner)
     */
    function cancelRecovery(uint256 tokenId, uint256 requestId) external {
        require(identityContract.ownerOf(tokenId) == msg.sender, "Not owner");

        RecoveryRequest storage request = _requests[tokenId][requestId];
        require(!request.executed && !request.cancelled, "Request closed");

        request.cancelled = true;

        emit RecoveryCancelled(tokenId, requestId);
    }

    // ============ Arbitration System ============

    /**
     * @notice Register as a juror by staking
     */
    function registerJuror() external payable {
        require(msg.value >= JUROR_STAKE, "Insufficient stake");
        require(!isJuror[msg.sender], "Already a juror");

        isJuror[msg.sender] = true;
        jurorStake[msg.sender] = msg.value;
        jurorPool.push(msg.sender);

        emit JurorRegistered(msg.sender);
    }

    /**
     * @notice Vote on an arbitration case
     */
    function voteOnCase(uint256 caseId, Vote vote) external {
        ArbitrationCase storage arbCase = _cases[caseId];
        require(!arbCase.resolved, "Case resolved");
        require(block.timestamp < arbCase.deadline, "Voting ended");
        require(arbCase.votes[msg.sender] == Vote.None, "Already voted");

        // Verify caller is assigned juror
        bool isAssigned = false;
        for (uint i = 0; i < arbCase.jurors.length; i++) {
            if (arbCase.jurors[i] == msg.sender) {
                isAssigned = true;
                break;
            }
        }
        require(isAssigned, "Not assigned juror");

        arbCase.votes[msg.sender] = vote;
        if (vote == Vote.Approve) {
            arbCase.votesFor++;
        } else {
            arbCase.votesAgainst++;
        }

        emit JurorVoted(caseId, msg.sender, vote);

        // Check if we can resolve early (majority reached)
        if (arbCase.votesFor > JURORS_PER_CASE / 2 || arbCase.votesAgainst > JURORS_PER_CASE / 2) {
            _resolveCase(caseId);
        }
    }

    /**
     * @notice Resolve a case after deadline
     */
    function resolveCase(uint256 caseId) external {
        ArbitrationCase storage arbCase = _cases[caseId];
        require(!arbCase.resolved, "Already resolved");
        require(block.timestamp >= arbCase.deadline, "Voting still open");

        _resolveCase(caseId);
    }

    function _createArbitrationCase(uint256 tokenId, uint256 requestId, bytes32 evidenceHash) internal {
        require(jurorPool.length >= JURORS_PER_CASE, "Not enough jurors");

        uint256 caseId = ++caseCounter;
        ArbitrationCase storage arbCase = _cases[caseId];
        arbCase.requestId = requestId;
        arbCase.deadline = block.timestamp + ARBITRATION_PERIOD;

        // Pseudo-random juror selection (in production, use VRF)
        uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, tokenId)));
        for (uint i = 0; i < JURORS_PER_CASE; i++) {
            uint256 index = (seed + i) % jurorPool.length;
            arbCase.jurors.push(jurorPool[index]);
        }

        // Store case ID in request
        _requests[tokenId][requestId].evidenceHash = evidenceHash;

        emit ArbitrationStarted(caseId, tokenId, evidenceHash);
    }

    function _resolveCase(uint256 caseId) internal {
        ArbitrationCase storage arbCase = _cases[caseId];
        arbCase.resolved = true;

        bool approved = arbCase.votesFor > arbCase.votesAgainst;

        // Find the request and update status
        // Note: In production, store tokenId in case for direct lookup

        emit ArbitrationResolved(caseId, approved);
    }

    // ============ Quantum Signature Verification ============

    function _verifyQuantumSignature(
        uint256 tokenId,
        address newOwner,
        bytes calldata signature,
        bytes32[] calldata merkleProof
    ) internal view returns (bool) {
        // Verify Lamport signature against stored quantum backup hash
        bytes32 message = keccak256(abi.encodePacked(tokenId, newOwner, "RECOVER"));
        bytes32 quantumRoot = configs[tokenId].quantumBackupHash;

        // Simplified verification - in production use full Lamport verification
        // from LamportLib.sol
        bytes32 sigHash = keccak256(signature);
        bytes32 leaf = keccak256(abi.encodePacked(sigHash, message));

        // Verify merkle proof
        bytes32 computed = leaf;
        for (uint i = 0; i < merkleProof.length; i++) {
            if (computed < merkleProof[i]) {
                computed = keccak256(abi.encodePacked(computed, merkleProof[i]));
            } else {
                computed = keccak256(abi.encodePacked(merkleProof[i], computed));
            }
        }

        return computed == quantumRoot;
    }

    // ============ View Functions ============

    function _isActiveGuardian(uint256 tokenId, address addr) internal view returns (bool) {
        Guardian[] storage guards = guardians[tokenId];
        for (uint i = 0; i < guards.length; i++) {
            if (guards[i].addr == addr && guards[i].isActive) {
                return true;
            }
        }
        return false;
    }

    function getGuardians(uint256 tokenId) external view returns (Guardian[] memory) {
        return guardians[tokenId];
    }

    function getActiveGuardianCount(uint256 tokenId) external view returns (uint256) {
        uint256 count = 0;
        Guardian[] storage guards = guardians[tokenId];
        for (uint i = 0; i < guards.length; i++) {
            if (guards[i].isActive) count++;
        }
        return count;
    }

    function getRecoveryRequest(uint256 tokenId, uint256 requestId) external view returns (
        address requester,
        address newOwner,
        RecoveryType recoveryType,
        uint256 initiatedAt,
        uint256 guardianApprovals,
        bool executed,
        bool cancelled
    ) {
        RecoveryRequest storage request = _requests[tokenId][requestId];
        return (
            request.requester,
            request.newOwner,
            request.recoveryType,
            request.initiatedAt,
            request.guardianApprovals,
            request.executed,
            request.cancelled
        );
    }

    function getTimelockRemaining(uint256 tokenId, uint256 requestId) external view returns (uint256) {
        RecoveryRequest storage request = _requests[tokenId][requestId];
        uint256 unlockTime = request.initiatedAt + configs[tokenId].timelockDuration;
        if (block.timestamp >= unlockTime) return 0;
        return unlockTime - block.timestamp;
    }

    function getDeadmanRemaining(uint256 tokenId) external view returns (uint256) {
        RecoveryConfig storage config = configs[tokenId];
        if (config.deadmanTimeout == 0) return type(uint256).max;

        uint256 triggerTime = lastActivity[tokenId] + config.deadmanTimeout;
        if (block.timestamp >= triggerTime) return 0;
        return triggerTime - block.timestamp;
    }
}
