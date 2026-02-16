// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/framework/VibeIntentRouter.sol";
import "../../contracts/framework/interfaces/IVibeIntentRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFuzzRouterToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockFuzzAMM {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }

    mapping(bytes32 => Pool) public pools;

    function createPool(address t0, address t1, uint256 feeRate) external returns (bytes32 poolId) {
        (address token0, address token1) = t0 < t1 ? (t0, t1) : (t1, t0);
        poolId = keccak256(abi.encodePacked(token0, token1));
        pools[poolId] = Pool(token0, token1, 0, 0, 0, feeRate, true);
    }

    function seedPool(bytes32 poolId, uint256 r0, uint256 r1) external {
        pools[poolId].reserve0 = r0;
        pools[poolId].reserve1 = r1;
        pools[poolId].totalLiquidity = r0;
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    function getLPToken(bytes32) external pure returns (address) {
        return address(0);
    }

    function quote(bytes32 poolId, address, uint256 amountIn) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        if (!pool.initialized || pool.reserve0 == 0 || pool.reserve1 == 0) return 0;
        uint256 amountInWithFee = amountIn * (10000 - pool.feeRate);
        return (amountInWithFee * pool.reserve1) / (pool.reserve0 * 10000 + amountInWithFee);
    }

    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        require(pool.initialized, "Pool not found");

        uint256 amountInWithFee = amountIn * (10000 - pool.feeRate);
        amountOut = (amountInWithFee * pool.reserve1) / (pool.reserve0 * 10000 + amountInWithFee);
        require(amountOut >= minAmountOut, "Insufficient output");

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        address tokenOut = tokenIn == pool.token0 ? pool.token1 : pool.token0;
        IERC20(tokenOut).transfer(recipient, amountOut);

        if (tokenIn == pool.token0) {
            pool.reserve0 += amountIn;
            pool.reserve1 -= amountOut;
        } else {
            pool.reserve1 += amountIn;
            pool.reserve0 -= amountOut;
        }
    }
}

contract MockFuzzAuction {
    uint256 public nonce;
    function commitOrder(bytes32) external payable returns (bytes32) {
        return keccak256(abi.encodePacked(++nonce));
    }
    function revealOrder(bytes32, address, address, uint256, uint256, bytes32, uint256) external payable {}
}

// ============ Fuzz Tests ============

/**
 * @title VibeIntentRouter Fuzz Tests
 * @notice Property-based testing for intent routing across venues.
 *         Validates that routing always picks optimal path, respects bounds,
 *         and never leaves tokens stuck in the router.
 */
contract VibeIntentRouterFuzzTest is Test {
    VibeIntentRouter public router;
    MockFuzzAMM public amm;
    MockFuzzAuction public auction;
    MockFuzzRouterToken public tokenA;
    MockFuzzRouterToken public tokenB;
    bytes32 public poolId;

    address public alice;

    uint256 constant RESERVE = 1_000_000 ether;

    function setUp() public {
        alice = makeAddr("alice");

        tokenA = new MockFuzzRouterToken("Token A", "TKA");
        tokenB = new MockFuzzRouterToken("Token B", "TKB");

        amm = new MockFuzzAMM();
        auction = new MockFuzzAuction();

        router = new VibeIntentRouter(
            address(amm),
            address(auction),
            address(0),
            address(0)
        );

        // Disable factory and cross-chain to simplify fuzz
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.CROSS_CHAIN, false);

        poolId = amm.createPool(address(tokenA), address(tokenB), 30);
        amm.seedPool(poolId, RESERVE, RESERVE);

        tokenB.mint(address(amm), RESERVE * 2);

        tokenA.mint(alice, type(uint128).max);
        vm.prank(alice);
        tokenA.approve(address(router), type(uint256).max);
    }

    /// @notice Any valid amount produces a valid quote (no reverts)
    function testFuzz_quoteIntent_anyValidAmount(uint256 amountIn) public view {
        amountIn = bound(amountIn, 1 ether, RESERVE / 2); // Need 1e18+ for non-zero output

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);
        assertTrue(quotes.length > 0, "Should always produce at least one quote");

        // AMM quote should be first and positive
        assertTrue(quotes[0].expectedOut > 0, "Best quote should be positive");
    }

    /// @notice AMM quote is always >= auction estimate (auction = 99.5% of AMM)
    function testFuzz_quoteIntent_ammBetterThanAuction(uint256 amountIn) public view {
        amountIn = bound(amountIn, 1 ether, RESERVE / 2);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);

        uint256 ammOut;
        uint256 auctionOut;
        for (uint256 i = 0; i < quotes.length; i++) {
            if (quotes[i].path == IVibeIntentRouter.ExecutionPath.AMM_DIRECT) ammOut = quotes[i].expectedOut;
            if (quotes[i].path == IVibeIntentRouter.ExecutionPath.BATCH_AUCTION) auctionOut = quotes[i].expectedOut;
        }

        assertTrue(ammOut >= auctionOut, "AMM should always beat auction estimate");
    }

    /// @notice Swapping always returns tokens to user, never to router
    function testFuzz_submitIntent_routerHoldsNoTokens(uint256 amountIn) public {
        amountIn = bound(amountIn, 1 ether, RESERVE / 10);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.prank(alice);
        router.submitIntent(intent);

        assertEq(tokenA.balanceOf(address(router)), 0, "Router should hold no tokenA");
        assertEq(tokenB.balanceOf(address(router)), 0, "Router should hold no tokenB");
    }

    /// @notice Output amount is always monotonically increasing with input
    function testFuzz_quoteIntent_outputMonotonic(uint256 amount1, uint256 amount2) public view {
        amount1 = bound(amount1, 1 ether, RESERVE / 4);
        amount2 = bound(amount2, amount1 + 1, RESERVE / 2);

        IVibeIntentRouter.Intent memory intent1 = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amount1,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.Intent memory intent2 = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amount2,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes1 = router.quoteIntent(intent1);
        IVibeIntentRouter.RouteQuote[] memory quotes2 = router.quoteIntent(intent2);

        assertTrue(quotes2[0].expectedOut >= quotes1[0].expectedOut,
            "Larger input should produce larger output");
    }

    /// @notice Deadline enforcement works for all fuzzed timestamps
    function testFuzz_submitIntent_deadlineEnforced(uint256 deadline, uint256 timestamp) public {
        deadline = bound(deadline, 1, type(uint64).max - 1);
        timestamp = bound(timestamp, deadline + 1, type(uint64).max);

        vm.warp(timestamp);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1 ether,
            minAmountOut: 0,
            deadline: deadline,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        vm.prank(alice);
        vm.expectRevert(IVibeIntentRouter.DeadlineExpired.selector);
        router.submitIntent(intent);
    }

    /// @notice Quotes are always sorted descending by expectedOut
    function testFuzz_quoteIntent_alwaysSorted(uint256 amountIn) public view {
        amountIn = bound(amountIn, 1 ether, RESERVE / 2);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);

        for (uint256 i = 1; i < quotes.length; i++) {
            assertTrue(quotes[i - 1].expectedOut >= quotes[i].expectedOut,
                "Quotes should be sorted descending");
        }
    }

    /// @notice User's balance change matches expected output
    function testFuzz_submitIntent_balanceConsistency(uint256 amountIn) public {
        amountIn = bound(amountIn, 1 ether, RESERVE / 10);

        // Get expected output first
        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);
        uint256 expectedOut = quotes[0].expectedOut;

        uint256 beforeA = tokenA.balanceOf(alice);
        uint256 beforeB = tokenB.balanceOf(alice);

        vm.prank(alice);
        router.submitIntent(intent);

        assertEq(tokenA.balanceOf(alice), beforeA - amountIn, "TokenA decrease should match amountIn");
        assertEq(tokenB.balanceOf(alice), beforeB + expectedOut, "TokenB increase should match quote");
    }

    /// @notice AMM always route picks best among available
    function testFuzz_submitIntent_bestRouteSelected(uint256 amountIn) public {
        amountIn = bound(amountIn, 1 ether, RESERVE / 10);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 1,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);
        uint256 bestExpected = quotes[0].expectedOut;

        uint256 beforeB = tokenB.balanceOf(alice);

        vm.prank(alice);
        router.submitIntent(intent);

        uint256 actualOut = tokenB.balanceOf(alice) - beforeB;
        assertEq(actualOut, bestExpected, "Should execute at best quoted price");
    }
}
