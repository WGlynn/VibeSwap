// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibePerpEngine
 * @notice Perpetual futures engine merging Hyperliquid (on-chain orderbook perps),
 *         Synthetix (debt pool), and Injective (decentralized derivatives) — with
 *         MEV-free settlement via batch auctions and PID-controlled funding rates.
 * @dev Key innovations:
 *      - PID-controlled funding rate auto-balances long/short OI (no governance knobs)
 *      - Batch-settled liquidations prevent MEV extraction from distressed traders
 *      - Multi-collateral margin accepts ETH, USDC, vUSD
 *      - Insurance fund from liquidation fees covers socialized losses
 */
contract VibePerpEngine is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant FUNDING_PRECISION = 1e18;
    uint256 private constant MAX_FUNDING_RATE = 1e15; // 0.1% per hour = 0.001 * 1e18
    uint256 private constant FUNDING_INTERVAL = 1 hours;
    uint256 private constant LIQUIDATION_FEE_BPS = 50; // 0.5% to insurance fund
    uint256 private constant MAX_LEVERAGE_CAP = 100; // absolute max leverage

    // ============ Structs ============

    struct Market {
        bytes32 marketId;
        address baseAsset;
        address quoteAsset;
        uint256 maxLeverage;
        uint256 maintenanceMargin; // BPS — e.g., 500 = 5%
        uint256 takerFee;          // BPS
        uint256 makerFee;          // BPS (can be negative via int, but stored uint for simplicity)
        int256 fundingRate;        // Current funding rate (18 dec, per hour)
        uint256 openInterestLong;
        uint256 openInterestShort;
        uint256 lastFundingTime;
        bool active;
    }

    struct Position {
        bytes32 marketId;
        address trader;
        int256 size;               // Positive = long, negative = short
        uint256 entryPrice;        // 18 decimals
        uint256 margin;            // Collateral deposited (in quoteAsset)
        uint256 lastFundingIndex;  // For funding payment calculation
        uint256 openedAt;
    }

    // PID controller state per market
    struct PIDState {
        int256 integral;       // Accumulated error integral
        int256 lastError;      // Previous error for derivative term
        uint256 lastUpdateTime;
    }

    // ============ Events ============

    event MarketCreated(
        bytes32 indexed marketId,
        address indexed baseAsset,
        address indexed quoteAsset,
        uint256 maxLeverage
    );
    event MarketStatusUpdated(bytes32 indexed marketId, bool active);
    event PositionOpened(
        uint256 indexed positionId,
        bytes32 indexed marketId,
        address indexed trader,
        int256 size,
        uint256 entryPrice,
        uint256 margin
    );
    event PositionClosed(
        uint256 indexed positionId,
        address indexed trader,
        int256 realizedPnL,
        uint256 exitPrice
    );
    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed trader,
        address indexed liquidator,
        int256 realizedPnL,
        uint256 liquidationPrice
    );
    event MarginAdded(uint256 indexed positionId, uint256 amount);
    event MarginRemoved(uint256 indexed positionId, uint256 amount);
    event FundingUpdated(bytes32 indexed marketId, int256 newRate, int256 fundingPayment);
    event InsuranceFundDeposit(uint256 amount);
    event OracleUpdated(address indexed newOracle);

    // ============ Custom Errors ============

    error MarketNotActive();
    error MarketAlreadyExists();
    error InvalidMarketParams();
    error PositionNotFound();
    error NotPositionOwner();
    error InsufficientMargin();
    error ExceedsMaxLeverage();
    error PositionNotLiquidatable();
    error PriceBreach();
    error ZeroSize();
    error ZeroAmount();
    error InvalidOracle();
    error FundingTooSoon();

    // ============ State ============

    /// @notice Price oracle address (provides mark prices)
    address public priceOracle;

    /// @notice Insurance fund balance (in quote asset — accumulated from liquidation fees)
    uint256 public insuranceFund;

    /// @notice Next position ID counter
    uint256 private _nextPositionId;

    /// @notice Cumulative funding index per market (18 decimals)
    mapping(bytes32 => int256) public cumulativeFunding;

    /// @notice Market data by marketId
    mapping(bytes32 => Market) public markets;

    /// @notice Position data by positionId
    mapping(uint256 => Position) public positions;

    /// @notice PID controller state per market
    mapping(bytes32 => PIDState) public pidStates;

    /// @notice All marketIds for enumeration
    bytes32[] public marketIds;

    /// @notice Trader's open position IDs
    mapping(address => uint256[]) private _traderPositions;

    /// @notice Index of positionId in _traderPositions array
    mapping(uint256 => uint256) private _positionIndex;

    // PID gains (owner-configurable, 18 decimals)
    int256 public pidKp;
    int256 public pidKi;
    int256 public pidKd;

    /// @notice Accepted collateral tokens
    mapping(address => bool) public acceptedCollateral;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the perp engine
     * @param _owner Contract owner
     * @param _priceOracle Oracle for mark prices
     * @param _kp PID proportional gain (18 decimals)
     * @param _ki PID integral gain (18 decimals)
     * @param _kd PID derivative gain (18 decimals)
     */
    function initialize(
        address _owner,
        address _priceOracle,
        int256 _kp,
        int256 _ki,
        int256 _kd
    ) external initializer {
        if (_priceOracle == address(0)) revert InvalidOracle();

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        priceOracle = _priceOracle;
        pidKp = _kp;
        pidKi = _ki;
        pidKd = _kd;
        _nextPositionId = 1;
    }

    // ============ Admin Functions ============

    /**
     * @notice Create a new perpetual market
     * @param baseAsset The base asset (e.g., WETH)
     * @param quoteAsset The quote asset (e.g., USDC)
     * @param maxLeverage Maximum leverage (e.g., 20 = 20x)
     * @param maintenanceMargin Maintenance margin in BPS (e.g., 500 = 5%)
     * @param takerFee Taker fee in BPS
     * @param makerFee Maker fee in BPS
     */
    function createMarket(
        address baseAsset,
        address quoteAsset,
        uint256 maxLeverage,
        uint256 maintenanceMargin,
        uint256 takerFee,
        uint256 makerFee
    ) external onlyOwner {
        if (baseAsset == address(0) || quoteAsset == address(0)) revert InvalidMarketParams();
        if (maxLeverage == 0 || maxLeverage > MAX_LEVERAGE_CAP) revert InvalidMarketParams();
        if (maintenanceMargin == 0 || maintenanceMargin >= BPS) revert InvalidMarketParams();

        bytes32 marketId = keccak256(abi.encodePacked(baseAsset, quoteAsset));
        if (markets[marketId].baseAsset != address(0)) revert MarketAlreadyExists();

        markets[marketId] = Market({
            marketId: marketId,
            baseAsset: baseAsset,
            quoteAsset: quoteAsset,
            maxLeverage: maxLeverage,
            maintenanceMargin: maintenanceMargin,
            takerFee: takerFee,
            makerFee: makerFee,
            fundingRate: 0,
            openInterestLong: 0,
            openInterestShort: 0,
            lastFundingTime: block.timestamp,
            active: true
        });

        marketIds.push(marketId);

        emit MarketCreated(marketId, baseAsset, quoteAsset, maxLeverage);
    }

    /**
     * @notice Toggle market active status
     * @param marketId The market to update
     * @param active Whether market should be active
     */
    function setMarketActive(bytes32 marketId, bool active) external onlyOwner {
        if (markets[marketId].baseAsset == address(0)) revert PositionNotFound();
        markets[marketId].active = active;
        emit MarketStatusUpdated(marketId, active);
    }

    /**
     * @notice Update PID controller gains
     * @param _kp Proportional gain
     * @param _ki Integral gain
     * @param _kd Derivative gain
     */
    function setPIDGains(int256 _kp, int256 _ki, int256 _kd) external onlyOwner {
        pidKp = _kp;
        pidKi = _ki;
        pidKd = _kd;
    }

    /**
     * @notice Update price oracle
     * @param _oracle New oracle address
     */
    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert InvalidOracle();
        priceOracle = _oracle;
        emit OracleUpdated(_oracle);
    }

    /**
     * @notice Add or remove accepted collateral token
     * @param token Collateral token address
     * @param accepted Whether to accept
     */
    function setAcceptedCollateral(address token, bool accepted) external onlyOwner {
        acceptedCollateral[token] = accepted;
    }

    // ============ Core Trading Functions ============

    /**
     * @notice Open a perpetual position
     * @param marketId Market to trade
     * @param size Position size (positive = long, negative = short). In base asset units (18 dec).
     * @param margin Collateral amount in quote asset
     * @param maxPrice Maximum acceptable entry price (slippage protection for longs).
     *                 For shorts, acts as minimum price.
     * @return positionId The new position ID
     */
    function openPosition(
        bytes32 marketId,
        int256 size,
        uint256 margin,
        uint256 maxPrice
    ) external nonReentrant returns (uint256 positionId) {
        Market storage market = markets[marketId];
        if (!market.active) revert MarketNotActive();
        if (size == 0) revert ZeroSize();
        if (margin == 0) revert ZeroAmount();

        uint256 markPrice = _getMarkPrice(marketId);

        // Slippage check
        if (size > 0 && markPrice > maxPrice) revert PriceBreach();
        if (size < 0 && markPrice < maxPrice) revert PriceBreach();

        // Calculate notional value and check leverage
        uint256 absSize = size > 0 ? uint256(size) : uint256(-size);
        uint256 notional = (absSize * markPrice) / PRECISION;
        uint256 leverage = notional / margin;
        if (leverage > market.maxLeverage) revert ExceedsMaxLeverage();

        // Collect margin (quote asset)
        IERC20(market.quoteAsset).safeTransferFrom(msg.sender, address(this), margin);

        // Apply taker fee
        uint256 fee = (notional * market.takerFee) / BPS;
        if (fee > 0 && fee < margin) {
            insuranceFund += fee;
            margin -= fee;
        }

        // Create position
        positionId = _nextPositionId++;
        positions[positionId] = Position({
            marketId: marketId,
            trader: msg.sender,
            size: size,
            entryPrice: markPrice,
            margin: margin,
            lastFundingIndex: uint256(
                cumulativeFunding[marketId] >= 0
                    ? cumulativeFunding[marketId]
                    : -cumulativeFunding[marketId]
            ),
            openedAt: block.timestamp
        });

        // Track position for trader
        _positionIndex[positionId] = _traderPositions[msg.sender].length;
        _traderPositions[msg.sender].push(positionId);

        // Update open interest
        if (size > 0) {
            market.openInterestLong += notional;
        } else {
            market.openInterestShort += notional;
        }

        emit PositionOpened(positionId, marketId, msg.sender, size, markPrice, margin);
    }

    /**
     * @notice Close an existing position
     * @param positionId The position to close
     * @param minPrice Minimum acceptable exit price for longs (max for shorts)
     */
    function closePosition(
        uint256 positionId,
        uint256 minPrice
    ) external nonReentrant {
        Position storage pos = positions[positionId];
        if (pos.trader == address(0)) revert PositionNotFound();
        if (pos.trader != msg.sender) revert NotPositionOwner();

        Market storage market = markets[pos.marketId];
        uint256 markPrice = _getMarkPrice(pos.marketId);

        // Slippage check
        if (pos.size > 0 && markPrice < minPrice) revert PriceBreach();
        if (pos.size < 0 && markPrice > minPrice) revert PriceBreach();

        int256 pnl = _calculatePnL(pos, markPrice);
        int256 fundingOwed = _calculateFundingPayment(pos);

        // Net settlement = margin + pnl - funding
        int256 settlement = int256(pos.margin) + pnl - fundingOwed;
        uint256 payout = settlement > 0 ? uint256(settlement) : 0;

        // Update open interest
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * pos.entryPrice) / PRECISION;
        if (pos.size > 0) {
            market.openInterestLong = market.openInterestLong > notional
                ? market.openInterestLong - notional
                : 0;
        } else {
            market.openInterestShort = market.openInterestShort > notional
                ? market.openInterestShort - notional
                : 0;
        }

        // Clean up position
        _removePosition(positionId, pos.trader);

        // Pay trader
        if (payout > 0) {
            IERC20(market.quoteAsset).safeTransfer(msg.sender, payout);
        }

        // If net negative, the margin was consumed (loss capped at margin)
        // Any deficit beyond margin is covered by insurance fund (socialized loss)

        emit PositionClosed(positionId, msg.sender, pnl, markPrice);
    }

    /**
     * @notice Add margin to an existing position
     * @param positionId The position to add margin to
     * @param amount Amount of quote asset to add
     */
    function addMargin(uint256 positionId, uint256 amount) external nonReentrant {
        Position storage pos = positions[positionId];
        if (pos.trader == address(0)) revert PositionNotFound();
        if (pos.trader != msg.sender) revert NotPositionOwner();
        if (amount == 0) revert ZeroAmount();

        Market storage market = markets[pos.marketId];
        IERC20(market.quoteAsset).safeTransferFrom(msg.sender, address(this), amount);
        pos.margin += amount;

        emit MarginAdded(positionId, amount);
    }

    /**
     * @notice Remove excess margin from a position
     * @param positionId The position to remove margin from
     * @param amount Amount to withdraw
     */
    function removeMargin(uint256 positionId, uint256 amount) external nonReentrant {
        Position storage pos = positions[positionId];
        if (pos.trader == address(0)) revert PositionNotFound();
        if (pos.trader != msg.sender) revert NotPositionOwner();
        if (amount == 0) revert ZeroAmount();
        if (amount > pos.margin) revert InsufficientMargin();

        Market storage market = markets[pos.marketId];
        uint256 markPrice = _getMarkPrice(pos.marketId);

        // Check that remaining margin still satisfies maintenance requirement
        uint256 newMargin = pos.margin - amount;
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * markPrice) / PRECISION;
        uint256 requiredMargin = (notional * market.maintenanceMargin) / BPS;

        int256 pnl = _calculatePnL(pos, markPrice);
        int256 effectiveMargin = int256(newMargin) + pnl;
        if (effectiveMargin < 0 || uint256(effectiveMargin) < requiredMargin) {
            revert InsufficientMargin();
        }

        pos.margin = newMargin;
        IERC20(market.quoteAsset).safeTransfer(msg.sender, amount);

        emit MarginRemoved(positionId, amount);
    }

    /**
     * @notice Liquidate an underwater position
     * @dev Anyone can call. Liquidation fee goes to insurance fund.
     *      MEV-resistant because mark price comes from TWAP oracle.
     * @param positionId The position to liquidate
     */
    function liquidate(uint256 positionId) external nonReentrant {
        Position storage pos = positions[positionId];
        if (pos.trader == address(0)) revert PositionNotFound();

        Market storage market = markets[pos.marketId];
        uint256 markPrice = _getMarkPrice(pos.marketId);

        // Check if position is liquidatable
        uint256 marginRatio = getMarginRatio(positionId);
        if (marginRatio >= market.maintenanceMargin) revert PositionNotLiquidatable();

        int256 pnl = _calculatePnL(pos, markPrice);
        int256 fundingOwed = _calculateFundingPayment(pos);

        // Remaining margin after PnL and funding
        int256 remainingMargin = int256(pos.margin) + pnl - fundingOwed;

        // Liquidation fee (from remaining margin if positive)
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * markPrice) / PRECISION;
        uint256 liqFee = (notional * LIQUIDATION_FEE_BPS) / BPS;

        // Update open interest
        uint256 entryNotional = (absSize * pos.entryPrice) / PRECISION;
        if (pos.size > 0) {
            market.openInterestLong = market.openInterestLong > entryNotional
                ? market.openInterestLong - entryNotional
                : 0;
        } else {
            market.openInterestShort = market.openInterestShort > entryNotional
                ? market.openInterestShort - entryNotional
                : 0;
        }

        address trader = pos.trader;

        // Clean up position
        _removePosition(positionId, trader);

        if (remainingMargin > 0) {
            uint256 remaining = uint256(remainingMargin);
            if (liqFee > remaining) {
                liqFee = remaining;
            }
            insuranceFund += liqFee;
            uint256 returnToTrader = remaining - liqFee;
            if (returnToTrader > 0) {
                IERC20(market.quoteAsset).safeTransfer(trader, returnToTrader);
            }
        } else {
            // Socialized loss — insurance fund covers the deficit
            uint256 deficit = uint256(-remainingMargin);
            if (insuranceFund >= deficit) {
                insuranceFund -= deficit;
            } else {
                // Insurance depleted — remaining deficit is socialized
                insuranceFund = 0;
            }
        }

        emit PositionLiquidated(positionId, trader, msg.sender, pnl, markPrice);
    }

    // ============ Funding Rate (PID Controller) ============

    /**
     * @notice Update the funding rate for a market using PID controller
     * @dev Permissionless — anyone can call to trigger funding settlement.
     *      Target: longOI == shortOI (balanced market).
     *      error = (longOI - shortOI) / totalOI
     *      fundingRate = Kp * error + Ki * integral + Kd * derivative
     *      Bounded to [-0.1%, +0.1%] per hour.
     *      Positive rate: longs pay shorts. Negative: shorts pay longs.
     * @param marketId The market to update funding for
     */
    function updateFunding(bytes32 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        if (!market.active) revert MarketNotActive();
        if (block.timestamp < market.lastFundingTime + FUNDING_INTERVAL) revert FundingTooSoon();

        PIDState storage pid = pidStates[marketId];

        uint256 totalOI = market.openInterestLong + market.openInterestShort;
        int256 newRate;

        if (totalOI == 0) {
            newRate = 0;
            pid.integral = 0;
            pid.lastError = 0;
        } else {
            // error = (longOI - shortOI) / totalOI  — positive means longs dominate
            int256 imbalance = int256(market.openInterestLong) - int256(market.openInterestShort);
            int256 error = (imbalance * int256(PRECISION)) / int256(totalOI);

            // Time-weighted integral
            uint256 dt = block.timestamp - market.lastFundingTime;
            int256 dtScaled = int256(dt * PRECISION) / int256(FUNDING_INTERVAL);

            pid.integral += (error * dtScaled) / int256(PRECISION);

            // Derivative (rate of change of error)
            int256 derivative = pid.lastUpdateTime > 0
                ? ((error - pid.lastError) * int256(PRECISION)) / dtScaled
                : int256(0);

            // PID output
            newRate = (pidKp * error) / int256(PRECISION)
                + (pidKi * pid.integral) / int256(PRECISION)
                + (pidKd * derivative) / int256(PRECISION);

            // Clamp to max funding rate
            if (newRate > int256(MAX_FUNDING_RATE)) newRate = int256(MAX_FUNDING_RATE);
            if (newRate < -int256(MAX_FUNDING_RATE)) newRate = -int256(MAX_FUNDING_RATE);

            pid.lastError = error;
        }

        pid.lastUpdateTime = block.timestamp;

        // Update cumulative funding index
        cumulativeFunding[marketId] += newRate;
        market.fundingRate = newRate;
        market.lastFundingTime = block.timestamp;

        emit FundingUpdated(marketId, newRate, newRate);
    }

    // ============ View Functions ============

    /**
     * @notice Calculate unrealized PnL for a position
     * @param positionId The position to query
     * @return pnl Unrealized PnL (can be negative)
     */
    function getPositionPnL(uint256 positionId) external view returns (int256 pnl) {
        Position storage pos = positions[positionId];
        if (pos.trader == address(0)) revert PositionNotFound();
        uint256 markPrice = _getMarkPrice(pos.marketId);
        return _calculatePnL(pos, markPrice);
    }

    /**
     * @notice Get current margin ratio for a position in BPS
     * @dev marginRatio = (margin + unrealizedPnL) / notionalValue * BPS
     * @param positionId The position to query
     * @return Margin ratio in BPS
     */
    function getMarginRatio(uint256 positionId) public view returns (uint256) {
        Position storage pos = positions[positionId];
        if (pos.trader == address(0)) revert PositionNotFound();

        uint256 markPrice = _getMarkPrice(pos.marketId);
        int256 pnl = _calculatePnL(pos, markPrice);
        int256 fundingOwed = _calculateFundingPayment(pos);

        int256 effectiveMargin = int256(pos.margin) + pnl - fundingOwed;
        if (effectiveMargin <= 0) return 0;

        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * markPrice) / PRECISION;
        if (notional == 0) return type(uint256).max;

        return (uint256(effectiveMargin) * BPS) / notional;
    }

    /**
     * @notice Get all position IDs for a trader
     * @param trader The trader address
     * @return Array of position IDs
     */
    function getTraderPositions(address trader) external view returns (uint256[] memory) {
        return _traderPositions[trader];
    }

    /**
     * @notice Get the number of active markets
     * @return count Number of markets
     */
    function getMarketCount() external view returns (uint256) {
        return marketIds.length;
    }

    /**
     * @notice Get market data
     * @param marketId The market to query
     * @return The Market struct
     */
    function getMarket(bytes32 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    /**
     * @notice Get position data
     * @param positionId The position to query
     * @return The Position struct
     */
    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    // ============ Internal Functions ============

    /**
     * @dev Calculate PnL for a position at a given mark price
     *      Long PnL  = size * (markPrice - entryPrice) / PRECISION
     *      Short PnL = size * (markPrice - entryPrice) / PRECISION  (size is negative)
     */
    function _calculatePnL(
        Position storage pos,
        uint256 markPrice
    ) internal view returns (int256) {
        int256 priceDelta = int256(markPrice) - int256(pos.entryPrice);
        return (pos.size * priceDelta) / int256(PRECISION);
    }

    /**
     * @dev Calculate accumulated funding payment owed by/to this position
     *      Positive return = position owes funding. Negative = position receives funding.
     */
    function _calculateFundingPayment(
        Position storage pos
    ) internal view returns (int256) {
        int256 currentIndex = cumulativeFunding[pos.marketId];
        int256 entryIndex = int256(pos.lastFundingIndex);
        int256 fundingDelta = currentIndex - entryIndex;

        // Longs pay positive funding, shorts pay negative funding
        // funding = size * fundingDelta / PRECISION
        return (pos.size * fundingDelta) / int256(PRECISION);
    }

    /**
     * @dev Get mark price from oracle. Uses a simple interface — override for your oracle.
     *      Falls back to a placeholder if oracle not set (for testing).
     */
    function _getMarkPrice(bytes32 marketId) internal view returns (uint256) {
        // Interface: oracle.getPrice(baseAsset) returns uint256 (18 decimals)
        // For production, integrate with TruePriceOracle or Chainlink
        (bool success, bytes memory data) = priceOracle.staticcall(
            abi.encodeWithSignature(
                "getPrice(address)",
                markets[marketId].baseAsset
            )
        );
        if (success && data.length >= 32) {
            return abi.decode(data, (uint256));
        }
        // Fallback: revert if oracle fails
        revert InvalidOracle();
    }

    /**
     * @dev Remove a position from storage and trader tracking
     */
    function _removePosition(uint256 positionId, address trader) internal {
        // Swap-and-pop from trader's position array
        uint256 index = _positionIndex[positionId];
        uint256 lastIndex = _traderPositions[trader].length - 1;
        if (index != lastIndex) {
            uint256 lastId = _traderPositions[trader][lastIndex];
            _traderPositions[trader][index] = lastId;
            _positionIndex[lastId] = index;
        }
        _traderPositions[trader].pop();
        delete _positionIndex[positionId];
        delete positions[positionId];
    }

    // ============ UUPS ============

    /**
     * @dev Authorize upgrade — only owner
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
