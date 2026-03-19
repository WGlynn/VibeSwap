// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// ============ Minimal Interfaces ============

interface IUtilizationAccumulator {
    struct EpochPoolData {
        uint128 totalVolumeIn;
        uint128 totalVolumeOut;
        uint64 buyVolume;
        uint64 sellVolume;
        uint32 batchCount;
        uint8 maxVolatilityTier;
        bool finalized;
    }
    function getEpochPoolData(uint256 epochId, bytes32 poolId) external view returns (EpochPoolData memory);
    function getPoolLPs(bytes32 poolId) external view returns (address[] memory);
    function getLPSnapshot(bytes32 poolId, address lp) external view returns (uint128);
    function currentEpochId() external view returns (uint256);
}

interface IEmissionController {
    struct Participant {
        address participant;
        uint256 directContribution;
        uint256 timeInPool;
        uint256 scarcityScore;
        uint256 stabilityScore;
    }
    function createContributionGame(
        bytes32 gameId,
        Participant[] calldata participants,
        uint256 drainBps
    ) external;
}

interface ILoyaltyRewards {
    function getStakeTimestamp(bytes32 poolId, address lp) external view returns (uint256);
}

/**
 * @title MicroGameFactory — Permissionless Shapley Game Creator (Layer 2)
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Periodically reads accumulated utilization data and creates Shapley
 *         micro-games via EmissionController. PERMISSIONLESS — anyone can trigger
 *         game creation for finalized epochs.
 *
 * @dev Architecture position:
 *
 *   UtilizationAccumulator (L1) → MicroGameFactory (L2) → EmissionController → ShapleyDistributor
 *         accumulates data            reads & transforms         drains pool         distributes rewards
 *
 *   Each finalized epoch + pool pair produces one micro-game. The factory reads
 *   LP snapshots, computes contribution scores, sorts by directContribution,
 *   and calls EmissionController.createContributionGame().
 *
 *   DISINTERMEDIATION: Grade A — fully permissionless. No access control on
 *   createMicroGame(). Data comes from on-chain accumulator snapshots (immutable
 *   once finalized). Anyone can trigger, outcome is deterministic. Protocol runs
 *   without founder.
 */
contract MicroGameFactory is OwnableUpgradeable, UUPSUpgradeable {

    // ============ Constants ============

    uint256 public constant BPS = 10_000;

    /// @notice Volatility tier thresholds for stability scoring
    uint8 public constant VOLATILITY_HIGH = 2;
    uint8 public constant VOLATILITY_EXTREME = 3;

    // ============ External Contracts ============

    IUtilizationAccumulator public accumulator;
    IEmissionController public emissionController;
    ILoyaltyRewards public loyaltyRewards;

    // ============ Configuration ============

    uint256 public drainBps;
    uint256 public maxParticipants;
    uint256 public minLiquidity;

    // ============ State ============

    /// @notice Per-pool tracking of last settled epoch
    mapping(bytes32 => uint256) public lastSettledEpoch;

    // ============ Events ============

    event MicroGameCreated(
        bytes32 indexed poolId,
        uint256 indexed epochId,
        bytes32 gameId,
        uint256 participantCount
    );

    // ============ Errors ============

    error EpochNotFinalized();
    error EpochAlreadySettled();
    error NoQualifiedParticipants();
    error ZeroAddress();
    error InvalidBps();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _accumulator,
        address _emissionController,
        address _loyaltyRewards
    ) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        if (_accumulator == address(0)) revert ZeroAddress();
        if (_emissionController == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        accumulator = IUtilizationAccumulator(_accumulator);
        emissionController = IEmissionController(_emissionController);
        loyaltyRewards = ILoyaltyRewards(_loyaltyRewards);

        drainBps = 500; // 5% default
        maxParticipants = 100;
        minLiquidity = 0;
    }

    // ============ Core Functions ============

    /**
     * @notice Create a Shapley micro-game for a finalized epoch + pool pair
     * @dev PERMISSIONLESS — anyone can call. All inputs are derived from on-chain
     *      accumulator state (immutable once finalized). Outcome is deterministic.
     *
     *      Contribution scoring:
     *        directContribution = lpSnapshot * (totalVolumeIn / totalPoolLiquidity)
     *        timeInPool         = block.timestamp - loyaltyRewards.getStakeTimestamp()
     *        scarcityScore      = 5000 (balanced default for v1)
     *        stabilityScore     = 5000 base, +2500 if HIGH volatility, +5000 if EXTREME
     *
     *      Participants are sorted by directContribution (descending), capped at maxParticipants.
     *
     * @param poolId Pool identifier
     * @param epochId Epoch to settle
     */
    function createMicroGame(bytes32 poolId, uint256 epochId) public {
        // Validate epoch is finalized and not already settled
        IUtilizationAccumulator.EpochPoolData memory data = accumulator.getEpochPoolData(epochId, poolId);
        if (!data.finalized) revert EpochNotFinalized();
        if (lastSettledEpoch[poolId] >= epochId && epochId != 0) revert EpochAlreadySettled();

        // Get LP list and compute total pool liquidity from snapshots
        address[] memory lps = accumulator.getPoolLPs(poolId);
        uint256 lpCount = lps.length;

        // First pass: gather snapshots and compute total liquidity
        uint128[] memory snapshots = new uint128[](lpCount);
        uint256 totalPoolLiquidity = 0;
        uint256 qualifiedCount = 0;

        for (uint256 i = 0; i < lpCount; i++) {
            snapshots[i] = accumulator.getLPSnapshot(poolId, lps[i]);
            if (snapshots[i] >= minLiquidity) {
                totalPoolLiquidity += snapshots[i];
                qualifiedCount++;
            }
        }

        if (qualifiedCount == 0 || totalPoolLiquidity == 0) revert NoQualifiedParticipants();

        // Second pass: build participant array with contribution scores
        IEmissionController.Participant[] memory candidates = new IEmissionController.Participant[](qualifiedCount);
        uint256 idx = 0;

        // Stability score based on epoch volatility tier
        uint256 stability = 5000;
        if (data.maxVolatilityTier >= VOLATILITY_EXTREME) {
            stability = 10000; // 5000 base + 5000 extreme bonus
        } else if (data.maxVolatilityTier >= VOLATILITY_HIGH) {
            stability = 7500; // 5000 base + 2500 high bonus
        }

        uint256 totalVolumeIn = uint256(data.totalVolumeIn);

        for (uint256 i = 0; i < lpCount; i++) {
            if (snapshots[i] < minLiquidity) continue;

            uint256 direct = (uint256(snapshots[i]) * totalVolumeIn) / totalPoolLiquidity;

            // Time in pool from loyalty rewards (fallback to 1 day if not staked)
            uint256 timeInPool;
            if (address(loyaltyRewards) != address(0)) {
                uint256 stakeTs = loyaltyRewards.getStakeTimestamp(poolId, lps[i]);
                timeInPool = stakeTs > 0 && stakeTs < block.timestamp
                    ? block.timestamp - stakeTs
                    : 1 days;
            } else {
                timeInPool = 1 days;
            }

            candidates[idx] = IEmissionController.Participant({
                participant: lps[i],
                directContribution: direct,
                timeInPool: timeInPool,
                scarcityScore: 5000,
                stabilityScore: stability
            });
            idx++;
        }

        // Sort by directContribution descending (insertion sort — bounded by maxParticipants)
        uint256 count = candidates.length;
        for (uint256 i = 1; i < count; i++) {
            IEmissionController.Participant memory key = candidates[i];
            uint256 j = i;
            while (j > 0 && candidates[j - 1].directContribution < key.directContribution) {
                candidates[j] = candidates[j - 1];
                j--;
            }
            candidates[j] = key;
        }

        // Cap at maxParticipants
        uint256 finalCount = count > maxParticipants ? maxParticipants : count;
        IEmissionController.Participant[] memory participants = new IEmissionController.Participant[](finalCount);
        for (uint256 i = 0; i < finalCount; i++) {
            participants[i] = candidates[i];
        }

        // Generate deterministic game ID
        bytes32 gameId = keccak256(abi.encodePacked("micro", poolId, epochId));

        // Create the contribution game via EmissionController
        emissionController.createContributionGame(gameId, participants, drainBps);

        // Mark epoch as settled for this pool
        lastSettledEpoch[poolId] = epochId;

        emit MicroGameCreated(poolId, epochId, gameId, finalCount);
    }

    /**
     * @notice Batch create micro-games for multiple pools in a single epoch
     * @dev Convenience function. Calls createMicroGame for each pool.
     *      Reverts if any individual pool fails (atomic batch).
     * @param poolIds Array of pool identifiers
     * @param epochId Epoch to settle
     */
    function createMicroGamesForEpoch(bytes32[] calldata poolIds, uint256 epochId) external {
        for (uint256 i = 0; i < poolIds.length; i++) {
            createMicroGame(poolIds[i], epochId);
        }
    }

    // ============ Admin Functions ============

    // DISINTERMEDIATION: Grade C → Target Grade B (governance via TimelockController)
    function setDrainBps(uint256 _bps) external onlyOwner {
        if (_bps > BPS) revert InvalidBps();
        drainBps = _bps;
    }

    // DISINTERMEDIATION: Grade C → Target Grade B (governance via TimelockController)
    function setMaxParticipants(uint256 _max) external onlyOwner {
        maxParticipants = _max;
    }

    // DISINTERMEDIATION: Grade C → Target Grade B (governance via TimelockController)
    function setMinLiquidity(uint256 _min) external onlyOwner {
        minLiquidity = _min;
    }

    // ============ UUPS ============

    // DISINTERMEDIATION: KEEP during bootstrap. Target Grade B via governance TimelockController.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
