// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/IncrementalMerkleTree.sol";

contract MerkleTreeFuzzWrapper {
    using IncrementalMerkleTree for IncrementalMerkleTree.Tree;
    IncrementalMerkleTree.Tree public tree;

    function init(uint256 depth) external { tree.init(depth); }
    function insert(bytes32 leaf) external returns (uint256) { return tree.insert(leaf); }
    function getRoot() external view returns (bytes32) { return tree.getRoot(); }
    function getNextIndex() external view returns (uint256) { return tree.getNextIndex(); }
    function isKnownRoot(bytes32 root) external view returns (bool) { return tree.isKnownRoot(root); }
}

contract IncrementalMerkleTreeFuzzTest is Test {
    MerkleTreeFuzzWrapper wrapper;

    function setUp() public {
        wrapper = new MerkleTreeFuzzWrapper();
        wrapper.init(10); // depth 10 = 1024 capacity
    }

    // ============ Fuzz: root changes with each unique leaf ============
    function testFuzz_rootChangesOnInsert(bytes32 leaf) public {
        vm.assume(leaf != bytes32(0)); // zero leaf edge case handled separately
        bytes32 rootBefore = wrapper.getRoot();
        wrapper.insert(leaf);
        bytes32 rootAfter = wrapper.getRoot();
        assertNotEq(rootBefore, rootAfter, "Root should change after insert");
    }

    // ============ Fuzz: insert is deterministic ============
    function testFuzz_insert_deterministic(bytes32 leaf1, bytes32 leaf2) public {
        // Create two identical trees
        MerkleTreeFuzzWrapper w1 = new MerkleTreeFuzzWrapper();
        MerkleTreeFuzzWrapper w2 = new MerkleTreeFuzzWrapper();
        w1.init(10);
        w2.init(10);

        w1.insert(leaf1);
        w1.insert(leaf2);
        w2.insert(leaf1);
        w2.insert(leaf2);

        assertEq(w1.getRoot(), w2.getRoot(), "Same leaves should produce same root");
    }

    // ============ Fuzz: nextIndex increments monotonically ============
    function testFuzz_nextIndex_monotonic(bytes32 leaf) public {
        uint256 idxBefore = wrapper.getNextIndex();
        wrapper.insert(leaf);
        assertEq(wrapper.getNextIndex(), idxBefore + 1, "Index should increment by 1");
    }

    // ============ Fuzz: current root is always a known root ============
    function testFuzz_currentRoot_isKnown(bytes32 leaf) public {
        wrapper.insert(leaf);
        bytes32 root = wrapper.getRoot();
        assertTrue(wrapper.isKnownRoot(root), "Current root should be known");
    }

    // Note: IncrementalMerkleTree uses commutative hashing (_hashPair sorts inputs)
    // so swapping the first two leaves produces the same root. This is by design
    // for MerkleProof.verify() compatibility.

    // ============ Fuzz: inserting 3+ leaves in different order produces different roots ============
    function testFuzz_orderMatters_threeLeaves(bytes32 leaf1, bytes32 leaf2, bytes32 leaf3) public {
        vm.assume(leaf1 != leaf2 && leaf2 != leaf3 && leaf1 != leaf3);

        MerkleTreeFuzzWrapper w1 = new MerkleTreeFuzzWrapper();
        MerkleTreeFuzzWrapper w2 = new MerkleTreeFuzzWrapper();
        w1.init(10);
        w2.init(10);

        w1.insert(leaf1);
        w1.insert(leaf2);
        w1.insert(leaf3);
        w2.insert(leaf3);
        w2.insert(leaf1);
        w2.insert(leaf2);

        // With 3 leaves in different order, roots should differ
        // (commutative hash only affects sibling pairs, not cross-level ordering)
        assertNotEq(w1.getRoot(), w2.getRoot(), "Different order of 3 leaves should produce different root");
    }

    // ============ Fuzz: insert returns sequential indices ============
    function testFuzz_insert_returnsIndex(bytes32 leaf1, bytes32 leaf2, bytes32 leaf3) public {
        uint256 idx1 = wrapper.insert(leaf1);
        uint256 idx2 = wrapper.insert(leaf2);
        uint256 idx3 = wrapper.insert(leaf3);
        assertEq(idx1, 0);
        assertEq(idx2, 1);
        assertEq(idx3, 2);
    }
}
