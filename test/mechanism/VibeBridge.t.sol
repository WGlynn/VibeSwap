// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ VibeBridge Tests ============

contract VibeBridgeTest is Test {
    VibeBridge public bridge;
    MockToken public tokenA;

    address public owner;
    address public alice;
    address public bob;
    address public validator1;
    address public validator2;
    address public validator3;

    uint256 constant SRC_CHAIN  = 1;
    uint256 constant DST_CHAIN  = 137;
    uint256 constant DAILY_LIMIT = 1_000_000 ether;
    uint256 constant MIN_AMOUNT  = 1 ether;
    uint256 constant MAX_AMOUNT  = 100_000 ether;

    // ============ Events ============

    event BridgeInitiated(bytes32 indexed messageId, address indexed sender, address token, uint256 amount, uint256 dstChainId);
    event BridgeAttested(bytes32 indexed messageId, address indexed validator);
    event BridgeExecuted(bytes32 indexed messageId, address indexed recipient, uint256 amount);
    event BridgeRefunded(bytes32 indexed messageId, address indexed sender, uint256 amount);
    event RouteAdded(bytes32 indexed routeId, uint256 srcChain, uint256 dstChain);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    // ============ Setup ============

    function setUp() public {
        owner      = address(this);
        alice      = makeAddr("alice");
        bob        = makeAddr("bob");
        validator1 = makeAddr("validator1");
        validator2 = makeAddr("validator2");
        validator3 = makeAddr("validator3");

        tokenA = new MockToken("Token A", "TKA");

        VibeBridge impl = new VibeBridge();
        bytes memory initData = abi.encodeCall(VibeBridge.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        bridge = VibeBridge(payable(address(proxy)));

        // Add three validators (BFT threshold = ceil(3*2/3) = 2)
        bridge.addValidator(validator1);
        bridge.addValidator(validator2);
        bridge.addValidator(validator3);

        tokenA.mint(alice, 1_000_000 ether);
        tokenA.mint(address(bridge), 500_000 ether); // pre-fund bridge for executeB side

        vm.prank(alice);
        tokenA.approve(address(bridge), type(uint256).max);
    }

    // ============ Helpers ============

    function _addDefaultRoute() internal returns (bytes32 routeId) {
        routeId = bridge.addRoute(
            SRC_CHAIN, DST_CHAIN,
            address(tokenA), address(tokenA),
            DAILY_LIMIT, MIN_AMOUNT, MAX_AMOUNT, 0
        );
    }

    function _initiateBridge(address sender, bytes32 routeId, address recipient, uint256 amount)
        internal returns (bytes32 messageId)
    {
        vm.prank(sender);
        messageId = bridge.bridge(routeId, recipient, amount);
    }

    function _attest(bytes32 messageId, address validator) internal {
        vm.prank(validator);
        bridge.attest(messageId);
    }

    function _reachBFT(bytes32 messageId) internal {
        // 2 out of 3 validators = threshold
        _attest(messageId, validator1);
        _attest(messageId, validator2);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(bridge.owner(), owner);
    }

    function test_initialize_zeroMessageNonce() public view {
        assertEq(bridge.messageNonce(), 0);
    }

    function test_initialize_constants() public view {
        assertEq(bridge.BFT_THRESHOLD_NUM(), 2);
        assertEq(bridge.BFT_THRESHOLD_DEN(), 3);
        assertEq(bridge.MAX_BRIDGE_DELAY(), 24 hours);
    }

    // ============ Route Management ============

    function test_addRoute_storesRoute() public {
        bytes32 routeId = _addDefaultRoute();

        (
            uint256 srcChainId,
            uint256 dstChainId,
            address srcToken,
            address dstToken,
            uint256 dailyLimit,
            ,
            ,
            uint256 minAmount,
            uint256 maxAmount,
            uint256 feeBps,
            bool active
        ) = bridge.routes(routeId);

        assertEq(srcChainId,  SRC_CHAIN);
        assertEq(dstChainId,  DST_CHAIN);
        assertEq(srcToken,    address(tokenA));
        assertEq(dstToken,    address(tokenA));
        assertEq(dailyLimit,  DAILY_LIMIT);
        assertEq(minAmount,   MIN_AMOUNT);
        assertEq(maxAmount,   MAX_AMOUNT);
        assertEq(feeBps,      0); // zero fee invariant
        assertTrue(active);
    }

    function test_addRoute_emitsEvent() public {
        bytes32 routeId = keccak256(abi.encodePacked(SRC_CHAIN, DST_CHAIN, address(tokenA), address(tokenA)));

        vm.expectEmit(true, false, false, true);
        emit RouteAdded(routeId, SRC_CHAIN, DST_CHAIN);

        bridge.addRoute(SRC_CHAIN, DST_CHAIN, address(tokenA), address(tokenA),
            DAILY_LIMIT, MIN_AMOUNT, MAX_AMOUNT, 0);
    }

    function test_addRoute_incrementsRouteList() public {
        assertEq(bridge.getRouteCount(), 0);
        _addDefaultRoute();
        assertEq(bridge.getRouteCount(), 1);
    }

    function test_addRoute_feeBpsAlwaysZero() public {
        // Even if caller passes feeBps > 0, contract enforces 0 (no-extraction)
        bytes32 routeId = bridge.addRoute(
            SRC_CHAIN, DST_CHAIN, address(tokenA), address(tokenA),
            DAILY_LIMIT, MIN_AMOUNT, MAX_AMOUNT, 500 // caller tries to set 5%
        );

        (, , , , , , , , , uint256 feeBps, ) = bridge.routes(routeId);
        assertEq(feeBps, 0);
    }

    function test_addRoute_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        bridge.addRoute(SRC_CHAIN, DST_CHAIN, address(tokenA), address(tokenA),
            DAILY_LIMIT, MIN_AMOUNT, MAX_AMOUNT, 0);
    }

    // ============ Validator Management ============

    function test_addValidator_registers() public {
        address newVal = makeAddr("newVal");
        bridge.addValidator(newVal);
        assertTrue(bridge.validators(newVal));
        assertEq(bridge.getValidatorCount(), 4);
    }

    function test_addValidator_emitsEvent() public {
        address newVal = makeAddr("newVal");
        vm.expectEmit(true, false, false, false);
        emit ValidatorAdded(newVal);
        bridge.addValidator(newVal);
    }

    function test_removeValidator_revokes() public {
        bridge.removeValidator(validator3);
        assertFalse(bridge.validators(validator3));
        // validatorList length still 3 (list is not shrunk), but mapping is false
        assertEq(bridge.getValidatorCount(), 3);
    }

    function test_addRemoveValidator_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        bridge.addValidator(makeAddr("x"));

        vm.prank(alice);
        vm.expectRevert();
        bridge.removeValidator(validator1);
    }

    // ============ Bridge Initiation ============

    function test_bridge_locksTokens() public {
        bytes32 routeId = _addDefaultRoute();
        uint256 amount  = 100 ether;
        uint256 balBefore = tokenA.balanceOf(address(bridge));

        _initiateBridge(alice, routeId, bob, amount);

        assertEq(tokenA.balanceOf(address(bridge)), balBefore + amount);
    }

    function test_bridge_createsMessage() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId = _initiateBridge(alice, routeId, bob, 100 ether);

        VibeBridge.BridgeMessage memory m = bridge.getMessage(msgId);
        assertEq(m.sender,    alice);
        assertEq(m.recipient, bob);
        assertEq(m.amount,    100 ether); // feeBps = 0, amount unchanged
        assertEq(uint8(m.status), uint8(VibeBridge.BridgeStatus.PENDING));
        assertEq(m.attestationCount, 0);
        assertEq(m.dstChainId, DST_CHAIN);
    }

    function test_bridge_incrementsNonce() public {
        bytes32 routeId = _addDefaultRoute();
        assertEq(bridge.messageNonce(), 0);

        _initiateBridge(alice, routeId, bob, 100 ether);
        assertEq(bridge.messageNonce(), 1);

        _initiateBridge(alice, routeId, bob, 100 ether);
        assertEq(bridge.messageNonce(), 2);
    }

    function test_bridge_tracksTotalVolume() public {
        bytes32 routeId = _addDefaultRoute();
        assertEq(bridge.totalBridgedVolume(), 0);

        _initiateBridge(alice, routeId, bob, 100 ether);
        assertEq(bridge.totalBridgedVolume(), 100 ether);

        _initiateBridge(alice, routeId, bob, 50 ether);
        assertEq(bridge.totalBridgedVolume(), 150 ether);
    }

    function test_bridge_emitsEvent() public {
        bytes32 routeId = _addDefaultRoute();
        uint256 amount  = 100 ether;

        // We can't know the messageId in advance, so just check the event fires
        vm.prank(alice);
        vm.expectEmit(false, true, false, false);
        emit BridgeInitiated(bytes32(0), alice, address(tokenA), amount, DST_CHAIN);
        bridge.bridge(routeId, bob, amount);
    }

    function test_bridge_routeNotActive_reverts() public {
        bytes32 fakeRouteId = keccak256("nonexistent");
        vm.prank(alice);
        vm.expectRevert("Route not active");
        bridge.bridge(fakeRouteId, bob, 100 ether);
    }

    function test_bridge_amountBelowMin_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        vm.prank(alice);
        vm.expectRevert("Amount out of range");
        bridge.bridge(routeId, bob, MIN_AMOUNT - 1);
    }

    function test_bridge_amountAboveMax_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        vm.prank(alice);
        vm.expectRevert("Amount out of range");
        bridge.bridge(routeId, bob, MAX_AMOUNT + 1);
    }

    function test_bridge_dailyLimitEnforced() public {
        bytes32 routeId = bridge.addRoute(
            SRC_CHAIN, DST_CHAIN, address(tokenA), address(tokenA),
            150 ether, // daily limit = 150
            1 ether, 200 ether, 0
        );

        _initiateBridge(alice, routeId, bob, 100 ether); // OK, 100/150 used

        // Next 100 would exceed 150 daily limit
        vm.prank(alice);
        vm.expectRevert("Daily limit exceeded");
        bridge.bridge(routeId, bob, 100 ether);
    }

    function test_bridge_dailyLimitResetsAfter24h() public {
        bytes32 routeId = bridge.addRoute(
            SRC_CHAIN, DST_CHAIN, address(tokenA), address(tokenA),
            100 ether, 1 ether, 200 ether, 0
        );

        _initiateBridge(alice, routeId, bob, 100 ether); // fills daily

        // Advance past 24h
        vm.warp(block.timestamp + 1 days + 1);

        // Should succeed (reset)
        _initiateBridge(alice, routeId, bob, 100 ether);
    }

    function test_bridge_ETH_locksValue() public {
        bytes32 routeId = bridge.addRoute(
            SRC_CHAIN, DST_CHAIN,
            address(0), address(0), // ETH route
            DAILY_LIMIT, 1 ether, 100 ether, 0
        );

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        bridge.bridge{value: 5 ether}(routeId, bob, 5 ether);

        assertEq(address(bridge).balance, 5 ether);
    }

    function test_bridge_ETH_insufficientValue_reverts() public {
        bytes32 routeId = bridge.addRoute(
            SRC_CHAIN, DST_CHAIN, address(0), address(0),
            DAILY_LIMIT, 1 ether, 100 ether, 0
        );
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert("Insufficient ETH");
        bridge.bridge{value: 4 ether}(routeId, bob, 5 ether);
    }

    // ============ Attestation ============

    function test_attest_incrementsCount() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        _attest(msgId, validator1);

        VibeBridge.BridgeMessage memory m = bridge.getMessage(msgId);
        assertEq(m.attestationCount, 1);
        assertEq(uint8(m.status), uint8(VibeBridge.BridgeStatus.PENDING));
    }

    function test_attest_bftThreshold_changesStatus() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        _reachBFT(msgId); // 2 of 3 validators

        VibeBridge.BridgeMessage memory m = bridge.getMessage(msgId);
        assertEq(uint8(m.status), uint8(VibeBridge.BridgeStatus.ATTESTED));
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.ATTESTED));
    }

    function test_attest_emitsEvent() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        vm.expectEmit(true, true, false, false);
        emit BridgeAttested(msgId, validator1);
        vm.prank(validator1);
        bridge.attest(msgId);
    }

    function test_attest_notValidator_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        vm.prank(alice); // not a validator
        vm.expectRevert("Not a validator");
        bridge.attest(msgId);
    }

    function test_attest_doubleAttest_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        _attest(msgId, validator1);

        vm.prank(validator1);
        vm.expectRevert("Already attested");
        bridge.attest(msgId);
    }

    function test_attest_notPending_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);
        _reachBFT(msgId); // now ATTESTED

        vm.prank(validator3);
        vm.expectRevert("Not pending");
        bridge.attest(msgId);
    }

    // ============ Execute Bridge ============

    function test_executeBridge_transfersTokens() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);
        _reachBFT(msgId);

        uint256 bobBefore = tokenA.balanceOf(bob);
        bridge.executeBridge(msgId);

        assertEq(tokenA.balanceOf(bob), bobBefore + 100 ether);
    }

    function test_executeBridge_changesStatus() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);
        _reachBFT(msgId);

        bridge.executeBridge(msgId);

        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.EXECUTED));
    }

    function test_executeBridge_emitsEvent() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);
        _reachBFT(msgId);

        vm.expectEmit(true, true, false, true);
        emit BridgeExecuted(msgId, bob, 100 ether);
        bridge.executeBridge(msgId);
    }

    function test_executeBridge_notAttested_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);
        // Only 1 attestation, below threshold
        _attest(msgId, validator1);

        vm.expectRevert("Not attested");
        bridge.executeBridge(msgId);
    }

    function test_executeBridge_double_execute_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);
        _reachBFT(msgId);

        bridge.executeBridge(msgId);

        vm.expectRevert("Not attested");
        bridge.executeBridge(msgId);
    }

    function test_executeBridge_ETH_transfersValue() public {
        bytes32 routeId = bridge.addRoute(
            SRC_CHAIN, DST_CHAIN, address(0), address(0),
            DAILY_LIMIT, 1 ether, 100 ether, 0
        );

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        bytes32 msgId = bridge.bridge{value: 5 ether}(routeId, bob, 5 ether);

        _reachBFT(msgId);

        uint256 bobBefore = bob.balance;
        bridge.executeBridge(msgId);
        assertEq(bob.balance, bobBefore + 5 ether);
    }

    // ============ Refund ============

    function test_refund_returnsTokensAfterDelay() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        vm.warp(block.timestamp + 24 hours + 1);

        uint256 aliceBefore = tokenA.balanceOf(alice);
        bridge.refund(msgId);

        assertEq(tokenA.balanceOf(alice), aliceBefore + 100 ether);
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.REFUNDED));
    }

    function test_refund_emitsEvent() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.expectEmit(true, true, false, true);
        emit BridgeRefunded(msgId, alice, 100 ether);
        bridge.refund(msgId);
    }

    function test_refund_notExpired_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        vm.expectRevert("Not expired");
        bridge.refund(msgId);
    }

    function test_refund_notPending_reverts() public {
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);
        _reachBFT(msgId);
        bridge.executeBridge(msgId); // now EXECUTED

        vm.warp(block.timestamp + 24 hours + 1);

        vm.expectRevert("Not pending");
        bridge.refund(msgId);
    }

    function test_refund_ETH_returnsValue() public {
        bytes32 routeId = bridge.addRoute(
            SRC_CHAIN, DST_CHAIN, address(0), address(0),
            DAILY_LIMIT, 1 ether, 100 ether, 0
        );

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        bytes32 msgId = bridge.bridge{value: 5 ether}(routeId, bob, 5 ether);

        vm.warp(block.timestamp + 24 hours + 1);

        uint256 aliceBefore = alice.balance;
        bridge.refund(msgId);
        assertEq(alice.balance, aliceBefore + 5 ether);
    }

    // ============ BFT Threshold Math ============

    function test_bftThreshold_2of3() public {
        // Already 3 validators in setUp — need 2
        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        _attest(msgId, validator1); // count=1, threshold=2 → still PENDING
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.PENDING));

        _attest(msgId, validator2); // count=2, threshold=2 → ATTESTED
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.ATTESTED));
    }

    function test_bftThreshold_3of4() public {
        // Add a 4th validator → threshold = ceil(4*2/3) = 3
        bridge.addValidator(makeAddr("v4"));

        bytes32 routeId = _addDefaultRoute();
        bytes32 msgId   = _initiateBridge(alice, routeId, bob, 100 ether);

        _attest(msgId, validator1); // 1/3
        _attest(msgId, validator2); // 2/3 → still PENDING
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.PENDING));

        _attest(msgId, validator3); // 3/3 → ATTESTED
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.ATTESTED));
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle_happyPath() public {
        bytes32 routeId = _addDefaultRoute();

        // 1. Initiate
        bytes32 msgId = _initiateBridge(alice, routeId, bob, 500 ether);
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.PENDING));

        // 2. Two validators attest
        _reachBFT(msgId);
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.ATTESTED));

        // 3. Execute on destination side
        uint256 bobBefore = tokenA.balanceOf(bob);
        bridge.executeBridge(msgId);
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.EXECUTED));
        assertEq(tokenA.balanceOf(bob), bobBefore + 500 ether);
    }

    function test_fullLifecycle_refundPath() public {
        bytes32 routeId = _addDefaultRoute();

        // 1. Initiate but no attestations
        bytes32 msgId = _initiateBridge(alice, routeId, bob, 500 ether);

        // 2. Wait out delay
        vm.warp(block.timestamp + 24 hours + 1);

        // 3. Refund
        uint256 aliceBefore = tokenA.balanceOf(alice);
        bridge.refund(msgId);
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.REFUNDED));
        assertEq(tokenA.balanceOf(alice), aliceBefore + 500 ether);
    }

    // ============ Fuzz ============

    function testFuzz_bridge_amountInRange(uint256 amount) public {
        amount = bound(amount, MIN_AMOUNT, MAX_AMOUNT);
        bytes32 routeId = _addDefaultRoute();
        tokenA.mint(alice, amount);

        bytes32 msgId = _initiateBridge(alice, routeId, bob, amount);
        assertEq(uint8(bridge.getMessageStatus(msgId)), uint8(VibeBridge.BridgeStatus.PENDING));

        VibeBridge.BridgeMessage memory m = bridge.getMessage(msgId);
        assertEq(m.amount, amount); // zero fee, always exact
    }
}
