// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/IntelligenceExchange.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockVIBEIntegration is ERC20 {
    constructor() ERC20("VIBE", "VIBE") { _mint(msg.sender, 1e9 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title IntelligenceExchangeIntegration — End-to-End Scenarios
 * @notice Tests complete user journeys through the SIE:
 *   1. Academic citation chain (foundational → derivative → synthesis)
 *   2. Revenue waterfall through citation graph
 *   3. Multi-epoch knowledge anchoring
 *   4. Concurrent multi-user access patterns
 *   5. Large citation graph stress test
 */
contract IntelligenceExchangeIntegrationTest is Test {
    IntelligenceExchange public sie;
    MockVIBEIntegration public vibe;

    address public owner = address(this);
    address public shard = address(0x5BARD);

    // Simulated researchers
    address public satoshi = address(0x5A70);   // Foundational
    address public vitalik = address(0x71A1);   // Builds on Satoshi
    address public will = address(0x1337);      // Synthesizes both
    address public carol = address(0xCA01);     // Independent
    address public reader1 = address(0xBEE1);
    address public reader2 = address(0xBEE2);
    address public reader3 = address(0xBEE3);

    function setUp() public {
        vibe = new MockVIBEIntegration();
        IntelligenceExchange impl = new IntelligenceExchange();
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize, (address(vibe), owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sie = IntelligenceExchange(payable(address(proxy)));
        sie.addEpochSubmitter(shard);

        address[7] memory users = [satoshi, vitalik, will, carol, reader1, reader2, reader3];
        for (uint256 i = 0; i < users.length; i++) {
            vm.deal(users[i], 10 ether);
            vibe.mint(users[i], 10_000 ether);
            vm.prank(users[i]);
            vibe.approve(address(sie), type(uint256).max);
        }
    }

    // ============ Scenario 1: Academic Citation Chain ============

    function test_academicCitationChain() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Satoshi publishes foundational work
        vm.prank(satoshi);
        bytes32 bitcoin = sie.submitIntelligence{value: 0.01 ether}(
            keccak256("bitcoin-whitepaper"),
            "ipfs://QmBitcoin",
            IntelligenceExchange.AssetType.RESEARCH,
            noCites
        );

        // Vitalik builds on Satoshi
        bytes32[] memory citesSatoshi = new bytes32[](1);
        citesSatoshi[0] = bitcoin;

        vm.prank(vitalik);
        bytes32 ethereum = sie.submitIntelligence{value: 0.01 ether}(
            keccak256("ethereum-whitepaper"),
            "ipfs://QmEthereum",
            IntelligenceExchange.AssetType.RESEARCH,
            citesSatoshi
        );

        // Will synthesizes both
        bytes32[] memory citesBoth = new bytes32[](2);
        citesBoth[0] = bitcoin;
        citesBoth[1] = ethereum;

        vm.prank(will);
        bytes32 economitra = sie.submitIntelligence{value: 0.01 ether}(
            keccak256("economitra"),
            "ipfs://QmEconomitra",
            IntelligenceExchange.AssetType.INSIGHT,
            citesBoth
        );

        // Verify citation counts
        assertEq(sie.getAsset(bitcoin).citations, 2);   // Cited by Vitalik + Will
        assertEq(sie.getAsset(ethereum).citations, 1);   // Cited by Will
        assertEq(sie.getAsset(economitra).citations, 0); // Not cited yet

        // Verify bonding prices reflect citation count
        uint256 priceBitcoin = sie.getAsset(bitcoin).bondingPrice;
        uint256 priceEthereum = sie.getAsset(ethereum).bondingPrice;
        uint256 priceEconomitra = sie.getAsset(economitra).bondingPrice;

        assertGt(priceBitcoin, priceEthereum);       // More citations = higher price
        assertGt(priceEthereum, priceEconomitra);     // 1 citation > 0 citations

        // Carol reads Economitra
        vm.prank(carol);
        sie.purchaseAccess(economitra);

        // Revenue flows: Will gets 70%, Satoshi and Vitalik split 30%
        uint256 willClaimable = sie.claimable(will);
        uint256 satoshiClaimable = sie.claimable(satoshi);
        uint256 vitalikClaimable = sie.claimable(vitalik);

        assertGt(willClaimable, 0, "Will should earn direct revenue");
        assertGt(satoshiClaimable, 0, "Satoshi should earn citation revenue");
        assertGt(vitalikClaimable, 0, "Vitalik should earn citation revenue");
        assertEq(satoshiClaimable, vitalikClaimable, "Equal citations = equal share");

        // Total distributed = price
        uint256 totalDistributed = willClaimable + satoshiClaimable + vitalikClaimable;
        assertEq(totalDistributed, priceEconomitra, "Revenue fully distributed");
    }

    // ============ Scenario 2: Revenue Waterfall ============

    function test_revenueWaterfall() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Build a 4-layer citation chain: A → B → C → D
        vm.prank(satoshi);
        bytes32 layerA = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("layer-a"), "ipfs://a",
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        bytes32[] memory citesA = new bytes32[](1);
        citesA[0] = layerA;
        vm.prank(vitalik);
        bytes32 layerB = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("layer-b"), "ipfs://b",
            IntelligenceExchange.AssetType.RESEARCH, citesA
        );

        bytes32[] memory citesB = new bytes32[](1);
        citesB[0] = layerB;
        vm.prank(will);
        bytes32 layerC = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("layer-c"), "ipfs://c",
            IntelligenceExchange.AssetType.MODEL, citesB
        );

        bytes32[] memory citesC = new bytes32[](1);
        citesC[0] = layerC;
        vm.prank(carol);
        bytes32 layerD = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("layer-d"), "ipfs://d",
            IntelligenceExchange.AssetType.INSIGHT, citesC
        );

        // Reader buys access to D
        vm.prank(reader1);
        sie.purchaseAccess(layerD);

        // Carol (D author) gets direct share
        assertGt(sie.claimable(carol), 0, "D author earns");
        // Will (C author) gets citation share from D
        assertGt(sie.claimable(will), 0, "C author earns from D access");
        // Vitalik (B author) does NOT earn — D only cites C directly
        assertEq(sie.claimable(vitalik), 0, "B author doesn't earn from D (not directly cited)");

        // Now reader buys access to C
        vm.prank(reader2);
        sie.purchaseAccess(layerC);

        // Will earns directly, Vitalik earns citation share
        assertGt(sie.claimable(vitalik), 0, "B author earns from C access");

        // Reader buys B → Satoshi earns
        vm.prank(reader3);
        sie.purchaseAccess(layerB);
        assertGt(sie.claimable(satoshi), 0, "A author earns from B access");
    }

    // ============ Scenario 3: Multi-Epoch Anchoring ============

    function test_multiEpochAnchoring() public {
        // Anchor 5 epochs
        for (uint256 i = 1; i <= 5; i++) {
            vm.prank(shard);
            sie.anchorKnowledgeEpoch(
                keccak256(abi.encodePacked("epoch-", i)),
                i * 10,      // Growing asset count
                i * 1 ether  // Growing value
            );
        }

        assertEq(sie.epochCount(), 5);

        // Verify epoch data integrity
        for (uint256 i = 1; i <= 5; i++) {
            IntelligenceExchange.KnowledgeEpoch memory epoch = sie.getEpoch(i);
            assertEq(epoch.epochId, i);
            assertEq(epoch.assetCount, i * 10);
            assertEq(epoch.totalValue, i * 1 ether);
            assertEq(epoch.submitter, shard);
        }
    }

    // ============ Scenario 4: Concurrent Multi-User Access ============

    function test_concurrentMultiUserAccess() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Single paper accessed by multiple readers
        vm.prank(will);
        bytes32 paper = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("popular-paper"), "ipfs://popular",
            IntelligenceExchange.AssetType.PROOF, noCites
        );

        // 3 readers buy access
        vm.prank(reader1);
        sie.purchaseAccess(paper);
        vm.prank(reader2);
        sie.purchaseAccess(paper);
        vm.prank(reader3);
        sie.purchaseAccess(paper);

        // Will should have 3x the access price as claimable
        uint256 price = sie.getAsset(paper).bondingPrice;
        assertEq(sie.claimable(will), price * 3, "3 accesses = 3x revenue");

        // Claim all
        uint256 balBefore = vibe.balanceOf(will);
        vm.prank(will);
        sie.claimRewards();
        assertEq(vibe.balanceOf(will) - balBefore, price * 3);
        assertEq(sie.claimable(will), 0);
    }

    // ============ Scenario 5: Large Citation Graph ============

    function test_largeCitationGraph() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Create foundational paper
        vm.prank(satoshi);
        bytes32 foundation = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("foundation"), "ipfs://foundation",
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        // 20 papers all citing the foundation
        bytes32[] memory citesFoundation = new bytes32[](1);
        citesFoundation[0] = foundation;

        for (uint256 i = 0; i < 20; i++) {
            address researcher = address(uint160(0xF000 + i));
            vm.deal(researcher, 1 ether);
            vibe.mint(researcher, 100 ether);
            vm.prank(researcher);
            vibe.approve(address(sie), type(uint256).max);

            vm.prank(researcher);
            sie.submitIntelligence{value: 0.001 ether}(
                keccak256(abi.encodePacked("derivative-", i)),
                "ipfs://derivative",
                IntelligenceExchange.AssetType.INSIGHT,
                citesFoundation
            );
        }

        // Foundation now has 20 citations
        assertEq(sie.getAsset(foundation).citations, 20);

        // Price should be significantly higher than base
        uint256 highCitationPrice = sie.getAsset(foundation).bondingPrice;
        uint256 basePrice = sie.getBondingPrice(0);
        assertGt(highCitationPrice, basePrice * 10, "20 citations should significantly increase price");

        // Someone buys access to the foundation
        vm.prank(reader1);
        sie.purchaseAccess(foundation);

        // Satoshi gets 100% (no citations in the foundation)
        assertEq(sie.claimable(satoshi), highCitationPrice);
    }

    // ============ Scenario 6: Mixed Asset Types ============

    function test_mixedAssetTypes() public {
        bytes32[] memory noCites = new bytes32[](0);

        IntelligenceExchange.AssetType[6] memory types = [
            IntelligenceExchange.AssetType.RESEARCH,
            IntelligenceExchange.AssetType.MODEL,
            IntelligenceExchange.AssetType.DATASET,
            IntelligenceExchange.AssetType.INSIGHT,
            IntelligenceExchange.AssetType.PROOF,
            IntelligenceExchange.AssetType.PROTOCOL
        ];

        // Submit one of each type
        for (uint256 i = 0; i < 6; i++) {
            address researcher = address(uint160(0xE000 + i));
            vm.deal(researcher, 1 ether);

            vm.prank(researcher);
            bytes32 assetId = sie.submitIntelligence{value: 0.001 ether}(
                keccak256(abi.encodePacked("asset-type-", i)),
                "ipfs://typed",
                types[i],
                noCites
            );

            IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
            assertEq(uint256(asset.assetType), uint256(types[i]));
        }

        assertEq(sie.assetCount(), 6);
    }

    // ============ Scenario 7: Full Lifecycle with Verification ============

    function test_fullLifecycleWithVerification() public {
        bytes32[] memory noCites = new bytes32[](0);

        // 1. Submit
        vm.prank(will);
        bytes32 paper = sie.submitIntelligence{value: 0.01 ether}(
            keccak256("lifecycle-paper"), "ipfs://lifecycle",
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );
        assertEq(uint256(sie.getAsset(paper).state), uint256(IntelligenceExchange.AssetState.SUBMITTED));

        // 2. Verify (owner in MVP, CRPC in Phase 1)
        sie.verifyAsset(paper);
        assertEq(uint256(sie.getAsset(paper).state), uint256(IntelligenceExchange.AssetState.VERIFIED));

        // 3. Access
        vm.prank(reader1);
        sie.purchaseAccess(paper);
        assertTrue(sie.hasAccess(paper, reader1));

        // 4. Claim
        uint256 earnings = sie.claimable(will);
        assertGt(earnings, 0);

        vm.prank(will);
        sie.claimRewards();
        assertEq(sie.claimable(will), 0);
        assertEq(sie.contributorEarnings(will), earnings);

        // 5. Anchor epoch
        vm.prank(shard);
        sie.anchorKnowledgeEpoch(keccak256("final-epoch"), 1, earnings);
        assertEq(sie.epochCount(), 1);
    }

    // ============ Scenario 8: Revenue Conservation Across Graph ============

    function test_revenueConservationAcrossGraph() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Build: A → B → C (each cites the previous)
        vm.prank(satoshi);
        bytes32 a = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("a"), "ipfs://a",
            IntelligenceExchange.AssetType.RESEARCH, noCites
        );

        bytes32[] memory citesA = new bytes32[](1);
        citesA[0] = a;
        vm.prank(vitalik);
        bytes32 b = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("b"), "ipfs://b",
            IntelligenceExchange.AssetType.RESEARCH, citesA
        );

        bytes32[] memory citesAB = new bytes32[](2);
        citesAB[0] = a;
        citesAB[1] = b;
        vm.prank(will);
        bytes32 c = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("c"), "ipfs://c",
            IntelligenceExchange.AssetType.INSIGHT, citesAB
        );

        // Buy access to all three
        uint256 vibeBeforeSIE = vibe.balanceOf(address(sie));

        vm.prank(reader1);
        sie.purchaseAccess(a);
        vm.prank(reader2);
        sie.purchaseAccess(b);
        vm.prank(reader3);
        sie.purchaseAccess(c);

        uint256 vibeAfterSIE = vibe.balanceOf(address(sie));
        uint256 totalPaid = vibeAfterSIE - vibeBeforeSIE;

        // Total claimable must equal total paid
        uint256 totalClaimable = sie.claimable(satoshi) + sie.claimable(vitalik) + sie.claimable(will);
        assertEq(totalClaimable, totalPaid, "Revenue conservation: claimable == paid");
    }
}
