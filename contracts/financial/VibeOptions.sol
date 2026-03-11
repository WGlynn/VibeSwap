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

    function writeOption(WriteParams calldata params)
        external
        nonReentrant
        returns (uint256 optionId)
    {
        if (params.amount == 0) revert InvalidAmount();
        if (params.strikePrice == 0) revert InvalidStrikePrice();
        if (params.expiry <= uint40(block.timestamp)) revert InvalidExpiry();
        if (params.exerciseWindow == 0) revert InvalidExerciseWindow();

        uint256 collateral = _calculateCollateral(
            params.optionType, params.amount, params.strikePrice
        );

        {
            IVibeAMM.Pool memory pool = amm.getPool(params.poolId);
            if (!pool.initialized) revert PoolNotInitialized();
            address collateralToken = params.optionType == OptionType.CALL
                ? pool.token0
                : pool.token1;
            IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateral);
        }

        optionId = _nextOptionId++;
        _safeMint(msg.sender, optionId);

        _storeOption(optionId, msg.sender, params, collateral);
        _writerOptions[msg.sender].push(optionId);
        _totalOptions++;
        _emitWritten(optionId, msg.sender, params);
    }

    function purchase(uint256 optionId) external nonReentrant {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        if (option.state != OptionState.WRITTEN) revert OptionAlreadyPurchased();
        if (uint40(block.timestamp) >= option.expiry) revert OptionExpired();

        if (option.premium > 0) {
            _transferCollateral(option.poolId, option.optionType, msg.sender, option.writer, option.premium);
        }

        _transfer(option.writer, msg.sender, optionId);
        option.state = OptionState.ACTIVE;

        emit OptionPurchased(optionId, msg.sender, option.premium);
    }

    function exercise(uint256 optionId) external nonReentrant {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        if (option.state == OptionState.EXERCISED) revert OptionAlreadyExercised();
        if (option.state != OptionState.ACTIVE) revert OptionNotActive();
        if (uint40(block.timestamp) < option.expiry) revert OptionNotExpired();
        if (uint40(block.timestamp) > option.exerciseEnd) revert ExerciseWindowClosed();

        address holder;
        uint256 payoff;
        {
            holder = _requireOwned(optionId);
            _checkAuthorized(holder, msg.sender, optionId);

            uint256 settlementPrice = _getSettlementPrice(option.poolId);
            payoff = _calculatePayoff(option, settlementPrice);
            if (payoff == 0) revert OptionOutOfTheMoney();
            if (payoff > option.collateral) payoff = option.collateral;
        }

        option.collateral -= payoff;
        option.state = OptionState.EXERCISED;

        _transferCollateral(option.poolId, option.optionType, address(this), holder, payoff);

        emit OptionExercised(optionId, holder, payoff);
    }

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
            _transferCollateral(option.poolId, option.optionType, address(this), option.writer, amount);
        }

        emit OptionReclaimed(optionId, option.writer, amount);
    }

    function cancel(uint256 optionId) external nonReentrant {
        Option storage option = _options[optionId];
        if (option.writer == address(0)) revert OptionNotFound();
        if (option.state != OptionState.WRITTEN) revert OptionAlreadyPurchased();
        if (msg.sender != option.writer) revert NotOptionWriter();

        uint256 collateral = option.collateral;
        option.collateral = 0;
        option.state = OptionState.CANCELED;

        _transferCollateral(option.poolId, option.optionType, address(this), option.writer, collateral);

        _burn(optionId);

        emit OptionCanceled(optionId);
    }

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

    function suggestPremium(
        bytes32 poolId,
        OptionType optionType,
        uint256 amount,
        uint256 strikePrice,
        uint40 expiry
    ) external view returns (uint256) {
        {
            IVibeAMM.Pool memory pool = amm.getPool(poolId);
            if (!pool.initialized) revert PoolNotInitialized();
        }

        uint256 spot = amm.getSpotPrice(poolId);
        if (spot == 0) return 0;

        uint256 sqrtT;
        {
            uint256 timeToExpiry = expiry > uint40(block.timestamp)
                ? uint256(expiry - uint40(block.timestamp))
                : 0;
            if (timeToExpiry == 0) return 0;
            uint256 T = (timeToExpiry * 1e18) / SECONDS_PER_YEAR;
            sqrtT = _sqrt(T * 1e18);
        }

        uint256 intrinsic;
        {
            if (optionType == OptionType.CALL && spot > strikePrice) {
                intrinsic = ((spot - strikePrice) * amount) / 1e18;
            } else if (optionType == OptionType.PUT && strikePrice > spot) {
                intrinsic = ((strikePrice - spot) * amount) / 1e18;
            }
        }

        uint256 vol = volatilityOracle.calculateRealizedVolatility(poolId, VOL_PERIOD);
        if (vol < MIN_VOLATILITY) vol = MIN_VOLATILITY;

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

    function _emitWritten(uint256 optionId, address writer, WriteParams calldata params) internal {
        emit OptionWritten(
            optionId, writer, params.poolId, params.optionType,
            params.amount, params.strikePrice, params.premium, params.expiry
        );
    }

    function _storeOption(
        uint256 optionId,
        address writer,
        WriteParams calldata params,
        uint256 collateral
    ) internal {
        _options[optionId] = Option({
            writer: writer,
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
    }

    function _getSettlementPrice(bytes32 poolId) internal view returns (uint256) {
        uint256 twap = amm.getTWAP(poolId, TWAP_PERIOD);
        if (twap > 0) return twap;
        return amm.getSpotPrice(poolId);
    }

    function _transferCollateral(
        bytes32 poolId,
        OptionType optionType,
        address from,
        address to,
        uint256 amount
    ) internal {
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        address token = optionType == OptionType.CALL ? pool.token0 : pool.token1;
        if (from == address(this)) {
            IERC20(token).safeTransfer(to, amount);
        } else {
            IERC20(token).safeTransferFrom(from, to, amount);
        }
    }

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
