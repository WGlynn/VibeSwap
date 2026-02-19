// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/SingleStaking.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Unit Tests ============

contract SingleStakingTest is Test {
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardAdded(uint256 amount, uint256 duration);

    SingleStaking public staking;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address owner;

    uint256 constant REWARD_AMOUNT = 1_000_000 ether;
    uint256 constant REWARD_DURATION = 7 days;
    uint256 constant STAKE_AMOUNT = 100 ether;

    function setUp() public {
        owner = address(this);
        stakingToken = new MockERC20("Stake", "STK");
        rewardToken = new MockERC20("Reward", "RWD");

        staking = new SingleStaking(address(stakingToken), address(rewardToken));

        // Fund users with staking tokens
        stakingToken.mint(alice, 10_000 ether);
        stakingToken.mint(bob, 10_000 ether);

        // Fund owner with reward tokens
        rewardToken.mint(owner, 10_000_000 ether);

        // Approve staking
        vm.prank(alice);
        stakingToken.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        stakingToken.approve(address(staking), type(uint256).max);

        // Owner approves for reward notification
        rewardToken.approve(address(staking), type(uint256).max);
    }

    // ============ Constructor ============

    function test_constructor_setsTokens() public view {
        assertEq(staking.stakingToken(), address(stakingToken));
        assertEq(staking.rewardToken(), address(rewardToken));
    }

    function test_constructor_revertsZeroStakingToken() public {
        vm.expectRevert(ISingleStaking.ZeroAddress.selector);
        new SingleStaking(address(0), address(rewardToken));
    }

    function test_constructor_revertsZeroRewardToken() public {
        vm.expectRevert(ISingleStaking.ZeroAddress.selector);
        new SingleStaking(address(stakingToken), address(0));
    }

    // ============ Stake ============

    function test_stake_basic() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        assertEq(staking.stakeOf(alice), STAKE_AMOUNT);
        assertEq(staking.totalStaked(), STAKE_AMOUNT);
    }

    function test_stake_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Staked(alice, STAKE_AMOUNT);

        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);
    }

    function test_stake_transfersTokens() public {
        uint256 balBefore = stakingToken.balanceOf(alice);

        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        assertEq(stakingToken.balanceOf(alice), balBefore - STAKE_AMOUNT);
        assertEq(stakingToken.balanceOf(address(staking)), STAKE_AMOUNT);
    }

    function test_stake_multipleUsers() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.prank(bob);
        staking.stake(STAKE_AMOUNT * 2);

        assertEq(staking.totalStaked(), STAKE_AMOUNT * 3);
        assertEq(staking.stakeOf(alice), STAKE_AMOUNT);
        assertEq(staking.stakeOf(bob), STAKE_AMOUNT * 2);
    }

    function test_stake_revertsZeroAmount() public {
        vm.expectRevert(ISingleStaking.ZeroAmount.selector);
        vm.prank(alice);
        staking.stake(0);
    }

    function test_stake_multipleTimesAccumulates() public {
        vm.startPrank(alice);
        staking.stake(50 ether);
        staking.stake(50 ether);
        vm.stopPrank();

        assertEq(staking.stakeOf(alice), 100 ether);
    }

    // ============ Withdraw ============

    function test_withdraw_basic() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.prank(alice);
        staking.withdraw(STAKE_AMOUNT);

        assertEq(staking.stakeOf(alice), 0);
        assertEq(staking.totalStaked(), 0);
    }

    function test_withdraw_partial() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.prank(alice);
        staking.withdraw(STAKE_AMOUNT / 2);

        assertEq(staking.stakeOf(alice), STAKE_AMOUNT / 2);
        assertEq(staking.totalStaked(), STAKE_AMOUNT / 2);
    }

    function test_withdraw_emitsEvent() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.expectEmit(true, false, false, true);
        emit Withdrawn(alice, STAKE_AMOUNT);

        vm.prank(alice);
        staking.withdraw(STAKE_AMOUNT);
    }

    function test_withdraw_returnsTokens() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        uint256 balBefore = stakingToken.balanceOf(alice);

        vm.prank(alice);
        staking.withdraw(STAKE_AMOUNT);

        assertEq(stakingToken.balanceOf(alice), balBefore + STAKE_AMOUNT);
    }

    function test_withdraw_revertsZeroAmount() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.expectRevert(ISingleStaking.ZeroAmount.selector);
        vm.prank(alice);
        staking.withdraw(0);
    }

    function test_withdraw_revertsInsufficientStake() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.expectRevert(ISingleStaking.InsufficientStake.selector);
        vm.prank(alice);
        staking.withdraw(STAKE_AMOUNT + 1);
    }

    // ============ Reward Notification ============

    function test_notifyRewardAmount_basic() public {
        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        assertEq(staking.rewardRate(), REWARD_AMOUNT / REWARD_DURATION);
        assertEq(staking.rewardDuration(), REWARD_DURATION);
        assertEq(staking.periodFinish(), block.timestamp + REWARD_DURATION);
    }

    function test_notifyRewardAmount_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit RewardAdded(REWARD_AMOUNT, REWARD_DURATION);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);
    }

    function test_notifyRewardAmount_transfersRewards() public {
        uint256 balBefore = rewardToken.balanceOf(owner);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        assertEq(rewardToken.balanceOf(owner), balBefore - REWARD_AMOUNT);
        assertEq(rewardToken.balanceOf(address(staking)), REWARD_AMOUNT);
    }

    function test_notifyRewardAmount_revertsNonOwner() public {
        rewardToken.mint(alice, REWARD_AMOUNT);
        vm.startPrank(alice);
        rewardToken.approve(address(staking), type(uint256).max);

        vm.expectRevert();
        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);
        vm.stopPrank();
    }

    function test_notifyRewardAmount_revertsZeroAmount() public {
        vm.expectRevert(ISingleStaking.ZeroAmount.selector);
        staking.notifyRewardAmount(0, REWARD_DURATION);
    }

    function test_notifyRewardAmount_revertsZeroDuration() public {
        vm.expectRevert(ISingleStaking.ZeroAmount.selector);
        staking.notifyRewardAmount(REWARD_AMOUNT, 0);
    }

    function test_notifyRewardAmount_extendsExistingPeriod() public {
        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(block.timestamp + REWARD_DURATION / 2);

        // Add more rewards — leftover from first period rolls into new period
        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        // New rate should incorporate leftover
        uint256 remaining = REWARD_DURATION / 2;
        uint256 leftover = remaining * (REWARD_AMOUNT / REWARD_DURATION);
        uint256 expectedRate = (REWARD_AMOUNT + leftover) / REWARD_DURATION;
        assertEq(staking.rewardRate(), expectedRate);
    }

    // ============ Reward Earning ============

    function test_earned_zeroBeforeRewardPeriod() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        assertEq(staking.earned(alice), 0);
    }

    function test_earned_accumulatesOverTime() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(block.timestamp + 1 days);

        uint256 expectedReward = (REWARD_AMOUNT / REWARD_DURATION) * 1 days;
        // Allow 1 wei tolerance for rounding
        assertApproxEqAbs(staking.earned(alice), expectedReward, 1);
    }

    function test_earned_proportionalToStake() public {
        // Alice stakes 1x, Bob stakes 3x
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.prank(bob);
        staking.stake(STAKE_AMOUNT * 3);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(block.timestamp + REWARD_DURATION);

        uint256 aliceEarned = staking.earned(alice);
        uint256 bobEarned = staking.earned(bob);

        // Bob should earn ~3x what Alice earns
        assertApproxEqRel(bobEarned, aliceEarned * 3, 1e15); // 0.1% tolerance
    }

    function test_earned_stopsAtPeriodEnd() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        // Warp past period end
        vm.warp(block.timestamp + REWARD_DURATION + 30 days);

        uint256 earnedAtEnd = staking.earned(alice);

        // Should not exceed total reward amount (minus rounding)
        assertApproxEqAbs(earnedAtEnd, REWARD_AMOUNT, REWARD_DURATION); // Max rounding = 1 per second
    }

    function test_earned_lateStakerGetsProportional() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        // Bob enters halfway through
        vm.warp(block.timestamp + REWARD_DURATION / 2);

        vm.prank(bob);
        staking.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + REWARD_DURATION / 2);

        uint256 aliceEarned = staking.earned(alice);
        uint256 bobEarned = staking.earned(bob);

        // Alice earned full first half + half of second half
        // Bob earned half of second half
        // Alice should earn more than Bob
        assertGt(aliceEarned, bobEarned);
    }

    // ============ Claim Reward ============

    function test_claimReward_basic() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(block.timestamp + REWARD_DURATION);

        uint256 earnedBefore = staking.earned(alice);
        uint256 balBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        staking.claimReward();

        assertEq(rewardToken.balanceOf(alice), balBefore + earnedBefore);
        assertEq(staking.earned(alice), 0);
    }

    function test_claimReward_emitsEvent() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);
        vm.warp(block.timestamp + REWARD_DURATION);

        uint256 expectedReward = staking.earned(alice);

        vm.expectEmit(true, false, false, true);
        emit RewardClaimed(alice, expectedReward);

        vm.prank(alice);
        staking.claimReward();
    }

    function test_claimReward_revertsNothingToClaim() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.expectRevert(ISingleStaking.NothingToClaim.selector);
        vm.prank(alice);
        staking.claimReward();
    }

    function test_claimReward_multipleClaims() public {
        vm.warp(1000);

        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        // Claim after 1 day
        vm.warp(1000 + 1 days);
        uint256 firstClaim = staking.earned(alice);
        vm.prank(alice);
        staking.claimReward();

        // Claim after another day
        vm.warp(1000 + 2 days);
        uint256 secondClaim = staking.earned(alice);
        vm.prank(alice);
        staking.claimReward();

        // Both claims should be approximately equal
        assertApproxEqAbs(firstClaim, secondClaim, 2);
    }

    // ============ Exit ============

    function test_exit_withdrawsAndClaims() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(block.timestamp + REWARD_DURATION);

        uint256 expectedReward = staking.earned(alice);
        uint256 stakeBalBefore = stakingToken.balanceOf(alice);
        uint256 rewardBalBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        staking.exit();

        assertEq(staking.stakeOf(alice), 0);
        assertEq(stakingToken.balanceOf(alice), stakeBalBefore + STAKE_AMOUNT);
        assertEq(rewardToken.balanceOf(alice), rewardBalBefore + expectedReward);
    }

    function test_exit_noRewardsJustWithdraws() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        // Exit without any reward period
        vm.prank(alice);
        staking.exit();

        assertEq(staking.stakeOf(alice), 0);
        assertEq(stakingToken.balanceOf(alice), 10_000 ether);
    }

    function test_exit_noStakeButHasRewards() public {
        // Alice stakes, earns, withdraws, then exits for remaining claim
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);
        vm.warp(block.timestamp + REWARD_DURATION);

        // Withdraw stake manually
        vm.prank(alice);
        staking.withdraw(STAKE_AMOUNT);

        // Exit should just claim rewards
        uint256 rewardBalBefore = rewardToken.balanceOf(alice);
        uint256 pendingReward = staking.earned(alice);

        vm.prank(alice);
        staking.exit();

        assertEq(rewardToken.balanceOf(alice), rewardBalBefore + pendingReward);
    }

    // ============ Same Token Staking ============

    function test_sameToken_stakingAndReward() public {
        // Create staking where stake token = reward token
        MockERC20 token = new MockERC20("Token", "TKN");
        SingleStaking sameTokenStaking = new SingleStaking(address(token), address(token));

        token.mint(alice, 10_000 ether);
        token.mint(address(this), 10_000_000 ether);

        vm.prank(alice);
        token.approve(address(sameTokenStaking), type(uint256).max);
        token.approve(address(sameTokenStaking), type(uint256).max);

        vm.prank(alice);
        sameTokenStaking.stake(100 ether);

        // Notify reward — solvency check should subtract staked
        sameTokenStaking.notifyRewardAmount(1000 ether, 7 days);

        vm.warp(block.timestamp + 7 days);

        uint256 earned = sameTokenStaking.earned(alice);
        assertGt(earned, 0);
    }

    // ============ Views ============

    function test_views_initialState() public view {
        assertEq(staking.totalStaked(), 0);
        assertEq(staking.rewardRate(), 0);
        assertEq(staking.rewardPerTokenStored(), 0);
        assertEq(staking.lastUpdateTime(), 0);
        assertEq(staking.periodFinish(), 0);
        assertEq(staking.rewardDuration(), 0);
    }

    function test_views_afterStakeAndReward() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        assertEq(staking.totalStaked(), STAKE_AMOUNT);
        assertGt(staking.rewardRate(), 0);
        assertEq(staking.rewardDuration(), REWARD_DURATION);
    }

    // ============ Edge Cases ============

    function test_edge_stakeAfterPeriodEnds() public {
        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(block.timestamp + REWARD_DURATION + 1);

        // Staking after period ends should work
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        assertEq(staking.stakeOf(alice), STAKE_AMOUNT);
        assertEq(staking.earned(alice), 0);
    }

    function test_edge_noStakersDuringRewardPeriod() public {
        // Start rewards with no stakers — rewards are effectively lost
        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(block.timestamp + REWARD_DURATION / 2);

        // Alice stakes halfway
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + REWARD_DURATION / 2);

        // Alice should only earn ~half the rewards
        uint256 earned = staking.earned(alice);
        assertApproxEqRel(earned, REWARD_AMOUNT / 2, 1e16); // 1% tolerance
    }

    function test_edge_withdrawAllDuringPeriod() public {
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(block.timestamp + 1 days);

        uint256 earnedBeforeWithdraw = staking.earned(alice);

        // Withdraw all
        vm.prank(alice);
        staking.withdraw(STAKE_AMOUNT);

        // Earned should be preserved (snapshot in updateReward)
        assertEq(staking.earned(alice), earnedBeforeWithdraw);

        // Wait more — earned should NOT increase (no stake)
        vm.warp(block.timestamp + 1 days);
        assertEq(staking.earned(alice), earnedBeforeWithdraw);
    }

    function test_edge_restakeAfterWithdraw() public {
        vm.warp(1000);

        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        staking.notifyRewardAmount(REWARD_AMOUNT, REWARD_DURATION);

        vm.warp(1000 + 1 days);

        vm.prank(alice);
        staking.withdraw(STAKE_AMOUNT);

        vm.warp(1000 + 2 days);

        // Re-stake
        vm.prank(alice);
        staking.stake(STAKE_AMOUNT);

        vm.warp(1000 + 3 days);

        // Should have earned for day 1 + day 3, but NOT day 2
        uint256 earned = staking.earned(alice);
        uint256 dailyRate = REWARD_AMOUNT / REWARD_DURATION * 1 days;
        assertApproxEqRel(earned, dailyRate * 2, 1e16); // 2 days of rewards, 1% tolerance
    }
}
