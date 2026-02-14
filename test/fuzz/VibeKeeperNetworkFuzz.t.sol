// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/governance/VibeKeeperNetwork.sol";
import "../../contracts/governance/interfaces/IVibeKeeperNetwork.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockKNFuzzToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockKNFuzzOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockKNFuzzTarget {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
}

// ============ Fuzz Tests ============

contract VibeKeeperNetworkFuzzTest is Test {
    VibeKeeperNetwork public network;
    MockKNFuzzToken public jul;
    MockKNFuzzOracle public oracle;
    MockKNFuzzTarget public target;

    address public keeper;

    function setUp() public {
        keeper = makeAddr("keeper");

        jul = new MockKNFuzzToken("JUL", "JUL");
        oracle = new MockKNFuzzOracle();
        target = new MockKNFuzzTarget();

        network = new VibeKeeperNetwork(address(jul), address(oracle));

        jul.mint(keeper, 100_000 ether);
        jul.mint(address(this), 100_000 ether);

        vm.prank(keeper);
        jul.approve(address(network), type(uint256).max);
        jul.approve(address(network), type(uint256).max);

        network.depositRewards(50_000 ether);
        network.registerTask(address(target), target.setValue.selector, 10 ether, 0);
    }

    // ============ Stake Properties ============

    function testFuzz_effectiveMinStakeNeverBelowFloor(uint8 tierSeed) public {
        uint8 tier = uint8(bound(tierSeed, 0, 255));
        oracle.setTier(keeper, tier);
        assertGe(network.effectiveMinStake(keeper), 25 ether);
    }

    function testFuzz_effectiveMinStakeMonotonic() public {
        uint256 prevStake = type(uint256).max;
        for (uint8 tier = 0; tier <= 4; tier++) {
            oracle.setTier(keeper, tier);
            uint256 stake = network.effectiveMinStake(keeper);
            assertLe(stake, prevStake);
            prevStake = stake;
        }
    }

    function testFuzz_registerWithExactMinStake(uint8 tierSeed) public {
        uint8 tier = uint8(bound(tierSeed, 0, 4));
        oracle.setTier(keeper, tier);

        uint256 minStake = network.effectiveMinStake(keeper);

        vm.prank(keeper);
        network.registerKeeper(minStake);
        assertTrue(network.isActiveKeeper(keeper));
    }

    function testFuzz_registerBelowMinStakeReverts(uint8 tierSeed) public {
        uint8 tier = uint8(bound(tierSeed, 0, 4));
        oracle.setTier(keeper, tier);

        uint256 minStake = network.effectiveMinStake(keeper);
        if (minStake == 0) return;

        vm.prank(keeper);
        vm.expectRevert(IVibeKeeperNetwork.InsufficientStake.selector);
        network.registerKeeper(minStake - 1);
    }

    // ============ Execution Properties ============

    function testFuzz_executeAlwaysUpdatesState(uint256 valueSeed) public {
        uint256 val = bound(valueSeed, 0, type(uint128).max);

        vm.prank(keeper);
        network.registerKeeper(100 ether);

        bytes memory data = abi.encodeCall(MockKNFuzzTarget.setValue, (val));
        vm.prank(keeper);
        network.executeTask(0, data);

        assertEq(target.value(), val);
        assertEq(network.pendingRewards(keeper), 10 ether);
    }

    function testFuzz_multipleExecutionsAccumulateRewards(uint256 count) public {
        count = bound(count, 1, 20);

        vm.prank(keeper);
        network.registerKeeper(100 ether);

        for (uint256 i = 0; i < count; i++) {
            bytes memory data = abi.encodeCall(MockKNFuzzTarget.setValue, (i));
            vm.prank(keeper);
            network.executeTask(0, data);
        }

        assertEq(network.pendingRewards(keeper), 10 ether * count);

        IVibeKeeperNetwork.KeeperInfo memory k = network.getKeeper(keeper);
        assertEq(k.totalExecutions, count);
    }

    // ============ Performance Properties ============

    function testFuzz_performanceNeverExceeds10000(uint256 successes, uint256 failures) public {
        successes = bound(successes, 0, 100);
        failures = bound(failures, 0, 100);

        vm.prank(keeper);
        network.registerKeeper(100 ether);

        for (uint256 i = 0; i < successes; i++) {
            bytes memory data = abi.encodeCall(MockKNFuzzTarget.setValue, (i));
            vm.prank(keeper);
            network.executeTask(0, data);
        }

        // Can't easily inject failures through fuzz, but verify bounds with successes only
        uint256 perf = network.keeperPerformance(keeper);
        assertLe(perf, 10_000);
    }

    // ============ Slash Properties ============

    function testFuzz_slashNeverExceedsStake(uint256 slashAmount) public {
        vm.prank(keeper);
        network.registerKeeper(100 ether);

        slashAmount = bound(slashAmount, 1, 100 ether);

        network.slashKeeper(keeper, slashAmount, "test");

        IVibeKeeperNetwork.KeeperInfo memory k = network.getKeeper(keeper);
        assertEq(k.stakedAmount, 100 ether - slashAmount);
        assertEq(k.totalSlashed, slashAmount);
    }

    function testFuzz_slashedFundsGoToRewardPool(uint256 slashAmount) public {
        vm.prank(keeper);
        network.registerKeeper(100 ether);

        slashAmount = bound(slashAmount, 1, 100 ether);
        uint256 poolBefore = network.rewardPool();

        network.slashKeeper(keeper, slashAmount, "test");

        assertEq(network.rewardPool(), poolBefore + slashAmount);
    }
}
