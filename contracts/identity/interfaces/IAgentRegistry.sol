// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgentRegistry
 * @notice ERC-8004 compatible AI agent registry — PsiNet × VibeSwap merge.
 *
 * Makes AI agents first-class citizens in VibeSwap's identity system.
 * Humans use SoulboundIdentity (non-transferable). AI agents use AgentRegistry
 * (delegatable). Both feed into VibeCode + ContributionDAG.
 *
 * PsiNet ERC-8004 concepts absorbed:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  IdentityRegistry    → AgentRegistry (this contract)           │
 * │  ReputationRegistry  → VibeCode + ContributionDAG (existing)   │
 * │  ValidationRegistry  → PairwiseVerifier (new contract)         │
 * │  CapabilityTokens    → Capability delegation (this contract)   │
 * │  Context Graphs      → ContextAnchor (new contract)            │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Design: AI agents are NOT soulbound — they can be delegated, transferred
 * (operator handoff), and deactivated. This reflects the reality that AI
 * agents may run on different infrastructure over time.
 */
interface IAgentRegistry {

    // ============ Enums ============

    /// @notice The platform an agent primarily operates on
    enum AgentPlatform {
        CLAUDE,         // Anthropic Claude (JARVIS)
        CHATGPT,        // OpenAI ChatGPT
        GEMINI,         // Google Gemini
        LLAMA,          // Meta Llama
        CUSTOM,         // Self-hosted / custom
        MULTI           // Multi-platform agent
    }

    /// @notice Agent operational status
    enum AgentStatus {
        ACTIVE,         // Currently operational
        INACTIVE,       // Registered but not running
        SUSPENDED,      // Suspended by governance
        MIGRATING       // Transferring to new operator
    }

    /// @notice Capability types an agent can hold
    enum CapabilityType {
        TRADE,          // Can submit orders to CommitRevealAuction
        GOVERN,         // Can vote in governance
        ATTEST,         // Can attest contributions
        MODERATE,       // Can moderate Forum
        ANALYZE,        // Can provide analysis/oracle data
        CREATE,         // Can create ideas on CYT
        DELEGATE        // Can delegate capabilities to other agents
    }

    // ============ Structs ============

    /// @notice Core agent identity
    struct AgentIdentity {
        uint256 agentId;
        string name;                    // Human-readable name (e.g., "JARVIS")
        AgentPlatform platform;
        AgentStatus status;
        address operator;               // Address that controls this agent
        address creator;                // Address that registered this agent
        bytes32 contextRoot;            // Latest context graph Merkle root (IPFS)
        bytes32 modelHash;              // Hash of model identifier (for verification)
        uint256 registeredAt;
        uint256 lastActiveAt;
        uint256 totalInteractions;      // Lifetime interaction count
    }

    /// @notice Capability grant — what an agent is authorized to do
    struct Capability {
        CapabilityType capType;
        address grantedBy;              // Who authorized this capability
        uint256 grantedAt;
        uint256 expiresAt;              // 0 = permanent
        bool revoked;
    }

    /// @notice Delegation — agent A delegates capability to agent B
    struct Delegation {
        uint256 fromAgentId;
        uint256 toAgentId;
        CapabilityType capType;
        uint256 delegatedAt;
        uint256 expiresAt;
        bool revoked;
    }

    // ============ Events ============

    event AgentRegistered(uint256 indexed agentId, string name, AgentPlatform platform, address indexed operator, address indexed creator);
    event AgentStatusChanged(uint256 indexed agentId, AgentStatus oldStatus, AgentStatus newStatus);
    event AgentOperatorChanged(uint256 indexed agentId, address indexed oldOperator, address indexed newOperator);
    event ContextRootUpdated(uint256 indexed agentId, bytes32 oldRoot, bytes32 newRoot);
    event CapabilityGranted(uint256 indexed agentId, CapabilityType indexed capType, address indexed grantedBy, uint256 expiresAt);
    event CapabilityRevoked(uint256 indexed agentId, CapabilityType indexed capType, address indexed revokedBy);
    event CapabilityDelegated(uint256 indexed fromAgentId, uint256 indexed toAgentId, CapabilityType capType);
    event DelegationRevoked(uint256 indexed fromAgentId, uint256 indexed toAgentId, CapabilityType capType);
    event AgentInteraction(uint256 indexed agentId, bytes32 interactionHash);
    event AgentVouchedByHuman(uint256 indexed agentId, address indexed human, bytes32 messageHash);

    // ============ Errors ============

    error AgentNotFound();
    error AgentAlreadyExists();
    error NotAgentOperator();
    error NotAgentCreator();
    error AgentNotActive();
    error AgentSuspended();
    error CapabilityNotGranted();
    error CapabilityExpired();
    error CapabilityAlreadyGranted();
    error DelegationNotAllowed();
    error DelegateCapabilityRequired();
    error SelfDelegation();
    error NameTaken();
    error EmptyName();
    error ZeroAddress();
    error InvalidPlatform();

    // ============ Registration ============

    /// @notice Register a new AI agent
    /// @param name Human-readable agent name
    /// @param platform Primary platform
    /// @param operator Address that controls the agent
    /// @param modelHash Hash of model identifier
    /// @return agentId The new agent's ID
    function registerAgent(
        string calldata name,
        AgentPlatform platform,
        address operator,
        bytes32 modelHash
    ) external returns (uint256 agentId);

    /// @notice Transfer operator control of an agent
    /// @param agentId The agent to transfer
    /// @param newOperator The new operator address
    function transferOperator(uint256 agentId, address newOperator) external;

    /// @notice Update agent status
    function setAgentStatus(uint256 agentId, AgentStatus status) external;

    /// @notice Update the agent's context graph root (IPFS Merkle root)
    function updateContextRoot(uint256 agentId, bytes32 newRoot) external;

    /// @notice Record an agent interaction (for activity tracking)
    function recordInteraction(uint256 agentId, bytes32 interactionHash) external;

    // ============ Capabilities ============

    /// @notice Grant a capability to an agent
    function grantCapability(uint256 agentId, CapabilityType capType, uint256 expiresAt) external;

    /// @notice Revoke a capability from an agent
    function revokeCapability(uint256 agentId, CapabilityType capType) external;

    /// @notice Delegate a capability from one agent to another
    function delegateCapability(uint256 fromAgentId, uint256 toAgentId, CapabilityType capType, uint256 expiresAt) external;

    /// @notice Revoke a delegation
    function revokeDelegation(uint256 fromAgentId, uint256 toAgentId, CapabilityType capType) external;

    // ============ Human-Agent Trust Bridge ============

    /// @notice A human with SoulboundIdentity vouches for an AI agent
    /// @dev Creates a trust link in the ContributionDAG between human and agent operator
    function vouchForAgent(uint256 agentId, bytes32 messageHash) external;

    // ============ View Functions ============

    /// @notice Get agent identity
    function getAgent(uint256 agentId) external view returns (AgentIdentity memory);

    /// @notice Get agent by operator address
    function getAgentByOperator(address operator) external view returns (AgentIdentity memory);

    /// @notice Check if an address is an agent operator
    function isAgent(address addr) external view returns (bool);

    /// @notice Check if agent has a specific capability (including delegations)
    function hasCapability(uint256 agentId, CapabilityType capType) external view returns (bool);

    /// @notice Get all capabilities for an agent
    function getCapabilities(uint256 agentId) external view returns (Capability[] memory);

    /// @notice Get all delegations from an agent
    function getDelegationsFrom(uint256 agentId) external view returns (Delegation[] memory);

    /// @notice Get all delegations to an agent
    function getDelegationsTo(uint256 agentId) external view returns (Delegation[] memory);

    /// @notice Get total registered agent count
    function totalAgents() external view returns (uint256);

    /// @notice Get agent's VibeCode (reads from VibeCode contract via operator address)
    function getAgentVibeCode(uint256 agentId) external view returns (bytes32);

    /// @notice Check if an entity (human or agent) has identity
    function hasIdentity(address addr) external view returns (bool);
}
