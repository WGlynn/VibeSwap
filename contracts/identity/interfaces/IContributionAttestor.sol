// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IContributionAttestor
 * @notice Interface for the 3-branch contribution attestation governance system.
 *
 * Separation of powers — mirrors constitutional governance:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  EXECUTIVE (Handshake Protocol)                                │
 * │  Peer attestations weighted by trust score × multiplier        │
 * │  Source: ContributionDAG                                       │
 * │  Action: attest() / contest()                                  │
 * │  Auto-accepts when cumulative weight ≥ threshold               │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  JUDICIAL (Tribunal)                                           │
 * │  Jury-based dispute resolution for contested claims            │
 * │  Source: DecentralizedTribunal                                 │
 * │  Action: escalateToTribunal() → resolveByTribunal()            │
 * │  Verdict is BINDING — overrides executive branch               │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  LEGISLATIVE (Governance)                                      │
 * │  Quadratic voting proposals can override any decision          │
 * │  Source: QuadraticVoting                                       │
 * │  Action: escalateToGovernance() → resolveByGovernance()        │
 * │  Supreme authority — can override both executive and judicial   │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Flow:
 * 1. Claim submitted → Executive branch (peer attestations)
 * 2. If accepted by weight → done
 * 3. If contested → can escalate to Judicial (Tribunal)
 * 4. If Tribunal is disputed or rules need changing → Legislative (Governance)
 * 5. Governance is supreme — can override any prior decision
 */
interface IContributionAttestor {

    // ============ Enums ============

    enum ClaimStatus {
        Pending,              // Awaiting executive branch attestations
        Accepted,             // Accepted (by any branch)
        Contested,            // Negatively weighted by executive branch
        Rejected,             // Rejected (by any branch)
        Expired,              // TTL elapsed without resolution
        Escalated,            // Under judicial review (Tribunal)
        GovernanceReview      // Under legislative review (QuadraticVoting)
    }

    /// @notice Which branch resolved the claim
    enum ResolutionSource {
        None,                 // Unresolved
        Executive,            // Handshake protocol (attestation weight)
        Judicial,             // Tribunal verdict
        Legislative           // Governance vote
    }

    enum ContributionType {
        Code,           // Smart contract, frontend, infrastructure
        Design,         // UI/UX, branding, logo, art
        Research,       // Whitepapers, mechanism design, analysis
        Community,      // Moderation, support, onboarding
        Marketing,      // Tweets, articles, outreach
        Security,       // Audits, bug reports, fuzzing
        Governance,     // Proposal drafting, voting facilitation
        Inspiration,    // Cultural contribution, philosophy, ethos
        Other           // Catch-all
    }

    // ============ Structs ============

    struct ContributionClaim {
        bytes32 claimId;
        address contributor;           // Who made the contribution
        address claimant;              // Who submitted the claim (may differ)
        ContributionType contribType;
        bytes32 evidenceHash;          // IPFS/Arweave hash of evidence
        string description;            // Short human-readable description
        uint256 value;                 // Proposed reward value (0 = no reward, attestation-only)
        uint256 timestamp;
        uint256 expiresAt;             // TTL for pending claims
        ClaimStatus status;
        ResolutionSource resolvedBy;   // Which branch resolved the claim
        int256 netWeight;              // Cumulative attestation weight (can go negative)
        uint256 attestationCount;      // Number of attesters
        uint256 contestationCount;     // Number of contesters
    }

    struct Attestation {
        address attester;
        uint256 weight;                // Trust score × multiplier (PRECISION scale)
        uint256 timestamp;
        bool isContestation;           // True = negative attestation
        bytes32 reasonHash;            // Optional IPFS hash for contestation reason
    }

    // ============ Events ============

    // Executive branch
    event ClaimSubmitted(bytes32 indexed claimId, address indexed contributor, address indexed claimant, ContributionType contribType, uint256 value);
    event ClaimAttested(bytes32 indexed claimId, address indexed attester, uint256 weight, int256 newNetWeight);
    event ClaimContested(bytes32 indexed claimId, address indexed contester, uint256 weight, int256 newNetWeight, bytes32 reasonHash);
    event ClaimAccepted(bytes32 indexed claimId, address indexed contributor, int256 finalWeight, uint256 attestationCount);
    event ClaimRejected(bytes32 indexed claimId, string reason);
    event ClaimExpired(bytes32 indexed claimId);

    // Judicial branch
    event ClaimEscalatedToTribunal(bytes32 indexed claimId, bytes32 indexed trialId);
    event ClaimResolvedByTribunal(bytes32 indexed claimId, bytes32 indexed trialId, bool accepted);

    // Legislative branch
    event ClaimEscalatedToGovernance(bytes32 indexed claimId, uint256 indexed proposalId);
    event ClaimResolvedByGovernance(bytes32 indexed claimId, uint256 indexed proposalId, bool accepted);

    // Admin
    event AcceptanceThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event ClaimTTLUpdated(uint256 oldTTL, uint256 newTTL);
    event TribunalUpdated(address oldTribunal, address newTribunal);
    event GovernanceUpdated(address oldGovernance, address newGovernance);

    // ============ Errors ============

    error ClaimNotFound();
    error ClaimNotPending();
    error ClaimNotContested();
    error ClaimNotEscalated();
    error ClaimNotUnderGovernance();
    error ClaimExpiredError();
    error AlreadyAttested();
    error AlreadyEscalated();
    error CannotAttestOwnClaim();
    error ZeroTrustScore();
    error ZeroAddress();
    error EmptyDescription();
    error InvalidContributionType();
    error ThresholdTooLow();
    error TTLTooShort();
    error TribunalNotSet();
    error GovernanceNotSet();
    error TrialNotClosed();
    error TrialCaseIdMismatch();
    error ProposalNotFinalized();
    error ProposalClaimMismatch();

    // ============ Executive Branch (Handshake Protocol) ============

    function submitClaim(address contributor, ContributionType contribType, bytes32 evidenceHash, string calldata description, uint256 value) external returns (bytes32 claimId);
    function attest(bytes32 claimId) external;
    function contest(bytes32 claimId, bytes32 reasonHash) external;
    function checkExpiry(bytes32 claimId) external;

    // ============ Judicial Branch (Tribunal) ============

    /// @notice Escalate a contested claim to the DecentralizedTribunal
    /// @dev Claim must be in Contested status. Sets status to Escalated.
    function escalateToTribunal(bytes32 claimId, bytes32 trialId) external;

    /// @notice Apply a Tribunal verdict to a claim
    /// @dev Reads the trial verdict from DecentralizedTribunal. Binding.
    function resolveByTribunal(bytes32 claimId) external;

    // ============ Legislative Branch (Governance) ============

    /// @notice Escalate a claim to governance (QuadraticVoting)
    /// @dev Links a governance proposal to this claim. Supreme authority.
    function escalateToGovernance(bytes32 claimId, uint256 proposalId) external;

    /// @notice Apply a governance vote result to a claim
    /// @dev Reads the proposal result from QuadraticVoting. Supreme override.
    function resolveByGovernance(bytes32 claimId) external;

    // ============ View Functions ============

    function getClaim(bytes32 claimId) external view returns (ContributionClaim memory);
    function getAttestations(bytes32 claimId) external view returns (Attestation[] memory);
    function getCumulativeWeight(bytes32 claimId) external view returns (int256 netWeight, uint256 totalPositive, uint256 totalNegative, bool isAccepted);
    function hasAttested(bytes32 claimId, address user) external view returns (bool);
    function getAcceptanceThreshold() external view returns (uint256);
    function getClaimsByContributor(address contributor) external view returns (bytes32[] memory);
    function getClaimCount() external view returns (uint256);
}
