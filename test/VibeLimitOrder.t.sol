// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/VibeLimitOrder.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title VibeLimitOrder Unit Tests
 * @notice Comprehensive test coverage for the on-chain limit order book.
 *         Covers placement, cancellation, batch fills, claims, expiry,
 *         price constraints, access control, and edge cases.
 */
contract VibeLimitOrderTest is Test {
    VibeLimitOrder public orderBook;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public owner;
    address public settler;
    address public alice;
    address public bob;
    address public charlie;

    uint256 public constant PRICE_PRECISION = 1e18;

    // ============ Events (for expectEmit) ============

    event OrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 limitPrice,
        uint256 expiry,
        bool isBuy
    );
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
    event OrderFilled(
        uint256 indexed orderId,
        uint256 amountFilled,
        uint256 amountReceived,
        uint256 clearingPrice,
        bool isPartial
    );
    event OrderClaimed(uint256 indexed orderId, address indexed owner, uint256 amountReceived);
    event SettlerUpdated(address indexed settler, bool authorized);

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        settler = makeAddr("settler");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        // Deploy tokens
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");

        // Deploy VibeLimitOrder via UUPS proxy
        VibeLimitOrder impl = new VibeLimitOrder();
        bytes memory initData = abi.encodeWithSelector(
            VibeLimitOrder.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        orderBook = VibeLimitOrder(address(proxy));

        // Authorize settler
        vm.prank(owner);
        orderBook.setSettler(settler, true);

        // Mint tokens
        tokenA.mint(alice, 100_000 ether);
        tokenB.mint(alice, 100_000 ether);
        tokenA.mint(bob, 100_000 ether);
        tokenB.mint(bob, 100_000 ether);
        tokenA.mint(settler, 100_000 ether);
        tokenB.mint(settler, 100_000 ether);

        // Approve order book
        vm.prank(alice);
        tokenA.approve(address(orderBook), type(uint256).max);
        vm.prank(alice);
        tokenB.approve(address(orderBook), type(uint256).max);
        vm.prank(bob);
        tokenA.approve(address(orderBook), type(uint256).max);
        vm.prank(bob);
        tokenB.approve(address(orderBook), type(uint256).max);
        vm.prank(settler);
        tokenA.approve(address(orderBook), type(uint256).max);
        vm.prank(settler);
        tokenB.approve(address(orderBook), type(uint256).max);
    }

    // ============ Initialization Tests ============

    function test_initialize_setsOwner() public view {
        assertEq(orderBook.owner(), owner);
    }

    function test_initialize_startsAtOrderIdZero() public view {
        assertEq(orderBook.nextOrderId(), 0);
    }

    function test_initialize_revertsOnZeroOwner() public {
        VibeLimitOrder impl = new VibeLimitOrder();
        bytes memory initData = abi.encodeWithSelector(
            VibeLimitOrder.initialize.selector,
            address(0)
        );
        vm.expectRevert(VibeLimitOrder.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_cannotBeCalledTwice() public {
        vm.expectRevert();
        orderBook.initialize(owner);
    }

    // ============ Place Order Tests ============

    function test_placeLimitOrder_buyOrder() public {
        uint256 expiry = block.timestamp + 1 days;

        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA),   // tokenIn (paying with tokenA)
            address(tokenB),   // tokenOut (buying tokenB)
            10 ether,          // amountIn
            2 ether,           // limitPrice (max price willing to pay)
            expiry,
            true               // isBuy
        );

        assertEq(orderId, 0);
        assertEq(orderBook.nextOrderId(), 1);

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(order.owner, alice);
        assertEq(order.tokenIn, address(tokenA));
        assertEq(order.tokenOut, address(tokenB));
        assertEq(order.amountIn, 10 ether);
        assertEq(order.limitPrice, 2 ether);
        assertEq(order.expiry, expiry);
        assertTrue(order.isBuy);
        assertEq(uint8(order.status), uint8(VibeLimitOrder.OrderStatus.PENDING));
    }

    function test_placeLimitOrder_sellOrder() public {
        uint256 expiry = block.timestamp + 7 days;

        vm.prank(bob);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenB),   // tokenIn (selling tokenB)
            address(tokenA),   // tokenOut (receiving tokenA)
            50 ether,          // amountIn
            1.5 ether,         // limitPrice (min price willing to accept)
            expiry,
            false              // isSell
        );

        assertEq(orderId, 0);

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(order.owner, bob);
        assertFalse(order.isBuy);
    }

    function test_placeLimitOrder_transfersTokensIn() public {
        uint256 balBefore = tokenA.balanceOf(alice);

        vm.prank(alice);
        orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 1 ether, block.timestamp + 1 days, true
        );

        assertEq(tokenA.balanceOf(alice), balBefore - 10 ether);
        assertEq(tokenA.balanceOf(address(orderBook)), 10 ether);
    }

    function test_placeLimitOrder_emitsEvent() public {
        uint256 expiry = block.timestamp + 1 days;

        vm.expectEmit(true, true, false, true);
        emit OrderPlaced(0, alice, address(tokenA), address(tokenB), 10 ether, 2 ether, expiry, true);

        vm.prank(alice);
        orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, expiry, true
        );
    }

    function test_placeLimitOrder_incrementsOrderId() public {
        vm.startPrank(alice);
        uint256 id0 = orderBook.placeLimitOrder(address(tokenA), address(tokenB), 1 ether, 1 ether, block.timestamp + 1 days, true);
        uint256 id1 = orderBook.placeLimitOrder(address(tokenA), address(tokenB), 1 ether, 1 ether, block.timestamp + 1 days, true);
        uint256 id2 = orderBook.placeLimitOrder(address(tokenA), address(tokenB), 1 ether, 1 ether, block.timestamp + 1 days, true);
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(orderBook.nextOrderId(), 3);
    }

    function test_placeLimitOrder_tracksUserOrders() public {
        vm.startPrank(alice);
        orderBook.placeLimitOrder(address(tokenA), address(tokenB), 1 ether, 1 ether, block.timestamp + 1 days, true);
        orderBook.placeLimitOrder(address(tokenA), address(tokenB), 2 ether, 1 ether, block.timestamp + 1 days, true);
        vm.stopPrank();

        uint256[] memory ids = orderBook.getUserOrders(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], 0);
        assertEq(ids[1], 1);
    }

    // ============ Place Order Validation Tests ============

    function test_placeLimitOrder_revertsOnZeroTokenIn() public {
        vm.prank(alice);
        vm.expectRevert(VibeLimitOrder.ZeroAddress.selector);
        orderBook.placeLimitOrder(address(0), address(tokenB), 1 ether, 1 ether, block.timestamp + 1 days, true);
    }

    function test_placeLimitOrder_revertsOnZeroTokenOut() public {
        vm.prank(alice);
        vm.expectRevert(VibeLimitOrder.ZeroAddress.selector);
        orderBook.placeLimitOrder(address(tokenA), address(0), 1 ether, 1 ether, block.timestamp + 1 days, true);
    }

    function test_placeLimitOrder_revertsOnSameToken() public {
        vm.prank(alice);
        vm.expectRevert(VibeLimitOrder.SameToken.selector);
        orderBook.placeLimitOrder(address(tokenA), address(tokenA), 1 ether, 1 ether, block.timestamp + 1 days, true);
    }

    function test_placeLimitOrder_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(VibeLimitOrder.ZeroAmount.selector);
        orderBook.placeLimitOrder(address(tokenA), address(tokenB), 0, 1 ether, block.timestamp + 1 days, true);
    }

    function test_placeLimitOrder_revertsOnZeroPrice() public {
        vm.prank(alice);
        vm.expectRevert(VibeLimitOrder.InvalidPrice.selector);
        orderBook.placeLimitOrder(address(tokenA), address(tokenB), 1 ether, 0, block.timestamp + 1 days, true);
    }

    function test_placeLimitOrder_revertsOnExpiredExpiry() public {
        vm.prank(alice);
        vm.expectRevert(VibeLimitOrder.InvalidExpiry.selector);
        orderBook.placeLimitOrder(address(tokenA), address(tokenB), 1 ether, 1 ether, block.timestamp, true);
    }

    function test_placeLimitOrder_revertsOnPastExpiry() public {
        vm.prank(alice);
        vm.expectRevert(VibeLimitOrder.InvalidExpiry.selector);
        orderBook.placeLimitOrder(address(tokenA), address(tokenB), 1 ether, 1 ether, block.timestamp - 1, true);
    }

    function test_placeLimitOrder_revertsOnExpiryTooFar() public {
        vm.prank(alice);
        vm.expectRevert(VibeLimitOrder.InvalidExpiry.selector);
        orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            1 ether, 1 ether,
            block.timestamp + 31 days, // > MAX_EXPIRY_DURATION (30 days)
            true
        );
    }

    function test_placeLimitOrder_maxExpiryIsValid() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            1 ether, 1 ether,
            block.timestamp + 30 days, // exactly MAX_EXPIRY_DURATION
            true
        );

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(order.expiry, block.timestamp + 30 days);
    }

    // ============ Cancel Order Tests ============

    function test_cancelOrder_pendingOrder() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 1 ether, block.timestamp + 1 days, true
        );

        uint256 balBefore = tokenA.balanceOf(alice);

        vm.prank(alice);
        orderBook.cancelOrder(orderId);

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(uint8(order.status), uint8(VibeLimitOrder.OrderStatus.CANCELLED));
        assertEq(tokenA.balanceOf(alice), balBefore + 10 ether);
    }

    function test_cancelOrder_emitsEvent() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 1 ether, block.timestamp + 1 days, true
        );

        vm.expectEmit(true, true, false, false);
        emit OrderCancelled(orderId, alice);

        vm.prank(alice);
        orderBook.cancelOrder(orderId);
    }

    function test_cancelOrder_revertsForNonOwner() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 1 ether, block.timestamp + 1 days, true
        );

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VibeLimitOrder.NotOrderOwner.selector, orderId));
        orderBook.cancelOrder(orderId);
    }

    function test_cancelOrder_revertsForNonExistentOrder() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeLimitOrder.OrderNotFound.selector, 999));
        orderBook.cancelOrder(999);
    }

    function test_cancelOrder_revertsForAlreadyCancelledOrder() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 1 ether, block.timestamp + 1 days, true
        );

        vm.prank(alice);
        orderBook.cancelOrder(orderId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeLimitOrder.OrderNotCancellable.selector, orderId));
        orderBook.cancelOrder(orderId);
    }

    // ============ Fill Orders Tests ============

    function test_fillOrders_singleBuyOrder() public {
        // Alice places a buy order: pay 10 tokenA, max price 2e18 (2 tokenA per tokenB)
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        // Settler fills at clearing price 1.5e18 (1.5 tokenA per tokenB)
        // amountOut = (10e18 * 1e18) / 1.5e18 = 6.666... tokenB
        uint256 clearingPrice = 1.5 ether;

        // Settler must pre-fund the order book with output tokens
        vm.prank(settler);
        tokenB.transfer(address(orderBook), 10 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, clearingPrice);

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(uint8(order.status), uint8(VibeLimitOrder.OrderStatus.FILLED));

        (uint256 amountFilled, uint256 amountReceived, bool claimed) = orderBook.getFillInfo(orderId);
        assertEq(amountFilled, 10 ether);
        // amountOut = (10e18 * 1e18) / 1.5e18 = 6666666666666666666
        assertEq(amountReceived, (10 ether * PRICE_PRECISION) / clearingPrice);
        assertFalse(claimed);
    }

    function test_fillOrders_singleSellOrder() public {
        // Bob places a sell order: sell 20 tokenB, min price 0.5e18
        vm.prank(bob);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenB), address(tokenA),
            20 ether, 0.5 ether, block.timestamp + 1 days, false
        );

        // Settler fills at clearing price 0.8e18
        uint256 clearingPrice = 0.8 ether;

        // Pre-fund output tokens
        vm.prank(settler);
        tokenA.transfer(address(orderBook), 20 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, clearingPrice);

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(uint8(order.status), uint8(VibeLimitOrder.OrderStatus.FILLED));

        (uint256 amountFilled, uint256 amountReceived,) = orderBook.getFillInfo(orderId);
        assertEq(amountFilled, 20 ether);
        // amountOut = (20e18 * 0.8e18) / 1e18 = 16e18
        assertEq(amountReceived, (20 ether * clearingPrice) / PRICE_PRECISION);
    }

    function test_fillOrders_multipleBuyOrders() public {
        vm.prank(alice);
        uint256 id0 = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        vm.prank(bob);
        uint256 id1 = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            5 ether, 1.8 ether, block.timestamp + 1 days, true
        );

        // Pre-fund with enough tokenB for both orders
        vm.prank(settler);
        tokenB.transfer(address(orderBook), 20 ether);

        uint256[] memory orderIds = new uint256[](2);
        orderIds[0] = id0;
        orderIds[1] = id1;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1.5 ether);

        assertEq(uint8(orderBook.getOrder(id0).status), uint8(VibeLimitOrder.OrderStatus.FILLED));
        assertEq(uint8(orderBook.getOrder(id1).status), uint8(VibeLimitOrder.OrderStatus.FILLED));
    }

    function test_fillOrders_revertsForNonSettler() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(charlie);
        vm.expectRevert(VibeLimitOrder.NotAuthorizedSettler.selector);
        orderBook.fillOrders(orderIds, 1 ether);
    }

    function test_fillOrders_revertsWhenBuyPriceExceedsLimit() public {
        // Alice places buy with max price 1e18
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 1 ether, block.timestamp + 1 days, true
        );

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        // Clearing price 1.5e18 > limit 1e18 — too expensive for buyer
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(
            VibeLimitOrder.PriceNotMet.selector, orderId, 1.5 ether, 1 ether
        ));
        orderBook.fillOrders(orderIds, 1.5 ether);
    }

    function test_fillOrders_revertsWhenSellPriceBelowLimit() public {
        // Bob places sell with min price 2e18
        vm.prank(bob);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenB), address(tokenA),
            10 ether, 2 ether, block.timestamp + 1 days, false
        );

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        // Clearing price 1e18 < limit 2e18 — too cheap for seller
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(
            VibeLimitOrder.PriceNotMet.selector, orderId, 1 ether, 2 ether
        ));
        orderBook.fillOrders(orderIds, 1 ether);
    }

    function test_fillOrders_skipsExpiredOrders() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 hours, true
        );

        // Advance time past expiry
        vm.warp(block.timestamp + 2 hours);

        uint256 balBefore = tokenA.balanceOf(alice);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        // Order should be marked as EXPIRED
        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(uint8(order.status), uint8(VibeLimitOrder.OrderStatus.EXPIRED));

        // Tokens should be refunded
        assertEq(tokenA.balanceOf(alice), balBefore + 10 ether);
    }

    function test_fillOrders_skipsAlreadyFilledOrder() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        // Pre-fund and fill
        vm.prank(settler);
        tokenB.transfer(address(orderBook), 20 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        // Try to fill again — should be silently skipped (status is FILLED, not PENDING)
        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        // Still FILLED, not double-filled
        assertEq(uint8(orderBook.getOrder(orderId).status), uint8(VibeLimitOrder.OrderStatus.FILLED));
    }

    function test_fillOrders_skipsCancelledOrder() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        vm.prank(alice);
        orderBook.cancelOrder(orderId);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        // Should silently skip cancelled order
        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        assertEq(uint8(orderBook.getOrder(orderId).status), uint8(VibeLimitOrder.OrderStatus.CANCELLED));
    }

    function test_fillOrders_transfersTokenInToSettler() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        // Pre-fund
        vm.prank(settler);
        tokenB.transfer(address(orderBook), 20 ether);

        uint256 settlerBalBefore = tokenA.balanceOf(settler);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        // Settler receives the tokenIn (tokenA) from the filled order
        assertEq(tokenA.balanceOf(settler), settlerBalBefore + 10 ether);
    }

    // ============ Claim Tests ============

    function test_claimFilled_successfulClaim() public {
        // Place and fill a buy order
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        uint256 clearingPrice = 1 ether;
        uint256 expectedOut = (10 ether * PRICE_PRECISION) / clearingPrice; // 10 tokenB

        // Pre-fund output tokens
        vm.prank(settler);
        tokenB.transfer(address(orderBook), 20 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, clearingPrice);

        // Claim
        uint256 balBefore = tokenB.balanceOf(alice);

        vm.prank(alice);
        orderBook.claimFilled(orderId);

        assertEq(tokenB.balanceOf(alice), balBefore + expectedOut);

        (,, bool claimed) = orderBook.getFillInfo(orderId);
        assertTrue(claimed);
    }

    function test_claimFilled_emitsEvent() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        vm.prank(settler);
        tokenB.transfer(address(orderBook), 20 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        uint256 expectedOut = (10 ether * PRICE_PRECISION) / 1 ether;

        vm.expectEmit(true, true, false, true);
        emit OrderClaimed(orderId, alice, expectedOut);

        vm.prank(alice);
        orderBook.claimFilled(orderId);
    }

    function test_claimFilled_revertsForNonOwner() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        vm.prank(settler);
        tokenB.transfer(address(orderBook), 20 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VibeLimitOrder.NotOrderOwner.selector, orderId));
        orderBook.claimFilled(orderId);
    }

    function test_claimFilled_revertsForPendingOrder() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeLimitOrder.OrderNotClaimable.selector, orderId));
        orderBook.claimFilled(orderId);
    }

    function test_claimFilled_revertsForDoubleClaim() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        vm.prank(settler);
        tokenB.transfer(address(orderBook), 20 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        vm.prank(alice);
        orderBook.claimFilled(orderId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeLimitOrder.AlreadyClaimed.selector, orderId));
        orderBook.claimFilled(orderId);
    }

    // ============ Admin Tests ============

    function test_setSettler_authorize() public {
        address newSettler = makeAddr("newSettler");

        vm.expectEmit(true, false, false, true);
        emit SettlerUpdated(newSettler, true);

        vm.prank(owner);
        orderBook.setSettler(newSettler, true);

        assertTrue(orderBook.isSettler(newSettler));
    }

    function test_setSettler_deauthorize() public {
        vm.prank(owner);
        orderBook.setSettler(settler, false);

        assertFalse(orderBook.isSettler(settler));
    }

    function test_setSettler_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        orderBook.setSettler(alice, true);
    }

    function test_setSettler_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(VibeLimitOrder.ZeroAddress.selector);
        orderBook.setSettler(address(0), true);
    }

    // ============ View Function Tests ============

    function test_getUserOrders_returnsEmpty() public view {
        uint256[] memory ids = orderBook.getUserOrders(charlie);
        assertEq(ids.length, 0);
    }

    function test_getOrder_nonExistentReturnsZeroOwner() public view {
        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(999);
        assertEq(order.owner, address(0));
    }

    function test_getFillInfo_defaultValues() public view {
        (uint256 amountFilled, uint256 amountReceived, bool claimed) = orderBook.getFillInfo(999);
        assertEq(amountFilled, 0);
        assertEq(amountReceived, 0);
        assertFalse(claimed);
    }

    // ============ Fuzz Tests ============

    function testFuzz_placeLimitOrder_anyValidAmount(uint256 amount) public {
        amount = bound(amount, 1, 100_000 ether);

        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            amount, 1 ether, block.timestamp + 1 days, true
        );

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(order.amountIn, amount);
    }

    function testFuzz_placeLimitOrder_anyValidPrice(uint256 price) public {
        price = bound(price, 1, type(uint128).max);

        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            1 ether, price, block.timestamp + 1 days, true
        );

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(order.limitPrice, price);
    }

    function testFuzz_placeLimitOrder_anyValidExpiry(uint256 offset) public {
        offset = bound(offset, 1, 30 days);
        uint256 expiry = block.timestamp + offset;

        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            1 ether, 1 ether, expiry, true
        );

        VibeLimitOrder.LimitOrder memory order = orderBook.getOrder(orderId);
        assertEq(order.expiry, expiry);
    }

    function testFuzz_fillOrder_buyPriceMath(uint256 clearingPrice) public {
        // Buy order: clearing price must be <= limit price (2 ether)
        clearingPrice = bound(clearingPrice, 0.1 ether, 2 ether);

        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        // Pre-fund generously
        vm.prank(settler);
        tokenB.transfer(address(orderBook), 200 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, clearingPrice);

        (, uint256 amountReceived,) = orderBook.getFillInfo(orderId);
        uint256 expectedOut = (10 ether * PRICE_PRECISION) / clearingPrice;
        assertEq(amountReceived, expectedOut);
    }

    function testFuzz_fillOrder_sellPriceMath(uint256 clearingPrice) public {
        // Sell order: clearing price must be >= limit price (0.5 ether)
        clearingPrice = bound(clearingPrice, 0.5 ether, 10 ether);

        vm.prank(bob);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenB), address(tokenA),
            10 ether, 0.5 ether, block.timestamp + 1 days, false
        );

        // Pre-fund
        vm.prank(settler);
        tokenA.transfer(address(orderBook), 200 ether);

        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, clearingPrice);

        (, uint256 amountReceived,) = orderBook.getFillInfo(orderId);
        uint256 expectedOut = (10 ether * clearingPrice) / PRICE_PRECISION;
        assertEq(amountReceived, expectedOut);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle_placeAndFillAndClaim() public {
        // Alice buys tokenB with tokenA
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        // Pre-fund output
        vm.prank(settler);
        tokenB.transfer(address(orderBook), 20 ether);

        // Settler fills at clearing price of 1 ether (1:1)
        uint256[] memory orderIds = new uint256[](1);
        orderIds[0] = orderId;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        // Alice claims 10 tokenB
        uint256 aliceBalBefore = tokenB.balanceOf(alice);

        vm.prank(alice);
        orderBook.claimFilled(orderId);

        assertEq(tokenB.balanceOf(alice), aliceBalBefore + 10 ether);
    }

    function test_fullLifecycle_placeAndCancel() public {
        uint256 aliceBalBefore = tokenA.balanceOf(alice);

        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        // Alice's tokenA reduced by 10
        assertEq(tokenA.balanceOf(alice), aliceBalBefore - 10 ether);

        vm.prank(alice);
        orderBook.cancelOrder(orderId);

        // Alice's tokenA restored
        assertEq(tokenA.balanceOf(alice), aliceBalBefore);
    }

    function test_fullLifecycle_multipleUsersMultipleOrders() public {
        // Alice and Bob both place buy orders
        vm.prank(alice);
        uint256 id0 = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            10 ether, 2 ether, block.timestamp + 1 days, true
        );

        vm.prank(bob);
        uint256 id1 = orderBook.placeLimitOrder(
            address(tokenA), address(tokenB),
            5 ether, 1.5 ether, block.timestamp + 1 days, true
        );

        // Pre-fund
        vm.prank(settler);
        tokenB.transfer(address(orderBook), 30 ether);

        // Fill both at 1 ether
        uint256[] memory orderIds = new uint256[](2);
        orderIds[0] = id0;
        orderIds[1] = id1;

        vm.prank(settler);
        orderBook.fillOrders(orderIds, 1 ether);

        // Both claim
        vm.prank(alice);
        orderBook.claimFilled(id0);

        vm.prank(bob);
        orderBook.claimFilled(id1);

        // Verify amounts: clearing price 1e18, so 1:1
        (, uint256 aliceReceived,) = orderBook.getFillInfo(id0);
        (, uint256 bobReceived,) = orderBook.getFillInfo(id1);

        assertEq(aliceReceived, 10 ether);
        assertEq(bobReceived, 5 ether);
    }
}
