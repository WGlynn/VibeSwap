// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IContributionYieldTokenizer
 * @notice Pendle-inspired tokenization of future contribution rewards.
 *         Separates ideas (intrinsic, permanent value) from execution (time-bound, performance-dependent).
 *
 * Two primitives:
 *
 * 1. IDEA TOKEN (IT) — Instant, full-value tokenization of an idea.
 *    - The idea's value is intrinsic and independent of execution
 *    - Fully liquid from day zero — buying IT = funding the idea's existence
 *    - Price discovery via market: good ideas appreciate, bad ideas don't
 *    - Ideas are eternal — IT never expires or decays
 *
 * 2. EXECUTION STREAM (ES) — Continuous funding for whoever executes the idea.
 *    - Auto-flows to active executors proportional to their share
 *    - Decays on stall/staleness — unused streams redirect automatically
 *    - Executor can change: if original stalls, any IT holder can redirect
 *    - Stream rate = equal share of remaining funding / 30 days
 *
 * The separation:
 * - Ideas have permanent, intrinsic value (never goes stale)
 * - Execution is time-bound, performance-dependent, and revocable
 * - You can fund an idea without funding any particular executor
 * - Multiple executors can compete for the same idea's execution stream
 *
 * Integration:
 * - RewardLedger: execution milestones recorded as value events
 * - ShapleyDistributor: rewards flow through trust chains
 */
interface IContributionYieldTokenizer {

    // ============ Enums ============

    enum IdeaStatus { ACTIVE, ARCHIVED }
    enum StreamStatus { ACTIVE, STALLED, REDIRECTED, COMPLETED }

    // ============ Structs ============

    /// @notice An idea — permanently tokenized concept
    struct Idea {
        uint256 ideaId;
        address creator;           // Original proposer
        bytes32 contentHash;       // IPFS hash of idea document
        uint256 totalFunding;      // Total reward tokens deposited as funding
        uint256 createdAt;
        IdeaStatus status;
        address ideaToken;         // ERC20 Idea Token address
    }

    /// @notice An execution stream — continuous funding for an executor
    struct ExecutionStream {
        uint256 streamId;
        uint256 ideaId;            // Which idea this executes
        address executor;          // Current executor
        uint256 streamRate;        // Tokens per second flowing to executor
        uint256 totalStreamed;     // Cumulative tokens streamed
        uint256 lastUpdate;        // Last stream rate update
        uint256 lastMilestone;     // Timestamp of last progress report
        uint256 staleDuration;     // Seconds since last milestone before decay kicks in
        StreamStatus status;
    }

    // ============ Events ============

    event IdeaCreated(uint256 indexed ideaId, address indexed creator, address ideaToken, bytes32 contentHash);
    event IdeaFunded(uint256 indexed ideaId, address indexed funder, uint256 amount);
    event IdeaTokensMinted(uint256 indexed ideaId, address indexed to, uint256 amount);

    event StreamCreated(uint256 indexed streamId, uint256 indexed ideaId, address indexed executor);
    event StreamRateUpdated(uint256 indexed streamId, uint256 newRate);
    event StreamClaimed(uint256 indexed streamId, address indexed executor, uint256 amount);
    event StreamStalled(uint256 indexed streamId);
    event StreamRedirected(uint256 indexed streamId, address indexed oldExecutor, address indexed newExecutor);
    event StreamCompleted(uint256 indexed streamId);
    event MilestoneReported(uint256 indexed streamId, bytes32 evidenceHash, uint256 timestamp);

    // ============ Errors ============

    error IdeaNotFound();
    error StreamNotFound();
    error StreamNotActive();
    error StreamStillActive();
    error NotExecutor();
    error NotIdeaTokenHolder();
    error ZeroAmount();
    error ZeroAddress();
    error NothingToClaim();
    error StalePeriodNotReached();
    error Unauthorized();

    // ============ Idea Functions ============

    /// @notice Create a new idea and mint its Idea Token
    /// @param contentHash IPFS hash of the idea document
    /// @param initialFunding Optional initial funding in reward tokens
    /// @return ideaId The new idea's ID
    function createIdea(bytes32 contentHash, uint256 initialFunding) external returns (uint256 ideaId);

    /// @notice Fund an existing idea (deposit reward tokens, get IT minted)
    /// @param ideaId The idea to fund
    /// @param amount Reward tokens to deposit
    function fundIdea(uint256 ideaId, uint256 amount) external;

    // ============ Execution Stream Functions ============

    /// @notice Propose to execute an idea (creates a stream, auto-starts flowing)
    /// @param ideaId The idea to execute
    /// @return streamId The new stream's ID
    function proposeExecution(uint256 ideaId) external returns (uint256 streamId);

    /// @notice Report execution progress (resets stale timer)
    /// @param streamId The execution stream
    /// @param evidenceHash IPFS hash of milestone evidence
    function reportMilestone(uint256 streamId, bytes32 evidenceHash) external;

    /// @notice Claim accumulated stream funds
    /// @param streamId The execution stream
    function claimStream(uint256 streamId) external;

    /// @notice Mark a stream as completed
    /// @param streamId The execution stream
    function completeStream(uint256 streamId) external;

    /// @notice Trigger stale check — if executor hasn't reported milestones, stall the stream
    /// @param streamId The execution stream to check
    function checkStale(uint256 streamId) external;

    /// @notice Redirect a stalled stream to a new executor
    /// @param streamId The stalled stream
    /// @param newExecutor The proposed new executor
    function redirectStream(uint256 streamId, address newExecutor) external;

    // ============ View Functions ============

    function getIdea(uint256 ideaId) external view returns (Idea memory);
    function getStream(uint256 streamId) external view returns (ExecutionStream memory);
    function getStreamRate(uint256 streamId) external view returns (uint256);
    function pendingStreamAmount(uint256 streamId) external view returns (uint256);
    function getIdeaStreamCount(uint256 ideaId) external view returns (uint256);
    function getIdeaStreams(uint256 ideaId) external view returns (uint256[] memory streamIds);
}
