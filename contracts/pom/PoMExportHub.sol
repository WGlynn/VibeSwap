// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {IPoMExportHub} from "./interfaces/IPoMExportHub.sol";
import {IPoMOperatorRegistry} from "./interfaces/IPoMOperatorRegistry.sol";
import {PoMReward} from "./PoMReward.sol";

/**
 * @title PoMExportHub — "The DAO 2" optimistic PoM export consumer
 * @notice Consumes the off-chain `pom_export` reduction on an EVM chain WITHOUT a
 *         signer quorum, via an optimistic re-derivation game. See IPoMExportHub
 *         for the trust-boundary discussion.
 *
 *         Standings are serialized: at most one proposal is in flight at a time and
 *         each carries the monotonically-next nonce, so the "registry consumers
 *         read" is a single, totally-ordered, slowly-updating value — exactly the
 *         shape the export-layer design calls for (read, not a hot path).
 */
contract PoMExportHub is
    IPoMExportHub,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Offense tags ============

    bytes32 public constant OFFENSE_FALSE_PROPOSAL = keccak256("POM_FALSE_PROPOSAL");
    bytes32 public constant OFFENSE_FRIVOLOUS_CHALLENGE = keccak256("POM_FRIVOLOUS_CHALLENGE");

    /// @notice Floor on challengeWindow so governance cannot set it to ~0 and defeat the
    ///         optimistic safety (a standing must stay challengeable for a real window).
    uint64 public constant MIN_CHALLENGE_WINDOW = 10 minutes;

    // ============ Meta-block subsidy schedule ============

    /// @notice Bitcoin-form schedule, denominated in meta-block height (the standing nonce):
    ///         3.125 MIND initial, halving every 210,000 meta-blocks. The token cap equals the
    ///         closed form 2 x HALVING_INTERVAL x INITIAL_SUBSIDY = 1,312,500 MIND.
    uint256 public constant INITIAL_SUBSIDY = 3.125e18;
    uint256 public constant HALVING_INTERVAL = 210_000;

    /// @notice Contributor share of every subsidy (bps). A COMPILE-TIME CONSTANT so governance
    ///         can never dip into the contributor pool — the value-router soul enforced by code,
    ///         not policy. (Immutable absent a UUPS hub upgrade; the only fully upgrade-proof
    ///         invariant is the token's MAX_SUPPLY cap.)
    uint16 public constant CONTRIBUTOR_SHARE_BPS = 9100;

    /// @notice Upper bound on resolutionWindow so a dead resolver + a near-infinite window
    ///         cannot freeze the one-in-flight slot forever (an emission-halt grief).
    uint64 public constant MAX_RESOLUTION_WINDOW = 30 days;

    /// @notice Canonical reduction parameters every standing MUST declare, so a proposer cannot
    ///         self-declare theta_ent = 0 (nothing floored) and honestly re-derive junk-inflated
    ///         value. Mirror pom_export.rs DEFAULT_THETA_{SIM,ENT}_Q16.
    uint64 public constant CANONICAL_THETA_SIM_Q16 = 62259;
    uint64 public constant CANONICAL_THETA_ENT_Q16 = 62259;

    // ============ Storage ============

    IPoMOperatorRegistry public registry;
    PoMReward public reward;

    /// @notice Authorized to resolve disputes. v1: governance adjudicator (re-runs
    ///         pom_export, which is permissionless to verify). v2: a ZK/RISC-V
    ///         one-step-proof verifier — same slot, fully trustless.
    address public resolver;

    uint64 public challengeWindow;   // seconds a proposal is challengeable
    uint64 public resolutionWindow;  // seconds after a challenge before expireChallenge() unlocks the slot
    uint16 public proposerCutBps;    // proposer share of each subsidy (default 600 = 6%)
    uint16 public trancheBps;        // security-budget share of each subsidy (default 300 = 3%)
    uint96 public challengerReward;  // per-dispute MIND draw size (bounded by securityBudget)
    uint96 public slashAmount;       // bond slashed from the losing side of a dispute

    uint256 public nextNonce;         // the standing nonce a new proposal must carry
    uint256 public proposalCount;     // total proposals ever created (also the id counter)
    uint256 public pendingProposalId; // 0 = none in flight; serializes standing updates

    uint256 public emissionCommitted; // total subsidy scheduled so far (proposer + pool + tranche)
    uint256 public securityBudget;    // accrued challenger-bounty pool (3% tranche); draws only

    PomStanding internal current;
    mapping(uint256 => Proposal) internal proposals;

    // Per-finalized-nonce delta-payout root + pool accounting for contributor claims.
    mapping(uint256 => bytes32) public payoutRoots;               // nonce => this block's payout root
    mapping(uint256 => uint256) public blockPool;                 // nonce => contributor pool (91% of subsidy)
    mapping(uint256 => uint256) public blockClaimed;              // nonce => total already claimed
    mapping(uint256 => mapping(bytes32 => bool)) public claimed;  // nonce => contributor => claimed?

    /// @notice bps of a losing proposer's slashed BOND routed to the winning challenger. Bond-
    ///         denominated, so it compensates the honest challenger even when the MIND security
    ///         budget is empty at genesis (closes the "first challenger earns 0" gap). Appended
    ///         after the original layout to preserve upgrade-safety; __gap reduced 35 -> 34.
    uint16 public challengerSlashSliceBps;

    uint256[34] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _registry,
        address _reward,
        address _resolver,
        address _owner,
        uint64 _challengeWindow,
        uint64 _resolutionWindow,
        uint96 _challengerReward,
        uint96 _slashAmount
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        if (_challengeWindow < MIN_CHALLENGE_WINDOW) {
            revert ChallengeWindowTooShort(_challengeWindow, MIN_CHALLENGE_WINDOW);
        }
        if (_resolutionWindow > MAX_RESOLUTION_WINDOW) {
            revert ResolutionWindowTooLong(_resolutionWindow, MAX_RESOLUTION_WINDOW);
        }

        registry = IPoMOperatorRegistry(_registry);
        reward = PoMReward(_reward);
        resolver = _resolver;
        challengeWindow = _challengeWindow;
        resolutionWindow = _resolutionWindow;
        proposerCutBps = 600; // 6%
        trancheBps = 300;     // 3% (contributor share = 91% is a compile-time constant)
        challengerReward = _challengerReward;
        slashAmount = _slashAmount;
        challengerSlashSliceBps = 5000; // half the liar's slashed bond → the honest challenger
    }

    // ============ Admin ============

    function setResolver(address newResolver) external onlyOwner {
        resolver = newResolver;
    }

    function setChallengeWindow(uint64 newWindow) external onlyOwner {
        if (newWindow < MIN_CHALLENGE_WINDOW) revert ChallengeWindowTooShort(newWindow, MIN_CHALLENGE_WINDOW);
        challengeWindow = newWindow;
    }

    function setResolutionWindow(uint64 newWindow) external onlyOwner {
        if (newWindow > MAX_RESOLUTION_WINDOW) revert ResolutionWindowTooLong(newWindow, MAX_RESOLUTION_WINDOW);
        resolutionWindow = newWindow;
    }

    /// @notice Repartition only the NON-contributor 9% between proposer cut and security tranche.
    ///         Cannot touch the 91% contributor share (a constant): the two must sum to 9%.
    function setSplit(uint16 newProposerCutBps, uint16 newTrancheBps) external onlyOwner {
        require(newProposerCutBps + newTrancheBps == 10_000 - CONTRIBUTOR_SHARE_BPS, "split != 9%");
        proposerCutBps = newProposerCutBps;
        trancheBps = newTrancheBps;
    }

    /// @notice Per-dispute challenger draw size. Cap-safe because resolveDispute pays
    ///         min(challengerReward, securityBudget), never minting past the accrued tranche.
    function setChallengerReward(uint96 newChallengerReward) external onlyOwner {
        challengerReward = newChallengerReward;
    }

    function setSlashAmount(uint96 newSlashAmount) external onlyOwner {
        slashAmount = newSlashAmount;
    }

    /// @notice bps of a losing proposer's slashed bond paid to the winning challenger (<= 100%).
    function setChallengerSlashSliceBps(uint16 newBps) external onlyOwner {
        require(newBps <= 10_000, "bps>100%");
        challengerSlashSliceBps = newBps;
    }

    // ============ Optimistic flow ============

    /// @inheritdoc IPoMExportHub
    function propose(PomStanding calldata standing)
        external
        nonReentrant
        returns (uint256 proposalId)
    {
        if (!registry.isActive(msg.sender)) revert NotBondedOperator(msg.sender);
        if (pendingProposalId != 0) revert ProposalPending(pendingProposalId);
        if (standing.nonce != nextNonce) revert WrongNonce(standing.nonce, nextNonce);
        // Pin the reduction parameters so "false" is well-defined (no self-declared thetas).
        if (
            standing.thetaSimQ16 != CANONICAL_THETA_SIM_Q16 ||
            standing.thetaEntQ16 != CANONICAL_THETA_ENT_Q16
        ) revert ThetaMismatch();
        // Every meta-block must carry strictly new information (total is monotone cumulative):
        // no empty-block grinding of the schedule, and the block's delta pool is never empty.
        if (standing.total <= current.total) revert NoNewInformation(standing.total, current.total);
        // Anti selective-inclusion (canonical-prefix rule). The ON-CHAIN half is a DETECTION
        // ENABLER, not a prevention: it forces the Noesis prefix to strictly advance and to carry a
        // non-zero tip, so a proposer cannot silently re-play a stale prefix and every meta-block
        // must commit a FRESH (honest-or-false) inputCommitment. The contract does NOT verify the
        // tip is the honest hash of cells [0, noesisHeight) — it cannot, the cells are off-chain.
        // The OFF-CHAIN half does the catching: a challenger holding the canonical prefix re-hashes
        // it, and if the proposer omitted a canonical contributor the honest tip differs from the
        // posted one, so the standing is refuted and frozen (1-of-N-honest). The tip must be
        // non-zero so "which prefix should have been included" is well-defined. (v1 resolves
        // off-chain; DA-blob / sovereign-chain v2 makes the prefix check permissionless — see
        // SECURITY-NOTES.)
        if (standing.noesisHeight <= current.noesisHeight) {
            revert PrefixNotAdvancing(standing.noesisHeight, current.noesisHeight);
        }
        if (standing.inputCommitment == bytes32(0)) revert TipHashMissing();

        proposalId = ++proposalCount;
        uint64 finalizableAt = uint64(block.timestamp) + challengeWindow;

        Proposal storage p = proposals[proposalId];
        p.proposer = msg.sender;
        p.proposedAt = uint64(block.timestamp);
        p.finalizableAt = finalizableAt;
        p.status = ProposalStatus.Pending;
        p.standing = standing;

        pendingProposalId = proposalId;

        emit StandingProposed(
            proposalId,
            standing.nonce,
            msg.sender,
            standing.scoresRoot,
            standing.total,
            finalizableAt
        );
    }

    /// @inheritdoc IPoMExportHub
    /// @dev 1-of-N-honest safety: a single bonded challenger freezes the standing
    ///      inside the window so a false proposal can never be consumed. Final
    ///      slashing waits for the resolver, but the freeze is trustless.
    function challenge(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Pending) revert NotPending(proposalId);
        if (block.timestamp >= p.finalizableAt) revert ChallengeWindowClosed(proposalId);
        if (!registry.isActive(msg.sender)) revert NotBondedOperator(msg.sender);
        if (msg.sender == p.proposer) revert ProposerCannotChallengeSelf();

        p.status = ProposalStatus.Challenged;
        p.challenger = msg.sender;
        p.resolveDeadline = uint64(block.timestamp) + resolutionWindow;
        // Snapshot the bond-slice rate at challenge time so a later setChallengerSlashSliceBps
        // cannot retroactively cut (or inflate) the bounty of an already-committed challenger who
        // can no longer exit the dispute. Settlement-time binding of the economic parameter.
        p.challengerSlashSliceBpsAtChallenge = challengerSlashSliceBps;

        emit StandingChallenged(proposalId, msg.sender);
    }

    /// @inheritdoc IPoMExportHub
    function finalize(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Pending) revert NotPending(proposalId);
        if (block.timestamp < p.finalizableAt) revert ChallengeWindowOpen(proposalId);
        _finalize(p, proposalId);
    }

    /// @inheritdoc IPoMExportHub
    function resolveDispute(uint256 proposalId, bool proposerWins) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver(msg.sender);
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Challenged) revert NotChallenged(proposalId);

        // A challenged proposal is ALWAYS discarded. The resolver decides ONLY who was
        // wrong and gets slashed, never which standing goes live — the frozen standing
        // can never be consumed, and the standing only advances via a fresh, unchallenged
        // proposal. This keeps the 1-of-N-honest safety-freeze independent of resolver
        // honesty: a corrupt resolver can mis-slash (economic harm, bounded), but can
        // never push a false standing into `current`.
        address loser = proposerWins ? p.challenger : p.proposer;
        bytes32 offense = proposerWins ? OFFENSE_FRIVOLOUS_CHALLENGE : OFFENSE_FALSE_PROPOSAL;
        address challenger = p.challenger;

        // Effects before interactions (CEI): reopen the slot before any external call.
        p.status = ProposalStatus.Rejected;
        pendingProposalId = 0; // nonce slot reopens; nextNonce unchanged

        uint96 slashed;
        if (proposerWins) {
            // Frivolous challenger: slash them; the whole amount goes to the governance pool.
            slashed = registry.slash(loser, offense, slashAmount);
        } else {
            // False proposal: slash the proposer, routing a slice of their slashed BOND straight
            // to the honest challenger. Bond-denominated, so it pays even at genesis when the MIND
            // security budget is empty — this closes the "first challenger earns 0" gap without any
            // off-schedule mint. The remainder funds the governance pool.
            (slashed, ) = registry.slashToBeneficiary(
                loser, offense, slashAmount, registry.payoutOf(challenger), p.challengerSlashSliceBpsAtChallenge
            );
            // PLUS a MIND draw from the accrued security budget (a DRAW, never a fresh mint, so it
            // can never exceed the 3% tranche accrued so far). This is 0 at genesis and compounds
            // from the first finalized meta-block onward.
            uint256 draw = challengerReward;
            if (draw > securityBudget) draw = securityBudget;
            if (draw > 0) {
                securityBudget -= draw;
                reward.mint(registry.payoutOf(challenger), draw);
            }
        }
        emit DisputeResolved(proposalId, proposerWins, loser, slashed);
    }

    /// @inheritdoc IPoMExportHub
    function expireChallenge(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Challenged) revert NotChallenged(proposalId);
        if (block.timestamp < p.resolveDeadline) revert ResolutionWindowOpen(proposalId);

        // Resolver never decided in time: reopen the slot with no slashing (the dispute
        // is undetermined). Liveness never depends on the resolver being present.
        p.status = ProposalStatus.Rejected;
        pendingProposalId = 0; // nonce slot reopens; nextNonce unchanged

        emit ChallengeExpired(proposalId);
    }

    function _finalize(Proposal storage p, uint256 proposalId) internal {
        uint256 nonce = p.standing.nonce;
        p.status = ProposalStatus.Finalized;
        current = p.standing;
        nextNonce = nonce + 1;
        pendingProposalId = 0;

        // Meta-block subsidy on the fixed schedule, clamped to the remaining cap (unreachable
        // under the schedule; a deterministic pure-of-nonce clamp, so re-derivability survives).
        uint256 subsidy = metaBlockSubsidy(nonce);
        uint256 headroom = reward.MAX_SUPPLY() - emissionCommitted;
        if (subsidy > headroom) subsidy = headroom;
        emissionCommitted += subsidy;
        // NOTE (payoutRoot consistency): the proposer MUST compute payoutRoot against this SAME
        // clamped pool. `pom_export::meta_block_pool_wei` is unclamped; near the MAX_SUPPLY cap it
        // can exceed the clamped blockPool below, so an unclamped root would make honest claims
        // revert ClaimExceedsPool (fail-safe, never insolvent). The clamp only bites in the final
        // wei of the cap (~epoch 62, far beyond v1). See SECURITY-NOTES + the Rust caveat.

        uint256 proposerCut = (subsidy * proposerCutBps) / 10_000;
        uint256 tranche = (subsidy * trancheBps) / 10_000;
        uint256 pool = subsidy - proposerCut - tranche; // 91%; division remainders accrue to pool
        securityBudget += tranche;
        blockPool[nonce] = pool;
        payoutRoots[nonce] = p.standing.payoutRoot;

        if (proposerCut > 0) {
            reward.mint(registry.payoutOf(p.proposer), proposerCut);
        }

        emit StandingFinalized(proposalId, nonce, p.standing.scoresRoot, p.standing.total, p.standing.noesisHeight);
        emit MetaBlockSubsidy(proposalId, nonce, subsidy, proposerCut, pool);
    }

    /// @notice Subsidy for a meta-block height (the standing nonce). Bitcoin-form: 3.125 MIND,
    ///         halving every 210,000 meta-blocks, reaching 0 at epoch 62 (guard at 64).
    function metaBlockSubsidy(uint256 nonce) public pure returns (uint256) {
        uint256 epoch = nonce / HALVING_INTERVAL;
        if (epoch >= 64) return 0;
        return INITIAL_SUBSIDY >> epoch;
    }

    // ============ Consumer API ============

    /// @inheritdoc IPoMExportHub
    function currentStanding() external view returns (PomStanding memory) {
        return current;
    }

    /// @inheritdoc IPoMExportHub
    function verifyContributionScore(
        bytes32 contributor,
        uint256 cumulativeValue,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(contributor, cumulativeValue))));
        return MerkleProof.verify(proof, current.scoresRoot, leaf);
    }

    /// @inheritdoc IPoMExportHub
    /// @dev Delta-priced: each finalized meta-block's 91% pool is routed to the contributors
    ///      who produced THAT block's new information (not lifetime score — no rent). Claimable
    ///      once per (nonce, contributor); permissionless since funds route only to the in-leaf
    ///      payTo. Solvent by construction: per-block claims never exceed that block's pool.
    /// @dev TRUST BOUNDARY (off-chain): the payoutRoot commits (contributor, payTo, amount) but NOT
    ///      the registrations map used to derive them, so the contract does NOT prove `payTo` is the
    ///      contributor's true registered address. A dishonest proposer could route a contributor's
    ///      share to an attacker `payTo` and post a self-consistent root. This is caught off-chain,
    ///      not here: a bonded challenger re-runs `pom_export::payout_entries` with the canonical
    ///      registrations (from PoMOperatorRegistry.payoutOf) and, on any mismatch, challenges and
    ///      freezes the standing (1-of-N-honest). v2's permissionless path must add an on-chain
    ///      registrations commitment (reserved `registrationsRoot`) — see SECURITY-NOTES.
    function claimContributorReward(
        uint256 nonce,
        bytes32 contributor,
        address payTo,
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant {
        bytes32 root = payoutRoots[nonce];
        if (root == bytes32(0)) revert UnknownPayoutRoot(nonce);
        if (claimed[nonce][contributor]) revert AlreadyClaimed(nonce, contributor);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(contributor, payTo, amount))));
        if (!MerkleProof.verify(proof, root, leaf)) revert InvalidClaimProof();

        uint256 newClaimed = blockClaimed[nonce] + amount;
        if (newClaimed > blockPool[nonce]) revert ClaimExceedsPool(nonce);

        // Effects before the external mint (CEI + nonReentrant).
        claimed[nonce][contributor] = true;
        blockClaimed[nonce] = newClaimed;

        reward.mint(payTo, amount);
        emit ContributorRewardClaimed(nonce, contributor, payTo, amount);
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
