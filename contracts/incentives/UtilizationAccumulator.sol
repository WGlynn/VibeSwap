// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title UtilizationAccumulator
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Lightweight Layer 1 of the micro-game Shapley architecture.
 * @dev Records per-batch utilization data at minimal gas cost (~30K per batch).
 *      Data is later consumed by MicroGameFactory to construct Shapley games.
 *
 *      Design principles:
 *      - Hot path: every batch settlement writes here. Gas is king.
 *      - Struct packing: EpochPoolData fits in 2 storage slots.
 *      - Permissionless epoch advancement: anyone can finalize stale epochs.
 *      - LP set management uses swap-and-pop with 1-indexed lookup for O(1) ops.
 */
contract UtilizationAccumulator is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Custom Errors ============

    error Unauthorized();
    error ZeroAddress();
    error EpochNotReady();
    error LPAlreadyRegistered();
    error LPNotRegistered();
    error InvalidEpochDuration();

    // ============ Structs ============

    /**
     * @notice Per-epoch, per-pool aggregate utilization data.
     * @dev Packed into 2 storage slots (64 bytes):
     *      Slot 1: totalVolumeIn (16) + totalVolumeOut (16) = 32 bytes
     *      Slot 2: buyVolume (8) + sellVolume (8) + batchCount (4) +
     *              maxVolatilityTier (1) + finalized (1) = 22 bytes
     */
    struct EpochPoolData {
        uint128 totalVolumeIn;
        uint128 totalVolumeOut;
        uint64 buyVolume;
        uint64 sellVolume;
        uint32 batchCount;
        uint8 maxVolatilityTier;
        bool finalized;
    }

    // ============ State ============

    /// @notice Current epoch identifier (monotonically increasing)
    uint256 public currentEpochId;

    /// @notice Duration of each epoch in seconds
    uint256 public epochDuration;

    /// @notice Timestamp when the current epoch started
    uint256 public currentEpochStart;

    /// @notice Per-epoch, per-pool aggregated utilization data
    mapping(uint256 => mapping(bytes32 => EpochPoolData)) public epochPoolData;

    /// @notice LP address set per pool (for enumeration by MicroGameFactory)
    mapping(bytes32 => address[]) internal _poolLPs;

    /// @notice 1-indexed LP position in _poolLPs array (0 = not registered)
    mapping(bytes32 => mapping(address => uint256)) public poolLPIndex;

    /// @notice LP liquidity snapshot at epoch start (for Shapley weight input)
    mapping(bytes32 => mapping(address => uint128)) public lpLiquiditySnapshot;

    /// @notice Authorized callers (VibeSwapCore, IncentiveController)
    mapping(address => bool) public authorized;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event BatchRecorded(bytes32 indexed poolId, uint256 indexed epochId, uint32 batchCount);
    event EpochAdvanced(uint256 indexed oldEpochId, uint256 indexed newEpochId, uint256 timestamp);
    event LPRegistered(bytes32 indexed poolId, address indexed lp);
    event LPDeregistered(bytes32 indexed poolId, address indexed lp);
    event LPSnapshotted(bytes32 indexed poolId, address indexed lp, uint128 liquidity);
    event AuthorizedUpdated(address indexed caller, bool status);
    event EpochDurationUpdated(uint256 oldDuration, uint256 newDuration);

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        if (!authorized[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner, uint256 _epochDuration) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        if (_epochDuration == 0) revert InvalidEpochDuration();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        epochDuration = _epochDuration;
        currentEpochStart = block.timestamp;
        // currentEpochId starts at 0
    }

    // ============ Core: Batch Settlement Recording ============

    /**
     * @notice Record a batch settlement's utilization data into the current epoch.
     * @dev Called by VibeSwapCore after each batch. Gas target: ~30K.
     *      Auto-advances epoch if the current one has expired.
     * @param poolId Pool identifier
     * @param volumeIn Total input volume for the batch
     * @param volumeOut Total output volume for the batch
     * @param buyVol Compressed buy volume (scaled to fit uint64)
     * @param sellVol Compressed sell volume (scaled to fit uint64)
     * @param volatilityTier Volatility classification for this batch (0-255)
     */
    function recordBatchSettlement(
        bytes32 poolId,
        uint128 volumeIn,
        uint128 volumeOut,
        uint64 buyVol,
        uint64 sellVol,
        uint8 volatilityTier
    ) external onlyAuthorized {
        // Auto-advance epoch if stale
        if (block.timestamp >= currentEpochStart + epochDuration) {
            _advanceEpoch();
        }

        EpochPoolData storage data = epochPoolData[currentEpochId][poolId];

        // Accumulate — unchecked for gas savings (overflow extremely unlikely
        // with uint128 volumes in a single epoch)
        unchecked {
            data.totalVolumeIn += volumeIn;
            data.totalVolumeOut += volumeOut;
            data.buyVolume += buyVol;
            data.sellVolume += sellVol;
            data.batchCount++;
        }

        // Track worst-case volatility in epoch
        if (volatilityTier > data.maxVolatilityTier) {
            data.maxVolatilityTier = volatilityTier;
        }

        emit BatchRecorded(poolId, currentEpochId, data.batchCount);
    }

    // ============ LP Set Management ============

    /**
     * @notice Register an LP in a pool's address set.
     * @dev Called by IncentiveController on liquidity add. O(1) via 1-indexed mapping.
     * @param poolId Pool identifier
     * @param lp LP address to register
     */
    function registerLP(bytes32 poolId, address lp) external onlyAuthorized {
        if (lp == address(0)) revert ZeroAddress();
        if (poolLPIndex[poolId][lp] != 0) revert LPAlreadyRegistered();

        _poolLPs[poolId].push(lp);
        poolLPIndex[poolId][lp] = _poolLPs[poolId].length; // 1-indexed

        emit LPRegistered(poolId, lp);
    }

    /**
     * @notice Remove an LP from a pool's address set.
     * @dev Swap-and-pop for O(1) removal. Called on liquidity remove.
     * @param poolId Pool identifier
     * @param lp LP address to deregister
     */
    function deregisterLP(bytes32 poolId, address lp) external onlyAuthorized {
        uint256 idx = poolLPIndex[poolId][lp];
        if (idx == 0) revert LPNotRegistered();

        uint256 lastIdx = _poolLPs[poolId].length;
        if (idx != lastIdx) {
            // Swap with last element
            address lastLP = _poolLPs[poolId][lastIdx - 1];
            _poolLPs[poolId][idx - 1] = lastLP;
            poolLPIndex[poolId][lastLP] = idx;
        }

        _poolLPs[poolId].pop();
        delete poolLPIndex[poolId][lp];
        delete lpLiquiditySnapshot[poolId][lp];

        emit LPDeregistered(poolId, lp);
    }

    /**
     * @notice Record LP's liquidity at epoch start for Shapley weight calculation.
     * @dev Called on first batch of a new epoch or when an LP is added mid-epoch.
     * @param poolId Pool identifier
     * @param lp LP address
     * @param liquidity LP's current liquidity amount
     */
    function snapshotLP(
        bytes32 poolId,
        address lp,
        uint128 liquidity
    ) external onlyAuthorized {
        if (lp == address(0)) revert ZeroAddress();

        lpLiquiditySnapshot[poolId][lp] = liquidity;

        emit LPSnapshotted(poolId, lp, liquidity);
    }

    // ============ Epoch Management ============

    /**
     * @notice Permissionless epoch advancement.
     * @dev Anyone can call this to finalize a stale epoch and start a new one.
     *      Reverts if the current epoch hasn't expired yet.
     */
    function advanceEpoch() external {
        if (block.timestamp < currentEpochStart + epochDuration) {
            revert EpochNotReady();
        }
        _advanceEpoch();
    }

    /**
     * @dev Internal epoch advancement. Finalizes current epoch, starts next.
     *      Handles time jumps: skips to the correct epoch if multiple have passed.
     */
    function _advanceEpoch() internal {
        uint256 oldEpochId = currentEpochId;

        // Calculate how many epochs have elapsed (handles time jumps)
        uint256 elapsed = block.timestamp - currentEpochStart;
        uint256 epochsSkipped = elapsed / epochDuration;

        unchecked {
            currentEpochId += epochsSkipped;
            currentEpochStart += epochsSkipped * epochDuration;
        }

        emit EpochAdvanced(oldEpochId, currentEpochId, block.timestamp);
    }

    // ============ View Functions ============

    /**
     * @notice Read epoch utilization data for a pool.
     * @param epochId Epoch identifier
     * @param poolId Pool identifier
     */
    function getEpochPoolData(
        uint256 epochId,
        bytes32 poolId
    ) external view returns (EpochPoolData memory) {
        return epochPoolData[epochId][poolId];
    }

    /**
     * @notice Enumerate all LPs registered for a pool.
     * @param poolId Pool identifier
     * @return Array of LP addresses
     */
    function getPoolLPs(bytes32 poolId) external view returns (address[] memory) {
        return _poolLPs[poolId];
    }

    /**
     * @notice Get LP's liquidity snapshot for a pool.
     * @param poolId Pool identifier
     * @param lp LP address
     * @return LP's snapshotted liquidity
     */
    function getLPSnapshot(
        bytes32 poolId,
        address lp
    ) external view returns (uint128) {
        return lpLiquiditySnapshot[poolId][lp];
    }

    /**
     * @notice Get the number of LPs registered for a pool.
     * @param poolId Pool identifier
     */
    function getPoolLPCount(bytes32 poolId) external view returns (uint256) {
        return _poolLPs[poolId].length;
    }

    // ============ Admin Functions ============

    /**
     * @notice Authorize or deauthorize a caller (VibeSwapCore, IncentiveController).
     * @param caller Address to update
     * @param status True to authorize, false to revoke
     *
     * DISINTERMEDIATION: KEEP — controls which contracts can write utilization data.
     * Target Grade B: governance (TimelockController).
     */
    function setAuthorized(address caller, bool status) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorized[caller] = status;
        emit AuthorizedUpdated(caller, status);
    }

    /**
     * @notice Update epoch duration for future epochs.
     * @param _epochDuration New epoch duration in seconds
     *
     * DISINTERMEDIATION: Grade C -> Target Grade B. Governance-appropriate.
     */
    function setEpochDuration(uint256 _epochDuration) external onlyOwner {
        if (_epochDuration == 0) revert InvalidEpochDuration();
        uint256 old = epochDuration;
        epochDuration = _epochDuration;
        emit EpochDurationUpdated(old, _epochDuration);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
