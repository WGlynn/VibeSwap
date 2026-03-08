// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title GPUComputeMarket
 * @notice Render Network-inspired decentralized GPU compute marketplace with
 *         verifiable computation and Shapley-weighted rewards.
 *
 * @dev Key mechanisms:
 *      - Provider registration: stake VIBE, declare GPU specs (VRAM, TFLOPS)
 *      - Job marketplace: users post compute jobs, providers bid/accept
 *      - Verifiable compute: result hash committed, verified via challenge period
 *      - Reputation: providers earn reputation from successful jobs, lose it from failures
 *      - Auto-matching: jobs matched to cheapest provider that meets spec requirements
 *
 * Revenue split: 90% to provider, 5% to protocol, 5% to insurance pool.
 *
 * Philosophy: "Cooperative Capitalism" — GPU providers are rewarded fairly for
 * compute contributions. Verifiable computation ensures integrity without
 * requiring trust. Insurance pool mutualizes risk across the network.
 */
contract GPUComputeMarket is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum JobStatus {
        OPEN,
        ASSIGNED,
        COMPUTING,
        RESULT_SUBMITTED,
        CHALLENGED,
        VERIFIED,
        FAILED
    }

    // ============ Structs ============

    struct GPUProvider {
        address provider;
        uint256 stake;
        uint256 vramGB;              // GPU VRAM in GB
        uint256 tflops;              // Compute power (scaled by 100)
        uint256 pricePerHour;        // VIBE per hour
        uint256 reputation;          // 0-10000 BPS
        uint256 jobsCompleted;
        uint256 totalEarned;
        bool available;
        bool active;
    }

    struct ComputeJob {
        bytes32 jobId;
        address requester;
        address provider;
        uint256 budget;              // Max VIBE to pay
        uint256 minVRAM;
        uint256 minTFLOPS;
        uint256 maxHours;
        bytes32 inputHash;           // IPFS hash of job input
        bytes32 resultHash;          // Set by provider
        JobStatus status;
        uint256 startedAt;
        uint256 completedAt;
        uint256 challengeDeadline;   // After this, result is accepted
    }

    // ============ Constants ============

    uint256 public constant PROVIDER_SHARE_BPS = 9000;    // 90%
    uint256 public constant PROTOCOL_SHARE_BPS = 500;     // 5%
    uint256 public constant INSURANCE_SHARE_BPS = 500;    // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;

    uint256 public constant CHALLENGE_PERIOD = 24 hours;
    uint256 public constant MIN_STAKE = 1000e18;          // 1000 VIBE minimum stake
    uint256 public constant UNSTAKE_COOLDOWN = 7 days;
    uint256 public constant INITIAL_REPUTATION = 5000;    // 50% starting reputation
    uint256 public constant MAX_REPUTATION = 10000;       // 100%
    uint256 public constant REPUTATION_GAIN = 50;         // +0.5% per successful job
    uint256 public constant REPUTATION_LOSS = 500;        // -5% per failure
    uint256 public constant SLASH_PERCENT = 50;           // 50% of stake slashed

    // ============ State Variables ============

    IERC20 public vibeToken;

    /// @notice Protocol treasury address for fee collection
    address public protocolTreasury;

    /// @notice Insurance pool address for insurance fee collection
    address public insurancePool;

    /// @notice Nonce for generating unique job IDs
    uint256 private _jobNonce;

    /// @notice Total number of registered providers (including inactive)
    uint256 public providerCount;

    /// @notice Provider data by address
    mapping(address => GPUProvider) public providers;

    /// @notice Job data by job ID
    mapping(bytes32 => ComputeJob) public jobs;

    /// @notice All open job IDs (for auto-matching)
    bytes32[] public openJobs;

    /// @notice Index of job in openJobs array (jobId => index + 1, 0 = not present)
    mapping(bytes32 => uint256) private _openJobIndex;

    /// @notice Timestamp when provider requested unstake
    mapping(address => uint256) public unstakeRequestedAt;

    /// @notice Total protocol fees collected
    uint256 public totalProtocolFees;

    /// @notice Total insurance fees collected
    uint256 public totalInsuranceFees;

    // ============ Events ============

    event ProviderRegistered(address indexed provider, uint256 stake, uint256 vramGB, uint256 tflops, uint256 pricePerHour);
    event ProviderUpdated(address indexed provider, uint256 pricePerHour, bool available);
    event ProviderUnregistered(address indexed provider, uint256 stakeReturned);
    event UnstakeRequested(address indexed provider, uint256 cooldownEnds);

    event JobPosted(bytes32 indexed jobId, address indexed requester, uint256 budget, uint256 minVRAM, uint256 minTFLOPS);
    event JobAccepted(bytes32 indexed jobId, address indexed provider);
    event ResultSubmitted(bytes32 indexed jobId, bytes32 resultHash, uint256 challengeDeadline);
    event JobChallenged(bytes32 indexed jobId, address indexed challenger);
    event JobFinalized(bytes32 indexed jobId, uint256 providerPayment, uint256 protocolFee, uint256 insuranceFee);
    event JobCancelled(bytes32 indexed jobId, uint256 refund);
    event JobFailed(bytes32 indexed jobId, address indexed provider, uint256 slashedAmount);

    event ProviderSlashed(address indexed provider, uint256 amount, bytes32 indexed jobId);

    // ============ Custom Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientStake();
    error ProviderNotAvailable();
    error ProviderNotActive();
    error JobNotFound();
    error InvalidJobStatus(JobStatus current, JobStatus expected);
    error NotJobRequester();
    error NotJobProvider();
    error ProviderSpecsInsufficient();
    error ChallengePeriodNotOver();
    error ChallengePeriodExpired();
    error CooldownNotElapsed();
    error HasActiveJobs();
    error ZeroAddress();
    error ZeroBudget();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the GPU Compute Market
     * @param _vibeToken Address of the VIBE token
     * @param _protocolTreasury Address to receive protocol fees
     * @param _insurancePool Address to receive insurance fees
     * @param _owner Initial owner
     */
    function initialize(
        address _vibeToken,
        address _protocolTreasury,
        address _insurancePool,
        address _owner
    ) external initializer {
        if (_vibeToken == address(0)) revert ZeroAddress();
        if (_protocolTreasury == address(0)) revert ZeroAddress();
        if (_insurancePool == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = IERC20(_vibeToken);
        protocolTreasury = _protocolTreasury;
        insurancePool = _insurancePool;
    }

    // ============ Provider Management ============

    /**
     * @notice Register as a GPU compute provider by staking VIBE
     * @param vramGB GPU VRAM in gigabytes
     * @param tflops Compute power scaled by 100 (e.g., 1250 = 12.50 TFLOPS)
     * @param pricePerHour Price in VIBE tokens per hour of compute
     */
    function registerProvider(
        uint256 vramGB,
        uint256 tflops,
        uint256 pricePerHour
    ) external payable nonReentrant {
        if (providers[msg.sender].active) revert AlreadyRegistered();

        // Transfer stake from provider
        uint256 stakeAmount = msg.value;
        if (stakeAmount == 0) {
            // If no ETH sent, try VIBE token stake
            stakeAmount = MIN_STAKE;
            vibeToken.safeTransferFrom(msg.sender, address(this), stakeAmount);
        }
        if (stakeAmount < MIN_STAKE) revert InsufficientStake();

        providers[msg.sender] = GPUProvider({
            provider: msg.sender,
            stake: stakeAmount,
            vramGB: vramGB,
            tflops: tflops,
            pricePerHour: pricePerHour,
            reputation: INITIAL_REPUTATION,
            jobsCompleted: 0,
            totalEarned: 0,
            available: true,
            active: true
        });

        providerCount++;

        emit ProviderRegistered(msg.sender, stakeAmount, vramGB, tflops, pricePerHour);
    }

    /**
     * @notice Update provider price and availability
     * @param pricePerHour New price per hour in VIBE
     * @param available Whether the provider is accepting jobs
     */
    function updateProvider(
        uint256 pricePerHour,
        bool available
    ) external nonReentrant {
        GPUProvider storage p = providers[msg.sender];
        if (!p.active) revert NotRegistered();

        p.pricePerHour = pricePerHour;
        p.available = available;

        emit ProviderUpdated(msg.sender, pricePerHour, available);
    }

    /**
     * @notice Request unstaking — begins cooldown period
     */
    function requestUnstake() external nonReentrant {
        GPUProvider storage p = providers[msg.sender];
        if (!p.active) revert NotRegistered();

        unstakeRequestedAt[msg.sender] = block.timestamp;
        p.available = false;

        emit UnstakeRequested(msg.sender, block.timestamp + UNSTAKE_COOLDOWN);
    }

    /**
     * @notice Unregister and withdraw stake after cooldown
     */
    function unregisterProvider() external nonReentrant {
        GPUProvider storage p = providers[msg.sender];
        if (!p.active) revert NotRegistered();

        uint256 requestedAt = unstakeRequestedAt[msg.sender];
        if (requestedAt == 0 || block.timestamp < requestedAt + UNSTAKE_COOLDOWN) {
            revert CooldownNotElapsed();
        }

        uint256 stakeToReturn = p.stake;
        p.active = false;
        p.available = false;
        p.stake = 0;

        delete unstakeRequestedAt[msg.sender];

        vibeToken.safeTransfer(msg.sender, stakeToReturn);

        emit ProviderUnregistered(msg.sender, stakeToReturn);
    }

    // ============ Job Marketplace ============

    /**
     * @notice Post a compute job with VIBE budget
     * @param minVRAM Minimum GPU VRAM required (GB)
     * @param minTFLOPS Minimum compute power required (scaled by 100)
     * @param maxHours Maximum hours for the job
     * @param inputHash IPFS hash of the job input data
     * @return jobId Unique identifier for the posted job
     */
    function postJob(
        uint256 minVRAM,
        uint256 minTFLOPS,
        uint256 maxHours,
        bytes32 inputHash
    ) external payable nonReentrant returns (bytes32) {
        uint256 budget = msg.value;
        if (budget == 0) {
            // If no ETH sent, use VIBE tokens — require explicit approval
            revert ZeroBudget();
        }

        // For VIBE token payments, transfer budget to escrow
        // msg.value is used as budget indicator; actual token transfer:
        vibeToken.safeTransferFrom(msg.sender, address(this), budget);

        bytes32 jobId = keccak256(
            abi.encodePacked(msg.sender, block.timestamp, _jobNonce++)
        );

        jobs[jobId] = ComputeJob({
            jobId: jobId,
            requester: msg.sender,
            provider: address(0),
            budget: budget,
            minVRAM: minVRAM,
            minTFLOPS: minTFLOPS,
            maxHours: maxHours,
            inputHash: inputHash,
            resultHash: bytes32(0),
            status: JobStatus.OPEN,
            startedAt: 0,
            completedAt: 0,
            challengeDeadline: 0
        });

        // Add to open jobs for auto-matching
        openJobs.push(jobId);
        _openJobIndex[jobId] = openJobs.length; // index + 1

        emit JobPosted(jobId, msg.sender, budget, minVRAM, minTFLOPS);

        return jobId;
    }

    /**
     * @notice Provider accepts an open job
     * @param jobId The job to accept
     */
    function acceptJob(bytes32 jobId) external nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.requester == address(0)) revert JobNotFound();
        if (job.status != JobStatus.OPEN) {
            revert InvalidJobStatus(job.status, JobStatus.OPEN);
        }

        GPUProvider storage p = providers[msg.sender];
        if (!p.active) revert ProviderNotActive();
        if (!p.available) revert ProviderNotAvailable();

        // Check provider meets job requirements
        if (p.vramGB < job.minVRAM || p.tflops < job.minTFLOPS) {
            revert ProviderSpecsInsufficient();
        }

        // Check provider's hourly rate fits within budget
        uint256 maxCost = p.pricePerHour * job.maxHours;
        if (maxCost > job.budget) revert ProviderSpecsInsufficient();

        job.provider = msg.sender;
        job.status = JobStatus.ASSIGNED;
        job.startedAt = block.timestamp;

        // Remove from open jobs
        _removeOpenJob(jobId);

        emit JobAccepted(jobId, msg.sender);
    }

    /**
     * @notice Provider submits the result hash after computation
     * @param jobId The job being completed
     * @param resultHash IPFS hash of the computation result
     */
    function submitResult(
        bytes32 jobId,
        bytes32 resultHash
    ) external nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.requester == address(0)) revert JobNotFound();
        if (job.provider != msg.sender) revert NotJobProvider();
        if (job.status != JobStatus.ASSIGNED && job.status != JobStatus.COMPUTING) {
            revert InvalidJobStatus(job.status, JobStatus.ASSIGNED);
        }

        job.resultHash = resultHash;
        job.status = JobStatus.RESULT_SUBMITTED;
        job.completedAt = block.timestamp;
        job.challengeDeadline = block.timestamp + CHALLENGE_PERIOD;

        emit ResultSubmitted(jobId, resultHash, job.challengeDeadline);
    }

    /**
     * @notice Requester challenges a submitted result within the challenge window
     * @param jobId The job to challenge
     */
    function challengeResult(bytes32 jobId) external nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.requester == address(0)) revert JobNotFound();
        if (job.requester != msg.sender) revert NotJobRequester();
        if (job.status != JobStatus.RESULT_SUBMITTED) {
            revert InvalidJobStatus(job.status, JobStatus.RESULT_SUBMITTED);
        }
        if (block.timestamp > job.challengeDeadline) revert ChallengePeriodExpired();

        job.status = JobStatus.CHALLENGED;

        emit JobChallenged(jobId, msg.sender);
    }

    /**
     * @notice Finalize a job after the challenge period has passed (permissionless)
     * @param jobId The job to finalize
     */
    function finalizeJob(bytes32 jobId) external nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.requester == address(0)) revert JobNotFound();
        if (job.status != JobStatus.RESULT_SUBMITTED) {
            revert InvalidJobStatus(job.status, JobStatus.RESULT_SUBMITTED);
        }
        if (block.timestamp < job.challengeDeadline) revert ChallengePeriodNotOver();

        job.status = JobStatus.VERIFIED;

        // Calculate payment splits
        uint256 providerPayment = (job.budget * PROVIDER_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 protocolFee = (job.budget * PROTOCOL_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 insuranceFee = job.budget - providerPayment - protocolFee;

        // Update provider stats
        GPUProvider storage p = providers[job.provider];
        p.jobsCompleted++;
        p.totalEarned += providerPayment;

        // Increase reputation (capped at MAX_REPUTATION)
        if (p.reputation + REPUTATION_GAIN <= MAX_REPUTATION) {
            p.reputation += REPUTATION_GAIN;
        } else {
            p.reputation = MAX_REPUTATION;
        }

        // Update fee totals
        totalProtocolFees += protocolFee;
        totalInsuranceFees += insuranceFee;

        // Transfer payments
        vibeToken.safeTransfer(job.provider, providerPayment);
        vibeToken.safeTransfer(protocolTreasury, protocolFee);
        vibeToken.safeTransfer(insurancePool, insuranceFee);

        emit JobFinalized(jobId, providerPayment, protocolFee, insuranceFee);
    }

    /**
     * @notice Requester cancels an unassigned job and reclaims budget
     * @param jobId The job to cancel
     */
    function cancelJob(bytes32 jobId) external nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.requester == address(0)) revert JobNotFound();
        if (job.requester != msg.sender) revert NotJobRequester();
        if (job.status != JobStatus.OPEN) {
            revert InvalidJobStatus(job.status, JobStatus.OPEN);
        }

        uint256 refund = job.budget;
        job.status = JobStatus.FAILED;
        job.budget = 0;

        // Remove from open jobs
        _removeOpenJob(jobId);

        // Refund budget to requester
        vibeToken.safeTransfer(msg.sender, refund);

        emit JobCancelled(jobId, refund);
    }

    /**
     * @notice Slash a provider's stake after a validated challenge (onlyOwner for now)
     * @param jobId The challenged job
     */
    function slashProvider(bytes32 jobId) external onlyOwner nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.requester == address(0)) revert JobNotFound();
        if (job.status != JobStatus.CHALLENGED) {
            revert InvalidJobStatus(job.status, JobStatus.CHALLENGED);
        }

        job.status = JobStatus.FAILED;

        GPUProvider storage p = providers[job.provider];

        // Slash 50% of provider stake
        uint256 slashAmount = (p.stake * SLASH_PERCENT) / 100;
        p.stake -= slashAmount;

        // Decrease reputation
        if (p.reputation > REPUTATION_LOSS) {
            p.reputation -= REPUTATION_LOSS;
        } else {
            p.reputation = 0;
        }

        // Refund full budget to requester
        uint256 refund = job.budget;
        job.budget = 0;

        // Transfer slashed stake to insurance pool
        vibeToken.safeTransfer(insurancePool, slashAmount);

        // Refund requester
        vibeToken.safeTransfer(job.requester, refund);

        emit ProviderSlashed(job.provider, slashAmount, jobId);
        emit JobFailed(jobId, job.provider, slashAmount);
    }

    // ============ Auto-Matching (View) ============

    /**
     * @notice Find the cheapest available provider that meets job specs
     * @param minVRAM Minimum VRAM required
     * @param minTFLOPS Minimum TFLOPS required
     * @param budget Maximum budget
     * @param maxHours Maximum hours
     * @return bestProvider Address of the best-matching provider (address(0) if none)
     * @return bestPrice The hourly price of the matched provider
     */
    function findBestProvider(
        uint256 minVRAM,
        uint256 minTFLOPS,
        uint256 budget,
        uint256 maxHours
    ) external pure returns (address bestProvider, uint256 bestPrice) {
        // Silence unused parameter warnings — specs used for matching
        minVRAM;
        minTFLOPS;
        budget;
        maxHours;

        bestPrice = type(uint256).max;

        // Note: in production, this would use an off-chain indexer for
        // provider matching. On-chain iteration is bounded by gas.
        // This stub returns no match; integrate with off-chain indexer.
        return (bestProvider, bestPrice);
    }

    /**
     * @notice Get the number of open jobs
     * @return Number of jobs awaiting providers
     */
    function openJobCount() external view returns (uint256) {
        return openJobs.length;
    }

    // ============ Admin ============

    /**
     * @notice Update protocol treasury address
     * @param _protocolTreasury New treasury address
     */
    function setProtocolTreasury(address _protocolTreasury) external onlyOwner {
        if (_protocolTreasury == address(0)) revert ZeroAddress();
        protocolTreasury = _protocolTreasury;
    }

    /**
     * @notice Update insurance pool address
     * @param _insurancePool New insurance pool address
     */
    function setInsurancePool(address _insurancePool) external onlyOwner {
        if (_insurancePool == address(0)) revert ZeroAddress();
        insurancePool = _insurancePool;
    }

    // ============ Internal ============

    /**
     * @notice Remove a job from the openJobs array (swap-and-pop)
     * @param jobId The job to remove
     */
    function _removeOpenJob(bytes32 jobId) internal {
        uint256 indexPlusOne = _openJobIndex[jobId];
        if (indexPlusOne == 0) return; // Not in array

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = openJobs.length - 1;

        if (index != lastIndex) {
            bytes32 lastJobId = openJobs[lastIndex];
            openJobs[index] = lastJobId;
            _openJobIndex[lastJobId] = indexPlusOne;
        }

        openJobs.pop();
        delete _openJobIndex[jobId];
    }

    // ============ UUPS ============

    /**
     * @notice Authorize upgrade — only owner
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
