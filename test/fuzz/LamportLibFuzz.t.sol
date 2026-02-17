// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/quantum/LamportLib.sol";

contract LamportLibFuzzHarness {
    function getBit(bytes32 data, uint256 index) external pure returns (uint256) {
        return LamportLib.getBit(data, index);
    }

    function hashMessage(bytes memory message) external pure returns (bytes32) {
        return LamportLib.hashMessage(message);
    }

    function hashStructuredMessage(bytes32 domainSep, bytes memory data) external pure returns (bytes32) {
        return LamportLib.hashStructuredMessage(domainSep, data);
    }

    function hashPublicKey(LamportLib.PublicKey memory pk) external pure returns (bytes32) {
        return LamportLib.hashPublicKey(pk);
    }
}

contract LamportLibFuzzTest is Test {
    LamportLibFuzzHarness public h;

    function setUp() public {
        h = new LamportLibFuzzHarness();
    }

    /// @notice getBit always returns 0 or 1
    function testFuzz_getBitBounded(bytes32 data, uint256 index) public view {
        index = bound(index, 0, 255);
        uint256 bit = h.getBit(data, index);
        assertTrue(bit == 0 || bit == 1);
    }

    /// @notice hashMessage is deterministic
    function testFuzz_hashMessageDeterministic(bytes memory message) public view {
        bytes32 hash1 = h.hashMessage(message);
        bytes32 hash2 = h.hashMessage(message);
        assertEq(hash1, hash2);
    }

    /// @notice hashStructuredMessage is deterministic
    function testFuzz_hashStructuredMessageDeterministic(bytes32 domainSep, bytes memory data) public view {
        bytes32 hash1 = h.hashStructuredMessage(domainSep, data);
        bytes32 hash2 = h.hashStructuredMessage(domainSep, data);
        assertEq(hash1, hash2);
    }

    /// @notice Different domain separators produce different hashes
    function testFuzz_differentDomainSepDifferentHash(bytes32 domainSep1, bytes32 domainSep2) public view {
        vm.assume(domainSep1 != domainSep2);
        bytes memory data = "test";
        bytes32 hash1 = h.hashStructuredMessage(domainSep1, data);
        bytes32 hash2 = h.hashStructuredMessage(domainSep2, data);
        assertTrue(hash1 != hash2);
    }

    /// @notice hashPublicKey is deterministic
    function testFuzz_hashPublicKeyDeterministic(bytes32 seed) public view {
        LamportLib.PublicKey memory pk;
        // Fill with deterministic data from seed
        for (uint256 i = 0; i < 256; i++) {
            pk.hashes[i][0] = keccak256(abi.encodePacked(seed, i, uint256(0)));
            pk.hashes[i][1] = keccak256(abi.encodePacked(seed, i, uint256(1)));
        }
        bytes32 hash1 = h.hashPublicKey(pk);
        bytes32 hash2 = h.hashPublicKey(pk);
        assertEq(hash1, hash2);
    }
}
