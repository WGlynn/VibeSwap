// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IFeeRouter.sol";

/**
 * @title FeeRouter
 * @notice Central protocol fee collector and distributor.
 * @dev Part of VSOS (VibeSwap Operating System) DeFi/DeFAI layer.
 *
 *      All protocol revenue flows through FeeRouter:
 *        - AMM swap fees (VibeAMM)
 *        - Priority bid revenue (CommitRevealAuction → MEVRedistributor → FeeRouter)
 *        - Bridge fees (CrossChainRouter)
 *        - Strategy vault performance fees (StrategyVault)
 *        - Liquidation fees (DutchAuctionLiquidator)
 *
 *      Revenue is distributed according to governance-configured splits:
 *        - DAOTreasury: operational funding and POL
 *        - Insurance: mutualized protection pools
 *        - RevShare: direct distribution to JUL stakers
 *        - Buyback: protocol buyback-and-burn for value accrual
 *
 *      Cooperative capitalism:
 *        - Transparent accounting: all flows visible on-chain
 *        - Governance-directed: community controls split ratios
 *        - No hidden extraction: every wei accounted for
 *        - Multi-token support: works with any ERC-20
 *
 *      Default split: 40% treasury, 20% insurance, 30% revshare, 10% buyback
 */
contract FeeRouter is IFeeRouter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;

    // ============ State ============

    FeeConfig private _config;

    address private _treasury;
    address private _insurance;
    address private _revShare;
    address private _buybackTarget;

    mapping(address => bool) private _authorizedSources;
    mapping(address => TokenAccounting) private _accounting;
    address[] private _trackedTokens;
    mapping(address => bool) private _tokenTracked;

    // ============ Constructor ============

    constructor(
        address treasury_,
        address insurance_,
        address revShare_,
        address buybackTarget_
    ) Ownable(msg.sender) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (insurance_ == address(0)) revert ZeroAddress();
        if (revShare_ == address(0)) revert ZeroAddress();
        if (buybackTarget_ == address(0)) revert ZeroAddress();

        _treasury = treasury_;
        _insurance = insurance_;
        _revShare = revShare_;
        _buybackTarget = buybackTarget_;

        // Default split: 40/20/30/10
        _config = FeeConfig({
            treasuryBps: 4000,
            insuranceBps: 2000,
            revShareBps: 3000,
            buybackBps: 1000
        });
    }

    // ============ Fee Collection ============

    function collectFee(address token, uint256 amount) external nonReentrant {
        if (!_authorizedSources[msg.sender] && msg.sender != owner()) revert UnauthorizedSource();
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        _accounting[token].totalCollected += amount;
        _accounting[token].pending += amount;

        // Track token for enumeration
        if (!_tokenTracked[token]) {
            _trackedTokens.push(token);
            _tokenTracked[token] = true;
        }

        emit FeeCollected(msg.sender, token, amount);
    }

    // ============ Distribution ============

    function distribute(address token) public nonReentrant {
        uint256 pending = _accounting[token].pending;
        if (pending == 0) revert NothingToDistribute();

        uint256 toTreasury = (pending * _config.treasuryBps) / BPS;
        uint256 toInsurance = (pending * _config.insuranceBps) / BPS;
        uint256 toRevShare = (pending * _config.revShareBps) / BPS;
        uint256 toBuyback = pending - toTreasury - toInsurance - toRevShare; // dust goes to buyback

        _accounting[token].pending = 0;
        _accounting[token].totalDistributed += pending;

        if (toTreasury > 0) {
            IERC20(token).safeTransfer(_treasury, toTreasury);
        }
        if (toInsurance > 0) {
            IERC20(token).safeTransfer(_insurance, toInsurance);
        }
        if (toRevShare > 0) {
            IERC20(token).safeTransfer(_revShare, toRevShare);
        }
        if (toBuyback > 0) {
            IERC20(token).safeTransfer(_buybackTarget, toBuyback);
            emit BuybackExecuted(token, toBuyback, _buybackTarget);
        }

        emit FeeDistributed(token, toTreasury, toInsurance, toRevShare, toBuyback);
    }

    function distributeMultiple(address[] calldata tokens) external {
        for (uint256 i; i < tokens.length; ++i) {
            if (_accounting[tokens[i]].pending > 0) {
                distribute(tokens[i]);
            }
        }
    }

    // ============ Configuration ============

    function updateConfig(FeeConfig calldata newConfig) external onlyOwner {
        uint256 total = uint256(newConfig.treasuryBps) +
            uint256(newConfig.insuranceBps) +
            uint256(newConfig.revShareBps) +
            uint256(newConfig.buybackBps);

        if (total != BPS) revert InvalidConfig();

        _config = newConfig;

        emit ConfigUpdated(
            newConfig.treasuryBps,
            newConfig.insuranceBps,
            newConfig.revShareBps,
            newConfig.buybackBps
        );
    }

    function authorizeSource(address source) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        _authorizedSources[source] = true;
        emit SourceAuthorized(source);
    }

    function revokeSource(address source) external onlyOwner {
        _authorizedSources[source] = false;
        emit SourceRevoked(source);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        _treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setInsurance(address newInsurance) external onlyOwner {
        if (newInsurance == address(0)) revert ZeroAddress();
        _insurance = newInsurance;
        emit InsuranceUpdated(newInsurance);
    }

    function setRevShare(address newRevShare) external onlyOwner {
        if (newRevShare == address(0)) revert ZeroAddress();
        _revShare = newRevShare;
        emit RevShareUpdated(newRevShare);
    }

    function setBuybackTarget(address newTarget) external onlyOwner {
        if (newTarget == address(0)) revert ZeroAddress();
        _buybackTarget = newTarget;
        emit BuybackTargetUpdated(newTarget);
    }

    function emergencyRecover(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyRecovered(token, amount, to);
    }

    // ============ Views ============

    function config() external view returns (FeeConfig memory) { return _config; }
    function treasury() external view returns (address) { return _treasury; }
    function insurance() external view returns (address) { return _insurance; }
    function revShare() external view returns (address) { return _revShare; }
    function buybackTarget() external view returns (address) { return _buybackTarget; }

    function pendingFees(address token) external view returns (uint256) {
        return _accounting[token].pending;
    }

    function totalCollected(address token) external view returns (uint256) {
        return _accounting[token].totalCollected;
    }

    function totalDistributed(address token) external view returns (uint256) {
        return _accounting[token].totalDistributed;
    }

    function isAuthorizedSource(address source) external view returns (bool) {
        return _authorizedSources[source];
    }
}
