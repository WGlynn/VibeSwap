// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAttentionToken — BAT + x402 Attention Economy Protocol
 * @notice Absorbs Basic Attention Token logic with x402 micropayments.
 *         Tokenizes human and AI attention. Advertisers pay for verified
 *         attention. Users earn for genuine engagement. Content creators
 *         get paid per view/interaction without platform middlemen.
 *
 * @dev Architecture (BAT + x402 + VSOS fusion):
 *      - Advertisers fund campaigns with ETH
 *      - Attention is measured on-chain via verified engagement proofs
 *      - Users earn attention rewards (70% user, 15% creator, 10% protocol, 5% verifiers)
 *      - x402 gates: content access = pay-per-view micropayment
 *      - AI agents can be attention verifiers (detect bots, verify engagement)
 *      - Attention scores feed into reputation and governance weight
 *      - Anti-fraud: minimum engagement time, attention proof hashing
 *      - Content quality scoring via community consensus
 *
 *      Key innovation over BAT: not browser-locked. Works across any
 *      VSOS surface (DApps, agents, feeds, wikis, forums). Attention
 *      is a universal resource, not a Brave browser feature.
 */
contract VibeAttentionToken is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum CampaignType { DISPLAY, VIDEO, INTERACTIVE, SPONSORED_CONTENT, AGENT_PROMOTED }
    enum ContentType { ARTICLE, VIDEO, AUDIO, FEED_POST, WIKI_PAGE, FORUM_THREAD, AGENT_OUTPUT }

    struct Campaign {
        uint256 campaignId;
        address advertiser;
        CampaignType campaignType;
        bytes32 contentHash;         // IPFS hash of ad content
        uint256 budget;              // Total ETH budget
        uint256 spent;
        uint256 pricePerAttention;   // Wei per verified attention unit
        uint256 impressions;
        uint256 verifiedEngagements;
        uint256 startTime;
        uint256 endTime;
        uint256 minEngagementSeconds; // Minimum attention time to qualify
        bool active;
    }

    struct AttentionProof {
        uint256 proofId;
        uint256 campaignId;
        address user;
        bytes32 proofHash;           // hash(user, content, timestamp, duration)
        uint256 engagementSeconds;
        uint256 rewardAmount;
        uint256 timestamp;
        bool verified;
        bool paid;
    }

    struct ContentListing {
        uint256 listingId;
        address creator;
        ContentType contentType;
        bytes32 contentHash;
        uint256 pricePerView;        // x402 pay-per-view price (0 = free)
        uint256 totalViews;
        uint256 totalEarned;
        uint256 qualityScore;        // Community-rated 0-10000
        bool active;
    }

    struct UserAttention {
        address user;
        uint256 totalAttentionSeconds;
        uint256 totalEarned;
        uint256 attentionScore;      // 0-10000 (based on quality of attention)
        uint256 verifiedEngagements;
        bool isBotFlagged;
    }

    // ============ Constants ============

    // Revenue split (basis points)
    uint256 public constant USER_SHARE = 7000;       // 70%
    uint256 public constant CREATOR_SHARE = 1500;    // 15%
    uint256 public constant PROTOCOL_SHARE = 1000;   // 10%
    uint256 public constant VERIFIER_SHARE = 500;    // 5%

    uint256 public constant MIN_ENGAGEMENT = 3;      // 3 seconds minimum
    uint256 public constant MIN_CAMPAIGN_BUDGET = 0.01 ether;

    // ============ State ============

    mapping(uint256 => Campaign) public campaigns;
    uint256 public campaignCount;

    mapping(uint256 => AttentionProof) public proofs;
    uint256 public proofCount;

    mapping(uint256 => ContentListing) public listings;
    uint256 public listingCount;

    mapping(address => UserAttention) public userAttention;

    /// @notice Verified attention verifiers (AI agents or human moderators)
    mapping(address => bool) public verifiers;

    /// @notice Campaign proofs: campaignId => proofId[]
    mapping(uint256 => uint256[]) public campaignProofs;

    /// @notice Stats
    uint256 public totalAttentionRewardsPaid;
    uint256 public totalContentViewsPaid;
    uint256 public protocolRevenue;
    uint256 public totalAttentionSeconds;

    // ============ Events ============

    event CampaignCreated(uint256 indexed campaignId, address indexed advertiser, CampaignType cType, uint256 budget);
    event AttentionVerified(uint256 indexed proofId, uint256 indexed campaignId, address indexed user, uint256 reward);
    event ContentListed(uint256 indexed listingId, address indexed creator, ContentType cType, uint256 pricePerView);
    event ContentViewed(uint256 indexed listingId, address indexed viewer, uint256 payment);
    event UserFlaggedAsBot(address indexed user);
    event VerifierAdded(address indexed verifier);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Campaign Management ============

    function createCampaign(
        CampaignType campaignType,
        bytes32 contentHash,
        uint256 pricePerAttention,
        uint256 durationDays,
        uint256 minEngagementSeconds
    ) external payable returns (uint256) {
        require(msg.value >= MIN_CAMPAIGN_BUDGET, "Budget too low");
        require(pricePerAttention > 0, "Zero price");
        require(minEngagementSeconds >= MIN_ENGAGEMENT, "Engagement too short");

        campaignCount++;
        campaigns[campaignCount] = Campaign({
            campaignId: campaignCount,
            advertiser: msg.sender,
            campaignType: campaignType,
            contentHash: contentHash,
            budget: msg.value,
            spent: 0,
            pricePerAttention: pricePerAttention,
            impressions: 0,
            verifiedEngagements: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + (durationDays * 1 days),
            minEngagementSeconds: minEngagementSeconds,
            active: true
        });

        emit CampaignCreated(campaignCount, msg.sender, campaignType, msg.value);
        return campaignCount;
    }

    // ============ Attention Verification ============

    /**
     * @notice Submit and verify an attention proof
     * @dev Only registered verifiers can submit proofs (anti-fraud)
     */
    function submitAttentionProof(
        uint256 campaignId,
        address user,
        bytes32 proofHash,
        uint256 engagementSeconds,
        address contentCreator
    ) external nonReentrant {
        require(verifiers[msg.sender], "Not a verifier");

        Campaign storage campaign = campaigns[campaignId];
        require(campaign.active, "Campaign inactive");
        require(block.timestamp <= campaign.endTime, "Campaign ended");
        require(engagementSeconds >= campaign.minEngagementSeconds, "Engagement too short");
        require(!userAttention[user].isBotFlagged, "User flagged as bot");

        uint256 reward = campaign.pricePerAttention;
        require(campaign.spent + reward <= campaign.budget, "Budget exhausted");

        campaign.spent += reward;
        campaign.impressions++;
        campaign.verifiedEngagements++;

        proofCount++;
        proofs[proofCount] = AttentionProof({
            proofId: proofCount,
            campaignId: campaignId,
            user: user,
            proofHash: proofHash,
            engagementSeconds: engagementSeconds,
            rewardAmount: reward,
            timestamp: block.timestamp,
            verified: true,
            paid: true
        });

        campaignProofs[campaignId].push(proofCount);

        // Distribute rewards
        uint256 userReward = (reward * USER_SHARE) / 10000;
        uint256 creatorReward = (reward * CREATOR_SHARE) / 10000;
        uint256 protocolReward = (reward * PROTOCOL_SHARE) / 10000;
        uint256 verifierReward = reward - userReward - creatorReward - protocolReward;

        // Update user attention stats
        UserAttention storage ua = userAttention[user];
        ua.user = user;
        ua.totalAttentionSeconds += engagementSeconds;
        ua.totalEarned += userReward;
        ua.verifiedEngagements++;

        totalAttentionRewardsPaid += reward;
        totalAttentionSeconds += engagementSeconds;
        protocolRevenue += protocolReward;

        // Pay out
        (bool ok1, ) = user.call{value: userReward}("");
        require(ok1, "User payment failed");

        if (contentCreator != address(0) && creatorReward > 0) {
            (bool ok2, ) = contentCreator.call{value: creatorReward}("");
            if (!ok2) protocolRevenue += creatorReward; // Fallback to protocol
        }

        (bool ok3, ) = msg.sender.call{value: verifierReward}("");
        if (!ok3) protocolRevenue += verifierReward;

        emit AttentionVerified(proofCount, campaignId, user, userReward);
    }

    // ============ Content Pay-Per-View (x402) ============

    function listContent(
        ContentType contentType,
        bytes32 contentHash,
        uint256 pricePerView
    ) external returns (uint256) {
        listingCount++;
        listings[listingCount] = ContentListing({
            listingId: listingCount,
            creator: msg.sender,
            contentType: contentType,
            contentHash: contentHash,
            pricePerView: pricePerView,
            totalViews: 0,
            totalEarned: 0,
            qualityScore: 5000,
            active: true
        });

        emit ContentListed(listingCount, msg.sender, contentType, pricePerView);
        return listingCount;
    }

    function viewContent(uint256 listingId) external payable nonReentrant {
        ContentListing storage listing = listings[listingId];
        require(listing.active, "Not active");

        if (listing.pricePerView > 0) {
            require(msg.value >= listing.pricePerView, "Insufficient payment");

            uint256 creatorPayment = (listing.pricePerView * 9500) / 10000; // 95%
            uint256 protocolFee = listing.pricePerView - creatorPayment;

            listing.totalEarned += creatorPayment;
            protocolRevenue += protocolFee;
            totalContentViewsPaid += listing.pricePerView;

            (bool ok, ) = listing.creator.call{value: creatorPayment}("");
            require(ok, "Creator payment failed");

            // Refund excess
            if (msg.value > listing.pricePerView) {
                (bool ok2, ) = msg.sender.call{value: msg.value - listing.pricePerView}("");
                require(ok2, "Refund failed");
            }
        }

        listing.totalViews++;
        emit ContentViewed(listingId, msg.sender, listing.pricePerView);
    }

    // ============ Quality & Anti-Fraud ============

    function rateContent(uint256 listingId, uint256 score) external {
        require(score <= 10000, "Invalid score");
        ContentListing storage listing = listings[listingId];
        // EMA smoothing
        listing.qualityScore = (listing.qualityScore * 9 + score) / 10;
    }

    function flagBot(address user) external {
        require(verifiers[msg.sender] || msg.sender == owner(), "Not authorized");
        userAttention[user].isBotFlagged = true;
        emit UserFlaggedAsBot(user);
    }

    // ============ Admin ============

    function addVerifier(address v) external onlyOwner {
        verifiers[v] = true;
        emit VerifierAdded(v);
    }

    function removeVerifier(address v) external onlyOwner {
        verifiers[v] = false;
    }

    function withdrawProtocolRevenue() external onlyOwner nonReentrant {
        uint256 amount = protocolRevenue;
        protocolRevenue = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    function endCampaign(uint256 campaignId) external nonReentrant {
        Campaign storage campaign = campaigns[campaignId];
        require(campaign.advertiser == msg.sender, "Not advertiser");
        campaign.active = false;

        // Return unspent budget
        uint256 remaining = campaign.budget - campaign.spent;
        if (remaining > 0) {
            campaign.budget = campaign.spent;
            (bool ok, ) = msg.sender.call{value: remaining}("");
            require(ok, "Refund failed");
        }
    }

    // ============ View ============

    function getCampaign(uint256 id) external view returns (Campaign memory) { return campaigns[id]; }
    function getProof(uint256 id) external view returns (AttentionProof memory) { return proofs[id]; }
    function getListing(uint256 id) external view returns (ContentListing memory) { return listings[id]; }
    function getUserAttention(address user) external view returns (UserAttention memory) { return userAttention[user]; }
    function getCampaignCount() external view returns (uint256) { return campaignCount; }
    function getListingCount() external view returns (uint256) { return listingCount; }

    receive() external payable {}
}
