// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeContentMarket.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VibeContentMarketTest
 * @notice Unit tests for VibeContentMarket (Mirror/Paragraph-style content monetization)
 *
 * Coverage:
 *   - Publication creation: id increment, state, event
 *   - Article publishing: creator guard, state, event
 *   - Collaborative article: share validation (must sum to 10000), collaborator mapping
 *   - purchaseArticle: per-article purchase, 95/5 revenue split, double-purchase guard
 *   - purchaseArticle (subscriber): free access via active subscription
 *   - subscribe: 30-day expiry, revenue split, subscriber count, extension
 *   - tip: distributes to author, 5% fee
 *   - Revenue distribution to collaborators: proportional shares
 *   - Excess payment refund
 *   - Protocol revenue withdrawal: onlyOwner
 *   - hasAccess: purchased OR active subscription
 *   - UUPS upgrade: only owner
 */
contract VibeContentMarketTest is Test {
    VibeContentMarket public market;
    VibeContentMarket public impl;

    address public owner;
    address public alice; // creator
    address public bob;   // reader/subscriber
    address public carol; // collaborator

    // ============ Events ============

    event PublicationCreated(uint256 indexed pubId, address indexed creator, bytes32 nameHash);
    event ArticlePublished(uint256 indexed articleId, uint256 indexed pubId, bytes32 contentHash, uint256 price);
    event ArticlePurchased(uint256 indexed articleId, address indexed reader, uint256 amount);
    event Subscribed(address indexed subscriber, uint256 indexed pubId, uint256 expiresAt);
    event Tipped(uint256 indexed articleId, address indexed tipper, uint256 amount);

    bytes32 constant NAME_HASH    = keccak256("VibeWrite");
    bytes32 constant META_HASH    = keccak256("pubMetadata");
    bytes32 constant CONTENT_HASH = keccak256("article content");

    uint256 constant ARTICLE_PRICE = 0.01 ether;
    uint256 constant SUB_PRICE     = 0.05 ether;

    // Allow test contract (= owner) to receive ETH from withdrawProtocolRevenue
    receive() external payable {}

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob   = makeAddr("bob");
        carol = makeAddr("carol");

        vm.deal(alice, 10 ether);
        vm.deal(bob,   10 ether);
        vm.deal(carol, 10 ether);

        impl = new VibeContentMarket();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeContentMarket.initialize, ())
        );
        market = VibeContentMarket(payable(address(proxy)));
    }

    // ============ Helpers ============

    function _createPub(uint256 subPrice) internal returns (uint256) {
        vm.prank(alice);
        return market.createPublication(NAME_HASH, META_HASH, subPrice);
    }

    function _publishArticle(uint256 pubId, uint256 price) internal returns (uint256) {
        vm.prank(alice);
        return market.publishArticle(pubId, CONTENT_HASH, price);
    }

    // ============ Initialization ============

    function test_initialize_state() public view {
        assertEq(market.pubCount(), 0);
        assertEq(market.articleCount(), 0);
        assertEq(market.protocolRevenue(), 0);
        assertEq(market.totalContentRevenue(), 0);
        assertEq(market.PROTOCOL_FEE(), 500); // 5%
    }

    // ============ Publication Creation ============

    function test_createPublication_basic() public {
        uint256 id = _createPub(SUB_PRICE);
        assertEq(id, 1);
        assertEq(market.pubCount(), 1);

        VibeContentMarket.Publication memory pub = market.getPublication(1);
        assertEq(pub.pubId, 1);
        assertEq(pub.creator, alice);
        assertEq(pub.nameHash, NAME_HASH);
        assertEq(pub.metadataHash, META_HASH);
        assertEq(pub.subscriptionPrice, SUB_PRICE);
        assertEq(pub.articleCount, 0);
        assertEq(pub.subscriberCount, 0);
        assertEq(pub.totalRevenue, 0);
        assertTrue(pub.active);
    }

    function test_createPublication_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit PublicationCreated(1, alice, NAME_HASH);
        market.createPublication(NAME_HASH, META_HASH, SUB_PRICE);
    }

    function test_createPublication_multiple() public {
        _createPub(SUB_PRICE);

        vm.prank(bob);
        market.createPublication(keccak256("BobWrite"), META_HASH, 0);

        assertEq(market.pubCount(), 2);
    }

    // ============ Article Publishing ============

    function test_publishArticle_basic() public {
        uint256 pubId = _createPub(SUB_PRICE);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        assertEq(articleId, 1);
        assertEq(market.articleCount(), 1);

        VibeContentMarket.Article memory a = market.getArticle(1);
        assertEq(a.articleId, 1);
        assertEq(a.pubId, pubId);
        assertEq(a.author, alice);
        assertEq(a.contentHash, CONTENT_HASH);
        assertEq(a.price, ARTICLE_PRICE);
        assertEq(a.purchases, 0);
        assertEq(a.tips, 0);
        assertEq(a.totalRevenue, 0);
        assertTrue(a.active);
        assertGt(a.publishedAt, 0);
    }

    function test_publishArticle_incrementsPubArticleCount() public {
        uint256 pubId = _createPub(SUB_PRICE);
        _publishArticle(pubId, ARTICLE_PRICE);

        assertEq(market.getPublication(pubId).articleCount, 1);
    }

    function test_publishArticle_emitsEvent() public {
        uint256 pubId = _createPub(SUB_PRICE);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ArticlePublished(1, pubId, CONTENT_HASH, ARTICLE_PRICE);
        market.publishArticle(pubId, CONTENT_HASH, ARTICLE_PRICE);
    }

    function test_publishArticle_revert_notCreator() public {
        uint256 pubId = _createPub(SUB_PRICE);

        vm.prank(bob);
        vm.expectRevert("Not creator");
        market.publishArticle(pubId, CONTENT_HASH, ARTICLE_PRICE);
    }

    function test_publishArticle_revert_notActivePub() public {
        // pub 999 doesn't exist
        vm.prank(alice);
        vm.expectRevert("Not creator");
        market.publishArticle(999, CONTENT_HASH, ARTICLE_PRICE);
    }

    // ============ Collaborative Article ============

    function test_publishCollaborativeArticle_basic() public {
        uint256 pubId = _createPub(0);

        address[] memory collabs = new address[](2);
        collabs[0] = alice;
        collabs[1] = carol;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000; // 60%
        shares[1] = 4000; // 40%

        vm.prank(alice);
        uint256 id = market.publishCollaborativeArticle(
            pubId, CONTENT_HASH, ARTICLE_PRICE, collabs, shares
        );

        assertEq(id, 1);
        assertEq(market.collaboratorShares(1, alice), 6000);
        assertEq(market.collaboratorShares(1, carol), 4000);
    }

    function test_publishCollaborativeArticle_revert_sharesMismatch() public {
        uint256 pubId = _createPub(0);

        address[] memory collabs = new address[](2);
        collabs[0] = alice;
        collabs[1] = carol;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 5000;
        shares[1] = 4000; // total = 9000, not 10000

        vm.prank(alice);
        vm.expectRevert("Shares must sum to 10000");
        market.publishCollaborativeArticle(pubId, CONTENT_HASH, ARTICLE_PRICE, collabs, shares);
    }

    function test_publishCollaborativeArticle_revert_lengthMismatch() public {
        uint256 pubId = _createPub(0);

        address[] memory collabs = new address[](2);
        collabs[0] = alice;
        collabs[1] = carol;

        uint256[] memory shares = new uint256[](1);
        shares[0] = 10000;

        vm.prank(alice);
        vm.expectRevert("Length mismatch");
        market.publishCollaborativeArticle(pubId, CONTENT_HASH, ARTICLE_PRICE, collabs, shares);
    }

    // ============ Purchase Article ============

    function test_purchaseArticle_basicRevenueSplit() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        uint256 aliceBalBefore = alice.balance;

        vm.prank(bob);
        market.purchaseArticle{value: ARTICLE_PRICE}(articleId);

        assertTrue(market.articleAccess(articleId, bob));
        assertEq(market.getArticle(articleId).purchases, 1);

        // 95% to creator
        uint256 expectedCreatorPayment = (ARTICLE_PRICE * 9500) / 10000;
        assertEq(alice.balance - aliceBalBefore, expectedCreatorPayment);

        // 5% to protocol
        uint256 expectedFee = (ARTICLE_PRICE * 500) / 10000;
        assertEq(market.protocolRevenue(), expectedFee);

        assertEq(market.totalContentRevenue(), ARTICLE_PRICE);
    }

    function test_purchaseArticle_emitsEvent() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit ArticlePurchased(articleId, bob, ARTICLE_PRICE);
        market.purchaseArticle{value: ARTICLE_PRICE}(articleId);
    }

    function test_purchaseArticle_refundsExcess() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        uint256 bobBalBefore = bob.balance;

        vm.prank(bob);
        market.purchaseArticle{value: ARTICLE_PRICE + 0.1 ether}(articleId);

        uint256 spent = bobBalBefore - bob.balance;
        assertEq(spent, ARTICLE_PRICE, "Bob should only spend article price");
    }

    function test_purchaseArticle_subscriberGetsFreePurchase() public {
        uint256 pubId = _createPub(SUB_PRICE);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        // Bob subscribes
        vm.prank(bob);
        market.subscribe{value: SUB_PRICE}(pubId);

        // Bob can purchase (free — subscriber access)
        vm.prank(bob);
        market.purchaseArticle{value: 0}(articleId);

        assertTrue(market.articleAccess(articleId, bob));
    }

    function test_purchaseArticle_revert_alreadyPurchased() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        vm.prank(bob);
        market.purchaseArticle{value: ARTICLE_PRICE}(articleId);

        vm.prank(bob);
        vm.expectRevert("Already purchased");
        market.purchaseArticle{value: ARTICLE_PRICE}(articleId);
    }

    function test_purchaseArticle_revert_freeArticleNoPaymentPath() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, 0); // free

        vm.prank(bob);
        vm.expectRevert("Free article");
        market.purchaseArticle{value: 0}(articleId);
    }

    function test_purchaseArticle_revert_insufficientPayment() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        vm.prank(bob);
        vm.expectRevert("Insufficient payment");
        market.purchaseArticle{value: ARTICLE_PRICE - 1}(articleId);
    }

    // ============ Subscription ============

    function test_subscribe_basic() public {
        uint256 pubId = _createPub(SUB_PRICE);

        uint256 aliceBalBefore = alice.balance;

        vm.prank(bob);
        market.subscribe{value: SUB_PRICE}(pubId);

        assertEq(market.getPublication(pubId).subscriberCount, 1);

        VibeContentMarket.Subscription memory sub = market.getSubscription(bob, pubId);
        assertEq(sub.subscriber, bob);
        assertEq(sub.pubId, pubId);
        assertGt(sub.expiresAt, block.timestamp);
        assertEq(sub.totalPaid, SUB_PRICE);

        // Creator gets 95%
        uint256 expectedCreatorPayment = (SUB_PRICE * 9500) / 10000;
        assertEq(alice.balance - aliceBalBefore, expectedCreatorPayment);

        // Protocol gets 5%
        uint256 expectedFee = (SUB_PRICE * 500) / 10000;
        assertEq(market.protocolRevenue(), expectedFee);
    }

    function test_subscribe_emitsEvent() public {
        uint256 pubId = _createPub(SUB_PRICE);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit Subscribed(bob, pubId, 0); // expiresAt checked separately
        market.subscribe{value: SUB_PRICE}(pubId);
    }

    function test_subscribe_thirtyDayExpiry() public {
        uint256 pubId = _createPub(SUB_PRICE);

        uint256 before = block.timestamp;
        vm.prank(bob);
        market.subscribe{value: SUB_PRICE}(pubId);

        VibeContentMarket.Subscription memory sub = market.getSubscription(bob, pubId);
        assertApproxEqAbs(sub.expiresAt, before + 30 days, 2);
    }

    function test_subscribe_extendsExistingSubscription() public {
        uint256 pubId = _createPub(SUB_PRICE);

        vm.prank(bob);
        market.subscribe{value: SUB_PRICE}(pubId);

        VibeContentMarket.Subscription memory sub1 = market.getSubscription(bob, pubId);
        uint256 firstExpiry = sub1.expiresAt;

        // Extend before expiry
        vm.prank(bob);
        market.subscribe{value: SUB_PRICE}(pubId);

        VibeContentMarket.Subscription memory sub2 = market.getSubscription(bob, pubId);
        // New expiry = firstExpiry + 30 days
        assertApproxEqAbs(sub2.expiresAt, firstExpiry + 30 days, 2);
    }

    function test_subscribe_revert_noSubscriptionPrice() public {
        uint256 pubId = _createPub(0); // no subscription

        vm.prank(bob);
        vm.expectRevert("No subscription");
        market.subscribe{value: 0}(pubId);
    }

    function test_subscribe_revert_insufficientPayment() public {
        uint256 pubId = _createPub(SUB_PRICE);

        vm.prank(bob);
        vm.expectRevert("Insufficient payment");
        market.subscribe{value: SUB_PRICE - 1}(pubId);
    }

    // ============ Tips ============

    function test_tip_basic() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        uint256 aliceBalBefore = alice.balance;
        uint256 tipAmount = 0.1 ether;

        vm.prank(bob);
        market.tip{value: tipAmount}(articleId);

        // 95% to creator
        uint256 expectedCreatorTip = (tipAmount * 9500) / 10000;
        assertEq(alice.balance - aliceBalBefore, expectedCreatorTip);

        assertEq(market.getArticle(articleId).tips, tipAmount);
        assertEq(market.totalContentRevenue(), tipAmount);
    }

    function test_tip_emitsEvent() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit Tipped(articleId, bob, 0.05 ether);
        market.tip{value: 0.05 ether}(articleId);
    }

    function test_tip_revert_zeroTip() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        vm.prank(bob);
        vm.expectRevert("Zero tip");
        market.tip{value: 0}(articleId);
    }

    // ============ Collaborative Revenue Distribution ============

    function test_collaborativeArticle_revenueDistribution() public {
        uint256 pubId = _createPub(0);

        address[] memory collabs = new address[](2);
        collabs[0] = alice;
        collabs[1] = carol;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000; // 60%
        shares[1] = 4000; // 40%

        vm.prank(alice);
        uint256 articleId = market.publishCollaborativeArticle(
            pubId, CONTENT_HASH, ARTICLE_PRICE, collabs, shares
        );

        uint256 aliceBalBefore = alice.balance;
        uint256 carolBalBefore = carol.balance;

        vm.prank(bob);
        market.purchaseArticle{value: ARTICLE_PRICE}(articleId);

        uint256 creatorAmount = (ARTICLE_PRICE * 9500) / 10000;
        uint256 aliceExpected = (creatorAmount * 6000) / 10000;
        uint256 carolExpected = (creatorAmount * 4000) / 10000;

        assertEq(alice.balance - aliceBalBefore, aliceExpected, "Alice 60% share");
        assertEq(carol.balance - carolBalBefore, carolExpected, "Carol 40% share");
    }

    // ============ hasAccess ============

    function test_hasAccess_purchasedArticle() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        assertFalse(market.hasAccess(articleId, bob));

        vm.prank(bob);
        market.purchaseArticle{value: ARTICLE_PRICE}(articleId);

        assertTrue(market.hasAccess(articleId, bob));
    }

    function test_hasAccess_activeSubscription() public {
        uint256 pubId = _createPub(SUB_PRICE);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        assertFalse(market.hasAccess(articleId, bob));

        vm.prank(bob);
        market.subscribe{value: SUB_PRICE}(pubId);

        assertTrue(market.hasAccess(articleId, bob));
    }

    function test_hasAccess_expiredSubscription() public {
        uint256 pubId = _createPub(SUB_PRICE);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        vm.prank(bob);
        market.subscribe{value: SUB_PRICE}(pubId);

        // Warp past subscription expiry
        vm.warp(block.timestamp + 31 days);

        assertFalse(market.hasAccess(articleId, bob));
    }

    // ============ Protocol Revenue Withdrawal ============

    function test_withdrawProtocolRevenue_onlyOwner() public {
        uint256 pubId = _createPub(0);
        uint256 articleId = _publishArticle(pubId, ARTICLE_PRICE);

        vm.prank(bob);
        market.purchaseArticle{value: ARTICLE_PRICE}(articleId);

        uint256 revenue = market.protocolRevenue();
        assertGt(revenue, 0);

        address proxyOwner = market.owner();
        uint256 ownerBalBefore = proxyOwner.balance;

        vm.prank(proxyOwner);
        market.withdrawProtocolRevenue();

        assertEq(market.protocolRevenue(), 0);
        assertEq(proxyOwner.balance - ownerBalBefore, revenue);
    }

    function test_withdrawProtocolRevenue_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        market.withdrawProtocolRevenue();
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_onlyOwner() public {
        VibeContentMarket newImpl = new VibeContentMarket();

        vm.prank(alice);
        vm.expectRevert();
        market.upgradeToAndCall(address(newImpl), "");

        address proxyOwner = market.owner();
        vm.prank(proxyOwner);
        market.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Integration: Creator Economy Flow ============

    function test_integration_creatorEconomyFlow() public {
        // 1. Alice creates a publication with subscription
        uint256 pubId = _createPub(SUB_PRICE);

        // 2. Alice publishes two articles
        vm.prank(alice);
        uint256 article1 = market.publishArticle(pubId, CONTENT_HASH, ARTICLE_PRICE);

        vm.prank(alice);
        uint256 article2 = market.publishArticle(pubId, keccak256("article2"), 0.02 ether);

        assertEq(market.getPublication(pubId).articleCount, 2);

        // 3. Bob subscribes (gets access to all current/future articles)
        vm.prank(bob);
        market.subscribe{value: SUB_PRICE}(pubId);

        assertTrue(market.hasAccess(article1, bob));
        assertTrue(market.hasAccess(article2, bob));

        // 4. Carol buys a specific article without subscribing
        vm.prank(carol);
        market.purchaseArticle{value: ARTICLE_PRICE}(article1);
        assertFalse(market.hasAccess(article2, carol)); // only bought article1

        // 5. Carol tips the article
        vm.prank(carol);
        market.tip{value: 0.005 ether}(article1);

        // 6. Verify protocol revenue accrued
        assertGt(market.protocolRevenue(), 0);
        assertGt(market.totalContentRevenue(), 0);

        // 7. Withdraw protocol revenue
        address proxyOwner = market.owner();
        vm.prank(proxyOwner);
        market.withdrawProtocolRevenue();
        assertEq(market.protocolRevenue(), 0);
    }

    // ============ Fuzz ============

    function testFuzz_purchaseArticle_revenueSplitConsistency(uint256 price) public {
        price = bound(price, 1, 100 ether);
        vm.deal(bob, price + 1 ether);

        uint256 pubId = _createPub(0);

        vm.prank(alice);
        uint256 articleId = market.publishArticle(pubId, CONTENT_HASH, price);

        uint256 aliceBalBefore = alice.balance;

        vm.prank(bob);
        market.purchaseArticle{value: price}(articleId);

        uint256 fee = (price * 500) / 10000;
        uint256 creatorAmount = price - fee;

        assertEq(alice.balance - aliceBalBefore, creatorAmount, "Creator 95%");
        assertEq(market.protocolRevenue(), fee, "Protocol 5%");
        assertEq(market.totalContentRevenue(), price, "Total revenue");
    }
}
