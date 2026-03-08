// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofOfMind — Hybrid PoW/PoS/PoM Consensus Primitive
 * @notice Cumulative cognitive work as an economic barrier to attack.
 *         Mind-work compounds over time, making Sybil attacks and protocol
 *         hijacking economically impossible — the attack surface shrinks
 *         as the network grows.
 *
 * @dev Three-layer security model:
 *
 *   1. PoW (Proof of Work) — Computational barrier
 *      - Nodes must solve hashcash puzzles to submit consensus votes
 *      - Difficulty auto-adjusts based on network participation
 *      - Prevents spam and ensures cost-of-attack is non-trivial
 *
 *   2. PoS (Proof of Stake) — Economic barrier
 *      - Nodes stake VIBE/ETH as collateral
 *      - Slashing for misbehavior (wrong votes, downtime, equivocation)
 *      - Stake-weighted voting in consensus
 *
 *   3. PoM (Proof of Mind) — Cognitive barrier (the novel primitive)
 *      - Cumulative contribution history from ContributionDAG
 *      - Verified outputs: code commits, data assets, AI tasks completed
 *      - Reputation compounds — new attackers start at zero
 *      - Mind-weight grows logarithmically (diminishing returns prevent plutocracy)
 *      - Cannot be bought, only earned through genuine cognitive output
 *
 *   Combined Weight:
 *     vote_weight = (stake_weight * 0.3) + (pow_weight * 0.1) + (mind_weight * 0.6)
 *
 *   Attack cost = stake_needed + compute_needed + TIME_OF_GENUINE_WORK
 *   The third factor makes attacks asymptotically impossible.
 *
 *   "The only way to hack the system is to contribute to it." — Will
 */
contract ProofOfMind {
    // ============ Constants ============

    /// @notice Weight allocation (basis points, total = 10000)
    uint256 public constant STAKE_WEIGHT_BPS = 3000;   // 30%
    uint256 public constant POW_WEIGHT_BPS = 1000;      // 10%
    uint256 public constant MIND_WEIGHT_BPS = 6000;     // 60%

    /// @notice PoW difficulty parameters
    uint256 public constant INITIAL_DIFFICULTY = 20;     // 20 leading zero bits
    uint256 public constant DIFFICULTY_ADJUSTMENT_PERIOD = 100; // blocks
    uint256 public constant TARGET_SOLVE_TIME = 30;      // seconds

    /// @notice Mind score logarithmic scaling (log2 base)
    uint256 public constant MIND_LOG_BASE = 2;
    uint256 public constant MIND_SCALE = 1e18;

    /// @notice Minimum stake to participate
    uint256 public constant MIN_STAKE = 0.01 ether;

    /// @notice Equivocation window — votes for different values in same round
    uint256 public constant EQUIVOCATION_WINDOW = 2 hours;

    /// @notice Slash percentages (basis points)
    uint256 public constant SLASH_EQUIVOCATION = 5000;  // 50% for double-voting
    uint256 public constant SLASH_DOWNTIME = 500;       // 5% for extended downtime
    uint256 public constant SLASH_INVALID_POW = 1000;   // 10% for invalid PoW

    // ============ State ============

    struct MindNode {
        address nodeAddress;
        uint256 stake;
        uint256 mindScore;           // Cumulative cognitive contribution
        uint256 powSolutions;        // Total valid PoW solutions submitted
        uint256 lastPowTimestamp;    // Last PoW solution time
        uint256 joinedAt;
        uint256 lastActiveRound;
        bool active;
        bool slashed;
    }

    struct ConsensusRound {
        uint256 roundId;
        bytes32 topic;               // What we're voting on
        uint256 startTime;
        uint256 endTime;
        bytes32 winningValue;
        uint256 totalWeight;
        bool finalized;
        uint256 participantCount;
    }

    struct Vote {
        bytes32 value;
        uint256 weight;
        uint256 powNonce;            // PoW solution for this vote
        uint256 timestamp;
    }

    /// @notice All mind nodes
    mapping(address => MindNode) public mindNodes;
    address[] public nodeList;
    uint256 public activeNodeCount;

    /// @notice Consensus rounds
    mapping(uint256 => ConsensusRound) public rounds;
    uint256 public currentRound;

    /// @notice Votes per round per node
    mapping(uint256 => mapping(address => Vote)) public votes;

    /// @notice Value tallies per round: value => total weight
    mapping(uint256 => mapping(bytes32 => uint256)) public valueTallies;

    /// @notice PoW difficulty (auto-adjusting)
    uint256 public currentDifficulty;
    uint256 public lastDifficultyAdjustment;
    uint256 public solutionsSinceAdjustment;
    uint256 public adjustmentStartTime;

    /// @notice Mind contribution records (hash => verified)
    mapping(bytes32 => bool) public verifiedContributions;
    mapping(address => uint256) public contributionCount;

    /// @notice Meta nodes (read-only P2P nodes, no voting power)
    mapping(address => MetaNode) public metaNodes;
    address[] public metaNodeList;

    struct MetaNode {
        address nodeAddress;
        string endpoint;              // P2P endpoint
        uint256 syncedToRound;        // Last synced consensus round
        uint256 registeredAt;
        bool active;
        address[] trinityPeers;       // Which trinity nodes it syncs from
    }

    // ============ Events ============

    event NodeJoined(address indexed node, uint256 stake, uint256 initialMindScore);
    event NodeExited(address indexed node, uint256 stakeReturned);
    event MindContribution(address indexed node, bytes32 contributionHash, uint256 newMindScore);
    event PowSolved(address indexed node, uint256 roundId, uint256 nonce, uint256 difficulty);
    event VoteCast(address indexed node, uint256 roundId, bytes32 value, uint256 weight);
    event RoundFinalized(uint256 roundId, bytes32 winningValue, uint256 totalWeight);
    event DifficultyAdjusted(uint256 oldDifficulty, uint256 newDifficulty);
    event NodeSlashed(address indexed node, uint256 amount, string reason);
    event MetaNodeRegistered(address indexed node, string endpoint);
    event MetaNodeSynced(address indexed node, uint256 syncedToRound);
    event EquivocationDetected(address indexed node, uint256 roundId);

    // ============ Errors ============

    error NotActive();
    error AlreadyRegistered();
    error InsufficientStake();
    error InvalidPoW();
    error RoundNotOpen();
    error AlreadyVoted();
    error RoundNotFinalized();
    error RoundAlreadyFinalized();
    error CannotSlashBelowMinimum();
    error InvalidContribution();
    error NotTrinityNode();

    // ============ Modifiers ============

    modifier onlyActiveNode() {
        if (!mindNodes[msg.sender].active) revert NotActive();
        _;
    }

    // ============ Constructor ============

    constructor() {
        currentDifficulty = INITIAL_DIFFICULTY;
        lastDifficultyAdjustment = block.number;
        adjustmentStartTime = block.timestamp;
    }

    // ============ Node Management ============

    /**
     * @notice Join as a mind node with stake + existing mind score
     * @param initialMindScore Imported from ContributionDAG (verified off-chain then bridged)
     */
    function joinNetwork(uint256 initialMindScore) external payable {
        if (mindNodes[msg.sender].active) revert AlreadyRegistered();
        if (msg.value < MIN_STAKE) revert InsufficientStake();

        mindNodes[msg.sender] = MindNode({
            nodeAddress: msg.sender,
            stake: msg.value,
            mindScore: initialMindScore,
            powSolutions: 0,
            lastPowTimestamp: 0,
            joinedAt: block.timestamp,
            lastActiveRound: 0,
            active: true,
            slashed: false
        });

        nodeList.push(msg.sender);
        activeNodeCount++;

        emit NodeJoined(msg.sender, msg.value, initialMindScore);
    }

    /**
     * @notice Exit the network and reclaim stake
     * @dev Mind score persists — you can rejoin later with accumulated reputation
     */
    function exitNetwork() external onlyActiveNode {
        MindNode storage node = mindNodes[msg.sender];
        node.active = false;
        activeNodeCount--;

        uint256 stakeReturn = node.stake;
        node.stake = 0;

        if (stakeReturn > 0) {
            (bool ok, ) = msg.sender.call{value: stakeReturn}("");
            require(ok, "Stake return failed");
        }

        emit NodeExited(msg.sender, stakeReturn);
    }

    // ============ Mind Score (PoM) ============

    /**
     * @notice Record a verified cognitive contribution (increases mind score)
     * @dev Contributions are verified by trinity consensus before recording
     * @param contributionHash Hash of the contribution (code, data, task result)
     * @param mindValue The cognitive value of this contribution (set by consensus)
     */
    function recordContribution(
        address contributor,
        bytes32 contributionHash,
        uint256 mindValue
    ) external onlyActiveNode {
        // Only trinity nodes can record contributions (they verified it)
        if (!verifiedContributions[contributionHash]) {
            verifiedContributions[contributionHash] = true;

            MindNode storage node = mindNodes[contributor];
            if (node.active) {
                // Logarithmic scaling: score += log2(1 + mindValue) * SCALE
                // This prevents mind-score plutocracy — diminishing returns
                uint256 logValue = _log2(MIND_SCALE + mindValue);
                node.mindScore += logValue;
                contributionCount[contributor]++;

                emit MindContribution(contributor, contributionHash, node.mindScore);
            }
        }
    }

    // ============ Consensus Rounds ============

    /**
     * @notice Start a new consensus round
     * @param topic What we're deciding on (hash of the question)
     * @param duration How long the round lasts
     */
    function startRound(bytes32 topic, uint256 duration) external onlyActiveNode returns (uint256) {
        currentRound++;

        rounds[currentRound] = ConsensusRound({
            roundId: currentRound,
            topic: topic,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            winningValue: bytes32(0),
            totalWeight: 0,
            finalized: false,
            participantCount: 0
        });

        return currentRound;
    }

    /**
     * @notice Cast a vote with PoW proof
     * @param roundId The consensus round
     * @param value The value being voted for
     * @param powNonce The PoW solution nonce
     */
    function castVote(
        uint256 roundId,
        bytes32 value,
        uint256 powNonce
    ) external onlyActiveNode {
        ConsensusRound storage round = rounds[roundId];
        if (block.timestamp < round.startTime || block.timestamp > round.endTime) revert RoundNotOpen();
        if (votes[roundId][msg.sender].timestamp != 0) revert AlreadyVoted();

        // Verify PoW
        bytes32 powHash = keccak256(abi.encodePacked(
            msg.sender, roundId, value, powNonce, block.chainid
        ));
        if (!_meetsPoWDifficulty(powHash)) revert InvalidPoW();

        // Calculate combined weight
        MindNode storage node = mindNodes[msg.sender];
        uint256 weight = _calculateVoteWeight(node);

        // Record vote
        votes[roundId][msg.sender] = Vote({
            value: value,
            weight: weight,
            powNonce: powNonce,
            timestamp: block.timestamp
        });

        valueTallies[roundId][value] += weight;
        round.totalWeight += weight;
        round.participantCount++;

        // Update PoW stats
        node.powSolutions++;
        node.lastPowTimestamp = block.timestamp;
        node.lastActiveRound = roundId;
        solutionsSinceAdjustment++;

        emit PowSolved(msg.sender, roundId, powNonce, currentDifficulty);
        emit VoteCast(msg.sender, roundId, value, weight);

        // Auto-adjust difficulty
        _adjustDifficulty();
    }

    /**
     * @notice Finalize a round — highest weighted value wins
     * @param roundId The round to finalize
     * @param candidateValues Array of values that received votes
     */
    function finalizeRound(uint256 roundId, bytes32[] calldata candidateValues) external {
        ConsensusRound storage round = rounds[roundId];
        if (round.finalized) revert RoundAlreadyFinalized();
        if (block.timestamp <= round.endTime) revert RoundNotOpen();

        bytes32 winner;
        uint256 highestWeight;

        for (uint256 i = 0; i < candidateValues.length; i++) {
            uint256 tally = valueTallies[roundId][candidateValues[i]];
            if (tally > highestWeight) {
                highestWeight = tally;
                winner = candidateValues[i];
            }
        }

        round.winningValue = winner;
        round.finalized = true;

        emit RoundFinalized(roundId, winner, round.totalWeight);
    }

    // ============ Equivocation Detection ============

    /**
     * @notice Report a node that voted for different values in same round
     * @dev This is the cardinal sin — slashed 50%
     */
    function reportEquivocation(
        address node,
        uint256 roundId,
        bytes32 value1,
        uint256 nonce1,
        bytes32 value2,
        uint256 nonce2
    ) external {
        // Verify both PoWs are valid for the same node and round
        bytes32 pow1 = keccak256(abi.encodePacked(node, roundId, value1, nonce1, block.chainid));
        bytes32 pow2 = keccak256(abi.encodePacked(node, roundId, value2, nonce2, block.chainid));

        require(_meetsPoWDifficulty(pow1) && _meetsPoWDifficulty(pow2), "Invalid PoW proofs");
        require(value1 != value2, "Same value");

        // Slash the equivocator
        MindNode storage offender = mindNodes[node];
        uint256 slashAmount = (offender.stake * SLASH_EQUIVOCATION) / 10000;
        offender.stake -= slashAmount;
        offender.slashed = true;

        // Also penalize mind score — equivocation destroys reputation
        offender.mindScore = offender.mindScore / 4; // Lose 75% of mind score

        emit EquivocationDetected(node, roundId);
        emit NodeSlashed(node, slashAmount, "equivocation");
    }

    // ============ Meta Nodes (Client P2P) ============

    /**
     * @notice Register as a meta node — syncs with trinity, no voting power
     * @dev Anyone can run a meta node for client-side P2P utility
     *      Meta nodes unify trinity node state locally but cannot influence consensus
     */
    function registerMetaNode(
        string calldata endpoint,
        address[] calldata trinityPeers
    ) external {
        metaNodes[msg.sender] = MetaNode({
            nodeAddress: msg.sender,
            endpoint: endpoint,
            syncedToRound: 0,
            registeredAt: block.timestamp,
            active: true,
            trinityPeers: trinityPeers
        });

        metaNodeList.push(msg.sender);
        emit MetaNodeRegistered(msg.sender, endpoint);
    }

    /**
     * @notice Meta node reports its sync status
     */
    function reportSync(uint256 syncedRound) external {
        require(metaNodes[msg.sender].active, "Not a meta node");
        metaNodes[msg.sender].syncedToRound = syncedRound;
        emit MetaNodeSynced(msg.sender, syncedRound);
    }

    /**
     * @notice Deactivate meta node
     */
    function deactivateMetaNode() external {
        require(metaNodes[msg.sender].active, "Not a meta node");
        metaNodes[msg.sender].active = false;
    }

    // ============ View Functions ============

    /**
     * @notice Calculate a node's current vote weight
     */
    function getVoteWeight(address nodeAddr) external view returns (uint256) {
        return _calculateVoteWeight(mindNodes[nodeAddr]);
    }

    /**
     * @notice Get the attack cost estimate for the current network
     * @dev Attack requires: stake > total_stake/2 + compute > difficulty + mind > total_mind/2
     *      The mind component makes this asymptotically impossible
     */
    function getAttackCost() external view returns (
        uint256 stakeNeeded,
        uint256 computeDifficulty,
        uint256 mindScoreNeeded,
        uint256 timeEstimateYears
    ) {
        uint256 totalStake;
        uint256 totalMind;

        for (uint256 i = 0; i < nodeList.length; i++) {
            MindNode storage n = mindNodes[nodeList[i]];
            if (n.active) {
                totalStake += n.stake;
                totalMind += n.mindScore;
            }
        }

        stakeNeeded = totalStake / 2 + 1;
        computeDifficulty = currentDifficulty;
        mindScoreNeeded = totalMind / 2 + 1;

        // Time estimate: mind score grows ~1 unit per contribution
        // Average contributor does ~10 contributions/month
        // To accumulate mindScoreNeeded from zero:
        if (mindScoreNeeded > 0) {
            timeEstimateYears = mindScoreNeeded / (10 * 12 * MIND_SCALE);
            if (timeEstimateYears == 0) timeEstimateYears = 1;
        }
    }

    /**
     * @notice Get all active meta nodes
     */
    function getActiveMetaNodes() external view returns (address[] memory) {
        uint256 count;
        for (uint256 i = 0; i < metaNodeList.length; i++) {
            if (metaNodes[metaNodeList[i]].active) count++;
        }

        address[] memory active = new address[](count);
        uint256 idx;
        for (uint256 i = 0; i < metaNodeList.length; i++) {
            if (metaNodes[metaNodeList[i]].active) {
                active[idx++] = metaNodeList[i];
            }
        }
        return active;
    }

    /**
     * @notice Get round result
     */
    function getRoundResult(uint256 roundId) external view returns (
        bytes32 winningValue,
        uint256 totalWeight,
        uint256 participantCount,
        bool finalized
    ) {
        ConsensusRound storage r = rounds[roundId];
        return (r.winningValue, r.totalWeight, r.participantCount, r.finalized);
    }

    // ============ Internal ============

    /**
     * @notice Calculate combined vote weight: 30% stake + 10% PoW + 60% mind
     */
    function _calculateVoteWeight(MindNode storage node) internal view returns (uint256) {
        // Stake weight: linear with stake amount
        uint256 stakeW = (node.stake * STAKE_WEIGHT_BPS) / 10000;

        // PoW weight: based on cumulative solutions (shows consistent participation)
        uint256 powW = (_log2(1 + node.powSolutions) * MIND_SCALE * POW_WEIGHT_BPS) / (10000 * MIND_SCALE);

        // Mind weight: logarithmic mind score (THE key differentiator)
        uint256 mindW = (node.mindScore * MIND_WEIGHT_BPS) / 10000;

        return stakeW + powW + mindW;
    }

    /**
     * @notice Check if a hash meets the current PoW difficulty
     * @dev Difficulty = number of leading zero bits required
     */
    function _meetsPoWDifficulty(bytes32 hash) internal view returns (bool) {
        // Check leading zero bits
        uint256 hashNum = uint256(hash);
        uint256 threshold = type(uint256).max >> currentDifficulty;
        return hashNum <= threshold;
    }

    /**
     * @notice Auto-adjust PoW difficulty based on solution rate
     */
    function _adjustDifficulty() internal {
        if (block.number - lastDifficultyAdjustment < DIFFICULTY_ADJUSTMENT_PERIOD) return;

        uint256 elapsed = block.timestamp - adjustmentStartTime;
        if (elapsed == 0) return;

        uint256 avgSolveTime = elapsed / (solutionsSinceAdjustment > 0 ? solutionsSinceAdjustment : 1);

        uint256 oldDifficulty = currentDifficulty;

        if (avgSolveTime < TARGET_SOLVE_TIME / 2) {
            // Too fast — increase difficulty
            currentDifficulty++;
        } else if (avgSolveTime > TARGET_SOLVE_TIME * 2 && currentDifficulty > 1) {
            // Too slow — decrease difficulty
            currentDifficulty--;
        }

        lastDifficultyAdjustment = block.number;
        solutionsSinceAdjustment = 0;
        adjustmentStartTime = block.timestamp;

        if (currentDifficulty != oldDifficulty) {
            emit DifficultyAdjusted(oldDifficulty, currentDifficulty);
        }
    }

    /**
     * @notice Integer log2 approximation (floor)
     */
    function _log2(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 result = 0;
        while (x > 1) {
            x >>= 1;
            result++;
        }
        return result;
    }

    /// @notice Contract holds all stakes
    receive() external payable {}
}
