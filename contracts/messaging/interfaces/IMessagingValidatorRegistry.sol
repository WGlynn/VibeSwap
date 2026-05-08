// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMessagingValidatorRegistry
 * @notice Validator-set management for the post-LayerZero messaging layer.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §7.1
 *         Forked from: contracts/governance/ShardOperatorRegistry.sol
 *
 *         Why a fork instead of direct reuse:
 *           Shard-bonds and messaging-bonds carry different slashing risk
 *           profiles. A shard operator slashed for shard misbehavior should
 *           not lose their messaging stake (and vice versa). Separate
 *           registries, shared bond infrastructure (ClawbackVault).
 *
 *         Set parameters (v1, governance-tunable):
 *           - bondFloor:      32 ETH-equivalent on Ethereum, scaled per chain
 *           - activationDelay: 7 days (Sybil resistance + churn time-lock)
 *           - unbondingDelay:  14 days (must outlive any in-flight challenge)
 *           - maxSetSize:      128 active validators (BLS aggregation cap)
 *
 *         BLS aggregation:
 *           - Curve: BLS12-381 (Ethereum-native; precompile-assisted verify)
 *           - Pubkey aggregation precomputed at set-rotation boundaries
 *           - Threshold t = ⌈2n/3⌉ + 1 enforced at the verifier layer
 */
interface IMessagingValidatorRegistry {
    // ============ Structs ============

    struct Validator {
        bytes blsPubkey;       // 48-byte BLS12-381 G1 compressed pubkey
        address operator;      // EVM address controlling registration + slashing
        address payoutAddress; // Where attestation/aggregator rewards go
        uint96  bondAmount;    // Currently bonded stake in the messaging-bond vault
        uint64  activatedAt;   // Block timestamp when validator becomes active
        uint64  exitInitiatedAt; // 0 if not exiting; otherwise unbonding start time
        uint32  index;         // Stable index in the active set (for BLS aggregation)
        bool    slashed;       // Permanent flag — set by ProofOfMisbehavior
    }

    /// @notice Snapshot of the active set at a specific epoch.
    /// @dev Used by the AttestationVerifier to verify aggregate signatures
    ///      against the set that was active at the time of attestation.
    struct SetSnapshot {
        uint64  epoch;
        uint32  size;             // Number of active validators in this snapshot
        bytes32 aggregatePubkeyHash; // keccak256 of the aggregate BLS pubkey
        bytes32 merkleRoot;       // Merkle root over individual pubkeys (for partial-set proofs)
    }

    // ============ Events ============

    event ValidatorRegistered(
        address indexed operator,
        bytes blsPubkey,
        uint32 index,
        uint96 bondAmount
    );
    event ValidatorActivated(uint32 indexed index, uint64 activatedAt);
    event ValidatorExitInitiated(uint32 indexed index, uint64 exitAt);
    event ValidatorExited(uint32 indexed index);
    event ValidatorSlashed(
        uint32 indexed index,
        bytes32 indexed offenseTag,
        uint96 amountSlashed
    );
    event SetRotated(uint64 indexed epoch, uint32 newSize, bytes32 aggregatePubkeyHash);
    event BondDeposited(address indexed operator, uint96 amount);
    event BondWithdrawn(address indexed operator, uint96 amount);

    // ============ Errors ============

    error BondBelowFloor(uint96 amount, uint96 floor);
    error PubkeyAlreadyRegistered(bytes pubkey);
    error InvalidPubkey();
    error NotActivated(uint32 index);
    error AlreadyExiting(uint32 index);
    error UnbondingPeriodActive(uint64 secondsRemaining);
    error SetFull(uint32 maxSize);
    error UnauthorizedSlasher();
    error UnknownValidator(uint32 index);
    error UnknownEpoch(uint64 epoch);

    // ============ Lifecycle ============

    /// @notice Register a new validator. Activates after activationDelay.
    /// @dev Requires bondAmount >= bondFloor staked into the messaging-bond vault.
    function register(
        bytes calldata blsPubkey,
        address payoutAddress,
        uint96 bondAmount
    ) external returns (uint32 index);

    /// @notice Top up an existing validator's bond.
    function topUpBond(uint32 index, uint96 amount) external;

    /// @notice Initiate validator exit. Bond is locked for unbondingDelay.
    function initiateExit(uint32 index) external;

    /// @notice Complete validator exit after unbondingDelay has elapsed.
    function finalizeExit(uint32 index) external;

    /// @notice Slash a validator's bond. Permissioned to ProofOfMisbehavior.
    /// @return amountSlashed Actual slashed amount (may be less than requested if bond is depleted).
    function slash(
        uint32 index,
        bytes32 offenseTag,
        uint96 requestedAmount
    ) external returns (uint96 amountSlashed);

    /// @notice Rotate the active set into a new epoch.
    /// @dev Called by governance or auto-triggered on activation/exit boundaries.
    ///      Recomputes the aggregate BLS pubkey for the new active set.
    function rotateSet() external returns (uint64 newEpoch);

    // ============ Views ============

    function bondFloor() external view returns (uint96);
    function activationDelay() external view returns (uint64);
    function unbondingDelay() external view returns (uint64);
    function maxSetSize() external view returns (uint32);

    function currentEpoch() external view returns (uint64);
    function setSnapshot(uint64 epoch) external view returns (SetSnapshot memory);
    function activeSetSize() external view returns (uint32);
    function thresholdForEpoch(uint64 epoch) external view returns (uint32);

    function getValidator(uint32 index) external view returns (Validator memory);
    function getValidatorByOperator(address operator)
        external
        view
        returns (uint32 index, Validator memory);
    function isActive(uint32 index) external view returns (bool);

    /// @notice Aggregate BLS pubkey for the active set at `epoch`.
    function aggregatePubkey(uint64 epoch) external view returns (bytes memory);
}
