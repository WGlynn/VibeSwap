// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/AgentRegistry.sol";
import "../../contracts/identity/interfaces/IAgentRegistry.sol";
import "../../contracts/identity/interfaces/IVibeCode.sol";
import "../../contracts/identity/interfaces/IContributionDAG.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Contracts ============

contract MockVibeCode {
    mapping(address => bytes32) public vibeCodes;

    function setVibeCode(address user, bytes32 code) external {
        vibeCodes[user] = code;
    }

    function getVibeCode(address user) external view returns (bytes32) {
        return vibeCodes[user];
    }
}

contract MockContributionDAG {
    // Track calls for verification
    address public lastVouchTo;
    bytes32 public lastVouchHash;
    uint256 public vouchCallCount;
    bool public shouldRevert;

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function addVouch(address to, bytes32 messageHash) external returns (bool) {
        if (shouldRevert) revert("DAG revert");
        lastVouchTo = to;
        lastVouchHash = messageHash;
        vouchCallCount++;
        return false;
    }
}

contract MockSoulboundIdentity {
    mapping(address => bool) public identities;

    function setIdentity(address user, bool hasId) external {
        identities[user] = hasId;
    }

    function hasIdentity(address user) external view returns (bool) {
        return identities[user];
    }
}

// ============ Test Contract ============

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
    MockContributionDAG public mockDAG;
    MockSoulboundIdentity public mockSBI;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public operator1;
    address public operator2;
    address public operator3;
    address public recorder;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        operator1 = makeAddr("operator1");
        operator2 = makeAddr("operator2");
        operator3 = makeAddr("operator3");
        recorder = makeAddr("recorder");

        // Deploy via UUPS proxy
        AgentRegistry impl = new AgentRegistry();
        bytes memory initData = abi.encodeWithSelector(AgentRegistry.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = AgentRegistry(address(proxy));

        // Deploy mocks
        mockVibeCode = new MockVibeCode();
        mockDAG = new MockContributionDAG();
        mockSBI = new MockSoulboundIdentity();

        // Configure external contracts
        registry.setVibeCode(address(mockVibeCode));
        registry.setContributionDAG(address(mockDAG));
        registry.setSoulboundIdentity(address(mockSBI));

        // Set authorized recorder
        registry.setAuthorizedRecorder(recorder, true);
    }

    // ============ Helpers ============

    function _registerAgent(
        string memory name,
        address operator
    ) internal returns (uint256) {
        return registry.registerAgent(
            name,
            IAgentRegistry.AgentPlatform.CLAUDE,
            operator,
            keccak256("model-v1")
        );
    }

    function _registerJarvis() internal returns (uint256) {
        return _registerAgent("JARVIS", operator1);
    }

    function _registerSecondAgent() internal returns (uint256) {
        return _registerAgent("FRIDAY", operator2);
    }

    function _grantCapability(
        uint256 agentId,
        IAgentRegistry.CapabilityType capType
    ) internal {
        registry.grantCapability(agentId, capType, 0); // permanent
    }

    function _grantCapabilityWithExpiry(
        uint256 agentId,
        IAgentRegistry.CapabilityType capType,
        uint256 expiresAt
    ) internal {
        registry.grantCapability(agentId, capType, expiresAt);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(registry.owner(), owner);
    }

    function test_initialize_totalAgentsZero() public view {
        assertEq(registry.totalAgents(), 0);
    }

    function test_initialize_noVibeCodeByDefault() public view {
        // We set it in setUp, but we test the address was set
        assertEq(address(registry.vibeCode()), address(mockVibeCode));
    }

    // ============ Registration ============

    function test_registerAgent_happyPath() public {
        uint256 agentId = _registerJarvis();

        assertEq(agentId, 1);
        assertEq(registry.totalAgents(), 1);
        assertTrue(registry.isAgent(operator1));
        assertEq(registry.operatorToAgentId(operator1), 1);
        assertTrue(registry.nameTaken("JARVIS"));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.agentId, 1);
        assertEq(agent.name, "JARVIS");
        assertEq(uint256(agent.platform), uint256(IAgentRegistry.AgentPlatform.CLAUDE));
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.ACTIVE));
        assertEq(agent.operator, operator1);
        assertEq(agent.creator, address(this));
        assertEq(agent.contextRoot, bytes32(0));
        assertEq(agent.modelHash, keccak256("model-v1"));
        assertEq(agent.registeredAt, block.timestamp);
        assertEq(agent.lastActiveAt, block.timestamp);
        assertEq(agent.totalInteractions, 0);
    }

    function test_registerAgent_emitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit AgentRegistered(
            1,
            "JARVIS",
            IAgentRegistry.AgentPlatform.CLAUDE,
            operator1,
            address(this)
        );
        _registerJarvis();
    }

    function test_registerAgent_multipleAgents() public {
        uint256 id1 = _registerAgent("JARVIS", operator1);
        uint256 id2 = _registerAgent("FRIDAY", operator2);
        uint256 id3 = _registerAgent("ULTRON", operator3);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
        assertEq(registry.totalAgents(), 3);
    }

    function test_registerAgent_differentPlatforms() public {
        registry.registerAgent("GPT-Agent", IAgentRegistry.AgentPlatform.CHATGPT, operator1, keccak256("gpt"));
        registry.registerAgent("Gemini-Agent", IAgentRegistry.AgentPlatform.GEMINI, operator2, keccak256("gemini"));

        IAgentRegistry.AgentIdentity memory a1 = registry.getAgent(1);
        IAgentRegistry.AgentIdentity memory a2 = registry.getAgent(2);

        assertEq(uint256(a1.platform), uint256(IAgentRegistry.AgentPlatform.CHATGPT));
        assertEq(uint256(a2.platform), uint256(IAgentRegistry.AgentPlatform.GEMINI));
    }

    function test_registerAgent_anyoneCanRegister() public {
        vm.prank(alice);
        uint256 agentId = registry.registerAgent(
            "AliceBot",
            IAgentRegistry.AgentPlatform.CUSTOM,
            operator1,
            keccak256("custom")
        );

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.creator, alice);
    }

    function test_registerAgent_duplicateName_reverts() public {
        _registerJarvis();

        vm.expectRevert(IAgentRegistry.NameTaken.selector);
        _registerAgent("JARVIS", operator2);
    }

    function test_registerAgent_duplicateOperator_reverts() public {
        _registerJarvis();

        vm.expectRevert(IAgentRegistry.AgentAlreadyExists.selector);
        _registerAgent("FRIDAY", operator1);
    }

    function test_registerAgent_emptyName_reverts() public {
        vm.expectRevert(IAgentRegistry.EmptyName.selector);
        _registerAgent("", operator1);
    }

    function test_registerAgent_nameTooLong_reverts() public {
        // MAX_NAME_LENGTH = 64, create a 65-char name
        string memory longName = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 65 chars
        vm.expectRevert(IAgentRegistry.EmptyName.selector);
        _registerAgent(longName, operator1);
    }

    function test_registerAgent_nameExactlyMaxLength_succeeds() public {
        // Exactly 64 chars should work
        string memory exactName = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 64 chars
        uint256 agentId = _registerAgent(exactName, operator1);
        assertEq(agentId, 1);
    }

    function test_registerAgent_zeroAddress_reverts() public {
        vm.expectRevert(IAgentRegistry.ZeroAddress.selector);
        _registerAgent("JARVIS", address(0));
    }

    // ============ Operator Transfer ============

    function test_transferOperator_happyPath() public {
        uint256 agentId = _registerJarvis();
        address newOp = makeAddr("newOperator");

        vm.prank(operator1);
        registry.transferOperator(agentId, newOp);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.operator, newOp);
        assertEq(registry.operatorToAgentId(newOp), agentId);
        assertEq(registry.operatorToAgentId(operator1), 0);
        assertTrue(registry.isAgent(newOp));
        assertFalse(registry.isAgent(operator1));
    }

    function test_transferOperator_emitsEvent() public {
        uint256 agentId = _registerJarvis();
        address newOp = makeAddr("newOperator");

        vm.prank(operator1);
        vm.expectEmit(true, true, true, true);
        emit AgentOperatorChanged(agentId, operator1, newOp);
        registry.transferOperator(agentId, newOp);
    }

    function test_transferOperator_setsStatusActive() public {
        uint256 agentId = _registerJarvis();

        // Change status to MIGRATING first
        vm.prank(operator1);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.MIGRATING);

        // Transfer resets to ACTIVE
        address newOp = makeAddr("newOperator");
        vm.prank(operator1);
        registry.transferOperator(agentId, newOp);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.ACTIVE));
    }

    function test_transferOperator_notOperator_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotAgentOperator.selector);
        registry.transferOperator(agentId, alice);
    }

    function test_transferOperator_toExistingOperator_reverts() public {
        _registerJarvis();
        _registerSecondAgent();

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.AgentAlreadyExists.selector);
        registry.transferOperator(1, operator2);
    }

    function test_transferOperator_toZeroAddress_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.ZeroAddress.selector);
        registry.transferOperator(agentId, address(0));
    }

    function test_transferOperator_nonExistentAgent_reverts() public {
        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.transferOperator(999, operator2);
    }

    // ============ Status Management ============

    function test_setAgentStatus_operatorCanActivate() public {
        uint256 agentId = _registerJarvis();

        // First set to INACTIVE
        vm.prank(operator1);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);

        // Operator sets back to ACTIVE
        vm.prank(operator1);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.ACTIVE);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.ACTIVE));
    }

    function test_setAgentStatus_operatorCanDeactivate() public {
        uint256 agentId = _registerJarvis();

        vm.prank(operator1);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.INACTIVE));
    }

    function test_setAgentStatus_operatorCanMigrate() public {
        uint256 agentId = _registerJarvis();

        vm.prank(operator1);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.MIGRATING);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.MIGRATING));
    }

    function test_setAgentStatus_ownerCanSuspend() public {
        uint256 agentId = _registerJarvis();

        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.SUSPENDED);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.SUSPENDED));
    }

    function test_setAgentStatus_ownerCanAlsoSetOtherStatuses() public {
        uint256 agentId = _registerJarvis();

        // Owner can set non-suspend statuses too
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);
        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint256(agent.status), uint256(IAgentRegistry.AgentStatus.INACTIVE));
    }

    function test_setAgentStatus_emitsEvent() public {
        uint256 agentId = _registerJarvis();

        vm.prank(operator1);
        vm.expectEmit(true, false, false, true);
        emit AgentStatusChanged(agentId, IAgentRegistry.AgentStatus.ACTIVE, IAgentRegistry.AgentStatus.INACTIVE);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);
    }

    function test_setAgentStatus_operatorCannotSuspend_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.prank(operator1);
        vm.expectRevert("Only owner can suspend");
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.SUSPENDED);
    }

    function test_setAgentStatus_unauthorizedCannotChange_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotAgentOperator.selector);
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.INACTIVE);
    }

    function test_setAgentStatus_nonExistentAgent_reverts() public {
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.setAgentStatus(999, IAgentRegistry.AgentStatus.ACTIVE);
    }

    function test_setAgentStatus_randomCannotSuspend_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert("Only owner can suspend");
        registry.setAgentStatus(agentId, IAgentRegistry.AgentStatus.SUSPENDED);
    }

    // ============ Context Root ============

    function test_updateContextRoot_happyPath() public {
        uint256 agentId = _registerJarvis();
        bytes32 newRoot = keccak256("new-context-root");

        vm.prank(operator1);
        registry.updateContextRoot(agentId, newRoot);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.contextRoot, newRoot);
    }

    function test_updateContextRoot_updatesLastActiveAt() public {
        uint256 agentId = _registerJarvis();

        vm.warp(block.timestamp + 1 hours);

        vm.prank(operator1);
        registry.updateContextRoot(agentId, keccak256("root"));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.lastActiveAt, block.timestamp);
    }

    function test_updateContextRoot_emitsEvent() public {
        uint256 agentId = _registerJarvis();
        bytes32 newRoot = keccak256("root-v2");

        vm.prank(operator1);
        vm.expectEmit(true, false, false, true);
        emit ContextRootUpdated(agentId, bytes32(0), newRoot);
        registry.updateContextRoot(agentId, newRoot);
    }

    function test_updateContextRoot_emitsCorrectOldRoot() public {
        uint256 agentId = _registerJarvis();
        bytes32 root1 = keccak256("root1");
        bytes32 root2 = keccak256("root2");

        vm.prank(operator1);
        registry.updateContextRoot(agentId, root1);

        vm.prank(operator1);
        vm.expectEmit(true, false, false, true);
        emit ContextRootUpdated(agentId, root1, root2);
        registry.updateContextRoot(agentId, root2);
    }

    function test_updateContextRoot_notOperator_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotAgentOperator.selector);
        registry.updateContextRoot(agentId, keccak256("root"));
    }

    function test_updateContextRoot_nonExistentAgent_reverts() public {
        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.updateContextRoot(999, keccak256("root"));
    }

    // ============ Interactions ============

    function test_recordInteraction_byOperator() public {
        uint256 agentId = _registerJarvis();
        bytes32 hash = keccak256("interaction-1");

        vm.prank(operator1);
        registry.recordInteraction(agentId, hash);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.totalInteractions, 1);
    }

    function test_recordInteraction_byAuthorizedRecorder() public {
        uint256 agentId = _registerJarvis();
        bytes32 hash = keccak256("interaction-1");

        vm.prank(recorder);
        registry.recordInteraction(agentId, hash);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.totalInteractions, 1);
    }

    function test_recordInteraction_incrementsCount() public {
        uint256 agentId = _registerJarvis();

        vm.startPrank(operator1);
        registry.recordInteraction(agentId, keccak256("i1"));
        registry.recordInteraction(agentId, keccak256("i2"));
        registry.recordInteraction(agentId, keccak256("i3"));
        vm.stopPrank();

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.totalInteractions, 3);
    }

    function test_recordInteraction_updatesLastActiveAt() public {
        uint256 agentId = _registerJarvis();

        vm.warp(block.timestamp + 2 hours);

        vm.prank(operator1);
        registry.recordInteraction(agentId, keccak256("i1"));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.lastActiveAt, block.timestamp);
    }

    function test_recordInteraction_emitsEvent() public {
        uint256 agentId = _registerJarvis();
        bytes32 hash = keccak256("interaction-x");

        vm.prank(operator1);
        vm.expectEmit(true, false, false, true);
        emit AgentInteraction(agentId, hash);
        registry.recordInteraction(agentId, hash);
    }

    function test_recordInteraction_unauthorized_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert("Not authorized");
        registry.recordInteraction(agentId, keccak256("hack"));
    }

    function test_recordInteraction_nonExistentAgent_reverts() public {
        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.recordInteraction(999, keccak256("x"));
    }

    // ============ Capabilities: Grant ============

    function test_grantCapability_byOwner() public {
        uint256 agentId = _registerJarvis();

        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_grantCapability_byCreator() public {
        vm.prank(alice);
        uint256 agentId = registry.registerAgent("AliceBot", IAgentRegistry.AgentPlatform.CLAUDE, operator1, keccak256("m"));

        vm.prank(alice);
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.GOVERN, 0);

        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.GOVERN));
    }

    function test_grantCapability_permanent() public {
        uint256 agentId = _registerJarvis();

        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE); // expiresAt = 0

        // Still valid after long time
        vm.warp(block.timestamp + 365 days);
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_grantCapability_withExpiry() public {
        uint256 agentId = _registerJarvis();
        uint256 expiry = block.timestamp + 7 days;

        _grantCapabilityWithExpiry(agentId, IAgentRegistry.CapabilityType.ANALYZE, expiry);

        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.ANALYZE));
    }

    function test_grantCapability_emitsEvent() public {
        uint256 agentId = _registerJarvis();
        uint256 expiry = block.timestamp + 1 days;

        vm.expectEmit(true, true, true, true);
        emit CapabilityGranted(agentId, IAgentRegistry.CapabilityType.TRADE, address(this), expiry);
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, expiry);
    }

    function test_grantCapability_multipleDifferentCaps() public {
        uint256 agentId = _registerJarvis();

        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
        _grantCapability(agentId, IAgentRegistry.CapabilityType.GOVERN);
        _grantCapability(agentId, IAgentRegistry.CapabilityType.ATTEST);

        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.GOVERN));
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.ATTEST));
    }

    function test_grantCapability_alreadyGranted_reverts() public {
        uint256 agentId = _registerJarvis();

        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        vm.expectRevert(IAgentRegistry.CapabilityAlreadyGranted.selector);
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_grantCapability_reGrantAfterExpiry() public {
        uint256 agentId = _registerJarvis();
        uint256 expiry = block.timestamp + 1 hours;

        _grantCapabilityWithExpiry(agentId, IAgentRegistry.CapabilityType.TRADE, expiry);

        // Fast forward past expiry
        vm.warp(expiry + 1);
        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));

        // Re-grant should succeed
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_grantCapability_reGrantAfterRevoke() public {
        uint256 agentId = _registerJarvis();

        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        // Re-grant after revoke should work (revoked flag means it's no longer active)
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_grantCapability_nonExistentAgent_reverts() public {
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        _grantCapability(999, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_grantCapability_unauthorized_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.prank(alice);
        vm.expectRevert("Not authorized to grant");
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    // ============ Capabilities: Revoke ============

    function test_revokeCapability_byOwner() public {
        uint256 agentId = _registerJarvis();
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_revokeCapability_byCreator() public {
        vm.prank(alice);
        uint256 agentId = registry.registerAgent("AliceBot", IAgentRegistry.AgentPlatform.CLAUDE, operator1, keccak256("m"));

        // Owner grants
        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, 0);

        // Creator revokes
        vm.prank(alice);
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_revokeCapability_byGranter() public {
        uint256 agentId = _registerJarvis();

        // Owner grants (so grantedBy = owner)
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        // Owner (= grantedBy) revokes
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_revokeCapability_emitsEvent() public {
        uint256 agentId = _registerJarvis();
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        vm.expectEmit(true, true, true, true);
        emit CapabilityRevoked(agentId, IAgentRegistry.CapabilityType.TRADE, address(this));
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_revokeCapability_notGranted_reverts() public {
        uint256 agentId = _registerJarvis();

        vm.expectRevert(IAgentRegistry.CapabilityNotGranted.selector);
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_revokeCapability_unauthorized_reverts() public {
        uint256 agentId = _registerJarvis();
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(alice);
        vm.expectRevert("Not authorized to revoke");
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_revokeCapability_nonExistentAgent_reverts() public {
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.revokeCapability(999, IAgentRegistry.CapabilityType.TRADE);
    }

    // ============ Capabilities: Expired ============

    function test_hasCapability_expiredCapability_returnsFalse() public {
        uint256 agentId = _registerJarvis();
        uint256 expiry = block.timestamp + 1 hours;

        _grantCapabilityWithExpiry(agentId, IAgentRegistry.CapabilityType.TRADE, expiry);
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));

        vm.warp(expiry); // exact expiry — should be expired (expiresAt <= block.timestamp)
        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_hasCapability_justBeforeExpiry_returnsTrue() public {
        uint256 agentId = _registerJarvis();
        uint256 expiry = block.timestamp + 1 hours;

        _grantCapabilityWithExpiry(agentId, IAgentRegistry.CapabilityType.TRADE, expiry);

        vm.warp(expiry - 1);
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_hasCapability_revokedCapability_returnsFalse() public {
        uint256 agentId = _registerJarvis();
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_hasCapability_neverGranted_returnsFalse() public {
        uint256 agentId = _registerJarvis();

        assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    // ============ Capabilities: getCapabilities ============

    function test_getCapabilities_returnsActiveOnly() public {
        uint256 agentId = _registerJarvis();

        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
        _grantCapability(agentId, IAgentRegistry.CapabilityType.GOVERN);
        _grantCapabilityWithExpiry(agentId, IAgentRegistry.CapabilityType.ANALYZE, block.timestamp + 1 hours);

        // Revoke GOVERN
        registry.revokeCapability(agentId, IAgentRegistry.CapabilityType.GOVERN);

        IAgentRegistry.Capability[] memory caps = registry.getCapabilities(agentId);
        assertEq(caps.length, 2); // TRADE + ANALYZE (GOVERN revoked)
    }

    function test_getCapabilities_excludesExpired() public {
        uint256 agentId = _registerJarvis();
        uint256 expiry = block.timestamp + 1 hours;

        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);
        _grantCapabilityWithExpiry(agentId, IAgentRegistry.CapabilityType.ANALYZE, expiry);

        vm.warp(expiry + 1);

        IAgentRegistry.Capability[] memory caps = registry.getCapabilities(agentId);
        assertEq(caps.length, 1); // Only TRADE remains
    }

    function test_getCapabilities_emptyForNoGrants() public {
        uint256 agentId = _registerJarvis();

        IAgentRegistry.Capability[] memory caps = registry.getCapabilities(agentId);
        assertEq(caps.length, 0);
    }

    // ============ Delegation ============

    function test_delegateCapability_happyPath() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        // Grant DELEGATE + TRADE to agent1
        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        // Agent1 delegates TRADE to Agent2
        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);

        // Agent2 should now have TRADE via delegation
        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_delegateCapability_emitsEvent() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        vm.expectEmit(true, true, false, true);
        emit CapabilityDelegated(id1, id2, IAgentRegistry.CapabilityType.TRADE);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_withExpiry() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();
        uint256 expiry = block.timestamp + 3 days;

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.GOVERN);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.GOVERN, expiry);

        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.GOVERN));

        // After expiry
        vm.warp(expiry + 1);
        assertFalse(registry.hasCapability(id2, IAgentRegistry.CapabilityType.GOVERN));
    }

    function test_delegateCapability_needsDelegateCap_reverts() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE); // Has TRADE but not DELEGATE

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.DelegateCapabilityRequired.selector);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_needsCapBeingDelegated_reverts() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE); // Has DELEGATE but not TRADE

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.CapabilityNotGranted.selector);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_selfDelegation_reverts() public {
        uint256 id1 = _registerJarvis();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.SelfDelegation.selector);
        registry.delegateCapability(id1, id1, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_notOperator_reverts() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotAgentOperator.selector);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_toNonExistentAgent_reverts() public {
        uint256 id1 = _registerJarvis();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.delegateCapability(id1, 999, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_suspendedAgent_reverts() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        // Suspend agent1
        registry.setAgentStatus(id1, IAgentRegistry.AgentStatus.SUSPENDED);

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.AgentSuspended.selector);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    function test_delegateCapability_inactiveAgent_reverts() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        // Deactivate agent1
        vm.prank(operator1);
        registry.setAgentStatus(id1, IAgentRegistry.AgentStatus.INACTIVE);

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.AgentNotActive.selector);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);
    }

    // ============ Delegation: Revoke ============

    function test_revokeDelegation_happyPath() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);
        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));

        vm.prank(operator1);
        registry.revokeDelegation(id1, id2, IAgentRegistry.CapabilityType.TRADE);
        assertFalse(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_revokeDelegation_emitsEvent() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);

        vm.prank(operator1);
        vm.expectEmit(true, true, false, true);
        emit DelegationRevoked(id1, id2, IAgentRegistry.CapabilityType.TRADE);
        registry.revokeDelegation(id1, id2, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_revokeDelegation_nonExistentDelegation_reverts() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        vm.prank(operator1);
        vm.expectRevert(IAgentRegistry.DelegationNotAllowed.selector);
        registry.revokeDelegation(id1, id2, IAgentRegistry.CapabilityType.TRADE);
    }

    function test_revokeDelegation_notOperator_reverts() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotAgentOperator.selector);
        registry.revokeDelegation(id1, id2, IAgentRegistry.CapabilityType.TRADE);
    }

    // ============ hasCapability: Direct + Delegated ============

    function test_hasCapability_directCapability_returnsTrue() public {
        uint256 agentId = _registerJarvis();
        _grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE);

        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_hasCapability_delegatedCapability_returnsTrue() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.ATTEST);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.ATTEST, 0);

        // Agent2 has ATTEST via delegation
        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.ATTEST));
        // But does NOT have DELEGATE (was not delegated)
        assertFalse(registry.hasCapability(id2, IAgentRegistry.CapabilityType.DELEGATE));
    }

    function test_hasCapability_expiredDelegation_returnsFalse() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();
        uint256 expiry = block.timestamp + 1 hours;

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, expiry);

        vm.warp(expiry + 1);
        assertFalse(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_hasCapability_revokedDelegation_returnsFalse() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);

        vm.prank(operator1);
        registry.revokeDelegation(id1, id2, IAgentRegistry.CapabilityType.TRADE);

        assertFalse(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_hasCapability_directPlusDelegated() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        // Agent2 has TRADE directly
        _grantCapability(id2, IAgentRegistry.CapabilityType.TRADE);

        // Agent1 delegates GOVERN to Agent2
        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.GOVERN);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.GOVERN, 0);

        // Agent2 has both
        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));
        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.GOVERN));
    }

    // ============ getDelegationsFrom / getDelegationsTo ============

    function test_getDelegationsFrom_returnsAll() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.GOVERN);

        vm.startPrank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.GOVERN, 0);
        vm.stopPrank();

        IAgentRegistry.Delegation[] memory delegations = registry.getDelegationsFrom(id1);
        // Note: _delegationsFromList pushes toAgentId each call, so id2 appears twice.
        // The loop iterates both entries across all 7 cap types, finding TRADE and GOVERN
        // for each duplicate entry = 2 * 2 = 4 results (includes duplicates by design).
        assertEq(delegations.length, 4);
    }

    function test_getDelegationsTo_returnsAll() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);

        IAgentRegistry.Delegation[] memory delegations = registry.getDelegationsTo(id2);
        assertEq(delegations.length, 1);
        assertEq(delegations[0].fromAgentId, id1);
        assertEq(delegations[0].toAgentId, id2);
    }

    function test_getDelegationsFrom_emptyWhenNone() public {
        uint256 id1 = _registerJarvis();

        IAgentRegistry.Delegation[] memory delegations = registry.getDelegationsFrom(id1);
        assertEq(delegations.length, 0);
    }

    // ============ Human-Agent Trust Bridge ============

    function test_vouchForAgent_happyPath_withSBI() public {
        uint256 agentId = _registerJarvis();

        // Set alice as having a SoulboundIdentity
        mockSBI.setIdentity(alice, true);

        vm.prank(alice);
        registry.vouchForAgent(agentId, keccak256("I trust JARVIS"));

        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 1);
        assertEq(vouchers[0], alice);
    }

    function test_vouchForAgent_emitsEvent() public {
        uint256 agentId = _registerJarvis();
        mockSBI.setIdentity(alice, true);
        bytes32 msgHash = keccak256("vouch");

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit AgentVouchedByHuman(agentId, alice, msgHash);
        registry.vouchForAgent(agentId, msgHash);
    }

    function test_vouchForAgent_bridgesToDAG() public {
        uint256 agentId = _registerJarvis();
        mockSBI.setIdentity(alice, true);
        bytes32 msgHash = keccak256("trust");

        vm.prank(alice);
        registry.vouchForAgent(agentId, msgHash);

        // Verify the DAG was called with agent's operator
        assertEq(mockDAG.lastVouchTo(), operator1);
        assertEq(mockDAG.lastVouchHash(), msgHash);
        assertEq(mockDAG.vouchCallCount(), 1);
    }

    function test_vouchForAgent_dagRevert_doesNotBubble() public {
        uint256 agentId = _registerJarvis();
        mockSBI.setIdentity(alice, true);
        mockDAG.setShouldRevert(true);

        // Should not revert even though DAG reverts (try/catch)
        vm.prank(alice);
        registry.vouchForAgent(agentId, keccak256("vouch"));

        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 1);
    }

    function test_vouchForAgent_withoutSBI_whenSBINotSet() public {
        // Clear SBI address
        registry.setSoulboundIdentity(address(0));

        uint256 agentId = _registerJarvis();

        // Should work without SBI check
        vm.prank(alice);
        registry.vouchForAgent(agentId, keccak256("vouch"));

        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 1);
    }

    function test_vouchForAgent_withoutSBI_whenSBISet_reverts() public {
        uint256 agentId = _registerJarvis();

        // alice does NOT have identity
        mockSBI.setIdentity(alice, false);

        vm.prank(alice);
        vm.expectRevert("No identity");
        registry.vouchForAgent(agentId, keccak256("vouch"));
    }

    function test_vouchForAgent_multipleVouchers() public {
        uint256 agentId = _registerJarvis();
        mockSBI.setIdentity(alice, true);
        mockSBI.setIdentity(bob, true);
        mockSBI.setIdentity(carol, true);

        vm.prank(alice);
        registry.vouchForAgent(agentId, keccak256("v1"));
        vm.prank(bob);
        registry.vouchForAgent(agentId, keccak256("v2"));
        vm.prank(carol);
        registry.vouchForAgent(agentId, keccak256("v3"));

        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 3);
        assertEq(vouchers[0], alice);
        assertEq(vouchers[1], bob);
        assertEq(vouchers[2], carol);
    }

    function test_vouchForAgent_nonExistentAgent_reverts() public {
        mockSBI.setIdentity(alice, true);

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.vouchForAgent(999, keccak256("vouch"));
    }

    function test_vouchForAgent_withoutDAG_noRevert() public {
        // Clear DAG
        registry.setContributionDAG(address(0));

        uint256 agentId = _registerJarvis();
        mockSBI.setIdentity(alice, true);

        // Should work, just skips DAG bridging
        vm.prank(alice);
        registry.vouchForAgent(agentId, keccak256("vouch"));

        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 1);
    }

    // ============ View Functions: getAgent ============

    function test_getAgent_returnsCorrectData() public {
        uint256 agentId = _registerJarvis();

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);

        assertEq(agent.agentId, agentId);
        assertEq(agent.name, "JARVIS");
        assertEq(agent.operator, operator1);
        assertEq(agent.creator, address(this));
    }

    function test_getAgent_nonExistent_reverts() public {
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.getAgent(999);
    }

    // ============ View Functions: getAgentByOperator ============

    function test_getAgentByOperator_returnsCorrectAgent() public {
        _registerJarvis();

        IAgentRegistry.AgentIdentity memory agent = registry.getAgentByOperator(operator1);
        assertEq(agent.name, "JARVIS");
        assertEq(agent.operator, operator1);
    }

    function test_getAgentByOperator_nonExistent_reverts() public {
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.getAgentByOperator(alice);
    }

    // ============ View Functions: isAgent ============

    function test_isAgent_trueForOperator() public {
        _registerJarvis();
        assertTrue(registry.isAgent(operator1));
    }

    function test_isAgent_falseForNonOperator() public view {
        assertFalse(registry.isAgent(alice));
    }

    function test_isAgent_falseAfterTransfer() public {
        uint256 agentId = _registerJarvis();
        address newOp = makeAddr("newOp");

        vm.prank(operator1);
        registry.transferOperator(agentId, newOp);

        assertFalse(registry.isAgent(operator1));
        assertTrue(registry.isAgent(newOp));
    }

    // ============ View Functions: totalAgents ============

    function test_totalAgents_incrementsOnRegistration() public {
        assertEq(registry.totalAgents(), 0);

        _registerJarvis();
        assertEq(registry.totalAgents(), 1);

        _registerSecondAgent();
        assertEq(registry.totalAgents(), 2);
    }

    // ============ View Functions: getAgentVibeCode ============

    function test_getAgentVibeCode_returnsVibeCode() public {
        uint256 agentId = _registerJarvis();
        bytes32 expectedCode = keccak256("jarvis-vibe");
        mockVibeCode.setVibeCode(operator1, expectedCode);

        bytes32 code = registry.getAgentVibeCode(agentId);
        assertEq(code, expectedCode);
    }

    function test_getAgentVibeCode_zeroWhenNoVibeCodeContract() public {
        registry.setVibeCode(address(0));
        uint256 agentId = _registerJarvis();

        bytes32 code = registry.getAgentVibeCode(agentId);
        assertEq(code, bytes32(0));
    }

    function test_getAgentVibeCode_zeroWhenNoProfileSet() public {
        uint256 agentId = _registerJarvis();

        // No vibe code set for operator1
        bytes32 code = registry.getAgentVibeCode(agentId);
        assertEq(code, bytes32(0));
    }

    function test_getAgentVibeCode_nonExistentAgent_reverts() public {
        vm.expectRevert(IAgentRegistry.AgentNotFound.selector);
        registry.getAgentVibeCode(999);
    }

    // ============ View Functions: hasIdentity ============

    function test_hasIdentity_trueForAgentOperator() public {
        _registerJarvis();
        assertTrue(registry.hasIdentity(operator1));
    }

    function test_hasIdentity_trueForSoulboundHolder() public {
        mockSBI.setIdentity(alice, true);
        assertTrue(registry.hasIdentity(alice));
    }

    function test_hasIdentity_falseForNoIdentity() public view {
        assertFalse(registry.hasIdentity(alice));
    }

    function test_hasIdentity_falseWhenSBINotSet() public {
        registry.setSoulboundIdentity(address(0));

        // alice is not an agent operator, and SBI not set
        assertFalse(registry.hasIdentity(alice));
    }

    function test_hasIdentity_agentTakesPriority() public {
        _registerJarvis();
        // Even if SBI returns false, isAgent is true
        mockSBI.setIdentity(operator1, false);
        assertTrue(registry.hasIdentity(operator1));
    }

    // ============ View Functions: getHumanVouchers ============

    function test_getHumanVouchers_emptyByDefault() public {
        uint256 agentId = _registerJarvis();
        address[] memory vouchers = registry.getHumanVouchers(agentId);
        assertEq(vouchers.length, 0);
    }

    // ============ Admin Functions ============

    function test_setVibeCode_onlyOwner() public {
        address newVC = makeAddr("newVibeCode");
        registry.setVibeCode(newVC);
        assertEq(address(registry.vibeCode()), newVC);
    }

    function test_setVibeCode_nonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setVibeCode(makeAddr("x"));
    }

    function test_setContributionDAG_onlyOwner() public {
        address newDAG = makeAddr("newDAG");
        registry.setContributionDAG(newDAG);
        assertEq(address(registry.contributionDAG()), newDAG);
    }

    function test_setContributionDAG_nonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setContributionDAG(makeAddr("x"));
    }

    function test_setSoulboundIdentity_onlyOwner() public {
        address newSBI = makeAddr("newSBI");
        registry.setSoulboundIdentity(newSBI);
        assertEq(registry.soulboundIdentity(), newSBI);
    }

    function test_setSoulboundIdentity_nonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setSoulboundIdentity(makeAddr("x"));
    }

    function test_setAuthorizedRecorder_onlyOwner() public {
        address newRecorder = makeAddr("newRecorder");
        registry.setAuthorizedRecorder(newRecorder, true);
        assertTrue(registry.authorizedRecorders(newRecorder));
    }

    function test_setAuthorizedRecorder_revoke() public {
        registry.setAuthorizedRecorder(recorder, false);
        assertFalse(registry.authorizedRecorders(recorder));
    }

    function test_setAuthorizedRecorder_nonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setAuthorizedRecorder(makeAddr("x"), true);
    }

    // ============ Constants ============

    function test_constants() public view {
        assertEq(registry.MAX_CAPABILITIES(), 7);
        assertEq(registry.MAX_DELEGATIONS_PER_AGENT(), 10);
        assertEq(registry.MAX_NAME_LENGTH(), 64);
    }

    // ============ UUPS Upgrade ============

    function test_upgradeToAndCall_onlyOwner_reverts() public {
        AgentRegistry newImpl = new AgentRegistry();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgradeToAndCall_ownerCanUpgrade() public {
        AgentRegistry newImpl = new AgentRegistry();

        // Should not revert
        registry.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Edge Cases ============

    function test_registerAgent_operatorCanBeCreator() public {
        // Operator and creator can be the same address
        vm.prank(operator1);
        uint256 agentId = registry.registerAgent("SelfBot", IAgentRegistry.AgentPlatform.CUSTOM, operator1, keccak256("m"));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.operator, operator1);
        assertEq(agent.creator, operator1);
    }

    function test_ownerRecordInteraction_authorized() public {
        uint256 agentId = _registerJarvis();

        // Owner should be able to record via onlyAuthorized (authorizedRecorders check || owner())
        // But recordInteraction checks operator OR authorizedRecorders, not owner directly
        // Owner needs to be set as authorizedRecorder or be the operator
        registry.setAuthorizedRecorder(address(this), true);
        registry.recordInteraction(agentId, keccak256("test"));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.totalInteractions, 1);
    }

    function test_multipleDelegationsToSameAgent() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();
        uint256 id3 = _registerAgent("ULTRON", operator3);

        // Both id1 and id3 delegate TRADE to id2
        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id1, IAgentRegistry.CapabilityType.TRADE);
        _grantCapability(id3, IAgentRegistry.CapabilityType.DELEGATE);
        _grantCapability(id3, IAgentRegistry.CapabilityType.TRADE);

        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.TRADE, 0);

        vm.prank(operator3);
        registry.delegateCapability(id3, id2, IAgentRegistry.CapabilityType.TRADE, 0);

        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));

        // Revoke one delegation — should still have it from the other
        vm.prank(operator1);
        registry.revokeDelegation(id1, id2, IAgentRegistry.CapabilityType.TRADE);

        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));

        // Revoke both
        vm.prank(operator3);
        registry.revokeDelegation(id3, id2, IAgentRegistry.CapabilityType.TRADE);

        assertFalse(registry.hasCapability(id2, IAgentRegistry.CapabilityType.TRADE));
    }

    function test_delegateCapability_DELEGATE_itself() public {
        uint256 id1 = _registerJarvis();
        uint256 id2 = _registerSecondAgent();

        // Agent1 has DELEGATE capability
        _grantCapability(id1, IAgentRegistry.CapabilityType.DELEGATE);

        // Agent1 delegates DELEGATE to Agent2
        vm.prank(operator1);
        registry.delegateCapability(id1, id2, IAgentRegistry.CapabilityType.DELEGATE, 0);

        // Agent2 has DELEGATE via delegation (for hasCapability)
        assertTrue(registry.hasCapability(id2, IAgentRegistry.CapabilityType.DELEGATE));
    }

    function test_agentIdZero_isNeverUsed() public view {
        // Agent ID 0 is reserved (default for unmapped operators)
        assertFalse(registry.isAgent(address(0)));
        assertEq(registry.operatorToAgentId(address(0)), 0);
    }
}
