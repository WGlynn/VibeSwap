// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeStaking.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VibeStakingTest is Test {
    VibeStaking public staking;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address delegatee = address(0xDD);

    uint256 constant RATE = 0.001 ether; // 0.001 ETH/sec reward rate

    function setUp() public {
        VibeStaking impl = new VibeStaking();
        bytes memory initData = abi.encodeCall(VibeStaking.initialize, (address(this)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        staking = VibeStaking(payable(address(proxy)));

        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(address(this), 1000 ether);
    }

    function _createAndFundPool() internal returns (uint256 poolId) {
        poolId = staking.createPool(RATE);
        staking.fundPool{value: 100 ether}(poolId);
    }

    // ============ Pool Management ============

    function test_createPool() public {
        uint256 poolId = staking.createPool(RATE);
        assertEq(poolId, 0);
        assertEq(staking.getPoolCount(), 1);

        (uint256 rate, uint256 totalStaked, uint256 rawStaked, uint256 balance, bool paused) =
            staking.getPoolInfo(poolId);
        assertEq(rate, RATE);
        assertEq(totalStaked, 0);
        assertEq(rawStaked, 0);
        assertEq(balance, 0);
        assertFalse(paused);
    }

    function test_createMultiplePools() public {
        staking.createPool(RATE);
        staking.createPool(RATE * 2);
        assertEq(staking.getPoolCount(), 2);
    }

    function test_fundPool() public {
        uint256 poolId = staking.createPool(RATE);
        staking.fundPool{value: 50 ether}(poolId);

        (, , , uint256 balance, ) = staking.getPoolInfo(poolId);
        assertEq(balance, 50 ether);
    }

    function test_fundPoolAnyone() public {
        uint256 poolId = staking.createPool(RATE);

        vm.prank(alice);
        staking.fundPool{value: 10 ether}(poolId);

        (, , , uint256 balance, ) = staking.getPoolInfo(poolId);
        assertEq(balance, 10 ether);
    }

    function test_revertFundPoolZero() public {
        uint256 poolId = staking.createPool(RATE);

        vm.expectRevert(VibeStaking.ZeroAmount.selector);
        staking.fundPool{value: 0}(poolId);
    }

    function test_togglePoolPause() public {
        uint256 poolId = staking.createPool(RATE);
        staking.togglePoolPause(poolId);

        (, , , , bool paused) = staking.getPoolInfo(poolId);
        assertTrue(paused);

        staking.togglePoolPause(poolId);
        (, , , , paused) = staking.getPoolInfo(poolId);
        assertFalse(paused);
    }

    function test_setPoolRewardRate() public {
        uint256 poolId = staking.createPool(RATE);
        staking.setPoolRewardRate(poolId, RATE * 2);

        (uint256 rate, , , , ) = staking.getPoolInfo(poolId);
        assertEq(rate, RATE * 2);
    }

    function test_revertInvalidPool() public {
        vm.expectRevert(VibeStaking.InvalidPool.selector);
        staking.fundPool{value: 1 ether}(99);
    }

    function test_revertPoolCreationNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        staking.createPool(RATE);
    }

    // ============ Staking ============

    function test_stake30DayLock() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        (uint256 amount, uint256 effective, uint256 lockEnd, uint256 lockDuration, address delegate, ) =
            staking.getUserStake(poolId, alice);

        assertEq(amount, 10 ether);
        assertEq(effective, 10 ether); // 1x multiplier
        assertEq(lockEnd, block.timestamp + 30 days);
        assertEq(lockDuration, 30 days);
        assertEq(delegate, alice); // Self-delegated by default
    }

    function test_stake90DayLock() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 90 days);

        (, uint256 effective, , , , ) = staking.getUserStake(poolId, alice);
        assertEq(effective, 15 ether); // 1.5x multiplier
    }

    function test_stake180DayLock() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 180 days);

        (, uint256 effective, , , , ) = staking.getUserStake(poolId, alice);
        assertEq(effective, 20 ether); // 2x multiplier
    }

    function test_stake365DayLock() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 365 days);

        (, uint256 effective, , , , ) = staking.getUserStake(poolId, alice);
        assertEq(effective, 30 ether); // 3x multiplier
    }

    function test_revertInvalidLockTier() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        vm.expectRevert(VibeStaking.InvalidLockTier.selector);
        staking.stake{value: 10 ether}(poolId, 60 days);
    }

    function test_revertStakeZeroAmount() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        vm.expectRevert(VibeStaking.ZeroAmount.selector);
        staking.stake{value: 0}(poolId, 30 days);
    }

    function test_revertStakePausedPool() public {
        uint256 poolId = _createAndFundPool();
        staking.togglePoolPause(poolId);

        vm.prank(alice);
        vm.expectRevert(VibeStaking.PoolPaused.selector);
        staking.stake{value: 10 ether}(poolId, 30 days);
    }

    function test_stakeUpdatesPoolTotals() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 90 days);

        (, uint256 totalStaked, uint256 rawStaked, , ) = staking.getPoolInfo(poolId);
        assertEq(totalStaked, 15 ether); // 10 * 1.5x
        assertEq(rawStaked, 10 ether);
    }

    // ============ Unstaking ============

    function test_unstakeAfterLock() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        vm.warp(block.timestamp + 30 days);

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        staking.unstake(poolId);

        assertGt(alice.balance, balanceBefore + 10 ether - 1); // Principal + rewards
    }

    function test_earlyUnstake50PercentPenalty() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        // Warp 15 days (before lock ends)
        vm.warp(block.timestamp + 15 days);

        uint256 pendingBefore = staking.getPendingRewards(poolId, alice);
        assertGt(pendingBefore, 0);

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        staking.unstake(poolId);

        // Should get principal + 50% of rewards
        uint256 received = alice.balance - balanceBefore;
        assertGe(received, 10 ether); // At least principal
        // Received should be less than principal + full rewards
        assertLt(received, 10 ether + pendingBefore);
    }

    function test_unstakeClearsStake() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        staking.unstake(poolId);

        (uint256 amount, , , , , ) = staking.getUserStake(poolId, alice);
        assertEq(amount, 0);
    }

    function test_revertUnstakeNoStake() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        vm.expectRevert(VibeStaking.NoStake.selector);
        staking.unstake(poolId);
    }

    function test_earlyUnstakeForfeitedRewardsReturnToPool() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        vm.warp(block.timestamp + 15 days);

        (, , , uint256 balanceBefore, ) = staking.getPoolInfo(poolId);

        // Get pending rewards
        uint256 pending = staking.getPendingRewards(poolId, alice);

        vm.prank(alice);
        staking.unstake(poolId);

        (, , , uint256 balanceAfter, ) = staking.getPoolInfo(poolId);
        // Balance should have decreased by reward payout, but forfeited rewards added back
        // Net: balance decreased by (pending - forfeited), i.e., by half
        assertGt(balanceAfter, balanceBefore - pending);
    }

    // ============ Rewards ============

    function test_pendingRewardsAccrue() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        vm.warp(block.timestamp + 1 days);

        uint256 pending = staking.getPendingRewards(poolId, alice);
        assertGt(pending, 0);
    }

    function test_claimRewards() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        vm.warp(block.timestamp + 1 days);

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        staking.claimRewards(poolId);

        assertGt(alice.balance, balanceBefore);
    }

    function test_revertClaimNoStake() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        vm.expectRevert(VibeStaking.NoStake.selector);
        staking.claimRewards(poolId);
    }

    function test_revertClaimNoPendingRewards() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        // No time has passed, no rewards
        vm.prank(alice);
        vm.expectRevert(VibeStaking.NoPendingRewards.selector);
        staking.claimRewards(poolId);
    }

    function test_rewardsCappedByBalance() public {
        // Create pool with tiny funding
        uint256 poolId = staking.createPool(RATE);
        staking.fundPool{value: 0.001 ether}(poolId);

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        // Warp long enough that rewards would exceed funding
        vm.warp(block.timestamp + 30 days);

        uint256 pending = staking.getPendingRewards(poolId, alice);
        // Pending should be capped at pool balance
        assertLe(pending, 0.001 ether);
    }

    function test_higherMultiplierGetsMoreRewards() public {
        uint256 poolId = _createAndFundPool();

        // Alice: 30-day lock (1x)
        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        // Bob: 365-day lock (3x) — same raw amount
        vm.prank(bob);
        staking.stake{value: 10 ether}(poolId, 365 days);

        vm.warp(block.timestamp + 7 days);

        uint256 alicePending = staking.getPendingRewards(poolId, alice);
        uint256 bobPending = staking.getPendingRewards(poolId, bob);

        // Bob gets 3x the rewards (3x effective stake)
        assertGt(bobPending, alicePending);
        // Approximate 3:1 ratio
        assertApproxEqRel(bobPending, alicePending * 3, 0.01e18);
    }

    // ============ Auto-Compound ============

    function test_setAutoCompound() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        vm.prank(alice);
        staking.setAutoCompound(poolId, true);

        (, , , , , bool autoCompound) = staking.getUserStake(poolId, alice);
        assertTrue(autoCompound);
    }

    function test_autoCompoundIncreasesStake() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        vm.prank(alice);
        staking.setAutoCompound(poolId, true);

        vm.warp(block.timestamp + 1 days);

        (uint256 amountBefore, , , , , ) = staking.getUserStake(poolId, alice);

        vm.prank(alice);
        staking.claimRewards(poolId);

        (uint256 amountAfter, , , , , ) = staking.getUserStake(poolId, alice);
        assertGt(amountAfter, amountBefore, "Compound should increase staked amount");
    }

    function test_revertAutoCompoundNoStake() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        vm.expectRevert(VibeStaking.NoStake.selector);
        staking.setAutoCompound(poolId, true);
    }

    // ============ Delegation ============

    function test_selfDelegatedByDefault() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        (, , , , address delegate, ) = staking.getUserStake(poolId, alice);
        assertEq(delegate, alice);

        uint256 power = staking.getDelegatedPower(poolId, alice);
        assertEq(power, 10 ether); // 1x multiplier
    }

    function test_setDelegate() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 90 days);

        vm.prank(alice);
        staking.setDelegate(poolId, delegatee);

        (, , , , address delegate, ) = staking.getUserStake(poolId, alice);
        assertEq(delegate, delegatee);

        // Power moved from alice to delegatee
        assertEq(staking.getDelegatedPower(poolId, alice), 0);
        assertEq(staking.getDelegatedPower(poolId, delegatee), 15 ether); // 1.5x
    }

    function test_revertDelegateNoStake() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        vm.expectRevert(VibeStaking.NoStake.selector);
        staking.setDelegate(poolId, delegatee);
    }

    // ============ Emergency Withdraw ============

    function test_emergencyWithdraw() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 365 days);

        vm.warp(block.timestamp + 1 days); // Still locked

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        staking.emergencyWithdraw(poolId);

        // Gets principal back, no rewards
        assertEq(alice.balance, balanceBefore + 10 ether);

        (uint256 amount, , , , , ) = staking.getUserStake(poolId, alice);
        assertEq(amount, 0);
    }

    function test_emergencyWithdrawClearsDelegation() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        assertEq(staking.getDelegatedPower(poolId, alice), 10 ether);

        vm.prank(alice);
        staking.emergencyWithdraw(poolId);

        assertEq(staking.getDelegatedPower(poolId, alice), 0);
    }

    function test_revertEmergencyWithdrawNoStake() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        vm.expectRevert(VibeStaking.NoStake.selector);
        staking.emergencyWithdraw(poolId);
    }

    // ============ Views ============

    function test_getTotalStaked() public {
        uint256 poolId = _createAndFundPool();

        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);
        vm.prank(bob);
        staking.stake{value: 5 ether}(poolId, 30 days);

        assertEq(staking.getTotalStaked(poolId), 15 ether);
    }

    // ============ Integration ============

    function test_multiUserStakeClaimUnstake() public {
        uint256 poolId = _createAndFundPool();

        // Alice: 30-day lock
        vm.prank(alice);
        staking.stake{value: 10 ether}(poolId, 30 days);

        // Bob: 90-day lock
        vm.prank(bob);
        staking.stake{value: 10 ether}(poolId, 90 days);

        vm.warp(block.timestamp + 30 days);

        // Alice unstakes after lock
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        staking.unstake(poolId);
        uint256 aliceReceived = alice.balance - aliceBefore;
        assertGt(aliceReceived, 10 ether);

        // Bob claims rewards (still locked)
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        staking.claimRewards(poolId);
        uint256 bobReceived = bob.balance - bobBefore;
        assertGt(bobReceived, 0);
    }

    receive() external payable {}
}
