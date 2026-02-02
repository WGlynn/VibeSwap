// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title VibeAMM Fuzz Tests
 * @notice Comprehensive fuzz testing for AMM invariants and edge cases
 */
contract VibeAMMFuzzTest is Test {
    VibeAMM public amm;
    MockToken public token0;
    MockToken public token1;

    address public owner;
    address public treasury;
    address public executor;
    address public user;

    bytes32 public poolId;

    uint256 constant INITIAL_LIQUIDITY = 1000 ether;
    uint256 constant MAX_UINT = type(uint256).max;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        executor = makeAddr("executor");
        user = makeAddr("user");

        // Deploy tokens
        token0 = new MockToken("Token A", "TKA");
        token1 = new MockToken("Token B", "TKB");

        // Ensure token0 < token1 for consistent ordering
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        // Deploy AMM
        VibeAMM ammImpl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(ammImpl), initData);
        amm = VibeAMM(address(proxy));

        // Setup
        amm.setAuthorizedExecutor(executor, true);

        // Create pool
        poolId = amm.createPool(address(token0), address(token1), 30);

        // Fund initial liquidity
        token0.mint(owner, INITIAL_LIQUIDITY * 10);
        token1.mint(owner, INITIAL_LIQUIDITY * 10);
        token0.approve(address(amm), MAX_UINT);
        token1.approve(address(amm), MAX_UINT);

        amm.addLiquidity(poolId, INITIAL_LIQUIDITY, INITIAL_LIQUIDITY, 0, 0);

        // Disable flash loan protection for fuzz testing
        // In production, this is an important security feature
        amm.setFlashLoanProtection(false);
    }

    // ============ Constant Product Invariant Tests ============

    /**
     * @notice Fuzz test: K should never decrease after a swap
     */
    function testFuzz_swapMaintainsKInvariant(uint256 amountIn) public {
        // Bound to reasonable amounts (0.001 ether to 10% of reserves)
        amountIn = bound(amountIn, 0.001 ether, INITIAL_LIQUIDITY / 10);

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;

        // Mint tokens directly to AMM and sync balance (simulating deposit from VibeSwapCore)
        token0.mint(address(amm), amountIn);
        amm.syncTrackedBalance(address(token0));

        // Execute swap via batch (only way to swap)
        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: user,
            tokenIn: address(token0),
            tokenOut: address(token1),
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;

        // K should never decrease (may increase due to fees)
        assertGe(kAfter, kBefore, "K invariant violated: K decreased after swap");
    }

    /**
     * @notice Fuzz test: Adding liquidity maintains price ratio
     */
    function testFuzz_addLiquidityMaintainsRatio(uint256 amount0, uint256 amount1) public {
        // Bound to reasonable amounts
        amount0 = bound(amount0, 1 ether, 100 ether);
        amount1 = bound(amount1, 1 ether, 100 ether);

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 ratioBefore = (poolBefore.reserve0 * 1e18) / poolBefore.reserve1;

        // Add liquidity
        token0.mint(owner, amount0);
        token1.mint(owner, amount1);

        (uint256 actualAmount0, uint256 actualAmount1,) = amm.addLiquidity(
            poolId,
            amount0,
            amount1,
            0,
            0
        );

        // The actual amounts should maintain the ratio
        if (actualAmount0 > 0 && actualAmount1 > 0) {
            uint256 providedRatio = (actualAmount0 * 1e18) / actualAmount1;
            // Allow 0.1% deviation due to rounding
            assertApproxEqRel(providedRatio, ratioBefore, 0.001e18, "Ratio not maintained");
        }
    }

    /**
     * @notice Fuzz test: Removing liquidity returns proportional amounts
     */
    function testFuzz_removeLiquidityProportional(uint256 liquidityToRemove) public {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 totalLiquidity = pool.totalLiquidity;

        // Bound: at least 1, at most half of total (leave some in pool)
        liquidityToRemove = bound(liquidityToRemove, 1, totalLiquidity / 2);

        uint256 expectedAmount0 = (pool.reserve0 * liquidityToRemove) / totalLiquidity;
        uint256 expectedAmount1 = (pool.reserve1 * liquidityToRemove) / totalLiquidity;

        (uint256 amount0, uint256 amount1) = amm.removeLiquidity(
            poolId,
            liquidityToRemove,
            0,
            0
        );

        // Should receive proportional amounts (allow 1 wei rounding)
        assertApproxEqAbs(amount0, expectedAmount0, 1, "Amount0 not proportional");
        assertApproxEqAbs(amount1, expectedAmount1, 1, "Amount1 not proportional");
    }

    // ============ Fee Invariant Tests ============

    /**
     * @notice Fuzz test: Protocol fees are collected on swaps
     */
    function testFuzz_protocolFeesCollected(uint256 amountIn) public {
        // Use reasonable bounds for swap amount
        amountIn = bound(amountIn, 1 ether, INITIAL_LIQUIDITY / 10);

        // Mint tokens directly to AMM and sync balance
        token0.mint(address(amm), amountIn);
        amm.syncTrackedBalance(address(token0));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: user,
            tokenIn: address(token0),
            tokenOut: address(token1),
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // If swap executed, protocol fees should be collected
        if (result.totalTokenInSwapped > 0) {
            // Protocol fees should be non-zero
            assertGt(result.protocolFees, 0, "Protocol fees should be collected");

            // Protocol fees should be < 1% of input (0.3% * 20% = 0.06%)
            assertLt(result.protocolFees, amountIn / 100, "Protocol fees too high");
        }
    }

    // ============ Slippage Protection Tests ============

    /**
     * @notice Fuzz test: Swap always produces output and doesn't drain pool
     */
    function testFuzz_swapProducesOutput(uint256 amountIn) public {
        // Use reasonable amounts
        amountIn = bound(amountIn, 0.1 ether, INITIAL_LIQUIDITY / 20);

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);

        // Mint tokens directly to AMM and sync balance
        token0.mint(address(amm), amountIn);
        amm.syncTrackedBalance(address(token0));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: user,
            tokenIn: address(token0),
            tokenOut: address(token1),
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        uint256 balanceBefore = token1.balanceOf(user);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        uint256 received = token1.balanceOf(user) - balanceBefore;
        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);

        // Swap should produce output
        assertGt(received, 0, "Should receive some tokens");

        // Pool should never be drained
        assertGt(poolAfter.reserve0, 0, "Pool reserve0 drained");
        assertGt(poolAfter.reserve1, 0, "Pool reserve1 drained");

        // Reserve1 decrease should be >= amount sent to user (difference is LP fees)
        assertGe(poolBefore.reserve1 - poolAfter.reserve1, received, "Reserve1 decreased less than sent");
    }

    // ============ Edge Case Tests ============

    /**
     * @notice Fuzz test: Very small swaps don't break invariants
     */
    function testFuzz_smallSwapsDontBreak(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, 1000); // 1 wei to 1000 wei

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);

        // Mint tokens directly to AMM and sync balance (simulating deposit from VibeSwapCore)
        token0.mint(address(amm), amountIn);
        amm.syncTrackedBalance(address(token0));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: user,
            tokenIn: address(token0),
            tokenOut: address(token1),
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);

        // Pool should still be functional
        assertGt(poolAfter.reserve0, 0, "Reserve0 zeroed");
        assertGt(poolAfter.reserve1, 0, "Reserve1 zeroed");
        assertGe(
            poolAfter.reserve0 * poolAfter.reserve1,
            poolBefore.reserve0 * poolBefore.reserve1,
            "K decreased"
        );
    }

    /**
     * @notice Fuzz test: Multiple sequential swaps maintain invariants
     * @dev Syncs tracked balances between swaps to avoid donation attack detection
     */
    function testFuzz_multipleSwapsMaintainInvariants(
        uint256 swap1Amount,
        uint256 swap2Amount,
        uint256 swap3Amount
    ) public {
        swap1Amount = bound(swap1Amount, 0.001 ether, INITIAL_LIQUIDITY / 50);
        swap2Amount = bound(swap2Amount, 0.001 ether, INITIAL_LIQUIDITY / 50);
        swap3Amount = bound(swap3Amount, 0.001 ether, INITIAL_LIQUIDITY / 50);

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;

        // Execute multiple swaps in different directions
        // Sync balances after each swap to avoid donation attack false positives
        _executeSwap(address(token0), address(token1), swap1Amount, 2);
        amm.syncTrackedBalance(address(token0));
        amm.syncTrackedBalance(address(token1));

        _executeSwap(address(token1), address(token0), swap2Amount, 3);
        amm.syncTrackedBalance(address(token0));
        amm.syncTrackedBalance(address(token1));

        _executeSwap(address(token0), address(token1), swap3Amount, 4);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;

        // K should only increase (due to fees)
        assertGe(kAfter, kBefore, "K decreased after multiple swaps");
    }

    // ============ Helper Functions ============

    function _executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint64 batchId
    ) internal {
        // Mint tokens directly to the AMM and sync (simulating deposit from VibeSwapCore)
        MockToken(tokenIn).mint(address(amm), amountIn);
        amm.syncTrackedBalance(tokenIn);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: user,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        amm.executeBatchSwap(poolId, batchId, orders);
    }
}
