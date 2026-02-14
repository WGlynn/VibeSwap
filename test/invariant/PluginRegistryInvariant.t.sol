// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/governance/VibePluginRegistry.sol";
import "../../contracts/governance/interfaces/IVibePluginRegistry.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockPRInvToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockPRInvOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Handler ============

contract PluginRegistryHandler is Test {
    VibePluginRegistry public registry;
    MockPRInvToken public jul;
    address public reviewer;

    // Ghost variables
    uint256 public ghost_proposed;
    uint256 public ghost_approved;
    uint256 public ghost_activated;
    uint256 public ghost_deprecated;
    uint256 public ghost_deactivated;
    uint256 public ghost_totalIntegrations;

    uint256 private _implCounter;

    constructor(VibePluginRegistry _registry, MockPRInvToken _jul, address _reviewer) {
        registry = _registry;
        jul = _jul;
        reviewer = _reviewer;
        _implCounter = 100_000;
    }

    function proposePlugin(uint8 catSeed) public {
        uint8 cat = uint8(bound(catSeed, 0, 5));
        address impl = address(uint160(++_implCounter));

        try registry.proposePlugin(impl, IVibePluginRegistry.PluginCategory(cat), bytes32(0)) {
            ghost_proposed++;
        } catch {}
    }

    function approvePlugin(uint256 idSeed) public {
        uint256 total = registry.totalPlugins();
        if (total == 0) return;
        uint256 id = idSeed % total;

        vm.prank(reviewer);
        try registry.approvePlugin(id) {
            ghost_approved++;
        } catch {}
    }

    function activatePlugin(uint256 idSeed) public {
        uint256 total = registry.totalPlugins();
        if (total == 0) return;
        uint256 id = idSeed % total;

        try registry.activatePlugin(id) {
            ghost_activated++;
        } catch {}
    }

    function deprecatePlugin(uint256 idSeed) public {
        uint256 total = registry.totalPlugins();
        if (total == 0) return;
        uint256 id = idSeed % total;

        vm.prank(reviewer);
        try registry.deprecatePlugin(id, "sunset") {
            ghost_deprecated++;
        } catch {}
    }

    function deactivatePlugin(uint256 idSeed) public {
        uint256 total = registry.totalPlugins();
        if (total == 0) return;
        uint256 id = idSeed % total;

        vm.prank(reviewer);
        try registry.deactivatePlugin(id, "kill") {
            ghost_deactivated++;
        } catch {}
    }

    function addIntegration(uint256 idSeed, uint256 consumerSeed) public {
        uint256 total = registry.totalPlugins();
        if (total == 0) return;
        uint256 id = idSeed % total;
        address consumer = address(uint160(bound(consumerSeed, 200_000, 200_100)));

        vm.prank(consumer);
        try registry.addIntegration(id) {
            ghost_totalIntegrations++;
        } catch {}
    }

    function removeIntegration(uint256 idSeed, uint256 consumerSeed) public {
        uint256 total = registry.totalPlugins();
        if (total == 0) return;
        uint256 id = idSeed % total;
        address consumer = address(uint160(bound(consumerSeed, 200_000, 200_100)));

        vm.prank(consumer);
        try registry.removeIntegration(id) {
            ghost_totalIntegrations--;
        } catch {}
    }

    function warpTime(uint256 seconds_) public {
        seconds_ = bound(seconds_, 0, 5 days);
        vm.warp(block.timestamp + seconds_);
    }
}

// ============ Invariant Tests ============

contract PluginRegistryInvariantTest is StdInvariant, Test {
    VibePluginRegistry public registry;
    MockPRInvToken public jul;
    MockPRInvOracle public oracle;
    PluginRegistryHandler public handler;

    address public reviewer;
    uint256 constant INITIAL_REWARD_POOL = 50_000 ether;

    function setUp() public {
        reviewer = makeAddr("reviewer");

        jul = new MockPRInvToken("JUL", "JUL");
        oracle = new MockPRInvOracle();

        registry = new VibePluginRegistry(address(jul), address(oracle), 2 days);
        registry.setReviewer(reviewer, true);

        jul.mint(address(this), INITIAL_REWARD_POOL);
        jul.approve(address(registry), type(uint256).max);
        registry.depositJulRewards(INITIAL_REWARD_POOL);

        handler = new PluginRegistryHandler(registry, jul, reviewer);
        targetContract(address(handler));
    }

    // ============ Plugin Count Invariant ============

    /**
     * @notice totalPlugins always equals ghost_proposed.
     */
    function invariant_pluginCountMatchesGhost() public view {
        assertEq(
            registry.totalPlugins(),
            handler.ghost_proposed(),
            "Plugin count must match proposals"
        );
    }

    // ============ State Machine Invariant ============

    /**
     * @notice Every plugin is in a valid state.
     */
    function invariant_allPluginsValidState() public view {
        uint256 total = registry.totalPlugins();
        for (uint256 i = 0; i < total; i++) {
            IVibePluginRegistry.Plugin memory p = registry.getPlugin(i);
            uint8 state = uint8(p.state);
            assertTrue(state <= 4, "Invalid plugin state");
        }
    }

    // ============ Timestamp Ordering Invariant ============

    /**
     * @notice Timestamps are ordered: proposedAt <= approvedAt <= activatedAt.
     */
    function invariant_timestampOrdering() public view {
        uint256 total = registry.totalPlugins();
        for (uint256 i = 0; i < total; i++) {
            IVibePluginRegistry.Plugin memory p = registry.getPlugin(i);

            if (p.approvedAt > 0) {
                assertGe(p.approvedAt, p.proposedAt, "approved must be >= proposed");
            }
            if (p.activatedAt > 0) {
                assertGe(p.activatedAt, p.approvedAt, "activated must be >= approved");
            }
            if (p.deprecatedAt > 0) {
                assertGe(p.deprecatedAt, p.activatedAt, "deprecated must be >= activated");
            }
        }
    }

    // ============ JUL Solvency Invariant ============

    /**
     * @notice JUL balance always covers reward pool.
     */
    function invariant_julSolvency() public view {
        uint256 balance = jul.balanceOf(address(registry));
        uint256 pool = registry.julRewardPool();
        assertGe(balance, pool, "JUL balance must cover reward pool");
    }

    // ============ Reward Pool Monotone Invariant ============

    /**
     * @notice Reward pool never exceeds initial deposit (only decreases via tips).
     */
    function invariant_rewardPoolBounded() public view {
        assertLe(
            registry.julRewardPool(),
            INITIAL_REWARD_POOL,
            "Reward pool must not exceed initial deposit"
        );
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("--- Plugin Registry Invariant Summary ---");
        console.log("Proposed:", handler.ghost_proposed());
        console.log("Approved:", handler.ghost_approved());
        console.log("Activated:", handler.ghost_activated());
        console.log("Deprecated:", handler.ghost_deprecated());
        console.log("Deactivated:", handler.ghost_deactivated());
        console.log("Total integrations:", handler.ghost_totalIntegrations());
        console.log("Reward pool:", registry.julRewardPool());
    }
}
