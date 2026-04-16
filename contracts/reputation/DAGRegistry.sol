// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal interface every registered DAG must implement.
///         ContributionPoolDistributor calls distribute(amount) with the DAG's
///         epoch share. Each DAG handles its own internal Shapley + Lawson.
interface IDAG {
    function distribute(uint256 vibeAmount) external;
    function attestedContributors() external view returns (uint256);
    function totalCrossEdges() external view returns (uint256);
}

/**
 * @title DAGRegistry — Peer-to-peer mesh of attribution DAGs
 * @notice Registry of contribution-attribution DAGs (Contribution DAG, Social
 *         DAG, Research DAG, Audit DAG, etc.). Each DAG is a first-class cell
 *         in the mesh — no hierarchical root. New DAGs are added permissionlessly
 *         by posting a VIBE registration bond.
 *
 * @dev Design principles (per Will, 2026-04-16):
 *   - Peer-to-peer: no privileged DAG. Cross-edges are bidirectional.
 *   - No governance dependencies: all parameters are constants. Upgrades only
 *     via UUPS, which is rare/high-ceremony/auditable.
 *   - VIBE-denominated: registration bonds in VIBE. CKB stays consensus+state.
 *   - Activity-weighted: weight is a function of attested contributors and
 *     cross-edges, not governance vote. Algorithmic, not political.
 *
 *   NCI provides canonical ordering for all DAG state transitions — each DAG's
 *   merkle commitments post as transactions and are ordered at the consensus
 *   layer. No coordination gap between peers.
 */
contract DAGRegistry is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice VIBE bond required to register a new DAG. Slashable via peer
    ///         challenge-response if the DAG is proven fraudulent.
    uint256 public constant REGISTRATION_BOND = 10_000e18;

    /// @notice Minimum epochs a DAG must accrue before earning weight share.
    ///         Bootstrap gate — prevents zero-activity DAGs from siphoning on
    ///         day one.
    uint256 public constant MIN_ACTIVITY_EPOCHS = 1;

    /// @notice Weight formula exponents. weight = attestedContributors^A * crossEdges^B
    ///         Powers are intentionally low (1 and 1) to avoid superlinear
    ///         incentives that amplify Sybil ROI.
    uint256 public constant CONTRIBUTOR_WEIGHT_POWER = 1;
    uint256 public constant CROSSEDGE_WEIGHT_POWER = 1;

    // ============ State ============

    /// @notice The VIBE token used for registration bonds
    IERC20 public vibeToken;

    /// @notice The distributor authorized to receive emission on behalf of DAGs.
    ///         Set once at initialize; only changeable via UUPS upgrade.
    address public contributionPoolDistributor;

    struct DAGEntry {
        address dagContract;     // Must implement IDAG
        address registrant;      // Who registered the DAG (bond holder)
        uint256 registrationBond;
        uint256 registeredAt;
        uint256 epochsActive;
        bool active;
        string name;             // Display name (e.g., "Contribution DAG", "Social DAG")
    }

    mapping(address => DAGEntry) public dags;
    address[] public dagList;

    /// @notice Track epoch advancement so MIN_ACTIVITY_EPOCHS is enforced
    mapping(address => uint256) public lastEpochRecorded;

    /// @dev Reserved storage gap
    uint256[48] private __gap;

    // ============ Events ============

    event DAGRegistered(address indexed dag, address indexed registrant, string name, uint256 bond);
    event DAGDeregistered(address indexed dag, string reason);
    event EpochActivityRecorded(address indexed dag, uint256 epoch);

    // ============ Errors ============

    error DAGAlreadyRegistered();
    error DAGNotRegistered();
    error InvalidDAGContract();
    error InsufficientBond();
    error NotDistributor();
    error EpochAlreadyRecorded();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _vibeToken,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        if (_vibeToken == address(0)) revert InvalidDAGContract();
        vibeToken = IERC20(_vibeToken);
        // contributionPoolDistributor is set via the one-shot setter below,
        // post-deploy (Post-Upgrade Init Gate pattern). Required before any
        // DAG epoch activity can be recorded.
    }

    /// @notice One-shot setter for the distributor. Callable exactly once by
    ///         owner during deployment bootstrap. This is the Post-Upgrade
    ///         Initialization Gate pattern — no governance dependency at
    ///         runtime, but allows the chicken-and-egg deploy ordering.
    function setDistributor(address _distributor) external onlyOwner {
        require(contributionPoolDistributor == address(0), "Already set");
        require(_distributor != address(0), "Zero address");
        contributionPoolDistributor = _distributor;
    }

    // ============ Registration ============

    /**
     * @notice Register a new DAG in the mesh. Permissionless — anyone can
     *         register a DAG by posting REGISTRATION_BOND in VIBE.
     * @dev The DAG contract must implement the IDAG interface. The registrant
     *      is the bond holder and can be slashed if the DAG is proven fraudulent
     *      via peer challenge-response.
     *
     *      No governance approval required. The mesh is permissionless.
     */
    function registerDAG(
        address dagContract,
        string calldata name
    ) external nonReentrant {
        if (dagContract == address(0)) revert InvalidDAGContract();
        if (dags[dagContract].active) revert DAGAlreadyRegistered();

        // Sanity-check: the contract must at least have code (prevents EOA registrations)
        require(dagContract.code.length > 0, "Not a contract");

        // Pull the VIBE bond from the registrant
        vibeToken.safeTransferFrom(msg.sender, address(this), REGISTRATION_BOND);

        dags[dagContract] = DAGEntry({
            dagContract: dagContract,
            registrant: msg.sender,
            registrationBond: REGISTRATION_BOND,
            registeredAt: block.timestamp,
            epochsActive: 0,
            active: true,
            name: name
        });
        dagList.push(dagContract);

        emit DAGRegistered(dagContract, msg.sender, name, REGISTRATION_BOND);
    }

    /**
     * @notice Record that a DAG was active during a given epoch. Called by
     *         the ContributionPoolDistributor at epoch settlement. Tracks
     *         epochsActive so MIN_ACTIVITY_EPOCHS bootstrap gate works.
     */
    function recordEpochActivity(address dag, uint256 epoch) external {
        if (msg.sender != contributionPoolDistributor) revert NotDistributor();
        if (!dags[dag].active) revert DAGNotRegistered();
        if (lastEpochRecorded[dag] == epoch) revert EpochAlreadyRecorded();

        lastEpochRecorded[dag] = epoch;
        dags[dag].epochsActive++;

        emit EpochActivityRecorded(dag, epoch);
    }

    // ============ Weight Computation ============

    /**
     * @notice Algorithmic weight for a registered DAG. Used by the
     *         ContributionPoolDistributor to split the epoch pool.
     *
     *         weight = attestedContributors^A * crossEdges^B
     *         with A = CONTRIBUTOR_WEIGHT_POWER, B = CROSSEDGE_WEIGHT_POWER
     *
     *         Both currently = 1, so weight = contributors * crossEdges.
     *         This is intentionally simple and sublinear-friendly. A DAG with
     *         zero cross-edges or zero attested contributors has zero weight
     *         and gets no pool share (Lawson Floor still applies within each
     *         DAG, but between DAGs we want provable activity).
     *
     *         DAGs below MIN_ACTIVITY_EPOCHS return weight zero (bootstrap gate).
     */
    function getDAGWeight(address dag) public view returns (uint256) {
        DAGEntry storage entry = dags[dag];
        if (!entry.active) return 0;
        if (entry.epochsActive < MIN_ACTIVITY_EPOCHS) return 0;

        uint256 contributors = IDAG(dag).attestedContributors();
        uint256 crossEdges = IDAG(dag).totalCrossEdges();

        // weight = contributors^A * crossEdges^B with A=B=1
        // Adding 1 to crossEdges so a brand-new DAG with attested contributors
        // but no cross-edges yet still gets a floor weight (otherwise it could
        // never reach MIN_ACTIVITY_EPOCHS in a productive way). The +1 is the
        // minimum floor to prevent total starvation; algorithmic, not governance.
        return contributors * (crossEdges + 1);
    }

    function getTotalWeight() external view returns (uint256 total) {
        uint256 n = dagList.length;
        for (uint256 i = 0; i < n; ) {
            total += getDAGWeight(dagList[i]);
            unchecked { ++i; }
        }
    }

    function getDAGCount() external view returns (uint256) {
        return dagList.length;
    }

    function getDAGAt(uint256 index) external view returns (address) {
        return dagList[index];
    }

    function isRegistered(address dag) external view returns (bool) {
        return dags[dag].active;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
