// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeMultiSend — Batch Token Distribution
 * @notice Send tokens to multiple recipients in a single transaction.
 *         Essential for airdrops, payroll, reward distribution.
 *
 * Gas savings: ~50% cheaper than individual transfers for 100+ recipients.
 */
contract VibeMultiSend is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    uint256 public totalDistributions;
    uint256 public totalRecipients;
    uint256 public totalVolume;

    event MultiSendETH(address indexed sender, uint256 recipientCount, uint256 totalAmount);
    event MultiSendToken(address indexed sender, address token, uint256 recipientCount, uint256 totalAmount);

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    /// @notice Send ETH to multiple recipients
    function multiSendETH(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable nonReentrant {
        require(recipients.length == amounts.length, "Length mismatch");
        require(recipients.length > 0, "Empty");
        require(recipients.length <= 500, "Max 500 recipients");

        uint256 totalSent = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Zero address");
            require(amounts[i] > 0, "Zero amount");
            totalSent += amounts[i];
            (bool ok, ) = recipients[i].call{value: amounts[i]}("");
            require(ok, "Transfer failed");
        }

        require(totalSent <= msg.value, "Insufficient ETH");
        totalDistributions++;
        totalRecipients += recipients.length;
        totalVolume += totalSent;

        // Refund excess
        if (msg.value > totalSent) {
            (bool ok, ) = msg.sender.call{value: msg.value - totalSent}("");
            require(ok, "Refund failed");
        }

        emit MultiSendETH(msg.sender, recipients.length, totalSent);
    }

    /// @notice Send ERC20 tokens to multiple recipients
    function multiSendToken(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        require(recipients.length == amounts.length, "Length mismatch");
        require(recipients.length > 0 && recipients.length <= 500, "Invalid count");

        uint256 totalSent = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Zero address");
            totalSent += amounts[i];

            bytes memory data = abi.encodeWithSignature(
                "transferFrom(address,address,uint256)",
                msg.sender, recipients[i], amounts[i]
            );
            (bool ok, ) = token.call(data);
            require(ok, "Token transfer failed");
        }

        totalDistributions++;
        totalRecipients += recipients.length;

        emit MultiSendToken(msg.sender, token, recipients.length, totalSent);
    }

    /// @notice Send equal amounts of ETH to multiple recipients
    function multiSendEqual(address[] calldata recipients) external payable nonReentrant {
        require(recipients.length > 0 && recipients.length <= 500, "Invalid count");
        uint256 each = msg.value / recipients.length;
        require(each > 0, "Amount too small");

        for (uint256 i = 0; i < recipients.length; i++) {
            (bool ok, ) = recipients[i].call{value: each}("");
            require(ok, "Transfer failed");
        }

        totalDistributions++;
        totalRecipients += recipients.length;
        totalVolume += msg.value;

        emit MultiSendETH(msg.sender, recipients.length, msg.value);
    }

    receive() external payable {}
}
