// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/governance/VibePluginRegistry.sol";
import "../../contracts/governance/interfaces/IVibePluginRegistry.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockPRFuzzToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockPRFuzzOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Fuzz Tests ============

contract VibePluginRegistryFuzzTest is Test {
    VibePluginRegistry public registry;
    MockPRFuzzToken public jul;
    MockPRFuzzOracle public oracle;

    address public reviewer;
    address public author;

    uint32 constant DEFAULT_GRACE = 2 days;

    function setUp() public {
        reviewer = makeAddr("reviewer");
        author = makeAddr("author");

        jul = new MockPRFuzzToken("JUL", "JUL");
        oracle = new MockPRFuzzOracle();

        registry = new VibePluginRegistry(address(jul), address(oracle), DEFAULT_GRACE);
        registry.setReviewer(reviewer, true);

        jul.mint(address(this), 100_000 ether);
        jul.approve(address(registry), type(uint256).max);
        registry.depositJulRewards(50_000 ether);
    }

    // ============ Grace Period Properties ============

    function testFuzz_effectiveGracePeriodNeverBelowFloor(uint8 tierSeed) public {
        uint8 tier = uint8(bound(tierSeed, 0, 255));
        oracle.setTier(author, tier);
        assertGe(registry.effectiveGracePeriod(author), 6 hours);
    }

    function testFuzz_effectiveGracePeriodMonotonic() public {
        uint32 prevGrace = type(uint32).max;
        for (uint8 tier = 0; tier <= 4; tier++) {
            oracle.setTier(author, tier);
            uint32 grace = registry.effectiveGracePeriod(author);
            assertLe(grace, prevGrace, "Grace period must decrease with higher tier");
            prevGrace = grace;
        }
    }

    function testFuzz_defaultGracePeriodClamped(uint32 period) public {
        registry.setDefaultGracePeriod(period);
        uint32 actual = registry.defaultGracePeriod();
        assertGe(actual, 6 hours, "Must be >= MIN_GRACE_PERIOD");
        assertLe(actual, 30 days, "Must be <= MAX_GRACE_PERIOD");
    }

    // ============ Propose Properties ============

    function testFuzz_proposeIncrementsTotalPlugins(uint8 count) public {
        count = uint8(bound(count, 1, 20));

        for (uint8 i = 0; i < count; i++) {
            address impl = address(uint160(i + 10_000));
            vm.prank(author);
            registry.proposePlugin(impl, IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));
        }

        assertEq(registry.totalPlugins(), count);
    }

    function testFuzz_proposeWithAnyCategory(uint8 catSeed) public {
        uint8 cat = uint8(bound(catSeed, 0, 5)); // 6 categories
        address impl = address(uint160(cat + 20_000));

        vm.prank(author);
        registry.proposePlugin(impl, IVibePluginRegistry.PluginCategory(cat), bytes32(0));

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.category), cat);
    }

    // ============ Lifecycle Properties ============

    function testFuzz_activationOnlyAfterGrace(uint32 warpTime) public {
        address impl = address(uint160(30_000));

        vm.prank(author);
        registry.proposePlugin(impl, IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        vm.prank(reviewer);
        registry.approvePlugin(0);

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        uint256 requiredTime = uint256(p.approvedAt) + p.gracePeriod;

        warpTime = uint32(bound(warpTime, 0, 60 days));
        vm.warp(block.timestamp + warpTime);

        if (block.timestamp < requiredTime) {
            vm.expectRevert(IVibePluginRegistry.GracePeriodNotElapsed.selector);
            registry.activatePlugin(0);
        } else {
            registry.activatePlugin(0);
            assertTrue(registry.isActive(0));
        }
    }

    function testFuzz_deactivateFromAnyNonTerminalState(uint8 stateSeed) public {
        address impl = address(uint160(40_000));

        vm.prank(author);
        registry.proposePlugin(impl, IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        uint8 targetState = uint8(bound(stateSeed, 0, 3)); // PROPOSED, APPROVED, ACTIVE, DEPRECATED

        if (targetState >= 1) {
            vm.prank(reviewer);
            registry.approvePlugin(0);
        }
        if (targetState >= 2) {
            vm.warp(block.timestamp + DEFAULT_GRACE + 1);
            registry.activatePlugin(0);
        }
        if (targetState >= 3) {
            vm.prank(reviewer);
            registry.deprecatePlugin(0, "sunset");
        }

        // Deactivate should always work from any non-terminal state
        vm.prank(reviewer);
        registry.deactivatePlugin(0, "emergency kill");

        IVibePluginRegistry.Plugin memory p = registry.getPlugin(0);
        assertEq(uint8(p.state), uint8(IVibePluginRegistry.PluginState.DEACTIVATED));
    }

    // ============ Integration Count Properties ============

    function testFuzz_integrationCountAccurate(uint8 addCount, uint8 removeCount) public {
        addCount = uint8(bound(addCount, 1, 20));
        removeCount = uint8(bound(removeCount, 0, addCount));

        address impl = address(uint160(50_000));
        vm.prank(author);
        registry.proposePlugin(impl, IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));
        vm.prank(reviewer);
        registry.approvePlugin(0);
        vm.warp(block.timestamp + DEFAULT_GRACE + 1);
        registry.activatePlugin(0);

        // Add integrations
        for (uint8 i = 0; i < addCount; i++) {
            address c = address(uint160(i + 60_000));
            vm.prank(c);
            registry.addIntegration(0);
        }

        assertEq(registry.getPlugin(0).integrations, addCount);

        // Remove some
        for (uint8 i = 0; i < removeCount; i++) {
            address c = address(uint160(i + 60_000));
            vm.prank(c);
            registry.removeIntegration(0);
        }

        assertEq(registry.getPlugin(0).integrations, addCount - removeCount);
    }

    // ============ Audit Score Properties ============

    function testFuzz_auditScoreNeverExceedsMax(uint16 score) public {
        address impl = address(uint160(70_000));
        vm.prank(author);
        registry.proposePlugin(impl, IVibePluginRegistry.PluginCategory.CURVE, bytes32(0));

        if (score > 10_000) {
            vm.prank(reviewer);
            vm.expectRevert(IVibePluginRegistry.InvalidAuditScore.selector);
            registry.setAuditScore(0, score);
        } else {
            vm.prank(reviewer);
            registry.setAuditScore(0, score);
            assertEq(registry.getPlugin(0).auditScore, score);
        }
    }
}
