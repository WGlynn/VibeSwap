// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/TrustScoreVerifier.sol";
import "../../contracts/settlement/VerifiedCompute.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract TrustScoreVerifierTest is Test {
    TrustScoreVerifier public verifier;

    address public owner;
    address public submitter;
    address public alice;
    address public bob;
    address public charlie;

    bytes32 public constant EPOCH_ID = keccak256("trust-epoch-1");
    uint256 public constant DISPUTE_WINDOW = 1 hours;
    uint256 public constant BOND_AMOUNT = 0.01 ether;
    uint64 public constant EPOCH_NUM = 42;

    function setUp() public {
        owner = address(this);
        submitter = makeAddr("submitter");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        TrustScoreVerifier impl = new TrustScoreVerifier();
        bytes memory initData = abi.encodeWithSelector(
            TrustScoreVerifier.initialize.selector, DISPUTE_WINDOW, BOND_AMOUNT
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        verifier = TrustScoreVerifier(payable(address(proxy)));

        vm.deal(submitter, 1 ether);
        vm.prank(submitter);
        verifier.bond{value: BOND_AMOUNT}();
    }

    // ============ Helpers ============

    function _validParticipants() internal view returns (address[] memory) {
        address[] memory p = new address[](3);
        p[0] = alice; p[1] = bob; p[2] = charlie;
        return p;
    }

    function _validScores() internal pure returns (uint256[] memory) {
        uint256[] memory s = new uint256[](3);
        s[0] = 5000; s[1] = 3000; s[2] = 2000;
        return s;
    }

    function _setRootAndSubmit(
        bytes32 epochId,
        address[] memory participants,
        uint256[] memory scores,
        uint256 totalScore,
        uint64 epoch
    ) internal {
        bytes32 resultHash = keccak256(abi.encode(epochId, participants, scores, totalScore, epoch));
        verifier.setExpectedRoot(epochId, resultHash);
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(submitter);
        verifier.submitTrustResult(epochId, participants, scores, totalScore, epoch, proof);
    }

    // ============ Valid Submission ============

    function test_submitTrustResult_valid() public {
        _setRootAndSubmit(EPOCH_ID, _validParticipants(), _validScores(), 10000, EPOCH_NUM);

        (address[] memory p, uint256[] memory s, uint256 total, uint64 epoch, VerifiedCompute.ResultStatus status)
            = verifier.getTrustResult(EPOCH_ID);
        assertEq(p.length, 3);
        assertEq(s[0], 5000);
        assertEq(total, 10000);
        assertEq(epoch, EPOCH_NUM);
        assertTrue(status == VerifiedCompute.ResultStatus.Pending);
    }

    // ============ Invariant 1: Bounded ============

    function test_revert_scoreExceedsBound() public {
        address[] memory p = _validParticipants();
        uint256[] memory s = new uint256[](3);
        s[0] = 10001; s[1] = 3000; s[2] = 2000; // 10001 > MAX_SCORE

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(TrustScoreVerifier.ScoreExceedsBound.selector, 10001, 10000));
        verifier.submitTrustResult(EPOCH_ID, p, s, 15001, EPOCH_NUM, new bytes32[](0));
    }

    // ============ Invariant 2: Normalized ============

    function test_revert_totalScoreMismatch() public {
        address[] memory p = _validParticipants();
        uint256[] memory s = _validScores(); // sum = 10000

        bytes32 resultHash = keccak256(abi.encode(EPOCH_ID, p, s, uint256(9000), EPOCH_NUM));
        verifier.setExpectedRoot(EPOCH_ID, resultHash);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(TrustScoreVerifier.TotalScoreMismatch.selector, 10000, 9000));
        verifier.submitTrustResult(EPOCH_ID, p, s, 9000, EPOCH_NUM, proof);
    }

    // ============ Invariant 3: Non-zero ============

    function test_revert_zeroScore() public {
        address[] memory p = _validParticipants();
        uint256[] memory s = new uint256[](3);
        s[0] = 5000; s[1] = 5000; s[2] = 0; // zero score for charlie

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(TrustScoreVerifier.ZeroScoreViolation.selector, charlie));
        verifier.submitTrustResult(EPOCH_ID, p, s, 10000, EPOCH_NUM, new bytes32[](0));
    }

    // ============ Finalization ============

    function test_finalize_updatesLatestEpoch() public {
        _setRootAndSubmit(EPOCH_ID, _validParticipants(), _validScores(), 10000, EPOCH_NUM);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeTrustResult(EPOCH_ID);

        assertEq(verifier.latestFinalizedEpoch(), EPOCH_ID);
        assertTrue(verifier.isFinalized(EPOCH_ID));
    }

    // ============ Consumer Interface ============

    function test_getVerifiedScores_afterFinalization() public {
        _setRootAndSubmit(EPOCH_ID, _validParticipants(), _validScores(), 10000, EPOCH_NUM);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeTrustResult(EPOCH_ID);

        (address[] memory p, uint256[] memory s) = verifier.getVerifiedScores(EPOCH_ID);
        assertEq(p[0], alice);
        assertEq(s[0], 5000);
        assertEq(verifier.getVerifiedTotalScore(EPOCH_ID), 10000);
        assertEq(verifier.getVerifiedEpoch(EPOCH_ID), EPOCH_NUM);
    }

    function test_revert_getVerifiedScores_notFinalized() public {
        _setRootAndSubmit(EPOCH_ID, _validParticipants(), _validScores(), 10000, EPOCH_NUM);

        vm.expectRevert(TrustScoreVerifier.EpochNotFinalized.selector);
        verifier.getVerifiedScores(EPOCH_ID);
    }

    // ============ Pure Verification ============

    function test_verifyTrustInvariants_valid() public view {
        assertTrue(verifier.verifyTrustInvariants(3, _validScores(), 10000));
    }

    function test_verifyTrustInvariants_exceedsBound() public view {
        uint256[] memory s = new uint256[](2);
        s[0] = 10001; s[1] = 1000;
        assertFalse(verifier.verifyTrustInvariants(2, s, 11001));
    }

    function test_verifyTrustInvariants_sumMismatch() public view {
        uint256[] memory s = _validScores();
        assertFalse(verifier.verifyTrustInvariants(3, s, 9000)); // actual sum 10000
    }

    function test_verifyTrustInvariants_zeroScore() public view {
        uint256[] memory s = new uint256[](2);
        s[0] = 1000; s[1] = 0;
        assertFalse(verifier.verifyTrustInvariants(2, s, 1000));
    }

    // ============ Edge Cases ============

    function test_revert_emptyParticipants() public {
        vm.prank(submitter);
        vm.expectRevert(TrustScoreVerifier.EmptyParticipants.selector);
        verifier.submitTrustResult(EPOCH_ID, new address[](0), new uint256[](0), 0, EPOCH_NUM, new bytes32[](0));
    }

    function test_revert_duplicateSubmission() public {
        _setRootAndSubmit(EPOCH_ID, _validParticipants(), _validScores(), 10000, EPOCH_NUM);

        vm.prank(submitter);
        vm.expectRevert(TrustScoreVerifier.EpochAlreadySubmitted.selector);
        verifier.submitTrustResult(EPOCH_ID, _validParticipants(), _validScores(), 10000, EPOCH_NUM, new bytes32[](0));
    }
}
