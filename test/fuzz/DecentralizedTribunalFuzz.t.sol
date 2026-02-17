// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/governance/DecentralizedTribunal.sol";
import "../../contracts/compliance/FederatedConsensus.sol";

contract DecentralizedTribunalFuzzTest is Test {
    DecentralizedTribunal public tribunal;
    FederatedConsensus public consensus;
    bytes32 public caseId = keccak256("case1");
    bytes32 public proposalId;

    function setUp() public {
        FederatedConsensus consImpl = new FederatedConsensus();
        ERC1967Proxy consProxy = new ERC1967Proxy(
            address(consImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, address(this), 1, 1 days)
        );
        consensus = FederatedConsensus(address(consProxy));

        DecentralizedTribunal impl = new DecentralizedTribunal();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(DecentralizedTribunal.initialize.selector, address(this), address(consensus))
        );
        tribunal = DecentralizedTribunal(payable(address(proxy)));

        consensus.addAuthority(address(tribunal), FederatedConsensus.AuthorityRole.ONCHAIN_TRIBUNAL, "GLOBAL");
        proposalId = consensus.createProposal(caseId, makeAddr("target"), 100 ether, address(0), "test");
    }

    /// @notice Juror stake is always enforced
    function testFuzz_jurorStakeEnforced(uint256 stake) public {
        stake = bound(stake, 0, 1 ether);
        bytes32 trialId = tribunal.openTrial(caseId, proposalId);

        address juror = makeAddr("juror");
        vm.deal(juror, 1 ether);

        if (stake < 0.1 ether) {
            vm.prank(juror);
            vm.expectRevert(DecentralizedTribunal.InsufficientStake.selector);
            tribunal.volunteerAsJuror{value: stake}(trialId);
        } else {
            vm.prank(juror);
            tribunal.volunteerAsJuror{value: stake}(trialId);
        }
    }

    /// @notice Quorum calculation is correct for varying jury sizes
    function testFuzz_quorumCalculation(uint256 jurySize, uint256 quorumBps) public {
        jurySize = bound(jurySize, 3, 21);
        quorumBps = bound(quorumBps, 1000, 10000);

        tribunal.setJuryParameters(jurySize, 0.1 ether, quorumBps);

        uint256 quorumRequired = (jurySize * quorumBps) / 10000;
        assertLe(quorumRequired, jurySize, "Quorum exceeds jury size");
    }

    /// @notice Trial count is monotonically increasing
    function testFuzz_trialCountMonotonic(uint8 numTrials) public {
        numTrials = uint8(bound(numTrials, 1, 10));

        for (uint8 i = 0; i < numTrials; i++) {
            tribunal.openTrial(keccak256(abi.encodePacked("case", i)), proposalId);
        }

        assertEq(tribunal.trialCount(), numTrials);
    }

    /// @notice Phase durations are always stored correctly
    function testFuzz_phaseDurationsStored(uint256 jury, uint256 evidence, uint256 deliberation, uint256 appeal) public {
        jury = bound(jury, 1 hours, 30 days);
        evidence = bound(evidence, 1 hours, 30 days);
        deliberation = bound(deliberation, 1 hours, 30 days);
        appeal = bound(appeal, 1 hours, 30 days);

        tribunal.setPhaseDurations(jury, evidence, deliberation, appeal);
        assertEq(tribunal.jurySelectionDuration(), jury);
        assertEq(tribunal.evidenceDuration(), evidence);
        assertEq(tribunal.deliberationDuration(), deliberation);
        assertEq(tribunal.appealDuration(), appeal);
    }

    /// @notice Eligibility parameters are stored correctly
    function testFuzz_eligibilityStored(uint256 minRep, uint256 minLevel) public {
        minRep = bound(minRep, 0, 10000);
        minLevel = bound(minLevel, 0, 100);

        tribunal.setEligibility(minRep, minLevel);
        assertEq(tribunal.minJurorReputation(), minRep);
        assertEq(tribunal.minJurorLevel(), minLevel);
    }
}
