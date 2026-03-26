// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeSocialGraph.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VibeSocialGraphTest
 * @notice Unit tests for VibeSocialGraph (Lens/Farcaster-style on-chain social layer)
 *
 * Coverage:
 *   - Profile creation: handle uniqueness, duplicate guard
 *   - Profile update: metadata hash update
 *   - Follow graph: follow/unfollow, weight, self-follow guard
 *   - Posts: root post, reply (parentPostId), post indexing
 *   - Reactions: like, repost, double-action guards
 *   - Social score: EMA update on follows and likes
 *   - View helpers: getProfile, getPost, getUserPosts, isFollowing
 *   - Global counters: totalProfiles, totalPosts, totalFollows
 *   - UUPS upgrade: only owner
 */
contract VibeSocialGraphTest is Test {
    VibeSocialGraph public sg;
    VibeSocialGraph public impl;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    // ============ Events ============

    event ProfileCreated(address indexed owner, bytes32 handleHash);
    event Followed(address indexed follower, address indexed followed, uint256 weight);
    event Unfollowed(address indexed follower, address indexed unfollowed);
    event PostCreated(uint256 indexed postId, address indexed author, bytes32 contentHash);
    event PostLiked(uint256 indexed postId, address indexed liker);
    event PostReposted(uint256 indexed postId, address indexed reposter);

    bytes32 constant ALICE_HANDLE   = keccak256("alice");
    bytes32 constant BOB_HANDLE     = keccak256("bob");
    bytes32 constant CAROL_HANDLE   = keccak256("carol");
    bytes32 constant META_HASH      = keccak256("metadata");
    bytes32 constant CONTENT_HASH   = keccak256("content");

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob   = makeAddr("bob");
        carol = makeAddr("carol");

        impl = new VibeSocialGraph();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeSocialGraph.initialize, ())
        );
        sg = VibeSocialGraph(payable(address(proxy)));
    }

    // ============ Helpers ============

    function _createAlice() internal {
        vm.prank(alice);
        sg.createProfile(ALICE_HANDLE, META_HASH);
    }

    function _createBob() internal {
        vm.prank(bob);
        sg.createProfile(BOB_HANDLE, META_HASH);
    }

    function _createCarol() internal {
        vm.prank(carol);
        sg.createProfile(CAROL_HANDLE, META_HASH);
    }

    // ============ Initialization ============

    function test_initialize_state() public view {
        assertEq(sg.totalProfiles(), 0);
        assertEq(sg.totalPosts(), 0);
        assertEq(sg.totalFollows(), 0);
        assertEq(sg.postCount(), 0);
    }

    // ============ Profile Creation ============

    function test_createProfile_basic() public {
        _createAlice();

        assertEq(sg.totalProfiles(), 1);

        VibeSocialGraph.Profile memory p = sg.getProfile(alice);
        assertEq(p.owner, alice);
        assertEq(p.handleHash, ALICE_HANDLE);
        assertEq(p.metadataHash, META_HASH);
        assertEq(p.followers, 0);
        assertEq(p.following, 0);
        assertEq(p.posts, 0);
        assertEq(p.socialScore, 5000);
        assertTrue(p.active);
        assertGt(p.createdAt, 0);
    }

    function test_createProfile_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit ProfileCreated(alice, ALICE_HANDLE);
        sg.createProfile(ALICE_HANDLE, META_HASH);
    }

    function test_createProfile_registersHandle() public {
        _createAlice();
        assertEq(sg.handleToAddress(ALICE_HANDLE), alice);
    }

    function test_createProfile_revert_alreadyHasProfile() public {
        _createAlice();

        vm.prank(alice);
        vm.expectRevert("Already has profile");
        sg.createProfile(keccak256("alice2"), META_HASH);
    }

    function test_createProfile_revert_handleTaken() public {
        _createAlice();

        vm.prank(bob);
        vm.expectRevert("Handle taken");
        sg.createProfile(ALICE_HANDLE, META_HASH); // same handle
    }

    // ============ Profile Update ============

    function test_updateProfile_changesMetadataHash() public {
        _createAlice();

        bytes32 newMeta = keccak256("newMetadata");
        vm.prank(alice);
        sg.updateProfile(newMeta);

        VibeSocialGraph.Profile memory p = sg.getProfile(alice);
        assertEq(p.metadataHash, newMeta);
    }

    function test_updateProfile_revert_noProfile() public {
        vm.prank(alice);
        vm.expectRevert("No profile");
        sg.updateProfile(META_HASH);
    }

    // ============ Follow Graph ============

    function test_follow_basic() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.follow(bob, 5000);

        assertEq(sg.followWeight(alice, bob), 5000);
        assertEq(sg.getProfile(alice).following, 1);
        assertEq(sg.getProfile(bob).followers, 1);
        assertEq(sg.totalFollows(), 1);
        assertTrue(sg.isFollowing(alice, bob));
    }

    function test_follow_emitsEvent() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Followed(alice, bob, 7500);
        sg.follow(bob, 7500);
    }

    function test_follow_revert_selfFollow() public {
        _createAlice();

        vm.prank(alice);
        vm.expectRevert("Cannot follow self");
        sg.follow(alice, 5000);
    }

    function test_follow_revert_targetNoProfile() public {
        _createAlice();

        vm.prank(alice);
        vm.expectRevert("Target has no profile");
        sg.follow(carol, 5000); // carol has no profile
    }

    function test_follow_revert_invalidWeightZero() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        vm.expectRevert("Invalid weight");
        sg.follow(bob, 0);
    }

    function test_follow_revert_invalidWeightTooHigh() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        vm.expectRevert("Invalid weight");
        sg.follow(bob, 10001);
    }

    function test_follow_revert_alreadyFollowing() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.follow(bob, 5000);

        vm.prank(alice);
        vm.expectRevert("Already following");
        sg.follow(bob, 3000);
    }

    function test_unfollow_basic() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.follow(bob, 5000);

        vm.prank(alice);
        sg.unfollow(bob);

        assertEq(sg.followWeight(alice, bob), 0);
        assertEq(sg.getProfile(alice).following, 0);
        assertEq(sg.getProfile(bob).followers, 0);
        assertEq(sg.totalFollows(), 0);
        assertFalse(sg.isFollowing(alice, bob));
    }

    function test_unfollow_emitsEvent() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.follow(bob, 5000);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit Unfollowed(alice, bob);
        sg.unfollow(bob);
    }

    function test_unfollow_revert_notFollowing() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        vm.expectRevert("Not following");
        sg.unfollow(bob);
    }

    // ============ Posts ============

    function test_createPost_rootPost() public {
        _createAlice();

        vm.prank(alice);
        uint256 id = sg.createPost(CONTENT_HASH, 0);

        assertEq(id, 1);
        assertEq(sg.postCount(), 1);
        assertEq(sg.totalPosts(), 1);

        VibeSocialGraph.Post memory post = sg.getPost(1);
        assertEq(post.postId, 1);
        assertEq(post.author, alice);
        assertEq(post.contentHash, CONTENT_HASH);
        assertEq(post.likes, 0);
        assertEq(post.reposts, 0);
        assertEq(post.replies, 0);
        assertEq(post.parentPostId, 0);
        assertGt(post.timestamp, 0);
    }

    function test_createPost_emitsEvent() public {
        _createAlice();

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit PostCreated(1, alice, CONTENT_HASH);
        sg.createPost(CONTENT_HASH, 0);
    }

    function test_createPost_reply_incrementsParentReplies() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        uint256 parentId = sg.createPost(CONTENT_HASH, 0);

        vm.prank(bob);
        uint256 replyId = sg.createPost(keccak256("reply"), parentId);

        VibeSocialGraph.Post memory parent = sg.getPost(parentId);
        assertEq(parent.replies, 1);

        VibeSocialGraph.Post memory reply = sg.getPost(replyId);
        assertEq(reply.parentPostId, parentId);
    }

    function test_createPost_incrementsProfilePostCount() public {
        _createAlice();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        assertEq(sg.getProfile(alice).posts, 1);
    }

    function test_createPost_indexedInUserPosts() public {
        _createAlice();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(alice);
        sg.createPost(keccak256("post2"), 0);

        uint256[] memory ids = sg.getUserPosts(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_createPost_revert_noProfile() public {
        vm.prank(alice);
        vm.expectRevert("No profile");
        sg.createPost(CONTENT_HASH, 0);
    }

    // ============ Reactions ============

    function test_likePost_basic() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(bob);
        sg.likePost(1);

        assertTrue(sg.liked(1, bob));
        assertEq(sg.getPost(1).likes, 1);
    }

    function test_likePost_emitsEvent() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit PostLiked(1, bob);
        sg.likePost(1);
    }

    function test_likePost_revert_alreadyLiked() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(bob);
        sg.likePost(1);

        vm.prank(bob);
        vm.expectRevert("Already liked");
        sg.likePost(1);
    }

    function test_likePost_revert_postNotFound() public {
        vm.prank(bob);
        vm.expectRevert("Post not found");
        sg.likePost(999);
    }

    function test_repost_basic() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(bob);
        sg.repost(1);

        assertTrue(sg.reposted(1, bob));
        assertEq(sg.getPost(1).reposts, 1);
    }

    function test_repost_emitsEvent() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit PostReposted(1, bob);
        sg.repost(1);
    }

    function test_repost_revert_alreadyReposted() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(bob);
        sg.repost(1);

        vm.prank(bob);
        vm.expectRevert("Already reposted");
        sg.repost(1);
    }

    function test_repost_revert_postNotFound() public {
        vm.prank(bob);
        vm.expectRevert("Post not found");
        sg.repost(999);
    }

    // ============ Social Score ============

    function test_socialScore_updatesOnFollow() public {
        _createAlice();
        _createBob();
        _createCarol();

        // Bob and carol follow alice — scores should shift
        vm.prank(bob);
        sg.follow(alice, 5000);

        VibeSocialGraph.Profile memory p = sg.getProfile(alice);
        // After 1 follower: engagement = 1*3 + 0*2 = 3
        // score = (5000 * 9 + 3) / 10 = 4500
        assertEq(p.socialScore, 4500);
    }

    function test_socialScore_updatesOnLike() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(bob);
        sg.likePost(1);

        // After like, social score for alice recomputed
        VibeSocialGraph.Profile memory p = sg.getProfile(alice);
        // engagement = 0*3 + 1*2 = 2  → score = (5000*9 + 2)/10 = 4500
        assertEq(p.socialScore, 4500);
    }

    // ============ Global Counters ============

    function test_globalCounters_multipleProfiles() public {
        _createAlice();
        _createBob();
        _createCarol();

        assertEq(sg.totalProfiles(), 3);
    }

    function test_globalCounters_postsAndFollows() public {
        _createAlice();
        _createBob();

        vm.prank(alice);
        sg.createPost(CONTENT_HASH, 0);

        vm.prank(alice);
        sg.follow(bob, 5000);

        assertEq(sg.totalPosts(), 1);
        assertEq(sg.totalFollows(), 1);
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_onlyOwner() public {
        VibeSocialGraph newImpl = new VibeSocialGraph();

        vm.prank(alice);
        vm.expectRevert();
        sg.upgradeToAndCall(address(newImpl), "");

        address proxyOwner = sg.owner();
        vm.prank(proxyOwner);
        sg.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Integration: Social Feed Flow ============

    function test_integration_socialFeed() public {
        _createAlice();
        _createBob();
        _createCarol();

        // Alice posts
        vm.prank(alice);
        uint256 rootId = sg.createPost(keccak256("alice post"), 0);

        // Bob follows alice, replies, likes
        vm.prank(bob);
        sg.follow(alice, 8000);

        vm.prank(bob);
        uint256 replyId = sg.createPost(keccak256("bob reply"), rootId);

        vm.prank(bob);
        sg.likePost(rootId);

        // Carol reposts and likes
        vm.prank(carol);
        sg.repost(rootId);

        vm.prank(carol);
        sg.follow(alice, 3000);

        // Verify final state
        VibeSocialGraph.Post memory root = sg.getPost(rootId);
        assertEq(root.likes, 1);
        assertEq(root.reposts, 1);
        assertEq(root.replies, 1);

        VibeSocialGraph.Post memory reply = sg.getPost(replyId);
        assertEq(reply.parentPostId, rootId);

        VibeSocialGraph.Profile memory aliceProfile = sg.getProfile(alice);
        assertEq(aliceProfile.followers, 2);
        assertEq(aliceProfile.posts, 1);

        assertEq(sg.totalProfiles(), 3);
        assertEq(sg.totalPosts(), 2);
        assertEq(sg.totalFollows(), 2);
    }
}
