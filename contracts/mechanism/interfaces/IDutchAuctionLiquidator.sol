// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDutchAuctionLiquidator
 * @notice Interface for Dutch auction liquidation of undercollateralized positions
 * @dev Descending-price auctions replace instant seizure, enabling fair price discovery.
 *      Cooperative Capitalism: liquidation surplus flows back to position owners,
 *      not extracted by MEV bots.
 */
interface IDutchAuctionLiquidator {
    // ============ Enums ============

    enum AuctionState {
        NONE,
        ACTIVE,
        COMPLETED,
        EXPIRED
    }

    // ============ Structs ============

    struct LiquidationAuction {
        address collateralToken;
        uint256 collateralAmount;
        address debtToken;
        uint256 debtAmount;
        uint256 startPrice;
        uint256 endPrice;
        uint64 startTime;
        uint64 duration;
        AuctionState state;
        address creator;
        address positionOwner;
        address winner;
        uint256 winningBid;
    }

    // ============ Events ============

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed collateralToken,
        address indexed debtToken,
        uint256 collateralAmount,
        uint256 debtAmount,
        uint256 startPrice,
        uint256 endPrice
    );

    event AuctionBid(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 price,
        uint256 surplus
    );

    event AuctionExpiredSettled(
        uint256 indexed auctionId,
        uint256 collateralToTreasury
    );

    event AuthorizedCreatorAdded(address indexed creator);
    event AuthorizedCreatorRemoved(address indexed creator);
    event DefaultDurationUpdated(uint64 oldDuration, uint64 newDuration);
    event StartPremiumUpdated(uint256 oldBps, uint256 newBps);
    event EndDiscountUpdated(uint256 oldBps, uint256 newBps);
    event SurplusShareUpdated(uint256 oldBps, uint256 newBps);

    // ============ Errors ============

    error AuctionNotFound();
    error AuctionNotActive();
    error AuctionStillActive();
    error NotAuthorizedCreator();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidDuration();

    // ============ Core Functions ============

    function createAuction(
        address collateralToken,
        uint256 collateralAmount,
        address debtToken,
        uint256 debtAmount,
        address positionOwner
    ) external returns (uint256 auctionId);

    function bid(uint256 auctionId) external;

    function settleExpired(uint256 auctionId) external;

    // ============ View Functions ============

    function currentPrice(uint256 auctionId) external view returns (uint256);

    function getAuction(uint256 auctionId) external view returns (LiquidationAuction memory);

    function auctionCount() external view returns (uint256);
}
