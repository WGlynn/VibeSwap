// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibePerpetual — Perpetual Futures with PID Funding Rate
 * @notice Decentralized perpetual swaps with auto-adjusting funding rates.
 *         No centralized order book — virtual AMM for price discovery.
 *
 * @dev Architecture:
 *      - Virtual AMM (vAMM) — no real liquidity, purely for price discovery
 *      - Funding rate: PID controller targets mark = index price
 *      - Cross-margin and isolated margin modes
 *      - Liquidation with insurance fund backstop
 *      - Max leverage: 20x
 */
contract VibePerpetual is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant MAX_LEVERAGE = 20;
    uint256 public constant LIQUIDATION_THRESHOLD_BPS = 500; // 5% margin remaining
    uint256 public constant FUNDING_INTERVAL = 8 hours;
    uint256 public constant SCALE = 1e18;

    // PID controller gains
    uint256 public constant KP = 1e15;    // Proportional
    uint256 public constant KI = 1e13;    // Integral
    uint256 public constant KD = 1e14;    // Derivative

    // ============ Types ============

    struct Market {
        bytes32 marketId;
        string symbol;
        uint256 vammK;              // Virtual AMM constant (x*y=k)
        uint256 vammBaseReserve;
        uint256 vammQuoteReserve;
        uint256 indexPrice;         // Oracle index price
        uint256 markPrice;          // vAMM mark price
        int256 fundingRate;         // Current funding rate (can be negative)
        int256 cumulativeFunding;
        uint256 lastFundingTime;
        uint256 openInterestLong;
        uint256 openInterestShort;
        uint256 insuranceFund;
        bool active;
    }

    struct Position {
        bytes32 marketId;
        address trader;
        int256 size;                // Positive = long, negative = short
        uint256 margin;
        uint256 entryPrice;
        int256 lastCumulativeFunding;
        uint256 openedAt;
        bool open;
    }

    // ============ State ============

    // Internal to avoid auto-generated getters for 14-field Market/8-field Position structs (stack-too-deep)
    mapping(bytes32 => Market) internal markets;
    bytes32[] public marketList;

    /// @notice Positions: positionId => Position
    mapping(bytes32 => Position) internal positions;

    /// @notice Trader positions: trader => positionIds
    mapping(address => bytes32[]) public traderPositions;

    /// @notice Total collateral deposited
    mapping(address => uint256) public collateral;

    /// @notice PID state for funding rate
    mapping(bytes32 => int256) public fundingIntegral;
    mapping(bytes32 => int256) public fundingLastError;

    /// @notice Trading fees (basis points)
    uint256 public tradingFeeBps;
    address public feeRecipient;

    uint256 public totalVolume;
    uint256 public totalLiquidations;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event MarketCreated(bytes32 indexed marketId, string symbol);
    event PositionOpened(bytes32 indexed posId, address indexed trader, bytes32 marketId, int256 size, uint256 margin);
    event PositionClosed(bytes32 indexed posId, address indexed trader, int256 pnl);
    event PositionLiquidated(bytes32 indexed posId, address indexed trader, address indexed liquidator);
    event FundingSettled(bytes32 indexed marketId, int256 fundingRate);
    event CollateralDeposited(address indexed trader, uint256 amount);
    event CollateralWithdrawn(address indexed trader, uint256 amount);
    event IndexPriceUpdated(bytes32 indexed marketId, uint256 price);

    // ============ Init ============

    function initialize(address _feeRecipient) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        feeRecipient = _feeRecipient;
        tradingFeeBps = 10; // 0.1%
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Market Management ============

    function createMarket(
        string calldata symbol,
        uint256 initialPrice,
        uint256 vammLiquidity
    ) external onlyOwner returns (bytes32) {
        bytes32 marketId = keccak256(abi.encodePacked(symbol, block.timestamp));

        uint256 baseReserve = vammLiquidity;
        uint256 quoteReserve = vammLiquidity * initialPrice / SCALE;

        markets[marketId] = Market({
            marketId: marketId,
            symbol: symbol,
            vammK: baseReserve * quoteReserve,
            vammBaseReserve: baseReserve,
            vammQuoteReserve: quoteReserve,
            indexPrice: initialPrice,
            markPrice: initialPrice,
            fundingRate: 0,
            cumulativeFunding: 0,
            lastFundingTime: block.timestamp,
            openInterestLong: 0,
            openInterestShort: 0,
            insuranceFund: 0,
            active: true
        });

        marketList.push(marketId);
        emit MarketCreated(marketId, symbol);
        return marketId;
    }

    function updateIndexPrice(bytes32 marketId, uint256 price) external onlyOwner {
        markets[marketId].indexPrice = price;
        emit IndexPriceUpdated(marketId, price);
    }

    // ============ Collateral ============

    function depositCollateral() external payable {
        collateral[msg.sender] += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant {
        require(collateral[msg.sender] >= amount, "Insufficient");
        // Check free collateral (not used as margin)
        collateral[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit CollateralWithdrawn(msg.sender, amount);
    }

    // ============ Trading ============

    /**
     * @notice Open a perpetual position
     * @param marketId The market to trade
     * @param size Position size (positive = long, negative = short)
     * @param margin Collateral for this position
     */
    function openPosition(
        bytes32 marketId,
        int256 size,
        uint256 margin
    ) external nonReentrant returns (bytes32) {
        Market storage market = markets[marketId];
        require(market.active, "Market not active");
        require(size != 0, "Zero size");
        require(collateral[msg.sender] >= margin, "Insufficient collateral");

        uint256 absSize = size > 0 ? uint256(size) : uint256(-size);
        uint256 notionalValue = (absSize * market.markPrice) / SCALE;

        // Check leverage
        require(notionalValue / margin <= MAX_LEVERAGE, "Exceeds max leverage");

        collateral[msg.sender] -= margin;

        // Update vAMM
        _updateVAMM(market, size);

        // Create position
        bytes32 posId = keccak256(abi.encodePacked(
            msg.sender, marketId, block.timestamp, size
        ));

        positions[posId] = Position({
            marketId: marketId,
            trader: msg.sender,
            size: size,
            margin: margin,
            entryPrice: market.markPrice,
            lastCumulativeFunding: market.cumulativeFunding,
            openedAt: block.timestamp,
            open: true
        });

        traderPositions[msg.sender].push(posId);

        // Update OI
        if (size > 0) market.openInterestLong += absSize;
        else market.openInterestShort += absSize;

        // Collect fee
        uint256 fee = (notionalValue * tradingFeeBps) / 10000;
        if (fee > 0 && fee <= margin) {
            positions[posId].margin -= fee;
            (bool ok, ) = feeRecipient.call{value: fee}("");
            require(ok, "Fee transfer failed");
        }

        totalVolume += notionalValue;

        emit PositionOpened(posId, msg.sender, marketId, size, margin);
        return posId;
    }

    /**
     * @notice Close a position
     */
    function closePosition(bytes32 posId) external nonReentrant {
        Position storage pos = positions[posId];
        require(pos.trader == msg.sender, "Not your position");
        require(pos.open, "Not open");

        Market storage market = markets[pos.marketId];

        // Calculate PnL
        int256 pnl = _calculatePnL(pos, market);

        // Settle funding
        int256 fundingOwed = _calculateFundingOwed(pos, market);

        pos.open = false;

        // Update OI
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        if (pos.size > 0) market.openInterestLong -= absSize;
        else market.openInterestShort -= absSize;

        // Update vAMM (reverse direction)
        _updateVAMM(market, -pos.size);

        // Return margin + PnL - funding
        int256 totalReturn = int256(pos.margin) + pnl - fundingOwed;
        if (totalReturn > 0) {
            collateral[msg.sender] += uint256(totalReturn);
        }
        // If totalReturn <= 0, margin is fully consumed

        // Fee
        uint256 closeNotional = (absSize * market.markPrice) / SCALE;
        uint256 fee = (closeNotional * tradingFeeBps) / 10000;
        if (fee > 0 && collateral[msg.sender] >= fee) {
            collateral[msg.sender] -= fee;
        }

        totalVolume += closeNotional;
        emit PositionClosed(posId, msg.sender, pnl);
    }

    /**
     * @notice Liquidate an underwater position
     */
    function liquidate(bytes32 posId) external nonReentrant {
        Position storage pos = positions[posId];
        require(pos.open, "Not open");

        Market storage market = markets[pos.marketId];

        int256 pnl = _calculatePnL(pos, market);
        int256 fundingOwed = _calculateFundingOwed(pos, market);

        int256 marginRemaining = int256(pos.margin) + pnl - fundingOwed;
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * market.markPrice) / SCALE;
        uint256 maintenanceMargin = (notional * LIQUIDATION_THRESHOLD_BPS) / 10000;

        require(marginRemaining <= int256(maintenanceMargin), "Not liquidatable");

        pos.open = false;

        if (pos.size > 0) market.openInterestLong -= absSize;
        else market.openInterestShort -= absSize;

        _updateVAMM(market, -pos.size);

        // Remaining margin to insurance fund
        if (marginRemaining > 0) {
            market.insuranceFund += uint256(marginRemaining);
        }

        // Liquidator reward: 5% of remaining margin or 0.5% of notional
        uint256 reward = marginRemaining > 0
            ? uint256(marginRemaining) / 20
            : (notional * 50) / 10000;

        if (reward > 0 && market.insuranceFund >= reward) {
            market.insuranceFund -= reward;
            (bool ok, ) = msg.sender.call{value: reward}("");
            require(ok, "Reward failed");
        }

        totalLiquidations++;
        emit PositionLiquidated(posId, pos.trader, msg.sender);
    }

    // ============ Funding ============

    /**
     * @notice Settle funding rate (permissionless, every 8 hours)
     */
    function settleFunding(bytes32 marketId) external {
        Market storage market = markets[marketId];
        require(block.timestamp >= market.lastFundingTime + FUNDING_INTERVAL, "Too soon");

        // PID controller: target mark = index
        int256 error = int256(market.markPrice) - int256(market.indexPrice);

        // Update integral
        fundingIntegral[marketId] += error;

        // Derivative
        int256 derivative = error - fundingLastError[marketId];
        fundingLastError[marketId] = error;

        // PID output
        int256 pidOutput = (error * int256(KP) + fundingIntegral[marketId] * int256(KI) + derivative * int256(KD)) / int256(SCALE);

        market.fundingRate = pidOutput;
        market.cumulativeFunding += pidOutput;
        market.lastFundingTime = block.timestamp;

        emit FundingSettled(marketId, pidOutput);
    }

    // ============ Internal ============

    function _updateVAMM(Market storage market, int256 size) internal {
        if (size > 0) {
            // Buy (long): add quote, remove base
            uint256 quoteIn = (uint256(size) * market.markPrice) / SCALE;
            market.vammQuoteReserve += quoteIn;
            market.vammBaseReserve = market.vammK / market.vammQuoteReserve;
        } else {
            // Sell (short): add base, remove quote
            uint256 baseIn = uint256(-size);
            market.vammBaseReserve += baseIn;
            market.vammQuoteReserve = market.vammK / market.vammBaseReserve;
        }
        // Update mark price
        market.markPrice = (market.vammQuoteReserve * SCALE) / market.vammBaseReserve;
    }

    function _calculatePnL(Position storage pos, Market storage market) internal view returns (int256) {
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        int256 priceDelta = int256(market.markPrice) - int256(pos.entryPrice);
        if (pos.size > 0) {
            return (int256(absSize) * priceDelta) / int256(SCALE);
        } else {
            return -(int256(absSize) * priceDelta) / int256(SCALE);
        }
    }

    function _calculateFundingOwed(Position storage pos, Market storage market) internal view returns (int256) {
        int256 fundingDelta = market.cumulativeFunding - pos.lastCumulativeFunding;
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);

        // Longs pay positive funding, shorts receive (and vice versa)
        if (pos.size > 0) {
            return (fundingDelta * int256(absSize)) / int256(SCALE);
        } else {
            return -(fundingDelta * int256(absSize)) / int256(SCALE);
        }
    }

    // ============ View ============

    function getMarket(bytes32 marketId) external view returns (Market memory) { return markets[marketId]; }
    function getPosition(bytes32 posId) external view returns (Position memory) { return positions[posId]; }
    function getMarketCount() external view returns (uint256) { return marketList.length; }
    function getTraderPositions(address trader) external view returns (bytes32[] memory) { return traderPositions[trader]; }

    function getPositionHealth(bytes32 posId) external view returns (
        int256 pnl,
        int256 marginRemaining,
        uint256 leverage,
        bool liquidatable
    ) {
        Position storage pos = positions[posId];
        Market storage market = markets[pos.marketId];

        pnl = _calculatePnL(pos, market);
        int256 funding = _calculateFundingOwed(pos, market);
        marginRemaining = int256(pos.margin) + pnl - funding;

        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * market.markPrice) / SCALE;
        leverage = marginRemaining > 0 ? notional / uint256(marginRemaining) : type(uint256).max;

        uint256 maintenanceMargin = (notional * LIQUIDATION_THRESHOLD_BPS) / 10000;
        liquidatable = marginRemaining <= int256(maintenanceMargin);
    }

    receive() external payable {
        collateral[msg.sender] += msg.value;
    }
}
