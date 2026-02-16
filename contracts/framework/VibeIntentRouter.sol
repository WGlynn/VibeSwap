// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IVibeIntentRouter.sol";
import "../core/interfaces/IVibeAMM.sol";

/**
 * @title VibeIntentRouter
 * @notice Intent-based order routing across VibeSwap venues.
 *
 *         Users express "swap X for best Y" — the router scores available venues
 *         (AMM direct, batch auction, cross-chain, PoolFactory pools) and routes
 *         to the best one.
 *
 *         Individual sovereignty: users declare desired outcome, not execution path.
 *         Cooperative efficiency: routing volume to healthiest pools strengthens
 *         the whole system.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol/Framework layer.
 */
contract VibeIntentRouter is IVibeIntentRouter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant AUCTION_ESTIMATE_BPS = 9950; // 99.5% of TWAP (conservative estimate)
    uint256 private constant BPS = 10000;

    // ============ State ============

    address public vibeAMM;
    address public auction;
    address public crossChainRouter;
    address public poolFactory;

    mapping(ExecutionPath => bool) public routeEnabled;
    mapping(bytes32 => PendingIntent) public pendingIntents;

    uint256 public intentNonce;

    // ============ Constructor ============

    constructor(
        address _vibeAMM,
        address _auction,
        address _crossChainRouter,
        address _poolFactory
    ) Ownable(msg.sender) {
        vibeAMM = _vibeAMM;
        auction = _auction;
        crossChainRouter = _crossChainRouter;
        poolFactory = _poolFactory;

        // Enable AMM and auction by default
        routeEnabled[ExecutionPath.AMM_DIRECT] = true;
        routeEnabled[ExecutionPath.BATCH_AUCTION] = true;
        routeEnabled[ExecutionPath.CROSS_CHAIN] = true;
        routeEnabled[ExecutionPath.FACTORY_POOL] = true;
    }

    // ============ Core Functions ============

    /**
     * @notice Submit an intent for best-path execution
     * @param intent The user's desired swap parameters
     * @return intentId Unique identifier for tracking
     */
    function submitIntent(
        Intent calldata intent
    ) external payable nonReentrant returns (bytes32 intentId) {
        // Validate
        if (intent.amountIn == 0) revert ZeroAmount();
        if (intent.tokenIn == intent.tokenOut) revert SameToken();
        if (intent.deadline != 0 && block.timestamp > intent.deadline) revert DeadlineExpired();

        // Generate unique intent ID
        intentId = keccak256(abi.encodePacked(
            msg.sender,
            intent.tokenIn,
            intent.tokenOut,
            intent.amountIn,
            ++intentNonce,
            block.timestamp
        ));

        // Get quotes and find the best route
        RouteQuote[] memory quotes = _quoteAll(intent);
        if (quotes.length == 0) revert NoValidRoute();

        // Best quote is first (sorted by expectedOut descending)
        RouteQuote memory best = quotes[0];
        if (best.expectedOut < intent.minAmountOut) revert InsufficientOutput();

        // Execute on the best path
        uint256 amountOut;

        if (best.path == ExecutionPath.AMM_DIRECT) {
            amountOut = _executeAMM(intent, best.venueId);
        } else if (best.path == ExecutionPath.BATCH_AUCTION) {
            _executeAuction(intentId, intent);
            emit IntentSubmitted(intentId, msg.sender, best.path);
            return intentId; // Auction is async — no amountOut yet
        } else if (best.path == ExecutionPath.CROSS_CHAIN) {
            _executeCrossChain(intent);
            emit IntentSubmitted(intentId, msg.sender, best.path);
            return intentId; // Cross-chain is async
        } else if (best.path == ExecutionPath.FACTORY_POOL) {
            amountOut = _executeFactoryQuoteOnly(intent, best);
            // Factory pools are quote-only in v1 — routes through AMM
        }

        emit IntentSubmitted(intentId, msg.sender, best.path);
        emit IntentExecuted(intentId, best.path, intent.amountIn, amountOut);

        return intentId;
    }

    /**
     * @notice Get quotes from all enabled venues
     * @param intent The intent to quote
     * @return quotes Sorted by expectedOut descending
     */
    function quoteIntent(
        Intent calldata intent
    ) external view returns (RouteQuote[] memory quotes) {
        if (intent.amountIn == 0) revert ZeroAmount();
        if (intent.tokenIn == intent.tokenOut) revert SameToken();
        return _quoteAll(intent);
    }

    /**
     * @notice Cancel a pending auction intent (before reveal)
     * @param intentId The intent to cancel
     */
    function cancelIntent(bytes32 intentId) external {
        PendingIntent storage pi = pendingIntents[intentId];
        if (pi.submitter == address(0)) revert IntentNotFound();
        if (pi.submitter != msg.sender) revert NotIntentOwner();
        if (pi.executed) revert IntentAlreadyExecuted();
        if (pi.cancelled) revert IntentAlreadyCancelled();

        pi.cancelled = true;

        emit IntentCancelled(intentId, msg.sender);
    }

    /**
     * @notice Reveal a pending auction intent during reveal phase
     * @param intentId The pending intent
     * @param secret Secret used in commitment hash
     * @param priorityBid Additional bid for priority execution
     */
    function revealPendingIntent(
        bytes32 intentId,
        bytes32 secret,
        uint256 priorityBid
    ) external payable nonReentrant {
        PendingIntent storage pi = pendingIntents[intentId];
        if (pi.submitter == address(0)) revert IntentNotFound();
        if (pi.submitter != msg.sender) revert NotIntentOwner();
        if (pi.executed) revert IntentAlreadyExecuted();
        if (pi.cancelled) revert IntentAlreadyCancelled();

        pi.executed = true;

        // Call auction reveal
        // Note: msg.sender must be the original committer for the auction to accept
        // The router stores the commitId for the user to reveal through the auction directly
        // This is a convenience wrapper
        (bool success,) = auction.call{value: msg.value}(
            abi.encodeWithSignature(
                "revealOrder(bytes32,address,address,uint256,uint256,bytes32,uint256)",
                pi.commitId,
                pi.intent.tokenIn,
                pi.intent.tokenOut,
                pi.intent.amountIn,
                pi.intent.minAmountOut,
                secret,
                priorityBid
            )
        );
        require(success, "Reveal failed");
    }

    // ============ Internal — Quoting ============

    function _quoteAll(Intent calldata intent) internal view returns (RouteQuote[] memory) {
        // Count enabled routes for array sizing
        RouteQuote[] memory temp = new RouteQuote[](4);
        uint256 count;

        // AMM Direct
        if (routeEnabled[ExecutionPath.AMM_DIRECT] && vibeAMM != address(0)) {
            (bool ok, uint256 out, bytes32 poolId) = _quoteAMM(intent);
            if (ok && out > 0) {
                temp[count++] = RouteQuote({
                    path: ExecutionPath.AMM_DIRECT,
                    expectedOut: out,
                    venueId: poolId,
                    estimatedGas: 150_000
                });
            }
        }

        // Factory Pool (quote-only — trading through AMM in v1)
        if (routeEnabled[ExecutionPath.FACTORY_POOL] && poolFactory != address(0)) {
            (bool ok, uint256 out, bytes32 poolId) = _quoteFactory(intent);
            if (ok && out > 0) {
                temp[count++] = RouteQuote({
                    path: ExecutionPath.FACTORY_POOL,
                    expectedOut: out,
                    venueId: poolId,
                    estimatedGas: 180_000
                });
            }
        }

        // Batch Auction (estimate only)
        if (routeEnabled[ExecutionPath.BATCH_AUCTION] && auction != address(0)) {
            (bool ok, uint256 out) = _quoteAuction(intent);
            if (ok && out > 0) {
                temp[count++] = RouteQuote({
                    path: ExecutionPath.BATCH_AUCTION,
                    expectedOut: out,
                    venueId: bytes32(0),
                    estimatedGas: 250_000
                });
            }
        }

        // Cross-chain (only if extraData provided)
        if (routeEnabled[ExecutionPath.CROSS_CHAIN] && crossChainRouter != address(0)
            && intent.extraData.length > 0) {
            temp[count++] = RouteQuote({
                path: ExecutionPath.CROSS_CHAIN,
                expectedOut: 0, // Can't estimate cross-chain output reliably
                venueId: bytes32(0),
                estimatedGas: 500_000
            });
        }

        // Copy to correctly-sized array and sort by expectedOut descending
        RouteQuote[] memory quotes = new RouteQuote[](count);
        for (uint256 i = 0; i < count; i++) {
            quotes[i] = temp[i];
        }

        // Simple insertion sort (max 4 elements)
        for (uint256 i = 1; i < count; i++) {
            RouteQuote memory key = quotes[i];
            uint256 j = i;
            while (j > 0 && quotes[j - 1].expectedOut < key.expectedOut) {
                quotes[j] = quotes[j - 1];
                j--;
            }
            quotes[j] = key;
        }

        return quotes;
    }

    function _quoteAMM(
        Intent calldata intent
    ) internal view returns (bool ok, uint256 amountOut, bytes32 poolId) {
        try IVibeAMM(vibeAMM).getPoolId(intent.tokenIn, intent.tokenOut) returns (bytes32 pid) {
            poolId = pid;
            try IVibeAMM(vibeAMM).quote(pid, intent.tokenIn, intent.amountIn) returns (uint256 out) {
                return (true, out, pid);
            } catch {
                return (false, 0, pid);
            }
        } catch {
            return (false, 0, bytes32(0));
        }
    }

    function _quoteFactory(
        Intent calldata intent
    ) internal view returns (bool ok, uint256 amountOut, bytes32 poolId) {
        // Factory pools have different poolId scheme (includes curveId)
        // For v1, we try the default constant-product curve
        bytes32 defaultCurveId = keccak256("CONSTANT_PRODUCT");

        // Use low-level staticcall since try/catch requires external calls
        (bool s1, bytes memory d1) = poolFactory.staticcall(
            abi.encodeWithSignature("getPoolId(address,address,bytes32)", intent.tokenIn, intent.tokenOut, defaultCurveId)
        );
        if (!s1 || d1.length < 32) return (false, 0, bytes32(0));
        poolId = abi.decode(d1, (bytes32));

        (bool s2, bytes memory d2) = poolFactory.staticcall(
            abi.encodeWithSignature("quoteAmountOut(bytes32,uint256)", poolId, intent.amountIn)
        );
        if (!s2 || d2.length < 32) return (false, 0, poolId);
        amountOut = abi.decode(d2, (uint256));

        return (true, amountOut, poolId);
    }

    function _quoteAuction(
        Intent calldata intent
    ) internal view returns (bool ok, uint256 estimatedOut) {
        // Auction clearing price is unknowable before settlement.
        // Estimate using AMM spot price with small discount (99.5% of AMM quote)
        // to account for batch auction's uniform clearing price advantage.
        (bool ammOk, uint256 ammOut,) = _quoteAMM(intent);
        if (ammOk && ammOut > 0) {
            return (true, (ammOut * AUCTION_ESTIMATE_BPS) / BPS);
        }
        return (false, 0);
    }

    // ============ Internal — Execution ============

    function _executeAMM(
        Intent calldata intent,
        bytes32 poolId
    ) internal returns (uint256 amountOut) {
        // Transfer tokens from user to router
        IERC20(intent.tokenIn).safeTransferFrom(msg.sender, address(this), intent.amountIn);

        // Approve AMM
        IERC20(intent.tokenIn).safeIncreaseAllowance(vibeAMM, intent.amountIn);

        // Execute swap via low-level call (swap() not in IVibeAMM interface)
        (bool success, bytes memory data) = vibeAMM.call(
            abi.encodeWithSignature(
                "swap(bytes32,address,uint256,uint256,address)",
                poolId,
                intent.tokenIn,
                intent.amountIn,
                intent.minAmountOut,
                msg.sender // tokens go directly to user
            )
        );
        require(success, "AMM swap failed");
        amountOut = abi.decode(data, (uint256));
    }

    function _executeAuction(
        bytes32 intentId,
        Intent calldata intent
    ) internal {
        // Build commit hash (user would normally provide secret, but here we
        // create a deterministic one — user reveals via revealPendingIntent)
        bytes32 commitHash = keccak256(abi.encodePacked(
            msg.sender,
            intent.tokenIn,
            intent.tokenOut,
            intent.amountIn,
            intent.minAmountOut,
            intentId // use intentId as part of hash for uniqueness
        ));

        // Send commit to auction (requires ETH deposit)
        (bool success, bytes memory data) = auction.call{value: msg.value}(
            abi.encodeWithSignature("commitOrder(bytes32)", commitHash)
        );
        require(success, "Auction commit failed");
        bytes32 commitId = abi.decode(data, (bytes32));

        // Store pending intent for later reveal
        pendingIntents[intentId] = PendingIntent({
            intent: intent,
            submitter: msg.sender,
            commitId: commitId,
            submittedAt: block.timestamp,
            executed: false,
            cancelled: false
        });

        emit IntentRoutedToAuction(intentId, commitId);
    }

    function _executeCrossChain(Intent calldata intent) internal {
        if (intent.extraData.length == 0) revert CrossChainDataRequired();

        // Decode destination EID and options from extraData
        (uint32 dstEid, bytes memory options) = abi.decode(intent.extraData, (uint32, bytes));

        // Build commit hash for cross-chain
        bytes32 commitHash = keccak256(abi.encodePacked(
            msg.sender,
            intent.tokenIn,
            intent.tokenOut,
            intent.amountIn,
            intent.minAmountOut
        ));

        // Forward to CrossChainRouter (requires msg.value for LayerZero fees)
        (bool success,) = crossChainRouter.call{value: msg.value}(
            abi.encodeWithSignature(
                "sendCommit(uint32,bytes32,bytes)",
                dstEid,
                commitHash,
                options
            )
        );
        require(success, "Cross-chain commit failed");
    }

    function _executeFactoryQuoteOnly(
        Intent calldata intent,
        RouteQuote memory /* quote */
    ) internal returns (uint256) {
        // Factory pools are quote-only in v1.
        // If a factory pool returns a better quote, we still execute through AMM.
        // This is a simplification — future versions will add direct factory swap.
        (bool ok,, bytes32 ammPoolId) = _quoteAMM(intent);
        if (ok) {
            return _executeAMM(intent, ammPoolId);
        }
        revert NoValidRoute();
    }

    // ============ Admin ============

    function setVibeAMM(address _amm) external onlyOwner {
        vibeAMM = _amm;
    }

    function setAuction(address _auction) external onlyOwner {
        auction = _auction;
    }

    function setCrossChainRouter(address _router) external onlyOwner {
        crossChainRouter = _router;
    }

    function setPoolFactory(address _factory) external onlyOwner {
        poolFactory = _factory;
    }

    function setRouteEnabled(ExecutionPath path, bool enabled) external onlyOwner {
        routeEnabled[path] = enabled;
        emit RouteToggled(path, enabled);
    }

    // ============ Views ============

    function getPendingIntent(bytes32 intentId) external view returns (PendingIntent memory) {
        return pendingIntents[intentId];
    }

    function isRouteEnabled(ExecutionPath path) external view returns (bool) {
        return routeEnabled[path];
    }

    // ============ Receive ============

    /// @notice Accept ETH refunds from auction/cross-chain
    receive() external payable {}
}
