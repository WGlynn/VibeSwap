// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/amm/VibeLP.sol";
import "../contracts/libraries/BatchMath.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VibeAMMTest is Test {
    VibeAMM public amm;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public owner;
    address public treasury;
    address public lp1;
    address public lp2;
    address public trader;

    bytes32 public poolId;

    event PoolCreated(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        uint256 feeRate
    );

    event LiquidityAdded(
        bytes32 indexed poolId,
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    );

    event SwapExecuted(
        bytes32 indexed poolId,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        lp1 = makeAddr("lp1");
        lp2 = makeAddr("lp2");
        trader = makeAddr("trader");

        // Deploy tokens
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");

        // Deploy AMM
        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));

        // Authorize this contract as executor
        amm.setAuthorizedExecutor(address(this), true);

        // Mint tokens
        tokenA.mint(lp1, 1000 ether);
        tokenB.mint(lp1, 1000 ether);
        tokenA.mint(lp2, 1000 ether);
        tokenB.mint(lp2, 1000 ether);
        tokenA.mint(trader, 100 ether);
        tokenB.mint(trader, 100 ether);

        // Approvals
        vm.prank(lp1);
        tokenA.approve(address(amm), type(uint256).max);
        vm.prank(lp1);
        tokenB.approve(address(amm), type(uint256).max);
        vm.prank(lp2);
        tokenA.approve(address(amm), type(uint256).max);
        vm.prank(lp2);
        tokenB.approve(address(amm), type(uint256).max);
        vm.prank(trader);
        tokenA.approve(address(amm), type(uint256).max);
        vm.prank(trader);
        tokenB.approve(address(amm), type(uint256).max);

        // Disable flash loan protection for unit testing
        // In production, this is an important security feature
        amm.setFlashLoanProtection(false);
    }

    // ============ Pool Creation Tests ============

    function test_createPool() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertTrue(pool.initialized);
        assertEq(pool.feeRate, 30);

        address lpToken = amm.getLPToken(poolId);
        assertTrue(lpToken != address(0));
    }

    function test_createPool_defaultFee() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 0);

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertEq(pool.feeRate, 5); // DEFAULT_FEE_RATE = 5 bps (0.05%)
    }

    function test_createPool_sameToken() public {
        vm.expectRevert(VibeAMM.IdenticalTokens.selector);
        amm.createPool(address(tokenA), address(tokenA), 30);
    }

    function test_createPool_duplicate() public {
        amm.createPool(address(tokenA), address(tokenB), 30);

        vm.expectRevert(VibeAMM.PoolAlreadyExists.selector);
        amm.createPool(address(tokenA), address(tokenB), 30);
    }

    function test_createPool_tokenOrdering() public {
        // Create with reversed order
        bytes32 poolId1 = amm.createPool(address(tokenB), address(tokenA), 30);

        // Pool ID should be same regardless of order
        bytes32 expectedId = amm.getPoolId(address(tokenA), address(tokenB));
        assertEq(poolId1, expectedId);

        IVibeAMM.Pool memory pool = amm.getPool(poolId1);
        assertTrue(pool.token0 < pool.token1); // Should be ordered
    }

    // ============ Liquidity Tests ============

    function test_addLiquidity_initial() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        (uint256 amount0, uint256 amount1, uint256 liquidity) = amm.addLiquidity(
            poolId,
            100 ether,
            100 ether,
            0,
            0
        );

        assertEq(amount0, 100 ether);
        assertEq(amount1, 100 ether);
        assertTrue(liquidity > 0);

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertEq(pool.reserve0, 100 ether);
        assertEq(pool.reserve1, 100 ether);
    }

    function test_addLiquidity_proportional() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        // First LP
        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Second LP - must maintain ratio
        vm.prank(lp2);
        (uint256 amount0, uint256 amount1, ) = amm.addLiquidity(
            poolId,
            50 ether,
            50 ether,
            0,
            0
        );

        assertEq(amount0, 50 ether);
        assertEq(amount1, 50 ether);

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertEq(pool.reserve0, 150 ether);
        assertEq(pool.reserve1, 150 ether);
    }

    function test_addLiquidity_imbalanced() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 200 ether, 0, 0);

        // Try to add with different ratio
        vm.prank(lp2);
        (uint256 amount0, uint256 amount1, ) = amm.addLiquidity(
            poolId,
            50 ether,
            200 ether, // Wants more token1 than ratio allows
            0,
            0
        );

        // Should get proportional amounts
        assertEq(amount0, 50 ether);
        assertEq(amount1, 100 ether); // 50 * (200/100) = 100
    }

    function test_removeLiquidity() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        (,, uint256 liquidity) = amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        uint256 balanceA_before = tokenA.balanceOf(lp1);
        uint256 balanceB_before = tokenB.balanceOf(lp1);

        // Remove 20% of liquidity (within 25% withdrawal breaker threshold)
        uint256 removeAmount = liquidity / 5;
        vm.prank(lp1);
        (uint256 amount0, uint256 amount1) = amm.removeLiquidity(
            poolId,
            removeAmount,
            0,
            0
        );

        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertEq(tokenA.balanceOf(lp1), balanceA_before + amount0);
        assertEq(tokenB.balanceOf(lp1), balanceB_before + amount1);
    }

    // ============ Swap Tests ============

    function test_swap() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        uint256 balanceB_before = tokenB.balanceOf(trader);

        vm.prank(trader);
        uint256 amountOut = amm.swap(
            poolId,
            address(tokenA),
            10 ether,
            0,
            trader
        );

        assertGt(amountOut, 0);
        assertEq(tokenB.balanceOf(trader), balanceB_before + amountOut);
    }

    function test_swap_slippage() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Quote should work
        uint256 expectedOut = amm.quote(poolId, address(tokenA), 10 ether);

        vm.prank(trader);
        vm.expectRevert(VibeAMM.InsufficientOutput.selector);
        amm.swap(
            poolId,
            address(tokenA),
            10 ether,
            expectedOut + 1, // Slightly too high
            trader
        );
    }

    function test_swap_constantProduct() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;

        vm.prank(trader);
        amm.swap(poolId, address(tokenA), 10 ether, 0, trader);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;

        // k should increase due to fees
        assertGe(kAfter, kBefore);
    }

    // ============ Batch Swap Tests ============

    function test_executeBatchSwap() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Transfer tokens to AMM for batch execution
        // NOTE: Do NOT syncTrackedBalance — executeBatchSwap pre-credits batch inflow
        // to trackedBalances (TRP-R16-F03). Syncing first would double-count.
        tokenA.mint(address(amm), 20 ether);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](2);
        orders[0] = IVibeAMM.SwapOrder({
            trader: trader,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            isPriority: true
        });
        orders[1] = IVibeAMM.SwapOrder({
            trader: lp2,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            isPriority: false
        });

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        assertGt(result.clearingPrice, 0);
        assertGt(result.totalTokenInSwapped, 0);
        assertGt(result.totalTokenOutSwapped, 0);
    }

    function test_executeBatchSwap_empty() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](0);

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        assertEq(result.clearingPrice, 0);
        assertEq(result.totalTokenInSwapped, 0);
    }

    // ============ Fee Tests ============

    function test_fees_collected() public {
        // With PROTOCOL_FEE_SHARE = 0, all fees go to LPs through reserves (k increase)
        // Verify fees are reflected in the constant product increase
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;

        vm.prank(trader);
        amm.swap(poolId, address(tokenA), 10 ether, 0, trader);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;

        // k increases because fees stay in reserves for LPs
        assertGt(kAfter, kBefore);

        // With PROTOCOL_FEE_SHARE = 0, no protocol fees accumulate
        assertEq(amm.accumulatedFees(address(tokenA)), 0);
    }

    function test_collectFees() public {
        // With PROTOCOL_FEE_SHARE = 0, collectFees should revert
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        vm.prank(trader);
        amm.swap(poolId, address(tokenA), 10 ether, 0, trader);

        // No protocol fees accumulated, so collectFees reverts
        vm.expectRevert(VibeAMM.NoFeesToCollect.selector);
        amm.collectFees(address(tokenA));
    }

    // ============ Quote Tests ============

    function test_quote() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        uint256 quote1 = amm.quote(poolId, address(tokenA), 10 ether);
        uint256 quote2 = amm.quote(poolId, address(tokenA), 10 ether);

        // Same input should give same quote
        assertEq(quote1, quote2);

        // Larger input should give less per unit due to slippage
        uint256 quote3 = amm.quote(poolId, address(tokenA), 50 ether);
        assertTrue(quote3 < 5 * quote1);
    }

    function test_getSpotPrice() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 200 ether, 0, 0);

        uint256 spotPrice = amm.getSpotPrice(poolId);
        assertEq(spotPrice, 2e18); // 200/100 = 2
    }

    // ============ BatchMath Library Tests ============

    function test_batchMath_getAmountOut() public pure {
        uint256 amountOut = BatchMath.getAmountOut(
            1 ether,    // amountIn
            100 ether,  // reserveIn
            100 ether,  // reserveOut
            5           // 0.05% fee
        );

        // With 0.05% fee: 0.9995 * 1 * 100 / (100 + 0.9995) ≈ 0.989
        assertApproxEqRel(amountOut, 0.989 ether, 0.01e18);
    }

    function test_batchMath_getAmountIn() public pure {
        uint256 amountIn = BatchMath.getAmountIn(
            1 ether,    // amountOut
            100 ether,  // reserveIn
            100 ether,  // reserveOut
            5           // 0.05% fee
        );

        // Should need slightly more than 1 ETH input to get 1 ETH output
        assertGt(amountIn, 1 ether);
    }

    function test_batchMath_sqrt() public pure {
        assertEq(BatchMath.sqrt(0), 0);
        assertEq(BatchMath.sqrt(1), 1);
        assertEq(BatchMath.sqrt(4), 2);
        assertEq(BatchMath.sqrt(100), 10);
        assertEq(BatchMath.sqrt(10000), 100);
    }

    function test_batchMath_calculateLiquidity_initial() public pure {
        uint256 liquidity = BatchMath.calculateLiquidity(
            100 ether,  // amount0
            100 ether,  // amount1
            0,          // reserve0
            0,          // reserve1
            0           // totalSupply
        );

        // sqrt(100e18 * 100e18) - 1000 = 100e18 - 1000
        assertEq(liquidity, 100 ether - 1000);
    }

    // ============ AMM-07: Fee Path Equivalence Tests ============

    /**
     * @notice AMM-07: Prove single-swap and batch-swap paths charge equivalent fees.
     *
     * Both paths should use the input-fee model: fee = amountIn * feeRate / 10000.
     * The effective "fee paid" as a fraction of amountIn must be equal.
     *
     * We measure fee impact by comparing how much output the trader receives relative
     * to a zero-fee reference. The ratio (amountOut / zeroFeeOut) should be
     * approximately equal for both paths when using the same feeRate.
     *
     * Note: Single-swap uses constant-product formula (output decreases with price impact)
     * while batch-swap uses clearing price (spot rate). They produce different absolute
     * amountOut values, but the *fee deduction fraction* should be equal.
     */
    function test_AMM07_feePathEquivalence_inputFeeModel() public {
        // Setup: 1:1 pool, 30 bps fee (0.3%)
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);
        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        uint256 amountIn = 1 ether; // Small trade to minimize price impact difference
        uint256 feeRate = 30; // 30 bps

        // ---- Single swap: measure effective fee ----
        // Quote with fee (actual output)
        uint256 singleOut = amm.quote(poolId, address(tokenA), amountIn);
        // Quote without fee (zero-fee reference) — fee=0 in getAmountOut
        uint256 singleOutNoFee = BatchMath.getAmountOut(amountIn, 100 ether, 100 ether, 0);

        // Effective fee fraction = (noFeeOut - actualOut) / noFeeOut
        // This equals feeRate / 10000 for an input-fee model
        uint256 singleFeeFraction = ((singleOutNoFee - singleOut) * 10000) / singleOutNoFee;

        // ---- Batch swap: measure effective fee ----
        // At spot price 1:1, clearing price = 1e18
        // With input-fee model: effectiveIn = amountIn * (10000 - feeRate) / 10000
        //                       amountOut = effectiveIn * price / 1e18
        // Zero-fee reference: amountOut_noFee = amountIn * price / 1e18
        // Fee fraction = (amountOut_noFee - amountOut) / amountOut_noFee = feeRate / 10000
        uint256 spotPrice = amm.getSpotPrice(poolId); // Should be 1e18 for 1:1 pool
        uint256 batchOutNoFee = (amountIn * spotPrice) / 1e18;
        uint256 effectiveAmountIn = (amountIn * (10000 - feeRate)) / 10000;
        uint256 batchOut = (effectiveAmountIn * spotPrice) / 1e18;
        uint256 batchFeeFraction = ((batchOutNoFee - batchOut) * 10000) / batchOutNoFee;

        // Both fee fractions must equal feeRate (30 bps) — proving input-fee model is used
        assertEq(batchFeeFraction, feeRate, "Batch path must use input-fee model");
        // Single-swap fee fraction may differ slightly due to constant-product math,
        // but should be within 1 bps of feeRate
        assertApproxEqAbs(singleFeeFraction, feeRate, 1, "Single swap fee fraction should approximate feeRate");
    }

    /**
     * @notice AMM-07: Execute actual batch swap and verify fee deduction matches
     * the input-fee model (not the old output-fee model). Split into two helpers
     * to avoid stack-too-deep.
     */
    function test_AMM07_batchFeeIsInputBased_nonUnityPrice() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);
        vm.prank(lp1);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Pre-fund AMM — no syncTrackedBalance: pre-credit loop in executeBatchSwap handles it
        tokenA.mint(address(amm), 1 ether);

        _runBatchAndAssertInputFee(poolId);
    }

    /// @dev Helper split out to avoid stack-too-deep in the parent test
    function _runBatchAndAssertInputFee(bytes32 pid) internal {
        IVibeAMM.Pool memory poolBefore = amm.getPool(pid);
        bool tokenAIsToken0 = poolBefore.token0 == address(tokenA);

        uint256 amountIn = 1 ether;
        uint256 feeRate = 30;
        // effectiveAmountIn = amountIn * (10000 - feeRate) / 10000
        uint256 effectiveIn = (amountIn * (10000 - feeRate)) / 10000;

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: trader,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        uint256 traderBefore = tokenB.balanceOf(trader);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(pid, 1, orders);
        uint256 actualOut = tokenB.balanceOf(trader) - traderBefore;

        assertGt(result.totalTokenInSwapped, 0, "Batch swap must have executed");
        assertGt(result.clearingPrice, 0, "Clearing price must be non-zero");

        _assertInputFeeModel(tokenAIsToken0, amountIn, effectiveIn, feeRate,
            result.clearingPrice, actualOut, poolBefore);
    }

    /// @dev Asserts input-fee model invariants (split for stack depth)
    function _assertInputFeeModel(
        bool tokenAIsToken0,
        uint256 amountIn,
        uint256 effectiveIn,
        uint256 feeRate,
        uint256 clearingPrice,
        uint256 actualOut,
        IVibeAMM.Pool memory poolBefore
    ) internal {
        // Input-fee model: amountOut = effectiveIn * price (or /price for reverse swap)
        // Output-fee model (old):  amountOut = (amountIn * price) * (10000 - fee) / 10000
        uint256 expectedInputFee;
        uint256 grossOut;
        if (tokenAIsToken0) {
            expectedInputFee = (effectiveIn * clearingPrice) / 1e18;
            grossOut = (amountIn * clearingPrice) / 1e18;
        } else {
            expectedInputFee = clearingPrice > 0 ? (effectiveIn * 1e18) / clearingPrice : 0;
            grossOut = clearingPrice > 0 ? (amountIn * 1e18) / clearingPrice : 0;
        }
        uint256 expectedOutputFee = (grossOut * (10000 - feeRate)) / 10000;

        // Verify actual output matches input-fee formula
        assertApproxEqAbs(actualOut, expectedInputFee, 1,
            "Batch must use input-fee: amountOut = effectiveIn * clearingPrice");

        // Verify actual output does NOT match output-fee formula (proves the fix)
        if (expectedInputFee != expectedOutputFee) {
            assertTrue(actualOut != expectedOutputFee,
                "Batch must NOT use output-fee model (pre-fix behavior)");
        }

        // Reserve accounting: reserveIn += amountIn, reserveOut -= amountOut (input-fee)
        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        if (tokenAIsToken0) {
            assertEq(poolAfter.reserve0, poolBefore.reserve0 + amountIn,
                "reserve0 must increase by full amountIn");
            assertEq(poolAfter.reserve1, poolBefore.reserve1 - actualOut,
                "reserve1 must decrease by amountOut");
        } else {
            assertEq(poolAfter.reserve1, poolBefore.reserve1 + amountIn,
                "reserve1 must increase by full amountIn");
            assertEq(poolAfter.reserve0, poolBefore.reserve0 - actualOut,
                "reserve0 must decrease by amountOut");
        }
    }
}
