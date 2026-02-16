// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeIntentRouter
 * @notice Interface for intent-based order routing across VibeSwap venues.
 *
 *         Individual sovereignty: users express desired outcome, not execution path.
 *         Cooperative efficiency: protocol routes to the healthiest pool, strengthening
 *         the whole system.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol/Framework layer.
 */
interface IVibeIntentRouter {
    // ============ Enums ============

    enum ExecutionPath { AMM_DIRECT, BATCH_AUCTION, CROSS_CHAIN, FACTORY_POOL }

    // ============ Structs ============

    struct Intent {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        ExecutionPath preferredPath; // optional hint — can be overridden by router
        bytes extraData;             // cross-chain: abi.encode(dstEid, options)
    }

    struct RouteQuote {
        ExecutionPath path;
        uint256 expectedOut;
        bytes32 venueId;       // poolId for AMM/Factory, batchId for auction
        uint256 estimatedGas;  // hint only
    }

    struct PendingIntent {
        Intent intent;
        address submitter;
        bytes32 commitId;
        uint256 submittedAt;
        bool executed;
        bool cancelled;
    }

    // ============ Events ============

    event IntentSubmitted(bytes32 indexed intentId, address indexed submitter, ExecutionPath path);
    event IntentExecuted(bytes32 indexed intentId, ExecutionPath path, uint256 amountIn, uint256 amountOut);
    event IntentRoutedToAuction(bytes32 indexed intentId, bytes32 commitId);
    event IntentCancelled(bytes32 indexed intentId, address indexed submitter);
    event RouteToggled(ExecutionPath indexed path, bool enabled);

    // ============ Errors ============

    error ZeroAmount();
    error SameToken();
    error DeadlineExpired();
    error InsufficientOutput();
    error RouteDisabled();
    error IntentNotFound();
    error IntentAlreadyExecuted();
    error IntentAlreadyCancelled();
    error NotIntentOwner();
    error NoValidRoute();
    error CrossChainDataRequired();

    // ============ Core Functions ============

    function submitIntent(Intent calldata intent) external payable returns (bytes32 intentId);
    function quoteIntent(Intent calldata intent) external view returns (RouteQuote[] memory quotes);
    function cancelIntent(bytes32 intentId) external;
    function revealPendingIntent(
        bytes32 intentId,
        bytes32 secret,
        uint256 priorityBid
    ) external payable;

    // ============ Admin ============

    function setVibeAMM(address amm) external;
    function setAuction(address auction) external;
    function setCrossChainRouter(address router) external;
    function setPoolFactory(address factory) external;
    function setRouteEnabled(ExecutionPath path, bool enabled) external;

    // ============ Views ============

    function getPendingIntent(bytes32 intentId) external view returns (PendingIntent memory);
    function isRouteEnabled(ExecutionPath path) external view returns (bool);
}
