// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/BondingCurveLauncher.sol";

// ============ Mock Token ============

contract MockBCLToken {
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

// ============ Test Contract ============

contract BondingCurveLauncherTest is Test {
    BondingCurveLauncher public bcl;
    MockBCLToken public launchToken;
    MockBCLToken public reserveToken;

    address public owner;
    address public treasuryAddr;
    address public creator;
    address public buyer;
    address public buyer2;

    uint256 constant INITIAL_PRICE = 0.01 ether; // 0.01 reserve per token
    uint256 constant CURVE_SLOPE = 0.001 ether;  // price increases 0.001 per token sold
    uint256 constant GRADUATION_TARGET = 50 ether;
    uint256 constant MAX_SUPPLY = 10_000 ether;

    function setUp() public {
        owner = makeAddr("owner");
        treasuryAddr = makeAddr("treasury");
        creator = makeAddr("creator");
        buyer = makeAddr("buyer");
        buyer2 = makeAddr("buyer2");

        vm.prank(owner);
        bcl = new BondingCurveLauncher(treasuryAddr);

        launchToken = new MockBCLToken();
        reserveToken = new MockBCLToken();

        // Fund the contract with launch tokens (simulating token supply)
        launchToken.mint(address(bcl), 1_000_000 ether);

        // Fund buyers with reserve tokens
        reserveToken.mint(buyer, 1_000_000 ether);
        vm.prank(buyer);
        reserveToken.approve(address(bcl), type(uint256).max);

        reserveToken.mint(buyer2, 1_000_000 ether);
        vm.prank(buyer2);
        reserveToken.approve(address(bcl), type(uint256).max);
    }

    // ============ Helpers ============

    function _createDefaultLaunch() internal returns (uint256) {
        vm.prank(creator);
        return bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            INITIAL_PRICE,
            CURVE_SLOPE,
            GRADUATION_TARGET,
            MAX_SUPPLY,
            200 // 2% creator fee
        );
    }

    // ============ Constructor Tests ============

    function test_constructor_setsTreasury() public view {
        assertEq(bcl.treasury(), treasuryAddr);
    }

    function test_constructor_setsOwner() public view {
        assertEq(bcl.owner(), owner);
    }

    // ============ createLaunch Tests ============

    function test_createLaunch_happyPath() public {
        uint256 id = _createDefaultLaunch();
        assertEq(id, 1);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(1);
        assertEq(l.token, address(launchToken));
        assertEq(l.reserveToken, address(reserveToken));
        assertEq(l.creator, creator);
        assertEq(l.initialPrice, INITIAL_PRICE);
        assertEq(l.curveSlope, CURVE_SLOPE);
        assertEq(l.tokensSold, 0);
        assertEq(l.reserveBalance, 0);
        assertEq(l.graduationTarget, GRADUATION_TARGET);
        assertEq(l.maxSupply, MAX_SUPPLY);
        assertEq(l.creatorFeeBps, 200);
        assertEq(uint8(l.state), uint8(IBondingCurveLauncher.LaunchState.ACTIVE));
    }

    function test_createLaunch_revertsZeroAddress() public {
        vm.expectRevert(IBondingCurveLauncher.ZeroAddress.selector);
        bcl.createLaunch(address(0), address(reserveToken), INITIAL_PRICE, CURVE_SLOPE, GRADUATION_TARGET, MAX_SUPPLY, 200);
    }

    function test_createLaunch_revertsFeeTooHigh() public {
        vm.expectRevert(IBondingCurveLauncher.FeeTooHigh.selector);
        bcl.createLaunch(address(launchToken), address(reserveToken), INITIAL_PRICE, CURVE_SLOPE, GRADUATION_TARGET, MAX_SUPPLY, 600);
    }

    function test_createLaunch_revertsInvalidParams() public {
        vm.expectRevert(IBondingCurveLauncher.InvalidParams.selector);
        bcl.createLaunch(address(launchToken), address(reserveToken), 0, CURVE_SLOPE, GRADUATION_TARGET, MAX_SUPPLY, 200);
    }

    // ============ buy Tests ============

    function test_buy_happyPath() public {
        _createDefaultLaunch();

        uint256 amount = 100 ether;
        uint256 quote = bcl.buyQuote(1, amount);

        uint256 balBefore = reserveToken.balanceOf(buyer);

        vm.prank(buyer);
        bcl.buy(1, amount, quote);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(1);
        assertEq(l.tokensSold, amount);
        assertGt(l.reserveBalance, 0);
        assertEq(launchToken.balanceOf(buyer), amount);
        assertEq(balBefore - reserveToken.balanceOf(buyer), quote);
    }

    function test_buy_priceIncreasesWithSupply() public {
        _createDefaultLaunch();

        uint256 price1 = bcl.currentPrice(1);

        vm.prank(buyer);
        bcl.buy(1, 100 ether, type(uint256).max);

        uint256 price2 = bcl.currentPrice(1);
        assertGt(price2, price1, "Price should increase after buying");
    }

    function test_buy_creatorAndProtocolFees() public {
        _createDefaultLaunch();

        uint256 amount = 100 ether;
        uint256 creatorBefore = reserveToken.balanceOf(creator);
        uint256 treasuryBefore = reserveToken.balanceOf(treasuryAddr);

        vm.prank(buyer);
        bcl.buy(1, amount, type(uint256).max);

        assertGt(reserveToken.balanceOf(creator) - creatorBefore, 0, "Creator should get fee");
        assertGt(reserveToken.balanceOf(treasuryAddr) - treasuryBefore, 0, "Treasury should get fee");
    }

    function test_buy_revertsSlippage() public {
        _createDefaultLaunch();

        vm.prank(buyer);
        vm.expectRevert(IBondingCurveLauncher.SlippageExceeded.selector);
        bcl.buy(1, 100 ether, 1); // maxCost = 1 wei
    }

    function test_buy_revertsExceedsMaxSupply() public {
        _createDefaultLaunch();

        vm.prank(buyer);
        vm.expectRevert(IBondingCurveLauncher.ExceedsMaxSupply.selector);
        bcl.buy(1, MAX_SUPPLY + 1 ether, type(uint256).max);
    }

    function test_buy_revertsNotActive() public {
        uint256 id = _createDefaultLaunch();

        vm.prank(owner);
        bcl.failLaunch(id);

        vm.prank(buyer);
        vm.expectRevert(IBondingCurveLauncher.LaunchNotActive.selector);
        bcl.buy(id, 100 ether, type(uint256).max);
    }

    // ============ sell Tests ============

    function test_sell_happyPath() public {
        _createDefaultLaunch();

        // Buy first
        vm.prank(buyer);
        bcl.buy(1, 100 ether, type(uint256).max);

        // Approve launch token for selling back
        vm.prank(buyer);
        launchToken.approve(address(bcl), type(uint256).max);

        uint256 balBefore = reserveToken.balanceOf(buyer);

        vm.prank(buyer);
        bcl.sell(1, 50 ether, 0);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(1);
        assertEq(l.tokensSold, 50 ether);
        assertGt(reserveToken.balanceOf(buyer) - balBefore, 0, "Should receive proceeds");
    }

    function test_sell_revertsInsufficientTokens() public {
        _createDefaultLaunch();

        vm.prank(buyer);
        launchToken.approve(address(bcl), type(uint256).max);

        vm.prank(buyer);
        vm.expectRevert(IBondingCurveLauncher.InsufficientTokens.selector);
        bcl.sell(1, 100 ether, 0); // Never bought any
    }

    // ============ graduate Tests ============

    function test_graduate_happyPath() public {
        _createDefaultLaunch();

        // Buy enough to hit graduation target
        vm.prank(buyer);
        bcl.buy(1, 5000 ether, type(uint256).max);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(1);
        assertTrue(l.reserveBalance >= GRADUATION_TARGET, "Should have enough reserve");

        bcl.graduate(1);

        l = bcl.getLaunch(1);
        assertEq(uint8(l.state), uint8(IBondingCurveLauncher.LaunchState.GRADUATED));
    }

    function test_graduate_revertsBeforeTarget() public {
        _createDefaultLaunch();

        vm.prank(buyer);
        bcl.buy(1, 10 ether, type(uint256).max);

        vm.expectRevert(IBondingCurveLauncher.InvalidParams.selector);
        bcl.graduate(1);
    }

    // ============ failLaunch + refund Tests ============

    function test_failLaunch_happyPath() public {
        uint256 id = _createDefaultLaunch();

        vm.prank(owner);
        bcl.failLaunch(id);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(id);
        assertEq(uint8(l.state), uint8(IBondingCurveLauncher.LaunchState.FAILED));
    }

    function test_refund_happyPath() public {
        uint256 id = _createDefaultLaunch();

        // Buy tokens
        vm.prank(buyer);
        bcl.buy(id, 100 ether, type(uint256).max);

        uint256 deposit = bcl.getUserDeposit(id, buyer);
        assertGt(deposit, 0);

        // Fail the launch
        vm.prank(owner);
        bcl.failLaunch(id);

        // Claim refund
        uint256 balBefore = reserveToken.balanceOf(buyer);
        vm.prank(buyer);
        bcl.refund(id);

        assertGt(reserveToken.balanceOf(buyer) - balBefore, 0, "Should receive refund");
        assertEq(bcl.getUserDeposit(id, buyer), 0, "Deposit should be zero");
    }

    function test_refund_revertsNotFailed() public {
        uint256 id = _createDefaultLaunch();

        vm.prank(buyer);
        vm.expectRevert(IBondingCurveLauncher.LaunchNotFailed.selector);
        bcl.refund(id);
    }

    // ============ View Tests ============

    function test_currentPrice_startsAtInitialPrice() public {
        _createDefaultLaunch();
        assertEq(bcl.currentPrice(1), INITIAL_PRICE);
    }

    function test_buyQuote_sellQuote_symmetry() public {
        _createDefaultLaunch();

        uint256 amount = 100 ether;
        uint256 buyCost = bcl.buyQuote(1, amount);

        // Simulate buy
        vm.prank(buyer);
        bcl.buy(1, amount, type(uint256).max);

        // Sell quote should be less than buy cost (due to fees + curve shape)
        uint256 sellProceeds = bcl.sellQuote(1, amount);
        assertLt(sellProceeds, buyCost, "Sell proceeds < buy cost (fees)");
    }
}
