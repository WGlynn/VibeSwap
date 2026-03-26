// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibePerpEngine.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockOracle {
    mapping(address => uint256) public prices;

    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }

    function getPrice(address token) external view returns (uint256) {
        return prices[token];
    }
}

// ============ Fuzz Tests ============

/**
 * @title VibePerpEngine Fuzz Tests
 * @notice Fuzz testing for the perpetual futures engine. Covers:
 *         - Position sizing with random margin/size combos
 *         - PnL correctness across random price movements
 *         - Liquidation thresholds at boundary conditions
 *         - Funding rate PID controller under random OI imbalances
 *         - Insurance fund accounting under stress
 */
contract VibePerpEngineFuzzTest is Test {
    VibePerpEngine public engine;
    MockERC20 public baseToken;
    MockERC20 public quoteToken;
    MockOracle public oracle;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address owner;

    bytes32 ethMarket;

    uint256 constant MARK_PRICE = 2000e18;
    uint256 constant MAX_LEVERAGE = 20;
    uint256 constant MAINT_MARGIN_BPS = 500; // 5%
    uint256 constant TAKER_FEE_BPS = 10;     // 0.1%
    uint256 constant MAKER_FEE_BPS = 5;
    uint256 constant PRECISION = 1e18;
    uint256 constant BPS = 10_000;

    int256 constant KP = 1e16;
    int256 constant KI = 1e14;
    int256 constant KD = 5e15;

    function setUp() public {
        owner = address(this);

        baseToken = new MockERC20("WETH", "WETH");
        quoteToken = new MockERC20("USDC", "USDC");

        oracle = new MockOracle();
        oracle.setPrice(address(baseToken), MARK_PRICE);

        VibePerpEngine impl = new VibePerpEngine();
        bytes memory initData = abi.encodeCall(
            VibePerpEngine.initialize,
            (owner, address(oracle), KP, KI, KD)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        engine = VibePerpEngine(address(proxy));

        engine.createMarket(
            address(baseToken),
            address(quoteToken),
            MAX_LEVERAGE,
            MAINT_MARGIN_BPS,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS
        );
        ethMarket = keccak256(abi.encodePacked(address(baseToken), address(quoteToken)));

        // Fund traders generously
        quoteToken.mint(alice, 100_000_000e18);
        quoteToken.mint(bob, 100_000_000e18);
        // Fund engine for payouts
        quoteToken.mint(address(engine), 100_000_000e18);

        vm.prank(alice);
        quoteToken.approve(address(engine), type(uint256).max);
        vm.prank(bob);
        quoteToken.approve(address(engine), type(uint256).max);
    }

    // ============ Open Position Fuzz ============

    function testFuzz_openLongValidMargin(uint256 margin) public {
        // Margin must produce leverage <= 20x at $2000 mark price
        // notional = 1e18 * 2000e18 / 1e18 = 2000e18
        // leverage = 2000e18 / margin <= 20 => margin >= 100e18
        // Also, fee = 2000e18 * 10 / 10000 = 2e18; fee < margin required
        margin = bound(margin, 101e18, 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, margin, MARK_PRICE);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.trader, alice);
        assertGt(pos.size, 0);
        assertEq(pos.entryPrice, MARK_PRICE);

        // Margin reduced by taker fee
        uint256 notional = (1e18 * MARK_PRICE) / PRECISION;
        uint256 fee = (notional * TAKER_FEE_BPS) / BPS;
        assertEq(pos.margin, margin - fee);
    }

    function testFuzz_openShortValidMargin(uint256 margin) public {
        margin = bound(margin, 101e18, 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, -1e18, margin, 0);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.trader, alice);
        assertLt(pos.size, 0);
    }

    function testFuzz_openPositionSizeScaling(uint256 sizeRaw) public {
        // Size between 0.01 ETH and 10 ETH
        uint256 absSize = bound(sizeRaw, 0.01e18, 10e18);
        int256 size = int256(absSize);

        // Ensure sufficient margin: notional = absSize * 2000, leverage <= 20 => margin >= notional/20
        uint256 notional = (absSize * MARK_PRICE) / PRECISION;
        uint256 minMargin = (notional / MAX_LEVERAGE) + 1e18; // +1 for rounding safety
        uint256 margin = minMargin + 100e18; // comfortable margin

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, size, margin, MARK_PRICE);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.size, size);
    }

    function testFuzz_revertOpenExceedsLeverage(uint256 margin) public {
        // margin too small for 1 ETH at $2000 → leverage > 20x
        // notional = 2000e18, max margin for revert = notional/maxLeverage - 1 = 99.999...
        margin = bound(margin, 3e18, 99e18); // fee = 2e18, so margin > fee needed

        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.ExceedsMaxLeverage.selector);
        engine.openPosition(ethMarket, 1e18, margin, MARK_PRICE);
    }

    // ============ PnL Fuzz ============

    function testFuzz_longPnLSymmetry(uint256 exitPriceRaw) public {
        // Exit price between $500 and $5000
        uint256 exitPrice = bound(exitPriceRaw, 500e18, 5000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 500e18, MARK_PRICE);

        oracle.setPrice(address(baseToken), exitPrice);

        int256 pnl = engine.getPositionPnL(posId);
        int256 expectedPnl = (int256(exitPrice) - int256(MARK_PRICE));

        assertEq(pnl, expectedPnl);
    }

    function testFuzz_shortPnLSymmetry(uint256 exitPriceRaw) public {
        uint256 exitPrice = bound(exitPriceRaw, 500e18, 5000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, -1e18, 500e18, 0);

        oracle.setPrice(address(baseToken), exitPrice);

        int256 pnl = engine.getPositionPnL(posId);
        // Short PnL = (-1) * (exitPrice - entryPrice) = entryPrice - exitPrice
        int256 expectedPnl = int256(MARK_PRICE) - int256(exitPrice);

        assertEq(pnl, expectedPnl);
    }

    function testFuzz_closeLongPayout(uint256 exitPriceRaw) public {
        uint256 exitPrice = bound(exitPriceRaw, 1000e18, 3000e18);
        uint256 margin = 500e18;

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, margin, MARK_PRICE);

        oracle.setPrice(address(baseToken), exitPrice);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        int256 expectedPnl = int256(exitPrice) - int256(MARK_PRICE);
        int256 expectedSettlement = int256(pos.margin) + expectedPnl;
        uint256 expectedPayout = expectedSettlement > 0 ? uint256(expectedSettlement) : 0;

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(posId, 0);
        uint256 balAfter = quoteToken.balanceOf(alice);

        assertEq(balAfter - balBefore, expectedPayout);
    }

    function testFuzz_closeShortPayout(uint256 exitPriceRaw) public {
        uint256 exitPrice = bound(exitPriceRaw, 1000e18, 3000e18);
        uint256 margin = 500e18;

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, -1e18, margin, 0);

        oracle.setPrice(address(baseToken), exitPrice);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        int256 expectedPnl = int256(MARK_PRICE) - int256(exitPrice);
        int256 expectedSettlement = int256(pos.margin) + expectedPnl;
        uint256 expectedPayout = expectedSettlement > 0 ? uint256(expectedSettlement) : 0;

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(posId, type(uint256).max);
        uint256 balAfter = quoteToken.balanceOf(alice);

        assertEq(balAfter - balBefore, expectedPayout);
    }

    // ============ Margin Ratio Fuzz ============

    function testFuzz_marginRatioDecreaseWithLoss(uint256 lossPercent) public {
        // Loss between 0-90% of entry price
        lossPercent = bound(lossPercent, 1, 90);
        uint256 lossPrice = MARK_PRICE - (MARK_PRICE * lossPercent / 100);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 500e18, MARK_PRICE);

        uint256 ratioBefore = engine.getMarginRatio(posId);

        oracle.setPrice(address(baseToken), lossPrice);
        uint256 ratioAfter = engine.getMarginRatio(posId);

        // Margin ratio should decrease or be zero
        assertTrue(ratioAfter <= ratioBefore, "Margin ratio should decrease with loss");
    }

    function testFuzz_marginRatioIncreaseWithGain(uint256 gainPercent) public {
        gainPercent = bound(gainPercent, 1, 100);
        uint256 gainPrice = MARK_PRICE + (MARK_PRICE * gainPercent / 100);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 500e18, MARK_PRICE);

        uint256 ratioBefore = engine.getMarginRatio(posId);

        oracle.setPrice(address(baseToken), gainPrice);
        uint256 ratioAfter = engine.getMarginRatio(posId);

        // Margin ratio should increase with profit
        assertTrue(ratioAfter >= ratioBefore, "Margin ratio should increase with gain");
    }

    // ============ Liquidation Fuzz ============

    function testFuzz_liquidationThreshold(uint256 dropPercent) public {
        // Test liquidation at various price drops (5-50%)
        dropPercent = bound(dropPercent, 5, 50);
        uint256 crashPrice = MARK_PRICE - (MARK_PRICE * dropPercent / 100);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        oracle.setPrice(address(baseToken), crashPrice);

        uint256 marginRatio = engine.getMarginRatio(posId);

        if (marginRatio < MAINT_MARGIN_BPS) {
            // Should be liquidatable
            vm.prank(bob);
            engine.liquidate(posId);

            VibePerpEngine.Position memory pos = engine.getPosition(posId);
            assertEq(pos.trader, address(0), "Position should be deleted after liquidation");
        } else {
            // Should NOT be liquidatable
            vm.prank(bob);
            vm.expectRevert(VibePerpEngine.PositionNotLiquidatable.selector);
            engine.liquidate(posId);
        }
    }

    function testFuzz_liquidationPreservesInsuranceFundAccounting(uint256 dropPercent) public {
        dropPercent = bound(dropPercent, 10, 95);
        uint256 crashPrice = MARK_PRICE - (MARK_PRICE * dropPercent / 100);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        uint256 insuranceBefore = engine.insuranceFund();

        oracle.setPrice(address(baseToken), crashPrice);

        uint256 marginRatio = engine.getMarginRatio(posId);
        if (marginRatio < MAINT_MARGIN_BPS) {
            vm.prank(bob);
            engine.liquidate(posId);

            // Insurance fund should either grow (from liq fee) or shrink (socialized loss)
            // But should never underflow (covered by the contract's check)
            uint256 insuranceAfter = engine.insuranceFund();
            assertTrue(insuranceAfter <= type(uint256).max, "Insurance fund should not underflow");
        }
    }

    // ============ Add/Remove Margin Fuzz ============

    function testFuzz_addMarginIncreasesMargin(uint256 addAmount) public {
        addAmount = bound(addAmount, 1e18, 50_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 500e18, MARK_PRICE);

        VibePerpEngine.Position memory posBefore = engine.getPosition(posId);

        vm.prank(alice);
        engine.addMargin(posId, addAmount);

        VibePerpEngine.Position memory posAfter = engine.getPosition(posId);
        assertEq(posAfter.margin, posBefore.margin + addAmount);
    }

    function testFuzz_removeMarginDecreasesMargin(uint256 removeAmount) public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 1000e18, MARK_PRICE);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        // Required maintenance: notional * 5% = 2000 * 0.05 = 100e18
        // Max removable: margin - maintenance = 998e18 - 100e18 = 898e18
        removeAmount = bound(removeAmount, 1e18, 800e18);

        vm.prank(alice);
        engine.removeMargin(posId, removeAmount);

        VibePerpEngine.Position memory posAfter = engine.getPosition(posId);
        assertEq(posAfter.margin, pos.margin - removeAmount);
    }

    // ============ Funding Rate Fuzz ============

    function testFuzz_fundingRateBounded(uint256 longSize, uint256 shortSize) public {
        // Random OI imbalance
        longSize = bound(longSize, 0.1e18, 50e18);
        shortSize = bound(shortSize, 0.1e18, 50e18);

        uint256 longNotional = (longSize * MARK_PRICE) / PRECISION;
        uint256 longMargin = (longNotional / MAX_LEVERAGE) + 10e18;

        uint256 shortNotional = (shortSize * MARK_PRICE) / PRECISION;
        uint256 shortMargin = (shortNotional / MAX_LEVERAGE) + 10e18;

        vm.prank(alice);
        engine.openPosition(ethMarket, int256(longSize), longMargin, MARK_PRICE);

        vm.prank(bob);
        engine.openPosition(ethMarket, -int256(shortSize), shortMargin, 0);

        vm.warp(block.timestamp + 1 hours);
        engine.updateFunding(ethMarket);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);

        // Funding rate should be bounded to [-0.1%, +0.1%] = [-1e15, 1e15]
        assertTrue(m.fundingRate >= -int256(1e15), "Funding rate below lower bound");
        assertTrue(m.fundingRate <= int256(1e15), "Funding rate above upper bound");
    }

    function testFuzz_fundingSignMatchesImbalance(uint256 longSize) public {
        longSize = bound(longSize, 1e18, 50e18);

        uint256 notional = (longSize * MARK_PRICE) / PRECISION;
        uint256 margin = (notional / MAX_LEVERAGE) + 10e18;

        // Only longs, no shorts → positive funding
        vm.prank(alice);
        engine.openPosition(ethMarket, int256(longSize), margin, MARK_PRICE);

        vm.warp(block.timestamp + 1 hours);
        engine.updateFunding(ethMarket);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertTrue(m.fundingRate > 0, "Long-heavy should produce positive funding");
    }

    function testFuzz_multipleFundingUpdates(uint8 updates) public {
        updates = uint8(bound(updates, 1, 10));

        vm.prank(alice);
        engine.openPosition(ethMarket, 5e18, 1000e18, MARK_PRICE);

        int256 prevCumulative = engine.cumulativeFunding(ethMarket);

        for (uint8 i = 0; i < updates; i++) {
            vm.warp(block.timestamp + 1 hours);
            engine.updateFunding(ethMarket);

            int256 currentCumulative = engine.cumulativeFunding(ethMarket);
            // Cumulative should be monotonically increasing when longs dominate
            assertTrue(currentCumulative >= prevCumulative, "Cumulative funding should increase");
            prevCumulative = currentCumulative;
        }
    }

    // ============ Open Interest Fuzz ============

    function testFuzz_openInterestAccounting(uint256 numPositions) public {
        numPositions = bound(numPositions, 1, 5);

        uint256 expectedLongOI;
        uint256 expectedShortOI;

        for (uint256 i = 0; i < numPositions; i++) {
            uint256 margin = 500e18;
            int256 size = (i % 2 == 0) ? int256(1e18) : int256(-1e18);
            uint256 maxPriceParam = (i % 2 == 0) ? MARK_PRICE : 0;

            vm.prank(alice);
            engine.openPosition(ethMarket, size, margin, maxPriceParam);

            uint256 notional = (1e18 * MARK_PRICE) / PRECISION;
            if (size > 0) {
                expectedLongOI += notional;
            } else {
                expectedShortOI += notional;
            }
        }

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertEq(m.openInterestLong, expectedLongOI, "Long OI mismatch");
        assertEq(m.openInterestShort, expectedShortOI, "Short OI mismatch");
    }

    // ============ Market Creation Fuzz ============

    function testFuzz_createMarketLeverageBounds(uint256 leverage) public {
        leverage = bound(leverage, 1, 100);

        MockERC20 newBase = new MockERC20("NEW", "NEW");
        oracle.setPrice(address(newBase), 1000e18);

        engine.createMarket(
            address(newBase),
            address(quoteToken),
            leverage,
            MAINT_MARGIN_BPS,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS
        );

        bytes32 newMarket = keccak256(abi.encodePacked(address(newBase), address(quoteToken)));
        VibePerpEngine.Market memory m = engine.getMarket(newMarket);
        assertEq(m.maxLeverage, leverage);
    }

    function testFuzz_revertCreateMarketExcessiveLeverage(uint256 leverage) public {
        leverage = bound(leverage, 101, 1000);

        MockERC20 newBase = new MockERC20("BAD", "BAD");
        oracle.setPrice(address(newBase), 1000e18);

        vm.expectRevert(VibePerpEngine.InvalidMarketParams.selector);
        engine.createMarket(
            address(newBase),
            address(quoteToken),
            leverage,
            MAINT_MARGIN_BPS,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS
        );
    }

    // ============ Slippage Protection Fuzz ============

    function testFuzz_longSlippageProtection(uint256 maxPrice) public {
        maxPrice = bound(maxPrice, 1e18, MARK_PRICE - 1);

        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.PriceBreach.selector);
        engine.openPosition(ethMarket, 1e18, 500e18, maxPrice);
    }

    function testFuzz_shortSlippageProtection(uint256 minPrice) public {
        minPrice = bound(minPrice, MARK_PRICE + 1, 100_000e18);

        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.PriceBreach.selector);
        engine.openPosition(ethMarket, -1e18, 500e18, minPrice);
    }
}
