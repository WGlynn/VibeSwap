// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/governance/DecentralizedTribunal.sol";
import "../contracts/compliance/FederatedConsensus.sol";

contract MockDTSoulbound {
    mapping(address => bool) public hasId;
    mapping(address => ISoulboundIdentityMinimal.IdentityInfo) public ids;

    function setIdentity(address addr, uint256 level, uint256 rep) external {
        hasId[addr] = true;
        ISoulboundIdentityMinimal.AvatarTraits memory avatar;
        ids[addr] = ISoulboundIdentityMinimal.IdentityInfo({
            username: "juror",
            level: level,
            xp: 0,
            alignment: 0,
            contributions: 0,
            reputation: rep,
            createdAt: block.timestamp,
            lastActive: block.timestamp,
            avatar: avatar,
            quantumEnabled: false,
            quantumKeyRoot: bytes32(0)
        });
    }

    function hasIdentity(address addr) external view returns (bool) { return hasId[addr]; }
    function getIdentity(address addr) external view returns (ISoulboundIdentityMinimal.IdentityInfo memory) { return ids[addr]; }
}

contract DecentralizedTribunalTest is Test {
    DecentralizedTribunal public tribunal;
    FederatedConsensus public consensus;
    MockDTSoulbound public soulbound;

    address public owner;
    bytes32 public caseId = keccak256("case1");
    bytes32 public proposalId;

    function setUp() public {
        owner = address(this);

        // Deploy consensus
        FederatedConsensus consImpl = new FederatedConsensus();
        ERC1967Proxy consProxy = new ERC1967Proxy(
            address(consImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, owner, 1, 1 days)
        );
        consensus = FederatedConsensus(address(consProxy));

        // Deploy tribunal
        DecentralizedTribunal impl = new DecentralizedTribunal();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(DecentralizedTribunal.initialize.selector, owner, address(consensus))
        );
        tribunal = DecentralizedTribunal(payable(address(proxy)));

        // Register tribunal as authority in consensus
        consensus.addAuthority(address(tribunal), FederatedConsensus.AuthorityRole.ONCHAIN_TRIBUNAL, "GLOBAL");

        // Create a proposal for the tribunal to vote on
        proposalId = consensus.createProposal(caseId, makeAddr("target"), 100 ether, address(0), "test case");

        // Deploy soulbound (optional)
        soulbound = new MockDTSoulbound();
    }

    // ============ Helpers ============

    function _openTrial() internal returns (bytes32) {
        return tribunal.openTrial(caseId, proposalId);
    }

    function _fillJury(bytes32 trialId) internal returns (address[] memory jurorAddrs) {
        uint256 jurySize = tribunal.defaultJurySize();
        jurorAddrs = new address[](jurySize);
        for (uint256 i = 0; i < jurySize; i++) {
            address j = makeAddr(string(abi.encodePacked("juror", i)));
            vm.deal(j, 1 ether);
            vm.prank(j);
            tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);
            jurorAddrs[i] = j;
        }
    }

    function _fillJuryAndAdvance(bytes32 trialId) internal returns (address[] memory jurorAddrs) {
        jurorAddrs = _fillJury(trialId);
        // Jury fills auto-advances to EVIDENCE
        // Advance past evidence period
        vm.warp(block.timestamp + 5 days + 1);
        tribunal.advanceToDeliberation(trialId);
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(tribunal.defaultJurySize(), 7);
        assertEq(tribunal.jurorStakeAmount(), 0.1 ether);
        assertEq(tribunal.quorumBps(), 6000);
        assertEq(tribunal.maxAppeals(), 2);
        assertEq(tribunal.minJurorReputation(), 10);
        assertEq(tribunal.minJurorLevel(), 2);
    }

    // ============ Open Trial ============

    function test_openTrial() public {
        bytes32 trialId = _openTrial();
        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);

        assertEq(trial.caseId, caseId);
        assertEq(uint8(trial.phase), uint8(DecentralizedTribunal.TrialPhase.JURY_SELECTION));
        assertEq(uint8(trial.verdict), uint8(DecentralizedTribunal.Verdict.PENDING));
        assertEq(trial.jurySize, 7);
        assertEq(tribunal.trialCount(), 1);
    }

    function test_openTrial_onlyOwner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        tribunal.openTrial(caseId, proposalId);
    }

    // ============ Volunteer as Juror ============

    function test_volunteerAsJuror() public {
        bytes32 trialId = _openTrial();
        address juror = makeAddr("juror0");
        vm.deal(juror, 1 ether);

        vm.prank(juror);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);

        address[] memory trialJurors = tribunal.getTrialJurors(trialId);
        assertEq(trialJurors.length, 1);
        assertEq(trialJurors[0], juror);
    }

    function test_volunteerAsJuror_insufficientStake() public {
        bytes32 trialId = _openTrial();
        address juror = makeAddr("juror0");
        vm.deal(juror, 1 ether);

        vm.prank(juror);
        vm.expectRevert(DecentralizedTribunal.InsufficientStake.selector);
        tribunal.volunteerAsJuror{value: 0.05 ether}(trialId);
    }

    function test_volunteerAsJuror_wrongPhase() public {
        bytes32 trialId = _openTrial();
        _fillJury(trialId); // fills jury, auto-advances to EVIDENCE

        address juror = makeAddr("extra_juror");
        vm.deal(juror, 1 ether);
        vm.prank(juror);
        vm.expectRevert(DecentralizedTribunal.WrongPhase.selector);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);
    }

    function test_volunteerAsJuror_alreadyJuror() public {
        bytes32 trialId = _openTrial();
        address juror = makeAddr("juror0");
        vm.deal(juror, 2 ether);

        vm.prank(juror);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);

        vm.prank(juror);
        vm.expectRevert(DecentralizedTribunal.AlreadyJuror.selector);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);
    }

    function test_volunteerAsJuror_autoAdvancesWhenFull() public {
        bytes32 trialId = _openTrial();
        _fillJury(trialId);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(uint8(trial.phase), uint8(DecentralizedTribunal.TrialPhase.EVIDENCE));
    }

    function test_volunteerAsJuror_juryFull() public {
        bytes32 trialId = _openTrial();
        _fillJury(trialId); // fills 7

        // Already auto-advanced to EVIDENCE, so WrongPhase is expected
        address extra = makeAddr("extra");
        vm.deal(extra, 1 ether);
        vm.prank(extra);
        vm.expectRevert(DecentralizedTribunal.WrongPhase.selector);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);
    }

    function test_volunteerAsJuror_soulboundChecks() public {
        tribunal.setSoulboundIdentity(address(soulbound));
        bytes32 trialId = _openTrial();

        address juror = makeAddr("juror0");
        vm.deal(juror, 1 ether);

        // No identity
        vm.prank(juror);
        vm.expectRevert(DecentralizedTribunal.NoIdentity.selector);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);

        // Low level
        soulbound.setIdentity(juror, 1, 100);
        vm.prank(juror);
        vm.expectRevert(DecentralizedTribunal.InsufficientLevel.selector);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);

        // Low reputation
        soulbound.setIdentity(juror, 5, 5);
        vm.prank(juror);
        vm.expectRevert(DecentralizedTribunal.InsufficientReputation.selector);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);

        // Valid identity
        soulbound.setIdentity(juror, 5, 100);
        vm.prank(juror);
        tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);
    }

    // ============ Evidence ============

    function test_submitEvidence() public {
        bytes32 trialId = _openTrial();
        _fillJury(trialId); // auto-advances to EVIDENCE

        tribunal.submitEvidence(trialId, "QmEvidence1");
        assertEq(tribunal.getEvidenceCount(trialId), 1);
    }

    function test_submitEvidence_wrongPhase() public {
        bytes32 trialId = _openTrial();
        // Still in JURY_SELECTION
        vm.expectRevert(DecentralizedTribunal.WrongPhase.selector);
        tribunal.submitEvidence(trialId, "QmEvidence1");
    }

    // ============ Deliberation ============

    function test_advanceToDeliberation() public {
        bytes32 trialId = _openTrial();
        _fillJury(trialId);

        vm.warp(block.timestamp + 5 days + 1);
        tribunal.advanceToDeliberation(trialId);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(uint8(trial.phase), uint8(DecentralizedTribunal.TrialPhase.DELIBERATION));
    }

    function test_advanceToDeliberation_phaseNotExpired() public {
        bytes32 trialId = _openTrial();
        _fillJury(trialId);

        vm.expectRevert(DecentralizedTribunal.PhaseNotExpired.selector);
        tribunal.advanceToDeliberation(trialId);
    }

    // ============ Voting ============

    function test_castJuryVote() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        vm.prank(jurorAddrs[0]);
        tribunal.castJuryVote(trialId, true);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(trial.guiltyVotes, 1);
    }

    function test_castJuryVote_notSummoned() public {
        bytes32 trialId = _openTrial();
        _fillJuryAndAdvance(trialId);

        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(DecentralizedTribunal.NotSummoned.selector);
        tribunal.castJuryVote(trialId, true);
    }

    function test_castJuryVote_alreadyVoted() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        vm.prank(jurorAddrs[0]);
        tribunal.castJuryVote(trialId, true);

        vm.prank(jurorAddrs[0]);
        vm.expectRevert(DecentralizedTribunal.AlreadyVoted.selector);
        tribunal.castJuryVote(trialId, true);
    }

    // ============ Verdict ============

    function test_renderVerdict_guilty() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        // 5 guilty, 2 not guilty (quorum met, majority guilty)
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        for (uint256 i = 5; i < 7; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, false);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(uint8(trial.verdict), uint8(DecentralizedTribunal.Verdict.GUILTY));
        assertEq(uint8(trial.phase), uint8(DecentralizedTribunal.TrialPhase.VERDICT));
    }

    function test_renderVerdict_notGuilty() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        // 2 guilty, 5 not guilty
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        for (uint256 i = 2; i < 7; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, false);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(uint8(trial.verdict), uint8(DecentralizedTribunal.Verdict.NOT_GUILTY));
    }

    function test_renderVerdict_mistrial_noQuorum() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        // Only 3 vote (need 60% of 7 = 4.2, so need at least 5)
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(uint8(trial.verdict), uint8(DecentralizedTribunal.Verdict.MISTRIAL));
    }

    function test_renderVerdict_mistrial_tie() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        // 3 guilty, 3 not guilty, 1 abstain — but that's only 6 votes
        // 60% of 7 = 4.2, need at least 5, so 6 meets quorum but 3-3 is a tie
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        for (uint256 i = 3; i < 6; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, false);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(uint8(trial.verdict), uint8(DecentralizedTribunal.Verdict.MISTRIAL));
    }

    function test_renderVerdict_phaseNotExpired() public {
        bytes32 trialId = _openTrial();
        _fillJuryAndAdvance(trialId);

        vm.expectRevert(DecentralizedTribunal.PhaseNotExpired.selector);
        tribunal.renderVerdict(trialId);
    }

    // ============ Stake Settlement ============

    function test_stakeSettlement_majorityGetsStakeBack() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        // 5 guilty (majority), 2 not guilty
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        for (uint256 i = 5; i < 7; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, false);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        // Majority (guilty voters) should have pending stake
        assertEq(tribunal.pendingStakeWithdrawals(jurorAddrs[0]), 0.1 ether);
        // Minority should have no pending stake
        assertEq(tribunal.pendingStakeWithdrawals(jurorAddrs[5]), 0);
    }

    function test_withdrawStake() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        for (uint256 i = 5; i < 7; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, false);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        uint256 balBefore = jurorAddrs[0].balance;
        vm.prank(jurorAddrs[0]);
        tribunal.withdrawStake();
        assertEq(jurorAddrs[0].balance, balBefore + 0.1 ether);
        assertEq(tribunal.pendingStakeWithdrawals(jurorAddrs[0]), 0);
    }

    function test_withdrawStake_noPendingStake() public {
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(DecentralizedTribunal.NoPendingStake.selector);
        tribunal.withdrawStake();
    }

    // ============ Appeal ============

    function test_fileAppeal() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        for (uint256 i = 5; i < 7; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, false);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        // File appeal within appeal window (requires stake)
        tribunal.fileAppeal{value: 0.1 ether}(trialId);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(uint8(trial.phase), uint8(DecentralizedTribunal.TrialPhase.JURY_SELECTION));
        assertEq(trial.jurySize, 11); // 7 + 4
        assertEq(trial.appealCount, 1);
        assertEq(trial.guiltyVotes, 0);
        assertEq(trial.notGuiltyVotes, 0);
    }

    function test_fileAppeal_maxAppealsReached() public {
        // Mock consensus.vote to always succeed (we're testing maxAppeals, not consensus)
        vm.mockCall(
            address(consensus),
            abi.encodeWithSelector(FederatedConsensus.vote.selector),
            abi.encode()
        );

        bytes32 trialId = _openTrial();

        // Appeal round 1: fill jury → evidence → deliberation → verdict → appeal
        address[] memory jurors1 = _fillJuryAndAdvance(trialId);
        for (uint256 i = 0; i < jurors1.length; i++) {
            vm.prank(jurors1[i]);
            tribunal.castJuryVote(trialId, true);
        }
        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);
        tribunal.fileAppeal{value: 0.1 ether}(trialId);

        // Appeal round 2: jury size is now 11
        DecentralizedTribunal.Trial memory t2 = tribunal.getTrial(trialId);
        assertEq(t2.jurySize, 11);
        for (uint256 i = 0; i < 11; i++) {
            address j = makeAddr(string(abi.encodePacked("jr2_", i)));
            vm.deal(j, 1 ether);
            vm.prank(j);
            tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);
        }
        vm.warp(block.timestamp + 5 days + 1);
        tribunal.advanceToDeliberation(trialId);
        address[] memory jurs2 = tribunal.getTrialJurors(trialId);
        for (uint256 i = 0; i < jurs2.length; i++) {
            vm.prank(jurs2[i]);
            tribunal.castJuryVote(trialId, true);
        }
        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);
        tribunal.fileAppeal{value: 0.1 ether}(trialId);

        // Appeal round 3: jury size is now 15, but max appeals (2) reached
        DecentralizedTribunal.Trial memory t3 = tribunal.getTrial(trialId);
        assertEq(t3.jurySize, 15);
        assertEq(t3.appealCount, 2);
        for (uint256 i = 0; i < 15; i++) {
            address j = makeAddr(string(abi.encodePacked("jr3_", i)));
            vm.deal(j, 1 ether);
            vm.prank(j);
            tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);
        }
        vm.warp(block.timestamp + 5 days + 1);
        tribunal.advanceToDeliberation(trialId);
        address[] memory jurs3 = tribunal.getTrialJurors(trialId);
        for (uint256 i = 0; i < jurs3.length; i++) {
            vm.prank(jurs3[i]);
            tribunal.castJuryVote(trialId, true);
        }
        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        vm.expectRevert(DecentralizedTribunal.MaxAppealsReached.selector);
        tribunal.fileAppeal{value: 0.1 ether}(trialId);
    }

    // ============ Close Trial ============

    function test_closeTrial() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        for (uint256 i = 5; i < 7; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, false);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        // Wait for appeal window
        vm.warp(block.timestamp + 7 days + 1);
        tribunal.closeTrial(trialId);

        DecentralizedTribunal.Trial memory trial = tribunal.getTrial(trialId);
        assertEq(uint8(trial.phase), uint8(DecentralizedTribunal.TrialPhase.CLOSED));
    }

    function test_closeTrial_phaseNotExpired() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        for (uint256 i = 0; i < 7; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        vm.expectRevert(DecentralizedTribunal.PhaseNotExpired.selector);
        tribunal.closeTrial(trialId);
    }

    // ============ Admin ============

    function test_setJuryParameters() public {
        tribunal.setJuryParameters(11, 0.5 ether, 7000);
        assertEq(tribunal.defaultJurySize(), 11);
        assertEq(tribunal.jurorStakeAmount(), 0.5 ether);
        assertEq(tribunal.quorumBps(), 7000);
    }

    function test_setPhaseDurations() public {
        tribunal.setPhaseDurations(1 days, 3 days, 2 days, 5 days);
        assertEq(tribunal.jurySelectionDuration(), 1 days);
        assertEq(tribunal.evidenceDuration(), 3 days);
        assertEq(tribunal.deliberationDuration(), 2 days);
        assertEq(tribunal.appealDuration(), 5 days);
    }

    function test_setEligibility() public {
        tribunal.setEligibility(50, 5);
        assertEq(tribunal.minJurorReputation(), 50);
        assertEq(tribunal.minJurorLevel(), 5);
    }

    function test_setSoulboundIdentity() public {
        tribunal.setSoulboundIdentity(address(soulbound));
        assertEq(tribunal.soulboundIdentity(), address(soulbound));
    }

    function test_admin_onlyOwner() public {
        address rando = makeAddr("rando");

        vm.prank(rando);
        vm.expectRevert();
        tribunal.setJuryParameters(11, 0.5 ether, 7000);

        vm.prank(rando);
        vm.expectRevert();
        tribunal.setPhaseDurations(1 days, 3 days, 2 days, 5 days);

        vm.prank(rando);
        vm.expectRevert();
        tribunal.setEligibility(50, 5);
    }

    // ============ View Functions ============

    function test_getTrialJurors() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJury(trialId);
        address[] memory result = tribunal.getTrialJurors(trialId);
        assertEq(result.length, jurorAddrs.length);
    }

    function test_getEvidenceCount() public {
        bytes32 trialId = _openTrial();
        _fillJury(trialId);
        tribunal.submitEvidence(trialId, "Qm1");
        tribunal.submitEvidence(trialId, "Qm2");
        assertEq(tribunal.getEvidenceCount(trialId), 2);
    }

    // ============ Consensus Integration ============

    function test_verdictCastsConsensusVote() public {
        bytes32 trialId = _openTrial();
        address[] memory jurorAddrs = _fillJuryAndAdvance(trialId);

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, true);
        }
        for (uint256 i = 5; i < 7; i++) {
            vm.prank(jurorAddrs[i]);
            tribunal.castJuryVote(trialId, false);
        }

        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        // Tribunal should have voted on the consensus proposal
        assertTrue(consensus.hasVoted(proposalId, address(tribunal)));
    }

    function test_receive() public {
        (bool sent,) = address(tribunal).call{value: 1 ether}("");
        assertTrue(sent);
    }
}
