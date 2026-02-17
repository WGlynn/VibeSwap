// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/governance/AutomatedRegulator.sol";
import "../../contracts/compliance/FederatedConsensus.sol";

contract MockARFClawbackRegistry {}

contract AutomatedRegulatorFuzzTest is Test {
    AutomatedRegulator public regulator;
    address public monitor;

    function setUp() public {
        monitor = makeAddr("monitor");

        FederatedConsensus consImpl = new FederatedConsensus();
        ERC1967Proxy consProxy = new ERC1967Proxy(
            address(consImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, address(this), 2, 1 days)
        );

        MockARFClawbackRegistry registry = new MockARFClawbackRegistry();
        AutomatedRegulator impl = new AutomatedRegulator();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(AutomatedRegulator.initialize.selector, address(this), address(consProxy), address(registry))
        );
        regulator = AutomatedRegulator(address(proxy));

        regulator.setAuthorizedMonitor(monitor, true);
    }

    /// @notice Volume tracking accumulates correctly
    function testFuzz_volumeAccumulates(uint256 vol1, uint256 vol2, bool isBuy) public {
        vol1 = bound(vol1, 1, 1e24);
        vol2 = bound(vol2, 1, 1e24);
        address trader = makeAddr("trader");
        address cp = makeAddr("cp");

        vm.prank(monitor);
        regulator.reportTrade(trader, cp, vol1, isBuy, 0);
        vm.prank(monitor);
        regulator.reportTrade(trader, cp, vol2, isBuy, 0);

        AutomatedRegulator.WalletActivity memory a = regulator.getWalletActivity(trader);
        if (isBuy) {
            assertEq(a.buyVolume, vol1 + vol2);
        } else {
            assertEq(a.sellVolume, vol1 + vol2);
        }
    }

    /// @notice Window reset clears all counters
    function testFuzz_windowReset(uint256 volume) public {
        volume = bound(volume, 1, 1e24);
        address trader = makeAddr("trader");
        address cp = makeAddr("cp");

        vm.prank(monitor);
        regulator.reportTrade(trader, cp, volume, true, 100);

        vm.warp(block.timestamp + 25 hours);
        vm.prank(monitor);
        regulator.reportTrade(trader, cp, 1, true, 1);

        AutomatedRegulator.WalletActivity memory a = regulator.getWalletActivity(trader);
        assertEq(a.buyVolume, 1);
        assertEq(a.priceImpact, 1);
    }

    /// @notice Violation count only increases
    function testFuzz_violationCountMonotonic(uint8 tradeCount) public {
        tradeCount = uint8(bound(tradeCount, 1, 10));
        address trader = makeAddr("trader");

        uint256 prevCount = regulator.violationCount();
        for (uint8 i = 0; i < tradeCount; i++) {
            vm.prank(monitor);
            regulator.reportTrade(trader, trader, 10_000e18, true, 10);
        }

        assertGe(regulator.violationCount(), prevCount);
    }

    /// @notice Wash trading threshold is enforced
    function testFuzz_washTradingThreshold(uint256 selfTradeVolume) public {
        selfTradeVolume = bound(selfTradeVolume, 1, 100_000e18);
        address trader = makeAddr("trader");

        vm.prank(monitor);
        regulator.reportTrade(trader, trader, selfTradeVolume, true, 0);

        if (selfTradeVolume >= 50_000e18) {
            assertGe(regulator.violationCount(), 1, "Wash trading should be detected");
        } else {
            assertEq(regulator.violationCount(), 0, "Below threshold should not detect");
        }
    }

    /// @notice Sanctions always trigger violation
    function testFuzz_sanctionsAlwaysTrigger(uint256 volume) public {
        volume = bound(volume, 1, 1e24);
        address trader = makeAddr("trader");
        address sanctioned = makeAddr("sanctioned");

        regulator.addSanctionedAddress(sanctioned);

        vm.prank(monitor);
        regulator.reportTrade(trader, sanctioned, volume, true, 0);

        assertGe(regulator.violationCount(), 1, "Sanctions should always trigger");
    }

    /// @notice Rule configuration is stored correctly
    function testFuzz_ruleConfigStored(uint256 threshold, uint256 timeWindow) public {
        threshold = bound(threshold, 1, 1e24);
        timeWindow = bound(timeWindow, 0, 365 days);

        regulator.setRule(
            AutomatedRegulator.ViolationType.INSIDER_TRADING,
            threshold,
            timeWindow,
            AutomatedRegulator.SeverityLevel.HIGH,
            "test rule"
        );

        (, bool enabled, uint256 storedThreshold, uint256 storedWindow, , ) = regulator.rules(AutomatedRegulator.ViolationType.INSIDER_TRADING);
        assertTrue(enabled);
        assertEq(storedThreshold, threshold);
        assertEq(storedWindow, timeWindow);
    }
}
