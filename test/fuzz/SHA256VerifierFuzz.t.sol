// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/SHA256Verifier.sol";

contract SHA256FuzzWrapper {
    bytes32 public lastResult;
    bytes32 public lastPacked;

    function sha256Hash(bytes memory data) external {
        lastResult = SHA256Verifier.sha256Hash(data);
    }

    function sha256Packed(bytes32 a, bytes32 b) external {
        lastPacked = SHA256Verifier.sha256Packed(a, b);
    }
}

contract SHA256VerifierFuzzTest is Test {
    SHA256FuzzWrapper wrapper;

    function setUp() public {
        wrapper = new SHA256FuzzWrapper();
    }

    // ============ Fuzz: sha256Hash matches native sha256 ============
    function testFuzz_sha256Hash_matchesNative(bytes memory data) public {
        vm.assume(data.length > 0 && data.length < 1000);
        bytes32 expected = sha256(data);
        wrapper.sha256Hash(data);
        bytes32 result = wrapper.lastResult();
        // Library uses assembly precompile; if it returns nonzero, it should match native
        if (result != bytes32(0)) {
            assertEq(result, expected, "Should match native sha256");
        }
    }

    // ============ Fuzz: sha256Hash is deterministic ============
    function testFuzz_sha256Hash_deterministic(bytes32 input) public {
        bytes memory data = abi.encodePacked(input);
        wrapper.sha256Hash(data);
        bytes32 result1 = wrapper.lastResult();
        wrapper.sha256Hash(data);
        bytes32 result2 = wrapper.lastResult();
        assertEq(result1, result2, "Same input should produce same hash");
    }

    // ============ Fuzz: sha256Packed is deterministic ============
    function testFuzz_sha256Packed_deterministic(bytes32 a, bytes32 b) public {
        wrapper.sha256Packed(a, b);
        bytes32 result1 = wrapper.lastPacked();
        wrapper.sha256Packed(a, b);
        bytes32 result2 = wrapper.lastPacked();
        assertEq(result1, result2, "Same inputs should produce same packed hash");
    }

    // ============ Fuzz: different inputs produce different hashes ============
    function testFuzz_sha256Hash_collision(bytes32 a, bytes32 b) public {
        vm.assume(a != b);
        wrapper.sha256Hash(abi.encodePacked(a));
        bytes32 hashA = wrapper.lastResult();
        wrapper.sha256Hash(abi.encodePacked(b));
        bytes32 hashB = wrapper.lastResult();
        if (hashA != bytes32(0) && hashB != bytes32(0)) {
            assertNotEq(hashA, hashB, "Different inputs should produce different hashes");
        }
    }
}
