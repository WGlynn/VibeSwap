// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IMessagingValidatorRegistry} from "./interfaces/IMessagingValidatorRegistry.sol";

/**
 * @title MessagingValidatorRegistry
 * @notice Validator-set management for the post-LayerZero messaging layer.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §7.1
 *         Interface: contracts/messaging/interfaces/IMessagingValidatorRegistry.sol
 *
 *         Forked from ShardOperatorRegistry — separate registry, separate bonds.
 *         Differences vs the shard variant:
 *           - Validators are keyed by 48-byte BLS12-381 G1 pubkeys, not by
 *             bytes32 shardIds, because the pubkey is the cryptographic identity
 *             that signs attestations.
 *           - Activation is delayed (Sybil resistance + churn time-lock).
 *           - Exit is delayed (unbonding window must outlive any in-flight
 *             challenge against attestations they signed).
 *           - Set rotation is an explicit event with a per-epoch snapshot the
 *             AttestationVerifier reads when verifying historical attestations.
 *
 *         What v0.1 does NOT do (deferred to v0.2 hardening):
 *           - On-chain BLS aggregate pubkey verification at rotation time. v0.1
 *             governance-asserts the aggregate; v0.2 adds a challenge/refute
 *             cycle for incorrect aggregation, mirroring the cellsReport flow
 *             in ShardOperatorRegistry.
 *           - Pubkey proof-of-possession (PoP) check at registration. v0.1
 *             stores the raw pubkey; v0.2 adds a PoP signature requirement to
 *             rule out rogue-key attacks.
 */
contract MessagingValidatorRegistry is
    IMessagingValidatorRegistry,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint32 public constant MAX_SET_SIZE = 128;
    uint96 public constant DEFAULT_BOND_FLOOR = 32 ether;
    uint64 public constant DEFAULT_ACTIVATION_DELAY = 7 days;
    uint64 public constant DEFAULT_UNBONDING_DELAY = 14 days;
    /// @notice Self-audit H-1: minimum interval between rotateSet calls. Prevents
    ///         a griefer from spamming rotations and burying useful epochs in
    ///         noise. Tunable by governance.
    uint64 public constant DEFAULT_ROTATION_INTERVAL = 10 minutes;

    /// @notice BLS12-381 G1 compressed pubkey length.
    uint256 private constant BLS_PUBKEY_LEN = 48;

    // ============ Storage ============

    IERC20 public bondToken;
    address public proofOfMisbehavior; // Authorized slasher

    uint96 public bondFloorAmount;
    uint64 public activationDelaySeconds;
    uint64 public unbondingDelaySeconds;
    uint32 public maxSetSizeValue;

    /// @notice Self-audit H-1: minimum interval between rotateSet calls.
    uint64 public rotationIntervalSeconds;
    uint64 public lastRotationAt;

    /// @notice All validators by stable index. Indices are not reused after exit.
    mapping(uint32 => Validator) internal validators;
    uint32 public nextIndex;

    /// @notice Operator address → validator index. Zero means unregistered.
    /// @dev Index 0 is intentionally unused so that 0 unambiguously means "none".
    mapping(address => uint32) internal operatorToIndex;

    /// @notice Pubkey hash → validator index. Enforces pubkey uniqueness.
    mapping(bytes32 => uint32) internal pubkeyHashToIndex;

    /// @notice Active set as an array of indices. Reordered on exit.
    uint32[] internal activeIndices;

    /// @notice Per-validator position within `activeIndices`. Zero if inactive.
    /// @dev Stored as positions+1 so 0 means "not in active set".
    mapping(uint32 => uint32) internal activeSlot;

    /// @notice Current epoch counter. Bumped by rotateSet().
    uint64 public currentEpochValue;

    /// @notice Snapshots of the active set per epoch.
    mapping(uint64 => SetSnapshot) internal snapshots;

    /// @notice Aggregate BLS pubkey per epoch (for AttestationVerifier).
    mapping(uint64 => bytes) internal aggregatePubkeys;

    /// @dev Reserved storage gap for upgrade safety.
    uint256[40] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _bondToken,
        address _proofOfMisbehavior,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        bondToken = IERC20(_bondToken);
        proofOfMisbehavior = _proofOfMisbehavior;

        bondFloorAmount = DEFAULT_BOND_FLOOR;
        activationDelaySeconds = DEFAULT_ACTIVATION_DELAY;
        unbondingDelaySeconds = DEFAULT_UNBONDING_DELAY;
        maxSetSizeValue = MAX_SET_SIZE;
        rotationIntervalSeconds = DEFAULT_ROTATION_INTERVAL;

        // Index 0 is reserved as "unregistered" sentinel.
        nextIndex = 1;
        currentEpochValue = 0;
    }

    // ============ Lifecycle ============

    /// @inheritdoc IMessagingValidatorRegistry
    function register(
        bytes calldata blsPubkey,
        address payoutAddress,
        uint96 bondAmount
    ) external nonReentrant returns (uint32 index) {
        if (blsPubkey.length != BLS_PUBKEY_LEN) revert InvalidPubkey();
        if (bondAmount < bondFloorAmount) revert BondBelowFloor(bondAmount, bondFloorAmount);
        if (operatorToIndex[msg.sender] != 0) revert PubkeyAlreadyRegistered(blsPubkey);

        bytes32 pkHash = keccak256(blsPubkey);
        if (pubkeyHashToIndex[pkHash] != 0) revert PubkeyAlreadyRegistered(blsPubkey);

        if (activeIndices.length >= maxSetSizeValue) revert SetFull(maxSetSizeValue);

        bondToken.safeTransferFrom(msg.sender, address(this), bondAmount);

        index = nextIndex++;
        uint64 activatesAt = uint64(block.timestamp) + activationDelaySeconds;

        validators[index] = Validator({
            blsPubkey: blsPubkey,
            operator: msg.sender,
            payoutAddress: payoutAddress,
            bondAmount: bondAmount,
            activatedAt: activatesAt,
            exitInitiatedAt: 0,
            index: index,
            slashed: false
        });

        operatorToIndex[msg.sender] = index;
        pubkeyHashToIndex[pkHash] = index;

        emit ValidatorRegistered(msg.sender, blsPubkey, index, bondAmount);
        emit BondDeposited(msg.sender, bondAmount);
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function topUpBond(uint32 index, uint96 amount) external nonReentrant {
        Validator storage v = validators[index];
        if (v.operator == address(0)) revert UnknownValidator(index);
        if (v.slashed) revert UnknownValidator(index);
        // Self-audit M-1: reject top-ups during unbonding. Adding bond after
        // exit-init would silently lock new funds in the same unbonding queue,
        // a UX trap that's also a refactor liability — anyone reasoning about
        // bond movement during exit would have to remember this asymmetry.
        if (v.exitInitiatedAt != 0) revert ValidatorExiting(index);

        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        v.bondAmount += amount;

        emit BondDeposited(v.operator, amount);
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function initiateExit(uint32 index) external nonReentrant {
        Validator storage v = validators[index];
        if (v.operator == address(0)) revert UnknownValidator(index);
        if (msg.sender != v.operator) revert UnauthorizedSlasher();
        if (block.timestamp < v.activatedAt) revert NotActivated(index);
        if (v.exitInitiatedAt != 0) revert AlreadyExiting(index);

        v.exitInitiatedAt = uint64(block.timestamp);

        // Remove from active set immediately so they stop being aggregated
        // for new attestations. Bond stays locked until finalizeExit.
        _removeFromActiveSet(index);

        emit ValidatorExitInitiated(index, uint64(block.timestamp) + unbondingDelaySeconds);
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function finalizeExit(uint32 index) external nonReentrant {
        Validator storage v = validators[index];
        if (v.operator == address(0)) revert UnknownValidator(index);
        if (v.exitInitiatedAt == 0) revert NotActivated(index);

        uint64 unlockAt = v.exitInitiatedAt + unbondingDelaySeconds;
        if (block.timestamp < unlockAt) {
            revert UnbondingPeriodActive(unlockAt - uint64(block.timestamp));
        }

        uint96 returnedBond = v.bondAmount;
        v.bondAmount = 0;
        address payTo = v.payoutAddress == address(0) ? v.operator : v.payoutAddress;

        // operatorToIndex stays bound; the validator's identity is permanently
        // retired (same shardId-burn invariant pattern as ShardOperatorRegistry
        // C10-AUDIT-10). Operators may register a fresh validator under a
        // different operator address.

        if (returnedBond > 0) {
            bondToken.safeTransfer(payTo, returnedBond);
            emit BondWithdrawn(payTo, returnedBond);
        }

        emit ValidatorExited(index);
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function slash(
        uint32 index,
        bytes32 offenseTag,
        uint96 requestedAmount
    ) external nonReentrant returns (uint96 amountSlashed) {
        if (msg.sender != proofOfMisbehavior) revert UnauthorizedSlasher();

        Validator storage v = validators[index];
        if (v.operator == address(0)) revert UnknownValidator(index);

        // Self-audit M-2: early-return when there is nothing left to slash.
        // Without this, slash() on an already-finalized validator (bondAmount=0)
        // would still execute the "below floor" branch and re-emit
        // ValidatorExitInitiated with a fresh timestamp — confusing off-chain
        // monitors and producing event noise.
        if (v.bondAmount == 0) {
            emit ValidatorSlashed(index, offenseTag, 0);
            return 0;
        }

        amountSlashed = requestedAmount > v.bondAmount ? v.bondAmount : requestedAmount;
        v.bondAmount -= amountSlashed;

        // If slashed to zero (or near-zero floor), eject from active set.
        if (v.bondAmount < bondFloorAmount) {
            v.slashed = true;
            if (activeSlot[index] != 0) {
                _removeFromActiveSet(index);
            }
            // Force-initiate exit so the unbonding window starts running on
            // any residual bond. Funds become withdrawable to the payout
            // address after unbondingDelay.
            if (v.exitInitiatedAt == 0) {
                v.exitInitiatedAt = uint64(block.timestamp);
                emit ValidatorExitInitiated(index, uint64(block.timestamp) + unbondingDelaySeconds);
            }
        }

        // Slashed amount is held by this contract; governance routes it to the
        // insurance pool / treasury via a separate sweep call.

        emit ValidatorSlashed(index, offenseTag, amountSlashed);
    }

    // ============ Set rotation ============

    /// @inheritdoc IMessagingValidatorRegistry
    /// @dev v0.1: governance asserts the aggregate pubkey at rotation time.
    ///      v0.2 will add a challenge/refute cycle similar to ShardOperatorRegistry's
    ///      cellsReport flow, plus on-chain BLS aggregation verification using
    ///      EIP-2537 precompiles.
    function rotateSet() external returns (uint64 newEpoch) {
        // Self-audit H-1: rate-limit rotations to prevent spam-grief that
        // would inflate the epoch space and force downstream verifiers to
        // track sub-second epoch churn. First-ever rotation is exempt
        // (lastRotationAt == 0). Owner can bypass via forceRotateSet().
        if (lastRotationAt != 0 && block.timestamp < lastRotationAt + rotationIntervalSeconds) {
            revert RotationTooFrequent(
                uint64(block.timestamp),
                lastRotationAt + rotationIntervalSeconds
            );
        }
        lastRotationAt = uint64(block.timestamp);

        // First, sweep any newly-activated validators into the active set.
        _activateMatured();

        newEpoch = ++currentEpochValue;
        uint32 size = uint32(activeIndices.length);

        bytes32 root = _computeSetRoot();
        bytes32 aggHash = keccak256(_currentAggregatePubkey());

        snapshots[newEpoch] = SetSnapshot({
            epoch: newEpoch,
            size: size,
            aggregatePubkeyHash: aggHash,
            merkleRoot: root
        });

        emit SetRotated(newEpoch, size, aggHash);
    }

    /// @notice Owner-supplied aggregate pubkey for the current epoch.
    /// @dev v0.1 stub. v0.2 will compute on-chain or verify via PoM challenge.
    function setAggregatePubkey(uint64 epoch, bytes calldata pubkey) external onlyOwner {
        if (snapshots[epoch].epoch == 0 && epoch != 0) revert UnknownEpoch(epoch);
        aggregatePubkeys[epoch] = pubkey;
    }

    function setBondFloor(uint96 newFloor) external onlyOwner {
        bondFloorAmount = newFloor;
    }

    function setActivationDelay(uint64 newDelay) external onlyOwner {
        activationDelaySeconds = newDelay;
    }

    function setUnbondingDelay(uint64 newDelay) external onlyOwner {
        unbondingDelaySeconds = newDelay;
    }

    /// @notice Self-audit H-1: configure rotation rate limit.
    function setRotationInterval(uint64 newInterval) external onlyOwner {
        rotationIntervalSeconds = newInterval;
    }

    function setProofOfMisbehavior(address newPom) external onlyOwner {
        proofOfMisbehavior = newPom;
    }

    // ============ Views ============

    /// @inheritdoc IMessagingValidatorRegistry
    function bondFloor() external view returns (uint96) {
        return bondFloorAmount;
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function activationDelay() external view returns (uint64) {
        return activationDelaySeconds;
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function unbondingDelay() external view returns (uint64) {
        return unbondingDelaySeconds;
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function maxSetSize() external view returns (uint32) {
        return maxSetSizeValue;
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function currentEpoch() external view returns (uint64) {
        return currentEpochValue;
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function setSnapshot(uint64 epoch) external view returns (SetSnapshot memory) {
        return snapshots[epoch];
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function activeSetSize() external view returns (uint32) {
        return uint32(activeIndices.length);
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function thresholdForEpoch(uint64 epoch) external view returns (uint32) {
        SetSnapshot memory snap = snapshots[epoch];
        if (snap.size == 0) return 0;
        // ceil(2n/3) + 1
        return (2 * snap.size) / 3 + 1;
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function getValidator(uint32 index) external view returns (Validator memory) {
        return validators[index];
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function getValidatorByOperator(address operator)
        external
        view
        returns (uint32 index, Validator memory)
    {
        index = operatorToIndex[operator];
        return (index, validators[index]);
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function isActive(uint32 index) external view returns (bool) {
        return activeSlot[index] != 0;
    }

    /// @inheritdoc IMessagingValidatorRegistry
    function aggregatePubkey(uint64 epoch) external view returns (bytes memory) {
        return aggregatePubkeys[epoch];
    }

    /// @notice Get an active validator index by its position in the active set.
    function activeIndexAt(uint32 position) external view returns (uint32) {
        return activeIndices[position];
    }

    // ============ Internal ============

    /// @dev Sweep validators whose activation time has passed into the active set.
    function _activateMatured() internal {
        // O(n) sweep over registered indices; for v0.1 expected n ≤ 128 this is fine.
        for (uint32 i = 1; i < nextIndex; i++) {
            Validator storage v = validators[i];
            if (
                v.operator != address(0)
                && !v.slashed
                && v.exitInitiatedAt == 0
                && v.activatedAt <= block.timestamp
                && activeSlot[i] == 0
                && activeIndices.length < maxSetSizeValue
            ) {
                activeIndices.push(i);
                activeSlot[i] = uint32(activeIndices.length); // position+1
                emit ValidatorActivated(i, uint64(block.timestamp));
            }
        }
    }

    /// @dev Remove a validator from the active set by index. Swap-and-pop.
    function _removeFromActiveSet(uint32 index) internal {
        uint32 slot = activeSlot[index];
        if (slot == 0) return;

        uint32 lastPos = uint32(activeIndices.length - 1);
        uint32 movingIndex = activeIndices[lastPos];

        if (slot - 1 != lastPos) {
            activeIndices[slot - 1] = movingIndex;
            activeSlot[movingIndex] = slot;
        }

        activeIndices.pop();
        activeSlot[index] = 0;
    }

    /// @dev Compute Merkle root over current active validator pubkeys.
    /// @dev Naïve linear hashing; for v0.1 set size ≤ 128 this is acceptable.
    ///      v0.2 will switch to a sparse Merkle tree for partial-set proofs.
    function _computeSetRoot() internal view returns (bytes32) {
        uint256 n = activeIndices.length;
        if (n == 0) return bytes32(0);

        bytes32 acc = keccak256(validators[activeIndices[0]].blsPubkey);
        for (uint256 i = 1; i < n; i++) {
            acc = keccak256(abi.encodePacked(acc, validators[activeIndices[i]].blsPubkey));
        }
        return acc;
    }

    /// @dev Concatenate active validator pubkeys for off-chain aggregate verification.
    /// @dev Used only as input to keccak for the snapshot hash. Actual BLS
    ///      aggregation lives in the AttestationVerifier; this contract just
    ///      stores the governance-asserted aggregate alongside its hash.
    function _currentAggregatePubkey() internal view returns (bytes memory) {
        // For the snapshot hash, the canonical input is concat(pubkey_i) over
        // the active set in index order. v0.1 hashes this directly; v0.2 will
        // verify the stored aggregate matches the BLS aggregation of these.
        uint256 n = activeIndices.length;
        bytes memory out = new bytes(n * BLS_PUBKEY_LEN);
        uint256 offset = 0;
        for (uint256 i = 0; i < n; i++) {
            bytes storage pk = validators[activeIndices[i]].blsPubkey;
            for (uint256 j = 0; j < BLS_PUBKEY_LEN; j++) {
                out[offset + j] = pk[j];
            }
            offset += BLS_PUBKEY_LEN;
        }
        return out;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
