// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeStaking.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VibeStaking Fuzz Tests
 * @notice Comprehensive fuzz testing for staking invariants:
 *         lock tiers, multipliers, delegation, reward accrual, early unstake penalties.
 */
contract VibeStakingFuzzTest is Test {
    VibeStaking public staking;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;

    uint256 public poolId;

    uint256 constant PRECISION = 1e18;
    uint256 constant BPS = 10_000;

    // Lock tiers
    uint256 constant TIER_30 = 30 days;
    uint256 constant TIER_90 = 90 days;
    uint256 constant TIER_180 = 180 days;
    uint256 constant TIER_365 = 365 days;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        // Deploy staking via UUPS proxy
        VibeStaking impl = new VibeStaking();
        bytes memory initData = abi.encodeWithSelector(VibeStaking.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        staking = VibeStaking(payable(address(proxy)));

        // Create pool with 0.001 ETH/sec reward rate
        poolId = staking.createPool(0.001 ether);

        // Fund pool with rewards
        staking.fundPool{value: 1000 ether}(poolId);

        // Fund users
        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
        vm.deal(charlie, 10_000 ether);
    }

    // ============ Lock Tier / Multiplier Tests ============

    /**
     * @notice Fuzz test: effective stake equals amount * multiplier for each tier
     */
    function testFuzz_effectiveStakeMultiplier(uint256 amount, uint8 tierIdx) public {
        amount = bound(amount, 0.01 ether, 1000 ether);
        tierIdx = uint8(bound(tierIdx, 0, 3));

        uint256[4] memory tiers = [TIER_30, TIER_90, TIER_180, TIER_365];
        uint256[4] memory mults = [uint256(1e18), 1.5e18, 2e18, 3e18];

        uint256 lockDuration = tiers[tierIdx];
        uint256 expectedMultiplier = mults[tierIdx];

        vm.prank(alice);
        staking.stake{value: amount}(poolId, lockDuration);

        (uint256 stakedAmt, uint256 effectiveAmt,,,,) = staking.getUserStake(poolId, alice);

        assertEq(stakedAmt, amount, "Raw stake amount mismatch");

        uint256 expectedEffective = amount * expectedMultiplier / PRECISION;
        assertEq(effectiveAmt, expectedEffective, "Effective amount doesn't match multiplier");
    }

    /**
     * @notice Fuzz test: invalid lock tiers are rejected
     */
    function testFuzz_invalidLockTierRejected(uint256 lockDuration) public {
        // Exclude valid tiers
        vm.assume(lockDuration != TIER_30);
        vm.assume(lockDuration != TIER_90);
        vm.assume(lockDuration != TIER_180);
        vm.assume(lockDuration != TIER_365);

        vm.prank(alice);
        vm.expectRevert(VibeStaking.InvalidLockTier.selector);
        staking.stake{value: 1 ether}(poolId, lockDuration);
    }

    /**
     * @notice Fuzz test: longer lock = higher multiplier (incentive alignment)
     */
    function testFuzz_longerLockHigherMultiplier(uint256 amount) public {
        amount = bound(amount, 1 ether, 100 ether);

        // Stake with each tier and verify multipliers increase
        uint256[4] memory tiers = [TIER_30, TIER_90, TIER_180, TIER_365];
        uint256 prevEffective = 0;

        for (uint256 i = 0; i < 4; i++) {
            address user = address(uint160(5000 + i));
            vm.deal(user, amount + 1 ether);

            vm.prank(user);
            staking.stake{value: amount}(poolId, tiers[i]);

            (, uint256 effectiveAmt,,,,) = staking.getUserStake(poolId, user);

            assertGt(effectiveAmt, prevEffective, "Longer lock should give higher effective stake");
            prevEffective = effectiveAmt;
        }
    }

    // ============ Stake / Unstake Invariants ============

    /**
     * @notice Fuzz test: unstake returns principal regardless of timing
     */
    function testFuzz_unstakeReturnsPrincipal(uint256 amount, uint256 timeWarp) public {
        amount = bound(amount, 0.01 ether, 1000 ether);
        timeWarp = bound(timeWarp, 0, 400 days);

        vm.prank(alice);
        staking.stake{value: amount}(poolId, TIER_30);

        vm.warp(block.timestamp + timeWarp);

        uint256 balBefore = alice.balance;

        vm.prank(alice);
        staking.unstake(poolId);

        uint256 balAfter = alice.balance;
        uint256 received = balAfter - balBefore;

        // Should receive at least the principal (+ rewards if lock expired, - penalty rewards if early)
        assertGe(received, amount, "User did not receive at least their principal back");
    }

    /**
     * @notice Fuzz test: cannot unstake zero stake
     */
    function testFuzz_cannotUnstakeWithNoStake(address randomUser) public {
        vm.assume(randomUser != address(0));
        vm.assume(randomUser != alice);
        vm.assume(randomUser != bob);

        vm.prank(randomUser);
        vm.expectRevert(VibeStaking.NoStake.selector);
        staking.unstake(poolId);
    }

    /**
     * @notice Fuzz test: zero amount stake is rejected
     */
    function testFuzz_zeroStakeRejected() public {
        vm.prank(alice);
        vm.expectRevert(VibeStaking.ZeroAmount.selector);
        staking.stake{value: 0}(poolId, TIER_30);
    }

    // ============ Early Unstake Penalty Tests ============

    /**
     * @notice Fuzz test: early unstake incurs 50% reward penalty
     */
    function testFuzz_earlyUnstakePenalty(uint256 amount, uint256 earlyTime) public {
        amount = bound(amount, 1 ether, 100 ether);
        earlyTime = bound(earlyTime, 1, TIER_90 - 1); // Before lock expires

        vm.prank(alice);
        staking.stake{value: amount}(poolId, TIER_90);

        // Warp to before lock end
        vm.warp(block.timestamp + earlyTime);

        // Calculate expected rewards before unstake
        uint256 pendingBefore = staking.getPendingRewards(poolId, alice);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        staking.unstake(poolId);
        uint256 received = alice.balance - balBefore;

        // Should receive principal + penalized rewards
        // Penalty = 50% of rewards
        if (pendingBefore > 0) {
            uint256 expectedPayout = amount + (pendingBefore * 5000 / BPS);
            // Allow small rounding difference due to block.timestamp changes during tx
            assertApproxEqAbs(received, expectedPayout, 0.01 ether, "Early penalty calculation wrong");
        } else {
            assertEq(received, amount, "Should get principal back with no rewards");
        }
    }

    /**
     * @notice Fuzz test: late unstake (after lock) gets full rewards
     */
    function testFuzz_lateUnstakeFullRewards(uint256 amount) public {
        amount = bound(amount, 1 ether, 100 ether);

        vm.prank(alice);
        staking.stake{value: amount}(poolId, TIER_30);

        // Warp past lock end
        vm.warp(block.timestamp + TIER_30 + 1);

        uint256 pendingBefore = staking.getPendingRewards(poolId, alice);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        staking.unstake(poolId);
        uint256 received = alice.balance - balBefore;

        // Should receive principal + full rewards (no penalty)
        assertGe(received, amount + pendingBefore - 0.001 ether, "Should receive full rewards after lock");
    }

    // ============ Delegation Tests ============

    /**
     * @notice Fuzz test: delegation transfers voting power correctly
     */
    function testFuzz_delegationTransfersPower(uint256 amount) public {
        amount = bound(amount, 1 ether, 1000 ether);

        vm.prank(alice);
        staking.stake{value: amount}(poolId, TIER_30);

        (, uint256 effectiveAmt,,,,) = staking.getUserStake(poolId, alice);

        // Initially self-delegated
        uint256 alicePower = staking.getDelegatedPower(poolId, alice);
        assertEq(alicePower, effectiveAmt, "Self-delegation power mismatch");

        // Delegate to bob
        vm.prank(alice);
        staking.setDelegate(poolId, bob);

        uint256 alicePowerAfter = staking.getDelegatedPower(poolId, alice);
        uint256 bobPower = staking.getDelegatedPower(poolId, bob);

        assertEq(alicePowerAfter, 0, "Alice should have zero power after delegation");
        assertEq(bobPower, effectiveAmt, "Bob should have received delegated power");
    }

    /**
     * @notice Fuzz test: delegation is conserved (no power created or destroyed)
     */
    function testFuzz_delegationConservation(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1 ether, 500 ether);
        amount2 = bound(amount2, 1 ether, 500 ether);

        // Alice stakes
        vm.prank(alice);
        staking.stake{value: amount1}(poolId, TIER_90);

        // Bob stakes
        vm.prank(bob);
        staking.stake{value: amount2}(poolId, TIER_90);

        (, uint256 aliceEffective,,,,) = staking.getUserStake(poolId, alice);
        (, uint256 bobEffective,,,,) = staking.getUserStake(poolId, bob);
        uint256 totalEffective = aliceEffective + bobEffective;

        // Both delegate to charlie
        vm.prank(alice);
        staking.setDelegate(poolId, charlie);
        vm.prank(bob);
        staking.setDelegate(poolId, charlie);

        uint256 charliePower = staking.getDelegatedPower(poolId, charlie);
        uint256 alicePower = staking.getDelegatedPower(poolId, alice);
        uint256 bobPower = staking.getDelegatedPower(poolId, bob);

        // Conservation: total delegated power = total effective stake
        assertEq(
            charliePower + alicePower + bobPower,
            totalEffective,
            "Delegation power not conserved"
        );
    }

    // ============ Pool State Tests ============

    /**
     * @notice Fuzz test: pool totalStaked tracks effective amounts correctly
     */
    function testFuzz_poolTotalStakedAccuracy(uint256 amount1, uint256 amount2, uint8 tier1, uint8 tier2) public {
        amount1 = bound(amount1, 1 ether, 500 ether);
        amount2 = bound(amount2, 1 ether, 500 ether);
        tier1 = uint8(bound(tier1, 0, 3));
        tier2 = uint8(bound(tier2, 0, 3));

        uint256[4] memory tiers = [TIER_30, TIER_90, TIER_180, TIER_365];
        uint256[4] memory mults = [uint256(1e18), 1.5e18, 2e18, 3e18];

        vm.prank(alice);
        staking.stake{value: amount1}(poolId, tiers[tier1]);

        vm.prank(bob);
        staking.stake{value: amount2}(poolId, tiers[tier2]);

        uint256 expectedEffective1 = amount1 * mults[tier1] / PRECISION;
        uint256 expectedEffective2 = amount2 * mults[tier2] / PRECISION;

        (,uint256 totalStaked, uint256 totalRawStaked,,) = staking.getPoolInfo(poolId);

        assertEq(totalRawStaked, amount1 + amount2, "Raw staked total mismatch");
        assertEq(totalStaked, expectedEffective1 + expectedEffective2, "Effective staked total mismatch");
    }

    /**
     * @notice Fuzz test: pool fund balance is correctly tracked
     */
    function testFuzz_poolFundingAccuracy(uint256 fundAmount) public {
        fundAmount = bound(fundAmount, 0.01 ether, 10_000 ether);

        (,,,,) = staking.getPoolInfo(poolId);

        // Fund additional amount
        staking.fundPool{value: fundAmount}(poolId);

        (,,,uint256 rewardBalance,) = staking.getPoolInfo(poolId);
        // Initial 1000 ether + fundAmount
        assertEq(rewardBalance, 1000 ether + fundAmount, "Reward balance mismatch after funding");
    }

    /**
     * @notice Fuzz test: paused pool rejects new stakes
     */
    function testFuzz_pausedPoolRejectsStakes(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 100 ether);

        staking.togglePoolPause(poolId);

        vm.prank(alice);
        vm.expectRevert(VibeStaking.PoolPaused.selector);
        staking.stake{value: amount}(poolId, TIER_30);
    }

    // ============ Emergency Withdraw Tests ============

    /**
     * @notice Fuzz test: emergency withdraw returns only principal, forfeits rewards
     */
    function testFuzz_emergencyWithdrawPrincipalOnly(uint256 amount, uint256 timeWarp) public {
        amount = bound(amount, 1 ether, 100 ether);
        timeWarp = bound(timeWarp, 1 hours, 365 days);

        vm.prank(alice);
        staking.stake{value: amount}(poolId, TIER_365);

        vm.warp(block.timestamp + timeWarp);

        // There should be pending rewards by now
        uint256 pending = staking.getPendingRewards(poolId, alice);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        staking.emergencyWithdraw(poolId);
        uint256 received = alice.balance - balBefore;

        // Emergency withdraw returns ONLY principal (all rewards forfeited)
        assertEq(received, amount, "Emergency withdraw should return exact principal");

        // Verify stake is cleared
        (uint256 stakedAmt,,,,,) = staking.getUserStake(poolId, alice);
        assertEq(stakedAmt, 0, "Stake not cleared after emergency withdraw");
    }

    // ============ Auto-Compound Tests ============

    /**
     * @notice Fuzz test: auto-compound increases stake without ETH transfer
     */
    function testFuzz_autoCompoundIncreasesStake(uint256 amount, uint256 timeWarp) public {
        amount = bound(amount, 10 ether, 100 ether);
        timeWarp = bound(timeWarp, 1 days, 90 days);

        vm.prank(alice);
        staking.stake{value: amount}(poolId, TIER_30);

        vm.prank(alice);
        staking.setAutoCompound(poolId, true);

        vm.warp(block.timestamp + timeWarp);

        uint256 pending = staking.getPendingRewards(poolId, alice);
        if (pending == 0) return; // Skip if no rewards accrued

        uint256 balBefore = alice.balance;

        vm.prank(alice);
        staking.claimRewards(poolId);

        uint256 balAfter = alice.balance;

        // With auto-compound, no ETH should be transferred to user
        assertEq(balAfter, balBefore, "Auto-compound should not send ETH to user");

        // Stake amount should have increased
        (uint256 newAmount,,,,,) = staking.getUserStake(poolId, alice);
        assertGt(newAmount, amount, "Stake should increase after auto-compound");
    }

    // ============ Reward Calculation Tests ============

    /**
     * @notice Fuzz test: rewards accrue proportionally to effective stake
     */
    function testFuzz_rewardsProportionalToEffectiveStake(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 10 ether, 1000 ether);
        amount2 = bound(amount2, 10 ether, 1000 ether);

        // Both stake with same tier so multiplier is the same
        vm.prank(alice);
        staking.stake{value: amount1}(poolId, TIER_30);

        vm.prank(bob);
        staking.stake{value: amount2}(poolId, TIER_30);

        // Warp to accrue rewards
        vm.warp(block.timestamp + 7 days);

        uint256 aliceRewards = staking.getPendingRewards(poolId, alice);
        uint256 bobRewards = staking.getPendingRewards(poolId, bob);

        if (aliceRewards == 0 && bobRewards == 0) return;

        // Rewards should be proportional to stake amounts
        // alice/bob rewards should be close to amount1/amount2 ratio
        if (bobRewards > 0) {
            uint256 rewardRatio = (aliceRewards * 1e18) / bobRewards;
            uint256 stakeRatio = (amount1 * 1e18) / amount2;
            // Allow 1% deviation due to rounding
            assertApproxEqRel(rewardRatio, stakeRatio, 0.01e18, "Rewards not proportional to stake");
        }
    }

    /**
     * @notice Fuzz test: rewards are capped by pool reward balance
     */
    function testFuzz_rewardsCappedByBalance(uint256 amount) public {
        amount = bound(amount, 100 ether, 1000 ether);

        // Create a new pool with very low funding
        uint256 lowFundPool = staking.createPool(1 ether); // 1 ETH/sec (very high rate)
        staking.fundPool{value: 1 ether}(lowFundPool); // Only 1 ETH of rewards

        vm.prank(alice);
        staking.stake{value: amount}(poolId, TIER_30);

        // Warp far into the future
        vm.warp(block.timestamp + 365 days);

        // Pending rewards should be capped by the pool's reward balance
        uint256 pending = staking.getPendingRewards(poolId, alice);
        (,,,uint256 rewardBalance,) = staking.getPoolInfo(poolId);

        assertLe(pending, rewardBalance, "Pending rewards exceed pool balance");
    }

    // ============ Invalid Pool Tests ============

    /**
     * @notice Fuzz test: operations on invalid pool ID revert
     */
    function testFuzz_invalidPoolRejected(uint256 badPoolId) public {
        badPoolId = bound(badPoolId, staking.getPoolCount(), type(uint128).max);

        vm.prank(alice);
        vm.expectRevert(VibeStaking.InvalidPool.selector);
        staking.stake{value: 1 ether}(badPoolId, TIER_30);
    }

    receive() external payable {}
}
