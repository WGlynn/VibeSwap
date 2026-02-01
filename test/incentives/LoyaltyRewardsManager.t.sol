// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/LoyaltyRewardsManager.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LoyaltyRewardsManagerTest is Test {
    LoyaltyRewardsManager public manager;
    MockERC20 public rewardToken;

    address public owner;
    address public controller;
    address public treasury;
    address public alice;
    address public bob;
    address public charlie;

    bytes32 public constant POOL_ID = keccak256("pool-1");

    event StakeRegistered(bytes32 indexed poolId, address indexed lp, uint256 amount);
    event RewardsClaimed(bytes32 indexed poolId, address indexed lp, uint256 amount);
    event PenaltyApplied(bytes32 indexed poolId, address indexed lp, uint256 penaltyAmount);

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        // Deploy reward token
        rewardToken = new MockERC20("Vibe Token", "VIBE");

        // Deploy manager
        LoyaltyRewardsManager impl = new LoyaltyRewardsManager();
        bytes memory initData = abi.encodeWithSelector(
            LoyaltyRewardsManager.initialize.selector,
            owner,
            controller,
            treasury,
            address(rewardToken)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        manager = LoyaltyRewardsManager(address(proxy));

        // Fund manager with rewards
        rewardToken.mint(address(manager), 10000 ether);
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(manager.owner(), owner);
        assertEq(manager.incentiveController(), controller);
        assertEq(manager.treasury(), treasury);
        assertEq(manager.rewardToken(), address(rewardToken));
        assertEq(manager.treasuryPenaltyShareBps(), 3000); // 30%
    }

    function test_loyaltyTiers() public view {
        // Tier 0: Week 1 - 1.0x, 5% penalty
        (uint256 min0, uint256 mult0, uint256 pen0) = manager.loyaltyTiers(0);
        assertEq(min0, 7 days);
        assertEq(mult0, 10000);
        assertEq(pen0, 500);

        // Tier 1: Month 1 - 1.25x, 3% penalty
        (uint256 min1, uint256 mult1, uint256 pen1) = manager.loyaltyTiers(1);
        assertEq(min1, 30 days);
        assertEq(mult1, 12500);
        assertEq(pen1, 300);

        // Tier 2: Month 3 - 1.5x, 1% penalty
        (uint256 min2, uint256 mult2, uint256 pen2) = manager.loyaltyTiers(2);
        assertEq(min2, 90 days);
        assertEq(mult2, 15000);
        assertEq(pen2, 100);

        // Tier 3: Year 1 - 2.0x, 0% penalty
        (uint256 min3, uint256 mult3, uint256 pen3) = manager.loyaltyTiers(3);
        assertEq(min3, 365 days);
        assertEq(mult3, 20000);
        assertEq(pen3, 0);
    }

    // ============ Stake Registration Tests ============

    function test_registerStake() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        ILoyaltyRewardsManager.LoyaltyPosition memory pos = manager.getPosition(POOL_ID, alice);
        assertEq(pos.stakedAmount, 100 ether);
        assertEq(pos.startTime, block.timestamp);
        assertEq(pos.currentTier, 0);
        assertTrue(pos.active);
    }

    function test_registerStake_multiple() public {
        vm.startPrank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);
        manager.registerStake(POOL_ID, bob, 200 ether);
        manager.registerStake(POOL_ID, charlie, 50 ether);
        vm.stopPrank();

        assertEq(manager.getPosition(POOL_ID, alice).stakedAmount, 100 ether);
        assertEq(manager.getPosition(POOL_ID, bob).stakedAmount, 200 ether);
        assertEq(manager.getPosition(POOL_ID, charlie).stakedAmount, 50 ether);
    }

    function test_registerStake_revertUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert(LoyaltyRewardsManager.Unauthorized.selector);
        manager.registerStake(POOL_ID, alice, 100 ether);
    }

    // ============ Tier Progression Tests ============

    function test_tierProgression() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        // Initially tier 0
        assertEq(manager.getCurrentTier(POOL_ID, alice), 0);

        // After 7 days - still tier 0 (need to pass threshold)
        vm.warp(block.timestamp + 7 days);
        assertEq(manager.getCurrentTier(POOL_ID, alice), 0);

        // After 30 days - tier 1
        vm.warp(block.timestamp + 30 days);
        assertEq(manager.getCurrentTier(POOL_ID, alice), 1);

        // After 90 days - tier 2
        vm.warp(block.timestamp + 90 days);
        assertEq(manager.getCurrentTier(POOL_ID, alice), 2);

        // After 365 days - tier 3 (max)
        vm.warp(block.timestamp + 365 days);
        assertEq(manager.getCurrentTier(POOL_ID, alice), 3);
    }

    function test_getMultiplier() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        // Tier 0: 1.0x
        assertEq(manager.getMultiplier(POOL_ID, alice), 10000);

        // Tier 1: 1.25x
        vm.warp(block.timestamp + 31 days);
        assertEq(manager.getMultiplier(POOL_ID, alice), 12500);

        // Tier 2: 1.5x
        vm.warp(block.timestamp + 91 days);
        assertEq(manager.getMultiplier(POOL_ID, alice), 15000);

        // Tier 3: 2.0x
        vm.warp(block.timestamp + 366 days);
        assertEq(manager.getMultiplier(POOL_ID, alice), 20000);
    }

    // ============ Reward Distribution Tests ============

    function test_distributeRewards() public {
        // Register stakes
        vm.startPrank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);
        manager.registerStake(POOL_ID, bob, 100 ether);
        vm.stopPrank();

        // Add rewards to pool
        vm.prank(controller);
        manager.addPoolRewards(POOL_ID, 100 ether);

        // Check pending rewards (should be ~50 each with same stake and tier)
        uint256 aliceRewards = manager.getPendingRewards(POOL_ID, alice);
        uint256 bobRewards = manager.getPendingRewards(POOL_ID, bob);

        assertGt(aliceRewards, 0);
        assertGt(bobRewards, 0);
        assertApproxEqRel(aliceRewards, bobRewards, 0.01e18);
    }

    function test_distributeRewards_withMultipliers() public {
        // Register stakes at different times
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        // Bob stakes 30 days later
        vm.warp(block.timestamp + 30 days);
        vm.prank(controller);
        manager.registerStake(POOL_ID, bob, 100 ether);

        // Add rewards after another 30 days
        // Alice now at tier 1 (1.25x), Bob at tier 0 (1.0x)
        vm.warp(block.timestamp + 30 days);
        vm.prank(controller);
        manager.addPoolRewards(POOL_ID, 100 ether);

        uint256 aliceRewards = manager.getPendingRewards(POOL_ID, alice);
        uint256 bobRewards = manager.getPendingRewards(POOL_ID, bob);

        // Alice should get more due to higher multiplier
        assertGt(aliceRewards, bobRewards);
    }

    // ============ Claim Tests ============

    function test_claimRewards() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        vm.prank(controller);
        manager.addPoolRewards(POOL_ID, 100 ether);

        uint256 pending = manager.getPendingRewards(POOL_ID, alice);
        uint256 balanceBefore = rewardToken.balanceOf(alice);

        vm.prank(controller);
        uint256 claimed = manager.claimRewards(POOL_ID, alice);

        assertEq(claimed, pending);
        assertEq(rewardToken.balanceOf(alice), balanceBefore + claimed);
    }

    // ============ Early Exit Penalty Tests ============

    function test_earlyExitPenalty_tier0() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        // Add some rewards
        vm.prank(controller);
        manager.addPoolRewards(POOL_ID, 100 ether);

        // Exit immediately (tier 0: 5% penalty)
        uint256 pending = manager.getPendingRewards(POOL_ID, alice);

        vm.prank(controller);
        (uint256 rewards, uint256 penalty) = manager.unstake(POOL_ID, alice);

        // Penalty should be 5% of pending
        assertEq(penalty, (pending * 500) / 10000);
        assertEq(rewards, pending - penalty);
    }

    function test_earlyExitPenalty_redistribution() public {
        // Alice and Bob stake
        vm.startPrank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);
        manager.registerStake(POOL_ID, bob, 100 ether);
        manager.addPoolRewards(POOL_ID, 100 ether);
        vm.stopPrank();

        uint256 treasuryBefore = rewardToken.balanceOf(treasury);
        uint256 bobBefore = manager.getPendingRewards(POOL_ID, bob);

        // Alice exits early with penalty
        vm.prank(controller);
        (,uint256 penalty) = manager.unstake(POOL_ID, alice);

        assertGt(penalty, 0);

        // 30% to treasury
        uint256 treasuryShare = (penalty * 3000) / 10000;
        assertEq(rewardToken.balanceOf(treasury), treasuryBefore + treasuryShare);

        // 70% redistributed to remaining LPs (Bob)
        uint256 lpShare = penalty - treasuryShare;
        uint256 bobAfter = manager.getPendingRewards(POOL_ID, bob);
        assertApproxEqRel(bobAfter, bobBefore + lpShare, 0.01e18);
    }

    function test_noEarlyExitPenalty_tier3() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        vm.prank(controller);
        manager.addPoolRewards(POOL_ID, 100 ether);

        // Warp to tier 3 (365+ days - no penalty)
        vm.warp(block.timestamp + 366 days);

        uint256 pending = manager.getPendingRewards(POOL_ID, alice);

        vm.prank(controller);
        (uint256 rewards, uint256 penalty) = manager.unstake(POOL_ID, alice);

        // No penalty at tier 3
        assertEq(penalty, 0);
        assertEq(rewards, pending);
    }

    // ============ Pool State Tests ============

    function test_poolRewardState() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        vm.prank(controller);
        manager.addPoolRewards(POOL_ID, 100 ether);

        ILoyaltyRewardsManager.PoolRewardState memory state = manager.getPoolState(POOL_ID);

        assertEq(state.totalStaked, 100 ether);
        assertGt(state.rewardPerShare, 0);
    }

    // ============ Admin Tests ============

    function test_setTreasuryPenaltyShare() public {
        manager.setTreasuryPenaltyShare(5000); // 50%
        assertEq(manager.treasuryPenaltyShareBps(), 5000);
    }

    function test_setLoyaltyTier() public {
        manager.setLoyaltyTier(0, 14 days, 11000, 400); // 2 weeks, 1.1x, 4% penalty

        (uint256 min, uint256 mult, uint256 pen) = manager.loyaltyTiers(0);
        assertEq(min, 14 days);
        assertEq(mult, 11000);
        assertEq(pen, 400);
    }

    // ============ Edge Cases ============

    function test_zeroRewards() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        // No rewards added
        assertEq(manager.getPendingRewards(POOL_ID, alice), 0);

        // Claim should return 0
        vm.prank(controller);
        uint256 claimed = manager.claimRewards(POOL_ID, alice);
        assertEq(claimed, 0);
    }

    function test_multiplePoolsIndependent() public {
        bytes32 pool2 = keccak256("pool-2");

        vm.startPrank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);
        manager.registerStake(pool2, alice, 50 ether);
        manager.addPoolRewards(POOL_ID, 100 ether);
        // No rewards for pool2
        vm.stopPrank();

        // Should have rewards in POOL_ID, not in pool2
        assertGt(manager.getPendingRewards(POOL_ID, alice), 0);
        assertEq(manager.getPendingRewards(pool2, alice), 0);
    }
}
