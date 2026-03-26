// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/VibeRouter.sol";
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
        amountOut = amountIn - (amountIn * feeRate / 10000);
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
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

/// @dev Mock pool with zero fee for edge case testing
contract ZeroFeePool {
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256,
        address to
    ) external returns (uint256 amountOut) {
        amountOut = amountIn; // 1:1
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenOut).mint(to, amountOut);
        return amountOut;
    }

    function getAmountOut(address, address, uint256 amountIn) external pure returns (uint256) {
        return amountIn;
    }
}

/**
 * @title VibeRouter Unit Tests
 * @notice Comprehensive unit test coverage for the multi-path trade aggregation router.
 *         Covers initialization, pool registration/removal, single-route swaps,
 *         multi-route splits, multi-hop paths, deadline/slippage, access control,
 *         quote functionality, and edge cases.
 */
contract VibeRouterTest is Test {
    VibeRouter public router;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;
    MockERC20 public tokenD;
    MockPool public poolAB_30bps;   // A<>B at 0.30%
    MockPool public poolAB_10bps;   // A<>B at 0.10%
    MockPool public poolBC_20bps;   // B<>C at 0.20% (for hops)
    MockPool public poolCD_15bps;   // C<>D at 0.15% (for multi-hop)

    address public owner;
    address public alice;
    address public bob;

    // ============ Events ============

    event PoolRegistered(address indexed pool, uint256 poolType);
    event PoolRemoved(address indexed pool);
    event SwapExecuted(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 routeCount
    );

    // ============ setUp ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy tokens
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        tokenC = new MockERC20("Token C", "TKC");
        tokenD = new MockERC20("Token D", "TKD");

        // Deploy router via UUPS proxy
        VibeRouter impl = new VibeRouter();
        bytes memory initData = abi.encodeWithSelector(VibeRouter.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = VibeRouter(address(proxy));

        // Deploy mock pools
        poolAB_30bps = new MockPool(30);
        poolAB_10bps = new MockPool(10);
        poolBC_20bps = new MockPool(20);
        poolCD_15bps = new MockPool(15);

        // Register pools
        router.registerPool(address(poolAB_30bps), 0);
        router.registerPool(address(poolAB_10bps), 1);
        router.registerPool(address(poolBC_20bps), 0);
        router.registerPool(address(poolCD_15bps), 0);

        // Register pair pools for quote discovery
        router.registerPairPool(address(poolAB_30bps), address(tokenA), address(tokenB));
        router.registerPairPool(address(poolAB_10bps), address(tokenA), address(tokenB));
        router.registerPairPool(address(poolBC_20bps), address(tokenB), address(tokenC));
        router.registerPairPool(address(poolCD_15bps), address(tokenC), address(tokenD));

        // Fund users
        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenC.mint(alice, 1_000_000 ether);
        tokenD.mint(alice, 1_000_000 ether);

        tokenA.mint(bob, 1_000_000 ether);
        tokenB.mint(bob, 1_000_000 ether);

        // Approve router
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        tokenC.approve(address(router), type(uint256).max);
        tokenD.approve(address(router), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ============ Initialization Tests ============

    function test_initialize_setsOwner() public view {
        assertEq(router.owner(), owner);
    }

    function test_initialize_revertsOnZeroOwner() public {
        VibeRouter impl = new VibeRouter();
        bytes memory initData = abi.encodeWithSelector(VibeRouter.initialize.selector, address(0));
        vm.expectRevert(VibeRouter.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_cannotBeCalledTwice() public {
        vm.expectRevert();
        router.initialize(owner);
    }

    // ============ Pool Registration Tests ============

    function test_registerPool_success() public {
        MockPool newPool = new MockPool(50);

        vm.expectEmit(true, false, false, true);
        emit PoolRegistered(address(newPool), 0);

        router.registerPool(address(newPool), 0);

        assertTrue(router.isRegisteredPool(address(newPool)));
        assertEq(router.poolTypes(address(newPool)), 0);
        assertEq(router.getRegisteredPoolCount(), 5); // 4 from setUp + 1
    }

    function test_registerPool_allPoolTypes() public {
        MockPool p0 = new MockPool(10);
        MockPool p1 = new MockPool(10);
        MockPool p2 = new MockPool(10);

        router.registerPool(address(p0), 0); // ConstantProduct
        router.registerPool(address(p1), 1); // StableSwap
        router.registerPool(address(p2), 2); // BatchAuction

        assertEq(router.poolTypes(address(p0)), 0);
        assertEq(router.poolTypes(address(p1)), 1);
        assertEq(router.poolTypes(address(p2)), 2);
    }

    function test_registerPool_revertsOnZeroAddress() public {
        vm.expectRevert(VibeRouter.ZeroAddress.selector);
        router.registerPool(address(0), 0);
    }

    function test_registerPool_revertsOnDuplicate() public {
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.PoolAlreadyRegistered.selector, address(poolAB_30bps)));
        router.registerPool(address(poolAB_30bps), 0);
    }

    function test_registerPool_revertsOnInvalidPoolType() public {
        MockPool p = new MockPool(10);
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.InvalidPoolType.selector, 3));
        router.registerPool(address(p), 3);
    }

    function test_registerPool_revertsForNonOwner() public {
        MockPool p = new MockPool(10);
        vm.prank(alice);
        vm.expectRevert();
        router.registerPool(address(p), 0);
    }

    // ============ Pool Removal Tests ============

    function test_removePool_success() public {
        uint256 countBefore = router.getRegisteredPoolCount();

        vm.expectEmit(true, false, false, false);
        emit PoolRemoved(address(poolAB_30bps));

        router.removePool(address(poolAB_30bps));

        assertFalse(router.isRegisteredPool(address(poolAB_30bps)));
        assertEq(router.getRegisteredPoolCount(), countBefore - 1);
    }

    function test_removePool_revertsOnUnregistered() public {
        address fake = makeAddr("fake");
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.PoolNotRegistered.selector, fake));
        router.removePool(fake);
    }

    function test_removePool_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        router.removePool(address(poolAB_30bps));
    }

    function test_removePool_swapAndPopOrder() public {
        // Register additional pools to test swap-and-pop
        MockPool p1 = new MockPool(10);
        MockPool p2 = new MockPool(10);
        MockPool p3 = new MockPool(10);

        router.registerPool(address(p1), 0);
        router.registerPool(address(p2), 0);
        router.registerPool(address(p3), 0);

        uint256 countBefore = router.getRegisteredPoolCount();

        // Remove middle pool
        router.removePool(address(p2));

        assertEq(router.getRegisteredPoolCount(), countBefore - 1);
        assertFalse(router.isRegisteredPool(address(p2)));
        assertTrue(router.isRegisteredPool(address(p1)));
        assertTrue(router.isRegisteredPool(address(p3)));
    }

    function test_removePool_removeLast() public {
        MockPool p = new MockPool(10);
        router.registerPool(address(p), 0);

        uint256 countBefore = router.getRegisteredPoolCount();
        router.removePool(address(p));
        assertEq(router.getRegisteredPoolCount(), countBefore - 1);
    }

    // ============ Pair Pool Registration Tests ============

    function test_registerPairPool_success() public {
        MockPool p = new MockPool(10);
        router.registerPool(address(p), 0);
        router.registerPairPool(address(p), address(tokenA), address(tokenC));
        // No revert = success. (Pair pools are stored internally for quote discovery.)
    }

    function test_registerPairPool_revertsForUnregisteredPool() public {
        address fake = makeAddr("fake");
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.PoolNotRegistered.selector, fake));
        router.registerPairPool(fake, address(tokenA), address(tokenB));
    }

    // ============ Single-Route Swap Tests ============

    function test_swap_singleRoute_success() public {
        uint256 amountIn = 100 ether;

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            amountIn, 0, block.timestamp + 1 hours
        );

        uint256 aliceBBefore = tokenB.balanceOf(alice);

        vm.prank(alice);
        uint256 amountOut = router.swap(params);

        uint256 expected = amountIn - (amountIn * 30 / 10000);
        assertEq(amountOut, expected);
        assertEq(tokenB.balanceOf(alice), aliceBBefore + amountOut);
    }

    function test_swap_singleRoute_emitsEvent() public {
        uint256 amountIn = 50 ether;
        uint256 expectedOut = amountIn - (amountIn * 30 / 10000);

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            amountIn, 0, block.timestamp + 1 hours
        );

        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(alice, address(tokenA), address(tokenB), amountIn, expectedOut, 1);

        vm.prank(alice);
        router.swap(params);
    }

    function test_swap_singleRoute_lowerFeePoolGivesMoreOutput() public {
        uint256 amountIn = 100 ether;

        VibeRouter.SwapParams memory params30 = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            amountIn, 0, block.timestamp + 1 hours
        );

        VibeRouter.SwapParams memory params10 = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_10bps), 1,
            amountIn, 0, block.timestamp + 1 hours
        );

        vm.prank(alice);
        uint256 out30 = router.swap(params30);

        vm.prank(alice);
        uint256 out10 = router.swap(params10);

        assertGt(out10, out30, "Lower fee pool should give more output");
    }

    function test_swap_revertsOnExpiredDeadline() public {
        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            10 ether, 0, block.timestamp - 1
        );

        vm.prank(alice);
        vm.expectRevert(VibeRouter.DeadlineExpired.selector);
        router.swap(params);
    }

    function test_swap_revertsOnZeroAmount() public {
        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            0, 0, block.timestamp + 1 hours
        );

        vm.prank(alice);
        vm.expectRevert(VibeRouter.ZeroAmount.selector);
        router.swap(params);
    }

    function test_swap_revertsOnZeroTokenIn() public {
        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(0), address(tokenB), address(poolAB_30bps), 0,
            10 ether, 0, block.timestamp + 1 hours
        );
        // Override path[0] to be address(0)
        params.routes[0].path[0] = address(0);

        vm.prank(alice);
        vm.expectRevert(VibeRouter.ZeroAddress.selector);
        router.swap(params);
    }

    function test_swap_revertsOnZeroTokenOut() public {
        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(0), address(poolAB_30bps), 0,
            10 ether, 0, block.timestamp + 1 hours
        );
        params.routes[0].path[1] = address(0);

        vm.prank(alice);
        vm.expectRevert(VibeRouter.ZeroAddress.selector);
        router.swap(params);
    }

    function test_swap_revertsOnNoRoutes() public {
        VibeRouter.Route[] memory routes = new VibeRouter.Route[](0);
        uint256[] memory splits = new uint256[](0);

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(VibeRouter.InvalidRoutes.selector);
        router.swap(params);
    }

    function test_swap_revertsOnTooManyRoutes() public {
        VibeRouter.Route[] memory routes = new VibeRouter.Route[](6);
        uint256[] memory splits = new uint256[](6);

        for (uint256 i; i < 6; i++) {
            routes[i] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_30bps), 0);
            splits[i] = i < 5 ? 1666 : 1670; // Sum to 10000
        }

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(VibeRouter.TooManyRoutes.selector);
        router.swap(params);
    }

    function test_swap_revertsOnInsufficientOutput() public {
        uint256 amountIn = 100 ether;
        uint256 actualOut = amountIn - (amountIn * 30 / 10000);
        uint256 tooHighMin = actualOut + 1 ether;

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            amountIn, tooHighMin, block.timestamp + 1 hours
        );

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.InsufficientOutput.selector, actualOut, tooHighMin));
        router.swap(params);
    }

    function test_swap_revertsOnUnregisteredPool() public {
        MockPool unregistered = new MockPool(10);

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(unregistered), 0,
            10 ether, 0, block.timestamp + 1 hours
        );

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.PoolNotRegistered.selector, address(unregistered)));
        router.swap(params);
    }

    function test_swap_revertsOnRevertingPool() public {
        RevertingPool rp = new RevertingPool();
        router.registerPool(address(rp), 0);

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(rp), 0,
            10 ether, 0, block.timestamp + 1 hours
        );

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeRouter.SwapFailed.selector, address(rp)));
        router.swap(params);
    }

    // ============ Multi-Route Split Tests ============

    function test_swap_multiRoute_50_50Split() public {
        uint256 amountIn = 100 ether;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](2);
        routes[0] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_30bps), 0);
        routes[1] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_10bps), 1);

        uint256[] memory splits = new uint256[](2);
        splits[0] = 5000;
        splits[1] = 5000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        uint256 amountOut = router.swap(params);

        // 50 ether through 30bps pool + 50 ether through 10bps pool
        uint256 route1Out = 50 ether - (50 ether * 30 / 10000);
        uint256 route2Out = 50 ether - (50 ether * 10 / 10000);
        assertEq(amountOut, route1Out + route2Out);
    }

    function test_swap_multiRoute_unevenSplit() public {
        uint256 amountIn = 100 ether;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](2);
        routes[0] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_30bps), 0);
        routes[1] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_10bps), 1);

        uint256[] memory splits = new uint256[](2);
        splits[0] = 2000; // 20%
        splits[1] = 8000; // 80%

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        uint256 amountOut = router.swap(params);

        uint256 route1In = (100 ether * 2000) / 10000;
        uint256 route2In = (100 ether * 8000) / 10000;
        uint256 expected = (route1In - route1In * 30 / 10000) + (route2In - route2In * 10 / 10000);
        assertEq(amountOut, expected);
    }

    function test_swap_multiRoute_revertsOnBadSplitSum() public {
        VibeRouter.Route[] memory routes = new VibeRouter.Route[](2);
        routes[0] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_30bps), 0);
        routes[1] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_10bps), 1);

        uint256[] memory splits = new uint256[](2);
        splits[0] = 5000;
        splits[1] = 4000; // Total = 9000, not 10000

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(VibeRouter.InvalidSplitBps.selector);
        router.swap(params);
    }

    function test_swap_multiRoute_revertsOnMismatchedSplitsLength() public {
        VibeRouter.Route[] memory routes = new VibeRouter.Route[](2);
        routes[0] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_30bps), 0);
        routes[1] = _buildRoute(address(tokenA), address(tokenB), address(poolAB_10bps), 1);

        uint256[] memory splits = new uint256[](1); // Only 1 split for 2 routes
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(VibeRouter.InvalidSplitBps.selector);
        router.swap(params);
    }

    // ============ Multi-Hop Tests ============

    function test_swap_multiHop_twoHops() public {
        uint256 amountIn = 100 ether;

        // Route: tokenA -> (poolBC_20bps) -> tokenC (...wait, need A->B first)
        // Actually: tokenA -> poolAB -> tokenB -> poolBC -> tokenC

        VibeRouter.Route memory route;
        route.path = new address[](3);
        route.path[0] = address(tokenA);
        route.path[1] = address(tokenB);
        route.path[2] = address(tokenC);

        route.pools = new address[](2);
        route.pools[0] = address(poolAB_30bps);
        route.pools[1] = address(poolBC_20bps);

        route.poolTypes = new uint256[](2);
        route.poolTypes[0] = 0;
        route.poolTypes[1] = 0;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = route;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenC),
            amountIn: amountIn,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        uint256 amountOut = router.swap(params);

        // Hop 1: 100 ether through 30bps -> 99.7 ether of tokenB
        uint256 hop1Out = amountIn - (amountIn * 30 / 10000);
        // Hop 2: 99.7 ether through 20bps -> 99.7 - 0.1994 = ~99.5006
        uint256 hop2Out = hop1Out - (hop1Out * 20 / 10000);

        assertEq(amountOut, hop2Out);
    }

    function test_swap_multiHop_threeHops() public {
        uint256 amountIn = 100 ether;

        VibeRouter.Route memory route;
        route.path = new address[](4);
        route.path[0] = address(tokenA);
        route.path[1] = address(tokenB);
        route.path[2] = address(tokenC);
        route.path[3] = address(tokenD);

        route.pools = new address[](3);
        route.pools[0] = address(poolAB_30bps);
        route.pools[1] = address(poolBC_20bps);
        route.pools[2] = address(poolCD_15bps);

        route.poolTypes = new uint256[](3);
        route.poolTypes[0] = 0;
        route.poolTypes[1] = 0;
        route.poolTypes[2] = 0;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = route;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenD),
            amountIn: amountIn,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        uint256 amountOut = router.swap(params);

        uint256 hop1Out = amountIn - (amountIn * 30 / 10000);
        uint256 hop2Out = hop1Out - (hop1Out * 20 / 10000);
        uint256 hop3Out = hop2Out - (hop2Out * 15 / 10000);

        assertEq(amountOut, hop3Out);
    }

    function test_swap_revertsOnTooManyHops() public {
        // MAX_HOPS = 4, try 5 hops
        MockPool p5 = new MockPool(10);
        router.registerPool(address(p5), 0);

        VibeRouter.Route memory route;
        route.path = new address[](6); // 6 tokens = 5 hops
        route.path[0] = address(tokenA);
        route.path[1] = address(tokenB);
        route.path[2] = address(tokenC);
        route.path[3] = address(tokenD);
        route.path[4] = address(tokenA); // loop back (mock doesn't care)
        route.path[5] = address(tokenB);

        route.pools = new address[](5);
        route.pools[0] = address(poolAB_30bps);
        route.pools[1] = address(poolBC_20bps);
        route.pools[2] = address(poolCD_15bps);
        route.pools[3] = address(p5);
        route.pools[4] = address(poolAB_10bps);

        route.poolTypes = new uint256[](5);

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = route;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(VibeRouter.TooManyHops.selector);
        router.swap(params);
    }

    // ============ Route Validation Tests ============

    function test_swap_revertsOnPathTooShort() public {
        VibeRouter.Route memory route;
        route.path = new address[](1); // Too short (need at least 2)
        route.path[0] = address(tokenA);
        route.pools = new address[](0);
        route.poolTypes = new uint256[](0);

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = route;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(VibeRouter.InvalidRoutes.selector);
        router.swap(params);
    }

    function test_swap_revertsOnPathEndpointMismatch() public {
        VibeRouter.Route memory route;
        route.path = new address[](2);
        route.path[0] = address(tokenA);
        route.path[1] = address(tokenC); // Doesn't match tokenOut=tokenB

        route.pools = new address[](1);
        route.pools[0] = address(poolAB_30bps);
        route.poolTypes = new uint256[](1);
        route.poolTypes[0] = 0;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = route;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(VibeRouter.PathMismatch.selector);
        router.swap(params);
    }

    function test_swap_revertsOnPoolArrayLengthMismatch() public {
        VibeRouter.Route memory route;
        route.path = new address[](2);
        route.path[0] = address(tokenA);
        route.path[1] = address(tokenB);
        route.pools = new address[](2); // Should be 1 (path.length - 1)
        route.pools[0] = address(poolAB_30bps);
        route.pools[1] = address(poolAB_10bps);
        route.poolTypes = new uint256[](2);

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = route;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(VibeRouter.PathMismatch.selector);
        router.swap(params);
    }

    // ============ Quote Tests ============

    function test_getQuote_findsDirectRoute() public view {
        (uint256 amountOut, VibeRouter.Route memory bestRoute) = router.getQuote(
            address(tokenA), address(tokenB), 100 ether
        );

        assertGt(amountOut, 0);
        assertEq(bestRoute.path.length, 2);
        assertEq(bestRoute.path[0], address(tokenA));
        assertEq(bestRoute.path[1], address(tokenB));
    }

    function test_getQuote_selectsBestPool() public view {
        (uint256 amountOut, VibeRouter.Route memory bestRoute) = router.getQuote(
            address(tokenA), address(tokenB), 100 ether
        );

        // Pool with 10bps fee should give better output than 30bps
        uint256 expectedBest = 100 ether - (100 ether * 10 / 10000);
        assertEq(amountOut, expectedBest);
        assertEq(bestRoute.pools[0], address(poolAB_10bps));
    }

    function test_getQuote_returnsZeroForNoPair() public view {
        (uint256 amountOut,) = router.getQuote(
            address(tokenA), address(tokenD), 100 ether
        );
        // No direct pool for A<>D
        assertEq(amountOut, 0);
    }

    function test_getQuote_revertsOnZeroAmount() public {
        vm.expectRevert(VibeRouter.ZeroAmount.selector);
        router.getQuote(address(tokenA), address(tokenB), 0);
    }

    function test_getQuote_revertsOnZeroAddress() public {
        vm.expectRevert(VibeRouter.ZeroAddress.selector);
        router.getQuote(address(0), address(tokenB), 100 ether);
    }

    // ============ Router Token Retention Tests ============

    function test_swap_routerNeverRetainsTokens() public {
        uint256 routerABefore = tokenA.balanceOf(address(router));
        uint256 routerBBefore = tokenB.balanceOf(address(router));

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            100 ether, 0, block.timestamp + 1 hours
        );

        vm.prank(alice);
        router.swap(params);

        assertEq(tokenA.balanceOf(address(router)), routerABefore, "Router retained tokenA");
        assertEq(tokenB.balanceOf(address(router)), routerBBefore, "Router retained tokenB");
    }

    // ============ View Function Tests ============

    function test_getRegisteredPoolCount() public view {
        assertEq(router.getRegisteredPoolCount(), 4);
    }

    function test_registeredPools_accessible() public view {
        address first = router.registeredPools(0);
        assertTrue(first != address(0));
    }

    // ============ Fuzz Tests ============

    function testFuzz_swap_anyValidAmount(uint256 amountIn) public {
        amountIn = bound(amountIn, 0.001 ether, 100_000 ether);

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            amountIn, 0, block.timestamp + 1 hours
        );

        vm.prank(alice);
        uint256 amountOut = router.swap(params);

        uint256 expected = amountIn - (amountIn * 30 / 10000);
        assertEq(amountOut, expected);
    }

    function testFuzz_swap_deadlineEnforcement(uint256 deadline) public {
        deadline = bound(deadline, 0, block.timestamp - 1);

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            1 ether, 0, deadline
        );

        vm.prank(alice);
        vm.expectRevert(VibeRouter.DeadlineExpired.selector);
        router.swap(params);
    }

    function testFuzz_swap_outputNeverExceedsInput(uint256 amountIn) public {
        amountIn = bound(amountIn, 0.001 ether, 100_000 ether);

        VibeRouter.SwapParams memory params = _buildSingleRouteParams(
            address(tokenA), address(tokenB), address(poolAB_30bps), 0,
            amountIn, 0, block.timestamp + 1 hours
        );

        vm.prank(alice);
        uint256 amountOut = router.swap(params);

        assertLt(amountOut, amountIn, "Output should be less than input (fees)");
    }

    // ============ Helper Functions ============

    function _buildRoute(
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

    function _buildSingleRouteParams(
        address tokenIn,
        address tokenOut,
        address pool,
        uint256 poolType,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) internal pure returns (VibeRouter.SwapParams memory params) {
        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0] = _buildRoute(tokenIn, tokenOut, pool, poolType);

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        params = VibeRouter.SwapParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            routes: routes,
            splitBps: splits,
            deadline: deadline
        });
    }
}
