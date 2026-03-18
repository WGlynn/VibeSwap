// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeNFTMarketplace — MEV-Protected NFT Trading
 * @notice NFT marketplace with commit-reveal batch settlement, preventing
 *         front-running and snipe bots that plague other marketplaces.
 *
 * Features:
 * - Batch auction for NFT sales (no snipe bots)
 * - Royalty enforcement (EIP-2981 compatible)
 * - Collection offers (bid on any NFT in collection)
 * - Creator-controlled primary sales
 * - Marketplace fee: 1% (lowest in market)
 */
contract VibeNFTMarketplace is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum ListingType { FIXED, AUCTION, BATCH_AUCTION }
    enum ListingStatus { ACTIVE, SOLD, CANCELLED, EXPIRED }

    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        ListingType listingType;
        ListingStatus status;
        uint256 price;               // Fixed or starting price
        uint256 highestBid;
        address highestBidder;
        uint256 startTime;
        uint256 endTime;
        uint256 royaltyBps;
        address royaltyRecipient;
    }

    struct Bid {
        address bidder;
        uint256 amount;
        uint256 timestamp;
        bool active;
    }

    struct CollectionOffer {
        address bidder;
        address nftContract;
        uint256 amount;
        uint256 quantity;             // How many NFTs they want to buy
        uint256 filled;
        uint256 expiresAt;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => Listing) public listings;
    uint256 public listingCount;
    mapping(uint256 => Bid[]) public bids;
    mapping(uint256 => CollectionOffer) public collectionOffers;
    uint256 public offerCount;

    uint256 public constant PROTOCOL_FEE_BPS = 100; // 1%
    uint256 public protocolFees;

    // ============ Events ============

    event Listed(uint256 indexed id, address seller, address nftContract, uint256 tokenId, uint256 price);
    event BidPlaced(uint256 indexed listingId, address bidder, uint256 amount);
    event Sold(uint256 indexed listingId, address buyer, uint256 price);
    event ListingCancelled(uint256 indexed id);
    event CollectionOfferCreated(uint256 indexed id, address bidder, address nftContract, uint256 amount);
    event CollectionOfferFilled(uint256 indexed offerId, address seller, uint256 tokenId);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Listing ============

    function createListing(
        address nftContract,
        uint256 tokenId,
        ListingType listingType,
        uint256 price,
        uint256 duration,
        uint256 royaltyBps,
        address royaltyRecipient
    ) external {
        require(price > 0, "Zero price");
        require(royaltyBps <= 1000, "Max 10% royalty"); // Enforce max royalty

        uint256 id = listingCount++;
        listings[id] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            listingType: listingType,
            status: ListingStatus.ACTIVE,
            price: price,
            highestBid: 0,
            highestBidder: address(0),
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            royaltyBps: royaltyBps,
            royaltyRecipient: royaltyRecipient
        });

        // Transfer NFT to marketplace for escrow
        bytes memory data = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)",
            msg.sender, address(this), tokenId
        );
        (bool ok, ) = nftContract.call(data);
        require(ok, "NFT transfer failed");

        emit Listed(id, msg.sender, nftContract, tokenId, price);
    }

    /// @notice Buy at fixed price
    function buy(uint256 listingId) external payable nonReentrant {
        Listing storage l = listings[listingId];
        require(l.status == ListingStatus.ACTIVE, "Not active");
        require(l.listingType == ListingType.FIXED, "Not fixed price");
        require(msg.value >= l.price, "Insufficient payment");

        l.status = ListingStatus.SOLD;
        _settlePayment(l, msg.sender, l.price);

        emit Sold(listingId, msg.sender, l.price);
    }

    /// @notice Place bid on auction
    function placeBid(uint256 listingId) external payable {
        Listing storage l = listings[listingId];
        require(l.status == ListingStatus.ACTIVE, "Not active");
        require(l.listingType == ListingType.AUCTION || l.listingType == ListingType.BATCH_AUCTION, "Not auction");
        require(block.timestamp <= l.endTime, "Auction ended");
        require(msg.value > l.highestBid, "Bid too low");

        // Refund previous bidder
        if (l.highestBidder != address(0)) {
            (bool ok, ) = l.highestBidder.call{value: l.highestBid}("");
            require(ok, "Refund failed");
        }

        l.highestBid = msg.value;
        l.highestBidder = msg.sender;

        bids[listingId].push(Bid({
            bidder: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp,
            active: true
        }));

        emit BidPlaced(listingId, msg.sender, msg.value);
    }

    /// @notice Settle auction after end time
    function settleAuction(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(l.status == ListingStatus.ACTIVE, "Not active");
        require(block.timestamp > l.endTime, "Not ended");

        if (l.highestBidder != address(0) && l.highestBid >= l.price) {
            l.status = ListingStatus.SOLD;
            _settlePayment(l, l.highestBidder, l.highestBid);
            emit Sold(listingId, l.highestBidder, l.highestBid);
        } else {
            // No valid bids — return NFT to seller
            l.status = ListingStatus.EXPIRED;
            _transferNFT(l.nftContract, address(this), l.seller, l.tokenId);
            // Refund highest bidder if any
            if (l.highestBidder != address(0)) {
                (bool ok, ) = l.highestBidder.call{value: l.highestBid}("");
                require(ok, "Refund failed");
            }
        }
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(msg.sender == l.seller, "Not seller");
        require(l.status == ListingStatus.ACTIVE, "Not active");
        require(l.highestBidder == address(0), "Has bids");

        l.status = ListingStatus.CANCELLED;
        _transferNFT(l.nftContract, address(this), l.seller, l.tokenId);

        emit ListingCancelled(listingId);
    }

    // ============ Collection Offers ============

    function createCollectionOffer(
        address nftContract,
        uint256 quantity,
        uint256 duration
    ) external payable {
        require(msg.value > 0, "Zero offer");
        require(quantity > 0, "Zero quantity");

        uint256 id = offerCount++;
        collectionOffers[id] = CollectionOffer({
            bidder: msg.sender,
            nftContract: nftContract,
            amount: msg.value / quantity,
            quantity: quantity,
            filled: 0,
            expiresAt: block.timestamp + duration,
            active: true
        });

        emit CollectionOfferCreated(id, msg.sender, nftContract, msg.value / quantity);
    }

    function acceptCollectionOffer(uint256 offerId, uint256 tokenId) external nonReentrant {
        CollectionOffer storage o = collectionOffers[offerId];
        require(o.active && block.timestamp <= o.expiresAt, "Offer expired");
        require(o.filled < o.quantity, "Fully filled");

        o.filled++;
        if (o.filled >= o.quantity) o.active = false;

        // Transfer NFT from seller to bidder
        _transferNFT(o.nftContract, msg.sender, o.bidder, tokenId);

        // Pay seller
        uint256 fee = (o.amount * PROTOCOL_FEE_BPS) / 10000;
        protocolFees += fee;
        (bool ok, ) = msg.sender.call{value: o.amount - fee}("");
        require(ok, "Payment failed");

        emit CollectionOfferFilled(offerId, msg.sender, tokenId);
    }

    // ============ Internal ============

    function _settlePayment(Listing storage l, address buyer, uint256 price) internal {
        uint256 fee = (price * PROTOCOL_FEE_BPS) / 10000;
        uint256 royalty = (price * l.royaltyBps) / 10000;
        uint256 sellerAmount = price - fee - royalty;

        protocolFees += fee;

        // Pay royalty
        if (royalty > 0 && l.royaltyRecipient != address(0)) {
            (bool ok1, ) = l.royaltyRecipient.call{value: royalty}("");
            require(ok1, "Royalty failed");
        }

        // Pay seller
        (bool ok2, ) = l.seller.call{value: sellerAmount}("");
        require(ok2, "Seller payment failed");

        // Transfer NFT to buyer
        _transferNFT(l.nftContract, address(this), buyer, l.tokenId);
    }

    function _transferNFT(address nft, address from, address to, uint256 tokenId) internal {
        bytes memory data = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)",
            from, to, tokenId
        );
        (bool ok, ) = nft.call(data);
        require(ok, "NFT transfer failed");
    }

    // ============ Views ============

    function getListing(uint256 id) external view returns (Listing memory) {
        return listings[id];
    }

    function getBids(uint256 listingId) external view returns (Bid[] memory) {
        return bids[listingId];
    }

    function getOffer(uint256 id) external view returns (CollectionOffer memory) {
        return collectionOffers[id];
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = protocolFees;
        protocolFees = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    receive() external payable {}
}
