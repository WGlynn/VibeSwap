// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/financial/VibeRevShare.sol";
import "../contracts/financial/interfaces/IVibeRevShare.sol";
import "../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockRevToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockRevOracle is IReputationOracle {
    mapping(address => uint8) public tiers;

    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Test Contract ============

contract VibeRevShareTest is Test {
    VibeRevShare public rev;
    MockRevToken public usdc;
    MockRevToken public jul;
    MockRevOracle public oracle;

    // Re-declare events
    event Staked(address indexed user, uint256 amount);
    event UnstakeRequested(address indexed user, uint256 amount, uint40 availableAt);
    event UnstakeCompleted(address indexed user, uint256 amount);
    event UnstakeCancelled(address indexed user, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 amount);
    event RevenueDeposited(address indexed source, uint256 amount);
    event RevenueSourceUpdated(address indexed source, bool authorized);
    event JulRewardsDeposited(address indexed depositor, uint256 amount);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);

    // ============ Actors ============

    address public alice;     // staker
    address public bob;       // staker #2
    address public charlie;   // revenue source
    address public dave;      // no reputation

    // ============ Constants ============

    uint256 constant MINT_AMOUNT = 100_000 ether;
    uint256 constant STAKE_AMOUNT = 10_000 ether;
    uint256 constant REVENUE = 1_000 ether;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave = makeAddr("dave");

        jul = new MockRevToken("JUL Token", "JUL");
        usdc = new MockRevToken("USD Coin", "USDC");
        oracle = new MockRevOracle();

        rev = new VibeRevShare(address(jul), address(oracle), address(usdc));

        // Set tiers
        oracle.setTier(alice, 4);    // elite — 3-day cooldown
        oracle.setTier(bob, 2);      // default — 5-day cooldown
        oracle.setTier(charlie, 0);  // none — 7-day cooldown
        oracle.setTier(dave, 0);

        // Mint VREV to stakers
        rev.mint(alice, MINT_AMOUNT);
        rev.mint(bob, MINT_AMOUNT);

        // Mint USDC for revenue deposits
        usdc.mint(charlie, 100_000_000 ether);
        jul.mint(address(this), 1_000_000 ether);

        // Authorize revenue source
        rev.setRevenueSource(charlie, true);

        // Approvals
        vm.prank(alice);
        rev.approve(address(rev), type(uint256).max);
        vm.prank(bob);
        rev.approve(address(rev), type(uint256).max);
        vm.prank(charlie);
        usdc.approve(address(rev), type(uint256).max);
        jul.approve(address(rev), type(uint256).max);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsImmutables() public view {
        assertEq(address(rev.julToken()), address(jul));
        assertEq(address(rev.revenueToken()), address(usdc));
        assertEq(address(rev.reputationOracle()), address(oracle));
    }

    function test_constructor_initialState() public view {
        assertEq(rev.totalStaked(), 0);
        assertEq(rev.totalRevenueDeposited(), 0);
        assertEq(rev.totalRevenueClaimed(), 0);
        assertEq(rev.julRewardPool(), 0);
        assertEq(rev.name(), "VibeSwap Revenue Share");
        assertEq(rev.symbol(), "VREV");
    }

    function test_constructor_zeroAddress_reverts() public {
        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        new VibeRevShare(address(0), address(oracle), address(usdc));

        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        new VibeRevShare(address(jul), address(0), address(usdc));

        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        new VibeRevShare(address(jul), address(oracle), address(0));
    }

    // ============ Mint / Burn Tests ============

    function test_mint_valid() public {
        rev.mint(dave, 1000 ether);
        assertEq(rev.balanceOf(dave), 1000 ether);
    }

    function test_mint_notOwner_reverts() public {
        vm.prank(bob);
        vm.expectRevert();
        rev.mint(dave, 1000 ether);
    }

    function test_burn_valid() public {
        rev.mint(dave, 1000 ether);
        rev.burn(dave, 500 ether);
        assertEq(rev.balanceOf(dave), 500 ether);
    }

    // ============ Staking Tests ============

    function test_stake_valid() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        assertEq(rev.stakedBalanceOf(alice), STAKE_AMOUNT);
        assertEq(rev.totalStaked(), STAKE_AMOUNT);
        assertEq(rev.balanceOf(alice), MINT_AMOUNT - STAKE_AMOUNT);
    }

    function test_stake_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Staked(alice, STAKE_AMOUNT);
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);
    }

    function test_stake_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        rev.stake(0);
    }

    function test_stake_insufficientBalance_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.InsufficientBalance.selector);
        rev.stake(MINT_AMOUNT + 1);
    }

    function test_stake_multipleTimes() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        assertEq(rev.stakedBalanceOf(alice), STAKE_AMOUNT * 2);
    }

    // ============ Revenue Deposit Tests ============

    function test_depositRevenue_valid() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        assertEq(rev.totalRevenueDeposited(), REVENUE);
    }

    function test_depositRevenue_emitsEvent() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.expectEmit(true, false, false, true);
        emit RevenueDeposited(charlie, REVENUE);
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);
    }

    function test_depositRevenue_notAuthorized_reverts() public {
        vm.prank(bob);
        vm.expectRevert(IVibeRevShare.NotAuthorizedSource.selector);
        rev.depositRevenue(REVENUE);
    }

    function test_depositRevenue_zeroAmount_reverts() public {
        vm.prank(charlie);
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        rev.depositRevenue(0);
    }

    // ============ Revenue Claim Tests ============

    function test_claimRevenue_singleStaker() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        uint256 earned = rev.earned(alice);
        assertEq(earned, REVENUE);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        rev.claimRevenue();
        assertEq(usdc.balanceOf(alice) - balBefore, REVENUE);
        assertEq(rev.totalRevenueClaimed(), REVENUE);
    }

    function test_claimRevenue_twoStakers() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);
        vm.prank(bob);
        rev.stake(STAKE_AMOUNT);

        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        // Each should earn half
        assertEq(rev.earned(alice), REVENUE / 2);
        assertEq(rev.earned(bob), REVENUE / 2);

        vm.prank(alice);
        rev.claimRevenue();
        vm.prank(bob);
        rev.claimRevenue();

        assertEq(usdc.balanceOf(alice), REVENUE / 2);
        assertEq(usdc.balanceOf(bob), REVENUE / 2);
    }

    function test_claimRevenue_proportional() public {
        // Alice stakes 3x more than bob
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT * 3);
        vm.prank(bob);
        rev.stake(STAKE_AMOUNT);

        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        uint256 aliceEarned = rev.earned(alice);
        uint256 bobEarned = rev.earned(bob);

        // Alice should earn 75%, bob 25%
        assertEq(aliceEarned, (REVENUE * 3) / 4);
        assertEq(bobEarned, REVENUE / 4);
    }

    function test_claimRevenue_nothingToClaim_reverts() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.NothingToClaim.selector);
        rev.claimRevenue();
    }

    function test_claimRevenue_multipleDeposits() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(charlie);
        rev.depositRevenue(REVENUE);
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        assertEq(rev.earned(alice), REVENUE * 2);
    }

    function test_claimRevenue_afterPartialUnstake() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        // Request unstake half — stops earning on that half
        vm.prank(alice);
        rev.requestUnstake(STAKE_AMOUNT / 2);

        // Deposit more revenue — only half is staked now
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        // Alice earned: full REVENUE from first deposit + half REVENUE from second
        uint256 earned = rev.earned(alice);
        assertEq(earned, REVENUE + REVENUE); // wait, the first REVENUE was snapshotted in updateReward...
        // Actually: first deposit = 1000 (all to alice). Then unstake half (updateReward snapshots 1000).
        // Second deposit = only 5000 staked. 1000 * 1e18 / 5000 per token. Alice has 5000 staked.
        // So alice earns 1000 from second deposit too.
        // Total: 2000
    }

    // ============ Unstake Tests ============

    function test_requestUnstake_valid() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(alice);
        rev.requestUnstake(STAKE_AMOUNT);

        assertEq(rev.stakedBalanceOf(alice), 0);
        assertEq(rev.totalStaked(), 0);

        IVibeRevShare.StakeInfo memory info = rev.getStakeInfo(alice);
        assertEq(info.unstakeRequestAmount, STAKE_AMOUNT);
        assertTrue(info.unstakeRequestTime > 0);
    }

    function test_requestUnstake_insufficientStake_reverts() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.InsufficientStake.selector);
        rev.requestUnstake(STAKE_AMOUNT + 1);
    }

    function test_requestUnstake_pendingRequest_reverts() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(alice);
        rev.requestUnstake(STAKE_AMOUNT / 2);

        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.UnstakePending.selector);
        rev.requestUnstake(STAKE_AMOUNT / 2);
    }

    function test_completeUnstake_afterCooldown() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(alice);
        rev.requestUnstake(STAKE_AMOUNT);

        // Alice is tier 4: cooldown = 7 - 4 = 3 days
        vm.warp(block.timestamp + 3 days + 1);

        uint256 balBefore = rev.balanceOf(alice);
        vm.prank(alice);
        rev.completeUnstake();
        assertEq(rev.balanceOf(alice) - balBefore, STAKE_AMOUNT);
    }

    function test_completeUnstake_cooldownNotElapsed_reverts() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(alice);
        rev.requestUnstake(STAKE_AMOUNT);

        // Alice tier 4: 3-day cooldown. Try at 2 days.
        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.CooldownNotElapsed.selector);
        rev.completeUnstake();
    }

    function test_completeUnstake_noRequest_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.NoUnstakeRequest.selector);
        rev.completeUnstake();
    }

    function test_cancelUnstake_valid() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(alice);
        rev.requestUnstake(STAKE_AMOUNT);
        assertEq(rev.stakedBalanceOf(alice), 0);

        vm.prank(alice);
        rev.cancelUnstake();
        assertEq(rev.stakedBalanceOf(alice), STAKE_AMOUNT);
        assertEq(rev.totalStaked(), STAKE_AMOUNT);
    }

    function test_cancelUnstake_noRequest_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IVibeRevShare.NoUnstakeRequest.selector);
        rev.cancelUnstake();
    }

    // ============ Cooldown Tests ============

    function test_effectiveCooldown_tier4() public view {
        // tier 4: 7 - 4 = 3 days
        assertEq(rev.effectiveCooldown(alice), 3 days);
    }

    function test_effectiveCooldown_tier2() public view {
        // tier 2: 7 - 2 = 5 days
        assertEq(rev.effectiveCooldown(bob), 5 days);
    }

    function test_effectiveCooldown_tier0() public view {
        // tier 0: 7 - 0 = 7 days
        assertEq(rev.effectiveCooldown(charlie), 7 days);
    }

    function test_effectiveCooldown_minCooldown() public {
        // Set tier to max (would give 7 - 5*1 = 2 days, but capped at MIN_COOLDOWN=2)
        oracle.setTier(dave, 4);
        assertEq(rev.effectiveCooldown(dave), 3 days); // 7 - 4 = 3

        // Even hypothetical tier 6 would be capped at 2 days
        oracle.setTier(dave, 5);
        assertEq(rev.effectiveCooldown(dave), 2 days); // 7 - 5 = 2 = MIN_COOLDOWN
    }

    function test_cooldownRemaining() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(alice);
        rev.requestUnstake(STAKE_AMOUNT);

        // Initially: 3 days remaining
        assertEq(rev.cooldownRemaining(alice), 3 days);

        // After 1 day: 2 days remaining
        vm.warp(block.timestamp + 1 days);
        assertEq(rev.cooldownRemaining(alice), 2 days);

        // After 3 days: 0 remaining
        vm.warp(block.timestamp + 2 days + 1);
        assertEq(rev.cooldownRemaining(alice), 0);
    }

    // ============ Revenue Source Tests ============

    function test_setRevenueSource_valid() public {
        rev.setRevenueSource(dave, true);
        assertTrue(rev.authorizedSources(dave));

        rev.setRevenueSource(dave, false);
        assertFalse(rev.authorizedSources(dave));
    }

    function test_setRevenueSource_zeroAddress_reverts() public {
        vm.expectRevert(IVibeRevShare.ZeroAddress.selector);
        rev.setRevenueSource(address(0), true);
    }

    function test_setRevenueSource_notOwner_reverts() public {
        vm.prank(bob);
        vm.expectRevert();
        rev.setRevenueSource(dave, true);
    }

    // ============ JUL Rewards Tests ============

    function test_depositJulRewards_valid() public {
        rev.depositJulRewards(100 ether);
        assertEq(rev.julRewardPool(), 100 ether);
    }

    function test_depositJulRewards_zeroAmount_reverts() public {
        vm.expectRevert(IVibeRevShare.ZeroAmount.selector);
        rev.depositJulRewards(0);
    }

    // ============ View Tests ============

    function test_getStakeInfo() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        IVibeRevShare.StakeInfo memory info = rev.getStakeInfo(alice);
        assertEq(info.stakedBalance, STAKE_AMOUNT);
        assertEq(info.pendingRewards, REVENUE);
        assertEq(info.unstakeRequestTime, 0);
        assertEq(info.unstakeRequestAmount, 0);
    }

    function test_rewardPerToken() public {
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        assertEq(rev.rewardPerToken(), 0);

        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        // rewardPerToken = REVENUE * 1e18 / STAKE_AMOUNT
        assertEq(rev.rewardPerToken(), (REVENUE * 1e18) / STAKE_AMOUNT);
    }

    // ============ ERC-20 Transfer Tests ============

    function test_transfer_unstaked() public {
        uint256 amount = 1000 ether;
        vm.prank(alice);
        rev.transfer(dave, amount);

        assertEq(rev.balanceOf(dave), amount);
        assertEq(rev.balanceOf(alice), MINT_AMOUNT - amount);
    }

    function test_stakedTokensNotTransferable() public {
        vm.prank(alice);
        rev.stake(MINT_AMOUNT);

        // All tokens staked, balance is 0
        assertEq(rev.balanceOf(alice), 0);

        // Can't transfer staked tokens
        vm.prank(alice);
        vm.expectRevert();
        rev.transfer(bob, 1);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // 1. Alice and Bob stake
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT * 3); // 75%
        vm.prank(bob);
        rev.stake(STAKE_AMOUNT);     // 25%

        // 2. Revenue deposited
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        // 3. Alice claims
        uint256 aliceEarned = rev.earned(alice);
        assertEq(aliceEarned, (REVENUE * 3) / 4);
        vm.prank(alice);
        rev.claimRevenue();

        // 4. More revenue
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        // 5. Alice unstakes
        vm.prank(alice);
        rev.requestUnstake(STAKE_AMOUNT * 3);

        // 6. Bob is now the only staker for future revenue
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);
        assertEq(rev.earned(bob), (REVENUE / 4) + REVENUE / 4 + REVENUE); // 25% + 25% + 100%

        // 7. Alice completes unstake after cooldown
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(alice);
        rev.completeUnstake();

        // 8. Alice claims remaining revenue (earned from Rev2 before unstaking)
        vm.prank(alice);
        rev.claimRevenue();

        // 9. Bob claims all accumulated revenue
        vm.prank(bob);
        rev.claimRevenue();

        // Verify solvency — all revenue claimed
        assertEq(
            rev.totalRevenueClaimed(),
            rev.totalRevenueDeposited()
        );
    }

    function test_lateStakerEarnsFromNewRevenueOnly() public {
        // Alice stakes first
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);

        // Revenue deposited — all to alice
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        // Bob stakes now
        vm.prank(bob);
        rev.stake(STAKE_AMOUNT);

        // Bob earned nothing from first deposit
        assertEq(rev.earned(bob), 0);

        // New revenue — split between alice and bob
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        assertEq(rev.earned(alice), REVENUE + REVENUE / 2);
        assertEq(rev.earned(bob), REVENUE / 2);
    }

    function test_noStakers_revenueAccumulates() public {
        // Revenue deposited with no stakers
        vm.prank(charlie);
        rev.depositRevenue(REVENUE);

        // Nobody earns (no stakers)
        // Revenue is in the contract but not distributed via accumulator
        assertEq(rev.totalRevenueDeposited(), REVENUE);

        // Alice stakes — but doesn't retroactively earn
        vm.prank(alice);
        rev.stake(STAKE_AMOUNT);
        assertEq(rev.earned(alice), 0);
    }
}
