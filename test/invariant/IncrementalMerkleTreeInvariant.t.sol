// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/IncrementalMerkleTree.sol";

contract MerkleTreeHandler is Test {
    using IncrementalMerkleTree for IncrementalMerkleTree.Tree;
    IncrementalMerkleTree.Tree public tree;

    uint256 public insertCount;
    bytes32 public previousRoot;
    bool public rootEverChanged;

    constructor() {
        tree.init(10); // depth 10 = 1024 capacity
        previousRoot = tree.getRoot();
    }

    function insert(bytes32 leaf) external {
        if (insertCount >= 1024) return; // tree is full

        previousRoot = tree.getRoot();
        tree.insert(leaf);
        insertCount++;

        if (tree.getRoot() != previousRoot) {
            rootEverChanged = true;
        }
    }

    function getRoot() external view returns (bytes32) {
        return tree.getRoot();
    }

    function getNextIndex() external view returns (uint256) {
        return tree.getNextIndex();
    }

    function isKnownRoot(bytes32 root) external view returns (bool) {
        return tree.isKnownRoot(root);
    }
}

contract IncrementalMerkleTreeInvariantTest is Test {
    MerkleTreeHandler handler;

    function setUp() public {
        handler = new MerkleTreeHandler();
        targetContract(address(handler));
    }

    // ============ Invariant: nextIndex == insertCount ============
    function invariant_nextIndex_matchesInsertCount() public view {
        assertEq(handler.getNextIndex(), handler.insertCount(), "nextIndex should match insert count");
    }

    // ============ Invariant: current root is always known ============
    function invariant_currentRoot_isKnown() public view {
        bytes32 root = handler.getRoot();
        assertTrue(handler.isKnownRoot(root), "Current root should always be known");
    }

    // ============ Invariant: root is non-zero after any insert ============
    function invariant_rootNonZero() public view {
        bytes32 root = handler.getRoot();
        // Root should never be zero (even empty tree has a default root)
        assertNotEq(root, bytes32(0), "Root should never be zero");
    }
}
