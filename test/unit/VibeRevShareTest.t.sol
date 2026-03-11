// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeRevShare.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockReputationOracle is IReputationOracle {
    mapping(address => uint8) public tiers;

    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 100; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Tests ============

contract VibeRevShareTest is Test {
    VibeRevShare public revShare;
    MockToken public julToken;
    MockToken public revenueToken;
    MockReputationOracle public oracle;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address revenueSource = address(0xCC);
    address owner;

    function setUp() public {
        owner = address(this);

        julToken = new MockToken("JUL Token", "JUL");
        revenueToken = new MockToken("Revenue Token", "REV");
        oracle = new MockReputationOracle();

        revShare = new VibeRevShare(
            address(julToken),
            address(oracle),
            address(revenueToken)
        );

        // Authorize revenue source
        revShare.setRevenueSource(revenueSource, true);

        // Mint VREV tokens to users
        revShare.mint(alice, 1000e18);
        revShare.mint(bob, 1000e18);

        // Mint revenue tokens to source
        revenueToken.mint(revenueSource, 100_000e18);
        vm.prank(revenueSource);
        revenueToken.approve(address(revShare), type(uint256).max);

        // Mint JUL for keeper rewards
        julToken.mint(owner, 10_000e18);
        julToken.approve(address(revShare), type(uint256).max);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(revShare.name(), "VibeSwap Revenue Share");
        assertEq(revShare.symbol(), "VREV");
        assertEq(address(revShare.julToken()), address(julToken));
        assertEq(address(revShare.revenueToken()), address(revenueToken));
        assertEq(address(revShare.reputationOracle()), address(oracle));
    }

    function test_revertConstructorZeroJul() public {
        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        new VibeRevShare(address(0), address(oracle), address(revenueToken));
    }

    function test_revertConstructorZeroOracle() public {
        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        new VibeRevShare(address(julToken), address(0), address(revenueToken));
    }

    function test_revertConstructorZeroRevenue() public {
        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        new VibeRevShare(address(julToken), address(oracle), address(0));
    }

    // ============ Mint / Burn ============

    function test_mint() public view {
        assertEq(revShare.balanceOf(alice), 1000e18);
    }

    function test_revertMintNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        revShare.mint(alice, 100e18);
    }

    function test_revertMintZeroAddress() public {
        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        revShare.mint(address(0), 100e18);
    }

    function test_revertMintZeroAmount() public {
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        revShare.mint(alice, 0);
    }

    function test_burn() public {
        revShare.burn(alice, 500e18);
        assertEq(revShare.balanceOf(alice), 500e18);
    }

    function test_revertBurnNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        revShare.burn(alice, 100e18);
    }

    function test_revertBurnZeroAddress() public {
        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        revShare.burn(address(0), 100e18);
    }

    function test_revertBurnZeroAmount() public {
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        revShare.burn(alice, 0);
    }

    // ============ Revenue Source ============

    function test_setRevenueSource() public view {
        assertTrue(revShare.authorizedSources(revenueSource));
    }

    function test_revokeRevenueSource() public {
        revShare.setRevenueSource(revenueSource, false);
        assertFalse(revShare.authorizedSources(revenueSource));
    }

    function test_revertSetSourceNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        revShare.setRevenueSource(address(0x99), true);
    }

    function test_revertSetSourceZeroAddress() public {
        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        revShare.setRevenueSource(address(0), true);
    }

    // ============ Staking ============

    function test_stake() public {
        vm.prank(alice);
        revShare.stake(500e18);

        assertEq(revShare.stakedBalanceOf(alice), 500e18);
        assertEq(revShare.totalStaked(), 500e18);
        assertEq(revShare.balanceOf(alice), 500e18); // remaining unstaked
    }

    function test_stakeTransfersToContract() public {
        vm.prank(alice);
        revShare.stake(500e18);
        assertEq(revShare.balanceOf(address(revShare)), 500e18);
    }

    function test_revertStakeZero() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        revShare.stake(0);
    }

    function test_revertStakeInsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.InsufficientBalance.selector);
        revShare.stake(2000e18);
    }

    // ============ Revenue Deposit & Earning ============

    function test_depositRevenue() public {
        // Need stakers first
        vm.prank(alice);
        revShare.stake(1000e18);

        vm.prank(revenueSource);
        revShare.depositRevenue(100e18);

        assertEq(revShare.totalRevenueDeposited(), 100e18);
    }

    function test_earnedAfterRevenue() public {
        vm.prank(alice);
        revShare.stake(1000e18);

        vm.prank(revenueSource);
        revShare.depositRevenue(100e18);

        assertEq(revShare.earned(alice), 100e18);
    }

    function test_earnedProportional() public {
        // Alice stakes 750, Bob stakes 250
        vm.prank(alice);
        revShare.stake(750e18);
        vm.prank(bob);
        revShare.stake(250e18);

        vm.prank(revenueSource);
        revShare.depositRevenue(1000e18);

        assertEq(revShare.earned(alice), 750e18);
        assertEq(revShare.earned(bob), 250e18);
    }

    function test_revertDepositRevenueNotAuthorized() public {
        vm.prank(alice);
        revShare.stake(1000e18);

        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.NotAuthorizedSource.selector);
        revShare.depositRevenue(100e18);
    }

    function test_revertDepositRevenueZero() public {
        vm.prank(alice);
        revShare.stake(1000e18);

        vm.prank(revenueSource);
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        revShare.depositRevenue(0);
    }

    function test_revertDepositRevenueNoStakers() public {
        vm.prank(revenueSource);
        vm.expectRevert("No stakers to distribute to");
        revShare.depositRevenue(100e18);
    }

    // ============ Claim Revenue ============

    function test_claimRevenue() public {
        vm.prank(alice);
        revShare.stake(1000e18);

        vm.prank(revenueSource);
        revShare.depositRevenue(500e18);

        uint256 balBefore = revenueToken.balanceOf(alice);
        vm.prank(alice);
        revShare.claimRevenue();

        assertEq(revenueToken.balanceOf(alice) - balBefore, 500e18);
        assertEq(revShare.earned(alice), 0);
        assertEq(revShare.totalRevenueClaimed(), 500e18);
    }

    function test_revertClaimNothingToClaim() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.NothingToClaim.selector);
        revShare.claimRevenue();
    }

    function test_claimMultipleDeposits() public {
        vm.prank(alice);
        revShare.stake(1000e18);

        vm.prank(revenueSource);
        revShare.depositRevenue(100e18);
        vm.prank(revenueSource);
        revShare.depositRevenue(200e18);

        assertEq(revShare.earned(alice), 300e18);

        vm.prank(alice);
        revShare.claimRevenue();
        assertEq(revShare.totalRevenueClaimed(), 300e18);
    }

    // ============ Unstaking Lifecycle ============

    function test_requestUnstake() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(500e18);

        assertEq(revShare.stakedBalanceOf(alice), 0);
        assertEq(revShare.totalStaked(), 0);
    }

    function test_revertRequestUnstakeZero() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        revShare.requestUnstake(0);
    }

    function test_revertRequestUnstakeInsufficientStake() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.InsufficientStake.selector);
        revShare.requestUnstake(600e18);
    }

    function test_revertRequestUnstakePending() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(200e18);

        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.UnstakePending.selector);
        revShare.requestUnstake(100e18);
    }

    function test_completeUnstake() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(500e18);

        // Default cooldown = 7 days (tier 0)
        vm.warp(block.timestamp + 7 days);

        vm.prank(alice);
        revShare.completeUnstake();

        assertEq(revShare.balanceOf(alice), 1000e18); // all tokens back
    }

    function test_revertCompleteUnstakeTooEarly() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(500e18);

        vm.warp(block.timestamp + 3 days);

        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.CooldownNotElapsed.selector);
        revShare.completeUnstake();
    }

    function test_revertCompleteUnstakeNoRequest() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.NoUnstakeRequest.selector);
        revShare.completeUnstake();
    }

    // ============ Cancel Unstake ============

    function test_cancelUnstake() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(500e18);

        // Must wait 1 day before cancelling
        vm.warp(block.timestamp + 1 days);

        vm.prank(alice);
        revShare.cancelUnstake();

        assertEq(revShare.stakedBalanceOf(alice), 500e18);
        assertEq(revShare.totalStaked(), 500e18);
    }

    function test_revertCancelUnstakeTooSoon() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(500e18);

        // Try to cancel immediately (anti-MEV: must wait 1 day)
        vm.prank(alice);
        vm.expectRevert("Must wait 1 day before cancelling unstake");
        revShare.cancelUnstake();
    }

    function test_revertCancelUnstakeNoRequest() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.NoUnstakeRequest.selector);
        revShare.cancelUnstake();
    }

    // ============ Reputation-Based Cooldown ============

    function test_cooldownReducedByTier() public {
        // Tier 0 = 7 days (default)
        assertEq(revShare.effectiveCooldown(alice), 7 days);

        // Tier 1 = 6 days
        oracle.setTier(alice, 1);
        assertEq(revShare.effectiveCooldown(alice), 6 days);

        // Tier 3 = 4 days
        oracle.setTier(alice, 3);
        assertEq(revShare.effectiveCooldown(alice), 4 days);
    }

    function test_cooldownMinimum() public {
        // Tier 5 → 7 - 5 = 2 days (= MIN_COOLDOWN)
        oracle.setTier(alice, 5);
        assertEq(revShare.effectiveCooldown(alice), 2 days);

        // Tier 10 → would be negative, clamped to MIN_COOLDOWN
        oracle.setTier(alice, 10);
        assertEq(revShare.effectiveCooldown(alice), 2 days);
    }

    function test_highTierCanUnstakeFaster() public {
        oracle.setTier(alice, 5); // 2 day cooldown

        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(500e18);

        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        revShare.completeUnstake(); // Should succeed with 2-day cooldown
        assertEq(revShare.balanceOf(alice), 1000e18);
    }

    function test_cooldownRemaining() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(500e18);

        assertEq(revShare.cooldownRemaining(alice), 7 days);

        vm.warp(block.timestamp + 3 days);
        assertEq(revShare.cooldownRemaining(alice), 4 days);

        vm.warp(block.timestamp + 4 days);
        assertEq(revShare.cooldownRemaining(alice), 0);
    }

    function test_cooldownRemainingNoRequest() public view {
        assertEq(revShare.cooldownRemaining(alice), 0);
    }

    // ============ JUL Keeper Rewards ============

    function test_depositJulRewards() public {
        revShare.depositJulRewards(100e18);
        assertEq(revShare.julRewardPool(), 100e18);
        assertEq(julToken.balanceOf(address(revShare)), 100e18);
    }

    function test_revertDepositJulZero() public {
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        revShare.depositJulRewards(0);
    }

    // ============ Stake Info View ============

    function test_getStakeInfo() public {
        vm.prank(alice);
        revShare.stake(500e18);

        IVibeRevShare.StakeInfo memory info = revShare.getStakeInfo(alice);
        assertEq(info.stakedBalance, 500e18);
        assertEq(info.pendingRewards, 0);
        assertEq(info.unstakeRequestTime, 0);
        assertEq(info.unstakeRequestAmount, 0);
    }

    function test_getStakeInfoWithPending() public {
        vm.prank(alice);
        revShare.stake(1000e18);

        vm.prank(revenueSource);
        revShare.depositRevenue(200e18);

        IVibeRevShare.StakeInfo memory info = revShare.getStakeInfo(alice);
        assertEq(info.stakedBalance, 1000e18);
        assertEq(info.pendingRewards, 200e18);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle() public {
        // 1. Alice and Bob stake
        vm.prank(alice);
        revShare.stake(750e18);
        vm.prank(bob);
        revShare.stake(250e18);

        // 2. Revenue deposited (proportional: 75/25)
        vm.prank(revenueSource);
        revShare.depositRevenue(1000e18);

        assertEq(revShare.earned(alice), 750e18);
        assertEq(revShare.earned(bob), 250e18);

        // 3. Alice claims
        vm.prank(alice);
        revShare.claimRevenue();
        assertEq(revenueToken.balanceOf(alice), 750e18);

        // 4. More revenue deposited
        vm.prank(revenueSource);
        revShare.depositRevenue(500e18);
        assertEq(revShare.earned(alice), 375e18); // 75% of 500
        assertEq(revShare.earned(bob), 375e18);   // 250 unclaimed + 125 new

        // 5. Bob requests unstake
        vm.prank(bob);
        revShare.requestUnstake(250e18);

        // 6. Bob claims accumulated before unstake completes
        vm.prank(bob);
        revShare.claimRevenue();
        assertEq(revenueToken.balanceOf(bob), 375e18);

        // 7. More revenue — only Alice earns now (Bob unstaked)
        vm.prank(revenueSource);
        revShare.depositRevenue(100e18);
        assertApproxEqAbs(revShare.earned(alice), 475e18, 1e3); // 375 + 100 (only staker, minor rounding)

        // 8. Bob completes unstake after cooldown
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        revShare.completeUnstake();
        assertEq(revShare.balanceOf(bob), 1000e18); // all tokens back
    }

    function test_stakeUnstakeCancelRestake() public {
        vm.prank(alice);
        revShare.stake(500e18);

        vm.prank(alice);
        revShare.requestUnstake(500e18);

        // Wait 1 day then cancel
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        revShare.cancelUnstake();

        assertEq(revShare.stakedBalanceOf(alice), 500e18);

        // Revenue deposited — Alice should earn
        vm.prank(revenueSource);
        revShare.depositRevenue(200e18);
        assertEq(revShare.earned(alice), 200e18);
    }

    function test_multipleStakers_oneLeaves() public {
        // Both stake equally
        vm.prank(alice);
        revShare.stake(500e18);
        vm.prank(bob);
        revShare.stake(500e18);

        // Revenue: 50/50
        vm.prank(revenueSource);
        revShare.depositRevenue(100e18);
        assertEq(revShare.earned(alice), 50e18);
        assertEq(revShare.earned(bob), 50e18);

        // Bob unstakes
        vm.prank(bob);
        revShare.requestUnstake(500e18);

        // More revenue: 100% to Alice
        vm.prank(revenueSource);
        revShare.depositRevenue(100e18);
        assertEq(revShare.earned(alice), 150e18); // 50 + 100
        assertEq(revShare.earned(bob), 50e18);    // unchanged
    }
}
