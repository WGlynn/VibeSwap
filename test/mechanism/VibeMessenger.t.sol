// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeMessenger.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VibeMessengerTest
 * @notice Unit tests for VibeMessenger (cross-chain messaging + Push Protocol alternative)
 *
 * Coverage:
 *   - Initialization: requiredAttestations, minSendStake
 *   - Channel creation: id increment, state, event
 *   - Subscribe/unsubscribe: flags, subscriber count, events, guards
 *   - sendMessage (channel): owner-only broadcast
 *   - sendMessage (direct): DM opt-in guard, allowDirectMessages toggle
 *   - acknowledgeDelivery: recipient sets delivered, event
 *   - sendCrossChain: creates message + relay record, event
 *   - attestRelay: validator-only, counter, threshold triggers executed
 *   - Validator management: addValidator, removeValidator (onlyOwner)
 *   - UUPS upgrade: only owner
 */
contract VibeMessengerTest is Test {
    VibeMessenger public messenger;
    VibeMessenger public impl;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public validator1;
    address public validator2;
    address public validator3;

    // ============ Events ============

    event ChannelCreated(uint256 indexed channelId, address indexed owner, string name);
    event Subscribed(uint256 indexed channelId, address indexed subscriber);
    event Unsubscribed(uint256 indexed channelId, address indexed subscriber);
    event MessageSent(uint256 indexed messageId, address indexed sender, uint256 channelId, address recipient);
    event MessageDelivered(uint256 indexed messageId);
    event CrossChainRelayed(bytes32 indexed relayId, uint256 srcChain, uint256 dstChain);
    event RelayAttested(bytes32 indexed relayId, address indexed validator);

    uint256 constant REQUIRED_ATTESTATIONS = 2;

    function setUp() public {
        owner     = makeAddr("owner");
        alice     = makeAddr("alice");
        bob       = makeAddr("bob");
        carol     = makeAddr("carol");
        validator1 = makeAddr("validator1");
        validator2 = makeAddr("validator2");
        validator3 = makeAddr("validator3");

        impl = new VibeMessenger();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeMessenger.initialize, (REQUIRED_ATTESTATIONS))
        );
        messenger = VibeMessenger(payable(address(proxy)));

        // Add validators via proxy owner
        address proxyOwner = messenger.owner();
        vm.startPrank(proxyOwner);
        messenger.addValidator(validator1);
        messenger.addValidator(validator2);
        messenger.addValidator(validator3);
        vm.stopPrank();
    }

    // ============ Helpers ============

    function _createChannel(address channelOwner) internal returns (uint256) {
        vm.prank(channelOwner);
        return messenger.createChannel("VibeNews", "Official VibeSwap news");
    }

    // ============ Initialization ============

    function test_initialize_state() public view {
        assertEq(messenger.channelCount(), 0);
        assertEq(messenger.messageCount(), 0);
        assertEq(messenger.requiredAttestations(), REQUIRED_ATTESTATIONS);
        assertEq(messenger.minSendStake(), 0);
    }

    function test_initialize_validators() public view {
        assertTrue(messenger.validators(validator1));
        assertTrue(messenger.validators(validator2));
        assertTrue(messenger.validators(validator3));
        assertEq(messenger.validatorCount(), 3);
    }

    // ============ Channel Creation ============

    function test_createChannel_basic() public {
        uint256 id = _createChannel(alice);
        assertEq(id, 1);
        assertEq(messenger.channelCount(), 1);
        assertEq(messenger.getChannelCount(), 1);

        VibeMessenger.Channel memory ch = messenger.getChannel(1);
        assertEq(ch.channelId, 1);
        assertEq(ch.owner, alice);
        assertEq(ch.subscriberCount, 0);
        assertEq(ch.messageCount, 0);
        assertTrue(ch.active);
        assertGt(ch.createdAt, 0);
    }

    function test_createChannel_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ChannelCreated(1, alice, "VibeNews");
        messenger.createChannel("VibeNews", "desc");
    }

    function test_createChannel_multiple() public {
        _createChannel(alice);
        _createChannel(bob);
        assertEq(messenger.channelCount(), 2);
    }

    // ============ Subscribe / Unsubscribe ============

    function test_subscribe_basic() public {
        _createChannel(alice);

        vm.prank(bob);
        messenger.subscribe(1);

        assertTrue(messenger.subscriptions(1, bob));
        assertEq(messenger.getChannel(1).subscriberCount, 1);
        assertTrue(messenger.isSubscribed(1, bob));
    }

    function test_subscribe_emitsEvent() public {
        _createChannel(alice);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit Subscribed(1, bob);
        messenger.subscribe(1);
    }

    function test_subscribe_revert_channelNotActive() public {
        // Channel 999 doesn't exist (active == false by default)
        vm.prank(bob);
        vm.expectRevert("Channel not active");
        messenger.subscribe(999);
    }

    function test_subscribe_revert_alreadySubscribed() public {
        _createChannel(alice);

        vm.prank(bob);
        messenger.subscribe(1);

        vm.prank(bob);
        vm.expectRevert("Already subscribed");
        messenger.subscribe(1);
    }

    function test_unsubscribe_basic() public {
        _createChannel(alice);

        vm.prank(bob);
        messenger.subscribe(1);

        vm.prank(bob);
        messenger.unsubscribe(1);

        assertFalse(messenger.subscriptions(1, bob));
        assertEq(messenger.getChannel(1).subscriberCount, 0);
        assertFalse(messenger.isSubscribed(1, bob));
    }

    function test_unsubscribe_emitsEvent() public {
        _createChannel(alice);

        vm.prank(bob);
        messenger.subscribe(1);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit Unsubscribed(1, bob);
        messenger.unsubscribe(1);
    }

    function test_unsubscribe_revert_notSubscribed() public {
        _createChannel(alice);

        vm.prank(bob);
        vm.expectRevert("Not subscribed");
        messenger.unsubscribe(1);
    }

    // ============ Send Message (Channel Broadcast) ============

    function test_sendMessage_channelBroadcast() public {
        _createChannel(alice);

        bytes32 contentHash = keccak256("news post");
        vm.prank(alice); // channel owner
        uint256 msgId = messenger.sendMessage(1, address(0), contentHash);

        assertEq(msgId, 1);
        assertEq(messenger.messageCount(), 1);
        assertEq(messenger.getMessageCount(), 1);

        VibeMessenger.Message memory m = messenger.getMessage(1);
        assertEq(m.messageId, 1);
        assertEq(m.sender, alice);
        assertEq(m.channelId, 1);
        assertEq(m.recipient, address(0));
        assertEq(m.contentHash, contentHash);
        assertFalse(m.delivered);
    }

    function test_sendMessage_channelBroadcast_incrementsChannelMessageCount() public {
        _createChannel(alice);

        vm.prank(alice);
        messenger.sendMessage(1, address(0), keccak256("msg"));

        assertEq(messenger.getChannel(1).messageCount, 1);
    }

    function test_sendMessage_channelBroadcast_emitsEvent() public {
        _createChannel(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit MessageSent(1, alice, 1, address(0));
        messenger.sendMessage(1, address(0), keccak256("msg"));
    }

    function test_sendMessage_channelBroadcast_revert_notChannelOwner() public {
        _createChannel(alice);

        vm.prank(bob);
        vm.expectRevert("Not channel owner");
        messenger.sendMessage(1, address(0), keccak256("msg"));
    }

    // ============ Send Message (Direct) ============

    function test_sendMessage_direct_requiresDMsEnabled() public {
        // bob has not opted in to DMs
        vm.prank(alice);
        vm.expectRevert("DMs not allowed");
        messenger.sendMessage(0, bob, keccak256("hi bob"));
    }

    function test_sendMessage_direct_allowed() public {
        // bob opts in
        vm.prank(bob);
        messenger.setAllowDirectMessages(true);

        vm.prank(alice);
        uint256 msgId = messenger.sendMessage(0, bob, keccak256("hi bob"));

        assertEq(msgId, 1);
        VibeMessenger.Message memory m = messenger.getMessage(1);
        assertEq(m.recipient, bob);
        assertEq(m.channelId, 0);
    }

    function test_setAllowDirectMessages_toggles() public {
        assertFalse(messenger.allowDirectMessages(bob));

        vm.prank(bob);
        messenger.setAllowDirectMessages(true);
        assertTrue(messenger.allowDirectMessages(bob));

        vm.prank(bob);
        messenger.setAllowDirectMessages(false);
        assertFalse(messenger.allowDirectMessages(bob));
    }

    // ============ Acknowledge Delivery ============

    function test_acknowledgeDelivery_byRecipient() public {
        vm.prank(bob);
        messenger.setAllowDirectMessages(true);

        vm.prank(alice);
        messenger.sendMessage(0, bob, keccak256("msg"));

        vm.prank(bob);
        messenger.acknowledgeDelivery(1);

        assertTrue(messenger.getMessage(1).delivered);
        assertTrue(messenger.deliveryReceipts(1));
    }

    function test_acknowledgeDelivery_emitsEvent() public {
        vm.prank(bob);
        messenger.setAllowDirectMessages(true);

        vm.prank(alice);
        messenger.sendMessage(0, bob, keccak256("msg"));

        vm.prank(bob);
        vm.expectEmit(true, false, false, false);
        emit MessageDelivered(1);
        messenger.acknowledgeDelivery(1);
    }

    function test_acknowledgeDelivery_byAnyoneForChannelMessage() public {
        _createChannel(alice);

        vm.prank(alice);
        messenger.sendMessage(1, address(0), keccak256("broadcast"));

        // Anyone can acknowledge a channel message (channelId > 0)
        vm.prank(carol);
        messenger.acknowledgeDelivery(1);

        assertTrue(messenger.deliveryReceipts(1));
    }

    function test_acknowledgeDelivery_revert_notRecipient() public {
        vm.prank(bob);
        messenger.setAllowDirectMessages(true);

        vm.prank(alice);
        messenger.sendMessage(0, bob, keccak256("msg"));

        // carol is not the recipient, message is direct (channelId == 0)
        vm.prank(carol);
        vm.expectRevert("Not recipient");
        messenger.acknowledgeDelivery(1);
    }

    // ============ Cross-Chain Messaging ============

    function test_sendCrossChain_createsMessageAndRelay() public {
        uint256 dstChainId = 137; // Polygon
        bytes32 contentHash = keccak256("cross-chain msg");

        vm.prank(alice);
        uint256 msgId = messenger.sendCrossChain(dstChainId, 0, bob, contentHash);

        assertEq(msgId, 1);

        VibeMessenger.Message memory m = messenger.getMessage(1);
        assertEq(m.dstChainId, dstChainId);
        assertEq(m.contentHash, contentHash);
        assertFalse(m.delivered);
    }

    function test_sendCrossChain_emitsBothEvents() public {
        uint256 dstChainId = 42161; // Arbitrum
        bytes32 contentHash = keccak256("msg");

        // Pre-compute relayId using the same formula as the contract
        // messageCount will be 1 (first message)
        bytes32 expectedRelayId = keccak256(abi.encodePacked(
            uint256(1), block.chainid, dstChainId, contentHash
        ));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit MessageSent(1, alice, 0, bob);
        vm.expectEmit(true, false, false, true);
        emit CrossChainRelayed(expectedRelayId, block.chainid, dstChainId);
        messenger.sendCrossChain(dstChainId, 0, bob, contentHash);
    }

    function test_sendCrossChain_relayRecordCreated() public {
        uint256 dstChainId = 8453; // Base
        bytes32 contentHash = keccak256("base msg");

        vm.prank(alice);
        messenger.sendCrossChain(dstChainId, 0, bob, contentHash);

        bytes32 relayId = keccak256(abi.encodePacked(
            uint256(1), block.chainid, dstChainId, contentHash
        ));

        VibeMessenger.CrossChainRelay memory relay = messenger.getRelay(relayId);
        assertEq(relay.dstChainId, dstChainId);
        assertEq(relay.messageHash, contentHash);
        assertEq(relay.attestations, 0);
        assertFalse(relay.executed);
    }

    // ============ Relay Attestation ============

    function test_attestRelay_validatorAttests() public {
        uint256 dstChainId = 137;
        bytes32 contentHash = keccak256("relay msg");

        vm.prank(alice);
        messenger.sendCrossChain(dstChainId, 0, bob, contentHash);

        bytes32 relayId = keccak256(abi.encodePacked(
            uint256(1), block.chainid, dstChainId, contentHash
        ));

        vm.prank(validator1);
        messenger.attestRelay(relayId);

        VibeMessenger.CrossChainRelay memory relay = messenger.getRelay(relayId);
        assertEq(relay.attestations, 1);
        assertFalse(relay.executed); // need REQUIRED_ATTESTATIONS = 2
        assertTrue(messenger.relayAttestations(relayId, validator1));
    }

    function test_attestRelay_emitsEvent() public {
        uint256 dstChainId = 137;
        bytes32 contentHash = keccak256("relay msg");

        vm.prank(alice);
        messenger.sendCrossChain(dstChainId, 0, bob, contentHash);

        bytes32 relayId = keccak256(abi.encodePacked(
            uint256(1), block.chainid, dstChainId, contentHash
        ));

        vm.prank(validator1);
        vm.expectEmit(true, true, false, false);
        emit RelayAttested(relayId, validator1);
        messenger.attestRelay(relayId);
    }

    function test_attestRelay_executedAtThreshold() public {
        uint256 dstChainId = 137;
        bytes32 contentHash = keccak256("relay msg");

        vm.prank(alice);
        messenger.sendCrossChain(dstChainId, 0, bob, contentHash);

        bytes32 relayId = keccak256(abi.encodePacked(
            uint256(1), block.chainid, dstChainId, contentHash
        ));

        vm.prank(validator1);
        messenger.attestRelay(relayId);

        vm.prank(validator2);
        messenger.attestRelay(relayId);

        // REQUIRED_ATTESTATIONS = 2 → should now be executed
        VibeMessenger.CrossChainRelay memory relay = messenger.getRelay(relayId);
        assertEq(relay.attestations, 2);
        assertTrue(relay.executed);
    }

    function test_attestRelay_revert_notValidator() public {
        uint256 dstChainId = 137;
        bytes32 contentHash = keccak256("relay msg");

        vm.prank(alice);
        messenger.sendCrossChain(dstChainId, 0, bob, contentHash);

        bytes32 relayId = keccak256(abi.encodePacked(
            uint256(1), block.chainid, dstChainId, contentHash
        ));

        vm.prank(carol); // not a validator
        vm.expectRevert("Not validator");
        messenger.attestRelay(relayId);
    }

    function test_attestRelay_revert_alreadyAttested() public {
        uint256 dstChainId = 137;
        bytes32 contentHash = keccak256("relay msg");

        vm.prank(alice);
        messenger.sendCrossChain(dstChainId, 0, bob, contentHash);

        bytes32 relayId = keccak256(abi.encodePacked(
            uint256(1), block.chainid, dstChainId, contentHash
        ));

        vm.prank(validator1);
        messenger.attestRelay(relayId);

        vm.prank(validator1);
        vm.expectRevert("Already attested");
        messenger.attestRelay(relayId);
    }

    // ============ Validator Management ============

    function test_addValidator_onlyOwner() public {
        address newVal = makeAddr("newVal");
        address proxyOwner = messenger.owner();

        vm.prank(proxyOwner);
        messenger.addValidator(newVal);

        assertTrue(messenger.validators(newVal));
        assertEq(messenger.validatorCount(), 4);
    }

    function test_addValidator_idempotent() public {
        address proxyOwner = messenger.owner();

        vm.prank(proxyOwner);
        messenger.addValidator(validator1); // already exists

        assertEq(messenger.validatorCount(), 3); // no double-count
    }

    function test_addValidator_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        messenger.addValidator(makeAddr("x"));
    }

    function test_removeValidator_onlyOwner() public {
        address proxyOwner = messenger.owner();

        vm.prank(proxyOwner);
        messenger.removeValidator(validator1);

        assertFalse(messenger.validators(validator1));
        assertEq(messenger.validatorCount(), 2);
    }

    function test_removeValidator_idempotent() public {
        address proxyOwner = messenger.owner();

        vm.prank(proxyOwner);
        messenger.removeValidator(validator1);

        vm.prank(proxyOwner);
        messenger.removeValidator(validator1); // already removed

        assertEq(messenger.validatorCount(), 2); // no underflow
    }

    function test_removeValidator_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        messenger.removeValidator(validator1);
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_onlyOwner() public {
        VibeMessenger newImpl = new VibeMessenger();

        vm.prank(alice);
        vm.expectRevert();
        messenger.upgradeToAndCall(address(newImpl), "");

        address proxyOwner = messenger.owner();
        vm.prank(proxyOwner);
        messenger.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Integration: Full Messaging Flow ============

    function test_integration_channelAndDMFlow() public {
        // 1. Alice creates a public channel
        uint256 channelId = _createChannel(alice);

        // 2. Bob and carol subscribe
        vm.prank(bob);
        messenger.subscribe(channelId);
        vm.prank(carol);
        messenger.subscribe(channelId);

        assertEq(messenger.getChannel(channelId).subscriberCount, 2);

        // 3. Alice broadcasts to channel
        vm.prank(alice);
        uint256 msgId = messenger.sendMessage(channelId, address(0), keccak256("Hello subscribers!"));

        // 4. Carol acknowledges
        vm.prank(carol);
        messenger.acknowledgeDelivery(msgId);
        assertTrue(messenger.deliveryReceipts(msgId));

        // 5. Carol opts in for DMs, alice sends direct message
        vm.prank(carol);
        messenger.setAllowDirectMessages(true);

        vm.prank(alice);
        uint256 dmId = messenger.sendMessage(0, carol, keccak256("private message"));

        // 6. Carol acknowledges DM
        vm.prank(carol);
        messenger.acknowledgeDelivery(dmId);
        assertTrue(messenger.deliveryReceipts(dmId));

        // 7. Bob unsubscribes
        vm.prank(bob);
        messenger.unsubscribe(channelId);
        assertEq(messenger.getChannel(channelId).subscriberCount, 1);

        assertEq(messenger.messageCount(), 2);
    }
}
