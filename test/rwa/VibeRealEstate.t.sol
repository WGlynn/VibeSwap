// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/rwa/VibeRealEstate.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeRealEstateTest is Test {
    // ============ State ============

    VibeRealEstate public estate;
    address public deployer;
    address public seller;
    address public buyerAddr;
    address public buyer2Addr;
    address public inspector;

    // ============ setUp ============

    function setUp() public {
        deployer = makeAddr("deployer");
        seller = makeAddr("seller");
        buyerAddr = makeAddr("buyer");
        buyer2Addr = makeAddr("buyer2");
        inspector = makeAddr("inspector");

        vm.startPrank(deployer);
        VibeRealEstate impl = new VibeRealEstate();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeRealEstate.initialize, ())
        );
        estate = VibeRealEstate(payable(address(proxy)));

        estate.addInspector(inspector);
        vm.stopPrank();

        vm.deal(seller, 100 ether);
        vm.deal(buyerAddr, 100 ether);
        vm.deal(buyer2Addr, 100 ether);
    }

    // ============ Helpers ============

    function _listProperty() internal returns (bytes32 propertyId) {
        vm.prank(seller);
        propertyId = estate.listProperty(
            VibeRealEstate.PropertyType.RESIDENTIAL,
            "123 Main Street",
            keccak256("deed-hash"),
            10 ether,       // asking price
            0,              // not fractionalized
            false,          // not rental
            0               // no monthly rent
        );
    }

    function _listFractionalProperty() internal returns (bytes32 propertyId) {
        vm.prank(seller);
        propertyId = estate.listProperty(
            VibeRealEstate.PropertyType.COMMERCIAL,
            "456 Business Ave",
            keccak256("commercial-deed"),
            100 ether,      // asking price
            1000,           // 1000 fractions
            true,           // rental property
            0.5 ether       // 0.5 ETH monthly rent
        );
    }

    function _makeAndAcceptOffer(bytes32 propertyId) internal returns (uint256 offerId) {
        uint256 offerAmount = 10 ether;
        uint256 earnest = (offerAmount * 300) / 10000; // 3% = 0.3 ETH

        vm.prank(buyerAddr);
        offerId = estate.makeOffer{value: earnest}(propertyId, offerAmount, 30);

        vm.prank(seller);
        estate.acceptOffer(offerId);
    }

    // ============ Property Listing Tests ============

    function test_ListProperty_SetsFields() public {
        bytes32 propertyId = _listProperty();

        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(prop.owner, seller);
        assertEq(uint8(prop.propertyType), uint8(VibeRealEstate.PropertyType.RESIDENTIAL));
        assertEq(prop.askingPrice, 10 ether);
        assertEq(prop.totalFractions, 0);
        assertEq(uint8(prop.status), uint8(VibeRealEstate.TransactionStatus.LISTED));
        assertFalse(prop.isRental);
    }

    function test_ListProperty_IncrementsCounters() public {
        _listProperty();
        assertEq(estate.totalProperties(), 1);
        assertEq(estate.getPropertyCount(), 1);
    }

    function test_ListProperty_FractionalRental() public {
        bytes32 propertyId = _listFractionalProperty();

        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(prop.totalFractions, 1000);
        assertTrue(prop.isRental);
        assertEq(prop.monthlyRentalIncome, 0.5 ether);
    }

    // ============ Offer Tests ============

    function test_MakeOffer_CreatesOffer() public {
        bytes32 propertyId = _listProperty();

        uint256 earnest = (10 ether * 300) / 10000; // 3%
        vm.prank(buyerAddr);
        uint256 offerId = estate.makeOffer{value: earnest}(propertyId, 10 ether, 30);

        assertEq(offerId, 1);
        assertEq(estate.offerCount(), 1);
    }

    function test_MakeOffer_RevertsNotListed() public {
        bytes32 propertyId = _listProperty();

        // Accept an offer to change status
        uint256 earnest = (10 ether * 300) / 10000;
        vm.prank(buyerAddr);
        uint256 offerId = estate.makeOffer{value: earnest}(propertyId, 10 ether, 30);

        vm.prank(seller);
        estate.acceptOffer(offerId);

        // Now property is UNDER_CONTRACT, new offers should fail
        vm.prank(buyer2Addr);
        vm.expectRevert("Not listed");
        estate.makeOffer{value: earnest}(propertyId, 10 ether, 30);
    }

    function test_MakeOffer_RevertsInsufficientEarnest() public {
        bytes32 propertyId = _listProperty();

        // 3% of 10 ETH = 0.3 ETH, send less
        vm.prank(buyerAddr);
        vm.expectRevert("Insufficient earnest deposit");
        estate.makeOffer{value: 0.1 ether}(propertyId, 10 ether, 30);
    }

    // ============ Offer Acceptance & Escrow Tests ============

    function test_AcceptOffer_CreatesEscrow() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(uint8(prop.status), uint8(VibeRealEstate.TransactionStatus.UNDER_CONTRACT));
    }

    function test_AcceptOffer_RevertsNonOwner() public {
        bytes32 propertyId = _listProperty();

        uint256 earnest = (10 ether * 300) / 10000;
        vm.prank(buyerAddr);
        uint256 offerId = estate.makeOffer{value: earnest}(propertyId, 10 ether, 30);

        vm.prank(buyerAddr); // Not the property owner
        vm.expectRevert("Not property owner");
        estate.acceptOffer(offerId);
    }

    function test_AcceptOffer_RevertsExpired() public {
        bytes32 propertyId = _listProperty();

        uint256 earnest = (10 ether * 300) / 10000;
        vm.prank(buyerAddr);
        uint256 offerId = estate.makeOffer{value: earnest}(propertyId, 10 ether, 30);

        vm.warp(block.timestamp + 31 days); // Offer expired

        vm.prank(seller);
        vm.expectRevert("Offer expired");
        estate.acceptOffer(offerId);
    }

    // ============ Escrow & Closing Tests ============

    function test_DepositToEscrow_IncreasesBalance() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        vm.prank(buyerAddr);
        estate.depositToEscrow{value: 5 ether}(propertyId);

        (, , , , , uint256 buyerDeposited, , , ) = estate.escrows(propertyId);
        // earnest (0.3) + 5 = 5.3
        uint256 earnest = (10 ether * 300) / 10000;
        assertEq(buyerDeposited, earnest + 5 ether);
    }

    function test_DepositToEscrow_RevertsNonBuyer() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        vm.prank(buyer2Addr);
        vm.expectRevert("Not buyer");
        estate.depositToEscrow{value: 5 ether}(propertyId);
    }

    function test_ApproveInspection_ByInspector() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        vm.prank(inspector);
        estate.approveInspection(propertyId, keccak256("inspection-report"));

        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(uint8(prop.status), uint8(VibeRealEstate.TransactionStatus.INSPECTION));
        assertTrue(prop.inspectionHash != bytes32(0));
    }

    function test_ApproveInspection_RevertsNonInspector() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        vm.prank(buyerAddr);
        vm.expectRevert("Not inspector");
        estate.approveInspection(propertyId, keccak256("report"));
    }

    function test_CloseSale_TransfersOwnership() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        // Deposit remaining funds (10 ETH total - 0.3 earnest = 9.7)
        uint256 remaining = 10 ether - (10 ether * 300) / 10000;
        vm.prank(buyerAddr);
        estate.depositToEscrow{value: remaining}(propertyId);

        // Inspection
        vm.prank(inspector);
        estate.approveInspection(propertyId, keccak256("pass"));

        // Close
        uint256 sellerBefore = seller.balance;
        vm.prank(buyerAddr);
        estate.closeSale(propertyId);

        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(prop.owner, buyerAddr);
        assertEq(uint8(prop.status), uint8(VibeRealEstate.TransactionStatus.COMPLETED));
        assertEq(seller.balance - sellerBefore, 10 ether);
        assertEq(estate.totalTransactionVolume(), 10 ether);
    }

    function test_CloseSale_RevertsWithoutInspection() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        uint256 remaining = 10 ether - (10 ether * 300) / 10000;
        vm.prank(buyerAddr);
        estate.depositToEscrow{value: remaining}(propertyId);

        vm.prank(buyerAddr);
        vm.expectRevert("Inspection not approved");
        estate.closeSale(propertyId);
    }

    function test_CloseSale_RevertsInsufficientFunds() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        // Don't deposit remaining — only earnest is there
        vm.prank(inspector);
        estate.approveInspection(propertyId, keccak256("pass"));

        vm.prank(buyerAddr);
        vm.expectRevert("Insufficient funds");
        estate.closeSale(propertyId);
    }

    function test_CloseSale_RevertsNonParty() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        uint256 remaining = 10 ether - (10 ether * 300) / 10000;
        vm.prank(buyerAddr);
        estate.depositToEscrow{value: remaining}(propertyId);

        vm.prank(inspector);
        estate.approveInspection(propertyId, keccak256("pass"));

        vm.prank(buyer2Addr); // Not buyer or seller
        vm.expectRevert("Not party");
        estate.closeSale(propertyId);
    }

    function test_CloseSale_RefundsExcess() public {
        bytes32 propertyId = _listProperty();
        _makeAndAcceptOffer(propertyId);

        // Over-deposit
        vm.prank(buyerAddr);
        estate.depositToEscrow{value: 15 ether}(propertyId);

        vm.prank(inspector);
        estate.approveInspection(propertyId, keccak256("pass"));

        uint256 buyerBefore = buyerAddr.balance;
        vm.prank(buyerAddr);
        estate.closeSale(propertyId);

        // Buyer should get back excess: 15 + 0.3 - 10 = 5.3 ETH
        uint256 earnest = (10 ether * 300) / 10000;
        uint256 expectedRefund = 15 ether + earnest - 10 ether;
        assertEq(buyerAddr.balance - buyerBefore, expectedRefund);
    }

    // ============ Fractional Ownership Tests ============

    function test_BuyFractions_Success() public {
        bytes32 propertyId = _listFractionalProperty();

        // Price per fraction: 100 ETH / 1000 = 0.1 ETH
        vm.prank(buyerAddr);
        estate.buyFractions{value: 10 ether}(propertyId, 100);

        assertEq(estate.getHolding(propertyId, buyerAddr), 100);

        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(prop.fractionsSold, 100);
    }

    function test_BuyFractions_RevertsNotFractionalized() public {
        bytes32 propertyId = _listProperty(); // totalFractions = 0

        vm.prank(buyerAddr);
        vm.expectRevert("Not fractionalized");
        estate.buyFractions{value: 1 ether}(propertyId, 10);
    }

    function test_BuyFractions_RevertsNotEnoughFractions() public {
        bytes32 propertyId = _listFractionalProperty();

        vm.prank(buyerAddr);
        vm.expectRevert("Not enough fractions");
        estate.buyFractions{value: 200 ether}(propertyId, 1001);
    }

    function test_BuyFractions_RevertsInsufficientPayment() public {
        bytes32 propertyId = _listFractionalProperty();

        vm.prank(buyerAddr);
        vm.expectRevert("Insufficient payment");
        estate.buyFractions{value: 0.01 ether}(propertyId, 100);
    }

    function test_BuyFractions_MultipleBuyers() public {
        bytes32 propertyId = _listFractionalProperty();

        vm.prank(buyerAddr);
        estate.buyFractions{value: 10 ether}(propertyId, 100);

        vm.prank(buyer2Addr);
        estate.buyFractions{value: 5 ether}(propertyId, 50);

        assertEq(estate.getHolding(propertyId, buyerAddr), 100);
        assertEq(estate.getHolding(propertyId, buyer2Addr), 50);

        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(prop.fractionsSold, 150);
    }

    // ============ Rental Income Tests ============

    function test_DepositRentalIncome_Success() public {
        bytes32 propertyId = _listFractionalProperty();

        vm.prank(seller);
        estate.depositRentalIncome{value: 0.5 ether}(propertyId);
    }

    function test_DepositRentalIncome_RevertsZero() public {
        bytes32 propertyId = _listFractionalProperty();

        vm.prank(seller);
        vm.expectRevert("Zero income");
        estate.depositRentalIncome{value: 0}(propertyId);
    }

    function test_DepositRentalIncome_RevertsNotRental() public {
        bytes32 propertyId = _listProperty(); // Not a rental

        vm.prank(seller);
        vm.expectRevert("Not rental");
        estate.depositRentalIncome{value: 0.5 ether}(propertyId);
    }

    function test_ClaimRental_Success() public {
        bytes32 propertyId = _listFractionalProperty();

        // Buy fractions
        vm.prank(buyerAddr);
        estate.buyFractions{value: 10 ether}(propertyId, 100);

        // Deposit rental income
        vm.prank(seller);
        estate.depositRentalIncome{value: 1 ether}(propertyId);

        uint256 currentMonth = block.timestamp / 30 days;
        uint256 buyerBefore = buyerAddr.balance;

        vm.prank(buyerAddr);
        estate.claimRental(propertyId, currentMonth);

        // Buyer has 100 out of 1000 fractions = 10%
        uint256 expectedShare = (1 ether * 100) / 1000;
        assertEq(buyerAddr.balance - buyerBefore, expectedShare);
    }

    function test_ClaimRental_RevertsNoFractions() public {
        bytes32 propertyId = _listFractionalProperty();

        vm.prank(seller);
        estate.depositRentalIncome{value: 1 ether}(propertyId);

        uint256 currentMonth = block.timestamp / 30 days;

        vm.prank(buyerAddr); // No fractions
        vm.expectRevert("No fractions");
        estate.claimRental(propertyId, currentMonth);
    }

    function test_ClaimRental_RevertsAlreadyClaimed() public {
        bytes32 propertyId = _listFractionalProperty();

        vm.prank(buyerAddr);
        estate.buyFractions{value: 10 ether}(propertyId, 100);

        vm.prank(seller);
        estate.depositRentalIncome{value: 1 ether}(propertyId);

        uint256 currentMonth = block.timestamp / 30 days;

        vm.prank(buyerAddr);
        estate.claimRental(propertyId, currentMonth);

        vm.prank(buyerAddr);
        vm.expectRevert("Already claimed");
        estate.claimRental(propertyId, currentMonth);
    }

    // ============ Appraisal Tests ============

    function test_SubmitAppraisal_Success() public {
        bytes32 propertyId = _listProperty();

        vm.prank(buyerAddr);
        estate.submitAppraisal{value: 0.1 ether}(propertyId, 12 ether, keccak256("report"));

        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(prop.appraisedValue, 12 ether);
        assertEq(prop.lastAppraisedAt, block.timestamp);
    }

    function test_SubmitAppraisal_RevertsNoStake() public {
        bytes32 propertyId = _listProperty();

        vm.prank(buyerAddr);
        vm.expectRevert("Stake required");
        estate.submitAppraisal{value: 0}(propertyId, 12 ether, keccak256("report"));
    }

    // ============ Admin Tests ============

    function test_Admin_AddRemoveInspector() public {
        address newInspector = makeAddr("newInspector");

        vm.prank(deployer);
        estate.addInspector(newInspector);
        assertTrue(estate.approvedInspectors(newInspector));

        vm.prank(deployer);
        estate.removeInspector(newInspector);
        assertFalse(estate.approvedInspectors(newInspector));
    }

    function test_Admin_OnlyOwner() public {
        vm.prank(buyerAddr);
        vm.expectRevert();
        estate.addInspector(buyerAddr);
    }

    // ============ Full Sale Lifecycle Test ============

    function test_FullSaleLifecycle() public {
        // 1. List property
        bytes32 propertyId = _listProperty();
        assertEq(estate.totalProperties(), 1);

        // 2. Make offer
        uint256 offerAmount = 10 ether;
        uint256 earnest = (offerAmount * 300) / 10000;
        vm.prank(buyerAddr);
        uint256 offerId = estate.makeOffer{value: earnest}(propertyId, offerAmount, 30);

        // 3. Accept offer (creates escrow)
        vm.prank(seller);
        estate.acceptOffer(offerId);

        // 4. Deposit remaining to escrow
        uint256 remaining = offerAmount - earnest;
        vm.prank(buyerAddr);
        estate.depositToEscrow{value: remaining}(propertyId);

        // 5. Inspection
        vm.prank(inspector);
        estate.approveInspection(propertyId, keccak256("all-clear"));

        // 6. Close sale
        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        estate.closeSale(propertyId);

        // 7. Verify outcomes
        VibeRealEstate.Property memory prop = estate.getProperty(propertyId);
        assertEq(prop.owner, buyerAddr);
        assertEq(uint8(prop.status), uint8(VibeRealEstate.TransactionStatus.COMPLETED));
        assertEq(seller.balance - sellerBefore, offerAmount);
        assertEq(estate.totalTransactionVolume(), offerAmount);
    }

    // ============ Fuzz Tests ============

    function testFuzz_BuyFractions_CorrectPayment(uint256 fractionCount) public {
        bytes32 propertyId = _listFractionalProperty();
        fractionCount = bound(fractionCount, 1, 1000);

        uint256 pricePerFraction = 100 ether / 1000; // 0.1 ETH
        uint256 totalCost = fractionCount * pricePerFraction;
        vm.deal(buyerAddr, totalCost + 1 ether);

        vm.prank(buyerAddr);
        estate.buyFractions{value: totalCost}(propertyId, fractionCount);

        assertEq(estate.getHolding(propertyId, buyerAddr), fractionCount);
    }

    function testFuzz_EarnestDeposit_Minimum(uint256 offerAmount) public {
        offerAmount = bound(offerAmount, 1 ether, 1000 ether);
        bytes32 propertyId = _listProperty();

        uint256 earnest = (offerAmount * 300) / 10000; // 3%
        vm.deal(buyerAddr, earnest + 1 ether);

        vm.prank(buyerAddr);
        uint256 offerId = estate.makeOffer{value: earnest}(propertyId, offerAmount, 30);
        assertGt(offerId, 0);
    }

    function testFuzz_RentalClaim_ProportionalToHoldings(uint256 fractionCount, uint256 rentalAmount) public {
        fractionCount = bound(fractionCount, 1, 1000);
        rentalAmount = bound(rentalAmount, 0.01 ether, 100 ether);

        bytes32 propertyId = _listFractionalProperty();

        uint256 pricePerFraction = 100 ether / 1000;
        uint256 totalCost = fractionCount * pricePerFraction;
        vm.deal(buyerAddr, totalCost + 1 ether);

        vm.prank(buyerAddr);
        estate.buyFractions{value: totalCost}(propertyId, fractionCount);

        vm.deal(seller, rentalAmount + 1 ether);
        vm.prank(seller);
        estate.depositRentalIncome{value: rentalAmount}(propertyId);

        uint256 currentMonth = block.timestamp / 30 days;
        uint256 buyerBefore = buyerAddr.balance;

        vm.prank(buyerAddr);
        estate.claimRental(propertyId, currentMonth);

        uint256 expectedShare = (rentalAmount * fractionCount) / 1000;
        assertEq(buyerAddr.balance - buyerBefore, expectedShare);
    }
}
