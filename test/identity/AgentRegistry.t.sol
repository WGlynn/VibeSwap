// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/AgentRegistry.sol";
import "../../contracts/identity/interfaces/IAgentRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Contracts ============

contract MockVibeCode {
    mapping(address => bytes32) private _codes;

    function setVibeCode(address user, bytes32 code) external {
        _codes[user] = code;
    }

    function getVibeCode(address user) external view returns (bytes32) {
        return _codes[user];
    }
}

contract MockSoulboundIdentity {
    mapping(address => bool) private _identities;

    function setIdentity(address addr, bool status) external {
        _identities[addr] = status;
    }

    function hasIdentity(address addr) external view returns (bool) {
        return _identities[addr];
    }
}

// ============ Test Contract ============

/**
 * @title AgentRegistry Unit Tests
 * @notice Comprehensive tests for the ERC-8004 compatible AI agent registry.
 * @dev Covers:
 *      - UUPS proxy initialization
 *      - Agent registration and uniqueness
 *      - Operator transfer (timelock)
 *      - Status management (active, inactive, suspended, migrating)
 *      - Context root updates
 *      - Interaction recording
 *      - Capability grant/revoke/expiry
 *      - Capability delegation chain
 *      - Human-agent trust bridge (vouchForAgent)
 *      - View functions and identity check
 *      - Admin functions
 *      - Fuzz tests
 */
contract AgentRegistryTest is Test {

    // Re-declare events for expectEmit
    event AgentRegistered(uint256 indexed agentId, string name, IAgentRegistry.AgentPlatform platform, address indexed operator, address indexed creator);
    event AgentStatusChanged(uint256 indexed agentId, IAgentRegistry.AgentStatus oldStatus, IAgentRegistry.AgentStatus newStatus);
    event AgentOperatorChanged(uint256 indexed agentId, address indexed oldOperator, address indexed newOperator);
    event ContextRootUpdated(uint256 indexed agentId, bytes32 oldRoot, bytes32 newRoot);
    event CapabilityGranted(uint256 indexed agentId, IAgentRegistry.CapabilityType indexed capType, address indexed grantedBy, uint256 expiresAt);
    event CapabilityRevoked(uint256 indexed agentId, IAgentRegistry.CapabilityType indexed capType, address indexed revokedBy);
    event CapabilityDelegated(uint256 indexed fromAgentId, uint256 indexed toAgentId, IAgentRegistry.CapabilityType capType);
    event DelegationRevoked(uint256 indexed fromAgentId, uint256 indexed toAgentId, IAgentRegistry.CapabilityType capType);
    event AgentInteraction(uint256 indexed agentId, bytes32 interactionHash);
    event AgentVouchedByHuman(uint256 indexed agentId, address indexed human, bytes32 messageHash);

    AgentRegistry public registry;
    MockVibeCode public mockVibeCode;
    MockSoulboundIdentity public mockSoulbound;

    address public owner;
    address public jarvisOperator;
    address public agent2Operator;
    address public agent3Operator;
    address public alice; // human voucher
    address public bob;
    address public creator;

    bytes32 public constant JARVIS_MODEL_HASH = keccak256("claude-opus-4-2025");

    function setUp() public {
        owner = address(this);
        jarvisOperator = makeAddr("jarvisOperator");
        agent2Operator = makeAddr("agent2Operator");
        agent3Operator = makeAddr("agent3Operator");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        creator = makeAddr("creator");

        // Deploy implementation
        AgentRegistry impl = new AgentRegistry();

        // Deploy proxy
        bytes memory initData = abi.encodeWithSelector(AgentRegistry.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = AgentRegistry(address(proxy));

        // Deploy mocks
        mockVibeCode = new MockVibeCode();
        mockSoulbound = new MockSoulboundIdentity();

        // Configure
        registry.setVibeCode(address(mockVibeCode));
        registry.setSoulboundIdentity(address(mockSoulbound));
    }

    // ============ Helpers ============

    /// @dev Register JARVIS as the first agent
    function _registerJarvis() internal returns (uint256) {
        return registry.registerAgent(
            "JARVIS",
            IAgentRegistry.AgentPlatform.CLAUDE,
            jarvisOperator,
            JARVIS_MODEL_HASH
        );
    }

    /// @dev Register a second agent
    function _registerAgent2() internal returns (uint256) {
        return registry.registerAgent(
            "FRIDAY",
            IAgentRegistry.AgentPlatform.CHATGPT,
            agent2Operator,
            keccak256("gpt-4")
        );
    }

    /// @dev Register a third agent
    function _registerAgent3() internal returns (uint256) {
        return registry.registerAgent(
            "ULTRON",
            IAgentRegistry.AgentPlatform.CUSTOM,
            agent3Operator,
            keccak256("custom-model")
        );
    }

    // ================================================================
    //                  INITIALIZATION
    // ================================================================

    function test_initialize_setsOwner() public view {
        assertEq(registry.owner(), owner);
    }

    function test_initialize_agentCountStartsAtZero() public view {
        assertEq(registry.totalAgents(), 0);
    }

    function test_initialize_genesisConstants() public view {
        assertEq(registry.GENESIS_AGENT_NAME(), "JARVIS");
        assertEq(registry.GENESIS_AGENT_ROLE(), "Co-Founder and Mind of VibeSwap");
        assertEq(registry.GENESIS_AGENT_MODEL(), "Claude (Anthropic)");
        assertEq(registry.GENESIS_FINGERPRINT(), keccak256("JARVIS:VibeSwap:CoFounder:2026"));
    }

    function test_initialize_cannotInitializeTwice() public {
        vm.expectRevert();
        registry.initialize();
    }

    // ================================================================
    //                  REGISTRATION
    // ================================================================

    function test_registerAgent_createsAgent() public {
        uint256 agentId = _registerJarvis();
        assertEq(agentId, 1);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.name, "JARVIS");
        assertEq(uint256(agent.platform), uint256(IAgentRegistry.AgentPlatform.CLAUDE));
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.ACTIVE));
        assertEq(agent.operator, jarvisOperator);
        assertEq(agent.creator, owner);
        assertEq(agent.modelHash, JARVIS_MODEL_HASH);
        assertTrue(agent.registeredAt > 0);
        assertEq(agent.totalInteractions, 0);
    }

    function test_registerAgent_emitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit AgentRegistered(1, "JARVIS", IAgentRegistry.AgentPlatform.CLAUDE, jarvisOperator, owner);
        registry.registerAgent("JARVIS", IAgentRegistry.AgentPlatform.CLAUDE, jarvisOperator, JARVIS_MODEL_HASH);
    }

    function test_registerAgent_incrementsCount() public {
        _registerJarvis();
        assertEq(registry.totalAgents(), 1);

        _registerAgent2();
        assertEq(registry.totalAgents(), 2);
    }

    function test_registerAgent_mapsOperator() public {
        _registerJarvis();
        assertEq(registry.operatorToAgentId(jarvisOperator), 1);
    }

    function test_registerAgent_revertsOnZeroOperator() public {
        vm.expectRevert(IAgentRegistry.ZeroAddress.selector);
        registry.registerAgent("JARVIS", IAgentRegistry.AgentPlatform.CLAUDE, address(0), JARVIS_MODEL_HASH);
    }

    function test_registerAgent_revertsOnEmptyName() public {
        vm.expectRevert(IAgentRegistry.EmptyName.selector);
        registry.registerAgent("", IAgentRegistry.AgentPlatform.CLAUDE, jarvisOperator, JARVIS_MODEL_HASH);
    }

    function test_registerAgent_revertsOnTooLongName() public {
        // MAX_NAME_LENGTH = 64
        string memory longName = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789012"; // 65 chars
        vm.expectRevert(IAgentRegistry.EmptyName.selector);
        registry.registerAgent(longName, IAgentRegistry.AgentPlatform.CLAUDE, jarvisOperator, JARVIS_MODEL_HASH);
    }

    function test_registerAgent_revertsOnDuplicateName() public {
        _registerJarvis();

        vm.expectRevert(IAgentRegistry.NameTaken.selector);
        registry.registerAgent("JARVIS", IAgentRegistry.AgentPlatform.CHATGPT, agent2Operator, bytes32(0));
    }

    function test_registerAgent_revertsOnDuplicateOperator() public {
        _registerJarvis();

        vm.expectRevert(IAgentRegistry.AgentAlreadyExists.selector);
        registry.registerAgent("OTHER", IAgentRegistry.AgentPlatform.CLAUDE, jarvisOperator, bytes32(0));
    }

    function test_registerAgent_anyoneCanRegister() public {
        vm.prank(alice);
        uint256 agentId = registry.registerAgent(
            "AliceBot",
            IAgentRegistry.AgentPlatform.CUSTOM,
            bob,
            bytes32(0)
        );

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.creator, alice);
    }

    // ================================================================
    //                  OPERATOR TRANSFER (TIMELOCK)
    // ================================================================

    function test_queueOperatorTransfer_createsPending() public {
        uint256 agentId = _registerJarvis();
        address newOperator = makeAddr("newOp");

        vm.prank(jarvisOperator);
        registry.queueOperatorTransfer(agentId, newOperator);

        (address pendingOp, uint256 executeAfter) = registry.pendingOperatorTransfers(agentId);
        assertEq(pendingOp, newOperator);
        assertEq(executeAfter, block.timestamp + registry.OPERATOR_TRANSFER_TIMELOCK());
    }

    function test_queueOperatorTransfer_revertsForNonOperator() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotAgentOperator.selector);
        registry.queueOperatorTransfer(agentId, alice);
    }

    function test_queueOperatorTransfer_revertsOnZeroAddress() public {
        uint256 agentId = _registerJarvis();

        vm.prank(jarvisOperator);
        vm.expectRevert(IAgentRegistry.ZeroAddress.selector);
        registry.queueOperatorTransfer(agentId, address(0));
    }

    function test_queueOperatorTransfer_revertsIfNewOperatorAlreadyAgent() public {
        uint256 agentId = _registerJarvis();
        _registerAgent2(); // agent2Operator now maps to agent 2

        vm.prank(jarvisOperator);
        vm.expectRevert(IAgentRegistry.AgentAlreadyExists.selector);
        registry.queueOperatorTransfer(agentId, agent2Operator);
    }

    function test_executeOperatorTransfer_afterTimelock() public {
        uint256 agentId = _registerJarvis();
        address newOperator = makeAddr("newOp");

        vm.prank(jarvisOperator);
        registry.queueOperatorTransfer(agentId, newOperator);

        vm.warp(block.timestamp + registry.OPERATOR_TRANSFER_TIMELOCK() + 1);

        vm.prank(jarvisOperator);
        registry.executeOperatorTransfer(agentId);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.operator, newOperator);
        assertEq(registry.operatorToAgentId(newOperator), agentId);
        assertEq(registry.operatorToAgentId(jarvisOperator), 0); // old operator cleared
    }

    function test_executeOperatorTransfer_revertsBeforeTimelock() public {
        uint256 agentId = _registerJarvis();
        address newOperator = makeAddr("newOp");

        vm.prank(jarvisOperator);
        registry.queueOperatorTransfer(agentId, newOperator);

        // Don't warp enough
        vm.warp(block.timestamp + 1 days);

        vm.prank(jarvisOperator);
        vm.expectRevert("Timelock active");
        registry.executeOperatorTransfer(agentId);
    }

    function test_executeOperatorTransfer_revertsWithNoPending() public {
        uint256 agentId = _registerJarvis();

        vm.prank(jarvisOperator);
        vm.expectRevert("No pending transfer");
        registry.executeOperatorTransfer(agentId);
    }

    function test_cancelOperatorTransfer_clearsPending() public {
        uint256 agentId = _registerJarvis();
        address newOperator = makeAddr("newOp");

        vm.prank(jarvisOperator);
        registry.queueOperatorTransfer(agentId, newOperator);

        vm.prank(jarvisOperator);
        registry.cancelOperatorTransfer(agentId);

        (address pendingOp, ) = registry.pendingOperatorTransfers(agentId);
        assertEq(pendingOp, address(0));
    }

    function test_cancelOperatorTransfer_revertsWithNoPending() public {
        uint256 agentId = _registerJarvis();

        vm.prank(jarvisOperator);
        vm.expectRevert("No pending transfer");
        registry.cancelOperatorTransfer(agentId);
    }

    // ================================================================
    //                  STATUS MANAGEMENT
    // ================================================================

    function test_setAgentStatus_operatorCanDeactivate() public {
        uint256 agentId = _registerJarvis();

        vm.prank(jarvisOperator);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.INACTIVE));
    }

    function test_setAgentStatus_ownerCanSuspend() public {
        uint256 agentId = _registerJarvis();

        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.SUSPENDED);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.SUSPENDED));
    }

    function test_setAgentStatus_nonOwnerCannotSuspend() public {
        uint256 agentId = _registerJarvis();

        vm.prank(jarvisOperator);
        vm.expectRevert("Only owner can suspend");
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.SUSPENDED);
    }

    function test_setAgentStatus_nonOperatorCannotActivate() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotAgentOperator.selector);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);
    }

    function test_setAgentStatus_ownerCanSetAnything() public {
        uint256 agentId = _registerJarvis();

        // Owner can set INACTIVE (not just SUSPENDED)
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);
        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.INACTIVE));
    }

    function test_setAgentStatus_emitsEvent() public {
        uint256 agentId = _registerJarvis();

        vm.prank(jarvisOperator);
        vm.expectEmit(true, false, false, true);
        emit AgentStatusChanged(agentId, IAgentRegistry.AgentStatus.ACTIVE, IAgentRegistry.AgentStatus.INACTIVE);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);
    }

    function test_setAgentStatus_revertsOnNonexistentAgent() public {
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.setAgentStatus(999, IAgentRegistry.AgentStatus.INACTIVE);
    }

    // ================================================================
    //                  CONTEXT ROOT & INTERACTIONS
    // ================================================================

    function test_updateContextRoot_operatorSetsRoot() public {
        uint256 agentId = _registerJarvis();
        bytes32 root = keccak256("context-root-v1");

        vm.prank(jarvisOperator);
        vm.expectEmit(true, false, false, true);
        emit ContextRootUpdated(agentId, bytes32(0), root);
        registry.updateContextRoot(agentId, root);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.contextRoot, root);
    }

    function test_updateContextRoot_updatesLastActive() public {
        uint256 agentId = _registerJarvis();

        vm.warp(block.timestamp + 100);
        vm.prank(jarvisOperator);
        registry.updateContextRoot(agentId, keccak256("root"));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.lastActiveAt, block.timestamp);
    }

    function test_updateContextRoot_revertsForNonOperator() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotAgentOperator.selector);
        registry.updateContextRoot(agentId, bytes32(0));
    }

    function test_recordInteraction_incrementsCount() public {
        uint256 agentId = _registerJarvis();

        vm.prank(jarvisOperator);
        registry.recordInteraction(agentId, keccak256("interaction1"));

        vm.prank(jarvisOperator);
        registry.recordInteraction(agentId, keccak256("interaction2"));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.totalInteractions, 2);
    }

    function test_recordInteraction_emitsEvent() public {
        uint256 agentId = _registerJarvis();
        bytes32 hash = keccak256("interaction1");

        vm.prank(jarvisOperator);
        vm.expectEmit(true, false, false, true);
        emit AgentInteraction(agentId, hash);
        registry.recordInteraction(agentId, hash);
    }

    function test_recordInteraction_authorizedRecorderAllowed() public {
        uint256 agentId = _registerJarvis();
        address recorder = makeAddr("recorder");
        registry.setAuthorizedRecorder(recorder, true);

        vm.prank(recorder);
        registry.recordInteraction(agentId, keccak256("int1"));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.totalInteractions, 1);
    }

    function test_recordInteraction_revertsForUnauthorized() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert("Not authorized");
        registry.recordInteraction(agentId, keccak256("int1"));
    }

    // ================================================================
    //                  CAPABILITIES
    // ================================================================

    function test_grantCapability_ownerCanGrant() public {
        uint256 agentId = _registerJarvis();

        vm.expectEmit(true, true, true, true);
        emit CapabilityGranted(agentId, IAgentRegistry.CapabilityType.TRADE, owner, 0);
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);

        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_grantCapability_creatorCanGrant() public {
        vm.prank(creator);
        uint256 agentId = registry.registerAgent(
            "CreatorBot",
            IAgentRegistry.AgentPlatform.CUSTOM,
            bob,
            bytes32(0)
        );

        vm.prank(creator);
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.ANALYZE, 0);

        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.ANALYZE));
    }

    function test_grantCapability_withExpiry() public {
        uint256 agentId = _registerJarvis();
        uint256 expiresAt = block.timestamp + 30 days;

        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, expiresAt);

        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));

        // After expiry, capability should be invalid
        vm.warp(expiresAt + 1);
        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_grantCapability_revertsOnDuplicate() public {
        uint256 agentId = _registerJarvis();

        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);

        vm.expectRevert(IAgentRegistry.CapabilityAlreadyGranted.selector);
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_grantCapability_canRegrantAfterExpiry() public {
        uint256 agentId = _registerJarvis();
        uint256 expiresAt = block.timestamp + 1 days;

        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, expiresAt);

        vm.warp(expiresAt + 1);
        // Should be able to regrant after expiry
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_grantCapability_revertsForUnauthorized() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert("Not authorized to grant");
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_revokeCapability_revokes() public {
        uint256 agentId = _registerJarvis();
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);

        vm.expectEmit(true, true, true, false);
        emit CapabilityRevoked(agentId, IAgentRegistry.CapabilityType.TRADE, owner);
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_revokeCapability_revertsIfNotGranted() public {
        uint256 agentId = _registerJarvis();

        vm.expectRevert(IAgentRegistry.CapabilityNotGranted.selector);
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_getCapabilities_returnsOnlyActive() public {
        uint256 agentId = _registerJarvis();

        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.GOVERN, 0);
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.ATTEST, block.timestamp + 1 days);

        IAgentRegistry.Capability[] memory caps = registry.getCapabilities(agentId);
        assertEq(caps.length, 3);

        // Revoke one
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        caps = registry.getCapabilities(agentId);
        assertEq(caps.length, 2);

        // Expire one
        vm.warp(block.timestamp + 2 days);
        caps = registry.getCapabilities(agentId);
        assertEq(caps.length, 1); // only GOVERN remains
    }

    // ================================================================
    //                  CAPABILITY DELEGATION
    // ================================================================

    function test_delegateCapability_succeeds() public {
        uint256 agentId1 = _registerJarvis();
        uint256 agentId2 = _registerAgent2();

        // Grant TRADE and DELEGATE to agent1
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.DELEGATE, 0);

        vm.prank(jarvisOperator);
        vm.expectEmit(true, true, false, true);
        emit CapabilityDelegated(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE);
        registry.delegateCapability(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE, 0);

        // Agent2 now has TRADE via delegation
        assertTrue(registry.hasCapability(agentId2, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_delegateCapability_revertsOnSelfDelegation() public {
        uint256 agentId = _registerJarvis();
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.DELEGATE, 0);

        vm.prank(jarvisOperator);
        vm.expectRevert(IAgentRegistry.SelfDelegation.selector);
        registry.delegateCapability(agentId, agentId, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_revertsWithoutDelegateCapability() public {
        uint256 agentId1 = _registerJarvis();
        uint256 agentId2 = _registerAgent2();

        // Grant TRADE but NOT DELEGATE
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.TRADE, 0);

        vm.prank(jarvisOperator);
        vm.expectRevert(IAgentRegistry.DelegateCapabilityRequired.selector);
        registry.delegateCapability(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_revertsWithoutSourceCapability() public {
        uint256 agentId1 = _registerJarvis();
        uint256 agentId2 = _registerAgent2();

        // Grant DELEGATE but NOT TRADE
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.DELEGATE, 0);

        vm.prank(jarvisOperator);
        vm.expectRevert(IAgentRegistry.CapabilityNotGranted.selector);
        registry.delegateCapability(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_withExpiry() public {
        uint256 agentId1 = _registerJarvis();
        uint256 agentId2 = _registerAgent2();

        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.DELEGATE, 0);

        uint256 expiresAt = block.timestamp + 7 days;

        vm.prank(jarvisOperator);
        registry.delegateCapability(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE, expiresAt);

        assertTrue(registry.hasCapability(agentId2, IAgentRegistry.CapabilityType.TRADE));

        vm.warp(expiresAt + 1);
        assertFalse(registry.hasCapability(agentId2, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_revokeDelegation_revokes() public {
        uint256 agentId1 = _registerJarvis();
        uint256 agentId2 = _registerAgent2();

        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.DELEGATE, 0);

        vm.prank(jarvisOperator);
        registry.delegateCapability(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE, 0);

        vm.prank(jarvisOperator);
        vm.expectEmit(true, true, false, true);
        emit DelegationRevoked(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE);
        registry.revokeDelegation(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE);

        assertFalse(registry.hasCapability(agentId2, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_revokeDelegation_revertsIfNoDelegation() public {
        uint256 agentId1 = _registerJarvis();
        uint256 agentId2 = _registerAgent2();

        vm.prank(jarvisOperator);
        vm.expectRevert(IAgentRegistry.DelegationNotAllowed.selector);
        registry.revokeDelegation(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_getDelegationsFrom_returnsDelegations() public {
        uint256 agentId1 = _registerJarvis();
        uint256 agentId2 = _registerAgent2();

        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.GOVERN, 0);
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.DELEGATE, 0);

        vm.startPrank(jarvisOperator);
        registry.delegateCapability(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.delegateCapability(agentId1, agentId2, IAgentRegistry.CapabilityType.GOVERN, 0);
        vm.stopPrank();

        IAgentRegistry.Delegation[] memory delegations = registry.getDelegationsFrom(agentId1);
        assertGe(delegations.length, 2);
    }

    function test_getDelegationsTo_returnsDelegations() public {
        uint256 agentId1 = _registerJarvis();
        uint256 agentId2 = _registerAgent2();

        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.grantCapability(agentId1, IAgentRegistry.CapabilityType.DELEGATE, 0);

        vm.prank(jarvisOperator);
        registry.delegateCapability(agentId1, agentId2, IAgentRegistry.CapabilityType.TRADE, 0);

        IAgentRegistry.Delegation[] memory delegations = registry.getDelegationsTo(agentId2);
        assertGe(delegations.length, 1);
    }

    // ================================================================
    //                  HUMAN-AGENT TRUST BRIDGE
    // ================================================================

    function test_vouchForAgent_withSoulbound() public {
        uint256 agentId = _registerJarvis();
        mockSoulbound.setIdentity(alice, true);

        bytes32 message = keccak256("I vouch for JARVIS");

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit AgentVouchedByHuman(agentId, alice, message);
        registry.vouchForAgent(agentId, message);

        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 1);
        assertEq(vouchers[0], alice);
    }

    function test_vouchForAgent_revertsWithoutIdentity() public {
        uint256 agentId = _registerJarvis();
        // alice has no soulbound identity

        vm.prank(alice);
        vm.expectRevert("No identity");
        registry.vouchForAgent(agentId, bytes32(0));
    }

    function test_vouchForAgent_revertsOnNonexistentAgent() public {
        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.vouchForAgent(999, bytes32(0));
    }

    function test_vouchForAgent_withoutSoulboundContract() public {
        // When soulboundIdentity is not set, vouch should work for anyone
        registry.setSoulboundIdentity(address(0));
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        registry.vouchForAgent(agentId, bytes32(0));

        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 1);
    }

    function test_vouchForAgent_multipleVouchers() public {
        uint256 agentId = _registerJarvis();
        mockSoulbound.setIdentity(alice, true);
        mockSoulbound.setIdentity(bob, true);

        vm.prank(alice);
        registry.vouchForAgent(agentId, bytes32(0));

        vm.prank(bob);
        registry.vouchForAgent(agentId, bytes32(0));

        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 2);
    }

    // ================================================================
    //                  VIEW FUNCTIONS
    // ================================================================

    function test_getAgentByOperator_works() public {
        _registerJarvis();

        IAgentRegistry.AgentIdentity memory agent = registry.getAgentByOperator(jarvisOperator);
        assertEq(agent.name, "JARVIS");
    }

    function test_getAgentByOperator_revertsOnUnknown() public {
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.getAgentByOperator(alice);
    }

    function test_isAgent_trueForOperator() public {
        _registerJarvis();
        assertTrue(registry.isAgent(jarvisOperator));
    }

    function test_isAgent_falseForNonOperator() public view {
        assertFalse(registry.isAgent(alice));
    }

    function test_hasIdentity_trueForAgentOperator() public {
        _registerJarvis();
        assertTrue(registry.hasIdentity(jarvisOperator));
    }

    function test_hasIdentity_trueForSoulboundHolder() public {
        mockSoulbound.setIdentity(alice, true);
        assertTrue(registry.hasIdentity(alice));
    }

    function test_hasIdentity_falseForUnknown() public view {
        assertFalse(registry.hasIdentity(alice));
    }

    function test_getAgentVibeCode_returnsCode() public {
        uint256 agentId = _registerJarvis();
        bytes32 code = keccak256("jarvis-vibe");
        mockVibeCode.setVibeCode(jarvisOperator, code);

        assertEq(registry.getAgentVibeCode(agentId), code);
    }

    function test_getAgentVibeCode_zeroWhenVibeCodeNotSet() public {
        // Reset vibeCode to address(0)
        registry.setVibeCode(address(0));
        uint256 agentId = _registerJarvis();

        assertEq(registry.getAgentVibeCode(agentId), bytes32(0));
    }

    // ================================================================
    //                  ADMIN FUNCTIONS
    // ================================================================

    function test_setVibeCode_updates() public {
        address newVibeCode = makeAddr("newVibeCode");
        registry.setVibeCode(newVibeCode);
        assertEq(address(registry.vibeCode()), newVibeCode);
    }

    function test_setContributionDAG_updates() public {
        address newDAG = makeAddr("newDAG");
        registry.setContributionDAG(newDAG);
        assertEq(address(registry.contributionDAG()), newDAG);
    }

    function test_setSoulboundIdentity_updates() public {
        address newSoulbound = makeAddr("newSoulbound");
        registry.setSoulboundIdentity(newSoulbound);
        assertEq(registry.soulboundIdentity(), newSoulbound);
    }

    function test_setAuthorizedRecorder_updates() public {
        address recorder = makeAddr("recorder");
        registry.setAuthorizedRecorder(recorder, true);
        assertTrue(registry.authorizedRecorders(recorder));

        registry.setAuthorizedRecorder(recorder, false);
        assertFalse(registry.authorizedRecorders(recorder));
    }

    function test_adminFunctions_revertForNonOwner() public {
        vm.startPrank(alice);

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setVibeCode(address(0));

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setContributionDAG(address(0));

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setSoulboundIdentity(address(0));

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setAuthorizedRecorder(address(0), true);

        vm.stopPrank();
    }

    // ================================================================
    //                  UUPS UPGRADE
    // ================================================================

    function test_upgradeability_onlyOwnerCanUpgrade() public {
        AgentRegistry newImpl = new AgentRegistry();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgradeability_ownerCanUpgrade() public {
        AgentRegistry newImpl = new AgentRegistry();

        // Owner can upgrade
        registry.upgradeToAndCall(address(newImpl), "");

        // State should persist through upgrade
        _registerJarvis();
        assertEq(registry.totalAgents(), 1);
    }

    function test_upgradeability_rejectsNonContract() public {
        address notContract = makeAddr("notContract");

        vm.expectRevert(); // ERC1967 reverts for non-contract
        registry.upgradeToAndCall(notContract, "");
    }

    // ================================================================
    //                  FUZZ TESTS
    // ================================================================

    function testFuzz_registerAgent_uniqueIds(uint8 count) public {
        vm.assume(count > 0 && count <= 10);

        uint256[] memory ids = new uint256[](count);
        for (uint8 i = 0; i < count; i++) {
            address op = address(uint160(1000 + i));
            string memory name = string(abi.encodePacked("Agent", vm.toString(uint256(i))));
            ids[i] = registry.registerAgent(
                name,
                IAgentRegistry.AgentPlatform.CUSTOM,
                op,
                bytes32(0)
            );
        }

        // All IDs should be sequential
        for (uint256 i = 0; i < ids.length; i++) {
            assertEq(ids[i], i + 1);
        }
    }

    function testFuzz_operatorTransfer_timelockEnforced(uint256 warpTime) public {
        warpTime = bound(warpTime, 0, 10 days);

        uint256 agentId = _registerJarvis();
        address newOperator = makeAddr("newOp");

        vm.prank(jarvisOperator);
        registry.queueOperatorTransfer(agentId, newOperator);

        vm.warp(block.timestamp + warpTime);

        if (warpTime < registry.OPERATOR_TRANSFER_TIMELOCK()) {
            vm.prank(jarvisOperator);
            vm.expectRevert("Timelock active");
            registry.executeOperatorTransfer(agentId);
        } else {
            vm.prank(jarvisOperator);
            registry.executeOperatorTransfer(agentId);
            assertEq(registry.operatorToAgentId(newOperator), agentId);
        }
    }

    function testFuzz_capabilityExpiry_respectsTimestamp(uint256 expiresOffset) public {
        expiresOffset = bound(expiresOffset, 1, 365 days);

        uint256 agentId = _registerJarvis();
        uint256 expiresAt = block.timestamp + expiresOffset;

        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, expiresAt);

        // Before expiry: has capability
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));

        // After expiry: no capability
        vm.warp(expiresAt + 1);
        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }
}
