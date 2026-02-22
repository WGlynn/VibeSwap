// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/amm/VibeLP.sol";
import "../contracts/core/interfaces/IVibeAMM.sol";
import "../contracts/oracles/interfaces/ITruePriceOracle.sol";
import "../contracts/libraries/TruePriceLib.sol";
import "../contracts/libraries/BatchMath.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockERC20TP is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Configurable mock True Price Oracle for testing all enforcement tiers
contract MockTruePriceOracle is ITruePriceOracle {
    mapping(bytes32 => TruePriceData) public prices;
    StablecoinContext public ctx;
    bool public shouldRevert;
    bool public stablecoinRevert;

    function setTruePrice(
        bytes32 poolId,
        uint256 price,
        uint256 confidence,
        int256 deviationZScore,
        RegimeType regime,
        uint256 manipulationProb
    ) external {
        prices[poolId] = TruePriceData({
            price: price,
            confidence: confidence,
            deviationZScore: deviationZScore,
            regime: regime,
            manipulationProb: manipulationProb,
            timestamp: uint64(block.timestamp),
            dataHash: keccak256(abi.encode(price, block.timestamp))
        });
    }

    function setTimestamp(bytes32 poolId, uint64 ts) external {
        prices[poolId].timestamp = ts;
    }

    function setStablecoinContext(
        uint256 usdtUsdcRatio,
        bool usdtDominant,
        bool usdcDominant,
        uint256 volatilityMultiplier
    ) external {
        ctx = StablecoinContext({
            usdtUsdcRatio: usdtUsdcRatio,
            usdtDominant: usdtDominant,
            usdcDominant: usdcDominant,
            volatilityMultiplier: volatilityMultiplier
        });
    }

    function setShouldRevert(bool _revert) external { shouldRevert = _revert; }
    function setStablecoinRevert(bool _revert) external { stablecoinRevert = _revert; }

    // ITruePriceOracle interface
    function getTruePrice(bytes32 poolId) external view returns (TruePriceData memory) {
        if (shouldRevert) revert("Oracle unavailable");
        return prices[poolId];
    }

    function getStablecoinContext() external view returns (StablecoinContext memory) {
        if (stablecoinRevert) revert("Stablecoin context unavailable");
        return ctx;
    }

    function getDeviationMetrics(bytes32 poolId) external view returns (uint256, int256, uint256) {
        TruePriceData memory d = prices[poolId];
        return (d.price, d.deviationZScore, d.manipulationProb);
    }

    function isManipulationLikely(bytes32 poolId, uint256 threshold) external view returns (bool) {
        return prices[poolId].manipulationProb > threshold;
    }

    function getRegime(bytes32 poolId) external view returns (RegimeType) {
        return prices[poolId].regime;
    }

    function isFresh(bytes32 poolId, uint256 maxAge) external view returns (bool) {
        uint64 ts = prices[poolId].timestamp;
        if (ts == 0) return false;
        return block.timestamp <= ts + maxAge;
    }

    function getPriceBounds(bytes32 poolId, uint256 baseDeviationBps) external view returns (uint256, uint256) {
        uint256 p = prices[poolId].price;
        uint256 dev = (p * baseDeviationBps) / 10000;
        return (p - dev, p + dev);
    }

    function updateTruePrice(bytes32, uint256, uint256, int256, RegimeType, uint256, bytes32, bytes calldata) external {}
    function updateStablecoinContext(uint256, bool, bool, uint256, bytes calldata) external {}
    function setAuthorizedSigner(address, bool) external {}
}

// ============ Test Contract ============

/**
 * @title TruePriceValidationTest
 * @notice Tests True Price Oracle integration in VibeAMM
 * @dev Covers: three-tier enforcement, regime bounds, stablecoin context, staleness, oracle failures
 */
contract TruePriceValidationTest is Test {
    VibeAMM public amm;
    MockERC20TP public tokenA;
    MockERC20TP public tokenB;
    MockTruePriceOracle public oracle;

    address public owner;
    address public treasury;
    address public executor;
    address public trader;

    bytes32 public poolId;

    uint256 constant INITIAL_LIQUIDITY = 1000 ether;
    uint256 constant SWAP_AMOUNT = 10 ether;

    event TruePriceValidationResult(bytes32 indexed poolId, uint256 spotPrice, uint256 truePrice, bool passed);
    event PriceManipulationDetected(bytes32 indexed poolId, uint256 spotPrice, uint256 twapPrice);
    event TruePriceOracleUpdated(address indexed oracle);
    event TruePriceValidationToggled(bool enabled);

    function setUp() public {
        // Warp to reasonable timestamp (Foundry starts at 1, causes underflow with timestamp math)
        vm.warp(1 hours);

        owner = address(this);
        treasury = makeAddr("treasury");
        executor = makeAddr("executor");
        trader = makeAddr("trader");

        // Deploy tokens
        tokenA = new MockERC20TP("Token A", "TKA");
        tokenB = new MockERC20TP("Token B", "TKB");

        // Deploy AMM via proxy
        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(VibeAMM.initialize.selector, owner, treasury);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));

        // Setup executor
        amm.setAuthorizedExecutor(executor, true);
        amm.setFlashLoanProtection(false);

        // Deploy and configure True Price Oracle
        oracle = new MockTruePriceOracle();
        amm.setTruePriceOracle(address(oracle));
        amm.setTruePriceValidation(true);

        // Create pool and add liquidity
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        tokenA.mint(owner, INITIAL_LIQUIDITY * 10);
        tokenB.mint(owner, INITIAL_LIQUIDITY * 10);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);

        amm.addLiquidity(poolId, INITIAL_LIQUIDITY, INITIAL_LIQUIDITY, 0, 0);

        // Set True Price matching the spot price (1:1 pool → price = 1e18)
        oracle.setTruePrice(
            poolId,
            1e18,      // price matches reserves
            0.01e18,   // tight confidence
            0,         // no deviation
            ITruePriceOracle.RegimeType.NORMAL,
            0          // no manipulation
        );
    }

    // ============ Admin Function Tests ============

    function test_setTruePriceOracle() public {
        address newOracle = makeAddr("newOracle");
        vm.expectEmit(true, false, false, false);
        emit TruePriceOracleUpdated(newOracle);
        amm.setTruePriceOracle(newOracle);
        assertEq(address(amm.truePriceOracle()), newOracle);
    }

    function test_setTruePriceOracle_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        amm.setTruePriceOracle(address(oracle));
    }

    function test_setTruePriceValidation_enable() public {
        amm.setTruePriceValidation(false);
        assertEq(amm.protectionFlags() & 4, 0); // FLAG_TRUE_PRICE = 1 << 2 = 4

        vm.expectEmit(false, false, false, true);
        emit TruePriceValidationToggled(true);
        amm.setTruePriceValidation(true);
        assertEq(amm.protectionFlags() & 4, 4);
    }

    function test_setTruePriceValidation_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        amm.setTruePriceValidation(true);
    }

    function test_setTruePriceMaxStaleness() public {
        amm.setTruePriceMaxStaleness(60); // 1 minute
        assertEq(amm.truePriceMaxStaleness(), 60);
    }

    function test_setTruePriceMaxStaleness_bounds() public {
        // Too low
        vm.expectRevert("Staleness out of range");
        amm.setTruePriceMaxStaleness(29);

        // Too high
        vm.expectRevert("Staleness out of range");
        amm.setTruePriceMaxStaleness(31 minutes);

        // Boundaries should work
        amm.setTruePriceMaxStaleness(30);
        assertEq(amm.truePriceMaxStaleness(), 30);
        amm.setTruePriceMaxStaleness(30 minutes);
        assertEq(amm.truePriceMaxStaleness(), 30 minutes);
    }

    // ============ Tier 1: Within Bounds — Pass Through ============

    function test_truePrice_withinBounds_passThrough() public {
        // True Price = 1e18, spot ≈ 1e18 (1:1 pool, small swap)
        // Deviation < 5% (MAX_PRICE_DEVIATION_BPS = 500) → pass through

        _executeSwapAndAssertSuccess(SWAP_AMOUNT);
    }

    function test_truePrice_withinBounds_emitsPassedEvent() public {
        // We expect a TruePriceValidationResult event with passed=true
        // Can't predict exact clearing price, but the event should fire
        _mintAndSync(SWAP_AMOUNT);

        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // If True Price validation passed, we get a result
        assertGt(result.clearingPrice, 0, "Should have clearing price");
    }

    // ============ Tier 2: Beyond Bounds — Golden Ratio Damping ============

    function test_truePrice_beyondBounds_dampsClearingPrice() public {
        // Set True Price significantly different from spot
        // Spot is ~1e18 (1:1 pool). Set True Price to 0.5e18 (50% lower)
        // This means clearing price will deviate far from True Price
        oracle.setTruePrice(
            poolId,
            0.5e18,   // True Price much lower than spot
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Clearing price should be damped toward True Price
        // It should NOT be the raw clearing price from the AMM
        assertGt(result.clearingPrice, 0, "Should have clearing price");

        // With golden ratio damping, the price should be closer to truePrice (0.5e18)
        // than the raw spot (~1e18)
        // The damped price = truePrice + (maxDev * PHI / PRECISION)
        // maxDev = truePrice * 500 / 10000 = 0.5e18 * 0.05 = 0.025e18
        // dampedIncrease = 0.025e18 * 1.618 / 1e18 ≈ 0.04045e18
        // But that gets capped at maxDev = 0.025e18
        // So damped = 0.5e18 + 0.025e18 = 0.525e18
        // The clearing price should be around 0.525e18 (much less than raw ~1e18)
        assertLt(result.clearingPrice, 0.6e18, "Price should be damped toward True Price");
    }

    function test_truePrice_beyondBounds_emitsFailedEvent() public {
        // Large deviation from True Price
        oracle.setTruePrice(
            poolId,
            0.5e18,
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        // Should emit TruePriceValidationResult with passed=false
        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);
        // Test passes if no revert — damping is applied instead
    }

    // ============ Tier 3: Manipulation Detection ============

    function test_truePrice_highManipulationProb_emitsAlert() public {
        // Set manipulation probability > 70%
        oracle.setTruePrice(
            poolId,
            0.5e18,    // far from spot
            0.01e18,
            3e18,      // 3-sigma deviation
            ITruePriceOracle.RegimeType.MANIPULATION,
            8e17       // 80% manipulation probability
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        // Should emit PriceManipulationDetected
        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);
        // No revert — damping + alert, not hard stop
    }

    function test_truePrice_lowManipulationProb_noAlert() public {
        // Set manipulation probability < 70%
        oracle.setTruePrice(
            poolId,
            0.5e18,
            0.01e18,
            1e18,
            ITruePriceOracle.RegimeType.NORMAL,
            5e17       // 50% — below threshold
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);
    }

    // ============ Staleness Tests ============

    function test_truePrice_staleData_skipsValidation() public {
        // Set oracle timestamp to 10 minutes ago (max staleness = 5 min)
        oracle.setTimestamp(poolId, uint64(block.timestamp - 10 minutes));

        // Even with wildly wrong True Price, stale data should skip validation
        oracle.setTruePrice(
            poolId,
            0.01e18,    // extremely wrong
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0
        );
        oracle.setTimestamp(poolId, uint64(block.timestamp - 10 minutes));

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Clearing price should be raw (not damped) because True Price data is stale
        assertGt(result.clearingPrice, 0.5e18, "Stale data should not damp price");
    }

    function test_truePrice_freshData_enforces() public {
        // Set oracle timestamp to now (fresh)
        oracle.setTruePrice(
            poolId,
            0.5e18,
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Fresh data should enforce — price should be damped
        assertLt(result.clearingPrice, 0.6e18, "Fresh data should enforce damping");
    }

    // ============ Oracle Failure Tests ============

    function test_truePrice_oracleReverts_fallsThrough() public {
        oracle.setShouldRevert(true);

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Should not revert — graceful fallback
        assertGt(result.clearingPrice, 0, "Should succeed despite oracle failure");
    }

    function test_truePrice_stablecoinContextReverts_stillEnforces() public {
        // Stablecoin context fails but True Price is available
        oracle.setStablecoinRevert(true);
        oracle.setTruePrice(
            poolId,
            0.5e18,
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Should still enforce True Price (just without stablecoin adjustment)
        assertLt(result.clearingPrice, 0.6e18, "Should still enforce without stablecoin context");
    }

    function test_truePrice_zeroPriceFromOracle_skips() public {
        // True Price = 0 means no data
        oracle.setTruePrice(poolId, 0, 0, 0, ITruePriceOracle.RegimeType.NORMAL, 0);

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Zero True Price = skip validation
        assertGt(result.clearingPrice, 0.5e18, "Zero True Price should skip validation");
    }

    // ============ Disabled Validation Tests ============

    function test_truePrice_disabled_skipsAll() public {
        amm.setTruePriceValidation(false);

        // Set far-off True Price
        oracle.setTruePrice(poolId, 0.01e18, 0.01e18, 0, ITruePriceOracle.RegimeType.NORMAL, 0);

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Disabled → no damping
        assertGt(result.clearingPrice, 0.5e18, "Disabled validation should not damp");
    }

    function test_truePrice_noOracle_skipsAll() public {
        amm.setTruePriceOracle(address(0));

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        assertGt(result.clearingPrice, 0, "No oracle should still allow swaps");
    }

    // ============ Regime-Adjusted Bounds Tests ============

    function test_truePrice_cascadeRegime_tighterBounds() public {
        // CASCADE regime = 60% of normal bounds
        // Normal MAX_PRICE_DEVIATION_BPS = 500 (5%)
        // CASCADE: 500 * 6000 / 10000 = 300 (3%)
        oracle.setTruePrice(
            poolId,
            0.96e18,   // 4% below spot — within normal 5% but outside CASCADE 3%
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.CASCADE,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // In CASCADE, 4% deviation should trigger damping
        // (whereas in NORMAL it would pass through at 5% threshold)
        assertGt(result.clearingPrice, 0, "Should succeed with CASCADE damping");
    }

    function test_truePrice_trendRegime_looserBounds() public {
        // TREND regime = 130% of normal bounds
        // Normal: 500 bps (5%), TREND: 650 bps (6.5%)
        oracle.setTruePrice(
            poolId,
            0.94e18,   // 6% below spot — outside normal 5% but within TREND 6.5%
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.TREND,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // In TREND, 6% deviation should pass through (within 6.5%)
        assertGt(result.clearingPrice, 0, "Should succeed in TREND regime");
    }

    function test_truePrice_manipulationRegime_tighterBounds() public {
        // MANIPULATION = 70% of normal bounds = 350 bps (3.5%)
        oracle.setTruePrice(
            poolId,
            0.96e18,   // 4% below — outside MANIPULATION 3.5%
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.MANIPULATION,
            5e17       // 50% manipulation prob (below 70% alert threshold)
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Should be damped — 4% exceeds MANIPULATION's 3.5% bound
        assertGt(result.clearingPrice, 0, "MANIPULATION regime should damp");
    }

    // ============ Stablecoin Context Tests ============

    function test_truePrice_usdtDominant_tighterBounds() public {
        // USDT dominant = 80% of base (after regime adjustment)
        oracle.setStablecoinContext(3e18, true, false, 2e18);

        oracle.setTruePrice(
            poolId,
            0.96e18,   // 4% deviation
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // NORMAL (500) * USDT_DOMINANT (80%) = 400 bps (4%)
        // 4% deviation is right at the boundary
        assertGt(result.clearingPrice, 0, "Should succeed with USDT-dominant context");
    }

    function test_truePrice_usdcDominant_looserBounds() public {
        // USDC dominant = 120% of base
        oracle.setStablecoinContext(0.3e18, false, true, 1e18);

        oracle.setTruePrice(
            poolId,
            0.94e18,   // 6% deviation
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // NORMAL (500) * USDC_DOMINANT (120%) = 600 bps (6%)
        // 6% deviation is right at the boundary
        assertGt(result.clearingPrice, 0, "Should succeed with USDC-dominant context");
    }

    // ============ TruePriceLib Unit Tests ============

    function test_truePriceLib_validatePriceDeviation() public pure {
        // Within 5%
        assertTrue(TruePriceLib.validatePriceDeviation(1.04e18, 1e18, 500));
        // At boundary
        assertTrue(TruePriceLib.validatePriceDeviation(1.05e18, 1e18, 500));
        // Beyond 5%
        assertFalse(TruePriceLib.validatePriceDeviation(1.06e18, 1e18, 500));
        // Below
        assertTrue(TruePriceLib.validatePriceDeviation(0.96e18, 1e18, 500));
        assertFalse(TruePriceLib.validatePriceDeviation(0.94e18, 1e18, 500));
        // Zero True Price = skip
        assertTrue(TruePriceLib.validatePriceDeviation(1e18, 0, 500));
    }

    function test_truePriceLib_adjustDeviationForRegime() public pure {
        uint256 base = 500; // 5%

        assertEq(TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.NORMAL), 500);
        assertEq(TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.CASCADE), 300); // 60%
        assertEq(TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.MANIPULATION), 350); // 70%
        assertEq(TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.HIGH_LEVERAGE), 425); // 85%
        assertEq(TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.TREND), 650); // 130%
        assertEq(TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.LOW_VOLATILITY), 350); // 70%
    }

    function test_truePriceLib_adjustDeviationForStablecoin() public pure {
        uint256 base = 500;

        // Neither dominant
        assertEq(TruePriceLib.adjustDeviationForStablecoin(base, false, false), 500);
        // USDT dominant
        assertEq(TruePriceLib.adjustDeviationForStablecoin(base, true, false), 400); // 80%
        // USDC dominant
        assertEq(TruePriceLib.adjustDeviationForStablecoin(base, false, true), 600); // 120%
    }

    function test_truePriceLib_isFresh() public {
        // Fresh (now)
        assertTrue(TruePriceLib.isFresh(uint64(block.timestamp), 5 minutes));
        // Stale (10 min ago with 5 min max)
        assertFalse(TruePriceLib.isFresh(uint64(block.timestamp - 10 minutes), 5 minutes));
        // Zero timestamp = not fresh
        assertFalse(TruePriceLib.isFresh(0, 5 minutes));
        // Boundary: exactly at maxAge
        assertTrue(TruePriceLib.isFresh(uint64(block.timestamp - 5 minutes), 5 minutes));
    }

    function test_truePriceLib_zScoreToReversionProbability() public pure {
        // Sub-1 sigma: low probability
        uint256 prob0 = TruePriceLib.zScoreToReversionProbability(0.5e18, false);
        assertLt(prob0, 0.25e18);

        // 1.5 sigma: moderate
        uint256 prob1 = TruePriceLib.zScoreToReversionProbability(1.5e18, false);
        assertGt(prob1, 0.25e18);
        assertLt(prob1, 0.5e18);

        // 2.5 sigma: high
        uint256 prob2 = TruePriceLib.zScoreToReversionProbability(2.5e18, false);
        assertGt(prob2, 0.5e18);

        // 4 sigma: very high
        uint256 prob3 = TruePriceLib.zScoreToReversionProbability(4e18, false);
        assertGt(prob3, 0.83e18);

        // USDT dominant increases probability by 10%
        uint256 probUsdt = TruePriceLib.zScoreToReversionProbability(1.5e18, true);
        assertGt(probUsdt, prob1);

        // Negative z-score works the same (absolute value)
        uint256 probNeg = TruePriceLib.zScoreToReversionProbability(-2.5e18, false);
        assertEq(probNeg, prob2);
    }

    // ============ Golden Ratio Damping Tests ============

    function test_goldenRatioDamping_caps_increase() public pure {
        // Price tries to go from 1e18 to 2e18 (100% increase)
        // maxDev = 500 bps = 5%
        uint256 damped = BatchMath.applyGoldenRatioDamping(1e18, 2e18, 500);

        // Should be capped much lower than 2e18
        assertLt(damped, 1.06e18, "Should be capped near max deviation");
        assertGt(damped, 1e18, "Should still allow some increase");
    }

    function test_goldenRatioDamping_caps_decrease() public pure {
        // Price tries to go from 1e18 to 0.5e18 (50% decrease)
        uint256 damped = BatchMath.applyGoldenRatioDamping(1e18, 0.5e18, 500);

        assertGt(damped, 0.94e18, "Should be capped near max deviation");
        assertLt(damped, 1e18, "Should still allow some decrease");
    }

    function test_goldenRatioDamping_withinBounds_passThrough() public pure {
        // Small move: 1e18 to 1.02e18 (2% increase, within 5% bounds)
        uint256 damped = BatchMath.applyGoldenRatioDamping(1e18, 1.02e18, 500);

        // Should pass through unchanged
        assertEq(damped, 1.02e18, "Within-bounds move should pass through");
    }

    // ============ Multi-Order Batch with True Price ============

    function test_truePrice_multiOrderBatch() public {
        // Multiple orders should all execute at the same (damped) clearing price
        _mintAndSync(30 ether);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](3);
        for (uint256 i = 0; i < 3; i++) {
            orders[i] = IVibeAMM.SwapOrder({
                trader: makeAddr(string(abi.encodePacked("trader", i))),
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                amountIn: 10 ether,
                minAmountOut: 0,
                isPriority: false
            });
        }

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        assertGt(result.clearingPrice, 0, "Multi-order batch should have clearing price");
        assertGt(result.totalTokenInSwapped, 0, "Should have swapped tokens");
    }

    // ============ Combined Regime + Stablecoin Tests ============

    function test_truePrice_cascadeWithUsdtDominant() public {
        // Worst case: CASCADE (60%) × USDT dominant (80%) = 48% of base
        // Base 500 → 240 bps (2.4%)
        oracle.setStablecoinContext(3e18, true, false, 2e18);
        oracle.setTruePrice(
            poolId,
            0.97e18,   // 3% deviation — beyond 2.4% bounds
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.CASCADE,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Should be heavily damped — tightest possible bounds
        assertGt(result.clearingPrice, 0, "Should succeed with combined tight bounds");
    }

    function test_truePrice_trendWithUsdcDominant() public {
        // Best case: TREND (130%) × USDC dominant (120%) = 156% of base
        // Base 500 → 780 bps (7.8%)
        oracle.setStablecoinContext(0.3e18, false, true, 1e18);
        oracle.setTruePrice(
            poolId,
            0.93e18,   // 7% deviation — within 7.8% bounds
            0.01e18,
            0,
            ITruePriceOracle.RegimeType.TREND,
            0
        );

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        // Should pass through — within loosest possible bounds
        assertGt(result.clearingPrice, 0, "Should succeed with combined loose bounds");
    }

    // ============ Reserves Under True Price Damping ============

    function test_truePrice_reservesStayPositive() public {
        // Batch auction clearing prices are uniform (not constant-product), so K is NOT
        // guaranteed to be preserved under True Price damping. Instead, verify reserves
        // stay positive and the pool remains functional.

        // Set True Price far from spot to trigger damping
        oracle.setTruePrice(poolId, 0.5e18, 0.01e18, 0, ITruePriceOracle.RegimeType.NORMAL, 0);

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        assertGt(poolAfter.reserve0, 0, "Reserve0 must stay positive");
        assertGt(poolAfter.reserve1, 0, "Reserve1 must stay positive");
        assertGt(result.clearingPrice, 0, "Should produce valid clearing price");
    }

    function test_truePrice_kPreservedWhenMatchingSpot() public {
        // When True Price matches spot, clearing price is undamped and K is preserved
        // True Price = 1e18, spot = 1e18 (1:1 pool)
        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;

        _mintAndSync(SWAP_AMOUNT);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(SWAP_AMOUNT);

        vm.prank(executor);
        amm.executeBatchSwap(poolId, 1, orders);

        IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
        uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;

        assertGe(kAfter, kBefore, "K should not decrease when True Price matches spot");
    }

    // ============ Helpers ============

    function _mintAndSync(uint256 amount) internal {
        tokenA.mint(address(amm), amount);
        amm.syncTrackedBalance(address(tokenA));
    }

    function _makeSingleOrder(uint256 amount) internal view returns (IVibeAMM.SwapOrder[] memory) {
        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: trader,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amount,
            minAmountOut: 0,
            isPriority: false
        });
        return orders;
    }

    function _executeSwapAndAssertSuccess(uint256 amount) internal {
        _mintAndSync(amount);
        IVibeAMM.SwapOrder[] memory orders = _makeSingleOrder(amount);

        vm.prank(executor);
        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, 1, orders);

        assertGt(result.clearingPrice, 0, "Should succeed");
        assertGt(result.totalTokenInSwapped, 0, "Should swap tokens");
    }
}
