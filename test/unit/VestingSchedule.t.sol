// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VestingSchedule.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockVestingToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Unit Tests ============

contract VestingScheduleTest is Test {
    MockVestingToken token;
    VestingSchedule vesting;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant START = 1000;
    uint256 constant CLIFF = 365 days; // 1 year cliff
    uint256 constant DURATION = 4 * 365 days; // 4 year vesting
    uint256 constant AMOUNT = 1_000_000 ether;

    function setUp() public {
        token = new MockVestingToken();
        vesting = new VestingSchedule();

        token.mint(address(this), 10_000_000 ether);
        token.approve(address(vesting), type(uint256).max);
    }

    // ============ createSchedule ============

    function test_createSchedule() public {
        vm.warp(START);
        uint256 id = vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        assertEq(id, 0);
        assertEq(vesting.scheduleCount(), 1);

        IVestingSchedule.Schedule memory s = vesting.getSchedule(0);
        assertEq(s.beneficiary, alice);
        assertEq(s.token, address(token));
        assertEq(s.totalAmount, AMOUNT);
        assertEq(s.claimed, 0);
        assertEq(s.startTime, START);
        assertEq(s.cliffDuration, CLIFF);
        assertEq(s.vestingDuration, DURATION);
        assertTrue(s.revocable);
        assertFalse(s.revoked);
    }

    function test_createSchedule_multipleForSameBeneficiary() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), 500_000 ether, START, CLIFF, DURATION, true);
        vesting.createSchedule(alice, address(token), 300_000 ether, START, 0, 365 days, false);

        uint256[] memory ids = vesting.schedulesOf(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], 0);
        assertEq(ids[1], 1);
    }

    function test_createSchedule_revertsZeroBeneficiary() public {
        vm.expectRevert(IVestingSchedule.ZeroAddress.selector);
        vesting.createSchedule(address(0), address(token), AMOUNT, START, CLIFF, DURATION, true);
    }

    function test_createSchedule_revertsZeroToken() public {
        vm.expectRevert(IVestingSchedule.ZeroAddress.selector);
        vesting.createSchedule(alice, address(0), AMOUNT, START, CLIFF, DURATION, true);
    }

    function test_createSchedule_revertsZeroAmount() public {
        vm.expectRevert(IVestingSchedule.ZeroAmount.selector);
        vesting.createSchedule(alice, address(token), 0, START, CLIFF, DURATION, true);
    }

    function test_createSchedule_revertsZeroDuration() public {
        vm.expectRevert(IVestingSchedule.ZeroDuration.selector);
        vesting.createSchedule(alice, address(token), AMOUNT, START, 0, 0, true);
    }

    function test_createSchedule_revertsCliffExceedsVesting() public {
        vm.expectRevert(IVestingSchedule.CliffExceedsVesting.selector);
        vesting.createSchedule(alice, address(token), AMOUNT, START, DURATION + 1, DURATION, true);
    }

    function test_createSchedule_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);
    }

    // ============ vestedAmount ============

    function test_vestedAmount_beforeCliff() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + CLIFF - 1);
        assertEq(vesting.vestedAmount(0), 0);
    }

    function test_vestedAmount_atCliff() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + CLIFF);
        // At cliff: elapsed = CLIFF, vested = AMOUNT * CLIFF / DURATION = 25%
        uint256 expected = (AMOUNT * CLIFF) / DURATION;
        assertEq(vesting.vestedAmount(0), expected);
    }

    function test_vestedAmount_halfwayThrough() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + DURATION / 2);
        uint256 expected = AMOUNT / 2;
        assertEq(vesting.vestedAmount(0), expected);
    }

    function test_vestedAmount_fullyVested() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + DURATION);
        assertEq(vesting.vestedAmount(0), AMOUNT);
    }

    function test_vestedAmount_afterFullVesting() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + DURATION + 365 days);
        assertEq(vesting.vestedAmount(0), AMOUNT);
    }

    function test_vestedAmount_noCliff() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, 0, DURATION, true);

        // Vesting starts immediately (no cliff)
        vm.warp(START + DURATION / 4);
        assertEq(vesting.vestedAmount(0), AMOUNT / 4);
    }

    // ============ claim ============

    function test_claim_afterCliff() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + CLIFF);
        uint256 expected = (AMOUNT * CLIFF) / DURATION;

        vm.prank(alice);
        vesting.claim(0);

        assertEq(token.balanceOf(alice), expected);
        assertEq(vesting.claimableAmount(0), 0);
    }

    function test_claim_multipleTimes() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        // First claim at cliff
        vm.warp(START + CLIFF);
        vm.prank(alice);
        vesting.claim(0);
        uint256 firstClaim = token.balanceOf(alice);

        // Second claim halfway through
        vm.warp(START + DURATION / 2);
        vm.prank(alice);
        vesting.claim(0);
        uint256 secondClaim = token.balanceOf(alice) - firstClaim;

        assertGt(secondClaim, 0);
        assertEq(token.balanceOf(alice), AMOUNT / 2);
    }

    function test_claim_fullyVested() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + DURATION);
        vm.prank(alice);
        vesting.claim(0);

        assertEq(token.balanceOf(alice), AMOUNT);
    }

    function test_claim_revertsBeforeCliff() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + CLIFF - 1);
        vm.prank(alice);
        vm.expectRevert(IVestingSchedule.NothingToClaim.selector);
        vesting.claim(0);
    }

    function test_claim_revertsNotBeneficiary() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + DURATION);
        vm.prank(bob);
        vm.expectRevert(IVestingSchedule.NotBeneficiary.selector);
        vesting.claim(0);
    }

    function test_claim_revertsNothingNew() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + CLIFF);
        vm.prank(alice);
        vesting.claim(0);

        // Immediately claim again — nothing new
        vm.prank(alice);
        vm.expectRevert(IVestingSchedule.NothingToClaim.selector);
        vesting.claim(0);
    }

    // ============ revoke ============

    function test_revoke() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        // Revoke at 50% vested
        vm.warp(START + DURATION / 2);
        uint256 ownerBefore = token.balanceOf(address(this));
        vesting.revoke(0);

        IVestingSchedule.Schedule memory s = vesting.getSchedule(0);
        assertTrue(s.revoked);
        assertEq(s.totalAmount, AMOUNT / 2); // Reduced to vested amount

        // Unvested returned to owner
        assertEq(token.balanceOf(address(this)) - ownerBefore, AMOUNT / 2);
    }

    function test_revoke_beneficiaryCanStillClaim() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + DURATION / 2);
        vesting.revoke(0);

        // Alice can claim the vested portion
        vm.prank(alice);
        vesting.claim(0);

        assertEq(token.balanceOf(alice), AMOUNT / 2);
    }

    function test_revoke_beforeCliff() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + 100); // Before cliff
        uint256 ownerBefore = token.balanceOf(address(this));
        vesting.revoke(0);

        // All returned (nothing vested before cliff)
        assertEq(token.balanceOf(address(this)) - ownerBefore, AMOUNT);

        IVestingSchedule.Schedule memory s = vesting.getSchedule(0);
        assertEq(s.totalAmount, 0);
    }

    function test_revoke_revertsNotRevocable() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, false);

        vm.warp(START + DURATION / 2);
        vm.expectRevert(IVestingSchedule.NotRevocable.selector);
        vesting.revoke(0);
    }

    function test_revoke_revertsAlreadyRevoked() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + DURATION / 2);
        vesting.revoke(0);

        vm.expectRevert(IVestingSchedule.AlreadyRevoked.selector);
        vesting.revoke(0);
    }

    function test_revoke_onlyOwner() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.prank(alice);
        vm.expectRevert();
        vesting.revoke(0);
    }

    // ============ claimableAmount ============

    function test_claimableAmount_afterPartialClaim() public {
        vm.warp(START);
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        vm.warp(START + CLIFF);
        vm.prank(alice);
        vesting.claim(0);

        // Advance to 50%
        vm.warp(START + DURATION / 2);
        uint256 claimable = vesting.claimableAmount(0);
        uint256 vestedAtCliff = (AMOUNT * CLIFF) / DURATION;
        assertEq(claimable, AMOUNT / 2 - vestedAtCliff);
    }

    // ============ emergencyRecover ============

    function test_emergencyRecover() public {
        token.mint(address(vesting), 1000 ether);
        address recipient = makeAddr("recipient");

        vesting.emergencyRecover(address(token), 1000 ether, recipient);
        assertEq(token.balanceOf(recipient), 1000 ether);
    }

    // ============ Full Flow ============

    function test_fullFlow_teamVesting() public {
        vm.warp(START);

        // Create 4-year vest with 1-year cliff for Alice
        vesting.createSchedule(alice, address(token), AMOUNT, START, CLIFF, DURATION, true);

        // Before cliff: nothing
        vm.warp(START + 180 days);
        assertEq(vesting.claimableAmount(0), 0);

        // At cliff: 25% vested
        vm.warp(START + CLIFF);
        vm.prank(alice);
        vesting.claim(0);
        assertEq(token.balanceOf(alice), AMOUNT / 4);

        // At 2 years: 50% vested
        vm.warp(START + 2 * 365 days);
        vm.prank(alice);
        vesting.claim(0);
        assertEq(token.balanceOf(alice), AMOUNT / 2);

        // At 4 years: 100% vested
        vm.warp(START + DURATION);
        vm.prank(alice);
        vesting.claim(0);
        assertEq(token.balanceOf(alice), AMOUNT);
    }
}
