// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPoMExportHub
 * @notice Orchestrator for the PoM-on-ETH ("The DAO 2") optimistic export layer.
 *
 *         PoM value is computed OFF-CHAIN by the deterministic `pom_export`
 *         reduction (noesis/node/src/pom_export.rs) — too expensive to run in the
 *         EVM. This hub is how a host chain consumes that output WITHOUT a signer
 *         quorum, via an optimistic re-derivation game:
 *
 *           propose()  — a bonded operator posts the next standing
 *           challenge()— any bonded operator freezes it within the window (1-of-N
 *                        honest safety: one honest party stops a bad standing from
 *                        ever being consumed)
 *           finalize() — after the window with no challenge, the standing is live
 *           resolveDispute() — the swappable `resolver` slot decides a challenge
 *                        and slashes the losing side
 *
 *         Trust boundary (honest): the happy path and the safety-freeze need NO
 *         trust. Only *resolving* a dispute needs to know the true computation,
 *         which the EVM cannot re-run — so v1's resolver is a governance adjudicator
 *         (re-running pom_export is permissionless to verify), and v2 replaces it
 *         with a RISC-V/ZK one-step proof for full trustlessness. Same interface.
 *
 *         Consumers (a value-routing DAO) READ `currentStanding()` and verify a
 *         contributor's score against `scoresRoot` with a Merkle proof — the
 *         irreducible "value router" function: value in, contribution scored, value out.
 */
interface IPoMExportHub {
    // ============ Structs ============

    /// @notice One finalized PoM standing — the slowly-updating registry consumers read.
    /// @dev Mirrors the off-chain PomExport (pom_export.rs): thetaSimQ16 + total +
    ///      the input commitment, plus a Merkle root over per-contributor cumulative value.
    struct PomStanding {
        uint256 nonce;           // monotonic standing index
        uint64  noesisHeight;    // canonical Noesis prefix length this standing covers (strictly advancing)
        uint64  thetaSimQ16;     // similarity-floor parameter (pinned to canonical in propose)
        uint64  thetaEntQ16;     // entropy-floor parameter (pinned to canonical in propose)
        uint256 total;           // aggregate PoM value, cumulative sum over contributors (monotone)
        bytes32 scoresRoot;      // Merkle root over (contributor, cumulativeValue) leaves
        bytes32 payoutRoot;      // Merkle root over THIS block's (contributor, payTo, amount) delta payouts
        // Canonical-prefix tip commitment: blake2b over the EXACT cells [0, noesisHeight) this
        // standing reduced (pom_export `commitment`). Anti selective-inclusion: it pins WHICH
        // prefix must have been fully included, so a proposer that omits a canonical contributor's
        // cells posts a tip that a challenger (who holds the canonical prefix) can refute. On the
        // ETH MVP the contract cannot itself check this against off-chain cells — the strict
        // noesisHeight advance is the on-chain lever; the tip makes omission challengeable off-chain
        // (resolver-adjudicated in v1; permissionless once cells are chain state / DA blobs, v2).
        bytes32 inputCommitment;
    }

    enum ProposalStatus { None, Pending, Challenged, Finalized, Rejected }

    struct Proposal {
        address proposer;
        address challenger;      // 0 until challenged
        uint64  proposedAt;
        uint64  finalizableAt;   // block.timestamp after which finalize() is allowed
        uint64  resolveDeadline; // set on challenge; after this, expireChallenge() reopens the slot
        uint16  challengerSlashSliceBpsAtChallenge; // bond-slice bps snapshotted at challenge() — no retroactive change
        ProposalStatus status;
        PomStanding standing;
    }

    // ============ Events ============

    event StandingProposed(
        uint256 indexed proposalId,
        uint256 indexed nonce,
        address indexed proposer,
        bytes32 scoresRoot,
        uint256 total,
        uint64 finalizableAt
    );
    event StandingChallenged(uint256 indexed proposalId, address indexed challenger);
    event ChallengeExpired(uint256 indexed proposalId);
    event StandingFinalized(
        uint256 indexed proposalId,
        uint256 indexed nonce,
        bytes32 scoresRoot,
        uint256 total,
        uint64 noesisHeight
    );
    event DisputeResolved(
        uint256 indexed proposalId,
        bool proposerWon,
        address slashed,
        uint96 amountSlashed
    );
    event MetaBlockSubsidy(
        uint256 indexed proposalId,
        uint256 indexed nonce,
        uint256 subsidy,
        uint256 proposerCut,
        uint256 contributorPool
    );
    event ContributorRewardClaimed(
        uint256 indexed nonce,
        bytes32 indexed contributor,
        address indexed payTo,
        uint256 amount
    );

    // ============ Errors ============

    error NotBondedOperator(address who);
    error ProposalPending(uint256 proposalId);
    error WrongNonce(uint256 got, uint256 expected);
    error NotPending(uint256 proposalId);
    error NotChallenged(uint256 proposalId);
    error ChallengeWindowClosed(uint256 proposalId);
    error ChallengeWindowOpen(uint256 proposalId);
    error ResolutionWindowOpen(uint256 proposalId);
    error NotResolver(address who);
    error ProposerCannotChallengeSelf();
    error ChallengeWindowTooShort(uint64 got, uint64 min);
    error NoNewInformation(uint256 total, uint256 currentTotal);
    error PrefixNotAdvancing(uint64 got, uint64 currentHeight);
    error TipHashMissing();
    error ThetaMismatch();
    error ResolutionWindowTooLong(uint64 got, uint64 max);
    error InvalidClaimProof();
    error AlreadyClaimed(uint256 nonce, bytes32 contributor);
    error ClaimExceedsPool(uint256 nonce);
    error UnknownPayoutRoot(uint256 nonce);

    // ============ Optimistic flow ============

    function propose(PomStanding calldata standing) external returns (uint256 proposalId);
    function challenge(uint256 proposalId) external;
    function finalize(uint256 proposalId) external;

    /// @notice Resolve a challenged proposal. The proposal is ALWAYS discarded (a
    ///         challenge freezes the standing permanently — it can never be consumed;
    ///         the standing only advances via a fresh, unchallenged proposal). The
    ///         resolver decides ONLY who was wrong and gets slashed — it has NO power
    ///         to make a challenged standing live. So the 1-of-N-honest safety-freeze
    ///         never depends on resolver honesty; only the economic outcome does.
    /// @param proposerWins true = challenge was frivolous (slash challenger);
    ///                     false = proposal was false (slash proposer, reward challenger).
    function resolveDispute(uint256 proposalId, bool proposerWins) external;

    /// @notice Reopen a challenged proposal's slot after the resolution window elapses
    ///         with no resolver decision. Permissionless — removes the resolver as a
    ///         liveness single-point-of-failure. No slashing (the dispute is undetermined).
    function expireChallenge(uint256 proposalId) external;

    // ============ Consumer API ============

    function currentStanding() external view returns (PomStanding memory);

    /// @notice Verify a contributor's attested cumulative PoM value against the live
    ///         standing's Merkle root. This is how a value-routing DAO reads a score.
    /// @dev Leaf = keccak256(bytes.concat(keccak256(abi.encode(contributor, cumulativeValue)))),
    ///      the OpenZeppelin double-hash leaf convention (must match pom_export.rs).
    function verifyContributionScore(
        bytes32 contributor,
        uint256 cumulativeValue,
        bytes32[] calldata proof
    ) external view returns (bool);

    /// @notice Claim a contributor's delta-priced share of a finalized meta-block's subsidy.
    ///         Permissionless (funds route only to the in-leaf `payTo`); claimable once per
    ///         (nonce, contributor). This is the value router paying out: each meta-block's
    ///         subsidy flows to whoever produced that block's NEW information, by proof.
    /// @dev Leaf = keccak256(bytes.concat(keccak256(abi.encode(contributor, payTo, amount)))).
    function claimContributorReward(
        uint256 nonce,
        bytes32 contributor,
        address payTo,
        uint256 amount,
        bytes32[] calldata proof
    ) external;
}
