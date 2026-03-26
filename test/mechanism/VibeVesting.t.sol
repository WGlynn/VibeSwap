// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeVesting.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibeVesting Tests ============

contract VibeVestingTest is Test {
    VibeVesting public vesting;

    address public owner;
    address public alice;
    address public bob;

    // ============ Events ============

    event ScheduleCreated(uint256 indexed id, address beneficiary, uint256 amount, uint256 duration);
    event TokensReleased(uint256 indexed id, uint256 amount);
    event ScheduleRevoked(uint256 indexed id, uint256 unreleased);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob   = makeAddr("bob");

        VibeVesting impl = new VibeVesting();
        bytes memory initData = abi.encodeCall(VibeVesting.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vesting = VibeVesting(payable(address(proxy)));

        // Fund owner so they can create schedules
        vm.deal(owner, 100 ether);
    }

    // ============ Helpers ============

    /// @dev Create a simple linear schedule for alice: 1 ether, 365-day duration, no cliff
    function _createLinearSchedule() internal returns (uint256 id) {
        id = vesting.createSchedule{value: 1 ether}(
            alice,
            0,          // no cliff
            365 days,
            VibeVesting.VestingType.LINEAR,
            false
        );
    }

    /// @dev Create a cliff+linear schedule for alice: 1 ether, 90-day cliff, 365-day total
    function _createCliffLinearSchedule() internal returns (uint256 id) {
        id = vesting.createSchedule{value: 1 ether}(
            alice,
            90 days,    // 90-day cliff
            365 days,
            VibeVesting.VestingType.CLIFF_LINEAR,
            false
        );
    }

    /// @dev Create a revocable schedule for alice
    function _createRevocableSchedule() internal returns (uint256 id) {
        id = vesting.createSchedule{value: 2 ether}(
            alice,
            0,
            365 days,
            VibeVesting.VestingType.LINEAR,
            true
        );
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(vesting.owner(), owner);
    }

    function test_initialize_zeroScheduleCount() public view {
        assertEq(vesting.scheduleCount(), 0);
    }

    // ============ Create Schedule ============

    function test_createSchedule_storesSchedule() public {
        uint256 id = _createLinearSchedule();
        assertEq(id, 0);
        assertEq(vesting.scheduleCount(), 1);

        VibeVesting.VestingSchedule memory s = vesting.getSchedule(0);
        assertEq(s.beneficiary,     alice);
        assertEq(s.totalAmount,     1 ether);
        assertEq(s.released,        0);
        assertEq(s.cliffDuration,   0);
        assertEq(s.vestingDuration, 365 days);
        assertFalse(s.revocable);
        assertFalse(s.revoked);
    }

    function test_createSchedule_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ScheduleCreated(0, alice, 1 ether, 365 days);
        _createLinearSchedule();
    }

    function test_createSchedule_updatesTotalAllocated() public {
        _createLinearSchedule();
        assertEq(vesting.totalAllocated(), 1 ether);
    }

    function test_createSchedule_addsToBeneficiaryList() public {
        _createLinearSchedule();
        uint256[] memory ids = vesting.getBeneficiarySchedules(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], 0);
    }

    function test_createSchedule_multipleForSameBeneficiary() public {
        _createLinearSchedule();
        _createCliffLinearSchedule();

        uint256[] memory ids = vesting.getBeneficiarySchedules(alice);
        assertEq(ids.length, 2);
    }

    function test_createSchedule_zeroValue_reverts() public {
        vm.expectRevert("Zero amount");
        vesting.createSchedule{value: 0}(alice, 0, 365 days, VibeVesting.VestingType.LINEAR, false);
    }

    function test_createSchedule_zeroBeneficiary_reverts() public {
        vm.expectRevert("Zero beneficiary");
        vesting.createSchedule{value: 1 ether}(
            address(0), 0, 365 days, VibeVesting.VestingType.LINEAR, false
        );
    }

    function test_createSchedule_zeroDuration_reverts() public {
        vm.expectRevert("Zero duration");
        vesting.createSchedule{value: 1 ether}(alice, 0, 0, VibeVesting.VestingType.LINEAR, false);
    }

    function test_createSchedule_notOwner_reverts() public {
        vm.prank(alice);
        vm.deal(alice, 1 ether);
        vm.expectRevert();
        vesting.createSchedule{value: 1 ether}(
            alice, 0, 365 days, VibeVesting.VestingType.LINEAR, false
        );
    }

    // ============ Vesting Logic ============

    function test_vestedAmount_zeroBeforeCliff() public {
        _createCliffLinearSchedule();
        assertEq(vesting.getVestedAmount(0), 0);
    }

    function test_vestedAmount_zeroAtCliffBoundary() public {
        _createCliffLinearSchedule();
        vm.warp(block.timestamp + 90 days - 1);
        assertEq(vesting.getVestedAmount(0), 0);
    }

    function test_vestedAmount_partialAfterHalfDuration() public {
        _createLinearSchedule(); // no cliff, 365-day duration
        vm.warp(block.timestamp + 365 days / 2);

        uint256 vested = vesting.getVestedAmount(0);
        // ~50% of 1 ether (may be slightly less due to integer division)
        assertApproxEqAbs(vested, 0.5 ether, 1e15);
    }

    function test_vestedAmount_fullAtDurationEnd() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 365 days);

        assertEq(vesting.getVestedAmount(0), 1 ether);
    }

    function test_vestedAmount_fullAfterDurationEnd() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 730 days); // 2 years

        assertEq(vesting.getVestedAmount(0), 1 ether);
    }

    // ============ Release ============

    function test_release_transfersTokens() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 365 days); // fully vested

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        vesting.release(0);

        assertEq(alice.balance, aliceBefore + 1 ether);
    }

    function test_release_updatesReleasedAmount() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 365 days / 2);

        vm.prank(alice);
        vesting.release(0);

        VibeVesting.VestingSchedule memory s = vesting.getSchedule(0);
        assertGt(s.released, 0);
        assertLt(s.released, 1 ether);
    }

    function test_release_updatesTotalReleased() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 365 days);

        vm.prank(alice);
        vesting.release(0);

        assertEq(vesting.totalReleased(), 1 ether);
    }

    function test_release_emitsEvent() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 365 days);

        vm.expectEmit(true, false, false, true);
        emit TokensReleased(0, 1 ether);
        vm.prank(alice);
        vesting.release(0);
    }

    function test_release_notBeneficiary_reverts() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 365 days);

        vm.prank(bob);
        vm.expectRevert("Not beneficiary");
        vesting.release(0);
    }

    function test_release_nothingToRelease_reverts() public {
        _createLinearSchedule();
        // No time has passed

        vm.prank(alice);
        vm.expectRevert("Nothing to release");
        vesting.release(0);
    }

    function test_release_beforeCliff_reverts() public {
        _createCliffLinearSchedule();
        vm.warp(block.timestamp + 89 days); // before cliff

        vm.prank(alice);
        vm.expectRevert("Nothing to release");
        vesting.release(0);
    }

    function test_release_cannotDoubleRelease() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 365 days);

        vm.prank(alice);
        vesting.release(0); // releases all

        vm.prank(alice);
        vm.expectRevert("Nothing to release");
        vesting.release(0); // nothing left
    }

    function test_release_incrementalWorks() public {
        _createLinearSchedule();

        // Release at 6 months
        vm.warp(block.timestamp + 182 days);
        vm.prank(alice);
        vesting.release(0);
        uint256 first = vesting.getSchedule(0).released;
        assertGt(first, 0);

        // Release at 12 months
        vm.warp(block.timestamp + 183 days); // total 365 days
        vm.prank(alice);
        vesting.release(0);
        uint256 total = vesting.getSchedule(0).released;
        assertEq(total, 1 ether);
        assertGt(total, first);
    }

    // ============ Revoke ============

    function test_revoke_marksRevoked() public {
        _createRevocableSchedule();
        vesting.revoke(0);

        assertTrue(vesting.getSchedule(0).revoked);
    }

    function test_revoke_returnsUnvestedToOwner() public {
        _createRevocableSchedule(); // 2 ether, 365-day linear

        uint256 ownerBefore = owner.balance;
        vesting.revoke(0); // at t=0: 0 vested, 2 ether unvested

        assertEq(owner.balance, ownerBefore + 2 ether);
    }

    function test_revoke_atHalfway_splitsCorrectly() public {
        _createRevocableSchedule(); // 2 ether
        vm.warp(block.timestamp + 365 days / 2);

        uint256 ownerBefore = owner.balance;
        uint256 aliceBefore = alice.balance;

        vesting.revoke(0);

        // ~1 ether goes to alice, ~1 ether goes back to owner
        assertApproxEqAbs(alice.balance, aliceBefore + 1 ether, 1e15);
        assertApproxEqAbs(owner.balance, ownerBefore + 1 ether, 1e15);
    }

    function test_revoke_emitsEvent() public {
        _createRevocableSchedule();

        vm.expectEmit(true, false, false, true);
        emit ScheduleRevoked(0, 2 ether);
        vesting.revoke(0);
    }

    function test_revoke_notRevocable_reverts() public {
        _createLinearSchedule(); // revocable = false

        vm.expectRevert("Not revocable");
        vesting.revoke(0);
    }

    function test_revoke_alreadyRevoked_reverts() public {
        _createRevocableSchedule();
        vesting.revoke(0);

        vm.expectRevert("Already revoked");
        vesting.revoke(0);
    }

    function test_revoke_notOwner_reverts() public {
        _createRevocableSchedule();

        vm.prank(alice);
        vm.expectRevert();
        vesting.revoke(0);
    }

    function test_release_revokedSchedule_reverts() public {
        _createRevocableSchedule();
        vesting.revoke(0);

        vm.prank(alice);
        vm.expectRevert("Revoked");
        vesting.release(0);
    }

    // ============ Releasable View ============

    function test_getReleasableAmount_zeroBeforeVesting() public {
        _createLinearSchedule();
        assertEq(vesting.getReleasableAmount(0), 0);
    }

    function test_getReleasableAmount_afterPartialRelease() public {
        _createLinearSchedule();
        vm.warp(block.timestamp + 365 days / 2);

        uint256 releasable = vesting.getReleasableAmount(0);
        assertGt(releasable, 0);

        vm.prank(alice);
        vesting.release(0);

        // After release, releasable should be ~0 (may accrue new tiny amount per second)
        assertApproxEqAbs(vesting.getReleasableAmount(0), 0, 1e12);
    }

    function test_getReleasableAmount_zeroIfRevoked() public {
        _createRevocableSchedule();
        vesting.revoke(0);

        assertEq(vesting.getReleasableAmount(0), 0);
    }

    // ============ Fuzz ============

    function testFuzz_createAndRelease_fullVesting(uint256 amount) public {
        amount = bound(amount, 1 wei, 50 ether);
        vm.deal(owner, amount);

        vesting.createSchedule{value: amount}(alice, 0, 365 days, VibeVesting.VestingType.LINEAR, false);

        vm.warp(block.timestamp + 365 days);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        vesting.release(0);

        assertEq(alice.balance, aliceBefore + amount);
    }

    function testFuzz_cliff_noReleaseBeforeCliff(uint256 cliff) public {
        cliff = bound(cliff, 1 days, 300 days);
        uint256 duration = 365 days;
        if (cliff >= duration) duration = cliff + 1 days;

        vesting.createSchedule{value: 1 ether}(
            alice, cliff, duration, VibeVesting.VestingType.CLIFF_LINEAR, false
        );

        vm.warp(block.timestamp + cliff - 1);

        assertEq(vesting.getReleasableAmount(0), 0);
    }
}
