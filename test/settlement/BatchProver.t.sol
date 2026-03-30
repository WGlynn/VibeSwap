// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/BatchProver.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Mock verifier that always returns true
contract MockVerifierValid is IBatchVerifier {
    function verifyBatchProof(bytes calldata, bytes memory) external pure returns (bool) {
        return true;
    }
    function verifyAggregateProof(bytes calldata, bytes memory) external pure returns (bool) {
        return true;
    }
}

/// @dev Mock verifier that always returns false
contract MockVerifierInvalid is IBatchVerifier {
    function verifyBatchProof(bytes calldata, bytes memory) external pure returns (bool) {
        return false;
    }
    function verifyAggregateProof(bytes calldata, bytes memory) external pure returns (bool) {
        return false;
    }
}

contract BatchProverTest is Test {
    BatchProver public prover;
    MockVerifierValid public validVerifier;
    MockVerifierInvalid public invalidVerifier;

    address public owner;
    address public alice;
    address public bob;
    address public endpoint;

    uint64 public constant CHALLENGE_WINDOW = 1 hours;
    uint256 public constant CHALLENGE_BOND = 0.1 ether;

    // ============ Events (re-declared for vm.expectEmit) ============

    event BatchProven(uint64 indexed batchId, address indexed prover, bytes32 proofHash, uint256 clearingPrice, uint256 orderCount);
    event AggregateProven(uint64[] batchIds, address indexed prover, bytes32 proofHash, uint256 batchCount);
    event BatchFinalized(uint64 indexed batchId, address indexed prover);
    event BatchChallenged(uint64 indexed batchId, address indexed challenger, bytes32 counterProofHash);
    event ChallengeResolved(uint64 indexed batchId, bool challengeSucceeded, address indexed winner);
    event CrossChainProofReceived(uint32 indexed srcChainId, uint64 indexed batchId, bytes32 proofHash);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        endpoint = makeAddr("lzEndpoint");

        validVerifier = new MockVerifierValid();
        invalidVerifier = new MockVerifierInvalid();

        // Deploy with UUPS proxy
        BatchProver impl = new BatchProver();
        bytes memory initData = abi.encodeWithSelector(
            BatchProver.initialize.selector, owner, CHALLENGE_WINDOW, CHALLENGE_BOND
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        prover = BatchProver(payable(address(proxy)));

        // Set LZ endpoint
        prover.setLzEndpoint(endpoint);

        // Fund test actors
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ============ Helpers ============

    function _defaultInputs(uint64 batchId) internal pure returns (BatchProver.PublicInputs memory) {
        return BatchProver.PublicInputs({
            batchId: batchId,
            clearingPrice: 1000,
            orderCount: 50,
            shuffleSeed: keccak256("seed"),
            matchedOrdersRoot: keccak256("orders")
        });
    }

    function _defaultProof() internal pure returns (bytes memory) {
        return abi.encodePacked(keccak256("valid_proof_data"));
    }

    function _submitDefaultProof(address submitter, uint64 batchId) internal {
        vm.prank(submitter);
        prover.submitBatchProof(batchId, _defaultProof(), _defaultInputs(batchId));
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(prover.owner(), owner);
    }

    function test_initialize_setsChallengeWindow() public view {
        assertEq(prover.challengeWindow(), CHALLENGE_WINDOW);
    }

    function test_initialize_setsChallengeBond() public view {
        assertEq(prover.challengeBond(), CHALLENGE_BOND);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        prover.initialize(owner, CHALLENGE_WINDOW, CHALLENGE_BOND);
    }

    // ============ Single Batch Proof Submission ============

    function test_submitBatchProof_succeeds() public {
        uint64 batchId = 1;
        bytes memory proof = _defaultProof();
        BatchProver.PublicInputs memory inputs = _defaultInputs(batchId);

        vm.expectEmit(true, true, false, true);
        emit BatchProven(batchId, alice, keccak256(proof), inputs.clearingPrice, inputs.orderCount);

        vm.prank(alice);
        prover.submitBatchProof(batchId, proof, inputs);

        assertEq(uint8(prover.getBatchProofStatus(batchId)), uint8(BatchProver.ProofStatus.Proven));
        assertEq(prover.totalBatchesProven(), 1);
    }

    function test_submitBatchProof_storesData() public {
        _submitDefaultProof(alice, 1);

        (bytes32 proofHash, address proverAddr, uint64 provenAt, BatchProver.ProofStatus status) =
            prover.getBatchProofData(1);

        assertEq(proofHash, keccak256(_defaultProof()));
        assertEq(proverAddr, alice);
        assertEq(provenAt, uint64(block.timestamp));
        assertEq(uint8(status), uint8(BatchProver.ProofStatus.Proven));
    }

    function test_submitBatchProof_revert_zeroBatchId() public {
        vm.prank(alice);
        vm.expectRevert(BatchProver.ZeroBatchId.selector);
        prover.submitBatchProof(0, _defaultProof(), _defaultInputs(0));
    }

    function test_submitBatchProof_revert_alreadyProven() public {
        _submitDefaultProof(alice, 1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BatchProver.BatchAlreadyProven.selector, uint64(1)));
        prover.submitBatchProof(1, _defaultProof(), _defaultInputs(1));
    }

    function test_submitBatchProof_revert_alreadyFinalized() public {
        _submitDefaultProof(alice, 1);
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        prover.finalizeBatch(1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BatchProver.BatchAlreadyFinalized.selector, uint64(1)));
        prover.submitBatchProof(1, _defaultProof(), _defaultInputs(1));
    }

    function test_submitBatchProof_revert_mismatchedBatchId() public {
        BatchProver.PublicInputs memory inputs = _defaultInputs(99);

        vm.prank(alice);
        vm.expectRevert(BatchProver.InvalidPublicInputs.selector);
        prover.submitBatchProof(1, _defaultProof(), inputs);
    }

    function test_submitBatchProof_revert_zeroClearingPrice() public {
        BatchProver.PublicInputs memory inputs = _defaultInputs(1);
        inputs.clearingPrice = 0;

        vm.prank(alice);
        vm.expectRevert(BatchProver.InvalidPublicInputs.selector);
        prover.submitBatchProof(1, _defaultProof(), inputs);
    }

    function test_submitBatchProof_revert_invalidProofWithVerifier() public {
        prover.setVerifierContract(address(invalidVerifier));

        vm.prank(alice);
        vm.expectRevert(BatchProver.InvalidProof.selector);
        prover.submitBatchProof(1, _defaultProof(), _defaultInputs(1));
    }

    function test_submitBatchProof_succeedsWithValidVerifier() public {
        prover.setVerifierContract(address(validVerifier));

        vm.prank(alice);
        prover.submitBatchProof(1, _defaultProof(), _defaultInputs(1));

        assertEq(uint8(prover.getBatchProofStatus(1)), uint8(BatchProver.ProofStatus.Proven));
    }

    // ============ Aggregate Proof Submission ============

    function test_submitAggregateProof_succeeds() public {
        uint64[] memory batchIds = new uint64[](3);
        batchIds[0] = 1;
        batchIds[1] = 2;
        batchIds[2] = 3;

        BatchProver.PublicInputs[] memory inputs = new BatchProver.PublicInputs[](3);
        inputs[0] = _defaultInputs(1);
        inputs[1] = _defaultInputs(2);
        inputs[2] = _defaultInputs(3);

        bytes memory proof = _defaultProof();

        vm.expectEmit(false, true, false, true);
        emit AggregateProven(batchIds, alice, keccak256(proof), 3);

        vm.prank(alice);
        prover.submitAggregateProof(batchIds, proof, inputs);

        assertEq(uint8(prover.getBatchProofStatus(1)), uint8(BatchProver.ProofStatus.Proven));
        assertEq(uint8(prover.getBatchProofStatus(2)), uint8(BatchProver.ProofStatus.Proven));
        assertEq(uint8(prover.getBatchProofStatus(3)), uint8(BatchProver.ProofStatus.Proven));
        assertEq(prover.totalBatchesProven(), 3);
    }

    function test_submitAggregateProof_revert_emptyBatchIds() public {
        uint64[] memory batchIds = new uint64[](0);
        BatchProver.PublicInputs[] memory inputs = new BatchProver.PublicInputs[](0);

        vm.prank(alice);
        vm.expectRevert(BatchProver.EmptyBatchIds.selector);
        prover.submitAggregateProof(batchIds, _defaultProof(), inputs);
    }

    function test_submitAggregateProof_revert_lengthMismatch() public {
        uint64[] memory batchIds = new uint64[](2);
        batchIds[0] = 1;
        batchIds[1] = 2;

        BatchProver.PublicInputs[] memory inputs = new BatchProver.PublicInputs[](1);
        inputs[0] = _defaultInputs(1);

        vm.prank(alice);
        vm.expectRevert(BatchProver.InvalidPublicInputs.selector);
        prover.submitAggregateProof(batchIds, _defaultProof(), inputs);
    }

    function test_submitAggregateProof_revert_duplicateWithExisting() public {
        // Prove batch 1 individually first
        _submitDefaultProof(alice, 1);

        uint64[] memory batchIds = new uint64[](2);
        batchIds[0] = 1; // already proven
        batchIds[1] = 2;

        BatchProver.PublicInputs[] memory inputs = new BatchProver.PublicInputs[](2);
        inputs[0] = _defaultInputs(1);
        inputs[1] = _defaultInputs(2);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BatchProver.BatchAlreadyProven.selector, uint64(1)));
        prover.submitAggregateProof(batchIds, _defaultProof(), inputs);
    }

    // ============ Finalization ============

    function test_finalizeBatch_succeeds() public {
        _submitDefaultProof(alice, 1);

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);

        vm.expectEmit(true, true, false, false);
        emit BatchFinalized(1, alice);

        prover.finalizeBatch(1);

        assertEq(uint8(prover.getBatchProofStatus(1)), uint8(BatchProver.ProofStatus.Finalized));
        assertTrue(prover.isBatchFinalized(1));
        assertEq(prover.totalBatchesFinalized(), 1);
    }

    function test_finalizeBatch_revert_notProven() public {
        vm.expectRevert(abi.encodeWithSelector(BatchProver.BatchNotProven.selector, uint64(99)));
        prover.finalizeBatch(99);
    }

    function test_finalizeBatch_revert_challengeWindowActive() public {
        _submitDefaultProof(alice, 1);

        vm.warp(block.timestamp + CHALLENGE_WINDOW - 1);

        vm.expectRevert(abi.encodeWithSelector(BatchProver.ChallengeWindowActive.selector, uint64(1)));
        prover.finalizeBatch(1);
    }

    function test_finalizeBatch_atExactWindowBoundary() public {
        _submitDefaultProof(alice, 1);

        // At exactly provenAt + challengeWindow: block.timestamp < provenAt + challengeWindow is false
        vm.warp(block.timestamp + CHALLENGE_WINDOW);

        prover.finalizeBatch(1);
        assertTrue(prover.isBatchFinalized(1));
    }

    function test_finalizeBatch_anyoneCanCall() public {
        _submitDefaultProof(alice, 1);
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);

        vm.prank(bob);
        prover.finalizeBatch(1);
        assertTrue(prover.isBatchFinalized(1));
    }

    // ============ Challenge Mechanism ============

    function test_challengeProof_succeeds() public {
        _submitDefaultProof(alice, 1);

        bytes memory counterProof = abi.encodePacked(keccak256("counter_proof"));

        vm.expectEmit(true, true, false, true);
        emit BatchChallenged(1, bob, keccak256(counterProof));

        vm.prank(bob);
        prover.challengeProof{value: CHALLENGE_BOND}(1, counterProof);

        assertEq(uint8(prover.getBatchProofStatus(1)), uint8(BatchProver.ProofStatus.Challenged));
    }

    function test_challengeProof_revert_notProven() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BatchProver.BatchNotProven.selector, uint64(99)));
        prover.challengeProof{value: CHALLENGE_BOND}(99, _defaultProof());
    }

    function test_challengeProof_revert_windowExpired() public {
        _submitDefaultProof(alice, 1);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BatchProver.ChallengeWindowExpired.selector, uint64(1)));
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());
    }

    function test_challengeProof_revert_insufficientBond() public {
        _submitDefaultProof(alice, 1);

        vm.prank(bob);
        vm.expectRevert(BatchProver.InsufficientBond.selector);
        prover.challengeProof{value: CHALLENGE_BOND - 1}(1, _defaultProof());
    }

    function test_challengeProof_revert_alreadyChallenged() public {
        _submitDefaultProof(alice, 1);

        vm.prank(bob);
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BatchProver.BatchNotProven.selector, uint64(1)));
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());
    }

    function test_resolveChallenge_challengeSucceeds() public {
        _submitDefaultProof(alice, 1);

        vm.prank(bob);
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());

        uint256 bobBalBefore = bob.balance;

        vm.expectEmit(true, false, true, true);
        emit ChallengeResolved(1, true, bob);

        prover.resolveChallenge(1, true);

        // Proof invalidated
        assertEq(uint8(prover.getBatchProofStatus(1)), uint8(BatchProver.ProofStatus.Unproven));
        // Bond returned to challenger
        assertEq(bob.balance, bobBalBefore + CHALLENGE_BOND);
    }

    function test_resolveChallenge_challengeFails() public {
        _submitDefaultProof(alice, 1);

        vm.prank(bob);
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());

        uint256 aliceBalBefore = alice.balance;

        vm.expectEmit(true, false, true, true);
        emit ChallengeResolved(1, false, alice);

        prover.resolveChallenge(1, false);

        // Proof restored to Proven
        assertEq(uint8(prover.getBatchProofStatus(1)), uint8(BatchProver.ProofStatus.Proven));
        // Bond goes to original prover
        assertEq(alice.balance, aliceBalBefore + CHALLENGE_BOND);
    }

    function test_resolveChallenge_revert_nonOwner() public {
        _submitDefaultProof(alice, 1);

        vm.prank(bob);
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());

        vm.prank(bob);
        vm.expectRevert();
        prover.resolveChallenge(1, true);
    }

    function test_resolveChallenge_revert_noChallengeExists() public {
        _submitDefaultProof(alice, 1);

        vm.expectRevert(abi.encodeWithSelector(BatchProver.ChallengeNotFound.selector, uint64(1)));
        prover.resolveChallenge(1, true);
    }

    function test_finalizeBatch_revert_unresolvedChallenge() public {
        _submitDefaultProof(alice, 1);

        vm.prank(bob);
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());

        // Resolve back to Proven, but it's Challenged so finalize won't work
        // Actually, the status is Challenged, so finalizeBatch reverts with BatchNotProven
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);

        vm.expectRevert(abi.encodeWithSelector(BatchProver.BatchNotProven.selector, uint64(1)));
        prover.finalizeBatch(1);
    }

    // ============ Cross-Chain Proof Receipt ============

    function test_receiveCrossChainProof_succeeds() public {
        uint32 srcChainId = 30101; // Ethereum mainnet EID
        uint64 batchId = 42;
        bytes32 proofHash = keccak256("remote_proof");

        vm.expectEmit(true, true, false, true);
        emit CrossChainProofReceived(srcChainId, batchId, proofHash);

        vm.prank(endpoint);
        prover.receiveCrossChainProof(srcChainId, batchId, proofHash);

        assertEq(uint8(prover.getBatchProofStatus(batchId)), uint8(BatchProver.ProofStatus.Proven));
        assertEq(prover.totalBatchesProven(), 1);
    }

    function test_receiveCrossChainProof_revert_notEndpoint() public {
        vm.prank(alice);
        vm.expectRevert(BatchProver.NotEndpoint.selector);
        prover.receiveCrossChainProof(30101, 1, keccak256("proof"));
    }

    function test_receiveCrossChainProof_revert_zeroBatchId() public {
        vm.prank(endpoint);
        vm.expectRevert(BatchProver.ZeroBatchId.selector);
        prover.receiveCrossChainProof(30101, 0, keccak256("proof"));
    }

    // ============ Access Control ============

    function test_setVerifierContract_onlyOwner() public {
        vm.expectEmit(true, true, false, false);
        emit VerifierUpdated(address(0), address(validVerifier));

        prover.setVerifierContract(address(validVerifier));

        assertEq(address(prover.verifier()), address(validVerifier));
    }

    function test_setVerifierContract_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        prover.setVerifierContract(address(validVerifier));
    }

    function test_setVerifierContract_revert_zeroAddress() public {
        vm.expectRevert(BatchProver.InvalidVerifierAddress.selector);
        prover.setVerifierContract(address(0));
    }

    function test_setChallengeWindow_onlyOwner() public {
        prover.setChallengeWindow(2 hours);
        assertEq(prover.challengeWindow(), 2 hours);
    }

    function test_setChallengeWindow_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        prover.setChallengeWindow(2 hours);
    }

    function test_setChallengeBond_onlyOwner() public {
        prover.setChallengeBond(0.5 ether);
        assertEq(prover.challengeBond(), 0.5 ether);
    }

    // ============ View Functions ============

    function test_getBatchProofStatus_defaultUnproven() public view {
        assertEq(uint8(prover.getBatchProofStatus(999)), uint8(BatchProver.ProofStatus.Unproven));
    }

    function test_isBatchFinalized_falseByDefault() public view {
        assertFalse(prover.isBatchFinalized(999));
    }

    function test_getBatchPublicInputs_returnsCorrectData() public {
        _submitDefaultProof(alice, 1);

        BatchProver.PublicInputs memory inputs = prover.getBatchPublicInputs(1);
        assertEq(inputs.batchId, 1);
        assertEq(inputs.clearingPrice, 1000);
        assertEq(inputs.orderCount, 50);
        assertEq(inputs.shuffleSeed, keccak256("seed"));
        assertEq(inputs.matchedOrdersRoot, keccak256("orders"));
    }

    // ============ Edge Cases ============

    function test_multipleBatches_independent() public {
        _submitDefaultProof(alice, 1);
        _submitDefaultProof(bob, 2);

        (,address p1,,) = prover.getBatchProofData(1);
        (,address p2,,) = prover.getBatchProofData(2);
        assertEq(p1, alice);
        assertEq(p2, bob);
        assertEq(prover.totalBatchesProven(), 2);
    }

    function test_challengeResolvedThenFinalize() public {
        _submitDefaultProof(alice, 1);

        // Challenge
        vm.prank(bob);
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());

        // Resolve: challenge fails, proof restored
        prover.resolveChallenge(1, false);

        // Now finalize after new challenge window
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        prover.finalizeBatch(1);

        assertTrue(prover.isBatchFinalized(1));
    }

    function test_proofAfterSuccessfulChallenge() public {
        _submitDefaultProof(alice, 1);

        // Challenge succeeds
        vm.prank(bob);
        prover.challengeProof{value: CHALLENGE_BOND}(1, _defaultProof());
        prover.resolveChallenge(1, true);

        // Batch is now Unproven, can be re-proven
        assertEq(uint8(prover.getBatchProofStatus(1)), uint8(BatchProver.ProofStatus.Unproven));

        // Re-submit proof for same batch
        vm.prank(bob);
        prover.submitBatchProof(1, _defaultProof(), _defaultInputs(1));
        assertEq(uint8(prover.getBatchProofStatus(1)), uint8(BatchProver.ProofStatus.Proven));
    }

    // ============ Fuzz Tests ============

    function testFuzz_submitBatchProof_validBatchId(uint64 batchId) public {
        vm.assume(batchId > 0);

        vm.prank(alice);
        prover.submitBatchProof(batchId, _defaultProof(), _defaultInputs(batchId));

        assertEq(uint8(prover.getBatchProofStatus(batchId)), uint8(BatchProver.ProofStatus.Proven));
    }

    function testFuzz_finalizeBatch_afterWindow(uint64 warpSeconds) public {
        vm.assume(warpSeconds > CHALLENGE_WINDOW);
        vm.assume(warpSeconds < 365 days);

        _submitDefaultProof(alice, 1);
        vm.warp(block.timestamp + warpSeconds);

        prover.finalizeBatch(1);
        assertTrue(prover.isBatchFinalized(1));
    }
}
