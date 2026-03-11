// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeStream.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock ============

contract MockStreamToken is ERC20 {
    constructor() ERC20("USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Tests ============

contract VibeStreamTest is Test {
    VibeStream public streamer;
    MockStreamToken public usdc;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address charlie = address(0xC1);
    address owner;

    uint40 constant START = 1000;
    uint40 constant END = 1000 + 365 days;
    uint128 constant DEPOSIT = 365_000e18; // ~1000e18 per day

    function setUp() public {
        owner = address(this);
        usdc = new MockStreamToken();
        streamer = new VibeStream();

        // Fund users
        usdc.mint(alice, 10_000_000e18);
        usdc.mint(bob, 10_000_000e18);
        usdc.mint(owner, 10_000_000e18);

        vm.prank(alice);
        usdc.approve(address(streamer), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(streamer), type(uint256).max);
        usdc.approve(address(streamer), type(uint256).max);
    }

    // ============ Helpers ============

    function _createStream(address sender, address recipient, bool cancelable) internal returns (uint256) {
        vm.prank(sender);
        return streamer.createStream(IVibeStream.CreateParams({
            recipient: recipient,
            token: address(usdc),
            depositAmount: DEPOSIT,
            startTime: START,
            endTime: END,
            cliffTime: 0,
            cancelable: cancelable
        }));
    }

    function _createStreamWithCliff(address sender, address recipient, uint40 cliff) internal returns (uint256) {
        vm.prank(sender);
        return streamer.createStream(IVibeStream.CreateParams({
            recipient: recipient,
            token: address(usdc),
            depositAmount: DEPOSIT,
            startTime: START,
            endTime: END,
            cliffTime: cliff,
            cancelable: true
        }));
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(streamer.name(), "VibeSwap Stream");
        assertEq(streamer.symbol(), "VSTREAM");
        assertEq(streamer.totalStreams(), 0);
    }

    // ============ Create Stream ============

    function test_createStream() public {
        uint256 id = _createStream(alice, bob, true);

        IVibeStream.Stream memory s = streamer.getStream(id);
        assertEq(s.sender, alice);
        assertEq(s.token, address(usdc));
        assertEq(s.depositAmount, DEPOSIT);
        assertEq(s.startTime, START);
        assertEq(s.endTime, END);
        assertTrue(s.cancelable);
        assertFalse(s.canceled);

        // Bob owns the NFT
        assertEq(streamer.ownerOf(id), bob);
        assertEq(streamer.totalStreams(), 1);
    }

    function test_createStreamPullsTokens() public {
        uint256 balBefore = usdc.balanceOf(alice);
        _createStream(alice, bob, true);
        assertEq(usdc.balanceOf(alice), balBefore - DEPOSIT);
    }

    function test_createStreamWithCliff() public {
        uint40 cliff = START + 90 days;
        uint256 id = _createStreamWithCliff(alice, bob, cliff);

        IVibeStream.Stream memory s = streamer.getStream(id);
        assertEq(s.cliffTime, cliff);
    }

    function test_revertCreateZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(IVibeStream.ZeroRecipient.selector);
        streamer.createStream(IVibeStream.CreateParams({
            recipient: address(0), token: address(usdc), depositAmount: DEPOSIT,
            startTime: START, endTime: END, cliffTime: 0, cancelable: true
        }));
    }

    function test_revertCreateZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IVibeStream.ZeroAmount.selector);
        streamer.createStream(IVibeStream.CreateParams({
            recipient: bob, token: address(usdc), depositAmount: 0,
            startTime: START, endTime: END, cliffTime: 0, cancelable: true
        }));
    }

    function test_revertCreateInvalidTimeRange() public {
        vm.prank(alice);
        vm.expectRevert(IVibeStream.InvalidTimeRange.selector);
        streamer.createStream(IVibeStream.CreateParams({
            recipient: bob, token: address(usdc), depositAmount: DEPOSIT,
            startTime: END, endTime: START, cliffTime: 0, cancelable: true
        }));
    }

    function test_revertCreateCliffOutOfRange() public {
        vm.prank(alice);
        vm.expectRevert(IVibeStream.CliffOutOfRange.selector);
        streamer.createStream(IVibeStream.CreateParams({
            recipient: bob, token: address(usdc), depositAmount: DEPOSIT,
            startTime: START, endTime: END, cliffTime: END + 1, cancelable: true
        }));
    }

    // ============ Streaming Amount ============

    function test_streamedBeforeStart() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START - 1);
        assertEq(streamer.streamedAmount(id), 0);
    }

    function test_streamedAtStart() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START);
        assertEq(streamer.streamedAmount(id), 0);
    }

    function test_streamedMidway() public {
        uint256 id = _createStream(alice, bob, true);
        uint256 midpoint = (uint256(START) + uint256(END)) / 2;
        vm.warp(midpoint);

        uint128 streamed = streamer.streamedAmount(id);
        assertApproxEqAbs(streamed, DEPOSIT / 2, 1e18);
    }

    function test_streamedAtEnd() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(END);
        assertEq(streamer.streamedAmount(id), DEPOSIT);
    }

    function test_streamedPastEnd() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(END + 100 days);
        assertEq(streamer.streamedAmount(id), DEPOSIT);
    }

    function test_streamedBeforeCliff() public {
        uint40 cliff = START + 90 days;
        uint256 id = _createStreamWithCliff(alice, bob, cliff);
        vm.warp(START + 45 days);
        assertEq(streamer.streamedAmount(id), 0);
    }

    function test_streamedAfterCliff() public {
        uint40 cliff = START + 90 days;
        uint256 id = _createStreamWithCliff(alice, bob, cliff);
        vm.warp(cliff);
        assertGt(streamer.streamedAmount(id), 0);
    }

    // ============ Withdraw ============

    function test_withdraw() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        uint128 available = streamer.withdrawable(id);
        assertGt(available, 0);

        uint256 balBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        streamer.withdraw(id, available, bob);
        assertEq(usdc.balanceOf(bob) - balBefore, available);
    }

    function test_withdrawPartial() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        uint128 available = streamer.withdrawable(id);
        uint128 half = available / 2;

        vm.prank(bob);
        streamer.withdraw(id, half, bob);

        assertEq(streamer.withdrawable(id), available - half);
    }

    function test_withdrawToOtherAddress() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        uint128 available = streamer.withdrawable(id);
        uint256 charlieBal = usdc.balanceOf(charlie);

        vm.prank(bob);
        streamer.withdraw(id, available, charlie);
        assertEq(usdc.balanceOf(charlie) - charlieBal, available);
    }

    function test_revertWithdrawZero() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.ZeroAmount.selector);
        streamer.withdraw(id, 0, bob);
    }

    function test_revertWithdrawZeroRecipient() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.ZeroRecipient.selector);
        streamer.withdraw(id, 1, address(0));
    }

    function test_revertWithdrawExceeded() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        uint128 available = streamer.withdrawable(id);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.WithdrawAmountExceeded.selector);
        streamer.withdraw(id, available + 1, bob);
    }

    function test_revertWithdrawNotOwner() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        vm.prank(charlie);
        vm.expectRevert();
        streamer.withdraw(id, 1, charlie);
    }

    function test_revertWithdrawNothingBeforeStart() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START - 1);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.NothingToWithdraw.selector);
        streamer.withdraw(id, 1, bob);
    }

    // ============ Cancel ============

    function test_cancel() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        uint128 streamed = streamer.streamedAmount(id);
        uint128 expectedRefund = DEPOSIT - streamed;
        uint256 aliceBal = usdc.balanceOf(alice);

        vm.prank(alice);
        streamer.cancel(id);

        IVibeStream.Stream memory s = streamer.getStream(id);
        assertTrue(s.canceled);
        assertEq(usdc.balanceOf(alice), aliceBal + expectedRefund);
    }

    function test_cancelRefundable() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        uint128 refundable = streamer.refundable(id);
        assertGt(refundable, 0);
        assertLt(refundable, DEPOSIT);
    }

    function test_canceledStreamFullyWithdrawable() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        vm.prank(alice);
        streamer.cancel(id);

        // After cancel, streamedAmount = depositAmount (reduced)
        uint128 available = streamer.withdrawable(id);
        assertGt(available, 0);

        vm.prank(bob);
        streamer.withdraw(id, available, bob);
        assertEq(streamer.withdrawable(id), 0);
    }

    function test_revertCancelNotSender() public {
        uint256 id = _createStream(alice, bob, true);
        vm.prank(bob);
        vm.expectRevert(IVibeStream.NotStreamSender.selector);
        streamer.cancel(id);
    }

    function test_revertCancelNotCancelable() public {
        uint256 id = _createStream(alice, bob, false);
        vm.prank(alice);
        vm.expectRevert(IVibeStream.StreamNotCancelable.selector);
        streamer.cancel(id);
    }

    function test_revertCancelTwice() public {
        uint256 id = _createStream(alice, bob, true);
        vm.prank(alice);
        streamer.cancel(id);
        vm.prank(alice);
        vm.expectRevert(IVibeStream.StreamAlreadyCanceled.selector);
        streamer.cancel(id);
    }

    function test_refundableZeroAfterCancel() public {
        uint256 id = _createStream(alice, bob, true);
        vm.prank(alice);
        streamer.cancel(id);
        assertEq(streamer.refundable(id), 0);
    }

    function test_refundableZeroNotCancelable() public {
        uint256 id = _createStream(alice, bob, false);
        assertEq(streamer.refundable(id), 0);
    }

    // ============ Burn ============

    function test_burnAfterComplete() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(END);

        // Withdraw everything
        uint128 available = streamer.withdrawable(id);
        vm.prank(bob);
        streamer.withdraw(id, available, bob);

        // Burn the NFT
        vm.prank(bob);
        streamer.burn(id);

        // NFT should not exist
        vm.expectRevert();
        streamer.ownerOf(id);
    }

    function test_burnCanceledAndDepleted() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        // Cancel
        vm.prank(alice);
        streamer.cancel(id);

        // Withdraw remaining earned
        uint128 available = streamer.withdrawable(id);
        vm.prank(bob);
        streamer.withdraw(id, available, bob);

        // Burn
        vm.prank(bob);
        streamer.burn(id);
    }

    function test_revertBurnNotDepleted() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.StreamNotDepleted.selector);
        streamer.burn(id);
    }

    function test_revertBurnActiveNotEnded() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        // Even if nothing to withdraw right now (all withdrawn), stream not ended
        uint128 avail = streamer.withdrawable(id);
        vm.prank(bob);
        streamer.withdraw(id, avail, bob);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.StreamNotDepleted.selector);
        streamer.burn(id);
    }

    // ============ NFT Transfer ============

    function test_nftTransferChangesRecipient() public {
        uint256 id = _createStream(alice, bob, true);
        vm.warp(START + 100 days);

        // Bob transfers NFT to Charlie
        vm.prank(bob);
        streamer.transferFrom(bob, charlie, id);

        assertEq(streamer.ownerOf(id), charlie);

        // Charlie can withdraw
        uint128 available = streamer.withdrawable(id);
        vm.prank(charlie);
        streamer.withdraw(id, available, charlie);
        assertGt(usdc.balanceOf(charlie), 0);
    }

    // ============ Tracking ============

    function test_getStreamsByOwner() public {
        _createStream(alice, bob, true);
        _createStream(alice, bob, true);

        uint256[] memory ids = streamer.getStreamsByOwner(bob);
        assertEq(ids.length, 2);
    }

    function test_getStreamsBySender() public {
        _createStream(alice, bob, true);
        _createStream(alice, charlie, true);

        uint256[] memory ids = streamer.getStreamsBySender(alice);
        assertEq(ids.length, 2);
    }

    // ============ FundingPool ============

    function _createPool() internal returns (uint256) {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        return streamer.createFundingPool(IVibeStream.CreateFundingPoolParams({
            token: address(usdc),
            depositAmount: 100_000e18,
            recipients: recipients,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp + 365 days)
        }));
    }

    function test_createFundingPool() public {
        uint256 poolId = _createPool();

        IVibeStream.FundingPool memory pool = streamer.getPool(poolId);
        assertEq(pool.creator, address(this));
        assertEq(pool.totalDeposit, 100_000e18);
        assertFalse(pool.canceled);

        address[] memory recipients = streamer.getPoolRecipients(poolId);
        assertEq(recipients.length, 2);
    }

    function test_revertCreatePoolNoRecipients() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(IVibeStream.NoRecipientsProvided.selector);
        streamer.createFundingPool(IVibeStream.CreateFundingPoolParams({
            token: address(usdc), depositAmount: 100_000e18,
            recipients: empty,
            startTime: uint40(block.timestamp), endTime: uint40(block.timestamp + 365 days)
        }));
    }

    function test_revertCreatePoolZeroAmount() public {
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        vm.expectRevert(IVibeStream.ZeroAmount.selector);
        streamer.createFundingPool(IVibeStream.CreateFundingPoolParams({
            token: address(usdc), depositAmount: 0,
            recipients: recipients,
            startTime: uint40(block.timestamp), endTime: uint40(block.timestamp + 365 days)
        }));
    }

    function test_revertCreatePoolDuplicateRecipient() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = alice;
        vm.expectRevert(IVibeStream.DuplicateRecipient.selector);
        streamer.createFundingPool(IVibeStream.CreateFundingPoolParams({
            token: address(usdc), depositAmount: 100_000e18,
            recipients: recipients,
            startTime: uint40(block.timestamp), endTime: uint40(block.timestamp + 365 days)
        }));
    }

    // ============ Conviction Signaling ============

    function test_signalConviction() public {
        uint256 poolId = _createPool();

        // Bob signals for Alice
        vm.prank(bob);
        streamer.signalConviction(poolId, alice, 1000e18);

        IVibeStream.VoterSignal memory sig = streamer.getVoterSignal(poolId, alice, bob);
        assertEq(sig.amount, 1000e18);

        vm.warp(block.timestamp + 30 days);
        uint256 conv = streamer.getConviction(poolId, alice);
        assertGt(conv, 0);
    }

    function test_revertSignalZero() public {
        uint256 poolId = _createPool();
        vm.prank(bob);
        vm.expectRevert(IVibeStream.ZeroAmount.selector);
        streamer.signalConviction(poolId, alice, 0);
    }

    function test_revertSignalNotRecipient() public {
        uint256 poolId = _createPool();
        vm.prank(bob);
        vm.expectRevert(IVibeStream.NotRecipient.selector);
        streamer.signalConviction(poolId, charlie, 1000e18);
    }

    function test_revertSignalDuplicate() public {
        uint256 poolId = _createPool();
        vm.prank(bob);
        streamer.signalConviction(poolId, alice, 1000e18);

        vm.prank(bob);
        vm.expectRevert(IVibeStream.SignalAlreadyExists.selector);
        streamer.signalConviction(poolId, alice, 500e18);
    }

    function test_removeSignal() public {
        uint256 poolId = _createPool();
        vm.prank(bob);
        streamer.signalConviction(poolId, alice, 1000e18);

        uint256 bobBal = usdc.balanceOf(bob);
        vm.prank(bob);
        streamer.removeSignal(poolId, alice);

        assertEq(usdc.balanceOf(bob), bobBal + 1000e18);

        IVibeStream.VoterSignal memory sig = streamer.getVoterSignal(poolId, alice, bob);
        assertEq(sig.amount, 0);
    }

    function test_revertRemoveNoSignal() public {
        uint256 poolId = _createPool();
        vm.prank(bob);
        vm.expectRevert(IVibeStream.NoSignalExists.selector);
        streamer.removeSignal(poolId, alice);
    }

    // ============ Pool Withdrawal ============

    function test_withdrawFromPool() public {
        uint256 poolId = _createPool();

        // Signal conviction: equal for both
        vm.prank(bob);
        streamer.signalConviction(poolId, alice, 1000e18);
        vm.prank(alice);
        streamer.signalConviction(poolId, bob, 1000e18);

        // Wait for tokens to stream
        vm.warp(block.timestamp + 180 days);

        uint128 aliceWithdrawable = streamer.getPoolWithdrawable(poolId, alice);
        assertGt(aliceWithdrawable, 0);

        uint256 aliceBal = usdc.balanceOf(alice);
        vm.prank(alice);
        streamer.withdrawFromPool(poolId);
        assertGt(usdc.balanceOf(alice), aliceBal);
    }

    function test_revertWithdrawNotRecipient() public {
        uint256 poolId = _createPool();
        vm.prank(charlie);
        vm.expectRevert(IVibeStream.NotRecipient.selector);
        streamer.withdrawFromPool(poolId);
    }

    function test_revertWithdrawNoConviction() public {
        uint256 poolId = _createPool();
        // No signals yet
        vm.prank(alice);
        vm.expectRevert(IVibeStream.NoConviction.selector);
        streamer.withdrawFromPool(poolId);
    }

    // ============ Pool Cancel ============

    function test_cancelPool() public {
        uint256 poolId = _createPool();
        vm.warp(block.timestamp + 100 days);

        uint256 ownerBal = usdc.balanceOf(owner);
        streamer.cancelPool(poolId);

        IVibeStream.FundingPool memory pool = streamer.getPool(poolId);
        assertTrue(pool.canceled);
        assertGt(usdc.balanceOf(owner), ownerBal);
    }

    function test_revertCancelPoolNotCreator() public {
        uint256 poolId = _createPool();
        vm.prank(alice);
        vm.expectRevert(IVibeStream.NotPoolCreator.selector);
        streamer.cancelPool(poolId);
    }

    function test_revertCancelPoolTwice() public {
        uint256 poolId = _createPool();
        streamer.cancelPool(poolId);
        vm.expectRevert(IVibeStream.PoolAlreadyCanceled.selector);
        streamer.cancelPool(poolId);
    }

    // ============ Pool Fairness ============

    function test_verifyPoolFairness() public {
        uint256 poolId = _createPool();

        // Equal conviction → fair
        vm.prank(bob);
        streamer.signalConviction(poolId, alice, 1000e18);
        vm.prank(alice);
        streamer.signalConviction(poolId, bob, 1000e18);

        vm.warp(block.timestamp + 30 days);

        (bool fair, ) = streamer.verifyPoolFairness(poolId, alice, bob);
        assertTrue(fair);
    }

    // ============ Full Stream Lifecycle ============

    function test_fullStreamLifecycle() public {
        // 1. Alice creates stream for Bob
        uint256 id = _createStream(alice, bob, true);

        // 2. Time passes, Bob withdraws periodically
        vm.warp(START + 100 days);
        uint128 w1 = streamer.withdrawable(id);
        vm.prank(bob);
        streamer.withdraw(id, w1, bob);

        vm.warp(START + 200 days);
        uint128 w2 = streamer.withdrawable(id);
        vm.prank(bob);
        streamer.withdraw(id, w2, bob);

        // 3. Stream ends, Bob withdraws remainder
        vm.warp(END);
        uint128 w3 = streamer.withdrawable(id);
        vm.prank(bob);
        streamer.withdraw(id, w3, bob);

        assertEq(streamer.withdrawable(id), 0);

        // 4. Total withdrawn = deposit
        assertEq(w1 + w2 + w3, DEPOSIT);

        // 5. Burn the depleted NFT
        vm.prank(bob);
        streamer.burn(id);
    }

    function test_fullPoolLifecycle() public {
        // 1. Create pool with Alice and Bob as recipients
        uint256 poolId = _createPool();

        // 2. Voters signal conviction (unequal: 2x for Alice)
        usdc.mint(charlie, 10_000e18);
        vm.prank(charlie);
        usdc.approve(address(streamer), type(uint256).max);

        vm.prank(charlie);
        streamer.signalConviction(poolId, alice, 2000e18);
        vm.prank(charlie);
        streamer.signalConviction(poolId, bob, 1000e18);

        // 3. Wait for tokens to stream
        vm.warp(block.timestamp + 365 days);

        // 4. Both withdraw — Alice should get ~2x Bob
        uint128 aliceW = streamer.getPoolWithdrawable(poolId, alice);
        uint128 bobW = streamer.getPoolWithdrawable(poolId, bob);
        assertApproxEqAbs(aliceW, bobW * 2, 1e18);

        vm.prank(alice);
        streamer.withdrawFromPool(poolId);
        vm.prank(bob);
        streamer.withdrawFromPool(poolId);

        // 5. Charlie removes signals to get stake back
        vm.prank(charlie);
        streamer.removeSignal(poolId, alice);
        vm.prank(charlie);
        streamer.removeSignal(poolId, bob);

        assertEq(usdc.balanceOf(charlie), 10_000e18); // started 10k, staked 3k, got 3k back
    }

    // ERC-721 receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
