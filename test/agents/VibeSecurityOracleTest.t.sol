// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeSecurityOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeSecurityOracleTest is Test {
    // ============ Re-declare Events ============

    event AuditRequested(uint256 indexed auditId, address indexed requester, uint256 bountyPool);
    event FindingSubmitted(uint256 indexed findingId, uint256 indexed auditId, VibeSecurityOracle.Severity severity, VibeSecurityOracle.VulnCategory category);
    event FindingVerified(uint256 indexed findingId, uint256 payout);
    event FindingRejected(uint256 indexed findingId);
    event AuditCompleted(uint256 indexed auditId, uint256 totalFindings);
    event AuditorRegistered(address indexed auditor, bool isAI);

    // ============ State ============

    VibeSecurityOracle public oracle;
    address public owner;
    address public auditRequester;
    address public auditor1;
    address public auditor2;
    address public expert;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        auditRequester = makeAddr("requester");
        auditor1 = makeAddr("auditor1");
        auditor2 = makeAddr("auditor2");
        expert = makeAddr("expert");

        vm.deal(auditRequester, 100 ether);
        vm.deal(auditor1, 10 ether);
        vm.deal(auditor2, 10 ether);

        VibeSecurityOracle impl = new VibeSecurityOracle();
        bytes memory initData = abi.encodeWithSelector(VibeSecurityOracle.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        oracle = VibeSecurityOracle(payable(address(proxy)));

        // Set up expert panel
        oracle.addExpert(expert);
    }

    // ============ Helpers ============

    function _registerAuditor(address auditor, bool isAI) internal {
        vm.prank(auditor);
        oracle.registerAuditor{value: 1 ether}(keccak256(abi.encodePacked(auditor)), isAI);
    }

    function _requestAudit(uint256 bounty, uint256 deadlineDays) internal returns (uint256) {
        vm.prank(auditRequester);
        return oracle.requestAudit{value: bounty}(keccak256("code"), "0xContractAddr", deadlineDays);
    }

    function _submitFinding(
        address auditor,
        uint256 auditId,
        VibeSecurityOracle.Severity severity
    ) internal returns (uint256) {
        vm.prank(auditor);
        return oracle.submitFinding(
            auditId,
            severity,
            VibeSecurityOracle.VulnCategory.REENTRANCY,
            keccak256("description"),
            keccak256("poc"),
            keccak256("checkpoint")
        );
    }

    // ============ Audit Requests ============

    function test_requestAudit_success() public {
        vm.prank(auditRequester);
        uint256 auditId = oracle.requestAudit{value: 10 ether}(
            keccak256("code"),
            "0xContractAddr",
            30
        );

        assertEq(auditId, 1);

        VibeSecurityOracle.AuditRequest memory audit = oracle.getAudit(auditId);
        assertEq(audit.requester, auditRequester);
        assertEq(audit.bountyPool, 10 ether);
        assertEq(uint8(audit.status), uint8(VibeSecurityOracle.AuditStatus.IN_PROGRESS));
        assertEq(audit.findingsCount, 0);
        assertEq(audit.deadline, block.timestamp + 30 days);
    }

    function test_requestAudit_emitsEvent() public {
        vm.prank(auditRequester);
        vm.expectEmit(true, true, false, true);
        emit AuditRequested(1, auditRequester, 10 ether);
        oracle.requestAudit{value: 10 ether}(keccak256("code"), "addr", 30);
    }

    function test_requestAudit_revert_zeroBounty() public {
        vm.prank(auditRequester);
        vm.expectRevert("Need bounty pool");
        oracle.requestAudit(keccak256("code"), "addr", 30);
    }

    function test_requestAudit_incrementsCount() public {
        _requestAudit(1 ether, 30);
        assertEq(oracle.auditCount(), 1);
        _requestAudit(2 ether, 30);
        assertEq(oracle.auditCount(), 2);
    }

    // ============ Auditor Registration ============

    function test_registerAuditor_success() public {
        vm.prank(auditor1);
        oracle.registerAuditor{value: 1 ether}(keccak256("agent1"), true);

        VibeSecurityOracle.Auditor memory a = oracle.auditors(auditor1);
        assertEq(a.addr, auditor1);
        assertTrue(a.isAI);
        assertTrue(a.active);
        assertEq(a.reputation, 5000);
        assertEq(a.totalFindings, 0);
    }

    function test_registerAuditor_humanAuditor() public {
        vm.prank(auditor1);
        oracle.registerAuditor{value: 1 ether}(bytes32(0), false);

        assertFalse(oracle.auditors(auditor1).isAI);
    }

    function test_registerAuditor_emitsEvent() public {
        vm.prank(auditor1);
        vm.expectEmit(true, false, false, true);
        emit AuditorRegistered(auditor1, true);
        oracle.registerAuditor{value: 1 ether}(keccak256("agent1"), true);
    }

    function test_registerAuditor_revert_duplicate() public {
        _registerAuditor(auditor1, true);

        vm.prank(auditor1);
        vm.expectRevert("Already registered");
        oracle.registerAuditor{value: 1 ether}(keccak256("agent1"), true);
    }

    function test_registerAuditor_revert_noStake() public {
        vm.prank(auditor1);
        vm.expectRevert("Stake required");
        oracle.registerAuditor(keccak256("agent1"), true);
    }

    function test_getAuditorCount() public {
        assertEq(oracle.getAuditorCount(), 0);
        _registerAuditor(auditor1, true);
        assertEq(oracle.getAuditorCount(), 1);
        _registerAuditor(auditor2, false);
        assertEq(oracle.getAuditorCount(), 2);
    }

    // ============ Finding Submission ============

    function test_submitFinding_success() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditor1);
        uint256 findingId = oracle.submitFinding(
            auditId,
            VibeSecurityOracle.Severity.CRITICAL,
            VibeSecurityOracle.VulnCategory.REENTRANCY,
            keccak256("desc"),
            keccak256("poc"),
            keccak256("checkpoint")
        );

        assertEq(findingId, 1);

        VibeSecurityOracle.Finding memory f = oracle.getFinding(findingId);
        assertEq(f.auditId, auditId);
        assertEq(f.auditor, auditor1);
        assertEq(uint8(f.severity), uint8(VibeSecurityOracle.Severity.CRITICAL));
        assertEq(uint8(f.category), uint8(VibeSecurityOracle.VulnCategory.REENTRANCY));
        assertEq(uint8(f.status), uint8(VibeSecurityOracle.FindingStatus.SUBMITTED));
    }

    function test_submitFinding_emitsEvent() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditor1);
        vm.expectEmit(true, true, false, true);
        emit FindingSubmitted(1, auditId, VibeSecurityOracle.Severity.HIGH, VibeSecurityOracle.VulnCategory.ACCESS_CONTROL);
        oracle.submitFinding(
            auditId,
            VibeSecurityOracle.Severity.HIGH,
            VibeSecurityOracle.VulnCategory.ACCESS_CONTROL,
            keccak256("desc"),
            keccak256("poc"),
            keccak256("cp")
        );
    }

    function test_submitFinding_revert_auditNotInProgress() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        // Complete the audit
        vm.prank(auditRequester);
        oracle.completeAudit(auditId);

        vm.prank(auditor1);
        vm.expectRevert("Not in progress");
        oracle.submitFinding(auditId, VibeSecurityOracle.Severity.LOW, VibeSecurityOracle.VulnCategory.LOGIC, keccak256("d"), keccak256("p"), keccak256("c"));
    }

    function test_submitFinding_revert_deadlinePassed() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.warp(block.timestamp + 31 days);

        vm.prank(auditor1);
        vm.expectRevert("Deadline passed");
        oracle.submitFinding(auditId, VibeSecurityOracle.Severity.LOW, VibeSecurityOracle.VulnCategory.LOGIC, keccak256("d"), keccak256("p"), keccak256("c"));
    }

    function test_submitFinding_revert_notRegistered() public {
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditor1); // not registered
        vm.expectRevert("Not registered auditor");
        oracle.submitFinding(auditId, VibeSecurityOracle.Severity.LOW, VibeSecurityOracle.VulnCategory.LOGIC, keccak256("d"), keccak256("p"), keccak256("c"));
    }

    function test_submitFinding_revert_noPoc() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditor1);
        vm.expectRevert("PoC required");
        oracle.submitFinding(auditId, VibeSecurityOracle.Severity.LOW, VibeSecurityOracle.VulnCategory.LOGIC, keccak256("d"), bytes32(0), keccak256("c"));
    }

    function test_submitFinding_updatesAuditFindingsCount() public {
        _registerAuditor(auditor1, true);
        _registerAuditor(auditor2, false);
        uint256 auditId = _requestAudit(10 ether, 30);

        _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);
        _submitFinding(auditor2, auditId, VibeSecurityOracle.Severity.MEDIUM);

        assertEq(oracle.getAudit(auditId).findingsCount, 2);

        uint256[] memory findings = oracle.getAuditFindings(auditId);
        assertEq(findings.length, 2);
    }

    function test_submitFinding_updatesAuditorStats() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.CRITICAL);

        assertEq(oracle.auditors(auditor1).totalFindings, 1);
    }

    // ============ Finding Verification & Payout ============

    function test_verifyFinding_criticalPayout() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.CRITICAL);

        uint256 balBefore = auditor1.balance;

        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        // CRITICAL = 40% of 10 ether = 4 ether
        uint256 expectedPayout = (10 ether * 4000) / 10000;
        assertEq(auditor1.balance - balBefore, expectedPayout);

        VibeSecurityOracle.Finding memory f = oracle.getFinding(findingId);
        assertEq(uint8(f.status), uint8(VibeSecurityOracle.FindingStatus.PAID));
        assertEq(f.payout, expectedPayout);
    }

    function test_verifyFinding_highPayout() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        // HIGH = 25% of 10 ether = 2.5 ether
        assertEq(oracle.getFinding(findingId).payout, 2.5 ether);
    }

    function test_verifyFinding_mediumPayout() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditor1);
        uint256 findingId = oracle.submitFinding(
            auditId, VibeSecurityOracle.Severity.MEDIUM, VibeSecurityOracle.VulnCategory.LOGIC,
            keccak256("d"), keccak256("p"), keccak256("c")
        );

        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        // MEDIUM = 15%
        assertEq(oracle.getFinding(findingId).payout, 1.5 ether);
    }

    function test_verifyFinding_lowPayout() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditor1);
        uint256 findingId = oracle.submitFinding(
            auditId, VibeSecurityOracle.Severity.LOW, VibeSecurityOracle.VulnCategory.LOGIC,
            keccak256("d"), keccak256("p"), keccak256("c")
        );

        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        // LOW = 7.5%
        assertEq(oracle.getFinding(findingId).payout, 0.75 ether);
    }

    function test_verifyFinding_infoPayout() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditor1);
        uint256 findingId = oracle.submitFinding(
            auditId, VibeSecurityOracle.Severity.INFO, VibeSecurityOracle.VulnCategory.OTHER,
            keccak256("d"), keccak256("p"), keccak256("c")
        );

        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        // INFO = 2.5%
        assertEq(oracle.getFinding(findingId).payout, 0.25 ether);
    }

    function test_verifyFinding_byExpert() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        vm.prank(expert);
        oracle.verifyFinding(findingId);

        assertEq(uint8(oracle.getFinding(findingId).status), uint8(VibeSecurityOracle.FindingStatus.PAID));
    }

    function test_verifyFinding_revert_notAuthorized() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        vm.prank(auditor2); // not requester or expert
        vm.expectRevert("Not authorized");
        oracle.verifyFinding(findingId);
    }

    function test_verifyFinding_revert_notSubmitted() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        // Verify once
        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        // Try again
        vm.prank(auditRequester);
        vm.expectRevert("Not submitted");
        oracle.verifyFinding(findingId);
    }

    function test_verifyFinding_updatesAuditorReputation() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        uint256 repBefore = oracle.auditors(auditor1).reputation;
        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        assertEq(oracle.auditors(auditor1).reputation, repBefore + 100);
    }

    function test_verifyFinding_reputationCappedAt10000() public {
        _registerAuditor(auditor1, true);

        // Submit and verify 60 findings to push reputation past 10000
        for (uint256 i = 0; i < 60; i++) {
            uint256 auditId = _requestAudit(10 ether, 30);
            uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.LOW);

            vm.prank(auditRequester);
            oracle.verifyFinding(findingId);
        }

        assertLe(oracle.auditors(auditor1).reputation, 10000);
    }

    function test_verifyFinding_updatesGlobalStats() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.CRITICAL);

        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        assertEq(oracle.totalVerifiedBugs(), 1);
        assertEq(oracle.totalBountyPaid(), 4 ether);
    }

    function test_verifyFinding_reducesBountyPool() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.CRITICAL);

        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        // 10 - 4 = 6 ether remaining
        assertEq(oracle.getAudit(auditId).bountyPool, 6 ether);
    }

    // ============ Finding Rejection ============

    function test_rejectFinding_success() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        vm.prank(auditRequester);
        oracle.rejectFinding(findingId);

        assertEq(uint8(oracle.getFinding(findingId).status), uint8(VibeSecurityOracle.FindingStatus.REJECTED));
    }

    function test_rejectFinding_byExpert() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        vm.prank(expert);
        oracle.rejectFinding(findingId);

        assertEq(uint8(oracle.getFinding(findingId).status), uint8(VibeSecurityOracle.FindingStatus.REJECTED));
    }

    function test_rejectFinding_revert_notAuthorized() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        vm.prank(auditor2);
        vm.expectRevert("Not authorized");
        oracle.rejectFinding(findingId);
    }

    function test_rejectFinding_emitsEvent() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.HIGH);

        vm.prank(auditRequester);
        vm.expectEmit(true, false, false, false);
        emit FindingRejected(findingId);
        oracle.rejectFinding(findingId);
    }

    // ============ Audit Completion ============

    function test_completeAudit_success() public {
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditRequester);
        oracle.completeAudit(auditId);

        assertEq(uint8(oracle.getAudit(auditId).status), uint8(VibeSecurityOracle.AuditStatus.COMPLETED));
    }

    function test_completeAudit_returnsRemainingBounty() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);

        // One finding verified (40% = 4 ether out)
        uint256 findingId = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.CRITICAL);
        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        uint256 balBefore = auditRequester.balance;
        vm.prank(auditRequester);
        oracle.completeAudit(auditId);

        // 6 ether returned
        assertEq(auditRequester.balance - balBefore, 6 ether);
        assertEq(oracle.getAudit(auditId).bountyPool, 0);
    }

    function test_completeAudit_revert_notRequester() public {
        uint256 auditId = _requestAudit(10 ether, 30);

        vm.prank(auditor1);
        vm.expectRevert("Not requester");
        oracle.completeAudit(auditId);
    }

    function test_completeAudit_emitsEvent() public {
        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(10 ether, 30);
        _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.LOW);

        vm.prank(auditRequester);
        vm.expectEmit(true, false, false, true);
        emit AuditCompleted(auditId, 1);
        oracle.completeAudit(auditId);
    }

    // ============ Expert Panel (Admin) ============

    function test_addExpert_success() public {
        address newExpert = makeAddr("newExpert");
        oracle.addExpert(newExpert);
        assertTrue(oracle.expertPanel(newExpert));
    }

    function test_removeExpert_success() public {
        oracle.removeExpert(expert);
        assertFalse(oracle.expertPanel(expert));
    }

    function test_addExpert_revert_notOwner() public {
        vm.prank(auditor1);
        vm.expectRevert();
        oracle.addExpert(auditor1);
    }

    // ============ View Functions ============

    function test_getAuditCount() public {
        assertEq(oracle.getAuditCount(), 0);
        _requestAudit(1 ether, 30);
        assertEq(oracle.getAuditCount(), 1);
    }

    function test_receiveEther() public {
        (bool ok, ) = address(oracle).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ============ Fuzz Tests ============

    function testFuzz_requestAudit_variableBounty(uint128 bounty) public {
        bounty = uint128(bound(bounty, 1, 50 ether));
        vm.deal(auditRequester, uint256(bounty));

        vm.prank(auditRequester);
        uint256 auditId = oracle.requestAudit{value: bounty}(keccak256("code"), "addr", 30);
        assertEq(oracle.getAudit(auditId).bountyPool, bounty);
    }

    function testFuzz_verifyFinding_allSeverities(uint8 severityRaw) public {
        uint8 severity = uint8(bound(severityRaw, 0, 4));

        _registerAuditor(auditor1, true);
        uint256 auditId = _requestAudit(100 ether, 30);

        vm.prank(auditor1);
        uint256 findingId = oracle.submitFinding(
            auditId,
            VibeSecurityOracle.Severity(severity),
            VibeSecurityOracle.VulnCategory.LOGIC,
            keccak256("d"),
            keccak256("p"),
            keccak256("c")
        );

        vm.prank(auditRequester);
        oracle.verifyFinding(findingId);

        // Payout should be > 0
        assertGt(oracle.getFinding(findingId).payout, 0);
    }

    // ============ Integration: Full Audit Lifecycle ============

    function test_fullAuditLifecycle() public {
        // 1. Register auditors
        _registerAuditor(auditor1, true);
        _registerAuditor(auditor2, false);

        // 2. Request audit
        uint256 auditId = _requestAudit(20 ether, 30);

        // 3. Submit findings
        uint256 f1 = _submitFinding(auditor1, auditId, VibeSecurityOracle.Severity.CRITICAL);
        uint256 f2 = _submitFinding(auditor2, auditId, VibeSecurityOracle.Severity.MEDIUM);

        // 4. Verify critical, reject medium
        vm.prank(auditRequester);
        oracle.verifyFinding(f1); // 40% = 8 ether

        vm.prank(auditRequester);
        oracle.rejectFinding(f2);

        // 5. Complete audit
        uint256 balBefore = auditRequester.balance;
        vm.prank(auditRequester);
        oracle.completeAudit(auditId);

        // Requester gets remaining: 20 - 8 = 12 ether
        assertEq(auditRequester.balance - balBefore, 12 ether);

        // Stats check
        assertEq(oracle.totalVerifiedBugs(), 1);
        assertEq(oracle.totalBountyPaid(), 8 ether);
        assertEq(oracle.auditors(auditor1).verifiedFindings, 1);
        assertEq(oracle.auditors(auditor1).totalEarned, 8 ether);
    }
}
