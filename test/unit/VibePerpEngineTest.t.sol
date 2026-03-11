// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibePerpEngine.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

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

// ============ Tests ============

contract VibePerpEngineTest is Test {
    VibePerpEngine public engine;
    MockERC20 public baseToken;
    MockERC20 public quoteToken;
    MockOracle public oracle;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address liquidator = address(0xCC);
    address owner;

    bytes32 ethMarket;

    uint256 constant MARK_PRICE = 2000e18;
    uint256 constant MAX_LEVERAGE = 20;
    uint256 constant MAINT_MARGIN_BPS = 500; // 5%
    uint256 constant TAKER_FEE_BPS = 10; // 0.1%
    uint256 constant MAKER_FEE_BPS = 5;  // 0.05%

    // PID gains
    int256 constant KP = 1e16;  // 0.01
    int256 constant KI = 1e14;  // 0.0001
    int256 constant KD = 5e15;  // 0.005

    function setUp() public {
        owner = address(this);

        // Deploy tokens
        baseToken = new MockERC20("Wrapped ETH", "WETH");
        quoteToken = new MockERC20("USD Coin", "USDC");

        // Deploy oracle
        oracle = new MockOracle();
        oracle.setPrice(address(baseToken), MARK_PRICE);

        // Deploy engine via proxy
        VibePerpEngine impl = new VibePerpEngine();
        bytes memory initData = abi.encodeCall(
            VibePerpEngine.initialize,
            (owner, address(oracle), KP, KI, KD)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        engine = VibePerpEngine(address(proxy));

        // Create ETH/USD market
        engine.createMarket(
            address(baseToken),
            address(quoteToken),
            MAX_LEVERAGE,
            MAINT_MARGIN_BPS,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS
        );
        ethMarket = keccak256(abi.encodePacked(address(baseToken), address(quoteToken)));

        // Fund traders with quote tokens for margin
        quoteToken.mint(alice, 100_000e18);
        quoteToken.mint(bob, 100_000e18);
        quoteToken.mint(liquidator, 10_000e18);

        // Approve engine
        vm.prank(alice);
        quoteToken.approve(address(engine), type(uint256).max);
        vm.prank(bob);
        quoteToken.approve(address(engine), type(uint256).max);
        vm.prank(liquidator);
        quoteToken.approve(address(engine), type(uint256).max);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(engine.priceOracle(), address(oracle));
        assertEq(engine.pidKp(), KP);
        assertEq(engine.pidKi(), KI);
        assertEq(engine.pidKd(), KD);
        assertEq(engine.getMarketCount(), 1);
    }

    function test_revertReinitialize() public {
        vm.expectRevert();
        engine.initialize(owner, address(oracle), KP, KI, KD);
    }

    function test_revertInitZeroOracle() public {
        VibePerpEngine impl2 = new VibePerpEngine();
        vm.expectRevert(VibePerpEngine.InvalidOracle.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(VibePerpEngine.initialize, (owner, address(0), KP, KI, KD))
        );
    }

    // ============ Market Creation ============

    function test_createMarket() public view {
        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertEq(m.baseAsset, address(baseToken));
        assertEq(m.quoteAsset, address(quoteToken));
        assertEq(m.maxLeverage, MAX_LEVERAGE);
        assertEq(m.maintenanceMargin, MAINT_MARGIN_BPS);
        assertEq(m.takerFee, TAKER_FEE_BPS);
        assertEq(m.makerFee, MAKER_FEE_BPS);
        assertTrue(m.active);
    }

    function test_revertCreateDuplicateMarket() public {
        vm.expectRevert(VibePerpEngine.MarketAlreadyExists.selector);
        engine.createMarket(
            address(baseToken), address(quoteToken),
            MAX_LEVERAGE, MAINT_MARGIN_BPS, TAKER_FEE_BPS, MAKER_FEE_BPS
        );
    }

    function test_revertCreateZeroAddress() public {
        vm.expectRevert(VibePerpEngine.InvalidMarketParams.selector);
        engine.createMarket(
            address(0), address(quoteToken),
            MAX_LEVERAGE, MAINT_MARGIN_BPS, TAKER_FEE_BPS, MAKER_FEE_BPS
        );
    }

    function test_revertCreateZeroLeverage() public {
        MockERC20 newBase = new MockERC20("BTC", "BTC");
        vm.expectRevert(VibePerpEngine.InvalidMarketParams.selector);
        engine.createMarket(
            address(newBase), address(quoteToken),
            0, MAINT_MARGIN_BPS, TAKER_FEE_BPS, MAKER_FEE_BPS
        );
    }

    function test_revertCreateExcessiveLeverage() public {
        MockERC20 newBase = new MockERC20("BTC", "BTC");
        vm.expectRevert(VibePerpEngine.InvalidMarketParams.selector);
        engine.createMarket(
            address(newBase), address(quoteToken),
            101, MAINT_MARGIN_BPS, TAKER_FEE_BPS, MAKER_FEE_BPS
        );
    }

    function test_revertCreateZeroMaintMargin() public {
        MockERC20 newBase = new MockERC20("BTC", "BTC");
        vm.expectRevert(VibePerpEngine.InvalidMarketParams.selector);
        engine.createMarket(
            address(newBase), address(quoteToken),
            MAX_LEVERAGE, 0, TAKER_FEE_BPS, MAKER_FEE_BPS
        );
    }

    function test_revertCreateMaintMarginExceedsBPS() public {
        MockERC20 newBase = new MockERC20("BTC", "BTC");
        vm.expectRevert(VibePerpEngine.InvalidMarketParams.selector);
        engine.createMarket(
            address(newBase), address(quoteToken),
            MAX_LEVERAGE, 10_000, TAKER_FEE_BPS, MAKER_FEE_BPS
        );
    }

    function test_revertCreateNotOwner() public {
        MockERC20 newBase = new MockERC20("BTC", "BTC");
        vm.prank(alice);
        vm.expectRevert();
        engine.createMarket(
            address(newBase), address(quoteToken),
            MAX_LEVERAGE, MAINT_MARGIN_BPS, TAKER_FEE_BPS, MAKER_FEE_BPS
        );
    }

    function test_createMultipleMarkets() public {
        MockERC20 btc = new MockERC20("BTC", "BTC");
        oracle.setPrice(address(btc), 60000e18);
        engine.createMarket(
            address(btc), address(quoteToken),
            MAX_LEVERAGE, MAINT_MARGIN_BPS, TAKER_FEE_BPS, MAKER_FEE_BPS
        );
        assertEq(engine.getMarketCount(), 2);
    }

    // ============ Market Admin ============

    function test_setMarketActive() public {
        engine.setMarketActive(ethMarket, false);
        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertFalse(m.active);

        engine.setMarketActive(ethMarket, true);
        m = engine.getMarket(ethMarket);
        assertTrue(m.active);
    }

    function test_revertSetMarketActiveNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.setMarketActive(ethMarket, false);
    }

    function test_setPIDGains() public {
        int256 newKp = 2e16;
        int256 newKi = 2e14;
        int256 newKd = 1e16;
        engine.setPIDGains(newKp, newKi, newKd);
        assertEq(engine.pidKp(), newKp);
        assertEq(engine.pidKi(), newKi);
        assertEq(engine.pidKd(), newKd);
    }

    function test_setOracle() public {
        MockOracle newOracle = new MockOracle();
        engine.setOracle(address(newOracle));
        assertEq(engine.priceOracle(), address(newOracle));
    }

    function test_revertSetOracleZero() public {
        vm.expectRevert(VibePerpEngine.InvalidOracle.selector);
        engine.setOracle(address(0));
    }

    function test_setAcceptedCollateral() public {
        engine.setAcceptedCollateral(address(quoteToken), true);
        assertTrue(engine.acceptedCollateral(address(quoteToken)));
    }

    // ============ Open Position ============

    function test_openLong() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.trader, alice);
        assertGt(pos.size, 0);
        assertEq(pos.entryPrice, MARK_PRICE);
        assertGt(pos.margin, 0); // margin minus fee
        assertEq(pos.marketId, ethMarket);
    }

    function test_openShort() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, -1e18, 200e18, 0);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertLt(pos.size, 0);
        assertEq(pos.entryPrice, MARK_PRICE);
    }

    function test_openPositionDeductsMargin() public {
        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
        assertEq(quoteToken.balanceOf(alice), balBefore - 200e18);
    }

    function test_openPositionIncrementsId() public {
        vm.prank(alice);
        uint256 id1 = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
        vm.prank(alice);
        uint256 id2 = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
        assertEq(id2, id1 + 1);
    }

    function test_openPositionUpdatesOI() public {
        vm.prank(alice);
        engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        // notional = 1e18 * 2000e18 / 1e18 = 2000e18
        assertEq(m.openInterestLong, 2000e18);
        assertEq(m.openInterestShort, 0);
    }

    function test_openShortUpdatesOI() public {
        vm.prank(alice);
        engine.openPosition(ethMarket, -2e18, 400e18, 0);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertEq(m.openInterestShort, 4000e18);
        assertEq(m.openInterestLong, 0);
    }

    function test_takerFeeChargedOnOpen() public {
        uint256 insuranceBefore = engine.insuranceFund();
        vm.prank(alice);
        engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // notional = 2000e18, fee = 2000e18 * 10 / 10000 = 2e18
        assertEq(engine.insuranceFund(), insuranceBefore + 2e18);
    }

    function test_marginReducedByFee() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        // margin = 200 - 2 (fee) = 198
        assertEq(pos.margin, 198e18);
    }

    function test_traderPositionsTracked() public {
        vm.prank(alice);
        engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
        vm.prank(alice);
        engine.openPosition(ethMarket, -1e18, 200e18, 0);

        uint256[] memory posIds = engine.getTraderPositions(alice);
        assertEq(posIds.length, 2);
    }

    function test_revertOpenZeroSize() public {
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.ZeroSize.selector);
        engine.openPosition(ethMarket, 0, 200e18, MARK_PRICE);
    }

    function test_revertOpenZeroMargin() public {
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.ZeroAmount.selector);
        engine.openPosition(ethMarket, 1e18, 0, MARK_PRICE);
    }

    function test_revertOpenInactiveMarket() public {
        engine.setMarketActive(ethMarket, false);
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.MarketNotActive.selector);
        engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
    }

    function test_revertOpenExceedsMaxLeverage() public {
        // 1 ETH at $2000 = $2000 notional, margin = $10 → leverage = 200x > 20x
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.ExceedsMaxLeverage.selector);
        engine.openPosition(ethMarket, 1e18, 10e18, MARK_PRICE);
    }

    function test_revertLongSlippage() public {
        // maxPrice = 1999, mark = 2000 → PriceBreach
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.PriceBreach.selector);
        engine.openPosition(ethMarket, 1e18, 200e18, 1999e18);
    }

    function test_revertShortSlippage() public {
        // For short, maxPrice acts as minimum: minPrice = 2001, mark = 2000 → PriceBreach
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.PriceBreach.selector);
        engine.openPosition(ethMarket, -1e18, 200e18, 2001e18);
    }

    // ============ Close Position ============

    function test_closeLongBreakEven() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(posId, 0);

        // Should get margin back (minus fee from open, PnL=0)
        uint256 balAfter = quoteToken.balanceOf(alice);
        assertEq(balAfter - balBefore, 198e18); // margin was 198 after fee
    }

    function test_closeLongWithProfit() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Price goes up to 2200
        oracle.setPrice(address(baseToken), 2200e18);

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(posId, 0);

        // PnL = 1e18 * (2200 - 2000) / 1e18 = 200e18
        // Payout = margin(198) + pnl(200) = 398
        uint256 balAfter = quoteToken.balanceOf(alice);
        assertEq(balAfter - balBefore, 398e18);
    }

    function test_closeLongWithLoss() public {
        // Fund the engine so it can pay out (it needs tokens for other positions)
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Price goes down to 1900
        oracle.setPrice(address(baseToken), 1900e18);

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(posId, 0);

        // PnL = 1e18 * (1900 - 2000) / 1e18 = -100e18
        // Payout = margin(198) + pnl(-100) = 98
        uint256 balAfter = quoteToken.balanceOf(alice);
        assertEq(balAfter - balBefore, 98e18);
    }

    function test_closeShortWithProfit() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, -1e18, 200e18, 0);

        // Price goes down to 1800 → profit for short
        oracle.setPrice(address(baseToken), 1800e18);

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(posId, type(uint256).max);

        // PnL = (-1e18) * (1800 - 2000) / 1e18 = (-1) * (-200) = 200e18
        // Payout = margin(198) + pnl(200) = 398
        uint256 balAfter = quoteToken.balanceOf(alice);
        assertEq(balAfter - balBefore, 398e18);
    }

    function test_closeShortWithLoss() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, -1e18, 200e18, 0);

        // Price goes up to 2100 → loss for short
        oracle.setPrice(address(baseToken), 2100e18);

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(posId, type(uint256).max);

        // PnL = (-1e18) * (2100 - 2000) / 1e18 = -100e18
        // Payout = margin(198) + pnl(-100) = 98
        uint256 balAfter = quoteToken.balanceOf(alice);
        assertEq(balAfter - balBefore, 98e18);
    }

    function test_closeLossCappedAtMargin() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Price crashes to 1000 → loss > margin
        oracle.setPrice(address(baseToken), 1000e18);

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(posId, 0);

        // PnL = -1000, margin = 198, settlement = -802 → payout = 0
        uint256 balAfter = quoteToken.balanceOf(alice);
        assertEq(balAfter, balBefore); // gets nothing back
    }

    function test_closeRemovesPosition() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(alice);
        engine.closePosition(posId, 0);

        // Position should be deleted
        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.trader, address(0));

        // Removed from trader tracking
        uint256[] memory posIds = engine.getTraderPositions(alice);
        assertEq(posIds.length, 0);
    }

    function test_closeReducesOI() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(alice);
        engine.closePosition(posId, 0);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertEq(m.openInterestLong, 0);
    }

    function test_revertCloseNotOwner() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(bob);
        vm.expectRevert(VibePerpEngine.NotPositionOwner.selector);
        engine.closePosition(posId, 0);
    }

    function test_revertCloseNonexistent() public {
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.PositionNotFound.selector);
        engine.closePosition(999, 0);
    }

    function test_revertCloseLongSlippage() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // minPrice = 2001, mark = 2000 → PriceBreach
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.PriceBreach.selector);
        engine.closePosition(posId, 2001e18);
    }

    function test_revertCloseShortSlippage() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, -1e18, 200e18, 0);

        // For short close, minPrice acts as maxPrice: minPrice = 1999, mark = 2000 → PriceBreach
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.PriceBreach.selector);
        engine.closePosition(posId, 1999e18);
    }

    // ============ Add/Remove Margin ============

    function test_addMargin() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(alice);
        engine.addMargin(posId, 50e18);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.margin, 248e18); // 198 (after fee) + 50
    }

    function test_revertAddMarginNotOwner() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(bob);
        vm.expectRevert(VibePerpEngine.NotPositionOwner.selector);
        engine.addMargin(posId, 50e18);
    }

    function test_revertAddMarginZero() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.ZeroAmount.selector);
        engine.addMargin(posId, 0);
    }

    function test_removeMargin() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        uint256 balBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.removeMargin(posId, 10e18);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.margin, 188e18); // 198 - 10
        assertEq(quoteToken.balanceOf(alice), balBefore + 10e18);
    }

    function test_revertRemoveMarginTooMuch() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Try to remove more than margin
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.InsufficientMargin.selector);
        engine.removeMargin(posId, 300e18);
    }

    function test_revertRemoveMarginBreaksMaintenance() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // margin = 198, notional = 2000, required = 2000 * 500/10000 = 100
        // Remove 100 → new margin = 98 < 100 → revert
        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.InsufficientMargin.selector);
        engine.removeMargin(posId, 100e18);
    }

    function test_revertRemoveMarginNotOwner() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(bob);
        vm.expectRevert(VibePerpEngine.NotPositionOwner.selector);
        engine.removeMargin(posId, 10e18);
    }

    function test_revertRemoveMarginZero() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(alice);
        vm.expectRevert(VibePerpEngine.ZeroAmount.selector);
        engine.removeMargin(posId, 0);
    }

    // ============ Liquidation ============

    function test_liquidateUnderwaterLong() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Crash price so margin ratio < maintenance (5%)
        // margin=198, maint required = notional*5% = absSize*mark*5%
        // Need: (198 + pnl) / notional < 5%
        // At price 1810: pnl = -190, effective margin = 8, notional = 1810
        // margin ratio = 8/1810 * 10000 = 44 bps < 500 → liquidatable
        oracle.setPrice(address(baseToken), 1810e18);

        vm.prank(liquidator);
        engine.liquidate(posId);

        // Position should be deleted
        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.trader, address(0));
    }

    function test_liquidateUnderwaterShort() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, -1e18, 200e18, 0);

        // Price spike so short loses: margin = 198, need margin ratio < 5%
        // At price 2190: pnl = (-1)*(2190-2000) = -190, effective = 8, notional = 2190
        // ratio = 8/2190 * 10000 = 36 bps < 500 → liquidatable
        oracle.setPrice(address(baseToken), 2190e18);

        vm.prank(liquidator);
        engine.liquidate(posId);

        VibePerpEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.trader, address(0));
    }

    function test_liquidationFeeToInsuranceFund() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
        uint256 insuranceBefore = engine.insuranceFund();

        // Minor underwater: price to 1810 → small remaining margin
        oracle.setPrice(address(baseToken), 1810e18);

        vm.prank(liquidator);
        engine.liquidate(posId);

        assertGt(engine.insuranceFund(), insuranceBefore);
    }

    function test_revertLiquidateHealthy() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        vm.prank(liquidator);
        vm.expectRevert(VibePerpEngine.PositionNotLiquidatable.selector);
        engine.liquidate(posId);
    }

    function test_revertLiquidateNonexistent() public {
        vm.prank(liquidator);
        vm.expectRevert(VibePerpEngine.PositionNotFound.selector);
        engine.liquidate(999);
    }

    function test_liquidationReducesOI() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        oracle.setPrice(address(baseToken), 1810e18);

        vm.prank(liquidator);
        engine.liquidate(posId);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertEq(m.openInterestLong, 0);
    }

    function test_liquidationSocializedLoss() public {
        quoteToken.mint(address(engine), 10_000e18);

        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Severe crash: price to 1700 → loss = 300 > margin(198) → deficit = 102
        // Insurance fund has 2e18 (from taker fee). Deficit > insurance → insurance = 0
        oracle.setPrice(address(baseToken), 1700e18);

        vm.prank(liquidator);
        engine.liquidate(posId);

        // Insurance fund should be drained or reduced
        // remaining = 198 + (-300) = -102 → deficit = 102 > insuranceFund(2) → fund = 0
        assertEq(engine.insuranceFund(), 0);
    }

    // ============ Funding Rate (PID Controller) ============

    function test_updateFunding() public {
        vm.prank(alice);
        engine.openPosition(ethMarket, 5e18, 1000e18, MARK_PRICE);

        vm.warp(block.timestamp + 1 hours);
        engine.updateFunding(ethMarket);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        // All long, no short → positive funding (longs pay)
        assertGt(m.fundingRate, 0);
    }

    function test_fundingZeroWhenBalanced() public {
        vm.prank(alice);
        engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
        vm.prank(bob);
        engine.openPosition(ethMarket, -1e18, 200e18, 0);

        vm.warp(block.timestamp + 1 hours);
        engine.updateFunding(ethMarket);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        // Balanced OI → error = 0 → funding = 0
        assertEq(m.fundingRate, 0);
    }

    function test_fundingNegativeWhenShortsHeavy() public {
        vm.prank(alice);
        engine.openPosition(ethMarket, -5e18, 1000e18, 0);

        vm.warp(block.timestamp + 1 hours);
        engine.updateFunding(ethMarket);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        // All short → negative funding (shorts pay)
        assertLt(m.fundingRate, 0);
    }

    function test_revertFundingTooSoon() public {
        vm.expectRevert(VibePerpEngine.FundingTooSoon.selector);
        engine.updateFunding(ethMarket);
    }

    function test_fundingCumulativeIndex() public {
        uint256 startTime = block.timestamp;

        vm.prank(alice);
        engine.openPosition(ethMarket, 5e18, 1000e18, MARK_PRICE);

        vm.warp(startTime + 2 hours);
        engine.updateFunding(ethMarket);
        int256 cum1 = engine.cumulativeFunding(ethMarket);

        vm.warp(startTime + 4 hours);
        engine.updateFunding(ethMarket);
        int256 cum2 = engine.cumulativeFunding(ethMarket);

        // Should accumulate
        assertGt(cum2, cum1);
    }

    function test_fundingRateClamped() public {
        // Extreme imbalance → should clamp to MAX_FUNDING_RATE
        vm.prank(alice);
        engine.openPosition(ethMarket, 10e18, 2000e18, MARK_PRICE);
        // Set very aggressive PID gains
        engine.setPIDGains(1e18, 0, 0);  // Kp = 1.0

        vm.warp(block.timestamp + 1 hours);
        engine.updateFunding(ethMarket);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        // Should be clamped to 0.1% = 1e15
        assertEq(m.fundingRate, int256(1e15));
    }

    function test_fundingResetWhenNoOI() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Close position so OI = 0
        vm.prank(alice);
        engine.closePosition(posId, 0);

        vm.warp(block.timestamp + 1 hours);
        engine.updateFunding(ethMarket);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertEq(m.fundingRate, 0);
    }

    // ============ View Functions ============

    function test_getPositionPnL() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Price goes up 100
        oracle.setPrice(address(baseToken), 2100e18);

        int256 pnl = engine.getPositionPnL(posId);
        assertEq(pnl, 100e18);
    }

    function test_getPositionPnLNegative() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        oracle.setPrice(address(baseToken), 1900e18);

        int256 pnl = engine.getPositionPnL(posId);
        assertEq(pnl, -100e18);
    }

    function test_getMarginRatio() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        uint256 ratio = engine.getMarginRatio(posId);
        // margin = 198, notional = 2000 → ratio = 198/2000 * 10000 = 990
        assertEq(ratio, 990);
    }

    function test_getMarginRatioZeroWhenDeepUnderwater() public {
        vm.prank(alice);
        uint256 posId = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        // Price crashes → effective margin < 0
        oracle.setPrice(address(baseToken), 1700e18);

        uint256 ratio = engine.getMarginRatio(posId);
        assertEq(ratio, 0);
    }

    function test_getTraderPositions() public view {
        uint256[] memory posIds = engine.getTraderPositions(alice);
        assertEq(posIds.length, 0);
    }

    function test_getMarketCount() public view {
        assertEq(engine.getMarketCount(), 1);
    }

    // ============ Multi-User Lifecycle ============

    function test_fullLifecycle() public {
        quoteToken.mint(address(engine), 10_000e18);

        // Alice opens long, Bob opens short
        vm.prank(alice);
        uint256 longId = engine.openPosition(ethMarket, 2e18, 500e18, MARK_PRICE);
        vm.prank(bob);
        uint256 shortId = engine.openPosition(ethMarket, -2e18, 500e18, 0);

        VibePerpEngine.Market memory m = engine.getMarket(ethMarket);
        assertEq(m.openInterestLong, 4000e18);
        assertEq(m.openInterestShort, 4000e18);

        // Price moves up → Alice profits, Bob loses
        oracle.setPrice(address(baseToken), 2100e18);

        // Settle funding (balanced → 0)
        vm.warp(block.timestamp + 1 hours);
        engine.updateFunding(ethMarket);

        // Alice closes at profit
        uint256 aliceBalBefore = quoteToken.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(longId, 0);
        uint256 aliceProfit = quoteToken.balanceOf(alice) - aliceBalBefore;
        // notional = 2*2000 = 4000, fee = 4000*10/10000 = 4, margin = 496
        // PnL = 2 * (2100-2000) = 200, payout = 496 + 200 = 696
        assertEq(aliceProfit, 696e18);

        // Bob closes at loss
        uint256 bobBalBefore = quoteToken.balanceOf(bob);
        vm.prank(bob);
        engine.closePosition(shortId, type(uint256).max);
        uint256 bobPayout = quoteToken.balanceOf(bob) - bobBalBefore;
        // PnL = -2 * (2100-2000) = -200, margin = 496, payout = 296
        assertEq(bobPayout, 296e18);
    }

    function test_swapAndPopPositionTracking() public {
        // Open 3 positions, close the middle one → verify swap-and-pop
        vm.prank(alice);
        uint256 id1 = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
        vm.prank(alice);
        uint256 id2 = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);
        vm.prank(alice);
        uint256 id3 = engine.openPosition(ethMarket, 1e18, 200e18, MARK_PRICE);

        uint256[] memory posIds = engine.getTraderPositions(alice);
        assertEq(posIds.length, 3);

        // Close middle position
        vm.prank(alice);
        engine.closePosition(id2, 0);

        posIds = engine.getTraderPositions(alice);
        assertEq(posIds.length, 2);
        // id3 should have swapped into id2's slot
        assertTrue(posIds[0] == id1 || posIds[1] == id1);
        assertTrue(posIds[0] == id3 || posIds[1] == id3);
    }
}
