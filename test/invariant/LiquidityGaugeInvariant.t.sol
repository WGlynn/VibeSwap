// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/incentives/LiquidityGauge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockGaugeInvReward is ERC20 {
    constructor() ERC20("Reward", "RWD") {
        _mint(msg.sender, 100_000_000 ether);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockGaugeInvLP is ERC20 {
    constructor() ERC20("LP Token", "LP") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract GaugeHandler is Test {
    LiquidityGauge public gauge;
    MockGaugeInvLP public lpToken;
    MockGaugeInvReward public rewardToken;
    bytes32 public poolId;

    address[] public actors;

    uint256 public ghost_totalStaked;
    uint256 public ghost_totalClaimed;
    uint256 public ghost_stakeCount;
    uint256 public ghost_withdrawCount;

    constructor(LiquidityGauge _gauge, MockGaugeInvLP _lpToken, MockGaugeInvReward _rewardToken, bytes32 _poolId) {
        gauge = _gauge;
        lpToken = _lpToken;
        rewardToken = _rewardToken;
        poolId = _poolId;

        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0xC000 + i));
            actors.push(actor);
            lpToken.mint(actor, 10_000_000 ether);
            vm.prank(actor);
            lpToken.approve(address(gauge), type(uint256).max);
        }
    }

    function stake(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1 ether, 100_000 ether);

        // Warp forward a bit to accrue rewards
        vm.warp(block.timestamp + bound(actorSeed, 1, 100));

        vm.prank(actor);
        try gauge.stake(poolId, amount) {
            ghost_totalStaked += amount;
            ghost_stakeCount++;
        } catch {}
    }

    function withdraw(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        ILiquidityGauge.UserInfo memory info = gauge.userInfo(poolId, actor);
        if (info.staked == 0) return;

        amount = bound(amount, 1, info.staked);

        vm.warp(block.timestamp + bound(actorSeed, 1, 100));

        vm.prank(actor);
        try gauge.withdraw(poolId, amount) {
            ghost_totalStaked -= amount;
            ghost_withdrawCount++;
        } catch {}
    }

    function claim(uint256 actorSeed) public {
        address actor = actors[actorSeed % actors.length];

        vm.warp(block.timestamp + bound(actorSeed, 1, 100));

        uint256 balBefore = rewardToken.balanceOf(actor);
        vm.prank(actor);
        try gauge.claimRewards(poolId) {
            ghost_totalClaimed += rewardToken.balanceOf(actor) - balBefore;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract LiquidityGaugeInvariantTest is StdInvariant, Test {
    MockGaugeInvReward rewardToken;
    MockGaugeInvLP lpToken;
    LiquidityGauge gauge;
    GaugeHandler handler;

    bytes32 poolId = keccak256("INV_POOL");
    uint256 constant EMISSION_RATE = 10 ether;
    uint256 constant EPOCH_DURATION = 7 days;

    function setUp() public {
        rewardToken = new MockGaugeInvReward();
        lpToken = new MockGaugeInvLP();

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

        // Set starting timestamp
        vm.warp(10_000);

        handler = new GaugeHandler(gauge, lpToken, rewardToken, poolId);
        targetContract(address(handler));
    }

    // ============ Invariant: gauge totalStaked matches handler ghost ============

    function invariant_totalStakedAccurate() public view {
        ILiquidityGauge.GaugeInfo memory info = gauge.gaugeInfo(poolId);
        assertEq(info.totalStaked, handler.ghost_totalStaked());
    }

    // ============ Invariant: LP tokens conserved ============

    function invariant_lpTokenConservation() public view {
        uint256 gaugeBalance = lpToken.balanceOf(address(gauge));
        ILiquidityGauge.GaugeInfo memory info = gauge.gaugeInfo(poolId);
        // Gauge LP balance should equal total staked
        assertEq(gaugeBalance, info.totalStaked);
    }

    // ============ Invariant: individual stakes sum to total ============

    function invariant_stakeSumMatchesTotal() public view {
        uint256 sum;
        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0xC000 + i));
            ILiquidityGauge.UserInfo memory info = gauge.userInfo(poolId, actor);
            sum += info.staked;
        }

        ILiquidityGauge.GaugeInfo memory gInfo = gauge.gaugeInfo(poolId);
        assertEq(sum, gInfo.totalStaked);
    }

    // ============ Invariant: reward token balance never negative ============

    function invariant_gaugeRewardsSolvent() public view {
        uint256 gaugeBal = rewardToken.balanceOf(address(gauge));
        assertGe(gaugeBal, 0);
    }

    // ============ Invariant: gauge weight consistent ============

    function invariant_weightConsistency() public view {
        ILiquidityGauge.GaugeInfo memory info = gauge.gaugeInfo(poolId);
        assertEq(info.weight, 100);
        assertEq(gauge.totalWeight(), 100);
    }
}
