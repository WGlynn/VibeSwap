// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/rwa/VibeRWA.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeRWATest is Test {
    // ============ State ============

    VibeRWA public rwa;
    address public deployer;
    address public issuer;
    address public buyer;
    address public buyer2;
    address public appraiser;
    address public verifier;

    // ============ setUp ============

    function setUp() public {
        deployer = makeAddr("deployer");
        issuer = makeAddr("issuer");
        buyer = makeAddr("buyer");
        buyer2 = makeAddr("buyer2");
        appraiser = makeAddr("appraiser");
        verifier = makeAddr("verifier");

        vm.startPrank(deployer);
        VibeRWA impl = new VibeRWA();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeRWA.initialize, ())
        );
        rwa = VibeRWA(payable(address(proxy)));

        // Setup roles
        rwa.addAppraiser(appraiser);
        rwa.addLegalVerifier(verifier);
        rwa.setKYC(buyer, true);
        rwa.setKYC(buyer2, true);
        vm.stopPrank();

        vm.deal(issuer, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(buyer2, 100 ether);
    }

    // ============ Helpers ============

    function _registerAsset() internal returns (bytes32 assetId) {
        vm.prank(issuer);
        assetId = rwa.registerAsset(
            VibeRWA.AssetClass.REAL_ESTATE,
            "Downtown Office Building",
            keccak256("legal-doc-hash"),
            keccak256("appraisal-hash"),
            1000,           // totalShares
            0.1 ether,      // pricePerShare
            100 ether,      // appraisedValue
            "US-CA"
        );
    }

    function _registerAndActivate() internal returns (bytes32 assetId) {
        assetId = _registerAsset();
        vm.prank(verifier);
        rwa.activateAsset(assetId);
    }

    // ============ Asset Registration Tests ============

    function test_RegisterAsset_SetsFields() public {
        bytes32 assetId = _registerAsset();

        VibeRWA.RealWorldAsset memory asset = rwa.getAsset(assetId);
        assertEq(asset.issuer, issuer);
        assertEq(uint8(asset.assetClass), uint8(VibeRWA.AssetClass.REAL_ESTATE));
        assertEq(asset.totalShares, 1000);
        assertEq(asset.sharesSold, 0);
        assertEq(asset.pricePerShare, 0.1 ether);
        assertEq(asset.appraisedValue, 100 ether);
        assertEq(uint8(asset.status), uint8(VibeRWA.AssetStatus.PENDING));
        assertEq(asset.registeredAt, block.timestamp);
    }

    function test_RegisterAsset_IncrementsCounters() public {
        _registerAsset();
        assertEq(rwa.totalAssetsRegistered(), 1);
        assertEq(rwa.totalValueTokenized(), 100 ether);
        assertEq(rwa.getAssetCount(), 1);
    }

    function test_RegisterAsset_MultipleAssets() public {
        _registerAsset();

        vm.prank(issuer);
        rwa.registerAsset(
            VibeRWA.AssetClass.ART,
            "Rare Painting",
            keccak256("art-doc"),
            keccak256("art-appraisal"),
            100,
            1 ether,
            100 ether,
            "US-NY"
        );

        assertEq(rwa.totalAssetsRegistered(), 2);
        assertEq(rwa.totalValueTokenized(), 200 ether);
        assertEq(rwa.getAssetCount(), 2);
    }

    function test_RegisterAsset_UniqueIds() public {
        vm.prank(issuer);
        bytes32 id1 = rwa.registerAsset(
            VibeRWA.AssetClass.REAL_ESTATE, "Asset A",
            bytes32(0), bytes32(0), 100, 1 ether, 10 ether, "US"
        );

        vm.warp(block.timestamp + 1); // Different timestamp => different id
        vm.prank(issuer);
        bytes32 id2 = rwa.registerAsset(
            VibeRWA.AssetClass.REAL_ESTATE, "Asset B",
            bytes32(0), bytes32(0), 100, 1 ether, 10 ether, "US"
        );

        assertTrue(id1 != id2, "Asset IDs must be unique");
    }

    // ============ Asset Activation Tests ============

    function test_ActivateAsset_ByVerifier() public {
        bytes32 assetId = _registerAsset();

        vm.prank(verifier);
        rwa.activateAsset(assetId);

        VibeRWA.RealWorldAsset memory asset = rwa.getAsset(assetId);
        assertEq(uint8(asset.status), uint8(VibeRWA.AssetStatus.ACTIVE));
    }

    function test_ActivateAsset_RevertsNonVerifier() public {
        bytes32 assetId = _registerAsset();

        vm.prank(buyer);
        vm.expectRevert("Not legal verifier");
        rwa.activateAsset(assetId);
    }

    // ============ Primary Market Tests ============

    function test_PurchaseShares_Success() public {
        bytes32 assetId = _registerAndActivate();

        uint256 issuerBefore = issuer.balance;
        vm.prank(buyer);
        rwa.purchaseShares{value: 1 ether}(assetId, 10); // 10 shares * 0.1 ETH = 1 ETH

        (uint256 shares, ) = rwa.getHolding(assetId, buyer);
        assertEq(shares, 10);

        VibeRWA.RealWorldAsset memory asset = rwa.getAsset(assetId);
        assertEq(asset.sharesSold, 10);

        // Issuer receives 99% (1% platform fee)
        uint256 expectedFee = (1 ether * 100) / 10000; // 1% = 0.01 ETH
        assertEq(issuer.balance - issuerBefore, 1 ether - expectedFee);
    }

    function test_PurchaseShares_RevertsPendingStatus() public {
        bytes32 assetId = _registerAsset(); // Not activated

        vm.prank(buyer);
        vm.expectRevert("Not available");
        rwa.purchaseShares{value: 1 ether}(assetId, 10);
    }

    function test_PurchaseShares_RevertsInsufficientShares() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        vm.expectRevert("Insufficient shares");
        rwa.purchaseShares{value: 200 ether}(assetId, 1001); // Only 1000 total
    }

    function test_PurchaseShares_RevertsInsufficientPayment() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        vm.expectRevert("Insufficient payment");
        rwa.purchaseShares{value: 0.5 ether}(assetId, 10); // Needs 1 ETH
    }

    function test_PurchaseShares_RefundsExcess() public {
        bytes32 assetId = _registerAndActivate();

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        rwa.purchaseShares{value: 2 ether}(assetId, 10); // Sends 2 ETH, costs 1 ETH

        // Buyer paid 1 ETH net (2 sent - 1 refunded)
        uint256 expectedCost = 1 ether;
        assertEq(buyerBefore - buyer.balance, expectedCost);
    }

    function test_PurchaseShares_AllShares() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 100 ether}(assetId, 1000);

        VibeRWA.RealWorldAsset memory asset = rwa.getAsset(assetId);
        assertEq(asset.sharesSold, 1000);
    }

    // ============ Yield Distribution Tests ============

    function test_DistributeYield_Success() public {
        bytes32 assetId = _registerAndActivate();

        // Buyer purchases shares first
        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        // Issuer distributes yield
        vm.prank(issuer);
        rwa.distributeYield{value: 5 ether}(assetId);

        assertEq(rwa.currentEpoch(assetId), 1);
        assertEq(rwa.totalYieldPaid(), 5 ether);

        VibeRWA.RealWorldAsset memory asset = rwa.getAsset(assetId);
        assertEq(asset.totalYieldDistributed, 5 ether);
        assertEq(uint8(asset.status), uint8(VibeRWA.AssetStatus.YIELDING));
    }

    function test_DistributeYield_RevertsZeroValue() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(issuer);
        vm.expectRevert("Zero yield");
        rwa.distributeYield{value: 0}(assetId);
    }

    function test_DistributeYield_RevertsNonIssuer() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(buyer);
        vm.expectRevert("Not issuer");
        rwa.distributeYield{value: 1 ether}(assetId);
    }

    function test_DistributeYield_RevertsNoShareholders() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(issuer);
        vm.expectRevert("No shareholders");
        rwa.distributeYield{value: 1 ether}(assetId);
    }

    // ============ Yield Claim Tests ============

    function test_ClaimYield_Success() public {
        bytes32 assetId = _registerAndActivate();

        // Buyer gets all 100 shares sold
        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        // Issuer distributes 5 ETH yield
        vm.prank(issuer);
        rwa.distributeYield{value: 5 ether}(assetId);

        // Buyer claims: holds 100 out of 100 shares sold => gets 100% of yield
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        rwa.claimYield(assetId);

        assertEq(buyer.balance - buyerBefore, 5 ether);
    }

    function test_ClaimYield_ProportionalDistribution() public {
        bytes32 assetId = _registerAndActivate();

        // Two buyers split shares
        vm.prank(buyer);
        rwa.purchaseShares{value: 5 ether}(assetId, 50);

        vm.prank(buyer2);
        rwa.purchaseShares{value: 5 ether}(assetId, 50);

        // Distribute 10 ETH yield across 100 shares
        vm.prank(issuer);
        rwa.distributeYield{value: 10 ether}(assetId);

        uint256 buyer1Before = buyer.balance;
        vm.prank(buyer);
        rwa.claimYield(assetId);
        assertEq(buyer.balance - buyer1Before, 5 ether); // 50/100 * 10 = 5

        uint256 buyer2Before = buyer2.balance;
        vm.prank(buyer2);
        rwa.claimYield(assetId);
        assertEq(buyer2.balance - buyer2Before, 5 ether); // 50/100 * 10 = 5
    }

    function test_ClaimYield_MultipleEpochs() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        // Epoch 1
        vm.prank(issuer);
        rwa.distributeYield{value: 2 ether}(assetId);

        // Epoch 2
        vm.prank(issuer);
        rwa.distributeYield{value: 3 ether}(assetId);

        // Claim both epochs at once
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        rwa.claimYield(assetId);

        assertEq(buyer.balance - buyerBefore, 5 ether); // 2 + 3
    }

    function test_ClaimYield_RevertsNoShares() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(issuer);
        rwa.distributeYield{value: 1 ether}(assetId);

        vm.prank(buyer2); // buyer2 has no shares
        vm.expectRevert("No shares");
        rwa.claimYield(assetId);
    }

    function test_ClaimYield_RevertsNothingToClaim() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(issuer);
        rwa.distributeYield{value: 1 ether}(assetId);

        // First claim succeeds
        vm.prank(buyer);
        rwa.claimYield(assetId);

        // Second claim reverts — already claimed this epoch
        vm.prank(buyer);
        vm.expectRevert("Nothing to claim");
        rwa.claimYield(assetId);
    }

    // ============ Secondary Market Tests ============

    function test_ListShares_Success() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(buyer);
        uint256 listingId = rwa.listShares(assetId, 50, 0.2 ether);

        assertEq(listingId, 1);
        assertEq(rwa.listingCount(), 1);
    }

    function test_ListShares_RevertsInsufficientShares() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(buyer);
        vm.expectRevert("Insufficient shares");
        rwa.listShares(assetId, 200, 0.2 ether); // Only has 100
    }

    function test_BuyListed_TransfersShares() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(buyer);
        uint256 listingId = rwa.listShares(assetId, 50, 0.2 ether);

        uint256 sellerBefore = buyer.balance;
        vm.prank(buyer2);
        rwa.buyListed{value: 10 ether}(listingId); // 50 * 0.2 = 10 ETH

        (uint256 buyerShares, ) = rwa.getHolding(assetId, buyer);
        (uint256 buyer2Shares, ) = rwa.getHolding(assetId, buyer2);
        assertEq(buyerShares, 50); // 100 - 50
        assertEq(buyer2Shares, 50);

        // Seller gets 99% (1% fee)
        uint256 fee = (10 ether * 100) / 10000;
        assertEq(buyer.balance - sellerBefore, 10 ether - fee);
    }

    function test_BuyListed_RevertsNotActive() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(buyer);
        uint256 listingId = rwa.listShares(assetId, 50, 0.2 ether);

        vm.prank(buyer);
        rwa.cancelListing(listingId);

        vm.prank(buyer2);
        vm.expectRevert("Not active");
        rwa.buyListed{value: 10 ether}(listingId);
    }

    function test_BuyListed_IncreasesSecondaryVolume() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(buyer);
        uint256 listingId = rwa.listShares(assetId, 50, 0.2 ether);

        vm.prank(buyer2);
        rwa.buyListed{value: 10 ether}(listingId);

        assertEq(rwa.totalSecondaryVolume(), 10 ether);
    }

    function test_CancelListing_OnlyBySeller() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(buyer);
        uint256 listingId = rwa.listShares(assetId, 50, 0.2 ether);

        vm.prank(buyer2);
        vm.expectRevert("Not seller");
        rwa.cancelListing(listingId);
    }

    // ============ Appraisal Tests ============

    function test_UpdateAppraisal_Success() public {
        bytes32 assetId = _registerAsset();

        vm.prank(appraiser);
        rwa.updateAppraisal(assetId, 120 ether, keccak256("new-hash"));

        VibeRWA.RealWorldAsset memory asset = rwa.getAsset(assetId);
        assertEq(asset.appraisedValue, 120 ether);
        assertEq(rwa.totalValueTokenized(), 120 ether); // Updated from 100 to 120
    }

    function test_UpdateAppraisal_RevertsNonAppraiser() public {
        bytes32 assetId = _registerAsset();

        vm.prank(buyer);
        vm.expectRevert("Not appraiser");
        rwa.updateAppraisal(assetId, 120 ether, keccak256("new-hash"));
    }

    function test_UpdateAppraisal_AdjustsTotalValue() public {
        bytes32 assetId = _registerAsset();

        // Total tokenized = 100 ETH after registration
        assertEq(rwa.totalValueTokenized(), 100 ether);

        // Reappraise downward to 80 ETH
        vm.prank(appraiser);
        rwa.updateAppraisal(assetId, 80 ether, keccak256("lower"));

        assertEq(rwa.totalValueTokenized(), 80 ether);
    }

    // ============ Admin Tests ============

    function test_Admin_AddRemoveAppraiser() public {
        address newAppraiser = makeAddr("newAppraiser");

        vm.prank(deployer);
        rwa.addAppraiser(newAppraiser);
        assertTrue(rwa.approvedAppraisers(newAppraiser));

        vm.prank(deployer);
        rwa.removeAppraiser(newAppraiser);
        assertFalse(rwa.approvedAppraisers(newAppraiser));
    }

    function test_Admin_AddRemoveLegalVerifier() public {
        address newVerifier = makeAddr("newVerifier");

        vm.prank(deployer);
        rwa.addLegalVerifier(newVerifier);
        assertTrue(rwa.legalVerifiers(newVerifier));

        vm.prank(deployer);
        rwa.removeLegalVerifier(newVerifier);
        assertFalse(rwa.legalVerifiers(newVerifier));
    }

    function test_Admin_SetKYC() public {
        address user = makeAddr("kycUser");

        vm.prank(deployer);
        rwa.setKYC(user, true);
        assertTrue(rwa.kycVerified(user));

        vm.prank(deployer);
        rwa.setKYC(user, false);
        assertFalse(rwa.kycVerified(user));
    }

    function test_Admin_UpdateAssetStatus() public {
        bytes32 assetId = _registerAsset();

        vm.prank(deployer);
        rwa.updateAssetStatus(assetId, VibeRWA.AssetStatus.FROZEN);

        VibeRWA.RealWorldAsset memory asset = rwa.getAsset(assetId);
        assertEq(uint8(asset.status), uint8(VibeRWA.AssetStatus.FROZEN));
    }

    function test_Admin_OnlyOwner() public {
        vm.prank(buyer);
        vm.expectRevert();
        rwa.addAppraiser(buyer);

        vm.prank(buyer);
        vm.expectRevert();
        rwa.addLegalVerifier(buyer);

        vm.prank(buyer);
        vm.expectRevert();
        rwa.setKYC(buyer, true);
    }

    // ============ Fuzz Tests ============

    function testFuzz_PurchaseShares_CorrectCost(uint256 shareCount) public {
        bytes32 assetId = _registerAndActivate();
        shareCount = bound(shareCount, 1, 1000);

        uint256 totalCost = shareCount * 0.1 ether;
        vm.deal(buyer, totalCost + 1 ether);

        vm.prank(buyer);
        rwa.purchaseShares{value: totalCost}(assetId, shareCount);

        (uint256 shares, ) = rwa.getHolding(assetId, buyer);
        assertEq(shares, shareCount);
    }

    function testFuzz_YieldDistribution_YieldPerShareAccurate(uint256 yieldAmount, uint256 sharesSold) public {
        sharesSold = bound(sharesSold, 1, 1000);
        yieldAmount = bound(yieldAmount, 1 ether, 100 ether);

        bytes32 assetId = _registerAndActivate();

        uint256 totalCost = sharesSold * 0.1 ether;
        vm.deal(buyer, totalCost + 1 ether);
        vm.prank(buyer);
        rwa.purchaseShares{value: totalCost}(assetId, sharesSold);

        vm.deal(issuer, yieldAmount + 1 ether);
        vm.prank(issuer);
        rwa.distributeYield{value: yieldAmount}(assetId);

        // Verify yield per share calculation
        uint256 expectedYieldPerShare = (yieldAmount * 1e18) / sharesSold;
        VibeRWA.YieldEpoch memory ep = rwa.getYieldEpoch(assetId, 1);
        assertEq(ep.totalYield, yieldAmount);
        assertEq(ep.yieldPerShare, expectedYieldPerShare);
    }

    function testFuzz_SecondaryMarket_FeeCalculation(uint256 pricePerShare) public {
        pricePerShare = bound(pricePerShare, 0.001 ether, 10 ether);

        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        uint256 sharesToSell = 10;
        vm.prank(buyer);
        uint256 listingId = rwa.listShares(assetId, sharesToSell, pricePerShare);

        uint256 totalCost = sharesToSell * pricePerShare;
        uint256 expectedFee = (totalCost * 100) / 10000; // 1%
        uint256 expectedSellerPayment = totalCost - expectedFee;

        uint256 sellerBefore = buyer.balance;
        vm.deal(buyer2, totalCost + 1 ether);
        vm.prank(buyer2);
        rwa.buyListed{value: totalCost}(listingId);

        assertEq(buyer.balance - sellerBefore, expectedSellerPayment);
    }

    // ============ View Function Tests ============

    function test_GetAssetCount_ReturnsCorrectCount() public {
        assertEq(rwa.getAssetCount(), 0);
        _registerAsset();
        assertEq(rwa.getAssetCount(), 1);
    }

    function test_GetTotalValueTokenized_ReturnsCorrectValue() public {
        assertEq(rwa.getTotalValueTokenized(), 0);
        _registerAsset();
        assertEq(rwa.getTotalValueTokenized(), 100 ether);
    }

    // ============ Yielding Status Tests ============

    function test_PurchaseShares_WorksInYieldingStatus() public {
        bytes32 assetId = _registerAndActivate();

        vm.prank(buyer);
        rwa.purchaseShares{value: 10 ether}(assetId, 100);

        vm.prank(issuer);
        rwa.distributeYield{value: 1 ether}(assetId);

        // Asset is now YIELDING — purchases should still work
        vm.prank(buyer2);
        rwa.purchaseShares{value: 5 ether}(assetId, 50);

        (uint256 shares, ) = rwa.getHolding(assetId, buyer2);
        assertEq(shares, 50);
    }
}
