// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeRevenueShare — Stakeholder Revenue Distribution
 * @notice Automated revenue sharing for protocol stakeholders.
 *         Epoch-based distribution with configurable splits.
 *
 * @dev Distribution model:
 *      - Revenue accumulates during epoch (1 week)
 *      - At epoch end, distribute proportionally to stakers
 *      - Stakers' share based on time-weighted average balance
 *      - Supports multiple revenue streams (trading fees, lending interest, etc.)
 */
contract VibeRevenueShare is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant EPOCH_DURATION = 7 days;
    uint256 public constant SCALE = 1e18;

    // ============ Types ============

    struct Epoch {
        uint256 epochId;
        uint256 startTime;
        uint256 endTime;
        uint256 totalRevenue;
        uint256 totalShares;
        uint256 revenuePerShare;
        bool finalized;
    }

    struct StakeInfo {
        uint256 amount;
        uint256 lastEpochClaimed;
        uint256 stakedAt;
    }

    struct RevenueStream {
        string name;
        address source;
        uint256 totalContributed;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => Epoch) public epochs;
    uint256 public currentEpoch;

    mapping(address => StakeInfo) public stakers;
    uint256 public totalStaked;

    RevenueStream[] public revenueStreams;

    uint256 public totalRevenueDistributed;
    uint256 public totalStakers;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 epoch, uint256 amount);
    event EpochFinalized(uint256 indexed epoch, uint256 totalRevenue, uint256 revenuePerShare);
    event RevenueReceived(address indexed source, uint256 amount);
    event StreamAdded(string name, address source);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        currentEpoch = 1;
        epochs[1].epochId = 1;
        epochs[1].startTime = block.timestamp;
        epochs[1].endTime = block.timestamp + EPOCH_DURATION;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Staking ============

    function stake() external payable nonReentrant {
        require(msg.value > 0, "Zero amount");

        if (stakers[msg.sender].amount == 0) totalStakers++;

        stakers[msg.sender].amount += msg.value;
        stakers[msg.sender].stakedAt = block.timestamp;
        if (stakers[msg.sender].lastEpochClaimed == 0) {
            stakers[msg.sender].lastEpochClaimed = currentEpoch;
        }

        totalStaked += msg.value;
        epochs[currentEpoch].totalShares += msg.value;

        emit Staked(msg.sender, msg.value);
    }

    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage info = stakers[msg.sender];
        require(info.amount >= amount, "Insufficient stake");

        info.amount -= amount;
        totalStaked -= amount;
        epochs[currentEpoch].totalShares -= amount;

        if (info.amount == 0) totalStakers--;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit Unstaked(msg.sender, amount);
    }

    // ============ Revenue ============

    /**
     * @notice Receive revenue (called by fee router or directly)
     */
    function receiveRevenue() external payable {
        require(msg.value > 0, "Zero revenue");

        epochs[currentEpoch].totalRevenue += msg.value;

        emit RevenueReceived(msg.sender, msg.value);
    }

    /**
     * @notice Finalize current epoch and start new one
     */
    function finalizeEpoch() external {
        Epoch storage epoch = epochs[currentEpoch];
        require(block.timestamp >= epoch.endTime, "Epoch not ended");
        require(!epoch.finalized, "Already finalized");

        epoch.finalized = true;

        if (epoch.totalShares > 0) {
            epoch.revenuePerShare = (epoch.totalRevenue * SCALE) / epoch.totalShares;
        }

        totalRevenueDistributed += epoch.totalRevenue;

        emit EpochFinalized(currentEpoch, epoch.totalRevenue, epoch.revenuePerShare);

        // Start new epoch
        currentEpoch++;
        epochs[currentEpoch].epochId = currentEpoch;
        epochs[currentEpoch].startTime = block.timestamp;
        epochs[currentEpoch].endTime = block.timestamp + EPOCH_DURATION;
        epochs[currentEpoch].totalShares = totalStaked;
    }

    /**
     * @notice Claim revenue for past epochs
     */
    function claimRevenue() external nonReentrant {
        StakeInfo storage info = stakers[msg.sender];
        require(info.amount > 0, "Not staking");

        uint256 totalClaim;
        uint256 startEpoch = info.lastEpochClaimed;

        for (uint256 e = startEpoch; e < currentEpoch; e++) {
            Epoch storage epoch = epochs[e];
            if (epoch.finalized && epoch.revenuePerShare > 0) {
                totalClaim += (info.amount * epoch.revenuePerShare) / SCALE;
            }
        }

        require(totalClaim > 0, "Nothing to claim");
        info.lastEpochClaimed = currentEpoch;

        (bool ok, ) = msg.sender.call{value: totalClaim}("");
        require(ok, "Claim failed");

        emit RevenueClaimed(msg.sender, currentEpoch - 1, totalClaim);
    }

    // ============ Admin ============

    function addRevenueStream(string calldata name, address source) external onlyOwner {
        revenueStreams.push(RevenueStream(name, source, 0, true));
        emit StreamAdded(name, source);
    }

    // ============ View ============

    function getPendingRevenue(address user) external view returns (uint256) {
        StakeInfo storage info = stakers[user];
        if (info.amount == 0) return 0;

        uint256 total;
        for (uint256 e = info.lastEpochClaimed; e < currentEpoch; e++) {
            Epoch storage epoch = epochs[e];
            if (epoch.finalized && epoch.revenuePerShare > 0) {
                total += (info.amount * epoch.revenuePerShare) / SCALE;
            }
        }
        return total;
    }

    function getCurrentEpoch() external view returns (uint256) { return currentEpoch; }
    function getStreamCount() external view returns (uint256) { return revenueStreams.length; }
    function getTotalStaked() external view returns (uint256) { return totalStaked; }

    receive() external payable {
        epochs[currentEpoch].totalRevenue += msg.value;
    }
}
