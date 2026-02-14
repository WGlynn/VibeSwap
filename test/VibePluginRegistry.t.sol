// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/governance/VibePluginRegistry.sol";
import "../contracts/governance/interfaces/IVibePluginRegistry.sol";
import "../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockPRToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockPROracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockPlugin {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
}

// ============ Unit Tests ============

contract VibePluginRegistryTest is Test {
    VibePluginRegistry public registry;
    MockPRToken public jul;
    MockPROracle public oracle;
    MockPlugin public plugin1;
    MockPlugin public plugin2;
    MockPlugin public plugin3;

    address public owner;
    address public reviewer;
    address public author;
    address public consumer;
    address public alice;

    uint32 constant DEFAULT_GRACE = 2 days;

    function setUp() public {
        owner = address(this);
        reviewer = makeAddr("reviewer");
        author = makeAddr("author");
        consumer = makeAddr("consumer");
        alice = makeAddr("alice");

        jul = new MockPRToken("JUL", "JUL");
        oracle = new MockPROracle();
        plugin1 = new MockPlugin();
        plugin2 = new MockPlugin();
        plugin3 = new MockPlugin();

        registry = new VibePluginRegistry(address(jul), address(oracle), DEFAULT_GRACE);

        // Setup reviewer
        registry.setReviewer(reviewer, true);

        // Fund reward pool
        jul.mint(address(this), 100_000 ether);
        jul.approve(address(registry), type(uint256).max);
        registry.depositJulRewards(50_000 ether);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsState() public view {
        assertEq(address(registry.julToken()), address(jul));
        assertEq(address(registry.reputationOracle()), address(oracle));
        assertEq(registry.defaultGracePeriod(), DEFAULT_GRACE);
        assertEq(registry.totalPlugins(), 0);
    }

    function test_constructor_revertsZeroToken() public {
        vm.expectRevert(IVibePluginRegistry.ZeroAddress.selector);
        new VibePluginRegistry(address(0), address(oracle), DEFAULT_GRACE);
    }

    function test_constructor_revertsZeroOracle() public {
        vm.expectRevert(IVibePluginRegistry.ZeroAddress.selector);
        new VibePluginRegistry(address(jul), address(0), DEFAULT_GRACE);
    }

    function test_constructor_clampsGracePeriodMin() public {
        VibePluginRegistry r = new VibePluginRegistry(address(jul), address(oracle), 1 hours);
        assertEq(r.defaultGracePeriod(), 6 hours); // MIN_GRACE_PERIOD
    }

    function test_constructor_clampsGracePeriodMax() public {
        VibePluginRegistry r = new VibePluginRegistry(address(jul), address(oracle), 60 days);
        assertEq(r.defaultGracePeriod(), 30 days); // MAX_GRACE_PERIOD
    }

    // ============ Propose Tests ============

    function test_proposePlugin() public {
        vm.prank(author);
        uint256 id = registry.proposePlugin(
            address(plugin1),
            IVibePluginRegistry.PluginCategory.CURVE,
            bytes32("metadata1")
        );

        assertEq(id, 0);
        assertEq(registry.totalPlugins(), 1);

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(p.implementation, address(plugin1));
        assertEq(uint8(p.category), uint8(IVibePluginRegistry.PluginCategory.CURVE));
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.PROPOSED));
        assertEq(p.author, author);
        assertEq(p.version, 1);
        assertEq(p.metadataHash, bytes32("metadata1"));
        assertEq(p.integrations, 0);
    }

    function test_proposePlugin_setsCorrectId() public {
        vm.prank(author);
        uint256 id = registry.proposePlugin(
            address(plugin1),
            IVibePluginRegistry.PluginCategory.CURVE,
            bytes32("metadata1")
        );
        assertEq(id, 0);

        vm.prank(author);
        uint256 id2 = registry.proposePlugin(
            address(plugin2),
            IVibePluginRegistry.PluginCategory.ORACLE,
            bytes32("metadata2")
        );
        assertEq(id2, 1);
    }

    function test_proposePlugin_revertsZeroAddress() public {
        vm.prank(author);
        vm.expectRevert(IVibePluginRegistry.ZeroAddress.selector);
        registry.proposePlugin(
            address(0),
            IVibePluginRegistry.PluginCategory.CURVE,
            bytes32("metadata1")
        );
    }

    function test_proposePlugin_revertsDuplicate() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(alice);
        vm.expectRevert(IVibePluginRegistry.DuplicateImplementation.selector);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.ORACLE, bytes32(0));
    }

    function test_proposePlugin_multiplePlugins() public {
        vm.startPrank(author);
        uint256 id1 = registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));
        uint256 id2 = registry.proposePlugin(address(plugin2), IVibePluginRegistry.PluginCategory.ORACLE, bytes32(0));
        uint256 id3 = registry.proposePlugin(address(plugin3), IVibePluginRegistry.PluginCategory.HOOK, bytes32(0));
        vm.stopPrank();

        assertEq(id1, 0);
        assertEq(id2, 1);
        assertEq(id3, 2);
        assertEq(registry.totalPlugins(), 3);
    }

    // ============ Metadata Tests ============

    function test_updateMetadata() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32("old"));

        vm.prank(author);
        registry.updateMetadata(0, bytes32("new"));

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(p.metadataHash, bytes32("new"));
    }

    function test_updateMetadata_revertsNotAuthor() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32("old"));

        vm.prank(alice);
        vm.expectRevert(IVibePluginRegistry.NotPluginAuthor.selector);
        registry.updateMetadata(0, bytes32("new"));
    }

    function test_updateMetadata_revertsWhenActive() public {
        _proposeApproveActivate(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE);

        vm.prank(author);
        vm.expectRevert(IVibePluginRegistry.InvalidState.selector);
        registry.updateMetadata(0, bytes32("new"));
    }

    // ============ Approve Tests ============

    function test_approvePlugin() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.approvePlugin(0);

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.APPROVED));
        assertGt(p.approvedAt, 0);
    }

    function test_approvePlugin_revertsNotReviewer() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(alice);
        vm.expectRevert(IVibePluginRegistry.NotReviewer.selector);
        registry.approvePlugin(0);
    }

    function test_approvePlugin_revertsWrongState() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.approvePlugin(0);

        // Can't approve already-approved
        vm.prank(reviewer);
        vm.expectRevert(IVibePluginRegistry.InvalidState.selector);
        registry.approvePlugin(0);
    }

    function test_approvePlugin_revertsNotFound() public {
        vm.prank(reviewer);
        vm.expectRevert(IVibePluginRegistry.PluginNotFound.selector);
        registry.approvePlugin(999);
    }

    // ============ Activate Tests ============

    function test_activatePlugin() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.approvePlugin(0);

        vm.warp(block.timestamp + DEFAULT_GRACE + 1);

        registry.activatePlugin(0);

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.ACTIVE));
        assertGt(p.activatedAt, 0);
        assertTrue(registry.isActive(0));
        assertTrue(registry.isActiveImplementation(address(plugin1)));
    }

    function test_activatePlugin_revertsBeforeGrace() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.approvePlugin(0);

        // Don't warp enough
        vm.warp(block.timestamp + DEFAULT_GRACE - 1);

        vm.expectRevert(IVibePluginRegistry.GracePeriodNotElapsed.selector);
        registry.activatePlugin(0);
    }

    function test_activatePlugin_revertsWrongState() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        // Try to activate without approval
        vm.expectRevert(IVibePluginRegistry.InvalidState.selector);
        registry.activatePlugin(0);
    }

    function test_activatePlugin_paysAuthorTip() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.approvePlugin(0);
        vm.warp(block.timestamp + DEFAULT_GRACE + 1);

        uint256 authorBefore = jul.balanceOf(author);
        uint256 poolBefore = registry.julRewardPool();

        registry.activatePlugin(0);

        assertEq(jul.balanceOf(author), authorBefore + 10 ether);
        assertEq(registry.julRewardPool(), poolBefore - 10 ether);
    }

    function test_activatePlugin_anyoneCan() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.approvePlugin(0);
        vm.warp(block.timestamp + DEFAULT_GRACE + 1);

        // Random address can activate
        vm.prank(alice);
        registry.activatePlugin(0);

        assertTrue(registry.isActive(0));
    }

    // ============ Deprecate Tests ============

    function test_deprecatePlugin() public {
        _proposeApproveActivate(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE);

        vm.prank(reviewer);
        registry.deprecatePlugin(0, "sunset curve v1");

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.DEPRECATED));
        assertGt(p.deprecatedAt, 0);
        assertFalse(registry.isActive(0));
    }

    function test_deprecatePlugin_revertsNotActive() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        vm.expectRevert(IVibePluginRegistry.InvalidState.selector);
        registry.deprecatePlugin(0, "nope");
    }

    // ============ Deactivate Tests ============

    function test_deactivatePlugin_fromActive() public {
        _proposeApproveActivate(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE);

        vm.prank(reviewer);
        registry.deactivatePlugin(0, "security issue");

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.DEACTIVATED));
        assertFalse(registry.isActive(0));
    }

    function test_deactivatePlugin_fromProposed() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.deactivatePlugin(0, "rejected");

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.DEACTIVATED));
    }

    function test_deactivatePlugin_fromApproved() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.approvePlugin(0);

        vm.prank(reviewer);
        registry.deactivatePlugin(0, "rug detected");

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.DEACTIVATED));
    }

    function test_deactivatePlugin_fromDeprecated() public {
        _proposeApproveActivate(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE);

        vm.prank(reviewer);
        registry.deprecatePlugin(0, "sunset");

        vm.prank(reviewer);
        registry.deactivatePlugin(0, "full kill");

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.DEACTIVATED));
    }

    function test_deactivatePlugin_revertsAlreadyDeactivated() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.deactivatePlugin(0, "kill");

        vm.prank(reviewer);
        vm.expectRevert(IVibePluginRegistry.InvalidState.selector);
        registry.deactivatePlugin(0, "kill again");
    }

    // ============ Audit Score Tests ============

    function test_setAuditScore() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.setAuditScore(0, 9500);

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(p.auditScore, 9500);
    }

    function test_setAuditScore_revertsInvalidScore() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        vm.expectRevert(IVibePluginRegistry.InvalidAuditScore.selector);
        registry.setAuditScore(0, 10001);
    }

    // ============ Integration Tests ============

    function test_addIntegration() public {
        _proposeApproveActivate(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE);

        vm.prank(consumer);
        registry.addIntegration(0);

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(p.integrations, 1);
    }

    function test_addIntegration_revertsNotActive() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(consumer);
        vm.expectRevert(IVibePluginRegistry.PluginNotActive.selector);
        registry.addIntegration(0);
    }

    function test_addIntegration_revertsDuplicate() public {
        _proposeApproveActivate(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE);

        vm.prank(consumer);
        registry.addIntegration(0);

        vm.prank(consumer);
        vm.expectRevert(IVibePluginRegistry.AlreadyIntegrated.selector);
        registry.addIntegration(0);
    }

    function test_removeIntegration() public {
        _proposeApproveActivate(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE);

        vm.prank(consumer);
        registry.addIntegration(0);

        vm.prank(consumer);
        registry.removeIntegration(0);

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(p.integrations, 0);
    }

    function test_removeIntegration_revertsNotIntegrated() public {
        _proposeApproveActivate(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE);

        vm.prank(consumer);
        vm.expectRevert(IVibePluginRegistry.NotIntegrated.selector);
        registry.removeIntegration(0);
    }

    // ============ Admin Tests ============

    function test_setReviewer() public {
        registry.setReviewer(alice, true);
        assertTrue(registry.isReviewer(alice));

        registry.setReviewer(alice, false);
        assertFalse(registry.isReviewer(alice));
    }

    function test_setReviewer_revertsNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.setReviewer(alice, true);
    }

    function test_setReviewer_revertsZeroAddress() public {
        vm.expectRevert(IVibePluginRegistry.ZeroAddress.selector);
        registry.setReviewer(address(0), true);
    }

    function test_setDefaultGracePeriod() public {
        registry.setDefaultGracePeriod(3 days);
        assertEq(registry.defaultGracePeriod(), 3 days);
    }

    function test_setDefaultGracePeriod_clampsMin() public {
        registry.setDefaultGracePeriod(1 hours);
        assertEq(registry.defaultGracePeriod(), 6 hours);
    }

    function test_setDefaultGracePeriod_clampsMax() public {
        registry.setDefaultGracePeriod(60 days);
        assertEq(registry.defaultGracePeriod(), 30 days);
    }

    function test_depositJulRewards() public {
        uint256 poolBefore = registry.julRewardPool();
        registry.depositJulRewards(1000 ether);
        assertEq(registry.julRewardPool(), poolBefore + 1000 ether);
    }

    function test_depositJulRewards_revertsZero() public {
        vm.expectRevert(IVibePluginRegistry.ZeroAmount.selector);
        registry.depositJulRewards(0);
    }

    // ============ Reputation Grace Period Tests ============

    function test_effectiveGracePeriod_tier0() public view {
        assertEq(registry.effectiveGracePeriod(author), DEFAULT_GRACE);
    }

    function test_effectiveGracePeriod_tier2() public {
        oracle.setTier(author, 2);
        // 2 days - 2 * 6h = 2 days - 12h = 36h
        assertEq(registry.effectiveGracePeriod(author), 36 hours);
    }

    function test_effectiveGracePeriod_tier4() public {
        oracle.setTier(author, 4);
        // 2 days - 4 * 6h = 2 days - 24h = 24h
        assertEq(registry.effectiveGracePeriod(author), 24 hours);
    }

    function test_effectiveGracePeriod_neverBelowFloor() public {
        oracle.setTier(author, 255); // absurdly high
        assertGe(registry.effectiveGracePeriod(author), 6 hours);
    }

    function test_reputationAffectsProposal() public {
        oracle.setTier(author, 3);

        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        // 2 days - 3 * 6h = 30h
        assertEq(p.gracePeriod, 30 hours);
    }

    // ============ Category Index Tests ============

    function test_getPluginsByCategory() public {
        vm.startPrank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));
        registry.proposePlugin(address(plugin2), IVibePluginRegistry.PluginCategory.ORACLE, bytes32(0));
        registry.proposePlugin(address(plugin3), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));
        vm.stopPrank();

        uint256[] memory curves = registry.getPluginsByCategory(IVibePluginRegistry.PluginCategory.CURVE);
        assertEq(curves.length, 2);
        assertEq(curves[0], 0);
        assertEq(curves[1], 2);

        uint256[] memory oracles = registry.getPluginsByCategory(IVibePluginRegistry.PluginCategory.ORACLE);
        assertEq(oracles.length, 1);
        assertEq(oracles[0], 1);
    }

    // ============ Implementation Lookup Tests ============

    function test_getPluginByImplementation() public {
        vm.prank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        uint256 id = registry.getPluginByImplementation(address(plugin1));
        assertEq(id, 0);
    }

    function test_getPluginByImplementation_revertsNotFound() public {
        vm.expectRevert(IVibePluginRegistry.PluginNotFound.selector);
        registry.getPluginByImplementation(address(0xdead));
    }

    // ============ View Edge Cases ============

    function test_isActive_returnsFalseForNonexistent() public view {
        assertFalse(registry.isActive(999));
    }

    function test_isActiveImplementation_returnsFalseForUnknown() public view {
        assertFalse(registry.isActiveImplementation(address(0xdead)));
    }

    // ============ Integration Lifecycle Tests ============

    function test_fullLifecycle() public {
        // 1. Author proposes
        vm.prank(author);
        uint256 id = registry.proposePlugin(
            address(plugin1),
            IVibePluginRegistry.PluginCategory.HOOK,
            bytes32("ipfs://hook-docs")
        );

        // 2. Reviewer approves
        vm.prank(reviewer);
        registry.approvePlugin(id);

        // 3. Grace period elapses
        vm.warp(block.timestamp + DEFAULT_GRACE + 1);

        // 4. Anyone activates (author gets tip)
        uint256 authorBefore = jul.balanceOf(author);
        vm.prank(alice);
        registry.activatePlugin(id);
        assertEq(jul.balanceOf(author), authorBefore + 10 ether);

        // 5. Consumer integrates
        vm.prank(consumer);
        registry.addIntegration(id);
        assertEq(registry.getPlugin(id).integrations, 1);

        // 6. Reviewer deprecates
        vm.prank(reviewer);
        registry.deprecatePlugin(id, "v2 available");

        // 7. Consumer removes integration
        vm.prank(consumer);
        registry.removeIntegration(id);
        assertEq(registry.getPlugin(id).integrations, 0);

        // 8. Reviewer fully deactivates
        vm.prank(reviewer);
        registry.deactivatePlugin(id, "end of life");

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(id);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.DEACTIVATED));
    }

    function test_multiplePluginsSameAuthor() public {
        vm.startPrank(author);
        registry.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));
        registry.proposePlugin(address(plugin2), IVibePluginRegistry.PluginCategory.ORACLE, bytes32(0));
        registry.proposePlugin(address(plugin3), IVibePluginRegistry.PluginCategory.HOOK, bytes32(0));
        vm.stopPrank();

        assertEq(registry.totalPlugins(), 3);

        // Approve and activate all
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(reviewer);
            registry.approvePlugin(i);
        }

        vm.warp(block.timestamp + DEFAULT_GRACE + 1);

        for (uint256 i = 0; i < 3; i++) {
            registry.activatePlugin(i);
            assertTrue(registry.isActive(i));
        }
    }

    function test_activateWithEmptyRewardPool() public {
        // Deploy a registry with no rewards
        VibePluginRegistry emptyReg = new VibePluginRegistry(address(jul), address(oracle), DEFAULT_GRACE);
        emptyReg.setReviewer(reviewer, true);

        vm.prank(author);
        emptyReg.proposePlugin(address(plugin1), IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        emptyReg.approvePlugin(0);

        vm.warp(block.timestamp + DEFAULT_GRACE + 1);

        // Should activate without tip (pool empty)
        uint256 authorBefore = jul.balanceOf(author);
        emptyReg.activatePlugin(0);
        assertEq(jul.balanceOf(author), authorBefore); // No tip
        assertTrue(emptyReg.isActive(0));
    }

    // ============ Helper ============

    function _proposeApproveActivate(address impl, IVibePluginRegistry.PluginCategory cat) internal {
        vm.prank(author);
        registry.proposePlugin(impl, cat, bytes32(0));

        uint256 id = registry.totalPlugins() - 1;

        vm.prank(reviewer);
        registry.approvePlugin(id);

        vm.warp(block.timestamp + DEFAULT_GRACE + 1);
        registry.activatePlugin(id);
    }
}
