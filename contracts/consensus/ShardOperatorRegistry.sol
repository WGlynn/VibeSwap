// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant HEARTBEAT_INTERVAL = 24 hours;
    uint256 public constant HEARTBEAT_GRACE = 48 hours;
    uint256 public constant MIN_STAKE = 100e18;
    uint256 public constant MAX_CELLS_SERVED = 1e12; // NCI-011: Cap to prevent overflow in weight calc
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

    /// @notice NCI-012: Authorized issuance controller (only caller for distributeRewards)
    address public issuanceController;

    /// @dev Reserved storage gap
    uint256[49] private __gap;

    // ============ Events ============

    event ShardRegistered(bytes32 indexed shardId, address indexed operator, uint256 stake);
    event ShardDeactivated(bytes32 indexed shardId, string reason);
    event CellsReported(bytes32 indexed shardId, uint256 cellCount);
    event HeartbeatReceived(bytes32 indexed shardId, uint256 timestamp);
    event RewardClaimed(address indexed operator, uint256 amount);
    event RewardsDistributed(uint256 amount, uint256 newAccRewardPerShare);

    // ============ Errors ============

    error AlreadyRegistered();
    error ShardIdTaken();
    error NotRegistered();
    error InsufficientStake();
    error NotActive();
    error ZeroAmount();
    error CellsExceedCap();

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
        // NCI-005: Prevent shardId collision — don't overwrite existing operator's shard
        if (shards[shardId].operator != address(0)) revert ShardIdTaken();
        if (stakeAmount < MIN_STAKE) revert InsufficientStake();

        ckbToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

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
     * @dev NCI-011: Capped to MAX_CELLS_SERVED to prevent overflow in _shardWeight.
     *      NCI-037: Claims pending rewards before weight change (Masterchef invariant).
     */
    function reportCellsServed(uint256 cellCount) external {
        // NCI-011: Cap to prevent overflow in sqrt(cellsServed * stake)
        if (cellCount > MAX_CELLS_SERVED) revert CellsExceedCap();

        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        Shard storage shard = shards[shardId];
        if (!shard.active) revert NotActive();

        // NCI-037: Claim pending rewards at OLD weight before changing
        _claimRewards(shardId);

        // Update weight: remove old, add new
        uint256 oldWeight = _shardWeight(shard);
        uint256 oldCells = shard.cellsServed;
        shard.cellsServed = cellCount;
        uint256 newWeight = _shardWeight(shard);

        if (oldWeight > 0) totalWeight -= oldWeight;
        totalWeight += newWeight;

        // Update total cells incrementally (no unbounded loop)
        totalCellsServed = totalCellsServed - oldCells + cellCount;

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
        totalCellsServed -= shard.cellsServed;

        // Return stake
        uint256 stakeReturn = shard.stake;
        shard.stake = 0;
        // NCI-023: Clear operatorShard so operator can re-register
        operatorShard[msg.sender] = bytes32(0);
        ckbToken.safeTransfer(msg.sender, stakeReturn);

        emit ShardDeactivated(shardId, "voluntary");
    }

    // ============ Rewards ============

    /**
     * @notice Distribute rewards from SecondaryIssuanceController
     * @dev NCI-012: Restricted to issuanceController. Reverts if totalWeight=0
     *      to prevent tokens from being permanently locked.
     */
    function distributeRewards(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        // NCI-012: Only issuance controller can distribute (or owner during setup)
        require(
            msg.sender == issuanceController || msg.sender == owner(),
            "Not authorized"
        );
        // NCI-012: Don't accept tokens that can never be claimed
        require(totalWeight > 0, "No active shards");

        ckbToken.safeTransferFrom(msg.sender, address(this), amount);
        accRewardPerShare += (amount * ACC_PRECISION) / totalWeight;

        emit RewardsDistributed(amount, accRewardPerShare);
    }

    /// @notice Set the issuance controller address
    function setIssuanceController(address controller) external onlyOwner {
        issuanceController = controller;
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
            ckbToken.safeTransfer(shard.operator, pending);
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
