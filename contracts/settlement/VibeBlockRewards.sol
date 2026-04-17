// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeBlockRewards — Validator Reward Distribution for VibeStateChain
 * @notice Distributes block rewards to validators, subblock proposers, and
 *         uncle block miners. Implements NC-max reward curves with halvings.
 */
contract VibeBlockRewards is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    struct RewardEpoch {
        uint256 epochId;
        uint256 blockReward;
        uint256 subblockReward;
        uint256 uncleReward;
        uint256 blocksInEpoch;
        uint256 startBlock;
    }

    uint256 public constant INITIAL_BLOCK_REWARD = 0.01 ether;
    uint256 public constant BLOCKS_PER_EPOCH = 1000;
    uint256 public constant HALVING_INTERVAL = 10; // epochs

    mapping(uint256 => RewardEpoch) public epochs;
    uint256 public currentEpoch;
    mapping(address => uint256) public pendingRewards;
    uint256 public totalDistributed;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    event RewardDistributed(address indexed validator, uint256 amount, uint256 blockNumber);
    event EpochAdvanced(uint256 indexed epochId, uint256 newReward);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        currentEpoch = 1;
        epochs[1] = RewardEpoch(1, INITIAL_BLOCK_REWARD, INITIAL_BLOCK_REWARD / 6, INITIAL_BLOCK_REWARD / 2, 0, 0);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    function distributeBlockReward(address validator, uint256 blockNumber) external onlyOwner {
        RewardEpoch storage ep = epochs[currentEpoch];
        uint256 reward = ep.blockReward;
        pendingRewards[validator] += reward;
        ep.blocksInEpoch++;
        totalDistributed += reward;
        if (ep.blocksInEpoch >= BLOCKS_PER_EPOCH) _advanceEpoch();
        emit RewardDistributed(validator, reward, blockNumber);
    }

    function distributeSubblockReward(address proposer) external onlyOwner {
        uint256 reward = epochs[currentEpoch].subblockReward;
        pendingRewards[proposer] += reward;
        totalDistributed += reward;
    }

    function distributeUncleReward(address miner) external onlyOwner {
        uint256 reward = epochs[currentEpoch].uncleReward;
        pendingRewards[miner] += reward;
        totalDistributed += reward;
    }

    function claimRewards() external nonReentrant {
        uint256 amount = pendingRewards[msg.sender];
        require(amount > 0, "No rewards");
        pendingRewards[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Claim failed");
    }

    function _advanceEpoch() internal {
        currentEpoch++;
        uint256 halvings = (currentEpoch - 1) / HALVING_INTERVAL;
        uint256 reward = INITIAL_BLOCK_REWARD;
        for (uint256 i = 0; i < halvings && i < 20; i++) reward /= 2;
        epochs[currentEpoch] = RewardEpoch(currentEpoch, reward, reward / 6, reward / 2, 0, 0);
        emit EpochAdvanced(currentEpoch, reward);
    }

    function getEpoch(uint256 id) external view returns (RewardEpoch memory) { return epochs[id]; }
    function getPending(address v) external view returns (uint256) { return pendingRewards[v]; }
    receive() external payable {}
}
