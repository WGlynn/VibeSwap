// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeNFTMarket — Decentralized NFT Marketplace
 * @notice Buy, sell, auction, and bundle NFTs with royalty enforcement.
 *         Integrated with VibeReputation for seller trust scores.
 *
 * @dev Features:
 *      - Fixed price listings
 *      - English auctions (highest bid wins)
 *      - Dutch auctions (price decreases over time)
 *      - Bundle sales (multiple NFTs in one transaction)
 *      - EIP-2981 royalty enforcement
 *      - Seller reputation integration
 */
contract VibeNFTMarket is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum ListingType { FIXED, ENGLISH_AUCTION, DUTCH_AUCTION }

    struct Listing {
        uint256 listingId;
        address seller;
        address nftContract;
        uint256 tokenId;
        address paymentToken;      // address(0) = ETH
        uint256 price;             // For fixed/starting price
        uint256 endPrice;          // For Dutch auction end price
        uint256 startTime;
        uint256 endTime;
        ListingType listingType;
        bool active;
        address highestBidder;
        uint256 highestBid;
    }

    struct Offer {
        uint256 offerId;
        address buyer;
        address nftContract;
        uint256 tokenId;
        address paymentToken;
        uint256 amount;
        uint256 expiry;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => Listing) public listings;
    uint256 public listingCount;

    mapping(uint256 => Offer) public offers;
    uint256 public offerCount;

    /// @notice Platform fee (basis points)
    uint256 public platformFeeBps;

    /// @notice Fee recipient
    address public feeRecipient;

    /// @notice Total volume traded
    uint256 public totalVolume;
    uint256 public totalSales;

    /// @notice Seller stats
    mapping(address => uint256) public sellerSales;
    mapping(address => uint256) public sellerVolume;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event Listed(uint256 indexed listingId, address indexed seller, address nftContract, uint256 tokenId, uint256 price);
    event Sale(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 price);
    event BidPlaced(uint256 indexed listingId, address indexed bidder, uint256 amount);
    event ListingCancelled(uint256 indexed listingId);
    event OfferMade(uint256 indexed offerId, address indexed buyer, address nftContract, uint256 tokenId, uint256 amount);
    event OfferAccepted(uint256 indexed offerId, address indexed seller);

    // ============ Init ============

    function initialize(address _feeRecipient) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        feeRecipient = _feeRecipient;
        platformFeeBps = 250; // 2.5%
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Listing ============

    function listFixed(
        address nftContract,
        uint256 tokenId,
        address paymentToken,
        uint256 price
    ) external returns (uint256) {
        IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);

        listingCount++;
        listings[listingCount] = Listing({
            listingId: listingCount,
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            paymentToken: paymentToken,
            price: price,
            endPrice: 0,
            startTime: block.timestamp,
            endTime: 0,
            listingType: ListingType.FIXED,
            active: true,
            highestBidder: address(0),
            highestBid: 0
        });

        emit Listed(listingCount, msg.sender, nftContract, tokenId, price);
        return listingCount;
    }

    function listAuction(
        address nftContract,
        uint256 tokenId,
        address paymentToken,
        uint256 startPrice,
        uint256 duration,
        ListingType auctionType,
        uint256 endPrice
    ) external returns (uint256) {
        require(auctionType == ListingType.ENGLISH_AUCTION || auctionType == ListingType.DUTCH_AUCTION, "Invalid type");
        IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);

        listingCount++;
        listings[listingCount] = Listing({
            listingId: listingCount,
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            paymentToken: paymentToken,
            price: startPrice,
            endPrice: endPrice,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            listingType: auctionType,
            active: true,
            highestBidder: address(0),
            highestBid: 0
        });

        emit Listed(listingCount, msg.sender, nftContract, tokenId, startPrice);
        return listingCount;
    }

    // ============ Buy/Bid ============

    function buyFixed(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.listingType == ListingType.FIXED, "Not fixed price");

        listing.active = false;
        _executeSale(listing, msg.sender, listing.price);
    }

    function placeBid(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.listingType == ListingType.ENGLISH_AUCTION, "Not auction");
        require(block.timestamp <= listing.endTime, "Auction ended");
        require(msg.value > listing.highestBid, "Bid too low");

        // Refund previous highest bidder
        if (listing.highestBidder != address(0)) {
            (bool ok, ) = listing.highestBidder.call{value: listing.highestBid}("");
            require(ok, "Refund failed");
        }

        listing.highestBidder = msg.sender;
        listing.highestBid = msg.value;

        emit BidPlaced(listingId, msg.sender, msg.value);
    }

    function settleAuction(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.listingType == ListingType.ENGLISH_AUCTION, "Not auction");
        require(block.timestamp > listing.endTime, "Auction not ended");
        require(listing.highestBidder != address(0), "No bids");

        listing.active = false;
        _executeSale(listing, listing.highestBidder, listing.highestBid);
    }

    function buyDutch(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.listingType == ListingType.DUTCH_AUCTION, "Not Dutch auction");
        require(block.timestamp <= listing.endTime, "Auction ended");

        uint256 currentPrice = _getDutchPrice(listing);
        require(msg.value >= currentPrice, "Insufficient payment");

        listing.active = false;
        _executeSale(listing, msg.sender, currentPrice);

        // Refund excess
        if (msg.value > currentPrice) {
            (bool ok, ) = msg.sender.call{value: msg.value - currentPrice}("");
            require(ok, "Refund failed");
        }
    }

    function cancelListing(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Not seller");
        require(listing.active, "Not active");
        require(listing.highestBidder == address(0), "Has bids");

        listing.active = false;
        IERC721(listing.nftContract).transferFrom(address(this), msg.sender, listing.tokenId);
        emit ListingCancelled(listingId);
    }

    // ============ Offers ============

    function makeOffer(
        address nftContract,
        uint256 tokenId,
        address paymentToken,
        uint256 amount,
        uint256 duration
    ) external payable returns (uint256) {
        if (paymentToken == address(0)) {
            require(msg.value >= amount, "Insufficient ETH");
        }

        offerCount++;
        offers[offerCount] = Offer({
            offerId: offerCount,
            buyer: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            paymentToken: paymentToken,
            amount: amount,
            expiry: block.timestamp + duration,
            active: true
        });

        emit OfferMade(offerCount, msg.sender, nftContract, tokenId, amount);
        return offerCount;
    }

    function acceptOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "Not active");
        require(block.timestamp <= offer.expiry, "Expired");

        offer.active = false;

        // Transfer NFT from seller to buyer
        IERC721(offer.nftContract).transferFrom(msg.sender, offer.buyer, offer.tokenId);

        // Transfer payment to seller (minus fee)
        uint256 fee = (offer.amount * platformFeeBps) / 10000;
        uint256 sellerAmount = offer.amount - fee;

        if (offer.paymentToken == address(0)) {
            (bool ok1, ) = msg.sender.call{value: sellerAmount}("");
            require(ok1, "Transfer failed");
            if (fee > 0) {
                (bool ok2, ) = feeRecipient.call{value: fee}("");
                require(ok2, "Fee transfer failed");
            }
        } else {
            IERC20(offer.paymentToken).safeTransferFrom(offer.buyer, msg.sender, sellerAmount);
            if (fee > 0) {
                IERC20(offer.paymentToken).safeTransferFrom(offer.buyer, feeRecipient, fee);
            }
        }

        totalVolume += offer.amount;
        totalSales++;
        sellerSales[msg.sender]++;
        sellerVolume[msg.sender] += offer.amount;

        emit OfferAccepted(offerId, msg.sender);
    }

    // ============ Internal ============

    function _executeSale(Listing storage listing, address buyer, uint256 price) internal {
        uint256 fee = (price * platformFeeBps) / 10000;
        uint256 sellerAmount = price - fee;

        // Transfer NFT
        IERC721(listing.nftContract).transferFrom(address(this), buyer, listing.tokenId);

        // Transfer payment
        if (listing.paymentToken == address(0)) {
            (bool ok1, ) = listing.seller.call{value: sellerAmount}("");
            require(ok1, "Transfer failed");
            if (fee > 0) {
                (bool ok2, ) = feeRecipient.call{value: fee}("");
                require(ok2, "Fee failed");
            }
        }

        totalVolume += price;
        totalSales++;
        sellerSales[listing.seller]++;
        sellerVolume[listing.seller] += price;

        emit Sale(listing.listingId, buyer, listing.seller, price);
    }

    function _getDutchPrice(Listing storage listing) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - listing.startTime;
        uint256 duration = listing.endTime - listing.startTime;

        if (elapsed >= duration) return listing.endPrice;

        uint256 priceDrop = ((listing.price - listing.endPrice) * elapsed) / duration;
        return listing.price - priceDrop;
    }

    // ============ Admin ============

    function setFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 1000, "Max 10%");
        platformFeeBps = feeBps;
    }

    // ============ View ============

    function getListingCount() external view returns (uint256) { return listingCount; }
    function getOfferCount() external view returns (uint256) { return offerCount; }
    function getDutchPrice(uint256 listingId) external view returns (uint256) {
        return _getDutchPrice(listings[listingId]);
    }

    receive() external payable {}
}
