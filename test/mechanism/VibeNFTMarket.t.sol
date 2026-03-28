// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeNFTMarket.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockNFT is ERC721 {
    uint256 private _next;

    constructor() ERC721("MockNFT", "MNFT") {}

    function mint(address to) external returns (uint256 id) {
        id = ++_next;
        _mint(to, id);
    }
}

contract MockERC20 is ERC20 {
    constructor() ERC20("MockToken", "MTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Tests ============

contract VibeNFTMarketTest is Test {
    VibeNFTMarket public market;
    MockNFT public nft;
    MockERC20 public token;

    address public owner;
    address public feeRecipient;
    address public seller;
    address public buyer;
    address public bidder2;

    uint256 public nftId;

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        feeRecipient = makeAddr("feeRecipient");
        seller = makeAddr("seller");
        buyer = makeAddr("buyer");
        bidder2 = makeAddr("bidder2");

        nft = new MockNFT();
        token = new MockERC20();

        // Deploy through UUPS proxy
        VibeNFTMarket impl = new VibeNFTMarket();
        bytes memory initData = abi.encodeWithSelector(
            VibeNFTMarket.initialize.selector,
            feeRecipient
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        market = VibeNFTMarket(payable(address(proxy)));

        // Mint NFT to seller
        nftId = nft.mint(seller);
        vm.prank(seller);
        nft.approve(address(market), nftId);

        // Fund buyer
        vm.deal(buyer, 100 ether);
        vm.deal(bidder2, 100 ether);

        // ERC20 funding
        token.mint(buyer, 1000 ether);
        vm.prank(buyer);
        token.approve(address(market), type(uint256).max);
    }

    // ============ Helpers ============

    function _listFixed(uint256 price) internal returns (uint256 listingId) {
        vm.prank(seller);
        listingId = market.listFixed(address(nft), nftId, address(0), price);
    }

    function _listEnglishAuction(uint256 startPrice, uint256 duration) internal returns (uint256) {
        vm.prank(seller);
        return market.listAuction(
            address(nft), nftId, address(0),
            startPrice, duration,
            VibeNFTMarket.ListingType.ENGLISH_AUCTION,
            0
        );
    }

    function _listDutchAuction(uint256 startPrice, uint256 endPrice, uint256 duration) internal returns (uint256) {
        vm.prank(seller);
        return market.listAuction(
            address(nft), nftId, address(0),
            startPrice, duration,
            VibeNFTMarket.ListingType.DUTCH_AUCTION,
            endPrice
        );
    }

    // ============ Initialization ============

    function test_initialize_setsDefaults() public view {
        assertEq(market.feeRecipient(), feeRecipient);
        assertEq(market.platformFeeBps(), 250);
    }

    // ============ Fixed Price Listing ============

    function test_listFixed_transfersNFTToMarket() public {
        _listFixed(1 ether);
        assertEq(nft.ownerOf(nftId), address(market));
    }

    function test_listFixed_recordsListing() public {
        uint256 id = _listFixed(1 ether);
        assertEq(id, 1);
        assertEq(market.getListingCount(), 1);

        VibeNFTMarket.Listing memory lst = market.getListing(id);
        assertEq(lst.listingId, 1);
        assertEq(lst.seller, seller);
        assertEq(lst.nftContract, address(nft));
        assertEq(lst.tokenId, nftId);
        assertEq(lst.price, 1 ether);
        assertEq(uint8(lst.listingType), uint8(VibeNFTMarket.ListingType.FIXED));
        assertTrue(lst.active);
    }

    // ============ Buy Fixed ============

    function test_buyFixed_happyPath() public {
        _listFixed(1 ether);

        uint256 sellerBefore = seller.balance;
        uint256 feeBefore = feeRecipient.balance;

        vm.prank(buyer);
        market.buyFixed{value: 1 ether}(1);

        // NFT delivered to buyer
        assertEq(nft.ownerOf(nftId), buyer);

        // Fee = 2.5% of 1 ether = 0.025 ether
        uint256 expectedFee = (1 ether * 250) / 10000;
        uint256 expectedSeller = 1 ether - expectedFee;

        assertEq(feeRecipient.balance - feeBefore, expectedFee);
        assertEq(seller.balance - sellerBefore, expectedSeller);
    }

    function test_buyFixed_marksListingInactive() public {
        _listFixed(1 ether);
        vm.prank(buyer);
        market.buyFixed{value: 1 ether}(1);

        assertFalse(market.getListing(1).active);
    }

    function test_buyFixed_revertsWhenNotActive() public {
        _listFixed(1 ether);
        vm.prank(buyer);
        market.buyFixed{value: 1 ether}(1);

        vm.prank(bidder2);
        vm.expectRevert("Not active");
        market.buyFixed{value: 1 ether}(1);
    }

    function test_buyFixed_revertsWrongType() public {
        _listEnglishAuction(1 ether, 1 hours);

        vm.prank(buyer);
        vm.expectRevert("Not fixed price");
        market.buyFixed{value: 2 ether}(1);
    }

    function test_buyFixed_updatesStats() public {
        _listFixed(1 ether);
        vm.prank(buyer);
        market.buyFixed{value: 1 ether}(1);

        assertEq(market.totalVolume(), 1 ether);
        assertEq(market.totalSales(), 1);
        assertEq(market.sellerSales(seller), 1);
        assertEq(market.sellerVolume(seller), 1 ether);
    }

    // ============ English Auction ============

    function test_placeBid_happyPath() public {
        uint256 id = _listEnglishAuction(0.5 ether, 1 hours);

        vm.prank(buyer);
        market.placeBid{value: 1 ether}(id);

        assertEq(market.getListing(id).highestBidder, buyer);
        assertEq(market.getListing(id).highestBid, 1 ether);
    }

    function test_placeBid_refundsPreviousBidder() public {
        uint256 id = _listEnglishAuction(0.5 ether, 1 hours);

        vm.prank(buyer);
        market.placeBid{value: 1 ether}(id);

        uint256 buyerBefore = buyer.balance;
        vm.prank(bidder2);
        market.placeBid{value: 2 ether}(id);

        // buyer gets full refund
        assertEq(buyer.balance - buyerBefore, 1 ether);
    }

    function test_placeBid_revertsLowBid() public {
        uint256 id = _listEnglishAuction(0.5 ether, 1 hours);

        vm.prank(buyer);
        market.placeBid{value: 1 ether}(id);

        vm.prank(bidder2);
        vm.expectRevert("Bid too low");
        market.placeBid{value: 0.5 ether}(id);
    }

    function test_placeBid_revertsAfterEndTime() public {
        uint256 id = _listEnglishAuction(0.5 ether, 1 hours);
        vm.warp(block.timestamp + 2 hours);

        vm.prank(buyer);
        vm.expectRevert("Auction ended");
        market.placeBid{value: 1 ether}(id);
    }

    function test_settleAuction_happyPath() public {
        uint256 id = _listEnglishAuction(0.5 ether, 1 hours);

        vm.prank(buyer);
        market.placeBid{value: 1 ether}(id);

        vm.warp(block.timestamp + 2 hours);

        uint256 sellerBefore = seller.balance;
        market.settleAuction(id);

        // NFT goes to buyer
        assertEq(nft.ownerOf(nftId), buyer);

        // Seller receives proceeds minus fee
        uint256 fee = (1 ether * 250) / 10000;
        assertEq(seller.balance - sellerBefore, 1 ether - fee);
    }

    function test_settleAuction_revertsBeforeEnd() public {
        uint256 id = _listEnglishAuction(0.5 ether, 1 hours);
        vm.prank(buyer);
        market.placeBid{value: 1 ether}(id);

        vm.expectRevert("Auction not ended");
        market.settleAuction(id);
    }

    function test_settleAuction_revertsNoBids() public {
        uint256 id = _listEnglishAuction(0.5 ether, 1 hours);
        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert("No bids");
        market.settleAuction(id);
    }

    // ============ Dutch Auction ============

    function test_getDutchPrice_startsAtStartPrice() public {
        uint256 id = _listDutchAuction(2 ether, 0.5 ether, 1 hours);
        assertEq(market.getDutchPrice(id), 2 ether);
    }

    function test_getDutchPrice_descendsLinearly() public {
        uint256 id = _listDutchAuction(2 ether, 0.5 ether, 1 hours);

        vm.warp(block.timestamp + 30 minutes); // halfway
        uint256 midPrice = market.getDutchPrice(id);

        // midpoint = 2 - (2 - 0.5) * 0.5 = 2 - 0.75 = 1.25 ether
        assertEq(midPrice, 1.25 ether);
    }

    function test_getDutchPrice_flatsAtEndPrice() public {
        uint256 id = _listDutchAuction(2 ether, 0.5 ether, 1 hours);
        vm.warp(block.timestamp + 2 hours);
        assertEq(market.getDutchPrice(id), 0.5 ether);
    }

    function test_buyDutch_happyPath() public {
        uint256 id = _listDutchAuction(2 ether, 0.5 ether, 1 hours);

        vm.warp(block.timestamp + 30 minutes);
        uint256 price = market.getDutchPrice(id); // 1.25 ether

        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        market.buyDutch{value: 2 ether}(id); // overpay to ensure acceptance

        // NFT delivered
        assertEq(nft.ownerOf(nftId), buyer);

        // Excess refunded: paid 2 ether, price was 1.25 ether
        uint256 refund = 2 ether - price;
        assertApproxEqAbs(buyer.balance, buyerBefore - price, 10);
        assertGe(buyer.balance, buyerBefore - 2 ether + refund - 10);
    }

    function test_buyDutch_revertsInsufficientPayment() public {
        uint256 id = _listDutchAuction(2 ether, 0.5 ether, 1 hours);

        vm.prank(buyer);
        vm.expectRevert("Insufficient payment");
        market.buyDutch{value: 0.1 ether}(id);
    }

    function test_buyDutch_revertsAfterEnd() public {
        uint256 id = _listDutchAuction(2 ether, 0.5 ether, 1 hours);
        vm.warp(block.timestamp + 2 hours);

        vm.prank(buyer);
        vm.expectRevert("Auction ended");
        market.buyDutch{value: 1 ether}(id);
    }

    // ============ Cancel Listing ============

    function test_cancelListing_returnsNFT() public {
        _listFixed(1 ether);
        vm.prank(seller);
        market.cancelListing(1);

        assertEq(nft.ownerOf(nftId), seller);
        assertFalse(market.getListing(1).active);
    }

    function test_cancelListing_revertsNotSeller() public {
        _listFixed(1 ether);

        vm.prank(buyer);
        vm.expectRevert("Not seller");
        market.cancelListing(1);
    }

    function test_cancelListing_revertsWithBids() public {
        uint256 id = _listEnglishAuction(0.5 ether, 1 hours);

        vm.prank(buyer);
        market.placeBid{value: 1 ether}(id);

        vm.prank(seller);
        vm.expectRevert("Has bids");
        market.cancelListing(id);
    }

    // ============ Offers ============

    function test_makeOffer_ETH_holdsFunds() public {
        uint256 id;
        vm.prank(buyer);
        id = market.makeOffer{value: 1 ether}(address(nft), nftId, address(0), 1 ether, 1 days);

        assertEq(id, 1);
        assertEq(address(market).balance, 1 ether);
    }

    function test_acceptOffer_transfersNFTandFunds() public {
        // List first to have seller hold the NFT
        _listFixed(5 ether); // seller puts NFT in market

        // buyer makes offer
        vm.prank(buyer);
        uint256 offerId = market.makeOffer{value: 1 ether}(address(nft), nftId, address(0), 1 ether, 1 days);

        // seller accepts — they must pull NFT back first via cancel
        // Instead test acceptOffer when seller holds NFT directly
        uint256 nftId2 = nft.mint(seller);
        vm.prank(seller);
        nft.approve(address(market), nftId2);

        vm.prank(buyer);
        uint256 offerId2 = market.makeOffer{value: 2 ether}(address(nft), nftId2, address(0), 2 ether, 1 days);

        uint256 sellerBefore = seller.balance;
        uint256 feeBefore = feeRecipient.balance;

        vm.prank(seller);
        market.acceptOffer(offerId2);

        // NFT goes to buyer
        assertEq(nft.ownerOf(nftId2), buyer);

        // Seller gets offer minus fee
        uint256 fee = (2 ether * 250) / 10000;
        assertEq(seller.balance - sellerBefore, 2 ether - fee);
        assertEq(feeRecipient.balance - feeBefore, fee);
    }

    function test_acceptOffer_revertsExpired() public {
        uint256 nftId2 = nft.mint(seller);
        vm.prank(seller);
        nft.approve(address(market), nftId2);

        vm.prank(buyer);
        uint256 offerId = market.makeOffer{value: 1 ether}(address(nft), nftId2, address(0), 1 ether, 1 hours);

        vm.warp(block.timestamp + 2 hours);

        vm.prank(seller);
        vm.expectRevert("Expired");
        market.acceptOffer(offerId);
    }

    // ============ Fee Admin ============

    function test_setFee_updatesValue() public {
        // Test contract deployed the proxy so it IS the owner
        market.setFee(100);
        assertEq(market.platformFeeBps(), 100);
    }

    function test_setFee_revertsAboveMax() public {
        vm.expectRevert("Max 10%");
        market.setFee(1001);
    }

    function test_setFee_revertsNonOwner() public {
        vm.prank(seller);
        vm.expectRevert();
        market.setFee(100);
    }

    // ============ Fuzz ============

    function testFuzz_buyFixed_feeAccounting(uint96 rawPrice) public {
        // price must be > 0, and pay enough ETH
        uint256 price = uint256(rawPrice) + 1;
        vm.deal(buyer, price + 1 ether);

        uint256 freshId = nft.mint(seller);
        vm.prank(seller);
        nft.approve(address(market), freshId);

        vm.prank(seller);
        uint256 listId = market.listFixed(address(nft), freshId, address(0), price);

        uint256 sellerBefore = seller.balance;
        uint256 feeBefore = feeRecipient.balance;

        vm.prank(buyer);
        market.buyFixed{value: price}(listId);

        uint256 fee = (price * 250) / 10000;
        assertEq(feeRecipient.balance - feeBefore, fee, "fee mismatch");
        assertEq(seller.balance - sellerBefore, price - fee, "seller payout mismatch");
    }

    function testFuzz_dutchPrice_bounded(uint256 elapsed) public {
        uint256 duration = 1 hours;
        elapsed = bound(elapsed, 0, duration * 2);

        uint256 id = _listDutchAuction(2 ether, 0.5 ether, duration);
        vm.warp(block.timestamp + elapsed);

        uint256 p = market.getDutchPrice(id);
        assertGe(p, 0.5 ether, "price below floor");
        assertLe(p, 2 ether, "price above ceiling");
    }
}
