// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title StateRentVault — CKA Cell Capacity Management
 * @notice Locks CKB-native tokens to create CKA cells.
 *         1 CKB-native = 1 byte of cell capacity.
 *
 * @dev Nervos CKB state rent model:
 *      - Creating a cell locks tokens proportional to cell.capacity
 *      - Locked tokens cannot enter the DAO shelter
 *      - Secondary issuance dilutes locked tokens (economic pressure to clean state)
 *      - Destroying a cell releases locked tokens
 *      - State cleans itself — stale cells cost more than they're worth
 *
 *      This is NOT a tax. It's physics — state occupies space, space has cost.
 */

/// @notice Minimal CKB-native interface for lock/unlock
interface ICKBNativeForVault {
    function lock(address from, uint256 amount) external;
    function unlock(address to, uint256 amount) external;
    function totalOccupied() external view returns (uint256);
}

contract StateRentVault is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ State ============

    /// @notice CKB-native token
    ICKBNativeForVault public ckbToken;

    /// @notice Cell data
    struct Cell {
        address owner;
        uint256 capacity;       // Tokens locked (= bytes of state)
        bytes32 contentHash;    // Hash of cell content
        uint256 createdAt;
        bool active;
    }

    /// @notice All cells by ID
    mapping(bytes32 => Cell) public cells;

    /// @notice Cell count per owner
    mapping(address => uint256) public cellCount;

    /// @notice Owner's cells (for enumeration)
    mapping(address => bytes32[]) public ownerCells;

    /// @notice Total cells active
    uint256 public activeCellCount;

    /// @notice Authorized cell managers (protocol contracts that can create/destroy cells)
    mapping(address => bool) public cellManagers;

    /// @dev Reserved storage gap
    uint256[50] private __gap;

    // ============ Events ============

    event CellCreated(bytes32 indexed cellId, address indexed owner, uint256 capacity, bytes32 contentHash);
    event CellDestroyed(bytes32 indexed cellId, address indexed owner, uint256 capacityReleased);
    event CellManagerUpdated(address indexed manager, bool authorized);

    // ============ Errors ============

    error Unauthorized();
    error CellAlreadyExists();
    error CellNotFound();
    error NotCellOwner();
    error ZeroCapacity();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _ckbToken, address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        ckbToken = ICKBNativeForVault(_ckbToken);
    }

    // ============ Cell Operations ============

    /**
     * @notice Create a CKA cell — locks CKB-native tokens for state capacity
     * @dev Caller must have approved CKB-native token to this vault via the token's
     *      approve function (vault calls token.lock which does transferFrom).
     * @param cellId Unique cell identifier (content-addressable hash)
     * @param capacity Bytes of state to occupy (tokens to lock)
     * @param contentHash Hash of cell content for integrity verification
     */
    function createCell(
        bytes32 cellId,
        uint256 capacity,
        bytes32 contentHash
    ) external nonReentrant {
        if (!cellManagers[msg.sender]) revert Unauthorized();
        if (capacity == 0) revert ZeroCapacity();
        if (cells[cellId].active) revert CellAlreadyExists();

        // Lock CKB-native tokens (token.lock transfers from owner to token contract)
        // The cell manager specifies who pays — typically tx.origin or a designated payer
        // For simplicity, the manager itself must hold and approve the tokens
        ckbToken.lock(msg.sender, capacity);

        cells[cellId] = Cell({
            owner: msg.sender,
            capacity: capacity,
            contentHash: contentHash,
            createdAt: block.timestamp,
            active: true
        });

        cellCount[msg.sender]++;
        ownerCells[msg.sender].push(cellId);
        activeCellCount++;

        emit CellCreated(cellId, msg.sender, capacity, contentHash);
    }

    /**
     * @notice Destroy a CKA cell — releases locked CKB-native tokens
     * @param cellId The cell to destroy
     */
    function destroyCell(bytes32 cellId) external nonReentrant {
        Cell storage cell = cells[cellId];
        if (!cell.active) revert CellNotFound();
        if (cell.owner != msg.sender && !cellManagers[msg.sender]) revert NotCellOwner();

        uint256 capacity = cell.capacity;
        address cellOwner = cell.owner;

        cell.active = false;
        cell.capacity = 0;
        cellCount[cellOwner]--;
        activeCellCount--;

        // Unlock CKB-native tokens back to cell owner
        ckbToken.unlock(cellOwner, capacity);

        emit CellDestroyed(cellId, cellOwner, capacity);
    }

    // ============ Admin ============

    function setCellManager(address manager, bool authorized) external onlyOwner {
        cellManagers[manager] = authorized;
        emit CellManagerUpdated(manager, authorized);
    }

    // ============ View Functions ============

    function getCell(bytes32 cellId) external view returns (Cell memory) {
        return cells[cellId];
    }

    function getOwnerCellIds(address owner_) external view returns (bytes32[] memory) {
        return ownerCells[owner_];
    }

    function totalOccupiedState() external view returns (uint256) {
        return ckbToken.totalOccupied();
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
