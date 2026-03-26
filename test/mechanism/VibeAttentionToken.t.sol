// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeAttentionToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VibeAttentionTokenTest
 * @notice Unit tests for VibeAttentionToken (BAT + x402 attention economy)
 *
 * Coverage:
 *   - Campaign creation: budget, price, engagement guards
 *   - Attention proof submission: verifier-only, reward splits (70/15/10/5)
 *   - Content listing and pay-per-view (x402)
 *   - Bot flagging: owner and verifier
 *   - Verifier management: add/remove onlyOwner
 *   - Campaign end: returns unspent budget to advertiser
 *   - Protocol revenue withdrawal: onlyOwner
 *   - Content rating: quality score EMA update
 *   - Access control: all owner-gated operations
 *   - UUPS upgrade: only owner
 */
contract VibeAttentionTokenTest is Test {
    VibeAttentionToken public vat;
    VibeAttentionToken public impl;

    address public owner;
    address public advertiser;
    address public verifier;
    address public user;
    address public creator;

    // ============ Events ============

    event CampaignCreated(uint256 indexed campaignId, address indexed advertiser, VibeAttentionToken.CampaignType cType, uint256 budget);
    event AttentionVerified(uint256 indexed proofId, uint256 indexed campaignId, address indexed user_, uint256 reward);
    event ContentListed(uint256 indexed listingId, address indexed creator_, VibeAttentionToken.ContentType cType, uint256 pricePerView);
    event ContentViewed(uint256 indexed listingId, address indexed viewer, uint256 payment);
    event UserFlaggedAsBot(address indexed user_);
    event VerifierAdded(address indexed v);

    uint256 constant MIN_BUDGET = 0.01 ether;
    uint256 constant PRICE_PER_ATTENTION = 0.001 ether;
    uint256 constant MIN_ENGAGEMENT = 3;

    function setUp() public {
        owner = makeAddr("owner");
        advertiser = makeAddr("advertiser");
        verifier = makeAddr("verifier");
        user = makeAddr("user");
        creator = makeAddr("creator");

        vm.deal(advertiser, 100 ether);
        vm.deal(user, 10 ether);

        impl = new VibeAttentionToken();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeAttentionToken.initialize, ())
        );
        vat = VibeAttentionToken(payable(address(proxy)));

        // Add verifier
        address proxyOwner = vat.owner();
        vm.prank(proxyOwner);
        vat.addVerifier(verifier);
    }

    // ============ Initialization ============

    function test_initialize_state() public view {
        assertEq(vat.campaignCount(), 0);
        assertEq(vat.proofCount(), 0);
        assertEq(vat.listingCount(), 0);
        assertEq(vat.totalAttentionRewardsPaid(), 0);
        assertEq(vat.protocolRevenue(), 0);
    }

    function test_initialize_constants() public view {
        assertEq(vat.USER_SHARE(), 7000);
        assertEq(vat.CREATOR_SHARE(), 1500);
        assertEq(vat.PROTOCOL_SHARE(), 1000);
        assertEq(vat.VERIFIER_SHARE(), 500);
        assertEq(vat.MIN_ENGAGEMENT(), 3);
        assertEq(vat.MIN_CAMPAIGN_BUDGET(), 0.01 ether);
    }

    // ============ Campaign Creation ============

    function _createCampaign() internal returns (uint256 campaignId) {
        vm.prank(advertiser);
        return vat.createCampaign{value: MIN_BUDGET}(
            VibeAttentionToken.CampaignType.DISPLAY,
            bytes32("contentHash"),
            PRICE_PER_ATTENTION,
            7, // 7 days
            MIN_ENGAGEMENT
        );
    }

    function test_createCampaign_basic() public {
        uint256 id = _createCampaign();
        assertEq(id, 1);
        assertEq(vat.campaignCount(), 1);

        VibeAttentionToken.Campaign memory c = vat.getCampaign(1);
        assertEq(c.advertiser, advertiser);
        assertEq(c.budget, MIN_BUDGET);
        assertEq(c.pricePerAttention, PRICE_PER_ATTENTION);
        assertTrue(c.active);
        assertEq(c.spent, 0);
    }

    function test_createCampaign_emitsEvent() public {
        vm.prank(advertiser);
        vm.expectEmit(true, true, false, true);
        emit CampaignCreated(1, advertiser, VibeAttentionToken.CampaignType.DISPLAY, MIN_BUDGET);
        vat.createCampaign{value: MIN_BUDGET}(
            VibeAttentionToken.CampaignType.DISPLAY,
            bytes32("hash"),
            PRICE_PER_ATTENTION,
            1,
            MIN_ENGAGEMENT
        );
    }

    function test_createCampaign_revert_budgetTooLow() public {
        vm.prank(advertiser);
        vm.expectRevert("Budget too low");
        vat.createCampaign{value: MIN_BUDGET - 1}(
            VibeAttentionToken.CampaignType.DISPLAY,
            bytes32("hash"),
            PRICE_PER_ATTENTION,
            1,
            MIN_ENGAGEMENT
        );
    }

    function test_createCampaign_revert_zeroPrice() public {
        vm.prank(advertiser);
        vm.expectRevert("Zero price");
        vat.createCampaign{value: MIN_BUDGET}(
            VibeAttentionToken.CampaignType.DISPLAY,
            bytes32("hash"),
            0,
            1,
            MIN_ENGAGEMENT
        );
    }

    function test_createCampaign_revert_engagementTooShort() public {
        vm.prank(advertiser);
        vm.expectRevert("Engagement too short");
        vat.createCampaign{value: MIN_BUDGET}(
            VibeAttentionToken.CampaignType.DISPLAY,
            bytes32("hash"),
            PRICE_PER_ATTENTION,
            1,
            MIN_ENGAGEMENT - 1
        );
    }

    // ============ Attention Proof Submission ============

    function test_submitProof_rewardSplit() public {
        _createCampaign();

        uint256 userBalBefore = user.balance;
        uint256 creatorBalBefore = creator.balance;
        uint256 verifierBalBefore = verifier.balance;

        vm.prank(verifier);
        vat.submitAttentionProof(
            1,
            user,
            bytes32("proof"),
            MIN_ENGAGEMENT,
            creator
        );

        // USER_SHARE = 70% of PRICE_PER_ATTENTION
        uint256 expectedUserReward = (PRICE_PER_ATTENTION * 7000) / 10000;
        uint256 expectedCreatorReward = (PRICE_PER_ATTENTION * 1500) / 10000;
        uint256 expectedVerifierReward = PRICE_PER_ATTENTION
            - expectedUserReward
            - expectedCreatorReward
            - (PRICE_PER_ATTENTION * 1000) / 10000;

        assertEq(user.balance - userBalBefore, expectedUserReward, "User reward split");
        assertEq(creator.balance - creatorBalBefore, expectedCreatorReward, "Creator reward split");
        assertEq(verifier.balance - verifierBalBefore, expectedVerifierReward, "Verifier reward split");
        assertGt(vat.protocolRevenue(), 0, "Protocol should take its share");
    }

    function test_submitProof_recordsProof() public {
        _createCampaign();

        vm.prank(verifier);
        vat.submitAttentionProof(1, user, bytes32("proof"), MIN_ENGAGEMENT, creator);

        assertEq(vat.proofCount(), 1);

        VibeAttentionToken.AttentionProof memory p = vat.getProof(1);
        assertEq(p.campaignId, 1);
        assertEq(p.user, user);
        assertTrue(p.verified);
        assertTrue(p.paid);
    }

    function test_submitProof_updatesUserStats() public {
        _createCampaign();

        vm.prank(verifier);
        vat.submitAttentionProof(1, user, bytes32("proof"), 10, creator);

        VibeAttentionToken.UserAttention memory ua = vat.getUserAttention(user);
        assertEq(ua.user, user);
        assertEq(ua.totalAttentionSeconds, 10);
        assertGt(ua.totalEarned, 0);
        assertEq(ua.verifiedEngagements, 1);
    }

    function test_submitProof_revert_notVerifier() public {
        _createCampaign();

        vm.prank(user);
        vm.expectRevert("Not a verifier");
        vat.submitAttentionProof(1, user, bytes32("proof"), MIN_ENGAGEMENT, creator);
    }

    function test_submitProof_revert_campaignInactive() public {
        _createCampaign();

        // End campaign
        vm.prank(advertiser);
        vat.endCampaign(1);

        vm.prank(verifier);
        vm.expectRevert("Campaign inactive");
        vat.submitAttentionProof(1, user, bytes32("proof"), MIN_ENGAGEMENT, creator);
    }

    function test_submitProof_revert_campaignEnded() public {
        _createCampaign();

        // Warp past campaign end (7 days duration)
        vm.warp(block.timestamp + 8 days);

        vm.prank(verifier);
        vm.expectRevert("Campaign ended");
        vat.submitAttentionProof(1, user, bytes32("proof"), MIN_ENGAGEMENT, creator);
    }

    function test_submitProof_revert_engagementTooShort() public {
        _createCampaign();

        vm.prank(verifier);
        vm.expectRevert("Engagement too short");
        vat.submitAttentionProof(1, user, bytes32("proof"), MIN_ENGAGEMENT - 1, creator);
    }

    function test_submitProof_revert_botFlagged() public {
        _createCampaign();

        address proxyOwner = vat.owner();
        vm.prank(proxyOwner);
        vat.flagBot(user);

        vm.prank(verifier);
        vm.expectRevert("User flagged as bot");
        vat.submitAttentionProof(1, user, bytes32("proof"), MIN_ENGAGEMENT, creator);
    }

    function test_submitProof_revert_budgetExhausted() public {
        // Campaign with exactly one reward worth of budget
        vm.prank(advertiser);
        vat.createCampaign{value: PRICE_PER_ATTENTION}(
            VibeAttentionToken.CampaignType.DISPLAY,
            bytes32("hash"),
            PRICE_PER_ATTENTION,
            1,
            MIN_ENGAGEMENT
        );

        address user2 = makeAddr("user2");

        vm.prank(verifier);
        vat.submitAttentionProof(1, user, bytes32("proof1"), MIN_ENGAGEMENT, creator);

        vm.prank(verifier);
        vm.expectRevert("Budget exhausted");
        vat.submitAttentionProof(1, user2, bytes32("proof2"), MIN_ENGAGEMENT, creator);
    }

    // ============ Content Listing (x402) ============

    function test_listContent_basic() public {
        vm.prank(creator);
        uint256 id = vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("contentHash"),
            0.001 ether
        );

        assertEq(id, 1);
        assertEq(vat.listingCount(), 1);

        VibeAttentionToken.ContentListing memory l = vat.getListing(1);
        assertEq(l.creator, creator);
        assertEq(l.pricePerView, 0.001 ether);
        assertEq(l.qualityScore, 5000);
        assertTrue(l.active);
    }

    function test_listContent_freeContent() public {
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("freeHash"),
            0 // Free
        );

        // Viewing free content should not require payment
        vm.prank(user);
        vat.viewContent{value: 0}(1);

        VibeAttentionToken.ContentListing memory l = vat.getListing(1);
        assertEq(l.totalViews, 1);
    }

    function test_viewContent_paysCreator() public {
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.VIDEO,
            bytes32("hash"),
            0.01 ether
        );

        uint256 creatorBalBefore = creator.balance;

        vm.prank(user);
        vat.viewContent{value: 0.01 ether}(1);

        // Creator gets 95%, protocol gets 5%
        uint256 expectedCreatorPayment = (0.01 ether * 9500) / 10000;
        assertEq(creator.balance - creatorBalBefore, expectedCreatorPayment);
        assertGt(vat.protocolRevenue(), 0, "Protocol takes 5% fee");
    }

    function test_viewContent_refundsOverpayment() public {
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("hash"),
            0.01 ether
        );

        uint256 userBalBefore = user.balance;

        vm.prank(user);
        vat.viewContent{value: 0.02 ether}(1); // Overpay by 0.01

        // User should get 0.01 ether back
        uint256 spent = userBalBefore - user.balance;
        assertEq(spent, 0.01 ether, "Should only spend the price, rest refunded");
    }

    function test_viewContent_revert_insufficientPayment() public {
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("hash"),
            0.01 ether
        );

        vm.prank(user);
        vm.expectRevert("Insufficient payment");
        vat.viewContent{value: 0.001 ether}(1);
    }

    function test_viewContent_tracksViews() public {
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("hash"),
            0
        );

        vm.prank(user);
        vat.viewContent{value: 0}(1);

        vm.prank(bob);
        vm.deal(bob, 1 ether);
        vat.viewContent{value: 0}(1);

        VibeAttentionToken.ContentListing memory l = vat.getListing(1);
        assertEq(l.totalViews, 2);
    }

    function test_viewContent_emitsEvent() public {
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("hash"),
            0
        );

        vm.prank(user);
        vm.expectEmit(true, true, false, true);
        emit ContentViewed(1, user, 0);
        vat.viewContent{value: 0}(1);
    }

    // ============ Content Quality Rating ============

    function test_rateContent_updatesQualityScore() public {
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("hash"),
            0
        );

        // Initial quality score = 5000
        // EMA: newScore = (oldScore * 9 + rating) / 10
        vm.prank(user);
        vat.rateContent(1, 10000); // Rate maximum

        VibeAttentionToken.ContentListing memory l = vat.getListing(1);
        uint256 expectedScore = (5000 * 9 + 10000) / 10; // 5500
        assertEq(l.qualityScore, expectedScore);
    }

    function test_rateContent_revert_invalidScore() public {
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("hash"),
            0
        );

        vm.prank(user);
        vm.expectRevert("Invalid score");
        vat.rateContent(1, 10001);
    }

    // ============ Bot Flagging ============

    function test_flagBot_byOwner() public {
        address proxyOwner = vat.owner();
        vm.prank(proxyOwner);
        vat.flagBot(user);

        VibeAttentionToken.UserAttention memory ua = vat.getUserAttention(user);
        assertTrue(ua.isBotFlagged);
    }

    function test_flagBot_byVerifier() public {
        vm.prank(verifier);
        vat.flagBot(user);

        VibeAttentionToken.UserAttention memory ua = vat.getUserAttention(user);
        assertTrue(ua.isBotFlagged);
    }

    function test_flagBot_revert_unauthorized() public {
        vm.prank(user);
        vm.expectRevert("Not authorized");
        vat.flagBot(creator);
    }

    function test_flagBot_emitsEvent() public {
        address proxyOwner = vat.owner();
        vm.prank(proxyOwner);
        vm.expectEmit(true, false, false, false);
        emit UserFlaggedAsBot(user);
        vat.flagBot(user);
    }

    // ============ Verifier Management ============

    function test_addVerifier_onlyOwner() public {
        address newVerifier = makeAddr("newVerifier");

        address proxyOwner = vat.owner();
        vm.prank(proxyOwner);
        vat.addVerifier(newVerifier);

        assertTrue(vat.verifiers(newVerifier));
    }

    function test_addVerifier_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        vat.addVerifier(makeAddr("x"));
    }

    function test_removeVerifier_onlyOwner() public {
        address proxyOwner = vat.owner();
        vm.prank(proxyOwner);
        vat.removeVerifier(verifier);

        assertFalse(vat.verifiers(verifier));
    }

    function test_removeVerifier_blocksSubmissions() public {
        _createCampaign();

        // Remove verifier
        address proxyOwner = vat.owner();
        vm.prank(proxyOwner);
        vat.removeVerifier(verifier);

        vm.prank(verifier);
        vm.expectRevert("Not a verifier");
        vat.submitAttentionProof(1, user, bytes32("proof"), MIN_ENGAGEMENT, creator);
    }

    // ============ Campaign End ============

    function test_endCampaign_refundsUnspentBudget() public {
        _createCampaign();

        uint256 advertiserBalBefore = advertiser.balance;

        vm.prank(advertiser);
        vat.endCampaign(1);

        VibeAttentionToken.Campaign memory c = vat.getCampaign(1);
        assertFalse(c.active);
        // All budget unspent, so full refund
        assertEq(advertiser.balance - advertiserBalBefore, MIN_BUDGET);
    }

    function test_endCampaign_noRefundIfFullySpent() public {
        // Create campaign with budget exactly one reward
        vm.prank(advertiser);
        vat.createCampaign{value: PRICE_PER_ATTENTION}(
            VibeAttentionToken.CampaignType.DISPLAY,
            bytes32("hash"),
            PRICE_PER_ATTENTION,
            1,
            MIN_ENGAGEMENT
        );

        vm.prank(verifier);
        vat.submitAttentionProof(1, user, bytes32("proof"), MIN_ENGAGEMENT, creator);

        uint256 advertiserBalBefore = advertiser.balance;
        vm.prank(advertiser);
        vat.endCampaign(1);

        // No refund since campaign was fully spent
        assertEq(advertiser.balance - advertiserBalBefore, 0);
    }

    function test_endCampaign_revert_notAdvertiser() public {
        _createCampaign();

        vm.prank(user);
        vm.expectRevert("Not advertiser");
        vat.endCampaign(1);
    }

    // ============ Protocol Revenue Withdrawal ============

    function test_withdrawProtocolRevenue_onlyOwner() public {
        // Accrue some revenue via content viewing
        vm.prank(creator);
        vat.listContent(
            VibeAttentionToken.ContentType.ARTICLE,
            bytes32("hash"),
            0.1 ether
        );

        vm.prank(user);
        vat.viewContent{value: 0.1 ether}(1);

        assertGt(vat.protocolRevenue(), 0);

        address proxyOwner = vat.owner();
        uint256 balBefore = proxyOwner.balance;
        vm.prank(proxyOwner);
        vat.withdrawProtocolRevenue();

        assertEq(vat.protocolRevenue(), 0);
        assertGt(proxyOwner.balance - balBefore, 0);
    }

    function test_withdrawProtocolRevenue_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        vat.withdrawProtocolRevenue();
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_onlyOwner() public {
        VibeAttentionToken newImpl = new VibeAttentionToken();

        vm.prank(user);
        vm.expectRevert();
        vat.upgradeToAndCall(address(newImpl), "");

        address proxyOwner = vat.owner();
        vm.prank(proxyOwner);
        vat.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Integration: Full Attention Economy Flow ============

    function test_integration_campaignLifecycle() public {
        // 1. Create campaign
        vm.prank(advertiser);
        uint256 campaignId = vat.createCampaign{value: 0.1 ether}(
            VibeAttentionToken.CampaignType.VIDEO,
            bytes32("adContent"),
            0.001 ether,
            30,
            5
        );

        // 2. Submit multiple attention proofs
        address[] memory users = new address[](3);
        users[0] = makeAddr("viewer1");
        users[1] = makeAddr("viewer2");
        users[2] = makeAddr("viewer3");

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(verifier);
            vat.submitAttentionProof(campaignId, users[i], bytes32(i), 10, creator);
        }

        assertEq(vat.proofCount(), 3);

        VibeAttentionToken.Campaign memory c = vat.getCampaign(campaignId);
        assertEq(c.verifiedEngagements, 3);
        assertEq(c.spent, 0.003 ether);

        // 3. List related content
        vm.prank(creator);
        uint256 listingId = vat.listContent(
            VibeAttentionToken.ContentType.VIDEO,
            bytes32("videoHash"),
            0.001 ether
        );

        // 4. Users pay to view
        vm.deal(users[0], 0.01 ether);
        vm.prank(users[0]);
        vat.viewContent{value: 0.001 ether}(listingId);

        assertEq(vat.getListing(listingId).totalViews, 1);

        // 5. End campaign and get refund
        uint256 balBefore = advertiser.balance;
        vm.prank(advertiser);
        vat.endCampaign(campaignId);

        // Refund = 0.1 ether - 0.003 ether spent = 0.097 ether
        assertEq(advertiser.balance - balBefore, 0.097 ether);
    }

    // ============ Fuzz ============

    function testFuzz_submitProof_engagementSeconds(uint256 engagement) public {
        _createCampaign();

        engagement = bound(engagement, MIN_ENGAGEMENT, 3600);

        vm.prank(verifier);
        vat.submitAttentionProof(1, user, bytes32("proof"), engagement, creator);

        VibeAttentionToken.UserAttention memory ua = vat.getUserAttention(user);
        assertEq(ua.totalAttentionSeconds, engagement);
    }
}
