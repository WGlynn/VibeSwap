// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/governance/AutomatedRegulator.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "../../contracts/compliance/FederatedConsensus.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockRPToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Minimal vault that receives seized funds
contract MockClawbackVault {
    receive() external payable {}
}

// ============ Integration Test: Full Regulatory Pipeline ============

/**
 * @title RegulatoryPipelineTest
 * @notice Tests the complete automated regulatory pipeline:
 *   1. Monitor reports trades → AutomatedRegulator detects wash trading
 *   2. _autoFileCase → ClawbackRegistry.openCase → wallet FLAGGED
 *   3. submitForVoting → FederatedConsensus.createProposal
 *   4. castAutomatedVote → FederatedConsensus.vote (on-chain regulator vote)
 *   5. Human authority votes → threshold reached → APPROVED
 *   6. Grace period elapses → executeClawback → wallet FROZEN
 *   7. Dismissed case → wallet cleared
 *   8. Sanctions detection → immediate case filing
 */
contract RegulatoryPipelineTest is Test {
    // Compliance system
    FederatedConsensus consensus;
    ClawbackRegistry registry;
    AutomatedRegulator regulator;

    // Support contracts
    MockRPToken weth;
    MockClawbackVault vault;

    // Actors
    address owner;
    address humanAuthority;
    address monitor;
    address washTrader;
    address washPuppet;
    address sanctionedWallet;
    address cleanTrader;

    function setUp() public {
        owner = address(this);
        humanAuthority = makeAddr("humanAuthority");
        monitor = makeAddr("monitor");
        washTrader = makeAddr("washTrader");
        washPuppet = makeAddr("washPuppet");
        sanctionedWallet = makeAddr("sanctioned");
        cleanTrader = makeAddr("cleanTrader");

        // Deploy token
        weth = new MockRPToken("Wrapped Ether", "WETH");

        // Deploy vault
        vault = new MockClawbackVault();

        // Deploy compliance system
        _deployComplianceSystem();

        // Wire everything together
        _wireSystem();

        // Fund wallets
        weth.mint(washTrader, 1000 ether);
        weth.mint(cleanTrader, 1000 ether);
    }

    function _deployComplianceSystem() internal {
        // 1. FederatedConsensus — threshold=1 for testing, grace=1 hour
        FederatedConsensus consensusImpl = new FederatedConsensus();
        ERC1967Proxy consensusProxy = new ERC1967Proxy(
            address(consensusImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, owner, 1, 1 hours)
        );
        consensus = FederatedConsensus(address(consensusProxy));

        // 2. ClawbackRegistry — maxCascade=5, minTaint=1 ether
        ClawbackRegistry registryImpl = new ClawbackRegistry();
        ERC1967Proxy registryProxy = new ERC1967Proxy(
            address(registryImpl),
            abi.encodeWithSelector(ClawbackRegistry.initialize.selector, owner, address(consensus), 5, 1 ether)
        );
        registry = ClawbackRegistry(address(registryProxy));

        // 3. AutomatedRegulator
        AutomatedRegulator regulatorImpl = new AutomatedRegulator();
        ERC1967Proxy regulatorProxy = new ERC1967Proxy(
            address(regulatorImpl),
            abi.encodeWithSelector(AutomatedRegulator.initialize.selector, owner, address(consensus), address(registry))
        );
        regulator = AutomatedRegulator(address(regulatorProxy));
    }

    function _wireSystem() internal {
        // Human authority (REGULATOR role)
        consensus.addAuthority(humanAuthority, FederatedConsensus.AuthorityRole.REGULATOR, "US");

        // AutomatedRegulator as ONCHAIN_REGULATOR authority (so it can vote + open cases)
        consensus.addAuthority(address(regulator), FederatedConsensus.AuthorityRole.ONCHAIN_REGULATOR, "GLOBAL");

        // ClawbackRegistry is the executor in FederatedConsensus (for markExecuted)
        consensus.setExecutor(address(registry));

        // Set vault for fund seizure
        registry.setVault(address(vault));

        // Monitor can report trades to AutomatedRegulator
        regulator.setAuthorizedMonitor(monitor, true);

        // ClawbackRegistry must allow VibeSwapCore (or test contract) as tracker
        registry.setAuthorizedTracker(address(this), true);

        // Add sanctioned wallet
        regulator.addSanctionedAddress(sanctionedWallet);
    }

    // ============ Helper: Trigger wash trading violation ============

    function _triggerWashTrading(address trader) internal returns (bytes32 violationId) {
        // Default wash trading rule: threshold = 50_000e18 volume in 24h window
        // Report trades below threshold first, then one crossing trade
        uint256 countBefore = regulator.violationCount();

        vm.startPrank(monitor);

        // 8 trades of 6,000 = 48,000 (below 50,000 threshold)
        for (uint256 i = 0; i < 8; i++) {
            regulator.reportTrade(trader, trader, 6000 ether, true, 0);
        }
        // 1 trade of 3,000 = 51,000 (just crosses threshold, exactly 1 violation)
        regulator.reportTrade(trader, trader, 3000 ether, true, 0);

        vm.stopPrank();

        uint256 vCount = regulator.violationCount();
        assertEq(vCount, countBefore + 1, "Exactly one violation should fire");
        violationId = keccak256(abi.encodePacked(trader, AutomatedRegulator.ViolationType.WASH_TRADING, vCount));
    }

    // ============ Test: Full pipeline — detect → file → vote → execute ============

    function test_fullPipeline_detectFileVoteExecute() public {
        // Step 1: Trigger wash trading → auto-files case in ClawbackRegistry
        bytes32 violationId = _triggerWashTrading(washTrader);

        // Verify violation detected
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);
        assertTrue(v.actionTaken, "Action should be taken for HIGH severity");
        assertTrue(v.caseId != bytes32(0), "Case should be filed");
        assertEq(uint8(v.severity), uint8(AutomatedRegulator.SeverityLevel.HIGH));

        // Verify wallet is FLAGGED in ClawbackRegistry
        assertTrue(registry.isBlocked(washTrader), "Wash trader should be blocked");

        bytes32 caseId = v.caseId;

        // Step 2: Submit for voting → creates FederatedConsensus proposal
        vm.prank(humanAuthority);
        registry.submitForVoting(caseId);

        // Step 3: AutomatedRegulator casts automated vote
        // Need the proposal ID from the case
        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        vm.prank(monitor);
        regulator.castAutomatedVote(proposalId, violationId);

        // With threshold=1, one vote is enough → APPROVED

        // Step 4: Wait for grace period (1 hour)
        vm.warp(block.timestamp + 1 hours + 1);

        // Verify proposal is executable
        assertTrue(consensus.isExecutable(proposalId));

        // Step 5: Execute clawback → wallet FROZEN
        registry.executeClawback(caseId);

        // Verify wallet is now FROZEN
        (ClawbackRegistry.TaintLevel level, , , ) = registry.checkWallet(washTrader);
        assertEq(uint8(level), uint8(ClawbackRegistry.TaintLevel.FROZEN));
    }

    // ============ Test: Auto-filing requires authority registration ============

    function test_autoFiling_requiresAuthority() public {
        // Deploy a regulator NOT registered as authority
        AutomatedRegulator unregisteredImpl = new AutomatedRegulator();
        ERC1967Proxy unregProxy = new ERC1967Proxy(
            address(unregisteredImpl),
            abi.encodeWithSelector(AutomatedRegulator.initialize.selector, owner, address(consensus), address(registry))
        );
        AutomatedRegulator unregistered = AutomatedRegulator(address(unregProxy));
        unregistered.setAuthorizedMonitor(monitor, true);

        // Report wash trading — enough to trigger violation
        vm.startPrank(monitor);
        for (uint256 i = 0; i < 10; i++) {
            unregistered.reportTrade(washTrader, washTrader, 6000 ether, true, 0);
        }
        vm.stopPrank();

        // Violation is detected but case filing should fail (try/catch catches it)
        uint256 vCount = unregistered.violationCount();
        bytes32 vId = keccak256(abi.encodePacked(washTrader, AutomatedRegulator.ViolationType.WASH_TRADING, vCount));
        AutomatedRegulator.DetectedViolation memory v = unregistered.getViolation(vId);

        assertTrue(v.actionTaken, "Action attempt should be recorded");
        assertEq(v.caseId, bytes32(0), "Case should NOT be filed (no authority)");
    }

    // ============ Test: Sanctions detection triggers CRITICAL case ============

    function test_sanctionsDetection_immediateCase() public {
        // Single trade with sanctioned counterparty
        vm.prank(monitor);
        regulator.reportTrade(cleanTrader, sanctionedWallet, 100 ether, true, 0);

        // Should auto-file a CRITICAL violation
        uint256 vCount = regulator.violationCount();
        bytes32 violationId = keccak256(
            abi.encodePacked(cleanTrader, AutomatedRegulator.ViolationType.SANCTIONS_EVASION, vCount)
        );
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);

        assertEq(uint8(v.severity), uint8(AutomatedRegulator.SeverityLevel.CRITICAL));
        assertTrue(v.actionTaken);
        assertTrue(v.caseId != bytes32(0), "Case should be filed for CRITICAL");
    }

    // ============ Test: Taint propagation via recordTransaction ============

    function test_taintPropagation() public {
        // Flag washTrader
        _triggerWashTrading(washTrader);

        // Verify washTrader is flagged
        assertTrue(registry.isBlocked(washTrader));

        // Record a transaction: washTrader sends to cleanTrader
        registry.recordTransaction(washTrader, cleanTrader, 10 ether, address(weth));

        // cleanTrader should now be tainted (propagated)
        (ClawbackRegistry.TaintLevel level, , , ) = registry.checkWallet(cleanTrader);
        assertTrue(uint8(level) >= uint8(ClawbackRegistry.TaintLevel.TAINTED), "Taint should propagate");
    }

    // ============ Test: Case dismissal clears all wallets ============

    function test_dismissCase_clearsWallets() public {
        // Trigger violation and file case
        bytes32 violationId = _triggerWashTrading(washTrader);
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);
        bytes32 caseId = v.caseId;

        // Propagate taint to cleanTrader
        registry.recordTransaction(washTrader, cleanTrader, 10 ether, address(weth));

        // Both should be tainted
        assertTrue(registry.isBlocked(washTrader));
        (ClawbackRegistry.TaintLevel ctLevel, , , ) = registry.checkWallet(cleanTrader);
        assertTrue(uint8(ctLevel) >= uint8(ClawbackRegistry.TaintLevel.TAINTED));

        // Authority dismisses the case
        vm.prank(humanAuthority);
        registry.dismissCase(caseId);

        // Both wallets should be cleared
        assertFalse(registry.isBlocked(washTrader), "washTrader should be cleared after dismissal");
    }

    // ============ Test: Sybil cluster detection → wash trading ============

    function test_sybilCluster_washTradingDetection() public {
        // Register sybil cluster: washTrader is master, washPuppet is puppet
        address[] memory puppets = new address[](1);
        puppets[0] = washPuppet;
        vm.prank(monitor);
        regulator.registerCluster(washTrader, puppets);

        // Report trades between cluster members (not direct self-trade)
        vm.startPrank(monitor);
        for (uint256 i = 0; i < 10; i++) {
            regulator.reportTrade(washTrader, washPuppet, 6000 ether, true, 0);
        }
        vm.stopPrank();

        // Should detect wash trading via cluster
        uint256 vCount = regulator.violationCount();
        bytes32 violationId = keccak256(
            abi.encodePacked(washTrader, AutomatedRegulator.ViolationType.WASH_TRADING, vCount)
        );
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);
        assertEq(uint8(v.violationType), uint8(AutomatedRegulator.ViolationType.WASH_TRADING));
        assertTrue(v.caseId != bytes32(0));
    }

    // ============ Test: Market manipulation detection ============

    function test_marketManipulation_detection() public {
        // Default rule: 500 BPS price impact threshold
        vm.startPrank(monitor);
        // 6 trades with 100 BPS each = 600 BPS cumulative
        for (uint256 i = 0; i < 6; i++) {
            regulator.reportTrade(washTrader, cleanTrader, 1 ether, true, 100);
        }
        vm.stopPrank();

        uint256 vCount = regulator.violationCount();
        bytes32 violationId = keccak256(
            abi.encodePacked(washTrader, AutomatedRegulator.ViolationType.MARKET_MANIPULATION, vCount)
        );
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);
        assertEq(uint8(v.violationType), uint8(AutomatedRegulator.ViolationType.MARKET_MANIPULATION));
        assertEq(uint8(v.severity), uint8(AutomatedRegulator.SeverityLevel.HIGH));
    }

    // ============ Test: Human + automated dual authority voting ============

    function test_dualAuthorityVoting() public {
        // Set threshold to 2 (requires both human + automated vote)
        consensus.setThreshold(2);

        // Trigger violation → auto-file case
        bytes32 violationId = _triggerWashTrading(washTrader);
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);
        bytes32 caseId = v.caseId;

        // Submit for voting
        vm.prank(humanAuthority);
        registry.submitForVoting(caseId);
        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // Automated vote alone is not enough
        vm.prank(monitor);
        regulator.castAutomatedVote(proposalId, violationId);

        FederatedConsensus.Proposal memory prop = consensus.getProposal(proposalId);
        assertEq(uint8(prop.status), uint8(FederatedConsensus.ProposalStatus.PENDING), "Should still be pending");

        // Human authority votes → threshold reached
        vm.prank(humanAuthority);
        consensus.vote(proposalId, true);

        prop = consensus.getProposal(proposalId);
        assertEq(uint8(prop.status), uint8(FederatedConsensus.ProposalStatus.APPROVED));
    }

    // ============ Test: Grace period enforcement ============

    function test_gracePeriod_preventsPrematureExecution() public {
        bytes32 violationId = _triggerWashTrading(washTrader);
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);
        bytes32 caseId = v.caseId;

        vm.prank(humanAuthority);
        registry.submitForVoting(caseId);
        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        vm.prank(monitor);
        regulator.castAutomatedVote(proposalId, violationId);

        // Grace period not elapsed → should revert
        vm.expectRevert();
        registry.executeClawback(caseId);

        // After grace period → should succeed
        vm.warp(block.timestamp + 1 hours + 1);
        registry.executeClawback(caseId);
    }

    // ============ Test: Clean trader unaffected by regulatory pipeline ============

    function test_cleanTrader_unaffected() public {
        // Trigger violation on washTrader
        _triggerWashTrading(washTrader);

        // cleanTrader should NOT be blocked
        assertFalse(registry.isBlocked(cleanTrader));

        // Safety check should show CLEAN
        (bool safe, ) = registry.checkTransactionSafety(cleanTrader, address(0x1));
        assertTrue(safe);
    }

    // ============ Test: Activity window resets after 24 hours ============

    function test_activityWindow_resets() public {
        // Report some trades (not enough to trigger)
        vm.startPrank(monitor);
        for (uint256 i = 0; i < 5; i++) {
            regulator.reportTrade(washTrader, washTrader, 6000 ether, true, 0);
        }
        vm.stopPrank();

        // 30,000 ether self-trade volume, below 50,000 threshold
        uint256 countBefore = regulator.violationCount();

        // Advance past 24h window
        vm.warp(block.timestamp + 25 hours);

        // Report 5 more trades — window resets, so total is only 30,000 again
        vm.startPrank(monitor);
        for (uint256 i = 0; i < 5; i++) {
            regulator.reportTrade(washTrader, washTrader, 6000 ether, true, 0);
        }
        vm.stopPrank();

        // Should NOT have triggered a new violation (reset below threshold)
        assertEq(regulator.violationCount(), countBefore, "Window should reset - no new violations");
    }

    // ============ Test: Layering detection via cancellations ============

    function test_layeringDetection() public {
        // Default layering rule: 10 cancelled orders threshold, MEDIUM severity
        vm.startPrank(monitor);
        for (uint256 i = 0; i < 11; i++) {
            regulator.reportCancellation(washTrader, 1 ether);
        }
        vm.stopPrank();

        // MEDIUM severity → no auto case filing (only HIGH/CRITICAL auto-file)
        uint256 vCount = regulator.violationCount();
        assertTrue(vCount > 0, "Layering violation should be detected");

        bytes32 violationId = keccak256(
            abi.encodePacked(washTrader, AutomatedRegulator.ViolationType.LAYERING, vCount)
        );
        AutomatedRegulator.DetectedViolation memory v = regulator.getViolation(violationId);
        assertEq(uint8(v.violationType), uint8(AutomatedRegulator.ViolationType.LAYERING));
        assertEq(uint8(v.severity), uint8(AutomatedRegulator.SeverityLevel.MEDIUM));
        assertFalse(v.actionTaken, "MEDIUM severity should NOT auto-file case");
    }

    // ============ Test: Full lifecycle wiring verification ============

    function test_systemWiring() public view {
        // Verify all cross-contract connections
        assertTrue(consensus.isActiveAuthority(humanAuthority), "Human authority should be active");
        assertTrue(consensus.isActiveAuthority(address(regulator)), "AutomatedRegulator should be authority");
        assertEq(consensus.authorityCount(), 2);
    }
}
