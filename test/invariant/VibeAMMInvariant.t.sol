// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/amm/VibeLP.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockAMMIToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract AMMHandler is Test {
    VibeAMM public amm;
    MockAMMIToken public token0;
    MockAMMIToken public token1;
    bytes32 public poolId;
    address public executor;

    address[] public lps;
    address public trader;

    // Ghost variables
    uint256 public ghost_totalToken0In;
    uint256 public ghost_totalToken1In;
    uint256 public ghost_totalToken0Out;
    uint256 public ghost_totalToken1Out;
    uint256 public ghost_swapCount;
    uint256 public ghost_kInitial;

    constructor(
        VibeAMM _amm,
        MockAMMIToken _token0,
        MockAMMIToken _token1,
        bytes32 _poolId,
        address _executor,
        address[] memory _lps,
        address _trader
    ) {
        amm = _amm;
        token0 = _token0;
        token1 = _token1;
        poolId = _poolId;
        executor = _executor;
        lps = _lps;
        trader = _trader;

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        ghost_kInitial = pool.reserve0 * pool.reserve1;
    }

    function swap0to1(uint256 amountIn) public {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 maxSwap = pool.reserve0 / 10;
        if (maxSwap == 0) return;
        amountIn = bound(amountIn, 1, maxSwap);

        // Mint to AMM and sync (simulating VibeSwapCore deposit flow)
        token0.mint(address(amm), amountIn);
        amm.syncTrackedBalance(address(token0));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: trader,
            tokenIn: address(token0),
            tokenOut: address(token1),
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        uint256 balBefore = token1.balanceOf(trader);

        vm.prank(executor);
        try amm.executeBatchSwap(poolId, uint64(++ghost_swapCount), orders) {
            uint256 received = token1.balanceOf(trader) - balBefore;
            ghost_totalToken0In += amountIn;
            ghost_totalToken1Out += received;
        } catch {}
    }

    function swap1to0(uint256 amountIn) public {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 maxSwap = pool.reserve1 / 10;
        if (maxSwap == 0) return;
        amountIn = bound(amountIn, 1, maxSwap);

        token1.mint(address(amm), amountIn);
        amm.syncTrackedBalance(address(token1));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: trader,
            tokenIn: address(token1),
            tokenOut: address(token0),
            amountIn: amountIn,
            minAmountOut: 0,
            isPriority: false
        });

        uint256 balBefore = token0.balanceOf(trader);

        vm.prank(executor);
        try amm.executeBatchSwap(poolId, uint64(++ghost_swapCount), orders) {
            uint256 received = token0.balanceOf(trader) - balBefore;
            ghost_totalToken1In += amountIn;
            ghost_totalToken0Out += received;
        } catch {}
    }

    function addLiquidity(uint256 lpSeed, uint256 amount0) public {
        amount0 = bound(amount0, 0.01 ether, 10 ether);
        address lp = lps[lpSeed % lps.length];

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        if (pool.reserve0 == 0 || pool.reserve1 == 0) return;

        uint256 amount1 = (amount0 * pool.reserve1) / pool.reserve0;
        if (amount1 == 0) return;

        token0.mint(lp, amount0);
        token1.mint(lp, amount1);

        vm.startPrank(lp);
        token0.approve(address(amm), amount0);
        token1.approve(address(amm), amount1);
        try amm.addLiquidity(poolId, amount0, amount1, 0, 0) {} catch {}
        vm.stopPrank();
    }

    function removeLiquidity(uint256 lpSeed, uint256 fraction) public {
        address lp = lps[lpSeed % lps.length];
        address lpToken = amm.getLPToken(poolId);
        uint256 bal = ERC20(lpToken).balanceOf(lp);
        if (bal == 0) return;

        fraction = bound(fraction, 1, 5000); // up to 50%
        uint256 amount = (bal * fraction) / 10000;
        if (amount == 0) return;

        vm.startPrank(lp);
        ERC20(lpToken).approve(address(amm), amount);
        try amm.removeLiquidity(poolId, amount, 0, 0) {} catch {}
        vm.stopPrank();
    }
}

// ============ Invariant Tests ============

contract VibeAMMInvariantTest is StdInvariant, Test {
    VibeAMM public amm;
    MockAMMIToken public token0;
    MockAMMIToken public token1;
    AMMHandler public handler;

    bytes32 public poolId;
    address public executor;
    address[] public lps;
    address public trader;

    function setUp() public {
        token0 = new MockAMMIToken("Token 0", "TK0");
        token1 = new MockAMMIToken("Token 1", "TK1");

        // Ensure ordering
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            address(this),
            makeAddr("treasury")
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));

        executor = makeAddr("executor");
        amm.setAuthorizedExecutor(executor, true);
        amm.setFlashLoanProtection(false);

        // Create pool
        poolId = amm.createPool(address(token0), address(token1), 30);

        // Seed initial liquidity
        token0.mint(address(this), 10_000 ether);
        token1.mint(address(this), 10_000 ether);
        token0.approve(address(amm), type(uint256).max);
        token1.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);

        // Create LPs
        for (uint256 i = 0; i < 3; i++) {
            address lp = makeAddr(string(abi.encodePacked("lp", vm.toString(i))));
            lps.push(lp);
        }
        trader = makeAddr("trader");

        handler = new AMMHandler(amm, token0, token1, poolId, executor, lps, trader);
        amm.setAuthorizedExecutor(address(handler), true);

        targetContract(address(handler));
    }

    // ============ Invariant: x*y >= k_initial ============

    function invariant_constantProductHolds() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 k = pool.reserve0 * pool.reserve1;
        assertGe(k, handler.ghost_kInitial(), "K VIOLATION: k decreased below initial");
    }

    // ============ Invariant: reserves always positive ============

    function invariant_reservesPositive() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertGt(pool.reserve0, 0, "RESERVE: reserve0 is zero");
        assertGt(pool.reserve1, 0, "RESERVE: reserve1 is zero");
    }

    // ============ Invariant: token balances cover reserves ============

    function invariant_tokenBalancesCoverReserves() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 bal0 = token0.balanceOf(address(amm));
        uint256 bal1 = token1.balanceOf(address(amm));

        assertGe(bal0, pool.reserve0, "BALANCE: token0 balance < reserve0");
        assertGe(bal1, pool.reserve1, "BALANCE: token1 balance < reserve1");
    }

    // ============ Invariant: pool always initialized ============

    function invariant_poolInitialized() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertTrue(pool.initialized, "POOL: not initialized");
    }

    // ============ Invariant: total liquidity >= minimum ============

    function invariant_liquidityAboveMinimum() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        // MINIMUM_LIQUIDITY = 10000 is permanently locked
        assertGe(pool.totalLiquidity, 10000, "LIQUIDITY: below minimum");
    }
}
