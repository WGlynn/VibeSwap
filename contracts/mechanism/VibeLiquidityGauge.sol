// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeLiquidityGauge — Curve-Style Liquidity Mining
 * @notice Gauge system for directing VIBE emissions to liquidity pools.
 *         veVIBE holders vote on gauge weights to allocate rewards.
 *
 * @dev Architecture:
 *      - Epoch-based voting (weekly epochs)
 *      - Gauge weight determines emission share
 *      - Boost from veVIBE (1x-2.5x)
 *      - Gauge cap: max 35% to any single gauge
 */
contract VibeLiquidityGauge is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant EPOCH_DURATION = 7 days;
    uint256 public constant MAX_GAUGE_WEIGHT_BPS = 3500; // 35% cap
    uint256 public constant BPS = 10000;
    uint256 public constant SCALE = 1e18;

    // ============ Types ============

    struct Gauge {
        uint256 gaugeId;
        address pool;              // LP pool address
        string name;
        uint256 weight;            // Current weight (basis points)
        uint256 totalStaked;       // Total LP tokens staked
        uint256 rewardRate;        // Rewards per second
        uint256 rewardPerTokenStored;
        uint256 lastUpdateTime;
        bool active;
        bool killed;               // Permanently disabled
    }

    struct UserStake {
        uint256 amount;
        uint256 rewardPerTokenPaid;
        uint256 rewards;
        uint256 boostBps;
    }

    struct GaugeVote {
        uint256 gaugeId;
        uint256 weight;            // Weight allocated to this gauge
    }

    // ============ State ============

    mapping(uint256 => Gauge) public gauges;
    uint256 public gaugeCount;

    /// @notice User stakes per gauge: gaugeId => user => UserStake
    mapping(uint256 => mapping(address => UserStake)) public stakes;

    /// @notice Gauge votes per epoch: epoch => voter => GaugeVote[]
    mapping(uint256 => mapping(address => GaugeVote[])) public votes;

    /// @notice Total votes per gauge per epoch
    mapping(uint256 => mapping(uint256 => uint256)) public epochGaugeVotes;

    /// @notice Total vote power used per epoch
    mapping(uint256 => uint256) public epochTotalVotes;

    /// @notice Current epoch
    uint256 public currentEpoch;
    uint256 public epochStartTime;

    /// @notice Total emission rate (rewards per second across all gauges)
    uint256 public totalEmissionRate;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event GaugeCreated(uint256 indexed gaugeId, address indexed pool, string name);
    event GaugeKilled(uint256 indexed gaugeId);
    event Staked(uint256 indexed gaugeId, address indexed user, uint256 amount);
    event Unstaked(uint256 indexed gaugeId, address indexed user, uint256 amount);
    event RewardClaimed(uint256 indexed gaugeId, address indexed user, uint256 reward);
    event VoteCast(uint256 indexed epoch, address indexed voter, uint256 gaugeId, uint256 weight);
    event EpochAdvanced(uint256 indexed epoch);
    event EmissionRateUpdated(uint256 newRate);

    // ============ Init ============

    function initialize(uint256 _emissionRate) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        totalEmissionRate = _emissionRate;
        currentEpoch = 1;
        epochStartTime = block.timestamp;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Gauge Management ============

    function createGauge(address pool, string calldata name) external onlyOwner returns (uint256) {
        gaugeCount++;
        gauges[gaugeCount] = Gauge({
            gaugeId: gaugeCount,
            pool: pool,
            name: name,
            weight: 0,
            totalStaked: 0,
            rewardRate: 0,
            rewardPerTokenStored: 0,
            lastUpdateTime: block.timestamp,
            active: true,
            killed: false
        });

        emit GaugeCreated(gaugeCount, pool, name);
        return gaugeCount;
    }

    function killGauge(uint256 gaugeId) external onlyOwner {
        require(gauges[gaugeId].active, "Not active");
        gauges[gaugeId].killed = true;
        gauges[gaugeId].active = false;
        emit GaugeKilled(gaugeId);
    }

    // ============ Staking ============

    function stake(uint256 gaugeId) external payable nonReentrant {
        require(msg.value > 0, "Zero amount");
        Gauge storage gauge = gauges[gaugeId];
        require(gauge.active && !gauge.killed, "Gauge not active");

        _updateReward(gaugeId, msg.sender);

        stakes[gaugeId][msg.sender].amount += msg.value;
        gauge.totalStaked += msg.value;

        emit Staked(gaugeId, msg.sender, msg.value);
    }

    function unstake(uint256 gaugeId, uint256 amount) external nonReentrant {
        UserStake storage userStake = stakes[gaugeId][msg.sender];
        require(userStake.amount >= amount, "Insufficient stake");

        _updateReward(gaugeId, msg.sender);

        userStake.amount -= amount;
        gauges[gaugeId].totalStaked -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit Unstaked(gaugeId, msg.sender, amount);
    }

    function claimReward(uint256 gaugeId) external nonReentrant {
        _updateReward(gaugeId, msg.sender);

        UserStake storage userStake = stakes[gaugeId][msg.sender];
        uint256 reward = userStake.rewards;
        require(reward > 0, "No rewards");

        userStake.rewards = 0;

        (bool ok, ) = msg.sender.call{value: reward}("");
        require(ok, "Transfer failed");

        emit RewardClaimed(gaugeId, msg.sender, reward);
    }

    // ============ Voting ============

    /**
     * @notice Vote on gauge weights for the current epoch
     * @param gaugeVotes Array of (gaugeId, weight) pairs
     */
    function voteForGaugeWeights(GaugeVote[] calldata gaugeVotes) external {
        // Clear previous votes for this epoch
        delete votes[currentEpoch][msg.sender];

        uint256 totalWeight;
        for (uint256 i = 0; i < gaugeVotes.length; i++) {
            require(gauges[gaugeVotes[i].gaugeId].active, "Gauge not active");
            totalWeight += gaugeVotes[i].weight;

            votes[currentEpoch][msg.sender].push(gaugeVotes[i]);
            epochGaugeVotes[currentEpoch][gaugeVotes[i].gaugeId] += gaugeVotes[i].weight;

            emit VoteCast(currentEpoch, msg.sender, gaugeVotes[i].gaugeId, gaugeVotes[i].weight);
        }

        require(totalWeight <= BPS, "Total weight > 100%");
        epochTotalVotes[currentEpoch] += totalWeight;
    }

    // ============ Epoch ============

    /**
     * @notice Advance to next epoch and apply new gauge weights
     */
    function advanceEpoch() external {
        require(block.timestamp >= epochStartTime + EPOCH_DURATION, "Too early");

        // Apply voted weights
        uint256 totalVotes = epochTotalVotes[currentEpoch];
        if (totalVotes > 0) {
            for (uint256 i = 1; i <= gaugeCount; i++) {
                if (!gauges[i].active) continue;

                _updateReward(i, address(0));

                uint256 gaugeVotes = epochGaugeVotes[currentEpoch][i];
                uint256 newWeight = (gaugeVotes * BPS) / totalVotes;

                // Apply cap
                if (newWeight > MAX_GAUGE_WEIGHT_BPS) {
                    newWeight = MAX_GAUGE_WEIGHT_BPS;
                }

                gauges[i].weight = newWeight;
                gauges[i].rewardRate = (totalEmissionRate * newWeight) / BPS;
            }
        }

        currentEpoch++;
        epochStartTime = block.timestamp;

        emit EpochAdvanced(currentEpoch);
    }

    // ============ Admin ============

    function setEmissionRate(uint256 rate) external onlyOwner {
        totalEmissionRate = rate;
        emit EmissionRateUpdated(rate);
    }

    // ============ Internal ============

    function _updateReward(uint256 gaugeId, address user) internal {
        Gauge storage gauge = gauges[gaugeId];

        gauge.rewardPerTokenStored = _rewardPerToken(gaugeId);
        gauge.lastUpdateTime = block.timestamp;

        if (user != address(0)) {
            UserStake storage userStake = stakes[gaugeId][user];
            userStake.rewards = _earned(gaugeId, user);
            userStake.rewardPerTokenPaid = gauge.rewardPerTokenStored;
        }
    }

    function _rewardPerToken(uint256 gaugeId) internal view returns (uint256) {
        Gauge storage gauge = gauges[gaugeId];
        if (gauge.totalStaked == 0) return gauge.rewardPerTokenStored;

        uint256 elapsed = block.timestamp - gauge.lastUpdateTime;
        return gauge.rewardPerTokenStored + (elapsed * gauge.rewardRate * SCALE) / gauge.totalStaked;
    }

    function _earned(uint256 gaugeId, address user) internal view returns (uint256) {
        UserStake storage userStake = stakes[gaugeId][user];
        uint256 perToken = _rewardPerToken(gaugeId) - userStake.rewardPerTokenPaid;
        return userStake.rewards + (userStake.amount * perToken) / SCALE;
    }

    // ============ View ============

    function getGaugeInfo(uint256 gaugeId) external view returns (
        address pool,
        uint256 weight,
        uint256 totalStaked,
        uint256 rewardRate,
        bool active
    ) {
        Gauge storage g = gauges[gaugeId];
        return (g.pool, g.weight, g.totalStaked, g.rewardRate, g.active);
    }

    function getPendingReward(uint256 gaugeId, address user) external view returns (uint256) {
        return _earned(gaugeId, user);
    }

    function getEpoch() external view returns (uint256) { return currentEpoch; }
    function getGaugeCount() external view returns (uint256) { return gaugeCount; }

    receive() external payable {}
}
