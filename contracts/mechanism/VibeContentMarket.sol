// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeContentMarket — Mirror/Paragraph-Style Content Monetization
 * @notice Absorbs content monetization patterns: writers publish on-chain,
 *         readers pay per article or subscribe, revenue flows directly
 *         to creators. Combined with VibeAttentionToken for attention-based
 *         revenue and Shapley for attribution in collaborative works.
 *
 * @dev Architecture:
 *      - Publications: collections of articles by a creator
 *      - Articles: content-hash references with per-article pricing
 *      - Subscriptions: time-based access to entire publication
 *      - Tips: voluntary payments on top of article price
 *      - Collaborative articles: multi-author with Shapley splits
 *      - 95/5 creator/protocol revenue split
 */
contract VibeContentMarket is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct Publication {
        uint256 pubId;
        address creator;
        bytes32 nameHash;
        bytes32 metadataHash;        // IPFS hash of publication metadata
        uint256 subscriptionPrice;   // Monthly sub price (0 = free)
        uint256 articleCount;
        uint256 subscriberCount;
        uint256 totalRevenue;
        bool active;
    }

    struct Article {
        uint256 articleId;
        uint256 pubId;
        address author;
        bytes32 contentHash;         // IPFS hash
        uint256 price;               // Per-article price (0 = free or sub-only)
        uint256 purchases;
        uint256 tips;
        uint256 totalRevenue;
        uint256 publishedAt;
        bool active;
    }

    struct Subscription {
        address subscriber;
        uint256 pubId;
        uint256 expiresAt;
        uint256 totalPaid;
    }

    // ============ Constants ============

    uint256 public constant PROTOCOL_FEE = 500;   // 5%

    // ============ State ============

    mapping(uint256 => Publication) public publications;
    uint256 public pubCount;

    mapping(uint256 => Article) public articles;
    uint256 public articleCount;

    /// @notice subscriber => pubId => Subscription
    mapping(address => mapping(uint256 => Subscription)) public subscriptions;

    /// @notice article access: articleId => reader => purchased
    mapping(uint256 => mapping(address => bool)) public articleAccess;

    /// @notice Collaborative article splits: articleId => author => share (bps)
    mapping(uint256 => mapping(address => uint256)) public collaboratorShares;
    mapping(uint256 => address[]) public articleCollaborators;

    uint256 public protocolRevenue;
    uint256 public totalContentRevenue;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event PublicationCreated(uint256 indexed pubId, address indexed creator, bytes32 nameHash);
    event ArticlePublished(uint256 indexed articleId, uint256 indexed pubId, bytes32 contentHash, uint256 price);
    event ArticlePurchased(uint256 indexed articleId, address indexed reader, uint256 amount);
    event Subscribed(address indexed subscriber, uint256 indexed pubId, uint256 expiresAt);
    event Tipped(uint256 indexed articleId, address indexed tipper, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Publication ============

    function createPublication(
        bytes32 nameHash,
        bytes32 metadataHash,
        uint256 subscriptionPrice
    ) external returns (uint256) {
        pubCount++;
        publications[pubCount] = Publication({
            pubId: pubCount,
            creator: msg.sender,
            nameHash: nameHash,
            metadataHash: metadataHash,
            subscriptionPrice: subscriptionPrice,
            articleCount: 0,
            subscriberCount: 0,
            totalRevenue: 0,
            active: true
        });

        emit PublicationCreated(pubCount, msg.sender, nameHash);
        return pubCount;
    }

    // ============ Articles ============

    function publishArticle(
        uint256 pubId,
        bytes32 contentHash,
        uint256 price
    ) external returns (uint256) {
        Publication storage pub = publications[pubId];
        require(pub.creator == msg.sender, "Not creator");
        require(pub.active, "Not active");

        articleCount++;
        articles[articleCount] = Article({
            articleId: articleCount,
            pubId: pubId,
            author: msg.sender,
            contentHash: contentHash,
            price: price,
            purchases: 0,
            tips: 0,
            totalRevenue: 0,
            publishedAt: block.timestamp,
            active: true
        });

        pub.articleCount++;

        emit ArticlePublished(articleCount, pubId, contentHash, price);
        return articleCount;
    }

    function publishCollaborativeArticle(
        uint256 pubId,
        bytes32 contentHash,
        uint256 price,
        address[] calldata collaborators,
        uint256[] calldata shares
    ) external returns (uint256) {
        require(collaborators.length == shares.length, "Length mismatch");

        uint256 totalShares;
        for (uint256 i = 0; i < shares.length; i++) {
            totalShares += shares[i];
        }
        require(totalShares == 10000, "Shares must sum to 10000");

        uint256 id = articleCount + 1;

        // Publish the article first
        articleCount++;
        articles[articleCount] = Article({
            articleId: articleCount,
            pubId: pubId,
            author: msg.sender,
            contentHash: contentHash,
            price: price,
            purchases: 0,
            tips: 0,
            totalRevenue: 0,
            publishedAt: block.timestamp,
            active: true
        });

        publications[pubId].articleCount++;

        // Set collaborator shares
        for (uint256 i = 0; i < collaborators.length; i++) {
            collaboratorShares[id][collaborators[i]] = shares[i];
            articleCollaborators[id].push(collaborators[i]);
        }

        emit ArticlePublished(id, pubId, contentHash, price);
        return id;
    }

    // ============ Purchase & Subscribe ============

    function purchaseArticle(uint256 articleId) external payable nonReentrant {
        Article storage a = articles[articleId];
        require(a.active, "Not active");
        require(!articleAccess[articleId][msg.sender], "Already purchased");

        // Check if subscriber (free access)
        Subscription storage sub = subscriptions[msg.sender][a.pubId];
        if (sub.expiresAt > block.timestamp) {
            articleAccess[articleId][msg.sender] = true;
            return;
        }

        require(a.price > 0, "Free article");
        require(msg.value >= a.price, "Insufficient payment");

        articleAccess[articleId][msg.sender] = true;
        a.purchases++;

        _distributeRevenue(articleId, a.price);

        // Refund excess
        if (msg.value > a.price) {
            (bool ok, ) = msg.sender.call{value: msg.value - a.price}("");
            require(ok, "Refund failed");
        }

        emit ArticlePurchased(articleId, msg.sender, a.price);
    }

    function subscribe(uint256 pubId) external payable nonReentrant {
        Publication storage pub = publications[pubId];
        require(pub.active, "Not active");
        require(pub.subscriptionPrice > 0, "No subscription");
        require(msg.value >= pub.subscriptionPrice, "Insufficient payment");

        Subscription storage sub = subscriptions[msg.sender][pubId];
        uint256 start = sub.expiresAt > block.timestamp ? sub.expiresAt : block.timestamp;
        sub.subscriber = msg.sender;
        sub.pubId = pubId;
        sub.expiresAt = start + 30 days;
        sub.totalPaid += msg.value;

        pub.subscriberCount++;

        uint256 fee = (msg.value * PROTOCOL_FEE) / 10000;
        uint256 creatorPayment = msg.value - fee;
        protocolRevenue += fee;
        pub.totalRevenue += creatorPayment;
        totalContentRevenue += msg.value;

        (bool ok, ) = pub.creator.call{value: creatorPayment}("");
        require(ok, "Payment failed");

        emit Subscribed(msg.sender, pubId, sub.expiresAt);
    }

    function tip(uint256 articleId) external payable nonReentrant {
        require(msg.value > 0, "Zero tip");
        Article storage a = articles[articleId];
        require(a.active, "Not active");

        a.tips += msg.value;
        _distributeRevenue(articleId, msg.value);

        emit Tipped(articleId, msg.sender, msg.value);
    }

    // ============ Internal ============

    function _distributeRevenue(uint256 articleId, uint256 amount) internal {
        uint256 fee = (amount * PROTOCOL_FEE) / 10000;
        uint256 creatorAmount = amount - fee;
        protocolRevenue += fee;

        Article storage a = articles[articleId];
        a.totalRevenue += creatorAmount;
        publications[a.pubId].totalRevenue += creatorAmount;
        totalContentRevenue += amount;

        address[] storage collabs = articleCollaborators[articleId];
        if (collabs.length > 0) {
            // Split among collaborators
            for (uint256 i = 0; i < collabs.length; i++) {
                uint256 share = (creatorAmount * collaboratorShares[articleId][collabs[i]]) / 10000;
                if (share > 0) {
                    (bool ok, ) = collabs[i].call{value: share}("");
                    if (!ok) protocolRevenue += share;
                }
            }
        } else {
            // Single author
            (bool ok, ) = a.author.call{value: creatorAmount}("");
            if (!ok) protocolRevenue += creatorAmount;
        }
    }

    // ============ Admin ============

    function withdrawProtocolRevenue() external onlyOwner nonReentrant {
        uint256 amount = protocolRevenue;
        protocolRevenue = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    // ============ View ============

    function getPublication(uint256 id) external view returns (Publication memory) { return publications[id]; }
    function getArticle(uint256 id) external view returns (Article memory) { return articles[id]; }
    function getSubscription(address subscriber, uint256 pubId) external view returns (Subscription memory) { return subscriptions[subscriber][pubId]; }
    function hasAccess(uint256 articleId, address reader) external view returns (bool) {
        if (articleAccess[articleId][reader]) return true;
        Article storage a = articles[articleId];
        return subscriptions[reader][a.pubId].expiresAt > block.timestamp;
    }

    receive() external payable {}
}
