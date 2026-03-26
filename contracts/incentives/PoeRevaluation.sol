// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../mechanism/IABCHealthCheck.sol";

/**
 * @title PoeRevaluation — Posthumous/Overlooked Evidence Revaluation
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Allows retroactive revaluation of contributions whose worth was
 *         only recognized after their original Shapley game settled.
 *
 * @dev Named after Edgar Allan Poe, who died penniless while his work became
 *      priceless. The protocol must account for late-discovered value — not
 *      all contributions reveal their worth immediately.
 *
 *      Mechanism:
 *        1. Anyone can PROPOSE a Poe revaluation with evidence hash
 *        2. Community STAKES tokens to back the proposal (conviction)
 *        3. After conviction threshold, the proposal is EXECUTABLE
 *        4. Execution creates a new Shapley game funded from emissions
 *        5. ABC health gate enforced — no revaluations during curve stress
 *
 *      Safeguards:
 *        - Minimum conviction period (7 days) prevents impulsive claims
 *        - Staked tokens are locked until proposal resolves
 *        - ABC health gate immutably enforced
 *        - Maximum revaluation capped at 10% of Shapley pool per proposal
 *        - Cooldown per contributor prevents spam revaluations
 *
 *      P-000: Fairness Above All — even fairness that arrives late.
 *
 *      "To the few who love me and whom I love — to those who feel rather
 *       than to those who think — I offer this work." — Edgar Allan Poe
 */
contract PoeRevaluation is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS = 10000;
    uint256 public constant PRECISION = 1e18;

    /// @notice Minimum conviction period — 7 days of sustained belief
    uint256 public constant MIN_CONVICTION_PERIOD = 7 days;

    /// @notice Maximum revaluation: 10% of available Shapley pool per proposal
    uint256 public constant MAX_REVALUATION_BPS = 1000;

    /// @notice Cooldown between revaluations for the same contributor (30 days)
    uint256 public constant CONTRIBUTOR_COOLDOWN = 30 days;

    /// @notice Minimum conviction threshold as proportion of total staking token supply
    /// @dev 0.1% of supply must be staked to make a proposal executable
    uint256 public constant CONVICTION_THRESHOLD_BPS = 10;

    // ============ Enums ============

    enum ProposalState {
        PROPOSED,       // Awaiting conviction
        EXECUTABLE,     // Conviction threshold met, waiting for execution
        EXECUTED,       // Revaluation game created
        REJECTED        // Manually rejected or expired
    }

    // ============ Structs ============

    /**
     * @notice A Poe revaluation proposal
     * @param proposer Who proposed the revaluation
     * @param contributor The contributor being revalued (the "Poe")
     * @param evidenceHash IPFS hash or keccak256 of evidence document
     * @param description Short human-readable description
     * @param requestedBps Requested revaluation as BPS of Shapley pool
     * @param totalStaked Total tokens staked in conviction
     * @param proposedAt Timestamp of proposal creation
     * @param convictionMetAt When conviction threshold was first met (0 if not yet)
     * @param state Current proposal state
     */
    struct Proposal {
        address proposer;
        address contributor;
        bytes32 evidenceHash;
        string description;
        uint256 requestedBps;
        uint256 totalStaked;
        uint256 proposedAt;
        uint256 convictionMetAt;
        ProposalState state;
    }

    // ============ State ============

    /// @notice Staking token (VIBE)
    IERC20 public stakingToken;

    /// @notice ABC health checker
    IABCHealthCheck public bondingCurve;

    /// @notice Whether the bonding curve reference is sealed
    bool public bondingCurveSealed;

    /// @notice Address of EmissionController (to query Shapley pool)
    address public emissionController;

    /// @notice Address of ShapleyDistributor (to create revaluation games)
    address public shapleyDistributor;

    /// @notice Proposal counter
    uint256 public proposalCount;

    /// @notice Proposals by ID
    mapping(uint256 => Proposal) public proposals;

    /// @notice Staker => Proposal ID => Amount staked
    mapping(address => mapping(uint256 => uint256)) public stakes;

    /// @notice Contributor => last revaluation timestamp (cooldown enforcement)
    mapping(address => uint256) public lastRevaluation;

    /// @notice Proposal expiry (90 days without reaching conviction = expired)
    uint256 public constant PROPOSAL_EXPIRY = 90 days;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event PoeProposed(
        uint256 indexed proposalId,
        address indexed contributor,
        address indexed proposer,
        bytes32 evidenceHash,
        uint256 requestedBps,
        string description
    );

    event ConvictionStaked(uint256 indexed proposalId, address indexed staker, uint256 amount, uint256 totalStaked);
    event ConvictionUnstaked(uint256 indexed proposalId, address indexed staker, uint256 amount);
    event ConvictionThresholdMet(uint256 indexed proposalId, uint256 totalStaked, uint256 threshold);
    event PoeExecuted(uint256 indexed proposalId, address indexed contributor, uint256 revaluationAmount);
    event PoeRejected(uint256 indexed proposalId, string reason);
    event BondingCurveSealed(address indexed bondingCurve);

    // ============ Errors ============

    error ProposalNotFound();
    error InvalidState();
    error ConvictionPeriodNotMet();
    error CooldownActive(uint256 remainingSeconds);
    error RequestedTooMuch();
    error StakeZero();
    error NothingToUnstake();
    error ProposalExpired();
    error ABCUnhealthy(uint256 driftBps);
    error BondingCurveAlreadySealed();
    error ZeroAddress();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _stakingToken,
        address _emissionController,
        address _shapleyDistributor
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        stakingToken = IERC20(_stakingToken);
        emissionController = _emissionController;
        shapleyDistributor = _shapleyDistributor;
    }

    // ============ ABC Seal (Same Pattern as ShapleyDistributor) ============

    /**
     * @notice Seal the bonding curve reference — IRREVERSIBLE.
     */
    function sealBondingCurve(address _bondingCurve) external onlyOwner {
        if (bondingCurveSealed) revert BondingCurveAlreadySealed();
        if (_bondingCurve == address(0)) revert ZeroAddress();

        IABCHealthCheck abc = IABCHealthCheck(_bondingCurve);
        require(abc.isOpen(), "ABC not open");

        bondingCurve = abc;
        bondingCurveSealed = true;

        emit BondingCurveSealed(_bondingCurve);
    }

    function _requireABCHealthy() internal view {
        if (!bondingCurveSealed) return;

        (bool healthy, uint256 driftBps) = bondingCurve.isHealthy();
        if (!healthy) revert ABCUnhealthy(driftBps);
    }

    // ============ Propose ============

    /**
     * @notice Propose a Poe revaluation for a contributor whose work was
     *         undervalued at the time of original Shapley settlement.
     * @param contributor The address to be revalued
     * @param evidenceHash IPFS CID or keccak256 of evidence document
     * @param description Human-readable justification (max 280 chars — tweet-length)
     * @param requestedBps Requested revaluation as BPS of current Shapley pool
     */
    function propose(
        address contributor,
        bytes32 evidenceHash,
        string calldata description,
        uint256 requestedBps
    ) external returns (uint256 proposalId) {
        if (contributor == address(0)) revert ZeroAddress();
        if (requestedBps == 0 || requestedBps > MAX_REVALUATION_BPS) revert RequestedTooMuch();
        require(bytes(description).length <= 280, "Description too long");

        // Cooldown: prevent spam revaluations for the same contributor
        uint256 lastReval = lastRevaluation[contributor];
        if (lastReval > 0 && block.timestamp < lastReval + CONTRIBUTOR_COOLDOWN) {
            revert CooldownActive(lastReval + CONTRIBUTOR_COOLDOWN - block.timestamp);
        }

        proposalId = proposalCount++;

        proposals[proposalId] = Proposal({
            proposer: msg.sender,
            contributor: contributor,
            evidenceHash: evidenceHash,
            description: description,
            requestedBps: requestedBps,
            totalStaked: 0,
            proposedAt: block.timestamp,
            convictionMetAt: 0,
            state: ProposalState.PROPOSED
        });

        emit PoeProposed(proposalId, contributor, msg.sender, evidenceHash, requestedBps, description);
    }

    // ============ Conviction Staking ============

    /**
     * @notice Stake tokens to back a Poe proposal. Conviction = skin in the game.
     *         The more tokens staked, the stronger the community's belief that
     *         the contribution was undervalued.
     * @param proposalId The proposal to back
     * @param amount Tokens to stake
     */
    function stakeConviction(uint256 proposalId, uint256 amount) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.state != ProposalState.PROPOSED) revert InvalidState();
        if (amount == 0) revert StakeZero();

        // Check expiry
        if (block.timestamp > p.proposedAt + PROPOSAL_EXPIRY) {
            p.state = ProposalState.REJECTED;
            revert ProposalExpired();
        }

        // Transfer stake
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        stakes[msg.sender][proposalId] += amount;
        p.totalStaked += amount;

        emit ConvictionStaked(proposalId, msg.sender, amount, p.totalStaked);

        // Check if conviction threshold is met
        uint256 threshold = _convictionThreshold();
        if (p.totalStaked >= threshold && p.convictionMetAt == 0) {
            p.convictionMetAt = block.timestamp;
            p.state = ProposalState.EXECUTABLE;
            emit ConvictionThresholdMet(proposalId, p.totalStaked, threshold);
        }
    }

    /**
     * @notice Unstake tokens from a resolved or expired proposal
     * @param proposalId The proposal to unstake from
     */
    function unstake(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        uint256 staked = stakes[msg.sender][proposalId];
        if (staked == 0) revert NothingToUnstake();

        // Can only unstake from resolved proposals (EXECUTED or REJECTED)
        // or expired proposals
        bool resolved = p.state == ProposalState.EXECUTED || p.state == ProposalState.REJECTED;
        bool expired = block.timestamp > p.proposedAt + PROPOSAL_EXPIRY;

        if (!resolved && !expired) revert InvalidState();

        // If expired but not yet marked, mark it
        if (expired && p.state == ProposalState.PROPOSED) {
            p.state = ProposalState.REJECTED;
        }

        stakes[msg.sender][proposalId] = 0;
        p.totalStaked -= staked;

        stakingToken.safeTransfer(msg.sender, staked);

        emit ConvictionUnstaked(proposalId, msg.sender, staked);
    }

    // ============ Execute ============

    /**
     * @notice Execute a Poe revaluation after conviction period.
     * @dev Creates a new Shapley game via EmissionController to fund the
     *      revaluation. Requires ABC health gate.
     *
     *      "To be seen. To be valued. Even if it takes the world decades
     *       to catch up. The protocol remembers."
     *
     * @param proposalId The proposal to execute
     */
    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.state != ProposalState.EXECUTABLE) revert InvalidState();

        // Conviction period: must have sustained threshold for MIN_CONVICTION_PERIOD
        if (block.timestamp < p.convictionMetAt + MIN_CONVICTION_PERIOD) {
            revert ConvictionPeriodNotMet();
        }

        // ABC health gate — no revaluations during curve stress
        _requireABCHealthy();

        p.state = ProposalState.EXECUTED;
        lastRevaluation[p.contributor] = block.timestamp;

        emit PoeExecuted(proposalId, p.contributor, p.requestedBps);

        // The actual Shapley game creation is done by the authorized drainer
        // (EmissionController) — this contract emits the event and updates state.
        // The off-chain orchestrator reads PoeExecuted events and calls
        // EmissionController.createContributionGame() with the revaluation params.
        //
        // Why not call EmissionController directly?
        // 1. Separation of concerns — POE handles conviction, EC handles emissions
        // 2. EmissionController.createContributionGame() requires onlyDrainer
        // 3. The drainer can validate the POE event before executing
        //
        // This is intentional: conviction is permissionless, execution is gated.
    }

    // ============ Admin ============

    /**
     * @notice Reject a proposal (governance action)
     * @dev Only owner can reject. Stakers can unstake after rejection.
     */
    function reject(uint256 proposalId, string calldata reason) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.state == ProposalState.EXECUTED) revert InvalidState();

        p.state = ProposalState.REJECTED;

        emit PoeRejected(proposalId, reason);
    }

    // ============ View Functions ============

    /**
     * @notice Current conviction threshold (0.1% of staking token supply)
     */
    function _convictionThreshold() internal view returns (uint256) {
        uint256 totalSupply = stakingToken.totalSupply();
        return (totalSupply * CONVICTION_THRESHOLD_BPS) / BPS;
    }

    /**
     * @notice Get conviction threshold for UI display
     */
    function getConvictionThreshold() external view returns (uint256) {
        return _convictionThreshold();
    }

    /**
     * @notice Check if a proposal is executable
     */
    function isExecutable(uint256 proposalId) external view returns (bool) {
        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.EXECUTABLE) return false;
        if (block.timestamp < p.convictionMetAt + MIN_CONVICTION_PERIOD) return false;
        return true;
    }

    /**
     * @notice Get full proposal details
     */
    function getProposal(uint256 proposalId) external view returns (
        address proposer,
        address contributor,
        bytes32 evidenceHash,
        uint256 requestedBps,
        uint256 totalStaked,
        uint256 convictionThreshold,
        uint256 proposedAt,
        uint256 convictionMetAt,
        ProposalState state,
        bool expired
    ) {
        Proposal storage p = proposals[proposalId];
        proposer = p.proposer;
        contributor = p.contributor;
        evidenceHash = p.evidenceHash;
        requestedBps = p.requestedBps;
        totalStaked = p.totalStaked;
        convictionThreshold = _convictionThreshold();
        proposedAt = p.proposedAt;
        convictionMetAt = p.convictionMetAt;
        state = p.state;
        expired = block.timestamp > p.proposedAt + PROPOSAL_EXPIRY;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
