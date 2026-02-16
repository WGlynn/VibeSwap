// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IDutchAuctionLiquidator.sol";

/**
 * @title DutchAuctionLiquidator
 * @notice Descending-price auctions for liquidating undercollateralized positions
 * @dev Price descends linearly from startPrice (150% of debt) to endPrice (80% of debt).
 *      Surplus above debt is split: 80% to position owner, 20% to treasury.
 *      Cooperative Capitalism: fair price discovery replaces extractive instant seizure.
 */
contract DutchAuctionLiquidator is Ownable, ReentrancyGuard, IDutchAuctionLiquidator {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS = 10000;
    uint64 public constant MIN_DURATION = 5 minutes;
    uint64 public constant MAX_DURATION = 24 hours;

    // ============ State ============

    /// @notice Treasury address for protocol share of proceeds
    address public immutable treasury;

    /// @notice Number of auctions created
    uint256 public auctionCount;

    /// @notice Default auction duration
    uint64 public defaultDuration;

    /// @notice Start price premium in BPS above debt (5000 = 150% of debt)
    uint256 public startPremiumBps;

    /// @notice End price discount in BPS below debt (2000 = 80% of debt)
    uint256 public endDiscountBps;

    /// @notice Position owner share of surplus in BPS (8000 = 80%)
    uint256 public surplusShareBps;

    /// @notice Auctions by ID (1-indexed)
    mapping(uint256 => LiquidationAuction) internal _auctions;

    /// @notice Authorized auction creators (keepers, position contracts)
    mapping(address => bool) public authorizedCreators;

    // ============ Constructor ============

    constructor(address _treasury) Ownable(msg.sender) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        defaultDuration = 30 minutes;
        startPremiumBps = 5000;
        endDiscountBps = 2000;
        surplusShareBps = 8000;
    }

    // ============ Core Functions ============

    /// @inheritdoc IDutchAuctionLiquidator
    function createAuction(
        address collateralToken,
        uint256 collateralAmount,
        address debtToken,
        uint256 debtAmount,
        address positionOwner
    ) external nonReentrant returns (uint256 auctionId) {
        if (!authorizedCreators[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedCreator();
        }
        if (collateralAmount == 0 || debtAmount == 0) revert ZeroAmount();
        if (collateralToken == address(0) || debtToken == address(0)) revert ZeroAddress();

        auctionId = ++auctionCount;

        uint256 startPrice = (debtAmount * (BPS + startPremiumBps)) / BPS;
        uint256 endPrice = (debtAmount * (BPS - endDiscountBps)) / BPS;

        _auctions[auctionId] = LiquidationAuction({
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            debtToken: debtToken,
            debtAmount: debtAmount,
            startPrice: startPrice,
            endPrice: endPrice,
            startTime: uint64(block.timestamp),
            duration: defaultDuration,
            state: AuctionState.ACTIVE,
            creator: msg.sender,
            positionOwner: positionOwner,
            winner: address(0),
            winningBid: 0
        });

        // Pull collateral from creator
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateralAmount);

        emit AuctionCreated(
            auctionId,
            collateralToken,
            debtToken,
            collateralAmount,
            debtAmount,
            startPrice,
            endPrice
        );
    }

    /// @inheritdoc IDutchAuctionLiquidator
    function bid(uint256 auctionId) external nonReentrant {
        LiquidationAuction storage auction = _auctions[auctionId];
        if (auction.state != AuctionState.ACTIVE) revert AuctionNotActive();

        uint256 deadline = uint256(auction.startTime) + uint256(auction.duration);
        if (block.timestamp >= deadline) revert AuctionNotActive();

        uint256 price = _currentPrice(auctionId);

        // Pull payment from bidder in debt token
        IERC20(auction.debtToken).safeTransferFrom(msg.sender, address(this), price);

        // Send collateral to bidder
        IERC20(auction.collateralToken).safeTransfer(msg.sender, auction.collateralAmount);

        // Distribute proceeds
        uint256 surplus = 0;
        if (price > auction.debtAmount) {
            surplus = price - auction.debtAmount;
            uint256 ownerShare = (surplus * surplusShareBps) / BPS;
            uint256 treasuryAmount = price - ownerShare;

            if (ownerShare > 0) {
                IERC20(auction.debtToken).safeTransfer(auction.positionOwner, ownerShare);
            }
            IERC20(auction.debtToken).safeTransfer(treasury, treasuryAmount);
        } else {
            // No surplus — all proceeds to treasury to cover bad debt
            IERC20(auction.debtToken).safeTransfer(treasury, price);
        }

        auction.state = AuctionState.COMPLETED;
        auction.winner = msg.sender;
        auction.winningBid = price;

        emit AuctionBid(auctionId, msg.sender, price, surplus);
    }

    /// @inheritdoc IDutchAuctionLiquidator
    function settleExpired(uint256 auctionId) external nonReentrant {
        LiquidationAuction storage auction = _auctions[auctionId];
        if (auction.state != AuctionState.ACTIVE) revert AuctionNotActive();

        uint256 deadline = uint256(auction.startTime) + uint256(auction.duration);
        if (block.timestamp < deadline) revert AuctionStillActive();

        // No bidder — send collateral to treasury as last resort
        IERC20(auction.collateralToken).safeTransfer(treasury, auction.collateralAmount);

        auction.state = AuctionState.EXPIRED;

        emit AuctionExpiredSettled(auctionId, auction.collateralAmount);
    }

    // ============ Internal Functions ============

    /**
     * @notice Compute current auction price (descending linear)
     * @dev price = startPrice - (startPrice - endPrice) * elapsed / duration
     *      Mirrors VibeBonds.currentAuctionRate() formula.
     */
    function _currentPrice(uint256 auctionId) internal view returns (uint256) {
        LiquidationAuction storage auction = _auctions[auctionId];

        uint256 elapsed = block.timestamp > auction.startTime
            ? block.timestamp - auction.startTime
            : 0;

        if (elapsed >= auction.duration) return auction.endPrice;

        return auction.startPrice
            - ((auction.startPrice - auction.endPrice) * elapsed) / auction.duration;
    }

    // ============ View Functions ============

    /// @inheritdoc IDutchAuctionLiquidator
    function currentPrice(uint256 auctionId) external view returns (uint256) {
        return _currentPrice(auctionId);
    }

    /// @inheritdoc IDutchAuctionLiquidator
    function getAuction(uint256 auctionId) external view returns (LiquidationAuction memory) {
        return _auctions[auctionId];
    }

    // ============ Admin Functions ============

    function addAuthorizedCreator(address creator) external onlyOwner {
        authorizedCreators[creator] = true;
        emit AuthorizedCreatorAdded(creator);
    }

    function removeAuthorizedCreator(address creator) external onlyOwner {
        authorizedCreators[creator] = false;
        emit AuthorizedCreatorRemoved(creator);
    }

    function setDefaultDuration(uint64 _duration) external onlyOwner {
        if (_duration < MIN_DURATION || _duration > MAX_DURATION) revert InvalidDuration();
        uint64 old = defaultDuration;
        defaultDuration = _duration;
        emit DefaultDurationUpdated(old, _duration);
    }

    function setStartPremiumBps(uint256 _bps) external onlyOwner {
        uint256 old = startPremiumBps;
        startPremiumBps = _bps;
        emit StartPremiumUpdated(old, _bps);
    }

    function setEndDiscountBps(uint256 _bps) external onlyOwner {
        require(_bps < BPS, "Discount must be < 100%");
        uint256 old = endDiscountBps;
        endDiscountBps = _bps;
        emit EndDiscountUpdated(old, _bps);
    }

    function setSurplusShareBps(uint256 _bps) external onlyOwner {
        require(_bps <= BPS, "Share must be <= 100%");
        uint256 old = surplusShareBps;
        surplusShareBps = _bps;
        emit SurplusShareUpdated(old, _bps);
    }
}
