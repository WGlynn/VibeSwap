// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/Forum.sol";
import "../../contracts/identity/SoulboundIdentity.sol";

contract MockFIIdentity {
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

// ============ Handler ============

contract ForumHandler is Test {
    Forum public forum;
    address public poster;

    uint256 public ghost_postsCreated;
    uint256 public ghost_repliesCreated;

    constructor(Forum _forum, address _poster) {
        forum = _forum;
        poster = _poster;
    }

    function createPost(uint256 categoryId) public {
        categoryId = bound(categoryId, 1, 5); // 5 default categories
        bytes32 contentHash = keccak256(abi.encodePacked("post", ghost_postsCreated));

        vm.prank(poster);
        try forum.createPost(categoryId, "Post", contentHash) {
            ghost_postsCreated++;
        } catch {}
    }

    function createReply(uint256 postIdSeed) public {
        if (ghost_postsCreated == 0) return;
        uint256 postId = (postIdSeed % ghost_postsCreated) + 1;
        bytes32 contentHash = keccak256(abi.encodePacked("reply", ghost_repliesCreated));

        vm.prank(poster);
        try forum.createReply(postId, contentHash, 0) {
            ghost_repliesCreated++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 120); // 1-120 seconds
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract ForumInvariantTest is StdInvariant, Test {
    Forum public forum;
    ForumHandler public handler;

    function setUp() public {
        MockFIIdentity identity = new MockFIIdentity();
        address poster = makeAddr("poster");
        identity.setIdentity(poster, 1);

        Forum impl = new Forum();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(Forum.initialize.selector, address(identity))
        );
        forum = Forum(address(proxy));
        forum.setPostCooldown(0);

        vm.warp(100);

        handler = new ForumHandler(forum, poster);
        targetContract(address(handler));
    }

    /// @notice Post count matches ghost
    function invariant_postCountConsistent() public view {
        assertEq(forum.totalPosts(), handler.ghost_postsCreated());
    }

    /// @notice Reply count matches ghost
    function invariant_replyCountConsistent() public view {
        assertEq(forum.totalReplies(), handler.ghost_repliesCreated());
    }

    /// @notice Category count is always >= 5 (defaults)
    function invariant_categoriesAlwaysExist() public view {
        assertGe(forum.totalCategories(), 5);
    }
}
