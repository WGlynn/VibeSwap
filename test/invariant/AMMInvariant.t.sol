// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
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
 * @title AMM Handler for Invariant Testing
 * @notice Handles bounded random calls to the AMM
 */
contract AMMHandler is Test {
    VibeAMM public amm;
    MockToken public token0;
    MockToken public token1;
    bytes32 public poolId;
    address public executor;

    address[] public actors;
    uint64 public batchCounter;

    // Ghost variables for tracking
    uint256 public ghost_totalDeposited0;
    uint256 public ghost_totalDeposited1;
    uint256 public ghost_totalWithdrawn0;
    uint256 public ghost_totalWithdrawn1;
    uint256 public ghost_swapCount;

    constructor(
        VibeAMM _amm,
        MockToken _token0,
        MockToken _token1,
        bytes32 _poolId,
        address _executor
    ) {
        amm = _amm;
        token0 = _token0;
        token1 = _token1;
        poolId = _poolId;
        executor = _executor;
        batchCounter = 100;

        // Create actors
        for (uint256 i = 0; i < 10; i++) {
            actors.push(address(uint160(i + 1000)));
        }
    }

    function addLiquidity(uint256 actorSeed, uint256 amount0, uint256 amount1) public {
        // Bound inputs
        address actor = actors[actorSeed % actors.length];
        amount0 = bound(amount0, 0.001 ether, 100 ether);
        amount1 = bound(amount1, 0.001 ether, 100 ether);

        // Mint tokens
        token0.mint(actor, amount0);
        token1.mint(actor, amount1);

        // Approve and add liquidity
        vm.startPrank(actor);
        token0.approve(address(amm), amount0);
        token1.approve(address(amm), amount1);

        try amm.addLiquidity(poolId, amount0, amount1, 0, 0) returns (
            uint256 actual0,
            uint256 actual1,
            uint256
        ) {
            ghost_totalDeposited0 += actual0;
            ghost_totalDeposited1 += actual1;
        } catch {
            // Expected failures are ok
        }
        vm.stopPrank();
    }

    function removeLiquidity(uint256 actorSeed, uint256 liquidityPercent) public {
        address actor = actors[actorSeed % actors.length];
        liquidityPercent = bound(liquidityPercent, 1, 100);

        address lpToken = amm.getLPToken(poolId);
        uint256 balance = IERC20(lpToken).balanceOf(actor);

        if (balance == 0) return;

        uint256 toRemove = (balance * liquidityPercent) / 100;
        if (toRemove == 0) return;

        vm.startPrank(actor);

        try amm.removeLiquidity(poolId, toRemove, 0, 0) returns (
            uint256 amount0,
            uint256 amount1
        ) {
            ghost_totalWithdrawn0 += amount0;
            ghost_totalWithdrawn1 += amount1;
        } catch {
            // Expected failures are ok
        }
        vm.stopPrank();
    }

    function swap(uint256 actorSeed, uint256 amountIn, bool zeroForOne) public {
        address actor = actors[actorSeed % actors.length];
        amountIn = bound(amountIn, 0.0001 ether, 10 ether);

        MockToken tokenIn = zeroForOne ? token0 : token1;
        address tokenOut = zeroForOne ? address(token1) : address(token0);

        // Mint tokens directly to AMM and sync (simulating VibeSwapCore deposit)
        tokenIn.mint(address(amm), amountIn);
        amm.syncTrackedBalance(address(tokenIn));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: actor,
            tokenIn: address(tokenIn),
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        try amm.executeBatchSwap(poolId, batchCounter++, orders) {
            ghost_swapCount++;
            // Sync output token balance after swap
            amm.syncTrackedBalance(tokenOut);
        } catch {
            // Expected failures are ok
        }
    }
}

/**
 * @title AMM Invariant Tests
 * @notice Tests protocol-wide invariants under random sequences of operations
 */
contract AMMInvariantTest is StdInvariant, Test {
    VibeAMM public amm;
    MockToken public token0;
    MockToken public token1;
    AMMHandler public handler;

    address public owner;
    address public treasury;
    address public executor;

    bytes32 public poolId;

    uint256 constant INITIAL_K = 1000 ether * 1000 ether;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        executor = makeAddr("executor");

        // Deploy tokens
        token0 = new MockToken("Token A", "TKA");
        token1 = new MockToken("Token B", "TKB");

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

        amm.setAuthorizedExecutor(executor, true);

        // Create pool
        poolId = amm.createPool(address(token0), address(token1), 30);

        // Initial liquidity
        token0.mint(owner, 1000 ether);
        token1.mint(owner, 1000 ether);
        token0.approve(address(amm), 1000 ether);
        token1.approve(address(amm), 1000 ether);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        // Setup handler
        handler = new AMMHandler(amm, token0, token1, poolId, executor);

        // Target the handler for invariant testing
        targetContract(address(handler));
    }

    /**
     * @notice Invariant: K (reserve0 * reserve1) should never decrease
     * @dev This is the fundamental AMM invariant - K can only increase due to fees
     */
    function invariant_kNeverDecreases() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 currentK = pool.reserve0 * pool.reserve1;

        // K should be at least the initial K
        assertGe(currentK, INITIAL_K, "K invariant violated: K decreased below initial");
    }

    /**
     * @notice Invariant: Pool reserves should never be zero
     */
    function invariant_reservesNeverZero() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);

        assertGt(pool.reserve0, 0, "Reserve0 is zero");
        assertGt(pool.reserve1, 0, "Reserve1 is zero");
    }

    /**
     * @notice Invariant: Total liquidity equals sum of all LP balances
     */
    function invariant_liquidityAccounting() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        address lpToken = amm.getLPToken(poolId);

        // Total supply of LP token should match pool's tracked total liquidity
        uint256 lpTotalSupply = IERC20(lpToken).totalSupply();
        assertEq(pool.totalLiquidity, lpTotalSupply, "Liquidity accounting mismatch");
    }

    /**
     * @notice Invariant: Tracked balances should not exceed actual balances
     */
    function invariant_trackedBalancesValid() public view {
        uint256 tracked0 = amm.trackedBalances(address(token0));
        uint256 tracked1 = amm.trackedBalances(address(token1));

        uint256 actual0 = token0.balanceOf(address(amm));
        uint256 actual1 = token1.balanceOf(address(amm));

        // Tracked should not exceed actual (could be less due to accumulated fees)
        assertLe(tracked0, actual0 + 1, "Tracked balance0 exceeds actual");
        assertLe(tracked1, actual1 + 1, "Tracked balance1 exceeds actual");
    }

    /**
     * @notice Invariant: Fee rate should be bounded
     */
    function invariant_feeRateBounded() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);

        // Fee rate should be reasonable (0.01% to 10%)
        assertGe(pool.feeRate, 1, "Fee rate too low");
        assertLe(pool.feeRate, 1000, "Fee rate too high");
    }

    /**
     * @notice Call summary for debugging
     */
    function invariant_callSummary() public view {
        console.log("--- Call Summary ---");
        console.log("Total deposits token0:", handler.ghost_totalDeposited0());
        console.log("Total deposits token1:", handler.ghost_totalDeposited1());
        console.log("Total withdrawals token0:", handler.ghost_totalWithdrawn0());
        console.log("Total withdrawals token1:", handler.ghost_totalWithdrawn1());
        console.log("Total swaps:", handler.ghost_swapCount());
    }
}
