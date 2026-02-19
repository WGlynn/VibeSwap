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

// ============ Fuzz Tests ============

contract SingleStakingFuzzTest is Test {
    SingleStaking public staking;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;

    address alice = makeAddr("alice");
    address owner;

    function setUp() public {
        owner = address(this);
        stakingToken = new MockERC20("Stake", "STK");
        rewardToken = new MockERC20("Reward", "RWD");

        staking = new SingleStaking(address(stakingToken), address(rewardToken));

        stakingToken.mint(alice, type(uint128).max);
        rewardToken.mint(owner, type(uint128).max);

        vm.prank(alice);
        stakingToken.approve(address(staking), type(uint256).max);
        rewardToken.approve(address(staking), type(uint256).max);
    }

    // ============ Fuzz: stake any amount ============

    function testFuzz_stake_anyAmount(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);

        vm.prank(alice);
        staking.stake(amount);

        assertEq(staking.stakeOf(alice), amount);
        assertEq(staking.totalStaked(), amount);
    }

    // ============ Fuzz: withdraw partial ============

    function testFuzz_withdraw_partial(uint256 stakeAmt, uint256 withdrawAmt) public {
        stakeAmt = bound(stakeAmt, 1, 1_000_000 ether);
        withdrawAmt = bound(withdrawAmt, 1, stakeAmt);

        vm.prank(alice);
        staking.stake(stakeAmt);

        vm.prank(alice);
        staking.withdraw(withdrawAmt);

        assertEq(staking.stakeOf(alice), stakeAmt - withdrawAmt);
    }

    // ============ Fuzz: earned proportional to time ============

    function testFuzz_earned_proportionalToTime(uint256 elapsed) public {
        uint256 rewardAmount = 1_000_000 ether;
        uint256 duration = 30 days;
        elapsed = bound(elapsed, 1, duration);

        vm.prank(alice);
        staking.stake(100 ether);

        staking.notifyRewardAmount(rewardAmount, duration);

        vm.warp(block.timestamp + elapsed);

        uint256 earned = staking.earned(alice);
        uint256 expected = (rewardAmount / duration) * elapsed;

        // Earned should be close to expected (rounding can cause up to duration-1 wei error)
        assertApproxEqAbs(earned, expected, duration);
    }

    // ============ Fuzz: earned never exceeds total rewards ============

    function testFuzz_earned_neverExceedsTotalRewards(uint256 rewardAmount, uint256 duration, uint256 elapsed) public {
        rewardAmount = bound(rewardAmount, 1 ether, 10_000_000 ether);
        duration = bound(duration, 1 hours, 365 days);
        elapsed = bound(elapsed, 0, duration + 365 days);

        vm.prank(alice);
        staking.stake(100 ether);

        staking.notifyRewardAmount(rewardAmount, duration);

        vm.warp(block.timestamp + elapsed);

        uint256 earned = staking.earned(alice);

        // Earned can be slightly less than reward due to rounding, but never more
        assertLe(earned, rewardAmount);
    }

    // ============ Fuzz: claim + re-earn cycle ============

    function testFuzz_claimAndReEarn(uint256 claimTime, uint256 secondWait) public {
        uint256 rewardAmount = 1_000_000 ether;
        uint256 duration = 30 days;

        claimTime = bound(claimTime, 1, duration - 1);
        secondWait = bound(secondWait, 1, duration - claimTime);

        vm.prank(alice);
        staking.stake(100 ether);

        staking.notifyRewardAmount(rewardAmount, duration);

        // First period — earn and claim
        vm.warp(block.timestamp + claimTime);
        uint256 firstEarned = staking.earned(alice);
        vm.prank(alice);
        staking.claimReward();

        // Second period — earn more
        vm.warp(block.timestamp + secondWait);
        uint256 secondEarned = staking.earned(alice);

        // Total earned should not exceed total rewards
        assertLe(firstEarned + secondEarned, rewardAmount);
    }

    // ============ Fuzz: two stakers proportional sharing ============

    function testFuzz_twoStakers_proportional(uint256 aliceStake, uint256 bobStake) public {
        aliceStake = bound(aliceStake, 1 ether, 1_000_000 ether);
        bobStake = bound(bobStake, 1 ether, 1_000_000 ether);

        address bob = makeAddr("bob");
        stakingToken.mint(bob, bobStake);
        vm.prank(bob);
        stakingToken.approve(address(staking), type(uint256).max);

        uint256 rewardAmount = 1_000_000 ether;
        uint256 duration = 7 days;

        vm.prank(alice);
        staking.stake(aliceStake);
        vm.prank(bob);
        staking.stake(bobStake);

        staking.notifyRewardAmount(rewardAmount, duration);

        vm.warp(block.timestamp + duration);

        uint256 aliceEarned = staking.earned(alice);
        uint256 bobEarned = staking.earned(bob);

        // Proportional: aliceEarned / bobEarned ≈ aliceStake / bobStake
        // Cross-multiply to avoid division: aliceEarned * bobStake ≈ bobEarned * aliceStake
        uint256 lhs = aliceEarned * bobStake;
        uint256 rhs = bobEarned * aliceStake;

        // Allow 0.1% tolerance for rounding
        if (lhs > rhs) {
            assertLe(lhs - rhs, lhs / 1000 + 1);
        } else {
            assertLe(rhs - lhs, rhs / 1000 + 1);
        }
    }

    // ============ Fuzz: extend reward period ============

    function testFuzz_extendRewardPeriod(uint256 firstAmount, uint256 secondAmount, uint256 midpoint) public {
        firstAmount = bound(firstAmount, 1 ether, 5_000_000 ether);
        secondAmount = bound(secondAmount, 1 ether, 5_000_000 ether);
        uint256 duration = 7 days;
        midpoint = bound(midpoint, 1, duration - 1);

        vm.prank(alice);
        staking.stake(100 ether);

        staking.notifyRewardAmount(firstAmount, duration);

        vm.warp(block.timestamp + midpoint);

        // Extend with more rewards
        staking.notifyRewardAmount(secondAmount, duration);

        // New rate should incorporate leftover
        uint256 remaining = duration - midpoint;
        uint256 leftover = remaining * (firstAmount / duration);
        uint256 expectedRate = (secondAmount + leftover) / duration;
        assertEq(staking.rewardRate(), expectedRate);
    }

    // ============ Fuzz: exit always returns all tokens ============

    function testFuzz_exit_returnsAllTokens(uint256 stakeAmt, uint256 elapsed) public {
        stakeAmt = bound(stakeAmt, 1, 1_000_000 ether);
        uint256 rewardAmount = 500_000 ether;
        uint256 duration = 7 days;
        elapsed = bound(elapsed, 0, duration + 30 days);

        vm.prank(alice);
        staking.stake(stakeAmt);

        staking.notifyRewardAmount(rewardAmount, duration);

        vm.warp(block.timestamp + elapsed);

        uint256 pendingReward = staking.earned(alice);
        uint256 stakeBefore = stakingToken.balanceOf(alice);
        uint256 rewardBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        staking.exit();

        assertEq(stakingToken.balanceOf(alice), stakeBefore + stakeAmt);
        if (pendingReward > 0) {
            assertEq(rewardToken.balanceOf(alice), rewardBefore + pendingReward);
        }
        assertEq(staking.stakeOf(alice), 0);
    }
}
