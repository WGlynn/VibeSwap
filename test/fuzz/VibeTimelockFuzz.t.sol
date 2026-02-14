// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/governance/VibeTimelock.sol";
import "../../contracts/governance/interfaces/IVibeTimelock.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockTLFuzzToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockTLFuzzOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockTLFuzzTarget {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
}

// ============ Fuzz Tests ============

contract VibeTimelockFuzzTest is Test {
    VibeTimelock public timelock;
    MockTLFuzzToken public jul;
    MockTLFuzzOracle public oracle;
    MockTLFuzzTarget public target;

    address public proposer;
    address public executor;
    address public canceller;
    address public guardian;

    function setUp() public {
        proposer = makeAddr("proposer");
        executor = makeAddr("executor");
        canceller = makeAddr("canceller");
        guardian = makeAddr("guardian");

        jul = new MockTLFuzzToken("JUL", "JUL");
        oracle = new MockTLFuzzOracle();
        target = new MockTLFuzzTarget();

        address[] memory p = new address[](1);
        p[0] = proposer;
        address[] memory e = new address[](1);
        e[0] = executor;
        address[] memory c = new address[](1);
        c[0] = canceller;

        timelock = new VibeTimelock(
            2 days, address(jul), address(oracle), guardian, p, e, c
        );

        jul.mint(address(this), 10_000 ether);
        jul.approve(address(timelock), type(uint256).max);
        timelock.depositJulRewards(1000 ether);
    }

    // ============ Delay Properties ============

    function testFuzz_effectiveDelayNeverBelowFloor(uint8 tierSeed) public {
        uint8 tier = uint8(bound(tierSeed, 0, 255));
        oracle.setTier(proposer, tier);

        uint256 delay = timelock.effectiveMinDelay(proposer);
        assertGe(delay, 6 hours, "Effective delay must never be below MIN_DELAY_FLOOR");
    }

    function testFuzz_effectiveDelayMonotonic() public {
        uint256 prevDelay = type(uint256).max;
        for (uint8 tier = 0; tier <= 4; tier++) {
            oracle.setTier(proposer, tier);
            uint256 delay = timelock.effectiveMinDelay(proposer);
            assertLe(delay, prevDelay, "Higher tier must give equal or shorter delay");
            prevDelay = delay;
        }
    }

    function testFuzz_effectiveDelayFormula(uint8 tierSeed) public {
        uint8 tier = uint8(bound(tierSeed, 0, 4));
        oracle.setTier(proposer, tier);

        uint256 delay = timelock.effectiveMinDelay(proposer);
        uint256 reduction = uint256(tier) * 6 hours;
        uint256 expected = 2 days > reduction ? 2 days - reduction : 0;
        if (expected < 6 hours) expected = 6 hours;

        assertEq(delay, expected);
    }

    // ============ Schedule / Execute Properties ============

    function testFuzz_scheduleExecute(uint256 valueSeed, uint256 delaySeed) public {
        uint256 val = bound(valueSeed, 0, type(uint128).max);
        uint256 delay = bound(delaySeed, 2 days, 30 days);

        bytes memory data = abi.encodeCall(MockTLFuzzTarget.setValue, (val));
        bytes32 salt = bytes32(valueSeed);

        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, bytes32(0), salt, delay);

        bytes32 id = timelock.hashOperation(address(target), 0, data, bytes32(0), salt);

        // Not ready yet
        assertFalse(timelock.isOperationReady(id));
        assertTrue(timelock.isOperationPending(id));

        // Warp and execute
        vm.warp(block.timestamp + delay);
        assertTrue(timelock.isOperationReady(id));

        vm.prank(executor);
        timelock.execute(address(target), 0, data, bytes32(0), salt);

        assertTrue(timelock.isOperationDone(id));
        assertEq(target.value(), val);
    }

    function testFuzz_cannotExecuteBeforeDelay(uint256 delaySeed, uint256 warpSeed) public {
        uint256 delay = bound(delaySeed, 2 days, 30 days);
        uint256 warp = bound(warpSeed, 0, delay - 1);

        bytes memory data = abi.encodeCall(MockTLFuzzTarget.setValue, (42));

        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, bytes32(0), bytes32("x"), delay);

        vm.warp(block.timestamp + warp);

        vm.prank(executor);
        vm.expectRevert(IVibeTimelock.OperationNotReady.selector);
        timelock.execute(address(target), 0, data, bytes32(0), bytes32("x"));
    }

    // ============ Hash Properties ============

    function testFuzz_hashDeterministic(address tgt, uint256 val, bytes32 pred, bytes32 salt) public view {
        bytes memory data = abi.encodeCall(MockTLFuzzTarget.setValue, (val));
        bytes32 h1 = timelock.hashOperation(tgt, val, data, pred, salt);
        bytes32 h2 = timelock.hashOperation(tgt, val, data, pred, salt);
        assertEq(h1, h2);
    }

    function testFuzz_differentSaltsDifferentHash(bytes32 salt1, bytes32 salt2) public view {
        vm.assume(salt1 != salt2);
        bytes memory data = abi.encodeCall(MockTLFuzzTarget.setValue, (42));
        bytes32 h1 = timelock.hashOperation(address(target), 0, data, bytes32(0), salt1);
        bytes32 h2 = timelock.hashOperation(address(target), 0, data, bytes32(0), salt2);
        assertNotEq(h1, h2);
    }

    // ============ Cancel Properties ============

    function testFuzz_cancelPreventsExecution(uint256 delaySeed) public {
        uint256 delay = bound(delaySeed, 2 days, 30 days);
        bytes memory data = abi.encodeCall(MockTLFuzzTarget.setValue, (42));
        bytes32 salt = bytes32("cancel");

        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, bytes32(0), salt, delay);
        bytes32 id = timelock.hashOperation(address(target), 0, data, bytes32(0), salt);

        vm.prank(canceller);
        timelock.cancel(id);

        vm.warp(block.timestamp + delay + 1);

        vm.prank(executor);
        vm.expectRevert(IVibeTimelock.OperationNotReady.selector);
        timelock.execute(address(target), 0, data, bytes32(0), salt);
    }

    // ============ JUL Tip Properties ============

    function testFuzz_keeperTipDeducted(uint256 iterations) public {
        iterations = bound(iterations, 1, 10);

        uint256 poolBefore = timelock.julRewardPool();
        uint256 executorBalance = jul.balanceOf(executor);

        for (uint256 i = 0; i < iterations; i++) {
            bytes memory data = abi.encodeCall(MockTLFuzzTarget.setValue, (i));
            bytes32 salt = bytes32(i);

            vm.prank(proposer);
            timelock.schedule(address(target), 0, data, bytes32(0), salt, 2 days);
        }

        vm.warp(block.timestamp + 2 days);

        for (uint256 i = 0; i < iterations; i++) {
            bytes memory data = abi.encodeCall(MockTLFuzzTarget.setValue, (i));
            bytes32 salt = bytes32(i);

            vm.prank(executor);
            timelock.execute(address(target), 0, data, bytes32(0), salt);
        }

        uint256 expectedTips = iterations * 10 ether;
        if (expectedTips > poolBefore) expectedTips = poolBefore; // cap at pool

        uint256 actualTips = jul.balanceOf(executor) - executorBalance;
        assertEq(actualTips, expectedTips);
    }
}
