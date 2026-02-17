// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/governance/DisputeResolver.sol";
import "../contracts/governance/DecentralizedTribunal.sol";
import "../contracts/compliance/FederatedConsensus.sol";

contract DisputeResolverTest is Test {
    DisputeResolver public resolver;
    FederatedConsensus public consensus;
    DecentralizedTribunal public tribunal;
    address public owner;
    address public claimant;
    address public respondent;
    address public arbitrator1;
    address public arbitrator2;

    function setUp() public {
        owner = address(this);
        claimant = makeAddr("claimant");
        respondent = makeAddr("respondent");
        arbitrator1 = makeAddr("arbitrator1");
        arbitrator2 = makeAddr("arbitrator2");

        // Deploy FederatedConsensus
        FederatedConsensus consImpl = new FederatedConsensus();
        ERC1967Proxy consProxy = new ERC1967Proxy(
            address(consImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, owner, 2, 1 days)
        );
        consensus = FederatedConsensus(address(consProxy));

        // Deploy DecentralizedTribunal — resolver needs to be its owner for openTrial
        // We'll set the owner to the resolver address after deployment
        DecentralizedTribunal tribImpl = new DecentralizedTribunal();

        // Deploy DisputeResolver
        DisputeResolver impl = new DisputeResolver();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(DisputeResolver.initialize.selector, owner, address(consensus))
        );
        resolver = DisputeResolver(payable(address(proxy)));

        // Now deploy tribunal with resolver as owner so it can call openTrial
        ERC1967Proxy tribProxy = new ERC1967Proxy(
            address(tribImpl),
            abi.encodeWithSelector(DecentralizedTribunal.initialize.selector, address(resolver), address(consensus))
        );
        tribunal = DecentralizedTribunal(payable(address(tribProxy)));
        resolver.setTribunal(address(tribunal));

        // Register resolver as authority in consensus (so it can vote)
        consensus.addAuthority(address(resolver), FederatedConsensus.AuthorityRole.ONCHAIN_ARBITRATION, "GLOBAL");

        // Fund test accounts
        vm.deal(claimant, 10 ether);
        vm.deal(respondent, 10 ether);
        vm.deal(arbitrator1, 10 ether);
        vm.deal(arbitrator2, 10 ether);
    }

    function _registerArbitrator(address arb) internal {
        vm.prank(arb);
        resolver.registerArbitrator{value: 1 ether}();
    }

    function _fileDispute() internal returns (bytes32 disputeId) {
        bytes32 caseId = keccak256("case1");
        bytes32 proposalId = bytes32(0);

        vm.prank(claimant);
        disputeId = resolver.fileDispute{value: 0.01 ether}(
            caseId,
            proposalId,
            respondent,
            100 ether,
            address(0),
            "Stolen funds",
            "QmEvidence1"
        );
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(resolver.owner(), owner);
        assertEq(resolver.filingFee(), 0.01 ether);
        assertEq(resolver.minArbitratorStake(), 1 ether);
        assertEq(resolver.responseDuration(), 7 days);
        assertEq(resolver.arbitrationDuration(), 14 days);
    }

    // ============ Arbitrator Registration ============

    function test_registerArbitrator() public {
        _registerArbitrator(arbitrator1);

        DisputeResolver.Arbitrator memory arb = resolver.getArbitrator(arbitrator1);
        assertTrue(arb.registered);
        assertEq(arb.stake, 1 ether);
        assertEq(arb.reputation, 10000);
        assertFalse(arb.suspended);
        assertEq(resolver.getActiveArbitratorCount(), 1);
    }

    function test_registerArbitrator_refundsExcess() public {
        uint256 balBefore = arbitrator1.balance;
        vm.prank(arbitrator1);
        resolver.registerArbitrator{value: 5 ether}();
        assertEq(arbitrator1.balance, balBefore - 1 ether);
    }

    function test_registerArbitrator_insufficientStake() public {
        vm.prank(arbitrator1);
        vm.expectRevert(DisputeResolver.InsufficientStake.selector);
        resolver.registerArbitrator{value: 0.5 ether}();
    }

    function test_registerArbitrator_alreadyRegistered() public {
        _registerArbitrator(arbitrator1);
        vm.prank(arbitrator1);
        vm.expectRevert(DisputeResolver.AlreadyRegistered.selector);
        resolver.registerArbitrator{value: 1 ether}();
    }

    // ============ Filing Disputes ============

    function test_fileDispute() public {
        bytes32 disputeId = _fileDispute();

        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(d.claimant, claimant);
        assertEq(d.respondent, respondent);
        assertEq(d.claimAmount, 100 ether);
        assertEq(uint8(d.phase), uint8(DisputeResolver.DisputePhase.RESPONSE));
        assertEq(uint8(d.resolution), uint8(DisputeResolver.Resolution.PENDING));
        assertEq(resolver.disputeCount(), 1);
    }

    function test_fileDispute_insufficientFee() public {
        vm.prank(claimant);
        vm.expectRevert(DisputeResolver.InsufficientFee.selector);
        resolver.fileDispute{value: 0.001 ether}(
            keccak256("case1"), bytes32(0), respondent, 100 ether, address(0), "Stolen", "Qm1"
        );
    }

    function test_fileDispute_evidenceRecorded() public {
        bytes32 disputeId = _fileDispute();
        DisputeResolver.Evidence[] memory evidence = resolver.getEvidence(disputeId);
        assertEq(evidence.length, 1);
        assertEq(evidence[0].submitter, claimant);
        assertTrue(evidence[0].isClaimant);
    }

    // ============ Response ============

    function test_submitResponse() public {
        bytes32 disputeId = _fileDispute();

        vm.prank(respondent);
        resolver.submitResponse(disputeId, "QmDefense1");

        DisputeResolver.Evidence[] memory evidence = resolver.getEvidence(disputeId);
        assertEq(evidence.length, 2);
        assertFalse(evidence[1].isClaimant);
    }

    function test_submitResponse_wrongPhase() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);

        // Advance to arbitration first
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        vm.prank(respondent);
        vm.expectRevert(DisputeResolver.WrongPhase.selector);
        resolver.submitResponse(disputeId, "QmDefense1");
    }

    function test_submitResponse_notRespondent() public {
        bytes32 disputeId = _fileDispute();

        vm.prank(makeAddr("rando"));
        vm.expectRevert(DisputeResolver.NotRespondent.selector);
        resolver.submitResponse(disputeId, "QmDefense1");
    }

    // ============ Advance to Arbitration ============

    function test_advanceToArbitration() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);

        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(uint8(d.phase), uint8(DisputeResolver.DisputePhase.ARBITRATION));
        assertEq(d.assignedArbitrator, arbitrator1);
    }

    function test_advanceToArbitration_phaseNotExpired() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);

        vm.expectRevert(DisputeResolver.PhaseNotExpired.selector);
        resolver.advanceToArbitration(disputeId);
    }

    function test_advanceToArbitration_wrongPhase() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        // Already in ARBITRATION
        vm.expectRevert(DisputeResolver.WrongPhase.selector);
        resolver.advanceToArbitration(disputeId);
    }

    function test_advanceToArbitration_roundRobin() public {
        _registerArbitrator(arbitrator1);
        _registerArbitrator(arbitrator2);

        // File first dispute at T=1
        bytes32 d1 = _fileDispute();
        // d1 phaseDeadline = 1 + 7 days = 604801
        vm.warp(604801 + 1); // Past d1 deadline
        resolver.advanceToArbitration(d1);
        DisputeResolver.Dispute memory dispute1 = resolver.getDispute(d1);

        // File second dispute at current timestamp
        uint256 d2FiledAt = block.timestamp;
        vm.prank(claimant);
        bytes32 d2 = resolver.fileDispute{value: 0.01 ether}(
            keccak256("case2"), bytes32(0), respondent, 50 ether, address(0), "Fraud", "Qm2"
        );
        // d2 phaseDeadline = d2FiledAt + 7 days
        vm.warp(d2FiledAt + 8 days);
        resolver.advanceToArbitration(d2);
        DisputeResolver.Dispute memory dispute2 = resolver.getDispute(d2);

        // Should be different arbitrators (round-robin)
        assertTrue(dispute1.assignedArbitrator != dispute2.assignedArbitrator);
    }

    // ============ Add Evidence ============

    function test_addEvidence() public {
        bytes32 disputeId = _fileDispute();

        vm.prank(claimant);
        resolver.addEvidence(disputeId, "QmMore1");

        vm.prank(respondent);
        resolver.addEvidence(disputeId, "QmMore2");

        DisputeResolver.Evidence[] memory evidence = resolver.getEvidence(disputeId);
        assertEq(evidence.length, 3);
    }

    function test_addEvidence_notParty() public {
        bytes32 disputeId = _fileDispute();

        vm.prank(makeAddr("rando"));
        vm.expectRevert("Not a party");
        resolver.addEvidence(disputeId, "QmHack");
    }

    // ============ Resolution ============

    function test_resolveDispute_claimantWins() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.CLAIMANT_WINS);

        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(uint8(d.phase), uint8(DisputeResolver.DisputePhase.RESOLVED));
        assertEq(uint8(d.resolution), uint8(DisputeResolver.Resolution.CLAIMANT_WINS));
    }

    function test_resolveDispute_respondentWins() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.RESPONDENT_WINS);

        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(uint8(d.resolution), uint8(DisputeResolver.Resolution.RESPONDENT_WINS));
    }

    function test_resolveDispute_settled() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.SETTLED);

        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(uint8(d.resolution), uint8(DisputeResolver.Resolution.SETTLED));
    }

    function test_resolveDispute_updatesArbitratorStats() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.CLAIMANT_WINS);

        DisputeResolver.Arbitrator memory arb = resolver.getArbitrator(arbitrator1);
        assertEq(arb.casesHandled, 1);
    }

    function test_resolveDispute_wrongPhase() public {
        bytes32 disputeId = _fileDispute();

        vm.prank(arbitrator1);
        vm.expectRevert(DisputeResolver.WrongPhase.selector);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.CLAIMANT_WINS);
    }

    function test_resolveDispute_notAssigned() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        vm.prank(makeAddr("rando"));
        vm.expectRevert(DisputeResolver.NotAssignedArbitrator.selector);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.CLAIMANT_WINS);
    }

    // ============ Escalation ============

    function test_escalateToTribunal() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.RESPONDENT_WINS);

        // Claimant disagrees, escalates
        vm.prank(claimant);
        resolver.escalateToTribunal{value: 0.02 ether}(disputeId);

        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(uint8(d.phase), uint8(DisputeResolver.DisputePhase.APPEALED));
        assertEq(uint8(d.resolution), uint8(DisputeResolver.Resolution.ESCALATED));
    }

    function test_escalateToTribunal_insufficientFee() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);

        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.RESPONDENT_WINS);

        vm.prank(claimant);
        vm.expectRevert("Insufficient escalation fee");
        resolver.escalateToTribunal{value: 0.01 ether}(disputeId);
    }

    function test_escalateToTribunal_refundsExcess() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);
        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.RESPONDENT_WINS);

        uint256 balBefore = claimant.balance;
        vm.prank(claimant);
        resolver.escalateToTribunal{value: 1 ether}(disputeId);
        assertEq(claimant.balance, balBefore - 0.02 ether);
    }

    function test_escalateToTribunal_notParty() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);
        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.RESPONDENT_WINS);

        vm.deal(makeAddr("rando"), 1 ether);
        vm.prank(makeAddr("rando"));
        vm.expectRevert("Not a party");
        resolver.escalateToTribunal{value: 0.02 ether}(disputeId);
    }

    // ============ Appeal Outcome ============

    function test_recordAppealOutcome_notOverturned() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);
        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.CLAIMANT_WINS);

        resolver.recordAppealOutcome(disputeId, false);

        DisputeResolver.Arbitrator memory arb = resolver.getArbitrator(arbitrator1);
        assertEq(arb.correctRulings, 1);
        assertEq(arb.reputation, 10000); // 1/1 = 100%
    }

    function test_recordAppealOutcome_overturned() public {
        bytes32 disputeId = _fileDispute();
        _registerArbitrator(arbitrator1);
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(disputeId);
        vm.prank(arbitrator1);
        resolver.resolveDispute(disputeId, DisputeResolver.Resolution.CLAIMANT_WINS);

        resolver.recordAppealOutcome(disputeId, true);

        DisputeResolver.Arbitrator memory arb = resolver.getArbitrator(arbitrator1);
        assertEq(arb.correctRulings, 0);
        assertEq(arb.reputation, 0); // 0/1 = 0%
    }

    function test_recordAppealOutcome_suspendsBadArbitrator() public {
        _registerArbitrator(arbitrator1);

        // File and resolve 5 disputes, all overturned
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(claimant);
            bytes32 did = resolver.fileDispute{value: 0.01 ether}(
                keccak256(abi.encodePacked("case", i)), bytes32(0), respondent, 10 ether, address(0), "claim", "Qm"
            );
            vm.warp(block.timestamp + 8 days);
            resolver.advanceToArbitration(did);
            vm.prank(arbitrator1);
            resolver.resolveDispute(did, DisputeResolver.Resolution.CLAIMANT_WINS);
            resolver.recordAppealOutcome(did, true); // overturned
        }

        DisputeResolver.Arbitrator memory arb = resolver.getArbitrator(arbitrator1);
        assertTrue(arb.suspended);
    }

    // ============ Default Judgment ============

    function test_defaultJudgment() public {
        bytes32 disputeId = _fileDispute();

        // Don't submit response, wait past deadline
        vm.warp(block.timestamp + 8 days);
        resolver.defaultJudgment(disputeId);

        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(uint8(d.resolution), uint8(DisputeResolver.Resolution.CLAIMANT_WINS));
        assertEq(uint8(d.phase), uint8(DisputeResolver.DisputePhase.RESOLVED));
    }

    function test_defaultJudgment_respondentResponded() public {
        bytes32 disputeId = _fileDispute();

        vm.prank(respondent);
        resolver.submitResponse(disputeId, "QmDefense");

        vm.warp(block.timestamp + 8 days);
        resolver.defaultJudgment(disputeId);

        // Should NOT resolve — respondent did respond
        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(uint8(d.resolution), uint8(DisputeResolver.Resolution.PENDING));
    }

    function test_defaultJudgment_phaseNotExpired() public {
        bytes32 disputeId = _fileDispute();

        vm.expectRevert(DisputeResolver.PhaseNotExpired.selector);
        resolver.defaultJudgment(disputeId);
    }

    // ============ Admin ============

    function test_setFees() public {
        resolver.setFees(0.05 ether, 5 ether);
        assertEq(resolver.filingFee(), 0.05 ether);
        assertEq(resolver.minArbitratorStake(), 5 ether);
    }

    function test_setDurations() public {
        resolver.setDurations(14 days, 28 days);
        assertEq(resolver.responseDuration(), 14 days);
        assertEq(resolver.arbitrationDuration(), 28 days);
    }

    function test_setTribunal() public {
        address newTribunal = makeAddr("newTribunal");
        resolver.setTribunal(newTribunal);
        assertEq(address(resolver.tribunal()), newTribunal);
    }

    // ============ View Functions ============

    function test_getDisputeNotFound() public view {
        DisputeResolver.Dispute memory d = resolver.getDispute(keccak256("nonexistent"));
        assertEq(d.caseId, bytes32(0));
    }
}
