// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeNFTMarketplace.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock NFT ============

contract MockMktNFT is ERC721 {
    uint256 private _next;

    constructor() ERC721("MktNFT", "MKNFT") {}

    function mint(address to) external returns (uint256 id) {
        id = ++_next;
        _mint(to, id);
    }
}

// ============ Tests ============

contract VibeNFTMarketplaceTest is Test {
    VibeNFTMarketplace public mkt;
    MockMktNFT public nft;

    address public owner;
    address public seller;
    address public buyer;
    address public bidder2;
    address public creator; // royalty recipient

    uint256 public nftId;

    uint256 constant PRICE = 1 ether;
    uint256 constant ROYALTY_BPS = 500; // 5%
    uint256 constant DURATION = 1 days;

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        seller = makeAddr("seller");
        buyer = makeAddr("buyer");
        bidder2 = makeAddr("bidder2");
        creator = makeAddr("creator");

        nft = new MockMktNFT();

        // Deploy through UUPS proxy; initializer sets owner = msg.sender
        VibeNFTMarketplace impl = new VibeNFTMarketplace();
        bytes memory initData = abi.encodeWithSelector(VibeNFTMarketplace.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        mkt = VibeNFTMarketplace(payable(address(proxy)));

        // Mint NFT to seller, approve marketplace
        nftId = nft.mint(seller);
        vm.prank(seller);
        nft.approve(address(mkt), nftId);

        // Fund ETH accounts
        vm.deal(buyer, 100 ether);
        vm.deal(bidder2, 100 ether);
        vm.deal(seller, 10 ether);
    }

    // ============ Helpers ============

    function _createFixed(uint256 price) internal returns (uint256 id) {
        vm.prank(seller);
        mkt.createListing(
            address(nft), nftId,
            VibeNFTMarketplace.ListingType.FIXED,
            price, DURATION,
            ROYALTY_BPS, creator
        );
        id = mkt.listingCount() - 1;
    }

    function _createAuction(uint256 price) internal returns (uint256 id) {
        vm.prank(seller);
        mkt.createListing(
            address(nft), nftId,
            VibeNFTMarketplace.ListingType.AUCTION,
            price, DURATION,
            ROYALTY_BPS, creator
        );
        id = mkt.listingCount() - 1;
    }

    function _mintAndApprove(address to) internal returns (uint256 id) {
        id = nft.mint(to);
        vm.prank(to);
        nft.approve(address(mkt), id);
    }

    // ============ Initialize ============

    function test_initialize_setsProtocolFee() public view {
        assertEq(mkt.PROTOCOL_FEE_BPS(), 100); // 1%
    }

    // ============ createListing ============

    function test_createListing_escrwosNFT() public {
        _createFixed(PRICE);
        assertEq(nft.ownerOf(nftId), address(mkt));
    }

    function test_createListing_recordsMetadata() public {
        uint256 id = _createFixed(PRICE);
        VibeNFTMarketplace.Listing memory l = mkt.getListing(id);

        assertEq(l.seller, seller);
        assertEq(l.nftContract, address(nft));
        assertEq(l.tokenId, nftId);
        assertEq(l.price, PRICE);
        assertEq(l.royaltyBps, ROYALTY_BPS);
        assertEq(l.royaltyRecipient, creator);
        assertEq(uint8(l.status), uint8(VibeNFTMarketplace.ListingStatus.ACTIVE));
        assertEq(uint8(l.listingType), uint8(VibeNFTMarketplace.ListingType.FIXED));
    }

    function test_createListing_revertsZeroPrice() public {
        vm.prank(seller);
        vm.expectRevert("Zero price");
        mkt.createListing(address(nft), nftId, VibeNFTMarketplace.ListingType.FIXED, 0, DURATION, 0, address(0));
    }

    function test_createListing_revertsRoyaltyTooHigh() public {
        vm.prank(seller);
        vm.expectRevert("Max 10% royalty");
        mkt.createListing(address(nft), nftId, VibeNFTMarketplace.ListingType.FIXED, PRICE, DURATION, 1001, creator);
    }

    // ============ buy (fixed price) ============

    function test_buy_happyPath_royaltyDistribution() public {
        uint256 id = _createFixed(PRICE);

        uint256 sellerBefore = seller.balance;
        uint256 creatorBefore = creator.balance;

        vm.prank(buyer);
        mkt.buy{value: PRICE}(id);

        // NFT delivered to buyer
        assertEq(nft.ownerOf(nftId), buyer);

        // Listing marked sold
        VibeNFTMarketplace.Listing memory l = mkt.getListing(id);
        assertEq(uint8(l.status), uint8(VibeNFTMarketplace.ListingStatus.SOLD));

        // Protocol fee = 1% = 0.01 ether
        uint256 protocolFee = (PRICE * 100) / 10000;
        // Royalty = 5% = 0.05 ether
        uint256 royalty = (PRICE * ROYALTY_BPS) / 10000;
        // Seller = 1 - 0.01 - 0.05 = 0.94 ether
        uint256 sellerExpected = PRICE - protocolFee - royalty;

        assertEq(seller.balance - sellerBefore, sellerExpected, "seller payout wrong");
        assertEq(creator.balance - creatorBefore, royalty, "royalty payout wrong");
        assertEq(mkt.protocolFees(), protocolFee, "protocol fee accrual wrong");
    }

    function test_buy_revertsNotActive() public {
        uint256 id = _createFixed(PRICE);

        vm.prank(buyer);
        mkt.buy{value: PRICE}(id);

        vm.prank(bidder2);
        vm.expectRevert("Not active");
        mkt.buy{value: PRICE}(id);
    }

    function test_buy_revertsInsufficientPayment() public {
        uint256 id = _createFixed(PRICE);

        vm.prank(buyer);
        vm.expectRevert("Insufficient payment");
        mkt.buy{value: PRICE - 1}(id);
    }

    function test_buy_revertsWrongType() public {
        uint256 id = _createAuction(PRICE);

        vm.prank(buyer);
        vm.expectRevert("Not fixed price");
        mkt.buy{value: PRICE}(id);
    }

    // ============ placeBid (auction) ============

    function test_placeBid_setsHighestBid() public {
        uint256 id = _createAuction(PRICE);

        vm.prank(buyer);
        mkt.placeBid{value: 1.5 ether}(id);

        VibeNFTMarketplace.Listing memory l = mkt.getListing(id);
        assertEq(l.highestBid, 1.5 ether);
        assertEq(l.highestBidder, buyer);
    }

    function test_placeBid_refundsPreviousBidder() public {
        uint256 id = _createAuction(PRICE);

        vm.prank(buyer);
        mkt.placeBid{value: 1.5 ether}(id);

        uint256 buyerBefore = buyer.balance;
        vm.prank(bidder2);
        mkt.placeBid{value: 3 ether}(id);

        assertEq(buyer.balance - buyerBefore, 1.5 ether, "buyer not refunded");
    }

    function test_placeBid_recordsBidHistory() public {
        uint256 id = _createAuction(PRICE);

        vm.prank(buyer);
        mkt.placeBid{value: 1.5 ether}(id);

        vm.prank(bidder2);
        mkt.placeBid{value: 2 ether}(id);

        VibeNFTMarketplace.Bid[] memory bids = mkt.getBids(id);
        assertEq(bids.length, 2);
        assertEq(bids[0].bidder, buyer);
        assertEq(bids[1].bidder, bidder2);
    }

    function test_placeBid_revertsLowBid() public {
        uint256 id = _createAuction(PRICE);

        vm.prank(buyer);
        mkt.placeBid{value: 1.5 ether}(id);

        vm.prank(bidder2);
        vm.expectRevert("Bid too low");
        mkt.placeBid{value: 1 ether}(id);
    }

    function test_placeBid_revertsAfterEnd() public {
        uint256 id = _createAuction(PRICE);
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(buyer);
        vm.expectRevert("Auction ended");
        mkt.placeBid{value: 2 ether}(id);
    }

    // ============ settleAuction ============

    function test_settleAuction_successfulBid_royaltySplit() public {
        uint256 id = _createAuction(PRICE);

        vm.prank(buyer);
        mkt.placeBid{value: 2 ether}(id);

        vm.warp(block.timestamp + DURATION + 1);

        uint256 sellerBefore = seller.balance;
        uint256 creatorBefore = creator.balance;

        mkt.settleAuction(id);

        // NFT to buyer
        assertEq(nft.ownerOf(nftId), buyer);

        VibeNFTMarketplace.Listing memory l = mkt.getListing(id);
        assertEq(uint8(l.status), uint8(VibeNFTMarketplace.ListingStatus.SOLD));

        uint256 protocolFee = (2 ether * 100) / 10000;
        uint256 royalty = (2 ether * ROYALTY_BPS) / 10000;
        uint256 sellerExpected = 2 ether - protocolFee - royalty;

        assertEq(seller.balance - sellerBefore, sellerExpected, "seller");
        assertEq(creator.balance - creatorBefore, royalty, "creator royalty");
        assertEq(mkt.protocolFees(), protocolFee, "protocol fees");
    }

    function test_settleAuction_noBids_returnsNFTToSeller() public {
        uint256 id = _createAuction(PRICE);
        vm.warp(block.timestamp + DURATION + 1);

        mkt.settleAuction(id);

        // NFT returned to seller
        assertEq(nft.ownerOf(nftId), seller);

        VibeNFTMarketplace.Listing memory l = mkt.getListing(id);
        assertEq(uint8(l.status), uint8(VibeNFTMarketplace.ListingStatus.EXPIRED));
    }

    function test_settleAuction_bidBelowReserve_refundsAndExpires() public {
        uint256 id = _createAuction(2 ether); // reserve = 2 ETH

        // Place bid below reserve (price stores reserve as starting price, bid must exceed)
        // Actually the contract checks: highestBid >= l.price for settlement
        vm.prank(buyer);
        mkt.placeBid{value: 0.5 ether}(id); // below reserve

        vm.warp(block.timestamp + DURATION + 1);

        uint256 buyerBefore = buyer.balance;
        mkt.settleAuction(id);

        // NFT returned to seller (bid below reserve)
        assertEq(nft.ownerOf(nftId), seller, "NFT should return to seller");

        // Buyer refunded
        assertEq(buyer.balance - buyerBefore, 0.5 ether, "buyer not refunded");
    }

    function test_settleAuction_revertsBeforeEnd() public {
        uint256 id = _createAuction(PRICE);

        vm.prank(buyer);
        mkt.placeBid{value: 2 ether}(id);

        vm.expectRevert("Not ended");
        mkt.settleAuction(id);
    }

    // ============ cancelListing ============

    function test_cancelListing_returnsNFT() public {
        uint256 id = _createFixed(PRICE);

        vm.prank(seller);
        mkt.cancelListing(id);

        assertEq(nft.ownerOf(nftId), seller, "NFT not returned");

        VibeNFTMarketplace.Listing memory l = mkt.getListing(id);
        assertEq(uint8(l.status), uint8(VibeNFTMarketplace.ListingStatus.CANCELLED));
    }

    function test_cancelListing_revertsNotSeller() public {
        uint256 id = _createFixed(PRICE);

        vm.prank(buyer);
        vm.expectRevert("Not seller");
        mkt.cancelListing(id);
    }

    function test_cancelListing_revertsHasBids() public {
        uint256 id = _createAuction(PRICE);

        vm.prank(buyer);
        mkt.placeBid{value: 2 ether}(id);

        vm.prank(seller);
        vm.expectRevert("Has bids");
        mkt.cancelListing(id);
    }

    // ============ Collection Offers ============

    function test_createCollectionOffer_holdsETH() public {
        vm.prank(buyer);
        mkt.createCollectionOffer{value: 3 ether}(address(nft), 3, 1 days);

        VibeNFTMarketplace.CollectionOffer memory o = mkt.getOffer(0);
        assertEq(o.bidder, buyer);
        assertEq(o.nftContract, address(nft));
        assertEq(o.amount, 1 ether); // 3 ether / 3 quantity
        assertEq(o.quantity, 3);
        assertEq(o.filled, 0);
        assertTrue(o.active);
    }

    function test_acceptCollectionOffer_happyPath() public {
        // buyer creates offer for 2 NFTs at 1 ether each
        vm.prank(buyer);
        mkt.createCollectionOffer{value: 2 ether}(address(nft), 2, 1 days);

        uint256 offerId = 0;

        // seller accepts one
        uint256 sid = _mintAndApprove(seller);
        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        mkt.acceptCollectionOffer(offerId, sid);

        // NFT goes to buyer
        assertEq(nft.ownerOf(sid), buyer, "NFT not to buyer");

        // Seller gets 1 ether minus 1% fee
        uint256 fee = (1 ether * 100) / 10000;
        assertEq(seller.balance - sellerBefore, 1 ether - fee, "seller payout wrong");

        // Offer partially filled
        VibeNFTMarketplace.CollectionOffer memory o = mkt.getOffer(offerId);
        assertEq(o.filled, 1);
        assertTrue(o.active, "offer should still be active after partial fill");
    }

    function test_acceptCollectionOffer_fullyFilled_deactivates() public {
        vm.prank(buyer);
        mkt.createCollectionOffer{value: 1 ether}(address(nft), 1, 1 days);

        uint256 sid = _mintAndApprove(seller);
        vm.prank(seller);
        mkt.acceptCollectionOffer(0, sid);

        VibeNFTMarketplace.CollectionOffer memory o = mkt.getOffer(0);
        assertFalse(o.active, "offer should be deactivated when fully filled");
    }

    function test_acceptCollectionOffer_revertsExpired() public {
        vm.prank(buyer);
        mkt.createCollectionOffer{value: 1 ether}(address(nft), 1, 1 hours);

        vm.warp(block.timestamp + 2 hours);

        uint256 sid = _mintAndApprove(seller);
        vm.prank(seller);
        vm.expectRevert("Offer expired");
        mkt.acceptCollectionOffer(0, sid);
    }

    // ============ withdrawFees ============

    function test_withdrawFees_sendsFundsToOwner() public {
        // Generate some fees via a fixed price buy
        uint256 id = _createFixed(PRICE);
        vm.prank(buyer);
        mkt.buy{value: PRICE}(id);

        uint256 accrued = mkt.protocolFees();
        assertGt(accrued, 0, "should have fees");

        // owner is the test contract (msg.sender in initialize)
        uint256 ownerBefore = address(this).balance;
        mkt.withdrawFees();

        assertEq(address(this).balance - ownerBefore, accrued);
        assertEq(mkt.protocolFees(), 0);
    }

    function test_withdrawFees_revertsNonOwner() public {
        vm.prank(seller);
        vm.expectRevert();
        mkt.withdrawFees();
    }

    // ============ Fuzz ============

    function testFuzz_buy_royaltyNeverExceedsPrice(uint96 rawPrice, uint16 royaltyBps_) public {
        uint256 price = uint256(rawPrice) + 1;
        uint256 royaltyBps = bound(royaltyBps_, 0, 1000); // max 10%

        vm.deal(buyer, price + 1 ether);

        uint256 freshId = nft.mint(seller);
        vm.prank(seller);
        nft.approve(address(mkt), freshId);

        vm.prank(seller);
        mkt.createListing(
            address(nft), freshId,
            VibeNFTMarketplace.ListingType.FIXED,
            price, DURATION,
            royaltyBps, creator
        );

        uint256 listingId = mkt.listingCount() - 1;
        uint256 creatorBefore = creator.balance;
        uint256 sellerBefore = seller.balance;

        vm.prank(buyer);
        mkt.buy{value: price}(listingId);

        uint256 protocolFee = (price * 100) / 10000;
        uint256 royalty = (price * royaltyBps) / 10000;
        uint256 sellerGot = price - protocolFee - royalty;

        // Invariants: no double-spend, no underflow
        assertEq(creator.balance - creatorBefore, royalty, "royalty invariant");
        assertEq(seller.balance - sellerBefore, sellerGot, "seller invariant");
        assertLe(protocolFee + royalty, price, "protocol + royalty must not exceed price");
    }

    receive() external payable {}
}
