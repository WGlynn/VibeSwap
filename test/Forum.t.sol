// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/identity/Forum.sol";
import "../contracts/identity/SoulboundIdentity.sol";

contract MockForumIdentity {
    mapping(address => bool) public identities;
    mapping(address => uint256) public addressToTokenId;

    function setIdentity(address user, uint256 tokenId) external {
        identities[user] = true;
        addressToTokenId[user] = tokenId;
    }

    function hasIdentity(address addr) external view returns (bool) {
        return identities[addr];
    }

    function recordContribution(address, bytes32, SoulboundIdentity.ContributionType) external pure returns (uint256) {
        return 1; // Mock contribution ID
    }
}

contract ForumTest is Test {
    Forum public forum;
    MockForumIdentity public identity;
    address public poster1;
    address public poster2;
    address public moderator;

    function setUp() public {
        poster1 = makeAddr("poster1");
        poster2 = makeAddr("poster2");
        moderator = makeAddr("moderator");

        identity = new MockForumIdentity();
        identity.setIdentity(poster1, 1);
        identity.setIdentity(poster2, 2);

        Forum impl = new Forum();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(Forum.initialize.selector, address(identity))
        );
        forum = Forum(address(proxy));

        forum.setModerator(moderator, true);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(forum.totalCategories(), 5);
        assertEq(forum.totalPosts(), 0);
        assertEq(forum.totalReplies(), 0);
        assertEq(forum.postCooldown(), 60);
    }

    function test_defaultCategories() public view {
        (string memory name, , , bool active) = forum.categories(1);
        assertEq(name, "General");
        assertTrue(active);

        (name, , , active) = forum.categories(2);
        assertEq(name, "Trading");
        assertTrue(active);
    }

    // ============ Category Management ============

    function test_createCategory() public {
        forum.createCategory("New Category", "Description");
        assertEq(forum.totalCategories(), 6);

        (string memory name, string memory desc, uint256 postCount, bool active) = forum.categories(6);
        assertEq(name, "New Category");
        assertEq(desc, "Description");
        assertEq(postCount, 0);
        assertTrue(active);
    }

    function test_createCategory_onlyOwner() public {
        vm.prank(poster1);
        vm.expectRevert();
        forum.createCategory("Forbidden", "Nope");
    }

    function test_setCategoryActive() public {
        vm.prank(moderator);
        forum.setCategoryActive(1, false);

        (, , , bool active) = forum.categories(1);
        assertFalse(active);
    }

    function test_setCategoryActive_invalidCategory() public {
        vm.prank(moderator);
        vm.expectRevert(Forum.CategoryNotFound.selector);
        forum.setCategoryActive(0, false);
    }

    function test_setCategoryActive_notModerator() public {
        vm.prank(poster1);
        vm.expectRevert(Forum.NotModerator.selector);
        forum.setCategoryActive(1, false);
    }

    // ============ Post Creation ============

    function test_createPost() public {
        vm.warp(100);
        vm.prank(poster1);
        uint256 postId = forum.createPost(1, "Hello World", keccak256("content"));

        assertEq(postId, 1);
        assertEq(forum.totalPosts(), 1);

        (, uint256 categoryId, uint256 authorTokenId, address author, string memory title, , , , , , ) = forum.posts(1);
        assertEq(categoryId, 1);
        assertEq(authorTokenId, 1);
        assertEq(author, poster1);
        assertEq(title, "Hello World");
    }

    function test_createPost_incrementsCategoryPostCount() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        (, , uint256 postCount, ) = forum.categories(1);
        assertEq(postCount, 1);
    }

    function test_createPost_noIdentity() public {
        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert(Forum.NoIdentity.selector);
        forum.createPost(1, "Post", keccak256("content"));
    }

    function test_createPost_invalidCategory() public {
        vm.prank(poster1);
        vm.expectRevert(Forum.CategoryNotFound.selector);
        forum.createPost(0, "Post", keccak256("content"));
    }

    function test_createPost_inactiveCategory() public {
        vm.prank(moderator);
        forum.setCategoryActive(1, false);

        vm.prank(poster1);
        vm.expectRevert(Forum.CategoryInactive.selector);
        forum.createPost(1, "Post", keccak256("content"));
    }

    function test_createPost_emptyContent() public {
        vm.prank(poster1);
        vm.expectRevert(Forum.EmptyContent.selector);
        forum.createPost(1, "Post", bytes32(0));
    }

    function test_createPost_cooldown() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post 1", keccak256("c1"));

        vm.prank(poster1);
        vm.expectRevert(Forum.CooldownActive.selector);
        forum.createPost(1, "Post 2", keccak256("c2"));
    }

    function test_createPost_cooldownExpired() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post 1", keccak256("c1"));

        vm.warp(100 + 61);
        vm.prank(poster1);
        forum.createPost(1, "Post 2", keccak256("c2"));

        assertEq(forum.totalPosts(), 2);
    }

    // ============ Reply Creation ============

    function test_createReply() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        vm.prank(poster2);
        uint256 replyId = forum.createReply(1, keccak256("reply"), 0);

        assertEq(replyId, 1);
        assertEq(forum.totalReplies(), 1);
    }

    function test_createReply_incrementsReplyCount() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        vm.prank(poster2);
        forum.createReply(1, keccak256("reply"), 0);

        (, , , , , , , , uint256 replyCount, , ) = forum.posts(1);
        assertEq(replyCount, 1);
    }

    function test_createReply_invalidPost() public {
        vm.prank(poster1);
        vm.expectRevert(Forum.PostNotFound.selector);
        forum.createReply(0, keccak256("reply"), 0);
    }

    function test_createReply_lockedPost() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        vm.prank(moderator);
        forum.setLocked(1, true);

        vm.prank(poster2);
        vm.expectRevert(Forum.PostIsLocked.selector);
        forum.createReply(1, keccak256("reply"), 0);
    }

    function test_createReply_emptyContent() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        vm.prank(poster2);
        vm.expectRevert(Forum.EmptyContent.selector);
        forum.createReply(1, bytes32(0), 0);
    }

    function test_createReply_nestedReply() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        vm.prank(poster2);
        forum.createReply(1, keccak256("reply1"), 0); // replyId = 1

        vm.prank(poster1);
        forum.createReply(1, keccak256("reply2"), 1); // Nested under reply 1

        assertEq(forum.totalReplies(), 2);
    }

    // ============ Moderation ============

    function test_setPinned() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        vm.prank(moderator);
        forum.setPinned(1, true);

        (, , , , , , , , , bool pinned, ) = forum.posts(1);
        assertTrue(pinned);
    }

    function test_setLocked() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        vm.prank(moderator);
        forum.setLocked(1, true);

        (, , , , , , , , , , bool locked) = forum.posts(1);
        assertTrue(locked);
    }

    function test_setModerator() public view {
        assertTrue(forum.moderators(moderator));
    }

    function test_setPostCooldown() public {
        forum.setPostCooldown(120);
        assertEq(forum.postCooldown(), 120);
    }

    // ============ View Functions ============

    function test_getUserPosts() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post 1", keccak256("c1"));

        vm.warp(200);
        vm.prank(poster1);
        forum.createPost(2, "Post 2", keccak256("c2"));

        uint256[] memory postIds = forum.getUserPosts(1); // tokenId 1 = poster1
        assertEq(postIds.length, 2);
    }

    function test_getUserReplies() public {
        vm.warp(100);
        vm.prank(poster1);
        forum.createPost(1, "Post", keccak256("content"));

        vm.prank(poster2);
        forum.createReply(1, keccak256("r1"), 0);

        uint256[] memory replyIds = forum.getUserReplies(2); // tokenId 2 = poster2
        assertEq(replyIds.length, 1);
    }

    function test_getCategory() public view {
        Forum.Category memory cat = forum.getCategory(1);
        assertEq(cat.name, "General");
        assertTrue(cat.active);
    }
}
