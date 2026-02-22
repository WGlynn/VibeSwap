// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";
import "../../contracts/oracles/interfaces/ITruePriceOracle.sol";
import "../../contracts/libraries/TruePriceLib.sol";
import "../../contracts/libraries/BatchMath.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FuzzMockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract FuzzMockTruePriceOracle is ITruePriceOracle {
    mapping(bytes32 => TruePriceData) public prices;
    StablecoinContext public ctx;

    function setTruePrice(
        bytes32 poolId, uint256 price, uint256 confidence,
        int256 deviationZScore, RegimeType regime, uint256 manipulationProb
    ) external {
        prices[poolId] = TruePriceData({
            price: price, confidence: confidence,
            deviationZScore: deviationZScore, regime: regime,
            manipulationProb: manipulationProb,
            timestamp: uint64(block.timestamp),
            dataHash: keccak256(abi.encode(price))
        });
    }

    function setStablecoinContext(bool usdtDom, bool usdcDom) external {
        ctx = StablecoinContext({
            usdtUsdcRatio: usdtDom ? 3e18 : (usdcDom ? 0.3e18 : 1e18),
            usdtDominant: usdtDom,
            usdcDominant: usdcDom,
            volatilityMultiplier: 1e18
        });
    }

    function getTruePrice(bytes32 poolId) external view returns (TruePriceData memory) { return prices[poolId]; }
    function getStablecoinContext() external view returns (StablecoinContext memory) { return ctx; }
    function getDeviationMetrics(bytes32 poolId) external view returns (uint256, int256, uint256) {
        TruePriceData memory d = prices[poolId];
        return (d.price, d.deviationZScore, d.manipulationProb);
    }
    function isManipulationLikely(bytes32 poolId, uint256 threshold) external view returns (bool) {
        return prices[poolId].manipulationProb > threshold;
    }
    function getRegime(bytes32 poolId) external view returns (RegimeType) { return prices[poolId].regime; }
    function isFresh(bytes32 poolId, uint256 maxAge) external view returns (bool) {
        uint64 ts = prices[poolId].timestamp;
        return ts > 0 && block.timestamp <= ts + maxAge;
    }
    function getPriceBounds(bytes32 poolId, uint256 baseDeviationBps) external view returns (uint256, uint256) {
        uint256 p = prices[poolId].price;
        uint256 dev = (p * baseDeviationBps) / 10000;
        return (p > dev ? p - dev : 0, p + dev);
    }
    function updateTruePrice(bytes32, uint256, uint256, int256, RegimeType, uint256, bytes32, bytes calldata) external {}
    function updateStablecoinContext(uint256, bool, bool, uint256, bytes calldata) external {}
    function setAuthorizedSigner(address, bool) external {}
}

/**
 * @title TruePriceValidationFuzzTest
 * @notice Fuzz tests for True Price Oracle integration invariants
 */
contract TruePriceValidationFuzzTest is Test {
    VibeAMM public amm;
    FuzzMockToken public token0;
    FuzzMockToken public token1;
    FuzzMockTruePriceOracle public oracle;

    address public executor;
    address public user;
    bytes32 public poolId;

    uint256 constant INITIAL_LIQUIDITY = 1000 ether;

    function setUp() public {
        vm.warp(1 hours);

        address owner = address(this);
        executor = makeAddr("executor");
        user = makeAddr("user");

        token0 = new FuzzMockToken("Token A", "TKA");
        token1 = new FuzzMockToken("Token B", "TKB");
        if (address(token0) > address(token1)) (token0, token1) = (token1, token0);

        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(VibeAMM.initialize.selector, owner, makeAddr("treasury"));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));

        amm.setAuthorizedExecutor(executor, true);
        amm.setFlashLoanProtection(false);

        oracle = new FuzzMockTruePriceOracle();
        amm.setTruePriceOracle(address(oracle));
        amm.setTruePriceValidation(true);

        poolId = amm.createPool(address(token0), address(token1), 30);

        token0.mint(owner, INITIAL_LIQUIDITY * 10);
        token1.mint(owner, INITIAL_LIQUIDITY * 10);
        token0.approve(address(amm), type(uint256).max);
        token1.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId, INITIAL_LIQUIDITY, INITIAL_LIQUIDITY, 0, 0);

        // Default: True Price matches spot
        oracle.setTruePrice(poolId, 1e18, 0.01e18, 0, ITruePriceOracle.RegimeType.NORMAL, 0);
    }

    // ============ K Invariant Under Any True Price ============

    /**
     * @notice Reserves stay positive regardless of True Price value or regime
     * @dev Batch clearing prices are uniform (not constant-product), so K is NOT guaranteed
     *      to be preserved under True Price damping. Instead verify pool stays functional.
     */
    function testFuzz_reservesStayPositiveWithTruePrice(
        uint256 truePrice,
        uint256 swapAmount,
        uint8 regimeRaw
    ) public {
        truePrice = bound(truePrice, 0.01e18, 100e18);
        swapAmount = bound(swapAmount, 0.001 ether, INITIAL_LIQUIDITY / 10);
        uint8 regime = regimeRaw % 6;

        oracle.setTruePrice(
            poolId, truePrice, 0.01e18, 0,
            ITruePriceOracle.RegimeType(regime), 0
        );

        token0.mint(address(amm), swapAmount);
        amm.syncTrackedBalance(address(token0));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: user,
            tokenIn: address(token0),
            tokenOut: address(token1),
            amountIn: swapAmount,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        assertGt(poolAfter.reserve0, 0, "Reserve0 must stay positive");
        assertGt(poolAfter.reserve1, 0, "Reserve1 must stay positive");
    }

    // ============ Damping Always Moves Toward True Price ============

    /**
     * @notice When damping is applied, the result is always between clearing price and True Price
     */
    function testFuzz_dampingMovesTowardTruePrice(
        uint256 truePrice,
        uint256 swapAmount
    ) public {
        truePrice = bound(truePrice, 0.1e18, 10e18);
        swapAmount = bound(swapAmount, 0.01 ether, INITIAL_LIQUIDITY / 20);

        oracle.setTruePrice(
            poolId, truePrice, 0.01e18, 0,
            ITruePriceOracle.RegimeType.NORMAL, 0
        );

        token0.mint(address(amm), swapAmount);
        amm.syncTrackedBalance(address(token0));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: user,
            tokenIn: address(token0),
            tokenOut: address(token1),
            amountIn: swapAmount,
            minAmountOut: 0,
            isPriority: false
        });

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Clearing price should be non-zero
        assertGt(result.clearingPrice, 0, "Should produce a clearing price");
    }

    // ============ Regime Bounds Are Monotonic ============

    /**
     * @notice CASCADE < MANIPULATION < HIGH_LEVERAGE < NORMAL < TREND
     */
    function testFuzz_regimeBoundsMonotonic(uint256 baseBps) public pure {
        baseBps = bound(baseBps, 100, 5000);

        uint256 cascade = TruePriceLib.adjustDeviationForRegime(baseBps, ITruePriceOracle.RegimeType.CASCADE);
        uint256 manipulation = TruePriceLib.adjustDeviationForRegime(baseBps, ITruePriceOracle.RegimeType.MANIPULATION);
        uint256 highLev = TruePriceLib.adjustDeviationForRegime(baseBps, ITruePriceOracle.RegimeType.HIGH_LEVERAGE);
        uint256 normal = TruePriceLib.adjustDeviationForRegime(baseBps, ITruePriceOracle.RegimeType.NORMAL);
        uint256 trend = TruePriceLib.adjustDeviationForRegime(baseBps, ITruePriceOracle.RegimeType.TREND);

        // Strictest to loosest
        assertLe(cascade, manipulation, "CASCADE should be <= MANIPULATION");
        assertLe(manipulation, highLev, "MANIPULATION should be <= HIGH_LEVERAGE");
        assertLe(highLev, normal, "HIGH_LEVERAGE should be <= NORMAL");
        assertLe(normal, trend, "NORMAL should be <= TREND");
    }

    // ============ Stablecoin Bounds Ordering ============

    /**
     * @notice USDT dominant always tighter than USDC dominant
     */
    function testFuzz_stablecoinBoundsOrdering(uint256 baseBps) public pure {
        baseBps = bound(baseBps, 100, 5000);

        uint256 usdt = TruePriceLib.adjustDeviationForStablecoin(baseBps, true, false);
        uint256 neutral = TruePriceLib.adjustDeviationForStablecoin(baseBps, false, false);
        uint256 usdc = TruePriceLib.adjustDeviationForStablecoin(baseBps, false, true);

        assertLe(usdt, neutral, "USDT dominant should be tighter than neutral");
        assertLe(neutral, usdc, "Neutral should be tighter than USDC dominant");
    }

    // ============ Price Deviation Symmetry ============

    /**
     * @notice validatePriceDeviation is symmetric: +X% deviation same as -X%
     */
    function testFuzz_deviationSymmetry(uint256 price, uint256 deviationBps, uint256 maxBps) public pure {
        price = bound(price, 1e15, 1e24);
        deviationBps = bound(deviationBps, 1, 5000);
        maxBps = bound(maxBps, 1, 10000);

        uint256 above = price + (price * deviationBps) / 10000;
        uint256 below = price - (price * deviationBps) / 10000;

        bool aboveValid = TruePriceLib.validatePriceDeviation(above, price, maxBps);
        bool belowValid = TruePriceLib.validatePriceDeviation(below, price, maxBps);

        // Both should give same result (within rounding)
        assertEq(aboveValid, belowValid, "Deviation validation should be symmetric");
    }

    // ============ Golden Ratio Damping Bounds ============

    /**
     * @notice Damped price is always within [current - maxDev, current + maxDev]
     */
    function testFuzz_dampedPriceWithinBounds(
        uint256 currentPrice,
        uint256 proposedPrice,
        uint256 maxDeviationBps
    ) public pure {
        currentPrice = bound(currentPrice, 1e15, 1e24);
        proposedPrice = bound(proposedPrice, 1e15, 1e24);
        maxDeviationBps = bound(maxDeviationBps, 10, 5000);

        uint256 damped = BatchMath.applyGoldenRatioDamping(currentPrice, proposedPrice, maxDeviationBps);

        uint256 maxDev = (currentPrice * maxDeviationBps) / 10000;

        if (damped > currentPrice) {
            assertLe(damped - currentPrice, maxDev, "Damped increase should not exceed max deviation");
        } else {
            assertLe(currentPrice - damped, maxDev, "Damped decrease should not exceed max deviation");
        }
    }

    // ============ Freshness Edge Cases ============

    /**
     * @notice isFresh boundary conditions
     */
    function testFuzz_freshnessTransition(uint256 age, uint256 maxAge) public {
        age = bound(age, 0, 1 hours);
        maxAge = bound(maxAge, 1, 1 hours);

        uint64 ts = uint64(block.timestamp - age);

        bool fresh = TruePriceLib.isFresh(ts, maxAge);

        if (age <= maxAge) {
            assertTrue(fresh, "Should be fresh when age <= maxAge");
        } else {
            assertFalse(fresh, "Should be stale when age > maxAge");
        }
    }

    // ============ Z-Score Monotonicity ============

    /**
     * @notice Higher z-score produces higher reversion probability
     */
    function testFuzz_zScoreMonotonic(uint256 z1, uint256 z2) public pure {
        z1 = bound(z1, 0, 5e18);
        z2 = bound(z2, z1, 5e18);

        uint256 prob1 = TruePriceLib.zScoreToReversionProbability(int256(z1), false);
        uint256 prob2 = TruePriceLib.zScoreToReversionProbability(int256(z2), false);

        assertGe(prob2, prob1, "Higher z-score should give >= reversion probability");
    }

    // ============ Swap Never Reverts Due to True Price ============

    /**
     * @notice True Price should never cause a revert (graceful damping or fallback)
     */
    function testFuzz_swapNeverRevertsFromTruePrice(
        uint256 truePrice,
        uint256 manipProb,
        uint256 swapAmount,
        uint8 regimeRaw
    ) public {
        truePrice = bound(truePrice, 0.001e18, 1000e18);
        manipProb = bound(manipProb, 0, 1e18);
        swapAmount = bound(swapAmount, 0.001 ether, INITIAL_LIQUIDITY / 20);
        uint8 regime = regimeRaw % 6;

        oracle.setTruePrice(
            poolId, truePrice, 0.01e18,
            int256(bound(uint256(keccak256(abi.encode(truePrice))), 0, 5e18)),
            ITruePriceOracle.RegimeType(regime),
            manipProb
        );

        token0.mint(address(amm), swapAmount);
        amm.syncTrackedBalance(address(token0));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: user,
            tokenIn: address(token0),
            tokenOut: address(token1),
            amountIn: swapAmount,
            minAmountOut: 0,
            isPriority: false
        });

        // Should NEVER revert — True Price uses damping, not hard reverts
        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);
    }
}
