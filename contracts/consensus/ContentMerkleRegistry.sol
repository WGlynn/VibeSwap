// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/// @notice Minimal view over StateRentVault for cell-existence checks.
///         Mirrors the interface in OperatorCellRegistry.sol to avoid coupling.
interface IStateRentVaultForContent {
    struct Cell {
        address owner;
        uint256 capacity;
        bytes32 contentHash;
        uint256 createdAt;
        bool active;
    }
    function getCell(bytes32 cellId) external view returns (Cell memory);
}

/**
 * @title ContentMerkleRegistry — V2b operator chunk-commitment sidecar
 * @notice C32 (follow-up to C31): lets operators commit a Merkle root over chunked
 *         cell content. OperatorCellRegistry reads these commitments to verify
 *         permissionless probabilistic-availability-sampling (PAS) challenges.
 *
 * @dev Design follows the C30 / C31 composability principle: keep StateRentVault
 *      untouched; add a sidecar that owns the new primitive. This contract does
 *      NOT verify Merkle proofs — proof verification happens inside
 *      OperatorCellRegistry where the challenge state lives. This contract is
 *      the commitment ledger only.
 *
 *      Semantic honesty (Danksharding/Al-Bassam framing): the commitment proves
 *      "chunks from the committed root are retrievable on-demand," not "the root
 *      represents the content any user expected." Content fidelity is an
 *      off-chain social-layer verification (users compare the operator's
 *      committed root against their expected content hash).
 *
 *      Chunk layout convention (enforced at verification time in OCR):
 *        leaf_i = keccak256(abi.encode(i, chunk_i))
 *        chunk_i length == chunkSize (except possibly the tail chunk)
 *        Merkle root = chunkRoot, produced by standard (sorted-pair) OZ tree
 *
 *      Operator opts into V2b enforcement by committing. Operators without a
 *      commitment are immune to V2b chunk-availability challenges but remain
 *      subject to V2a liveness challenges. Future cycle may make V2b mandatory
 *      via OCR `claimCell` signature change.
 */
contract ContentMerkleRegistry is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    /// @notice Minimum chunk size (prevents degenerate commitments where every
    ///         chunk is a single byte, which would force absurd proof depths).
    uint256 public constant MIN_CHUNK_SIZE = 32;

    /// @notice Maximum chunk size (caps calldata cost for challenge responses).
    uint256 public constant MAX_CHUNK_SIZE = 4096;

    /// @notice Minimum chunkCount. 1 is allowed (tiny cells); we just forbid 0.
    uint256 public constant MIN_CHUNK_COUNT = 1;

    /// @notice Maximum chunkCount. log2(1e6) ≈ 20, capping Merkle-proof depth.
    uint256 public constant MAX_CHUNK_COUNT = 1_000_000;

    // ============ Types ============

    struct ChunkCommitment {
        bytes32 chunkRoot;
        uint256 chunkCount;
        uint256 chunkSize;
        uint256 committedAt;
        bool active;
    }

    // ============ State ============

    IStateRentVaultForContent public stateRentVault;

    /// @notice (operator, cellId) → ChunkCommitment
    mapping(address => mapping(bytes32 => ChunkCommitment)) public commitments;

    /// @notice Total active commitments per operator (for telemetry/enumeration).
    mapping(address => uint256) public operatorCommitmentCount;

    /// @dev Reserved storage gap for future upgrades.
    uint256[47] private __gap;

    // ============ Events ============

    event ChunksCommitted(
        address indexed operator,
        bytes32 indexed cellId,
        bytes32 chunkRoot,
        uint256 chunkCount,
        uint256 chunkSize
    );
    event CommitmentRevoked(address indexed operator, bytes32 indexed cellId);
    event StateRentVaultUpdated(address indexed newVault);

    // ============ Errors ============

    error ZeroAddress();
    error VaultNotSet();
    error InactiveCell();
    error CommitmentExists();
    error NoCommitment();
    error InvalidChunkSize();
    error InvalidChunkCount();
    error ZeroRoot();

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _stateRentVault, address _owner) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        stateRentVault = IStateRentVaultForContent(_stateRentVault);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Operator API ============

    /**
     * @notice Operator commits a chunked-content Merkle root for a cellId.
     * @dev    Requires cell to be active in StateRentVault. No reverification
     *         of (chunkRoot vs. cell.contentHash) — the vault's contentHash
     *         represents an earlier content hashing convention; the sidecar's
     *         chunkRoot represents this operator's committed chunking scheme.
     *         Consistency is an off-chain social-layer check.
     */
    function commitChunks(
        bytes32 cellId,
        bytes32 chunkRoot,
        uint256 chunkCount,
        uint256 chunkSize
    ) external nonReentrant {
        if (address(stateRentVault) == address(0)) revert VaultNotSet();
        if (!stateRentVault.getCell(cellId).active) revert InactiveCell();
        if (chunkRoot == bytes32(0)) revert ZeroRoot();
        if (chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) revert InvalidChunkSize();
        if (chunkCount < MIN_CHUNK_COUNT || chunkCount > MAX_CHUNK_COUNT) revert InvalidChunkCount();

        ChunkCommitment storage c = commitments[msg.sender][cellId];
        if (c.active) revert CommitmentExists();

        c.chunkRoot = chunkRoot;
        c.chunkCount = chunkCount;
        c.chunkSize = chunkSize;
        c.committedAt = block.timestamp;
        c.active = true;

        operatorCommitmentCount[msg.sender]++;

        emit ChunksCommitted(msg.sender, cellId, chunkRoot, chunkCount, chunkSize);
    }

    /**
     * @notice Operator revokes their commitment.
     * @dev    Operator-initiated only. Future cycle may add guards (e.g., cannot
     *         revoke during an active chunk challenge in OCR) — for now, OCR
     *         enforces its own state-consistency checks at challenge time.
     */
    function revokeCommitment(bytes32 cellId) external nonReentrant {
        ChunkCommitment storage c = commitments[msg.sender][cellId];
        if (!c.active) revert NoCommitment();

        c.active = false;
        // Preserve other fields for forensic visibility; only the active flag
        // gates V2b challenges. Re-committing later overwrites the record.
        operatorCommitmentCount[msg.sender]--;

        emit CommitmentRevoked(msg.sender, cellId);
    }

    // ============ Admin ============

    function setStateRentVault(address newVault) external onlyOwner {
        stateRentVault = IStateRentVaultForContent(newVault);
        emit StateRentVaultUpdated(newVault);
    }

    // ============ Views ============

    function getCommitment(address operator, bytes32 cellId)
        external
        view
        returns (ChunkCommitment memory)
    {
        return commitments[operator][cellId];
    }

    function hasCommitment(address operator, bytes32 cellId) external view returns (bool) {
        return commitments[operator][cellId].active;
    }

    /// @notice Re-commit on an already-committed cellId (atomic revoke + commit).
    /// @dev Convenience helper so operators can update chunkRoot (e.g., after
    ///      chunk size tuning) without two txs. Subject to same validation as
    ///      commitChunks. Skips operatorCommitmentCount accounting since the
    ///      commitment is replaced, not added.
    function updateCommitment(
        bytes32 cellId,
        bytes32 chunkRoot,
        uint256 chunkCount,
        uint256 chunkSize
    ) external nonReentrant {
        if (address(stateRentVault) == address(0)) revert VaultNotSet();
        if (!stateRentVault.getCell(cellId).active) revert InactiveCell();
        if (chunkRoot == bytes32(0)) revert ZeroRoot();
        if (chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) revert InvalidChunkSize();
        if (chunkCount < MIN_CHUNK_COUNT || chunkCount > MAX_CHUNK_COUNT) revert InvalidChunkCount();

        ChunkCommitment storage c = commitments[msg.sender][cellId];
        if (!c.active) revert NoCommitment();

        c.chunkRoot = chunkRoot;
        c.chunkCount = chunkCount;
        c.chunkSize = chunkSize;
        c.committedAt = block.timestamp;

        emit ChunksCommitted(msg.sender, cellId, chunkRoot, chunkCount, chunkSize);
    }
}
