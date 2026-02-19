// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/LiquidityGauge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockGaugeFuzzReward is ERC20 {
    constructor() ERC20("Reward", "RWD") {
        _mint(msg.sender, 100_000_000 ether);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockGaugeFuzzLP is ERC20 {
    constructor() ERC20("LP Token", "LP") {
        _mint(msg.sender, 100_000_000 ether);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract LiquidityGaugeFuzzTest is Test {
    MockGaugeFuzzReward rewardToken;
    MockGaugeFuzzLP lpToken;
    LiquidityGauge gauge;

    bytes32 poolId = keccak256("POOL_FUZZ");
    uint256 constant EMISSION_RATE = 10 ether;
    uint256 constant EPOCH_DURATION = 7 days;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        rewardToken = new MockGaugeFuzzReward();
        lpToken = new MockGaugeFuzzLP();

        gauge = new LiquidityGauge(
            address(rewardToken),
            EMISSION_RATE,
            EPOCH_DURATION
        );

        // Fund gauge
        rewardToken.transfer(address(gauge), 50_000_000 ether);

        // Create gauge and set weight
        gauge.createGauge(poolId, address(lpToken));
        bytes32[] memory pools = new bytes32[](1);
        pools[0] = poolId;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;
        gauge.updateWeights(pools, weights);

        // Fund users
        lpToken.mint(alice, 10_000_000 ether);
        lpToken.mint(bob, 10_000_000 ether);

        vm.prank(alice);
        lpToken.approve(address(gauge), type(uint256).max);
        vm.prank(bob);
        lpToken.approve(address(gauge), type(uint256).max);
    }

    // ============ Fuzz: stake amount correctly tracked ============

    function testFuzz_stakeTracked(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolId, amount);

        ILiquidityGauge.GaugeInfo memory info = gauge.gaugeInfo(poolId);
        assertEq(info.totalStaked, amount);

        ILiquidityGauge.UserInfo memory uInfo = gauge.userInfo(poolId, alice);
        assertEq(uInfo.staked, amount);
    }

    // ============ Fuzz: withdraw cannot exceed stake ============

    function testFuzz_withdrawBounded(uint256 stakeAmt, uint256 withdrawAmt) public {
        stakeAmt = bound(stakeAmt, 1 ether, 10_000_000 ether);
        withdrawAmt = bound(withdrawAmt, 1, 20_000_000 ether);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolId, stakeAmt);

        if (withdrawAmt > stakeAmt) {
            vm.prank(alice);
            vm.expectRevert(ILiquidityGauge.InsufficientStake.selector);
            gauge.withdraw(poolId, withdrawAmt);
        } else {
            vm.prank(alice);
            gauge.withdraw(poolId, withdrawAmt);
            ILiquidityGauge.UserInfo memory uInfo = gauge.userInfo(poolId, alice);
            assertEq(uInfo.staked, stakeAmt - withdrawAmt);
        }
    }

    // ============ Fuzz: rewards proportional to time ============

    function testFuzz_rewardsLinearInTime(uint256 elapsed) public {
        elapsed = bound(elapsed, 1, 100_000);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolId, 1000 ether);

        vm.warp(1000 + elapsed);

        uint256 pending = gauge.pendingRewards(poolId, alice);
        // 10 tokens/sec * elapsed
        assertEq(pending, EMISSION_RATE * elapsed);
    }

    // ============ Fuzz: two stakers split proportionally ============

    function testFuzz_twoStakersSplit(uint256 aliceAmt, uint256 bobAmt, uint256 elapsed) public {
        aliceAmt = bound(aliceAmt, 1 ether, 1_000_000 ether);
        bobAmt = bound(bobAmt, 1 ether, 1_000_000 ether);
        elapsed = bound(elapsed, 1, 10_000);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolId, aliceAmt);
        vm.prank(bob);
        gauge.stake(poolId, bobAmt);

        vm.warp(1000 + elapsed);

        uint256 alicePending = gauge.pendingRewards(poolId, alice);
        uint256 bobPending = gauge.pendingRewards(poolId, bob);

        uint256 totalEmissions = EMISSION_RATE * elapsed;

        // Sum of rewards should equal total emissions (rounding tolerance from rewardPerToken division)
        assertApproxEqAbs(alicePending + bobPending, totalEmissions, EMISSION_RATE);

        // Each gets proportional share
        if (aliceAmt > 0 && bobAmt > 0) {
            assertApproxEqRel(
                alicePending * bobAmt,
                bobPending * aliceAmt,
                0.01e18 // 1% tolerance for integer rounding
            );
        }
    }

    // ============ Fuzz: stake then full withdraw returns LP tokens ============

    function testFuzz_stakeWithdrawReturnsTokens(uint256 amount) public {
        amount = bound(amount, 1 ether, 10_000_000 ether);

        uint256 balBefore = lpToken.balanceOf(alice);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolId, amount);

        assertEq(lpToken.balanceOf(alice), balBefore - amount);

        vm.warp(1100);
        vm.prank(alice);
        gauge.withdraw(poolId, amount);

        assertEq(lpToken.balanceOf(alice), balBefore);
    }

    // ============ Fuzz: claim gives correct reward tokens ============

    function testFuzz_claimRewards(uint256 stakeAmt, uint256 elapsed) public {
        stakeAmt = bound(stakeAmt, 1 ether, 1_000_000 ether);
        elapsed = bound(elapsed, 1, 10_000);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolId, stakeAmt);

        vm.warp(1000 + elapsed);

        uint256 expectedReward = EMISSION_RATE * elapsed;
        uint256 balBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        gauge.claimRewards(poolId);

        uint256 claimed = rewardToken.balanceOf(alice) - balBefore;
        // Small rounding from rewardPerToken division
        assertApproxEqAbs(claimed, expectedReward, stakeAmt / 1e18 + 1);
    }

    // ============ Fuzz: emission rate change mid-epoch ============

    function testFuzz_emissionRateChange(uint256 rate1, uint256 rate2, uint256 t1, uint256 t2) public {
        rate1 = bound(rate1, 1 ether, 100 ether);
        rate2 = bound(rate2, 1 ether, 100 ether);
        t1 = bound(t1, 1, 1000);
        t2 = bound(t2, 1, 1000);

        gauge.setEmissionRate(rate1);

        vm.warp(1000);
        vm.prank(alice);
        gauge.stake(poolId, 1000 ether);

        vm.warp(1000 + t1);
        gauge.setEmissionRate(rate2);

        vm.warp(1000 + t1 + t2);

        uint256 pending = gauge.pendingRewards(poolId, alice);
        uint256 expected = rate1 * t1 + rate2 * t2;

        // Rounding tolerance from rewardPerToken integer division (scales with emission rate)
        uint256 maxRate = rate1 > rate2 ? rate1 : rate2;
        assertApproxEqAbs(pending, expected, maxRate);
    }

    // ============ Fuzz: weight updates preserve total ============

    function testFuzz_weightUpdate(uint256 w1, uint256 w2) public {
        w1 = bound(w1, 0, 10_000);
        w2 = bound(w2, 0, 10_000);

        bytes32 poolId2 = keccak256("POOL_FUZZ_2");
        MockGaugeFuzzLP lpToken2 = new MockGaugeFuzzLP();
        gauge.createGauge(poolId2, address(lpToken2));

        bytes32[] memory pools = new bytes32[](2);
        pools[0] = poolId;
        pools[1] = poolId2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = w1;
        weights[1] = w2;
        gauge.updateWeights(pools, weights);

        assertEq(gauge.totalWeight(), w1 + w2);
    }
}
