// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/governance/VibeCrossChainGovernance.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibeCrossChainGovernance Tests ============

contract VibeCrossChainGovernanceTest is Test {
    VibeCrossChainGovernance public gov;

    address public owner;
    address public proposer;
    address public validator1;
    address public validator2;
    address public validator3;

    bytes32 constant DESC_HASH = keccak256("Increase protocol fee to 0.05%");

    uint256 constant VOTING_PERIOD = 3 days;
    uint256 constant QUORUM = 1000;

    uint256 constant CHAIN_1 = 1;
    uint256 constant CHAIN_137 = 137;
    uint256 constant CHAIN_42161 = 42161;

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 descriptionHash,
        uint256[] chainIds,
        uint256 quorum,
        uint256 deadline
    );
    event ChainVotesSubmitted(
        uint256 indexed proposalId,
        uint256 indexed chainId,
        uint256 votesFor,
        uint256 votesAgainst,
        address indexed validator
    );
    event ChainVotesFinalized(
        uint256 indexed proposalId,
        uint256 indexed chainId,
        uint256 votesFor,
        uint256 votesAgainst
    );
    event ProposalExecuted(uint256 indexed proposalId, bool passed);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        proposer = makeAddr("proposer");
        validator1 = makeAddr("validator1");
        validator2 = makeAddr("validator2");
        validator3 = makeAddr("validator3");

        VibeCrossChainGovernance impl = new VibeCrossChainGovernance();
        bytes memory initData = abi.encodeWithSelector(
            VibeCrossChainGovernance.initialize.selector,
            owner,
            1 // minAttestations = 1
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        gov = VibeCrossChainGovernance(address(proxy));

        // Register validators
        gov.addValidator(validator1);
        gov.addValidator(validator2);
        gov.addValidator(validator3);
    }

    // ============ Initialization ============

    function test_initialize_setsOwnerAndAttestations() public view {
        assertEq(gov.owner(), owner);
        assertEq(gov.minValidatorAttestations(), 1);
        assertEq(gov.validatorCount(), 3);
    }

    function test_initialize_validatorsRegistered() public view {
        assertTrue(gov.validators(validator1));
        assertTrue(gov.validators(validator2));
        assertTrue(gov.validators(validator3));
        assertFalse(gov.validators(proposer));
    }

    // ============ Proposal Creation ============

    function _chainIds() internal pure returns (uint256[] memory) {
        uint256[] memory ids = new uint256[](2);
        ids[0] = CHAIN_1;
        ids[1] = CHAIN_137;
        return ids;
    }

    function test_createProposal_storesProposalAndEmitsEvent() public {
        uint256[] memory chains = _chainIds();

        vm.prank(proposer);
        vm.expectEmit(true, true, false, false);
        emit ProposalCreated(1, proposer, DESC_HASH, chains, QUORUM, 0);
        uint256 pid = gov.createProposal(DESC_HASH, chains, QUORUM, VOTING_PERIOD);

        assertEq(pid, 1);
        assertEq(gov.proposalCount(), 1);

        VibeCrossChainGovernance.CrossChainProposal memory p = gov.getProposal(1);
        assertEq(p.proposalId, 1);
        assertEq(p.proposer, proposer);
        assertEq(p.descriptionHash, DESC_HASH);
        assertEq(p.quorum, QUORUM);
        assertFalse(p.executed);
        assertFalse(p.passed);
        assertEq(p.chainIds.length, 2);
    }

    function test_createProposal_revertsOnVotingPeriodTooShort() public {
        vm.prank(proposer);
        vm.expectRevert(VibeCrossChainGovernance.InvalidVotingPeriod.selector);
        gov.createProposal(DESC_HASH, _chainIds(), QUORUM, 23 hours);
    }

    function test_createProposal_revertsOnVotingPeriodTooLong() public {
        vm.prank(proposer);
        vm.expectRevert(VibeCrossChainGovernance.InvalidVotingPeriod.selector);
        gov.createProposal(DESC_HASH, _chainIds(), QUORUM, 31 days);
    }

    function test_createProposal_revertsOnNoChains() public {
        uint256[] memory empty = new uint256[](0);
        vm.prank(proposer);
        vm.expectRevert(VibeCrossChainGovernance.NoChains.selector);
        gov.createProposal(DESC_HASH, empty, QUORUM, VOTING_PERIOD);
    }

    function test_createProposal_revertsOnZeroQuorum() public {
        vm.prank(proposer);
        vm.expectRevert(VibeCrossChainGovernance.ZeroQuorum.selector);
        gov.createProposal(DESC_HASH, _chainIds(), 0, VOTING_PERIOD);
    }

    function test_createProposal_revertsOnTooManyChains() public {
        uint256[] memory chains = new uint256[](21);
        for (uint256 i = 0; i < 21; i++) chains[i] = i + 1;

        vm.prank(proposer);
        vm.expectRevert(VibeCrossChainGovernance.TooManyChains.selector);
        gov.createProposal(DESC_HASH, chains, QUORUM, VOTING_PERIOD);
    }

    // ============ Validator Attestation / Vote Relay ============

    function _createProposal() internal returns (uint256 pid) {
        vm.prank(proposer);
        return gov.createProposal(DESC_HASH, _chainIds(), QUORUM, VOTING_PERIOD);
    }

    function test_submitChainVotes_firstAttestorSetsValues() public {
        uint256 pid = _createProposal();

        vm.prank(validator1);
        vm.expectEmit(true, true, false, true);
        emit ChainVotesSubmitted(pid, CHAIN_1, 800, 100, validator1);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);

        (uint256 vFor, uint256 vAgainst, bool finalized) = gov.getChainVotes(pid, CHAIN_1);
        assertEq(vFor, 800);
        assertEq(vAgainst, 100);
        // minAttestations=1, so a single attestation immediately finalizes the chain votes
        assertTrue(finalized);
    }

    function test_submitChainVotes_finalizesOnceThresholdMet() public {
        uint256 pid = _createProposal();

        // With minAttestations=1, single validator submission finalizes immediately
        vm.prank(validator1);
        vm.expectEmit(true, true, false, true);
        emit ChainVotesFinalized(pid, CHAIN_1, 800, 100);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);

        (, , bool finalized) = gov.getChainVotes(pid, CHAIN_1);
        assertTrue(finalized);
    }

    function test_submitChainVotes_multipleValidatorsAttest() public {
        // Require 2 attestations
        gov.setMinValidatorAttestations(2);
        uint256 pid = _createProposal();

        vm.prank(validator1);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);

        (, , bool notYet) = gov.getChainVotes(pid, CHAIN_1);
        assertFalse(notYet);

        vm.prank(validator2);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100); // same values

        (, , bool finalized) = gov.getChainVotes(pid, CHAIN_1);
        assertTrue(finalized);
    }

    function test_submitChainVotes_revertsOnVoteMismatch() public {
        gov.setMinValidatorAttestations(2);
        uint256 pid = _createProposal();

        vm.prank(validator1);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);

        // validator2 submits different numbers
        vm.prank(validator2);
        vm.expectRevert("Vote mismatch with prior attestation");
        gov.submitChainVotes(pid, CHAIN_1, 900, 100);
    }

    function test_submitChainVotes_revertsIfNotValidator() public {
        uint256 pid = _createProposal();

        vm.prank(proposer);
        vm.expectRevert(VibeCrossChainGovernance.NotValidator.selector);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);
    }

    function test_submitChainVotes_revertsIfAlreadyAttested() public {
        gov.setMinValidatorAttestations(3);
        uint256 pid = _createProposal();

        vm.prank(validator1);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);

        vm.prank(validator1);
        vm.expectRevert(VibeCrossChainGovernance.AlreadyAttested.selector);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);
    }

    function test_submitChainVotes_revertsForUnknownChain() public {
        uint256 pid = _createProposal();

        vm.prank(validator1);
        vm.expectRevert(VibeCrossChainGovernance.ChainNotInProposal.selector);
        gov.submitChainVotes(pid, 999, 800, 100);
    }

    function test_submitChainVotes_revertsAfterDeadline() public {
        uint256 pid = _createProposal();

        vm.warp(block.timestamp + VOTING_PERIOD + 1);

        vm.prank(validator1);
        vm.expectRevert("Voting period ended");
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);
    }

    function test_submitChainVotes_revertsIfVotesAlreadyFinalized() public {
        uint256 pid = _createProposal();

        // Finalize with validator1 (minAttestations=1)
        vm.prank(validator1);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);

        // validator2 tries to submit after finalized
        vm.prank(validator2);
        vm.expectRevert(VibeCrossChainGovernance.VotesAlreadyFinalized.selector);
        gov.submitChainVotes(pid, CHAIN_1, 800, 100);
    }

    // ============ Execution ============

    function _createAndFinalizeProposal(uint256 votesFor, uint256 votesAgainst)
        internal
        returns (uint256 pid)
    {
        pid = _createProposal();

        // Submit votes for both chains
        vm.prank(validator1);
        gov.submitChainVotes(pid, CHAIN_1, votesFor, votesAgainst);

        vm.prank(validator2);
        gov.submitChainVotes(pid, CHAIN_137, votesFor, votesAgainst);
    }

    function test_executeProposal_passesWithQuorumAndMajority() public {
        uint256 pid = _createAndFinalizeProposal(600, 100);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);

        vm.expectEmit(true, false, false, true);
        emit ProposalExecuted(pid, true);
        gov.executeProposal(pid);

        VibeCrossChainGovernance.CrossChainProposal memory p = gov.getProposal(pid);
        assertTrue(p.executed);
        assertTrue(p.passed);
    }

    function test_executeProposal_failsWithoutQuorum() public {
        // Total votes = 200, quorum = 1000 — not met
        uint256 pid = _createAndFinalizeProposal(110, 90);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);

        gov.executeProposal(pid);

        VibeCrossChainGovernance.CrossChainProposal memory p = gov.getProposal(pid);
        assertTrue(p.executed);
        assertFalse(p.passed); // quorum not met (110+90)*2=400 < 1000
    }

    function test_executeProposal_failsWithQuorumButNoMajority() public {
        // Quorum met (600*2=1200 > 1000) but against > for
        uint256 pid = _createAndFinalizeProposal(200, 400);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);

        gov.executeProposal(pid);

        VibeCrossChainGovernance.CrossChainProposal memory p = gov.getProposal(pid);
        assertTrue(p.executed);
        assertFalse(p.passed);
    }

    function test_executeProposal_revertsBeforeDeadline() public {
        uint256 pid = _createAndFinalizeProposal(600, 100);

        vm.expectRevert(VibeCrossChainGovernance.VotingNotEnded.selector);
        gov.executeProposal(pid);
    }

    function test_executeProposal_revertsIfAlreadyExecuted() public {
        uint256 pid = _createAndFinalizeProposal(600, 100);
        vm.warp(block.timestamp + VOTING_PERIOD + 1);

        gov.executeProposal(pid);

        vm.expectRevert(VibeCrossChainGovernance.ProposalAlreadyExecuted.selector);
        gov.executeProposal(pid);
    }

    function test_executeProposal_revertsOnInvalidId() public {
        vm.expectRevert(VibeCrossChainGovernance.ProposalNotFound.selector);
        gov.executeProposal(999);
    }

    // ============ Validator Management ============

    function test_addValidator_revertsIfAlreadyValidator() public {
        vm.expectRevert(VibeCrossChainGovernance.AlreadyValidator.selector);
        gov.addValidator(validator1);
    }

    function test_removeValidator_decrementsCount() public {
        gov.removeValidator(validator1);
        assertFalse(gov.validators(validator1));
        assertEq(gov.validatorCount(), 2);
    }

    function test_removeValidator_revertsIfNotValidator() public {
        vm.expectRevert(VibeCrossChainGovernance.NotValidator.selector);
        gov.removeValidator(proposer);
    }

    function test_setMinValidatorAttestations_updatesValue() public {
        gov.setMinValidatorAttestations(3);
        assertEq(gov.minValidatorAttestations(), 3);
    }

    function test_setMinValidatorAttestations_revertsOnZero() public {
        vm.expectRevert(VibeCrossChainGovernance.InvalidMinAttestations.selector);
        gov.setMinValidatorAttestations(0);
    }

    // ============ hasQuorum view ============

    function test_hasQuorum_returnsTrueWhenMetAcrossChains() public {
        uint256 pid = _createAndFinalizeProposal(600, 100);
        // 600+100 per chain * 2 chains = 1400 >= 1000
        assertTrue(gov.hasQuorum(pid));
    }

    function test_hasQuorum_returnsFalseWhenNotMet() public {
        uint256 pid = _createAndFinalizeProposal(100, 50);
        // 150*2 = 300 < 1000
        assertFalse(gov.hasQuorum(pid));
    }

    // ============ Fuzz ============

    function testFuzz_createProposal_incrementsCounter(uint8 numProposals) public {
        vm.assume(numProposals > 0 && numProposals < 20);
        uint256[] memory chains = _chainIds();
        for (uint256 i = 0; i < numProposals; i++) {
            gov.createProposal(DESC_HASH, chains, QUORUM, VOTING_PERIOD);
        }
        assertEq(gov.proposalCount(), numProposals);
    }
}
