// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeBonds
 * @notice Interface for ERC-1155 semi-fungible bond market with Dutch-auction
 *         yield discovery, Synthetix-style coupon distribution, and JUL integration.
 *         Part of the VSOS (VibeSwap Operating System) financial primitives.
 */
interface IVibeBonds {
    // ============ Enums ============

    enum BondState {
        AUCTION,    // Dutch auction phase — buyers bid at decreasing rates
        ACTIVE,     // Auction settled — coupons being distributed
        MATURED,    // Past maturity — principal redeemable
        REDEEMED,   // All bonds burned — series complete
        DEFAULTED   // Emergency — treasury failed to fund
    }

    // ============ Structs ============

    /// @notice Bond series data — each series is a distinct ERC-1155 token ID
    struct BondSeries {
        // Slot 0
        address token;                      // 20 bytes — denomination ERC-20
        BondState state;                    // 1 byte
        uint16 maxCouponRate;               // 2 bytes — Dutch auction ceiling (BPS)
        uint16 minCouponRate;               // 2 bytes — Dutch auction floor (BPS)
        uint16 earlyRedemptionPenaltyBps;   // 2 bytes — max early exit penalty
        uint16 couponsDistributed;          // 2 bytes — periods paid out
        // 3 bytes free

        // Slot 1
        address treasury;                   // 20 bytes — where principal goes
        uint40 auctionStart;                // 5 bytes
        uint40 auctionEnd;                  // 5 bytes
        // 2 bytes free

        // Slot 2
        uint40 maturity;                    // 5 bytes
        uint32 couponInterval;              // 4 bytes — seconds between distributions
        // 23 bytes free

        // Full slots
        uint256 maxPrincipal;               // Slot 3 — max raise
        uint256 totalPrincipal;             // Slot 4 — amount raised
        uint256 couponReserve;              // Slot 5 — locked coupon funds
        uint256 principalReserve;           // Slot 6 — locked redemption funds
        uint256 couponRate;                 // Slot 7 — clearing rate (BPS)
        uint256 rewardPerTokenStored;       // Slot 8 — Synthetix accumulator
        uint256 totalRedeemed;              // Slot 9 — principal already redeemed
    }

    struct CreateSeriesParams {
        address token;
        address treasury;
        uint256 maxPrincipal;
        uint16  maxCouponRate;
        uint16  minCouponRate;
        uint40  auctionDuration;
        uint40  maturity;           // absolute timestamp
        uint32  couponInterval;
        uint16  earlyRedemptionPenaltyBps;
    }

    // ============ Events ============

    event SeriesCreated(
        uint256 indexed seriesId,
        address indexed token,
        address indexed treasury,
        uint256 maxPrincipal
    );
    event BondPurchased(
        uint256 indexed seriesId,
        address indexed buyer,
        uint256 amount,
        uint256 rateSnapshot
    );
    event AuctionSettled(
        uint256 indexed seriesId,
        uint256 clearingRate,
        uint256 totalRaised
    );
    event CouponDistributed(
        uint256 indexed seriesId,
        uint256 couponAmount,
        address indexed keeper
    );
    event CouponClaimed(
        uint256 indexed seriesId,
        address indexed holder,
        uint256 amount
    );
    event BondRedeemed(
        uint256 indexed seriesId,
        address indexed holder,
        uint256 principal,
        uint256 coupons
    );
    event EarlyRedeemed(
        uint256 indexed seriesId,
        address indexed holder,
        uint256 returned,
        uint256 penalty
    );
    event CouponReserveFunded(uint256 indexed seriesId, uint256 amount);
    event PrincipalReserveFunded(uint256 indexed seriesId, uint256 amount);
    event SeriesDefaulted(uint256 indexed seriesId);
    event JulRewardsDeposited(uint256 amount);
    event KeeperTipPaid(address indexed keeper, uint256 amount);
    event JulBoostUpdated(uint256 newBoostBps);
    event KeeperTipUpdated(uint256 newTipAmount);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroPrincipal();
    error InvalidRateRange();
    error InvalidMaturity();
    error InvalidCouponInterval();
    error InvalidAuctionDuration();
    error SeriesNotFound();
    error NotInAuctionPhase();
    error NotActiveState();
    error NotMatured();
    error AuctionStillActive();
    error ExceedsMaxPrincipal();
    error ZeroAmount();
    error CouponTooEarly();
    error NothingToClaim();
    error InsufficientPrincipalReserve();
    error InsufficientCouponReserve();
    error AlreadyDefaulted();
    error AlreadyRedeemed();
    error NoPrincipalRaised();
    error AlreadyFunded();
    error AllCouponsDistributed();

    // ============ Core Functions ============

    function createSeries(CreateSeriesParams calldata params) external returns (uint256 seriesId);
    function buy(uint256 seriesId, uint256 amount) external;
    function settleAuction(uint256 seriesId) external;
    function fundCouponReserve(uint256 seriesId) external;
    function fundPrincipalReserve(uint256 seriesId, uint256 amount) external;
    function distributeCoupon(uint256 seriesId) external;
    function claimCoupon(uint256 seriesId) external;
    function redeem(uint256 seriesId, uint256 amount) external;
    function earlyRedeem(uint256 seriesId, uint256 amount) external;
    function markDefaulted(uint256 seriesId) external;

    // ============ JUL Integration ============

    function depositJulRewards(uint256 amount) external;
    function setJulBoostBps(uint256 bps) external;
    function setKeeperTipAmount(uint256 amount) external;

    // ============ View Functions ============

    function getSeries(uint256 seriesId) external view returns (BondSeries memory);
    function claimable(uint256 seriesId, address holder) external view returns (uint256);
    function currentAuctionRate(uint256 seriesId) external view returns (uint256);
    function earlyRedemptionValue(uint256 seriesId, uint256 amount) external view returns (uint256 value, uint256 penalty);
    function yieldToMaturity(uint256 seriesId) external view returns (uint256);
    function totalSeries() external view returns (uint256);
}
