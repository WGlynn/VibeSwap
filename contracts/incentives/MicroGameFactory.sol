// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// ============ Minimal Interfaces ============

interface IUtilizationAccumulator {
    struct EpochPoolData {
        uint128 totalVolumeIn; uint128 totalVolumeOut;
        uint64 buyVolume; uint64 sellVolume;
        uint32 batchCount; uint8 maxVolatilityTier; bool finalized;
    }
    function getEpochPoolData(uint256 epochId, bytes32 poolId) external view returns (EpochPoolData memory);
    function getPoolLPs(bytes32 poolId) external view returns (address[] memory);
    function getLPSnapshot(bytes32 poolId, address lp) external view returns (uint128);
    function currentEpochId() external view returns (uint256);
}

interface IEmissionController {
    struct Participant {
        address participant; uint256 directContribution;
        uint256 timeInPool; uint256 scarcityScore; uint256 stabilityScore;
    }
    function createContributionGame(bytes32 gameId, Participant[] calldata participants, uint256 drainBps) external;
}

interface ILoyaltyRewards {
    function getStakeTimestamp(bytes32 poolId, address lp) external view returns (uint256);
}

/// @title MicroGameFactory — Permissionless Shapley Game Creator (Layer 2)
/// @author Faraday1 & JARVIS — vibeswap.org
/// @notice Reads accumulated utilization data and creates Shapley micro-games via
///         EmissionController. PERMISSIONLESS — anyone can trigger for finalized epochs.
/// @dev UtilizationAccumulator (L1) → MicroGameFactory (L2) → EmissionController → ShapleyDistributor
///      DISINTERMEDIATION: Grade A — fully permissionless. Outcome is deterministic.
contract MicroGameFactory is OwnableUpgradeable, UUPSUpgradeable {

    // ============ Constants ============
    uint256 public constant BPS = 10_000;
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
    mapping(bytes32 => uint256) public lastSettledEpoch;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============
    event MicroGameCreated(bytes32 indexed poolId, uint256 indexed epochId, bytes32 gameId, uint256 participantCount);

    // ============ Errors ============
    error EpochNotFinalized();
    error EpochAlreadySettled();
    error NoQualifiedParticipants();
    error ZeroAddress();
    error InvalidBps();

    // ============ Initializer ============
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _owner, address _accumulator, address _emissionController, address _loyaltyRewards
    ) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        if (_accumulator == address(0)) revert ZeroAddress();
        if (_emissionController == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        accumulator = IUtilizationAccumulator(_accumulator);
        emissionController = IEmissionController(_emissionController);
        loyaltyRewards = ILoyaltyRewards(_loyaltyRewards);

        drainBps = 500;         // 5% default
        maxParticipants = 100;
        minLiquidity = 0;
    }

    // ============ Core Functions ============
    /**
     * @notice Create a Shapley micro-game for a finalized epoch + pool pair
     * @dev PERMISSIONLESS. Contribution scoring:
     *   directContribution = lpSnapshot * totalVolumeIn / totalPoolLiquidity
     *   timeInPool = block.timestamp - loyaltyRewards.getStakeTimestamp()
     *   scarcityScore = 5000 (balanced default for v1)
     *   stabilityScore = 5000 base, +2500 HIGH, +5000 EXTREME
     *   Sorted by directContribution descending, capped at maxParticipants.
     */
    function createMicroGame(bytes32 poolId, uint256 epochId) public {
        IUtilizationAccumulator.EpochPoolData memory data = accumulator.getEpochPoolData(epochId, poolId);
        if (!data.finalized) revert EpochNotFinalized();
        if (lastSettledEpoch[poolId] >= epochId && epochId != 0) revert EpochAlreadySettled();

        address[] memory lps = accumulator.getPoolLPs(poolId);
        uint256 lpCount = lps.length;

        // First pass: gather snapshots, compute total liquidity
        uint128[] memory snapshots = new uint128[](lpCount);
        uint256 totalPoolLiq = 0;
        uint256 qualifiedCount = 0;
        for (uint256 i = 0; i < lpCount; i++) {
            snapshots[i] = accumulator.getLPSnapshot(poolId, lps[i]);
            if (snapshots[i] >= minLiquidity) {
                totalPoolLiq += snapshots[i];
                qualifiedCount++;
            }
        }
        if (qualifiedCount == 0 || totalPoolLiq == 0) revert NoQualifiedParticipants();

        // Stability score from epoch volatility tier
        uint256 stability = 5000;
        if (data.maxVolatilityTier >= VOLATILITY_EXTREME) stability = 10000;
        else if (data.maxVolatilityTier >= VOLATILITY_HIGH) stability = 7500;

        // Second pass: build participant array
        IEmissionController.Participant[] memory candidates = new IEmissionController.Participant[](qualifiedCount);
        uint256 idx = 0;
        uint256 totalVol = uint256(data.totalVolumeIn);

        for (uint256 i = 0; i < lpCount; i++) {
            if (snapshots[i] < minLiquidity) continue;
            uint256 direct = (uint256(snapshots[i]) * totalVol) / totalPoolLiq;

            uint256 timeInPool = 1 days; // default fallback
            if (address(loyaltyRewards) != address(0)) {
                uint256 ts = loyaltyRewards.getStakeTimestamp(poolId, lps[i]);
                if (ts > 0 && ts < block.timestamp) timeInPool = block.timestamp - ts;
            }

            candidates[idx++] = IEmissionController.Participant({
                participant: lps[i],
                directContribution: direct,
                timeInPool: timeInPool,
                scarcityScore: 5000,
                stabilityScore: stability
            });
        }

        // Sort descending by directContribution (insertion sort, bounded by maxParticipants)
        for (uint256 i = 1; i < qualifiedCount; i++) {
            IEmissionController.Participant memory key = candidates[i];
            uint256 j = i;
            while (j > 0 && candidates[j - 1].directContribution < key.directContribution) {
                candidates[j] = candidates[j - 1];
                j--;
            }
            candidates[j] = key;
        }

        // Cap at maxParticipants, build final array
        uint256 finalCount = qualifiedCount > maxParticipants ? maxParticipants : qualifiedCount;
        IEmissionController.Participant[] memory participants = new IEmissionController.Participant[](finalCount);
        for (uint256 i = 0; i < finalCount; i++) participants[i] = candidates[i];

        bytes32 gameId = keccak256(abi.encodePacked("micro", poolId, epochId));
        emissionController.createContributionGame(gameId, participants, drainBps);
        lastSettledEpoch[poolId] = epochId;

        emit MicroGameCreated(poolId, epochId, gameId, finalCount);
    }

    /// @notice Batch create micro-games for multiple pools in a single epoch
    function createMicroGamesForEpoch(bytes32[] calldata poolIds, uint256 epochId) external {
        for (uint256 i = 0; i < poolIds.length; i++) {
            createMicroGame(poolIds[i], epochId);
        }
    }

    // ============ Admin Functions ============
    /// DISINTERMEDIATION: Grade C → Target Grade B (governance via TimelockController)
    function setDrainBps(uint256 _bps) external onlyOwner {
        if (_bps > BPS) revert InvalidBps();
        drainBps = _bps;
    }

    /// DISINTERMEDIATION: Grade C → Target Grade B (governance via TimelockController)
    function setMaxParticipants(uint256 _max) external onlyOwner { maxParticipants = _max; }

    /// DISINTERMEDIATION: Grade C → Target Grade B (governance via TimelockController)
    function setMinLiquidity(uint256 _min) external onlyOwner { minLiquidity = _min; }

    // ============ UUPS ============
    /// DISINTERMEDIATION: KEEP during bootstrap. Target Grade B via governance TimelockController.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
