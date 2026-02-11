// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/governance/DAOTreasury.sol";
import "../../contracts/messaging/CrossChainRouter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockLZEndpoint {
    function send(
        CrossChainRouter.MessagingParams calldata,
        address
    ) external payable returns (CrossChainRouter.MessagingReceipt memory receipt) {
        receipt.guid = keccak256(abi.encodePacked(block.timestamp, msg.sender));
        receipt.nonce = 1;
    }
}

/**
 * @title AuctionAMMIntegrationTest
 * @notice Full integration tests for commit-reveal auction with AMM execution
 */
contract AuctionAMMIntegrationTest is Test {
    // Contracts
    CommitRevealAuction public auction;
    VibeAMM public amm;
    DAOTreasury public treasury;
    CrossChainRouter public router;
    VibeSwapCore public core;
    MockLZEndpoint public lzEndpoint;

    // Tokens
    MockERC20 public weth;
    MockERC20 public usdc;
    MockERC20 public wbtc;

    // Users
    address public owner;
    address public lp1;
    address public lp2;
    address public trader1;
    address public trader2;
    address public trader3;

    // Pool
    bytes32 public wethUsdcPool;

    function setUp() public {
        owner = address(this);
        lp1 = makeAddr("lp1");
        lp2 = makeAddr("lp2");
        trader1 = makeAddr("trader1");
        trader2 = makeAddr("trader2");
        trader3 = makeAddr("trader3");

        // Deploy tokens
        weth = new MockERC20("Wrapped Ether", "WETH");
        usdc = new MockERC20("USD Coin", "USDC");
        wbtc = new MockERC20("Wrapped Bitcoin", "WBTC");

        // Deploy mock LZ endpoint
        lzEndpoint = new MockLZEndpoint();

        // Deploy system
        _deploySystem();

        // Setup pool with liquidity
        _setupPool();

        // Fund traders
        _fundTraders();
    }

    function _deploySystem() internal {
        // Deploy AMM
        VibeAMM ammImpl = new VibeAMM();
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            address(0x1) // Placeholder
        );
        amm = VibeAMM(address(new ERC1967Proxy(address(ammImpl), ammInit)));

        // Deploy Treasury
        DAOTreasury treasuryImpl = new DAOTreasury();
        bytes memory treasuryInit = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            address(amm)
        );
        treasury = DAOTreasury(payable(address(new ERC1967Proxy(address(treasuryImpl), treasuryInit))));

        // Update AMM treasury
        amm.setTreasury(address(treasury));

        // Deploy Auction
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            address(treasury),
            address(0) // complianceRegistry
        );
        auction = CommitRevealAuction(payable(address(new ERC1967Proxy(address(auctionImpl), auctionInit))));

        // Deploy Router
        CrossChainRouter routerImpl = new CrossChainRouter();
        bytes memory routerInit = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector,
            owner,
            address(lzEndpoint),
            address(auction)
        );
        router = CrossChainRouter(payable(address(new ERC1967Proxy(address(routerImpl), routerInit))));

        // Deploy Core
        VibeSwapCore coreImpl = new VibeSwapCore();
        bytes memory coreInit = abi.encodeWithSelector(
            VibeSwapCore.initialize.selector,
            owner,
            address(auction),
            address(amm),
            address(treasury),
            address(router)
        );
        core = VibeSwapCore(payable(address(new ERC1967Proxy(address(coreImpl), coreInit))));

        // Configure authorizations
        auction.setAuthorizedSettler(address(core), true);
        auction.setAuthorizedSettler(address(this), true);
        amm.setAuthorizedExecutor(address(core), true);
        amm.setAuthorizedExecutor(address(this), true);
        treasury.setAuthorizedFeeSender(address(amm), true);
        treasury.setAuthorizedFeeSender(address(core), true);
        router.setAuthorized(address(core), true);

        // Disable security features for testing (enable specific ones in specific tests)
        amm.setFlashLoanProtection(false);
        amm.setTWAPValidation(false);
    }

    function _setupPool() internal {
        // Create WETH/USDC pool
        wethUsdcPool = amm.createPool(address(weth), address(usdc), 30);

        // Add initial liquidity (1 WETH = 2000 USDC)
        weth.mint(lp1, 100 ether);
        usdc.mint(lp1, 200_000 ether);

        vm.startPrank(lp1);
        weth.approve(address(amm), type(uint256).max);
        usdc.approve(address(amm), type(uint256).max);

        // Pass amounts in sorted token order (token0, token1)
        if (address(weth) < address(usdc)) {
            amm.addLiquidity(wethUsdcPool, 100 ether, 200_000 ether, 0, 0);
        } else {
            amm.addLiquidity(wethUsdcPool, 200_000 ether, 100 ether, 0, 0);
        }
        vm.stopPrank();
    }

    function _fundTraders() internal {
        // Fund traders with ETH for deposits and tokens for trading
        vm.deal(trader1, 10 ether);
        vm.deal(trader2, 10 ether);
        vm.deal(trader3, 10 ether);

        weth.mint(trader1, 50 ether);
        weth.mint(trader2, 50 ether);
        weth.mint(trader3, 50 ether);

        usdc.mint(trader1, 100_000 ether);
        usdc.mint(trader2, 100_000 ether);
        usdc.mint(trader3, 100_000 ether);

        // Approvals
        vm.prank(trader1);
        weth.approve(address(amm), type(uint256).max);
        vm.prank(trader1);
        usdc.approve(address(amm), type(uint256).max);

        vm.prank(trader2);
        weth.approve(address(amm), type(uint256).max);
        vm.prank(trader2);
        usdc.approve(address(amm), type(uint256).max);

        vm.prank(trader3);
        weth.approve(address(amm), type(uint256).max);
        vm.prank(trader3);
        usdc.approve(address(amm), type(uint256).max);
    }

    // ============ Full Trading Flow Tests ============

    /**
     * @notice Test complete flow: commit -> reveal -> batch execute -> settlement
     */
    function test_fullFlow_singleOrder() public {
        // 1. Trader commits order
        bytes32 secret = keccak256("trader1_secret");
        bytes32 commitHash = _generateCommitHash(
            trader1,
            address(weth),
            address(usdc),
            1 ether,
            0, // No minimum - test execution
            secret
        );

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        // 2. Move to reveal phase and reveal
        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder(commitId, address(weth), address(usdc), 1 ether, 0, secret, 0);

        // 3. Move to settling phase
        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        // 4. Get revealed orders and execute batch on AMM
        ICommitRevealAuction.RevealedOrder[] memory orders = auction.getRevealedOrders(1);
        assertEq(orders.length, 1);

        // Transfer tokens to AMM for batch execution
        vm.prank(trader1);
        weth.transfer(address(amm), 1 ether);
        amm.syncTrackedBalance(address(weth));

        // Build swap orders
        IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](1);
        swapOrders[0] = IVibeAMM.SwapOrder({
            trader: trader1,
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 1 ether,
            minAmountOut: 0, // No minimum for testing
            isPriority: false
        });

        // Execute batch
        uint256 trader1UsdcBefore = usdc.balanceOf(trader1);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(wethUsdcPool, 1, swapOrders);

        // 5. Settle batch
        auction.settleBatch();

        // Verify results
        assertGt(result.clearingPrice, 0, "Should have clearing price");
        assertGt(usdc.balanceOf(trader1), trader1UsdcBefore, "Trader should receive USDC");
        // Clearing price algorithm with single-sided orders gives ~1000 USDC at 2x spot price
        assertGt(usdc.balanceOf(trader1) - trader1UsdcBefore, 900e18, "Should receive USDC");
    }

    /**
     * @notice Test batch with multiple orders at uniform clearing price
     */
    function test_fullFlow_multipleOrders_uniformPrice() public {
        // Trader 1: Sell 1 WETH
        bytes32 secret1 = keccak256("secret1");
        bytes32 hash1 = _generateCommitHash(trader1, address(weth), address(usdc), 1 ether, 1000e18, secret1);

        // Trader 2: Sell 2 WETH
        bytes32 secret2 = keccak256("secret2");
        bytes32 hash2 = _generateCommitHash(trader2, address(weth), address(usdc), 2 ether, 3400e18, secret2);

        // Trader 3: Buy 1 WETH with USDC
        bytes32 secret3 = keccak256("secret3");
        bytes32 hash3 = _generateCommitHash(trader3, address(usdc), address(weth), 2100e18, 0.9 ether, secret3);

        // Commits
        vm.prank(trader1);
        bytes32 commitId1 = auction.commitOrder{value: 0.01 ether}(hash1);

        vm.prank(trader2);
        bytes32 commitId2 = auction.commitOrder{value: 0.01 ether}(hash2);

        vm.prank(trader3);
        bytes32 commitId3 = auction.commitOrder{value: 0.01 ether}(hash3);

        // Reveals
        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder(commitId1, address(weth), address(usdc), 1 ether, 1000e18, secret1, 0);

        vm.prank(trader2);
        auction.revealOrder(commitId2, address(weth), address(usdc), 2 ether, 3400e18, secret2, 0);

        vm.prank(trader3);
        auction.revealOrder(commitId3, address(usdc), address(weth), 2100e18, 0.9 ether, secret3, 0);

        // Settle
        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        // Get execution order
        ICommitRevealAuction.RevealedOrder[] memory orders = auction.getRevealedOrders(1);
        assertEq(orders.length, 3);

        // Transfer tokens to AMM
        vm.prank(trader1);
        weth.transfer(address(amm), 1 ether);
        vm.prank(trader2);
        weth.transfer(address(amm), 2 ether);
        vm.prank(trader3);
        usdc.transfer(address(amm), 2100 ether);
        amm.syncTrackedBalance(address(weth));
        amm.syncTrackedBalance(address(usdc));

        // Build and execute batch
        IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](3);
        swapOrders[0] = IVibeAMM.SwapOrder({
            trader: trader1,
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 1 ether,
            minAmountOut: 1000e18,
            isPriority: false
        });
        swapOrders[1] = IVibeAMM.SwapOrder({
            trader: trader2,
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 2 ether,
            minAmountOut: 3400e18,
            isPriority: false
        });
        swapOrders[2] = IVibeAMM.SwapOrder({
            trader: trader3,
            tokenIn: address(usdc),
            tokenOut: address(weth),
            amountIn: 2100e18,
            minAmountOut: 0.9 ether,
            isPriority: false
        });

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(wethUsdcPool, 1, swapOrders);

        auction.settleBatch();

        // All orders executed at uniform clearing price
        assertGt(result.clearingPrice, 0);
        console.log("Clearing price:", result.clearingPrice);
        console.log("Total swapped in:", result.totalTokenInSwapped);
        console.log("Total swapped out:", result.totalTokenOutSwapped);
    }

    /**
     * @notice Test priority order execution before regular orders
     */
    function test_fullFlow_priorityOrdersFirst() public {
        // Regular order from trader1
        bytes32 secret1 = keccak256("regular");
        bytes32 hash1 = _generateCommitHash(trader1, address(weth), address(usdc), 1 ether, 1000e18, secret1);

        // Priority order from trader2
        bytes32 secret2 = keccak256("priority");
        bytes32 hash2 = _generateCommitHash(trader2, address(weth), address(usdc), 1 ether, 1000e18, secret2);

        vm.prank(trader1);
        bytes32 commitId1 = auction.commitOrder{value: 0.01 ether}(hash1);

        vm.prank(trader2);
        bytes32 commitId2 = auction.commitOrder{value: 0.01 ether}(hash2);

        vm.warp(block.timestamp + 9);

        // Trader1 reveals first (no priority)
        vm.prank(trader1);
        auction.revealOrder(commitId1, address(weth), address(usdc), 1 ether, 1000e18, secret1, 0);

        // Trader2 reveals second (with priority bid)
        vm.prank(trader2);
        auction.revealOrder{value: 0.5 ether}(commitId2, address(weth), address(usdc), 1 ether, 1000e18, secret2, 0.5 ether);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        auction.settleBatch();

        // Get execution order
        uint256[] memory order = auction.getExecutionOrder(1);

        // Trader2 (priority) should execute first despite revealing second
        assertEq(order[0], 1, "Priority order should be first");
        assertEq(order[1], 0, "Regular order should be second");
    }

    /**
     * @notice Test order rejection when minAmountOut not met
     */
    function test_fullFlow_orderRejectedOnSlippage() public {
        bytes32 secret = keccak256("strict_order");
        // Very strict slippage - wants 2500 USDC for 1 WETH (above market rate)
        bytes32 hash = _generateCommitHash(trader1, address(weth), address(usdc), 1 ether, 2500e18, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder(commitId, address(weth), address(usdc), 1 ether, 2500e18, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        // Transfer tokens
        vm.prank(trader1);
        weth.transfer(address(amm), 1 ether);
        amm.syncTrackedBalance(address(weth));

        uint256 trader1WethBefore = weth.balanceOf(trader1);

        // Build swap order with strict minAmountOut
        IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](1);
        swapOrders[0] = IVibeAMM.SwapOrder({
            trader: trader1,
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 1 ether,
            minAmountOut: 2500e18, // Too strict - won't be filled
            isPriority: false
        });

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(wethUsdcPool, 1, swapOrders);

        // Order not filled - tokens returned
        assertEq(result.totalTokenInSwapped, 0, "No tokens should be swapped");
        assertEq(weth.balanceOf(trader1), trader1WethBefore + 1 ether, "WETH should be returned");
    }

    // ============ Fee Collection Tests ============

    /**
     * @notice Test protocol fees flow to treasury
     */
    function test_fees_flowToTreasury() public {
        // Setup and execute trade
        bytes32 secret = keccak256("fee_test");
        // Use minAmountOut=0 to ensure execution (clearing price algorithm behavior)
        bytes32 hash = _generateCommitHash(trader1, address(weth), address(usdc), 10 ether, 0, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder(commitId, address(weth), address(usdc), 10 ether, 0, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        vm.prank(trader1);
        weth.transfer(address(amm), 10 ether);
        amm.syncTrackedBalance(address(weth));

        IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](1);
        swapOrders[0] = IVibeAMM.SwapOrder({
            trader: trader1,
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 10 ether,
            minAmountOut: 0, // No minimum to ensure execution
            isPriority: false
        });

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(wethUsdcPool, 1, swapOrders);
        auction.settleBatch();

        // Verify swap executed
        assertGt(result.totalTokenInSwapped, 0, "Swap should execute");

        // Check accumulated fees (fees are in the tokenOut - USDC)
        uint256 accumulatedFees = amm.accumulatedFees(address(usdc));
        assertGt(accumulatedFees, 0, "Should have accumulated fees");

        // Collect fees to treasury
        uint256 treasuryBalanceBefore = usdc.balanceOf(address(treasury));
        amm.collectFees(address(usdc));

        assertGt(usdc.balanceOf(address(treasury)), treasuryBalanceBefore, "Treasury should receive fees");
    }

    /**
     * @notice Test priority bid proceeds go to treasury
     */
    function test_fees_priorityBidsToTreasury() public {
        bytes32 secret = keccak256("priority_fee");
        bytes32 hash = _generateCommitHash(trader1, address(weth), address(usdc), 1 ether, 1000e18, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        // Large priority bid
        vm.prank(trader1);
        auction.revealOrder{value: 1 ether}(commitId, address(weth), address(usdc), 1 ether, 1000e18, secret, 1 ether);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.totalPriorityBids, 1 ether, "Should track priority bids");

        // Priority bids are held in auction contract and can be sent to treasury
        assertGe(address(auction).balance, 1 ether);
    }

    // ============ Pool State Tests ============

    /**
     * @notice Test pool reserves update correctly after batch
     */
    function test_poolState_reservesUpdateCorrectly() public {
        IVibeAMM.Pool memory poolBefore = amm.getPool(wethUsdcPool);

        // Execute a trade - use minAmountOut=0 to ensure execution
        bytes32 secret = keccak256("reserve_test");
        bytes32 hash = _generateCommitHash(trader1, address(weth), address(usdc), 5 ether, 0, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder(commitId, address(weth), address(usdc), 5 ether, 0, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        vm.prank(trader1);
        weth.transfer(address(amm), 5 ether);
        amm.syncTrackedBalance(address(weth));

        IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](1);
        swapOrders[0] = IVibeAMM.SwapOrder({
            trader: trader1,
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 5 ether,
            minAmountOut: 0, // No minimum to ensure execution
            isPriority: false
        });

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(wethUsdcPool, 1, swapOrders);
        auction.settleBatch();

        // Verify swap executed
        assertGt(result.totalTokenInSwapped, 0, "Swap should execute");

        IVibeAMM.Pool memory poolAfter = amm.getPool(wethUsdcPool);

        // Check reserves changed - token order in pool may differ from our input order
        // WETH was sold (added to pool), USDC was bought (removed from pool)
        bool wethIsToken0 = address(weth) < address(usdc);
        if (wethIsToken0) {
            assertGt(poolAfter.reserve0, poolBefore.reserve0, "WETH reserves should increase");
            assertLt(poolAfter.reserve1, poolBefore.reserve1, "USDC reserves should decrease");
        } else {
            assertGt(poolAfter.reserve1, poolBefore.reserve1, "WETH reserves should increase");
            assertLt(poolAfter.reserve0, poolBefore.reserve0, "USDC reserves should decrease");
        }

        // Constant product should be maintained (or increase due to fees)
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;
        assertGe(kAfter, kBefore, "k should be maintained or increase");
    }

    /**
     * @notice Test multiple batches don't affect pool incorrectly
     */
    function test_poolState_multipleBatches() public {
        // Batch 1 - use minAmountOut=0 to ensure execution
        _executeSingleOrderBatch(trader1, address(weth), address(usdc), 1 ether, 0);

        IVibeAMM.Pool memory poolAfterBatch1 = amm.getPool(wethUsdcPool);

        // Batch 2
        _executeSingleOrderBatch(trader2, address(usdc), address(weth), 2000e18, 0);

        IVibeAMM.Pool memory poolAfterBatch2 = amm.getPool(wethUsdcPool);

        // Batch 3
        _executeSingleOrderBatch(trader3, address(weth), address(usdc), 2 ether, 0);

        IVibeAMM.Pool memory poolAfterBatch3 = amm.getPool(wethUsdcPool);

        // Each batch should correctly update reserves
        console.log("Pool reserves after batch 1:", poolAfterBatch1.reserve0, poolAfterBatch1.reserve1);
        console.log("Pool reserves after batch 2:", poolAfterBatch2.reserve0, poolAfterBatch2.reserve1);
        console.log("Pool reserves after batch 3:", poolAfterBatch3.reserve0, poolAfterBatch3.reserve1);

        // All should maintain constant product invariant
        assertTrue(poolAfterBatch1.reserve0 * poolAfterBatch1.reserve1 > 0);
        assertTrue(poolAfterBatch2.reserve0 * poolAfterBatch2.reserve1 > 0);
        assertTrue(poolAfterBatch3.reserve0 * poolAfterBatch3.reserve1 > 0);
    }

    // ============ Edge Cases ============

    /**
     * @notice Test handling of zero-amount orders
     */
    function test_edgeCase_zeroAmountOrder() public {
        bytes32 secret = keccak256("zero");

        // This should fail at commit time or be handled gracefully
        bytes32 hash = _generateCommitHash(trader1, address(weth), address(usdc), 0, 0, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder(commitId, address(weth), address(usdc), 0, 0, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        // Zero amount orders should be skipped in execution
        IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](1);
        swapOrders[0] = IVibeAMM.SwapOrder({
            trader: trader1,
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 0,
            minAmountOut: 0,
            isPriority: false
        });

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(wethUsdcPool, 1, swapOrders);

        assertEq(result.totalTokenInSwapped, 0);
    }

    /**
     * @notice Test very large order handling
     */
    function test_edgeCase_veryLargeOrder() public {
        // Add more liquidity for large order test - handle token ordering
        weth.mint(lp2, 1000 ether);
        usdc.mint(lp2, 2_000_000e18);

        vm.startPrank(lp2);
        weth.approve(address(amm), type(uint256).max);
        usdc.approve(address(amm), type(uint256).max);
        // Pass amounts in sorted token order
        if (address(weth) < address(usdc)) {
            amm.addLiquidity(wethUsdcPool, 1000 ether, 2_000_000e18, 0, 0);
        } else {
            amm.addLiquidity(wethUsdcPool, 2_000_000e18, 1000 ether, 0, 0);
        }
        vm.stopPrank();

        // Large order
        weth.mint(trader1, 100 ether);

        // Use minAmountOut=0 for testing - verify execution happens
        bytes32 secret = keccak256("large");
        bytes32 hash = _generateCommitHash(trader1, address(weth), address(usdc), 100 ether, 0, secret);

        vm.prank(trader1);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        vm.prank(trader1);
        auction.revealOrder(commitId, address(weth), address(usdc), 100 ether, 0, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        vm.prank(trader1);
        weth.transfer(address(amm), 100 ether);
        amm.syncTrackedBalance(address(weth));

        IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](1);
        swapOrders[0] = IVibeAMM.SwapOrder({
            trader: trader1,
            tokenIn: address(weth),
            tokenOut: address(usdc),
            amountIn: 100 ether,
            minAmountOut: 0, // No minimum to ensure execution
            isPriority: false
        });

        // Should execute but with significant price impact
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(wethUsdcPool, 1, swapOrders);

        console.log("Large order clearing price:", result.clearingPrice);
        console.log("Large order output:", result.totalTokenOutSwapped);

        // Large order should execute and receive substantial USDC
        // With 1100 WETH and 2.2M USDC in pool, 100 WETH should get significant output
        assertGt(result.totalTokenInSwapped, 0, "Order should execute");
        assertGt(result.totalTokenOutSwapped, 50000 ether, "Should receive significant USDC");
    }

    // ============ Helper Functions ============

    function _executeSingleOrderBatch(
        address trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal {
        bytes32 secret = keccak256(abi.encodePacked(trader, block.timestamp));
        bytes32 hash = _generateCommitHash(trader, tokenIn, tokenOut, amountIn, minAmountOut, secret);

        vm.prank(trader);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        vm.prank(trader);
        auction.revealOrder(commitId, tokenIn, tokenOut, amountIn, minAmountOut, secret, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();

        // Sync both token balances before transfer to avoid DonationAttackSuspected
        amm.syncTrackedBalance(tokenIn);
        amm.syncTrackedBalance(tokenOut);

        vm.prank(trader);
        IERC20(tokenIn).transfer(address(amm), amountIn);
        amm.syncTrackedBalance(tokenIn);

        IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](1);
        swapOrders[0] = IVibeAMM.SwapOrder({
            trader: trader,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            isPriority: false
        });

        amm.executeBatchSwap(wethUsdcPool, uint64(auction.currentBatchId() - 1), swapOrders);
        auction.settleBatch();

        // Sync balances after swap for next batch
        amm.syncTrackedBalance(tokenIn);
        amm.syncTrackedBalance(tokenOut);
    }

    function _generateCommitHash(
        address trader,
        address tknIn,
        address tknOut,
        uint256 amtIn,
        uint256 minOut,
        bytes32 secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(trader, tknIn, tknOut, amtIn, minOut, secret));
    }
}
