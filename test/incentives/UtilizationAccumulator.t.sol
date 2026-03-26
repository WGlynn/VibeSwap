// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/UtilizationAccumulator.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ UtilizationAccumulator Tests ============

contract UtilizationAccumulatorTest is Test {
    UtilizationAccumulator public accumulator;

    address public owner;
    address public authorized1;
    address public authorized2;
    address public alice;
    address public bob;
    address public carol;
    address public unauthorized;

    bytes32 public constant POOL_A = keccak256("pool-A");
    bytes32 public constant POOL_B = keccak256("pool-B");

    uint256 public constant EPOCH_DURATION = 1 hours;

    // ============ Events (re-declared for expectEmit) ============

    event BatchRecorded(bytes32 indexed poolId, uint256 indexed epochId, uint32 batchCount);
    event EpochAdvanced(uint256 indexed oldEpochId, uint256 indexed newEpochId, uint256 timestamp);
    event LPRegistered(bytes32 indexed poolId, address indexed lp);
    event LPDeregistered(bytes32 indexed poolId, address indexed lp);
    event LPSnapshotted(bytes32 indexed poolId, address indexed lp, uint128 liquidity);
    event AuthorizedUpdated(address indexed caller, bool status);
    event EpochDurationUpdated(uint256 oldDuration, uint256 newDuration);

    function setUp() public {
        owner = address(this);
        authorized1 = makeAddr("authorized1");
        authorized2 = makeAddr("authorized2");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        unauthorized = makeAddr("unauthorized");

        // Deploy behind UUPS proxy
        UtilizationAccumulator impl = new UtilizationAccumulator();
        bytes memory initData = abi.encodeWithSelector(
            UtilizationAccumulator.initialize.selector,
            owner,
            EPOCH_DURATION
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        accumulator = UtilizationAccumulator(address(proxy));

        // Authorize callers
        accumulator.setAuthorized(authorized1, true);
        accumulator.setAuthorized(authorized2, true);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(accumulator.owner(), owner);
    }

    function test_initialize_setsEpochDuration() public view {
        assertEq(accumulator.epochDuration(), EPOCH_DURATION);
    }

    function test_initialize_startsAtEpochZero() public view {
        assertEq(accumulator.currentEpochId(), 0);
    }

    function test_initialize_setsEpochStart() public view {
        assertEq(accumulator.currentEpochStart(), block.timestamp);
    }

    function test_initialize_revertsZeroOwner() public {
        UtilizationAccumulator impl = new UtilizationAccumulator();
        bytes memory initData = abi.encodeWithSelector(
            UtilizationAccumulator.initialize.selector,
            address(0),
            EPOCH_DURATION
        );
        vm.expectRevert(UtilizationAccumulator.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsZeroEpochDuration() public {
        UtilizationAccumulator impl = new UtilizationAccumulator();
        bytes memory initData = abi.encodeWithSelector(
            UtilizationAccumulator.initialize.selector,
            owner,
            0
        );
        vm.expectRevert(UtilizationAccumulator.InvalidEpochDuration.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        accumulator.initialize(owner, EPOCH_DURATION);
    }

    // ============ Authorization ============

    function test_setAuthorized_grantsAccess() public {
        address newCaller = makeAddr("newCaller");
        accumulator.setAuthorized(newCaller, true);
        assertTrue(accumulator.authorized(newCaller));
    }

    function test_setAuthorized_revokesAccess() public {
        accumulator.setAuthorized(authorized1, false);
        assertFalse(accumulator.authorized(authorized1));
    }

    function test_setAuthorized_emitsEvent() public {
        address newCaller = makeAddr("newCaller");
        vm.expectEmit(true, false, false, true);
        emit AuthorizedUpdated(newCaller, true);
        accumulator.setAuthorized(newCaller, true);
    }

    function test_setAuthorized_revertsZeroAddress() public {
        vm.expectRevert(UtilizationAccumulator.ZeroAddress.selector);
        accumulator.setAuthorized(address(0), true);
    }

    function test_setAuthorized_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        accumulator.setAuthorized(unauthorized, true);
    }

    // ============ Batch Settlement Recording ============

    function test_recordBatchSettlement_accumulatesVolume() public {
        vm.prank(authorized1);
        accumulator.recordBatchSettlement(POOL_A, 100e18, 95e18, 60e8, 40e8, 1);

        UtilizationAccumulator.EpochPoolData memory data =
            accumulator.getEpochPoolData(0, POOL_A);

        assertEq(data.totalVolumeIn, 100e18);
        assertEq(data.totalVolumeOut, 95e18);
        assertEq(data.buyVolume, 60e8);
        assertEq(data.sellVolume, 40e8);
        assertEq(data.batchCount, 1);
        assertEq(data.maxVolatilityTier, 1);
        assertFalse(data.finalized);
    }

    function test_recordBatchSettlement_accumulatesMultipleBatches() public {
        vm.startPrank(authorized1);
        accumulator.recordBatchSettlement(POOL_A, 100e18, 95e18, 60e8, 40e8, 1);
        accumulator.recordBatchSettlement(POOL_A, 200e18, 190e18, 120e8, 80e8, 2);
        vm.stopPrank();

        UtilizationAccumulator.EpochPoolData memory data =
            accumulator.getEpochPoolData(0, POOL_A);

        assertEq(data.totalVolumeIn, 300e18);
        assertEq(data.totalVolumeOut, 285e18);
        assertEq(data.buyVolume, 180e8);
        assertEq(data.sellVolume, 120e8);
        assertEq(data.batchCount, 2);
        assertEq(data.maxVolatilityTier, 2); // takes the max
    }

    function test_recordBatchSettlement_tracksMaxVolatilityTier() public {
        vm.startPrank(authorized1);
        accumulator.recordBatchSettlement(POOL_A, 10e18, 10e18, 5e8, 5e8, 3); // extreme
        accumulator.recordBatchSettlement(POOL_A, 10e18, 10e18, 5e8, 5e8, 1); // low
        vm.stopPrank();

        UtilizationAccumulator.EpochPoolData memory data =
            accumulator.getEpochPoolData(0, POOL_A);

        // maxVolatilityTier should stay at 3 (doesn't go down)
        assertEq(data.maxVolatilityTier, 3);
    }

    function test_recordBatchSettlement_separatePoolsSeparateData() public {
        vm.startPrank(authorized1);
        accumulator.recordBatchSettlement(POOL_A, 100e18, 90e18, 50e8, 50e8, 1);
        accumulator.recordBatchSettlement(POOL_B, 200e18, 180e18, 60e8, 40e8, 2);
        vm.stopPrank();

        UtilizationAccumulator.EpochPoolData memory dataA =
            accumulator.getEpochPoolData(0, POOL_A);
        UtilizationAccumulator.EpochPoolData memory dataB =
            accumulator.getEpochPoolData(0, POOL_B);

        assertEq(dataA.totalVolumeIn, 100e18);
        assertEq(dataB.totalVolumeIn, 200e18);
        assertEq(dataA.maxVolatilityTier, 1);
        assertEq(dataB.maxVolatilityTier, 2);
    }

    function test_recordBatchSettlement_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit BatchRecorded(POOL_A, 0, 1);
        vm.prank(authorized1);
        accumulator.recordBatchSettlement(POOL_A, 10e18, 10e18, 5e8, 5e8, 0);
    }

    function test_recordBatchSettlement_revertsUnauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(UtilizationAccumulator.Unauthorized.selector);
        accumulator.recordBatchSettlement(POOL_A, 10e18, 10e18, 5e8, 5e8, 0);
    }

    function test_recordBatchSettlement_ownerCanCall() public {
        // Owner is always authorized even without explicit setAuthorized
        accumulator.recordBatchSettlement(POOL_A, 10e18, 10e18, 5e8, 5e8, 0);

        UtilizationAccumulator.EpochPoolData memory data =
            accumulator.getEpochPoolData(0, POOL_A);
        assertEq(data.batchCount, 1);
    }

    function test_recordBatchSettlement_autoAdvancesEpoch() public {
        // Record in epoch 0
        vm.prank(authorized1);
        accumulator.recordBatchSettlement(POOL_A, 10e18, 10e18, 5e8, 5e8, 0);

        // Warp past epoch boundary
        vm.warp(block.timestamp + EPOCH_DURATION + 1);

        // Next batch auto-advances to epoch 1
        vm.prank(authorized1);
        accumulator.recordBatchSettlement(POOL_A, 20e18, 20e18, 10e8, 10e8, 0);

        assertEq(accumulator.currentEpochId(), 1);

        // Data lands in epoch 1
        UtilizationAccumulator.EpochPoolData memory data1 =
            accumulator.getEpochPoolData(1, POOL_A);
        assertEq(data1.totalVolumeIn, 20e18);
        assertEq(data1.batchCount, 1);

        // Epoch 0 data unchanged
        UtilizationAccumulator.EpochPoolData memory data0 =
            accumulator.getEpochPoolData(0, POOL_A);
        assertEq(data0.totalVolumeIn, 10e18);
    }

    // ============ LP Set Management ============

    function test_registerLP_addsToPool() public {
        vm.prank(authorized1);
        accumulator.registerLP(POOL_A, alice);

        address[] memory lps = accumulator.getPoolLPs(POOL_A);
        assertEq(lps.length, 1);
        assertEq(lps[0], alice);
        assertEq(accumulator.getPoolLPCount(POOL_A), 1);
    }

    function test_registerLP_multipleAddresses() public {
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        accumulator.registerLP(POOL_A, bob);
        accumulator.registerLP(POOL_A, carol);
        vm.stopPrank();

        address[] memory lps = accumulator.getPoolLPs(POOL_A);
        assertEq(lps.length, 3);
        assertEq(accumulator.getPoolLPCount(POOL_A), 3);
    }

    function test_registerLP_emitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit LPRegistered(POOL_A, alice);
        vm.prank(authorized1);
        accumulator.registerLP(POOL_A, alice);
    }

    function test_registerLP_revertsZeroAddress() public {
        vm.prank(authorized1);
        vm.expectRevert(UtilizationAccumulator.ZeroAddress.selector);
        accumulator.registerLP(POOL_A, address(0));
    }

    function test_registerLP_revertsDuplicate() public {
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        vm.expectRevert(UtilizationAccumulator.LPAlreadyRegistered.selector);
        accumulator.registerLP(POOL_A, alice);
        vm.stopPrank();
    }

    function test_registerLP_revertsUnauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(UtilizationAccumulator.Unauthorized.selector);
        accumulator.registerLP(POOL_A, alice);
    }

    function test_registerLP_separatePoolsSeparateSets() public {
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        accumulator.registerLP(POOL_B, bob);
        vm.stopPrank();

        assertEq(accumulator.getPoolLPCount(POOL_A), 1);
        assertEq(accumulator.getPoolLPCount(POOL_B), 1);

        address[] memory lpsA = accumulator.getPoolLPs(POOL_A);
        address[] memory lpsB = accumulator.getPoolLPs(POOL_B);
        assertEq(lpsA[0], alice);
        assertEq(lpsB[0], bob);
    }

    function test_deregisterLP_removesFromPool() public {
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        accumulator.deregisterLP(POOL_A, alice);
        vm.stopPrank();

        assertEq(accumulator.getPoolLPCount(POOL_A), 0);
    }

    function test_deregisterLP_swapAndPop_preservesOthers() public {
        // Register three LPs
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        accumulator.registerLP(POOL_A, bob);
        accumulator.registerLP(POOL_A, carol);

        // Remove middle one (bob was index 2, swaps with carol at index 3)
        // Actually: alice=index1, bob=index2, carol=index3
        // Removing bob: carol moves to bob's slot
        accumulator.deregisterLP(POOL_A, bob);
        vm.stopPrank();

        address[] memory lps = accumulator.getPoolLPs(POOL_A);
        assertEq(lps.length, 2);

        // Carol should have been swapped into bob's position
        // alice at [0], carol at [1]
        assertEq(lps[0], alice);
        assertEq(lps[1], carol);
    }

    function test_deregisterLP_removesLastElement() public {
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        accumulator.registerLP(POOL_A, bob);

        // Remove last element (no swap needed)
        accumulator.deregisterLP(POOL_A, bob);
        vm.stopPrank();

        address[] memory lps = accumulator.getPoolLPs(POOL_A);
        assertEq(lps.length, 1);
        assertEq(lps[0], alice);
    }

    function test_deregisterLP_clearsSnapshot() public {
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        accumulator.snapshotLP(POOL_A, alice, 1000e18);

        // Verify snapshot set
        assertEq(accumulator.getLPSnapshot(POOL_A, alice), 1000e18);

        accumulator.deregisterLP(POOL_A, alice);
        vm.stopPrank();

        // Snapshot cleared on deregister
        assertEq(accumulator.getLPSnapshot(POOL_A, alice), 0);
    }

    function test_deregisterLP_emitsEvent() public {
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);

        vm.expectEmit(true, true, false, false);
        emit LPDeregistered(POOL_A, alice);
        accumulator.deregisterLP(POOL_A, alice);
        vm.stopPrank();
    }

    function test_deregisterLP_revertsNotRegistered() public {
        vm.prank(authorized1);
        vm.expectRevert(UtilizationAccumulator.LPNotRegistered.selector);
        accumulator.deregisterLP(POOL_A, alice);
    }

    function test_deregisterLP_revertsUnauthorized() public {
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        vm.stopPrank();

        vm.prank(unauthorized);
        vm.expectRevert(UtilizationAccumulator.Unauthorized.selector);
        accumulator.deregisterLP(POOL_A, alice);
    }

    // ============ LP Snapshot ============

    function test_snapshotLP_recordsLiquidity() public {
        vm.prank(authorized1);
        accumulator.snapshotLP(POOL_A, alice, 5000e18);
        assertEq(accumulator.getLPSnapshot(POOL_A, alice), 5000e18);
    }

    function test_snapshotLP_overwritesPrevious() public {
        vm.startPrank(authorized1);
        accumulator.snapshotLP(POOL_A, alice, 5000e18);
        accumulator.snapshotLP(POOL_A, alice, 8000e18);
        vm.stopPrank();

        assertEq(accumulator.getLPSnapshot(POOL_A, alice), 8000e18);
    }

    function test_snapshotLP_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit LPSnapshotted(POOL_A, alice, 5000e18);
        vm.prank(authorized1);
        accumulator.snapshotLP(POOL_A, alice, 5000e18);
    }

    function test_snapshotLP_revertsZeroAddress() public {
        vm.prank(authorized1);
        vm.expectRevert(UtilizationAccumulator.ZeroAddress.selector);
        accumulator.snapshotLP(POOL_A, address(0), 5000e18);
    }

    function test_snapshotLP_revertsUnauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(UtilizationAccumulator.Unauthorized.selector);
        accumulator.snapshotLP(POOL_A, alice, 5000e18);
    }

    // ============ Epoch Management ============

    function test_advanceEpoch_incrementsEpochId() public {
        vm.warp(block.timestamp + EPOCH_DURATION);
        accumulator.advanceEpoch();
        assertEq(accumulator.currentEpochId(), 1);
    }

    function test_advanceEpoch_updatesEpochStart() public {
        uint256 start = accumulator.currentEpochStart();
        vm.warp(block.timestamp + EPOCH_DURATION);
        accumulator.advanceEpoch();
        assertEq(accumulator.currentEpochStart(), start + EPOCH_DURATION);
    }

    function test_advanceEpoch_emitsEvent() public {
        vm.warp(block.timestamp + EPOCH_DURATION);
        vm.expectEmit(true, true, false, true);
        emit EpochAdvanced(0, 1, block.timestamp);
        accumulator.advanceEpoch();
    }

    function test_advanceEpoch_permissionless() public {
        // Anyone can call advanceEpoch, even unauthorized
        vm.warp(block.timestamp + EPOCH_DURATION);
        vm.prank(unauthorized);
        accumulator.advanceEpoch();
        assertEq(accumulator.currentEpochId(), 1);
    }

    function test_advanceEpoch_revertsIfNotReady() public {
        vm.expectRevert(UtilizationAccumulator.EpochNotReady.selector);
        accumulator.advanceEpoch();
    }

    function test_advanceEpoch_revertsJustBeforeBoundary() public {
        vm.warp(block.timestamp + EPOCH_DURATION - 1);
        vm.expectRevert(UtilizationAccumulator.EpochNotReady.selector);
        accumulator.advanceEpoch();
    }

    function test_advanceEpoch_handlesTimeJump() public {
        // Skip 5 full epochs
        vm.warp(block.timestamp + EPOCH_DURATION * 5);
        accumulator.advanceEpoch();

        assertEq(accumulator.currentEpochId(), 5);
    }

    function test_advanceEpoch_handlesTimeJump_epochStartCorrect() public {
        uint256 start = accumulator.currentEpochStart();
        vm.warp(block.timestamp + EPOCH_DURATION * 3 + 100); // mid-epoch-3
        accumulator.advanceEpoch();

        // Should land at start + 3*duration (the start of the epoch we're in)
        assertEq(accumulator.currentEpochStart(), start + EPOCH_DURATION * 3);
        assertEq(accumulator.currentEpochId(), 3);
    }

    function test_advanceEpoch_multipleSequentialAdvances() public {
        vm.warp(block.timestamp + EPOCH_DURATION);
        accumulator.advanceEpoch();
        assertEq(accumulator.currentEpochId(), 1);

        vm.warp(block.timestamp + EPOCH_DURATION);
        accumulator.advanceEpoch();
        assertEq(accumulator.currentEpochId(), 2);

        vm.warp(block.timestamp + EPOCH_DURATION);
        accumulator.advanceEpoch();
        assertEq(accumulator.currentEpochId(), 3);
    }

    // ============ Epoch Duration Admin ============

    function test_setEpochDuration_updates() public {
        uint256 newDuration = 2 hours;
        accumulator.setEpochDuration(newDuration);
        assertEq(accumulator.epochDuration(), newDuration);
    }

    function test_setEpochDuration_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit EpochDurationUpdated(EPOCH_DURATION, 2 hours);
        accumulator.setEpochDuration(2 hours);
    }

    function test_setEpochDuration_revertsZero() public {
        vm.expectRevert(UtilizationAccumulator.InvalidEpochDuration.selector);
        accumulator.setEpochDuration(0);
    }

    function test_setEpochDuration_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        accumulator.setEpochDuration(2 hours);
    }

    // ============ View Functions ============

    function test_getEpochPoolData_returnsEmpty() public view {
        UtilizationAccumulator.EpochPoolData memory data =
            accumulator.getEpochPoolData(99, POOL_A);
        assertEq(data.totalVolumeIn, 0);
        assertEq(data.batchCount, 0);
        assertFalse(data.finalized);
    }

    function test_getPoolLPs_returnsEmptyForUnknownPool() public view {
        address[] memory lps = accumulator.getPoolLPs(keccak256("unknown"));
        assertEq(lps.length, 0);
    }

    function test_getPoolLPCount_returnsZeroForUnknownPool() public view {
        assertEq(accumulator.getPoolLPCount(keccak256("unknown")), 0);
    }

    // ============ Integration: Full Epoch Lifecycle ============

    function test_fullEpochLifecycle() public {
        // Setup: register LPs and snapshot
        vm.startPrank(authorized1);
        accumulator.registerLP(POOL_A, alice);
        accumulator.registerLP(POOL_A, bob);
        accumulator.snapshotLP(POOL_A, alice, 3000e18);
        accumulator.snapshotLP(POOL_A, bob, 7000e18);

        // Record batches during epoch 0
        accumulator.recordBatchSettlement(POOL_A, 100e18, 95e18, 60e8, 40e8, 1);
        accumulator.recordBatchSettlement(POOL_A, 200e18, 190e18, 110e8, 90e8, 2);
        vm.stopPrank();

        // Verify epoch 0 state
        UtilizationAccumulator.EpochPoolData memory data0 =
            accumulator.getEpochPoolData(0, POOL_A);
        assertEq(data0.totalVolumeIn, 300e18);
        assertEq(data0.totalVolumeOut, 285e18);
        assertEq(data0.batchCount, 2);
        assertEq(data0.maxVolatilityTier, 2);

        // Advance to epoch 1
        vm.warp(block.timestamp + EPOCH_DURATION);
        accumulator.advanceEpoch();

        // Epoch 0 data is still readable
        UtilizationAccumulator.EpochPoolData memory data0After =
            accumulator.getEpochPoolData(0, POOL_A);
        assertEq(data0After.totalVolumeIn, 300e18);

        // Epoch 1 starts fresh
        UtilizationAccumulator.EpochPoolData memory data1 =
            accumulator.getEpochPoolData(1, POOL_A);
        assertEq(data1.totalVolumeIn, 0);
        assertEq(data1.batchCount, 0);

        // LP set persists across epochs
        assertEq(accumulator.getPoolLPCount(POOL_A), 2);
        assertEq(accumulator.getLPSnapshot(POOL_A, alice), 3000e18);
        assertEq(accumulator.getLPSnapshot(POOL_A, bob), 7000e18);
    }

    // ============ Fuzz Tests ============

    function testFuzz_recordBatchSettlement_accumulatesCorrectly(
        uint128 vol1,
        uint128 vol2
    ) public {
        // Bound to prevent overflow in two additions
        vol1 = uint128(bound(vol1, 0, type(uint128).max / 2));
        vol2 = uint128(bound(vol2, 0, type(uint128).max / 2));

        vm.startPrank(authorized1);
        accumulator.recordBatchSettlement(POOL_A, vol1, vol1, 0, 0, 0);
        accumulator.recordBatchSettlement(POOL_A, vol2, vol2, 0, 0, 0);
        vm.stopPrank();

        UtilizationAccumulator.EpochPoolData memory data =
            accumulator.getEpochPoolData(0, POOL_A);
        assertEq(data.totalVolumeIn, uint128(vol1 + vol2));
        assertEq(data.batchCount, 2);
    }

    function testFuzz_registerDeregister_preservesSetIntegrity(uint8 numLPs) public {
        numLPs = uint8(bound(numLPs, 1, 20));

        address[] memory lps = new address[](numLPs);

        vm.startPrank(authorized1);
        for (uint8 i = 0; i < numLPs; i++) {
            lps[i] = address(uint160(1000 + i));
            accumulator.registerLP(POOL_A, lps[i]);
        }
        assertEq(accumulator.getPoolLPCount(POOL_A), numLPs);

        // Remove every other LP
        uint256 removeCount = 0;
        for (uint8 i = 0; i < numLPs; i += 2) {
            accumulator.deregisterLP(POOL_A, lps[i]);
            removeCount++;
        }
        vm.stopPrank();

        assertEq(accumulator.getPoolLPCount(POOL_A), numLPs - removeCount);
    }

    function testFuzz_epochAdvance_correctEpochAfterTimeJump(uint32 epochsToSkip) public {
        epochsToSkip = uint32(bound(epochsToSkip, 1, 10000));
        vm.warp(block.timestamp + uint256(epochsToSkip) * EPOCH_DURATION);
        accumulator.advanceEpoch();
        assertEq(accumulator.currentEpochId(), epochsToSkip);
    }
}
