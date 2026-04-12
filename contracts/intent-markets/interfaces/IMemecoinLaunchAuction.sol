// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMemecoinLaunchAuction
 * @notice Memecoin launches via commit-reveal batch auction with uniform
 *         clearing price. Implements all 5 GEV fixes from the memecoin
 *         intent market paper.
 *
 *      Fix 1: Commit-reveal launches (no front-running, same price for all)
 *      Fix 2: Duplicate elimination (one canonical token per intent signal)
 *      Fix 3: Anti-rug (via ICreatorLiquidityLock)
 *      Fix 4: Wash trade resistance (via IBehavioralReputation + ISybilGuard)
 *      Fix 5: 0% protocol fees (100% to LPs)
 *
 *      Paper: docs/papers/memecoin-intent-market-seed.md
 *      CogProof integration: docs/COGPROOF_INTEGRATION.md
 */
interface IMemecoinLaunchAuction {
    // ============ Enums ============

    enum LaunchPhase {
        CREATED,    // launch exists, commit phase not yet started
        COMMIT,     // participants committing buy orders
        REVEAL,     // participants revealing orders
        SETTLING,   // computing uniform clearing price
        SETTLED,    // tokens distributed, AMM seeded
        FAILED      // insufficient participation or slashed
    }

    // ============ Structs ============

    struct MemecoinLaunch {
        uint256 launchId;
        address creator;
        address token;              // the memecoin ERC20
        address reserveToken;       // payment token (address(0) = ETH)
        bytes32 intentSignal;       // keccak256 of the cultural intent
        uint64 commitBatchId;       // links to CommitRevealAuction batch
        uint256 creatorLockId;      // links to CreatorLiquidityLock
        uint256 totalCommitted;     // total reserve committed by participants
        uint256 totalTokensForSale; // tokens allocated for the launch
        uint256 uniformPrice;       // reserve per token (set at settlement)
        LaunchPhase phase;
        uint64 createdAt;
    }

    // ============ Events ============

    event LaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address token,
        bytes32 indexed intentSignal,
        uint256 totalTokensForSale
    );

    event LaunchCommit(
        uint256 indexed launchId,
        address indexed participant,
        bytes32 commitId
    );

    event LaunchSettled(
        uint256 indexed launchId,
        uint256 uniformPrice,
        uint256 totalParticipants,
        uint256 totalReserve
    );

    event LaunchFailed(uint256 indexed launchId, string reason);

    event TokensClaimed(
        uint256 indexed launchId,
        address indexed participant,
        uint256 tokenAmount,
        uint256 reserveSpent
    );

    // ============ Errors ============

    error DuplicateIntentSignal();
    error LaunchNotInPhase(LaunchPhase expected, LaunchPhase actual);
    error CreatorCooldownActive();
    error ReputationTooLow();
    error NotLaunchParticipant();
    error AlreadyClaimed();
    error LaunchDoesNotExist();
    error ZeroTokenAllocation();
    error InsufficientCreatorDeposit();

    // ============ Functions ============

    function createLaunch(
        address token,
        address reserveToken,
        bytes32 intentSignal,
        uint256 totalTokensForSale,
        uint256 creatorDeposit,
        uint64 lockDuration
    ) external payable returns (uint256 launchId);

    function commitToBuy(
        uint256 launchId,
        bytes32 commitHash,
        uint256 estimatedAmount
    ) external payable returns (bytes32 commitId);

    function revealBuy(
        uint256 launchId,
        bytes32 commitId,
        uint256 amountIn,
        uint256 minTokensOut,
        bytes32 secret
    ) external;

    function settleLaunch(uint256 launchId) external;

    function claimTokens(uint256 launchId) external returns (uint256 tokenAmount);

    function getLaunch(uint256 launchId) external view returns (MemecoinLaunch memory);
    function getIntentLaunch(bytes32 intentSignal) external view returns (uint256 launchId);
}
