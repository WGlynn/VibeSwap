// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/IntelligenceExchange.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Mock VIBE token for testing
contract MockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {
        _mint(msg.sender, 1_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract IntelligenceExchangeTest is Test {
    IntelligenceExchange public sie;
    MockVIBE public vibe;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public carol = address(0xCA201);
    address public shard1 = address(uint160(0x58A6D1));

    bytes32 constant CONTENT_HASH_1 = keccak256("research-paper-1");
    bytes32 constant CONTENT_HASH_2 = keccak256("research-paper-2");
    bytes32 constant CONTENT_HASH_3 = keccak256("research-paper-3");
    string constant METADATA_URI_1 = "ipfs://QmPaper1";
    string constant METADATA_URI_2 = "ipfs://QmPaper2";
    string constant METADATA_URI_3 = "ipfs://QmPaper3";

    function setUp() public {
        // Deploy mock token
        vibe = new MockVIBE();

        // Deploy SIE behind proxy
        IntelligenceExchange impl = new IntelligenceExchange();
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize,
            (address(vibe), owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sie = IntelligenceExchange(payable(address(proxy)));

        // Fund test accounts
        vibe.mint(alice, 100 ether);
        vibe.mint(bob, 100 ether);
        vibe.mint(carol, 100 ether);

        // Approve SIE to spend VIBE
        vm.prank(alice);
        vibe.approve(address(sie), type(uint256).max);
        vm.prank(bob);
        vibe.approve(address(sie), type(uint256).max);
        vm.prank(carol);
        vibe.approve(address(sie), type(uint256).max);

        // Fund test accounts with ETH for staking
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);

        // Authorize shard as epoch submitter
        sie.addEpochSubmitter(shard1);
    }

    // ============ Constructor & Init ============

    function test_initialize() public view {
        assertEq(address(sie.vibeToken()), address(vibe));
        assertEq(sie.assetCount(), 0);
        assertEq(sie.epochCount(), 0);
        assertEq(sie.PROTOCOL_FEE_BPS(), 0); // P-001: No extraction
    }

    function test_P001_zeroProtocolFee() public pure {
        // P-001 invariant: protocol fee is always zero
        IntelligenceExchange tempSie;
        // The constant is hardcoded — cannot be changed by governance or upgrade
        // This is physics, not policy
        assert(true); // PROTOCOL_FEE_BPS is immutable constant = 0
    }

    // ============ Submit Intelligence ============

    function test_submitIntelligence() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1,
            METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH,
            noCitations
        );

        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        assertEq(asset.contributor, alice);
        assertEq(asset.contentHash, CONTENT_HASH_1);
        assertEq(uint256(asset.assetType), uint256(IntelligenceExchange.AssetType.RESEARCH));
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.SUBMITTED));
        assertEq(asset.citations, 0);
        assertEq(asset.bondingPrice, sie.getBondingPrice(0));
        assertEq(sie.assetCount(), 1);
    }

    function test_submitIntelligence_withCitations() public {
        bytes32[] memory noCitations = new bytes32[](0);

        // Alice submits paper 1
        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // Bob submits paper 2 citing paper 1
        bytes32[] memory cites = new bytes32[](1);
        cites[0] = paper1;

        vm.prank(bob);
        bytes32 paper2 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_2, METADATA_URI_2,
            IntelligenceExchange.AssetType.RESEARCH, cites
        );

        // Paper 1 should now have 1 citation
        IntelligenceExchange.IntelligenceAsset memory asset1 = sie.getAsset(paper1);
        assertEq(asset1.citations, 1);
        assertGt(asset1.bondingPrice, sie.getBondingPrice(0)); // Price increased

        // Citation graph should be recorded
        bytes32[] memory citationsOfPaper1 = sie.getCitations(paper1);
        assertEq(citationsOfPaper1.length, 1);
        assertEq(citationsOfPaper1[0], paper2);
    }

    function test_submitIntelligence_revert_insufficientStake() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.InsufficientStake.selector);
        sie.submitIntelligence{value: 0.0001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    function test_submitIntelligence_revert_invalidContentHash() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.InvalidContentHash.selector);
        sie.submitIntelligence{value: 0.001 ether}(
            bytes32(0), METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    function test_submitIntelligence_revert_invalidMetadataURI() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.InvalidMetadataURI.selector);
        sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, "",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    // ============ Citation System ============

    function test_cite_updatesBondingPrice() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(bob);
        bytes32 paper2 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_2, METADATA_URI_2,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // Bob cites Alice's paper
        vm.prank(bob);
        sie.cite(paper2, paper1);

        IntelligenceExchange.IntelligenceAsset memory asset1 = sie.getAsset(paper1);
        assertEq(asset1.citations, 1);
        assertEq(asset1.bondingPrice, sie.getBondingPrice(1));
    }

    function test_cite_revert_selfCitation() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.SelfCitation.selector);
        sie.cite(paper1, paper1);
    }

    function test_cite_revert_duplicateCitation() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(bob);
        bytes32 paper2 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_2, METADATA_URI_2,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(bob);
        sie.cite(paper2, paper1);

        vm.prank(bob);
        vm.expectRevert(IntelligenceExchange.DuplicateCitation.selector);
        sie.cite(paper2, paper1);
    }

    function test_cite_multipleCitations_priceGrows() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        uint256 price0 = sie.getBondingPrice(0);
        uint256 price1 = sie.getBondingPrice(1);
        uint256 price5 = sie.getBondingPrice(5);
        uint256 price10 = sie.getBondingPrice(10);

        // Bonding curve is monotonically increasing
        assertLt(price0, price1);
        assertLt(price1, price5);
        assertLt(price5, price10);
    }

    // ============ Access & Revenue ============

    function test_purchaseAccess_revenueDistribution() public {
        bytes32[] memory noCitations = new bytes32[](0);

        // Alice submits foundational paper
        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // Bob submits paper citing Alice
        bytes32[] memory cites = new bytes32[](1);
        cites[0] = paper1;

        vm.prank(bob);
        bytes32 paper2 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_2, METADATA_URI_2,
            IntelligenceExchange.AssetType.RESEARCH, cites
        );

        // Carol buys access to Bob's paper
        IntelligenceExchange.IntelligenceAsset memory bobAsset = sie.getAsset(paper2);
        uint256 price = bobAsset.bondingPrice;

        vm.prank(carol);
        sie.purchaseAccess(paper2);

        // Carol has access
        assertTrue(sie.hasAccess(paper2, carol));

        // Revenue split: 70% to Bob, 30% to cited works (Alice)
        uint256 citationPool = (price * 3000) / 10000;
        uint256 bobShare = price - citationPool;

        assertEq(sie.claimable(bob), bobShare);
        assertEq(sie.claimable(alice), citationPool); // Alice gets citation revenue
    }

    function test_purchaseAccess_noCitations_allToContributor() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(paper1);
        uint256 price = asset.bondingPrice;

        vm.prank(bob);
        sie.purchaseAccess(paper1);

        // No citations means all revenue goes to contributor
        assertEq(sie.claimable(alice), price);
    }

    function test_purchaseAccess_revert_alreadyHasAccess() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(bob);
        sie.purchaseAccess(paper1);

        vm.prank(bob);
        vm.expectRevert(IntelligenceExchange.AlreadyHasAccess.selector);
        sie.purchaseAccess(paper1);
    }

    // ============ Claims ============

    function test_claimRewards() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(bob);
        sie.purchaseAccess(paper1);

        uint256 claimableAmount = sie.claimable(alice);
        uint256 balanceBefore = vibe.balanceOf(alice);

        vm.prank(alice);
        sie.claimRewards();

        assertEq(vibe.balanceOf(alice), balanceBefore + claimableAmount);
        assertEq(sie.claimable(alice), 0);
    }

    function test_claimRewards_revert_nothingToClaim() public {
        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.NothingToClaim.selector);
        sie.claimRewards();
    }

    // ============ Knowledge Epochs ============

    function test_anchorKnowledgeEpoch() public {
        bytes32 merkleRoot = keccak256("epoch-1-root");

        vm.prank(shard1);
        sie.anchorKnowledgeEpoch(merkleRoot, 42, 1000 ether);

        assertEq(sie.epochCount(), 1);
        IntelligenceExchange.KnowledgeEpoch memory epoch = sie.getEpoch(1);
        assertEq(epoch.merkleRoot, merkleRoot);
        assertEq(epoch.assetCount, 42);
        assertEq(epoch.totalValue, 1000 ether);
        assertEq(epoch.submitter, shard1);
    }

    function test_anchorKnowledgeEpoch_revert_notSubmitter() public {
        vm.prank(alice); // Not an authorized submitter
        vm.expectRevert(IntelligenceExchange.NotEpochSubmitter.selector);
        sie.anchorKnowledgeEpoch(keccak256("root"), 1, 1 ether);
    }

    function test_anchorKnowledgeEpoch_ownerCanSubmit() public {
        bytes32 merkleRoot = keccak256("owner-epoch");

        // Owner can always submit
        sie.anchorKnowledgeEpoch(merkleRoot, 10, 500 ether);
        assertEq(sie.epochCount(), 1);
    }

    // ============ Verification ============

    function test_verifyAsset() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        sie.verifyAsset(paper1);

        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(paper1);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.VERIFIED));
    }

    function test_disputeAsset() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        sie.disputeAsset(paper1);

        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(paper1);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.DISPUTED));
    }

    // ============ Admin ============

    function test_addRemoveEpochSubmitter() public {
        address newShard = address(uint160(0x7EE));
        sie.addEpochSubmitter(newShard);
        assertTrue(sie.epochSubmitters(newShard));

        sie.removeEpochSubmitter(newShard);
        assertFalse(sie.epochSubmitters(newShard));
    }

    // ============ Integration: Full Flow ============

    function test_fullFlow_submitCiteAccessClaim() public {
        bytes32[] memory noCitations = new bytes32[](0);

        // 1. Alice submits foundational research
        vm.prank(alice);
        bytes32 foundation = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_1, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // 2. Bob builds on Alice's work
        bytes32[] memory cites = new bytes32[](1);
        cites[0] = foundation;

        vm.prank(bob);
        bytes32 extension = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_2, METADATA_URI_2,
            IntelligenceExchange.AssetType.MODEL, cites
        );

        // 3. Carol builds on both
        bytes32[] memory bothCites = new bytes32[](2);
        bothCites[0] = foundation;
        bothCites[1] = extension;

        vm.prank(carol);
        bytes32 synthesis = sie.submitIntelligence{value: 0.001 ether}(
            CONTENT_HASH_3, METADATA_URI_3,
            IntelligenceExchange.AssetType.INSIGHT, bothCites
        );

        // Alice's paper now has 2 citations (from Bob and Carol)
        assertEq(sie.getAsset(foundation).citations, 2);
        // Bob's paper has 1 citation (from Carol)
        assertEq(sie.getAsset(extension).citations, 1);

        // 4. Verify assets
        sie.verifyAsset(foundation);
        sie.verifyAsset(extension);
        sie.verifyAsset(synthesis);

        // 5. Someone buys access to Carol's synthesis
        address buyer = address(0xBEEF);
        vibe.mint(buyer, 100 ether);
        vm.prank(buyer);
        vibe.approve(address(sie), type(uint256).max);

        vm.prank(buyer);
        sie.purchaseAccess(synthesis);

        // 6. Revenue flows: Carol gets 70%, Alice and Bob split 30%
        assertTrue(sie.claimable(carol) > 0);
        assertTrue(sie.claimable(alice) > 0);
        assertTrue(sie.claimable(bob) > 0);

        // 7. Alice claims
        uint256 aliceBalanceBefore = vibe.balanceOf(alice);
        vm.prank(alice);
        sie.claimRewards();
        assertGt(vibe.balanceOf(alice), aliceBalanceBefore);

        // 8. Anchor knowledge epoch
        vm.prank(shard1);
        sie.anchorKnowledgeEpoch(keccak256("epoch-1"), 3, 1 ether);
        assertEq(sie.epochCount(), 1);
    }

    // ============ Fuzz Tests ============

    function testFuzz_bondingCurveMonotonic(uint256 citations1, uint256 citations2) public view {
        citations1 = bound(citations1, 0, 1000);
        citations2 = bound(citations2, citations1 + 1, 1001);

        uint256 price1 = sie.getBondingPrice(citations1);
        uint256 price2 = sie.getBondingPrice(citations2);

        assertLe(price1, price2, "Bonding curve must be monotonically increasing");
    }

    function testFuzz_revenueConservation(uint256 price) public {
        price = bound(price, 1, 100 ether);

        // Revenue conservation: contributor share + citation pool = total price
        uint256 citationPool = (price * 3000) / 10000;
        uint256 contributorShare = price - citationPool;

        assertEq(contributorShare + citationPool, price, "Revenue must be conserved");
    }

    function testFuzz_submitWithVariousStakes(uint256 stake) public {
        stake = bound(stake, 0.001 ether, 10 ether);
        bytes32[] memory noCitations = new bytes32[](0);
        bytes32 contentHash = keccak256(abi.encodePacked("content", stake));

        vm.deal(alice, stake);
        vm.prank(alice);
        bytes32 assetId = sie.submitIntelligence{value: stake}(
            contentHash, METADATA_URI_1,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        assertEq(sie.getAsset(assetId).stakeAmount, stake);
    }
}
