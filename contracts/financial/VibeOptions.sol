// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVibeOptions.sol";
import "../core/interfaces/IVibeAMM.sol";
import "../incentives/interfaces/IVolatilityOracle.sol";

/**
 * @title VibeOptions
 * @notice ERC-721 on-chain European-style options — calls and puts as transferable NFTs.
 * @dev Each option is fully collateralised by the writer. Cash-settled using TWAP
 *      pricing at exercise time (anti-MEV). Premium is market-driven (writer sets it),
 *      with a suggestPremium() view for reference via VolatilityOracle.
 *
 *      Lifecycle: write → purchase → exercise (after expiry) → reclaim (after window)
 *      Or:        write → cancel (if unpurchased)
 */
contract VibeOptions is ERC721, Ownable, ReentrancyGuard, IVibeOptions {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant SECONDS_PER_YEAR = 31_557_600;
    uint256 private constant MIN_VOLATILITY = 2000; // 20% floor in bps
    uint32 private constant TWAP_PERIOD = 600;      // 10 minutes
    uint32 private constant VOL_PERIOD = 3600;      // 1 hour

    // ============ State ============

    IVibeAMM public immutable amm;
    IVolatilityOracle public immutable volatilityOracle;

    uint256 private _nextOptionId = 1;
    uint256 private _totalOptions;

    mapping(uint256 => Option) private _options;
    mapping(address => uint256[]) private _writerOptions;
    mapping(address => uint256[]) private _ownedOptions;
    mapping(uint256 => uint256) private _ownedOptionIndex;

    // ============ Constructor ============

    constructor(
        address _amm,
        address _volatilityOracle
    ) ERC721("VibeSwap Option", "VOPT") Ownable(msg.sender) {
        require(_amm != address(0), "Invalid AMM");
        require(_volatilityOracle != address(0), "Invalid oracle");
        amm = IVibeAMM(_amm);
        volatilityOracle = IVolatilityOracle(_volatilityOracle);
    }

    // ============ Core Functions ============

    /**
     * @notice Write a new option — deposit collateral, mint NFT to writer
     * @param params WriteParams with pool, type, amount, strike, premium, expiry, window
     * @return optionId The minted option NFT token ID
     */
    function writeOption(WriteParams calldata params)
        external
        nonReentrant
        returns (uint256 optionId)
    {
        IVibeAMM.Pool memory pool = amm.getPool(params.poolId);
        if (!pool.initialized) revert PoolNotInitialized();
        if (params.amount == 0) revert InvalidAmount();
        if (params.strikePrice == 0) revert InvalidStrikePrice();
        if (params.expiry <= uint40(block.timestamp)) revert InvalidExpiry();
        if (params.exerciseWindow == 0) revert InvalidExerciseWindow();

        uint256 collateral = _calculateCollateral(
            params.optionType, params.amount, params.strikePrice
        );
        address collateralToken = params.optionType == OptionType.CALL
            ? pool.token0
            : pool.token1;

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateral);

        optionId = _nextOptionId++;
        _safeMint(msg.sender, optionId);

        _options[optionId] = Option({
            writer: msg.sender,
            expiry: params.expiry,
            exerciseEnd: params.expiry + params.exerciseWindow,
            optionType: params.optionType,
            state: OptionState.WRITTEN,
            poolId: params.poolId,
            amount: params.amount,
            strikePrice: params.strikePrice,
            collateral: collateral,
            premium: params.premium
        });

        _writerOptions[msg.sender].push(optionId);
        _totalOptions++;

        emit OptionWritten(
            optionId,
            msg.sender,
            params.poolId,
            params.optionType,
            params.amount,
            params.strikePrice,
            params.premium,
            params.expiry
        );
    }

    /**
     * @notice Purchase an option — pay premium to writer, receive NFT
     * @param optionId The option to purchase
     */
    function purchase(uint256 optionId) external nonReentrant {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        if (option.state != OptionState.WRITTEN) revert OptionAlreadyPurchased();
        if (uint40(block.timestamp) >= option.expiry) revert OptionExpired();

        if (option.premium > 0) {
            address collateralToken = _getCollateralToken(option.poolId, option.optionType);
            IERC20(collateralToken).safeTransferFrom(msg.sender, option.writer, option.premium);
        }

        _transfer(option.writer, msg.sender, optionId);
        option.state = OptionState.ACTIVE;

        emit OptionPurchased(optionId, msg.sender, option.premium);
    }

    /**
     * @notice Exercise an option after expiry — holder receives payoff from collateral
     * @dev Settlement price from TWAP (anti-MEV), with spot fallback
     * @param optionId The option to exercise
     */
    function exercise(uint256 optionId) external nonReentrant {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        if (option.state == OptionState.EXERCISED) revert OptionAlreadyExercised();
        if (option.state != OptionState.ACTIVE) revert OptionNotActive();
        if (uint40(block.timestamp) < option.expiry) revert OptionNotExpired();
        if (uint40(block.timestamp) > option.exerciseEnd) revert ExerciseWindowClosed();

        address holder = _requireOwned(optionId);
        _checkAuthorized(holder, msg.sender, optionId);

        uint256 settlementPrice = _getSettlementPrice(option.poolId);
        uint256 payoff = _calculatePayoff(option, settlementPrice);
        if (payoff == 0) revert OptionOutOfTheMoney();

        // Cap payoff at collateral (safety)
        if (payoff > option.collateral) payoff = option.collateral;

        // Update state before transfer (CEI)
        option.collateral -= payoff;
        option.state = OptionState.EXERCISED;

        address collateralToken = _getCollateralToken(option.poolId, option.optionType);
        IERC20(collateralToken).safeTransfer(holder, payoff);

        emit OptionExercised(optionId, holder, payoff);
    }

    /**
     * @notice Reclaim remaining collateral after exercise window closes
     * @dev Writer gets full collateral if unexercised, remainder if exercised
     * @param optionId The option to reclaim from
     */
    function reclaim(uint256 optionId) external nonReentrant {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        if (msg.sender != option.writer) revert NotOptionWriter();
        if (option.state == OptionState.RECLAIMED) revert OptionAlreadyReclaimed();
        if (option.state == OptionState.CANCELED) revert OptionNotFound();
        if (option.state == OptionState.WRITTEN) revert OptionNotPurchased();
        if (uint40(block.timestamp) <= option.exerciseEnd) revert OptionNotExpired();

        uint256 amount = option.collateral;
        option.collateral = 0;
        option.state = OptionState.RECLAIMED;

        if (amount > 0) {
            address collateralToken = _getCollateralToken(option.poolId, option.optionType);
            IERC20(collateralToken).safeTransfer(option.writer, amount);
        }

        emit OptionReclaimed(optionId, option.writer, amount);
    }

    /**
     * @notice Cancel an unpurchased option — writer gets collateral back, NFT burned
     * @param optionId The option to cancel
     */
    function cancel(uint256 optionId) external nonReentrant {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        if (option.state != OptionState.WRITTEN) revert OptionAlreadyPurchased();
        if (msg.sender != option.writer) revert NotOptionWriter();

        uint256 collateral = option.collateral;
        option.collateral = 0;
        option.state = OptionState.CANCELED;

        address collateralToken = _getCollateralToken(option.poolId, option.optionType);
        IERC20(collateralToken).safeTransfer(option.writer, collateral);

        _burn(optionId);

        emit OptionCanceled(optionId);
    }

    /**
     * @notice Burn a fully settled option NFT
     * @param optionId The option NFT to burn
     */
    function burn(uint256 optionId) external {
        address tokenOwner = _requireOwned(optionId);
        _checkAuthorized(tokenOwner, msg.sender, optionId);

        Option storage option = _options[optionId];

        bool settled = option.state == OptionState.EXERCISED
            || option.state == OptionState.RECLAIMED
            || (option.state == OptionState.ACTIVE && uint40(block.timestamp) > option.exerciseEnd);

        if (!settled) revert OptionNotActive();

        if (option.state == OptionState.RECLAIMED || option.collateral == 0) {
            delete _options[optionId];
        }

        _burn(optionId);
    }

    // ============ View Functions ============

    function getOption(uint256 optionId) external view returns (Option memory) {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        return option;
    }

    function getPayoff(uint256 optionId) external view returns (uint256) {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        uint256 settlementPrice = _getSettlementPrice(option.poolId);
        return _calculatePayoff(option, settlementPrice);
    }

    function isITM(uint256 optionId) external view returns (bool) {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        uint256 spot = amm.getSpotPrice(option.poolId);
        if (option.optionType == OptionType.CALL) {
            return spot > option.strikePrice;
        } else {
            return spot < option.strikePrice;
        }
    }

    /**
     * @notice Suggest a premium using a simplified Black-Scholes approximation
     * @dev Uses VolatilityOracle for vol, intrinsic + time-value model.
     *      This is a reference — writers set their own premiums.
     */
    function suggestPremium(
        bytes32 poolId,
        OptionType optionType,
        uint256 amount,
        uint256 strikePrice,
        uint40 expiry
    ) external view returns (uint256) {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        if (!pool.initialized) revert PoolNotInitialized();

        uint256 spot = amm.getSpotPrice(poolId);
        if (spot == 0) return 0;

        // Volatility with 20% floor
        uint256 vol = volatilityOracle.calculateRealizedVolatility(poolId, VOL_PERIOD);
        if (vol < MIN_VOLATILITY) vol = MIN_VOLATILITY;

        // Time to expiry in years (1e18 scale)
        uint256 timeToExpiry = expiry > uint40(block.timestamp)
            ? uint256(expiry - uint40(block.timestamp))
            : 0;
        if (timeToExpiry == 0) return 0;

        uint256 T = (timeToExpiry * 1e18) / SECONDS_PER_YEAR;
        uint256 sqrtT = _sqrt(T * 1e18);

        // Intrinsic value
        uint256 intrinsic = 0;
        if (optionType == OptionType.CALL && spot > strikePrice) {
            intrinsic = ((spot - strikePrice) * amount) / 1e18;
        } else if (optionType == OptionType.PUT && strikePrice > spot) {
            intrinsic = ((strikePrice - spot) * amount) / 1e18;
        }

        // Time value: amount × spot × vol × sqrtT / (1e18 × 10000 × 1e18)
        // Reorder to avoid overflow: (amount × spot / 1e18) × (vol × sqrtT / 10000) / 1e18
        uint256 timeValue = ((amount * spot) / 1e18) * ((vol * sqrtT) / 10000) / 1e18;

        return intrinsic + timeValue;
    }

    function getOptionsByOwner(address owner) external view returns (uint256[] memory) {
        return _ownedOptions[owner];
    }

    function getOptionsByWriter(address writer) external view returns (uint256[] memory) {
        return _writerOptions[writer];
    }

    function totalOptions() external view returns (uint256) {
        return _totalOptions;
    }

    // ============ Internal Functions ============

    /**
     * @notice Get settlement price — TWAP preferred, spot fallback (anti-MEV)
     */
    function _getSettlementPrice(bytes32 poolId) internal view returns (uint256) {
        uint256 twap = amm.getTWAP(poolId, TWAP_PERIOD);
        if (twap > 0) return twap;
        return amm.getSpotPrice(poolId);
    }

    /**
     * @notice Get collateral token for option type
     */
    function _getCollateralToken(bytes32 poolId, OptionType optionType)
        internal
        view
        returns (address)
    {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        return optionType == OptionType.CALL ? pool.token0 : pool.token1;
    }

    /**
     * @notice Calculate required collateral
     * @dev CALL: amount of token0. PUT: amount × strike / 1e18 of token1.
     */
    function _calculateCollateral(
        OptionType optionType,
        uint256 amount,
        uint256 strikePrice
    ) internal pure returns (uint256) {
        if (optionType == OptionType.CALL) {
            return amount;
        } else {
            return (amount * strikePrice) / 1e18;
        }
    }

    /**
     * @notice Calculate payoff given settlement price
     * @dev CALL: amount × (settlement - strike) / settlement (in token0)
     *      PUT:  amount × (strike - settlement) / 1e18       (in token1)
     */
    function _calculatePayoff(Option storage option, uint256 settlementPrice)
        internal
        view
        returns (uint256)
    {
        if (option.optionType == OptionType.CALL) {
            if (settlementPrice <= option.strikePrice) return 0;
            return (option.amount * (settlementPrice - option.strikePrice)) / settlementPrice;
        } else {
            if (settlementPrice >= option.strikePrice) return 0;
            return (option.amount * (option.strikePrice - settlementPrice)) / 1e18;
        }
    }

    /**
     * @notice Integer square root via Babylonian method
     */
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ============ ERC721 Overrides ============

    /**
     * @notice Track _ownedOptions on mint, burn, and transfer
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);

        if (from != address(0)) {
            _removeFromOwnedOptions(from, tokenId);
        }

        if (to != address(0)) {
            _ownedOptionIndex[tokenId] = _ownedOptions[to].length;
            _ownedOptions[to].push(tokenId);
        }

        return from;
    }

    /**
     * @notice O(1) swap-and-pop removal from owned options array
     */
    function _removeFromOwnedOptions(address owner, uint256 optionId) internal {
        uint256 idx = _ownedOptionIndex[optionId];
        uint256 lastIdx = _ownedOptions[owner].length - 1;

        if (idx != lastIdx) {
            uint256 lastOptionId = _ownedOptions[owner][lastIdx];
            _ownedOptions[owner][idx] = lastOptionId;
            _ownedOptionIndex[lastOptionId] = idx;
        }

        _ownedOptions[owner].pop();
        delete _ownedOptionIndex[optionId];
    }
}
