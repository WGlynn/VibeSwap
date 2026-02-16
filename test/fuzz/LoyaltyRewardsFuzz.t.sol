// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/LoyaltyRewardsManager.sol";
import "../../contracts/incentives/interfaces/ILoyaltyRewardsManager.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockLRFToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract LoyaltyRewardsFuzzTest is Test {
    LoyaltyRewardsManager public manager;
    MockLRFToken public rewardToken;

    address public owner;
    address public controller;
    address public treasury;
    address public lp;

    bytes32 constant POOL_ID = keccak256("pool-1");

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        treasury = makeAddr("treasury");
        lp = makeAddr("lp");

        rewardToken = new MockLRFToken("VIBE", "VIBE");

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

        rewardToken.mint(address(manager), 1_000_000 ether);
    }

    // ============ Fuzz: tier progression correct for any duration ============

    function testFuzz_tierProgression(uint256 duration) public {
        duration = bound(duration, 0, 500 days);

        vm.prank(controller);
        manager.registerStake(POOL_ID, lp, 100 ether);

        vm.warp(block.timestamp + duration);

        uint8 tier = manager.getCurrentTier(POOL_ID, lp);

        if (duration >= 365 days) {
            assertEq(tier, 3, "365+ days = tier 3");
        } else if (duration >= 90 days) {
            assertEq(tier, 2, "90-364 days = tier 2");
        } else if (duration >= 30 days) {
            assertEq(tier, 1, "30-89 days = tier 1");
        } else {
            assertEq(tier, 0, "0-29 days = tier 0");
        }
    }

    // ============ Fuzz: multiplier within valid range ============

    function testFuzz_multiplierInRange(uint256 duration) public {
        duration = bound(duration, 0, 500 days);

        vm.prank(controller);
        manager.registerStake(POOL_ID, lp, 100 ether);

        vm.warp(block.timestamp + duration);

        uint256 multiplier = manager.getLoyaltyMultiplier(POOL_ID, lp);

        assertGe(multiplier, 10000, "Multiplier must be >= 1.0x");
        assertLe(multiplier, 20000, "Multiplier must be <= 2.0x");
    }

    // ============ Fuzz: early exit penalty bounded by tier ============

    function testFuzz_penaltyBoundedByTier(uint256 liquidity, uint256 duration) public {
        liquidity = bound(liquidity, 1 ether, 1_000_000 ether);
        duration = bound(duration, 0, 500 days);

        vm.prank(controller);
        manager.registerStake(POOL_ID, lp, liquidity);

        vm.warp(block.timestamp + duration);

        vm.prank(controller);
        uint256 penalty = manager.recordUnstake(POOL_ID, lp, liquidity);

        // Penalty should be at most 5% (tier 0 = 500 bps)
        uint256 maxPenalty = (liquidity * 500) / 10000;
        assertLe(penalty, maxPenalty, "Penalty must be <= 5% (tier 0 max)");

        // For tier 3 (365+ days), penalty should be 0
        if (duration >= 365 days) {
            assertEq(penalty, 0, "Tier 3 penalty must be 0");
        }
    }

    // ============ Fuzz: register stake updates pool totalStaked ============

    function testFuzz_registerUpdatesPool(uint256 liq1, uint256 liq2) public {
        liq1 = bound(liq1, 1 ether, 1_000_000 ether);
        liq2 = bound(liq2, 1 ether, 1_000_000 ether);

        address lp2 = makeAddr("lp2");

        vm.startPrank(controller);
        manager.registerStake(POOL_ID, lp, liq1);
        manager.registerStake(POOL_ID, lp2, liq2);
        vm.stopPrank();

        ILoyaltyRewardsManager.PoolRewardState memory state = manager.getPoolState(POOL_ID);
        assertEq(state.totalStaked, liq1 + liq2, "Pool totalStaked must sum");
    }

    // ============ Fuzz: deposit rewards increases rewardPerShare ============

    function testFuzz_depositIncreasesRewardPerShare(uint256 liquidity, uint256 rewardAmount) public {
        liquidity = bound(liquidity, 1 ether, 1_000_000 ether);
        rewardAmount = bound(rewardAmount, 1 ether, 100_000 ether);

        vm.prank(controller);
        manager.registerStake(POOL_ID, lp, liquidity);

        ILoyaltyRewardsManager.PoolRewardState memory stateBefore = manager.getPoolState(POOL_ID);

        rewardToken.mint(address(this), rewardAmount);
        rewardToken.approve(address(manager), rewardAmount);
        manager.depositRewards(POOL_ID, rewardAmount);

        ILoyaltyRewardsManager.PoolRewardState memory stateAfter = manager.getPoolState(POOL_ID);
        assertGt(
            stateAfter.rewardPerShareAccumulated,
            stateBefore.rewardPerShareAccumulated,
            "Deposit must increase rewardPerShare"
        );
    }

    // ============ Fuzz: unstake reduces position liquidity ============

    function testFuzz_unstakeReducesLiquidity(uint256 liquidity, uint256 unstakeFraction) public {
        liquidity = bound(liquidity, 2 ether, 1_000_000 ether);
        unstakeFraction = bound(unstakeFraction, 1, 10000);

        vm.prank(controller);
        manager.registerStake(POOL_ID, lp, liquidity);

        uint256 unstakeAmount = (liquidity * unstakeFraction) / 10000;
        if (unstakeAmount == 0) unstakeAmount = 1;
        if (unstakeAmount > liquidity) unstakeAmount = liquidity;

        vm.prank(controller);
        manager.recordUnstake(POOL_ID, lp, unstakeAmount);

        ILoyaltyRewardsManager.LoyaltyPosition memory pos = manager.getPosition(POOL_ID, lp);
        assertEq(pos.liquidity, liquidity - unstakeAmount, "Liquidity must decrease by unstake amount");
    }
}
