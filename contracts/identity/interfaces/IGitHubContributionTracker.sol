// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IGitHubContributionTracker
 * @notice Interface for GitHub webhook-driven contribution ingestion.
 *
 * Architecture:
 *   GitHub Webhook → Off-chain Relayer → EIP-712 Sign → recordContribution()
 *                        ↓
 *                  IPFS/Arweave pin (full contribution data)
 *                        ↓
 *                  Off-chain indexer rebuilds Merkle tree from LeafInserted events
 *                        ↓
 *                  Generates proofs on demand for verification/contention
 *
 * The relayer is a trusted oracle. The Merkle tree provides trustless verification —
 * even if the relayer disappears, anyone can reconstruct from events.
 */
interface IGitHubContributionTracker {

    // ============ Enums ============

    enum ContributionType {
        COMMIT,
        PR_MERGED,
        REVIEW,
        ISSUE_CLOSED
    }

    // ============ Structs ============

    struct GitHubContribution {
        address contributor;        // On-chain address (bound to GitHub account)
        bytes32 repoHash;           // keccak256(org/repo)
        bytes32 commitHash;         // GitHub commit SHA or PR number hash
        ContributionType contribType;
        uint256 value;              // Reward value (set by relayer based on contribution size)
        uint256 timestamp;          // GitHub event timestamp
        bytes32 evidenceHash;       // IPFS hash of full contribution data
    }

    struct ContributorStats {
        uint256 totalContributions;
        uint256 totalValue;
    }

    // ============ Events ============

    event ContributionRecorded(
        address indexed contributor,
        bytes32 indexed repoHash,
        bytes32 commitHash,
        ContributionType contribType,
        uint256 value,
        uint256 leafIndex
    );

    event GitHubAccountBound(address indexed contributor, bytes32 githubHash);
    event GitHubAccountUnbound(address indexed contributor);
    event RelayerUpdated(address indexed relayer, bool authorized);
    event RewardValueUpdated(ContributionType indexed contribType, uint256 value);

    // ============ Errors ============

    error UnauthorizedRelayer();
    error DuplicateEvent();
    error UnboundGitHubAccount();
    error InvalidSignature();
    error ZeroAddress();
    error AlreadyBound();

    // ============ Ingestion ============

    /// @notice Record a GitHub contribution via EIP-712 signed relayer message
    function recordContribution(
        GitHubContribution calldata contribution,
        bytes calldata signature
    ) external;

    /// @notice Record multiple contributions in a single transaction (batch)
    function recordContributionBatch(
        GitHubContribution[] calldata contributions,
        bytes[] calldata signatures
    ) external;

    // ============ Verification ============

    /// @notice Verify a contribution exists via Merkle proof against current or historical root
    function verifyContribution(
        bytes32[] calldata proof,
        GitHubContribution calldata contribution
    ) external view returns (bool);

    /// @notice Get the current Merkle root of contributions
    function getContributionRoot() external view returns (bytes32);

    /// @notice Check if a root is in the recent history (supports async proof generation)
    function isKnownRoot(bytes32 root) external view returns (bool);

    // ============ View ============

    /// @notice Get total contribution count
    function getContributionCount() external view returns (uint256);

    /// @notice Get stats for a contributor
    function getContributorStats(address contributor) external view returns (
        uint256 totalContributions,
        uint256 totalValue
    );
}
