// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./SoulboundIdentity.sol";

/**
 * @title Forum
 * @notice Decentralized forum where contributions are bound to soulbound identities
 * @dev All posts/replies are linked to on-chain identity NFTs
 */
contract Forum is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Structs ============

    struct Category {
        string name;
        string description;
        uint256 postCount;
        bool active;
    }

    struct Post {
        uint256 id;
        uint256 categoryId;
        uint256 authorTokenId;
        address author;
        string title;
        bytes32 contentHash;      // IPFS hash
        uint256 createdAt;
        uint256 lastReplyAt;
        uint256 replyCount;
        bool pinned;
        bool locked;
    }

    struct Reply {
        uint256 id;
        uint256 postId;
        uint256 authorTokenId;
        address author;
        bytes32 contentHash;
        uint256 createdAt;
        uint256 parentReplyId;    // 0 if direct reply to post
    }

    // ============ State ============

    SoulboundIdentity public identityContract;

    uint256 private _nextCategoryId;
    uint256 private _nextPostId;
    uint256 private _nextReplyId;

    mapping(uint256 => Category) public categories;
    mapping(uint256 => Post) public posts;
    mapping(uint256 => Reply) public replies;

    mapping(uint256 => uint256[]) public categoryPosts;      // categoryId => postIds
    mapping(uint256 => uint256[]) public postReplies;        // postId => replyIds
    mapping(uint256 => uint256[]) public userPosts;          // tokenId => postIds
    mapping(uint256 => uint256[]) public userReplies;        // tokenId => replyIds

    // Rate limiting
    mapping(address => uint256) public lastPostTime;
    uint256 public postCooldown;

    // Moderation
    mapping(address => bool) public moderators;

    // ============ Events ============

    event CategoryCreated(uint256 indexed categoryId, string name);
    event PostCreated(uint256 indexed postId, uint256 indexed categoryId, uint256 indexed authorTokenId, string title);
    event ReplyCreated(uint256 indexed replyId, uint256 indexed postId, uint256 indexed authorTokenId);
    event PostPinned(uint256 indexed postId, bool pinned);
    event PostLocked(uint256 indexed postId, bool locked);
    event ModeratorUpdated(address indexed moderator, bool status);

    // ============ Errors ============

    error NoIdentity();
    error CategoryNotFound();
    error CategoryInactive();
    error PostNotFound();
    error PostIsLocked();
    error ReplyNotFound();
    error CooldownActive();
    error NotModerator();
    error EmptyContent();

    // ============ Modifiers ============

    modifier requireIdentity() {
        if (!identityContract.hasIdentity(msg.sender)) revert NoIdentity();
        _;
    }

    modifier onlyModerator() {
        if (!moderators[msg.sender] && msg.sender != owner()) revert NotModerator();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _identityContract) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        identityContract = SoulboundIdentity(_identityContract);
        postCooldown = 60; // 1 minute between posts

        _nextCategoryId = 1;
        _nextPostId = 1;
        _nextReplyId = 1;

        // Create default categories
        _createCategory("General", "General discussion about VibeSwap");
        _createCategory("Trading", "Trading strategies and insights");
        _createCategory("Proposals", "Governance proposals and discussions");
        _createCategory("Development", "Technical development and contributions");
        _createCategory("Support", "Help and support requests");
    }

    // ============ Category Management ============

    function createCategory(string calldata name, string calldata description) external onlyOwner {
        _createCategory(name, description);
    }

    function _createCategory(string memory name, string memory description) internal {
        uint256 categoryId = _nextCategoryId++;

        categories[categoryId] = Category({
            name: name,
            description: description,
            postCount: 0,
            active: true
        });

        emit CategoryCreated(categoryId, name);
    }

    function setCategoryActive(uint256 categoryId, bool active) external onlyModerator {
        if (categoryId == 0 || categoryId >= _nextCategoryId) revert CategoryNotFound();
        categories[categoryId].active = active;
    }

    // ============ Post Management ============

    /**
     * @notice Create a new post
     * @param categoryId Category to post in
     * @param title Post title
     * @param contentHash IPFS hash of post content
     */
    function createPost(
        uint256 categoryId,
        string calldata title,
        bytes32 contentHash
    ) external requireIdentity nonReentrant returns (uint256) {
        if (categoryId == 0 || categoryId >= _nextCategoryId) revert CategoryNotFound();
        if (!categories[categoryId].active) revert CategoryInactive();
        if (contentHash == bytes32(0)) revert EmptyContent();

        // Rate limiting
        if (block.timestamp < lastPostTime[msg.sender] + postCooldown) {
            revert CooldownActive();
        }
        lastPostTime[msg.sender] = block.timestamp;

        uint256 tokenId = identityContract.addressToTokenId(msg.sender);
        uint256 postId = _nextPostId++;

        posts[postId] = Post({
            id: postId,
            categoryId: categoryId,
            authorTokenId: tokenId,
            author: msg.sender,
            title: title,
            contentHash: contentHash,
            createdAt: block.timestamp,
            lastReplyAt: block.timestamp,
            replyCount: 0,
            pinned: false,
            locked: false
        });

        categoryPosts[categoryId].push(postId);
        userPosts[tokenId].push(postId);
        categories[categoryId].postCount++;

        // Record contribution in identity contract
        identityContract.recordContribution(
            msg.sender,
            contentHash,
            SoulboundIdentity.ContributionType.POST
        );

        emit PostCreated(postId, categoryId, tokenId, title);

        return postId;
    }

    /**
     * @notice Reply to a post
     * @param postId Post to reply to
     * @param contentHash IPFS hash of reply content
     * @param parentReplyId Optional parent reply (0 for direct post reply)
     */
    function createReply(
        uint256 postId,
        bytes32 contentHash,
        uint256 parentReplyId
    ) external requireIdentity nonReentrant returns (uint256) {
        if (postId == 0 || postId >= _nextPostId) revert PostNotFound();
        Post storage post = posts[postId];
        if (post.locked) revert PostIsLocked();
        if (contentHash == bytes32(0)) revert EmptyContent();

        // Validate parent reply if provided
        if (parentReplyId != 0) {
            if (parentReplyId >= _nextReplyId) revert ReplyNotFound();
            if (replies[parentReplyId].postId != postId) revert ReplyNotFound();
        }

        uint256 tokenId = identityContract.addressToTokenId(msg.sender);
        uint256 replyId = _nextReplyId++;

        replies[replyId] = Reply({
            id: replyId,
            postId: postId,
            authorTokenId: tokenId,
            author: msg.sender,
            contentHash: contentHash,
            createdAt: block.timestamp,
            parentReplyId: parentReplyId
        });

        postReplies[postId].push(replyId);
        userReplies[tokenId].push(replyId);
        post.replyCount++;
        post.lastReplyAt = block.timestamp;

        // Record contribution
        identityContract.recordContribution(
            msg.sender,
            contentHash,
            SoulboundIdentity.ContributionType.REPLY
        );

        emit ReplyCreated(replyId, postId, tokenId);

        return replyId;
    }

    // ============ Moderation ============

    function setPinned(uint256 postId, bool pinned) external onlyModerator {
        if (postId == 0 || postId >= _nextPostId) revert PostNotFound();
        posts[postId].pinned = pinned;
        emit PostPinned(postId, pinned);
    }

    function setLocked(uint256 postId, bool locked) external onlyModerator {
        if (postId == 0 || postId >= _nextPostId) revert PostNotFound();
        posts[postId].locked = locked;
        emit PostLocked(postId, locked);
    }

    function setModerator(address moderator, bool status) external onlyOwner {
        moderators[moderator] = status;
        emit ModeratorUpdated(moderator, status);
    }

    function setPostCooldown(uint256 cooldown) external onlyOwner {
        postCooldown = cooldown;
    }

    // ============ View Functions ============

    function getCategory(uint256 categoryId) external view returns (Category memory) {
        return categories[categoryId];
    }

    function getCategoryPosts(uint256 categoryId, uint256 offset, uint256 limit)
        external view returns (Post[] memory)
    {
        uint256[] storage postIds = categoryPosts[categoryId];
        uint256 len = postIds.length;

        if (offset >= len) return new Post[](0);

        uint256 end = offset + limit;
        if (end > len) end = len;

        Post[] memory result = new Post[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = posts[postIds[len - 1 - i]]; // Reverse order (newest first)
        }
        return result;
    }

    function getPostReplies(uint256 postId, uint256 offset, uint256 limit)
        external view returns (Reply[] memory)
    {
        uint256[] storage replyIds = postReplies[postId];
        uint256 len = replyIds.length;

        if (offset >= len) return new Reply[](0);

        uint256 end = offset + limit;
        if (end > len) end = len;

        Reply[] memory result = new Reply[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = replies[replyIds[i]];
        }
        return result;
    }

    function getUserPosts(uint256 tokenId) external view returns (uint256[] memory) {
        return userPosts[tokenId];
    }

    function getUserReplies(uint256 tokenId) external view returns (uint256[] memory) {
        return userReplies[tokenId];
    }

    function totalCategories() external view returns (uint256) {
        return _nextCategoryId - 1;
    }

    function totalPosts() external view returns (uint256) {
        return _nextPostId - 1;
    }

    function totalReplies() external view returns (uint256) {
        return _nextReplyId - 1;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
