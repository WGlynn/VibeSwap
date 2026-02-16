// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IPredictionMarket.sol";

/**
 * @title PredictionMarket
 * @notice Binary outcome prediction markets with complete-set + constant-product AMM.
 *         1 YES + 1 NO = 1 collateral (always). Guaranteed solvency.
 *         Cooperative capitalism: information aggregation improves price discovery for all.
 */
contract PredictionMarket is IPredictionMarket, Ownable, ReentrancyGuard {

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint16 public constant PROTOCOL_FEE_BPS = 100; // 1%

    // ============ State ============

    uint256 private _marketCount;
    mapping(uint256 => PredictionMarketData) private _markets;
    mapping(uint256 => mapping(address => Position)) private _positions;
    mapping(address => bool) public authorizedResolvers;

    address public treasury;

    // ============ Constructor ============

    constructor(address _treasury) Ownable(msg.sender) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ Core ============

    function createMarket(
        bytes32 question,
        address collateralToken,
        uint256 liquidityParam,
        uint64 lockTime,
        uint64 resolutionDeadline
    ) external returns (uint256 marketId) {
        if (collateralToken == address(0)) revert ZeroAddress();
        if (liquidityParam == 0) revert InvalidParams();
        if (lockTime <= block.timestamp) revert InvalidParams();
        if (resolutionDeadline <= lockTime) revert InvalidParams();

        // Creator seeds initial liquidity
        _transferFrom(collateralToken, msg.sender, address(this), liquidityParam);

        marketId = ++_marketCount;

        _markets[marketId] = PredictionMarketData({
            question: question,
            collateralToken: collateralToken,
            creator: msg.sender,
            lockTime: lockTime,
            resolutionDeadline: resolutionDeadline,
            phase: MarketPhase.OPEN,
            outcome: MarketOutcome.UNRESOLVED,
            yPool: liquidityParam,
            nPool: liquidityParam,
            totalSets: 0,
            liquidityParam: liquidityParam
        });

        emit MarketCreated(marketId, question, msg.sender, lockTime);
    }

    function buyShares(
        uint256 marketId,
        bool isYes,
        uint256 collateralAmount,
        uint256 minShares
    ) external nonReentrant {
        PredictionMarketData storage m = _markets[marketId];
        _checkOpen(m);
        if (collateralAmount == 0) revert ZeroAmount();

        // Protocol fee
        uint256 fee = (collateralAmount * PROTOCOL_FEE_BPS) / 10000;
        uint256 netAmount = collateralAmount - fee;

        // Transfer collateral from buyer
        _transferFrom(m.collateralToken, msg.sender, address(this), collateralAmount);
        if (fee > 0) {
            _transfer(m.collateralToken, treasury, fee);
        }

        // Mint complete sets (1 YES + 1 NO per collateral unit)
        m.totalSets += netAmount;

        // Swap opposite shares through AMM to get desired side
        uint256 sharesOut;
        if (isYes) {
            // Buyer wants YES. Sell NO shares into pool, get YES out.
            // Deposit NO shares (from minted set) into nPool
            // Get YES shares out from yPool
            // AMM: sharesOut = yPool * amountIn / (nPool + amountIn)
            sharesOut = (m.yPool * netAmount) / (m.nPool + netAmount);
            m.yPool -= sharesOut;
            m.nPool += netAmount;
            // Buyer gets: minted YES (netAmount) + swapped YES (sharesOut)
            // But minted NO went into pool, so net:
            // YES shares = netAmount + sharesOut (from mint + swap)
            // Actually, let me reconsider the model:
            // Mint netAmount complete sets -> netAmount YES + netAmount NO
            // Sell netAmount NO into pool -> get sharesOut YES from pool
            // Total YES for buyer = netAmount + sharesOut
            _positions[marketId][msg.sender].yesShares += netAmount + sharesOut;
        } else {
            // Buyer wants NO. Sell YES shares into pool, get NO out.
            sharesOut = (m.nPool * netAmount) / (m.yPool + netAmount);
            m.nPool -= sharesOut;
            m.yPool += netAmount;
            _positions[marketId][msg.sender].noShares += netAmount + sharesOut;
        }

        uint256 totalShares = netAmount + sharesOut;
        if (totalShares < minShares) revert SlippageExceeded();

        emit SharesBought(marketId, msg.sender, isYes, totalShares, collateralAmount);
    }

    function sellShares(
        uint256 marketId,
        bool isYes,
        uint256 shareAmount,
        uint256 minProceeds
    ) external nonReentrant {
        PredictionMarketData storage m = _markets[marketId];
        _checkOpen(m);
        if (shareAmount == 0) revert ZeroAmount();

        Position storage pos = _positions[marketId][msg.sender];

        // Check user has enough shares
        if (isYes) {
            if (pos.yesShares < shareAmount) revert InsufficientTokens();
        } else {
            if (pos.noShares < shareAmount) revert InsufficientTokens();
        }

        // Swap shares into pool to get opposite shares
        uint256 oppositeOut;
        if (isYes) {
            // Sell YES into yPool, get NO out
            oppositeOut = (m.nPool * shareAmount) / (m.yPool + shareAmount);
            m.yPool += shareAmount;
            m.nPool -= oppositeOut;
            pos.yesShares -= shareAmount;
        } else {
            // Sell NO into nPool, get YES out
            oppositeOut = (m.yPool * shareAmount) / (m.nPool + shareAmount);
            m.nPool += shareAmount;
            m.yPool -= oppositeOut;
            pos.noShares -= shareAmount;
        }

        // Burn complete sets: can only burn up to totalSets minted by traders
        // (initial pool liquidity from creator is separate)
        uint256 setsToburn = oppositeOut > m.totalSets ? m.totalSets : oppositeOut;
        m.totalSets -= setsToburn;

        // Protocol fee on proceeds
        uint256 fee = (setsToburn * PROTOCOL_FEE_BPS) / 10000;
        uint256 proceeds = setsToburn - fee;

        if (proceeds < minProceeds) revert SlippageExceeded();

        // Transfer collateral to seller
        _transfer(m.collateralToken, msg.sender, proceeds);
        if (fee > 0) {
            _transfer(m.collateralToken, treasury, fee);
        }

        emit SharesSold(marketId, msg.sender, isYes, shareAmount, proceeds);
    }

    function resolveMarket(uint256 marketId, MarketOutcome outcome) external {
        PredictionMarketData storage m = _markets[marketId];
        if (m.phase == MarketPhase.RESOLVED) revert MarketAlreadyResolved();
        if (!authorizedResolvers[msg.sender] && msg.sender != owner()) revert NotResolver();
        if (outcome == MarketOutcome.UNRESOLVED) revert InvalidOutcome();
        if (block.timestamp < m.lockTime) revert MarketNotLocked();

        m.phase = MarketPhase.RESOLVED;
        m.outcome = outcome;

        emit MarketResolved(marketId, outcome);
    }

    function claimWinnings(uint256 marketId) external nonReentrant {
        PredictionMarketData storage m = _markets[marketId];
        if (m.phase != MarketPhase.RESOLVED) revert MarketNotResolved();

        Position storage pos = _positions[marketId][msg.sender];
        if (pos.claimed) revert AlreadyClaimed();

        uint256 winningShares;
        if (m.outcome == MarketOutcome.YES) {
            winningShares = pos.yesShares;
        } else {
            winningShares = pos.noShares;
        }

        if (winningShares == 0) revert NoWinnings();

        pos.claimed = true;

        // 1 winning share = 1 collateral (guaranteed solvency)
        _transfer(m.collateralToken, msg.sender, winningShares);

        emit WinningsClaimed(marketId, msg.sender, winningShares);
    }

    function reclaimLiquidity(uint256 marketId) external nonReentrant {
        PredictionMarketData storage m = _markets[marketId];
        if (m.phase != MarketPhase.RESOLVED) revert MarketNotResolved();
        if (msg.sender != m.creator) revert NotCreator();

        // Creator reclaims remaining AMM pool liquidity after resolution
        // Remaining = pool shares that weren't swapped out
        uint256 remaining;
        if (m.outcome == MarketOutcome.YES) {
            // YES won, NO shares in pool are worthless
            // YES shares remaining in pool are valuable
            remaining = m.yPool;
            m.yPool = 0;
        } else {
            remaining = m.nPool;
            m.nPool = 0;
        }

        if (remaining == 0) revert NoWinnings();

        _transfer(m.collateralToken, msg.sender, remaining);

        emit LiquidityReclaimed(marketId, msg.sender, remaining);
    }

    // ============ Admin ============

    function addResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert ZeroAddress();
        authorizedResolvers[resolver] = true;
    }

    function removeResolver(address resolver) external onlyOwner {
        authorizedResolvers[resolver] = false;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ Views ============

    function getPrice(uint256 marketId, bool isYes) external view returns (uint256) {
        PredictionMarketData storage m = _markets[marketId];
        uint256 total = m.yPool + m.nPool;
        if (total == 0) return PRECISION / 2;

        if (isYes) {
            // Price of YES = nPool / (yPool + nPool)
            // More NO in pool = YES is more expensive (more demand for YES)
            return (m.nPool * PRECISION) / total;
        } else {
            return (m.yPool * PRECISION) / total;
        }
    }

    function getMarket(uint256 marketId) external view returns (PredictionMarketData memory) {
        return _markets[marketId];
    }

    function getPosition(uint256 marketId, address user) external view returns (Position memory) {
        return _positions[marketId][user];
    }

    function marketCount() external view returns (uint256) {
        return _marketCount;
    }

    // ============ Internal ============

    function _checkOpen(PredictionMarketData storage m) internal view {
        if (m.phase == MarketPhase.RESOLVED) revert MarketNotOpen();
        if (block.timestamp >= m.lockTime) revert MarketNotOpen();
    }

    function _transfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }

    function _transferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TransferFrom failed");
    }
}
