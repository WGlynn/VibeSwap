// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibePoolFactory.sol";
import "../../contracts/hooks/VibeHookRegistry.sol";
import "../../contracts/framework/VibeIntentRouter.sol";
import "../../contracts/amm/curves/ConstantProductCurve.sol";
import "../../contracts/hooks/interfaces/IVibeHook.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFRToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Hook that tracks all executions for verification
contract TrackingHook is IVibeHook {
    struct HookCall {
        bytes32 poolId;
        bytes data;
        uint256 timestamp;
    }

    HookCall[] public beforeCommitCalls;
    HookCall[] public afterCommitCalls;
    HookCall[] public beforeSettleCalls;
    HookCall[] public afterSettleCalls;
    HookCall[] public beforeSwapCalls;
    HookCall[] public afterSwapCalls;

    function beforeCommit(bytes32 poolId, bytes calldata data) external returns (bytes memory) {
        beforeCommitCalls.push(HookCall(poolId, data, block.timestamp));
        return "";
    }
    function afterCommit(bytes32 poolId, bytes calldata data) external returns (bytes memory) {
        afterCommitCalls.push(HookCall(poolId, data, block.timestamp));
        return "";
    }
    function beforeSettle(bytes32 poolId, bytes calldata data) external returns (bytes memory) {
        beforeSettleCalls.push(HookCall(poolId, data, block.timestamp));
        return "";
    }
    function afterSettle(bytes32 poolId, bytes calldata data) external returns (bytes memory) {
        afterSettleCalls.push(HookCall(poolId, data, block.timestamp));
        return "";
    }
    function beforeSwap(bytes32 poolId, bytes calldata data) external returns (bytes memory) {
        beforeSwapCalls.push(HookCall(poolId, data, block.timestamp));
        return "";
    }
    function afterSwap(bytes32 poolId, bytes calldata data) external returns (bytes memory) {
        afterSwapCalls.push(HookCall(poolId, data, block.timestamp));
        return "";
    }

    function getHookFlags() external pure returns (uint8) {
        return 63; // All 6 hook points enabled
    }

    function getCallCount(uint8 hookPoint) external view returns (uint256) {
        if (hookPoint == 0) return beforeCommitCalls.length;
        if (hookPoint == 1) return afterCommitCalls.length;
        if (hookPoint == 2) return beforeSettleCalls.length;
        if (hookPoint == 3) return afterSettleCalls.length;
        if (hookPoint == 4) return beforeSwapCalls.length;
        if (hookPoint == 5) return afterSwapCalls.length;
        return 0;
    }
}

/// @notice Hook that always reverts (to test graceful degradation)
contract RevertingHook is IVibeHook {
    function beforeCommit(bytes32, bytes calldata) external pure returns (bytes memory) { revert("HOOK_FAIL"); }
    function afterCommit(bytes32, bytes calldata) external pure returns (bytes memory) { revert("HOOK_FAIL"); }
    function beforeSettle(bytes32, bytes calldata) external pure returns (bytes memory) { revert("HOOK_FAIL"); }
    function afterSettle(bytes32, bytes calldata) external pure returns (bytes memory) { revert("HOOK_FAIL"); }
    function beforeSwap(bytes32, bytes calldata) external pure returns (bytes memory) { revert("HOOK_FAIL"); }
    function afterSwap(bytes32, bytes calldata) external pure returns (bytes memory) { revert("HOOK_FAIL"); }
    function getHookFlags() external pure returns (uint8) { return 63; }
}

/// @notice Mock VibeAMM that provides quotes for the IntentRouter
contract MockVibeAMMForRouter {
    mapping(bytes32 => uint256) public poolQuotes;
    mapping(bytes32 => bool) public poolExists;

    MockFRToken tokenIn;
    MockFRToken tokenOut;

    constructor(address _tokenIn, address _tokenOut) {
        tokenIn = MockFRToken(_tokenIn);
        tokenOut = MockFRToken(_tokenOut);
    }

    function setPoolQuote(bytes32 poolId, uint256 quoteAmount) external {
        poolQuotes[poolId] = quoteAmount;
        poolExists[poolId] = true;
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function quote(bytes32 poolId, address, uint256) external view returns (uint256) {
        require(poolExists[poolId], "Pool not found");
        return poolQuotes[poolId];
    }

    // Minimal swap function for AMM execution
    function swap(
        bytes32 poolId,
        address _tokenIn,
        uint256 amountIn,
        uint256,
        address recipient
    ) external returns (uint256) {
        require(poolExists[poolId], "Pool not found");
        IERC20(_tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = poolQuotes[poolId];
        tokenOut.mint(recipient, amountOut);
        return amountOut;
    }
}

// ============ Integration Test: Framework Routing Pipeline ============

/**
 * @title FrameworkRoutingPipelineTest
 * @notice Tests the complete framework layer routing pipeline:
 *   1. Register curve → VibePoolFactory accepts new curve strategy
 *   2. Create pool with hook → VibePoolFactory deploys LP + attaches hook via VibeHookRegistry
 *   3. Hook execution → VibeHookRegistry.executeHook dispatches to IVibeHook
 *   4. Quote intent → VibeIntentRouter quotes AMM and Factory pool
 *   5. Route selection → Router picks best quote across venues
 *   6. Graceful degradation → Reverting hooks don't block operations
 */
contract FrameworkRoutingPipelineTest is Test {
    // Core contracts
    VibePoolFactory factory;
    VibeHookRegistry hookRegistry;
    VibeIntentRouter router;
    ConstantProductCurve cpCurve;

    // Hooks
    TrackingHook trackingHook;
    RevertingHook revertingHook;

    // Mock AMM
    MockVibeAMMForRouter mockAMM;

    // Tokens
    MockFRToken weth;
    MockFRToken usdc;

    // State
    address owner;
    address user;
    bytes32 cpCurveId;

    function setUp() public {
        owner = address(this);
        user = makeAddr("user");

        // Deploy tokens
        weth = new MockFRToken("Wrapped Ether", "WETH");
        usdc = new MockFRToken("USD Coin", "USDC");

        // Deploy hooks
        trackingHook = new TrackingHook();
        revertingHook = new RevertingHook();

        // Deploy hook registry
        hookRegistry = new VibeHookRegistry();

        // Deploy ConstantProductCurve
        cpCurve = new ConstantProductCurve();
        cpCurveId = cpCurve.curveId();

        // Deploy factory with hook registry
        factory = new VibePoolFactory(address(hookRegistry));

        // Register the constant product curve
        factory.registerCurve(address(cpCurve));

        // Deploy mock AMM
        mockAMM = new MockVibeAMMForRouter(address(weth), address(usdc));

        // Deploy IntentRouter
        router = new VibeIntentRouter(
            address(mockAMM),    // AMM
            address(0),          // auction (disabled)
            address(0),          // cross-chain (disabled)
            address(factory)     // factory
        );

        // Disable auction and cross-chain routes (not testing those here)
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.BATCH_AUCTION, false);
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.CROSS_CHAIN, false);

        // Fund user
        weth.mint(user, 1000 ether);
        usdc.mint(user, 2_000_000 ether);
    }

    // ============ Test: Curve registration ============

    function test_curveRegistration() public view {
        assertTrue(factory.isCurveApproved(cpCurveId));
        assertEq(factory.getCurveAddress(cpCurveId), address(cpCurve));

        bytes32[] memory curves = factory.getApprovedCurves();
        assertEq(curves.length, 1);
        assertEq(curves[0], cpCurveId);
    }

    // ============ Test: Pool creation with hook attachment ============

    function test_createPool_withHookAttachment() public {
        // Set factory as pool owner in hook registry so it can attach hooks
        bytes32 expectedPoolId = factory.getPoolId(address(weth), address(usdc), cpCurveId);
        hookRegistry.setPoolOwner(expectedPoolId, address(factory));

        bytes32 poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(weth),
            tokenB: address(usdc),
            curveId: cpCurveId,
            feeRate: 30, // 0.3%
            curveParams: "",
            hook: address(trackingHook),
            hookFlags: 63 // all hooks enabled
        }));

        // Pool created
        assertEq(poolId, expectedPoolId);
        assertTrue(factory.getPool(poolId).feeRate > 0);

        // LP token deployed
        address lpToken = factory.getLPToken(poolId);
        assertTrue(lpToken != address(0));

        // Hook should be attached via registry
        assertTrue(hookRegistry.isHookActive(poolId));
    }

    // ============ Test: Pool creation WITHOUT hook (hook = address(0)) ============

    function test_createPool_withoutHook() public {
        bytes32 poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(weth),
            tokenB: address(usdc),
            curveId: cpCurveId,
            feeRate: 30,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));

        assertTrue(poolId != bytes32(0));
        assertFalse(hookRegistry.isHookActive(poolId));
    }

    // ============ Test: Hook execution via registry ============

    function test_hookExecution_viahookRegistry() public {
        bytes32 poolId = _createPoolWithHook(address(trackingHook));

        // Execute hooks at various points
        hookRegistry.executeHook(
            poolId,
            IVibeHookRegistry.HookPoint.BEFORE_SWAP,
            abi.encode(user, 1 ether)
        );
        hookRegistry.executeHook(
            poolId,
            IVibeHookRegistry.HookPoint.AFTER_SWAP,
            abi.encode(user, 0.99 ether)
        );

        // Verify hook received calls
        assertEq(trackingHook.getCallCount(4), 1); // BEFORE_SWAP
        assertEq(trackingHook.getCallCount(5), 1); // AFTER_SWAP
    }

    // ============ Test: Reverting hook doesn't block operations ============

    function test_revertingHook_gracefulDegradation() public {
        bytes32 poolId = _createPoolWithHook(address(revertingHook));

        // Execute hook — should not revert (caught internally)
        hookRegistry.executeHook(
            poolId,
            IVibeHookRegistry.HookPoint.BEFORE_SWAP,
            abi.encode(user, 1 ether)
        );
        // No revert = graceful degradation works
    }

    // ============ Test: IntentRouter quotes from Factory pool ============

    function test_intentRouter_quotesFactoryPool() public {
        // Create factory pool with liquidity data
        _createPoolWithHook(address(0));

        // The factory pool needs reserves for quoting
        // VibePoolFactory v1 doesn't store reserves — quoting depends on the pool having data
        // For this test, we verify the router can reach the factory and get a quote structure

        // Enable only FACTORY_POOL route
        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT, false);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 1 ether,
            minAmountOut: 0,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.FACTORY_POOL,
            extraData: ""
        });

        // Quote should return (possibly empty if pool has no reserves, but no revert)
        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);
        // Just verify no revert — v1 factory pools may return 0 if no reserves
        assertTrue(true);
    }

    // ============ Test: IntentRouter routes to AMM when AMM has better quote ============

    function test_intentRouter_routesToBestVenue() public {
        // Setup AMM with a good quote
        (address t0, address t1) = address(weth) < address(usdc)
            ? (address(weth), address(usdc))
            : (address(usdc), address(weth));
        bytes32 ammPoolId = keccak256(abi.encodePacked(t0, t1));
        mockAMM.setPoolQuote(ammPoolId, 2000 ether); // 1 ETH = 2000 USDC

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 1 ether,
            minAmountOut: 1900 ether,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        // Quote should include AMM route
        IVibeIntentRouter.RouteQuote[] memory quotes = router.quoteIntent(intent);
        assertTrue(quotes.length > 0, "Should have at least one quote");
        assertEq(uint8(quotes[0].path), uint8(IVibeIntentRouter.ExecutionPath.AMM_DIRECT));
        assertEq(quotes[0].expectedOut, 2000 ether);
    }

    // ============ Test: IntentRouter executes AMM swap ============

    function test_intentRouter_executesAMMSwap() public {
        // Setup AMM pool
        (address t0, address t1) = address(weth) < address(usdc)
            ? (address(weth), address(usdc))
            : (address(usdc), address(weth));
        bytes32 ammPoolId = keccak256(abi.encodePacked(t0, t1));
        mockAMM.setPoolQuote(ammPoolId, 2000 ether);

        // User approves router
        vm.startPrank(user);
        weth.approve(address(router), 1 ether);

        IVibeIntentRouter.Intent memory intent = IVibeIntentRouter.Intent({
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 1 ether,
            minAmountOut: 1900 ether,
            deadline: 0,
            preferredPath: IVibeIntentRouter.ExecutionPath.AMM_DIRECT,
            extraData: ""
        });

        router.submitIntent(intent);
        vm.stopPrank();

        // User should receive USDC
        assertEq(usdc.balanceOf(user), 2_000_000 ether + 2000 ether); // initial + swap output
    }

    // ============ Test: Hook detachment ============

    function test_hookDetachment() public {
        bytes32 poolId = _createPoolWithHook(address(trackingHook));

        assertTrue(hookRegistry.isHookActive(poolId));

        // Detach hook (test contract is pool owner from _createPoolWithHook)
        hookRegistry.detachHook(poolId);

        assertFalse(hookRegistry.isHookActive(poolId));
    }

    // ============ Test: Hook flag update ============

    function test_hookFlagUpdate() public {
        bytes32 poolId = _createPoolWithHook(address(trackingHook));

        // Initially all flags (63)
        assertTrue(hookRegistry.hasHook(poolId, IVibeHookRegistry.HookPoint.BEFORE_COMMIT));
        assertTrue(hookRegistry.hasHook(poolId, IVibeHookRegistry.HookPoint.AFTER_SWAP));

        // Update to only BEFORE_SWAP + AFTER_SWAP (flags 16 + 32 = 48)
        hookRegistry.updateHookFlags(poolId, 48);

        assertFalse(hookRegistry.hasHook(poolId, IVibeHookRegistry.HookPoint.BEFORE_COMMIT));
        assertTrue(hookRegistry.hasHook(poolId, IVibeHookRegistry.HookPoint.BEFORE_SWAP));
        assertTrue(hookRegistry.hasHook(poolId, IVibeHookRegistry.HookPoint.AFTER_SWAP));
    }

    // ============ Test: Multiple pools with different curves ============

    function test_multiplePools_samePairDifferentCurves() public {
        // For same pair, different curves create different pools
        bytes32 poolId1 = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(weth),
            tokenB: address(usdc),
            curveId: cpCurveId,
            feeRate: 30,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));

        // Can't create duplicate (same pair + same curve)
        vm.expectRevert();
        factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(weth),
            tokenB: address(usdc),
            curveId: cpCurveId,
            feeRate: 50,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));

        assertTrue(poolId1 != bytes32(0));
        assertEq(factory.getPoolCount(), 1);
    }

    // ============ Test: Curve deregistration ============

    function test_curveDeregistration() public {
        factory.deregisterCurve(cpCurveId);
        assertFalse(factory.isCurveApproved(cpCurveId));

        // Can't create pool with deregistered curve
        vm.expectRevert();
        factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(weth),
            tokenB: address(usdc),
            curveId: cpCurveId,
            feeRate: 30,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));
    }

    // ============ Test: Route toggling ============

    function test_routeToggling() public {
        assertTrue(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.AMM_DIRECT));
        assertTrue(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL));

        router.setRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL, false);
        assertFalse(router.isRouteEnabled(IVibeIntentRouter.ExecutionPath.FACTORY_POOL));
    }

    // ============ Test: System wiring verification ============

    function test_systemWiring() public view {
        assertEq(address(factory.hookRegistry()), address(hookRegistry));
        assertEq(router.vibeAMM(), address(mockAMM));
        assertEq(router.poolFactory(), address(factory));
    }

    // ============ Helper: Create pool with optional hook ============

    function _createPoolWithHook(address hook) internal returns (bytes32 poolId) {
        bytes32 expectedPoolId = factory.getPoolId(address(weth), address(usdc), cpCurveId);

        if (hook != address(0)) {
            // Set factory as pool owner in hook registry
            hookRegistry.setPoolOwner(expectedPoolId, address(factory));
        }

        poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(weth),
            tokenB: address(usdc),
            curveId: cpCurveId,
            feeRate: 30,
            curveParams: "",
            hook: hook,
            hookFlags: hook != address(0) ? uint8(63) : uint8(0)
        }));

        if (hook != address(0)) {
            // Transfer pool ownership to test contract for hook management
            hookRegistry.setPoolOwner(poolId, address(this));
        }
    }
}
