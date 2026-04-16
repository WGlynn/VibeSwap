// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/ShardOperatorRegistry.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev C11-AUDIT-14 test double. Lets tests mark cellIds active/inactive
///      without deploying a full StateRentVault. Mimics the Cell struct layout.
contract MockStateRentVault is IStateRentVaultForRegistry {
    mapping(bytes32 => bool) public activeCells;

    function setActive(bytes32 cellId, bool active) external {
        activeCells[cellId] = active;
    }

    function getCell(bytes32 cellId) external view returns (Cell memory) {
        return Cell({
            owner: address(0),
            capacity: 0,
            contentHash: bytes32(0),
            createdAt: 0,
            active: activeCells[cellId]
        });
    }
}

contract ShardOperatorRegistryTest is Test {
    using stdStorage for StdStorage;

    ShardOperatorRegistry public registry;
    CKBNativeToken public ckb;
    MockStateRentVault public vault;

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

        // C11-AUDIT-14: mock vault so existing challenge-response tests keep
        // working. Individual tests opt into unset-vault / inactive-cell
        // scenarios by either not setting active bits or by not wiring at all.
        vault = new MockStateRentVault();

        // Wire
        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        registry.setIssuanceController(controller);
        registry.setStateRentVault(address(vault));
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

    /// @dev C10-AUDIT-3 helper: commits a cellsServed report with empty merkleRoot,
    ///      warps past CHALLENGE_WINDOW, and finalizes. Use for test setup where
    ///      challenges aren't being exercised.
    function _report(address op, uint256 count) internal returns (bytes32) {
        vm.prank(op);
        registry.commitCellsReport(count, bytes32(0));
        bytes32 sid = registry.operatorShard(op);
        vm.warp(block.timestamp + 1 hours + 1);
        registry.finalizeCellsReport(sid);
        return sid;
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

        _report(op1, 1000);

        ShardOperatorRegistry.Shard memory s = registry.getShard(shard1);
        assertEq(s.cellsServed, 1000);
        assertEq(registry.totalCellsServed(), 1000);
    }

    function test_reportCellsServed_updatesWeight() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        // Weight should be 0 initially (0 cells)
        assertEq(registry.totalWeight(), 0);

        _report(op1, 100);

        // Weight = sqrt(100 * 500e18) > 0
        assertGt(registry.totalWeight(), 0);
    }

    function test_reportCellsServed_updatesTotalCells() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        _report(op1, 500);
        assertEq(registry.totalCellsServed(), 500);

        // Update to lower value
        _report(op1, 200);
        assertEq(registry.totalCellsServed(), 200);
    }

    function test_revert_cellsExceedCap() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.CellsExceedCap.selector);
        registry.commitCellsReport(1e12 + 1, bytes32(0));
    }

    function test_revert_reportCells_notRegistered() public {
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.NotRegistered.selector);
        registry.commitCellsReport(100, bytes32(0));
    }

    function test_revert_reportCells_afterDeactivate() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        vm.prank(op1);
        registry.deactivateShard();

        // NCI-023: operatorShard cleared on deactivate, so hits NotRegistered
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.NotRegistered.selector);
        registry.commitCellsReport(100, bytes32(0));
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

        _report(op1, 100);
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
        _report(op1, 100);

        uint256 rewardAmount = 1000e18;
        vm.prank(controller);
        registry.distributeRewards(rewardAmount);

        // accRewardPerShare should be updated
        assertGt(registry.accRewardPerShare(), 0);
    }

    function test_distributeRewards_onlyAuthorized() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        _report(op1, 100);

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
        _report(op1, 100);

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
        _report(op1, 100);

        // Op2: same stake and cells → same weight
        vm.prank(op2);
        registry.registerShard(shard2, STAKE);
        _report(op2, 100);

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
        _report(op1, 100);

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
        _report(op1, 100);

        vm.prank(controller);
        registry.distributeRewards(1000e18);

        // Op1 has 1000e18 pending. Now report more cells — should claim first.
        uint256 balBefore = ckb.balanceOf(op1);
        _report(op1, 200);

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
        _report(op1, 10000); // 10k cells

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
        _report(op1, 100);
        _report(op2, 100);
        _report(op3, 100);

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
        _report(op1, 100);

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
        _report(op1, 100);

        vm.warp(block.timestamp + 48 hours + 1);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.ShardStale.selector);
        registry.commitCellsReport(200, bytes32(0));
    }

    /// @notice Stale shard cannot claim — forces heartbeat first.
    function test_claimRewards_revertsWhenStale() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        _report(op1, 100);
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
        _report(op1, 100);

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

    // ============ C10-AUDIT-3: Challenge-Response Tests ============

    /// @dev Build a simple 2-leaf Merkle tree over (index, cellId) pairs.
    ///      Returns the root and proofs for each leaf.
    function _build2LeafTree(bytes32 cellId0, bytes32 cellId1)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proof0, bytes32[] memory proof1)
    {
        bytes32 leaf0 = keccak256(abi.encode(uint256(0), cellId0));
        bytes32 leaf1 = keccak256(abi.encode(uint256(1), cellId1));
        // OZ MerkleProof.verify uses _hashPair which sorts by default
        root = _hashPair(leaf0, leaf1);
        proof0 = new bytes32[](1);
        proof0[0] = leaf1;
        proof1 = new bytes32[](1);
        proof1[0] = leaf0;
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @notice commitCellsReport does NOT immediately change weight.
    function test_commit_doesNotUpdateWeightYet() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        uint256 weightBefore = registry.totalWeight();

        vm.prank(op1);
        registry.commitCellsReport(100, bytes32(0));

        // Weight unchanged — pending, not finalized
        assertEq(registry.totalWeight(), weightBefore);
    }

    /// @notice Cannot finalize before challenge window expires.
    function test_finalize_revertsBeforeWindow() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(100, bytes32(0));

        // Only 30 min elapsed; window is 1 hour
        vm.warp(block.timestamp + 30 minutes);

        vm.expectRevert(ShardOperatorRegistry.ReportNotMature.selector);
        registry.finalizeCellsReport(shard1);
    }

    /// @notice Cannot commit a new report while one is pending (unresolved).
    function test_commit_revertsWhilePendingActive() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(100, bytes32(0));

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.PendingReportActive.selector);
        registry.commitCellsReport(200, bytes32(0));
    }

    /// @notice A challenger can raise a challenge during the window.
    function test_challenge_raisedWithinWindow() public {
        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, , ) = _build2LeafTree(cellA, cellB);

        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(2, root);

        // op2 posts bond and challenges
        vm.prank(op2);
        ckb.approve(address(registry), type(uint256).max);
        vm.prank(op2);
        registry.challengeCellsReport(shard1, 0);

        (, , , , address challenger, uint256 cIdx, , , ) = registry.pendingReports(shard1);
        assertEq(challenger, op2);
        assertEq(cIdx, 0);
    }

    /// @notice Operator refutes successfully with a valid Merkle proof.
    ///         Challenger's bond is forfeited to the operator.
    function test_challenge_refutedWithValidProof() public {
        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, bytes32[] memory proof0, ) = _build2LeafTree(cellA, cellB);

        // C11-AUDIT-14: cellA must be a real active cell in the vault
        vault.setActive(cellA, true);

        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(2, root);

        vm.prank(op2);
        registry.challengeCellsReport(shard1, 0);

        uint256 op1Before = ckb.balanceOf(op1);

        // op1 refutes with the correct cellId at index 0
        vm.prank(op1);
        registry.respondToChallenge(shard1, cellA, proof0);

        // Challenger's bond transferred to op1
        assertEq(ckb.balanceOf(op1), op1Before + registry.CHALLENGE_BOND());

        // Challenge cleared; operator can finalize after the original window
        vm.warp(block.timestamp + 1 hours + 1);
        registry.finalizeCellsReport(shard1);
        assertEq(registry.getShard(shard1).cellsServed, 2);
    }

    /// @notice Operator who fails to respond is slashed; challenger collects slash + bond.
    function test_challenge_slashesNonRespondingOperator() public {
        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, , ) = _build2LeafTree(cellA, cellB);

        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        uint256 op1StakeBefore = registry.getShard(shard1).stake;
        assertEq(op1StakeBefore, STAKE);

        vm.prank(op1);
        registry.commitCellsReport(2, root);

        vm.prank(op2);
        registry.challengeCellsReport(shard1, 0);

        // op1 ignores the challenge
        vm.warp(block.timestamp + 30 minutes + 1);

        uint256 challengerBefore = ckb.balanceOf(op2);
        uint256 expectedSlash = (STAKE * 1000) / 10_000; // 10%

        // Anyone can trigger the slash — op2 does for their own payout
        registry.claimChallengeSlash(shard1);

        // op1's stake reduced by the slash
        assertEq(registry.getShard(shard1).stake, STAKE - expectedSlash);

        // op2 received slash + their bond back
        assertEq(
            ckb.balanceOf(op2),
            challengerBefore + expectedSlash + registry.CHALLENGE_BOND()
        );
    }

    /// @notice Invalid Merkle proof fails to refute — operator still on the hook.
    function test_challenge_invalidProofDoesNotRefute() public {
        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, bytes32[] memory proof0, ) = _build2LeafTree(cellA, cellB);

        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(2, root);

        vm.prank(op2);
        registry.challengeCellsReport(shard1, 0);

        // Provide proof that doesn't match the (index, cellId) pair
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.InvalidMerkleProof.selector);
        registry.respondToChallenge(shard1, keccak256("wrong"), proof0);
    }

    /// @notice Challenge response after deadline is rejected.
    function test_challenge_responseAfterDeadlineRejected() public {
        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, bytes32[] memory proof0, ) = _build2LeafTree(cellA, cellB);

        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(2, root);

        vm.prank(op2);
        registry.challengeCellsReport(shard1, 0);

        vm.warp(block.timestamp + 30 minutes + 1);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.ChallengeExpired.selector);
        registry.respondToChallenge(shard1, cellA, proof0);
    }

    /// @notice Cannot challenge after finalization window has elapsed.
    function test_challenge_afterWindowRejected() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(100, bytes32(0));

        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(op2);
        vm.expectRevert(ShardOperatorRegistry.ReportNotMature.selector);
        registry.challengeCellsReport(shard1, 0);
    }

    /// @notice Challenge cellIndex out of range rejected.
    function test_challenge_outOfRangeIndexRejected() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(5, bytes32(0));

        vm.prank(op2);
        vm.expectRevert(ShardOperatorRegistry.InvalidChallengeIndex.selector);
        registry.challengeCellsReport(shard1, 5);
    }

    // ============ C11 Batch A: challenge-lifecycle hardening ============

    /// @notice C11-AUDIT-3: voluntary deactivateShard must revert while a
    ///         pending report is unresolved. Otherwise operator escapes a
    ///         pending slash by zeroing their own stake before response window.
    function test_C11_deactivateShard_revertsWithPendingReport() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(100, bytes32(0));

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.PendingReportActive.selector);
        registry.deactivateShard();
    }

    /// @notice C11-AUDIT-2: deactivateStaleShard must revert while a pending
    ///         report is unresolved. Otherwise an accomplice reaps the shard
    ///         after 48h stale, zeroing stake and erasing any slash.
    function test_C11_deactivateStaleShard_revertsWithPendingReport() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);

        // Commit report, then go silent past the stale grace window.
        vm.prank(op1);
        registry.commitCellsReport(100, bytes32(0));
        vm.warp(block.timestamp + 49 hours);

        // op2 tries to reap op1's shard — must revert because of pending report.
        vm.prank(op2);
        vm.expectRevert(ShardOperatorRegistry.PendingReportActive.selector);
        registry.deactivateStaleShard(shard1);
    }

    /// @notice C11-AUDIT-2 positive path: once the challenge lifecycle resolves
    ///         (finalize after window), stale-reap works again.
    function test_C11_deactivateStaleShard_worksAfterReportResolved() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(100, bytes32(0));

        // Finalize the pending report normally — then go silent.
        vm.warp(block.timestamp + 1 hours + 1);
        registry.finalizeCellsReport(shard1);
        vm.warp(block.timestamp + 49 hours);

        vm.prank(op2);
        registry.deactivateStaleShard(shard1);
        assertFalse(registry.getShard(shard1).active, "reaped after resolved");
    }

    /// @notice C11-AUDIT-8: operator cannot challenge their own commit.
    ///         Prevents self-challenge + self-refute collusion that locks
    ///         out honest challengers for the full window.
    function test_C11_selfChallenge_rejected() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(5, bytes32(0));

        // op1 tries to challenge its own commit — rejected.
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.SelfChallenge.selector);
        registry.challengeCellsReport(shard1, 0);
    }

    /// @notice C11-AUDIT-9: only the shard operator may respond to a challenge.
    ///         An accomplice with the cellId data cannot refute on operator's behalf.
    function test_C11_nonOperatorCannotRespond() public {
        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, bytes32[] memory proof0, ) = _build2LeafTree(cellA, cellB);
        vault.setActive(cellA, true);

        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(2, root);

        vm.prank(op2);
        registry.challengeCellsReport(shard1, 0);

        // op3 (accomplice with knowledge of cellA) tries to refute — rejected.
        vm.prank(op3);
        vm.expectRevert(ShardOperatorRegistry.NotOperator.selector);
        registry.respondToChallenge(shard1, cellA, proof0);

        // Operator themselves can still respond successfully.
        vm.prank(op1);
        registry.respondToChallenge(shard1, cellA, proof0);
    }

    /// @notice C11-AUDIT-14: refute reverts if StateRentVault isn't wired.
    ///         Post-upgrade admin must call setStateRentVault before any
    ///         refute can succeed. Upgrade-path security enforced.
    function test_C11_respondToChallenge_revertsIfVaultUnset() public {
        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, bytes32[] memory proof0, ) = _build2LeafTree(cellA, cellB);
        vault.setActive(cellA, true);

        // Unset the vault to simulate post-upgrade, pre-setup state.
        vm.prank(owner);
        registry.setStateRentVault(address(0));

        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(2, root);

        vm.prank(op2);
        registry.challengeCellsReport(shard1, 0);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.VaultNotSet.selector);
        registry.respondToChallenge(shard1, cellA, proof0);
    }

    /// @notice C11-AUDIT-14: refute reverts if cellId is not active in vault.
    ///         Closes the "commit to any preimage" gap from C10-AUDIT-3:
    ///         operator can no longer commit fabricated cellIds.
    function test_C11_respondToChallenge_revertsIfCellInactive() public {
        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, bytes32[] memory proof0, ) = _build2LeafTree(cellA, cellB);
        // NOTE: cellA is NOT set active in the vault.

        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        vm.prank(op1);
        registry.commitCellsReport(2, root);

        vm.prank(op2);
        registry.challengeCellsReport(shard1, 0);

        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.InactiveCell.selector);
        registry.respondToChallenge(shard1, cellA, proof0);
    }

    /// @notice C11-AUDIT-7: deactivate paths must not revert if state has
    ///         drifted such that totalCellsServed < shard.cellsServed (e.g.,
    ///         a future upgrade bug corrupts the counter). Saturating subtract
    ///         lets operators reclaim stake even in that pathological case.
    function test_C11_deactivate_saturatesCellsServedUnderflow() public {
        vm.prank(op1);
        registry.registerShard(shard1, STAKE);
        _report(op1, 100);
        assertEq(registry.getShard(shard1).cellsServed, 100);
        assertEq(registry.totalCellsServed(), 100);

        // Force state drift: directly corrupt totalCellsServed so it's less
        // than shard.cellsServed. Storage slot for totalCellsServed is the
        // 10th declared state slot in ShardOperatorRegistry (after __gaps
        // inherited from base contracts it's slot 5 of the own storage —
        // easier to use stdstore targeting the public getter).
        stdstore
            .target(address(registry))
            .sig("totalCellsServed()")
            .checked_write(uint256(50));
        assertEq(registry.totalCellsServed(), 50);

        // Without saturation, this subtraction would underflow in 0.8.20 and
        // revert, trapping the operator. With AUDIT-7 fix it saturates to 0.
        vm.prank(op1);
        registry.deactivateShard();
        assertEq(registry.totalCellsServed(), 0);
        assertFalse(registry.getShard(shard1).active);
    }
}
