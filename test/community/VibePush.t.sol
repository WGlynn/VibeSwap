// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/community/VibePush.sol";

contract VibePushTest is Test {
    VibePush public push;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;

    event ChannelCreated(bytes32 indexed channelId, address indexed owner, string name);
    event ChannelDeactivated(bytes32 indexed channelId);
    event ChannelReactivated(bytes32 indexed channelId);
    event Subscribed(bytes32 indexed channelId, address indexed user);
    event Unsubscribed(bytes32 indexed channelId, address indexed user);
    event NotificationSent(
        bytes32 indexed channelId,
        string title,
        string body,
        string imageUrl,
        uint256 timestamp,
        uint8 priority
    );

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        VibePush impl = new VibePush();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibePush.initialize.selector)
        );
        push = VibePush(address(proxy));
    }

    // ============ Helpers ============

    function _createChannel(address channelOwner, string memory name) internal returns (bytes32) {
        vm.prank(channelOwner);
        return push.createChannel(name, "A test channel");
    }

    // ============ Test 1: Channel creation (happy path) ============

    function test_CreateChannel_HappyPath() public {
        bytes32 channelId = _createChannel(alice, "Protocol Updates");

        assertNotEq(channelId, bytes32(0));

        VibePush.Channel memory ch = push.getChannel(channelId);
        assertEq(ch.owner, alice);
        assertEq(keccak256(bytes(ch.name)), keccak256(bytes("Protocol Updates")));
        assertEq(ch.subscriberCount, 0);
        assertTrue(ch.active);
    }

    function test_CreateChannel_EmitsEvent() public {
        vm.prank(alice);

        // We can't predict channelId ahead of time (depends on block.timestamp + nonce),
        // so check indexed fields: topic1 = channelId (any), topic2 = owner
        vm.expectEmit(false, true, false, true);
        emit ChannelCreated(bytes32(0), alice, "Governance Alerts");

        push.createChannel("Governance Alerts", "Channel for governance proposals");
    }

    function test_CreateChannel_RevertsOnEmptyName() public {
        vm.prank(alice);
        vm.expectRevert(VibePush.InvalidChannelName.selector);
        push.createChannel("", "description");
    }

    function test_CreateChannel_RevertsOnNameTooLong() public {
        // MAX_CHANNEL_NAME_LENGTH = 128, create a 129-byte name
        bytes memory longName = new bytes(129);
        for (uint256 i = 0; i < 129; i++) {
            longName[i] = "A";
        }

        vm.prank(alice);
        vm.expectRevert(VibePush.InvalidChannelName.selector);
        push.createChannel(string(longName), "description");
    }

    // ============ Test 2: Subscribe to a channel ============

    function test_Subscribe_HappyPath() public {
        bytes32 channelId = _createChannel(alice, "Alerts");

        vm.prank(bob);
        push.subscribe(channelId);

        assertTrue(push.isSubscribed(bob, channelId));
        assertEq(push.getSubscriberCount(channelId), 1);

        address[] memory subs = push.getChannelSubscribers(channelId);
        assertEq(subs.length, 1);
        assertEq(subs[0], bob);
    }

    function test_Subscribe_EmitsEvent() public {
        bytes32 channelId = _createChannel(alice, "Events");

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit Subscribed(channelId, bob);
        push.subscribe(channelId);
    }

    function test_Subscribe_MultipleUsers() public {
        bytes32 channelId = _createChannel(alice, "Multi");

        vm.prank(bob);
        push.subscribe(channelId);

        vm.prank(charlie);
        push.subscribe(channelId);

        assertEq(push.getSubscriberCount(channelId), 2);

        address[] memory subs = push.getChannelSubscribers(channelId);
        assertEq(subs.length, 2);
        assertEq(subs[0], bob);
        assertEq(subs[1], charlie);
    }

    function test_Subscribe_TracksUserSubscriptions() public {
        bytes32 ch1 = _createChannel(alice, "Channel1");
        bytes32 ch2 = _createChannel(alice, "Channel2");

        vm.startPrank(bob);
        push.subscribe(ch1);
        push.subscribe(ch2);
        vm.stopPrank();

        bytes32[] memory userSubs = push.getUserSubscriptions(bob);
        assertEq(userSubs.length, 2);
        assertEq(userSubs[0], ch1);
        assertEq(userSubs[1], ch2);
    }

    // ============ Test 3: Unsubscribe from a channel ============

    function test_Unsubscribe_HappyPath() public {
        bytes32 channelId = _createChannel(alice, "Unsub");

        vm.prank(bob);
        push.subscribe(channelId);

        vm.prank(bob);
        push.unsubscribe(channelId);

        assertFalse(push.isSubscribed(bob, channelId));
        assertEq(push.getSubscriberCount(channelId), 0);

        address[] memory subs = push.getChannelSubscribers(channelId);
        assertEq(subs.length, 0);
    }

    function test_Unsubscribe_EmitsEvent() public {
        bytes32 channelId = _createChannel(alice, "UnsubEvent");

        vm.prank(bob);
        push.subscribe(channelId);

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit Unsubscribed(channelId, bob);
        push.unsubscribe(channelId);
    }

    function test_Unsubscribe_SwapAndPop_MiddleElement() public {
        bytes32 channelId = _createChannel(alice, "SwapPop");

        vm.prank(bob);
        push.subscribe(channelId);
        vm.prank(charlie);
        push.subscribe(channelId);
        vm.prank(alice);
        push.subscribe(channelId);

        // Unsubscribe bob (index 0) — charlie should remain, alice swapped to index 0
        vm.prank(bob);
        push.unsubscribe(channelId);

        assertEq(push.getSubscriberCount(channelId), 2);
        address[] memory subs = push.getChannelSubscribers(channelId);
        assertEq(subs.length, 2);
        // alice was last, should be swapped into bob's slot (index 0)
        assertEq(subs[0], alice);
        assertEq(subs[1], charlie);
    }

    // ============ Test 4: Send notification to channel subscribers ============

    function test_SendNotification_HappyPath() public {
        bytes32 channelId = _createChannel(alice, "Notifs");

        vm.prank(bob);
        push.subscribe(channelId);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit NotificationSent(channelId, "Hello", "World", "", block.timestamp, 1);
        push.sendNotification(channelId, "Hello", "World", "", 1);
    }

    function test_SendNotification_AllPriorities() public {
        bytes32 channelId = _createChannel(alice, "Priorities");

        vm.startPrank(alice);
        // Priority 0 = low
        push.sendNotification(channelId, "Low", "body", "", 0);
        // Priority 1 = medium
        push.sendNotification(channelId, "Med", "body", "", 1);
        // Priority 2 = high
        push.sendNotification(channelId, "High", "body", "", 2);
        // Priority 3 = urgent (MAX_PRIORITY)
        push.sendNotification(channelId, "Urgent", "body", "", 3);
        vm.stopPrank();
    }

    function test_SendNotification_WithImageUrl() public {
        bytes32 channelId = _createChannel(alice, "Images");

        vm.prank(alice);
        push.sendNotification(channelId, "New NFT", "Check it out", "https://img.example.com/nft.png", 2);
    }

    // ============ Test 5: Only channel owner can broadcast ============

    function test_SendNotification_RevertsIfNotOwner() public {
        bytes32 channelId = _createChannel(alice, "Owned");

        vm.prank(bob);
        vm.expectRevert(VibePush.NotChannelOwner.selector);
        push.sendNotification(channelId, "Hijack", "body", "", 1);
    }

    // ============ Test 6: Subscribe to non-existent channel (should revert) ============

    function test_Subscribe_RevertsOnNonExistentChannel() public {
        bytes32 fakeId = keccak256("nonexistent");

        vm.prank(bob);
        vm.expectRevert(VibePush.ChannelNotFound.selector);
        push.subscribe(fakeId);
    }

    // ============ Test 7: Double subscribe (should revert) ============

    function test_Subscribe_RevertsOnDoubleSubscribe() public {
        bytes32 channelId = _createChannel(alice, "NoDupes");

        vm.startPrank(bob);
        push.subscribe(channelId);

        vm.expectRevert(VibePush.AlreadySubscribed.selector);
        push.subscribe(channelId);
        vm.stopPrank();
    }

    // ============ Test 8: Unsubscribe when not subscribed ============

    function test_Unsubscribe_RevertsWhenNotSubscribed() public {
        bytes32 channelId = _createChannel(alice, "NotSubbed");

        vm.prank(bob);
        vm.expectRevert(VibePush.NotSubscribed.selector);
        push.unsubscribe(channelId);
    }

    // ============ Test 9: Channel deactivation by owner ============

    function test_DeactivateChannel_HappyPath() public {
        bytes32 channelId = _createChannel(alice, "Deactivatable");

        vm.prank(alice);
        push.deactivateChannel(channelId);

        VibePush.Channel memory ch = push.getChannel(channelId);
        assertFalse(ch.active);
    }

    function test_DeactivateChannel_EmitsEvent() public {
        bytes32 channelId = _createChannel(alice, "DeactEvent");

        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit ChannelDeactivated(channelId);
        push.deactivateChannel(channelId);
    }

    function test_DeactivateChannel_RevertsIfNotOwner() public {
        bytes32 channelId = _createChannel(alice, "NotYours");

        vm.prank(bob);
        vm.expectRevert(VibePush.NotChannelOwner.selector);
        push.deactivateChannel(channelId);
    }

    function test_DeactivateChannel_RevertsIfNotFound() public {
        bytes32 fakeId = keccak256("fake");

        vm.prank(alice);
        vm.expectRevert(VibePush.ChannelNotFound.selector);
        push.deactivateChannel(fakeId);
    }

    function test_DeactivateChannel_BlocksNewSubscriptions() public {
        bytes32 channelId = _createChannel(alice, "Deactivated");

        vm.prank(alice);
        push.deactivateChannel(channelId);

        vm.prank(bob);
        vm.expectRevert(VibePush.ChannelNotActive.selector);
        push.subscribe(channelId);
    }

    function test_DeactivateChannel_BlocksNotifications() public {
        bytes32 channelId = _createChannel(alice, "DeactNotif");

        vm.prank(alice);
        push.deactivateChannel(channelId);

        vm.prank(alice);
        vm.expectRevert(VibePush.ChannelNotActive.selector);
        push.sendNotification(channelId, "Blocked", "body", "", 0);
    }

    // ============ Test 10: Channel reactivation ============

    function test_ReactivateChannel_HappyPath() public {
        bytes32 channelId = _createChannel(alice, "Reactivatable");

        vm.prank(alice);
        push.deactivateChannel(channelId);

        vm.prank(alice);
        push.reactivateChannel(channelId);

        VibePush.Channel memory ch = push.getChannel(channelId);
        assertTrue(ch.active);
    }

    function test_ReactivateChannel_EmitsEvent() public {
        bytes32 channelId = _createChannel(alice, "ReactEvent");

        vm.prank(alice);
        push.deactivateChannel(channelId);

        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit ChannelReactivated(channelId);
        push.reactivateChannel(channelId);
    }

    function test_ReactivateChannel_RevertsIfNotOwner() public {
        bytes32 channelId = _createChannel(alice, "ReactNoAuth");

        vm.prank(alice);
        push.deactivateChannel(channelId);

        vm.prank(bob);
        vm.expectRevert(VibePush.NotChannelOwner.selector);
        push.reactivateChannel(channelId);
    }

    function test_ReactivateChannel_AllowsSubscriptionsAgain() public {
        bytes32 channelId = _createChannel(alice, "ReactSub");

        vm.prank(alice);
        push.deactivateChannel(channelId);

        vm.prank(alice);
        push.reactivateChannel(channelId);

        vm.prank(bob);
        push.subscribe(channelId);

        assertTrue(push.isSubscribed(bob, channelId));
        assertEq(push.getSubscriberCount(channelId), 1);
    }

    // ============ Test 11: Notification validation ============

    function test_SendNotification_RevertsOnInvalidPriority() public {
        bytes32 channelId = _createChannel(alice, "BadPrio");

        vm.prank(alice);
        vm.expectRevert(VibePush.InvalidPriority.selector);
        push.sendNotification(channelId, "Title", "Body", "", 4);
    }

    function test_SendNotification_RevertsOnTitleTooLong() public {
        bytes32 channelId = _createChannel(alice, "LongTitle");

        bytes memory longTitle = new bytes(257);
        for (uint256 i = 0; i < 257; i++) {
            longTitle[i] = "T";
        }

        vm.prank(alice);
        vm.expectRevert(VibePush.TitleTooLong.selector);
        push.sendNotification(channelId, string(longTitle), "Body", "", 0);
    }

    function test_SendNotification_RevertsOnBodyTooLong() public {
        bytes32 channelId = _createChannel(alice, "LongBody");

        bytes memory longBody = new bytes(4097);
        for (uint256 i = 0; i < 4097; i++) {
            longBody[i] = "B";
        }

        vm.prank(alice);
        vm.expectRevert(VibePush.BodyTooLong.selector);
        push.sendNotification(channelId, "Title", string(longBody), "", 0);
    }

    function test_SendNotification_RevertsOnNonExistentChannel() public {
        bytes32 fakeId = keccak256("nonexistent");

        vm.prank(alice);
        vm.expectRevert(VibePush.ChannelNotFound.selector);
        push.sendNotification(fakeId, "Title", "Body", "", 0);
    }

    // ============ Test 12: View functions ============

    function test_GetChannel_ReturnsCorrectData() public {
        bytes32 channelId = _createChannel(alice, "ViewTest");

        VibePush.Channel memory ch = push.getChannel(channelId);

        assertEq(ch.channelId, channelId);
        assertEq(ch.owner, alice);
        assertEq(keccak256(bytes(ch.name)), keccak256(bytes("ViewTest")));
        assertEq(keccak256(bytes(ch.description)), keccak256(bytes("A test channel")));
        assertEq(ch.subscriberCount, 0);
        assertTrue(ch.active);
    }

    function test_GetUserSubscriptions_EmptyByDefault() public view {
        bytes32[] memory subs = push.getUserSubscriptions(bob);
        assertEq(subs.length, 0);
    }

    function test_GetChannelSubscribers_EmptyByDefault() public {
        bytes32 channelId = _createChannel(alice, "EmptySubs");
        address[] memory subs = push.getChannelSubscribers(channelId);
        assertEq(subs.length, 0);
    }

    function test_IsSubscribed_FalseByDefault() public {
        bytes32 channelId = _createChannel(alice, "NotSubYet");
        assertFalse(push.isSubscribed(bob, channelId));
    }

    // ============ Test 13: User subscription list cleanup on unsubscribe ============

    function test_Unsubscribe_CleansUserSubscriptionList() public {
        bytes32 ch1 = _createChannel(alice, "Sub1");
        bytes32 ch2 = _createChannel(alice, "Sub2");
        bytes32 ch3 = _createChannel(alice, "Sub3");

        vm.startPrank(bob);
        push.subscribe(ch1);
        push.subscribe(ch2);
        push.subscribe(ch3);
        vm.stopPrank();

        assertEq(push.getUserSubscriptions(bob).length, 3);

        // Unsubscribe from the middle channel
        vm.prank(bob);
        push.unsubscribe(ch2);

        bytes32[] memory remaining = push.getUserSubscriptions(bob);
        assertEq(remaining.length, 2);
        // ch3 was last, swapped into ch2's slot
        assertEq(remaining[0], ch1);
        assertEq(remaining[1], ch3);
    }

    // ============ Test 14: Multiple channels by different owners ============

    function test_MultipleOwners_IndependentChannels() public {
        bytes32 aliceChannel = _createChannel(alice, "AliceChannel");
        bytes32 bobChannel = _createChannel(bob, "BobChannel");

        // Alice can send on her channel but not Bob's
        vm.prank(alice);
        push.sendNotification(aliceChannel, "Alice news", "body", "", 0);

        vm.prank(alice);
        vm.expectRevert(VibePush.NotChannelOwner.selector);
        push.sendNotification(bobChannel, "Hijack", "body", "", 0);

        // Bob can send on his channel but not Alice's
        vm.prank(bob);
        push.sendNotification(bobChannel, "Bob news", "body", "", 0);

        vm.prank(bob);
        vm.expectRevert(VibePush.NotChannelOwner.selector);
        push.sendNotification(aliceChannel, "Hijack", "body", "", 0);
    }

    // ============ Test 15: Boundary values for title and body lengths ============

    function test_SendNotification_MaxTitleLength() public {
        bytes32 channelId = _createChannel(alice, "MaxTitle");

        bytes memory maxTitle = new bytes(256);
        for (uint256 i = 0; i < 256; i++) {
            maxTitle[i] = "T";
        }

        vm.prank(alice);
        push.sendNotification(channelId, string(maxTitle), "Body", "", 0);
        // Should not revert — 256 is exactly MAX_TITLE_LENGTH
    }

    function test_SendNotification_MaxBodyLength() public {
        bytes32 channelId = _createChannel(alice, "MaxBody");

        bytes memory maxBody = new bytes(4096);
        for (uint256 i = 0; i < 4096; i++) {
            maxBody[i] = "B";
        }

        vm.prank(alice);
        push.sendNotification(channelId, "Title", string(maxBody), "", 0);
        // Should not revert — 4096 is exactly MAX_BODY_LENGTH
    }

    function test_CreateChannel_MaxNameLength() public {
        bytes memory maxName = new bytes(128);
        for (uint256 i = 0; i < 128; i++) {
            maxName[i] = "N";
        }

        vm.prank(alice);
        bytes32 channelId = push.createChannel(string(maxName), "desc");
        // Should not revert — 128 is exactly MAX_CHANNEL_NAME_LENGTH
        assertNotEq(channelId, bytes32(0));
    }
}
