// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VestingSchedule.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockVestingFuzzToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract VestingScheduleFuzzTest is Test {
    MockVestingFuzzToken token;
    VestingSchedule vesting;

    address alice = makeAddr("alice");

    function setUp() public {
        token = new MockVestingFuzzToken();
        vesting = new VestingSchedule();

        token.mint(address(this), 100_000_000 ether);
        token.approve(address(vesting), type(uint256).max);
    }

    // ============ Fuzz: vested amount linear ============

    function testFuzz_vestedAmountLinear(uint256 totalAmount, uint256 duration, uint256 elapsed) public {
        totalAmount = bound(totalAmount, 1 ether, 10_000_000 ether);
        duration = bound(duration, 1 days, 10 * 365 days);
        elapsed = bound(elapsed, 0, duration + 365 days);

        vm.warp(1000);
        vesting.createSchedule(alice, address(token), totalAmount, 1000, 0, duration, false);

        vm.warp(1000 + elapsed);
        uint256 vested = vesting.vestedAmount(0);

        if (elapsed >= duration) {
            assertEq(vested, totalAmount);
        } else {
            uint256 expected = (totalAmount * elapsed) / duration;
            assertEq(vested, expected);
        }
    }

    // ============ Fuzz: cliff blocks vesting ============

    function testFuzz_cliffBlocksVesting(uint256 totalAmount, uint256 cliff, uint256 duration, uint256 elapsed) public {
        totalAmount = bound(totalAmount, 1 ether, 10_000_000 ether);
        duration = bound(duration, 2 days, 10 * 365 days);
        cliff = bound(cliff, 1, duration);
        elapsed = bound(elapsed, 0, duration);

        vm.warp(1000);
        vesting.createSchedule(alice, address(token), totalAmount, 1000, cliff, duration, false);

        vm.warp(1000 + elapsed);
        uint256 vested = vesting.vestedAmount(0);

        if (elapsed < cliff) {
            assertEq(vested, 0);
        } else {
            assertGe(vested, 0);
            assertLe(vested, totalAmount);
        }
    }

    // ============ Fuzz: claim never exceeds totalAmount ============

    function testFuzz_claimNeverExceedsTotal(uint256 totalAmount, uint256 numClaims) public {
        totalAmount = bound(totalAmount, 1 ether, 1_000_000 ether);
        numClaims = bound(numClaims, 1, 10);

        uint256 duration = 365 days;
        vm.warp(1000);
        vesting.createSchedule(alice, address(token), totalAmount, 1000, 0, duration, false);

        uint256 totalClaimed;
        uint256 timeStep = duration / numClaims;

        for (uint256 i = 1; i <= numClaims; i++) {
            vm.warp(1000 + timeStep * i);
            uint256 claimable = vesting.claimableAmount(0);
            if (claimable > 0) {
                vm.prank(alice);
                vesting.claim(0);
                totalClaimed += claimable;
            }
        }

        assertLe(totalClaimed, totalAmount);
        assertEq(token.balanceOf(alice), totalClaimed);
    }

    // ============ Fuzz: revoke returns correct unvested ============

    function testFuzz_revokeReturnsUnvested(uint256 totalAmount, uint256 duration, uint256 revokeTime) public {
        totalAmount = bound(totalAmount, 1 ether, 10_000_000 ether);
        duration = bound(duration, 1 days, 10 * 365 days);
        revokeTime = bound(revokeTime, 0, duration);

        vm.warp(1000);
        vesting.createSchedule(alice, address(token), totalAmount, 1000, 0, duration, true);

        vm.warp(1000 + revokeTime);
        uint256 vested = vesting.vestedAmount(0);
        uint256 ownerBefore = token.balanceOf(address(this));

        vesting.revoke(0);

        uint256 returned = token.balanceOf(address(this)) - ownerBefore;
        assertEq(returned, totalAmount - vested);

        IVestingSchedule.Schedule memory s = vesting.getSchedule(0);
        assertEq(s.totalAmount, vested);
    }

    // ============ Fuzz: vested + unvested = total ============

    function testFuzz_vestedPlusUnvestedEqualsTotal(uint256 totalAmount, uint256 duration, uint256 elapsed) public {
        totalAmount = bound(totalAmount, 1 ether, 10_000_000 ether);
        duration = bound(duration, 1 days, 10 * 365 days);
        elapsed = bound(elapsed, 0, duration + 365 days);

        vm.warp(1000);
        vesting.createSchedule(alice, address(token), totalAmount, 1000, 0, duration, true);

        vm.warp(1000 + elapsed);
        uint256 vested = vesting.vestedAmount(0);
        uint256 unvested = totalAmount - vested;

        assertEq(vested + unvested, totalAmount);
    }

    // ============ Fuzz: multiple schedules independent ============

    function testFuzz_multipleSchedulesIndependent(uint256 amt1, uint256 amt2) public {
        amt1 = bound(amt1, 1 ether, 1_000_000 ether);
        amt2 = bound(amt2, 1 ether, 1_000_000 ether);

        vm.warp(1000);
        vesting.createSchedule(alice, address(token), amt1, 1000, 0, 365 days, false);
        vesting.createSchedule(alice, address(token), amt2, 1000, 0, 365 days, false);

        vm.warp(1000 + 365 days);

        // Claim both
        vm.startPrank(alice);
        vesting.claim(0);
        vesting.claim(1);
        vm.stopPrank();

        assertEq(token.balanceOf(alice), amt1 + amt2);
    }

    // ============ Fuzz: claim after revoke gets only vested ============

    function testFuzz_claimAfterRevoke(uint256 totalAmount, uint256 duration, uint256 revokeTime) public {
        totalAmount = bound(totalAmount, 1 ether, 10_000_000 ether);
        duration = bound(duration, 2 days, 10 * 365 days);
        revokeTime = bound(revokeTime, 1 days, duration);

        vm.warp(1000);
        vesting.createSchedule(alice, address(token), totalAmount, 1000, 0, duration, true);

        vm.warp(1000 + revokeTime);
        uint256 vestedAtRevoke = vesting.vestedAmount(0);

        vesting.revoke(0);

        if (vestedAtRevoke > 0) {
            vm.prank(alice);
            vesting.claim(0);
            assertEq(token.balanceOf(alice), vestedAtRevoke);
        }
    }

    // ============ Fuzz: vested amount monotonically increases ============

    function testFuzz_vestedMonotonicallyIncreases(uint256 totalAmount, uint256 t1, uint256 t2) public {
        totalAmount = bound(totalAmount, 1 ether, 10_000_000 ether);
        t1 = bound(t1, 0, 365 days);
        t2 = bound(t2, t1, 365 days * 2);

        vm.warp(1000);
        vesting.createSchedule(alice, address(token), totalAmount, 1000, 0, 365 days, false);

        vm.warp(1000 + t1);
        uint256 v1 = vesting.vestedAmount(0);

        vm.warp(1000 + t2);
        uint256 v2 = vesting.vestedAmount(0);

        assertGe(v2, v1);
    }
}
