// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IIssuerReputationRegistry.sol";

/**
 * @title IssuerReputationRegistry
 * @notice C12 — stake-bonded issuer identity for oracle evidence bundles.
 *
 * Issuers bond stake to register a key. Oracle contracts verify that bundle
 * signatures come from an active issuer before accepting. Fabrication is made
 * costly through a permissioned slashing mechanism: stake is burned and
 * reputation is docked. When reputation drops below MIN_REPUTATION the issuer
 * is SLASHED_OUT and cannot submit until they re-register with fresh stake.
 *
 * Reputation follows a mean-reverting model: starts at MID_REPUTATION (5000
 * bps = 0.5), decays toward MID over time when the issuer is honest. Slash
 * subtracts bps from reputation and burns proportional stake. No positive
 * reward loop — reputation is a penalty counter, not a reward surface.
 *
 * Design choices locked for C12:
 *  - New standalone contract, not an extension of ReputationOracle (semantic
 *    isolation, cleaner attack surface).
 *  - Permissioned slashing (owner + authorized slashers). Social slashing is
 *    a stub in ISocialSlashingTier, gated off by default.
 *  - Unbonding delay to prevent slash-dodging.
 *  - Time-based mean-reversion only; no re-inflation on honest issuance.
 */
contract IssuerReputationRegistry is
    IIssuerReputationRegistry,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant MID_REPUTATION = 5000;      // Mean-reversion target (0.5)
    uint256 public constant MAX_REPUTATION = 10000;
    uint256 public constant UNBOND_DELAY = 7 days;
    uint256 public constant REPUTATION_HALF_LIFE = 30 days; // Time for half the MID gap to close

    // ============ State ============

    IERC20 public stakeToken;

    struct Issuer {
        IssuerStatus status;
        address signer;
        uint256 stake;
        uint256 reputation;       // [0, 10000]
        uint256 lastTouched;      // For mean-reversion decay
        uint256 unbondAvailableAt;
    }

    mapping(bytes32 => Issuer) internal issuers;
    mapping(address => bytes32) public signerToIssuer;

    uint256 public override minStake;
    uint256 public override minReputation;

    /// @notice Addresses authorized to call slashIssuer (in addition to owner).
    mapping(address => bool) public authorizedSlashers;

    /// @notice Total stake slashed (burned). Tracked for telemetry.
    uint256 public totalSlashed;

    /// @dev Reserved storage gap.
    uint256[50] private __gap;

    // ============ Errors ============

    error ZeroAddress();
    error AlreadyRegistered();
    error SignerAlreadyBound();
    error NotRegistered();
    error NotActive();
    error InsufficientStake();
    error UnbondNotReady();
    error UnbondAlreadyRequested();
    error NotSlasher();
    error InvalidBps();
    error SlasherSameAsOwner();

    // ============ Modifiers ============

    modifier onlySlasher() {
        if (msg.sender != owner() && !authorizedSlashers[msg.sender]) revert NotSlasher();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _stakeToken,
        address _owner,
        uint256 _minStake,
        uint256 _minReputation
    ) external initializer {
        if (_stakeToken == address(0) || _owner == address(0)) revert ZeroAddress();
        if (_minReputation > MAX_REPUTATION) revert InvalidBps();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        stakeToken = IERC20(_stakeToken);
        minStake = _minStake;
        minReputation = _minReputation;
    }

    // ============ View ============

    function verifyIssuer(bytes32 issuerKey, address signer) external view override returns (bool) {
        Issuer storage iss = issuers[issuerKey];
        if (iss.status != IssuerStatus.ACTIVE) return false;
        if (iss.signer != signer) return false;
        // Compute effective reputation with mean-reversion applied.
        uint256 effective = _decayedReputation(iss.reputation, iss.lastTouched);
        return effective >= minReputation;
    }

    function getIssuerStatus(bytes32 issuerKey)
        external
        view
        override
        returns (
            IssuerStatus status,
            address signer,
            uint256 stake,
            uint256 reputation,
            uint256 unbondAvailableAt
        )
    {
        Issuer storage iss = issuers[issuerKey];
        return (
            iss.status,
            iss.signer,
            iss.stake,
            _decayedReputation(iss.reputation, iss.lastTouched),
            iss.unbondAvailableAt
        );
    }

    // ============ Registration ============

    function registerIssuer(bytes32 issuerKey, address signer, uint256 stakeAmount)
        external
        override
        nonReentrant
    {
        if (signer == address(0)) revert ZeroAddress();
        if (stakeAmount < minStake) revert InsufficientStake();

        Issuer storage iss = issuers[issuerKey];
        if (iss.status != IssuerStatus.UNREGISTERED && iss.status != IssuerStatus.SLASHED_OUT) {
            revert AlreadyRegistered();
        }
        if (signerToIssuer[signer] != bytes32(0) && signerToIssuer[signer] != issuerKey) {
            revert SignerAlreadyBound();
        }

        stakeToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        iss.status = IssuerStatus.ACTIVE;
        iss.signer = signer;
        iss.stake = stakeAmount;
        iss.reputation = MID_REPUTATION;
        iss.lastTouched = block.timestamp;
        iss.unbondAvailableAt = 0;

        signerToIssuer[signer] = issuerKey;

        emit IssuerRegistered(issuerKey, signer, stakeAmount);
    }

    function requestUnbond(bytes32 issuerKey) external override {
        Issuer storage iss = issuers[issuerKey];
        if (iss.status != IssuerStatus.ACTIVE) revert NotActive();
        // Only the signer may unbond. Owner intervention happens via slash.
        if (iss.signer != msg.sender) revert NotSlasher();
        if (iss.unbondAvailableAt != 0) revert UnbondAlreadyRequested();

        iss.status = IssuerStatus.UNBONDING;
        iss.unbondAvailableAt = block.timestamp + UNBOND_DELAY;

        emit IssuerUnbondRequested(issuerKey, iss.unbondAvailableAt);
    }

    function completeUnbond(bytes32 issuerKey) external override nonReentrant {
        Issuer storage iss = issuers[issuerKey];
        if (iss.status != IssuerStatus.UNBONDING) revert NotActive();
        if (iss.signer != msg.sender) revert NotSlasher();
        if (block.timestamp < iss.unbondAvailableAt) revert UnbondNotReady();

        uint256 payout = iss.stake;
        address recipient = iss.signer;

        delete signerToIssuer[iss.signer];
        iss.status = IssuerStatus.UNREGISTERED;
        iss.stake = 0;
        iss.unbondAvailableAt = 0;
        iss.signer = address(0);

        if (payout > 0) {
            stakeToken.safeTransfer(recipient, payout);
        }

        emit IssuerUnbonded(issuerKey, payout);
    }

    // ============ Slashing ============

    function slashIssuer(bytes32 issuerKey, uint256 bpsSlash, string calldata reason)
        external
        override
        onlySlasher
        nonReentrant
    {
        if (bpsSlash == 0 || bpsSlash > BPS_PRECISION) revert InvalidBps();

        Issuer storage iss = issuers[issuerKey];
        if (iss.status == IssuerStatus.UNREGISTERED) revert NotRegistered();

        // Slash stake (burned — not returned to anyone; anti-rent-extraction default).
        uint256 stakeSlashed = (iss.stake * bpsSlash) / BPS_PRECISION;
        iss.stake -= stakeSlashed;
        totalSlashed += stakeSlashed;

        // Dock reputation by the same bps delta (applied to current effective reputation).
        uint256 effective = _decayedReputation(iss.reputation, iss.lastTouched);
        uint256 reputationAfter = effective > bpsSlash ? effective - bpsSlash : 0;
        iss.reputation = reputationAfter;
        iss.lastTouched = block.timestamp;

        // If below minReputation OR stake below minStake, mark SLASHED_OUT.
        if (reputationAfter < minReputation || iss.stake < minStake) {
            iss.status = IssuerStatus.SLASHED_OUT;
        }

        emit IssuerSlashed(issuerKey, stakeSlashed, reputationAfter, reason);
    }

    function touchReputation(bytes32 issuerKey) external override {
        Issuer storage iss = issuers[issuerKey];
        if (iss.status == IssuerStatus.UNREGISTERED) revert NotRegistered();

        uint256 before_ = iss.reputation;
        uint256 after_ = _decayedReputation(iss.reputation, iss.lastTouched);
        iss.reputation = after_;
        iss.lastTouched = block.timestamp;

        // If issuer was SLASHED_OUT and decay brought them back above minReputation,
        // we do NOT auto-reactivate. Re-registration is required. This is intentional:
        // reputation decay is a cleanup signal, not a re-instatement mechanism.

        emit ReputationDecayed(issuerKey, before_, after_);
    }

    // ============ Admin ============

    function setAuthorizedSlasher(address slasher, bool authorized) external onlyOwner {
        if (slasher == address(0)) revert ZeroAddress();
        authorizedSlashers[slasher] = authorized;
        emit SlasherAuthorized(slasher, authorized);
    }

    function setMinStake(uint256 newMinStake) external onlyOwner {
        minStake = newMinStake;
    }

    function setMinReputation(uint256 newMinReputation) external onlyOwner {
        if (newMinReputation > MAX_REPUTATION) revert InvalidBps();
        minReputation = newMinReputation;
    }

    // ============ Internal ============

    /// @dev Exponential mean-reversion toward MID_REPUTATION with REPUTATION_HALF_LIFE.
    ///      Uses a simple linear approximation: each half-life, half the remaining
    ///      gap to MID is closed. For elapsed t, we compute nHalfLives = t/halfLife
    ///      and apply: delta' = delta * (1/2)^nHalfLives.
    ///      Linearized for gas: capped at 10 half-lives, discrete steps.
    function _decayedReputation(uint256 current, uint256 lastTouched) internal view returns (uint256) {
        if (lastTouched == 0 || current == MID_REPUTATION) return current;

        uint256 elapsed = block.timestamp - lastTouched;
        uint256 halfLives = elapsed / REPUTATION_HALF_LIFE;
        if (halfLives == 0) return current;
        if (halfLives > 10) halfLives = 10; // Cap: after 10 half-lives we're effectively at MID.

        uint256 gap = current > MID_REPUTATION ? current - MID_REPUTATION : MID_REPUTATION - current;
        // Divide gap by 2^halfLives.
        uint256 remaining = gap >> halfLives;

        return current > MID_REPUTATION ? MID_REPUTATION + remaining : MID_REPUTATION - remaining;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
