// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./DAGRegistry.sol";

/// @notice VIBE mint interface — matches VIBEToken.mint()
interface IVIBEMinter {
    function mint(address to, uint256 amount) external;
    function totalSupply() external view returns (uint256);
}

/**
 * @title ContributionPoolDistributor — VIBE emission router for the DAG mesh
 * @notice Receives a fixed annual VIBE emission budget (Bitcoin-halving
 *         schedule, mirrors VIBE's own halving logic) and routes it across
 *         all DAGs registered in DAGRegistry by activity weight.
 *
 * @dev Design (per Will, 2026-04-16):
 *   - No governance dependencies. Constants fixed at deploy, change only via
 *     UUPS upgrade.
 *   - VIBE as stake + reward. CKB stays consensus+state, not touched here.
 *   - Bitcoin-halving emission schedule: ANNUAL_BUDGET_ERA0 × 0.5^era per year.
 *   - Per-epoch distribution (weekly). Permissionless — any caller can
 *     trigger distributeEpoch() once EPOCH_DURATION has elapsed.
 *
 *   CRITICAL INVARIANT: this contract MINTS VIBE. It must be registered as
 *   an authorized minter in VIBEToken (via VIBEToken.setMinter()) AFTER
 *   Will reviews the deployment. V1 contract does not assume the authorization
 *   exists at deploy time; distributeEpoch() will revert Unauthorized from
 *   the token until the authorization is explicitly granted.
 *
 *   Per-era budget is a CONSTANT, not a setter. No way to inflate allocation
 *   at runtime. Only way to change is UUPS upgrade, which is high-ceremony.
 */
contract ContributionPoolDistributor is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Annual VIBE emission budget at era 0 (pre-first-halving).
    ///         100,000 VIBE/year ≈ 0.476% of MAX_SUPPLY (21M). Across all
    ///         halvings lifetime budget sums to ~4× annual = 400K VIBE to
    ///         the contribution pool total, < 2% of hard cap.
    uint256 public constant ANNUAL_BUDGET_ERA0 = 100_000e18;

    /// @notice Seconds per halving era. Matches Bitcoin's 4-year schedule
    ///         (actual Bitcoin halves every 210_000 blocks ≈ 4 years).
    uint256 public constant SECONDS_PER_ERA = 4 * 365 days + 1 days; // 1461 days

    /// @notice Max halving eras. After era 32 emissions are effectively zero.
    uint8 public constant MAX_ERA = 32;

    /// @notice Distribution cadence. Each epoch is a week — matches the
    ///         SocialDAG epoch cadence so merkle roots align.
    uint256 public constant EPOCH_DURATION = 7 days;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    // ============ State ============

    IVIBEMinter public vibeToken;
    DAGRegistry public dagRegistry;

    /// @notice Deploy timestamp — start of era 0
    uint256 public genesisTimestamp;

    /// @notice Last epoch that was distributed
    uint256 public lastDistributedEpoch;

    /// @notice Total VIBE ever distributed through this contract
    uint256 public totalDistributed;

    /// @dev Reserved storage gap
    uint256[48] private __gap;

    // ============ Events ============

    event EpochDistributed(
        uint256 indexed epoch,
        uint256 totalEmitted,
        uint256 dagCount,
        uint256 totalWeight,
        uint8 era
    );
    event DAGShareRouted(address indexed dag, uint256 amount, uint256 weight);

    // ============ Errors ============

    error TooSoon();
    error NoActiveDAGs();
    error ZeroEmission();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _vibeToken,
        address _dagRegistry,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = IVIBEMinter(_vibeToken);
        dagRegistry = DAGRegistry(_dagRegistry);
        genesisTimestamp = block.timestamp;
        lastDistributedEpoch = 0;
    }

    // ============ Emission math ============

    /**
     * @notice Current halving era — how many halvings have occurred since genesis.
     */
    function currentEra() public view returns (uint8) {
        uint256 elapsed = block.timestamp - genesisTimestamp;
        uint256 era = elapsed / SECONDS_PER_ERA;
        if (era >= MAX_ERA) return MAX_ERA;
        return uint8(era);
    }

    /**
     * @notice Per-epoch emission budget at the given era.
     *
     *   budget(era) = ANNUAL_BUDGET_ERA0 × 2^-era × (EPOCH_DURATION / 365 days)
     *
     *   At era 0: ~1,917 VIBE/epoch (100K / 52 weeks)
     *   At era 1: ~958 VIBE/epoch
     *   At era 32: effectively zero
     */
    function epochEmission(uint8 era) public pure returns (uint256) {
        if (era >= MAX_ERA) return 0;
        uint256 annualAtEra = ANNUAL_BUDGET_ERA0 >> era; // divide by 2^era
        return (annualAtEra * EPOCH_DURATION) / 365 days;
    }

    /**
     * @notice Current epoch number — how many full EPOCH_DURATION intervals
     *         have elapsed since genesis.
     */
    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesisTimestamp) / EPOCH_DURATION;
    }

    /**
     * @notice How much VIBE is ready to distribute (accumulated unclaimed).
     */
    function pendingEmission() external view returns (uint256) {
        uint256 currEpoch = currentEpoch();
        if (currEpoch <= lastDistributedEpoch) return 0;
        uint8 era = currentEra();
        uint256 epochsOwed = currEpoch - lastDistributedEpoch;
        return epochsOwed * epochEmission(era);
    }

    // ============ Distribution ============

    /**
     * @notice Distribute the next epoch's VIBE emission across registered DAGs
     *         by activity weight. Permissionless — any caller triggers once
     *         the epoch boundary has passed.
     *
     * @dev Requires:
     *   - VIBEToken has authorized this contract as a minter (set once, post-deploy)
     *   - At least one DAG is registered and active in DAGRegistry
     *   - EPOCH_DURATION has elapsed since the last distribution
     *
     * @dev If total weight across DAGs is zero (no activity yet), the epoch
     *      is skipped — VIBE is not minted. Emission is forfeit for that
     *      epoch; cannot be retroactively claimed. This is intentional:
     *      zero-activity epochs produce zero inflation.
     */
    function distributeEpoch() external nonReentrant {
        uint256 currEpoch = currentEpoch();
        if (currEpoch <= lastDistributedEpoch) revert TooSoon();

        uint8 era = currentEra();
        uint256 perEpochBudget = epochEmission(era);
        if (perEpochBudget == 0) revert ZeroEmission();

        // Consolidate any missed epochs into one distribution
        uint256 epochsOwed = currEpoch - lastDistributedEpoch;
        uint256 totalBudget = perEpochBudget * epochsOwed;

        uint256 n = dagRegistry.getDAGCount();
        if (n == 0) {
            // No DAGs registered — advance epoch pointer but mint nothing
            lastDistributedEpoch = currEpoch;
            return;
        }

        // Record activity for every registered DAG FIRST — this lets the
        // MIN_ACTIVITY_EPOCHS bootstrap gate advance even when totalWeight
        // is zero on the first distribute pass (new DAGs start at
        // epochsActive=0 with weight 0; they need an epoch recorded before
        // weight becomes nonzero).
        for (uint256 j = 0; j < n; ) {
            try dagRegistry.recordEpochActivity(dagRegistry.getDAGAt(j), currEpoch) {} catch {}
            unchecked { ++j; }
        }

        uint256 totalWeight = dagRegistry.getTotalWeight();
        if (totalWeight == 0) {
            // No active weight — advance pointer, mint nothing
            lastDistributedEpoch = currEpoch;
            return;
        }

        // Route to each DAG by weight.
        uint256 actuallyDistributed = 0;
        for (uint256 i = 0; i < n; ) {
            address dag = dagRegistry.getDAGAt(i);
            uint256 weight = dagRegistry.getDAGWeight(dag);
            if (weight == 0) {
                unchecked { ++i; }
                continue;
            }

            uint256 share = (totalBudget * weight) / totalWeight;
            if (share == 0) {
                unchecked { ++i; }
                continue;
            }

            // Mint directly to the distributor so it can approve + the DAG
            // pulls via transferFrom inside distribute().
            vibeToken.mint(address(this), share);
            IERC20(address(vibeToken)).forceApprove(dag, share);
            // Graceful Distribution Fallback: one bad DAG can't block others.
            try IDAG(dag).distribute(share) {
                actuallyDistributed += share;
                emit DAGShareRouted(dag, share, weight);
            } catch {
                // Clear approval; keep share on distributor (V1 conservatism).
                IERC20(address(vibeToken)).forceApprove(dag, 0);
            }

            unchecked { ++i; }
        }

        lastDistributedEpoch = currEpoch;
        totalDistributed += actuallyDistributed;

        emit EpochDistributed(currEpoch, actuallyDistributed, n, totalWeight, era);
    }

    // ============ Views ============

    function isOperational() external view returns (bool) {
        // True only if all wiring is in place. Off-chain can poll this before
        // calling distributeEpoch.
        return address(vibeToken) != address(0) && address(dagRegistry) != address(0);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // Needed for forceApprove via IERC20
    // (VIBEToken implements IERC20; no extra shim required)
}
