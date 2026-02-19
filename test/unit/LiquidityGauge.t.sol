// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/LiquidityGauge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockRewardToken is ERC20 {
    constructor() ERC20("Reward Token", "RWD") {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockLPToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Test Contract ============

contract LiquidityGaugeTest is Test {
    MockRewardToken rewardToken;
    MockLPToken lpTokenA;
    MockLPToken lpTokenB;
    LiquidityGauge gauge;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    bytes32 poolA = keccak256("POOL_A");
    bytes32 poolB = keccak256("POOL_B");

    uint256 constant EMISSION_RATE = 10 ether; // 10 tokens/sec
    uint256 constant EPOCH_DURATION = 7 days;

    function setUp() public {
        rewardToken = new MockRewardToken();
        lpTokenA = new MockLPToken("LP Token A", "LPA");
        lpTokenB = new MockLPToken("LP Token B", "LPB");

        gauge = new LiquidityGauge(
            address(rewardToken),
            EMISSION_RATE,
            EPOCH_DURATION
        );

        // Fund gauge with rewards (enough for full epoch at 10/sec: 604800 * 10 = 6.048M)
        rewardToken.transfer(address(gauge), 7_000_000 ether);

        // Fund users
        lpTokenA.mint(alice, 100_000 ether);
        lpTokenA.mint(bob, 100_000 ether);
        lpTokenA.mint(carol, 100_000 ether);
        lpTokenB.mint(alice, 100_000 ether);
        lpTokenB.mint(bob, 100_000 ether);

        // Approve
        vm.prank(alice);
        lpTokenA.approve(address(gauge), type(uint256).max);
        vm.prank(alice);
        lpTokenB.approve(address(gauge), type(uint256).max);
        vm.prank(bob);
        lpTokenA.approve(address(gauge), type(uint256).max);
        vm.prank(bob);
        lpTokenB.approve(address(gauge), type(uint256).max);
        vm.prank(carol);
        lpTokenA.approve(address(gauge), type(uint256).max);
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(gauge.rewardToken(), address(rewardToken));
        assertEq(gauge.emissionRate(), EMISSION_RATE);
        assertEq(gauge.epochDuration(), EPOCH_DURATION);
        assertEq(gauge.currentEpoch(), 1);
    }

    function test_constructor_revert_zeroAddress() public {
        vm.expectRevert(ILiquidityGauge.ZeroAddress.selector);
        new LiquidityGauge(address(0), EMISSION_RATE, EPOCH_DURATION);
    }

    // ============ Gauge Creation Tests ============

    function test_createGauge() public {
        gauge.createGauge(poolA, address(lpTokenA));

        ILiquidityGauge.GaugeInfo memory info = gauge.gaugeInfo(poolA);
        assertEq(info.lpToken, address(lpTokenA));
        assertEq(info.active, true);
        assertEq(gauge.gaugeCount(), 1);
    }

    function test_createGauge_revert_duplicate() public {
        gauge.createGauge(poolA, address(lpTokenA));
        vm.expectRevert(ILiquidityGauge.GaugeAlreadyExists.selector);
        gauge.createGauge(poolA, address(lpTokenA));
    }

    function test_createGauge_revert_zeroAddress() public {
        vm.expectRevert(ILiquidityGauge.ZeroAddress.selector);
        gauge.createGauge(poolA, address(0));
    }

    function test_createGauge_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        gauge.createGauge(poolA, address(lpTokenA));
    }

    // ============ Stake Tests ============

    function test_stake() public {
        gauge.createGauge(poolA, address(lpTokenA));

        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);

        ILiquidityGauge.GaugeInfo memory info = gauge.gaugeInfo(poolA);
        assertEq(info.totalStaked, 1000 ether);

        ILiquidityGauge.UserInfo memory uInfo = gauge.userInfo(poolA, alice);
        assertEq(uInfo.staked, 1000 ether);
    }

    function test_stake_revert_zeroAmount() public {
        gauge.createGauge(poolA, address(lpTokenA));

        vm.prank(alice);
        vm.expectRevert(ILiquidityGauge.ZeroAmount.selector);
        gauge.stake(poolA, 0);
    }

    function test_stake_revert_inactiveGauge() public {
        gauge.createGauge(poolA, address(lpTokenA));
        gauge.killGauge(poolA);

        vm.prank(alice);
        vm.expectRevert(ILiquidityGauge.GaugeNotActive.selector);
        gauge.stake(poolA, 1000 ether);
    }

    function test_multipleStakers() public {
        gauge.createGauge(poolA, address(lpTokenA));

        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);
        vm.prank(bob);
        gauge.stake(poolA, 2000 ether);

        ILiquidityGauge.GaugeInfo memory info = gauge.gaugeInfo(poolA);
        assertEq(info.totalStaked, 3000 ether);
    }

    // ============ Withdraw Tests ============

    function test_withdraw() public {
        gauge.createGauge(poolA, address(lpTokenA));

        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);

        vm.prank(alice);
        gauge.withdraw(poolA, 500 ether);

        ILiquidityGauge.UserInfo memory uInfo = gauge.userInfo(poolA, alice);
        assertEq(uInfo.staked, 500 ether);
    }

    function test_withdraw_revert_insufficient() public {
        gauge.createGauge(poolA, address(lpTokenA));

        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);

        vm.prank(alice);
        vm.expectRevert(ILiquidityGauge.InsufficientStake.selector);
        gauge.withdraw(poolA, 1001 ether);
    }

    function test_withdraw_revert_zeroAmount() public {
        gauge.createGauge(poolA, address(lpTokenA));

        vm.prank(alice);
        vm.expectRevert(ILiquidityGauge.ZeroAmount.selector);
        gauge.withdraw(poolA, 0);
    }

    // ============ Reward Tests ============

    function test_rewards_singleStaker() public {
        gauge.createGauge(poolA, address(lpTokenA));

        bytes32[] memory pools = new bytes32[](1);
        pools[0] = poolA;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;
        gauge.updateWeights(pools, weights);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);

        // Advance 100 seconds
        vm.warp(1100);

        uint256 pending = gauge.pendingRewards(poolA, alice);
        // 10 tokens/sec * 100 sec * (100 weight / 100 total weight) = 1000 tokens
        assertEq(pending, 1000 ether);
    }

    function test_rewards_twoStakers() public {
        gauge.createGauge(poolA, address(lpTokenA));

        bytes32[] memory pools = new bytes32[](1);
        pools[0] = poolA;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;
        gauge.updateWeights(pools, weights);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);
        vm.prank(bob);
        gauge.stake(poolA, 1000 ether);

        vm.warp(1100);

        uint256 alicePending = gauge.pendingRewards(poolA, alice);
        uint256 bobPending = gauge.pendingRewards(poolA, bob);

        // Equal stakes → equal rewards
        assertEq(alicePending, bobPending);
        assertEq(alicePending, 500 ether); // 1000/2
    }

    function test_rewards_twoGauges() public {
        gauge.createGauge(poolA, address(lpTokenA));
        gauge.createGauge(poolB, address(lpTokenB));

        bytes32[] memory pools = new bytes32[](2);
        pools[0] = poolA;
        pools[1] = poolB;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 70; // 70%
        weights[1] = 30; // 30%
        gauge.updateWeights(pools, weights);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);
        vm.prank(bob);
        gauge.stake(poolB, 1000 ether);

        vm.warp(1100);

        uint256 alicePending = gauge.pendingRewards(poolA, alice);
        uint256 bobPending = gauge.pendingRewards(poolB, bob);

        // 70/30 split
        assertEq(alicePending, 700 ether);
        assertEq(bobPending, 300 ether);
    }

    function test_rewards_claim() public {
        gauge.createGauge(poolA, address(lpTokenA));

        bytes32[] memory pools = new bytes32[](1);
        pools[0] = poolA;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;
        gauge.updateWeights(pools, weights);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);

        vm.warp(1100);

        uint256 balBefore = rewardToken.balanceOf(alice);
        vm.prank(alice);
        gauge.claimRewards(poolA);
        uint256 claimed = rewardToken.balanceOf(alice) - balBefore;

        assertEq(claimed, 1000 ether);

        // Pending should be 0 after claim
        assertEq(gauge.pendingRewards(poolA, alice), 0);
    }

    function test_rewards_claimAll() public {
        gauge.createGauge(poolA, address(lpTokenA));
        gauge.createGauge(poolB, address(lpTokenB));

        bytes32[] memory pools = new bytes32[](2);
        pools[0] = poolA;
        pools[1] = poolB;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 50;
        weights[1] = 50;
        gauge.updateWeights(pools, weights);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);
        vm.prank(alice);
        gauge.stake(poolB, 1000 ether);

        vm.warp(1100);

        uint256 balBefore = rewardToken.balanceOf(alice);
        vm.prank(alice);
        gauge.claimAllRewards(pools);
        uint256 claimed = rewardToken.balanceOf(alice) - balBefore;

        // 10 tokens/sec * 100 sec = 1000 total, all to alice
        assertEq(claimed, 1000 ether);
    }

    function test_rewards_nothingToClaim() public {
        gauge.createGauge(poolA, address(lpTokenA));

        vm.prank(alice);
        vm.expectRevert(ILiquidityGauge.NothingToClaim.selector);
        gauge.claimRewards(poolA);
    }

    function test_rewards_noWeightNoRewards() public {
        gauge.createGauge(poolA, address(lpTokenA));
        // No weights set

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);

        vm.warp(1100);

        assertEq(gauge.pendingRewards(poolA, alice), 0);
    }

    // ============ Weight Management Tests ============

    function test_updateWeights() public {
        gauge.createGauge(poolA, address(lpTokenA));
        gauge.createGauge(poolB, address(lpTokenB));

        bytes32[] memory pools = new bytes32[](2);
        pools[0] = poolA;
        pools[1] = poolB;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 60;
        weights[1] = 40;
        gauge.updateWeights(pools, weights);

        assertEq(gauge.totalWeight(), 100);
        assertEq(gauge.gaugeInfo(poolA).weight, 60);
        assertEq(gauge.gaugeInfo(poolB).weight, 40);
    }

    function test_updateWeights_revert_mismatch() public {
        gauge.createGauge(poolA, address(lpTokenA));

        bytes32[] memory pools = new bytes32[](2);
        pools[0] = poolA;
        pools[1] = poolB;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;

        vm.expectRevert(ILiquidityGauge.ArrayLengthMismatch.selector);
        gauge.updateWeights(pools, weights);
    }

    function test_updateWeights_revert_gaugeNotFound() public {
        bytes32[] memory pools = new bytes32[](1);
        pools[0] = poolA; // not created
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;

        vm.expectRevert(ILiquidityGauge.GaugeNotFound.selector);
        gauge.updateWeights(pools, weights);
    }

    // ============ Epoch Tests ============

    function test_advanceEpoch() public {
        gauge.createGauge(poolA, address(lpTokenA));
        assertEq(gauge.currentEpoch(), 1);

        vm.warp(block.timestamp + EPOCH_DURATION + 1);
        gauge.advanceEpoch();

        assertEq(gauge.currentEpoch(), 2);
    }

    function test_advanceEpoch_revert_tooEarly() public {
        vm.expectRevert(ILiquidityGauge.EpochNotReady.selector);
        gauge.advanceEpoch();
    }

    // ============ Kill Gauge Tests ============

    function test_killGauge() public {
        gauge.createGauge(poolA, address(lpTokenA));

        bytes32[] memory pools = new bytes32[](1);
        pools[0] = poolA;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;
        gauge.updateWeights(pools, weights);

        gauge.killGauge(poolA);

        ILiquidityGauge.GaugeInfo memory info = gauge.gaugeInfo(poolA);
        assertEq(info.active, false);
        assertEq(info.weight, 0);
        assertEq(gauge.totalWeight(), 0);
    }

    function test_killGauge_revert_notFound() public {
        vm.expectRevert(ILiquidityGauge.GaugeNotFound.selector);
        gauge.killGauge(poolA);
    }

    // ============ Emission Rate Tests ============

    function test_setEmissionRate() public {
        gauge.setEmissionRate(20 ether);
        assertEq(gauge.emissionRate(), 20 ether);
    }

    function test_emissionRate_change_midEpoch() public {
        gauge.createGauge(poolA, address(lpTokenA));

        bytes32[] memory pools = new bytes32[](1);
        pools[0] = poolA;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;
        gauge.updateWeights(pools, weights);

        // Use absolute timestamps to avoid optimizer re-reading block.timestamp
        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);

        // 50 seconds at 10/sec
        vm.warp(1050);
        gauge.setEmissionRate(20 ether);

        // 50 more seconds at 20/sec
        vm.warp(1100);

        uint256 pending = gauge.pendingRewards(poolA, alice);
        // 500 + 1000 = 1500
        assertEq(pending, 1500 ether);
    }

    // ============ Late Entry Tests ============

    function test_lateStaker_fairDistribution() public {
        gauge.createGauge(poolA, address(lpTokenA));

        bytes32[] memory pools = new bytes32[](1);
        pools[0] = poolA;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;
        gauge.updateWeights(pools, weights);

        // Use absolute timestamps to avoid optimizer re-reading block.timestamp
        vm.warp(1000);

        // Alice stakes at t=1000
        vm.prank(alice);
        gauge.stake(poolA, 1000 ether);

        // Bob stakes at t=1050
        vm.warp(1050);
        vm.prank(bob);
        gauge.stake(poolA, 1000 ether);

        // Check at t=1100
        vm.warp(1100);

        uint256 alicePending = gauge.pendingRewards(poolA, alice);
        uint256 bobPending = gauge.pendingRewards(poolA, bob);

        // Alice: 50 sec solo (500) + 50 sec shared (250) = 750
        assertEq(alicePending, 750 ether);
        // Bob: 50 sec shared (250)
        assertEq(bobPending, 250 ether);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // 1. Create gauges
        gauge.createGauge(poolA, address(lpTokenA));
        gauge.createGauge(poolB, address(lpTokenB));

        // 2. Set weights
        bytes32[] memory pools = new bytes32[](2);
        pools[0] = poolA;
        pools[1] = poolB;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 70;
        weights[1] = 30;
        gauge.updateWeights(pools, weights);

        // Use absolute timestamp to avoid optimizer re-reading block.timestamp
        vm.warp(1000);

        // 3. Users stake
        vm.prank(alice);
        gauge.stake(poolA, 5000 ether);
        vm.prank(bob);
        gauge.stake(poolB, 3000 ether);
        vm.prank(carol);
        gauge.stake(poolA, 5000 ether);

        // 4. Time passes (1 epoch)
        vm.warp(1000 + EPOCH_DURATION);

        // 5. Advance epoch
        gauge.advanceEpoch();

        // 6. Users claim
        vm.prank(alice);
        gauge.claimRewards(poolA);
        vm.prank(bob);
        gauge.claimRewards(poolB);
        vm.prank(carol);
        gauge.claimRewards(poolA);

        // 7. Verify claims
        uint256 aliceBalance = rewardToken.balanceOf(alice);
        uint256 bobBalance = rewardToken.balanceOf(bob);
        uint256 carolBalance = rewardToken.balanceOf(carol);

        // Alice and Carol split poolA rewards (70% of emissions) equally
        assertEq(aliceBalance, carolBalance);
        // Bob gets all poolB rewards (30% of emissions)
        assertGt(aliceBalance, 0);
        assertGt(bobBalance, 0);
        // alice + carol > bob (70% > 30%)
        assertGt(aliceBalance + carolBalance, bobBalance);
    }
}
