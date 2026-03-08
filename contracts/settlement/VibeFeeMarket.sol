// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title VibeFeeMarket — EIP-1559 style dynamic fee market for state chain
/// @notice Base fee adjusts per-block based on gas utilization
contract VibeFeeMarket is OwnableUpgradeable, UUPSUpgradeable {
    uint256 public baseFee;
    uint256 public constant TARGET_GAS = 15_000_000;
    uint256 public constant MAX_GAS = 30_000_000;
    uint256 public constant ADJUSTMENT_DENOMINATOR = 8;
    uint256 public constant MIN_BASE_FEE = 1 gwei;
    uint256 public totalFeeBurned;
    uint256 public totalPriorityFees;
    mapping(uint256 => uint256) public blockGasUsed;
    mapping(uint256 => uint256) public blockBaseFee;
    event BaseFeeUpdated(uint256 indexed blockNumber, uint256 newBaseFee, uint256 gasUsed);

    function initialize() external initializer { __Ownable_init(msg.sender); __UUPSUpgradeable_init(); baseFee = 100 gwei; }
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function recordBlock(uint256 blockNumber, uint256 gasUsed) external onlyOwner {
        blockGasUsed[blockNumber] = gasUsed;
        blockBaseFee[blockNumber] = baseFee;
        if (gasUsed > TARGET_GAS) {
            uint256 delta = baseFee * (gasUsed - TARGET_GAS) / TARGET_GAS / ADJUSTMENT_DENOMINATOR;
            baseFee += delta > 0 ? delta : 1;
        } else if (gasUsed < TARGET_GAS) {
            uint256 delta = baseFee * (TARGET_GAS - gasUsed) / TARGET_GAS / ADJUSTMENT_DENOMINATOR;
            baseFee = baseFee > delta + MIN_BASE_FEE ? baseFee - delta : MIN_BASE_FEE;
        }
        totalFeeBurned += baseFee * gasUsed;
        emit BaseFeeUpdated(blockNumber, baseFee, gasUsed);
    }
    function getBaseFee() external view returns (uint256) { return baseFee; }
    receive() external payable {}
}
