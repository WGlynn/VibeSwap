// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/ShardOperatorRegistry.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract ShardOperatorRegistryTest is Test {
    ShardOperatorRegistry public registry;
    CKBNativeToken public ckb;

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address controller = makeAddr("issuanceController");
    address op1 = makeAddr("operator1");
    address op2 = makeAddr("operator2");
    address op3 = makeAddr("operator3");

    bytes32 shard1 = keccak256("shard1");
    bytes32 shard2 = keccak256("shard2");
    bytes32 shard3 = keccak256("shard3");

    uint256 constant STAKE = 500e18;
    uint256 constant MIN = 100e18;

    function setUp() public {
        // Deploy CKB-native
        CKBNativeToken ckbImpl = new CKBNativeToken();
        bytes memory ckbData = abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner);
        ERC1967Proxy ckbProxy = new ERC1967Proxy(address(ckbImpl), ckbData);
        ckb = CKBNativeToken(address(ckbProxy));

        // Deploy registry
        ShardOperatorRegistry regImpl = new ShardOperatorRegistry();
        bytes memory regData = abi.encodeWithSelector(
            ShardOperatorRegistry.initialize.selector, address(ckb), owner
        );
        ERC1967Proxy regProxy = new ERC1967Proxy(address(regImpl), regData);
        registry = ShardOperatorRegistry(address(regProxy));

        // Wire
        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        registry.setIssuanceController(controller);
        vm.stopPrank();

        // Mint tokens to operators and controller
        vm.startPrank(minter);
        ckb.mint(op1, 50_000e18);
        ckb.mint(op2, 50_000e18);
        ckb.mint(op3, 50_000e18);
        ckb.mint(controller, 500_000e18);
        vm.stopPrank();

        // Approve registry
        vm.prank(op1);
        ckb.approve(address(registry), type(uint256).max);
        vm.prank(op2);
        ckb.approve(address(registry), type(uint256).max);
        vm.prank(op3);
        ckb.approve(address(registry), type(uint256).max);
        vm.prank(controller);
        ckb.approve(address(registry), type(uint256).max);
    }

    // ============ Registration ============

    function test_registerShard() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        ShardOperatorRegistry.Shard memory s = registry.getShard(shard1);
        assertEq(s.operator, op1);
        assertEq(s.stake, STAKE);
        assertEq(s.cellsServed, 0);
        assertTrue(s.active);
        assertEq(registry.activeShardCount(), 1);
        assertEq(registry.totalStaked(), STAKE);
    }

    function test_registerShard_transfersTokens() public {
        uint256 balBefore = ckb.balanceOf(op1);
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        assertEq(ckb.balanceOf(op1), balBefore - STAKE);
    }

    function test_revert_registerTwice() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.AlreadyRegistered.selector);
        registry.registerShard(shard2, STAKE);
    }

    function test_revert_shardIdCollision() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op2);
        vm.expectRevert(ShardOperatorRegistry.ShardIdTaken.selector);
        registry.registerShard(shard1, STAKE);
    }

    function test_revert_insufficientStake() public {
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.InsufficientStake.selector);
        registry.registerShard(shard1, MIN - 1);
    }

    // ============ Report Cells ============

    function test_reportCellsServed() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        registry.reportCellsServed(1000);

        ShardOperatorRegistry.Shard memory s = registry.getShard(shard1);
        assertEq(s.cellsServed, 1000);
        assertEq(registry.totalCellsServed(), 1000);
    }

    function test_reportCellsServed_updatesWeight() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        // Weight should be 0 initially (0 cells)
        assertEq(registry.totalWeight(), 0);

        vm.prank(op1);
        registry.reportCellsServed(100);

        // Weight = sqrt(100 * 500e18) > 0
        assertGt(registry.totalWeight(), 0);
    }

    function test_reportCellsServed_updatesTotalCells() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        registry.reportCellsServed(500);
        assertEq(registry.totalCellsServed(), 500);

        // Update to lower value
        vm.prank(op1);
        registry.reportCellsServed(200);
        assertEq(registry.totalCellsServed(), 200);
    }

    function test_revert_cellsExceedCap() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.CellsExceedCap.selector);
        registry.reportCellsServed(1e12 + 1);
    }

    function test_revert_reportCells_notRegistered() public {
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.NotRegistered.selector);
        registry.reportCellsServed(100);
    }

    function test_revert_reportCells_afterDeactivate() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        registry.deactivateShard();

        // NCI-023: operatorShard cleared on deactivate, so hits NotRegistered
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.NotRegistered.selector);
        registry.reportCellsServed(100);
    }

    // ============ Heartbeat ============

    function test_heartbeat() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.warp(block.timestamp + 12 hours);

        vm.prank(op1);
        registry.heartbeat();

        ShardOperatorRegistry.Shard memory s = registry.getShard(shard1);
        assertEq(s.lastHeartbeat, block.timestamp);
    }

    function test_revert_heartbeat_notRegistered() public {
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.NotRegistered.selector);
        registry.heartbeat();
    }

    // ============ Deactivation ============

    function test_deactivateShard() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        uint256 balBefore = ckb.balanceOf(op1);

        vm.prank(op1);
        registry.deactivateShard();

        ShardOperatorRegistry.Shard memory s = registry.getShard(shard1);
        assertFalse(s.active);
        assertEq(s.stake, 0);
        assertEq(registry.activeShardCount(), 0);
        assertEq(registry.totalStaked(), 0);
        // Stake returned
        assertEq(ckb.balanceOf(op1), balBefore + STAKE);
    }

    function test_deactivate_clearsOperatorShard() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        registry.deactivateShard();

        // NCI-023: operatorShard cleared so operator can re-register
        assertEq(registry.operatorShard(op1), bytes32(0));
    }

    function test_deactivate_removesWeight() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        registry.reportCellsServed(100);
        uint256 weightBefore = registry.totalWeight();
        assertGt(weightBefore, 0);

        vm.prank(op1);
        registry.deactivateShard();
        assertEq(registry.totalWeight(), 0);
    }

    function test_revert_deactivate_notRegistered() public {
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.NotRegistered.selector);
        registry.deactivateShard();
    }

    function test_revert_deactivate_afterDeactivate() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        registry.deactivateShard();

        // NCI-023: operatorShard cleared on deactivate, so hits NotRegistered
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.NotRegistered.selector);
        registry.deactivateShard();
    }

    // ============ Rewards (Masterchef) ============

    function test_distributeRewards() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        uint256 rewardAmount = 1000e18;
        vm.prank(controller);
        registry.distributeRewards(rewardAmount);

        // accRewardPerShare should be updated
        assertGt(registry.accRewardPerShare(), 0);
    }

    function test_distributeRewards_onlyAuthorized() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        vm.prank(op2);
        vm.expectRevert("Not authorized");
        registry.distributeRewards(100e18);
    }

    function test_distributeRewards_revertZero() public {
        vm.prank(controller);
        vm.expectRevert(ShardOperatorRegistry.ZeroAmount.selector);
        registry.distributeRewards(0);
    }

    function test_distributeRewards_revertNoActiveShards() public {
        // No shards registered → totalWeight = 0
        vm.prank(controller);
        vm.expectRevert("No active shards");
        registry.distributeRewards(100e18);
    }

    function test_claimRewards_singleOperator() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        uint256 rewardAmount = 1000e18;
        vm.prank(controller);
        registry.distributeRewards(rewardAmount);

        uint256 pending = registry.pendingRewards(op1);
        // Masterchef rounding: up to 1 wei loss
        assertApproxEqAbs(pending, rewardAmount, 1, "Single operator gets all rewards");

        uint256 balBefore = ckb.balanceOf(op1);
        vm.prank(op1);
        registry.claimRewards();
        assertApproxEqAbs(ckb.balanceOf(op1), balBefore + rewardAmount, 1);
    }

    function test_claimRewards_twoOperators_proportional() public {
        // Op1: stake=500, cells=100 → weight=sqrt(500e18*100)
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        // Op2: same stake and cells → same weight
        vm.prank(op2);
        registry.registerShard(shard2, STAKE);
        vm.prank(op2);
        registry.reportCellsServed(100);

        uint256 rewardAmount = 2000e18;
        vm.prank(controller);
        registry.distributeRewards(rewardAmount);

        // Equal weight → equal rewards
        uint256 pending1 = registry.pendingRewards(op1);
        uint256 pending2 = registry.pendingRewards(op2);
        assertApproxEqRel(pending1, 1000e18, 0.01e18, "Op1 gets ~50%");
        assertApproxEqRel(pending2, 1000e18, 0.01e18, "Op2 gets ~50%");
    }

    function test_claimRewards_afterDeactivation() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        vm.prank(controller);
        registry.distributeRewards(1000e18);

        // Deactivate claims rewards automatically
        uint256 balBefore = ckb.balanceOf(op1);
        vm.prank(op1);
        registry.deactivateShard();

        // Should have received stake + rewards (Masterchef rounding: up to 1 wei)
        uint256 balAfter = ckb.balanceOf(op1);
        assertApproxEqAbs(balAfter, balBefore + STAKE + 1000e18, 1);
    }

    function test_pendingRewards_zero_noWeight() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        // No cells reported → weight = 0 → no rewards

        vm.prank(controller);
        // Can't distribute with 0 weight
        vm.expectRevert("No active shards");
        registry.distributeRewards(100e18);
    }

    // ============ NCI-037: Claim Before Weight Change ============

    function test_reportCells_claimsBeforeWeightChange() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        vm.prank(controller);
        registry.distributeRewards(1000e18);

        // Op1 has 1000e18 pending. Now report more cells — should claim first.
        uint256 balBefore = ckb.balanceOf(op1);
        vm.prank(op1);
        registry.reportCellsServed(200);

        // Pending rewards should have been claimed (Masterchef rounding: up to 1 wei)
        assertApproxEqAbs(ckb.balanceOf(op1), balBefore + 1000e18, 1);
    }

    // ============ Weight Math ============

    function test_weight_zeroCells() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        // 0 cells → 0 weight
        assertEq(registry.totalWeight(), 0);
    }

    function test_weight_geometricMean() public {
        vm.prank(op1);
        registry.registerShard(shard1, 10000e18); // 10k stake
        vm.prank(op1);
        registry.reportCellsServed(10000); // 10k cells

        // weight = sqrt(10000 * 10000e18) = sqrt(1e8 * 1e18) = sqrt(1e26) = 1e13
        uint256 w = registry.totalWeight();
        assertApproxEqAbs(w, 1e13, 1, "sqrt(10000 * 10000e18) ~ 1e13");
    }

    // ============ Multi-Operator Scenario ============

    function test_threeOperators_fullLifecycle() public {
        // Register 3 operators
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op2);
        registry.registerShard(shard2, STAKE);
        vm.prank(op3);
        registry.registerShard(shard3, STAKE);

        assertEq(registry.activeShardCount(), 3);
        assertEq(registry.totalStaked(), STAKE * 3);

        // All report cells
        vm.prank(op1);
        registry.reportCellsServed(100);
        vm.prank(op2);
        registry.reportCellsServed(100);
        vm.prank(op3);
        registry.reportCellsServed(100);

        // Distribute rewards
        vm.prank(controller);
        registry.distributeRewards(3000e18);

        // Each gets ~1000
        assertApproxEqRel(registry.pendingRewards(op1), 1000e18, 0.01e18);
        assertApproxEqRel(registry.pendingRewards(op2), 1000e18, 0.01e18);
        assertApproxEqRel(registry.pendingRewards(op3), 1000e18, 0.01e18);

        // Op2 deactivates
        vm.prank(op2);
        registry.deactivateShard();
        assertEq(registry.activeShardCount(), 2);

        // New rewards distributed only to op1 and op3
        vm.prank(controller);
        registry.distributeRewards(2000e18);

        // Op1 and op3 still had ~1000 unclaimed from round 1, plus ~1000 from round 2
        assertApproxEqRel(registry.pendingRewards(op1), 2000e18, 0.01e18);
        assertApproxEqRel(registry.pendingRewards(op3), 2000e18, 0.01e18);
    }

    // ============ Admin ============

    function test_setIssuanceController() public {
        address newController = makeAddr("newController");
        vm.prank(owner);
        registry.setIssuanceController(newController);
        assertEq(registry.issuanceController(), newController);
    }

    function test_ownerCanDistribute() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        // Owner should also be authorized to distribute (setup phase)
        vm.prank(owner);
        ckb.approve(address(registry), type(uint256).max);
        vm.startPrank(minter);
        ckb.mint(owner, 1000e18);
        vm.stopPrank();

        vm.prank(owner);
        registry.distributeRewards(100e18);
        assertGt(registry.pendingRewards(op1), 0);
    }

    // ============ C10-AUDIT-2: Heartbeat Liveness ============

    /// @notice A shard is not stale immediately after registration.
    function test_isStale_freshRegistration() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        assertFalse(registry.isStale(shard1));
    }

    /// @notice A shard becomes stale after HEARTBEAT_GRACE passes without heartbeat.
    function test_isStale_afterGraceWindow() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        // Warp past grace (48h default)
        vm.warp(block.timestamp + 48 hours + 1);
        assertTrue(registry.isStale(shard1));
    }

    /// @notice Stale shard cannot report cells — forces heartbeat first.
    function test_reportCellsServed_revertsWhenStale() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        vm.warp(block.timestamp + 48 hours + 1);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.ShardStale.selector);
        registry.reportCellsServed(200);
    }

    /// @notice Stale shard cannot claim — forces heartbeat first.
    function test_claimRewards_revertsWhenStale() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);
        vm.prank(controller);
        registry.distributeRewards(1000e18);

        vm.warp(block.timestamp + 48 hours + 1);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.ShardStale.selector);
        registry.claimRewards();
    }

    /// @notice Heartbeating refreshes the liveness window.
    function test_heartbeat_refreshesLiveness() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.warp(block.timestamp + 40 hours); // inside grace still
        vm.prank(op1);
        registry.heartbeat();

        // Now 40h + 48h = 88h from start. isStale should be false because
        // grace is measured from lastHeartbeat, which just got refreshed.
        vm.warp(block.timestamp + 40 hours);
        assertFalse(registry.isStale(shard1));
    }

    /// @notice Anyone can reap a stale shard — no authorization required.
    function test_deactivateStaleShard_permissionless() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.reportCellsServed(100);

        uint256 activeBefore = registry.activeShardCount();
        uint256 stakedBefore = registry.totalStaked();

        vm.warp(block.timestamp + 48 hours + 1);

        // Random stranger (op2) reaps the stale shard
        vm.prank(op2);
        registry.deactivateStaleShard(shard1);

        assertEq(registry.activeShardCount(), activeBefore - 1);
        assertEq(registry.totalStaked(), stakedBefore - STAKE);
        assertEq(registry.operatorShard(op1), bytes32(0), "op1 can re-register");
        assertFalse(registry.getShard(shard1).active);
    }

    /// @notice Stake is returned to the reaped operator, not the reaper (no theft vector).
    function test_deactivateStaleShard_returnsStakeToOperator() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        uint256 op1Before = ckb.balanceOf(op1);
        uint256 reaperBefore = ckb.balanceOf(op2);

        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(op2);
        registry.deactivateStaleShard(shard1);

        assertEq(ckb.balanceOf(op1), op1Before + STAKE, "stake returned to op1");
        assertEq(ckb.balanceOf(op2), reaperBefore, "reaper got nothing");
    }

    /// @notice Cannot reap a live (heartbeating) shard.
    function test_deactivateStaleShard_revertsWhenLive() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op2);
        vm.expectRevert(ShardOperatorRegistry.ShardNotStale.selector);
        registry.deactivateStaleShard(shard1);
    }

    /// @notice Reaped operator can re-register with a new shardId.
    function test_deactivateStaleShard_operatorCanReregister() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(op2);
        registry.deactivateStaleShard(shard1);

        // op1 got stake back — re-approves and registers under new shardId
        vm.prank(op1);
        registry.registerShard(shard2, STAKE);
        assertEq(registry.operatorShard(op1), shard2);
    }
}
