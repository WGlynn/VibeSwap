// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title SecondaryIssuanceController — CKB-native Emission Engine
 * @notice Emits CKB-native tokens on a fixed annual schedule with a 3-way split:
 *
 *   1. Shard operators — proportional to cells stored × uptime
 *   2. DAO shelter depositors — inflation shelter (made whole)
 *   3. Insurance pool — proportional to unoccupied state
 *
 *   NO TREASURY CUT. Treasury taking secondary issuance = rent-seeking = P-001 violation.
 *   Insurance pool has objective, verifiable claim conditions — no discretion.
 *
 * @dev Split calculation (Nervos model):
 *      shardShare    = totalOccupied / totalSupply × epochEmission
 *      daoShare      = totalDAODeposits / totalSupply × epochEmission
 *      insuranceShare = epochEmission - shardShare - daoShare
 *
 *      The insight: unoccupied, unstaked tokens are the "nobody's land" proportion.
 *      That proportion's issuance goes to insurance — hardening the system, not enriching anyone.
 */

interface ICKBNativeMinter {
    function mint(address to, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function totalOccupied() external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IDAOShelterForIssuance {
    function totalDeposited() external view returns (uint256);
    function depositYield(uint256 amount) external;
}

interface IShardRegistryForIssuance {
    function distributeRewards(uint256 amount) external;
}

contract SecondaryIssuanceController is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ State ============

    /// @notice CKB-native token
    ICKBNativeMinter public ckbToken;

    /// @notice DAO shelter
    IDAOShelterForIssuance public daoShelter;

    /// @notice Shard operator registry
    IShardRegistryForIssuance public shardRegistry;

    /// @notice Insurance pool address
    address public insurancePool;

    /// @notice Annual emission rate (tokens per year)
    uint256 public annualEmission;

    /// @notice Epoch duration (how often distribution runs)
    uint256 public epochDuration;

    /// @notice Last distribution timestamp
    uint256 public lastDistribution;

    /// @notice Total distributed across all epochs
    uint256 public totalDistributed;

    /// @notice Minimum emission per distribution (skip if below)
    uint256 public minDistribution;

    /// @dev Reserved storage gap
    uint256[50] private __gap;

    // ============ Events ============

    event EpochDistributed(
        uint256 indexed epoch,
        uint256 shardShare,
        uint256 daoShare,
        uint256 insuranceShare,
        uint256 totalEmitted
    );
    event ParametersUpdated(uint256 annualEmission, uint256 epochDuration);

    // ============ Errors ============

    error TooSoon();
    error ZeroAmount();
    error NotConfigured();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _ckbToken,
        address _daoShelter,
        address _shardRegistry,
        address _insurancePool,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        ckbToken = ICKBNativeMinter(_ckbToken);
        daoShelter = IDAOShelterForIssuance(_daoShelter);
        shardRegistry = IShardRegistryForIssuance(_shardRegistry);
        insurancePool = _insurancePool;

        annualEmission = 1_344_000_000e18; // ~1.344B like Nervos
        epochDuration = 1 days;
        minDistribution = 1e18;
        lastDistribution = block.timestamp;
    }

    // ============ Distribution ============

    /**
     * @notice Distribute epoch emission — permissionless, anyone can call
     * @dev Mints CKB-native and splits 3 ways based on current state proportions
     */
    function distributeEpoch() external nonReentrant {
        if (block.timestamp < lastDistribution + epochDuration) revert TooSoon();

        // Calculate emission for elapsed time
        uint256 elapsed = block.timestamp - lastDistribution;
        uint256 emission = (annualEmission * elapsed) / 365 days;

        if (emission < minDistribution) revert ZeroAmount();

        lastDistribution = block.timestamp;

        // Get current state for 3-way split
        uint256 totalSupply = ckbToken.totalSupply();

        // Edge case: first emission (no supply yet)
        if (totalSupply == 0) {
            // All goes to insurance until there's circulating supply
            ckbToken.mint(insurancePool, emission);
            totalDistributed += emission;
            emit EpochDistributed(0, 0, 0, emission, emission);
            return;
        }

        uint256 totalOccupied = ckbToken.totalOccupied();
        uint256 totalDAO = daoShelter.totalDeposited();

        // NCI-003/MON-006: 3-way split with underflow protection.
        // totalOccupied + totalDAO can exceed totalSupply (DAO deposits are in-supply tokens),
        // which would cause insuranceShare to underflow. Cap proportionally.
        uint256 shardShare = (emission * totalOccupied) / totalSupply;
        uint256 daoShare = (emission * totalDAO) / totalSupply;

        // Safe underflow guard: if occupied + DAO proportions exceed 100%, scale down
        uint256 insuranceShare;
        if (shardShare + daoShare > emission) {
            // Scale proportionally so total = emission
            uint256 combinedBefore = shardShare + daoShare;
            shardShare = (emission * shardShare) / combinedBefore;
            daoShare = emission - shardShare; // Give remainder to DAO (no dust loss)
            insuranceShare = 0;
        } else {
            insuranceShare = emission - shardShare - daoShare;
        }

        // Mint and distribute
        if (shardShare > 0) {
            ckbToken.mint(address(this), shardShare);
            ckbToken.approve(address(shardRegistry), shardShare);
            shardRegistry.distributeRewards(shardShare);
        }

        if (daoShare > 0) {
            ckbToken.mint(address(this), daoShare);
            ckbToken.approve(address(daoShelter), daoShare);
            daoShelter.depositYield(daoShare);
        }

        if (insuranceShare > 0) {
            ckbToken.mint(insurancePool, insuranceShare);
        }

        totalDistributed += emission;

        emit EpochDistributed(
            totalDistributed,
            shardShare,
            daoShare,
            insuranceShare,
            emission
        );
    }

    // ============ Admin ============

    function setParameters(uint256 _annualEmission, uint256 _epochDuration) external onlyOwner {
        if (_annualEmission == 0 || _epochDuration == 0) revert ZeroAmount();
        annualEmission = _annualEmission;
        epochDuration = _epochDuration;
        emit ParametersUpdated(_annualEmission, _epochDuration);
    }

    function setMinDistribution(uint256 _min) external onlyOwner {
        minDistribution = _min;
    }

    function setInsurancePool(address _pool) external onlyOwner {
        insurancePool = _pool;
    }

    // ============ View Functions ============

    /// @notice Preview next epoch's emission and split
    function previewNextEpoch() external view returns (
        uint256 emission,
        uint256 shardShare,
        uint256 daoShare,
        uint256 insuranceShare
    ) {
        uint256 elapsed = block.timestamp - lastDistribution;
        emission = (annualEmission * elapsed) / 365 days;

        uint256 totalSupply = ckbToken.totalSupply();
        if (totalSupply == 0) return (emission, 0, 0, emission);

        uint256 totalOccupied = ckbToken.totalOccupied();
        uint256 totalDAO = daoShelter.totalDeposited();

        shardShare = (emission * totalOccupied) / totalSupply;
        daoShare = (emission * totalDAO) / totalSupply;
        insuranceShare = emission - shardShare - daoShare;
    }

    /// @notice Time until next distribution is available
    function timeUntilNextEpoch() external view returns (uint256) {
        uint256 nextTime = lastDistribution + epochDuration;
        return block.timestamp >= nextTime ? 0 : nextTime - block.timestamp;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
