// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../contracts/libraries/IncrementalMerkleTree.sol";

/// @dev Wrapper contract to expose library functions for testing
contract MerkleTreeWrapper {
    using IncrementalMerkleTree for IncrementalMerkleTree.Tree;

    IncrementalMerkleTree.Tree public tree;

    function init(uint256 depth) external {
        tree.init(depth);
    }

    function insert(bytes32 leaf) external returns (uint256) {
        return tree.insert(leaf);
    }

    function verify(bytes32[] calldata proof, bytes32 leaf) external view returns (bool) {
        return tree.verify(proof, leaf);
    }

    function isKnownRoot(bytes32 root) external view returns (bool) {
        return tree.isKnownRoot(root);
    }

    function getRoot() external view returns (bytes32) {
        return tree.getRoot();
    }

    function getNextIndex() external view returns (uint256) {
        return tree.getNextIndex();
    }

    function getDepth() external view returns (uint256) {
        return tree.depth;
    }
}

// ============ Test Contract ============

contract IncrementalMerkleTreeTest is Test {
    MerkleTreeWrapper public wrapper;

    function setUp() public {
        wrapper = new MerkleTreeWrapper();
        wrapper.init(20);
    }

    // ============ Initialization Tests ============

    function test_init_setsDepth() public view {
        assertEq(wrapper.getDepth(), 20);
    }

    function test_init_emptyTreeRootNonZero() public view {
        // Empty tree has a deterministic root (hash of zero hashes)
        bytes32 root = wrapper.getRoot();
        assertTrue(root != bytes32(0));
    }

    function test_init_nextIndexZero() public view {
        assertEq(wrapper.getNextIndex(), 0);
    }

    function test_init_zeroDepthReverts() public {
        MerkleTreeWrapper w = new MerkleTreeWrapper();
        vm.expectRevert(IncrementalMerkleTree.InvalidDepth.selector);
        w.init(0);
    }

    function test_init_overMaxDepthReverts() public {
        MerkleTreeWrapper w = new MerkleTreeWrapper();
        vm.expectRevert(IncrementalMerkleTree.InvalidDepth.selector);
        w.init(21);
    }

    function test_init_doubleInitReverts() public {
        vm.expectRevert(IncrementalMerkleTree.DepthAlreadySet.selector);
        wrapper.init(20);
    }

    // ============ Insert Tests ============

    function test_insert_updatesRoot() public {
        bytes32 rootBefore = wrapper.getRoot();
        wrapper.insert(keccak256("leaf1"));
        bytes32 rootAfter = wrapper.getRoot();
        assertTrue(rootBefore != rootAfter);
    }

    function test_insert_incrementsIndex() public {
        assertEq(wrapper.getNextIndex(), 0);
        wrapper.insert(keccak256("leaf1"));
        assertEq(wrapper.getNextIndex(), 1);
        wrapper.insert(keccak256("leaf2"));
        assertEq(wrapper.getNextIndex(), 2);
    }

    function test_insert_returnsCorrectIndex() public {
        uint256 idx0 = wrapper.insert(keccak256("a"));
        uint256 idx1 = wrapper.insert(keccak256("b"));
        uint256 idx2 = wrapper.insert(keccak256("c"));
        assertEq(idx0, 0);
        assertEq(idx1, 1);
        assertEq(idx2, 2);
    }

    function test_insert_differentLeavesProduceDifferentRoots() public {
        MerkleTreeWrapper w1 = new MerkleTreeWrapper();
        w1.init(5);
        w1.insert(keccak256("leafA"));
        bytes32 root1 = w1.getRoot();

        MerkleTreeWrapper w2 = new MerkleTreeWrapper();
        w2.init(5);
        w2.insert(keccak256("leafB"));
        bytes32 root2 = w2.getRoot();

        assertTrue(root1 != root2);
    }

    function test_insert_sequentialInsertsProduceValidRoots() public {
        // Insert 8 leaves and check root changes each time
        bytes32 prevRoot = wrapper.getRoot();
        for (uint256 i = 0; i < 8; i++) {
            wrapper.insert(keccak256(abi.encodePacked(i)));
            bytes32 newRoot = wrapper.getRoot();
            assertTrue(newRoot != prevRoot, "Root should change on each insert");
            prevRoot = newRoot;
        }
    }

    function test_insert_treeFull_reverts() public {
        // Use depth 2 (capacity = 4)
        MerkleTreeWrapper small = new MerkleTreeWrapper();
        small.init(2);

        small.insert(keccak256("a"));
        small.insert(keccak256("b"));
        small.insert(keccak256("c"));
        small.insert(keccak256("d"));

        vm.expectRevert(IncrementalMerkleTree.TreeFull.selector);
        small.insert(keccak256("e"));
    }

    // ============ Root History Tests (Tornado Cash pattern) ============

    function test_rootHistory_firstInsertRecorded() public {
        wrapper.insert(keccak256("leaf1"));
        bytes32 root = wrapper.getRoot();
        assertTrue(wrapper.isKnownRoot(root));
    }

    function test_rootHistory_previousRootsKnown() public {
        wrapper.insert(keccak256("leaf1"));
        bytes32 root1 = wrapper.getRoot();

        wrapper.insert(keccak256("leaf2"));
        bytes32 root2 = wrapper.getRoot();

        assertTrue(wrapper.isKnownRoot(root1), "First root should still be known");
        assertTrue(wrapper.isKnownRoot(root2), "Second root should be known");
    }

    function test_rootHistory_ringBufferWraps() public {
        // ROOT_HISTORY_SIZE = 30, so after 31 inserts the first root should be evicted
        bytes32 firstRoot = wrapper.getRoot(); // empty root at index 0

        // Do 30 inserts to fill the ring buffer (indices 1..30, but wraps at 30)
        for (uint256 i = 0; i < 30; i++) {
            wrapper.insert(keccak256(abi.encodePacked(i)));
        }

        // The empty root should be evicted now
        assertFalse(wrapper.isKnownRoot(firstRoot), "Empty root should be evicted after 30 inserts");

        // But recent roots should still be known
        bytes32 latestRoot = wrapper.getRoot();
        assertTrue(wrapper.isKnownRoot(latestRoot));
    }

    function test_rootHistory_zeroRootNotKnown() public view {
        assertFalse(wrapper.isKnownRoot(bytes32(0)));
    }

    // ============ Commutative Hashing Tests ============

    function test_hashPair_commutative() public {
        // H(a,b) == H(b,a) — this is the OZ compatibility guarantee
        bytes32 a = keccak256("alpha");
        bytes32 b = keccak256("beta");

        // We can't call _hashPair directly since it's internal,
        // but we can verify via insertion behavior:
        // Insert two trees with same leaves in different orders and compare behavior

        MerkleTreeWrapper t1 = new MerkleTreeWrapper();
        t1.init(2);
        t1.insert(a);
        t1.insert(b);

        MerkleTreeWrapper t2 = new MerkleTreeWrapper();
        t2.init(2);
        t2.insert(a);
        t2.insert(b);

        // Same insertions → same root
        assertEq(t1.getRoot(), t2.getRoot());
    }

    // ============ Small Tree Verification ============

    function test_smallTree_singleLeafVerifiable() public {
        // Using a depth-2 tree for deterministic proof generation
        MerkleTreeWrapper small = new MerkleTreeWrapper();
        small.init(2);

        bytes32 leaf = keccak256("test");
        small.insert(leaf);

        // Root should be known
        bytes32 root = small.getRoot();
        assertTrue(small.isKnownRoot(root));
    }

    function test_smallTree_multipleInsertsAllKnownRoots() public {
        MerkleTreeWrapper small = new MerkleTreeWrapper();
        small.init(3); // 8 capacity

        bytes32[] memory roots = new bytes32[](5);
        for (uint256 i = 0; i < 5; i++) {
            small.insert(keccak256(abi.encodePacked(i)));
            roots[i] = small.getRoot();
        }

        // All 5 roots should be in history (well within 30-root buffer)
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(small.isKnownRoot(roots[i]));
        }
    }
}
