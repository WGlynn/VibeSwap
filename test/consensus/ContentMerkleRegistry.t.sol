// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/ContentMerkleRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev C32 test double — mirrors MockCellVault from OperatorCellRegistry.t.sol
///      but implements the Content-layer interface (same struct layout).
contract MockContentVault is IStateRentVaultForContent {
    mapping(bytes32 => bool) public activeCells;

    function setActive(bytes32 cellId, bool active) external {
        activeCells[cellId] = active;
    }

    function getCell(bytes32 cellId) external view returns (Cell memory) {
        return Cell({
            owner: address(0),
            capacity: 0,
            contentHash: bytes32(0),
            createdAt: 0,
            active: activeCells[cellId]
        });
    }
}

contract ContentMerkleRegistryTest is Test {
    ContentMerkleRegistry public cmr;
    MockContentVault public vault;

    address owner = makeAddr("owner");
    address op1 = makeAddr("op1");
    address op2 = makeAddr("op2");

    bytes32 cell1 = keccak256("cell1");
    bytes32 cell2 = keccak256("cell2");

    bytes32 root1 = keccak256("root-1");
    uint256 constant COUNT = 64;
    uint256 constant SIZE = 32;

    event ChunksCommitted(
        address indexed operator,
        bytes32 indexed cellId,
        bytes32 chunkRoot,
        uint256 chunkCount,
        uint256 chunkSize
    );
    event CommitmentRevoked(address indexed operator, bytes32 indexed cellId);

    function setUp() public {
        vault = new MockContentVault();

        ContentMerkleRegistry impl = new ContentMerkleRegistry();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                ContentMerkleRegistry.initialize.selector,
                address(vault),
                owner
            )
        );
        cmr = ContentMerkleRegistry(address(proxy));

        vault.setActive(cell1, true);
        vault.setActive(cell2, true);
    }

    // ============ Commit ============

    function test_CMR_CommitChunks_HappyPath() public {
        vm.expectEmit(true, true, false, true);
        emit ChunksCommitted(op1, cell1, root1, COUNT, SIZE);

        vm.prank(op1);
        cmr.commitChunks(cell1, root1, COUNT, SIZE);

        ContentMerkleRegistry.ChunkCommitment memory c = cmr.getCommitment(op1, cell1);
        assertEq(c.chunkRoot, root1);
        assertEq(c.chunkCount, COUNT);
        assertEq(c.chunkSize, SIZE);
        assertEq(c.committedAt, block.timestamp);
        assertTrue(c.active);
        assertEq(cmr.operatorCommitmentCount(op1), 1);
        assertTrue(cmr.hasCommitment(op1, cell1));
    }

    function test_CMR_Commit_RevertsIfInactive() public {
        bytes32 dead = keccak256("inactive");
        // dead not setActive

        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.InactiveCell.selector);
        cmr.commitChunks(dead, root1, COUNT, SIZE);
    }

    function test_CMR_Commit_RevertsIfVaultUnset() public {
        vm.prank(owner);
        cmr.setStateRentVault(address(0));

        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.VaultNotSet.selector);
        cmr.commitChunks(cell1, root1, COUNT, SIZE);
    }

    function test_CMR_Commit_RevertsIfAlreadyCommitted() public {
        vm.prank(op1);
        cmr.commitChunks(cell1, root1, COUNT, SIZE);

        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.CommitmentExists.selector);
        cmr.commitChunks(cell1, root1, COUNT, SIZE);
    }

    function test_CMR_Commit_RevertsOnChunkSizeBelowMin() public {
        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.InvalidChunkSize.selector);
        cmr.commitChunks(cell1, root1, COUNT, 31);  // < MIN_CHUNK_SIZE = 32
    }

    function test_CMR_Commit_RevertsOnChunkSizeAboveMax() public {
        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.InvalidChunkSize.selector);
        cmr.commitChunks(cell1, root1, COUNT, 4097);  // > MAX_CHUNK_SIZE = 4096
    }

    function test_CMR_Commit_RevertsOnZeroChunkCount() public {
        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.InvalidChunkCount.selector);
        cmr.commitChunks(cell1, root1, 0, SIZE);
    }

    function test_CMR_Commit_RevertsOnChunkCountAboveMax() public {
        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.InvalidChunkCount.selector);
        cmr.commitChunks(cell1, root1, 1_000_001, SIZE);
    }

    function test_CMR_Commit_RevertsOnZeroRoot() public {
        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.ZeroRoot.selector);
        cmr.commitChunks(cell1, bytes32(0), COUNT, SIZE);
    }

    // ============ Revoke ============

    function test_CMR_Revoke_HappyPath() public {
        vm.prank(op1);
        cmr.commitChunks(cell1, root1, COUNT, SIZE);

        vm.expectEmit(true, true, false, false);
        emit CommitmentRevoked(op1, cell1);

        vm.prank(op1);
        cmr.revokeCommitment(cell1);

        assertFalse(cmr.hasCommitment(op1, cell1));
        assertEq(cmr.operatorCommitmentCount(op1), 0);
    }

    function test_CMR_Revoke_RevertsIfNoCommitment() public {
        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.NoCommitment.selector);
        cmr.revokeCommitment(cell1);
    }

    function test_CMR_Revoke_DoesNotAffectOtherOperators() public {
        vm.prank(op1);
        cmr.commitChunks(cell1, root1, COUNT, SIZE);
        vm.prank(op2);
        cmr.commitChunks(cell1, keccak256("root-2"), COUNT, SIZE);

        vm.prank(op1);
        cmr.revokeCommitment(cell1);

        assertFalse(cmr.hasCommitment(op1, cell1));
        assertTrue(cmr.hasCommitment(op2, cell1), "op2 commitment unaffected");
    }

    function test_CMR_CommitAfterRevoke_Works() public {
        vm.prank(op1);
        cmr.commitChunks(cell1, root1, COUNT, SIZE);
        vm.prank(op1);
        cmr.revokeCommitment(cell1);

        bytes32 root2 = keccak256("new-root");
        vm.prank(op1);
        cmr.commitChunks(cell1, root2, COUNT * 2, SIZE * 2);

        ContentMerkleRegistry.ChunkCommitment memory c = cmr.getCommitment(op1, cell1);
        assertEq(c.chunkRoot, root2);
        assertEq(c.chunkCount, COUNT * 2);
        assertEq(c.chunkSize, SIZE * 2);
        assertTrue(c.active);
    }

    // ============ Update ============

    function test_CMR_UpdateCommitment_UpdatesFields() public {
        vm.prank(op1);
        cmr.commitChunks(cell1, root1, COUNT, SIZE);

        uint256 firstCommittedAt = block.timestamp;
        vm.warp(block.timestamp + 100);

        bytes32 newRoot = keccak256("updated");
        vm.prank(op1);
        cmr.updateCommitment(cell1, newRoot, COUNT + 8, SIZE * 2);

        ContentMerkleRegistry.ChunkCommitment memory c = cmr.getCommitment(op1, cell1);
        assertEq(c.chunkRoot, newRoot);
        assertEq(c.chunkCount, COUNT + 8);
        assertEq(c.chunkSize, SIZE * 2);
        assertGt(c.committedAt, firstCommittedAt);
        assertEq(cmr.operatorCommitmentCount(op1), 1, "count unchanged on update");
    }

    function test_CMR_UpdateCommitment_RevertsIfNoCommitment() public {
        vm.prank(op1);
        vm.expectRevert(ContentMerkleRegistry.NoCommitment.selector);
        cmr.updateCommitment(cell1, root1, COUNT, SIZE);
    }

    // ============ Views + Admin ============

    function test_CMR_HasCommitment_Default() public view {
        assertFalse(cmr.hasCommitment(op1, cell1));
    }

    function test_CMR_SetStateRentVault_OnlyOwner() public {
        vm.prank(op1);
        vm.expectRevert();
        cmr.setStateRentVault(address(0xdead));
    }

    function test_CMR_Upgrade_OnlyOwner() public {
        ContentMerkleRegistry newImpl = new ContentMerkleRegistry();
        vm.prank(op1);
        vm.expectRevert();
        cmr.upgradeToAndCall(address(newImpl), "");
    }
}
