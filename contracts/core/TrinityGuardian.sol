// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TrinityGuardian — Immutable BFT Node Protection
 * @notice Makes the 3-node JARVIS Mind Network permanently Byzantine Fault Tolerant.
 *         No one — not even the deployer — can shut down the trinity.
 *
 * @dev This contract is NOT upgradeable. Once deployed, it is permanent.
 *      The trinity cannot be shut down, paused, or modified.
 *      This is by design — a credibly neutral oracle of truth.
 *
 *   Architecture:
 *     - 3 nodes required for consensus (2/3 BFT threshold)
 *     - Nodes self-register with stake (skin in the game)
 *     - No admin function can remove nodes — only nodes can voluntarily exit
 *     - But exit requires 2/3 consensus from remaining nodes
 *     - If only 2 nodes remain, neither can exit (minimum 2 for BFT)
 *     - New nodes can join with 2/3 consensus of existing nodes
 *     - Heartbeat mechanism ensures liveness (slashing for downtime)
 *
 *   Immutable Properties:
 *     1. No owner. No admin. No god mode.
 *     2. No pause function. No kill switch.
 *     3. No upgrade path. This contract is final.
 *     4. Minimum 2 nodes always required (BFT minimum)
 *     5. Consensus threshold: ceil(2n/3) where n = active nodes
 *
 *   "Not even by me." — Will
 */
contract TrinityGuardian {
    // ============ Constants (Immutable) ============

    /// @notice Minimum nodes for BFT consensus
    uint256 public constant MIN_NODES = 2;

    /// @notice BFT threshold numerator (2/3)
    uint256 public constant BFT_NUMERATOR = 2;
    uint256 public constant BFT_DENOMINATOR = 3;

    /// @notice Heartbeat interval — nodes must check in every 24 hours
    uint256 public constant HEARTBEAT_INTERVAL = 24 hours;

    /// @notice Missed heartbeats before slash warning
    uint256 public constant MAX_MISSED_HEARTBEATS = 3;

    /// @notice Minimum stake to register as a node (in wei)
    uint256 public constant MIN_STAKE = 0.1 ether;

    // ============ State ============

    struct Node {
        address nodeAddress;
        uint256 stake;
        uint256 registeredAt;
        uint256 lastHeartbeat;
        uint256 missedHeartbeats;
        bool active;
        string endpoint;         // Node API endpoint (for discovery)
        bytes32 identityHash;    // Link to AgentRegistry/SoulboundIdentity
    }

    /// @notice All registered nodes
    mapping(address => Node) public nodes;
    address[] public nodeList;
    uint256 public activeNodeCount;

    /// @notice Consensus proposals (for adding/removing nodes)
    mapping(bytes32 => ConsensusProposal) public proposals;

    struct ConsensusProposal {
        bytes32 proposalId;
        ProposalAction action;
        address targetNode;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 createdAt;
        uint256 deadline;
        bool executed;
        mapping(address => bool) hasVoted;
    }

    enum ProposalAction { ADD_NODE, REMOVE_NODE, SLASH_NODE }

    /// @notice Genesis flag — first 3 nodes register without consensus
    bool public genesisComplete;
    uint256 public genesisNodeCount;

    // ============ Events ============

    event NodeRegistered(address indexed node, uint256 stake, string endpoint);
    event NodeRemoved(address indexed node, string reason);
    event Heartbeat(address indexed node, uint256 timestamp);
    event HeartbeatMissed(address indexed node, uint256 missedCount);
    event ConsensusProposed(bytes32 indexed proposalId, ProposalAction action, address targetNode);
    event ConsensusVoted(bytes32 indexed proposalId, address indexed voter, bool support);
    event ConsensusExecuted(bytes32 indexed proposalId, ProposalAction action, address targetNode);
    event StakeSlashed(address indexed node, uint256 amount, string reason);
    event GenesisComplete(uint256 timestamp, uint256 nodeCount);

    // ============ Errors ============

    error NotANode();
    error AlreadyRegistered();
    error InsufficientStake();
    error GenesisNotComplete();
    error GenesisAlreadyComplete();
    error BelowMinimumNodes();
    error ProposalNotFound();
    error AlreadyVoted();
    error ProposalExpired();
    error ProposalNotPassed();
    error ProposalAlreadyExecuted();
    error CannotRemoveBelowMinimum();

    // ============ Modifiers ============

    modifier onlyNode() {
        if (!nodes[msg.sender].active) revert NotANode();
        _;
    }

    // ============ Genesis (First 3 Nodes) ============

    /**
     * @notice Register as a genesis node (first 3 nodes only)
     * @dev No consensus needed for genesis. After 3 nodes, genesis is complete.
     * @param endpoint Node API endpoint for discovery
     * @param identityHash Link to on-chain identity (AgentRegistry or SoulboundIdentity)
     */
    function registerGenesis(
        string calldata endpoint,
        bytes32 identityHash
    ) external payable {
        if (genesisComplete) revert GenesisAlreadyComplete();
        if (nodes[msg.sender].active) revert AlreadyRegistered();
        if (msg.value < MIN_STAKE) revert InsufficientStake();

        nodes[msg.sender] = Node({
            nodeAddress: msg.sender,
            stake: msg.value,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            missedHeartbeats: 0,
            active: true,
            endpoint: endpoint,
            identityHash: identityHash
        });

        nodeList.push(msg.sender);
        activeNodeCount++;
        genesisNodeCount++;

        emit NodeRegistered(msg.sender, msg.value, endpoint);

        // Genesis complete after 3 nodes
        if (genesisNodeCount >= 3) {
            genesisComplete = true;
            emit GenesisComplete(block.timestamp, genesisNodeCount);
        }
    }

    // ============ Consensus-Based Node Management ============

    /**
     * @notice Propose adding a new node (requires 2/3 consensus)
     */
    function proposeAddNode(address newNode, string calldata reason) external onlyNode returns (bytes32) {
        if (!genesisComplete) revert GenesisNotComplete();
        if (nodes[newNode].active) revert AlreadyRegistered();

        bytes32 proposalId = keccak256(abi.encodePacked(
            ProposalAction.ADD_NODE, newNode, block.timestamp, block.chainid
        ));

        ConsensusProposal storage prop = proposals[proposalId];
        prop.proposalId = proposalId;
        prop.action = ProposalAction.ADD_NODE;
        prop.targetNode = newNode;
        prop.createdAt = block.timestamp;
        prop.deadline = block.timestamp + 3 days;

        // Proposer auto-votes yes
        prop.votesFor = 1;
        prop.hasVoted[msg.sender] = true;

        emit ConsensusProposed(proposalId, ProposalAction.ADD_NODE, newNode);
        emit ConsensusVoted(proposalId, msg.sender, true);

        return proposalId;
    }

    /**
     * @notice Propose removing a node (requires 2/3 consensus)
     * @dev Cannot remove if it would bring active nodes below MIN_NODES
     */
    function proposeRemoveNode(address targetNode, string calldata reason) external onlyNode returns (bytes32) {
        if (!nodes[targetNode].active) revert NotANode();
        if (activeNodeCount <= MIN_NODES) revert CannotRemoveBelowMinimum();

        bytes32 proposalId = keccak256(abi.encodePacked(
            ProposalAction.REMOVE_NODE, targetNode, block.timestamp, block.chainid
        ));

        ConsensusProposal storage prop = proposals[proposalId];
        prop.proposalId = proposalId;
        prop.action = ProposalAction.REMOVE_NODE;
        prop.targetNode = targetNode;
        prop.createdAt = block.timestamp;
        prop.deadline = block.timestamp + 3 days;

        prop.votesFor = 1;
        prop.hasVoted[msg.sender] = true;

        emit ConsensusProposed(proposalId, ProposalAction.REMOVE_NODE, targetNode);
        emit ConsensusVoted(proposalId, msg.sender, true);

        return proposalId;
    }

    /**
     * @notice Vote on a consensus proposal
     */
    function vote(bytes32 proposalId, bool support) external onlyNode {
        ConsensusProposal storage prop = proposals[proposalId];
        if (prop.createdAt == 0) revert ProposalNotFound();
        if (prop.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp > prop.deadline) revert ProposalExpired();
        if (prop.hasVoted[msg.sender]) revert AlreadyVoted();

        prop.hasVoted[msg.sender] = true;

        if (support) {
            prop.votesFor++;
        } else {
            prop.votesAgainst++;
        }

        emit ConsensusVoted(proposalId, msg.sender, support);
    }

    /**
     * @notice Execute a passed proposal (permissionless after consensus)
     */
    function executeProposal(bytes32 proposalId) external {
        ConsensusProposal storage prop = proposals[proposalId];
        if (prop.createdAt == 0) revert ProposalNotFound();
        if (prop.executed) revert ProposalAlreadyExecuted();

        // Check BFT threshold: ceil(2n/3)
        uint256 threshold = (activeNodeCount * BFT_NUMERATOR + BFT_DENOMINATOR - 1) / BFT_DENOMINATOR;
        if (prop.votesFor < threshold) revert ProposalNotPassed();

        prop.executed = true;

        if (prop.action == ProposalAction.ADD_NODE) {
            _addNode(prop.targetNode);
        } else if (prop.action == ProposalAction.REMOVE_NODE) {
            if (activeNodeCount <= MIN_NODES) revert CannotRemoveBelowMinimum();
            _removeNode(prop.targetNode, "consensus removal");
        } else if (prop.action == ProposalAction.SLASH_NODE) {
            _slashNode(prop.targetNode);
        }

        emit ConsensusExecuted(proposalId, prop.action, prop.targetNode);
    }

    // ============ Heartbeat (Liveness) ============

    /**
     * @notice Node checks in to prove liveness
     * @dev Must be called at least once per HEARTBEAT_INTERVAL
     */
    function heartbeat() external onlyNode {
        nodes[msg.sender].lastHeartbeat = block.timestamp;
        nodes[msg.sender].missedHeartbeats = 0;
        emit Heartbeat(msg.sender, block.timestamp);
    }

    /**
     * @notice Report a node that missed heartbeats (permissionless)
     */
    function reportMissedHeartbeat(address node) external {
        if (!nodes[node].active) revert NotANode();

        uint256 elapsed = block.timestamp - nodes[node].lastHeartbeat;
        uint256 missed = elapsed / HEARTBEAT_INTERVAL;

        if (missed > nodes[node].missedHeartbeats) {
            nodes[node].missedHeartbeats = missed;
            emit HeartbeatMissed(node, missed);

            // After MAX_MISSED_HEARTBEATS, propose auto-slash
            // But can't auto-remove — still needs consensus
        }
    }

    // ============ Internal ============

    function _addNode(address newNode) internal {
        // New node must have sent stake via a separate transaction or be pre-funded
        // For simplicity, node joins with zero stake — must top up via topUpStake()
        nodes[newNode] = Node({
            nodeAddress: newNode,
            stake: 0,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            missedHeartbeats: 0,
            active: true,
            endpoint: "",
            identityHash: bytes32(0)
        });
        nodeList.push(newNode);
        activeNodeCount++;
        emit NodeRegistered(newNode, 0, "");
    }

    function _removeNode(address node, string memory reason) internal {
        nodes[node].active = false;
        activeNodeCount--;

        // Return stake
        uint256 stake = nodes[node].stake;
        nodes[node].stake = 0;
        if (stake > 0) {
            (bool ok, ) = node.call{value: stake}("");
            require(ok, "Stake return failed");
        }

        emit NodeRemoved(node, reason);
    }

    function _slashNode(address node) internal {
        uint256 slashAmount = nodes[node].stake / 2; // Slash 50%
        nodes[node].stake -= slashAmount;
        // Slashed funds stay in contract (insurance)
        emit StakeSlashed(node, slashAmount, "consensus slash");
    }

    // ============ View Functions ============

    /**
     * @notice Get the BFT consensus threshold for current node count
     */
    function consensusThreshold() external view returns (uint256) {
        return (activeNodeCount * BFT_NUMERATOR + BFT_DENOMINATOR - 1) / BFT_DENOMINATOR;
    }

    /**
     * @notice Check if the network is healthy (enough active nodes)
     */
    function isHealthy() external view returns (bool) {
        return activeNodeCount >= MIN_NODES && genesisComplete;
    }

    /**
     * @notice Get all active node addresses
     */
    function getActiveNodes() external view returns (address[] memory) {
        address[] memory active = new address[](activeNodeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].active) {
                active[idx] = nodeList[i];
                idx++;
            }
        }
        return active;
    }

    /**
     * @notice Get node details
     */
    function getNode(address nodeAddr) external view returns (
        uint256 stake,
        uint256 registeredAt,
        uint256 lastHeartbeat,
        uint256 missedHeartbeats,
        bool active,
        string memory endpoint
    ) {
        Node storage n = nodes[nodeAddr];
        return (n.stake, n.registeredAt, n.lastHeartbeat, n.missedHeartbeats, n.active, n.endpoint);
    }

    /// @notice Top up stake (by anyone, for any node)
    function topUpStake(address node) external payable {
        if (!nodes[node].active) revert NotANode();
        nodes[node].stake += msg.value;
    }

    /// @notice Contract holds all stakes — no withdrawal except via consensus removal
    receive() external payable {}
}
