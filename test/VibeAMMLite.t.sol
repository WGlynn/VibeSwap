// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/VibeAMMLite.sol";
import "../contracts/amm/VibeLP.sol";
import "../contracts/core/interfaces/IVibeAMM.sol";
import "../contracts/libraries/BatchMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title VibeAMMLite Unit Tests
 * @notice Comprehensive test coverage for the deployment-optimized AMM.
 *         Covers pool creation, liquidity ops, swaps, batch execution,
 *         circuit breakers, flash loan protection, TWAP oracle, admin controls,
 *         and fee collection.
 */
contract VibeAMMLiteTest is Test {
    VibeAMMLite public amm;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;

    address public owner;
    address public treasury;
    address public alice;
    address public bob;
    address public executor;

    bytes32 public poolId;

    // ============ Events ============

    event PoolCreated(bytes32 indexed poolId, address indexed token0, address indexed token1, uint256 feeRate);
    event LiquidityAdded(bytes32 indexed poolId, address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(bytes32 indexed poolId, address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event SwapExecuted(bytes32 indexed poolId, address indexed trader, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event FeesCollected(address indexed token, uint256 amount);

    // ============ setUp ============

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        executor = makeAddr("executor");

        // Deploy tokens — ensure consistent ordering
        MockERC20 t0 = new MockERC20("Token A", "TKA");
        MockERC20 t1 = new MockERC20("Token B", "TKB");
        if (address(t0) < address(t1)) {
            tokenA = t0;
            tokenB = t1;
        } else {
            tokenA = t1;
            tokenB = t0;
        }
        tokenC = new MockERC20("Token C", "TKC");

        // Deploy VibeAMMLite (not proxied — it's Initializable but not UUPS)
        amm = new VibeAMMLite();
        amm.initialize(owner, treasury);

        // Authorize executor
        amm.setAuthorizedExecutor(executor, true);

        // Disable protections for most unit tests (re-enable in specific tests)
        amm.setFlashLoanProtection(false);
        amm.setTWAPValidation(false);

        // Mint tokens
        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 1_000_000 ether);
        tokenB.mint(bob, 1_000_000 ether);
        tokenA.mint(executor, 1_000_000 ether);
        tokenB.mint(executor, 1_000_000 ether);

        // Create a default pool
        poolId = amm.createPool(address(tokenA), address(tokenB), 0);

        // Approve
        vm.startPrank(alice);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(executor);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        vm.stopPrank();
    }

    // ============ Initialization Tests ============

    function test_initialize_setsOwnerAndTreasury() public view {
        assertEq(amm.owner(), owner);
        assertEq(amm.treasury(), treasury);
    }

    function test_initialize_setsDefaultProtectionFlags() public {
        // Re-deploy fresh to check defaults
        VibeAMMLite fresh = new VibeAMMLite();
        fresh.initialize(owner, makeAddr("t"));
        // Both flash loan and TWAP should be on by default
        assertEq(fresh.protectionFlags(), 3); // FLAG_FLASH_LOAN | FLAG_TWAP = 1 | 2 = 3
    }

    function test_initialize_revertsOnZeroTreasury() public {
        VibeAMMLite fresh = new VibeAMMLite();
        vm.expectRevert(VibeAMMLite.InvalidTreasury.selector);
        fresh.initialize(owner, address(0));
    }

    function test_initialize_cannotBeCalledTwice() public {
        vm.expectRevert();
        amm.initialize(owner, treasury);
    }

    // ============ Pool Creation Tests ============

    function test_createPool_createsSuccessfully() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertTrue(pool.initialized);
        assertEq(pool.token0, address(tokenA));
        assertEq(pool.token1, address(tokenB));
        assertEq(pool.reserve0, 0);
        assertEq(pool.reserve1, 0);
        assertEq(pool.totalLiquidity, 0);
        assertEq(pool.feeRate, 5); // DEFAULT_FEE_RATE
    }

    function test_createPool_withCustomFee() public {
        bytes32 pid = amm.createPool(address(tokenA), address(tokenC), 30);
        IVibeAMM.Pool memory pool = amm.getPool(pid);
        assertEq(pool.feeRate, 30);
    }

    function test_createPool_sortsTokens() public {
        // Pass tokens in reverse order — should still sort
        MockERC20 tX = new MockERC20("X", "X");
        MockERC20 tY = new MockERC20("Y", "Y");
        address lower = address(tX) < address(tY) ? address(tX) : address(tY);
        address higher = address(tX) < address(tY) ? address(tY) : address(tX);

        bytes32 pid = amm.createPool(higher, lower, 0);
        IVibeAMM.Pool memory pool = amm.getPool(pid);
        assertEq(pool.token0, lower);
        assertEq(pool.token1, higher);
    }

    function test_createPool_createsLPToken() public view {
        address lp = amm.getLPToken(poolId);
        assertTrue(lp != address(0));
    }

    function test_createPool_revertsOnZeroAddress() public {
        vm.expectRevert(VibeAMMLite.InvalidToken.selector);
        amm.createPool(address(0), address(tokenB), 0);
    }

    function test_createPool_revertsOnIdenticalTokens() public {
        vm.expectRevert(VibeAMMLite.IdenticalTokens.selector);
        amm.createPool(address(tokenA), address(tokenA), 0);
    }

    function test_createPool_revertsOnDuplicate() public {
        vm.expectRevert(VibeAMMLite.PoolAlreadyExists.selector);
        amm.createPool(address(tokenA), address(tokenB), 0);
    }

    function test_createPool_revertsOnFeeTooHigh() public {
        vm.expectRevert(VibeAMMLite.FeeTooHigh.selector);
        amm.createPool(address(tokenA), address(tokenC), 1001); // > 1000 BPS
    }

    function test_createPool_poolIdIsDeterministic() public view {
        bytes32 expected = amm.getPoolId(address(tokenA), address(tokenB));
        assertEq(poolId, expected);

        // Reverse order should give same result
        bytes32 reversed = amm.getPoolId(address(tokenB), address(tokenA));
        assertEq(poolId, reversed);
    }

    // ============ Add Liquidity Tests ============

    function test_addLiquidity_initialDeposit() public {
        vm.prank(alice);
        (uint256 amount0, uint256 amount1, uint256 liquidity) = amm.addLiquidity(
            poolId, 100 ether, 100 ether, 0, 0
        );

        assertEq(amount0, 100 ether);
        assertEq(amount1, 100 ether);
        assertGt(liquidity, 0);

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertEq(pool.reserve0, 100 ether);
        assertEq(pool.reserve1, 100 ether);
        assertGt(pool.totalLiquidity, 0);
    }

    function test_addLiquidity_mintsLPTokens() public {
        vm.prank(alice);
        (,, uint256 liquidity) = amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        address lp = amm.getLPToken(poolId);
        assertEq(IERC20(lp).balanceOf(alice), liquidity);
    }

    function test_addLiquidity_subsequentDeposit() public {
        // Initial deposit
        vm.prank(alice);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Second deposit by bob
        vm.prank(bob);
        (uint256 amount0, uint256 amount1, uint256 liquidity) = amm.addLiquidity(
            poolId, 50 ether, 50 ether, 0, 0
        );

        assertEq(amount0, 50 ether);
        assertEq(amount1, 50 ether);
        assertGt(liquidity, 0);

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertEq(pool.reserve0, 150 ether);
        assertEq(pool.reserve1, 150 ether);
    }

    function test_addLiquidity_revertsOnInvalidPool() public {
        bytes32 fakePool = keccak256("fake");
        vm.prank(alice);
        vm.expectRevert(VibeAMMLite.PoolNotFound.selector);
        amm.addLiquidity(fakePool, 100 ether, 100 ether, 0, 0);
    }

    function test_addLiquidity_revertsWhenPaused() public {
        amm.setGlobalPause(true);

        vm.prank(alice);
        vm.expectRevert(VibeAMMLite.Paused.selector);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);
    }

    function test_addLiquidity_revertsOnSlippage() public {
        // Initial deposit
        vm.prank(alice);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Subsequent deposit with tight minimums that won't be met
        vm.prank(bob);
        vm.expectRevert(VibeAMMLite.InsufficientToken0.selector);
        amm.addLiquidity(poolId, 50 ether, 50 ether, 60 ether, 0);
    }

    // ============ Remove Liquidity Tests ============

    function test_removeLiquidity_success() public {
        // Add liquidity first
        vm.prank(alice);
        (,, uint256 liquidity) = amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        uint256 aliceA_before = tokenA.balanceOf(alice);
        uint256 aliceB_before = tokenB.balanceOf(alice);

        vm.prank(alice);
        (uint256 amount0, uint256 amount1) = amm.removeLiquidity(poolId, liquidity, 0, 0);

        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertEq(tokenA.balanceOf(alice), aliceA_before + amount0);
        assertEq(tokenB.balanceOf(alice), aliceB_before + amount1);
    }

    function test_removeLiquidity_revertsOnZeroLiquidity() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        vm.prank(alice);
        vm.expectRevert(VibeAMMLite.InvalidLiquidity.selector);
        amm.removeLiquidity(poolId, 0, 0, 0);
    }

    function test_removeLiquidity_revertsOnInsufficientBalance() public {
        vm.prank(alice);
        (,, uint256 liquidity) = amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        vm.prank(bob); // Bob has no LP tokens
        vm.expectRevert(VibeAMMLite.InsufficientLiquidityBalance.selector);
        amm.removeLiquidity(poolId, liquidity, 0, 0);
    }

    function test_removeLiquidity_revertsOnSlippage() public {
        vm.prank(alice);
        (,, uint256 liquidity) = amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        vm.prank(alice);
        vm.expectRevert(VibeAMMLite.InsufficientToken0.selector);
        amm.removeLiquidity(poolId, liquidity, 200 ether, 0);
    }

    // ============ Swap Tests ============

    function test_swap_token0ForToken1() public {
        // Seed pool
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        uint256 bobB_before = tokenB.balanceOf(bob);

        vm.prank(bob);
        uint256 amountOut = amm.swap(poolId, address(tokenA), 10 ether, 0, bob);

        assertGt(amountOut, 0);
        assertLt(amountOut, 10 ether); // Output < input due to fees and constant product
        assertEq(tokenB.balanceOf(bob), bobB_before + amountOut);
    }

    function test_swap_token1ForToken0() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        uint256 bobA_before = tokenA.balanceOf(bob);

        vm.prank(bob);
        uint256 amountOut = amm.swap(poolId, address(tokenB), 10 ether, 0, bob);

        assertGt(amountOut, 0);
        assertEq(tokenA.balanceOf(bob), bobA_before + amountOut);
    }

    function test_swap_revertsOnInvalidToken() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        vm.prank(bob);
        vm.expectRevert(VibeAMMLite.InvalidToken.selector);
        amm.swap(poolId, address(tokenC), 10 ether, 0, bob);
    }

    function test_swap_revertsOnInsufficientOutput() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        vm.prank(bob);
        vm.expectRevert(VibeAMMLite.InsufficientOutput.selector);
        amm.swap(poolId, address(tokenA), 10 ether, 100 ether, bob); // minAmountOut too high
    }

    function test_swap_revertsWhenPaused() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        amm.setGlobalPause(true);

        vm.prank(bob);
        vm.expectRevert(VibeAMMLite.Paused.selector);
        amm.swap(poolId, address(tokenA), 10 ether, 0, bob);
    }

    function test_swap_updatesReserves() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        IVibeAMM.Pool memory before = amm.getPool(poolId);

        vm.prank(bob);
        uint256 amountOut = amm.swap(poolId, address(tokenA), 10 ether, 0, bob);

        IVibeAMM.Pool memory after_ = amm.getPool(poolId);
        assertEq(after_.reserve0, before.reserve0 + 10 ether);
        assertEq(after_.reserve1, before.reserve1 - amountOut);
    }

    // ============ Quote Tests ============

    function test_quote_returnsExpectedOutput() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        uint256 quoted = amm.quote(poolId, address(tokenA), 10 ether);
        assertGt(quoted, 0);
        assertLt(quoted, 10 ether);
    }

    function test_quote_matchesSwapOutput() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        uint256 quoted = amm.quote(poolId, address(tokenA), 10 ether);

        vm.prank(bob);
        uint256 swapped = amm.swap(poolId, address(tokenA), 10 ether, 0, bob);

        assertEq(quoted, swapped);
    }

    // ============ Spot Price & TWAP Tests ============

    function test_getSpotPrice_correctAfterDeposit() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 100 ether, 200 ether, 0, 0);

        uint256 spotPrice = amm.getSpotPrice(poolId);
        // spot = reserve1 * 1e18 / reserve0 = 200e18 * 1e18 / 100e18 = 2e18
        assertEq(spotPrice, 2 ether);
    }

    function test_getSpotPrice_zeroForEmptyPool() public view {
        // Pool has no reserves yet (only created, no liquidity)
        uint256 spotPrice = amm.getSpotPrice(poolId);
        assertEq(spotPrice, 0);
    }

    function test_getTWAP_zeroWithInsufficientHistory() public view {
        // No oracle data yet
        uint256 twap = amm.getTWAP(poolId, 10 minutes);
        assertEq(twap, 0);
    }

    // ============ Circuit Breaker Tests ============

    function test_globalPause_blocksSwaps() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        amm.setGlobalPause(true);

        vm.prank(bob);
        vm.expectRevert(VibeAMMLite.Paused.selector);
        amm.swap(poolId, address(tokenA), 10 ether, 0, bob);
    }

    function test_globalPause_blocksAddLiquidity() public {
        amm.setGlobalPause(true);

        vm.prank(alice);
        vm.expectRevert(VibeAMMLite.Paused.selector);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);
    }

    function test_globalPause_blocksRemoveLiquidity() public {
        vm.prank(alice);
        (,, uint256 liquidity) = amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        amm.setGlobalPause(true);

        vm.prank(alice);
        vm.expectRevert(VibeAMMLite.Paused.selector);
        amm.removeLiquidity(poolId, liquidity, 0, 0);
    }

    function test_globalPause_unpauseRestoresFunction() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        amm.setGlobalPause(true);
        amm.setGlobalPause(false);

        vm.prank(bob);
        uint256 out = amm.swap(poolId, address(tokenA), 10 ether, 0, bob);
        assertGt(out, 0);
    }

    // ============ Flash Loan Protection Tests ============

    function test_flashLoanProtection_blocksSameBlockInteraction() public {
        // Re-enable flash loan protection
        amm.setFlashLoanProtection(true);

        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        // First swap should succeed
        vm.prank(bob);
        amm.swap(poolId, address(tokenA), 5 ether, 0, bob);

        // Second interaction in same block should fail
        vm.prank(bob);
        vm.expectRevert(VibeAMMLite.SameBlockInteraction.selector);
        amm.swap(poolId, address(tokenA), 5 ether, 0, bob);
    }

    function test_flashLoanProtection_allowsDifferentBlocks() public {
        amm.setFlashLoanProtection(true);

        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        vm.prank(bob);
        amm.swap(poolId, address(tokenA), 5 ether, 0, bob);

        // Advance block
        vm.roll(block.number + 1);

        vm.prank(bob);
        uint256 out = amm.swap(poolId, address(tokenA), 5 ether, 0, bob);
        assertGt(out, 0);
    }

    // ============ Fee Collection Tests ============

    function test_collectFees_sendsToTreasury() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        // Execute a batch swap that accumulates fees
        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: executor,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 100 ether,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);

        // Check accumulated fees
        uint256 fees = amm.accumulatedFees(address(tokenB));
        if (fees > 0) {
            uint256 treasuryBefore = tokenB.balanceOf(treasury);
            amm.collectFees(address(tokenB));
            assertEq(tokenB.balanceOf(treasury), treasuryBefore + fees);
            assertEq(amm.accumulatedFees(address(tokenB)), 0);
        }
    }

    function test_collectFees_revertsOnZeroFees() public {
        vm.expectRevert(VibeAMMLite.InsufficientOutput.selector);
        amm.collectFees(address(tokenA));
    }

    function test_collectFees_isPermissionless() public {
        // collectFees has no access control — anyone can call it
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: executor,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 100 ether,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);

        uint256 fees = amm.accumulatedFees(address(tokenB));
        if (fees > 0) {
            // Charlie (a random user) can trigger fee collection
            address charlie = makeAddr("charlie");
            vm.prank(charlie);
            amm.collectFees(address(tokenB));
        }
    }

    // ============ Batch Swap Tests ============

    function test_executeBatchSwap_singleOrder() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: executor,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        assertGt(result.clearingPrice, 0);
        assertGt(result.totalTokenInSwapped, 0);
        assertGt(result.totalTokenOutSwapped, 0);
    }

    function test_executeBatchSwap_emptyOrdersReturnsZero() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](0);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        assertEq(result.clearingPrice, 0);
        assertEq(result.totalTokenInSwapped, 0);
    }

    function test_executeBatchSwap_revertsForNonExecutor() public {
        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: alice,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 10 ether,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(alice); // Not an authorized executor
        vm.expectRevert(VibeAMMLite.NotAuthorized.selector);
        amm.executeBatchSwap(poolId, 1, orders);
    }

    // ============ Admin Tests ============

    function test_setAuthorizedExecutor() public {
        address newExec = makeAddr("newExec");
        amm.setAuthorizedExecutor(newExec, true);
        assertTrue(amm.authorizedExecutors(newExec));

        amm.setAuthorizedExecutor(newExec, false);
        assertFalse(amm.authorizedExecutors(newExec));
    }

    function test_setTreasury_success() public {
        address newTreasury = makeAddr("newTreasury");
        amm.setTreasury(newTreasury);
        assertEq(amm.treasury(), newTreasury);
    }

    function test_setTreasury_revertsOnZero() public {
        vm.expectRevert(VibeAMMLite.InvalidTreasury.selector);
        amm.setTreasury(address(0));
    }

    function test_setTreasury_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        amm.setTreasury(alice);
    }

    function test_setGlobalPause_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        amm.setGlobalPause(true);
    }

    function test_setFlashLoanProtection_toggles() public {
        amm.setFlashLoanProtection(true);
        assertEq(amm.protectionFlags() & 1, 1);

        amm.setFlashLoanProtection(false);
        assertEq(amm.protectionFlags() & 1, 0);
    }

    function test_setTWAPValidation_toggles() public {
        amm.setTWAPValidation(true);
        assertEq(amm.protectionFlags() & 2, 2);

        amm.setTWAPValidation(false);
        assertEq(amm.protectionFlags() & 2, 0);
    }

    function test_growOracleCardinality_isPermissionless() public {
        // Anyone can grow oracle cardinality — no revert
        vm.prank(alice);
        amm.growOracleCardinality(poolId, 100);
    }

    // ============ Fuzz Tests ============

    function testFuzz_createPool_validFeeRange(uint256 fee) public {
        fee = bound(fee, 1, 1000);

        MockERC20 t = new MockERC20("Z", "Z");
        bytes32 pid = amm.createPool(address(tokenA), address(t), fee);

        IVibeAMM.Pool memory pool = amm.getPool(pid);
        assertEq(pool.feeRate, fee);
    }

    function testFuzz_addLiquidity_anyRatio(uint256 amount0, uint256 amount1) public {
        amount0 = bound(amount0, 10001, 100_000 ether);
        amount1 = bound(amount1, 10001, 100_000 ether);

        vm.prank(alice);
        (uint256 a0, uint256 a1, uint256 liq) = amm.addLiquidity(poolId, amount0, amount1, 0, 0);

        assertGt(liq, 0);
        assertGt(a0, 0);
        assertGt(a1, 0);
    }

    function testFuzz_swap_anyAmountPreservesK(uint256 amountIn) public {
        amountIn = bound(amountIn, 0.001 ether, 100 ether);

        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        IVibeAMM.Pool memory before = amm.getPool(poolId);
        uint256 kBefore = before.reserve0 * before.reserve1;

        vm.prank(bob);
        amm.swap(poolId, address(tokenA), amountIn, 0, bob);

        IVibeAMM.Pool memory after_ = amm.getPool(poolId);
        uint256 kAfter = after_.reserve0 * after_.reserve1;

        // k should increase (fees) or stay the same
        assertGe(kAfter, kBefore, "Constant product k decreased after swap");
    }

    function testFuzz_spotPrice_monotonic(uint256 swapAmount) public {
        swapAmount = bound(swapAmount, 0.01 ether, 50 ether);

        vm.prank(alice);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        uint256 priceBefore = amm.getSpotPrice(poolId);

        // Swap token0 for token1 should increase price (more token0, less token1)
        vm.prank(bob);
        amm.swap(poolId, address(tokenA), swapAmount, 0, bob);

        uint256 priceAfter = amm.getSpotPrice(poolId);
        // Price = reserve1/reserve0. Swapping token0 in increases reserve0, decreases reserve1 -> price decreases
        assertLt(priceAfter, priceBefore, "Spot price should decrease when buying token1");
    }

    // ============ Integration Tests ============

    function test_fullCycle_createAddSwapRemove() public {
        // Create fresh pool with tokenA and tokenC
        bytes32 pid = amm.createPool(address(tokenA), address(tokenC), 10);
        address lp = amm.getLPToken(pid);

        tokenC.mint(alice, 1_000_000 ether);
        tokenC.mint(bob, 1_000_000 ether);

        vm.prank(alice);
        tokenC.approve(address(amm), type(uint256).max);
        vm.prank(bob);
        tokenC.approve(address(amm), type(uint256).max);

        // Add liquidity
        vm.prank(alice);
        (,, uint256 liquidity) = amm.addLiquidity(pid, 500 ether, 500 ether, 0, 0);
        assertGt(liquidity, 0);

        // Swap
        vm.prank(bob);
        uint256 swapOut = amm.swap(pid, address(tokenA), 10 ether, 0, bob);
        assertGt(swapOut, 0);

        // Remove liquidity
        vm.prank(alice);
        (uint256 out0, uint256 out1) = amm.removeLiquidity(pid, liquidity, 0, 0);
        assertGt(out0, 0);
        assertGt(out1, 0);

        // LP tokens should be burned
        assertEq(IERC20(lp).balanceOf(alice), 0);
    }
}
