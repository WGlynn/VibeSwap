// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/community/VibeSocial.sol";

contract VibeSocialTest is Test {
    VibeSocial public social;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;

    event ProfileCreated(address indexed owner, string handle);
    event Followed(address indexed follower, address indexed following);
    event Unfollowed(address indexed follower, address indexed following);
    event PostCreated(uint256 indexed postId, address indexed author);
    event PostLiked(uint256 indexed postId, address indexed liker);
    event CommentCreated(uint256 indexed postId, uint256 commentIndex, address indexed commenter);
    event Tipped(uint256 indexed postId, address indexed tipper, uint256 amount);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);

        VibeSocial impl = new VibeSocial();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeSocial.initialize.selector)
        );
        social = VibeSocial(address(proxy));
    }

    // ============ Helpers ============

    function _createProfile(address user, string memory handle) internal {
        vm.prank(user);
        social.createProfile(handle, "bio", "avatar");
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(social.profileCount(), 0);
        assertEq(social.postCount(), 0);
    }

    // ============ Profile Creation ============

    function test_createProfile() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit ProfileCreated(alice, "alice_handle");
        social.createProfile("alice_handle", "I am Alice", "ipfs://avatar");

        assertEq(social.profileCount(), 1);
        assertEq(social.handleToAddress("alice_handle"), alice);

        (string memory handle, string memory bio, uint256 followers, uint256 following, uint256 postCnt)
            = social.getProfile(alice);

        assertEq(handle, "alice_handle");
        assertEq(bio, "I am Alice");
        assertEq(followers, 0);
        assertEq(following, 0);
        assertEq(postCnt, 0);
    }

    function test_createProfile_revert_alreadyHasProfile() public {
        _createProfile(alice, "alice_handle");

        vm.prank(alice);
        vm.expectRevert("Already has profile");
        social.createProfile("alice_handle_2", "bio", "avatar");
    }

    function test_createProfile_revert_handleTaken() public {
        _createProfile(alice, "shared_handle");

        vm.prank(bob);
        vm.expectRevert("Handle taken");
        social.createProfile("shared_handle", "bio", "avatar");
    }

    function test_createProfile_revert_handleTooShort() public {
        vm.prank(alice);
        vm.expectRevert("Invalid handle");
        social.createProfile("ab", "bio", "avatar");
    }

    function test_createProfile_revert_handleTooLong() public {
        // 33 characters — exceeds 32 max
        vm.prank(alice);
        vm.expectRevert("Invalid handle");
        social.createProfile("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bio", "avatar");
    }

    function test_createProfile_minHandle() public {
        vm.prank(alice);
        social.createProfile("abc", "bio", "avatar"); // exactly 3 chars
        assertEq(social.profileCount(), 1);
    }

    function test_createProfile_maxHandle() public {
        vm.prank(alice);
        social.createProfile("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bio", "avatar"); // exactly 32 chars
        assertEq(social.profileCount(), 1);
    }

    // ============ Profile Update ============

    function test_updateProfile() public {
        _createProfile(alice, "alice_handle");

        vm.prank(alice);
        social.updateProfile("new bio", "new avatar");

        (, string memory bio, , , ) = social.getProfile(alice);
        assertEq(bio, "new bio");
    }

    function test_updateProfile_revert_noProfile() public {
        vm.prank(alice);
        vm.expectRevert("No profile");
        social.updateProfile("bio", "avatar");
    }

    // ============ Social Graph ============

    function test_follow() public {
        _createProfile(alice, "alice");
        _createProfile(bob, "bob");

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit Followed(alice, bob);
        social.follow(bob);

        assertTrue(social.isFollowing(alice, bob));

        (, , uint256 bobFollowers, , ) = social.getProfile(bob);
        assertEq(bobFollowers, 1);

        (, , , uint256 aliceFollowing, ) = social.getProfile(alice);
        assertEq(aliceFollowing, 1);
    }

    function test_follow_revert_noProfile() public {
        _createProfile(alice, "alice");

        vm.prank(alice);
        vm.expectRevert("Profile required");
        social.follow(bob); // bob has no profile
    }

    function test_follow_revert_alreadyFollowing() public {
        _createProfile(alice, "alice");
        _createProfile(bob, "bob");

        vm.prank(alice);
        social.follow(bob);

        vm.prank(alice);
        vm.expectRevert("Already following");
        social.follow(bob);
    }

    function test_follow_revert_selfFollow() public {
        _createProfile(alice, "alice");

        vm.prank(alice);
        vm.expectRevert("Cannot self-follow");
        social.follow(alice);
    }

    function test_unfollow() public {
        _createProfile(alice, "alice");
        _createProfile(bob, "bob");

        vm.prank(alice);
        social.follow(bob);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit Unfollowed(alice, bob);
        social.unfollow(bob);

        assertFalse(social.isFollowing(alice, bob));

        (, , uint256 bobFollowers, , ) = social.getProfile(bob);
        assertEq(bobFollowers, 0);
    }

    function test_unfollow_revert_notFollowing() public {
        _createProfile(alice, "alice");
        _createProfile(bob, "bob");

        vm.prank(alice);
        vm.expectRevert("Not following");
        social.unfollow(bob);
    }

    function test_follow_mutual() public {
        _createProfile(alice, "alice");
        _createProfile(bob, "bob");

        vm.prank(alice);
        social.follow(bob);

        vm.prank(bob);
        social.follow(alice);

        assertTrue(social.isFollowing(alice, bob));
        assertTrue(social.isFollowing(bob, alice));

        (, , uint256 aliceFollowers, uint256 aliceFollowing, ) = social.getProfile(alice);
        assertEq(aliceFollowers, 1);
        assertEq(aliceFollowing, 1);
    }

    // ============ Posts ============

    function test_createPost() public {
        _createProfile(alice, "alice");

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit PostCreated(1, alice);
        social.createPost("Hello world!");

        assertEq(social.postCount(), 1);

        (uint256 postId, address author, string memory content, uint256 timestamp,
         uint256 likes, uint256 commentCount, , bool active) = social.posts(1);

        assertEq(postId, 1);
        assertEq(author, alice);
        assertEq(content, "Hello world!");
        assertGt(timestamp, 0);
        assertEq(likes, 0);
        assertEq(commentCount, 0);
        assertTrue(active);

        (, , , , uint256 postCnt) = social.getProfile(alice);
        assertEq(postCnt, 1);
    }

    function test_createPost_revert_noProfile() public {
        vm.prank(alice);
        vm.expectRevert("No profile");
        social.createPost("Hello!");
    }

    function test_createPost_multiple() public {
        _createProfile(alice, "alice");

        vm.startPrank(alice);
        social.createPost("Post 1");
        social.createPost("Post 2");
        social.createPost("Post 3");
        vm.stopPrank();

        assertEq(social.postCount(), 3);

        (, , , , uint256 postCnt) = social.getProfile(alice);
        assertEq(postCnt, 3);
    }

    // ============ Likes ============

    function test_likePost() public {
        _createProfile(alice, "alice");

        vm.prank(alice);
        social.createPost("Likeable content");

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit PostLiked(1, bob);
        social.likePost(1);

        (, , , , uint256 likes, , , ) = social.posts(1);
        assertEq(likes, 1);
        assertTrue(social.hasLiked(1, bob));
    }

    function test_likePost_revert_alreadyLiked() public {
        _createProfile(alice, "alice");
        vm.prank(alice);
        social.createPost("Content");

        vm.prank(bob);
        social.likePost(1);

        vm.prank(bob);
        vm.expectRevert("Already liked");
        social.likePost(1);
    }

    function test_likePost_revert_postNotActive() public {
        // Post 0 doesn't exist — active is false by default
        vm.prank(alice);
        vm.expectRevert("Post not active");
        social.likePost(0);
    }

    function test_likePost_multipleLikers() public {
        _createProfile(alice, "alice");
        vm.prank(alice);
        social.createPost("Popular post");

        vm.prank(bob);
        social.likePost(1);
        vm.prank(charlie);
        social.likePost(1);

        (, , , , uint256 likes, , , ) = social.posts(1);
        assertEq(likes, 2);
    }

    // ============ Comments ============

    function test_commentOnPost() public {
        _createProfile(alice, "alice");
        _createProfile(bob, "bob");

        vm.prank(alice);
        social.createPost("Original post");

        vm.prank(bob);
        vm.expectEmit(true, false, true, false);
        emit CommentCreated(1, 0, bob);
        social.commentOnPost(1, "Great post!");

        (, , , , , uint256 commentCount, , ) = social.posts(1);
        assertEq(commentCount, 1);

        (uint256 cPostId, address cAuthor, string memory cContent, , , , , bool cActive) = social.comments(1, 0);
        assertEq(cPostId, 0);
        assertEq(cAuthor, bob);
        assertEq(cContent, "Great post!");
        assertTrue(cActive);
    }

    function test_commentOnPost_revert_noProfile() public {
        _createProfile(alice, "alice");
        vm.prank(alice);
        social.createPost("Post");

        vm.prank(bob); // no profile
        vm.expectRevert("No profile");
        social.commentOnPost(1, "Comment");
    }

    function test_commentOnPost_revert_postNotActive() public {
        _createProfile(alice, "alice");

        vm.prank(alice);
        vm.expectRevert("Post not active");
        social.commentOnPost(999, "Comment");
    }

    // ============ Tips ============

    function test_tipPost() public {
        _createProfile(alice, "alice");
        vm.prank(alice);
        social.createPost("Tip-worthy");

        uint256 aliceBefore = alice.balance;

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit Tipped(1, bob, 1 ether);
        social.tipPost{value: 1 ether}(1);

        (, , , , , , uint256 tipAmount, ) = social.posts(1);
        assertEq(tipAmount, 1 ether);
        assertEq(social.totalTipsReceived(alice), 1 ether);
        assertEq(alice.balance, aliceBefore + 1 ether);
    }

    function test_tipPost_revert_zeroTip() public {
        _createProfile(alice, "alice");
        vm.prank(alice);
        social.createPost("Post");

        vm.prank(bob);
        vm.expectRevert("Zero tip");
        social.tipPost{value: 0}(1);
    }

    function test_tipPost_revert_postNotActive() public {
        vm.prank(bob);
        vm.expectRevert("Post not active");
        social.tipPost{value: 1 ether}(999);
    }

    function test_tipPost_multipleTips() public {
        _createProfile(alice, "alice");
        vm.prank(alice);
        social.createPost("Popular post");

        vm.prank(bob);
        social.tipPost{value: 1 ether}(1);

        vm.prank(charlie);
        social.tipPost{value: 2 ether}(1);

        (, , , , , , uint256 tipAmount, ) = social.posts(1);
        assertEq(tipAmount, 3 ether);
        assertEq(social.totalTipsReceived(alice), 3 ether);
    }

    // ============ View Functions ============

    function test_resolveHandle() public {
        _createProfile(alice, "alice_handle");
        assertEq(social.resolveHandle("alice_handle"), alice);
    }

    function test_resolveHandle_notFound() public view {
        assertEq(social.resolveHandle("nonexistent"), address(0));
    }

    // ============ Fuzz Tests ============

    function testFuzz_tipPost_anyAmount(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(bob, uint256(amount));

        _createProfile(alice, "alice");
        vm.prank(alice);
        social.createPost("Post");

        vm.prank(bob);
        social.tipPost{value: amount}(1);

        assertEq(social.totalTipsReceived(alice), uint256(amount));
    }

    function testFuzz_multipleFollows(uint8 count) public {
        count = uint8(bound(count, 1, 30));
        _createProfile(alice, "alice");

        for (uint8 i = 0; i < count; i++) {
            address follower = makeAddr(string(abi.encodePacked("f", i)));
            _createProfile(follower, string(abi.encodePacked("handle_", i, "_x")));
            vm.prank(follower);
            social.follow(alice);
        }

        (, , uint256 followers, , ) = social.getProfile(alice);
        assertEq(followers, uint256(count));
    }

    // ============ Edge Cases ============

    function test_followUnfollowRefollow() public {
        _createProfile(alice, "alice");
        _createProfile(bob, "bob");

        vm.startPrank(alice);
        social.follow(bob);
        social.unfollow(bob);
        social.follow(bob);
        vm.stopPrank();

        assertTrue(social.isFollowing(alice, bob));
    }
}
