// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title IncrementalMerkleTree
 * @notice Hybrid incremental Merkle tree combining three proven patterns:
 *         - Eth2 Deposit Contract: Core insert algorithm (gas-efficient, formally verified)
 *         - Tornado Cash: Root history ring buffer (verify against recent roots for async proofs)
 *         - OpenZeppelin: Commutative hashing for native MerkleProof.verify() compatibility
 *
 * @dev Append-only tree. O(depth) storage, ~40-55k gas per insert.
 *      LeafInserted events allow off-chain indexers to reconstruct the full tree.
 */
library IncrementalMerkleTree {

    // ============ Constants ============

    uint256 internal constant MAX_DEPTH = 20;          // Supports up to 1M leaves
    uint256 internal constant ROOT_HISTORY_SIZE = 30;   // Tornado Cash ring buffer size

    // ============ Errors ============

    error TreeFull();
    error InvalidDepth();
    error DepthAlreadySet();

    // ============ Events ============

    event LeafInserted(uint256 indexed index, bytes32 indexed leaf, bytes32 newRoot);

    // ============ Storage ============

    struct Tree {
        uint256 depth;                          // Fixed depth (set once)
        uint256 nextIndex;                      // Append cursor
        bytes32 root;                           // Current Merkle root
        bytes32[20] filledSubtrees;             // Eth2: cached left siblings per level
        bytes32[20] zeroHashes;                 // Precomputed empty subtree hashes
        bytes32[30] rootHistory;                // Tornado Cash: recent root ring buffer
        uint256 currentRootIndex;               // Ring buffer cursor
    }

    // ============ Core Functions ============

    /**
     * @notice Initialize tree with given depth. Precomputes zero hashes and sets empty root.
     * @param self The tree storage
     * @param depth Tree depth (1-20). Total capacity = 2^depth leaves.
     */
    function init(Tree storage self, uint256 depth) internal {
        if (depth == 0 || depth > MAX_DEPTH) revert InvalidDepth();
        if (self.depth != 0) revert DepthAlreadySet();

        self.depth = depth;

        // Precompute zero hashes: zeroHashes[0] = 0, zeroHashes[i] = H(zeroHashes[i-1], zeroHashes[i-1])
        // Using commutative hashing (OZ-compatible)
        bytes32 currentZero = bytes32(0);
        self.zeroHashes[0] = currentZero;

        for (uint256 i = 1; i < depth; i++) {
            currentZero = _hashPair(currentZero, currentZero);
            self.zeroHashes[i] = currentZero;
        }

        // Fill subtrees with zero hashes (empty tree)
        for (uint256 i = 0; i < depth; i++) {
            self.filledSubtrees[i] = self.zeroHashes[i];
        }

        // Compute empty root
        bytes32 emptyRoot = currentZero;
        if (depth > 1) {
            emptyRoot = _hashPair(currentZero, currentZero);
        } else {
            emptyRoot = _hashPair(bytes32(0), bytes32(0));
        }
        self.root = emptyRoot;

        // Initialize root history
        self.rootHistory[0] = self.root;
    }

    /**
     * @notice Insert a leaf into the tree. Eth2 deposit contract algorithm with OZ-compatible hashing.
     * @param self The tree storage
     * @param leaf The leaf value to insert (typically keccak256 of data)
     * @return index The index at which the leaf was inserted
     */
    function insert(Tree storage self, bytes32 leaf) internal returns (uint256 index) {
        uint256 depth = self.depth;
        index = self.nextIndex;
        if (index >= (1 << depth)) revert TreeFull();

        self.nextIndex = index + 1;

        // Eth2 deposit contract insert algorithm:
        // Walk up the tree. If the current index bit is 0, this is a left child —
        // store it as the filled subtree and hash with the zero hash.
        // If bit is 1, this is a right child — hash with the filled subtree.
        bytes32 currentHash = leaf;
        uint256 currentIndex = index;

        for (uint256 i = 0; i < depth; i++) {
            if (currentIndex & 1 == 0) {
                // Left child: save as filled subtree, pair with zero
                self.filledSubtrees[i] = currentHash;
                currentHash = _hashPair(currentHash, self.zeroHashes[i]);
            } else {
                // Right child: pair with previously saved left sibling
                currentHash = _hashPair(self.filledSubtrees[i], currentHash);
            }
            currentIndex >>= 1;
        }

        // Update root
        self.root = currentHash;

        // Push to root history ring buffer (Tornado Cash pattern)
        uint256 newRootIndex = (self.currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        self.currentRootIndex = newRootIndex;
        self.rootHistory[newRootIndex] = currentHash;
    }

    /**
     * @notice Verify a Merkle proof against the current root using OZ MerkleProof.
     * @param self The tree storage
     * @param proof The Merkle proof (sibling hashes from leaf to root)
     * @param leaf The leaf hash to verify
     * @return valid True if the proof is valid against the current root
     */
    function verify(
        Tree storage self,
        bytes32[] calldata proof,
        bytes32 leaf
    ) internal view returns (bool valid) {
        return MerkleProof.verifyCalldata(proof, self.root, leaf);
    }

    /**
     * @notice Check if a root is in the recent root history (Tornado Cash pattern).
     *         Allows async proof generation — proofs built against a recent root
     *         remain valid even after new insertions.
     * @param self The tree storage
     * @param _root The root to check
     * @return known True if the root is in the history ring buffer
     */
    function isKnownRoot(Tree storage self, bytes32 _root) internal view returns (bool known) {
        if (_root == bytes32(0)) return false;

        uint256 idx = self.currentRootIndex;
        for (uint256 i = 0; i < ROOT_HISTORY_SIZE; i++) {
            if (self.rootHistory[idx] == _root) return true;
            if (idx == 0) {
                idx = ROOT_HISTORY_SIZE - 1;
            } else {
                idx--;
            }
        }
        return false;
    }

    /**
     * @notice Get the current root.
     */
    function getRoot(Tree storage self) internal view returns (bytes32) {
        return self.root;
    }

    /**
     * @notice Get the number of inserted leaves.
     */
    function getNextIndex(Tree storage self) internal view returns (uint256) {
        return self.nextIndex;
    }

    // ============ Internal Hashing (OZ-compatible commutative) ============

    /**
     * @notice Commutative hash pair — sorts inputs before hashing.
     *         Matches OpenZeppelin MerkleProof._hashPair() so proofs work with
     *         MerkleProof.verify() / verifyCalldata().
     */
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32 value) {
        /// @solidity memory-safe-assembly
        assembly {
            if gt(a, b) {
                let t := a
                a := b
                b := t
            }
            mstore(0x00, a)
            mstore(0x20, b)
            value := keccak256(0x00, 0x40)
        }
    }
}
