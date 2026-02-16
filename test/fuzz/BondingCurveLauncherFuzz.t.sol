// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/BondingCurveLauncher.sol";

// ============ Mocks ============

contract MockBCLFToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount);
        require(allowance[from][msg.sender] >= amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

// ============ Fuzz Tests ============

contract BondingCurveLauncherFuzzTest is Test {
    BondingCurveLauncher public bcl;
    MockBCLFToken public launchToken;
    MockBCLFToken public reserveToken;

    address public buyer;
    address public creator;
    address public treasuryAddr;

    function setUp() public {
        treasuryAddr = makeAddr("treasury");
        creator = makeAddr("creator");
        buyer = makeAddr("buyer");

        bcl = new BondingCurveLauncher(treasuryAddr);

        launchToken = new MockBCLFToken();
        reserveToken = new MockBCLFToken();

        launchToken.mint(address(bcl), type(uint128).max);

        reserveToken.mint(buyer, type(uint128).max);
        vm.prank(buyer);
        reserveToken.approve(address(bcl), type(uint256).max);
    }

    // ============ Fuzz: price monotonically increases with supply ============

    function testFuzz_priceIncreasesMonotonically(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1 ether, 1_000 ether);
        amount2 = bound(amount2, 1 ether, 1_000 ether);

        vm.prank(creator);
        uint256 id = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            0.01 ether,
            0.001 ether,
            1_000_000 ether,
            100_000 ether,
            0
        );

        uint256 price0 = bcl.currentPrice(id);

        vm.prank(buyer);
        bcl.buy(id, amount1, type(uint256).max);

        uint256 price1 = bcl.currentPrice(id);
        assertGt(price1, price0, "Price must increase after buy");

        vm.prank(buyer);
        bcl.buy(id, amount2, type(uint256).max);

        uint256 price2 = bcl.currentPrice(id);
        assertGt(price2, price1, "Price must keep increasing");
    }

    // ============ Fuzz: buy cost matches integral formula ============

    function testFuzz_buyCostMatchesFormula(uint256 initialPrice, uint256 slope, uint256 amount) public {
        initialPrice = bound(initialPrice, 0.001 ether, 1 ether);
        slope = bound(slope, 0.0001 ether, 0.1 ether);
        amount = bound(amount, 1 ether, 10_000 ether);

        vm.prank(creator);
        uint256 id = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            initialPrice,
            slope,
            type(uint128).max,
            type(uint128).max,
            0 // no creator fee for clean test
        );

        uint256 quote = bcl.buyQuote(id, amount);

        // Manual computation: cost = amount * (priceStart + priceEnd) / 2 / PRECISION
        // priceStart = initialPrice + slope * 0 / 1e18 = initialPrice
        // priceEnd = initialPrice + slope * amount / 1e18
        uint256 priceStart = initialPrice;
        uint256 priceEnd = initialPrice + (slope * amount) / 1e18;
        // Only 1% protocol fee (no creator fee)
        uint256 baseCost = (amount * (priceStart + priceEnd)) / (2 * 1e18);
        uint256 protocolFee = (baseCost * 100) / 10000;
        uint256 expected = baseCost + protocolFee;

        assertEq(quote, expected, "Buy quote must match integral formula");
    }

    // ============ Fuzz: sell proceeds <= reserve balance ============

    function testFuzz_sellProceedsLeqReserve(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 1 ether, 10_000 ether);

        vm.prank(creator);
        uint256 id = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            0.01 ether,
            0.001 ether,
            1_000_000 ether,
            100_000 ether,
            200
        );

        vm.prank(buyer);
        bcl.buy(id, buyAmount, type(uint256).max);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(id);
        uint256 sellProceeds = bcl.sellQuote(id, buyAmount);

        assertLe(sellProceeds, l.reserveBalance, "Sell proceeds must not exceed reserve");
    }

    // ============ Fuzz: buy then sell returns less (fees) ============

    function testFuzz_buyThenSellLossFees(uint256 amount) public {
        amount = bound(amount, 1 ether, 10_000 ether);

        vm.prank(creator);
        uint256 id = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            0.01 ether,
            0.001 ether,
            1_000_000 ether,
            100_000 ether,
            200
        );

        uint256 balBefore = reserveToken.balanceOf(buyer);

        vm.prank(buyer);
        bcl.buy(id, amount, type(uint256).max);

        vm.prank(buyer);
        launchToken.approve(address(bcl), type(uint256).max);

        vm.prank(buyer);
        bcl.sell(id, amount, 0);

        uint256 balAfter = reserveToken.balanceOf(buyer);
        assertLt(balAfter, balBefore, "Roundtrip should lose to fees");
    }

    // ============ Fuzz: graduation requires meeting target ============

    function testFuzz_graduationRequiresTarget(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 50 ether);

        vm.prank(creator);
        uint256 id = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            0.01 ether,
            0.001 ether,
            100 ether, // target = 100 ether
            100_000 ether,
            0
        );

        vm.prank(buyer);
        bcl.buy(id, amount, type(uint256).max);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(id);
        if (l.reserveBalance >= 100 ether) {
            bcl.graduate(id);
            l = bcl.getLaunch(id);
            assertEq(uint8(l.state), uint8(IBondingCurveLauncher.LaunchState.GRADUATED));
        } else {
            vm.expectRevert(IBondingCurveLauncher.InvalidParams.selector);
            bcl.graduate(id);
        }
    }

    // ============ Fuzz: currentPrice == initialPrice + slope * sold / PRECISION ============

    function testFuzz_currentPriceFormula(uint256 amount) public {
        amount = bound(amount, 1 ether, 10_000 ether);

        uint256 initP = 0.05 ether;
        uint256 slope = 0.002 ether;

        vm.prank(creator);
        uint256 id = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            initP,
            slope,
            type(uint128).max,
            type(uint128).max,
            0
        );

        vm.prank(buyer);
        bcl.buy(id, amount, type(uint256).max);

        uint256 price = bcl.currentPrice(id);
        uint256 expected = initP + (slope * amount) / 1e18;
        assertEq(price, expected, "Price formula: P = initial + slope * sold / PRECISION");
    }

    // ============ Fuzz: refund returns deposit for failed launch ============

    function testFuzz_refundReturnsDeposit(uint256 amount) public {
        amount = bound(amount, 1 ether, 10_000 ether);

        vm.prank(creator);
        uint256 id = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            0.01 ether,
            0.001 ether,
            type(uint128).max,
            type(uint128).max,
            0
        );

        vm.prank(buyer);
        bcl.buy(id, amount, type(uint256).max);

        uint256 deposit = bcl.getUserDeposit(id, buyer);
        assertGt(deposit, 0);

        bcl.failLaunch(id);

        uint256 balBefore = reserveToken.balanceOf(buyer);
        vm.prank(buyer);
        bcl.refund(id);

        uint256 refunded = reserveToken.balanceOf(buyer) - balBefore;
        assertEq(refunded, deposit, "Refund should return full deposit");
    }

    // ============ Fuzz: multiple buyers all tracked correctly ============

    function testFuzz_multipleBuyersTracked(uint256 a1, uint256 a2) public {
        a1 = bound(a1, 1 ether, 5_000 ether);
        a2 = bound(a2, 1 ether, 5_000 ether);

        address buyer2 = makeAddr("buyer2");
        reserveToken.mint(buyer2, type(uint128).max);
        vm.prank(buyer2);
        reserveToken.approve(address(bcl), type(uint256).max);

        vm.prank(creator);
        uint256 id = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            0.01 ether,
            0.001 ether,
            type(uint128).max,
            type(uint128).max,
            0
        );

        vm.prank(buyer);
        bcl.buy(id, a1, type(uint256).max);

        vm.prank(buyer2);
        bcl.buy(id, a2, type(uint256).max);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(id);
        assertEq(l.tokensSold, a1 + a2, "Total sold = sum of buys");
        assertEq(launchToken.balanceOf(buyer), a1, "Buyer1 got correct tokens");
        assertEq(launchToken.balanceOf(buyer2), a2, "Buyer2 got correct tokens");
    }
}
