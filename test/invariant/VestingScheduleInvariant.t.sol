// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VestingSchedule.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockVestingInvToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract VestingHandler is Test {
    VestingSchedule public vesting;
    MockVestingInvToken public token;
    address public owner;

    uint256 public ghost_totalFunded;
    uint256 public ghost_totalClaimed;
    uint256 public ghost_totalReturned; // from revocations
    uint256 public ghost_scheduleCount;

    address[5] public beneficiaries;

    constructor(VestingSchedule _vesting, MockVestingInvToken _token, address _owner) {
        vesting = _vesting;
        token = _token;
        owner = _owner;

        for (uint256 i; i < 5; i++) {
            beneficiaries[i] = address(uint160(0x2000 + i));
        }
    }

    function createSchedule(uint256 amount, uint256 benefIdx, uint256 duration) public {
        amount = bound(amount, 1 ether, 1_000_000 ether);
        benefIdx = benefIdx % 5;
        duration = bound(duration, 1 days, 4 * 365 days);

        token.mint(owner, amount);
        vm.startPrank(owner);
        token.approve(address(vesting), amount);
        try vesting.createSchedule(
            beneficiaries[benefIdx],
            address(token),
            amount,
            block.timestamp,
            0, // no cliff for simplicity in handler
            duration,
            true // revocable
        ) {
            ghost_totalFunded += amount;
            ghost_scheduleCount++;
        } catch {}
        vm.stopPrank();
    }

    function claimSchedule(uint256 scheduleIdx) public {
        if (ghost_scheduleCount == 0) return;
        scheduleIdx = scheduleIdx % ghost_scheduleCount;

        IVestingSchedule.Schedule memory s = vesting.getSchedule(scheduleIdx);
        if (s.beneficiary == address(0)) return;

        uint256 claimable = vesting.claimableAmount(scheduleIdx);
        if (claimable == 0) return;

        vm.prank(s.beneficiary);
        try vesting.claim(scheduleIdx) {
            ghost_totalClaimed += claimable;
        } catch {}
    }

    function revokeSchedule(uint256 scheduleIdx) public {
        if (ghost_scheduleCount == 0) return;
        scheduleIdx = scheduleIdx % ghost_scheduleCount;

        IVestingSchedule.Schedule memory s = vesting.getSchedule(scheduleIdx);
        if (s.revoked || !s.revocable) return;

        uint256 vested = vesting.vestedAmount(scheduleIdx);
        uint256 unvested = s.totalAmount - vested;

        vm.prank(owner);
        try vesting.revoke(scheduleIdx) {
            ghost_totalReturned += unvested;
        } catch {}
    }

    function advanceTime(uint256 time) public {
        time = bound(time, 1, 30 days);
        vm.warp(block.timestamp + time);
    }
}

// ============ Invariant Tests ============

contract VestingScheduleInvariantTest is StdInvariant, Test {
    MockVestingInvToken token;
    VestingSchedule vesting;
    VestingHandler handler;

    function setUp() public {
        token = new MockVestingInvToken();
        vesting = new VestingSchedule();

        handler = new VestingHandler(vesting, token, address(this));
        targetContract(address(handler));
    }

    // ============ Invariant: token conservation ============

    function invariant_tokenConservation() public view {
        uint256 inVesting = token.balanceOf(address(vesting));
        uint256 claimed = handler.ghost_totalClaimed();
        uint256 returned = handler.ghost_totalReturned();
        uint256 funded = handler.ghost_totalFunded();

        // funded = inVesting + claimed + returned
        assertEq(funded, inVesting + claimed + returned);
    }

    // ============ Invariant: claimed never exceeds funded ============

    function invariant_claimedPlusReturnedNeverExceedsFunded() public view {
        assertLe(
            handler.ghost_totalClaimed() + handler.ghost_totalReturned(),
            handler.ghost_totalFunded()
        );
    }

    // ============ Invariant: schedule count matches ghost ============

    function invariant_scheduleCountMatchesGhost() public view {
        assertEq(vesting.scheduleCount(), handler.ghost_scheduleCount());
    }

    // ============ Invariant: vested never exceeds totalAmount ============

    function invariant_vestedNeverExceedsTotal() public view {
        for (uint256 i; i < handler.ghost_scheduleCount() && i < 5; i++) {
            IVestingSchedule.Schedule memory s = vesting.getSchedule(i);
            uint256 vested = vesting.vestedAmount(i);
            assertLe(vested, s.totalAmount);
        }
    }

    // ============ Invariant: claimed never exceeds vested ============

    function invariant_claimedNeverExceedsVested() public view {
        for (uint256 i; i < handler.ghost_scheduleCount() && i < 5; i++) {
            IVestingSchedule.Schedule memory s = vesting.getSchedule(i);
            uint256 vested = vesting.vestedAmount(i);
            assertLe(s.claimed, vested);
        }
    }
}
