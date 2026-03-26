// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibeRouter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Mock pool that implements the swap interface expected by VibeRouter
contract MockPool {
    uint256 public feeRate; // BPS

    constructor(uint256 _feeRate) {
        feeRate = _feeRate;
    }

    /// @dev swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 /* minOut */,
        address to
    ) external returns (uint256 amountOut) {
        // Simple mock: output = amountIn - fee
        amountOut = amountIn - (amountIn * feeRate / 10000);
        // Transfer tokenIn from router (already approved)
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        // Mint tokenOut to recipient
        MockERC20(tokenOut).mint(to, amountOut);
        return amountOut;
    }

    function getAmountOut(
        address /* tokenIn */,
        address /* tokenOut */,
        uint256 amountIn
    ) external view returns (uint256) {
        return amountIn - (amountIn * feeRate / 10000);
    }
}

/// @dev Mock pool that always reverts on swap
contract RevertingPool {
    function swap(address, address, uint256, uint256, address) external pure {
        revert("pool broken");
    }
}

/**
 * @title VibeRouter Fuzz Tests
 * @notice Comprehensive fuzz testing for VibeRouter swap routing,
 *         pool registration, and split-path invariants.
 */
contract VibeRouterFuzzTest is Test {
    VibeRouter public router;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC; // intermediate hop token
    MockPool public pool1;
    MockPool public pool2;
    MockPool public pool3; // for multi-hop

    address public owner;
    address public user;

    function setUp() public {
        owner = address(this);
        user = makeAddr("user");

        // Deploy tokens
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        tokenC = new MockERC20("Token C", "TKC");

        // Deploy router via UUPS proxy
        VibeRouter impl = new VibeRouter();
        bytes memory initData = abi.encodeWithSelector(VibeRouter.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = VibeRouter(address(proxy));

        // Deploy mock pools with different fee rates
        pool1 = new MockPool(30);  // 0.30% fee
        pool2 = new MockPool(10);  // 0.10% fee
        pool3 = new MockPool(20);  // 0.20% fee (for hops)

        // Register pools
        router.registerPool(address(pool1), 0); // ConstantProduct
        router.registerPool(address(pool2), 1); // StableSwap
        router.registerPool(address(pool3), 0); // ConstantProduct

        // Register pair pools for quote discovery
        router.registerPairPool(address(pool1), address(tokenA), address(tokenB));
        router.registerPairPool(address(pool2), address(tokenA), address(tokenB));
        router.registerPairPool(address(pool3), address(tokenA), address(tokenC));

        // Fund user
        tokenA.mint(user, 1_000_000 ether);
        tokenB.mint(user, 1_000_000 ether);
        tokenC.mint(user, 1_000_000 ether);

        vm.prank(user);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(user);
        tokenB.approve(address(router), type(uint256).max);
    }

    // ============ Split BPS Invariant Tests ============

    /**
     * @notice Fuzz test: split percentages must sum to exactly 10000 BPS
     * @dev Tests that invalid split sums are rejected
     */
    function testFuzz_splitBpsMustSumTo10000(uint256 split1, uint256 split2) public {
        split1 = bound(split1, 1, 9999);
        split2 = bound(split2, 1, 9999);

        // Skip if they happen to sum to 10000
        if (split1 + split2 == 10000) return;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](2);
        routes[0] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool1), 0);
        routes[1] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool2), 1);

        uint256[] memory splits = new uint256[](2);
        splits[0] = split1;
        splits[1] = split2;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user);
        vm.expectRevert(VibeRouter.InvalidSplitBps.selector);
        router.swap(params);
    }

    /**
     * @notice Fuzz test: single-route swap produces output proportional to input
     */
    function testFuzz_singleRouteSwapOutput(uint256 amountIn) public {
        amountIn = bound(amountIn, 0.001 ether, 100_000 ether);

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool1), 0);

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000; // 100%

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        uint256 balBefore = tokenB.balanceOf(user);

        vm.prank(user);
        uint256 amountOut = router.swap(params);

        uint256 balAfter = tokenB.balanceOf(user);

        // Output should match the difference in user's balance
        assertEq(amountOut, balAfter - balBefore, "Output mismatch with balance change");

        // Output should be positive and less than input (fees taken)
        assertGt(amountOut, 0, "Zero output from swap");
        assertLt(amountOut, amountIn, "Output exceeds input (impossible with fees)");

        // Output should be within expected fee range: amountIn * (1 - 0.30%)
        uint256 expectedOut = amountIn - (amountIn * 30 / 10000);
        assertEq(amountOut, expectedOut, "Output doesn't match expected fee calculation");
    }

    /**
     * @notice Fuzz test: multi-route split distributes tokens proportionally
     */
    function testFuzz_multiRouteSplitDistribution(uint256 amountIn, uint256 splitBps1) public {
        amountIn = bound(amountIn, 1 ether, 10_000 ether);
        splitBps1 = bound(splitBps1, 100, 9900); // At least 1%, at most 99%
        uint256 splitBps2 = 10000 - splitBps1;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](2);
        routes[0] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool1), 0);
        routes[1] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool2), 1);

        uint256[] memory splits = new uint256[](2);
        splits[0] = splitBps1;
        splits[1] = splitBps2;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user);
        uint256 amountOut = router.swap(params);

        // Calculate expected: each route processes its share
        uint256 route1In = (amountIn * splitBps1) / 10000;
        uint256 route2In = (amountIn * splitBps2) / 10000;
        uint256 route1Out = route1In - (route1In * 30 / 10000); // pool1 = 0.30%
        uint256 route2Out = route2In - (route2In * 10 / 10000); // pool2 = 0.10%
        uint256 expectedTotal = route1Out + route2Out;

        assertEq(amountOut, expectedTotal, "Multi-route output mismatch");
        assertGt(amountOut, 0, "Zero output from multi-route swap");
    }

    /**
     * @notice Fuzz test: deadline enforcement always works
     */
    function testFuzz_deadlineEnforcement(uint256 deadline) public {
        deadline = bound(deadline, 0, block.timestamp - 1);

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool1), 0);

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: deadline
        });

        vm.prank(user);
        vm.expectRevert(VibeRouter.DeadlineExpired.selector);
        router.swap(params);
    }

    /**
     * @notice Fuzz test: minAmountOut slippage protection
     */
    function testFuzz_minAmountOutProtection(uint256 amountIn, uint256 minOut) public {
        amountIn = bound(amountIn, 1 ether, 10_000 ether);
        uint256 expectedOut = amountIn - (amountIn * 30 / 10000); // pool1 fee = 0.30%
        minOut = bound(minOut, expectedOut + 1, type(uint128).max); // Set minOut above actual output

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool1), 0);

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: minOut,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.InsufficientOutput.selector, expectedOut, minOut));
        router.swap(params);
    }

    // ============ Pool Registration Tests ============

    /**
     * @notice Fuzz test: pool registration and removal maintains consistent state
     */
    function testFuzz_poolRegistrationConsistency(uint8 numPools) public {
        numPools = uint8(bound(numPools, 1, 20));

        // Track starting pool count (3 already registered in setUp)
        uint256 startCount = router.getRegisteredPoolCount();

        address[] memory newPools = new address[](numPools);
        for (uint256 i = 0; i < numPools; i++) {
            MockPool p = new MockPool(10);
            newPools[i] = address(p);
            router.registerPool(address(p), i % 3); // Cycle through pool types
        }

        assertEq(
            router.getRegisteredPoolCount(),
            startCount + numPools,
            "Pool count mismatch after registration"
        );

        // Remove all new pools
        for (uint256 i = 0; i < numPools; i++) {
            assertTrue(router.isRegisteredPool(newPools[i]), "Pool should be registered");
            router.removePool(newPools[i]);
            assertFalse(router.isRegisteredPool(newPools[i]), "Pool should be removed");
        }

        assertEq(
            router.getRegisteredPoolCount(),
            startCount,
            "Pool count should return to original"
        );
    }

    /**
     * @notice Fuzz test: cannot swap through unregistered pool
     */
    function testFuzz_unregisteredPoolRejected(address randomPool) public {
        vm.assume(randomPool != address(pool1));
        vm.assume(randomPool != address(pool2));
        vm.assume(randomPool != address(pool3));
        vm.assume(randomPool != address(0));

        VibeRouter.Route memory route;
        route.path = new address[](2);
        route.path[0] = address(tokenA);
        route.path[1] = address(tokenB);
        route.pools = new address[](1);
        route.pools[0] = randomPool;
        route.poolTypes = new uint256[](1);
        route.poolTypes[0] = 0;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = route;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.PoolNotRegistered.selector, randomPool));
        router.swap(params);
    }

    /**
     * @notice Fuzz test: invalid pool types are rejected on registration
     */
    function testFuzz_invalidPoolTypeRejected(uint256 poolType) public {
        poolType = bound(poolType, 3, type(uint256).max); // Must be > POOL_TYPE_BATCH_AUCTION (2)

        MockPool p = new MockPool(10);
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.InvalidPoolType.selector, poolType));
        router.registerPool(address(p), poolType);
    }

    // ============ Route Validation Tests ============

    /**
     * @notice Fuzz test: too many routes are rejected
     */
    function testFuzz_tooManyRoutesRejected(uint8 routeCount) public {
        routeCount = uint8(bound(routeCount, 6, 255)); // MAX_ROUTES = 5

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](routeCount);
        uint256[] memory splits = new uint256[](routeCount);

        for (uint256 i = 0; i < routeCount; i++) {
            routes[i] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool1), 0);
            splits[i] = 10000 / routeCount;
        }
        // Fix rounding so splits sum to 10000
        splits[0] += 10000 - (10000 / routeCount) * routeCount;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user);
        vm.expectRevert(VibeRouter.TooManyRoutes.selector);
        router.swap(params);
    }

    /**
     * @notice Fuzz test: zero amount swaps are rejected
     */
    function testFuzz_zeroAmountRejected() public {
        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool1), 0);

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 0,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user);
        vm.expectRevert(VibeRouter.ZeroAmount.selector);
        router.swap(params);
    }

    /**
     * @notice Fuzz test: router never retains user tokens after swap
     */
    function testFuzz_routerNeverRetainsTokens(uint256 amountIn) public {
        amountIn = bound(amountIn, 0.01 ether, 100_000 ether);

        uint256 routerBalABefore = tokenA.balanceOf(address(router));
        uint256 routerBalBBefore = tokenB.balanceOf(address(router));

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = _buildDirectRoute(address(tokenA), address(tokenB), address(pool1), 0);

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user);
        router.swap(params);

        uint256 routerBalAAfter = tokenA.balanceOf(address(router));
        uint256 routerBalBAfter = tokenB.balanceOf(address(router));

        // Router should not retain any tokens
        assertEq(routerBalAAfter, routerBalABefore, "Router retained tokenA");
        assertEq(routerBalBAfter, routerBalBBefore, "Router retained tokenB");
    }

    // ============ Helper Functions ============

    function _buildDirectRoute(
        address tokenIn,
        address tokenOut,
        address pool,
        uint256 poolType
    ) internal pure returns (VibeRouter.Route memory route) {
        route.path = new address[](2);
        route.path[0] = tokenIn;
        route.path[1] = tokenOut;
        route.pools = new address[](1);
        route.pools[0] = pool;
        route.poolTypes = new uint256[](1);
        route.poolTypes[0] = poolType;
    }
}
