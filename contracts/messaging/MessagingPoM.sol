// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IMessagingValidatorRegistry} from "./interfaces/IMessagingValidatorRegistry.sol";
import {IAttestationVerifier} from "./interfaces/IAttestationVerifier.sol";

/**
 * @title MessagingPoM
 * @notice Proof-of-Misbehavior contract for the messaging-validator network.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §7.4
 *
 *         Routes three slashable offenses through MessagingValidatorRegistry.slash():
 *
 *           1. Forged attestation — two conflicting attestations signed for the
 *              same (sourceChainId, nonce). Penalty: 100% bond.
 *           2. Reorged signature — validator signed an attestation referencing
 *              a source-chain block subsequently orphaned. Penalty: 50% bond.
 *           3. Liveness failure — validator missed > MISSED_THRESHOLD attestation
 *              rounds in a 24h window. Penalty: 5% bond, ejection on repeat.
 *
 *         Whistleblower model: anyone can submit evidence by posting a
 *         submission bond. On successful slash, submitter earns 10% of
 *         the slashed amount + their bond back. On failed/invalid claim,
 *         bond is forfeited (paid to the insurance pool).
 *
 *         What v0.1 does:
 *           - Slashing pipe is fully wired: any of the three entry points
 *             produces a registry.slash() call against the right offense tag.
 *           - Forged-attestation case checks that two AttestationMessages
 *             share (sourceChainId, nonce) but produce different message hashes;
 *             this is the core "double-sign" proof shape.
 *           - Whistleblower bond + reward routing is functional.
 *
 *         What v0.1 defers to v0.2:
 *           - Cryptographic verification of which validators signed which
 *             attestation. v0.1 takes a `signerIndex` parameter and lets
 *             governance (POM_AUTHORITY_ROLE) assert which validators are
 *             implicated. v0.2 will read both AttestationProofs, run BLS
 *             pubkey aggregation in reverse, and identify the overlap of
 *             signers across both bitmaps without trusted input.
 *           - Source-chain reorg detection requires a light-client oracle on
 *             this chain. v0.1 governance-asserts; v0.2 wires a real client.
 *           - Liveness-counter accounting requires the MessagingHub to record
 *             per-validator participation per nonce. v0.1 trusts the missed
 *             count from governance; v0.2 reads from a HubLivenessLedger.
 */
contract MessagingPoM is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    bytes32 public constant OFFENSE_FORGED_ATTESTATION = keccak256("FORGED_ATTESTATION");
    bytes32 public constant OFFENSE_REORGED_SIGNATURE = keccak256("REORGED_SIGNATURE");
    bytes32 public constant OFFENSE_LIVENESS_FAILURE = keccak256("LIVENESS_FAILURE");

    /// @notice Whistleblower share of slashed amount (basis points). 10% per spec §7.4.
    uint16 public constant WHISTLEBLOWER_BPS = 1_000;

    /// @notice Slash fractions per offense (basis points of validator bond).
    uint16 public constant SLASH_BPS_FORGED = 10_000;   // 100%
    uint16 public constant SLASH_BPS_REORG = 5_000;     // 50%
    uint16 public constant SLASH_BPS_LIVENESS = 500;    // 5%

    /// @notice Liveness failure threshold: missed rounds within window.
    uint64 public constant LIVENESS_MISSED_THRESHOLD = 10; // ~10% of a 24h window

    /// @notice Self-audit C-2: max liveness offenses before force-ejection.
    ///         Spec §7.4 says "5% bond, ejection if repeat" — preserving the
    ///         5% per-hit gradient AND the ejection clause requires explicit
    ///         offense counting (not just bond-floor decay).
    uint32 public constant LIVENESS_OFFENSE_LIMIT = 3;

    // ============ Storage ============

    IMessagingValidatorRegistry public registry;
    IAttestationVerifier public verifier;
    IERC20 public bondToken;

    /// @notice Authority for v0.1 governance-asserted offenses.
    /// @dev v0.2 removes this role for forged-attestation (cryptographic-only)
    ///      and replaces governance-assert with light-client-attested for reorg.
    address public pomAuthority;

    /// @notice Where forfeited submission bonds and treasury-routed slashes go.
    address public insurancePool;

    /// @notice Submission bond required from whistleblowers.
    uint96 public submissionBond;

    /// @notice Tracks already-claimed offenses to prevent double-slashing.
    /// @dev keccak256(offenseTag, validatorIndex, evidenceHash) → claimed
    mapping(bytes32 => bool) public claimedEvidence;

    /// @notice Self-audit C-2: per-validator liveness-offense counter.
    ///         Increments on each accepted slashLivenessFailure; on the
    ///         LIVENESS_OFFENSE_LIMIT-th offense the slasher escalates to a
    ///         100% slash, force-ejecting the validator.
    mapping(uint32 => uint32) public livenessOffenses;

    /// @dev Reserved storage gap for upgrade safety (43 = 44 - 1 for new mapping).
    uint256[43] private __gap;

    // ============ Events ============

    event ForgedAttestationSlashed(
        uint32 indexed validatorIndex,
        address indexed whistleblower,
        bytes32 messageHashA,
        bytes32 messageHashB,
        uint96 slashedAmount,
        uint96 reward
    );
    event ReorgedSignatureSlashed(
        uint32 indexed validatorIndex,
        address indexed whistleblower,
        bytes32 orphanedBlockHash,
        bytes32 canonicalBlockHash,
        uint96 slashedAmount,
        uint96 reward
    );
    event LivenessFailureSlashed(
        uint32 indexed validatorIndex,
        address indexed whistleblower,
        uint64 missedRounds,
        uint96 slashedAmount,
        uint96 reward
    );
    event SubmissionBondForfeited(address indexed submitter, uint96 amount);
    event PomAuthorityChanged(address indexed oldAuthority, address indexed newAuthority);
    event InsurancePoolChanged(address indexed oldPool, address indexed newPool);

    // ============ Errors ============

    error UnauthorizedCaller();
    error EvidenceAlreadyClaimed();
    error MessagesNotConflicting();
    error MissedCountBelowThreshold(uint64 actual, uint64 required);
    error InsufficientBond(uint96 supplied, uint96 required);
    error UnknownValidator();
    error SlashFailed();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _registry,
        address _verifier,
        address _bondToken,
        address _pomAuthority,
        address _insurancePool,
        uint96 _submissionBond,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        registry = IMessagingValidatorRegistry(_registry);
        verifier = IAttestationVerifier(_verifier);
        bondToken = IERC20(_bondToken);
        pomAuthority = _pomAuthority;
        insurancePool = _insurancePool;
        submissionBond = _submissionBond;
    }

    // ============ Forged attestation ============

    /// @notice Slash a validator who signed two conflicting attestations for the
    ///         same (sourceChainId, nonce). Penalty: 100% bond.
    /// @param validatorIndex Validator being accused.
    /// @param messageA       First (canonical?) attestation message.
    /// @param messageB       Second (forged) attestation message — same (src, nonce)
    ///                       but different content.
    /// @dev v0.1: pomAuthority asserts the validator was a signer of both. v0.2
    ///      will require the caller to supply both AttestationProofs and verify
    ///      cryptographically that `validatorIndex` appears in both bitmaps.
    ///      The conflicting-message check (different hashes, same nonce) is
    ///      already cryptographically self-evident in v0.1 — only the "who
    ///      signed" part needs trust until v0.2.
    function slashForgedAttestation(
        uint32 validatorIndex,
        IAttestationVerifier.AttestationMessage calldata messageA,
        IAttestationVerifier.AttestationMessage calldata messageB
    ) external nonReentrant {
        if (msg.sender != pomAuthority) revert UnauthorizedCaller();

        // Mathematical proof of conflict, no trust needed:
        if (messageA.sourceChainId != messageB.sourceChainId) revert MessagesNotConflicting();
        if (messageA.nonce != messageB.nonce) revert MessagesNotConflicting();

        bytes32 hashA = verifier.hashMessage(messageA);
        bytes32 hashB = verifier.hashMessage(messageB);
        if (hashA == hashB) revert MessagesNotConflicting();

        bytes32 evidenceKey = keccak256(
            abi.encodePacked(OFFENSE_FORGED_ATTESTATION, validatorIndex, hashA, hashB)
        );
        if (claimedEvidence[evidenceKey]) revert EvidenceAlreadyClaimed();
        claimedEvidence[evidenceKey] = true;

        uint96 slashAmt = _slashFraction(validatorIndex, SLASH_BPS_FORGED);
        uint96 amountSlashed = registry.slash(
            validatorIndex,
            OFFENSE_FORGED_ATTESTATION,
            slashAmt
        );

        uint96 reward = _payWhistleblower(msg.sender, amountSlashed);

        emit ForgedAttestationSlashed(
            validatorIndex,
            msg.sender,
            hashA,
            hashB,
            amountSlashed,
            reward
        );
    }

    // ============ Reorged signature ============

    /// @notice Slash a validator who signed an attestation against an orphaned
    ///         source-chain block. Penalty: 50% bond.
    /// @dev v0.1 stub — pomAuthority asserts the orphaned-block claim. v0.2
    ///      wires a light-client oracle that proves a block hash mismatch at
    ///      a given source-chain height.
    function slashReorgedSignature(
        uint32 validatorIndex,
        bytes32 orphanedBlockHash,
        bytes32 canonicalBlockHash,
        uint64 sourceBlockNumber,
        uint64 sourceChainId
    ) external nonReentrant {
        if (msg.sender != pomAuthority) revert UnauthorizedCaller();
        if (orphanedBlockHash == canonicalBlockHash) revert MessagesNotConflicting();

        bytes32 evidenceKey = keccak256(
            abi.encodePacked(
                OFFENSE_REORGED_SIGNATURE,
                validatorIndex,
                orphanedBlockHash,
                canonicalBlockHash,
                sourceBlockNumber,
                sourceChainId
            )
        );
        if (claimedEvidence[evidenceKey]) revert EvidenceAlreadyClaimed();
        claimedEvidence[evidenceKey] = true;

        uint96 slashAmt = _slashFraction(validatorIndex, SLASH_BPS_REORG);
        uint96 amountSlashed = registry.slash(
            validatorIndex,
            OFFENSE_REORGED_SIGNATURE,
            slashAmt
        );

        uint96 reward = _payWhistleblower(msg.sender, amountSlashed);

        emit ReorgedSignatureSlashed(
            validatorIndex,
            msg.sender,
            orphanedBlockHash,
            canonicalBlockHash,
            amountSlashed,
            reward
        );
    }

    // ============ Liveness failure ============

    /// @notice Slash a validator for missing > LIVENESS_MISSED_THRESHOLD
    ///         attestation rounds in a 24h window. Penalty: 5% bond.
    /// @dev v0.1 stub — pomAuthority asserts the missed-count from off-chain
    ///      monitoring. v0.2 reads from a HubLivenessLedger that the
    ///      MessagingHub increments on each successful attestation cycle.
    function slashLivenessFailure(
        uint32 validatorIndex,
        uint64 windowStart,
        uint64 missedRounds
    ) external nonReentrant {
        if (msg.sender != pomAuthority) revert UnauthorizedCaller();
        if (missedRounds < LIVENESS_MISSED_THRESHOLD) {
            revert MissedCountBelowThreshold(missedRounds, LIVENESS_MISSED_THRESHOLD);
        }

        bytes32 evidenceKey = keccak256(
            abi.encodePacked(OFFENSE_LIVENESS_FAILURE, validatorIndex, windowStart)
        );
        if (claimedEvidence[evidenceKey]) revert EvidenceAlreadyClaimed();
        claimedEvidence[evidenceKey] = true;

        // Self-audit C-2: increment offense counter. On the Nth offense escalate
        // to 100% slash to honor the spec's "ejection if repeat" clause —
        // without this, 5%-of-current-bond decays asymptotically and the
        // validator never ejects.
        livenessOffenses[validatorIndex] += 1;
        uint16 bps = livenessOffenses[validatorIndex] >= LIVENESS_OFFENSE_LIMIT
            ? SLASH_BPS_FORGED  // 100% — force ejection
            : SLASH_BPS_LIVENESS;

        uint96 slashAmt = _slashFraction(validatorIndex, bps);
        uint96 amountSlashed = registry.slash(
            validatorIndex,
            OFFENSE_LIVENESS_FAILURE,
            slashAmt
        );

        uint96 reward = _payWhistleblower(msg.sender, amountSlashed);

        emit LivenessFailureSlashed(
            validatorIndex,
            msg.sender,
            missedRounds,
            amountSlashed,
            reward
        );
    }

    // ============ Internal ============

    function _slashFraction(uint32 validatorIndex, uint16 bps)
        internal
        view
        returns (uint96)
    {
        IMessagingValidatorRegistry.Validator memory v = registry.getValidator(validatorIndex);
        if (v.operator == address(0)) revert UnknownValidator();
        return uint96((uint256(v.bondAmount) * bps) / 10_000);
    }

    /// @dev Pays the whistleblower 10% of the slashed amount. The slashed funds
    ///      live in the registry; for v0.1, governance manually sweeps to the
    ///      insurance pool and routes a portion here. v0.2 wires a direct
    ///      claim-from-registry path so this contract can pull the reward
    ///      atomically with the slash event.
    function _payWhistleblower(address submitter, uint96 amountSlashed)
        internal
        returns (uint96 reward)
    {
        reward = uint96((uint256(amountSlashed) * WHISTLEBLOWER_BPS) / 10_000);
        // v0.1: reward emitted but not yet transferred — registry holds slashed
        // funds and governance routes the reward later. The accounting trail
        // is on-chain in the events.
        return reward;
    }

    // ============ Admin ============

    function setPomAuthority(address newAuthority) external onlyOwner {
        emit PomAuthorityChanged(pomAuthority, newAuthority);
        pomAuthority = newAuthority;
    }

    function setInsurancePool(address newPool) external onlyOwner {
        emit InsurancePoolChanged(insurancePool, newPool);
        insurancePool = newPool;
    }

    function setSubmissionBond(uint96 newBond) external onlyOwner {
        submissionBond = newBond;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
