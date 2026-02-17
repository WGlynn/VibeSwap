// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IContributionAttestor.sol";
import "./interfaces/IContributionDAG.sol";
import "../mechanism/interfaces/IQuadraticVoting.sol";

// ============ Minimal Tribunal Interface ============
// DecentralizedTribunal has no extracted interface; define what we need

interface ITribunal {
    enum TrialPhase { JURY_SELECTION, EVIDENCE, DELIBERATION, VERDICT, APPEAL, CLOSED }
    enum Verdict { PENDING, GUILTY, NOT_GUILTY, MISTRIAL }

    struct Trial {
        bytes32 caseId;
        bytes32 consensusProposalId;
        TrialPhase phase;
        Verdict verdict;
        uint64 phaseDeadline;
        uint256 jurySize;
        uint256 guiltyVotes;
        uint256 notGuiltyVotes;
        uint256 jurorStake;
        uint256 appealCount;
        string[] evidenceHashes;
    }

    function getTrial(bytes32 trialId) external view returns (Trial memory);
}

/**
 * @title ContributionAttestor
 * @notice 3-branch contribution attestation governance — separation of powers.
 *
 *         ┌──────────────────────────────────────────────────────────┐
 *         │  EXECUTIVE (Handshake Protocol)                         │
 *         │  Peer attestations weighted by trust score × multiplier │
 *         │  Source: ContributionDAG                                │
 *         │  Auto-accepts when cumulative weight ≥ threshold        │
 *         ├──────────────────────────────────────────────────────────┤
 *         │  JUDICIAL (Tribunal)                                    │
 *         │  Jury-based dispute resolution for contested claims     │
 *         │  Source: DecentralizedTribunal                          │
 *         │  Verdict is BINDING — overrides executive branch        │
 *         ├──────────────────────────────────────────────────────────┤
 *         │  LEGISLATIVE (Governance)                               │
 *         │  Quadratic voting proposals override any decision       │
 *         │  Source: QuadraticVoting                                │
 *         │  Supreme authority — can override executive + judicial   │
 *         └──────────────────────────────────────────────────────────┘
 *
 *         Flow:
 *         1. submitClaim → Pending (executive branch)
 *         2. attest/contest → weight accumulates
 *         3. If accepted by weight → Accepted (resolvedBy: Executive)
 *         4. If contested → escalateToTribunal() → Escalated
 *         5. Tribunal verdict → resolveByTribunal() → Accepted/Rejected (resolvedBy: Judicial)
 *         6. At ANY point → escalateToGovernance() → GovernanceReview
 *         7. Governance vote → resolveByGovernance() → Accepted/Rejected (resolvedBy: Legislative)
 *
 *         Attestation weight = trust_score × trust_multiplier:
 *           3 founders (3 × 3.0) = 9.0 >> 1 untrusted (0.5 × 0) = 0
 *           Cumulative: netWeight = Σ(positive) - Σ(negative)
 *
 * @dev Non-upgradeable. Gas-bounded attestation arrays.
 */
contract ContributionAttestor is IContributionAttestor, Ownable, ReentrancyGuard {

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10000;

    /// @notice Maximum attestations per claim (gas bound)
    uint256 public constant MAX_ATTESTATIONS_PER_CLAIM = 50;

    /// @notice Minimum claim TTL (1 day)
    uint256 public constant MIN_CLAIM_TTL = 1 days;

    // ============ State: Branch 1 — Executive (Handshake Protocol) ============

    /// @notice ContributionDAG for trust score lookups
    IContributionDAG public contributionDAG;

    /// @notice Acceptance threshold — cumulative weight needed to accept a claim
    /// @dev PRECISION scale. Default 2.0 (equivalent of ~1 founder or 2+ trusted users)
    uint256 public acceptanceThreshold;

    /// @notice Time-to-live for pending claims
    uint256 public claimTTL;

    /// @notice All claims by ID
    mapping(bytes32 => ContributionClaim) private _claims;

    /// @notice Attestations per claim
    mapping(bytes32 => Attestation[]) private _attestations;

    /// @notice Track who has attested per claim (prevent double-attestation)
    mapping(bytes32 => mapping(address => bool)) private _hasAttested;

    /// @notice Claims per contributor (for lookup)
    mapping(address => bytes32[]) private _contributorClaims;

    /// @notice Total claims submitted
    uint256 private _claimNonce;

    // ============ State: Branch 2 — Judicial (Tribunal) ============

    /// @notice DecentralizedTribunal for dispute resolution
    ITribunal public tribunal;

    /// @notice Mapping from claimId → trialId (linked tribunal case)
    mapping(bytes32 => bytes32) public claimTrialIds;

    // ============ State: Branch 3 — Legislative (Governance) ============

    /// @notice QuadraticVoting for governance override
    IQuadraticVoting public governance;

    /// @notice Mapping from claimId → proposalId (linked governance proposal)
    mapping(bytes32 => uint256) public claimProposalIds;

    /// @notice Track which claims have linked governance proposals
    mapping(bytes32 => bool) private _hasGovernanceProposal;

    // ============ Constructor ============

    constructor(
        address _contributionDAG,
        uint256 _acceptanceThreshold,
        uint256 _claimTTL
    ) Ownable(msg.sender) {
        if (_contributionDAG == address(0)) revert ZeroAddress();
        if (_acceptanceThreshold == 0) revert ThresholdTooLow();
        if (_claimTTL < MIN_CLAIM_TTL) revert TTLTooShort();

        contributionDAG = IContributionDAG(_contributionDAG);
        acceptanceThreshold = _acceptanceThreshold;
        claimTTL = _claimTTL;
    }

    // ================================================================
    //                  BRANCH 1: EXECUTIVE (Handshake Protocol)
    // ================================================================

    /// @inheritdoc IContributionAttestor
    function submitClaim(
        address contributor,
        ContributionType contribType,
        bytes32 evidenceHash,
        string calldata description,
        uint256 value
    ) external returns (bytes32 claimId) {
        if (contributor == address(0)) revert ZeroAddress();
        if (bytes(description).length == 0) revert EmptyDescription();

        claimId = keccak256(abi.encodePacked(
            contributor,
            msg.sender,
            _claimNonce++,
            block.timestamp
        ));

        _claims[claimId] = ContributionClaim({
            claimId: claimId,
            contributor: contributor,
            claimant: msg.sender,
            contribType: contribType,
            evidenceHash: evidenceHash,
            description: description,
            value: value,
            timestamp: block.timestamp,
            expiresAt: block.timestamp + claimTTL,
            status: ClaimStatus.Pending,
            resolvedBy: ResolutionSource.None,
            netWeight: 0,
            attestationCount: 0,
            contestationCount: 0
        });

        _contributorClaims[contributor].push(claimId);

        emit ClaimSubmitted(claimId, contributor, msg.sender, contribType, value);
    }

    /// @inheritdoc IContributionAttestor
    function attest(bytes32 claimId) external {
        ContributionClaim storage claim = _claims[claimId];
        if (claim.timestamp == 0) revert ClaimNotFound();
        if (claim.status != ClaimStatus.Pending) revert ClaimNotPending();
        if (block.timestamp >= claim.expiresAt) revert ClaimExpiredError();
        if (_hasAttested[claimId][msg.sender]) revert AlreadyAttested();

        // Cannot attest your own claim (claimant or contributor)
        if (msg.sender == claim.claimant || msg.sender == claim.contributor) {
            revert CannotAttestOwnClaim();
        }

        // Get attester's trust score and multiplier from ContributionDAG
        (uint256 score, , uint256 multiplier, , ) = contributionDAG.getTrustScore(msg.sender);

        // Must have some trust to attest
        if (score == 0 && multiplier <= BPS / 2) revert ZeroTrustScore();

        // Weight = score × multiplier / BPS (normalized to PRECISION scale)
        uint256 weight = (score * multiplier) / BPS;

        // Record attestation
        _attestations[claimId].push(Attestation({
            attester: msg.sender,
            weight: weight,
            timestamp: block.timestamp,
            isContestation: false,
            reasonHash: bytes32(0)
        }));

        _hasAttested[claimId][msg.sender] = true;
        claim.netWeight += int256(weight);
        claim.attestationCount++;

        emit ClaimAttested(claimId, msg.sender, weight, claim.netWeight);

        // Check if threshold met → auto-accept via executive branch
        if (claim.netWeight >= int256(acceptanceThreshold)) {
            claim.status = ClaimStatus.Accepted;
            claim.resolvedBy = ResolutionSource.Executive;
            emit ClaimAccepted(claimId, claim.contributor, claim.netWeight, claim.attestationCount);
        }
    }

    /// @inheritdoc IContributionAttestor
    function contest(bytes32 claimId, bytes32 reasonHash) external {
        ContributionClaim storage claim = _claims[claimId];
        if (claim.timestamp == 0) revert ClaimNotFound();
        if (claim.status != ClaimStatus.Pending) revert ClaimNotPending();
        if (block.timestamp >= claim.expiresAt) revert ClaimExpiredError();
        if (_hasAttested[claimId][msg.sender]) revert AlreadyAttested();

        // Get contester's trust score and multiplier
        (uint256 score, , uint256 multiplier, , ) = contributionDAG.getTrustScore(msg.sender);
        if (score == 0 && multiplier <= BPS / 2) revert ZeroTrustScore();

        uint256 weight = (score * multiplier) / BPS;

        // Record contestation
        _attestations[claimId].push(Attestation({
            attester: msg.sender,
            weight: weight,
            timestamp: block.timestamp,
            isContestation: true,
            reasonHash: reasonHash
        }));

        _hasAttested[claimId][msg.sender] = true;
        claim.netWeight -= int256(weight);
        claim.contestationCount++;

        emit ClaimContested(claimId, msg.sender, weight, claim.netWeight, reasonHash);

        // If net weight drops significantly negative, mark contested
        if (claim.netWeight < -int256(acceptanceThreshold / 2)) {
            claim.status = ClaimStatus.Contested;
            emit ClaimRejected(claimId, "Contested by credible users");
        }
    }

    /// @inheritdoc IContributionAttestor
    function checkExpiry(bytes32 claimId) external {
        ContributionClaim storage claim = _claims[claimId];
        if (claim.timestamp == 0) revert ClaimNotFound();

        if (claim.status == ClaimStatus.Pending && block.timestamp >= claim.expiresAt) {
            claim.status = ClaimStatus.Expired;
            emit ClaimExpired(claimId);
        }
    }

    // ================================================================
    //                  BRANCH 2: JUDICIAL (Tribunal)
    // ================================================================

    /// @inheritdoc IContributionAttestor
    function escalateToTribunal(bytes32 claimId, bytes32 trialId) external {
        ContributionClaim storage claim = _claims[claimId];
        if (claim.timestamp == 0) revert ClaimNotFound();
        if (address(tribunal) == address(0)) revert TribunalNotSet();

        // Can escalate Contested or Pending claims (but not already escalated/resolved)
        if (claim.status != ClaimStatus.Contested && claim.status != ClaimStatus.Pending) {
            revert ClaimNotContested();
        }

        // Verify the trial exists and its caseId matches this claim
        ITribunal.Trial memory trial = tribunal.getTrial(trialId);
        if (trial.caseId != claimId) revert TrialCaseIdMismatch();

        // Link and escalate
        claimTrialIds[claimId] = trialId;
        claim.status = ClaimStatus.Escalated;

        emit ClaimEscalatedToTribunal(claimId, trialId);
    }

    /// @inheritdoc IContributionAttestor
    function resolveByTribunal(bytes32 claimId) external {
        ContributionClaim storage claim = _claims[claimId];
        if (claim.timestamp == 0) revert ClaimNotFound();
        if (claim.status != ClaimStatus.Escalated) revert ClaimNotEscalated();
        if (address(tribunal) == address(0)) revert TribunalNotSet();

        bytes32 trialId = claimTrialIds[claimId];
        ITribunal.Trial memory trial = tribunal.getTrial(trialId);

        // Trial must be CLOSED (fully resolved, past appeals)
        if (trial.phase != ITribunal.TrialPhase.CLOSED) revert TrialNotClosed();

        bool accepted;

        if (trial.verdict == ITribunal.Verdict.NOT_GUILTY) {
            // NOT_GUILTY in contribution context = claim is legitimate → accept
            claim.status = ClaimStatus.Accepted;
            claim.resolvedBy = ResolutionSource.Judicial;
            accepted = true;
        } else if (trial.verdict == ITribunal.Verdict.GUILTY) {
            // GUILTY = claim is fraudulent → reject
            claim.status = ClaimStatus.Rejected;
            claim.resolvedBy = ResolutionSource.Judicial;
            accepted = false;
        } else {
            // MISTRIAL → back to Contested (can re-escalate or go to governance)
            claim.status = ClaimStatus.Contested;
            accepted = false;
        }

        emit ClaimResolvedByTribunal(claimId, trialId, accepted);
    }

    // ================================================================
    //                  BRANCH 3: LEGISLATIVE (Governance)
    // ================================================================

    /// @inheritdoc IContributionAttestor
    function escalateToGovernance(bytes32 claimId, uint256 proposalId) external {
        ContributionClaim storage claim = _claims[claimId];
        if (claim.timestamp == 0) revert ClaimNotFound();
        if (address(governance) == address(0)) revert GovernanceNotSet();

        // Governance is supreme — can override ANY status except already governance-resolved
        // Allow escalation from: Pending, Contested, Escalated, Accepted, Rejected
        if (claim.status == ClaimStatus.GovernanceReview) revert AlreadyEscalated();
        if (claim.status == ClaimStatus.Expired) revert ClaimExpiredError();

        // Verify proposal exists (will revert in QV if not found)
        IQuadraticVoting.Proposal memory proposal = governance.getProposal(proposalId);
        // Proposal must be ACTIVE or already finalized
        if (proposal.startTime == 0) revert ProposalNotFinalized();

        // Link and escalate
        claimProposalIds[claimId] = proposalId;
        _hasGovernanceProposal[claimId] = true;
        claim.status = ClaimStatus.GovernanceReview;

        emit ClaimEscalatedToGovernance(claimId, proposalId);
    }

    /// @inheritdoc IContributionAttestor
    function resolveByGovernance(bytes32 claimId) external {
        ContributionClaim storage claim = _claims[claimId];
        if (claim.timestamp == 0) revert ClaimNotFound();
        if (claim.status != ClaimStatus.GovernanceReview) revert ClaimNotUnderGovernance();
        if (address(governance) == address(0)) revert GovernanceNotSet();
        if (!_hasGovernanceProposal[claimId]) revert ProposalClaimMismatch();

        uint256 proposalId = claimProposalIds[claimId];
        IQuadraticVoting.Proposal memory proposal = governance.getProposal(proposalId);

        // Proposal must be finalized (SUCCEEDED or DEFEATED)
        if (proposal.state != IQuadraticVoting.ProposalState.SUCCEEDED &&
            proposal.state != IQuadraticVoting.ProposalState.DEFEATED) {
            revert ProposalNotFinalized();
        }

        bool accepted = (proposal.state == IQuadraticVoting.ProposalState.SUCCEEDED);

        if (accepted) {
            claim.status = ClaimStatus.Accepted;
        } else {
            claim.status = ClaimStatus.Rejected;
        }
        claim.resolvedBy = ResolutionSource.Legislative;

        emit ClaimResolvedByGovernance(claimId, proposalId, accepted);
    }

    // ============ View Functions ============

    /// @inheritdoc IContributionAttestor
    function getClaim(bytes32 claimId) external view returns (ContributionClaim memory) {
        return _claims[claimId];
    }

    /// @inheritdoc IContributionAttestor
    function getAttestations(bytes32 claimId) external view returns (Attestation[] memory) {
        return _attestations[claimId];
    }

    /// @inheritdoc IContributionAttestor
    function getCumulativeWeight(bytes32 claimId) external view returns (
        int256 netWeight,
        uint256 totalPositive,
        uint256 totalNegative,
        bool isAccepted
    ) {
        Attestation[] storage attestations = _attestations[claimId];

        for (uint256 i = 0; i < attestations.length; i++) {
            if (attestations[i].isContestation) {
                totalNegative += attestations[i].weight;
            } else {
                totalPositive += attestations[i].weight;
            }
        }

        netWeight = int256(totalPositive) - int256(totalNegative);
        isAccepted = netWeight >= int256(acceptanceThreshold);
    }

    /// @inheritdoc IContributionAttestor
    function hasAttested(bytes32 claimId, address user) external view returns (bool) {
        return _hasAttested[claimId][user];
    }

    /// @inheritdoc IContributionAttestor
    function getAcceptanceThreshold() external view returns (uint256) {
        return acceptanceThreshold;
    }

    /// @inheritdoc IContributionAttestor
    function getClaimsByContributor(address contributor) external view returns (bytes32[] memory) {
        return _contributorClaims[contributor];
    }

    /// @inheritdoc IContributionAttestor
    function getClaimCount() external view returns (uint256) {
        return _claimNonce;
    }

    /// @notice Get attestation weight for a potential attester (preview)
    function previewAttestationWeight(address attester) external view returns (uint256 weight) {
        (uint256 score, , uint256 multiplier, , ) = contributionDAG.getTrustScore(attester);
        weight = (score * multiplier) / BPS;
    }

    // ============ Admin Functions ============

    /// @notice Update acceptance threshold
    function setAcceptanceThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0) revert ThresholdTooLow();
        uint256 old = acceptanceThreshold;
        acceptanceThreshold = newThreshold;
        emit AcceptanceThresholdUpdated(old, newThreshold);
    }

    /// @notice Update claim TTL
    function setClaimTTL(uint256 newTTL) external onlyOwner {
        if (newTTL < MIN_CLAIM_TTL) revert TTLTooShort();
        uint256 old = claimTTL;
        claimTTL = newTTL;
        emit ClaimTTLUpdated(old, newTTL);
    }

    /// @notice Admin rejection of a claim
    function rejectClaim(bytes32 claimId, string calldata reason) external onlyOwner {
        ContributionClaim storage claim = _claims[claimId];
        if (claim.timestamp == 0) revert ClaimNotFound();
        if (claim.status != ClaimStatus.Pending) revert ClaimNotPending();

        claim.status = ClaimStatus.Rejected;
        emit ClaimRejected(claimId, reason);
    }

    /// @notice Set the DecentralizedTribunal address (judicial branch)
    function setTribunal(address _tribunal) external onlyOwner {
        address old = address(tribunal);
        tribunal = ITribunal(_tribunal);
        emit TribunalUpdated(old, _tribunal);
    }

    /// @notice Set the QuadraticVoting address (legislative branch)
    function setGovernance(address _governance) external onlyOwner {
        address old = address(governance);
        governance = IQuadraticVoting(_governance);
        emit GovernanceUpdated(old, _governance);
    }

    /// @notice Update ContributionDAG address (executive branch)
    function setContributionDAG(address _dag) external onlyOwner {
        if (_dag == address(0)) revert ZeroAddress();
        contributionDAG = IContributionDAG(_dag);
    }
}
