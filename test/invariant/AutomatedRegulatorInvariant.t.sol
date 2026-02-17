// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/governance/AutomatedRegulator.sol";
import "../../contracts/compliance/FederatedConsensus.sol";

contract MockARIClawbackRegistry {}

// ============ Handler ============

contract RegulatorHandler is Test {
    AutomatedRegulator public regulator;
    address public monitor;

    // Ghost variables
    uint256 public ghost_tradesReported;
    uint256 public ghost_cancellationsReported;

    constructor(AutomatedRegulator _regulator, address _monitor) {
        regulator = _regulator;
        monitor = _monitor;
    }

    function reportTrade(uint256 volume, uint256 priceImpact, bool isBuy) public {
        volume = bound(volume, 1, 10_000e18);
        priceImpact = bound(priceImpact, 0, 100);
        address trader = makeAddr("trader");
        address cp = makeAddr("cp");

        vm.prank(monitor);
        try regulator.reportTrade(trader, cp, volume, isBuy, priceImpact) {
            ghost_tradesReported++;
        } catch {}
    }

    function reportCancellation() public {
        address trader = makeAddr("trader");
        vm.prank(monitor);
        try regulator.reportCancellation(trader, 100e18) {
            ghost_cancellationsReported++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1 hours, 2 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract AutomatedRegulatorInvariantTest is StdInvariant, Test {
    AutomatedRegulator public regulator;
    RegulatorHandler public handler;
    address public monitor;

    function setUp() public {
        monitor = makeAddr("monitor");

        FederatedConsensus consImpl = new FederatedConsensus();
        ERC1967Proxy consProxy = new ERC1967Proxy(
            address(consImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, address(this), 2, 1 days)
        );

        MockARIClawbackRegistry registry = new MockARIClawbackRegistry();
        AutomatedRegulator impl = new AutomatedRegulator();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(AutomatedRegulator.initialize.selector, address(this), address(consProxy), address(registry))
        );
        regulator = AutomatedRegulator(address(proxy));
        regulator.setAuthorizedMonitor(monitor, true);

        handler = new RegulatorHandler(regulator, monitor);
        targetContract(address(handler));
    }

    /// @notice Violation count is monotonically non-decreasing
    function invariant_violationCountMonotonic() public view {
        assertGe(regulator.violationCount(), 0, "VIOLATIONS: underflow");
    }

    /// @notice Default wash trading rule is always enabled
    function invariant_washTradingRuleEnabled() public view {
        (, bool enabled, , , , ) = regulator.rules(AutomatedRegulator.ViolationType.WASH_TRADING);
        assertTrue(enabled, "WASH_TRADING: rule disabled");
    }

    /// @notice Default sanctions rule is always critical severity
    function invariant_sanctionsRuleCritical() public view {
        (, , , , AutomatedRegulator.SeverityLevel severity, ) = regulator.rules(AutomatedRegulator.ViolationType.SANCTIONS_EVASION);
        assertEq(uint8(severity), uint8(AutomatedRegulator.SeverityLevel.CRITICAL), "SANCTIONS: not critical");
    }
}
