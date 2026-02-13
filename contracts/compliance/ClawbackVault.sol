// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ClawbackVault
 * @notice Escrow for clawed-back funds during dispute resolution
 * @dev Holds frozen funds until a case is resolved. Funds are either:
 *      - Returned to the rightful owner (victim) after case resolution
 *      - Returned to the wallet if the case is dismissed
 *      - Sent to a designated recovery address per court order
 */
contract ClawbackVault is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct EscrowRecord {
        bytes32 caseId;
        address originalOwner;
        address token;
        uint256 amount;
        uint64 depositedAt;
        bool released;
        address releasedTo;
    }

    // ============ State ============

    /// @notice ClawbackRegistry address
    address public registry;

    /// @notice Escrow records by ID
    mapping(bytes32 => EscrowRecord) public escrows;

    /// @notice Total escrowed per token
    mapping(address => uint256) public totalEscrowed;

    /// @notice Escrow IDs per case
    mapping(bytes32 => bytes32[]) public caseEscrows;

    /// @notice Escrow counter
    uint256 public escrowCount;

    // ============ Events ============

    event FundsEscrowed(bytes32 indexed escrowId, bytes32 indexed caseId, address indexed from, address token, uint256 amount);
    event FundsReleased(bytes32 indexed escrowId, address indexed to, uint256 amount);
    event FundsReturnedToOwner(bytes32 indexed escrowId, address indexed owner, uint256 amount);

    // ============ Errors ============

    error NotRegistry();
    error EscrowNotFound();
    error AlreadyReleased();
    error InsufficientBalance();
    error InvalidRecipient();

    // ============ Modifiers ============

    modifier onlyRegistry() {
        if (msg.sender != registry && msg.sender != owner()) revert NotRegistry();
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner, address _registry) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        registry = _registry;
    }

    // ============ Escrow Functions ============

    /**
     * @notice Deposit funds into escrow (called by registry during clawback)
     * @param caseId Associated case
     * @param originalOwner The wallet funds were clawed from
     * @param token Token address
     * @param amount Amount escrowed
     * @return escrowId Unique escrow record ID
     */
    function escrowFunds(
        bytes32 caseId,
        address originalOwner,
        address token,
        uint256 amount
    ) external onlyRegistry nonReentrant returns (bytes32 escrowId) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        escrowCount++;
        escrowId = keccak256(abi.encodePacked(caseId, originalOwner, escrowCount));

        escrows[escrowId] = EscrowRecord({
            caseId: caseId,
            originalOwner: originalOwner,
            token: token,
            amount: amount,
            depositedAt: uint64(block.timestamp),
            released: false,
            releasedTo: address(0)
        });

        totalEscrowed[token] += amount;
        caseEscrows[caseId].push(escrowId);

        emit FundsEscrowed(escrowId, caseId, originalOwner, token, amount);
    }

    /**
     * @notice Release escrowed funds to a designated recipient (e.g., victim)
     * @param escrowId Escrow to release
     * @param recipient Where to send the funds
     */
    function releaseTo(
        bytes32 escrowId,
        address recipient
    ) external onlyRegistry nonReentrant {
        if (recipient == address(0)) revert InvalidRecipient();
        EscrowRecord storage record = escrows[escrowId];
        if (record.depositedAt == 0) revert EscrowNotFound();
        if (record.released) revert AlreadyReleased();

        record.released = true;
        record.releasedTo = recipient;
        totalEscrowed[record.token] -= record.amount;

        IERC20(record.token).safeTransfer(recipient, record.amount);

        emit FundsReleased(escrowId, recipient, record.amount);
    }

    /**
     * @notice Return funds to original owner (case dismissed)
     * @param escrowId Escrow to return
     */
    function returnToOwner(bytes32 escrowId) external onlyRegistry nonReentrant {
        EscrowRecord storage record = escrows[escrowId];
        if (record.depositedAt == 0) revert EscrowNotFound();
        if (record.released) revert AlreadyReleased();

        record.released = true;
        record.releasedTo = record.originalOwner;
        totalEscrowed[record.token] -= record.amount;

        IERC20(record.token).safeTransfer(record.originalOwner, record.amount);

        emit FundsReturnedToOwner(escrowId, record.originalOwner, record.amount);
    }

    /**
     * @notice Batch return all escrows for a dismissed case
     * @param caseId Case whose funds should be returned
     */
    function returnAllForCase(bytes32 caseId) external onlyRegistry nonReentrant {
        bytes32[] storage ids = caseEscrows[caseId];
        for (uint256 i = 0; i < ids.length; i++) {
            EscrowRecord storage record = escrows[ids[i]];
            if (!record.released) {
                record.released = true;
                record.releasedTo = record.originalOwner;
                totalEscrowed[record.token] -= record.amount;
                IERC20(record.token).safeTransfer(record.originalOwner, record.amount);
                emit FundsReturnedToOwner(ids[i], record.originalOwner, record.amount);
            }
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get escrow details
     */
    function getEscrow(bytes32 escrowId) external view returns (EscrowRecord memory) {
        return escrows[escrowId];
    }

    /**
     * @notice Get all escrow IDs for a case
     */
    function getCaseEscrows(bytes32 caseId) external view returns (bytes32[] memory) {
        return caseEscrows[caseId];
    }

    /**
     * @notice Get total escrowed for a token
     */
    function getTotalEscrowed(address token) external view returns (uint256) {
        return totalEscrowed[token];
    }

    // ============ Admin ============

    function setRegistry(address _registry) external onlyOwner {
        registry = _registry;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
