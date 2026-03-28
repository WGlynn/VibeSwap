// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/VerifierCheckpointBridge.sol";
import "../../contracts/settlement/VerifiedCompute.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Contracts ============

/// @notice Mock VibeStateChain that records checkpoint calls
contract MockStateChain is IVibeStateChain {
    struct CheckpointCall {
        bytes32 source;
        bytes32 decisionHash;
        uint256 roundId;
    }

    CheckpointCall[] public calls;

    function checkpoint(bytes32 source, bytes32 decisionHash, uint256 roundId) external override {
        calls.push(CheckpointCall(source, decisionHash, roundId));
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }
}

/// @notice Mock Verifier (concrete VerifiedCompute) that can return arbitrary result states
contract MockVerifier is VerifiedCompute {
    mapping(bytes32 => bytes32) public expectedRoots;

    function initialize(uint256 _disputeWindow, uint256 _bondAmount) external initializer {
        __VerifiedCompute_init(_disputeWindow, _bondAmount);
    }

    /// @dev Directly set result status for testing the bridge
    function setResultDirect(
        bytes32 computeId,
        bytes32 resultHash,
        address _submitter,
        uint256 _timestamp,
        ResultStatus _status
    ) external {
        results[computeId] = ComputeResult({
            resultHash: resultHash,
            submitter: _submitter,
            timestamp: _timestamp,
            status: _status
        });
    }

    function _getExpectedRoot(bytes32 computeId) internal view override returns (bytes32) {
        return expectedRoots[computeId];
    }

    function _validateDispute(bytes32, bytes calldata) internal pure override returns (bool) {
        return false;
    }
}

contract VerifierCheckpointBridgeTest is Test {
    VerifierCheckpointBridge public bridge;
    MockStateChain public stateChain;
    MockVerifier public verifier1;
    MockVerifier public verifier2;

    address public owner;
    address public alice;
    address public bob;

    bytes32 public constant SOURCE_SHAPLEY = keccak256("ShapleyVerifier");
    bytes32 public constant SOURCE_TRUST = keccak256("TrustScoreVerifier");

    bytes32 public constant COMPUTE_ID_1 = keccak256("compute-1");
    bytes32 public constant COMPUTE_ID_2 = keccak256("compute-2");
    bytes32 public constant COMPUTE_ID_3 = keccak256("compute-3");
    bytes32 public constant RESULT_HASH_1 = keccak256("result-1");
    bytes32 public constant RESULT_HASH_2 = keccak256("result-2");
    bytes32 public constant RESULT_HASH_3 = keccak256("result-3");

    event VerifierRegistered(address indexed verifier, bytes32 indexed source);
    event ResultCheckpointed(bytes32 indexed computeId, bytes32 indexed source, bytes32 resultHash);

    function setUp() public {
        // Warp forward so block.timestamp - 2 hours doesn't underflow
        vm.warp(block.timestamp + 1 days);

        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy mock state chain
        stateChain = new MockStateChain();

        // Deploy bridge with proxy
        VerifierCheckpointBridge impl = new VerifierCheckpointBridge();
        bytes memory initData = abi.encodeWithSelector(
            VerifierCheckpointBridge.initialize.selector, address(stateChain)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        bridge = VerifierCheckpointBridge(address(proxy));

        // Deploy mock verifiers (no proxy needed for mocks)
        verifier1 = new MockVerifier();
        verifier1.initialize(1 hours, 0.01 ether);

        verifier2 = new MockVerifier();
        verifier2.initialize(1 hours, 0.01 ether);

        // Register verifiers
        bridge.registerVerifier(address(verifier1), SOURCE_SHAPLEY);
        bridge.registerVerifier(address(verifier2), SOURCE_TRUST);
    }

    // ============ Helpers ============

    function _setFinalized(MockVerifier v, bytes32 computeId, bytes32 resultHash) internal {
        v.setResultDirect(
            computeId,
            resultHash,
            makeAddr("submitter"),
            block.timestamp - 2 hours,
            VerifiedCompute.ResultStatus.Finalized
        );
    }

    function _setPending(MockVerifier v, bytes32 computeId, bytes32 resultHash) internal {
        v.setResultDirect(
            computeId,
            resultHash,
            makeAddr("submitter"),
            block.timestamp,
            VerifiedCompute.ResultStatus.Pending
        );
    }

    // ============ Initialization ============

    function test_init_setsOwner() public view {
        assertEq(bridge.owner(), owner);
    }

    function test_init_setsStateChain() public view {
        assertEq(address(bridge.stateChain()), address(stateChain));
    }

    function test_init_totalCheckpointedStartsZero() public view {
        assertEq(bridge.totalCheckpointed(), 0);
    }

    function test_init_cannotReinitialize() public {
        vm.expectRevert();
        bridge.initialize(address(stateChain));
    }

    // ============ Source Constants ============

    function test_sourceConstants() public view {
        assertEq(bridge.SOURCE_SHAPLEY(), keccak256("ShapleyVerifier"));
        assertEq(bridge.SOURCE_TRUST(), keccak256("TrustScoreVerifier"));
        assertEq(bridge.SOURCE_VOTE(), keccak256("VoteVerifier"));
        assertEq(bridge.SOURCE_BATCH_PRICE(), keccak256("BatchPriceVerifier"));
    }

    // ============ Registration (Admin) ============

    function test_registerVerifier_succeeds() public {
        address newVerifier = makeAddr("new-verifier");
        bytes32 source = keccak256("NewVerifier");

        vm.expectEmit(true, true, false, false);
        emit VerifierRegistered(newVerifier, source);

        bridge.registerVerifier(newVerifier, source);

        assertEq(bridge.verifierSource(newVerifier), source);
    }

    function test_registerVerifier_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        bridge.registerVerifier(makeAddr("v"), keccak256("X"));
    }

    function test_registerVerifier_canOverwrite() public {
        address v = makeAddr("v");
        bridge.registerVerifier(v, keccak256("A"));
        bridge.registerVerifier(v, keccak256("B"));

        assertEq(bridge.verifierSource(v), keccak256("B"));
    }

    function test_registerVerifier_canUnregisterBySettingZero() public {
        bridge.registerVerifier(address(verifier1), bytes32(0));

        assertEq(bridge.verifierSource(address(verifier1)), bytes32(0));
    }

    // ============ Set State Chain (Admin) ============

    function test_setStateChain_succeeds() public {
        MockStateChain newChain = new MockStateChain();
        bridge.setStateChain(address(newChain));
        assertEq(address(bridge.stateChain()), address(newChain));
    }

    function test_setStateChain_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        bridge.setStateChain(makeAddr("chain"));
    }

    // ============ Checkpoint Single Result ============

    function test_checkpointResult_succeeds() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);

        vm.expectEmit(true, true, false, true);
        emit ResultCheckpointed(COMPUTE_ID_1, SOURCE_SHAPLEY, RESULT_HASH_1);

        vm.prank(alice); // Permissionless
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);

        assertTrue(bridge.isCheckpointed(COMPUTE_ID_1));
        assertEq(bridge.totalCheckpointed(), 1);

        // Verify state chain received the call
        assertEq(stateChain.callCount(), 1);
        (bytes32 src, bytes32 hash, uint256 roundId) = stateChain.calls(0);
        assertEq(src, SOURCE_SHAPLEY);
        assertEq(hash, RESULT_HASH_1);
        assertEq(roundId, 1);
    }

    function test_checkpointResult_permissionless() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);

        // Random address can checkpoint — Grade A DISSOLVED
        vm.prank(bob);
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);

        assertTrue(bridge.isCheckpointed(COMPUTE_ID_1));
    }

    function test_checkpointResult_incrementsCounter() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);
        _setFinalized(verifier2, COMPUTE_ID_2, RESULT_HASH_2);

        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
        assertEq(bridge.totalCheckpointed(), 1);

        bridge.checkpointResult(address(verifier2), COMPUTE_ID_2);
        assertEq(bridge.totalCheckpointed(), 2);
    }

    function test_checkpointResult_revert_stateChainNotSet() public {
        // Set state chain to zero address
        bridge.setStateChain(address(0));
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);

        vm.expectRevert(VerifierCheckpointBridge.StateChainNotSet.selector);
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
    }

    function test_checkpointResult_revert_unregisteredVerifier() public {
        address unregistered = makeAddr("unregistered");

        vm.expectRevert(
            abi.encodeWithSelector(VerifierCheckpointBridge.VerifierNotRegistered.selector, unregistered)
        );
        bridge.checkpointResult(unregistered, COMPUTE_ID_1);
    }

    function test_checkpointResult_revert_alreadyCheckpointed() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);

        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);

        vm.expectRevert(
            abi.encodeWithSelector(VerifierCheckpointBridge.AlreadyCheckpointed.selector, COMPUTE_ID_1)
        );
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
    }

    function test_checkpointResult_revert_resultNotFinalized_pending() public {
        _setPending(verifier1, COMPUTE_ID_1, RESULT_HASH_1);

        vm.expectRevert(
            abi.encodeWithSelector(VerifierCheckpointBridge.ResultNotFinalized.selector, COMPUTE_ID_1)
        );
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
    }

    function test_checkpointResult_revert_resultNotFinalized_none() public {
        // No result submitted at all
        vm.expectRevert(
            abi.encodeWithSelector(VerifierCheckpointBridge.ResultNotFinalized.selector, COMPUTE_ID_1)
        );
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
    }

    function test_checkpointResult_revert_resultNotFinalized_disputed() public {
        verifier1.setResultDirect(
            COMPUTE_ID_1,
            RESULT_HASH_1,
            makeAddr("submitter"),
            block.timestamp - 2 hours,
            VerifiedCompute.ResultStatus.Disputed
        );

        vm.expectRevert(
            abi.encodeWithSelector(VerifierCheckpointBridge.ResultNotFinalized.selector, COMPUTE_ID_1)
        );
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
    }

    function test_checkpointResult_revert_deregisteredVerifier() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);

        // Deregister verifier by setting source to zero
        bridge.registerVerifier(address(verifier1), bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(VerifierCheckpointBridge.VerifierNotRegistered.selector, address(verifier1))
        );
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
    }

    // ============ Batch Checkpoint ============

    function test_checkpointBatch_succeeds() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);
        _setFinalized(verifier2, COMPUTE_ID_2, RESULT_HASH_2);

        address[] memory verifiers = new address[](2);
        verifiers[0] = address(verifier1);
        verifiers[1] = address(verifier2);

        bytes32[] memory computeIds = new bytes32[](2);
        computeIds[0] = COMPUTE_ID_1;
        computeIds[1] = COMPUTE_ID_2;

        bridge.checkpointBatch(verifiers, computeIds);

        assertTrue(bridge.isCheckpointed(COMPUTE_ID_1));
        assertTrue(bridge.isCheckpointed(COMPUTE_ID_2));
        assertEq(bridge.totalCheckpointed(), 2);
        assertEq(stateChain.callCount(), 2);
    }

    function test_checkpointBatch_skipsUnregistered() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);

        address unregistered = makeAddr("unregistered");

        address[] memory verifiers = new address[](2);
        verifiers[0] = address(verifier1);
        verifiers[1] = unregistered;

        bytes32[] memory computeIds = new bytes32[](2);
        computeIds[0] = COMPUTE_ID_1;
        computeIds[1] = COMPUTE_ID_2;

        bridge.checkpointBatch(verifiers, computeIds);

        assertTrue(bridge.isCheckpointed(COMPUTE_ID_1));
        assertFalse(bridge.isCheckpointed(COMPUTE_ID_2));
        assertEq(bridge.totalCheckpointed(), 1);
    }

    function test_checkpointBatch_skipsAlreadyCheckpointed() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);
        _setFinalized(verifier2, COMPUTE_ID_2, RESULT_HASH_2);

        // Checkpoint one first
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);

        address[] memory verifiers = new address[](2);
        verifiers[0] = address(verifier1);
        verifiers[1] = address(verifier2);

        bytes32[] memory computeIds = new bytes32[](2);
        computeIds[0] = COMPUTE_ID_1;
        computeIds[1] = COMPUTE_ID_2;

        bridge.checkpointBatch(verifiers, computeIds);

        assertEq(bridge.totalCheckpointed(), 2); // Only incremented once more
        assertEq(stateChain.callCount(), 2); // 1 from single + 1 from batch
    }

    function test_checkpointBatch_skipsNonFinalized() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);
        _setPending(verifier2, COMPUTE_ID_2, RESULT_HASH_2);

        address[] memory verifiers = new address[](2);
        verifiers[0] = address(verifier1);
        verifiers[1] = address(verifier2);

        bytes32[] memory computeIds = new bytes32[](2);
        computeIds[0] = COMPUTE_ID_1;
        computeIds[1] = COMPUTE_ID_2;

        bridge.checkpointBatch(verifiers, computeIds);

        assertTrue(bridge.isCheckpointed(COMPUTE_ID_1));
        assertFalse(bridge.isCheckpointed(COMPUTE_ID_2));
        assertEq(bridge.totalCheckpointed(), 1);
    }

    function test_checkpointBatch_emptyArrays() public {
        address[] memory verifiers = new address[](0);
        bytes32[] memory computeIds = new bytes32[](0);

        bridge.checkpointBatch(verifiers, computeIds);

        assertEq(bridge.totalCheckpointed(), 0);
    }

    function test_checkpointBatch_revert_lengthMismatch() public {
        address[] memory verifiers = new address[](2);
        bytes32[] memory computeIds = new bytes32[](1);

        vm.expectRevert("Length mismatch");
        bridge.checkpointBatch(verifiers, computeIds);
    }

    function test_checkpointBatch_revert_stateChainNotSet() public {
        bridge.setStateChain(address(0));

        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);

        address[] memory verifiers = new address[](1);
        verifiers[0] = address(verifier1);

        bytes32[] memory computeIds = new bytes32[](1);
        computeIds[0] = COMPUTE_ID_1;

        vm.expectRevert(VerifierCheckpointBridge.StateChainNotSet.selector);
        bridge.checkpointBatch(verifiers, computeIds);
    }

    // ============ Cross-Verifier Checkpointing ============

    function test_crossVerifier_sameComputeIdDifferentVerifiers() public {
        // Same computeId on two different verifiers — both checkpoint the same computeId key
        // but the second one will be blocked by AlreadyCheckpointed
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);
        _setFinalized(verifier2, COMPUTE_ID_1, RESULT_HASH_2);

        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);

        vm.expectRevert(
            abi.encodeWithSelector(VerifierCheckpointBridge.AlreadyCheckpointed.selector, COMPUTE_ID_1)
        );
        bridge.checkpointResult(address(verifier2), COMPUTE_ID_1);
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        bridge.upgradeToAndCall(address(0xdead), "");
    }

    function test_upgrade_revert_notContract() public {
        vm.expectRevert("Not a contract");
        bridge.upgradeToAndCall(makeAddr("eoa"), "");
    }

    // ============ View Functions ============

    function test_isCheckpointed_default() public view {
        assertFalse(bridge.isCheckpointed(keccak256("nonexistent")));
    }

    function test_verifierSource_default() public {
        assertEq(bridge.verifierSource(makeAddr("unregistered")), bytes32(0));
    }

    // ============ State Chain Integration ============

    function test_stateChain_receivesCorrectRoundIds() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);
        _setFinalized(verifier1, COMPUTE_ID_2, RESULT_HASH_2);
        _setFinalized(verifier2, COMPUTE_ID_3, RESULT_HASH_3);

        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
        bridge.checkpointResult(address(verifier1), COMPUTE_ID_2);
        bridge.checkpointResult(address(verifier2), COMPUTE_ID_3);

        // Round IDs should be sequential (totalCheckpointed at time of call)
        (, , uint256 roundId1) = stateChain.calls(0);
        (, , uint256 roundId2) = stateChain.calls(1);
        (, , uint256 roundId3) = stateChain.calls(2);

        assertEq(roundId1, 1);
        assertEq(roundId2, 2);
        assertEq(roundId3, 3);
    }

    function test_stateChain_receivesCorrectSources() public {
        _setFinalized(verifier1, COMPUTE_ID_1, RESULT_HASH_1);
        _setFinalized(verifier2, COMPUTE_ID_2, RESULT_HASH_2);

        bridge.checkpointResult(address(verifier1), COMPUTE_ID_1);
        bridge.checkpointResult(address(verifier2), COMPUTE_ID_2);

        (bytes32 src1, , ) = stateChain.calls(0);
        (bytes32 src2, , ) = stateChain.calls(1);

        assertEq(src1, SOURCE_SHAPLEY);
        assertEq(src2, SOURCE_TRUST);
    }

    // ============ Fuzz Tests ============

    function testFuzz_checkpointResult_arbitraryComputeId(bytes32 computeId) public {
        vm.assume(computeId != bytes32(0));

        _setFinalized(verifier1, computeId, keccak256(abi.encode(computeId)));

        bridge.checkpointResult(address(verifier1), computeId);

        assertTrue(bridge.isCheckpointed(computeId));
    }

    function testFuzz_batchCheckpoint_variableLength(uint8 count) public {
        vm.assume(count > 0 && count <= 20);

        address[] memory verifiers = new address[](count);
        bytes32[] memory computeIds = new bytes32[](count);

        for (uint8 i = 0; i < count; i++) {
            bytes32 cid = keccak256(abi.encode("batch", i));
            bytes32 rh = keccak256(abi.encode("result", i));
            _setFinalized(verifier1, cid, rh);
            verifiers[i] = address(verifier1);
            computeIds[i] = cid;
        }

        bridge.checkpointBatch(verifiers, computeIds);

        assertEq(bridge.totalCheckpointed(), count);
    }
}
