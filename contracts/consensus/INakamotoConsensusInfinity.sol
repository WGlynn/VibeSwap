// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title INakamotoConsensusInfinity
 * @notice Interface for Nakamoto Consensus ∞ (NCI) — Three-Dimensional Consensus
 *
 * Three pillars of security:
 *   Dimension 1: Proof of Work  (10% weight) — Computational barrier (Joule mining)
 *   Dimension 2: Proof of Stake (30% weight) — Economic barrier (VIBE staking)
 *   Dimension 3: Proof of Mind  (60% weight) — Cognitive barrier (identity + reputation)
 *
 * Combined vote weight:
 *   W(node) = 0.10 × PoW(node) + 0.30 × PoS(node) + 0.60 × PoM(node)
 *
 * The 60% PoM weight ensures long-term contributors always outweigh
 * short-term capital or compute advantages.
 *
 * Attack cost = hashpower + stake + TIME_OF_GENUINE_WORK
 * The third term is the key — time cannot be purchased or accelerated.
 *
 * See: docs/papers/nakamoto-consensus-infinite.md
 */
interface INakamotoConsensusInfinity {
    // ============ Enums ============

    enum NodeType { META, AUTHORITY }
    enum ProposalStatus { VOTING, FINALIZED, REJECTED, EXPIRED }

    // ============ Structs ============

    /// @notice Validator state across all three consensus dimensions
    struct Validator {
        address addr;
        NodeType nodeType;
        // PoW dimension
        uint256 cumulativePoW;          // Cumulative valid PoW solutions submitted
        // PoS dimension
        uint256 stakedVibe;             // VIBE tokens staked
        // PoM dimension
        uint256 mindScore;              // Aggregated mind score from identity contracts
        // Computed weights (18 decimals)
        uint256 powWeight;              // log₂(1 + cumulativePoW) scaled
        uint256 posWeight;              // Linear stake weight
        uint256 pomWeight;              // log₂(1 + mindScore) scaled
        uint256 totalWeight;            // Combined W(node) = 0.10×PoW + 0.30×PoS + 0.60×PoM
        // Liveness
        uint256 lastHeartbeat;
        bool active;
        bool slashed;
        uint256 registeredAt;
    }

    /// @notice A consensus proposal (block/state transition to agree on)
    struct Proposal {
        uint256 proposalId;
        uint256 epochNumber;
        bytes32 dataHash;               // Hash of proposed data/block
        address proposer;
        uint256 weightFor;              // Total weighted votes for
        uint256 weightAgainst;          // Total weighted votes against
        ProposalStatus status;
        uint256 createdAt;
        uint256 finalizedAt;
    }

    /// @notice Epoch tracking
    struct EpochInfo {
        uint256 epochNumber;
        uint256 startTime;
        bytes32 finalizedHash;          // Winning proposal hash (0 if not finalized)
        bool finalized;
    }

    // ============ Events ============

    event ValidatorRegistered(address indexed validator, NodeType nodeType, uint256 initialStake);
    event ValidatorDeactivated(address indexed validator);
    event StakeDeposited(address indexed validator, uint256 amount, uint256 totalStake);
    event StakeWithdrawn(address indexed validator, uint256 amount, uint256 totalStake);
    event PoWSubmitted(address indexed validator, uint256 cumulativePoW, uint256 newPowWeight);
    event MindScoreUpdated(address indexed validator, uint256 newMindScore, uint256 newPomWeight);
    event WeightsRecalculated(address indexed validator, uint256 powWeight, uint256 posWeight, uint256 pomWeight, uint256 totalWeight);
    event ProposalCreated(uint256 indexed proposalId, uint256 indexed epochNumber, address indexed proposer, bytes32 dataHash);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalFinalized(uint256 indexed proposalId, bytes32 dataHash, bool approved);
    event EpochAdvanced(uint256 indexed epochNumber, bytes32 finalizedHash);
    event HeartbeatReceived(address indexed validator, uint256 timestamp);
    event ValidatorSlashed(address indexed validator, uint256 stakeSlashed, uint256 mindScoreSlashed, string reason);
    event EquivocationDetected(address indexed validator, uint256 indexed epochNumber, bytes32 hash1, bytes32 hash2);
    event TrinityNodeAdded(address indexed node);
    event TrinityNodeRemoved(address indexed node);
    // C36-F2: admin observability — external-contract reference setters
    event SoulboundIdentityUpdated(address indexed oldAddr, address indexed newAddr);
    event ContributionDAGUpdated(address indexed oldAddr, address indexed newAddr);
    event VibeCodeUpdated(address indexed oldAddr, address indexed newAddr);
    event AgentReputationUpdated(address indexed oldAddr, address indexed newAddr);
    event CKBNativeTokenUpdated(address indexed oldAddr, address indexed newAddr);
    event JouleTokenUpdated(address indexed oldAddr, address indexed newAddr);

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error NotActive();
    error InsufficientStake();
    error NotTrinityNode();
    error MinTrinityNodes();
    error AlreadyVoted();
    error ProposalNotVoting();
    error EpochNotReady();
    error InvalidPoW();
    error HeartbeatTooSoon();
    error ZeroAmount();
    error ValidatorSlashedErr();
    error Unauthorized();
    error MaxValidatorsReached();

    // ============ Validator Functions ============

    /// @notice Register as a validator (stake VIBE to join)
    /// @param nodeType META (anyone) or AUTHORITY (requires Trinity approval)
    /// @param stakeAmount VIBE to stake
    function registerValidator(NodeType nodeType, uint256 stakeAmount) external;

    /// @notice Deposit additional VIBE stake
    /// @param amount VIBE to add
    function depositStake(uint256 amount) external;

    /// @notice Withdraw VIBE stake (reduces PoS weight)
    /// @param amount VIBE to withdraw
    function withdrawStake(uint256 amount) external;

    /// @notice Submit proof of work to increase PoW weight
    /// @param nonce The PoW nonce that satisfies difficulty
    function submitPoW(bytes32 nonce) external;

    /// @notice Refresh mind score from external identity contracts
    function refreshMindScore() external;

    /// @notice Send heartbeat to prove liveness
    function heartbeat() external;

    /// @notice Deactivate self (graceful exit)
    function deactivateValidator() external;

    // ============ Consensus Functions ============

    /// @notice Create a proposal for the current epoch
    /// @param dataHash Hash of proposed data/block
    /// @return proposalId The new proposal ID
    function propose(bytes32 dataHash) external returns (uint256 proposalId);

    /// @notice Vote on a proposal (weight = W(node))
    /// @param proposalId Proposal to vote on
    /// @param support True = for, false = against
    function vote(uint256 proposalId, bool support) external;

    /// @notice Finalize a proposal if 2/3 weighted threshold met
    /// @param proposalId Proposal to finalize
    function finalizeProposal(uint256 proposalId) external;

    /// @notice Advance to next epoch
    function advanceEpoch() external;

    // ============ Trinity Management ============

    /// @notice Add a Trinity authority node (owner only, gated by PoM threshold)
    function addTrinityNode(address node) external;

    /// @notice Remove a Trinity authority node (cannot go below BFT minimum)
    function removeTrinityNode(address node) external;

    // ============ View Functions ============

    /// @notice Get a validator's full state
    function getValidator(address addr) external view returns (Validator memory);

    /// @notice Get combined vote weight for a validator
    function getVoteWeight(address addr) external view returns (uint256);

    /// @notice Get individual dimension weights
    function getDimensionWeights(address addr) external view returns (
        uint256 powWeight, uint256 posWeight, uint256 pomWeight
    );

    /// @notice Get total network weight across all active validators
    function getTotalNetworkWeight() external view returns (uint256);

    /// @notice Get proposal details
    function getProposal(uint256 proposalId) external view returns (Proposal memory);

    /// @notice Get current epoch info
    function getCurrentEpoch() external view returns (EpochInfo memory);

    /// @notice Get the number of active validators
    function getActiveValidatorCount() external view returns (uint256);

    /// @notice Get Trinity node count
    function getTrinityNodeCount() external view returns (uint256);

    /// @notice Check if an address is a Trinity authority node
    function isTrinity(address addr) external view returns (bool);

    /// @notice Calculate PoW weight from cumulative solutions (pure math)
    function calculatePoWWeight(uint256 cumulativePoW) external pure returns (uint256);

    /// @notice Calculate PoM weight from mind score (pure math)
    function calculatePoMWeight(uint256 mindScore) external pure returns (uint256);
}
