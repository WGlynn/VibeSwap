// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVibeBonds.sol";

/**
 * @title VibeBonds
 * @notice ERC-1155 semi-fungible bond market with Dutch-auction yield discovery,
 *         Synthetix-style coupon distribution, and native JUL integration.
 *
 *         Bonds in the same series share a token ID and are fungible within that class.
 *         Coupon rates are market-discovered via Dutch auction (uniform clearing price),
 *         philosophically aligned with VibeSwap's commit-reveal batch auctions.
 *
 *         Part of the VSOS (VibeSwap Operating System) financial primitives.
 */
contract VibeBonds is ERC1155Supply, Ownable, ReentrancyGuard, IVibeBonds {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 31_557_600;

    // ============ State ============

    IERC20 public immutable julToken;

    uint256 private _totalSeries;
    mapping(uint256 => BondSeries) private _series;

    // Synthetix reward tracking: seriesId => user => value
    mapping(uint256 => mapping(address => uint256)) private _userRewardPerTokenPaid;
    mapping(uint256 => mapping(address => uint256)) private _userRewards;

    // JUL integration
    uint256 public julRewardPool;
    uint256 public julBoostBps;
    uint256 public keeperTipAmount;

    // ============ Constructor ============

    constructor(address _julToken) ERC1155("") Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        julToken = IERC20(_julToken);
    }

    // ============ Admin Functions ============

    function createSeries(CreateSeriesParams calldata params) external onlyOwner returns (uint256 seriesId) {
        if (params.token == address(0)) revert ZeroAddress();
        if (params.treasury == address(0)) revert ZeroAddress();
        if (params.maxPrincipal == 0) revert ZeroPrincipal();
        if (params.maxCouponRate == 0 || params.maxCouponRate < params.minCouponRate) revert InvalidRateRange();
        if (params.auctionDuration == 0) revert InvalidAuctionDuration();

        uint40 auctionEnd = uint40(block.timestamp) + params.auctionDuration;
        if (params.maturity <= auctionEnd) revert InvalidMaturity();
        if (params.couponInterval == 0 || params.couponInterval > params.maturity - auctionEnd) {
            revert InvalidCouponInterval();
        }

        seriesId = _totalSeries++;

        BondSeries storage s = _series[seriesId];
        s.token = params.token;
        s.treasury = params.treasury;
        s.maxPrincipal = params.maxPrincipal;
        s.maxCouponRate = params.maxCouponRate;
        s.minCouponRate = params.minCouponRate;
        s.auctionStart = uint40(block.timestamp);
        s.auctionEnd = auctionEnd;
        s.maturity = params.maturity;
        s.couponInterval = params.couponInterval;
        s.earlyRedemptionPenaltyBps = params.earlyRedemptionPenaltyBps;
        s.state = BondState.AUCTION;

        emit SeriesCreated(seriesId, params.token, params.treasury, params.maxPrincipal);
    }

    function fundCouponReserve(uint256 seriesId) external nonReentrant {
        BondSeries storage s = _series[seriesId];
        _requireExists(seriesId);
        if (s.state != BondState.ACTIVE) revert NotActiveState();
        if (s.couponReserve > 0) revert AlreadyFunded();

        uint256 required = _requiredCouponReserve(seriesId);
        s.couponReserve = required;
        IERC20(s.token).safeTransferFrom(msg.sender, address(this), required);

        emit CouponReserveFunded(seriesId, required);
    }

    function fundPrincipalReserve(uint256 seriesId, uint256 amount) external nonReentrant {
        BondSeries storage s = _series[seriesId];
        _requireExists(seriesId);
        if (s.state == BondState.AUCTION) revert NotActiveState();
        if (amount == 0) revert ZeroAmount();

        s.principalReserve += amount;
        IERC20(s.token).safeTransferFrom(msg.sender, address(this), amount);

        emit PrincipalReserveFunded(seriesId, amount);
    }

    function markDefaulted(uint256 seriesId) external onlyOwner {
        BondSeries storage s = _series[seriesId];
        _requireExists(seriesId);
        if (s.state == BondState.DEFAULTED) revert AlreadyDefaulted();
        if (s.state == BondState.REDEEMED) revert AlreadyRedeemed();

        s.state = BondState.DEFAULTED;
        emit SeriesDefaulted(seriesId);
    }

    // ============ JUL Integration ============

    function depositJulRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        julRewardPool += amount;
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        emit JulRewardsDeposited(amount);
    }

    function setJulBoostBps(uint256 bps) external onlyOwner {
        julBoostBps = bps;
        emit JulBoostUpdated(bps);
    }

    function setKeeperTipAmount(uint256 amount) external onlyOwner {
        keeperTipAmount = amount;
        emit KeeperTipUpdated(amount);
    }

    // ============ User Functions ============

    function buy(uint256 seriesId, uint256 amount) external nonReentrant {
        BondSeries storage s = _series[seriesId];
        _requireExists(seriesId);
        if (s.state != BondState.AUCTION) revert NotInAuctionPhase();
        if (block.timestamp >= s.auctionEnd) revert NotInAuctionPhase();
        if (amount == 0) revert ZeroAmount();
        if (s.totalPrincipal + amount > s.maxPrincipal) revert ExceedsMaxPrincipal();

        // Snapshot the current Dutch auction rate — last buyer's rate becomes clearing rate
        uint256 rate = currentAuctionRate(seriesId);
        s.couponRate = rate;
        s.totalPrincipal += amount;

        // Mint bond tokens 1:1 with principal
        _mint(msg.sender, seriesId, amount, "");

        // Pull principal from buyer
        IERC20(s.token).safeTransferFrom(msg.sender, address(this), amount);

        emit BondPurchased(seriesId, msg.sender, amount, rate);
    }

    function claimCoupon(uint256 seriesId) external nonReentrant {
        _requireExists(seriesId);
        _updateReward(seriesId, msg.sender);

        uint256 reward = _userRewards[seriesId][msg.sender];
        if (reward == 0) revert NothingToClaim();

        _userRewards[seriesId][msg.sender] = 0;
        IERC20(_series[seriesId].token).safeTransfer(msg.sender, reward);

        emit CouponClaimed(seriesId, msg.sender, reward);
    }

    function redeem(uint256 seriesId, uint256 amount) external nonReentrant {
        BondSeries storage s = _series[seriesId];
        _requireExists(seriesId);
        _tryMature(seriesId);
        if (s.state != BondState.MATURED) revert NotMatured();
        if (amount == 0) revert ZeroAmount();
        if (s.principalReserve < amount) revert InsufficientPrincipalReserve();

        _updateReward(seriesId, msg.sender);

        s.principalReserve -= amount;
        s.totalRedeemed += amount;

        // Burn bonds
        _burn(msg.sender, seriesId, amount);

        // Auto-claim accumulated coupons
        uint256 coupons = _userRewards[seriesId][msg.sender];
        _userRewards[seriesId][msg.sender] = 0;

        // Transfer principal + coupons
        uint256 total = amount + coupons;
        IERC20(s.token).safeTransfer(msg.sender, total);

        // Mark fully redeemed
        if (totalSupply(seriesId) == 0) {
            s.state = BondState.REDEEMED;
        }

        emit BondRedeemed(seriesId, msg.sender, amount, coupons);
    }

    function earlyRedeem(uint256 seriesId, uint256 amount) external nonReentrant {
        BondSeries storage s = _series[seriesId];
        _requireExists(seriesId);
        if (s.state != BondState.ACTIVE) revert NotActiveState();
        if (block.timestamp >= s.maturity) revert NotActiveState();
        if (amount == 0) revert ZeroAmount();
        if (s.principalReserve < amount) revert InsufficientPrincipalReserve();

        _updateReward(seriesId, msg.sender);

        (uint256 value, uint256 penalty) = earlyRedemptionValue(seriesId, amount);

        s.principalReserve -= amount;
        s.totalRedeemed += amount;

        // Burn bonds
        _burn(msg.sender, seriesId, amount);

        // Distribute penalty to remaining holders (loyalty reward)
        uint256 remainingSupply = totalSupply(seriesId);
        if (penalty > 0 && remainingSupply > 0) {
            s.rewardPerTokenStored += penalty * 1e18 / remainingSupply;
        }

        // Transfer discounted principal
        IERC20(s.token).safeTransfer(msg.sender, value);

        // Auto-claim accumulated coupons
        uint256 coupons = _userRewards[seriesId][msg.sender];
        if (coupons > 0) {
            _userRewards[seriesId][msg.sender] = 0;
            IERC20(s.token).safeTransfer(msg.sender, coupons);
        }

        emit EarlyRedeemed(seriesId, msg.sender, value, penalty);
    }

    // ============ Keeper Functions ============

    function settleAuction(uint256 seriesId) external nonReentrant {
        BondSeries storage s = _series[seriesId];
        _requireExists(seriesId);
        if (s.state != BondState.AUCTION) revert NotActiveState();

        // Auction ends when time expires OR maxPrincipal is filled
        bool timeExpired = block.timestamp >= s.auctionEnd;
        bool filled = s.totalPrincipal >= s.maxPrincipal;
        if (!timeExpired && !filled) revert AuctionStillActive();
        if (s.totalPrincipal == 0) revert NoPrincipalRaised();

        s.state = BondState.ACTIVE;

        // Transfer principal to treasury
        IERC20(s.token).safeTransfer(s.treasury, s.totalPrincipal);

        emit AuctionSettled(seriesId, s.couponRate, s.totalPrincipal);
    }

    function distributeCoupon(uint256 seriesId) external nonReentrant {
        BondSeries storage s = _series[seriesId];
        _requireExists(seriesId);
        _tryMature(seriesId);

        if (s.state != BondState.ACTIVE && s.state != BondState.MATURED) revert NotActiveState();

        uint256 maxPeriods = _totalCouponPeriods(seriesId);
        if (s.couponsDistributed >= maxPeriods) revert AllCouponsDistributed();

        uint256 nextCouponTime = uint256(s.auctionEnd) + uint256(s.couponsDistributed + 1) * s.couponInterval;
        if (block.timestamp < nextCouponTime) revert CouponTooEarly();

        uint256 supply = totalSupply(seriesId);
        if (supply == 0) return;

        uint256 coupon = _couponPerPeriod(seriesId);
        if (s.couponReserve < coupon) revert InsufficientCouponReserve();

        s.couponReserve -= coupon;
        s.couponsDistributed++;

        // JUL boost for JUL-denominated bonds — seamless extra yield
        if (s.token == address(julToken) && julBoostBps > 0 && julRewardPool > 0) {
            uint256 julBonus = coupon * julBoostBps / BPS_DENOMINATOR;
            if (julBonus > julRewardPool) julBonus = julRewardPool;
            if (julBonus > 0) {
                julRewardPool -= julBonus;
                coupon += julBonus;
            }
        }

        s.rewardPerTokenStored += coupon * 1e18 / supply;

        // Keeper tip in JUL
        _payKeeperTip(msg.sender);

        emit CouponDistributed(seriesId, coupon, msg.sender);
    }

    // ============ View Functions ============

    function getSeries(uint256 seriesId) external view returns (BondSeries memory) {
        _requireExists(seriesId);
        return _series[seriesId];
    }

    function currentAuctionRate(uint256 seriesId) public view returns (uint256) {
        BondSeries storage s = _series[seriesId];
        if (s.state != BondState.AUCTION) return s.couponRate;

        uint256 elapsed = block.timestamp > s.auctionStart
            ? block.timestamp - s.auctionStart
            : 0;
        uint256 duration = s.auctionEnd - s.auctionStart;

        if (elapsed >= duration) return s.minCouponRate;

        return uint256(s.maxCouponRate) - (uint256(s.maxCouponRate - s.minCouponRate) * elapsed / duration);
    }

    function claimable(uint256 seriesId, address holder) external view returns (uint256) {
        BondSeries storage s = _series[seriesId];
        uint256 rpt = s.rewardPerTokenStored;
        uint256 bal = balanceOf(holder, seriesId);
        return _userRewards[seriesId][holder] +
            bal * (rpt - _userRewardPerTokenPaid[seriesId][holder]) / 1e18;
    }

    function earlyRedemptionValue(uint256 seriesId, uint256 amount) public view returns (uint256 value, uint256 penalty) {
        BondSeries storage s = _series[seriesId];
        uint256 totalDuration = s.maturity - s.auctionEnd;
        uint256 remainingTime = s.maturity > uint40(block.timestamp)
            ? s.maturity - uint40(block.timestamp)
            : 0;

        penalty = amount * s.earlyRedemptionPenaltyBps * remainingTime / (BPS_DENOMINATOR * totalDuration);
        value = amount - penalty;
    }

    function yieldToMaturity(uint256 seriesId) external view returns (uint256) {
        BondSeries storage s = _series[seriesId];
        if (s.totalPrincipal == 0) return 0;

        uint256 outstanding = s.totalPrincipal - s.totalRedeemed;
        if (outstanding == 0) return 0;

        uint256 maxPeriods = _totalCouponPeriods(seriesId);
        uint256 remainingPeriods = maxPeriods > s.couponsDistributed
            ? maxPeriods - s.couponsDistributed
            : 0;
        uint256 remainingCouponValue = _couponPerPeriod(seriesId) * remainingPeriods;

        uint256 remainingTime = s.maturity > uint40(block.timestamp)
            ? s.maturity - uint40(block.timestamp)
            : 1; // avoid div-by-zero

        // Annualized yield in BPS
        return remainingCouponValue * SECONDS_PER_YEAR * BPS_DENOMINATOR / (outstanding * remainingTime);
    }

    function totalSeries() external view returns (uint256) {
        return _totalSeries;
    }

    // ============ Internal ============

    function _requireExists(uint256 seriesId) internal view {
        if (seriesId >= _totalSeries) revert SeriesNotFound();
    }

    function _tryMature(uint256 seriesId) internal {
        BondSeries storage s = _series[seriesId];
        if (s.state == BondState.ACTIVE && block.timestamp >= s.maturity) {
            s.state = BondState.MATURED;
        }
    }

    function _updateReward(uint256 seriesId, address account) internal {
        uint256 rpt = _series[seriesId].rewardPerTokenStored;
        uint256 bal = balanceOf(account, seriesId);
        _userRewards[seriesId][account] += bal * (rpt - _userRewardPerTokenPaid[seriesId][account]) / 1e18;
        _userRewardPerTokenPaid[seriesId][account] = rpt;
    }

    function _couponPerPeriod(uint256 seriesId) internal view returns (uint256) {
        BondSeries storage s = _series[seriesId];
        return s.totalPrincipal * s.couponRate * s.couponInterval / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    function _totalCouponPeriods(uint256 seriesId) internal view returns (uint256) {
        BondSeries storage s = _series[seriesId];
        return (s.maturity - s.auctionEnd) / s.couponInterval;
    }

    function _requiredCouponReserve(uint256 seriesId) internal view returns (uint256) {
        return _couponPerPeriod(seriesId) * _totalCouponPeriods(seriesId);
    }

    function _payKeeperTip(address keeper) internal {
        if (keeperTipAmount == 0) return;

        uint256 tip = keeperTipAmount;
        if (tip > julRewardPool) tip = julRewardPool;
        if (tip == 0) return;

        julRewardPool -= tip;
        julToken.safeTransfer(keeper, tip);

        emit KeeperTipPaid(keeper, tip);
    }

    /// @dev Override ERC-1155 _update to track rewards on every transfer/mint/burn
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        // Snapshot rewards BEFORE balance changes
        for (uint256 i = 0; i < ids.length; i++) {
            if (from != address(0)) _updateReward(ids[i], from);
            if (to != address(0)) _updateReward(ids[i], to);
        }
        super._update(from, to, ids, values);
    }
}
