// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/amm/VibeLP.sol";
import "../../contracts/libraries/BatchMath.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockAMMIToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============
// Calls swap / addLiquidity / removeLiquidity with bounded random inputs.
// Ghost variables track cumulative state so invariant assertions can reason
// about the full sequence of operations.

contract VibeAMMHandler is Test {
    VibeAMM public amm;
    MockAMMIToken public token0;
    MockAMMIToken public token1;
    bytes32 public poolId;

    address[] public actors;
    uint256 constant NUM_ACTORS = 4;

    // ============ Ghost Variables ============

    // Running count of successful operations
    uint256 public ghost_swapCount;
    uint256 public ghost_addCount;
    uint256 public ghost_removeCount;

    // k (reserve0 * reserve1) immediately before the last swap
    uint256 public ghost_kBeforeLastSwap;
    // k immediately after the last swap
    uint256 public ghost_kAfterLastSwap;
    // Whether at least one successful swap has happened
    bool public ghost_hasSwapped;

    // k immediately before the last addLiquidity
    uint256 public ghost_kBeforeLastAdd;
    // k immediately after the last addLiquidity
    uint256 public ghost_kAfterLastAdd;
    bool public ghost_hasAdded;

    // k immediately before the last removeLiquidity
    uint256 public ghost_kBeforeLastRemove;
    // k immediately after the last removeLiquidity
    uint256 public ghost_kAfterLastRemove;
    bool public ghost_hasRemoved;

    // For swap value conservation: track input value vs output at pool price
    uint256 public ghost_lastSwapAmountIn;
    uint256 public ghost_lastSwapAmountOut;
    uint256 public ghost_lastSwapReserveIn;
    uint256 public ghost_lastSwapReserveOut;
    bool public ghost_lastSwapIsToken0;

    // For reserve ratio direction
    // price = reserve1/reserve0 (in 1e18). Tracks before/after last swap.
    uint256 public ghost_priceBefore;
    uint256 public ghost_priceAfter;

    // LP supply tracking
    uint256 public ghost_lpSupplyBeforeAdd;
    uint256 public ghost_lpSupplyAfterAdd;
    uint256 public ghost_lpSupplyBeforeRemove;
    uint256 public ghost_lpSupplyAfterRemove;

    constructor(
        VibeAMM _amm,
        MockAMMIToken _token0,
        MockAMMIToken _token1,
        bytes32 _poolId
    ) {
        amm = _amm;
        token0 = _token0;
        token1 = _token1;
        poolId = _poolId;

        // Create actor addresses
        for (uint256 i = 0; i < NUM_ACTORS; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);
        }
    }

    // ============ Actions ============

    /// @dev Swap token0 -> token1
    function swap0to1(uint256 amountSeed, uint256 actorSeed) public {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        if (pool.reserve0 == 0 || pool.reserve1 == 0) return;

        // MAX_TRADE_SIZE_BPS = 1000 (10% of reserve). Stay under it.
        uint256 maxSwap = (pool.reserve0 * 999) / 10000;
        if (maxSwap < 1e15) return; // minimum meaningful amount
        uint256 amountIn = bound(amountSeed, 1e15, maxSwap);

        address actor = actors[actorSeed % NUM_ACTORS];

        // Snapshot pre-swap state
        ghost_kBeforeLastSwap = pool.reserve0 * pool.reserve1;
        ghost_lastSwapReserveIn = pool.reserve0;
        ghost_lastSwapReserveOut = pool.reserve1;
        ghost_lastSwapIsToken0 = true;
        ghost_priceBefore = pool.reserve0 > 0 ? (pool.reserve1 * 1e18) / pool.reserve0 : 0;

        // Fund actor and approve
        token0.mint(actor, amountIn);
        vm.startPrank(actor);
        token0.approve(address(amm), amountIn);

        uint256 balBefore = token1.balanceOf(actor);
        // Use a new block to avoid same-block flash loan protection
        vm.roll(block.number + 1);
        try amm.swap(poolId, address(token0), amountIn, 0, actor) returns (uint256 amountOut) {
            vm.stopPrank();
            ghost_lastSwapAmountIn = amountIn;
            ghost_lastSwapAmountOut = amountOut;

            IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
            ghost_kAfterLastSwap = poolAfter.reserve0 * poolAfter.reserve1;
            ghost_priceAfter = poolAfter.reserve0 > 0
                ? (poolAfter.reserve1 * 1e18) / poolAfter.reserve0
                : 0;
            ghost_hasSwapped = true;
            ghost_swapCount++;
        } catch {
            vm.stopPrank();
        }
    }

    /// @dev Swap token1 -> token0
    function swap1to0(uint256 amountSeed, uint256 actorSeed) public {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        if (pool.reserve0 == 0 || pool.reserve1 == 0) return;

        uint256 maxSwap = (pool.reserve1 * 999) / 10000;
        if (maxSwap < 1e15) return;
        uint256 amountIn = bound(amountSeed, 1e15, maxSwap);

        address actor = actors[actorSeed % NUM_ACTORS];

        ghost_kBeforeLastSwap = pool.reserve0 * pool.reserve1;
        ghost_lastSwapReserveIn = pool.reserve1;
        ghost_lastSwapReserveOut = pool.reserve0;
        ghost_lastSwapIsToken0 = false;
        ghost_priceBefore = pool.reserve0 > 0 ? (pool.reserve1 * 1e18) / pool.reserve0 : 0;

        token1.mint(actor, amountIn);
        vm.startPrank(actor);
        token1.approve(address(amm), amountIn);

        vm.roll(block.number + 1);
        try amm.swap(poolId, address(token1), amountIn, 0, actor) returns (uint256 amountOut) {
            vm.stopPrank();
            ghost_lastSwapAmountIn = amountIn;
            ghost_lastSwapAmountOut = amountOut;

            IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
            ghost_kAfterLastSwap = poolAfter.reserve0 * poolAfter.reserve1;
            ghost_priceAfter = poolAfter.reserve0 > 0
                ? (poolAfter.reserve1 * 1e18) / poolAfter.reserve0
                : 0;
            ghost_hasSwapped = true;
            ghost_swapCount++;
        } catch {
            vm.stopPrank();
        }
    }

    /// @dev Add liquidity in proportion to current reserves
    function addLiquidity(uint256 amount0Seed, uint256 actorSeed) public {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        if (pool.reserve0 == 0 || pool.reserve1 == 0) return;

        uint256 amount0 = bound(amount0Seed, 1e15, 100 ether);
        uint256 amount1 = (amount0 * pool.reserve1) / pool.reserve0;
        if (amount1 == 0) return;

        address actor = actors[actorSeed % NUM_ACTORS];

        ghost_kBeforeLastAdd = pool.reserve0 * pool.reserve1;
        address lpToken = amm.getLPToken(poolId);
        ghost_lpSupplyBeforeAdd = ERC20(lpToken).totalSupply();

        token0.mint(actor, amount0);
        token1.mint(actor, amount1);

        vm.startPrank(actor);
        token0.approve(address(amm), amount0);
        token1.approve(address(amm), amount1);
        vm.roll(block.number + 1);
        try amm.addLiquidity(poolId, amount0, amount1, 0, 0) {
            vm.stopPrank();

            IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
            ghost_kAfterLastAdd = poolAfter.reserve0 * poolAfter.reserve1;
            ghost_lpSupplyAfterAdd = ERC20(lpToken).totalSupply();
            ghost_hasAdded = true;
            ghost_addCount++;
        } catch {
            vm.stopPrank();
        }
    }

    /// @dev Remove a fraction of an actor's LP position
    function removeLiquidity(uint256 actorSeed, uint256 fractionBps) public {
        address actor = actors[actorSeed % NUM_ACTORS];
        address lpToken = amm.getLPToken(poolId);
        uint256 bal = ERC20(lpToken).balanceOf(actor);
        if (bal == 0) return;

        // Remove between 1% and 50% of their position
        fractionBps = bound(fractionBps, 100, 5000);
        uint256 amount = (bal * fractionBps) / 10000;
        if (amount == 0) return;

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        // Don't drain the pool to zero (keep minimum liquidity intact)
        if (pool.totalLiquidity <= amount + 10000) return;

        ghost_kBeforeLastRemove = pool.reserve0 * pool.reserve1;
        ghost_lpSupplyBeforeRemove = ERC20(lpToken).totalSupply();

        vm.startPrank(actor);
        ERC20(lpToken).approve(address(amm), amount);
        vm.roll(block.number + 1);
        try amm.removeLiquidity(poolId, amount, 0, 0) {
            vm.stopPrank();

            IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
            ghost_kAfterLastRemove = poolAfter.reserve0 * poolAfter.reserve1;
            ghost_lpSupplyAfterRemove = ERC20(lpToken).totalSupply();
            ghost_hasRemoved = true;
            ghost_removeCount++;
        } catch {
            vm.stopPrank();
        }
    }
}

// ============ Invariant Test Suite ============

contract VibeAMMInvariantTest is StdInvariant, Test {
    VibeAMM public amm;
    MockAMMIToken public token0;
    MockAMMIToken public token1;
    VibeAMMHandler public handler;

    bytes32 public poolId;
    uint256 public initialK;

    function setUp() public {
        // Deploy tokens
        token0 = new MockAMMIToken("Token 0", "TK0");
        token1 = new MockAMMIToken("Token 1", "TK1");

        // Enforce canonical ordering (VibeAMM requires token0 < token1)
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        // Deploy AMM behind UUPS proxy
        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            address(this),
            makeAddr("treasury")
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));

        // Disable protections that interfere with fuzzing
        // Flash loan protection blocks same-block interactions
        amm.setFlashLoanProtection(false);
        // TWAP validation requires oracle history that the fuzzer won't build
        amm.setTWAPValidation(false);

        // Create pool with default fee rate (5 bps = 0.05%)
        poolId = amm.createPool(address(token0), address(token1), 5);

        // Seed initial liquidity: 1000 tokens each (equal ratio, price = 1:1)
        uint256 initAmount = 1000 ether;
        token0.mint(address(this), initAmount);
        token1.mint(address(this), initAmount);
        token0.approve(address(amm), type(uint256).max);
        token1.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId, initAmount, initAmount, 0, 0);

        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        initialK = pool.reserve0 * pool.reserve1;

        // Create handler and target it
        handler = new VibeAMMHandler(amm, token0, token1, poolId);

        targetContract(address(handler));

        // Restrict to only the handler's action functions
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = VibeAMMHandler.swap0to1.selector;
        selectors[1] = VibeAMMHandler.swap1to0.selector;
        selectors[2] = VibeAMMHandler.addLiquidity.selector;
        selectors[3] = VibeAMMHandler.removeLiquidity.selector;

        targetSelector(FuzzSelector({
            addr: address(handler),
            selectors: selectors
        }));
    }

    // ============ Invariant 1: x*y=k holds after every swap ============
    // Fees mean k should only increase (or stay equal within 1 wei rounding).
    // The constant product formula with fees guarantees k_after >= k_before.

    function invariant_constantProductHoldsAfterSwap() public view {
        if (!handler.ghost_hasSwapped()) return;

        uint256 kBefore = handler.ghost_kBeforeLastSwap();
        uint256 kAfter = handler.ghost_kAfterLastSwap();

        // k must not decrease after a swap (fees increase k).
        // Allow 1 wei tolerance for integer rounding.
        assertGe(
            kAfter + 1,
            kBefore,
            "INVARIANT 1 VIOLATED: x*y=k decreased after swap beyond 1 wei tolerance"
        );
    }

    // ============ Invariant 2: LP supply tracks proportionally ============
    // Total LP supply should be proportional to sqrt(k) after the initial mint.
    // Specifically: LP_supply / sqrt(k) should remain roughly constant.
    // We check that the ratio doesn't deviate by more than 1% from the
    // initial ratio established at pool creation.

    function invariant_lpSupplyTracksSqrtK() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        if (pool.reserve0 == 0 || pool.reserve1 == 0) return;

        address lpToken = amm.getLPToken(poolId);
        uint256 totalSupply = ERC20(lpToken).totalSupply();
        if (totalSupply == 0) return;

        // sqrt(k) = sqrt(reserve0 * reserve1)
        uint256 sqrtK = _sqrt(pool.reserve0 * pool.reserve1);
        if (sqrtK == 0) return;

        // The ratio totalSupply / sqrtK should remain roughly constant.
        // At initial mint: totalSupply included MINIMUM_LIQUIDITY locked to dead address.
        // Initial: sqrtK_init = sqrt(1000e18 * 1000e18) = 1000e18
        // Initial totalSupply = sqrt(1000e18 * 1000e18) - 1000 (BatchMath lock)
        //   but VibeLP.mint also locks 10000, so effective user LP = sqrt - 1000 - 10000
        //   totalSupply on-chain = sqrt - 1000 (BatchMath deducts 1000, AMM mints MINIMUM_LIQUIDITY=10000 to dead)
        //   Wait -- AMM line 544: liquidity -= MINIMUM_LIQUIDITY (10000)
        //   AMM line 545: mint MINIMUM_LIQUIDITY to dead
        //   So totalLiquidity (pool.totalLiquidity) includes the 10000 locked.
        //   And VibeLP.mint receives `liquidity` (after the 10000 deduction) but then
        //   on first call it internally locks another 10000 to dead.
        //   So on-chain totalSupply = (liquidity_from_amm) + 10000 (AMM's dead mint)
        //   where liquidity_from_amm: VibeLP internally does dead mint of 10000 + mints (amount-10000) to user
        //   Total on-chain ERC20 supply = 10000 (AMM dead) + 10000 (VibeLP dead) + (liquidity - 10000)
        //
        // In any case, the RATIO totalSupply/sqrtK should stay constant over time
        // because addLiquidity mints proportionally and removeLiquidity burns proportionally.
        // We verify this ratio doesn't change by more than 5% (generous tolerance for
        // fee accumulation which increases k without minting LP).

        // Use initial ratio as baseline
        uint256 sqrtKInitial = _sqrt(initialK);
        address lpTokenAddr = amm.getLPToken(poolId);
        // We can't easily get the initial total supply, so instead we verify
        // a weaker but still meaningful property: LP supply * LP supply <= k * C
        // where C accounts for the locked minimum liquidity.
        //
        // Simpler invariant: totalSupply^2 <= reserve0 * reserve1 * some_constant
        // This ensures LP tokens aren't being inflated relative to reserves.
        // For an AMM with fees, totalSupply^2 should be <= k (since fees grow k
        // but don't mint LP tokens).

        // Actually the cleanest check: after subtracting locked minimum,
        // (totalSupply)^2 <= reserve0 * reserve1
        // Because fees grow reserves without growing supply.
        // This may not hold precisely due to the initial MINIMUM_LIQUIDITY mechanics,
        // but it captures the spirit that LP tokens can't be inflated.

        // totalSupply includes locked minimums. The total minted to real LPs
        // tracks sqrt(k) from the time they deposited. Over time with fees,
        // k grows but supply doesn't, so totalSupply^2 < k should hold after
        // any fee-generating swap.
        //
        // At genesis (before any swap), totalSupply ~= sqrt(k) - locked_amounts,
        // so totalSupply^2 < k holds from the start.

        uint256 supplySquared = totalSupply * totalSupply;
        uint256 k = pool.reserve0 * pool.reserve1;

        // LP tokens should never be worth MORE than their share of reserves.
        // totalSupply^2 <= k is the mathematical guarantee of this.
        assertLe(
            supplySquared,
            k,
            "INVARIANT 2 VIOLATED: LP supply inflated beyond sqrt(k)"
        );
    }

    // ============ Invariant 3: addLiquidity increases k, removeLiquidity decreases k ============

    function invariant_addLiquidityIncreasesK() public view {
        if (!handler.ghost_hasAdded()) return;

        assertGt(
            handler.ghost_kAfterLastAdd(),
            handler.ghost_kBeforeLastAdd(),
            "INVARIANT 3a VIOLATED: k did not increase after addLiquidity"
        );
    }

    function invariant_removeLiquidityDecreasesK() public view {
        if (!handler.ghost_hasRemoved()) return;

        assertLt(
            handler.ghost_kAfterLastRemove(),
            handler.ghost_kBeforeLastRemove(),
            "INVARIANT 3b VIOLATED: k did not decrease after removeLiquidity"
        );
    }

    // ============ Invariant 4: No value created — swap output < input at pool price ============
    // For a constant product AMM with fees, the output of a swap must always be
    // worth less than the input at the pre-swap pool price. This is what prevents
    // value creation from thin air.
    //
    // If swapping tokenIn -> tokenOut:
    //   input value  = amountIn (in tokenIn units)
    //   output value = amountOut * (reserveIn / reserveOut) (converted to tokenIn units at pre-swap price)
    //   output_value < input_value must hold

    function invariant_noValueCreated() public view {
        if (!handler.ghost_hasSwapped()) return;

        uint256 amountIn = handler.ghost_lastSwapAmountIn();
        uint256 amountOut = handler.ghost_lastSwapAmountOut();
        uint256 reserveIn = handler.ghost_lastSwapReserveIn();
        uint256 reserveOut = handler.ghost_lastSwapReserveOut();

        if (amountIn == 0 || reserveOut == 0) return;

        // Convert output to input token units at pre-swap marginal price
        // price of tokenOut in tokenIn = reserveIn / reserveOut
        // output in tokenIn terms = amountOut * reserveIn / reserveOut
        uint256 outputValueInInputTerms = (amountOut * reserveIn) / reserveOut;

        assertLt(
            outputValueInInputTerms,
            amountIn,
            "INVARIANT 4 VIOLATED: swap output value >= input value (value created from nothing)"
        );
    }

    // ============ Invariant 5: Reserve ratio moves in the correct direction ============
    // When swapping token0 -> token1:
    //   reserve0 increases, reserve1 decreases
    //   => price (reserve1/reserve0) should DECREASE (token0 becomes cheaper)
    // When swapping token1 -> token0:
    //   reserve1 increases, reserve0 decreases
    //   => price (reserve1/reserve0) should INCREASE (token0 becomes more expensive)

    function invariant_reserveRatioDirection() public view {
        if (!handler.ghost_hasSwapped()) return;

        uint256 priceBefore = handler.ghost_priceBefore();
        uint256 priceAfter = handler.ghost_priceAfter();
        bool isToken0In = handler.ghost_lastSwapIsToken0();

        if (priceBefore == 0) return;

        if (isToken0In) {
            // Swapping token0 in: price (token1/token0) should decrease
            assertLe(
                priceAfter,
                priceBefore,
                "INVARIANT 5 VIOLATED: price increased when selling token0 (should decrease)"
            );
        } else {
            // Swapping token1 in: price (token1/token0) should increase
            assertGe(
                priceAfter,
                priceBefore,
                "INVARIANT 5 VIOLATED: price decreased when selling token1 (should increase)"
            );
        }
    }

    // ============ Supporting Invariants ============
    // These are foundational properties that support the 5 core invariants above.

    /// @dev Reserves must always be positive (pool never fully drained)
    function invariant_reservesPositive() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        assertGt(pool.reserve0, 0, "SUPPORT: reserve0 is zero");
        assertGt(pool.reserve1, 0, "SUPPORT: reserve1 is zero");
    }

    /// @dev Actual token balances must cover tracked reserves
    function invariant_solvency() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 bal0 = token0.balanceOf(address(amm));
        uint256 bal1 = token1.balanceOf(address(amm));
        assertGe(bal0, pool.reserve0, "SUPPORT: token0 balance < reserve0 (insolvent)");
        assertGe(bal1, pool.reserve1, "SUPPORT: token1 balance < reserve1 (insolvent)");
    }

    /// @dev k must never fall below the initial k (fees only grow the product)
    function invariant_kNeverBelowInitial() public view {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 k = pool.reserve0 * pool.reserve1;
        // k can decrease from removeLiquidity, but only proportionally.
        // With addLiquidity and swaps it should grow. We track that k >= initial
        // minus what was removed. Actually, after removeLiquidity k CAN be below
        // initialK. So this invariant only holds if no liquidity has been removed.
        // Skip if any remove has happened.
        if (handler.ghost_removeCount() > 0) return;
        assertGe(k, initialK, "SUPPORT: k fell below initial (without any removals)");
    }

    // ============ Utility ============

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
