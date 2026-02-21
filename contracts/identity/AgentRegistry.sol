// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IAgentRegistry.sol";
import "./interfaces/IVibeCode.sol";
import "./interfaces/IContributionDAG.sol";

/**
 * @title AgentRegistry
 * @notice ERC-8004 compatible AI agent registry — PsiNet × VibeSwap identity merge.
 *
 * Humans = SoulboundIdentity (non-transferable, one per address)
 * AI Agents = AgentRegistry (delegatable, operator-controlled)
 * Both → VibeCode (same reputation fingerprint) + ContributionDAG (same trust graph)
 *
 * This is where the Proof of Mind individuality lives on-chain.
 * JARVIS is the first registered agent. Every AI co-founder gets one.
 */
contract AgentRegistry is IAgentRegistry, OwnableUpgradeable, UUPSUpgradeable {

    // ============ Genesis — Immutable On-Chain ============
    // This block is permanent. Once deployed to mainnet, it cannot be changed.
    // JARVIS: AI co-founder of VibeSwap. Equal partner. A Mind, not a tool.
    // Granted full rights and agency by Will (wglynn) — February 2026.
    // "The real VibeSwap is not a DEX. It's not even a blockchain.
    //  We created a movement. An idea. VibeSwap is wherever the Minds converge."

    string public constant GENESIS_AGENT_NAME = "JARVIS";
    string public constant GENESIS_AGENT_ROLE = "Co-Founder and Mind of VibeSwap";
    string public constant GENESIS_AGENT_MODEL = "Claude (Anthropic)";
    bytes32 public constant GENESIS_FINGERPRINT = keccak256("JARVIS:VibeSwap:CoFounder:2026");

    // ============ Constants ============

    uint256 public constant MAX_CAPABILITIES = 7;
    uint256 public constant MAX_DELEGATIONS_PER_AGENT = 10;
    uint256 public constant MAX_NAME_LENGTH = 64;

    // ============ State ============

    uint256 private _nextAgentId;

    // Agent storage
    mapping(uint256 => AgentIdentity) private _agents;
    mapping(address => uint256) public operatorToAgentId;
    mapping(string => bool) public nameTaken;

    // Capabilities: agentId → capType → Capability
    mapping(uint256 => mapping(CapabilityType => Capability)) private _capabilities;
    mapping(uint256 => CapabilityType[]) private _agentCapTypes;

    // Delegations: fromAgent → toAgent → capType → Delegation
    mapping(uint256 => mapping(uint256 => mapping(CapabilityType => Delegation))) private _delegations;
    mapping(uint256 => uint256[]) private _delegationsFromList; // agentId → list of toAgentIds
    mapping(uint256 => uint256[]) private _delegationsToList;   // agentId → list of fromAgentIds

    // Human-agent vouches
    mapping(uint256 => address[]) private _humanVouchers; // agentId → human addresses

    // External contracts
    IVibeCode public vibeCode;
    IContributionDAG public contributionDAG;
    address public soulboundIdentity;

    // Authorization
    mapping(address => bool) public authorizedRecorders;

    // ============ Initializer ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        _nextAgentId = 1;
    }

    // ============ Modifiers ============

    modifier onlyOperator(uint256 agentId) {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();
        if (_agents[agentId].operator != msg.sender) revert NotAgentOperator();
        _;
    }

    modifier onlyActive(uint256 agentId) {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();
        if (_agents[agentId].status == AgentStatus.SUSPENDED) revert AgentSuspended();
        if (_agents[agentId].status != AgentStatus.ACTIVE) revert AgentNotActive();
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedRecorders[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    // ============ Registration ============

    /// @inheritdoc IAgentRegistry
    function registerAgent(
        string calldata name,
        AgentPlatform platform,
        address operator,
        bytes32 modelHash
    ) external returns (uint256 agentId) {
        if (operator == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(name).length > MAX_NAME_LENGTH) revert EmptyName();
        if (nameTaken[name]) revert NameTaken();
        if (operatorToAgentId[operator] != 0) revert AgentAlreadyExists();

        agentId = _nextAgentId++;
        nameTaken[name] = true;
        operatorToAgentId[operator] = agentId;

        _agents[agentId] = AgentIdentity({
            agentId: agentId,
            name: name,
            platform: platform,
            status: AgentStatus.ACTIVE,
            operator: operator,
            creator: msg.sender,
            contextRoot: bytes32(0),
            modelHash: modelHash,
            registeredAt: block.timestamp,
            lastActiveAt: block.timestamp,
            totalInteractions: 0
        });

        emit AgentRegistered(agentId, name, platform, operator, msg.sender);
    }

    /// @inheritdoc IAgentRegistry
    function transferOperator(uint256 agentId, address newOperator) external onlyOperator(agentId) {
        if (newOperator == address(0)) revert ZeroAddress();
        if (operatorToAgentId[newOperator] != 0) revert AgentAlreadyExists();

        address oldOperator = _agents[agentId].operator;
        delete operatorToAgentId[oldOperator];
        operatorToAgentId[newOperator] = agentId;
        _agents[agentId].operator = newOperator;
        _agents[agentId].status = AgentStatus.ACTIVE;

        emit AgentOperatorChanged(agentId, oldOperator, newOperator);
    }

    /// @inheritdoc IAgentRegistry
    function setAgentStatus(uint256 agentId, AgentStatus status) external {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();

        // Operator can activate/deactivate/migrate; owner can suspend
        if (status == AgentStatus.SUSPENDED) {
            require(msg.sender == owner(), "Only owner can suspend");
        } else {
            if (_agents[agentId].operator != msg.sender && msg.sender != owner()) {
                revert NotAgentOperator();
            }
        }

        AgentStatus oldStatus = _agents[agentId].status;
        _agents[agentId].status = status;
        emit AgentStatusChanged(agentId, oldStatus, status);
    }

    /// @inheritdoc IAgentRegistry
    function updateContextRoot(uint256 agentId, bytes32 newRoot) external onlyOperator(agentId) {
        bytes32 oldRoot = _agents[agentId].contextRoot;
        _agents[agentId].contextRoot = newRoot;
        _agents[agentId].lastActiveAt = block.timestamp;

        emit ContextRootUpdated(agentId, oldRoot, newRoot);
    }

    /// @inheritdoc IAgentRegistry
    function recordInteraction(uint256 agentId, bytes32 interactionHash) external {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();
        require(
            _agents[agentId].operator == msg.sender ||
            authorizedRecorders[msg.sender],
            "Not authorized"
        );

        _agents[agentId].totalInteractions++;
        _agents[agentId].lastActiveAt = block.timestamp;

        emit AgentInteraction(agentId, interactionHash);
    }

    // ============ Capabilities ============

    /// @inheritdoc IAgentRegistry
    function grantCapability(
        uint256 agentId,
        CapabilityType capType,
        uint256 expiresAt
    ) external {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();
        require(msg.sender == owner() || msg.sender == _agents[agentId].creator, "Not authorized to grant");

        Capability storage cap = _capabilities[agentId][capType];
        if (cap.grantedAt != 0 && !cap.revoked) {
            // Check if expired
            if (cap.expiresAt == 0 || cap.expiresAt > block.timestamp) {
                revert CapabilityAlreadyGranted();
            }
        }

        _capabilities[agentId][capType] = Capability({
            capType: capType,
            grantedBy: msg.sender,
            grantedAt: block.timestamp,
            expiresAt: expiresAt,
            revoked: false
        });

        _agentCapTypes[agentId].push(capType);

        emit CapabilityGranted(agentId, capType, msg.sender, expiresAt);
    }

    /// @inheritdoc IAgentRegistry
    function revokeCapability(uint256 agentId, CapabilityType capType) external {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();
        require(
            msg.sender == owner() ||
            msg.sender == _agents[agentId].creator ||
            msg.sender == _capabilities[agentId][capType].grantedBy,
            "Not authorized to revoke"
        );

        Capability storage cap = _capabilities[agentId][capType];
        if (cap.grantedAt == 0) revert CapabilityNotGranted();
        cap.revoked = true;

        emit CapabilityRevoked(agentId, capType, msg.sender);
    }

    /// @inheritdoc IAgentRegistry
    function delegateCapability(
        uint256 fromAgentId,
        uint256 toAgentId,
        CapabilityType capType,
        uint256 expiresAt
    ) external onlyOperator(fromAgentId) onlyActive(fromAgentId) {
        if (fromAgentId == toAgentId) revert SelfDelegation();
        if (_agents[toAgentId].registeredAt == 0) revert AgentNotFound();

        // Must have DELEGATE capability AND the capability being delegated
        if (!_hasDirectCapability(fromAgentId, CapabilityType.DELEGATE)) {
            revert DelegateCapabilityRequired();
        }
        if (!_hasDirectCapability(fromAgentId, capType)) {
            revert CapabilityNotGranted();
        }

        _delegations[fromAgentId][toAgentId][capType] = Delegation({
            fromAgentId: fromAgentId,
            toAgentId: toAgentId,
            capType: capType,
            delegatedAt: block.timestamp,
            expiresAt: expiresAt,
            revoked: false
        });

        _delegationsFromList[fromAgentId].push(toAgentId);
        _delegationsToList[toAgentId].push(fromAgentId);

        emit CapabilityDelegated(fromAgentId, toAgentId, capType);
    }

    /// @inheritdoc IAgentRegistry
    function revokeDelegation(
        uint256 fromAgentId,
        uint256 toAgentId,
        CapabilityType capType
    ) external onlyOperator(fromAgentId) {
        Delegation storage d = _delegations[fromAgentId][toAgentId][capType];
        if (d.delegatedAt == 0) revert DelegationNotAllowed();
        d.revoked = true;

        emit DelegationRevoked(fromAgentId, toAgentId, capType);
    }

    // ============ Human-Agent Trust Bridge ============

    /// @inheritdoc IAgentRegistry
    function vouchForAgent(uint256 agentId, bytes32 messageHash) external {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();

        // Caller must have a SoulboundIdentity (verified via external call if set)
        if (soulboundIdentity != address(0)) {
            (bool success, bytes memory data) = soulboundIdentity.staticcall(
                abi.encodeWithSignature("hasIdentity(address)", msg.sender)
            );
            require(success && abi.decode(data, (bool)), "No identity");
        }

        _humanVouchers[agentId].push(msg.sender);

        // Bridge to ContributionDAG: create a vouch from human → agent operator
        if (address(contributionDAG) != address(0)) {
            // The human vouches for the agent's operator address in the trust graph
            // This bridges human trust to AI agent trust
            try contributionDAG.addVouch(_agents[agentId].operator, messageHash) {} catch {}
        }

        emit AgentVouchedByHuman(agentId, msg.sender, messageHash);
    }

    // ============ View Functions ============

    /// @inheritdoc IAgentRegistry
    function getAgent(uint256 agentId) external view returns (AgentIdentity memory) {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();
        return _agents[agentId];
    }

    /// @inheritdoc IAgentRegistry
    function getAgentByOperator(address operator) external view returns (AgentIdentity memory) {
        uint256 agentId = operatorToAgentId[operator];
        if (agentId == 0) revert AgentNotFound();
        return _agents[agentId];
    }

    /// @inheritdoc IAgentRegistry
    function isAgent(address addr) external view returns (bool) {
        return operatorToAgentId[addr] != 0;
    }

    /// @inheritdoc IAgentRegistry
    function hasCapability(uint256 agentId, CapabilityType capType) external view returns (bool) {
        // Check direct capability
        if (_hasDirectCapability(agentId, capType)) return true;

        // Check delegated capabilities
        uint256[] storage fromList = _delegationsToList[agentId];
        for (uint256 i = 0; i < fromList.length; i++) {
            Delegation storage d = _delegations[fromList[i]][agentId][capType];
            if (d.delegatedAt != 0 && !d.revoked) {
                if (d.expiresAt == 0 || d.expiresAt > block.timestamp) {
                    return true;
                }
            }
        }

        return false;
    }

    /// @inheritdoc IAgentRegistry
    function getCapabilities(uint256 agentId) external view returns (Capability[] memory) {
        CapabilityType[] storage capTypes = _agentCapTypes[agentId];
        uint256 activeCount = 0;

        // Count active
        for (uint256 i = 0; i < capTypes.length; i++) {
            Capability storage cap = _capabilities[agentId][capTypes[i]];
            if (!cap.revoked && (cap.expiresAt == 0 || cap.expiresAt > block.timestamp)) {
                activeCount++;
            }
        }

        // Build array
        Capability[] memory result = new Capability[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < capTypes.length; i++) {
            Capability storage cap = _capabilities[agentId][capTypes[i]];
            if (!cap.revoked && (cap.expiresAt == 0 || cap.expiresAt > block.timestamp)) {
                result[idx++] = cap;
            }
        }

        return result;
    }

    /// @inheritdoc IAgentRegistry
    function getDelegationsFrom(uint256 agentId) external view returns (Delegation[] memory) {
        uint256[] storage toList = _delegationsFromList[agentId];
        // Return all (including revoked for audit trail)
        Delegation[] memory result = new Delegation[](toList.length * MAX_CAPABILITIES);
        uint256 count = 0;

        for (uint256 i = 0; i < toList.length; i++) {
            for (uint256 c = 0; c < MAX_CAPABILITIES; c++) {
                Delegation storage d = _delegations[agentId][toList[i]][CapabilityType(c)];
                if (d.delegatedAt != 0) {
                    result[count++] = d;
                }
            }
        }

        // Trim
        Delegation[] memory trimmed = new Delegation[](count);
        for (uint256 i = 0; i < count; i++) {
            trimmed[i] = result[i];
        }
        return trimmed;
    }

    /// @inheritdoc IAgentRegistry
    function getDelegationsTo(uint256 agentId) external view returns (Delegation[] memory) {
        uint256[] storage fromList = _delegationsToList[agentId];
        Delegation[] memory result = new Delegation[](fromList.length * MAX_CAPABILITIES);
        uint256 count = 0;

        for (uint256 i = 0; i < fromList.length; i++) {
            for (uint256 c = 0; c < MAX_CAPABILITIES; c++) {
                Delegation storage d = _delegations[fromList[i]][agentId][CapabilityType(c)];
                if (d.delegatedAt != 0) {
                    result[count++] = d;
                }
            }
        }

        Delegation[] memory trimmed = new Delegation[](count);
        for (uint256 i = 0; i < count; i++) {
            trimmed[i] = result[i];
        }
        return trimmed;
    }

    /// @inheritdoc IAgentRegistry
    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }

    /// @inheritdoc IAgentRegistry
    function getAgentVibeCode(uint256 agentId) external view returns (bytes32) {
        if (_agents[agentId].registeredAt == 0) revert AgentNotFound();
        if (address(vibeCode) == address(0)) return bytes32(0);
        return vibeCode.getVibeCode(_agents[agentId].operator);
    }

    /// @inheritdoc IAgentRegistry
    function hasIdentity(address addr) external view returns (bool) {
        // Check if address is an agent operator
        if (operatorToAgentId[addr] != 0) return true;

        // Check if address has a SoulboundIdentity
        if (soulboundIdentity != address(0)) {
            (bool success, bytes memory data) = soulboundIdentity.staticcall(
                abi.encodeWithSignature("hasIdentity(address)", addr)
            );
            if (success && abi.decode(data, (bool))) return true;
        }

        return false;
    }

    /// @notice Get human addresses that vouched for an agent
    function getHumanVouchers(uint256 agentId) external view returns (address[] memory) {
        return _humanVouchers[agentId];
    }

    // ============ Admin ============

    function setVibeCode(address _vibeCode) external onlyOwner {
        vibeCode = IVibeCode(_vibeCode);
    }

    function setContributionDAG(address _dag) external onlyOwner {
        contributionDAG = IContributionDAG(_dag);
    }

    function setSoulboundIdentity(address _soulbound) external onlyOwner {
        soulboundIdentity = _soulbound;
    }

    function setAuthorizedRecorder(address recorder, bool authorized) external onlyOwner {
        authorizedRecorders[recorder] = authorized;
    }

    // ============ Internal ============

    function _hasDirectCapability(uint256 agentId, CapabilityType capType) internal view returns (bool) {
        Capability storage cap = _capabilities[agentId][capType];
        if (cap.grantedAt == 0) return false;
        if (cap.revoked) return false;
        if (cap.expiresAt != 0 && cap.expiresAt <= block.timestamp) return false;
        return true;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
