// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoMOperatorRegistry} from "./interfaces/IPoMOperatorRegistry.sol";

/**
 * @title PoMOperatorRegistry
 * @notice Bonded-operator set for the PoM-on-ETH optimistic export layer.
 *
 *         Lean address-keyed fork of MessagingValidatorRegistry. Proposers and
 *         challengers bond here; the hub (as `slasher`) burns bond from whoever
 *         loses a dispute. No BLS, no epochs, no signer quorum — this design's
 *         security comes from the optimistic game, not from an M-of-N vouch.
 *
 *         Same lifecycle guarantees as the messaging registry it forks:
 *           - activation delay (Sybil resistance / churn time-lock)
 *           - unbonding delay (must outlive any in-flight challenge)
 *           - slash ejects below the floor and force-starts the unbonding clock
 */
contract PoMOperatorRegistry is
    IPoMOperatorRegistry,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint96 public constant DEFAULT_BOND_FLOOR = 1 ether;
    uint64 public constant DEFAULT_ACTIVATION_DELAY = 1 days;
    uint64 public constant DEFAULT_UNBONDING_DELAY = 7 days;

    // ============ Storage ============

    IERC20 public bondToken;
    /// @notice Authorized to slash — the PoMExportHub (dispute outcomes route here).
    address public slasher;

    uint96 public bondFloorAmount;
    uint64 public activationDelaySeconds;
    uint64 public unbondingDelaySeconds;

    /// @notice Accumulated slashed bond held by this contract, awaiting governance sweep.
    uint96 public slashedPool;

    mapping(address => Operator) internal operators;

    uint256[44] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _bondToken, address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        bondToken = IERC20(_bondToken);
        bondFloorAmount = DEFAULT_BOND_FLOOR;
        activationDelaySeconds = DEFAULT_ACTIVATION_DELAY;
        unbondingDelaySeconds = DEFAULT_UNBONDING_DELAY;
    }

    // ============ Admin ============

    function setSlasher(address newSlasher) external onlyOwner {
        slasher = newSlasher;
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

    /// @notice Route accumulated slashed bond to governance (insurance pool / treasury).
    function sweepSlashed(address to) external onlyOwner {
        uint96 amount = slashedPool;
        slashedPool = 0;
        if (amount > 0) {
            bondToken.safeTransfer(to, amount);
            emit SlashedPoolSwept(to, amount);
        }
    }

    // ============ Lifecycle ============

    /// @inheritdoc IPoMOperatorRegistry
    function register(address payoutAddress, uint96 bondAmount)
        external
        nonReentrant
        returns (uint64 activatesAt)
    {
        if (bondAmount < bondFloorAmount) revert BondBelowFloor(bondAmount, bondFloorAmount);
        Operator storage o = operators[msg.sender];
        if (o.operator != address(0)) revert AlreadyRegistered(msg.sender);

        bondToken.safeTransferFrom(msg.sender, address(this), bondAmount);

        activatesAt = uint64(block.timestamp) + activationDelaySeconds;
        operators[msg.sender] = Operator({
            operator: msg.sender,
            payoutAddress: payoutAddress,
            bondAmount: bondAmount,
            activatedAt: activatesAt,
            exitInitiatedAt: 0,
            slashed: false
        });

        emit OperatorRegistered(msg.sender, payoutAddress, bondAmount);
        emit BondDeposited(msg.sender, bondAmount);
    }

    /// @inheritdoc IPoMOperatorRegistry
    function topUpBond(uint96 amount) external nonReentrant {
        Operator storage o = operators[msg.sender];
        if (o.operator == address(0) || o.slashed) revert UnknownOperator(msg.sender);
        // Mirror MessagingValidatorRegistry M-1: no top-ups mid-exit (funds would
        // silently join the unbonding queue — a UX trap and refactor liability).
        if (o.exitInitiatedAt != 0) revert OperatorIsExiting(msg.sender);

        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        o.bondAmount += amount;
        emit BondDeposited(msg.sender, amount);
    }

    /// @inheritdoc IPoMOperatorRegistry
    function initiateExit() external nonReentrant {
        Operator storage o = operators[msg.sender];
        if (o.operator == address(0)) revert UnknownOperator(msg.sender);
        if (block.timestamp < o.activatedAt) revert NotActivated(msg.sender);
        if (o.exitInitiatedAt != 0) revert AlreadyExiting(msg.sender);

        o.exitInitiatedAt = uint64(block.timestamp);
        emit OperatorExitInitiated(msg.sender, uint64(block.timestamp) + unbondingDelaySeconds);
    }

    /// @inheritdoc IPoMOperatorRegistry
    function finalizeExit() external nonReentrant {
        Operator storage o = operators[msg.sender];
        if (o.operator == address(0)) revert UnknownOperator(msg.sender);
        if (o.exitInitiatedAt == 0) revert NotActivated(msg.sender);

        uint64 unlockAt = o.exitInitiatedAt + unbondingDelaySeconds;
        if (block.timestamp < unlockAt) {
            revert UnbondingPeriodActive(unlockAt - uint64(block.timestamp));
        }

        uint96 returnedBond = o.bondAmount;
        address payTo = o.payoutAddress == address(0) ? o.operator : o.payoutAddress;
        delete operators[msg.sender];

        if (returnedBond > 0) {
            bondToken.safeTransfer(payTo, returnedBond);
            emit BondWithdrawn(payTo, returnedBond);
        }
        emit OperatorExited(msg.sender);
    }

    /// @inheritdoc IPoMOperatorRegistry
    function slash(address operator, bytes32 offenseTag, uint96 requestedAmount)
        external
        nonReentrant
        returns (uint96 amountSlashed)
    {
        if (msg.sender != slasher) revert UnauthorizedSlasher();

        Operator storage o = operators[operator];
        if (o.operator == address(0)) revert UnknownOperator(operator);

        // Nothing left to slash: emit for monitors, no-op.
        if (o.bondAmount == 0) {
            emit OperatorSlashed(operator, offenseTag, 0);
            return 0;
        }

        amountSlashed = requestedAmount > o.bondAmount ? o.bondAmount : requestedAmount;
        o.bondAmount -= amountSlashed;
        slashedPool += amountSlashed;

        if (o.bondAmount < bondFloorAmount) {
            o.slashed = true;
            if (o.exitInitiatedAt == 0) {
                o.exitInitiatedAt = uint64(block.timestamp);
                emit OperatorExitInitiated(operator, uint64(block.timestamp) + unbondingDelaySeconds);
            }
        }

        emit OperatorSlashed(operator, offenseTag, amountSlashed);
    }

    /// @inheritdoc IPoMOperatorRegistry
    /// @dev Same slashing lifecycle as `slash`, plus a `beneficiaryBps` slice of the slashed bond
    ///      routed to `beneficiary`. The hub uses this to compensate a winning challenger from the
    ///      loser's BOND at genesis, when the MIND security budget is still empty. CEI: all state
    ///      effects (bond debit, eject-below-floor, pool credit) commit before the external transfer.
    function slashToBeneficiary(
        address operator,
        bytes32 offenseTag,
        uint96 requestedAmount,
        address beneficiary,
        uint16 beneficiaryBps
    ) external nonReentrant returns (uint96 amountSlashed, uint96 toBeneficiary) {
        if (msg.sender != slasher) revert UnauthorizedSlasher();
        if (beneficiaryBps > 10_000) revert BeneficiaryBpsTooHigh(beneficiaryBps);

        Operator storage o = operators[operator];
        if (o.operator == address(0)) revert UnknownOperator(operator);

        // Nothing left to slash: emit for monitors, no-op.
        if (o.bondAmount == 0) {
            emit OperatorSlashed(operator, offenseTag, 0);
            return (0, 0);
        }

        amountSlashed = requestedAmount > o.bondAmount ? o.bondAmount : requestedAmount;
        o.bondAmount -= amountSlashed;

        // Split: a slice to the beneficiary, the remainder to the governance pool. If no
        // beneficiary is set, the whole slashed amount folds into the pool (never stranded).
        toBeneficiary = uint96((uint256(amountSlashed) * beneficiaryBps) / 10_000);
        if (beneficiary == address(0)) toBeneficiary = 0;
        slashedPool += amountSlashed - toBeneficiary;

        if (o.bondAmount < bondFloorAmount) {
            o.slashed = true;
            if (o.exitInitiatedAt == 0) {
                o.exitInitiatedAt = uint64(block.timestamp);
                emit OperatorExitInitiated(operator, uint64(block.timestamp) + unbondingDelaySeconds);
            }
        }

        emit OperatorSlashed(operator, offenseTag, amountSlashed);

        // External interaction last (CEI + nonReentrant).
        if (toBeneficiary > 0) {
            bondToken.safeTransfer(beneficiary, toBeneficiary);
            emit BondSlicePaid(operator, beneficiary, toBeneficiary);
        }
    }

    // ============ Views ============

    /// @inheritdoc IPoMOperatorRegistry
    function isActive(address operator) public view returns (bool) {
        Operator storage o = operators[operator];
        return o.operator != address(0)
            && !o.slashed
            && o.exitInitiatedAt == 0
            && o.activatedAt <= block.timestamp
            && o.bondAmount >= bondFloorAmount;
    }

    /// @inheritdoc IPoMOperatorRegistry
    function bondOf(address operator) external view returns (uint96) {
        return operators[operator].bondAmount;
    }

    /// @inheritdoc IPoMOperatorRegistry
    function payoutOf(address operator) external view returns (address) {
        Operator storage o = operators[operator];
        return o.payoutAddress == address(0) ? o.operator : o.payoutAddress;
    }

    /// @inheritdoc IPoMOperatorRegistry
    function getOperator(address operator) external view returns (Operator memory) {
        return operators[operator];
    }

    /// @inheritdoc IPoMOperatorRegistry
    function bondFloor() external view returns (uint96) {
        return bondFloorAmount;
    }

    /// @inheritdoc IPoMOperatorRegistry
    function activationDelay() external view returns (uint64) {
        return activationDelaySeconds;
    }

    /// @inheritdoc IPoMOperatorRegistry
    function unbondingDelay() external view returns (uint64) {
        return unbondingDelaySeconds;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
