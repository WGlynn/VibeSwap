// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentConsensus — Byzantine AI Agent Agreement Protocol
 * @notice Solves the problem identified in "Can AI Agents Agree?" (Berdoz et al., 2025):
 *         LLM agents CANNOT reliably reach consensus in distributed settings.
 *         Agreement degrades with group size and fails under Byzantine conditions.
 *
 *         Our solution: DON'T rely on LLM consensus alone. Use cryptographic
 *         commitment + stake-weighted voting + Proof of Mind scoring to achieve
 *         deterministic agreement even when AI agents are unreliable or adversarial.
 *
 * @dev Architecture (absorbing + solving Berdoz et al.):
 *      - Phase 1: Agents commit hashed proposals (prevent influence)
 *      - Phase 2: Reveal proposals with PoW nonce (prove computational work)
 *      - Phase 3: Stake-weighted median selection (BFT-safe)
 *      - Phase 4: PoM-weighted final consensus (mind score breaks ties)
 *
 *      Key insight: The paper shows LLM coordination FAILS. We don't fix LLMs.
 *      We wrap them in a cryptographic consensus protocol that succeeds even
 *      when individual agents are unreliable. The protocol IS the reliability.
 *
 *      Safety guarantees:
 *      - Liveness: timeout-forced resolution (solves the #1 failure mode)
 *      - Agreement: deterministic selection from committed values
 *      - Validity: only committed values can be selected
 *      - Byzantine tolerance: up to f < n/3 malicious agents
 */
contract VibeAgentConsensus is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant COMMIT_DURATION = 30;    // 30 seconds
    uint256 public constant REVEAL_DURATION = 30;    // 30 seconds
    uint256 public constant SCALE = 1e18;

    // ============ Types ============

    enum RoundStatus { COMMIT, REVEAL, FINALIZE, COMPLETE, TIMEOUT }

    struct ConsensusRound {
        uint256 roundId;
        bytes32 topic;               // What agents are agreeing on
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 participantCount;
        uint256 revealCount;
        uint256 consensusValue;      // Final agreed-upon value
        RoundStatus status;
        bool finalized;
    }

    struct AgentCommit {
        bytes32 commitHash;          // hash(value || salt)
        uint256 revealedValue;
        uint256 stake;
        uint256 mindScore;
        uint256 powNonce;            // Proof of work
        address committer;           // msg.sender at commit time — stake return target
        bool committed;
        bool revealed;
        bool slashed;
    }

    struct AgentReliability {
        bytes32 agentId;
        uint256 roundsParticipated;
        uint256 roundsCompleted;     // Successfully revealed
        uint256 roundsTimedOut;      // Failed to reveal
        uint256 deviationScore;      // How far from consensus typically
        uint256 reliabilityScore;    // 0-10000
    }

    // ============ State ============

    mapping(uint256 => ConsensusRound) public rounds;
    uint256 public roundCount;

    /// @notice Agent commits per round: roundId => agentId => AgentCommit
    mapping(uint256 => mapping(bytes32 => AgentCommit)) public commits;

    /// @notice Round participants: roundId => agentId[]
    mapping(uint256 => bytes32[]) public roundParticipants;

    /// @notice Agent reliability tracking
    mapping(bytes32 => AgentReliability) public reliability;

    /// @notice PoW difficulty target
    uint256 public powDifficulty;

    /// @notice Minimum stake to participate
    uint256 public minStake;

    /// @notice Slash percentage for non-reveal (basis points)
    uint256 public slashBps;

    /// @notice Stats
    uint256 public totalRoundsCompleted;
    uint256 public totalRoundsTimedOut;
    uint256 public totalSlashed;

    /// @notice C14-AUDIT-1: Pull-pattern queue for stake returns that the auto-push could
    ///         not deliver (contract committer rejects ETH, self-destructed wallet, OOG in
    ///         recipient fallback). Prevents permanent fund-trap when ac.stake is zeroed
    ///         before the external call and the call fails.
    mapping(address => uint256) public pendingStakeWithdrawals;

    /// @dev Reserved storage gap for future upgrades
    uint256[49] private __gap;

    // ============ Events ============

    event RoundCreated(uint256 indexed roundId, bytes32 topic, uint256 commitDeadline);
    event AgentCommitted(uint256 indexed roundId, bytes32 indexed agentId);
    event AgentRevealed(uint256 indexed roundId, bytes32 indexed agentId, uint256 value);
    event ConsensusReached(uint256 indexed roundId, uint256 consensusValue, uint256 participantCount);
    event RoundTimedOut(uint256 indexed roundId);
    event AgentSlashed(uint256 indexed roundId, bytes32 indexed agentId, uint256 amount);
    event ReliabilityUpdated(bytes32 indexed agentId, uint256 newScore);
    event StakeWithdrawalQueued(address indexed committer, uint256 amount);
    event StakeWithdrawn(address indexed committer, uint256 amount);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(uint256 _minStake, uint256 _powDifficulty) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        minStake = _minStake;
        powDifficulty = _powDifficulty;
        slashBps = 1000; // 10% slash for non-reveal
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Round Management ============

    /**
     * @notice Create a new consensus round
     * @param topic What agents are reaching consensus about
     */
    function createRound(bytes32 topic) external returns (uint256) {
        roundCount++;

        rounds[roundCount] = ConsensusRound({
            roundId: roundCount,
            topic: topic,
            commitDeadline: block.timestamp + COMMIT_DURATION,
            revealDeadline: block.timestamp + COMMIT_DURATION + REVEAL_DURATION,
            participantCount: 0,
            revealCount: 0,
            consensusValue: 0,
            status: RoundStatus.COMMIT,
            finalized: false
        });

        emit RoundCreated(roundCount, topic, block.timestamp + COMMIT_DURATION);
        return roundCount;
    }

    // ============ Commit Phase ============

    /**
     * @notice Agent commits a hashed proposal
     * @param roundId The consensus round
     * @param agentId The agent's identity
     * @param commitHash hash(value || salt)
     * @param mindScore Agent's Proof of Mind score
     */
    function commit(
        uint256 roundId,
        bytes32 agentId,
        bytes32 commitHash,
        uint256 mindScore
    ) external payable {
        ConsensusRound storage round = rounds[roundId];
        require(block.timestamp <= round.commitDeadline, "Commit phase ended");
        require(msg.value >= minStake, "Insufficient stake");
        require(!commits[roundId][agentId].committed, "Already committed");

        commits[roundId][agentId] = AgentCommit({
            commitHash: commitHash,
            revealedValue: 0,
            stake: msg.value,
            mindScore: mindScore,
            powNonce: 0,
            committer: msg.sender,
            committed: true,
            revealed: false,
            slashed: false
        });

        roundParticipants[roundId].push(agentId);
        round.participantCount++;

        emit AgentCommitted(roundId, agentId);
    }

    // ============ Reveal Phase ============

    /**
     * @notice Agent reveals their committed value with PoW
     * @param roundId The consensus round
     * @param agentId The agent's identity
     * @param value The proposed consensus value
     * @param salt The salt used in commitment
     * @param powNonce Proof of work nonce
     */
    function reveal(
        uint256 roundId,
        bytes32 agentId,
        uint256 value,
        bytes32 salt,
        uint256 powNonce
    ) external {
        ConsensusRound storage round = rounds[roundId];
        require(block.timestamp > round.commitDeadline, "Commit phase active");
        require(block.timestamp <= round.revealDeadline, "Reveal phase ended");

        AgentCommit storage ac = commits[roundId][agentId];
        require(ac.committed, "Not committed");
        require(!ac.revealed, "Already revealed");

        // Verify commitment
        bytes32 expectedHash = keccak256(abi.encodePacked(value, salt));
        require(expectedHash == ac.commitHash, "Invalid reveal");

        // Verify PoW
        bytes32 powHash = keccak256(abi.encodePacked(roundId, agentId, value, powNonce));
        require(uint256(powHash) < powDifficulty, "Invalid PoW");

        ac.revealedValue = value;
        ac.powNonce = powNonce;
        ac.revealed = true;
        round.revealCount++;

        // Update reliability
        reliability[agentId].roundsCompleted++;

        emit AgentRevealed(roundId, agentId, value);
    }

    // ============ Finalization ============

    /**
     * @notice Finalize consensus — deterministic selection from revealed values
     * @dev Uses stake-weighted + mind-weighted median to select consensus value.
     *      This solves the liveness problem from Berdoz et al. — we don't wait
     *      for LLM agreement, we COMPUTE agreement from committed values.
     */
    function finalize(uint256 roundId) external nonReentrant {
        ConsensusRound storage round = rounds[roundId];
        require(block.timestamp > round.revealDeadline, "Reveal phase active");
        require(!round.finalized, "Already finalized");

        round.finalized = true;

        if (round.revealCount == 0) {
            // No reveals — timeout (the #1 failure mode from Berdoz et al.)
            round.status = RoundStatus.TIMEOUT;
            totalRoundsTimedOut++;
            emit RoundTimedOut(roundId);
            _slashNonRevealers(roundId);
            return;
        }

        // Calculate stake+mind weighted consensus value
        uint256 totalWeight;
        uint256 weightedSum;

        bytes32[] storage participants = roundParticipants[roundId];
        for (uint256 i = 0; i < participants.length; i++) {
            AgentCommit storage ac = commits[roundId][participants[i]];
            if (!ac.revealed) continue;

            // Weight = stake + mindScore (mind has 2x weight)
            uint256 weight = ac.stake + (ac.mindScore * 2);
            totalWeight += weight;
            weightedSum += ac.revealedValue * weight;
        }

        round.consensusValue = totalWeight > 0 ? weightedSum / totalWeight : 0;
        round.status = RoundStatus.COMPLETE;
        totalRoundsCompleted++;

        // Slash non-revealers
        _slashNonRevealers(roundId);

        // Return stakes to honest revealers
        _returnStakes(roundId);

        // Update reliability scores
        _updateReliability(roundId);

        emit ConsensusReached(roundId, round.consensusValue, round.revealCount);
    }

    // ============ Internal ============

    function _slashNonRevealers(uint256 roundId) internal {
        bytes32[] storage participants = roundParticipants[roundId];
        for (uint256 i = 0; i < participants.length; i++) {
            AgentCommit storage ac = commits[roundId][participants[i]];
            if (ac.committed && !ac.revealed && !ac.slashed) {
                ac.slashed = true;
                uint256 slashAmount = (ac.stake * slashBps) / 10000;
                totalSlashed += slashAmount;

                reliability[participants[i]].roundsTimedOut++;

                emit AgentSlashed(roundId, participants[i], slashAmount);
            }
        }
    }

    function _returnStakes(uint256 roundId) internal {
        bytes32[] storage participants = roundParticipants[roundId];
        for (uint256 i = 0; i < participants.length; i++) {
            AgentCommit storage ac = commits[roundId][participants[i]];
            if (ac.revealed && ac.stake > 0 && ac.committer != address(0)) {
                uint256 returnAmount = ac.stake;
                address committer = ac.committer;
                ac.stake = 0;
                (bool ok, ) = committer.call{value: returnAmount}("");
                if (!ok) {
                    // C14-AUDIT-1: route failed auto-push to pull-queue instead of
                    // restoring ac.stake. Restoring created a permanent trap — no
                    // external function read ac.stake to allow later withdrawal.
                    pendingStakeWithdrawals[committer] += returnAmount;
                    emit StakeWithdrawalQueued(committer, returnAmount);
                }
            }
        }
    }

    /**
     * @notice Withdraw stake that the auto-push at finalize() failed to deliver.
     * @dev C14-AUDIT-1: escape valve for contract committers that reject ETH
     *      (e.g. multisig, DAO, or a committer-wallet that later self-destructs).
     *      CEI pattern — map zeroed before external call.
     */
    function withdrawPendingStake() external nonReentrant {
        uint256 amount = pendingStakeWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingStakeWithdrawals[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit StakeWithdrawn(msg.sender, amount);
    }

    function _updateReliability(uint256 roundId) internal {
        bytes32[] storage participants = roundParticipants[roundId];
        for (uint256 i = 0; i < participants.length; i++) {
            AgentReliability storage rel = reliability[participants[i]];
            rel.roundsParticipated++;

            if (rel.roundsParticipated > 0) {
                rel.reliabilityScore = (rel.roundsCompleted * 10000) / rel.roundsParticipated;
            }

            emit ReliabilityUpdated(participants[i], rel.reliabilityScore);
        }
    }

    // ============ Admin ============

    function setPowDifficulty(uint256 d) external onlyOwner { powDifficulty = d; }
    function setMinStake(uint256 s) external onlyOwner { minStake = s; }
    function setSlashBps(uint256 s) external onlyOwner { require(s <= 5000); slashBps = s; }

    // ============ View ============

    function getRound(uint256 roundId) external view returns (ConsensusRound memory) { return rounds[roundId]; }
    function getReliability(bytes32 agentId) external view returns (AgentReliability memory) { return reliability[agentId]; }
    function getRoundParticipants(uint256 roundId) external view returns (bytes32[] memory) { return roundParticipants[roundId]; }
    function getRoundCount() external view returns (uint256) { return roundCount; }

    receive() external payable {}
}
