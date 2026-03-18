// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeSocialGraph — Lens/Farcaster-Style On-Chain Social Layer
 * @notice Absorbs decentralized social graph patterns: follow/unfollow,
 *         content posts with content-addressed storage, social reputation,
 *         and composable social primitives. No platform lock-in —
 *         your social graph lives on-chain forever.
 *
 * @dev Architecture:
 *      - Profiles with content-hash metadata (IPFS)
 *      - Directed follow graph with weight (interest level)
 *      - Posts as content-hash references (actual data on IPFS/Arweave)
 *      - Reactions (like/repost/quote) as lightweight on-chain records
 *      - Social reputation from engagement quality
 *      - Composable: other contracts can read social graph
 */
contract VibeSocialGraph is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct Profile {
        address owner;
        bytes32 handleHash;          // keccak256 of handle string
        bytes32 metadataHash;        // IPFS hash of profile metadata
        uint256 followers;
        uint256 following;
        uint256 posts;
        uint256 socialScore;         // 0-10000
        uint256 createdAt;
        bool active;
    }

    struct Post {
        uint256 postId;
        address author;
        bytes32 contentHash;         // IPFS hash of content
        uint256 likes;
        uint256 reposts;
        uint256 replies;
        uint256 timestamp;
        uint256 parentPostId;        // 0 if root post
    }

    // ============ State ============

    mapping(address => Profile) public profiles;
    mapping(bytes32 => address) public handleToAddress;

    /// @notice Follow graph: follower => following => weight (0 = not following)
    mapping(address => mapping(address => uint256)) public followWeight;

    mapping(uint256 => Post) public posts;
    uint256 public postCount;

    /// @notice Reactions: postId => user => reacted
    mapping(uint256 => mapping(address => bool)) public liked;
    mapping(uint256 => mapping(address => bool)) public reposted;

    /// @notice User posts index
    mapping(address => uint256[]) public userPosts;

    /// @notice Stats
    uint256 public totalProfiles;
    uint256 public totalPosts;
    uint256 public totalFollows;

    // ============ Events ============

    event ProfileCreated(address indexed owner, bytes32 handleHash);
    event Followed(address indexed follower, address indexed followed, uint256 weight);
    event Unfollowed(address indexed follower, address indexed unfollowed);
    event PostCreated(uint256 indexed postId, address indexed author, bytes32 contentHash);
    event PostLiked(uint256 indexed postId, address indexed liker);
    event PostReposted(uint256 indexed postId, address indexed reposter);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Profile ============

    function createProfile(bytes32 handleHash, bytes32 metadataHash) external {
        require(profiles[msg.sender].createdAt == 0, "Already has profile");
        require(handleToAddress[handleHash] == address(0), "Handle taken");

        profiles[msg.sender] = Profile({
            owner: msg.sender,
            handleHash: handleHash,
            metadataHash: metadataHash,
            followers: 0,
            following: 0,
            posts: 0,
            socialScore: 5000,
            createdAt: block.timestamp,
            active: true
        });

        handleToAddress[handleHash] = msg.sender;
        totalProfiles++;

        emit ProfileCreated(msg.sender, handleHash);
    }

    function updateProfile(bytes32 metadataHash) external {
        require(profiles[msg.sender].active, "No profile");
        profiles[msg.sender].metadataHash = metadataHash;
    }

    // ============ Follow Graph ============

    function follow(address target, uint256 weight) external {
        require(target != msg.sender, "Cannot follow self");
        require(profiles[target].active, "Target has no profile");
        require(weight > 0 && weight <= 10000, "Invalid weight");
        require(followWeight[msg.sender][target] == 0, "Already following");

        followWeight[msg.sender][target] = weight;
        profiles[msg.sender].following++;
        profiles[target].followers++;
        totalFollows++;

        // Update social score based on followers
        _updateSocialScore(target);

        emit Followed(msg.sender, target, weight);
    }

    function unfollow(address target) external {
        require(followWeight[msg.sender][target] > 0, "Not following");

        followWeight[msg.sender][target] = 0;
        profiles[msg.sender].following--;
        profiles[target].followers--;
        totalFollows--;

        _updateSocialScore(target);

        emit Unfollowed(msg.sender, target);
    }

    // ============ Posts ============

    function createPost(bytes32 contentHash, uint256 parentPostId) external returns (uint256) {
        require(profiles[msg.sender].active, "No profile");

        postCount++;
        posts[postCount] = Post({
            postId: postCount,
            author: msg.sender,
            contentHash: contentHash,
            likes: 0,
            reposts: 0,
            replies: 0,
            timestamp: block.timestamp,
            parentPostId: parentPostId
        });

        userPosts[msg.sender].push(postCount);
        profiles[msg.sender].posts++;
        totalPosts++;

        if (parentPostId > 0 && posts[parentPostId].author != address(0)) {
            posts[parentPostId].replies++;
        }

        emit PostCreated(postCount, msg.sender, contentHash);
        return postCount;
    }

    function likePost(uint256 postId) external {
        require(!liked[postId][msg.sender], "Already liked");
        require(posts[postId].author != address(0), "Post not found");

        liked[postId][msg.sender] = true;
        posts[postId].likes++;

        _updateSocialScore(posts[postId].author);

        emit PostLiked(postId, msg.sender);
    }

    function repost(uint256 postId) external {
        require(!reposted[postId][msg.sender], "Already reposted");
        require(posts[postId].author != address(0), "Post not found");

        reposted[postId][msg.sender] = true;
        posts[postId].reposts++;

        _updateSocialScore(posts[postId].author);

        emit PostReposted(postId, msg.sender);
    }

    // ============ Internal ============

    function _updateSocialScore(address user) internal {
        Profile storage p = profiles[user];
        // Simple engagement-based score
        uint256 engagement = p.followers * 3 + p.posts * 2;
        uint256 score = engagement > 10000 ? 10000 : engagement;
        p.socialScore = (p.socialScore * 9 + score) / 10; // EMA
    }

    // ============ View ============

    function getProfile(address user) external view returns (Profile memory) { return profiles[user]; }
    function getPost(uint256 id) external view returns (Post memory) { return posts[id]; }
    function getUserPosts(address user) external view returns (uint256[] memory) { return userPosts[user]; }
    function isFollowing(address follower, address target) external view returns (bool) { return followWeight[follower][target] > 0; }

    receive() external payable {}
}
