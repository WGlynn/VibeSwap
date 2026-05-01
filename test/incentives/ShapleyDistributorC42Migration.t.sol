// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local mock token — keeps this test self-contained.
contract C42MigMockToken is ERC20 {
    constructor() ERC20("C42 Migration Mock", "C42MIG") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice C42-F1 — Migration tests for the keeper commit-reveal defaults on
///         upgraded proxies. Audit
///         (docs/audits/2026-05-01-storage-layout-followup.md) flagged:
///
///   MEDIUM: `ShapleyDistributor.initialize()` sets `keeperRevealDelay =
///   DEFAULT_KEEPER_REVEAL_DELAY` inline, but `initializer` only runs on fresh
///   deploy. Upgrades from a pre-C42 proxy leave the slot at zero, allowing a
///   keeper to commit + reveal in the same block — defeating the
///   anti-frontrunning property of the M-of-N consensus.
///
/// This test asserts:
///   (a) `initializeC42Defaults()` reinitializer sets both slots when zero.
///   (b) The reinitializer cannot run twice (reinitializer(2) gate).
///   (c) Only the owner can call the reinitializer.
///   (d) The use-site floor activates if `keeperRevealDelay == 0`
///       (defense-in-depth) — same-block commit + reveal must still revert.
///   (e) Regression: existing keeper commit-reveal flow still works after the
///       reinitializer runs (and after governance overrides defaults).
contract ShapleyDistributorC42MigrationTest is Test {
    ShapleyDistributor public distributor;
    C42MigMockToken public token;

    address public owner;
    address public alice;
    address public keeper1;
    address public attacker;

    bytes32 public constant GAME_ID = keccak256("c42-mig-test-game");

    // Storage slots discovered via `forge inspect ShapleyDistributor storage`:
    //   slot 32: keeperRevealThreshold (uint256)
    //   slot 33: keeperRevealDelay     (uint256)
    uint256 internal constant SLOT_THRESHOLD = 32;
    uint256 internal constant SLOT_DELAY = 33;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        keeper1 = makeAddr("keeper-1");
        attacker = makeAddr("attacker");

        token = new C42MigMockToken();

        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        distributor.setAuthorizedCreator(owner, true);

        // Seed a game so reveals have a target (un-settled).
        token.mint(address(distributor), 100 ether);
        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 6000,
            stabilityScore: 8000
        });
        ps[1] = ShapleyDistributor.Participant({
            participant: keeper1, // dummy second participant
            directContribution: 50 ether,
            timeInPool: 14 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        distributor.createGame(GAME_ID, 100 ether, address(token), ps);
    }

    // ============ Helpers ============

    /// @dev Simulate a pre-C42 proxy: clear both keeper slots so the storage
    ///      mirrors a proxy that was initialized BEFORE C42 shipped.
    function _simulatePreC42Storage() internal {
        vm.store(address(distributor), bytes32(SLOT_THRESHOLD), bytes32(uint256(0)));
        vm.store(address(distributor), bytes32(SLOT_DELAY), bytes32(uint256(0)));
        assertEq(distributor.keeperRevealThreshold(), 0, "precondition: threshold cleared");
        assertEq(distributor.keeperRevealDelay(), 0, "precondition: delay cleared");
    }

    // ============ Reinitializer Path ============

    function test_C42F1_reinitializer_setsDefaultsWhenZero() public {
        _simulatePreC42Storage();

        distributor.initializeC42Defaults();

        assertEq(
            distributor.keeperRevealDelay(),
            distributor.DEFAULT_KEEPER_REVEAL_DELAY(),
            "delay must be set to DEFAULT_KEEPER_REVEAL_DELAY"
        );
        assertEq(
            distributor.keeperRevealThreshold(),
            1,
            "threshold must be set to 1 (single-keeper bootstrap)"
        );
    }

    function test_C42F1_reinitializer_doesNotOverwriteGovernanceValues() public {
        // Simulate the case where a governance call already raised the values
        // BEFORE the migration runs (unusual ordering but must be safe).
        _simulatePreC42Storage();
        // Owner pre-sets non-default values via the existing setters.
        distributor.setKeeperRevealDelay(2 hours);
        distributor.setKeeperRevealThreshold(3);

        // Now run the migration — non-zero slots must NOT be overwritten.
        distributor.initializeC42Defaults();

        assertEq(distributor.keeperRevealDelay(), 2 hours, "governance delay preserved");
        assertEq(distributor.keeperRevealThreshold(), 3, "governance threshold preserved");
    }

    function test_C42F1_reinitializer_cannotRunTwice() public {
        // Fresh deploy already advanced _initialized to 1, so reinitializer(2)
        // is callable exactly once.
        distributor.initializeC42Defaults();

        vm.expectRevert(); // InvalidInitialization
        distributor.initializeC42Defaults();
    }

    function test_C42F1_reinitializer_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        distributor.initializeC42Defaults();
    }

    // ============ Use-Site Floor (Defense-in-Depth) ============

    /// @dev Even if the migration has NOT yet run (so `keeperRevealDelay == 0`),
    ///      the use-site floor in `revealNoveltyMultiplier` must enforce
    ///      DEFAULT_KEEPER_REVEAL_DELAY. Same-block commit + reveal must revert.
    function test_C42F1_useSiteFloor_blocksSameBlockCommitReveal() public {
        // Certify keeper1 first.
        distributor.setCertifiedKeeper(keeper1, true);

        // Simulate pre-C42 storage AFTER the certify call (which doesn't touch
        // these slots).
        _simulatePreC42Storage();

        bytes32 salt = keccak256("salt-floor");
        uint256 mult = 15000;
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, mult, salt, 0);

        // Commit + immediate reveal in the same block — must revert because the
        // use-site floor injects DEFAULT_KEEPER_REVEAL_DELAY when storage is 0.
        vm.startPrank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        vm.expectRevert(ShapleyDistributor.RevealTooEarly.selector);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, mult, salt);
        vm.stopPrank();
    }

    /// @dev With the use-site floor, advancing past DEFAULT_KEEPER_REVEAL_DELAY
    ///      lets the reveal proceed even when storage is zero.
    function test_C42F1_useSiteFloor_allowsRevealAfterDefaultDelay() public {
        distributor.setCertifiedKeeper(keeper1, true);
        _simulatePreC42Storage();

        bytes32 salt = keccak256("salt-floor-pass");
        uint256 mult = 15000;
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, mult, salt, 0);

        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        // Advance past the floor.
        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        // BUT keeperRevealThreshold is also zero here. The existing inline floor
        // (`m == 0 ? 1 : m`) covers the M side, so the reveal should land and
        // apply the multiplier (threshold = 1 effective).
        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, mult, salt);

        assertEq(
            distributor.getNoveltyMultiplier(GAME_ID, alice),
            mult,
            "floor-respected reveal must apply multiplier"
        );
    }

    // ============ Regression — Existing Commit-Reveal Flow ============

    /// @dev Post-migration, the existing keeper commit-reveal flow still works:
    ///      commit → wait DEFAULT_KEEPER_REVEAL_DELAY → reveal → multiplier set.
    function test_C42F1_regression_existingFlowAfterMigration() public {
        distributor.setCertifiedKeeper(keeper1, true);
        _simulatePreC42Storage();
        distributor.initializeC42Defaults();

        bytes32 salt = keccak256("salt-regression");
        uint256 mult = 14000;
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, mult, salt, 0);

        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, mult, salt);

        assertEq(distributor.getNoveltyMultiplier(GAME_ID, alice), mult);
    }

    /// @dev Regression: fresh deploys (no migration needed) keep the original
    ///      behavior — commit + reveal + delay + multiplier-set.
    function test_C42F1_regression_freshDeployFlow() public {
        // Do NOT simulate pre-C42 storage. The fresh deploy already set the
        // defaults via initialize().
        assertEq(distributor.keeperRevealDelay(), distributor.DEFAULT_KEEPER_REVEAL_DELAY());
        assertEq(distributor.keeperRevealThreshold(), 1);

        distributor.setCertifiedKeeper(keeper1, true);

        bytes32 salt = keccak256("salt-fresh");
        uint256 mult = 13000;
        bytes32 commit = distributor.computeNoveltyCommitment(GAME_ID, alice, mult, salt, 0);

        vm.prank(keeper1);
        distributor.commitNoveltyMultiplier(GAME_ID, alice, commit);

        vm.warp(block.timestamp + distributor.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        vm.prank(keeper1);
        distributor.revealNoveltyMultiplier(GAME_ID, alice, mult, salt);

        assertEq(distributor.getNoveltyMultiplier(GAME_ID, alice), mult);
    }
}
