// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeSubscriptions.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibeSubscriptions Tests ============

contract VibeSubscriptionsTest is Test {
    VibeSubscriptions public subs;

    address public owner;
    address public alice;      // subscriber
    address public bob;        // subscriber 2
    address public merchant;

    uint256 public constant PLAN_PRICE  = 0.01 ether;
    uint256 public constant PLAN_PERIOD = 30 days;
    uint256 public constant PLATFORM_FEE_BPS = 200; // 2%

    // ============ Events ============

    event PlanCreated(uint256 indexed id, address merchant, string name, uint256 price, uint256 period);
    event Subscribed(uint256 indexed subId, address subscriber, uint256 planId);
    event PaymentProcessed(uint256 indexed subId, uint256 amount, uint256 paymentNumber);
    event Cancelled(uint256 indexed subId);
    event MerchantWithdraw(address indexed merchant, uint256 amount);

    // ============ Setup ============

    function setUp() public {
        owner    = address(this);
        alice    = makeAddr("alice");
        bob      = makeAddr("bob");
        merchant = makeAddr("merchant");

        VibeSubscriptions impl = new VibeSubscriptions();
        bytes memory initData = abi.encodeCall(VibeSubscriptions.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        subs = VibeSubscriptions(payable(address(proxy)));

        // Fund subscribers
        deal(alice, 100 ether);
        deal(bob,   100 ether);
    }

    // ============ Helpers ============

    function _createDefaultPlan() internal returns (uint256 planId) {
        vm.prank(merchant);
        subs.createPlan("Premium", PLAN_PRICE, PLAN_PERIOD);
        planId = subs.planCount() - 1; // planCount was incremented to 1, id=0
    }

    function _subscribe(address user, uint256 planId) internal returns (uint256 subId) {
        vm.prank(user);
        subs.subscribe{value: PLAN_PRICE}(planId);
        subId = subs.subCount() - 1;
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(subs.owner(), owner);
    }

    function test_initialize_zeroCounts() public view {
        assertEq(subs.planCount(), 0);
        assertEq(subs.subCount(),  0);
    }

    function test_initialize_platformFee() public view {
        assertEq(subs.PLATFORM_FEE_BPS(), PLATFORM_FEE_BPS);
    }

    // ============ createPlan ============

    function test_createPlan_storesPlan() public {
        _createDefaultPlan();
        VibeSubscriptions.Plan memory p = subs.getPlan(0);
        assertEq(p.merchant, merchant);
        assertEq(p.name,     "Premium");
        assertEq(p.price,    PLAN_PRICE);
        assertEq(p.period,   PLAN_PERIOD);
        assertTrue(p.active);
    }

    function test_createPlan_incrementsPlanCount() public {
        assertEq(subs.planCount(), 0);
        _createDefaultPlan();
        assertEq(subs.planCount(), 1);
    }

    function test_createPlan_addedToMerchantPlans() public {
        _createDefaultPlan();
        uint256[] memory mPlans = subs.getMerchantPlans(merchant);
        assertEq(mPlans.length, 1);
        assertEq(mPlans[0], 0);
    }

    function test_createPlan_multiplePlans() public {
        vm.startPrank(merchant);
        subs.createPlan("Basic",   0.005 ether, 30 days);
        subs.createPlan("Premium", 0.01 ether,  30 days);
        subs.createPlan("Pro",     0.05 ether,  7 days);
        vm.stopPrank();

        assertEq(subs.planCount(), 3);
        assertEq(subs.getMerchantPlans(merchant).length, 3);
    }

    function test_createPlan_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit PlanCreated(0, merchant, "Premium", PLAN_PRICE, PLAN_PERIOD);
        vm.prank(merchant);
        subs.createPlan("Premium", PLAN_PRICE, PLAN_PERIOD);
    }

    function test_createPlan_zeroPriceReverts() public {
        vm.prank(merchant);
        vm.expectRevert("Zero price");
        subs.createPlan("Bad", 0, 30 days);
    }

    function test_createPlan_periodTooShortReverts() public {
        vm.prank(merchant);
        vm.expectRevert("Min 1 day period");
        subs.createPlan("Bad", PLAN_PRICE, 1 hours); // < 1 day
    }

    // ============ deactivatePlan ============

    function test_deactivatePlan_setsInactive() public {
        _createDefaultPlan();
        vm.prank(merchant);
        subs.deactivatePlan(0);
        assertFalse(subs.getPlan(0).active);
    }

    function test_deactivatePlan_notMerchant_reverts() public {
        _createDefaultPlan();
        vm.prank(alice);
        vm.expectRevert("Not merchant");
        subs.deactivatePlan(0);
    }

    // ============ subscribe ============

    function test_subscribe_storesSubscription() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        VibeSubscriptions.Subscription memory s = subs.getSubscription(subId);
        assertEq(s.subscriber,    alice);
        assertEq(s.planId,        planId);
        assertEq(s.totalPaid,     PLAN_PRICE);
        assertEq(s.paymentCount,  1);
        assertTrue(s.active);
    }

    function test_subscribe_incrementsSubCount() public {
        uint256 planId = _createDefaultPlan();
        assertEq(subs.subCount(), 0);
        _subscribe(alice, planId);
        assertEq(subs.subCount(), 1);
    }

    function test_subscribe_addedToUserSubs() public {
        uint256 planId = _createDefaultPlan();
        _subscribe(alice, planId);
        uint256[] memory uSubs = subs.getUserSubs(alice);
        assertEq(uSubs.length, 1);
        assertEq(uSubs[0], 0);
    }

    function test_subscribe_chargesMerchantMinusFee() public {
        uint256 planId = _createDefaultPlan();
        _subscribe(alice, planId);

        uint256 fee = (PLAN_PRICE * PLATFORM_FEE_BPS) / 10000;
        uint256 net = PLAN_PRICE - fee;
        assertEq(subs.merchantBalances(merchant), net);
    }

    function test_subscribe_refundsExcess() public {
        uint256 planId = _createDefaultPlan();
        uint256 excess = 0.005 ether;
        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        subs.subscribe{value: PLAN_PRICE + excess}(planId);

        // alice pays PLAN_PRICE net
        assertEq(alice.balance, aliceBefore - PLAN_PRICE);
    }

    function test_subscribe_emitsEvents() public {
        uint256 planId = _createDefaultPlan();

        vm.expectEmit(true, false, false, true);
        emit Subscribed(0, alice, planId);
        vm.prank(alice);
        subs.subscribe{value: PLAN_PRICE}(planId);
    }

    function test_subscribe_inactivePlan_reverts() public {
        uint256 planId = _createDefaultPlan();
        vm.prank(merchant);
        subs.deactivatePlan(planId);

        vm.prank(alice);
        vm.expectRevert("Plan not active");
        subs.subscribe{value: PLAN_PRICE}(planId);
    }

    function test_subscribe_insufficientPayment_reverts() public {
        uint256 planId = _createDefaultPlan();
        vm.prank(alice);
        vm.expectRevert("Insufficient payment");
        subs.subscribe{value: PLAN_PRICE - 1}(planId);
    }

    function test_subscribe_multipleUsersToSamePlan() public {
        uint256 planId = _createDefaultPlan();
        _subscribe(alice, planId);
        _subscribe(bob,   planId);

        assertEq(subs.subCount(), 2);

        uint256 fee = (PLAN_PRICE * PLATFORM_FEE_BPS) / 10000;
        uint256 net = PLAN_PRICE - fee;
        // merchant accumulates 2x net
        assertEq(subs.merchantBalances(merchant), net * 2);
    }

    // ============ processPayment ============

    function test_processPayment_afterPeriod_succeeds() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.warp(block.timestamp + PLAN_PERIOD + 1);
        vm.prank(alice);
        subs.processPayment{value: PLAN_PRICE}(subId);

        VibeSubscriptions.Subscription memory s = subs.getSubscription(subId);
        assertEq(s.paymentCount, 2);
        assertEq(s.totalPaid,    PLAN_PRICE * 2);
    }

    function test_processPayment_updatesMerchantBalance() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        uint256 fee = (PLAN_PRICE * PLATFORM_FEE_BPS) / 10000;
        uint256 net = PLAN_PRICE - fee;
        uint256 balBefore = subs.merchantBalances(merchant); // = net from subscribe

        vm.warp(block.timestamp + PLAN_PERIOD + 1);
        vm.prank(alice);
        subs.processPayment{value: PLAN_PRICE}(subId);

        assertEq(subs.merchantBalances(merchant), balBefore + net);
    }

    function test_processPayment_emitsEvent() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.warp(block.timestamp + PLAN_PERIOD + 1);
        vm.expectEmit(true, false, false, true);
        emit PaymentProcessed(subId, PLAN_PRICE, 2);
        vm.prank(alice);
        subs.processPayment{value: PLAN_PRICE}(subId);
    }

    function test_processPayment_tooSoon_reverts() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.prank(alice);
        vm.expectRevert("Too soon");
        subs.processPayment{value: PLAN_PRICE}(subId);
    }

    function test_processPayment_notSubscriber_reverts() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.warp(block.timestamp + PLAN_PERIOD + 1);
        vm.prank(bob);
        vm.expectRevert("Only subscriber can pay");
        subs.processPayment{value: PLAN_PRICE}(subId);
    }

    function test_processPayment_insufficientValue_reverts() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.warp(block.timestamp + PLAN_PERIOD + 1);
        vm.prank(alice);
        vm.expectRevert("Insufficient payment");
        subs.processPayment{value: PLAN_PRICE - 1}(subId);
    }

    function test_processPayment_cancelledSub_reverts() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.prank(alice); subs.cancel(subId);

        vm.warp(block.timestamp + PLAN_PERIOD + 1);
        vm.prank(alice);
        vm.expectRevert("Not active");
        subs.processPayment{value: PLAN_PRICE}(subId);
    }

    // ============ cancel ============

    function test_cancel_deactivatesSub() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.prank(alice);
        subs.cancel(subId);

        assertFalse(subs.getSubscription(subId).active);
    }

    function test_cancel_emitsEvent() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.expectEmit(true, false, false, false);
        emit Cancelled(subId);
        vm.prank(alice);
        subs.cancel(subId);
    }

    function test_cancel_notSubscriber_reverts() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.prank(bob);
        vm.expectRevert("Not subscriber");
        subs.cancel(subId);
    }

    // ============ withdrawMerchant ============

    function test_withdrawMerchant_sendsETH() public {
        uint256 planId = _createDefaultPlan();
        _subscribe(alice, planId);

        uint256 fee = (PLAN_PRICE * PLATFORM_FEE_BPS) / 10000;
        uint256 net = PLAN_PRICE - fee;

        uint256 merchantBefore = merchant.balance;
        vm.prank(merchant);
        subs.withdrawMerchant();

        assertEq(merchant.balance, merchantBefore + net);
    }

    function test_withdrawMerchant_clearsBalance() public {
        uint256 planId = _createDefaultPlan();
        _subscribe(alice, planId);

        vm.prank(merchant);
        subs.withdrawMerchant();

        assertEq(subs.merchantBalances(merchant), 0);
    }

    function test_withdrawMerchant_emitsEvent() public {
        uint256 planId = _createDefaultPlan();
        _subscribe(alice, planId);

        uint256 fee = (PLAN_PRICE * PLATFORM_FEE_BPS) / 10000;
        uint256 net = PLAN_PRICE - fee;

        vm.expectEmit(true, false, false, true);
        emit MerchantWithdraw(merchant, net);
        vm.prank(merchant);
        subs.withdrawMerchant();
    }

    function test_withdrawMerchant_noBalance_reverts() public {
        vm.prank(merchant);
        vm.expectRevert("No balance");
        subs.withdrawMerchant();
    }

    function test_withdrawMerchant_doubleWithdraw_reverts() public {
        uint256 planId = _createDefaultPlan();
        _subscribe(alice, planId);

        vm.prank(merchant); subs.withdrawMerchant();

        vm.prank(merchant);
        vm.expectRevert("No balance");
        subs.withdrawMerchant();
    }

    // ============ isDue ============

    function test_isDue_falseBeforePeriod() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);
        assertFalse(subs.isDue(subId));
    }

    function test_isDue_trueAfterPeriod() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.warp(block.timestamp + PLAN_PERIOD + 1);
        assertTrue(subs.isDue(subId));
    }

    function test_isDue_falseAfterCancel() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        vm.prank(alice); subs.cancel(subId);
        vm.warp(block.timestamp + PLAN_PERIOD + 1);
        assertFalse(subs.isDue(subId));
    }

    // ============ Full lifecycle ============

    function test_fullLifecycle_threePayments() public {
        uint256 planId = _createDefaultPlan();
        uint256 subId  = _subscribe(alice, planId);

        for (uint256 i = 0; i < 2; i++) {
            vm.warp(block.timestamp + PLAN_PERIOD + 1);
            vm.prank(alice);
            subs.processPayment{value: PLAN_PRICE}(subId);
        }

        VibeSubscriptions.Subscription memory s = subs.getSubscription(subId);
        assertEq(s.paymentCount, 3); // 1 initial + 2 recurring
        assertEq(s.totalPaid,    PLAN_PRICE * 3);

        vm.prank(alice); subs.cancel(subId);
        assertFalse(subs.getSubscription(subId).active);
    }

    // ============ Fuzz ============

    function testFuzz_createPlan_validParams(uint256 price, uint256 period) public {
        price  = bound(price,  1, 100 ether);
        period = bound(period, 1 days, 365 days);

        vm.prank(merchant);
        subs.createPlan("Plan", price, period);

        VibeSubscriptions.Plan memory p = subs.getPlan(0);
        assertEq(p.price,  price);
        assertEq(p.period, period);
    }

    function testFuzz_subscribe_exactPrice(uint256 price) public {
        price = bound(price, 1, 10 ether);
        deal(alice, price);

        vm.prank(merchant);
        subs.createPlan("Plan", price, 30 days);

        vm.prank(alice);
        subs.subscribe{value: price}(0);

        uint256 fee = (price * PLATFORM_FEE_BPS) / 10000;
        uint256 net = price - fee;
        assertEq(subs.merchantBalances(merchant), net);
    }
}
