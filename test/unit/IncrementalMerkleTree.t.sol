// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/IncrementalMerkleTree.sol";

// Wrapper contract (library uses storage, so we need a contract)
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

    function isKnownRoot(bytes32 _root) external view returns (bool) {
        return tree.isKnownRoot(_root);
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

contract IncrementalMerkleTreeTest is Test {
    MerkleTreeWrapper wrapper;

    function setUp() public {
        wrapper = new MerkleTreeWrapper();
    }

    // ============ Initialization ============

    function test_init_setsDepth() public {
        wrapper.init(10);
        assertEq(wrapper.getDepth(), 10);
    }

    function test_init_emptyRoot() public {
        wrapper.init(5);
        bytes32 root = wrapper.getRoot();
        assertNotEq(root, bytes32(0));
    }

    function test_init_nextIndexZero() public {
        wrapper.init(5);
        assertEq(wrapper.getNextIndex(), 0);
    }

    function test_init_revertsZeroDepth() public {
        vm.expectRevert(IncrementalMerkleTree.InvalidDepth.selector);
        wrapper.init(0);
    }

    function test_init_revertsExceedsMaxDepth() public {
        vm.expectRevert(IncrementalMerkleTree.InvalidDepth.selector);
        wrapper.init(21);
    }

    function test_init_maxDepth() public {
        wrapper.init(20);
        assertEq(wrapper.getDepth(), 20);
    }

    function test_init_revertsDoubleInit() public {
        wrapper.init(5);
        vm.expectRevert(IncrementalMerkleTree.DepthAlreadySet.selector);
        wrapper.init(5);
    }

    // ============ Insert ============

    function test_insert_incrementsIndex() public {
        wrapper.init(5);
        uint256 idx = wrapper.insert(keccak256("leaf0"));
        assertEq(idx, 0);
        assertEq(wrapper.getNextIndex(), 1);

        idx = wrapper.insert(keccak256("leaf1"));
        assertEq(idx, 1);
        assertEq(wrapper.getNextIndex(), 2);
    }

    function test_insert_changesRoot() public {
        wrapper.init(5);
        bytes32 emptyRoot = wrapper.getRoot();

        wrapper.insert(keccak256("leaf0"));
        bytes32 root1 = wrapper.getRoot();
        assertNotEq(root1, emptyRoot);

        wrapper.insert(keccak256("leaf1"));
        bytes32 root2 = wrapper.getRoot();
        assertNotEq(root2, root1);
    }

    function test_insert_deterministic() public {
        // Two trees with same inserts should have same root
        MerkleTreeWrapper w1 = new MerkleTreeWrapper();
        MerkleTreeWrapper w2 = new MerkleTreeWrapper();

        w1.init(5);
        w2.init(5);

        bytes32 leaf1 = keccak256("a");
        bytes32 leaf2 = keccak256("b");

        w1.insert(leaf1);
        w1.insert(leaf2);

        w2.insert(leaf1);
        w2.insert(leaf2);

        assertEq(w1.getRoot(), w2.getRoot());
    }

    function test_insert_differentLeaves_differentRoots() public {
        MerkleTreeWrapper w1 = new MerkleTreeWrapper();
        MerkleTreeWrapper w2 = new MerkleTreeWrapper();

        w1.init(5);
        w2.init(5);

        w1.insert(keccak256("a"));
        w2.insert(keccak256("b"));

        assertNotEq(w1.getRoot(), w2.getRoot());
    }

    function test_insert_treeFull_depth1() public {
        wrapper.init(1); // capacity = 2^1 = 2
        wrapper.insert(keccak256("leaf0"));
        wrapper.insert(keccak256("leaf1"));

        vm.expectRevert(IncrementalMerkleTree.TreeFull.selector);
        wrapper.insert(keccak256("leaf2"));
    }

    function test_insert_treeFull_depth2() public {
        wrapper.init(2); // capacity = 2^2 = 4
        wrapper.insert(keccak256("leaf0"));
        wrapper.insert(keccak256("leaf1"));
        wrapper.insert(keccak256("leaf2"));
        wrapper.insert(keccak256("leaf3"));

        vm.expectRevert(IncrementalMerkleTree.TreeFull.selector);
        wrapper.insert(keccak256("leaf4"));
    }

    // ============ isKnownRoot ============

    function test_isKnownRoot_currentRoot() public {
        wrapper.init(5);
        bytes32 root = wrapper.getRoot();
        assertTrue(wrapper.isKnownRoot(root));
    }

    function test_isKnownRoot_previousRoot() public {
        wrapper.init(5);
        bytes32 emptyRoot = wrapper.getRoot();

        wrapper.insert(keccak256("leaf0"));
        bytes32 root1 = wrapper.getRoot();

        // Both should be known
        assertTrue(wrapper.isKnownRoot(emptyRoot));
        assertTrue(wrapper.isKnownRoot(root1));
    }

    function test_isKnownRoot_zeroNotKnown() public {
        wrapper.init(5);
        assertFalse(wrapper.isKnownRoot(bytes32(0)));
    }

    function test_isKnownRoot_randomNotKnown() public {
        wrapper.init(5);
        assertFalse(wrapper.isKnownRoot(keccak256("random")));
    }

    function test_isKnownRoot_ringBuffer_oldRootsEvicted() public {
        wrapper.init(5);
        // ROOT_HISTORY_SIZE = 30, so after 30+ inserts, oldest roots should be evicted
        bytes32 emptyRoot = wrapper.getRoot();

        // Insert 31 leaves to push empty root out of ring buffer
        for (uint256 i = 0; i < 31; i++) {
            wrapper.insert(keccak256(abi.encodePacked(i)));
        }

        // Empty root should be evicted from ring buffer
        assertFalse(wrapper.isKnownRoot(emptyRoot));

        // Current root should be known
        assertTrue(wrapper.isKnownRoot(wrapper.getRoot()));
    }

    // ============ Depth 1 (minimal tree) ============

    function test_depth1_twoLeaves() public {
        wrapper.init(1);
        wrapper.insert(keccak256("a"));
        wrapper.insert(keccak256("b"));
        assertEq(wrapper.getNextIndex(), 2);
        assertNotEq(wrapper.getRoot(), bytes32(0));
    }

    // ============ Multiple inserts maintain valid state ============

    function test_manyInserts_validState() public {
        wrapper.init(5); // capacity 32
        for (uint256 i = 0; i < 20; i++) {
            uint256 idx = wrapper.insert(keccak256(abi.encodePacked(i)));
            assertEq(idx, i);
        }
        assertEq(wrapper.getNextIndex(), 20);
        assertTrue(wrapper.isKnownRoot(wrapper.getRoot()));
    }

    // ============ Root changes every insert ============

    function test_rootChangesEveryInsert() public {
        wrapper.init(5);
        bytes32 prevRoot = wrapper.getRoot();

        for (uint256 i = 0; i < 10; i++) {
            wrapper.insert(keccak256(abi.encodePacked(i)));
            bytes32 newRoot = wrapper.getRoot();
            assertNotEq(newRoot, prevRoot);
            prevRoot = newRoot;
        }
    }

    // ============ Different depths produce different roots ============

    function test_differentDepths_differentRoots() public {
        MerkleTreeWrapper w5 = new MerkleTreeWrapper();
        MerkleTreeWrapper w10 = new MerkleTreeWrapper();

        w5.init(5);
        w10.init(10);

        // Same leaf
        bytes32 leaf = keccak256("same");
        w5.insert(leaf);
        w10.insert(leaf);

        assertNotEq(w5.getRoot(), w10.getRoot());
    }
}
