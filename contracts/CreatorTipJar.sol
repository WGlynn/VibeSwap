// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CreatorTipJar
 * @notice Voluntary donation contract for protocol creator
 * @dev Pure gratitude mechanism - no protocol extraction, no rent-seeking
 *
 * Philosophy:
 * - Tips are VOLUNTARY - never extracted from protocol fees
 * - No finder's fee, no protocol tax, no mandatory allocation
 * - Users tip AFTER receiving value, not before (retroactive gratitude)
 * - Transparent: anyone can verify all tips on-chain
 * - Minimal: no governance, no complexity, just a simple tip jar
 *
 * "The best systems reward creators through voluntary gratitude,
 *  not codified extraction." - VibeSwap Philosophy
 */
contract CreatorTipJar {
    using SafeERC20 for IERC20;

    // ============ State ============

    /// @notice Creator's address (immutable - set at deployment)
    address public immutable creator;

    /// @notice Total ETH tips received (lifetime)
    uint256 public totalEthTips;

    /// @notice Total tips per token (lifetime)
    mapping(address => uint256) public totalTokenTips;

    /// @notice Individual tip history (optional tracking)
    mapping(address => uint256) public tipperEthTotal;
    mapping(address => mapping(address => uint256)) public tipperTokenTotal;

    // ============ Events ============

    /// @notice Emitted when someone tips ETH
    event EthTip(address indexed tipper, uint256 amount, string message);

    /// @notice Emitted when someone tips tokens
    event TokenTip(address indexed tipper, address indexed token, uint256 amount, string message);

    /// @notice Emitted when creator withdraws
    event Withdrawal(address indexed token, uint256 amount);

    // ============ Constructor ============

    /**
     * @notice Deploy tip jar for a creator
     * @param _creator Address of the creator who can withdraw tips
     */
    constructor(address _creator) {
        require(_creator != address(0), "Invalid creator address");
        creator = _creator;
    }

    // ============ Tip Functions ============

    /**
     * @notice Tip ETH to the creator
     * @param message Optional message of gratitude
     */
    function tipEth(string calldata message) external payable {
        require(msg.value > 0, "Tip must be > 0");

        totalEthTips += msg.value;
        tipperEthTotal[msg.sender] += msg.value;

        emit EthTip(msg.sender, msg.value, message);
    }

    /**
     * @notice Tip tokens to the creator
     * @param token Token address to tip
     * @param amount Amount to tip
     * @param message Optional message of gratitude
     */
    function tipToken(
        address token,
        uint256 amount,
        string calldata message
    ) external {
        require(token != address(0), "Invalid token");
        require(amount > 0, "Tip must be > 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        totalTokenTips[token] += amount;
        tipperTokenTotal[msg.sender][token] += amount;

        emit TokenTip(msg.sender, token, amount, message);
    }

    /**
     * @notice Tip ETH directly by sending to contract
     */
    receive() external payable {
        if (msg.value > 0) {
            totalEthTips += msg.value;
            tipperEthTotal[msg.sender] += msg.value;
            emit EthTip(msg.sender, msg.value, "");
        }
    }

    // ============ Withdrawal (Creator Only) ============

    /**
     * @notice Withdraw ETH tips
     */
    function withdrawEth() external {
        require(msg.sender == creator, "Only creator");
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");

        (bool success, ) = creator.call{value: balance}("");
        require(success, "ETH transfer failed");

        emit Withdrawal(address(0), balance);
    }

    /**
     * @notice Withdraw token tips
     * @param token Token to withdraw
     */
    function withdrawToken(address token) external {
        require(msg.sender == creator, "Only creator");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        IERC20(token).safeTransfer(creator, balance);

        emit Withdrawal(token, balance);
    }

    // ============ View Functions ============

    /**
     * @notice Get total tips from a specific tipper
     * @param tipper Tipper address
     * @return ethAmount Total ETH tipped
     */
    function getTipperEthTotal(address tipper) external view returns (uint256) {
        return tipperEthTotal[tipper];
    }

    /**
     * @notice Get current contract balances
     * @return ethBalance Current ETH balance
     */
    function getBalance() external view returns (uint256 ethBalance) {
        return address(this).balance;
    }

    /**
     * @notice Get token balance
     * @param token Token address
     * @return balance Current token balance
     */
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
