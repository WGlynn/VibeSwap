// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeStream.sol";
import "../../contracts/financial/interfaces/IVibeStream.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockStreamFToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract VibeStreamFuzzTest is Test {
    VibeStream public stream;
    MockStreamFToken public token;

    address public alice; // sender
    address public bob;   // recipient

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        stream = new VibeStream();
        token = new MockStreamFToken("USD Coin", "USDC");

        token.mint(alice, 100_000_000 ether);
        vm.prank(alice);
        token.approve(address(stream), type(uint256).max);
    }

    // ============ Fuzz: streamed amount is linear ============

    function testFuzz_streamedAmountLinear(uint128 deposit, uint256 elapsed) public {
        deposit = uint128(bound(deposit, 1 ether, 10_000 ether));
        uint40 duration = 365 days;
        elapsed = bound(elapsed, 0, duration);

        uint256 start = block.timestamp;
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: deposit,
            startTime: uint40(start),
            endTime: uint40(start) + duration,
            cliffTime: 0,
            cancelable: true
        }));

        vm.warp(start + elapsed);

        uint128 streamed = stream.streamedAmount(streamId);
        uint256 expected = (uint256(deposit) * elapsed) / duration;

        assertEq(streamed, uint128(expected), "Streamed must be linear interpolation");
    }

    // ============ Fuzz: withdrawable never exceeds deposit ============

    function testFuzz_withdrawableNeverExceedsDeposit(uint128 deposit, uint256 elapsed) public {
        deposit = uint128(bound(deposit, 1 ether, 10_000 ether));
        uint40 duration = 365 days;
        elapsed = bound(elapsed, 0, duration * 2);

        uint256 start = block.timestamp;
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: deposit,
            startTime: uint40(start),
            endTime: uint40(start) + duration,
            cliffTime: 0,
            cancelable: true
        }));

        vm.warp(start + elapsed);

        uint128 withdrawable = stream.withdrawable(streamId);
        assertLe(withdrawable, deposit, "Withdrawable must never exceed deposit");
    }

    // ============ Fuzz: cliff blocks early withdrawal ============

    function testFuzz_cliffBlocksWithdrawal(uint128 deposit, uint256 cliffOffset) public {
        deposit = uint128(bound(deposit, 1 ether, 10_000 ether));
        uint40 duration = 365 days;
        cliffOffset = bound(cliffOffset, 1, duration - 1);

        uint256 start = block.timestamp;
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: deposit,
            startTime: uint40(start),
            endTime: uint40(start) + duration,
            cliffTime: uint40(start + cliffOffset),
            cancelable: true
        }));

        // Warp to just before cliff
        vm.warp(start + cliffOffset - 1);

        uint128 withdrawable = stream.withdrawable(streamId);
        assertEq(withdrawable, 0, "Before cliff: nothing withdrawable");

        // Warp to cliff
        vm.warp(start + cliffOffset);

        withdrawable = stream.withdrawable(streamId);
        assertGt(withdrawable, 0, "At cliff: should have withdrawable");
    }

    // ============ Fuzz: cancel returns correct amounts ============

    function testFuzz_cancelSplitsCorrectly(uint128 deposit, uint256 elapsed) public {
        deposit = uint128(bound(deposit, 1 ether, 10_000 ether));
        uint40 duration = 365 days;
        elapsed = bound(elapsed, 0, duration);

        uint256 start = block.timestamp;
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: deposit,
            startTime: uint40(start),
            endTime: uint40(start) + duration,
            cliffTime: 0,
            cancelable: true
        }));

        vm.warp(start + elapsed);

        uint128 streamed = stream.streamedAmount(streamId);
        uint256 aliceBefore = token.balanceOf(alice);

        vm.prank(alice);
        stream.cancel(streamId);

        uint256 aliceAfter = token.balanceOf(alice);
        uint128 refund = uint128(aliceAfter - aliceBefore);

        // refund = deposit - streamed
        assertEq(refund, deposit - streamed, "Refund must equal unstreamed portion");

        // Recipient's portion remains in contract
        IVibeStream.Stream memory s = stream.getStream(streamId);
        assertTrue(s.canceled, "Stream must be canceled");
        assertEq(s.depositAmount, streamed, "Deposit reduced to streamed amount");
    }

    // ============ Fuzz: withdraw exact amount works ============

    function testFuzz_withdrawExactAmount(uint128 deposit, uint256 elapsed, uint128 withdrawAmount) public {
        deposit = uint128(bound(deposit, 1 ether, 10_000 ether));
        uint40 duration = 365 days;
        elapsed = bound(elapsed, 1, duration);

        uint256 start = block.timestamp;
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: deposit,
            startTime: uint40(start),
            endTime: uint40(start) + duration,
            cliffTime: 0,
            cancelable: true
        }));

        vm.warp(start + elapsed);

        uint128 available = stream.withdrawable(streamId);
        if (available == 0) return;

        withdrawAmount = uint128(bound(withdrawAmount, 1, available));

        uint256 bobBefore = token.balanceOf(bob);

        vm.prank(bob);
        stream.withdraw(streamId, withdrawAmount, bob);

        assertEq(token.balanceOf(bob), bobBefore + withdrawAmount, "Bob receives exact withdraw amount");

        // Withdrawable reduced
        uint128 newAvailable = stream.withdrawable(streamId);
        assertEq(newAvailable, available - withdrawAmount, "Available reduced by withdrawn");
    }

    // ============ Fuzz: full stream completes at end time ============

    function testFuzz_fullStreamAtEnd(uint128 deposit) public {
        deposit = uint128(bound(deposit, 1 ether, 10_000 ether));
        uint40 duration = 365 days;

        uint256 start = block.timestamp;
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: deposit,
            startTime: uint40(start),
            endTime: uint40(start) + duration,
            cliffTime: 0,
            cancelable: true
        }));

        vm.warp(start + duration);

        uint128 streamed = stream.streamedAmount(streamId);
        assertEq(streamed, deposit, "At end time: full deposit streamed");

        uint128 withdrawable = stream.withdrawable(streamId);
        assertEq(withdrawable, deposit, "At end time: full deposit withdrawable");
    }
}
