// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ShardOperatorRegistry — CKA Shard Node Management
 * @notice Registers shard nodes, tracks cells served, distributes secondary issuance.
 *
 * @dev Shard nodes are CKA protocol nodes that:
 *   - Store and serve CKA cells to clients
 *   - Participate in BFT consensus (if authority type)
 *   - Stake CKB-native as collateral
 *   - Earn secondary issuance proportional to (cells_served × uptime × stake)
 *
 *   The shard network IS the protocol. Each TG bot instance running Jarvis
 *   is a shard node storing cells, serving queries, participating in consensus.
 *
 *   Uses Masterchef-style accRewardPerShare for O(1) reward distribution.
 */
contract ShardOperatorRegistry is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    uint256 public constant HEARTBEAT_INTERVAL = 24 hours;
    uint256 public constant HEARTBEAT_GRACE = 48 hours;
    uint256 public constant MIN_STAKE = 100e18;
    uint256 private constant ACC_PRECISION = 1e18;

    // ============ State ============

    IERC20 public ckbToken;

    struct Shard {
        address operator;
        bytes32 shardId;
        uint256 stake;
        uint256 cellsServed;
        uint256 lastHeartbeat;
        uint256 registeredAt;
        uint256 rewardDebt;
        bool active;
    }

    mapping(bytes32 => Shard) public shards;
    mapping(address => bytes32) public operatorShard;
    bytes32[] public shardList;
    uint256 public activeShardCount;

    /// @notice Total stake across all active shards
    uint256 public totalStaked;

    /// @notice Total cells served across all active shards
    uint256 public totalCellsServed;

    /// @notice Accumulated reward per weighted share
    uint256 public accRewardPerShare;

    /// @notice Total weight (sum of each shard's cells × stake product)
    uint256 public totalWeight;

    /// @dev Reserved storage gap
    uint256[50] private __gap;

    // ============ Events ============

    event ShardRegistered(bytes32 indexed shardId, address indexed operator, uint256 stake);
    event ShardDeactivated(bytes32 indexed shardId, string reason);
    event CellsReported(bytes32 indexed shardId, uint256 cellCount);
    event HeartbeatReceived(bytes32 indexed shardId, uint256 timestamp);
    event RewardClaimed(address indexed operator, uint256 amount);
    event RewardsDistributed(uint256 amount, uint256 newAccRewardPerShare);

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientStake();
    error NotActive();
    error ZeroAmount();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _ckbToken, address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        ckbToken = IERC20(_ckbToken);
    }

    // ============ Registration ============

    /**
     * @notice Register a shard node with CKB-native stake
     */
    function registerShard(bytes32 shardId, uint256 stakeAmount) external nonReentrant {
        if (operatorShard[msg.sender] != bytes32(0)) revert AlreadyRegistered();
        if (stakeAmount < MIN_STAKE) revert InsufficientStake();

        ckbToken.transferFrom(msg.sender, address(this), stakeAmount);

        shards[shardId] = Shard({
            operator: msg.sender,
            shardId: shardId,
            stake: stakeAmount,
            cellsServed: 0,
            lastHeartbeat: block.timestamp,
            registeredAt: block.timestamp,
            rewardDebt: 0,
            active: true
        });

        operatorShard[msg.sender] = shardId;
        shardList.push(shardId);
        activeShardCount++;
        totalStaked += stakeAmount;

        emit ShardRegistered(shardId, msg.sender, stakeAmount);
    }

    // ============ Operations ============

    /**
     * @notice Report cells being served by this shard
     */
    function reportCellsServed(uint256 cellCount) external {
        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        Shard storage shard = shards[shardId];
        if (!shard.active) revert NotActive();

        // Update weight: remove old, add new
        uint256 oldWeight = _shardWeight(shard);
        shard.cellsServed = cellCount;
        uint256 newWeight = _shardWeight(shard);

        if (oldWeight > 0) totalWeight -= oldWeight;
        totalWeight += newWeight;

        // Update total cells
        totalCellsServed = 0;
        for (uint256 i = 0; i < shardList.length; i++) {
            if (shards[shardList[i]].active) {
                totalCellsServed += shards[shardList[i]].cellsServed;
            }
        }

        emit CellsReported(shardId, cellCount);
    }

    /**
     * @notice Heartbeat — prove shard liveness
     */
    function heartbeat() external {
        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        shards[shardId].lastHeartbeat = block.timestamp;
        emit HeartbeatReceived(shardId, block.timestamp);
    }

    /**
     * @notice Deactivate a shard (voluntary exit)
     */
    function deactivateShard() external nonReentrant {
        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        Shard storage shard = shards[shardId];
        if (!shard.active) revert NotActive();

        // Claim pending rewards
        _claimRewards(shardId);

        // Remove weight
        totalWeight -= _shardWeight(shard);

        shard.active = false;
        activeShardCount--;
        totalStaked -= shard.stake;

        // Return stake
        uint256 stakeReturn = shard.stake;
        shard.stake = 0;
        ckbToken.transfer(msg.sender, stakeReturn);

        emit ShardDeactivated(shardId, "voluntary");
    }

    // ============ Rewards ============

    /**
     * @notice Distribute rewards from SecondaryIssuanceController
     * @dev Called by the issuance controller with CKB-native tokens
     */
    function distributeRewards(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        ckbToken.transferFrom(msg.sender, address(this), amount);

        if (totalWeight > 0) {
            accRewardPerShare += (amount * ACC_PRECISION) / totalWeight;
        }

        emit RewardsDistributed(amount, accRewardPerShare);
    }

    /**
     * @notice Claim accumulated rewards
     */
    function claimRewards() external nonReentrant {
        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        _claimRewards(shardId);
    }

    function _claimRewards(bytes32 shardId) internal {
        Shard storage shard = shards[shardId];
        uint256 weight = _shardWeight(shard);

        uint256 accumulated = (weight * accRewardPerShare) / ACC_PRECISION;
        uint256 pending = accumulated - shard.rewardDebt;

        if (pending > 0) {
            shard.rewardDebt = accumulated;
            ckbToken.transfer(shard.operator, pending);
            emit RewardClaimed(shard.operator, pending);
        } else {
            shard.rewardDebt = accumulated;
        }
    }

    // ============ Internal ============

    /// @notice Shard weight = sqrt(cellsServed * stake) — geometric mean
    /// @dev Prevents gaming by either maxing cells with min stake or vice versa
    function _shardWeight(Shard storage shard) internal view returns (uint256) {
        if (shard.cellsServed == 0 || shard.stake == 0) return 0;
        return _sqrt(shard.cellsServed * shard.stake);
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ============ View Functions ============

    function getShard(bytes32 shardId) external view returns (Shard memory) {
        return shards[shardId];
    }

    function pendingRewards(address operator) external view returns (uint256) {
        bytes32 shardId = operatorShard[operator];
        if (shardId == bytes32(0)) return 0;

        Shard storage shard = shards[shardId];
        uint256 weight = _shardWeight(shard);
        uint256 accumulated = (weight * accRewardPerShare) / ACC_PRECISION;
        return accumulated > shard.rewardDebt ? accumulated - shard.rewardDebt : 0;
    }

    function getActiveShardCount() external view returns (uint256) {
        return activeShardCount;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
