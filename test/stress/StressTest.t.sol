// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/incentives/LoyaltyRewardsManager.sol";
import "../../contracts/incentives/ILProtectionVault.sol";
import "../../contracts/incentives/SlippageGuaranteeFund.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

/**
 * @title StressTest
 * @notice Aggressive stress testing to find breaking points
 */
contract StressTest is Test {
    VibeAMM public amm;
    CommitRevealAuction public auction;
    MockToken public tokenA;
    MockToken public tokenB;

    address public owner;
    address public treasury;
    bytes32 public poolId;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");

        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");

        // Deploy AMM
        VibeAMM ammImpl = new VibeAMM();
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy ammProxy = new ERC1967Proxy(address(ammImpl), ammInit);
        amm = VibeAMM(address(ammProxy));

        amm.setAuthorizedExecutor(address(this), true);
        amm.setFlashLoanProtection(false);

        // Deploy Auction
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);
        auction = CommitRevealAuction(payable(address(auctionProxy)));

        auction.setAuthorizedSettler(address(this), true);

        // Create pool with substantial liquidity
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        tokenA.mint(address(this), 1000000 ether);
        tokenB.mint(address(this), 1000000 ether);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);

        amm.addLiquidity(poolId, 100000 ether, 100000 ether, 0, 0);
    }

    // ============ Extreme Value Tests ============

    /**
     * @notice Test with maximum practical amounts
     */
    function test_stress_largeAmounts() public {
        // Add massive liquidity
        tokenA.mint(address(this), type(uint128).max);
        tokenB.mint(address(this), type(uint128).max);

        // Try to add very large liquidity
        amm.addLiquidity(poolId, 1e30, 1e30, 0, 0);

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertGt(pool.reserve0, 0);
        assertGt(pool.reserve1, 0);
    }

    /**
     * @notice Test with minimum amounts (1 wei)
     */
    function test_stress_minimumAmounts() public {
        // Transfer 1 wei to AMM
        tokenA.mint(address(amm), 1);
        amm.syncTrackedBalance(address(tokenA));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: address(this),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1,
            minAmountOut: 0,
            isPriority: false
        });

        // Should handle gracefully (might return 0 output due to fees)
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);
        // Either executes with 0 output or doesn't execute - both acceptable
        assertTrue(result.totalTokenInSwapped == 0 || result.totalTokenInSwapped == 1);
    }

    // ============ Rapid Operation Tests ============

    /**
     * @notice Test many consecutive swaps in same direction
     */
    function test_stress_consecutiveSwapsSameDirection() public {
        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 numSwaps = 50;

        for (uint256 i = 0; i < numSwaps; i++) {
            uint256 swapAmount = 100 ether;
            tokenA.mint(address(amm), swapAmount);
            amm.syncTrackedBalance(address(tokenA));

            IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
            orders[0] = IVibeAMM.SwapOrder({
                trader: address(this),
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                amountIn: swapAmount,
                minAmountOut: 0,
                isPriority: false
            });

            amm.executeBatchSwap(poolId, uint64(i + 1), orders);
        }

        // Pool should still be valid
        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        assertGt(poolAfter.reserve0, 0);
        assertGt(poolAfter.reserve1, 0);

        // Reserves should have changed significantly (price moved)
        // Selling tokenA repeatedly means tokenA reserves increase, tokenB decreases
        bool tokenAIsToken0 = address(tokenA) < address(tokenB);
        if (tokenAIsToken0) {
            // tokenA is reserve0 - should increase
            assertGt(poolAfter.reserve0, poolBefore.reserve0, "TokenA reserves should increase");
        } else {
            // tokenA is reserve1 - should increase
            assertGt(poolAfter.reserve1, poolBefore.reserve1, "TokenA reserves should increase");
        }
    }

    /**
     * @notice Test alternating buy/sell rapidly
     */
    function test_stress_alternatingSwaps() public {
        uint256 numSwaps = 100;

        for (uint256 i = 0; i < numSwaps; i++) {
            uint256 swapAmount = 10 ether;
            address tokenIn = i % 2 == 0 ? address(tokenA) : address(tokenB);
            address tokenOut = i % 2 == 0 ? address(tokenB) : address(tokenA);

            MockToken(tokenIn).mint(address(amm), swapAmount);
            amm.syncTrackedBalance(tokenIn);

            IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
            orders[0] = IVibeAMM.SwapOrder({
                trader: address(this),
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: swapAmount,
                minAmountOut: 0,
                isPriority: false
            });

            amm.executeBatchSwap(poolId, uint64(i + 1), orders);
        }

        // Pool should maintain invariant
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 k = pool.reserve0 * pool.reserve1;
        assertGt(k, 0, "Constant product should be positive");
    }

    // ============ Auction Stress Tests ============

    /**
     * @notice Test many commits in same batch
     */
    function test_stress_manyCommits() public {
        uint256 numCommits = 50;
        bytes32[] memory commitIds = new bytes32[](numCommits);

        for (uint256 i = 0; i < numCommits; i++) {
            address trader = address(uint160(1000 + i));
            vm.deal(trader, 1 ether);

            bytes32 secret = keccak256(abi.encodePacked("secret", i));
            bytes32 commitHash = keccak256(abi.encodePacked(
                trader,
                address(tokenA),
                address(tokenB),
                uint256(1 ether),
                uint256(0),
                secret
            ));

            vm.prank(trader);
            commitIds[i] = auction.commitOrder{value: 0.01 ether}(commitHash);
        }

        // Verify all commits stored
        for (uint256 i = 0; i < numCommits; i++) {
            ICommitRevealAuction.OrderCommitment memory commit = auction.getCommitment(commitIds[i]);
            assertEq(uint8(commit.status), uint8(ICommitRevealAuction.CommitStatus.COMMITTED));
        }
    }

    /**
     * @notice Test rapid phase transitions
     */
    function test_stress_rapidPhaseTransitions() public {
        uint256 currentTime = block.timestamp;

        for (uint256 i = 0; i < 10; i++) {
            // Commit phase
            bytes32 secret = keccak256(abi.encodePacked("secret", i, currentTime));
            bytes32 commitHash = keccak256(abi.encodePacked(
                address(this),
                address(tokenA),
                address(tokenB),
                uint256(1 ether),
                uint256(0),
                secret
            ));

            bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

            // Move to reveal phase (need to wait for commit phase to end)
            currentTime += 9;
            vm.warp(currentTime);

            auction.revealOrder(
                commitId,
                address(tokenA),
                address(tokenB),
                1 ether,
                0,
                secret,
                0
            );

            // Move to settling phase
            currentTime += 3;
            vm.warp(currentTime);
            auction.advancePhase();
            auction.settleBatch();

            // New batch should be created
            assertEq(auction.getCurrentBatchId(), uint64(i + 2));
        }
    }

    // ============ Edge Case Tests ============

    /**
     * @notice Test pool with extremely unbalanced reserves
     */
    function test_stress_unbalancedPool() public {
        // Create extremely unbalanced pool with NEW tokens
        MockToken tokenC = new MockToken("Token C", "TKC");
        MockToken tokenD = new MockToken("Token D", "TKD");

        bytes32 unbalancedPool = amm.createPool(address(tokenC), address(tokenD), 30);

        tokenC.mint(address(this), 1e30);
        tokenD.mint(address(this), 1);
        tokenC.approve(address(amm), type(uint256).max);
        tokenD.approve(address(amm), type(uint256).max);

        // This should work even with extreme imbalance
        amm.addLiquidity(unbalancedPool, 1e30, 1, 0, 0);

        IVibeAMM.Pool memory pool = amm.getPool(unbalancedPool);
        assertGt(pool.reserve0, 0);
        assertGt(pool.reserve1, 0);
    }

    /**
     * @notice Test swap that would drain most of one reserve
     */
    function test_stress_nearDrainSwap() public {
        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);

        // Try to swap enough to drain ~99% of tokenB
        uint256 hugeSwap = poolBefore.reserve0 * 100;
        tokenA.mint(address(amm), hugeSwap);
        amm.syncTrackedBalance(address(tokenA));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: address(this),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: hugeSwap,
            minAmountOut: 0,
            isPriority: false
        });

        amm.executeBatchSwap(poolId, 1, orders);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);

        // Pool should still have some reserves
        assertGt(poolAfter.reserve1, 0, "Should not fully drain reserve");
        // Constant product should be maintained or increased
        assertGe(poolAfter.reserve0 * poolAfter.reserve1, poolBefore.reserve0 * poolBefore.reserve1);
    }

    /**
     * @notice Test batch with mixed valid/invalid orders
     */
    function test_stress_mixedValidityBatch() public {
        // Transfer tokens for valid orders
        tokenA.mint(address(amm), 10 ether);
        amm.syncTrackedBalance(address(tokenA));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](3);

        // Valid order
        orders[0] = IVibeAMM.SwapOrder({
            trader: address(this),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 5 ether,
            minAmountOut: 0,
            isPriority: false
        });

        // Order with impossible slippage (invalid)
        orders[1] = IVibeAMM.SwapOrder({
            trader: address(this),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 2 ether,
            minAmountOut: type(uint256).max, // Impossible
            isPriority: false
        });

        // Another valid order
        orders[2] = IVibeAMM.SwapOrder({
            trader: address(this),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 3 ether,
            minAmountOut: 0,
            isPriority: false
        });

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Should process valid orders
        assertGt(result.totalTokenInSwapped, 0, "Valid orders should execute");
    }

    // ============ Liquidity Stress Tests ============

    /**
     * @notice Test rapid add/remove liquidity
     */
    function test_stress_rapidLiquidityChanges() public {
        address lpToken = amm.getLPToken(poolId);

        for (uint256 i = 0; i < 20; i++) {
            // Add liquidity
            uint256 addAmount = 1000 ether;
            tokenA.mint(address(this), addAmount);
            tokenB.mint(address(this), addAmount);

            (,, uint256 liquidity) = amm.addLiquidity(poolId, addAmount, addAmount, 0, 0);

            // Immediately remove some
            uint256 removeAmount = liquidity / 2;
            if (removeAmount > 0) {
                amm.removeLiquidity(poolId, removeAmount, 0, 0);
            }
        }

        // Pool should still be valid
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertGt(pool.totalLiquidity, 0);
    }

    /**
     * @notice Test removing all liquidity except 1 wei
     */
    function test_stress_nearTotalWithdrawal() public {
        address lpToken = amm.getLPToken(poolId);
        uint256 totalLp = IERC20(lpToken).balanceOf(address(this));

        // Remove all but 1
        if (totalLp > 1) {
            amm.removeLiquidity(poolId, totalLp - 1, 0, 0);
        }

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertGt(pool.totalLiquidity, 0, "Should have minimal liquidity");
    }

    // ============ Gas Limit Tests ============

    /**
     * @notice Test batch with maximum practical orders
     */
    function test_stress_largeBatch() public {
        uint256 numOrders = 20; // Reasonable for block gas limit

        // Mint tokens for all orders
        uint256 totalAmount = numOrders * 1 ether;
        tokenA.mint(address(amm), totalAmount);
        amm.syncTrackedBalance(address(tokenA));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](numOrders);

        for (uint256 i = 0; i < numOrders; i++) {
            orders[i] = IVibeAMM.SwapOrder({
                trader: address(uint160(1000 + i)),
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                amountIn: 1 ether,
                minAmountOut: 0,
                isPriority: i % 5 == 0 // Some priority orders
            });
        }

        uint256 gasBefore = gasleft();
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);
        uint256 gasUsed = gasBefore - gasleft();

        assertGt(result.totalTokenInSwapped, 0);

        // Log gas usage for analysis
        emit log_named_uint("Gas used for batch", gasUsed);
        emit log_named_uint("Gas per order", gasUsed / numOrders);
    }
}
