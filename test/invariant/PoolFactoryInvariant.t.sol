// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/amm/VibePoolFactory.sol";
import "../../contracts/amm/interfaces/IPoolCurve.sol";
import "../../contracts/amm/curves/ConstantProductCurve.sol";
import "../../contracts/amm/curves/StableSwapCurve.sol";
import "../../contracts/amm/VibeLP.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock ============

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

/**
 * @title PoolFactoryHandler
 * @notice Bounded random operations on VibePoolFactory for invariant testing.
 *         Creates pools with random token pairs, curve types, fees, and amp factors.
 */
contract PoolFactoryHandler is Test {
    VibePoolFactory public factory;
    bytes32 public cpId;
    bytes32 public ssId;

    MockToken[] public tokens;
    bytes32[] public createdPoolIds;

    // Ghost variables for tracking
    uint256 public ghost_poolsCreated;
    uint256 public ghost_poolsFailed;
    uint256 public ghost_curvesRegistered;
    uint256 public ghost_curvesDeregistered;

    constructor(VibePoolFactory _factory, bytes32 _cpId, bytes32 _ssId) {
        factory = _factory;
        cpId = _cpId;
        ssId = _ssId;

        // Create a set of tokens for pool creation
        for (uint256 i = 0; i < 8; i++) {
            tokens.push(new MockToken(
                string(abi.encodePacked("Token", vm.toString(i))),
                string(abi.encodePacked("TK", vm.toString(i)))
            ));
        }
    }

    /// @notice Create a random CP pool
    function createCPPool(uint256 tokenASeed, uint256 tokenBSeed, uint16 feeRate) public {
        uint256 idxA = tokenASeed % tokens.length;
        uint256 idxB = tokenBSeed % tokens.length;
        if (idxA == idxB) idxB = (idxB + 1) % tokens.length;

        feeRate = uint16(bound(feeRate, 0, 1000));

        try factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokens[idxA]),
            tokenB: address(tokens[idxB]),
            curveId: cpId,
            feeRate: feeRate,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        })) returns (bytes32 poolId) {
            createdPoolIds.push(poolId);
            ghost_poolsCreated++;
        } catch {
            ghost_poolsFailed++;
        }
    }

    /// @notice Create a random SS pool
    function createSSPool(uint256 tokenASeed, uint256 tokenBSeed, uint256 A, uint16 feeRate) public {
        uint256 idxA = tokenASeed % tokens.length;
        uint256 idxB = tokenBSeed % tokens.length;
        if (idxA == idxB) idxB = (idxB + 1) % tokens.length;

        A = bound(A, 1, 10000);
        feeRate = uint16(bound(feeRate, 0, 1000));

        try factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokens[idxA]),
            tokenB: address(tokens[idxB]),
            curveId: ssId,
            feeRate: feeRate,
            curveParams: abi.encode(A),
            hook: address(0),
            hookFlags: 0
        })) returns (bytes32 poolId) {
            createdPoolIds.push(poolId);
            ghost_poolsCreated++;
        } catch {
            ghost_poolsFailed++;
        }
    }

    function getCreatedPoolCount() external view returns (uint256) {
        return createdPoolIds.length;
    }

    function getCreatedPoolId(uint256 index) external view returns (bytes32) {
        return createdPoolIds[index];
    }
}

// ============ Invariant Test ============

/**
 * @title PoolFactory Invariant Tests
 * @notice Stateful invariant testing for VibePoolFactory.
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         Verified invariants:
 *           1. Pool count always equals _poolIds array length
 *           2. Every pool in _poolIds has a non-zero LP token
 *           3. Every pool's LP token is owned by the factory
 *           4. Every pool has valid ordered tokens (token0 < token1)
 *           5. No two pools have the same pool ID
 *           6. Approved curves count matches _curveIds array
 *           7. Ghost variable matches actual pool count
 */
contract PoolFactoryInvariantTest is StdInvariant, Test {
    VibePoolFactory public factory;
    ConstantProductCurve public cpCurve;
    StableSwapCurve public ssCurve;
    PoolFactoryHandler public handler;

    bytes32 public cpId;
    bytes32 public ssId;

    function setUp() public {
        cpCurve = new ConstantProductCurve();
        ssCurve = new StableSwapCurve();
        cpId = cpCurve.CURVE_ID();
        ssId = ssCurve.CURVE_ID();

        factory = new VibePoolFactory(address(0));
        factory.registerCurve(address(cpCurve));
        factory.registerCurve(address(ssCurve));

        handler = new PoolFactoryHandler(factory, cpId, ssId);

        // Target only the handler for invariant calls
        targetContract(address(handler));
    }

    // ============ Invariants ============

    /// @notice Pool count must always match the _poolIds array length
    function invariant_poolCountMatchesArray() public view {
        bytes32[] memory allPools = factory.getAllPools();
        assertEq(factory.getPoolCount(), allPools.length, "Pool count mismatch");
    }

    /// @notice Every pool must have a non-zero LP token
    function invariant_everyPoolHasLPToken() public view {
        bytes32[] memory allPools = factory.getAllPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            address lp = factory.getLPToken(allPools[i]);
            assertTrue(lp != address(0), "Pool missing LP token");
        }
    }

    /// @notice Every pool's LP token must be owned by the factory
    function invariant_lpTokensOwnedByFactory() public view {
        bytes32[] memory allPools = factory.getAllPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            address lpAddr = factory.getLPToken(allPools[i]);
            VibeLP lp = VibeLP(lpAddr);
            assertEq(lp.owner(), address(factory), "LP not owned by factory");
        }
    }

    /// @notice Every pool must have properly ordered tokens (token0 < token1)
    function invariant_tokensOrdered() public view {
        bytes32[] memory allPools = factory.getAllPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            VibePoolFactory.FactoryPool memory pool = factory.getPool(allPools[i]);
            assertTrue(pool.token0 < pool.token1, "Tokens not ordered");
        }
    }

    /// @notice Every pool must be marked as initialized
    function invariant_allPoolsInitialized() public view {
        bytes32[] memory allPools = factory.getAllPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            VibePoolFactory.FactoryPool memory pool = factory.getPool(allPools[i]);
            assertTrue(pool.initialized, "Pool not initialized");
        }
    }

    /// @notice No duplicate pool IDs (each pool ID is unique in the array)
    function invariant_noDuplicatePoolIds() public view {
        bytes32[] memory allPools = factory.getAllPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            for (uint256 j = i + 1; j < allPools.length; j++) {
                assertTrue(allPools[i] != allPools[j], "Duplicate pool ID");
            }
        }
    }

    /// @notice Ghost variable must match actual pool count
    function invariant_ghostPoolCountMatches() public view {
        assertEq(
            handler.ghost_poolsCreated(),
            factory.getPoolCount(),
            "Ghost pool count mismatch"
        );
    }

    /// @notice Every pool must have a valid curve ID (one that was registered)
    function invariant_poolCurveIdsAreKnown() public view {
        bytes32[] memory allPools = factory.getAllPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            VibePoolFactory.FactoryPool memory pool = factory.getPool(allPools[i]);
            assertTrue(
                pool.curveId == cpId || pool.curveId == ssId,
                "Pool has unknown curve ID"
            );
        }
    }

    /// @notice Every pool must have a fee rate within valid bounds
    function invariant_feeRatesValid() public view {
        bytes32[] memory allPools = factory.getAllPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            VibePoolFactory.FactoryPool memory pool = factory.getPool(allPools[i]);
            assertLe(pool.feeRate, factory.MAX_FEE_RATE(), "Fee exceeds max");
            assertGt(pool.feeRate, 0, "Fee is zero (should be default or custom)");
        }
    }

    /// @notice LP token pair must match pool pair
    function invariant_lpTokenPairMatchesPool() public view {
        bytes32[] memory allPools = factory.getAllPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            VibePoolFactory.FactoryPool memory pool = factory.getPool(allPools[i]);
            address lpAddr = factory.getLPToken(allPools[i]);
            VibeLP lp = VibeLP(lpAddr);

            assertEq(lp.token0(), pool.token0, "LP token0 mismatch");
            assertEq(lp.token1(), pool.token1, "LP token1 mismatch");
        }
    }
}
