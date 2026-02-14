// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeRevShare.sol";
import "../../contracts/financial/interfaces/IVibeRevShare.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockRevFuzzToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockRevFuzzOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Fuzz Tests ============

contract VibeRevShareFuzzTest is Test {
    VibeRevShare public rev;
    MockRevFuzzToken public usdc;
    MockRevFuzzToken public jul;
    MockRevFuzzOracle public oracle;

    address public alice;
    address public bob;
    address public source;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        source = makeAddr("source");

        jul = new MockRevFuzzToken("JUL", "JUL");
        usdc = new MockRevFuzzToken("USDC", "USDC");
        oracle = new MockRevFuzzOracle();

        rev = new VibeRevShare(address(jul), address(oracle), address(usdc));
        rev.setRevenueSource(source, true);

        // Fund
        rev.mint(alice, type(uint128).max);
        rev.mint(bob, type(uint128).max);
        usdc.mint(source, type(uint128).max);

        vm.prank(alice);
        rev.approve(address(rev), type(uint256).max);
        vm.prank(bob);
        rev.approve(address(rev), type(uint256).max);
        vm.prank(source);
        usdc.approve(address(rev), type(uint256).max);
    }

    // ============ Staking Properties ============

    function testFuzz_stakeIncreasesTotalStaked(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);
        uint256 before = rev.totalStaked();

        vm.prank(alice);
        rev.stake(amount);

        assertEq(rev.totalStaked(), before + amount);
        assertEq(rev.stakedBalanceOf(alice), amount);
    }

    function testFuzz_unstakeDecreasesTotalStaked(uint256 stakeAmt) public {
        stakeAmt = bound(stakeAmt, 1, 10_000_000 ether);

        vm.prank(alice);
        rev.stake(stakeAmt);

        vm.prank(alice);
        rev.requestUnstake(stakeAmt);

        assertEq(rev.totalStaked(), 0);
        assertEq(rev.stakedBalanceOf(alice), 0);
    }

    // ============ Revenue Distribution Properties ============

    function testFuzz_singleStakerGetsAllRevenue(uint256 stakeAmt, uint256 revenueAmt) public {
        stakeAmt = bound(stakeAmt, 1 ether, 10_000_000 ether);
        revenueAmt = bound(revenueAmt, 1 ether, 10_000_000 ether);

        vm.prank(alice);
        rev.stake(stakeAmt);

        vm.prank(source);
        rev.depositRevenue(revenueAmt);

        // Single staker gets all revenue (accumulator rounds by up to stakeAmt/PRECISION)
        uint256 tolerance = stakeAmt / 1e18 + 1;
        assertApproxEqAbs(rev.earned(alice), revenueAmt, tolerance);
    }

    function testFuzz_twoStakersProportional(uint256 aliceStake, uint256 bobStake, uint256 revenueAmt) public {
        aliceStake = bound(aliceStake, 1 ether, 10_000_000 ether);
        bobStake = bound(bobStake, 1 ether, 10_000_000 ether);
        revenueAmt = bound(revenueAmt, 1 ether, 10_000_000 ether);

        vm.prank(alice);
        rev.stake(aliceStake);
        vm.prank(bob);
        rev.stake(bobStake);

        vm.prank(source);
        rev.depositRevenue(revenueAmt);

        uint256 aliceEarned = rev.earned(alice);
        uint256 bobEarned = rev.earned(bob);

        uint256 totalStaked = aliceStake + bobStake;
        uint256 expectedAlice = (revenueAmt * aliceStake) / totalStaked;
        uint256 expectedBob = (revenueAmt * bobStake) / totalStaked;

        // Accumulator rounding: up to totalStaked/PRECISION error per user
        uint256 tolerance = totalStaked / 1e14;
        if (tolerance < 2) tolerance = 2;
        assertApproxEqAbs(aliceEarned, expectedAlice, tolerance);
        assertApproxEqAbs(bobEarned, expectedBob, tolerance);
    }

    function testFuzz_totalClaimedNeverExceedsDeposited(uint256 aliceStake, uint256 bobStake, uint256 revenue1, uint256 revenue2) public {
        aliceStake = bound(aliceStake, 1 ether, 10_000_000 ether);
        bobStake = bound(bobStake, 1 ether, 10_000_000 ether);
        revenue1 = bound(revenue1, 1 ether, 10_000_000 ether);
        revenue2 = bound(revenue2, 1 ether, 10_000_000 ether);

        vm.prank(alice);
        rev.stake(aliceStake);
        vm.prank(bob);
        rev.stake(bobStake);

        vm.prank(source);
        rev.depositRevenue(revenue1);
        vm.prank(source);
        rev.depositRevenue(revenue2);

        // Both claim
        vm.prank(alice);
        rev.claimRevenue();
        vm.prank(bob);
        rev.claimRevenue();

        assertLe(rev.totalRevenueClaimed(), rev.totalRevenueDeposited());
    }

    // ============ Cooldown Properties ============

    function testFuzz_cooldownDecreaseWithTier(uint8 tierSeed) public {
        uint8 tier = uint8(bound(tierSeed, 0, 4));
        oracle.setTier(alice, tier);

        uint256 cooldown = rev.effectiveCooldown(alice);
        uint256 expected = 7 days - (uint256(tier) * 1 days);
        if (expected < 2 days) expected = 2 days;

        assertEq(cooldown, expected);
    }

    function testFuzz_cooldownNeverBelowMinimum(uint8 tierSeed) public {
        uint8 tier = uint8(bound(tierSeed, 0, 255));
        oracle.setTier(alice, tier);

        uint256 cooldown = rev.effectiveCooldown(alice);
        assertGe(cooldown, 2 days, "Cooldown must never be below minimum");
    }

    function testFuzz_cooldownMonotonicWithTier() public {
        uint256 prevCooldown = type(uint256).max;
        for (uint8 tier = 0; tier <= 4; tier++) {
            oracle.setTier(alice, tier);
            uint256 cooldown = rev.effectiveCooldown(alice);
            assertLe(cooldown, prevCooldown, "Higher tier must give equal or lower cooldown");
            prevCooldown = cooldown;
        }
    }

    // ============ Solvency Properties ============

    function testFuzz_contractBalanceCoversObligations(uint256 stakeAmt, uint256 revenueAmt) public {
        stakeAmt = bound(stakeAmt, 1 ether, 10_000_000 ether);
        revenueAmt = bound(revenueAmt, 1 ether, 10_000_000 ether);

        vm.prank(alice);
        rev.stake(stakeAmt);

        vm.prank(source);
        rev.depositRevenue(revenueAmt);

        uint256 contractBalance = usdc.balanceOf(address(rev));
        uint256 unclaimed = rev.earned(alice);

        assertGe(contractBalance, unclaimed, "Contract must hold enough to cover unclaimed revenue");
    }

    // ============ Claim Properties ============

    function testFuzz_claimResetsEarned(uint256 stakeAmt, uint256 revenueAmt) public {
        stakeAmt = bound(stakeAmt, 1 ether, 10_000_000 ether);
        revenueAmt = bound(revenueAmt, 1 ether, 10_000_000 ether);

        vm.prank(alice);
        rev.stake(stakeAmt);

        vm.prank(source);
        rev.depositRevenue(revenueAmt);

        vm.prank(alice);
        rev.claimRevenue();

        assertEq(rev.earned(alice), 0, "Earned must be zero after claim");
    }
}
