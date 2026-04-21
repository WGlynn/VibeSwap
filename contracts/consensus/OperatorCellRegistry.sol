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

    // ============ C31 (V2 availability challenge) Constants ============
    //
    // Parameters drawn from augmented-mechanism-design.md:
    //   - CHALLENGE_BOND mirrors ShardOperatorRegistry.CHALLENGE_BOND (10e18 CKB)
    //     for protocol-wide challenge-bond consistency.
    //   - ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW mirrors SOR's CHALLENGE_RESPONSE_WINDOW
    //     (30 min) — the paper's temporal augmentation class (§6.1).
    //   - PER_CELL_CHALLENGE_COOLDOWN is a grace-window analog (paper §6.1), set
    //     shorter than AHT's 72hr because this is an operational dispute class,
    //     not an ownership dispute. 24hr tolerates one honest off-day per cell.
    //   - ASSIGNMENT_SLASH_BPS (50%) mirrors CRBA's SLASH_RATE (paper §5.3 / §6.5):
    //     punitive but not confiscatory on first offense. Progressive escalation
    //     (100% on repeat) deferred to a future cycle.
    //   - CHALLENGER_PAYOUT_BPS (50% of slashed portion) mirrors CRBA's 50/50
    //     treasury/pool split (paper §6.5, Compensatory Augmentation). Challenger
    //     is the bug-bounty party; slashPool is the protocol treasury channel.

    uint256 public constant ASSIGNMENT_CHALLENGE_BOND = 10e18;
    uint256 public constant ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW = 30 minutes;
    uint256 public constant PER_CELL_CHALLENGE_COOLDOWN = 24 hours;
    uint256 public constant ASSIGNMENT_SLASH_BPS = 5000;       // 50% of assignment bond slashed
    uint256 public constant CHALLENGER_PAYOUT_BPS = 5000;      // 50% of slashed portion to challenger

    // ============ Types ============

    struct Assignment {
        address operator;
        uint256 bond;
        uint256 assignedAt;
        bool active;
    }

    /// @notice C31: state of a permissionless availability challenge against an assignment.
    /// @dev    `lastFailedAt` persists across challenge lifecycles to enforce the
    ///         per-cell cooldown after an operator successfully refutes.
    struct AssignmentChallenge {
        bytes32 nonce;          // opaque challenger-chosen nonce, must be echoed in response
        address challenger;
        uint256 bond;
        uint256 deadline;
        uint256 lastFailedAt;   // timestamp of most recent successful operator refute
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

    /// @notice C31: active availability challenges per cellId.
    mapping(bytes32 => AssignmentChallenge) public assignmentChallenges;

    /// @notice C31: pull queue for the unslashed 50% remainder of an operator's
    ///         assignment bond after a successful permissionless slash. Mirrors
    ///         the C14-AUDIT-1 pull-queue pattern in VibeAgentConsensus.
    mapping(address => uint256) public pendingOperatorRefunds;

    /// @dev Reserved storage gap for future upgrades. C31 added 2 mapping slots
    ///      (assignmentChallenges, pendingOperatorRefunds) — shrunk from 46 → 44.
    uint256[44] private __gap;

    // ============ Events ============

    event CellClaimed(bytes32 indexed cellId, address indexed operator, uint256 bond);
    event CellRelinquished(bytes32 indexed cellId, address indexed operator, uint256 bondReturned);
    event CellAssignmentSlashed(bytes32 indexed cellId, address indexed operator, uint256 bondSlashed);
    event BondPerCellUpdated(uint256 oldBond, uint256 newBond);
    event StateRentVaultUpdated(address indexed newVault);
    event SlashPoolSwept(address indexed destination, uint256 amount);
    // C31 (V2 availability challenge)
    event AssignmentChallenged(bytes32 indexed cellId, address indexed challenger, bytes32 nonce, uint256 deadline);
    event AssignmentChallengeRefuted(bytes32 indexed cellId, address indexed operator, address indexed challenger, uint256 bondPaidToOperator);
    event AssignmentSlashedByChallenge(bytes32 indexed cellId, address indexed operator, address indexed challenger, uint256 slashedAmount, uint256 challengerPayout, uint256 slashPoolAdd);
    event OperatorRefundQueued(address indexed operator, uint256 amount);
    event OperatorRefundWithdrawn(address indexed operator, uint256 amount);

    // ============ Errors ============

    error AlreadyClaimed();
    error NotAssigned();
    error InactiveCell();
    error VaultNotSet();
    error NotOperator();
    error ZeroAddress();
    error EmptyPool();
    error MaxCellsReached();
    // C31 (V2 availability challenge)
    error ChallengeActive();
    error NoActiveChallenge();
    error ChallengeExpired();
    error ChallengeNotExpired();
    error NonceMismatch();
    error CooldownActive();
    error SelfChallenge();
    error NothingToWithdraw();

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
        // C31: cannot relinquish out from under an active challenge — operator
        // must respond or be slashed; otherwise this becomes a free escape hatch.
        if (assignmentChallenges[cellId].challenger != address(0)) revert ChallengeActive();

        uint256 bond = a.bond;
        address operator_ = a.operator;

        _removeFromOperatorCells(operator_, cellId);

        a.active = false;
        a.bond = 0;

        totalBondsLocked -= bond;

        // C31: wipe challenge/cooldown state so a future claimant starts fresh
        delete assignmentChallenges[cellId];

        if (bond > 0) {
            ckbToken.safeTransfer(operator_, bond);
        }

        emit CellRelinquished(cellId, operator_, bond);
    }

    // ============ C31: V2 Permissionless Availability Challenge ============
    //
    // AMD frame (augmented-mechanism-design.md):
    //   - Temporal augmentation (§6.1): bonded challenge + 30min response window
    //     converts unilateral seizure into a verifiable liveness check.
    //   - Compensatory augmentation (§6.5): slashed portion splits 50/50 between
    //     challenger (bug-bounty) and slashPool (protocol treasury channel).
    //     Unslashed 50% remainder returns to operator via pendingOperatorRefunds
    //     (pull queue, reuses C14-AUDIT-1 pattern).
    //   - Anti-grief via PER_CELL_CHALLENGE_COOLDOWN after honest refute.

    /**
     * @notice Permissionlessly challenge an operator's assignment with a liveness probe.
     * @dev Challenger posts ASSIGNMENT_CHALLENGE_BOND. Operator must call
     *      respondToAssignmentChallenge(cellId, nonce) within ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW
     *      or anyone may call claimAssignmentSlash(cellId) to execute the slash.
     *      Rejects if: no active assignment, challenger is the operator (self-challenge),
     *      another challenge is already active on this cellId, or the per-cell
     *      cooldown has not elapsed since the last honest refute.
     */
    function challengeAssignment(bytes32 cellId, bytes32 nonce) external nonReentrant {
        Assignment storage a = assignments[cellId];
        if (!a.active) revert NotAssigned();
        if (msg.sender == a.operator) revert SelfChallenge();

        AssignmentChallenge storage c = assignmentChallenges[cellId];
        if (c.challenger != address(0)) revert ChallengeActive();
        if (
            c.lastFailedAt != 0 &&
            block.timestamp < c.lastFailedAt + PER_CELL_CHALLENGE_COOLDOWN
        ) revert CooldownActive();

        ckbToken.safeTransferFrom(msg.sender, address(this), ASSIGNMENT_CHALLENGE_BOND);

        c.nonce = nonce;
        c.challenger = msg.sender;
        c.bond = ASSIGNMENT_CHALLENGE_BOND;
        c.deadline = block.timestamp + ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW;
        // lastFailedAt preserved across lifecycle — only updated on honest refute

        emit AssignmentChallenged(cellId, msg.sender, nonce, c.deadline);
    }

    /**
     * @notice Operator refutes an active challenge by echoing the challenger's nonce.
     * @dev V2a is a liveness check: proof of response proves the operator is online
     *      and attending to the assignment. Does not prove content availability —
     *      V2b (future cycle) may layer Merkle-chunk PAS on top if StateRentVault
     *      migrates to chunk-tree contentHashes.
     *
     *      On success: challenger's bond transfers to the operator (reward for
     *      attentiveness). Challenge state cleared, cooldown stamp set.
     */
    function respondToAssignmentChallenge(bytes32 cellId, bytes32 nonce) external nonReentrant {
        Assignment storage a = assignments[cellId];
        if (!a.active) revert NotAssigned();
        if (msg.sender != a.operator) revert NotOperator();

        AssignmentChallenge storage c = assignmentChallenges[cellId];
        if (c.challenger == address(0)) revert NoActiveChallenge();
        if (block.timestamp > c.deadline) revert ChallengeExpired();
        if (c.nonce != nonce) revert NonceMismatch();

        address challenger_ = c.challenger;
        uint256 bond = c.bond;

        // Clear active-challenge fields; stamp cooldown on the persistent field
        c.nonce = bytes32(0);
        c.challenger = address(0);
        c.bond = 0;
        c.deadline = 0;
        c.lastFailedAt = block.timestamp;

        // Challenger's bond flows to the operator as attentiveness reward (SOR pattern)
        if (bond > 0) {
            ckbToken.safeTransfer(a.operator, bond);
        }

        emit AssignmentChallengeRefuted(cellId, a.operator, challenger_, bond);
    }

    /**
     * @notice Permissionlessly execute the slash after the response window expires
     *         without a valid refute.
     * @dev Splits:
     *        - slashAmount = assignmentBond × ASSIGNMENT_SLASH_BPS (50%)
     *        - challengerPayout = slashAmount × CHALLENGER_PAYOUT_BPS (50% of slashed)
     *        - slashPoolAdd = slashAmount − challengerPayout (50% of slashed)
     *        - remainder = assignmentBond − slashAmount (50%) → pendingOperatorRefunds
     *      Also returns the challenger's original CHALLENGE_BOND (they were right).
     *      Assignment is deactivated and removed from operator's enumeration list.
     */
    function claimAssignmentSlash(bytes32 cellId) external nonReentrant {
        AssignmentChallenge storage c = assignmentChallenges[cellId];
        if (c.challenger == address(0)) revert NoActiveChallenge();
        if (block.timestamp <= c.deadline) revert ChallengeNotExpired();

        Assignment storage a = assignments[cellId];
        if (!a.active) revert NotAssigned();

        uint256 assignmentBond = a.bond;
        address operator_ = a.operator;
        address challenger_ = c.challenger;
        uint256 challengeBond = c.bond;

        // Split math — all drawn from augmented-mechanism-design §5.3 / §6.5
        uint256 slashAmount = (assignmentBond * ASSIGNMENT_SLASH_BPS) / 10_000;
        uint256 remainder = assignmentBond - slashAmount;
        uint256 challengerPayout = (slashAmount * CHALLENGER_PAYOUT_BPS) / 10_000;
        uint256 slashPoolAdd = slashAmount - challengerPayout;

        // Clear assignment state
        _removeFromOperatorCells(operator_, cellId);
        a.active = false;
        a.bond = 0;
        totalBondsLocked -= assignmentBond;

        // Wipe all challenge state (lastFailedAt included — assignment is ending,
        // future claimants of this cellId start with a fresh cooldown slate)
        delete assignmentChallenges[cellId];

        // Accumulate to slashPool
        slashPool += slashPoolAdd;

        // Queue operator's remainder (pull queue, reuses C14-AUDIT-1 pattern)
        if (remainder > 0) {
            pendingOperatorRefunds[operator_] += remainder;
            emit OperatorRefundQueued(operator_, remainder);
        }

        // Pay challenger: refund their challenge bond + award the challengerPayout
        uint256 challengerTotal = challengeBond + challengerPayout;
        if (challengerTotal > 0) {
            ckbToken.safeTransfer(challenger_, challengerTotal);
        }

        emit AssignmentSlashedByChallenge(cellId, operator_, challenger_, slashAmount, challengerPayout, slashPoolAdd);
    }

    /**
     * @notice Operator pulls their 50% unslashed remainder queued by claimAssignmentSlash.
     * @dev CEI: mapping zeroed before external call. Mirrors VibeAgentConsensus.withdrawPendingStake.
     */
    function withdrawPendingRefund() external nonReentrant {
        uint256 amount = pendingOperatorRefunds[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingOperatorRefunds[msg.sender] = 0;
        ckbToken.safeTransfer(msg.sender, amount);
        emit OperatorRefundWithdrawn(msg.sender, amount);
    }

    // ============ Admin ============

    /**
     * @notice Slash an active assignment via admin authority.
     * @dev @deprecated Kept as a transition affordance (augmented-mechanism-design §8.2)
     *      while the permissionless `challengeAssignment` → `claimAssignmentSlash` path
     *      matures in production. Target removal once V2 enforcement is proven.
     *      This path slashes the FULL bond (100%) to slashPool, by design — admin
     *      use is reserved for emergencies where the graduated challenge flow is
     *      unsuitable (e.g. compromised operator key, legal take-down, emergency
     *      protocol response). For routine availability enforcement, use the
     *      permissionless challenge path, not this.
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

        // C31: wipe challenge/cooldown state so future claimants start fresh.
        // Also refunds any active challenger's bond (admin slash pre-empts
        // permissionless challenge — challenger was not wrong to try).
        AssignmentChallenge storage c = assignmentChallenges[cellId];
        if (c.challenger != address(0) && c.bond > 0) {
            address challenger_ = c.challenger;
            uint256 challengeBond = c.bond;
            delete assignmentChallenges[cellId];
            ckbToken.safeTransfer(challenger_, challengeBond);
        } else {
            delete assignmentChallenges[cellId];
        }

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
