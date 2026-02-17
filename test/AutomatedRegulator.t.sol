// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/governance/AutomatedRegulator.sol";
import "../contracts/compliance/FederatedConsensus.sol";
import "../contracts/compliance/ClawbackRegistry.sol";

contract MockARClawbackRegistry {
    // Stub — AutomatedRegulator only calls _autoFileCase which doesn't call registry in current impl
}

contract AutomatedRegulatorTest is Test {
    AutomatedRegulator public regulator;
    FederatedConsensus public consensus;
    address public monitor;
    address public trader;
    address public counterparty;

    function setUp() public {
        monitor = makeAddr("monitor");
        trader = makeAddr("trader");
        counterparty = makeAddr("counterparty");

        // Deploy consensus
        FederatedConsensus consImpl = new FederatedConsensus();
        ERC1967Proxy consProxy = new ERC1967Proxy(
            address(consImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, address(this), 2, 1 days)
        );
        consensus = FederatedConsensus(address(consProxy));

        // Deploy regulator
        MockARClawbackRegistry registry = new MockARClawbackRegistry();
        AutomatedRegulator impl = new AutomatedRegulator();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(AutomatedRegulator.initialize.selector, address(this), address(consensus), address(registry))
        );
        regulator = AutomatedRegulator(address(proxy));

        // Register regulator as consensus authority
        consensus.addAuthority(address(regulator), FederatedConsensus.AuthorityRole.ONCHAIN_REGULATOR, "GLOBAL");

        // Authorize monitor
        regulator.setAuthorizedMonitor(monitor, true);
    }

    // ============ Initialization ============

    function test_initialize() public view {
        // Check default rules exist
        (AutomatedRegulator.ViolationType vt, bool enabled, uint256 threshold, , AutomatedRegulator.SeverityLevel severity, ) = regulator.rules(AutomatedRegulator.ViolationType.WASH_TRADING);
        assertTrue(enabled);
        assertEq(threshold, 50_000e18);
        assertEq(uint8(severity), uint8(AutomatedRegulator.SeverityLevel.HIGH));
    }

    function test_initialize_sanctionsRule() public view {
        (, bool enabled, uint256 threshold, , AutomatedRegulator.SeverityLevel severity, ) = regulator.rules(AutomatedRegulator.ViolationType.SANCTIONS_EVASION);
        assertTrue(enabled);
        assertEq(threshold, 1);
        assertEq(uint8(severity), uint8(AutomatedRegulator.SeverityLevel.CRITICAL));
    }

    // ============ Trade Reporting ============

    function test_reportTrade_tracksVolume() public {
        vm.prank(monitor);
        regulator.reportTrade(trader, counterparty, 1000e18, true, 10);

        AutomatedRegulator.WalletActivity memory activity = regulator.getWalletActivity(trader);
        assertEq(activity.buyVolume, 1000e18);
        assertEq(activity.priceImpact, 10);
    }

    function test_reportTrade_sellVolume() public {
        vm.prank(monitor);
        regulator.reportTrade(trader, counterparty, 500e18, false, 5);

        AutomatedRegulator.WalletActivity memory activity = regulator.getWalletActivity(trader);
        assertEq(activity.sellVolume, 500e18);
    }

    function test_reportTrade_windowReset() public {
        vm.prank(monitor);
        regulator.reportTrade(trader, counterparty, 1000e18, true, 10);

        vm.warp(block.timestamp + 25 hours);
        vm.prank(monitor);
        regulator.reportTrade(trader, counterparty, 500e18, true, 5);

        AutomatedRegulator.WalletActivity memory activity = regulator.getWalletActivity(trader);
        assertEq(activity.buyVolume, 500e18); // Reset to just the new trade
    }

    function test_reportTrade_unauthorized() public {
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(AutomatedRegulator.NotAuthorizedMonitor.selector);
        regulator.reportTrade(trader, counterparty, 1000e18, true, 10);
    }

    function test_reportTrade_ownerCanMonitor() public {
        // Owner should be able to report trades (owner check in modifier)
        regulator.reportTrade(trader, counterparty, 1000e18, true, 10);
    }

    // ============ Wash Trading Detection ============

    function test_washTrading_selfTrade() public {
        vm.prank(monitor);
        regulator.reportTrade(trader, trader, 60_000e18, true, 10);

        // Should have detected wash trading violation
        assertEq(regulator.violationCount(), 1);
    }

    function test_washTrading_cluster() public {
        address puppet = makeAddr("puppet");
        address[] memory puppets = new address[](1);
        puppets[0] = puppet;

        vm.prank(monitor);
        regulator.registerCluster(trader, puppets);

        vm.prank(monitor);
        regulator.reportTrade(trader, puppet, 60_000e18, true, 10);

        assertGe(regulator.violationCount(), 1);
    }

    function test_washTrading_belowThreshold() public {
        vm.prank(monitor);
        regulator.reportTrade(trader, trader, 10_000e18, true, 10);

        assertEq(regulator.violationCount(), 0);
    }

    // ============ Market Manipulation Detection ============

    function test_marketManipulation_detected() public {
        // Price impact threshold is 500 BPS
        vm.prank(monitor);
        regulator.reportTrade(trader, counterparty, 1000e18, true, 600);

        assertGe(regulator.violationCount(), 1);
    }

    function test_marketManipulation_accumulates() public {
        vm.prank(monitor);
        regulator.reportTrade(trader, counterparty, 500e18, true, 300);

        vm.prank(monitor);
        regulator.reportTrade(trader, counterparty, 500e18, true, 300);

        // Total impact: 600, above 500 threshold
        assertGe(regulator.violationCount(), 1);
    }

    // ============ Layering Detection ============

    function test_layering_detected() public {
        // Threshold is 10 cancelled orders
        for (uint256 i = 0; i < 11; i++) {
            vm.prank(monitor);
            regulator.reportCancellation(trader, 100e18);
        }

        assertGe(regulator.violationCount(), 1);
    }

    function test_layering_belowThreshold() public {
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(monitor);
            regulator.reportCancellation(trader, 100e18);
        }

        assertEq(regulator.violationCount(), 0);
    }

    // ============ Sanctions Detection ============

    function test_sanctions_detected() public {
        address sanctioned = makeAddr("sanctioned");
        regulator.addSanctionedAddress(sanctioned);

        vm.prank(monitor);
        regulator.reportTrade(trader, sanctioned, 1e18, true, 0);

        assertGe(regulator.violationCount(), 1);
    }

    // ============ Cluster Management ============

    function test_registerCluster() public {
        address puppet1 = makeAddr("puppet1");
        address puppet2 = makeAddr("puppet2");
        address[] memory puppets = new address[](2);
        puppets[0] = puppet1;
        puppets[1] = puppet2;

        vm.prank(monitor);
        regulator.registerCluster(trader, puppets);

        address[] memory result = regulator.getCluster(trader);
        assertEq(result.length, 2);
    }

    // ============ Consensus Voting ============

    function test_castAutomatedVote() public {
        // Create a violation
        vm.prank(monitor);
        regulator.reportTrade(trader, trader, 60_000e18, true, 10);

        // Get the violation ID
        bytes32 violationId = keccak256(abi.encodePacked(trader, AutomatedRegulator.ViolationType.WASH_TRADING, uint256(1)));

        // Create a consensus proposal
        bytes32 proposalId = consensus.createProposal(keccak256("case"), trader, 100 ether, address(0), "wash trading");

        // Cast automated vote
        vm.prank(monitor);
        regulator.castAutomatedVote(proposalId, violationId);

        assertTrue(consensus.hasVoted(proposalId, address(regulator)));
    }

    function test_castAutomatedVote_violationNotFound() public {
        bytes32 fakeViolation = keccak256("fake");
        bytes32 proposalId = consensus.createProposal(keccak256("case"), trader, 100 ether, address(0), "test");

        vm.prank(monitor);
        vm.expectRevert(AutomatedRegulator.ViolationNotFound.selector);
        regulator.castAutomatedVote(proposalId, fakeViolation);
    }

    // ============ Admin ============

    function test_setRule() public {
        regulator.setRule(
            AutomatedRegulator.ViolationType.INSIDER_TRADING,
            1000e18,
            12 hours,
            AutomatedRegulator.SeverityLevel.CRITICAL,
            "Insider trading rule"
        );

        (, bool enabled, uint256 threshold, uint256 timeWindow, AutomatedRegulator.SeverityLevel severity,) = regulator.rules(AutomatedRegulator.ViolationType.INSIDER_TRADING);
        assertTrue(enabled);
        assertEq(threshold, 1000e18);
        assertEq(timeWindow, 12 hours);
        assertEq(uint8(severity), uint8(AutomatedRegulator.SeverityLevel.CRITICAL));
    }

    function test_addSanctionedAddress() public {
        address sanctioned = makeAddr("sanctioned");
        regulator.addSanctionedAddress(sanctioned);
        assertTrue(regulator.sanctionedAddresses(sanctioned));
    }

    function test_setAuthorizedMonitor() public {
        address newMonitor = makeAddr("newMonitor");
        regulator.setAuthorizedMonitor(newMonitor, true);
        assertTrue(regulator.authorizedMonitors(newMonitor));
    }

    function test_admin_onlyOwner() public {
        address rando = makeAddr("rando");

        vm.prank(rando);
        vm.expectRevert();
        regulator.setRule(
            AutomatedRegulator.ViolationType.WASH_TRADING, 1000, 1 hours,
            AutomatedRegulator.SeverityLevel.LOW, "x"
        );

        vm.prank(rando);
        vm.expectRevert();
        regulator.addSanctionedAddress(rando);

        vm.prank(rando);
        vm.expectRevert();
        regulator.setAuthorizedMonitor(rando, true);
    }

    // ============ View Functions ============

    function test_getViolation() public {
        vm.prank(monitor);
        regulator.reportTrade(trader, trader, 60_000e18, true, 10);

        bytes32 violationId = keccak256(abi.encodePacked(trader, AutomatedRegulator.ViolationType.WASH_TRADING, uint256(1)));
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);
        assertEq(v.wallet, trader);
        assertEq(uint8(v.violationType), uint8(AutomatedRegulator.ViolationType.WASH_TRADING));
        assertTrue(v.actionTaken); // HIGH severity triggers auto-file
    }

    function test_getWalletActivity() public {
        vm.prank(monitor);
        regulator.reportTrade(trader, counterparty, 1000e18, true, 10);

        AutomatedRegulator.WalletActivity memory activity = regulator.getWalletActivity(trader);
        assertEq(activity.buyVolume, 1000e18);
    }
}
