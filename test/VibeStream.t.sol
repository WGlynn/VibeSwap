// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/financial/VibeStream.sol";
import "../contracts/financial/interfaces/IVibeStream.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStreamToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VibeStreamTest is Test {
    VibeStream public stream;
    MockStreamToken public token;
    MockStreamToken public tokenB;

    address public alice; // sender
    address public bob;   // recipient
    address public charlie;

    uint40 public constant STREAM_DURATION = 365 days;
    uint128 public constant STREAM_AMOUNT = 100 ether;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        // Deploy
        stream = new VibeStream();
        token = new MockStreamToken("USD Coin", "USDC");
        tokenB = new MockStreamToken("Wrapped ETH", "WETH");

        // Fund alice (sender)
        token.mint(alice, 10000 ether);
        tokenB.mint(alice, 10000 ether);
        token.mint(charlie, 10000 ether);

        // Approve VibeStream
        vm.prank(alice);
        token.approve(address(stream), type(uint256).max);
        vm.prank(alice);
        tokenB.approve(address(stream), type(uint256).max);
        vm.prank(charlie);
        token.approve(address(stream), type(uint256).max);
    }

    // ============ Helpers ============

    function _createDefaultStream() internal returns (uint256 streamId) {
        vm.prank(alice);
        streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION,
            cliffTime: 0,
            cancelable: true
        }));
    }

    function _createStreamWithCliff(uint40 cliffDuration) internal returns (uint256 streamId) {
        vm.prank(alice);
        streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION,
            cliffTime: uint40(block.timestamp) + cliffDuration,
            cancelable: true
        }));
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(stream.name(), "VibeSwap Stream");
        assertEq(stream.symbol(), "VSTREAM");
        assertEq(stream.totalStreams(), 0);
    }

    // ============ CreateStream Tests ============

    function test_createStream_mintsNFTAndStoresStream() public {
        uint256 balBefore = token.balanceOf(alice);

        uint256 streamId = _createDefaultStream();

        assertEq(streamId, 1);
        assertEq(stream.ownerOf(streamId), bob);
        assertEq(stream.totalStreams(), 1);
        assertEq(token.balanceOf(alice), balBefore - STREAM_AMOUNT);
        assertEq(token.balanceOf(address(stream)), STREAM_AMOUNT);

        IVibeStream.Stream memory s = stream.getStream(streamId);
        assertEq(s.sender, alice);
        assertEq(s.token, address(token));
        assertEq(s.depositAmount, STREAM_AMOUNT);
        assertEq(s.withdrawnAmount, 0);
        assertEq(s.cancelable, true);
        assertEq(s.canceled, false);
    }

    function test_createStream_futureStart() public {
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp + 30 days),
            endTime: uint40(block.timestamp + 30 days) + STREAM_DURATION,
            cliffTime: 0,
            cancelable: true
        }));

        // Nothing withdrawable yet (hasn't started)
        assertEq(stream.withdrawable(streamId), 0);
        assertEq(stream.streamedAmount(streamId), 0);
    }

    function test_createStream_withCliff() public {
        uint256 streamId = _createStreamWithCliff(90 days);

        IVibeStream.Stream memory s = stream.getStream(streamId);
        assertEq(s.cliffTime, uint40(block.timestamp) + 90 days);
    }

    function test_createStream_revertsZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(IVibeStream.ZeroRecipient.selector);
        stream.createStream(IVibeStream.CreateParams({
            recipient: address(0),
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION,
            cliffTime: 0,
            cancelable: true
        }));
    }

    function test_createStream_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IVibeStream.ZeroAmount.selector);
        stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: 0,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION,
            cliffTime: 0,
            cancelable: true
        }));
    }

    function test_createStream_revertsInvalidTimeRange() public {
        vm.prank(alice);
        vm.expectRevert(IVibeStream.InvalidTimeRange.selector);
        stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp + 100),
            endTime: uint40(block.timestamp + 50), // end before start
            cliffTime: 0,
            cancelable: true
        }));
    }

    function test_createStream_revertsCliffOutOfRange() public {
        vm.prank(alice);
        vm.expectRevert(IVibeStream.CliffOutOfRange.selector);
        stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION,
            cliffTime: uint40(block.timestamp) + STREAM_DURATION + 1, // cliff after end
            cancelable: true
        }));
    }

    // ============ StreamedAmount Tests ============

    function test_streamedAmount_beforeStart() public {
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp + 1 days),
            endTime: uint40(block.timestamp + 1 days) + STREAM_DURATION,
            cliffTime: 0,
            cancelable: true
        }));

        assertEq(stream.streamedAmount(streamId), 0);
    }

    function test_streamedAmount_atHalfway() public {
        uint256 streamId = _createDefaultStream();

        // Warp to halfway
        vm.warp(block.timestamp + STREAM_DURATION / 2);

        uint128 streamed = stream.streamedAmount(streamId);
        assertApproxEqRel(streamed, STREAM_AMOUNT / 2, 0.001e18); // within 0.1%
    }

    function test_streamedAmount_afterEnd() public {
        uint256 streamId = _createDefaultStream();

        // Warp past end
        vm.warp(block.timestamp + STREAM_DURATION + 1);

        assertEq(stream.streamedAmount(streamId), STREAM_AMOUNT);
    }

    function test_streamedAmount_withCliff_beforeCliff() public {
        uint256 streamId = _createStreamWithCliff(90 days);

        // Warp to halfway through cliff (45 days)
        vm.warp(block.timestamp + 45 days);

        assertEq(stream.streamedAmount(streamId), 0);
    }

    function test_streamedAmount_withCliff_afterCliff() public {
        uint256 streamId = _createStreamWithCliff(90 days);

        // Warp to just past cliff
        vm.warp(block.timestamp + 90 days);

        uint128 streamed = stream.streamedAmount(streamId);
        // Should be ~90/365 of deposit (linear from start, not cliff)
        uint128 expected = uint128((uint256(STREAM_AMOUNT) * 90 days) / STREAM_DURATION);
        assertApproxEqRel(streamed, expected, 0.001e18);
    }

    // ============ Withdraw Tests ============

    function test_withdraw_partialAmount() public {
        uint256 streamId = _createDefaultStream();

        vm.warp(block.timestamp + STREAM_DURATION / 2);

        uint128 available = stream.withdrawable(streamId);
        uint128 half = available / 2;

        uint256 balBefore = token.balanceOf(bob);

        vm.prank(bob);
        stream.withdraw(streamId, half, bob);

        assertEq(token.balanceOf(bob), balBefore + half);

        // Should still have remaining available
        assertApproxEqAbs(stream.withdrawable(streamId), available - half, 1);
    }

    function test_withdraw_fullAvailable() public {
        uint256 streamId = _createDefaultStream();

        vm.warp(block.timestamp + STREAM_DURATION / 4);

        uint128 available = stream.withdrawable(streamId);
        assertGt(available, 0);

        vm.prank(bob);
        stream.withdraw(streamId, available, bob);

        assertEq(stream.withdrawable(streamId), 0);
    }

    function test_withdraw_revertsNotOwner() public {
        uint256 streamId = _createDefaultStream();

        vm.warp(block.timestamp + STREAM_DURATION / 2);

        vm.prank(charlie);
        vm.expectRevert();
        stream.withdraw(streamId, 1 ether, charlie);
    }

    function test_withdraw_revertsNothingToWithdraw() public {
        // Future start — nothing streamed
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp + 30 days),
            endTime: uint40(block.timestamp + 30 days) + STREAM_DURATION,
            cliffTime: 0,
            cancelable: true
        }));

        vm.prank(bob);
        vm.expectRevert(IVibeStream.NothingToWithdraw.selector);
        stream.withdraw(streamId, 1, bob);
    }

    function test_withdraw_revertsExceedsAvailable() public {
        uint256 streamId = _createDefaultStream();

        vm.warp(block.timestamp + STREAM_DURATION / 4);

        uint128 available = stream.withdrawable(streamId);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.WithdrawAmountExceeded.selector);
        stream.withdraw(streamId, available + 1, bob);
    }

    // ============ Cancel Tests ============

    function test_cancel_midStream() public {
        uint256 streamId = _createDefaultStream();

        vm.warp(block.timestamp + STREAM_DURATION / 2);

        uint128 streamedBefore = stream.streamedAmount(streamId);
        uint256 senderBalBefore = token.balanceOf(alice);

        vm.prank(alice);
        stream.cancel(streamId);

        // Sender gets unstreamed portion
        uint128 expectedRefund = STREAM_AMOUNT - streamedBefore;
        assertEq(token.balanceOf(alice), senderBalBefore + expectedRefund);

        // Stream is canceled
        IVibeStream.Stream memory s = stream.getStream(streamId);
        assertTrue(s.canceled);
        assertEq(s.depositAmount, streamedBefore);

        // Recipient can still withdraw earned portion
        uint128 available = stream.withdrawable(streamId);
        assertEq(available, streamedBefore);

        vm.prank(bob);
        stream.withdraw(streamId, available, bob);
        assertEq(token.balanceOf(bob), available);
    }

    function test_cancel_beforeStart() public {
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp + 30 days),
            endTime: uint40(block.timestamp + 30 days) + STREAM_DURATION,
            cliffTime: 0,
            cancelable: true
        }));

        uint256 senderBalBefore = token.balanceOf(alice);

        vm.prank(alice);
        stream.cancel(streamId);

        // Full refund (nothing streamed yet)
        assertEq(token.balanceOf(alice), senderBalBefore + STREAM_AMOUNT);
    }

    function test_cancel_revertsNotCancelable() public {
        vm.prank(alice);
        uint256 streamId = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION,
            cliffTime: 0,
            cancelable: false // not cancelable
        }));

        vm.prank(alice);
        vm.expectRevert(IVibeStream.StreamNotCancelable.selector);
        stream.cancel(streamId);
    }

    function test_cancel_revertsNotSender() public {
        uint256 streamId = _createDefaultStream();

        // Bob (recipient/NFT holder) cannot cancel
        vm.prank(bob);
        vm.expectRevert(IVibeStream.NotStreamSender.selector);
        stream.cancel(streamId);
    }

    function test_cancel_revertsAlreadyCanceled() public {
        uint256 streamId = _createDefaultStream();

        vm.prank(alice);
        stream.cancel(streamId);

        vm.prank(alice);
        vm.expectRevert(IVibeStream.StreamAlreadyCanceled.selector);
        stream.cancel(streamId);
    }

    // ============ Transfer Tests ============

    function test_transfer_newHolderCanWithdraw() public {
        uint256 streamId = _createDefaultStream();

        vm.warp(block.timestamp + STREAM_DURATION / 2);

        // Bob transfers to charlie
        vm.prank(bob);
        stream.transferFrom(bob, charlie, streamId);

        assertEq(stream.ownerOf(streamId), charlie);

        // Charlie can withdraw
        uint128 available = stream.withdrawable(streamId);
        assertGt(available, 0);

        uint256 charlieBefore = token.balanceOf(charlie);

        vm.prank(charlie);
        stream.withdraw(streamId, available, charlie);

        assertEq(token.balanceOf(charlie), charlieBefore + available);
    }

    function test_transfer_updatesOwnerTracking() public {
        uint256 streamId = _createDefaultStream();

        assertEq(stream.getStreamsByOwner(bob).length, 1);
        assertEq(stream.getStreamsByOwner(charlie).length, 0);

        vm.prank(bob);
        stream.transferFrom(bob, charlie, streamId);

        assertEq(stream.getStreamsByOwner(bob).length, 0);
        assertEq(stream.getStreamsByOwner(charlie).length, 1);
        assertEq(stream.getStreamsByOwner(charlie)[0], streamId);

        // Sender tracking unchanged
        assertEq(stream.getStreamsBySender(alice).length, 1);
    }

    // ============ Burn Tests ============

    function test_burn_afterFullWithdrawal() public {
        uint256 streamId = _createDefaultStream();

        // Warp past end
        vm.warp(block.timestamp + STREAM_DURATION + 1);

        // Withdraw everything
        vm.prank(bob);
        stream.withdraw(streamId, STREAM_AMOUNT, bob);

        // Burn
        vm.prank(bob);
        stream.burn(streamId);

        // NFT no longer exists
        vm.expectRevert();
        stream.ownerOf(streamId);

        assertEq(stream.getStreamsByOwner(bob).length, 0);
    }

    function test_burn_revertsIfNotDepleted() public {
        uint256 streamId = _createDefaultStream();

        // Stream just started — not depleted
        vm.prank(bob);
        vm.expectRevert(IVibeStream.StreamNotDepleted.selector);
        stream.burn(streamId);
    }

    function test_burn_revertsIfNotFullyWithdrawn() public {
        uint256 streamId = _createDefaultStream();

        // Warp past end but don't withdraw
        vm.warp(block.timestamp + STREAM_DURATION + 1);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.StreamNotDepleted.selector);
        stream.burn(streamId);
    }

    // ============ View Function Tests ============

    function test_refundable() public {
        uint256 streamId = _createDefaultStream();

        vm.warp(block.timestamp + STREAM_DURATION / 4);

        uint128 ref = stream.refundable(streamId);
        // ~75% should be refundable
        assertApproxEqRel(ref, (STREAM_AMOUNT * 3) / 4, 0.01e18);
    }

    function test_refundable_zeroAfterCancel() public {
        uint256 streamId = _createDefaultStream();

        vm.prank(alice);
        stream.cancel(streamId);

        assertEq(stream.refundable(streamId), 0);
    }

    function test_getStreamsBySender() public {
        _createDefaultStream();
        _createDefaultStream();

        uint256[] memory senderStreams = stream.getStreamsBySender(alice);
        assertEq(senderStreams.length, 2);
        assertEq(senderStreams[0], 1);
        assertEq(senderStreams[1], 2);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // Create stream
        uint256 streamId = _createDefaultStream();
        assertEq(stream.totalStreams(), 1);

        // Withdraw at 25%
        vm.warp(block.timestamp + STREAM_DURATION / 4);
        uint128 w1 = stream.withdrawable(streamId);
        assertGt(w1, 0);
        vm.prank(bob);
        stream.withdraw(streamId, w1, bob);

        // Withdraw at 50%
        vm.warp(block.timestamp + STREAM_DURATION / 4);
        uint128 w2 = stream.withdrawable(streamId);
        assertGt(w2, 0);
        vm.prank(bob);
        stream.withdraw(streamId, w2, bob);

        // Withdraw at 75%
        vm.warp(block.timestamp + STREAM_DURATION / 4);
        uint128 w3 = stream.withdrawable(streamId);
        assertGt(w3, 0);
        vm.prank(bob);
        stream.withdraw(streamId, w3, bob);

        // Final withdrawal after end
        vm.warp(block.timestamp + STREAM_DURATION / 4 + 1);
        uint128 w4 = stream.withdrawable(streamId);
        assertGt(w4, 0);
        vm.prank(bob);
        stream.withdraw(streamId, w4, bob);

        // Total withdrawn should equal deposit
        assertEq(w1 + w2 + w3 + w4, STREAM_AMOUNT);
        assertEq(token.balanceOf(bob), STREAM_AMOUNT);

        // Burn
        vm.prank(bob);
        stream.burn(streamId);

        vm.expectRevert();
        stream.ownerOf(streamId);
    }

    function test_vestingWithCliff() public {
        // Stream 1: Cancel BEFORE cliff → full refund
        uint256 id1 = _createStreamWithCliff(90 days);

        vm.warp(block.timestamp + 45 days); // halfway through cliff

        uint256 senderBal = token.balanceOf(alice);
        vm.prank(alice);
        stream.cancel(id1);

        // Full refund — nothing streamed before cliff
        assertEq(token.balanceOf(alice), senderBal + STREAM_AMOUNT);

        IVibeStream.Stream memory s1 = stream.getStream(id1);
        assertEq(s1.depositAmount, 0); // nothing earned
        assertEq(stream.withdrawable(id1), 0);

        // Stream 2: Cancel AFTER cliff → proportional split
        uint256 id2 = _createStreamWithCliff(90 days);
        uint40 startTime = uint40(block.timestamp);

        vm.warp(block.timestamp + 180 days); // well past cliff

        uint128 streamedBefore = stream.streamedAmount(id2);
        assertGt(streamedBefore, 0);

        senderBal = token.balanceOf(alice);
        vm.prank(alice);
        stream.cancel(id2);

        uint128 refunded = uint128(token.balanceOf(alice) - senderBal);
        assertEq(refunded, STREAM_AMOUNT - streamedBefore);

        // Bob can withdraw earned portion
        uint128 bobCanGet = stream.withdrawable(id2);
        assertEq(bobCanGet, streamedBefore);

        vm.prank(bob);
        stream.withdraw(id2, bobCanGet, bob);
    }

    // ============ FundingPool Helpers ============

    address public dave;
    address public eve;

    function _setupPoolActors() internal {
        dave = makeAddr("dave");
        eve = makeAddr("eve");

        // Fund voters
        token.mint(bob, 10000 ether);
        token.mint(dave, 10000 ether);
        token.mint(eve, 10000 ether);

        vm.prank(bob);
        token.approve(address(stream), type(uint256).max);
        vm.prank(dave);
        token.approve(address(stream), type(uint256).max);
        vm.prank(eve);
        token.approve(address(stream), type(uint256).max);
    }

    function _createDefaultPool() internal returns (uint256 poolId) {
        address[] memory recipients = new address[](2);
        recipients[0] = bob;
        recipients[1] = charlie;

        vm.prank(alice);
        poolId = stream.createFundingPool(IVibeStream.CreateFundingPoolParams({
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            recipients: recipients,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION
        }));
    }

    // ============ FundingPool Tests ============

    function test_createFundingPool() public {
        _setupPoolActors();
        uint256 balBefore = token.balanceOf(alice);

        uint256 poolId = _createDefaultPool();

        assertEq(poolId, type(uint256).max);
        assertEq(token.balanceOf(alice), balBefore - STREAM_AMOUNT);

        IVibeStream.FundingPool memory p = stream.getPool(poolId);
        assertEq(p.creator, alice);
        assertEq(p.token, address(token));
        assertEq(p.totalDeposit, STREAM_AMOUNT);
        assertEq(p.totalWithdrawn, 0);
        assertEq(p.canceled, false);

        address[] memory recipients = stream.getPoolRecipients(poolId);
        assertEq(recipients.length, 2);
        assertEq(recipients[0], bob);
        assertEq(recipients[1], charlie);

        uint256[] memory creatorPools = stream.getPoolsBySender(alice);
        assertEq(creatorPools.length, 1);
        assertEq(creatorPools[0], poolId);
    }

    function test_createFundingPool_revertsNoRecipients() public {
        address[] memory recipients = new address[](0);

        vm.prank(alice);
        vm.expectRevert(IVibeStream.NoRecipientsProvided.selector);
        stream.createFundingPool(IVibeStream.CreateFundingPoolParams({
            token: address(token),
            depositAmount: STREAM_AMOUNT,
            recipients: recipients,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION
        }));
    }

    function test_signalConviction() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        uint256 daveBefore = token.balanceOf(dave);

        vm.prank(dave);
        stream.signalConviction(poolId, bob, 10 ether);

        assertEq(token.balanceOf(dave), daveBefore - 10 ether);

        IVibeStream.VoterSignal memory sig = stream.getVoterSignal(poolId, bob, dave);
        assertEq(sig.amount, 10 ether);
        assertEq(sig.signalTime, uint40(block.timestamp));

        // Conviction accrues over time — warp forward to verify
        vm.warp(block.timestamp + 1);
        assertGt(stream.getConviction(poolId, bob), 0);
    }

    function test_signalConviction_revertsNotRecipient() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        vm.prank(dave);
        vm.expectRevert(IVibeStream.NotRecipient.selector);
        stream.signalConviction(poolId, dave, 10 ether); // dave is not a recipient
    }

    function test_signalConviction_revertsAlreadyExists() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        vm.prank(dave);
        stream.signalConviction(poolId, bob, 10 ether);

        vm.prank(dave);
        vm.expectRevert(IVibeStream.SignalAlreadyExists.selector);
        stream.signalConviction(poolId, bob, 5 ether);
    }

    function test_removeSignal() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        vm.prank(dave);
        stream.signalConviction(poolId, bob, 10 ether);

        uint256 daveBefore = token.balanceOf(dave);

        vm.prank(dave);
        stream.removeSignal(poolId, bob);

        assertEq(token.balanceOf(dave), daveBefore + 10 ether);

        IVibeStream.VoterSignal memory sig = stream.getVoterSignal(poolId, bob, dave);
        assertEq(sig.amount, 0);
    }

    function test_removeSignal_revertsNoSignal() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        vm.prank(dave);
        vm.expectRevert(IVibeStream.NoSignalExists.selector);
        stream.removeSignal(poolId, bob);
    }

    function test_conviction_growsOverTime() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        vm.prank(dave);
        stream.signalConviction(poolId, bob, 10 ether);

        uint256 conv1 = stream.getConviction(poolId, bob);

        vm.warp(block.timestamp + 30 days);

        uint256 conv2 = stream.getConviction(poolId, bob);

        assertGt(conv2, conv1);
    }

    function test_withdrawFromPool_proportional() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        // Dave signals 20 ether for bob, 10 ether for charlie
        vm.prank(dave);
        stream.signalConviction(poolId, bob, 20 ether);
        vm.prank(dave);
        stream.signalConviction(poolId, charlie, 10 ether);

        // Warp to halfway through stream
        vm.warp(block.timestamp + STREAM_DURATION / 2);

        uint128 bobWithdrawable = stream.getPoolWithdrawable(poolId, bob);
        uint128 charlieWithdrawable = stream.getPoolWithdrawable(poolId, charlie);

        // Bob should get ~2x what Charlie gets (2:1 conviction ratio)
        assertApproxEqRel(uint256(bobWithdrawable), uint256(charlieWithdrawable) * 2, 0.01e18);

        uint256 bobBefore = token.balanceOf(bob);
        uint256 charlieBefore = token.balanceOf(charlie);

        vm.prank(bob);
        stream.withdrawFromPool(poolId);

        vm.prank(charlie);
        stream.withdrawFromPool(poolId);

        assertEq(token.balanceOf(bob) - bobBefore, bobWithdrawable);
        assertEq(token.balanceOf(charlie) - charlieBefore, charlieWithdrawable);
    }

    function test_withdrawFromPool_multipleWithdrawals() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        vm.prank(dave);
        stream.signalConviction(poolId, bob, 10 ether);

        vm.prank(dave);
        stream.signalConviction(poolId, charlie, 10 ether);

        // First withdrawal at 25%
        vm.warp(block.timestamp + STREAM_DURATION / 4);
        uint256 bobBefore = token.balanceOf(bob);
        vm.prank(bob);
        stream.withdrawFromPool(poolId);
        uint256 w1 = token.balanceOf(bob) - bobBefore;
        assertGt(w1, 0);

        // Second withdrawal at 75%
        vm.warp(block.timestamp + STREAM_DURATION / 2);
        bobBefore = token.balanceOf(bob);
        vm.prank(bob);
        stream.withdrawFromPool(poolId);
        uint256 w2 = token.balanceOf(bob) - bobBefore;
        assertGt(w2, 0);

        // Third withdrawal at 100%
        vm.warp(block.timestamp + STREAM_DURATION);
        bobBefore = token.balanceOf(bob);
        vm.prank(bob);
        stream.withdrawFromPool(poolId);
        uint256 w3 = token.balanceOf(bob) - bobBefore;
        assertGt(w3, 0);

        // Total should be ~50% of deposit (equal conviction split with charlie)
        assertApproxEqRel(w1 + w2 + w3, uint256(STREAM_AMOUNT) / 2, 0.01e18);
    }

    function test_withdrawFromPool_revertsNoConviction() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        // No one has signaled
        vm.warp(block.timestamp + STREAM_DURATION / 2);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.NoConviction.selector);
        stream.withdrawFromPool(poolId);
    }

    function test_cancelPool() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        vm.prank(dave);
        stream.signalConviction(poolId, bob, 10 ether);

        vm.warp(block.timestamp + STREAM_DURATION / 2);

        uint256 aliceBefore = token.balanceOf(alice);

        vm.prank(alice);
        stream.cancelPool(poolId);

        IVibeStream.FundingPool memory p = stream.getPool(poolId);
        assertTrue(p.canceled);

        // Creator gets ~50% refund (unstreamed)
        uint256 refund = token.balanceOf(alice) - aliceBefore;
        assertApproxEqRel(refund, uint256(STREAM_AMOUNT) / 2, 0.01e18);
    }

    function test_cancelPool_revertsNotCreator() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        vm.prank(bob);
        vm.expectRevert(IVibeStream.NotPoolCreator.selector);
        stream.cancelPool(poolId);
    }

    function test_verifyPoolFairness() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        // Equal stakes for both recipients
        vm.prank(dave);
        stream.signalConviction(poolId, bob, 10 ether);
        vm.prank(dave);
        stream.signalConviction(poolId, charlie, 10 ether);

        vm.warp(block.timestamp + STREAM_DURATION / 2);

        (bool fair, uint256 deviation) = stream.verifyPoolFairness(poolId, bob, charlie);
        assertTrue(fair);
        assertEq(deviation, 0);
    }

    function test_convictionShift() public {
        _setupPoolActors();
        uint256 poolId = _createDefaultPool();

        // Initial: dave signals 10 for bob, 10 for charlie (equal)
        vm.prank(dave);
        stream.signalConviction(poolId, bob, 10 ether);
        vm.prank(dave);
        stream.signalConviction(poolId, charlie, 10 ether);

        // Warp to 25%
        vm.warp(block.timestamp + STREAM_DURATION / 4);

        // Bob withdraws at equal conviction
        vm.prank(bob);
        stream.withdrawFromPool(poolId);

        // Now eve adds 30 ether signal for charlie (shifts conviction toward charlie)
        vm.prank(eve);
        stream.signalConviction(poolId, charlie, 30 ether);

        // Warp to 75%
        vm.warp(block.timestamp + STREAM_DURATION / 2);

        // Charlie now has more conviction, should get proportionally more
        uint128 bobW = stream.getPoolWithdrawable(poolId, bob);
        uint128 charlieW = stream.getPoolWithdrawable(poolId, charlie);

        // Charlie should have more withdrawable than bob
        assertGt(charlieW, bobW);
    }

    // ============ FundingPool Integration Tests ============

    function test_fundingPool_fullLifecycle() public {
        _setupPoolActors();

        // Create pool
        uint256 poolId = _createDefaultPool();

        // Dave signals for bob, eve signals for charlie
        vm.prank(dave);
        stream.signalConviction(poolId, bob, 20 ether);
        vm.prank(eve);
        stream.signalConviction(poolId, charlie, 10 ether);

        // Warp to 50%
        vm.warp(block.timestamp + STREAM_DURATION / 2);

        // Both withdraw
        vm.prank(bob);
        stream.withdrawFromPool(poolId);
        vm.prank(charlie);
        stream.withdrawFromPool(poolId);

        // Verify fairness
        (bool fair,) = stream.verifyPoolFairness(poolId, bob, charlie);
        assertTrue(fair);

        // Warp to end
        vm.warp(block.timestamp + STREAM_DURATION);

        // Final withdrawals
        vm.prank(bob);
        stream.withdrawFromPool(poolId);
        vm.prank(charlie);
        stream.withdrawFromPool(poolId);

        // Bob got ~2/3, Charlie got ~1/3
        IVibeStream.FundingPool memory p = stream.getPool(poolId);
        assertApproxEqRel(p.totalWithdrawn, STREAM_AMOUNT, 0.01e18);

        // Remove signals — voters get stake back
        uint256 daveBefore = token.balanceOf(dave);
        vm.prank(dave);
        stream.removeSignal(poolId, bob);
        assertEq(token.balanceOf(dave), daveBefore + 20 ether);

        uint256 eveBefore = token.balanceOf(eve);
        vm.prank(eve);
        stream.removeSignal(poolId, charlie);
        assertEq(token.balanceOf(eve), eveBefore + 10 ether);
    }

    function test_fundingPool_multipleVoters() public {
        _setupPoolActors();

        // 3 recipients: bob, charlie, dave
        address[] memory recipients = new address[](3);
        recipients[0] = bob;
        recipients[1] = charlie;
        recipients[2] = dave;

        vm.prank(alice);
        uint256 poolId = stream.createFundingPool(IVibeStream.CreateFundingPoolParams({
            token: address(token),
            depositAmount: 300 ether,
            recipients: recipients,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + STREAM_DURATION
        }));

        // Eve signals 30 for bob, 20 for charlie, 10 for dave
        vm.prank(eve);
        stream.signalConviction(poolId, bob, 30 ether);
        vm.prank(eve);
        stream.signalConviction(poolId, charlie, 20 ether);
        vm.prank(eve);
        stream.signalConviction(poolId, dave, 10 ether);

        // Warp to end
        vm.warp(block.timestamp + STREAM_DURATION + 1);

        // All withdraw
        vm.prank(bob);
        uint128 bobAmt = stream.withdrawFromPool(poolId);
        vm.prank(charlie);
        uint128 charlieAmt = stream.withdrawFromPool(poolId);
        vm.prank(dave);
        uint128 daveAmt = stream.withdrawFromPool(poolId);

        // Proportional: bob ~150, charlie ~100, dave ~50
        assertApproxEqRel(bobAmt, 150 ether, 0.01e18);
        assertApproxEqRel(charlieAmt, 100 ether, 0.01e18);
        assertApproxEqRel(daveAmt, 50 ether, 0.01e18);

        // Total distributed equals deposit
        assertApproxEqAbs(uint256(bobAmt) + charlieAmt + daveAmt, 300 ether, 3);
    }

    // ============ Existing Integration Tests ============

    function test_multipleStreamsSameRecipient() public {
        // Alice streams USDC to Bob
        vm.prank(alice);
        uint256 id1 = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: 50 ether,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + 30 days,
            cliffTime: 0,
            cancelable: true
        }));

        // Alice streams WETH to Bob
        vm.prank(alice);
        uint256 id2 = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(tokenB),
            depositAmount: 10 ether,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + 60 days,
            cliffTime: 0,
            cancelable: false
        }));

        // Charlie streams USDC to Bob
        vm.prank(charlie);
        uint256 id3 = stream.createStream(IVibeStream.CreateParams({
            recipient: bob,
            token: address(token),
            depositAmount: 200 ether,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + 365 days,
            cliffTime: uint40(block.timestamp) + 30 days,
            cancelable: true
        }));

        // Bob owns 3 streams
        uint256[] memory bobStreams = stream.getStreamsByOwner(bob);
        assertEq(bobStreams.length, 3);
        assertEq(stream.totalStreams(), 3);

        // Alice created 2, Charlie created 1
        assertEq(stream.getStreamsBySender(alice).length, 2);
        assertEq(stream.getStreamsBySender(charlie).length, 1);

        // Warp 15 days — stream 1 half done, stream 2 quarter done, stream 3 before cliff
        vm.warp(block.timestamp + 15 days);

        uint128 w1 = stream.withdrawable(id1);
        uint128 w2 = stream.withdrawable(id2);
        uint128 w3 = stream.withdrawable(id3);

        assertApproxEqRel(w1, 25 ether, 0.01e18);  // 50% of 50
        assertApproxEqRel(w2, 2.5 ether, 0.01e18); // 25% of 10
        assertEq(w3, 0); // before cliff

        // Bob withdraws from each
        vm.startPrank(bob);
        stream.withdraw(id1, w1, bob);
        stream.withdraw(id2, w2, bob);
        vm.stopPrank();

        assertApproxEqRel(token.balanceOf(bob), 25 ether, 0.01e18);
        assertApproxEqRel(tokenB.balanceOf(bob), 2.5 ether, 0.01e18);
    }
}
