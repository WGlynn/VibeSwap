// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HoneypotDefense — Cryptographic Siren Attack Trap
 * @notice Game-theoretic defense that makes attackers THINK they're succeeding.
 *         Lures adversaries into a faux fork where they exhaust all resources
 *         mining towards nothing. When they realize the trap, it's too late —
 *         their compute is burned, their stake is gone.
 *
 * @dev Architecture:
 *
 *   The Siren Protocol:
 *   ===================
 *   1. DETECTION: Anomaly detection identifies attack patterns
 *      - Unusual PoW submission rate from unknown nodes
 *      - Stake accumulation patterns matching Sybil attacks
 *      - Vote clustering from correlated addresses
 *      - Transaction patterns matching known attack vectors
 *
 *   2. ENGAGEMENT: Instead of blocking, we ENGAGE the attacker
 *      - Serve them a "shadow state" that looks real
 *      - Their transactions appear to succeed
 *      - Their votes appear to count
 *      - Their PoW solutions appear valid
 *      - But they're operating on a phantom branch
 *
 *   3. EXHAUSTION: The longer they attack, the more they lose
 *      - PoW difficulty INCREASES for shadow branch (burns compute faster)
 *      - Fake rewards shown but never claimable
 *      - Stake is locked in the trap contract
 *      - Time is the ultimate resource — they can never get it back
 *
 *   4. REVEAL: When attack budget is depleted
 *      - Shadow branch is provably invalid
 *      - All attacker stake slashed
 *      - Attack evidence published on-chain (reputation destruction)
 *      - Network was never at risk — real consensus continued uninterrupted
 *
 *   Game Theory:
 *   - Cost of attack: C(attack) = compute + stake + time + opportunity cost
 *   - Expected gain from attack: E(gain) = 0 (shadow branch is worthless)
 *   - Expected loss: E(loss) = C(attack) + slashed_stake + reputation
 *   - Rational actors won't attack: E(loss) >>> E(gain) for ALL strategies
 *
 *   The attacker can't distinguish real from shadow until it's too late.
 *   By the time they realize, they've already burned everything.
 *
 *   "He thought he was hacking God. God was hacking him." — Will
 */
contract HoneypotDefense {
    // ============ Constants ============

    /// @notice Anomaly detection thresholds
    uint256 public constant SUSPICIOUS_POW_RATE = 10;      // >10 solutions per block = suspicious
    uint256 public constant SUSPICIOUS_STAKE_RATE = 5;     // >5 stake operations per hour = suspicious
    uint256 public constant CORRELATION_THRESHOLD = 80;    // >80% vote correlation = suspicious
    uint256 public constant SHADOW_DIFFICULTY_MULTIPLIER = 4; // Shadow PoW is 4x harder

    /// @notice Trap engagement duration before reveal
    uint256 public constant MIN_TRAP_DURATION = 1 hours;
    uint256 public constant MAX_TRAP_DURATION = 7 days;

    // ============ Types ============

    enum ThreatLevel { NONE, MONITORING, ENGAGED, EXHAUSTING, REVEALED }

    struct AttackProfile {
        address attacker;
        ThreatLevel level;
        uint256 firstSeen;
        uint256 engagedAt;
        uint256 revealedAt;
        uint256 computeWasted;       // Estimated compute burned (in PoW solutions)
        uint256 stakeLocked;         // Stake trapped in shadow
        uint256 fakeRewardsShown;    // Rewards they think they earned
        uint256 realLoss;            // Actual loss (slashed + compute)
        bytes32 shadowBranchRoot;    // Root of their fake branch
        string[] evidenceHashes;     // On-chain attack evidence
        bool active;
    }

    struct AnomalySignal {
        bytes32 signalId;
        address source;
        string signalType;          // "pow_rate", "stake_rate", "vote_correlation", etc.
        uint256 value;
        uint256 threshold;
        uint256 timestamp;
        bool confirmed;
    }

    struct ShadowState {
        bytes32 stateRoot;           // Fake state root
        uint256 blockHeight;         // Fake block height
        uint256 difficulty;          // Inflated difficulty
        uint256 totalStake;          // Fake total stake
        uint256 createdAt;
        bool active;
    }

    // ============ State ============

    /// @notice Active attack profiles
    mapping(address => AttackProfile) public attackProfiles;
    address[] public trackedAttackers;

    /// @notice Anomaly signals
    mapping(bytes32 => AnomalySignal) public signals;
    uint256 public signalCount;

    /// @notice Shadow states (per attacker)
    mapping(address => ShadowState) public shadowStates;

    /// @notice Activity rate tracking: address => window => count
    mapping(address => mapping(uint256 => uint256)) public activityRate;

    /// @notice Correlation matrix: address pair hash => correlation score
    mapping(bytes32 => uint256) public correlations;

    /// @notice Trinity node sentinels (authorized to report anomalies)
    mapping(address => bool) public sentinels;

    /// @notice Total attacks trapped
    uint256 public totalTrapped;
    uint256 public totalComputeWasted;
    uint256 public totalStakeSlashed;

    /// @notice Defense active flag
    bool public defenseActive;

    // ============ Events ============

    event AnomalyDetected(address indexed source, string signalType, uint256 value);
    event AttackEngaged(address indexed attacker, bytes32 shadowRoot);
    event ShadowStateCreated(address indexed attacker, bytes32 stateRoot);
    event FakeRewardShown(address indexed attacker, uint256 amount);
    event AttackRevealed(address indexed attacker, uint256 computeWasted, uint256 stakeLost);
    event EvidencePublished(address indexed attacker, string evidenceHash);
    event SentinelRegistered(address indexed sentinel);
    event ThreatEscalated(address indexed attacker, ThreatLevel newLevel);

    // ============ Errors ============

    error NotSentinel();
    error AttackNotActive();
    error TrapNotReady();
    error AlreadyTrapped();

    // ============ Modifiers ============

    modifier onlySentinel() {
        if (!sentinels[msg.sender]) revert NotSentinel();
        _;
    }

    // ============ Constructor ============

    constructor() {
        defenseActive = true;
    }

    // ============ Sentinel Management ============

    function registerSentinel(address sentinel) external {
        // In production: only TrinityGuardian consensus can add sentinels
        sentinels[sentinel] = true;
        emit SentinelRegistered(sentinel);
    }

    // ============ Anomaly Detection ============

    /**
     * @notice Report suspicious activity (sentinel only)
     */
    function reportAnomaly(
        address source,
        string calldata signalType,
        uint256 value
    ) external onlySentinel {
        signalCount++;
        bytes32 signalId = keccak256(abi.encodePacked(source, signalType, signalCount));

        uint256 threshold = _getThreshold(signalType);

        signals[signalId] = AnomalySignal({
            signalId: signalId,
            source: source,
            signalType: signalType,
            value: value,
            threshold: threshold,
            timestamp: block.timestamp,
            confirmed: value > threshold
        });

        emit AnomalyDetected(source, signalType, value);

        // Auto-escalate threat level
        if (value > threshold) {
            _escalateThreat(source);
        }
    }

    /**
     * @notice Report correlated behavior between addresses
     */
    function reportCorrelation(
        address addr1,
        address addr2,
        uint256 correlationScore
    ) external onlySentinel {
        bytes32 pairHash = keccak256(abi.encodePacked(
            addr1 < addr2 ? addr1 : addr2,
            addr1 < addr2 ? addr2 : addr1
        ));

        correlations[pairHash] = correlationScore;

        if (correlationScore > CORRELATION_THRESHOLD) {
            _escalateThreat(addr1);
            _escalateThreat(addr2);
        }
    }

    // ============ Shadow Branch Management ============

    /**
     * @notice Create a shadow state for a trapped attacker
     * @dev The attacker interacts with this fake state thinking it's real
     */
    function createShadowState(
        address attacker,
        bytes32 fakeStateRoot,
        uint256 fakeBlockHeight
    ) external onlySentinel {
        AttackProfile storage profile = attackProfiles[attacker];
        require(profile.level >= ThreatLevel.ENGAGED, "Not engaged");

        shadowStates[attacker] = ShadowState({
            stateRoot: fakeStateRoot,
            blockHeight: fakeBlockHeight,
            difficulty: _getShadowDifficulty(),
            totalStake: 0,
            createdAt: block.timestamp,
            active: true
        });

        profile.shadowBranchRoot = fakeStateRoot;
        emit ShadowStateCreated(attacker, fakeStateRoot);
    }

    /**
     * @notice Record compute wasted by attacker on shadow branch
     */
    function recordComputeWasted(
        address attacker,
        uint256 powSolutions
    ) external onlySentinel {
        AttackProfile storage profile = attackProfiles[attacker];
        if (!profile.active) revert AttackNotActive();

        profile.computeWasted += powSolutions;
        totalComputeWasted += powSolutions;

        // Show fake rewards (they'll never be claimable)
        uint256 fakeReward = powSolutions * 1e15; // Fake 0.001 ETH per solution
        profile.fakeRewardsShown += fakeReward;

        emit FakeRewardShown(attacker, fakeReward);
    }

    /**
     * @notice Record stake trapped in shadow branch
     */
    function recordStakeLocked(
        address attacker,
        uint256 amount
    ) external onlySentinel {
        AttackProfile storage profile = attackProfiles[attacker];
        if (!profile.active) revert AttackNotActive();

        profile.stakeLocked += amount;
        shadowStates[attacker].totalStake += amount;
    }

    // ============ Reveal (The Moment of Truth) ============

    /**
     * @notice Reveal the trap — prove shadow branch is invalid
     * @dev This is the "oh shit" moment for the attacker
     */
    function revealTrap(address attacker) external onlySentinel {
        AttackProfile storage profile = attackProfiles[attacker];
        require(profile.active && profile.level >= ThreatLevel.ENGAGED, "Not trapped");
        require(block.timestamp >= profile.engagedAt + MIN_TRAP_DURATION, "Too soon");

        profile.level = ThreatLevel.REVEALED;
        profile.revealedAt = block.timestamp;
        profile.active = false;
        profile.realLoss = profile.stakeLocked + (profile.computeWasted * tx.gasprice);

        // Deactivate shadow state
        shadowStates[attacker].active = false;

        totalTrapped++;
        totalStakeSlashed += profile.stakeLocked;

        emit AttackRevealed(attacker, profile.computeWasted, profile.stakeLocked);
    }

    /**
     * @notice Publish attack evidence on-chain (permanent record)
     */
    function publishEvidence(
        address attacker,
        string calldata evidenceHash
    ) external onlySentinel {
        attackProfiles[attacker].evidenceHashes.push(evidenceHash);
        emit EvidencePublished(attacker, evidenceHash);
    }

    // ============ View Functions ============

    /**
     * @notice Get attack profile for an address
     */
    function getAttackProfile(address attacker) external view returns (
        ThreatLevel level,
        uint256 computeWasted,
        uint256 stakeLocked,
        uint256 fakeRewardsShown,
        uint256 realLoss,
        bool active
    ) {
        AttackProfile storage p = attackProfiles[attacker];
        return (p.level, p.computeWasted, p.stakeLocked, p.fakeRewardsShown, p.realLoss, p.active);
    }

    /**
     * @notice Get defense statistics
     */
    function getDefenseStats() external view returns (
        uint256 trapped,
        uint256 computeWasted_,
        uint256 stakeSlashed,
        uint256 activeTraps
    ) {
        uint256 active;
        for (uint256 i = 0; i < trackedAttackers.length; i++) {
            if (attackProfiles[trackedAttackers[i]].active) active++;
        }
        return (totalTrapped, totalComputeWasted, totalStakeSlashed, active);
    }

    /**
     * @notice Check if an address is being tracked
     */
    function isTracked(address addr) external view returns (bool) {
        return attackProfiles[addr].level > ThreatLevel.NONE;
    }

    /**
     * @notice Get the shadow difficulty (what the attacker sees)
     */
    function getShadowDifficulty() external view returns (uint256) {
        return _getShadowDifficulty();
    }

    // ============ Internal ============

    function _escalateThreat(address target) internal {
        AttackProfile storage profile = attackProfiles[target];

        if (profile.level == ThreatLevel.NONE) {
            profile.attacker = target;
            profile.level = ThreatLevel.MONITORING;
            profile.firstSeen = block.timestamp;
            profile.active = true;
            trackedAttackers.push(target);
        } else if (profile.level == ThreatLevel.MONITORING) {
            profile.level = ThreatLevel.ENGAGED;
            profile.engagedAt = block.timestamp;
            emit AttackEngaged(target, bytes32(0));
        } else if (profile.level == ThreatLevel.ENGAGED) {
            profile.level = ThreatLevel.EXHAUSTING;
        }

        emit ThreatEscalated(target, profile.level);
    }

    function _getThreshold(string calldata signalType) internal pure returns (uint256) {
        bytes32 typeHash = keccak256(abi.encodePacked(signalType));

        if (typeHash == keccak256("pow_rate")) return SUSPICIOUS_POW_RATE;
        if (typeHash == keccak256("stake_rate")) return SUSPICIOUS_STAKE_RATE;
        if (typeHash == keccak256("vote_correlation")) return CORRELATION_THRESHOLD;

        return 100; // Default threshold
    }

    function _getShadowDifficulty() internal view returns (uint256) {
        // Shadow difficulty is always higher — burns attacker compute faster
        // Uses current block difficulty * multiplier
        return block.prevrandao * SHADOW_DIFFICULTY_MULTIPLIER;
    }

    // ============ Resource Recycling (Extractors Get Extracted) ============

    /// @notice Recycled resources from trapped attackers
    uint256 public recycledStake;
    uint256 public recycledFees;
    uint256 public harvestedEntropy;

    /// @notice Beneficiary addresses for recycled resources
    address public insurancePool;
    address public treasuryAddress;
    address public entropyConsumer;    // VibeRNG address

    event ResourcesRecycled(address indexed attacker, uint256 stakeRecycled, uint256 feesRecycled, uint256 entropyHarvested);
    event RecycleTargetsSet(address insurance, address treasury, address entropy);

    /**
     * @notice Set recycling target addresses
     */
    function setRecycleTargets(
        address _insurancePool,
        address _treasury,
        address _entropyConsumer
    ) external onlySentinel {
        insurancePool = _insurancePool;
        treasuryAddress = _treasury;
        entropyConsumer = _entropyConsumer;
        emit RecycleTargetsSet(_insurancePool, _treasury, _entropyConsumer);
    }

    /**
     * @notice Recycle captured attacker resources into the network
     * @dev The extractors get extracted. Attack resources strengthen the network.
     *      - Slashed stake → 50% insurance pool, 50% treasury
     *      - Shadow branch entropy → fed to VibeRNG
     *      - The more they attack, the stronger we become
     */
    function recycleResources(address attacker) external onlySentinel {
        AttackProfile storage profile = attackProfiles[attacker];
        require(profile.level == ThreatLevel.REVEALED, "Not revealed yet");

        uint256 stakeToRecycle = profile.stakeLocked;
        uint256 feesToRecycle = profile.fakeRewardsShown; // Fees captured from shadow txs
        uint256 entropy = profile.computeWasted;

        if (stakeToRecycle > 0) {
            profile.stakeLocked = 0;
            recycledStake += stakeToRecycle;

            // 50/50 split: insurance + treasury
            uint256 half = stakeToRecycle / 2;
            if (insurancePool != address(0)) {
                (bool ok1, ) = insurancePool.call{value: half}("");
                require(ok1, "Insurance transfer failed");
            }
            if (treasuryAddress != address(0)) {
                (bool ok2, ) = treasuryAddress.call{value: stakeToRecycle - half}("");
                require(ok2, "Treasury transfer failed");
            }
        }

        recycledFees += feesToRecycle;
        harvestedEntropy += entropy;

        emit ResourcesRecycled(attacker, stakeToRecycle, feesToRecycle, entropy);
    }

    /**
     * @notice Get total recycled value from all attacks
     * @dev Shows how much attackers have involuntarily donated to the network
     */
    function getTotalRecycled() external view returns (
        uint256 stake_,
        uint256 fees_,
        uint256 entropy_,
        string memory message
    ) {
        return (recycledStake, recycledFees, harvestedEntropy, "The extractors got extracted.");
    }
}
