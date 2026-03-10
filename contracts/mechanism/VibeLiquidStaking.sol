// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeLiquidStaking — Liquid Staking Derivatives
 * @notice Stake ETH, receive vsETH (Vibe Staked ETH) that accrues value.
 *         Use vsETH in DeFi while earning staking rewards.
 *
 * Model:
 * - 1 vsETH = (totalETH / totalVsETH) ETH (appreciating exchange rate)
 * - Rewards distributed by increasing the ETH backing per vsETH
 * - Instant unstake via liquidity buffer (no waiting period)
 * - Protocol fee: 10% of staking rewards
 */
contract VibeLiquidStaking is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ State ============

    mapping(address => uint256) public vsEthBalance;
    uint256 public totalVsEth;
    uint256 public totalPooledEth;
    uint256 public liquidityBuffer;

    uint256 public constant PROTOCOL_FEE_BPS = 1000; // 10% of rewards
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint256 public constant BUFFER_TARGET_BPS = 500;  // 5% buffer target
    uint256 public constant HOLD_PERIOD = 1 days;     // Anti-MEV hold before unstake

    uint256 public totalRewardsDistributed;
    uint256 public protocolFees;
    uint256 public stakerCount;

    mapping(address => uint256) public stakedAt;

    // ============ Events ============

    event Staked(address indexed user, uint256 ethAmount, uint256 vsEthMinted);
    event Unstaked(address indexed user, uint256 vsEthBurned, uint256 ethReturned);
    event RewardsDistributed(uint256 rewards, uint256 protocolFee);
    event BufferReplenished(uint256 amount);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Staking ============

    /// @notice Stake ETH, receive vsETH
    function stake() external payable {
        require(msg.value >= MIN_STAKE, "Below minimum");

        uint256 vsEthToMint;
        if (totalVsEth == 0) {
            vsEthToMint = msg.value; // 1:1 initial rate
        } else {
            vsEthToMint = (msg.value * totalVsEth) / totalPooledEth;
        }

        require(vsEthToMint > 0, "Zero mint");

        if (vsEthBalance[msg.sender] == 0) stakerCount++;

        vsEthBalance[msg.sender] += vsEthToMint;
        totalVsEth += vsEthToMint;
        totalPooledEth += msg.value;
        stakedAt[msg.sender] = block.timestamp;

        // Allocate portion to buffer
        uint256 bufferAmount = (msg.value * BUFFER_TARGET_BPS) / 10000;
        liquidityBuffer += bufferAmount;

        emit Staked(msg.sender, msg.value, vsEthToMint);
    }

    /// @notice Unstake vsETH, receive ETH
    /// @dev 1-day hold period prevents sandwich attacks on reward distribution
    function unstake(uint256 vsEthAmount) external nonReentrant {
        require(vsEthAmount > 0, "Zero amount");
        require(vsEthBalance[msg.sender] >= vsEthAmount, "Insufficient vsETH");
        require(block.timestamp >= stakedAt[msg.sender] + HOLD_PERIOD, "Hold period active");

        uint256 ethToReturn = (vsEthAmount * totalPooledEth) / totalVsEth;
        require(ethToReturn <= liquidityBuffer, "Insufficient liquidity");

        vsEthBalance[msg.sender] -= vsEthAmount;
        totalVsEth -= vsEthAmount;
        totalPooledEth -= ethToReturn;
        liquidityBuffer -= ethToReturn;

        if (vsEthBalance[msg.sender] == 0) stakerCount--;

        (bool ok, ) = msg.sender.call{value: ethToReturn}("");
        require(ok, "Unstake failed");

        emit Unstaked(msg.sender, vsEthAmount, ethToReturn);
    }

    // ============ Rewards ============

    /// @notice Distribute staking rewards (increases ETH per vsETH)
    function distributeRewards() external payable onlyOwner {
        require(msg.value > 0, "Zero rewards");
        require(totalVsEth > 0, "No stakers");

        uint256 protocolFee = (msg.value * PROTOCOL_FEE_BPS) / 10000;
        uint256 netRewards = msg.value - protocolFee;

        totalPooledEth += netRewards;
        protocolFees += protocolFee;
        totalRewardsDistributed += netRewards;

        // Add to buffer proportionally
        uint256 bufferAdd = (netRewards * BUFFER_TARGET_BPS) / 10000;
        liquidityBuffer += bufferAdd;

        emit RewardsDistributed(netRewards, protocolFee);
    }

    // ============ Admin ============

    function withdrawProtocolFees() external onlyOwner nonReentrant {
        uint256 amount = protocolFees;
        protocolFees = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    function replenishBuffer() external payable onlyOwner {
        liquidityBuffer += msg.value;
        emit BufferReplenished(msg.value);
    }

    // ============ Views ============

    function getExchangeRate() public view returns (uint256) {
        if (totalVsEth == 0) return 1 ether;
        return (totalPooledEth * 1 ether) / totalVsEth;
    }

    function getEthValue(address user) external view returns (uint256) {
        if (totalVsEth == 0) return 0;
        return (vsEthBalance[user] * totalPooledEth) / totalVsEth;
    }

    function getBufferUtilization() external view returns (uint256) {
        if (totalPooledEth == 0) return 0;
        return (liquidityBuffer * 10000) / totalPooledEth;
    }

    receive() external payable {}
}
