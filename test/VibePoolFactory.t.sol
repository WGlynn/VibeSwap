// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/VibePoolFactory.sol";
import "../contracts/amm/curves/ConstantProductCurve.sol";
import "../contracts/amm/curves/StableSwapCurve.sol";
import "../contracts/amm/interfaces/IPoolCurve.sol";
import "../contracts/amm/VibeLP.sol";
import "../contracts/hooks/interfaces/IVibeHookRegistry.sol";
import "../contracts/libraries/BatchMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Mock hook registry that always succeeds
contract MockHookRegistry is IVibeHookRegistry {
    mapping(bytes32 => HookConfig) private _configs;

    function attachHook(bytes32 poolId, address hook, uint8 flags) external {
        _configs[poolId] = HookConfig(hook, flags, uint40(block.timestamp), true);
        emit HookAttached(poolId, hook, flags);
    }

    function detachHook(bytes32 poolId) external {
        address hook = _configs[poolId].hook;
        delete _configs[poolId];
        emit HookDetached(poolId, hook);
    }

    function updateHookFlags(bytes32 poolId, uint8 newFlags) external {
        _configs[poolId].flags = newFlags;
        emit HookUpdated(poolId, newFlags);
    }

    function executeHook(bytes32, HookPoint, bytes calldata) external pure returns (bytes memory) {
        return "";
    }

    function setPoolOwner(bytes32 poolId, address poolOwner) external {
        emit PoolOwnerSet(poolId, poolOwner);
    }

    function getHookConfig(bytes32 poolId) external view returns (HookConfig memory) {
        return _configs[poolId];
    }

    function hasHook(bytes32 poolId, HookPoint) external view returns (bool) {
        return _configs[poolId].active;
    }

    function isHookActive(bytes32 poolId) external view returns (bool) {
        return _configs[poolId].active;
    }
}

/// @dev Mock hook registry that always reverts on attach
contract RevertingHookRegistry is IVibeHookRegistry {
    function attachHook(bytes32, address, uint8) external pure { revert("hook boom"); }
    function detachHook(bytes32) external pure { revert("hook boom"); }
    function updateHookFlags(bytes32, uint8) external pure { revert("hook boom"); }
    function executeHook(bytes32, HookPoint, bytes calldata) external pure returns (bytes memory) { revert("hook boom"); }
    function setPoolOwner(bytes32, address) external pure { revert("hook boom"); }
    function getHookConfig(bytes32) external pure returns (HookConfig memory) { revert("hook boom"); }
    function hasHook(bytes32, HookPoint) external pure returns (bool) { revert("hook boom"); }
    function isHookActive(bytes32) external pure returns (bool) { revert("hook boom"); }
}

/// @dev Fake curve for testing deregistration
contract FakeCurve is IPoolCurve {
    bytes32 public constant FAKE_ID = keccak256("FAKE_CURVE");
    function curveId() external pure returns (bytes32) { return FAKE_ID; }
    function curveName() external pure returns (string memory) { return "Fake"; }
    function getAmountOut(uint256, uint256, uint256, uint256, bytes calldata) external pure returns (uint256) { return 0; }
    function getAmountIn(uint256, uint256, uint256, uint256, bytes calldata) external pure returns (uint256) { return 0; }
    function validateParams(bytes calldata) external pure returns (bool) { return true; }
}

// ============ Test Contract ============

contract VibePoolFactoryTest is Test {
    VibePoolFactory public factory;
    ConstantProductCurve public cpCurve;
    StableSwapCurve public ssCurve;
    MockHookRegistry public hookRegistry;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;

    address public owner;
    address public alice;

    bytes32 public cpId;
    bytes32 public ssId;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");

        // Deploy curves
        cpCurve = new ConstantProductCurve();
        ssCurve = new StableSwapCurve();
        cpId = cpCurve.CURVE_ID();
        ssId = ssCurve.CURVE_ID();

        // Deploy mock hook registry
        hookRegistry = new MockHookRegistry();

        // Deploy factory
        factory = new VibePoolFactory(address(hookRegistry));

        // Deploy tokens (addresses will be ordered by value)
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        tokenC = new MockERC20("Token C", "TKC");

        // Register curves
        factory.registerCurve(address(cpCurve));
        factory.registerCurve(address(ssCurve));
    }

    // ============ Helper ============

    function _createCPPool() internal returns (bytes32) {
        return factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: cpId,
            feeRate: 0,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));
    }

    function _createSSPool(uint256 A) internal returns (bytes32) {
        return factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: ssId,
            feeRate: 0,
            curveParams: abi.encode(A),
            hook: address(0),
            hookFlags: 0
        }));
    }

    // ============ Constructor Tests ============

    function test_constructor_setsOwner() public view {
        assertEq(factory.owner(), owner);
    }

    function test_constructor_zeroHookRegistry() public {
        VibePoolFactory f = new VibePoolFactory(address(0));
        assertEq(address(f.hookRegistry()), address(0));
    }

    function test_setHookRegistry_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        factory.setHookRegistry(address(hookRegistry));
    }

    // ============ Curve Registration Tests ============

    function test_registerCurve_CP() public view {
        assertEq(factory.approvedCurves(cpId), address(cpCurve));
        assertTrue(factory.isCurveApproved(cpId));
    }

    function test_registerCurve_SS() public view {
        assertEq(factory.approvedCurves(ssId), address(ssCurve));
        assertTrue(factory.isCurveApproved(ssId));
    }

    function test_registerCurve_duplicate_reverts() public {
        vm.expectRevert(VibePoolFactory.CurveAlreadyRegistered.selector);
        factory.registerCurve(address(cpCurve));
    }

    function test_registerCurve_onlyOwner() public {
        FakeCurve fake = new FakeCurve();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        factory.registerCurve(address(fake));
    }

    function test_deregisterCurve() public {
        factory.deregisterCurve(cpId);
        assertFalse(factory.isCurveApproved(cpId));
        assertEq(factory.approvedCurves(cpId), address(0));
    }

    function test_getApprovedCurves() public view {
        bytes32[] memory curves = factory.getApprovedCurves();
        assertEq(curves.length, 2);
        // Both should be present (order may vary after deregister, but here they're in insertion order)
        assertTrue(curves[0] == cpId || curves[1] == cpId);
        assertTrue(curves[0] == ssId || curves[1] == ssId);
    }

    // ============ Pool Creation — Constant Product ============

    function test_createPool_CP_basic() public {
        bytes32 poolId = _createCPPool();

        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertTrue(pool.initialized);
        assertEq(pool.curveId, cpId);
        assertEq(pool.feeRate, factory.DEFAULT_FEE_RATE()); // default 5 BPS
        assertGt(pool.createdAt, 0);

        // LP token deployed
        address lp = factory.getLPToken(poolId);
        assertTrue(lp != address(0));
    }

    function test_createPool_CP_deterministicId() public {
        (address t0, address t1) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));

        bytes32 expectedId = keccak256(abi.encodePacked(t0, t1, cpId));
        bytes32 poolId = _createCPPool();
        assertEq(poolId, expectedId);

        // getPoolId matches
        assertEq(factory.getPoolId(address(tokenA), address(tokenB), cpId), poolId);
    }

    function test_createPool_CP_tokenOrdering() public {
        // Pass tokens in reverse order — should still work the same
        bytes32 poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenB),
            tokenB: address(tokenA),
            curveId: cpId,
            feeRate: 0,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));

        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertTrue(pool.token0 < pool.token1);
    }

    function test_createPool_CP_defaultFee() public {
        bytes32 poolId = _createCPPool();
        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertEq(pool.feeRate, 5); // 5 BPS default
    }

    function test_createPool_CP_customFee() public {
        bytes32 poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: cpId,
            feeRate: 30, // 0.3%
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));

        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertEq(pool.feeRate, 30);
    }

    function test_createPool_CP_duplicate_reverts() public {
        _createCPPool();

        vm.expectRevert(VibePoolFactory.PoolAlreadyExists.selector);
        _createCPPool();
    }

    function test_createPool_zeroToken_reverts() public {
        vm.expectRevert(VibePoolFactory.ZeroAddress.selector);
        factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(0),
            tokenB: address(tokenB),
            curveId: cpId,
            feeRate: 0,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));
    }

    function test_createPool_identicalTokens_reverts() public {
        vm.expectRevert(VibePoolFactory.IdenticalTokens.selector);
        factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenA),
            curveId: cpId,
            feeRate: 0,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));
    }

    // ============ Pool Creation — StableSwap ============

    function test_createPool_SS_basic() public {
        bytes32 poolId = _createSSPool(100);

        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertTrue(pool.initialized);
        assertEq(pool.curveId, ssId);
    }

    function test_createPool_SS_differentId_from_CP() public {
        bytes32 cpPoolId = _createCPPool();
        bytes32 ssPoolId = _createSSPool(100);

        assertTrue(cpPoolId != ssPoolId);
    }

    function test_createPool_SS_invalidAmp_reverts() public {
        vm.expectRevert(VibePoolFactory.InvalidCurveParams.selector);
        factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: ssId,
            feeRate: 0,
            curveParams: abi.encode(uint256(0)), // A=0 is invalid
            hook: address(0),
            hookFlags: 0
        }));
    }

    function test_createPool_SS_lowAmp() public {
        bytes32 poolId = _createSSPool(1); // A=1, behaves like CP
        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertTrue(pool.initialized);
    }

    function test_createPool_SS_highAmp() public {
        // Different pair so no collision with lowAmp test
        bytes32 poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenC),
            curveId: ssId,
            feeRate: 0,
            curveParams: abi.encode(uint256(10000)),
            hook: address(0),
            hookFlags: 0
        }));

        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertTrue(pool.initialized);
    }

    // ============ Pool Creation — Hook Integration ============

    function test_createPool_withHook() public {
        address mockHook = makeAddr("mockHook");

        bytes32 poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: cpId,
            feeRate: 0,
            curveParams: "",
            hook: mockHook,
            hookFlags: 63
        }));

        // Pool should be created
        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertTrue(pool.initialized);

        // Hook should be attached in registry
        IVibeHookRegistry.HookConfig memory config = hookRegistry.getHookConfig(poolId);
        assertEq(config.hook, mockHook);
        assertEq(config.flags, 63);
    }

    function test_createPool_withoutHook() public {
        bytes32 poolId = _createCPPool();

        // Pool created, no hook config
        assertTrue(factory.getPool(poolId).initialized);
    }

    function test_createPool_hookFails_gracefully() public {
        // Use reverting hook registry
        RevertingHookRegistry badRegistry = new RevertingHookRegistry();
        VibePoolFactory f2 = new VibePoolFactory(address(badRegistry));
        f2.registerCurve(address(cpCurve));

        address mockHook = makeAddr("mockHook");

        // Should NOT revert — graceful degradation
        bytes32 poolId = f2.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: cpId,
            feeRate: 0,
            curveParams: "",
            hook: mockHook,
            hookFlags: 63
        }));

        // Pool still created
        assertTrue(f2.getPool(poolId).initialized);
    }

    // ============ Curve Math — Constant Product ============

    function test_curveMath_CP_getAmountOut_matchesBatchMath() public view {
        uint256 amountIn = 1 ether;
        uint256 reserveIn = 100 ether;
        uint256 reserveOut = 100 ether;
        uint16 feeRate = 5;

        uint256 curveResult = cpCurve.getAmountOut(amountIn, reserveIn, reserveOut, feeRate, "");
        uint256 batchResult = BatchMath.getAmountOut(amountIn, reserveIn, reserveOut, feeRate);

        assertEq(curveResult, batchResult);
    }

    function test_curveMath_CP_getAmountIn_matchesBatchMath() public view {
        uint256 amountOut = 1 ether;
        uint256 reserveIn = 100 ether;
        uint256 reserveOut = 100 ether;
        uint16 feeRate = 5;

        uint256 curveResult = cpCurve.getAmountIn(amountOut, reserveIn, reserveOut, feeRate, "");
        uint256 batchResult = BatchMath.getAmountIn(amountOut, reserveIn, reserveOut, feeRate);

        assertEq(curveResult, batchResult);
    }

    function test_curveMath_CP_zeroInput_reverts() public {
        vm.expectRevert(ConstantProductCurve.InsufficientInput.selector);
        cpCurve.getAmountOut(0, 100 ether, 100 ether, 5, "");
    }

    function test_curveMath_CP_validateParams() public view {
        assertTrue(cpCurve.validateParams(""));
        assertTrue(cpCurve.validateParams(abi.encode(uint256(42)))); // ignored
    }

    // ============ Curve Math — StableSwap ============

    function test_curveMath_SS_nearPeg() public view {
        // Equal reserves, A=100 — should give near 1:1 with minimal slippage
        uint256 amountIn = 1 ether;
        uint256 reserveIn = 1000 ether;
        uint256 reserveOut = 1000 ether;
        bytes memory params = abi.encode(uint256(100));

        uint256 out = ssCurve.getAmountOut(amountIn, reserveIn, reserveOut, 0, params);

        // Near 1:1 — should be very close to 1 ether with high A and balanced reserves
        // StableSwap gives much better rate than CP for pegged assets
        assertGt(out, 0.999 ether);
        assertLt(out, 1 ether);
    }

    function test_curveMath_SS_imbalancedReserves() public view {
        // 80/20 imbalance — more slippage
        uint256 amountIn = 10 ether;
        uint256 reserveIn = 800 ether;
        uint256 reserveOut = 200 ether;
        bytes memory params = abi.encode(uint256(100));

        uint256 out = ssCurve.getAmountOut(amountIn, reserveIn, reserveOut, 0, params);

        // Should output something reasonable but with more slippage
        assertGt(out, 0);
        assertLt(out, amountIn); // can't get more than input with imbalanced pool
    }

    function test_curveMath_SS_roundtrip() public view {
        // getAmountOut then getAmountIn should roughly roundtrip (within rounding)
        uint256 reserveIn = 1000 ether;
        uint256 reserveOut = 1000 ether;
        bytes memory params = abi.encode(uint256(100));
        uint16 feeRate = 5;

        uint256 amountIn = 10 ether;
        uint256 out = ssCurve.getAmountOut(amountIn, reserveIn, reserveOut, feeRate, params);

        // Now compute how much input needed for that output
        uint256 requiredIn = ssCurve.getAmountIn(out, reserveIn, reserveOut, feeRate, params);

        // Required input should be <= original input (we lose to rounding/fees)
        assertLe(requiredIn, amountIn + 2); // +2 for rounding tolerance
    }

    function test_curveMath_SS_extremeReserves() public view {
        // Large reserves — convergence should still work
        uint256 amountIn = 1000 ether;
        uint256 reserveIn = 1_000_000 ether;
        uint256 reserveOut = 1_000_000 ether;
        bytes memory params = abi.encode(uint256(1000));

        uint256 out = ssCurve.getAmountOut(amountIn, reserveIn, reserveOut, 0, params);
        assertGt(out, 0);
        // High A + balanced pool — should be very close to input
        assertGt(out, 999 ether);
    }

    // ============ Views / Quotes ============

    function test_getAllPools_enumeration() public {
        _createCPPool();
        _createSSPool(100);

        // Third pool: different pair
        factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenB),
            tokenB: address(tokenC),
            curveId: cpId,
            feeRate: 0,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));

        bytes32[] memory pools = factory.getAllPools();
        assertEq(pools.length, 3);
        assertEq(factory.getPoolCount(), 3);
    }

    function test_invalidFeeRate_reverts() public {
        vm.expectRevert(VibePoolFactory.InvalidFeeRate.selector);
        factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: cpId,
            feeRate: 1001, // > MAX_FEE_RATE
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));
    }

    function test_unapprovedCurve_reverts() public {
        bytes32 fakeCurveId = keccak256("NONEXISTENT");

        vm.expectRevert(VibePoolFactory.CurveNotApproved.selector);
        factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: fakeCurveId,
            feeRate: 0,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));
    }

    function test_getPool_notFound_reverts() public {
        vm.expectRevert(VibePoolFactory.PoolNotFound.selector);
        factory.getPool(keccak256("nonexistent"));
    }

    event PoolCreated(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        bytes32 curveId,
        uint16 feeRate,
        address lpToken
    );

    function test_createPool_emitsEvent() public {
        (address t0, address t1) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));

        bytes32 expectedId = keccak256(abi.encodePacked(t0, t1, cpId));

        vm.expectEmit(true, true, true, false);
        emit PoolCreated(expectedId, t0, t1, cpId, 5, address(0));

        _createCPPool();
    }

    function test_curveIdentification() public view {
        assertEq(cpCurve.curveId(), keccak256("CONSTANT_PRODUCT"));
        assertEq(ssCurve.curveId(), keccak256("STABLE_SWAP"));
        assertEq(keccak256(bytes(cpCurve.curveName())), keccak256(bytes("Constant Product (x*y=k)")));
        assertEq(keccak256(bytes(ssCurve.curveName())), keccak256(bytes("StableSwap (Curve.fi invariant)")));
    }

    function test_SS_validateParams() public view {
        // Valid
        assertTrue(ssCurve.validateParams(abi.encode(uint256(1))));
        assertTrue(ssCurve.validateParams(abi.encode(uint256(100))));
        assertTrue(ssCurve.validateParams(abi.encode(uint256(10000))));

        // Invalid: A=0
        assertFalse(ssCurve.validateParams(abi.encode(uint256(0))));
        // Invalid: A > MAX
        assertFalse(ssCurve.validateParams(abi.encode(uint256(10001))));
        // Invalid: wrong length
        assertFalse(ssCurve.validateParams(""));
        assertFalse(ssCurve.validateParams(abi.encode(uint256(1), uint256(2))));
    }

    function test_deregisterCurve_notApproved_reverts() public {
        vm.expectRevert(VibePoolFactory.CurveNotApproved.selector);
        factory.deregisterCurve(keccak256("NONEXISTENT"));
    }

    function test_registerCurve_zeroAddress_reverts() public {
        vm.expectRevert(VibePoolFactory.ZeroAddress.selector);
        factory.registerCurve(address(0));
    }

    function test_getCurveAddress() public view {
        assertEq(factory.getCurveAddress(cpId), address(cpCurve));
        assertEq(factory.getCurveAddress(ssId), address(ssCurve));
        assertEq(factory.getCurveAddress(keccak256("NONE")), address(0));
    }
}
