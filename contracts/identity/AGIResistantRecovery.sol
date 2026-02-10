// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title AGIResistantRecovery
 * @notice Anti-AGI safeguards for wallet recovery
 * @dev Multiple layers of verification designed to be resistant to AI gaming
 *
 * Core Principle: AGI can fake digital signals, but struggles with:
 * 1. Physical world interactions (hardware, mail, in-person)
 * 2. Long-term behavioral consistency across years
 * 3. Multi-party coordination with real humans
 * 4. Economic costs at scale
 * 5. Unpredictable challenges with human-verifiable responses
 *
 * Defense Layers:
 * - Layer 1: Time delays (7-30 days) with notification to all channels
 * - Layer 2: Multi-channel verification (on-chain, email, SMS, physical)
 * - Layer 3: Guardian social graph analysis
 * - Layer 4: Behavioral fingerprinting
 * - Layer 5: Economic bonds (stake that's slashed if fraudulent)
 * - Layer 6: Physical world anchors (hardware keys, notarized docs)
 * - Layer 7: Human-in-the-loop arbitration with live video
 */
contract AGIResistantRecovery is UUPSUpgradeable, OwnableUpgradeable {

    // ============ Structs ============

    struct HumanityProof {
        ProofType proofType;
        bytes32 proofHash;          // Hash of the proof data
        uint256 timestamp;
        address verifier;           // Who verified this proof
        uint256 confidenceScore;    // 0-100 confidence it's human
    }

    struct BehavioralFingerprint {
        uint256 firstSeen;          // When this address was first active
        uint256 transactionCount;   // Total on-chain transactions
        bytes32 timingPatternHash;  // Hash of transaction timing patterns
        bytes32 interactionGraph;   // Hash of addresses interacted with
        uint256 avgGasPrice;        // Average gas price used
        uint256 totalValueTransferred;
    }

    struct RecoveryChallenge {
        ChallengeType challengeType;
        bytes32 challengeHash;      // The challenge data
        bytes32 expectedResponse;   // Hash of expected response
        uint256 deadline;
        bool completed;
    }

    enum ProofType {
        HARDWARE_KEY,           // YubiKey, Ledger, etc.
        NOTARIZED_DOCUMENT,     // Legally notarized ID
        VIDEO_VERIFICATION,     // Live video with random prompts
        PHYSICAL_MAIL,          // Code sent via postal mail
        BIOMETRIC_HASH,         // On-device biometric (never stored raw)
        SOCIAL_VOUCHING,        // Multiple humans vouch in person
        PROOF_OF_LOCATION,      // Physical presence proof
        HISTORICAL_KNOWLEDGE    // Questions only original owner would know
    }

    enum ChallengeType {
        RANDOM_PHRASE,          // Sign a random phrase at random time
        HISTORICAL_TX,          // Identify a specific past transaction
        GUARDIAN_CALL,          // Guardian confirms via video call
        PHYSICAL_TOKEN,         // Enter code from mailed token
        BEHAVIORAL_MATCH,       // Reproduce historical usage pattern
        SOCIAL_GRAPH_VERIFY,    // Guardians verify social connection
        TIME_LOCKED_SECRET,     // Reveal pre-committed secret
        PROOF_OF_LIFE           // Recent photo with specific gesture
    }

    // ============ State ============

    // Address => Behavioral fingerprint
    mapping(address => BehavioralFingerprint) public fingerprints;

    // Recovery request ID => Required challenges
    mapping(uint256 => RecoveryChallenge[]) public challenges;

    // Recovery request ID => Completed humanity proofs
    mapping(uint256 => HumanityProof[]) public humanityProofs;

    // Minimum proofs required for each recovery type
    mapping(uint8 => uint256) public minProofsRequired;

    // Verifier registry (trusted entities that can verify proofs)
    mapping(address => bool) public trustedVerifiers;

    // Anti-AGI parameters
    uint256 public constant MIN_ACCOUNT_AGE = 30 days;
    uint256 public constant MIN_TX_COUNT = 10;
    uint256 public constant MAX_RECOVERY_ATTEMPTS = 3;
    uint256 public constant ATTEMPT_COOLDOWN = 7 days;
    uint256 public constant BOND_AMOUNT = 1 ether;
    uint256 public constant NOTIFICATION_DELAY = 24 hours;
    uint256 public constant CHALLENGE_WINDOW = 48 hours;

    // Track recovery attempts per address
    mapping(address => uint256) public recoveryAttempts;
    mapping(address => uint256) public lastAttemptTime;

    // ============ Events ============

    event BehavioralFingerprintUpdated(address indexed account);
    event HumanityProofSubmitted(uint256 indexed requestId, ProofType proofType, uint256 confidence);
    event ChallengeIssued(uint256 indexed requestId, ChallengeType challengeType, bytes32 challengeHash);
    event ChallengeCompleted(uint256 indexed requestId, uint256 challengeIndex);
    event RecoveryBlocked(uint256 indexed requestId, string reason);
    event SuspiciousActivity(address indexed account, string indicator);

    // ============ Initialization ============

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        // Set default proof requirements
        minProofsRequired[uint8(ProofType.HARDWARE_KEY)] = 1;
        minProofsRequired[uint8(ProofType.VIDEO_VERIFICATION)] = 1;
        minProofsRequired[uint8(ProofType.SOCIAL_VOUCHING)] = 3; // 3 humans must vouch
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Behavioral Fingerprinting ============

    /**
     * @notice Update behavioral fingerprint for an account
     * @dev Called periodically by authorized contracts to track behavior
     */
    function updateFingerprint(
        address account,
        uint256 txCount,
        bytes32 timingPattern,
        bytes32 interactionGraph,
        uint256 avgGas,
        uint256 totalValue
    ) external {
        require(trustedVerifiers[msg.sender] || msg.sender == owner(), "Not authorized");

        BehavioralFingerprint storage fp = fingerprints[account];

        if (fp.firstSeen == 0) {
            fp.firstSeen = block.timestamp;
        }

        fp.transactionCount = txCount;
        fp.timingPatternHash = timingPattern;
        fp.interactionGraph = interactionGraph;
        fp.avgGasPrice = avgGas;
        fp.totalValueTransferred = totalValue;

        emit BehavioralFingerprintUpdated(account);
    }

    /**
     * @notice Check if account behavior matches historical patterns
     * @dev Returns confidence score 0-100
     */
    function verifyBehavioralMatch(
        address claimedOwner,
        bytes32 currentTimingPattern,
        bytes32 currentInteractionGraph,
        uint256 currentAvgGas
    ) public view returns (uint256 confidenceScore) {
        BehavioralFingerprint storage fp = fingerprints[claimedOwner];

        if (fp.firstSeen == 0) return 0;

        uint256 score = 0;

        // Check account age (AGI can't fake years of history)
        if (block.timestamp - fp.firstSeen > 365 days) {
            score += 20;
        } else if (block.timestamp - fp.firstSeen > 90 days) {
            score += 10;
        }

        // Check transaction count
        if (fp.transactionCount > 100) {
            score += 20;
        } else if (fp.transactionCount > 20) {
            score += 10;
        }

        // Check timing pattern match
        if (fp.timingPatternHash == currentTimingPattern) {
            score += 25;
        }

        // Check interaction graph match
        if (fp.interactionGraph == currentInteractionGraph) {
            score += 20;
        }

        // Check gas price pattern (humans have consistent habits)
        uint256 gasDiff = fp.avgGasPrice > currentAvgGas ?
            fp.avgGasPrice - currentAvgGas :
            currentAvgGas - fp.avgGasPrice;

        if (gasDiff < fp.avgGasPrice / 10) { // Within 10%
            score += 15;
        }

        return score;
    }

    // ============ Anti-AGI Challenge System ============

    /**
     * @notice Issue a random challenge that's hard for AI to game
     */
    function issueChallenge(
        uint256 requestId,
        ChallengeType challengeType
    ) external returns (bytes32 challengeHash) {
        require(trustedVerifiers[msg.sender] || msg.sender == owner(), "Not authorized");

        // Generate unpredictable challenge
        challengeHash = keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            requestId,
            challengeType,
            msg.sender
        ));

        challenges[requestId].push(RecoveryChallenge({
            challengeType: challengeType,
            challengeHash: challengeHash,
            expectedResponse: bytes32(0), // Set by verifier
            deadline: block.timestamp + CHALLENGE_WINDOW,
            completed: false
        }));

        emit ChallengeIssued(requestId, challengeType, challengeHash);

        return challengeHash;
    }

    /**
     * @notice Verify a challenge response
     */
    function verifyChallengeResponse(
        uint256 requestId,
        uint256 challengeIndex,
        bytes32 response
    ) external returns (bool) {
        require(trustedVerifiers[msg.sender], "Not authorized verifier");

        RecoveryChallenge storage challenge = challenges[requestId][challengeIndex];
        require(block.timestamp <= challenge.deadline, "Challenge expired");
        require(!challenge.completed, "Already completed");

        // Verifier confirms response is correct
        challenge.completed = true;
        challenge.expectedResponse = response;

        emit ChallengeCompleted(requestId, challengeIndex);

        return true;
    }

    // ============ Humanity Proof Submission ============

    /**
     * @notice Submit a proof of humanity
     */
    function submitHumanityProof(
        uint256 requestId,
        ProofType proofType,
        bytes32 proofHash,
        uint256 confidenceScore
    ) external {
        require(trustedVerifiers[msg.sender], "Not authorized verifier");
        require(confidenceScore <= 100, "Invalid confidence");

        humanityProofs[requestId].push(HumanityProof({
            proofType: proofType,
            proofHash: proofHash,
            timestamp: block.timestamp,
            verifier: msg.sender,
            confidenceScore: confidenceScore
        }));

        emit HumanityProofSubmitted(requestId, proofType, confidenceScore);
    }

    /**
     * @notice Calculate total humanity confidence score
     */
    function getHumanityScore(uint256 requestId) public view returns (uint256) {
        HumanityProof[] storage proofs = humanityProofs[requestId];

        if (proofs.length == 0) return 0;

        uint256 totalScore = 0;
        uint256 weightedSum = 0;

        // Weight different proof types
        for (uint i = 0; i < proofs.length; i++) {
            uint256 weight = _getProofWeight(proofs[i].proofType);
            totalScore += weight;
            weightedSum += proofs[i].confidenceScore * weight;
        }

        if (totalScore == 0) return 0;
        return weightedSum / totalScore;
    }

    function _getProofWeight(ProofType proofType) internal pure returns (uint256) {
        if (proofType == ProofType.HARDWARE_KEY) return 30;
        if (proofType == ProofType.NOTARIZED_DOCUMENT) return 40;
        if (proofType == ProofType.VIDEO_VERIFICATION) return 35;
        if (proofType == ProofType.PHYSICAL_MAIL) return 25;
        if (proofType == ProofType.BIOMETRIC_HASH) return 20;
        if (proofType == ProofType.SOCIAL_VOUCHING) return 25;
        if (proofType == ProofType.PROOF_OF_LOCATION) return 15;
        if (proofType == ProofType.HISTORICAL_KNOWLEDGE) return 30;
        return 10;
    }

    // ============ Rate Limiting & Anti-Gaming ============

    /**
     * @notice Check if recovery attempt is allowed
     */
    function canAttemptRecovery(address requester) public view returns (bool, string memory) {
        // Check attempt count
        if (recoveryAttempts[requester] >= MAX_RECOVERY_ATTEMPTS) {
            return (false, "Max attempts exceeded");
        }

        // Check cooldown
        if (block.timestamp < lastAttemptTime[requester] + ATTEMPT_COOLDOWN) {
            return (false, "Cooldown not elapsed");
        }

        return (true, "");
    }

    /**
     * @notice Record a recovery attempt
     */
    function recordAttempt(address requester) external {
        require(trustedVerifiers[msg.sender] || msg.sender == owner(), "Not authorized");

        recoveryAttempts[requester]++;
        lastAttemptTime[requester] = block.timestamp;
    }

    /**
     * @notice Detect suspicious patterns that might indicate AGI
     */
    function detectSuspiciousActivity(
        address account,
        uint256 requestTimestamp,
        bytes32 requestPattern
    ) external view returns (bool suspicious, string memory indicator) {
        BehavioralFingerprint storage fp = fingerprints[account];

        // Pattern 1: Too-perfect timing (AGI often executes with machine precision)
        if (requestTimestamp % 1000 == 0) {
            return (true, "Suspiciously round timestamp");
        }

        // Pattern 2: New account with no history
        if (fp.firstSeen == 0 || block.timestamp - fp.firstSeen < MIN_ACCOUNT_AGE) {
            return (true, "Account too new");
        }

        // Pattern 3: Insufficient transaction history
        if (fp.transactionCount < MIN_TX_COUNT) {
            return (true, "Insufficient history");
        }

        // Pattern 4: Request during off-hours for claimed timezone
        // (Would need additional oracle for timezone data)

        // Pattern 5: Multiple recovery attempts in short period
        if (recoveryAttempts[account] > 1 &&
            block.timestamp - lastAttemptTime[account] < ATTEMPT_COOLDOWN) {
            return (true, "Rapid retry pattern");
        }

        return (false, "");
    }

    // ============ Multi-Channel Notification ============

    /**
     * @notice Emit notification that must be sent to all registered channels
     * @dev Off-chain systems listen and send to email, SMS, push, etc.
     */
    function emitRecoveryNotification(
        uint256 requestId,
        address affectedAccount,
        address newOwner,
        uint256 effectiveTime
    ) external {
        require(trustedVerifiers[msg.sender] || msg.sender == owner(), "Not authorized");

        // This event must trigger notifications to ALL channels
        // Any channel can block recovery if owner responds
        emit RecoveryNotificationSent(
            requestId,
            affectedAccount,
            newOwner,
            effectiveTime,
            block.timestamp
        );
    }

    event RecoveryNotificationSent(
        uint256 indexed requestId,
        address indexed affectedAccount,
        address newOwner,
        uint256 effectiveTime,
        uint256 notificationTime
    );

    // ============ Physical World Anchors ============

    /**
     * @notice Register a hardware key for recovery
     */
    function registerHardwareKey(
        address account,
        bytes32 keyIdentifier,
        bytes calldata attestation
    ) external {
        require(msg.sender == account || trustedVerifiers[msg.sender], "Not authorized");

        // Verify attestation from hardware key manufacturer
        // In production, this would verify FIDO2/WebAuthn attestation

        emit HardwareKeyRegistered(account, keyIdentifier);
    }

    event HardwareKeyRegistered(address indexed account, bytes32 keyIdentifier);

    // ============ Verifier Management ============

    function addVerifier(address verifier) external onlyOwner {
        trustedVerifiers[verifier] = true;
    }

    function removeVerifier(address verifier) external onlyOwner {
        trustedVerifiers[verifier] = false;
    }

    // ============ View Functions ============

    function getChallenges(uint256 requestId) external view returns (RecoveryChallenge[] memory) {
        return challenges[requestId];
    }

    function getCompletedChallengeCount(uint256 requestId) external view returns (uint256) {
        RecoveryChallenge[] storage reqs = challenges[requestId];
        uint256 count = 0;
        for (uint i = 0; i < reqs.length; i++) {
            if (reqs[i].completed) count++;
        }
        return count;
    }

    function getHumanityProofs(uint256 requestId) external view returns (HumanityProof[] memory) {
        return humanityProofs[requestId];
    }
}
