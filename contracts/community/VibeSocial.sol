// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeSocial — On-Chain Social Graph
 * @notice Decentralized social layer for VSOS.
 *         Follow/unfollow, posts, comments, tips, and social recovery.
 *         Lens Protocol alternative — fully on-chain, no off-chain indexer required.
 */
contract VibeSocial is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct Profile {
        address owner;
        string handle;
        string bio;
        string avatar;             // IPFS hash
        uint256 followerCount;
        uint256 followingCount;
        uint256 postCount;
        uint256 createdAt;
        bool active;
    }

    struct Post {
        uint256 postId;
        address author;
        string content;            // IPFS hash for long content
        uint256 timestamp;
        uint256 likes;
        uint256 commentCount;
        uint256 tipAmount;
        bool active;
    }

    // ============ State ============

    /// @notice Profiles
    mapping(address => Profile) public profiles;
    mapping(string => address) public handleToAddress;
    uint256 public profileCount;

    /// @notice Social graph: follower => following => bool
    mapping(address => mapping(address => bool)) public isFollowing;

    /// @notice Posts
    mapping(uint256 => Post) public posts;
    uint256 public postCount;

    /// @notice Comments: postId => commentIndex => Post
    mapping(uint256 => mapping(uint256 => Post)) public comments;

    /// @notice Likes: postId => user => liked
    mapping(uint256 => mapping(address => bool)) public hasLiked;

    /// @notice Total tips per user
    mapping(address => uint256) public totalTipsReceived;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ProfileCreated(address indexed owner, string handle);
    event Followed(address indexed follower, address indexed following);
    event Unfollowed(address indexed follower, address indexed following);
    event PostCreated(uint256 indexed postId, address indexed author);
    event PostLiked(uint256 indexed postId, address indexed liker);
    event CommentCreated(uint256 indexed postId, uint256 commentIndex, address indexed commenter);
    event Tipped(uint256 indexed postId, address indexed tipper, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Profile ============

    function createProfile(
        string calldata handle,
        string calldata bio,
        string calldata avatar
    ) external {
        require(!profiles[msg.sender].active, "Already has profile");
        require(handleToAddress[handle] == address(0), "Handle taken");
        require(bytes(handle).length >= 3 && bytes(handle).length <= 32, "Invalid handle");

        profiles[msg.sender] = Profile({
            owner: msg.sender,
            handle: handle,
            bio: bio,
            avatar: avatar,
            followerCount: 0,
            followingCount: 0,
            postCount: 0,
            createdAt: block.timestamp,
            active: true
        });

        handleToAddress[handle] = msg.sender;
        profileCount++;

        emit ProfileCreated(msg.sender, handle);
    }

    function updateProfile(string calldata bio, string calldata avatar) external {
        require(profiles[msg.sender].active, "No profile");
        profiles[msg.sender].bio = bio;
        profiles[msg.sender].avatar = avatar;
    }

    // ============ Social Graph ============

    function follow(address target) external {
        require(profiles[msg.sender].active && profiles[target].active, "Profile required");
        require(!isFollowing[msg.sender][target], "Already following");
        require(msg.sender != target, "Cannot self-follow");

        isFollowing[msg.sender][target] = true;
        profiles[msg.sender].followingCount++;
        profiles[target].followerCount++;

        emit Followed(msg.sender, target);
    }

    function unfollow(address target) external {
        require(isFollowing[msg.sender][target], "Not following");

        isFollowing[msg.sender][target] = false;
        profiles[msg.sender].followingCount--;
        profiles[target].followerCount--;

        emit Unfollowed(msg.sender, target);
    }

    // ============ Posts ============

    function createPost(string calldata content) external {
        require(profiles[msg.sender].active, "No profile");

        postCount++;
        posts[postCount] = Post({
            postId: postCount,
            author: msg.sender,
            content: content,
            timestamp: block.timestamp,
            likes: 0,
            commentCount: 0,
            tipAmount: 0,
            active: true
        });

        profiles[msg.sender].postCount++;
        emit PostCreated(postCount, msg.sender);
    }

    function likePost(uint256 postId) external {
        require(posts[postId].active, "Post not active");
        require(!hasLiked[postId][msg.sender], "Already liked");

        hasLiked[postId][msg.sender] = true;
        posts[postId].likes++;

        emit PostLiked(postId, msg.sender);
    }

    function commentOnPost(uint256 postId, string calldata content) external {
        require(posts[postId].active, "Post not active");
        require(profiles[msg.sender].active, "No profile");

        uint256 idx = posts[postId].commentCount;
        comments[postId][idx] = Post({
            postId: idx,
            author: msg.sender,
            content: content,
            timestamp: block.timestamp,
            likes: 0,
            commentCount: 0,
            tipAmount: 0,
            active: true
        });

        posts[postId].commentCount++;
        emit CommentCreated(postId, idx, msg.sender);
    }

    function tipPost(uint256 postId) external payable {
        require(posts[postId].active, "Post not active");
        require(msg.value > 0, "Zero tip");

        posts[postId].tipAmount += msg.value;
        totalTipsReceived[posts[postId].author] += msg.value;

        (bool ok, ) = posts[postId].author.call{value: msg.value}("");
        require(ok, "Tip failed");

        emit Tipped(postId, msg.sender, msg.value);
    }

    // ============ View ============

    function getProfile(address user) external view returns (
        string memory handle, string memory bio, uint256 followers, uint256 following, uint256 postCnt
    ) {
        Profile storage p = profiles[user];
        return (p.handle, p.bio, p.followerCount, p.followingCount, p.postCount);
    }

    function resolveHandle(string calldata handle) external view returns (address) {
        return handleToAddress[handle];
    }
}
