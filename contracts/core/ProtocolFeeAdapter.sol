// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IProtocolFeeAdapter.sol";
import "./interfaces/IFeeRouter.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/**
 * @title ProtocolFeeAdapter
 * @notice Adapter that bridges fee-generating contracts to the cooperative distribution system.
 * @dev Part of VSOS (VibeSwap Operating System) DeFi/DeFAI layer.
 *
 *      Problem: VibeAMM, CommitRevealAuction, and other contracts send fees
 *      directly to treasury. This bypasses the cooperative distribution (FeeRouter)
 *      that splits revenue between treasury, insurance, revshare, and buyback.
 *
 *      Solution: Set this adapter as the "treasury" address on VibeAMM and other
 *      fee-generating contracts. Fees land here, then get forwarded through FeeRouter.
 *
 *      Flow:
 *        VibeAMM.collectFees() → sends tokens to this adapter (as "treasury")
 *        Anyone calls adapter.forwardFees(token) → forwards to FeeRouter.collectFee()
 *        FeeRouter.distribute() → splits to treasury/insurance/revshare/buyback
 *
 *      For ETH (priority bids):
 *        VibeSwapCore sends ETH here → adapter wraps or holds
 *        forwardETH() → forwards to FeeRouter (via WETH) or holds for MEV redistribution
 *
 *      Cooperative capitalism: no fee extraction bypasses the community-governed split.
 */
contract ProtocolFeeAdapter is IProtocolFeeAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    address private _feeRouter;
    address private _weth;

    mapping(address => uint256) private _totalForwarded;
    uint256 private _totalETHForwarded;

    // ============ Constructor ============

    constructor(address feeRouter_, address weth_) Ownable(msg.sender) {
        if (feeRouter_ == address(0) || weth_ == address(0)) revert ZeroAddress();
        _feeRouter = feeRouter_;
        _weth = weth_;
    }

    // ============ Receive ETH ============

    receive() external payable {}

    // ============ Core ============

    function forwardFees(address token) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();

        // Approve and forward to FeeRouter
        IERC20(token).safeIncreaseAllowance(_feeRouter, balance);
        IFeeRouter(_feeRouter).collectFee(token, balance);

        _totalForwarded[token] += balance;

        emit FeeForwarded(token, balance, msg.sender);
    }

    function forwardETH() external payable nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert ZeroAmount();

        // Wrap ETH to WETH so it flows through FeeRouter's cooperative distribution
        IWETH(_weth).deposit{value: balance}();
        IERC20(_weth).safeIncreaseAllowance(_feeRouter, balance);
        IFeeRouter(_feeRouter).collectFee(_weth, balance);

        _totalETHForwarded += balance;

        emit ETHForwarded(balance, msg.sender);
    }

    // ============ Admin ============

    function setFeeRouter(address newRouter) external onlyOwner {
        if (newRouter == address(0)) revert ZeroAddress();
        _feeRouter = newRouter;
        emit FeeRouterUpdated(newRouter);
    }

    /// @notice Emergency recover stuck tokens
    function recoverToken(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    // ============ Views ============

    function feeRouter() external view returns (address) { return _feeRouter; }
    function weth() external view returns (address) { return _weth; }
    function totalForwarded(address token) external view returns (uint256) { return _totalForwarded[token]; }
    function totalETHForwarded() external view returns (uint256) { return _totalETHForwarded; }
}
