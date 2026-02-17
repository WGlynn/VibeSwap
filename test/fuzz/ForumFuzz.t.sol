// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/Forum.sol";
import "../../contracts/identity/SoulboundIdentity.sol";

contract MockFFIdentity {
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
        return 1;
    }
}

contract ForumFuzzTest is Test {
    Forum public forum;
    MockFFIdentity public identity;
    address public poster;

    function setUp() public {
        identity = new MockFFIdentity();
        poster = makeAddr("poster");
        identity.setIdentity(poster, 1);

        Forum impl = new Forum();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(Forum.initialize.selector, address(identity))
        );
        forum = Forum(address(proxy));

        // Set cooldown to 0 for fuzz testing ease
        forum.setPostCooldown(0);
    }

    /// @notice Post count is monotonically increasing
    function testFuzz_postCountMonotonic(uint8 count) public {
        count = uint8(bound(count, 1, 20));

        for (uint256 i = 0; i < count; i++) {
            vm.prank(poster);
            forum.createPost(1, "Post", keccak256(abi.encodePacked("c", i)));
        }

        assertEq(forum.totalPosts(), count);
    }

    /// @notice Category post count matches actual posts
    function testFuzz_categoryPostCountConsistent(uint8 count) public {
        count = uint8(bound(count, 1, 10));

        for (uint256 i = 0; i < count; i++) {
            vm.prank(poster);
            forum.createPost(1, "Post", keccak256(abi.encodePacked("c", i)));
        }

        (, , uint256 postCount, ) = forum.categories(1);
        assertEq(postCount, count);
    }

    /// @notice Cooldown blocks rapid posting
    function testFuzz_cooldownBlocks(uint256 cooldown) public {
        cooldown = bound(cooldown, 10, 3600);

        forum.setPostCooldown(cooldown);

        vm.warp(10_000);
        vm.prank(poster);
        forum.createPost(1, "First", keccak256("first"));

        // Immediately after should fail
        vm.prank(poster);
        vm.expectRevert(Forum.CooldownActive.selector);
        forum.createPost(1, "Second", keccak256("second"));

        // After cooldown should succeed
        vm.warp(10_000 + cooldown + 1);
        vm.prank(poster);
        forum.createPost(1, "Third", keccak256("third"));
        assertEq(forum.totalPosts(), 2);
    }

    /// @notice Reply count is tracked per post
    function testFuzz_replyCountTracked(uint8 replyCount) public {
        replyCount = uint8(bound(replyCount, 1, 10));

        vm.prank(poster);
        forum.createPost(1, "Post", keccak256("content"));

        for (uint256 i = 0; i < replyCount; i++) {
            vm.prank(poster);
            forum.createReply(1, keccak256(abi.encodePacked("r", i)), 0);
        }

        (, , , , , , , , uint256 count, , ) = forum.posts(1);
        assertEq(count, replyCount);
    }
}
