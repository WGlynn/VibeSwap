// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/LoyaltyRewardsManager.sol";
import "../../contracts/incentives/interfaces/ILoyaltyRewardsManager.sol";
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

    bytes32 public constant POOL_ID = keccak256("pool-1");

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

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
    }

    function test_loyaltyTiers() public view {
        // Tier 0: Week 1 - 1.0x, 5% penalty
        ILoyaltyRewardsManager.LoyaltyTier memory tier0 = manager.getTier(0);
        assertEq(tier0.minDuration, 7 days);
        assertEq(tier0.multiplierBps, 10000);
        assertEq(tier0.earlyExitPenaltyBps, 500);

        // Tier 1: Month 1 - 1.25x, 3% penalty
        ILoyaltyRewardsManager.LoyaltyTier memory tier1 = manager.getTier(1);
        assertEq(tier1.minDuration, 30 days);
        assertEq(tier1.multiplierBps, 12500);
        assertEq(tier1.earlyExitPenaltyBps, 300);

        // Tier 2: Month 3 - 1.5x, 1% penalty
        ILoyaltyRewardsManager.LoyaltyTier memory tier2 = manager.getTier(2);
        assertEq(tier2.minDuration, 90 days);
        assertEq(tier2.multiplierBps, 15000);
        assertEq(tier2.earlyExitPenaltyBps, 100);

        // Tier 3: Year 1 - 2.0x, 0% penalty
        ILoyaltyRewardsManager.LoyaltyTier memory tier3 = manager.getTier(3);
        assertEq(tier3.minDuration, 365 days);
        assertEq(tier3.multiplierBps, 20000);
        assertEq(tier3.earlyExitPenaltyBps, 0);
    }

    // ============ Stake Registration Tests ============

    function test_registerStake() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        ILoyaltyRewardsManager.LoyaltyPosition memory pos = manager.getPosition(POOL_ID, alice);
        assertEq(pos.liquidity, 100 ether);
        assertEq(pos.stakeTimestamp, block.timestamp);
    }

    function test_registerStake_multiple() public {
        vm.startPrank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);
        manager.registerStake(POOL_ID, bob, 200 ether);
        vm.stopPrank();

        assertEq(manager.getPosition(POOL_ID, alice).liquidity, 100 ether);
        assertEq(manager.getPosition(POOL_ID, bob).liquidity, 200 ether);
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

        // After 30 days - tier 1
        vm.warp(block.timestamp + 31 days);
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
        assertEq(manager.getLoyaltyMultiplier(POOL_ID, alice), 10000);

        // Tier 1: 1.25x
        vm.warp(block.timestamp + 31 days);
        assertEq(manager.getLoyaltyMultiplier(POOL_ID, alice), 12500);

        // Tier 2: 1.5x
        vm.warp(block.timestamp + 91 days);
        assertEq(manager.getLoyaltyMultiplier(POOL_ID, alice), 15000);

        // Tier 3: 2.0x
        vm.warp(block.timestamp + 366 days);
        assertEq(manager.getLoyaltyMultiplier(POOL_ID, alice), 20000);
    }

    // ============ Pool State Tests ============

    function test_poolRewardState() public {
        vm.prank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);

        ILoyaltyRewardsManager.PoolRewardState memory state = manager.getPoolState(POOL_ID);
        assertEq(state.totalStaked, 100 ether);
    }

    // ============ Admin Tests ============

    function test_setTreasuryPenaltyShare() public {
        manager.setTreasuryPenaltyShare(5000); // 50%
        assertEq(manager.treasuryPenaltyShareBps(), 5000);
    }

    function test_configureTier() public {
        manager.configureTier(0, 14 days, 11000, 400); // 2 weeks, 1.1x, 4% penalty

        ILoyaltyRewardsManager.LoyaltyTier memory tier = manager.getTier(0);
        assertEq(tier.minDuration, 14 days);
        assertEq(tier.multiplierBps, 11000);
        assertEq(tier.earlyExitPenaltyBps, 400);
    }

    // ============ Edge Cases ============

    function test_multiplePoolsIndependent() public {
        bytes32 pool2 = keccak256("pool-2");

        vm.startPrank(controller);
        manager.registerStake(POOL_ID, alice, 100 ether);
        manager.registerStake(pool2, alice, 50 ether);
        vm.stopPrank();

        // Positions should be independent
        assertEq(manager.getPosition(POOL_ID, alice).liquidity, 100 ether);
        assertEq(manager.getPosition(pool2, alice).liquidity, 50 ether);
    }
}
