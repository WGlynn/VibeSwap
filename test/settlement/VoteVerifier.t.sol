// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/VoteVerifier.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VoteVerifierTest is Test {
    VoteVerifier public verifier;

    address public owner;
    address public submitter;

    bytes32 public constant PROPOSAL_ID = keccak256("proposal-1");
    uint256 public constant DISPUTE_WINDOW = 1 hours;
    uint256 public constant BOND_AMOUNT = 0.01 ether;
    uint256 public constant QUORUM_BPS = 1000; // 10%

    function setUp() public {
        owner = address(this);
        submitter = makeAddr("submitter");

        VoteVerifier impl = new VoteVerifier();
        bytes memory initData = abi.encodeWithSelector(
            VoteVerifier.initialize.selector, DISPUTE_WINDOW, BOND_AMOUNT, QUORUM_BPS
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        verifier = VoteVerifier(payable(address(proxy)));

        vm.deal(submitter, 1 ether);
        vm.prank(submitter);
        verifier.bond{value: BOND_AMOUNT}();
    }

    // ============ Helpers ============

    function _validSubmission() internal view returns (VoteVerifier.VoteSubmission memory) {
        uint256[] memory opts = new uint256[](3);
        opts[0] = 500; opts[1] = 300; opts[2] = 200; // Option 0 wins
        return VoteVerifier.VoteSubmission({
            proposalId: PROPOSAL_ID,
            optionVotes: opts,
            totalVotesCast: 1000,
            registeredVoters: 5000,
            quorumRequired: 500,
            winningOption: 0
        });
    }

    function _setRootAndSubmit(VoteVerifier.VoteSubmission memory sub) internal {
        bytes32 resultHash = keccak256(abi.encode(
            sub.proposalId, sub.optionVotes, sub.totalVotesCast,
            sub.registeredVoters, sub.quorumRequired, sub.winningOption
        ));
        verifier.setExpectedRoot(sub.proposalId, resultHash);
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(submitter);
        verifier.submitVoteResult(sub, proof);
    }

    // ============ Valid Submission ============

    function test_submitVoteResult_valid() public {
        VoteVerifier.VoteSubmission memory sub = _validSubmission();
        _setRootAndSubmit(sub);

        (uint256[] memory opts, uint256 total, uint8 winner, bool quorum) =
            verifier.getVoteResult(PROPOSAL_ID);
        assertEq(opts.length, 3);
        assertEq(opts[0], 500);
        assertEq(total, 1000);
        assertEq(winner, 0);
        assertTrue(quorum);
    }

    // ============ Invariant 1: Conservation ============

    function test_revert_conservationViolation() public {
        VoteVerifier.VoteSubmission memory sub = _validSubmission();
        sub.totalVotesCast = 900; // sum is 1000, declared 900

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(VoteVerifier.ConservationViolation.selector, 1000, 900));
        verifier.submitVoteResult(sub, new bytes32[](0));
    }

    // ============ Invariant 2: No Inflation ============

    function test_revert_inflationViolation() public {
        VoteVerifier.VoteSubmission memory sub = _validSubmission();
        sub.registeredVoters = 500; // 1000 votes > 500 voters

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(VoteVerifier.InflationViolation.selector, 1000, 500));
        verifier.submitVoteResult(sub, new bytes32[](0));
    }

    // ============ Invariant 3: Quorum ============

    function test_revert_quorumNotMet() public {
        VoteVerifier.VoteSubmission memory sub = _validSubmission();
        sub.quorumRequired = 2000; // 1000 votes < 2000 required

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(VoteVerifier.QuorumNotMet.selector, 1000, 2000));
        verifier.submitVoteResult(sub, new bytes32[](0));
    }

    // ============ Invariant 4: Winning Option ============

    function test_revert_invalidWinningOption() public {
        VoteVerifier.VoteSubmission memory sub = _validSubmission();
        sub.winningOption = 2; // Option 2 has 200 votes, but option 0 has 500

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(VoteVerifier.InvalidWinningOption.selector, 2, 0));
        verifier.submitVoteResult(sub, new bytes32[](0));
    }

    function test_revert_winningOptionOutOfRange() public {
        VoteVerifier.VoteSubmission memory sub = _validSubmission();
        sub.winningOption = 5; // Only 3 options

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(VoteVerifier.InvalidWinningOption.selector, 5, 0));
        verifier.submitVoteResult(sub, new bytes32[](0));
    }

    // ============ Finalization ============

    function test_finalize_afterDisputeWindow() public {
        _setRootAndSubmit(_validSubmission());

        vm.expectRevert();
        verifier.finalizeVoteResult(PROPOSAL_ID);

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeVoteResult(PROPOSAL_ID);

        assertEq(verifier.getVerifiedWinner(PROPOSAL_ID), 0);
        assertTrue(verifier.isQuorumMet(PROPOSAL_ID));
    }

    // ============ Consumer Interface ============

    function test_getVerifiedTally() public {
        _setRootAndSubmit(_validSubmission());
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeVoteResult(PROPOSAL_ID);

        (uint256[] memory opts, uint8 winner, bool quorum) =
            verifier.getVerifiedTally(PROPOSAL_ID);
        assertEq(opts[0], 500);
        assertEq(winner, 0);
        assertTrue(quorum);
    }

    function test_getVoterTurnout() public {
        _setRootAndSubmit(_validSubmission());
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeVoteResult(PROPOSAL_ID);

        uint256 turnout = verifier.getVoterTurnout(PROPOSAL_ID);
        // 1000/5000 * 10000 = 2000 BPS = 20%
        assertEq(turnout, 2000);
    }

    function test_revert_getVerifiedTally_notFinalized() public {
        _setRootAndSubmit(_validSubmission());

        vm.expectRevert(VoteVerifier.ProposalNotFinalized.selector);
        verifier.getVerifiedTally(PROPOSAL_ID);
    }

    // ============ Pure Verification ============

    function test_verifyVoteInvariants_valid() public view {
        uint256[] memory opts = new uint256[](3);
        opts[0] = 500; opts[1] = 300; opts[2] = 200;
        assertTrue(verifier.verifyVoteInvariants(opts, 1000, 5000, 0));
    }

    function test_verifyVoteInvariants_inflated() public view {
        uint256[] memory opts = new uint256[](2);
        opts[0] = 600; opts[1] = 400;
        assertFalse(verifier.verifyVoteInvariants(opts, 1000, 500, 0)); // 1000 > 500
    }

    function test_verifyVoteInvariants_wrongWinner() public view {
        uint256[] memory opts = new uint256[](2);
        opts[0] = 300; opts[1] = 700;
        assertFalse(verifier.verifyVoteInvariants(opts, 1000, 5000, 0)); // option 1 has more
    }

    // ============ Edge Cases ============

    function test_revert_emptyOptions() public {
        VoteVerifier.VoteSubmission memory sub;
        sub.proposalId = PROPOSAL_ID;
        sub.optionVotes = new uint256[](0);
        sub.totalVotesCast = 100;
        sub.registeredVoters = 1000;
        sub.quorumRequired = 50;
        sub.winningOption = 0;

        vm.prank(submitter);
        vm.expectRevert(VoteVerifier.EmptyOptions.selector);
        verifier.submitVoteResult(sub, new bytes32[](0));
    }

    function test_revert_zeroVoters() public {
        VoteVerifier.VoteSubmission memory sub = _validSubmission();
        sub.registeredVoters = 0;

        vm.prank(submitter);
        vm.expectRevert(VoteVerifier.ZeroRegisteredVoters.selector);
        verifier.submitVoteResult(sub, new bytes32[](0));
    }

    function test_tiedVote_firstOptionWins() public {
        uint256[] memory opts = new uint256[](2);
        opts[0] = 500; opts[1] = 500; // tied

        VoteVerifier.VoteSubmission memory sub = VoteVerifier.VoteSubmission({
            proposalId: PROPOSAL_ID,
            optionVotes: opts,
            totalVotesCast: 1000,
            registeredVoters: 5000,
            quorumRequired: 500,
            winningOption: 0 // first option declared winner in tie
        });
        _setRootAndSubmit(sub);

        (,, uint8 winner,) = verifier.getVoteResult(PROPOSAL_ID);
        assertEq(winner, 0);
    }
}
