// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPoMOperatorRegistry
 * @notice Bonded-operator set for the PoM-on-ETH ("The DAO 2") export layer.
 *
 *         Trust root for the optimistic re-derivation model: proposers and
 *         challengers must be bonded here so a losing side in a dispute has
 *         something to slash. Keyed by operator ADDRESS (secp256k1), not by a
 *         BLS pubkey — there is no signer quorum in this design, only bonded
 *         participants in an optimistic game.
 *
 *         Lean fork of vibeswap/contracts/messaging/MessagingValidatorRegistry:
 *           - address-keyed (no 48-byte BLS pubkey, no aggregate machinery)
 *           - no epochs / set-rotation (optimistic model needs neither)
 *           - same bond / activation-delay / unbonding-delay / slashing lifecycle
 */
interface IPoMOperatorRegistry {
    // ============ Structs ============

    struct Operator {
        address operator;       // controlling + bonded address
        address payoutAddress;  // where rewards / returned bond go
        uint96  bondAmount;     // currently bonded stake
        uint64  activatedAt;    // timestamp the operator becomes active
        uint64  exitInitiatedAt;// 0 if not exiting; else unbonding start
        bool    slashed;        // permanent flag set on bond-depleting slash
    }

    // ============ Events ============

    event OperatorRegistered(address indexed operator, address payoutAddress, uint96 bondAmount);
    event OperatorActivated(address indexed operator, uint64 activatedAt);
    event BondDeposited(address indexed operator, uint96 amount);
    event BondWithdrawn(address indexed operator, uint96 amount);
    event OperatorExitInitiated(address indexed operator, uint64 unlockAt);
    event OperatorExited(address indexed operator);
    event OperatorSlashed(address indexed operator, bytes32 indexed offenseTag, uint96 amountSlashed);
    event SlashedPoolSwept(address indexed to, uint96 amount);
    /// @notice A slice of a slashed bond routed directly to a beneficiary (a winning challenger),
    ///         rather than to the governance pool. Bond-denominated, so it pays even at genesis.
    event BondSlicePaid(address indexed slashedOperator, address indexed beneficiary, uint96 amount);

    // ============ Errors ============

    error BondBelowFloor(uint96 amount, uint96 floor);
    error AlreadyRegistered(address operator);
    error UnknownOperator(address operator);
    error NotActivated(address operator);
    error AlreadyExiting(address operator);
    error OperatorIsExiting(address operator);
    error UnbondingPeriodActive(uint64 secondsRemaining);
    error UnauthorizedSlasher();
    error BeneficiaryBpsTooHigh(uint16 bps);

    // ============ Lifecycle ============

    /// @notice Register the caller as a bonded operator. Activates after activationDelay.
    function register(address payoutAddress, uint96 bondAmount) external returns (uint64 activatesAt);

    /// @notice Top up the caller's bond.
    function topUpBond(uint96 amount) external;

    /// @notice Begin exit; bond locks for unbondingDelay.
    function initiateExit() external;

    /// @notice Complete exit after the unbonding window; returns remaining bond.
    function finalizeExit() external;

    /// @notice Slash an operator's bond. Slasher-only (the hub / dispute resolver).
    function slash(address operator, bytes32 offenseTag, uint96 requestedAmount)
        external
        returns (uint96 amountSlashed);

    /// @notice Slash `operator`, routing a `beneficiaryBps` slice of the slashed bond directly to
    ///         `beneficiary` and the remainder to the governance slashed-pool. Slasher-only. Lets
    ///         the hub pay a winning challenger from the LOSER'S BOND even when the MIND security
    ///         budget is empty (the genesis case), without minting off-schedule. If `beneficiary`
    ///         is zero the slice folds back into the pool (no bond is stranded).
    /// @return amountSlashed total bond removed from `operator`.
    /// @return toBeneficiary the sub-portion transferred to `beneficiary`.
    function slashToBeneficiary(
        address operator,
        bytes32 offenseTag,
        uint96 requestedAmount,
        address beneficiary,
        uint16 beneficiaryBps
    ) external returns (uint96 amountSlashed, uint96 toBeneficiary);

    // ============ Views ============

    function bondFloor() external view returns (uint96);
    function activationDelay() external view returns (uint64);
    function unbondingDelay() external view returns (uint64);

    /// @notice True iff registered, matured, un-slashed, not exiting, bond >= floor.
    function isActive(address operator) external view returns (bool);

    function bondOf(address operator) external view returns (uint96);
    function payoutOf(address operator) external view returns (address);
    function getOperator(address operator) external view returns (Operator memory);
}
