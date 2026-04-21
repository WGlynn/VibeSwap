// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal view over StateRentVault for cell-existence checks.
///         Mirrors IStateRentVaultForRegistry in ShardOperatorRegistry.sol to
///         avoid a circular import.
interface IStateRentVaultForCellRegistry {
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
 * @title OperatorCellRegistry — Operator↔Cell Assignment Ledger
 * @notice C30 (C11-AUDIT-14 follow-up): closes the "cells-I-don't-serve" refute class
 *         in ShardOperatorRegistry. An operator opts in to serve a specific cellId by
 *         posting a per-cell bond. The assignment is a precondition for respondToChallenge
 *         to accept a cellId-in-Merkle-proof from that operator. Sybil operators with
 *         small stake can no longer inflate cellsServed using real-but-unserved cellIds
 *         from StateRentVault — each claimed cell costs a bond.
 *
 * @dev V1 slashing is onlyOwner (admin slashes based on off-chain availability evidence).
 *      V2 will introduce permissionless availability-proof slashing; the onchain interface
 *      stays the same, only the `slashAssignment` access-control relaxes.
 *
 *      Phantom-array discipline (C24/C25 primitive): operatorCells is append-only with
 *      swap-and-pop removal + MAX_CELLS_PER_OPERATOR cap. Iteration is bounded.
 *
 *      Slash-pool pattern (C29 primitive): slashed bonds accumulate in `slashPool`;
 *      owner sweeps to a governance-chosen destination at sweep time.
 */
contract OperatorCellRegistry is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice C24/C25 primitive — cap operatorCells to prevent unbounded iteration.
    uint256 public constant MAX_CELLS_PER_OPERATOR = 10_000;

    // ============ Types ============

    struct Assignment {
        address operator;
        uint256 bond;
        uint256 assignedAt;
        bool active;
    }

    // ============ State ============

    IERC20 public ckbToken;
    IStateRentVaultForCellRegistry public stateRentVault;

    /// @notice Bond required per claimed cell. Governance-tunable.
    uint256 public bondPerCell;

    /// @notice Sum of all currently locked bonds (active assignments).
    uint256 public totalBondsLocked;

    /// @notice Accumulated slashed bonds awaiting sweep to treasury. Mirrors C29.
    uint256 public slashPool;

    /// @notice cellId → Assignment (active or historical-inactive).
    mapping(bytes32 => Assignment) public assignments;

    /// @notice Operator's claimed cells for enumeration. Swap-and-pop on remove.
    mapping(address => bytes32[]) public operatorCells;

    /// @notice Phantom-array index-plus-one lookup for O(1) swap-and-pop.
    /// @dev    Stored value is `index + 1`; 0 means "not present."
    mapping(address => mapping(bytes32 => uint256)) private _operatorCellIndexPlus1;

    /// @dev Reserved storage gap for future upgrades.
    uint256[46] private __gap;

    // ============ Events ============

    event CellClaimed(bytes32 indexed cellId, address indexed operator, uint256 bond);
    event CellRelinquished(bytes32 indexed cellId, address indexed operator, uint256 bondReturned);
    event CellAssignmentSlashed(bytes32 indexed cellId, address indexed operator, uint256 bondSlashed);
    event BondPerCellUpdated(uint256 oldBond, uint256 newBond);
    event StateRentVaultUpdated(address indexed newVault);
    event SlashPoolSwept(address indexed destination, uint256 amount);

    // ============ Errors ============

    error AlreadyClaimed();
    error NotAssigned();
    error InactiveCell();
    error VaultNotSet();
    error NotOperator();
    error ZeroAddress();
    error EmptyPool();
    error MaxCellsReached();

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _ckbToken,
        address _stateRentVault,
        uint256 _bondPerCell,
        address _owner
    ) external initializer {
        if (_ckbToken == address(0) || _owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        ckbToken = IERC20(_ckbToken);
        stateRentVault = IStateRentVaultForCellRegistry(_stateRentVault);  // may be zero at init
        bondPerCell = _bondPerCell;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Operator Flow ============

    /**
     * @notice Operator opts in to serve a cellId by posting a bond.
     * @dev Requires stateRentVault to be wired and cell to be active. Prevents double-claim.
     *      Bond is pulled via safeTransferFrom — operator must approve ckbToken first.
     */
    function claimCell(bytes32 cellId) external nonReentrant {
        if (address(stateRentVault) == address(0)) revert VaultNotSet();
        if (!stateRentVault.getCell(cellId).active) revert InactiveCell();
        if (assignments[cellId].active) revert AlreadyClaimed();
        if (operatorCells[msg.sender].length >= MAX_CELLS_PER_OPERATOR) revert MaxCellsReached();

        uint256 bond = bondPerCell;

        assignments[cellId] = Assignment({
            operator: msg.sender,
            bond: bond,
            assignedAt: block.timestamp,
            active: true
        });

        operatorCells[msg.sender].push(cellId);
        _operatorCellIndexPlus1[msg.sender][cellId] = operatorCells[msg.sender].length;  // index + 1

        totalBondsLocked += bond;

        if (bond > 0) {
            ckbToken.safeTransferFrom(msg.sender, address(this), bond);
        }

        emit CellClaimed(cellId, msg.sender, bond);
    }

    /**
     * @notice Operator voluntarily relinquishes an assignment; bond returned.
     * @dev CEI: state cleared before the external safeTransfer.
     */
    function relinquishCell(bytes32 cellId) external nonReentrant {
        Assignment storage a = assignments[cellId];
        if (!a.active) revert NotAssigned();
        if (a.operator != msg.sender) revert NotOperator();

        uint256 bond = a.bond;
        address operator_ = a.operator;

        _removeFromOperatorCells(operator_, cellId);

        a.active = false;
        a.bond = 0;

        totalBondsLocked -= bond;

        if (bond > 0) {
            ckbToken.safeTransfer(operator_, bond);
        }

        emit CellRelinquished(cellId, operator_, bond);
    }

    // ============ Admin ============

    /**
     * @notice Slash an active assignment (V1: admin-only). Bond accrues to slashPool.
     * @dev V1: admin uses off-chain availability evidence to decide.
     *      V2 (future cycle): permissionless cryptographic availability challenge.
     *      The onchain interface stays stable; only access-control relaxes.
     */
    function slashAssignment(bytes32 cellId) external onlyOwner nonReentrant {
        Assignment storage a = assignments[cellId];
        if (!a.active) revert NotAssigned();

        uint256 bond = a.bond;
        address operator_ = a.operator;

        _removeFromOperatorCells(operator_, cellId);

        a.active = false;
        a.bond = 0;

        totalBondsLocked -= bond;
        slashPool += bond;

        emit CellAssignmentSlashed(cellId, operator_, bond);
    }

    /**
     * @notice Sweep accumulated slashed bonds to a governance-chosen destination.
     * @dev Mirrors VibeAgentConsensus.sweepSlashPoolToTreasury (C29). Destination is
     *      a parameter so governance can route to DAOTreasury, insurance pool, or a
     *      bug-bounty fund without requiring a contract upgrade.
     */
    function sweepSlashPoolToTreasury(address destination) external onlyOwner nonReentrant {
        if (destination == address(0)) revert ZeroAddress();
        uint256 amount = slashPool;
        if (amount == 0) revert EmptyPool();
        slashPool = 0;
        ckbToken.safeTransfer(destination, amount);
        emit SlashPoolSwept(destination, amount);
    }

    function setBondPerCell(uint256 newBond) external onlyOwner {
        uint256 old = bondPerCell;
        bondPerCell = newBond;
        emit BondPerCellUpdated(old, newBond);
    }

    function setStateRentVault(address newVault) external onlyOwner {
        stateRentVault = IStateRentVaultForCellRegistry(newVault);
        emit StateRentVaultUpdated(newVault);
    }

    // ============ Views ============

    function isAssigned(bytes32 cellId, address operator) external view returns (bool) {
        Assignment storage a = assignments[cellId];
        return a.active && a.operator == operator;
    }

    function getAssignment(bytes32 cellId) external view returns (Assignment memory) {
        return assignments[cellId];
    }

    function getOperatorCells(address operator) external view returns (bytes32[] memory) {
        return operatorCells[operator];
    }

    function operatorCellCount(address operator) external view returns (uint256) {
        return operatorCells[operator].length;
    }

    // ============ Internal ============

    /// @dev C24/C25 Phantom Array primitive: swap-and-pop + index-plus-one mapping.
    function _removeFromOperatorCells(address operator, bytes32 cellId) internal {
        uint256 idxPlus1 = _operatorCellIndexPlus1[operator][cellId];
        if (idxPlus1 == 0) return;  // defensive: not present
        uint256 idx = idxPlus1 - 1;

        bytes32[] storage list = operatorCells[operator];
        uint256 last = list.length - 1;
        if (idx != last) {
            bytes32 moved = list[last];
            list[idx] = moved;
            _operatorCellIndexPlus1[operator][moved] = idx + 1;
        }
        list.pop();
        delete _operatorCellIndexPlus1[operator][cellId];
    }

    receive() external payable {}
}
