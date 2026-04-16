// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
    /// @notice C7-GOV-001: Aggregate off-circulation = totalOccupied + sum of registered holder balances
    function offCirculation() external view returns (uint256);
    /// @notice C10-AUDIT-5: Used to detect daoShelter double-registration at distribute time
    function isOffCirculationHolder(address) external view returns (bool);
    function balanceOf(address) external view returns (uint256);
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
    using SafeERC20 for IERC20;

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

    /// @notice C11-AUDIT-1: Minimum gas that must remain before the external
    ///         distributeRewards / depositYield calls. Each try/catch forwards
    ///         only 63/64 of gasleft() (EIP-150). A hostile upgradeable
    ///         shardRegistry or daoShelter could burn 63/64*gasleft() to force
    ///         the catch branch on every epoch, permanently diverting funds.
    ///         Halting the epoch is safer than silently rerouting.
    uint256 public constant MIN_DISTRIBUTE_GAS = 200_000;

    /// @dev Reserved storage gap
    uint256[50] private __gap;

    // ============ Errors (extended) ============

    error InsufficientGas();
    error ShelterShortPull();

    // ============ Events ============

    event EpochDistributed(
        uint256 indexed epoch,
        uint256 shardShare,
        uint256 daoShare,
        uint256 insuranceShare,
        uint256 totalEmitted
    );
    event ParametersUpdated(uint256 annualEmission, uint256 epochDuration);

    /// @notice C14-AUDIT-4: emitted when a try/catch branch reroutes shardShare or
    ///         daoShare to the insurance pool (catch path). Observability for the
    ///         rerouted portion that does NOT appear in EpochDistributed.shardShare
    ///         or .daoShare (those report the ORIGINAL split, not post-catch flows).
    event ShareRerouted(uint256 indexed epoch, string reason, uint256 amount);

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

        // C7-GOV-001: Use offCirculation() instead of totalOccupied() so tokens held by
        // registered staking/collateral contracts (NCI, VibeStable, JCV) count toward
        // shard share. Previously these were invisible to the split.
        uint256 offCirc = ckbToken.offCirculation();
        uint256 totalDAO = daoShelter.totalDeposited();

        // C10-AUDIT-5: Defense-in-depth against daoShelter being mistakenly
        // registered as an off-circulation holder. Its balance is already
        // accounted for via daoShelter.totalDeposited() below — counting it
        // twice would starve insurance. Subtract if double-registered.
        // C11-AUDIT-10: subtract totalDeposited (principal), NOT balanceOf.
        // balanceOf includes unwithdrawn yield, which is NOT double-counted
        // by totalDeposited. Subtracting balance over-corrects and silently
        // under-weights shardShare on every epoch.
        if (ckbToken.isOffCirculationHolder(address(daoShelter))) {
            uint256 shelterPrincipal = totalDAO;
            offCirc = offCirc > shelterPrincipal ? offCirc - shelterPrincipal : 0;
        }

        // NCI-003/MON-006: 3-way split with underflow protection.
        // offCirc + totalDAO can exceed totalSupply (DAO deposits are in-supply tokens),
        // which would cause insuranceShare to underflow. Cap proportionally.
        uint256 shardShare = (emission * offCirc) / totalSupply;
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
        // C5-CON-003: Use SafeERC20 forceApprove (handles approve-to-zero race)
        // C7-ISS-001: try/catch prevents ShardRegistry revert (no active shards)
        //   from blocking entire epoch. Redirects to insurance if shards unavailable.
        if (shardShare > 0) {
            ckbToken.mint(address(this), shardShare);
            IERC20(address(ckbToken)).forceApprove(address(shardRegistry), shardShare);
            // C11-AUDIT-1: floor so a hostile registry can't 63/64-OOG-grief
            // into the catch branch.
            if (gasleft() < MIN_DISTRIBUTE_GAS) revert InsufficientGas();
            try shardRegistry.distributeRewards(shardShare) {
                // success
            } catch {
                // No active shards — clear approval, redirect to insurance.
                // C14-AUDIT-4: emit observability event (parity with dao-shelter catch).
                // No insuranceShare mutation — this path is already supply-neutral because
                // the minted shardShare is transferred (not re-minted).
                IERC20(address(ckbToken)).forceApprove(address(shardRegistry), 0);
                IERC20(address(ckbToken)).safeTransfer(insurancePool, shardShare);
                emit ShareRerouted(totalDistributed, "shard-registry-catch", shardShare);
            }
        }

        // C10-AUDIT-4: try/catch the depositYield call (mirrors C7-ISS-001 pattern
        // for shardRegistry). If shelter reverts (e.g. totalDeposited == 0), the
        // approved tokens are swept to insurance so no wei of emission is left
        // stranded on the controller address.
        // C11-AUDIT-1: if depositYield returns SUCCESSFULLY but pulled less than
        // daoShare, that's a buggy/hostile shelter — halt the epoch rather than
        // silently rerouting. Short-pull isn't reachable from a standard OZ
        // ERC20 (transferFrom reverts or transfers full amount), so the only
        // way to hit this revert is through a hostile shelter upgrade that
        // short-transfers. Reverting forces operator intervention.
        uint256 daoShareRerouted;
        if (daoShare > 0) {
            ckbToken.mint(address(this), daoShare);
            IERC20(address(ckbToken)).forceApprove(address(daoShelter), daoShare);
            uint256 balBefore = IERC20(address(ckbToken)).balanceOf(address(this));
            // C11-AUDIT-1: gas floor — symmetric with the shardRegistry path.
            if (gasleft() < MIN_DISTRIBUTE_GAS) revert InsufficientGas();
            try daoShelter.depositYield(daoShare) {
                uint256 balAfter = IERC20(address(ckbToken)).balanceOf(address(this));
                uint256 actuallyPulled = balBefore - balAfter;
                if (actuallyPulled < daoShare) revert ShelterShortPull();
            } catch {
                // C10-AUDIT-4 + C14-AUDIT-3: reroute daoShare to insurance when shelter
                // cannot accept yield (e.g. totalDeposited == 0 → NoDepositors revert).
                // C14-AUDIT-4: the already-minted daoShare is transferred (no new supply).
                //              Previously this was ALSO added to insuranceShare and minted
                //              fresh at line below → over-emission by daoShare per catch.
                //              Now tracked separately via daoShareRerouted + ShareRerouted
                //              event for observability, but NOT minted twice.
                IERC20(address(ckbToken)).forceApprove(address(daoShelter), 0);
                IERC20(address(ckbToken)).safeTransfer(insurancePool, daoShare);
                daoShareRerouted = daoShare;
                emit ShareRerouted(totalDistributed, "dao-shelter-catch", daoShare);
                daoShare = 0;
            }
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
    /// @dev C5-CON-004: Mirrors distributeEpoch()'s underflow protection
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

        // C7-GOV-001: mirror distributeEpoch — use offCirculation() not totalOccupied()
        uint256 offCirc = ckbToken.offCirculation();
        uint256 totalDAO = daoShelter.totalDeposited();

        shardShare = (emission * offCirc) / totalSupply;
        daoShare = (emission * totalDAO) / totalSupply;

        // C5-CON-004: Same underflow guard as distributeEpoch()
        if (shardShare + daoShare > emission) {
            uint256 combinedBefore = shardShare + daoShare;
            shardShare = (emission * shardShare) / combinedBefore;
            daoShare = emission - shardShare;
            insuranceShare = 0;
        } else {
            insuranceShare = emission - shardShare - daoShare;
        }
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
