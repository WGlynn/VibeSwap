// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeZKVerifier.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VibeZKVerifierTest is Test {
    // ============ Events ============

    event VerificationKeyRegistered(bytes32 indexed keyId, string circuit, VibeZKVerifier.ProofSystem proofSystem);
    event ProofVerified(bytes32 indexed proofHash, bytes32 indexed keyId, bool valid);
    event CircuitAuthorized(string circuit);

    // ============ State ============

    VibeZKVerifier public verifier;

    address public owner;
    address public alice;

    bytes constant MOCK_VK_DATA    = hex"deadbeef01020304";
    bytes constant MOCK_PROOF      = hex"cafebabe0a0b0c0d";
    bytes32[] public publicInputs;

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");

        VibeZKVerifier impl = new VibeZKVerifier();
        bytes memory initData = abi.encodeCall(VibeZKVerifier.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        verifier = VibeZKVerifier(address(proxy));

        // Re-own to our owner address
        // Note: initialize() uses msg.sender as owner — the proxy deployer (this test contract)
        // Transfer ownership to our `owner` address
        verifier.transferOwnership(owner);

        // Default public inputs
        publicInputs.push(bytes32(uint256(1)));
        publicInputs.push(bytes32(uint256(2)));
    }

    // ============ Helpers ============

    /// @dev Register a Groth16 key and return keyId
    function _registerKey(
        string memory circuit,
        VibeZKVerifier.ProofSystem proofSystem
    ) internal returns (bytes32 keyId) {
        vm.prank(owner);
        keyId = verifier.registerVerificationKey(circuit, proofSystem, MOCK_VK_DATA);
    }

    function _registerGroth16() internal returns (bytes32) {
        return _registerKey("private_transfer", VibeZKVerifier.ProofSystem.GROTH16);
    }

    // ============ Key Registration ============

    function test_registerVerificationKey_groth16() public {
        vm.expectEmit(false, false, false, true);
        emit VerificationKeyRegistered(bytes32(0), "private_transfer", VibeZKVerifier.ProofSystem.GROTH16);

        bytes32 keyId = _registerGroth16();

        (
            bytes32 id,
            string memory circuit,
            VibeZKVerifier.ProofSystem ps,
            ,
            bool active,
            uint256 count,
            uint256 registeredAt
        ) = verifier.verificationKeys(keyId);

        assertEq(id, keyId);
        assertEq(circuit, "private_transfer");
        assertEq(uint8(ps), uint8(VibeZKVerifier.ProofSystem.GROTH16));
        assertTrue(active);
        assertEq(count, 0);
        assertGt(registeredAt, 0);
    }

    function test_registerVerificationKey_plonk() public {
        bytes32 keyId = _registerKey("private_vote", VibeZKVerifier.ProofSystem.PLONK);

        (, , VibeZKVerifier.ProofSystem ps, , , , ) = verifier.verificationKeys(keyId);
        assertEq(uint8(ps), uint8(VibeZKVerifier.ProofSystem.PLONK));
    }

    function test_registerVerificationKey_stark() public {
        bytes32 keyId = _registerKey("private_balance", VibeZKVerifier.ProofSystem.STARK);

        (, , VibeZKVerifier.ProofSystem ps, , , , ) = verifier.verificationKeys(keyId);
        assertEq(uint8(ps), uint8(VibeZKVerifier.ProofSystem.STARK));
    }

    function test_registerVerificationKey_authorisesCircuit() public {
        assertFalse(verifier.isCircuitAuthorized("private_transfer"));
        _registerGroth16();
        assertTrue(verifier.isCircuitAuthorized("private_transfer"));
    }

    function test_registerVerificationKey_appendsToKeyList() public {
        assertEq(verifier.getKeyCount(), 0);
        _registerGroth16();
        assertEq(verifier.getKeyCount(), 1);
        _registerKey("private_vote", VibeZKVerifier.ProofSystem.PLONK);
        assertEq(verifier.getKeyCount(), 2);
    }

    function test_registerVerificationKey_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        verifier.registerVerificationKey("circuit", VibeZKVerifier.ProofSystem.GROTH16, MOCK_VK_DATA);
    }

    // ============ Proof Verification ============

    function test_verifyProof_groth16_countsVerification() public {
        bytes32 keyId = _registerGroth16();

        vm.prank(alice);
        bool valid = verifier.verifyProof(keyId, MOCK_PROOF, publicInputs);

        (uint256 total, uint256 validCount, uint256 invalidCount) = verifier.getVerificationStats();
        assertEq(total, 1);
        if (valid) {
            assertEq(validCount, 1);
            assertEq(invalidCount, 0);
        } else {
            assertEq(validCount, 0);
            assertEq(invalidCount, 1);
        }

        (, , , , , uint256 count, ) = verifier.verificationKeys(keyId);
        assertEq(count, 1);
    }

    function test_verifyProof_emitsEvent() public {
        bytes32 keyId = _registerGroth16();
        bytes32 proofHash = keccak256(abi.encodePacked(keyId, MOCK_PROOF, publicInputs));

        vm.expectEmit(true, true, false, false);
        emit ProofVerified(proofHash, keyId, false); // result doesn't matter for emit check

        vm.prank(alice);
        verifier.verifyProof(keyId, MOCK_PROOF, publicInputs);
    }

    function test_verifyProof_usesCache() public {
        bytes32 keyId = _registerGroth16();

        vm.prank(alice);
        bool firstResult = verifier.verifyProof(keyId, MOCK_PROOF, publicInputs);

        // Second call with same inputs — should hit cache, not increment count again
        vm.prank(alice);
        bool secondResult = verifier.verifyProof(keyId, MOCK_PROOF, publicInputs);

        assertEq(firstResult, secondResult);

        (uint256 total, , ) = verifier.getVerificationStats();
        assertEq(total, 1); // only counted once (cache hit on second)

        (, , , , , uint256 count, ) = verifier.verificationKeys(keyId);
        assertEq(count, 1); // verificationCount only incremented once
    }

    function test_verifyProof_revertsInactiveKey() public {
        bytes32 nonExistentKey = keccak256("does-not-exist");

        vm.prank(alice);
        vm.expectRevert("Key not active");
        verifier.verifyProof(nonExistentKey, MOCK_PROOF, publicInputs);
    }

    function test_verifyProof_differentInputsProduceDifferentResults() public {
        bytes32 keyId = _registerGroth16();

        bytes32[] memory inputs1 = new bytes32[](1);
        inputs1[0] = bytes32(uint256(0xAA));

        bytes32[] memory inputs2 = new bytes32[](1);
        inputs2[0] = bytes32(uint256(0xBB));

        vm.prank(alice);
        verifier.verifyProof(keyId, MOCK_PROOF, inputs1);

        vm.prank(alice);
        verifier.verifyProof(keyId, MOCK_PROOF, inputs2);

        // Both calls should register — different proof hashes so no cache collision
        (uint256 total, , ) = verifier.getVerificationStats();
        assertEq(total, 2);
    }

    // ============ Batch Verification ============

    function test_batchVerify_lengthMismatchReverts() public {
        bytes32 keyId = _registerGroth16();

        bytes32[] memory keyIds = new bytes32[](2);
        keyIds[0] = keyId;
        keyIds[1] = keyId;

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = MOCK_PROOF;

        bytes32[][] memory inputs = new bytes32[][](2);
        inputs[0] = publicInputs;
        inputs[1] = publicInputs;

        vm.expectRevert("Length mismatch");
        verifier.batchVerify(keyIds, proofs, inputs);
    }

    function test_batchVerify_twoProofs() public {
        bytes32 keyId1 = _registerKey("circuit_a", VibeZKVerifier.ProofSystem.GROTH16);
        bytes32 keyId2 = _registerKey("circuit_b", VibeZKVerifier.ProofSystem.PLONK);

        bytes32[] memory keyIds = new bytes32[](2);
        keyIds[0] = keyId1;
        keyIds[1] = keyId2;

        bytes[] memory proofs = new bytes[](2);
        proofs[0] = MOCK_PROOF;
        proofs[1] = hex"aabbccdd";

        bytes32[][] memory inputs = new bytes32[][](2);
        inputs[0] = publicInputs;
        bytes32[] memory inputs2 = new bytes32[](1);
        inputs2[0] = bytes32(uint256(0xFF));
        inputs[1] = inputs2;

        bool[] memory results = verifier.batchVerify(keyIds, proofs, inputs);
        assertEq(results.length, 2);

        (uint256 total, , ) = verifier.getVerificationStats();
        assertEq(total, 2);
    }

    function test_batchVerify_usesCache() public {
        bytes32 keyId = _registerGroth16();

        // First verify individually to populate cache
        vm.prank(alice);
        verifier.verifyProof(keyId, MOCK_PROOF, publicInputs);

        // Batch verify with same proof — should hit cache
        bytes32[] memory keyIds = new bytes32[](1);
        keyIds[0] = keyId;

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = MOCK_PROOF;

        bytes32[][] memory allInputs = new bytes32[][](1);
        allInputs[0] = publicInputs;

        bool[] memory results = verifier.batchVerify(keyIds, proofs, allInputs);
        assertEq(results.length, 1);

        // Total should still be 1 (second call was cache hit)
        (uint256 total, , ) = verifier.getVerificationStats();
        assertEq(total, 1);
    }

    function test_batchVerify_emptyArray() public {
        bytes32[] memory keyIds  = new bytes32[](0);
        bytes[]   memory proofs  = new bytes[](0);
        bytes32[][] memory inputs = new bytes32[][](0);

        bool[] memory results = verifier.batchVerify(keyIds, proofs, inputs);
        assertEq(results.length, 0);

        (uint256 total, , ) = verifier.getVerificationStats();
        assertEq(total, 0);
    }

    // ============ Stats ============

    function test_verificationStats_cumulativeAcrossProofSystems() public {
        bytes32 g16  = _registerKey("groth16_circuit",  VibeZKVerifier.ProofSystem.GROTH16);
        bytes32 plonk = _registerKey("plonk_circuit",   VibeZKVerifier.ProofSystem.PLONK);
        bytes32 stark = _registerKey("stark_circuit",   VibeZKVerifier.ProofSystem.STARK);

        // Verify one with each system
        vm.startPrank(alice);
        verifier.verifyProof(g16,   MOCK_PROOF, publicInputs);
        verifier.verifyProof(plonk, hex"1122334455667788", publicInputs);
        verifier.verifyProof(stark, hex"aabbccddeeff0011", publicInputs);
        vm.stopPrank();

        (uint256 total, uint256 valid_, uint256 invalid_) = verifier.getVerificationStats();
        assertEq(total, 3);
        assertEq(valid_ + invalid_, 3);
    }

    // ============ Fuzz Tests ============

    function testFuzz_verifyProof_deterministicResult(bytes calldata proofData) public {
        vm.assume(proofData.length > 0 && proofData.length <= 512);
        bytes32 keyId = _registerGroth16();

        vm.prank(alice);
        bool r1 = verifier.verifyProof(keyId, proofData, publicInputs);

        // Same call again — must return same result from cache
        vm.prank(alice);
        bool r2 = verifier.verifyProof(keyId, proofData, publicInputs);

        assertEq(r1, r2);

        // Only 1 actual verification performed (second is cache)
        (uint256 total, , ) = verifier.getVerificationStats();
        assertEq(total, 1);
    }
}
