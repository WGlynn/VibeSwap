// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IBondingCurveLauncher.sol";

/**
 * @title BondingCurveLauncher
 * @notice Permissionless token launches via linear bonding curves.
 *         Price rises as tokens are sold; graduates to AMM pool at target.
 *         Cooperative capitalism: fair price discovery, community-driven liquidity.
 */
contract BondingCurveLauncher is IBondingCurveLauncher, Ownable, ReentrancyGuard {

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint16 public constant MAX_CREATOR_FEE_BPS = 500; // 5%
    uint16 public constant PROTOCOL_FEE_BPS = 100;    // 1%

    // ============ State ============

    uint256 private _launchCount;
    mapping(uint256 => TokenLaunch) private _launches;
    mapping(uint256 => mapping(address => uint256)) private _userDeposits;

    address public treasury;

    // ============ Constructor ============

    constructor(address _treasury) Ownable(msg.sender) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ Core ============

    function createLaunch(
        address token,
        address reserveToken,
        uint256 initialPrice,
        uint256 curveSlope,
        uint256 graduationTarget,
        uint256 maxSupply,
        uint16 creatorFeeBps
    ) external returns (uint256 launchId) {
        if (token == address(0) || reserveToken == address(0)) revert ZeroAddress();
        if (initialPrice == 0 || maxSupply == 0 || graduationTarget == 0) revert InvalidParams();
        if (creatorFeeBps > MAX_CREATOR_FEE_BPS) revert FeeTooHigh();

        launchId = ++_launchCount;

        _launches[launchId] = TokenLaunch({
            token: token,
            reserveToken: reserveToken,
            creator: msg.sender,
            initialPrice: initialPrice,
            curveSlope: curveSlope,
            tokensSold: 0,
            reserveBalance: 0,
            graduationTarget: graduationTarget,
            maxSupply: maxSupply,
            creatorFeeBps: creatorFeeBps,
            state: LaunchState.ACTIVE
        });

        emit LaunchCreated(launchId, token, msg.sender, graduationTarget);
    }

    function buy(uint256 launchId, uint256 tokenAmount, uint256 maxCost) external nonReentrant {
        TokenLaunch storage launch = _launches[launchId];
        if (launch.state != LaunchState.ACTIVE) revert LaunchNotActive();
        if (tokenAmount == 0) revert ZeroAmount();
        if (launch.tokensSold + tokenAmount > launch.maxSupply) revert ExceedsMaxSupply();

        uint256 cost = _computeBuyCost(launch, tokenAmount);

        // Fees
        uint256 creatorFee = (cost * launch.creatorFeeBps) / 10000;
        uint256 protocolFee = (cost * PROTOCOL_FEE_BPS) / 10000;
        uint256 totalCost = cost + creatorFee + protocolFee;

        if (totalCost > maxCost) revert SlippageExceeded();

        // Transfer reserve from buyer
        _transferFrom(launch.reserveToken, msg.sender, address(this), totalCost);

        // Distribute fees
        if (creatorFee > 0) {
            _transfer(launch.reserveToken, launch.creator, creatorFee);
        }
        if (protocolFee > 0) {
            _transfer(launch.reserveToken, treasury, protocolFee);
        }

        // Update state
        launch.tokensSold += tokenAmount;
        launch.reserveBalance += cost;
        _userDeposits[launchId][msg.sender] += cost;

        // Transfer tokens to buyer
        _transfer(launch.token, msg.sender, tokenAmount);

        emit TokensBought(launchId, msg.sender, tokenAmount, totalCost);
    }

    function sell(uint256 launchId, uint256 tokenAmount, uint256 minProceeds) external nonReentrant {
        TokenLaunch storage launch = _launches[launchId];
        if (launch.state != LaunchState.ACTIVE) revert LaunchNotActive();
        if (tokenAmount == 0) revert ZeroAmount();
        if (tokenAmount > launch.tokensSold) revert InsufficientTokens();

        uint256 proceeds = _computeSellProceeds(launch, tokenAmount);

        // Protocol fee on sells
        uint256 protocolFee = (proceeds * PROTOCOL_FEE_BPS) / 10000;
        uint256 netProceeds = proceeds - protocolFee;

        if (netProceeds < minProceeds) revert SlippageExceeded();

        // Transfer tokens from seller
        _transferFrom(launch.token, msg.sender, address(this), tokenAmount);

        // Update state
        launch.tokensSold -= tokenAmount;
        launch.reserveBalance -= proceeds;

        // Update user deposit tracking (proportional reduction)
        uint256 userDep = _userDeposits[launchId][msg.sender];
        if (userDep > 0) {
            uint256 reduction = userDep < proceeds ? userDep : proceeds;
            _userDeposits[launchId][msg.sender] -= reduction;
        }

        // Transfer proceeds to seller
        _transfer(launch.reserveToken, msg.sender, netProceeds);
        if (protocolFee > 0) {
            _transfer(launch.reserveToken, treasury, protocolFee);
        }

        emit TokensSold(launchId, msg.sender, tokenAmount, netProceeds);
    }

    function graduate(uint256 launchId) external nonReentrant {
        TokenLaunch storage launch = _launches[launchId];
        if (launch.state != LaunchState.ACTIVE) revert LaunchNotActive();
        if (launch.reserveBalance < launch.graduationTarget) revert InvalidParams();

        launch.state = LaunchState.GRADUATED;

        // Reserve stays in contract for AMM pool seeding (future integration)
        emit LaunchGraduated(launchId, launch.reserveBalance);
    }

    function refund(uint256 launchId) external nonReentrant {
        TokenLaunch storage launch = _launches[launchId];
        if (launch.state != LaunchState.FAILED) revert LaunchNotFailed();

        uint256 deposit = _userDeposits[launchId][msg.sender];
        if (deposit == 0) revert NothingToRefund();

        _userDeposits[launchId][msg.sender] = 0;

        // Pro-rata refund from remaining reserve
        uint256 refundAmount = deposit;
        if (refundAmount > launch.reserveBalance) {
            refundAmount = launch.reserveBalance;
        }
        launch.reserveBalance -= refundAmount;

        _transfer(launch.reserveToken, msg.sender, refundAmount);

        emit RefundClaimed(launchId, msg.sender, refundAmount);
    }

    // ============ Admin ============

    function failLaunch(uint256 launchId) external onlyOwner {
        TokenLaunch storage launch = _launches[launchId];
        if (launch.state != LaunchState.ACTIVE) revert LaunchNotActive();
        launch.state = LaunchState.FAILED;
        emit LaunchFailed(launchId);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ Views ============

    function currentPrice(uint256 launchId) external view returns (uint256) {
        TokenLaunch storage launch = _launches[launchId];
        return _priceAtSupply(launch, launch.tokensSold);
    }

    function buyQuote(uint256 launchId, uint256 tokenAmount) external view returns (uint256 cost) {
        TokenLaunch storage launch = _launches[launchId];
        uint256 baseCost = _computeBuyCost(launch, tokenAmount);
        uint256 creatorFee = (baseCost * launch.creatorFeeBps) / 10000;
        uint256 protocolFee = (baseCost * PROTOCOL_FEE_BPS) / 10000;
        cost = baseCost + creatorFee + protocolFee;
    }

    function sellQuote(uint256 launchId, uint256 tokenAmount) external view returns (uint256 proceeds) {
        TokenLaunch storage launch = _launches[launchId];
        uint256 gross = _computeSellProceeds(launch, tokenAmount);
        uint256 protocolFee = (gross * PROTOCOL_FEE_BPS) / 10000;
        proceeds = gross - protocolFee;
    }

    function getLaunch(uint256 launchId) external view returns (TokenLaunch memory) {
        return _launches[launchId];
    }

    function getUserDeposit(uint256 launchId, address user) external view returns (uint256) {
        return _userDeposits[launchId][user];
    }

    function launchCount() external view returns (uint256) {
        return _launchCount;
    }

    // ============ Internal ============

    /// @dev Price at a given supply level: P = initialPrice + curveSlope * supply / PRECISION
    function _priceAtSupply(TokenLaunch storage launch, uint256 supply) internal view returns (uint256) {
        return launch.initialPrice + (launch.curveSlope * supply) / PRECISION;
    }

    /// @dev Cost to buy `amount` tokens via trapezoidal integration
    /// Area under curve from tokensSold to tokensSold + amount
    /// = amount * (priceStart + priceEnd) / 2
    function _computeBuyCost(TokenLaunch storage launch, uint256 amount) internal view returns (uint256) {
        uint256 priceStart = _priceAtSupply(launch, launch.tokensSold);
        uint256 priceEnd = _priceAtSupply(launch, launch.tokensSold + amount);
        return (amount * (priceStart + priceEnd)) / (2 * PRECISION);
    }

    /// @dev Proceeds from selling `amount` tokens (reverse integration)
    /// Area under curve from tokensSold - amount to tokensSold
    function _computeSellProceeds(TokenLaunch storage launch, uint256 amount) internal view returns (uint256) {
        uint256 priceEnd = _priceAtSupply(launch, launch.tokensSold);
        uint256 priceStart = _priceAtSupply(launch, launch.tokensSold - amount);
        return (amount * (priceStart + priceEnd)) / (2 * PRECISION);
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
