// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DataMarketplace
 * @notice Ocean Protocol-inspired data marketplace merged with OriginTrail's
 *         knowledge asset pattern. Users tokenize datasets as NFTs and sell
 *         access or compute-on-data without exposing raw data.
 *
 * @dev Key mechanisms:
 *      - Data NFTs: ERC-721-style ownership of datasets (tracked internally)
 *      - Access tokens: purchaseAccess grants on-chain access rights
 *      - Compute-to-data: submit algorithms to run on data without downloading
 *      - Knowledge assets: structured knowledge graphs with DKA anchoring
 *      - Shapley pricing: data value attributed by contribution to downstream results
 *
 * Revenue split: 90% to data owner, 10% to protocol (Shapley pool).
 *
 * Philosophy: "Cooperative Capitalism" — data providers are rewarded for
 * contributions to collective intelligence. Compute-to-data preserves privacy
 * while enabling permissionless data science.
 */
contract DataMarketplace is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum AssetType { DATASET, MODEL, KNOWLEDGE_GRAPH, API_ENDPOINT }
    enum ComputeStatus { PENDING, RUNNING, COMPLETED, FAILED }

    // ============ Structs ============

    struct DataAsset {
        uint256 assetId;
        address owner;
        string metadataURI;         // IPFS URI for metadata
        bytes32 contentHash;        // Hash of actual data
        uint256 accessPrice;        // Price per access in VIBE
        uint256 computePrice;       // Price per compute job in VIBE
        uint256 totalAccesses;
        uint256 totalRevenue;
        AssetType assetType;
        bool active;
    }

    struct ComputeJob {
        bytes32 jobId;
        uint256 assetId;
        address requester;
        bytes32 algorithmHash;      // IPFS hash of the algorithm to run
        bytes32 resultHash;         // IPFS hash of the result (set after completion)
        uint256 payment;
        ComputeStatus status;
        uint256 submittedAt;
        uint256 completedAt;
    }

    // ============ Constants ============

    uint256 public constant OWNER_SHARE_BPS = 9000;     // 90%
    uint256 public constant PROTOCOL_SHARE_BPS = 1000;   // 10%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ============ State Variables ============

    IERC20 public vibeToken;

    uint256 public nextAssetId;
    uint256 private _jobNonce;

    /// @notice assetId => DataAsset
    mapping(uint256 => DataAsset) private _assets;

    /// @notice jobId => ComputeJob
    mapping(bytes32 => ComputeJob) private _computeJobs;

    /// @notice assetId => user => hasAccess
    mapping(uint256 => mapping(address => bool)) public hasAccess;

    /// @notice assetId => withdrawable revenue for owner (after protocol cut)
    mapping(uint256 => uint256) public ownerRevenue;

    /// @notice Total protocol fees accumulated (Shapley pool)
    uint256 public protocolRevenue;

    // ============ Events ============

    event AssetPublished(
        uint256 indexed assetId,
        address indexed owner,
        string metadataURI,
        bytes32 contentHash,
        AssetType assetType
    );

    event AccessPurchased(
        uint256 indexed assetId,
        address indexed buyer,
        uint256 price
    );

    event ComputeJobSubmitted(
        bytes32 indexed jobId,
        uint256 indexed assetId,
        address indexed requester,
        bytes32 algorithmHash,
        uint256 payment
    );

    event ComputeJobCompleted(
        bytes32 indexed jobId,
        bytes32 resultHash
    );

    event ComputeJobFailed(
        bytes32 indexed jobId
    );

    event PriceUpdated(
        uint256 indexed assetId,
        uint256 accessPrice,
        uint256 computePrice
    );

    event AssetDeactivated(uint256 indexed assetId);

    event RevenueWithdrawn(
        uint256 indexed assetId,
        address indexed owner,
        uint256 amount
    );

    event ProtocolRevenueWithdrawn(address indexed to, uint256 amount);

    // ============ Errors ============

    error AssetNotFound();
    error AssetNotActive();
    error NotAssetOwner();
    error AlreadyHasAccess();
    error InsufficientPayment();
    error JobNotFound();
    error InvalidJobStatus();
    error NotJobProvider();
    error NoRevenueToWithdraw();
    error InvalidMetadataURI();
    error InvalidContentHash();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _vibeToken, address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = IERC20(_vibeToken);
        nextAssetId = 1;
        _jobNonce = 0;
    }

    // ============ Publishing ============

    /**
     * @notice Publish a new data asset to the marketplace.
     * @param metadataURI  IPFS URI pointing to the dataset metadata
     * @param contentHash  Hash of the actual data content
     * @param accessPrice  Price in VIBE tokens per access purchase
     * @param computePrice Price in VIBE tokens per compute job
     * @param assetType    Type of asset (DATASET, MODEL, KNOWLEDGE_GRAPH, API_ENDPOINT)
     * @return assetId     The ID assigned to the new asset
     */
    function publishAsset(
        string calldata metadataURI,
        bytes32 contentHash,
        uint256 accessPrice,
        uint256 computePrice,
        AssetType assetType
    ) external nonReentrant returns (uint256) {
        if (bytes(metadataURI).length == 0) revert InvalidMetadataURI();
        if (contentHash == bytes32(0)) revert InvalidContentHash();

        uint256 assetId = nextAssetId++;

        _assets[assetId] = DataAsset({
            assetId: assetId,
            owner: msg.sender,
            metadataURI: metadataURI,
            contentHash: contentHash,
            accessPrice: accessPrice,
            computePrice: computePrice,
            totalAccesses: 0,
            totalRevenue: 0,
            assetType: assetType,
            active: true
        });

        emit AssetPublished(assetId, msg.sender, metadataURI, contentHash, assetType);

        return assetId;
    }

    // ============ Access ============

    /**
     * @notice Purchase access to a data asset. Caller must have approved
     *         this contract to spend `accessPrice` VIBE tokens.
     * @param assetId The asset to purchase access to
     */
    function purchaseAccess(uint256 assetId) external nonReentrant {
        DataAsset storage asset = _getActiveAsset(assetId);
        if (hasAccess[assetId][msg.sender]) revert AlreadyHasAccess();

        uint256 price = asset.accessPrice;
        if (price > 0) {
            vibeToken.safeTransferFrom(msg.sender, address(this), price);
            _splitRevenue(assetId, price);
        }

        hasAccess[assetId][msg.sender] = true;
        asset.totalAccesses++;

        emit AccessPurchased(assetId, msg.sender, price);
    }

    // ============ Compute-to-Data ============

    /**
     * @notice Submit a compute job against a data asset. The algorithm
     *         (identified by its IPFS hash) runs on the data without the
     *         requester ever downloading the raw data.
     * @param assetId       The asset to compute against
     * @param algorithmHash IPFS hash of the algorithm to execute
     * @return jobId        Unique identifier for the compute job
     */
    function submitComputeJob(
        uint256 assetId,
        bytes32 algorithmHash
    ) external nonReentrant returns (bytes32) {
        DataAsset storage asset = _getActiveAsset(assetId);

        uint256 price = asset.computePrice;
        if (price > 0) {
            vibeToken.safeTransferFrom(msg.sender, address(this), price);
            _splitRevenue(assetId, price);
        }

        bytes32 jobId = keccak256(
            abi.encodePacked(assetId, msg.sender, algorithmHash, _jobNonce++)
        );

        _computeJobs[jobId] = ComputeJob({
            jobId: jobId,
            assetId: assetId,
            requester: msg.sender,
            algorithmHash: algorithmHash,
            resultHash: bytes32(0),
            payment: price,
            status: ComputeStatus.PENDING,
            submittedAt: block.timestamp,
            completedAt: 0
        });

        emit ComputeJobSubmitted(jobId, assetId, msg.sender, algorithmHash, price);

        return jobId;
    }

    /**
     * @notice Data provider marks a compute job as completed and provides
     *         the result hash (IPFS pointer to the output).
     * @param jobId      The compute job to complete
     * @param resultHash IPFS hash of the computation result
     */
    function completeComputeJob(
        bytes32 jobId,
        bytes32 resultHash
    ) external nonReentrant {
        ComputeJob storage job = _computeJobs[jobId];
        if (job.submittedAt == 0) revert JobNotFound();
        if (job.status != ComputeStatus.PENDING && job.status != ComputeStatus.RUNNING) {
            revert InvalidJobStatus();
        }

        DataAsset storage asset = _assets[job.assetId];
        if (msg.sender != asset.owner) revert NotJobProvider();

        job.resultHash = resultHash;
        job.status = ComputeStatus.COMPLETED;
        job.completedAt = block.timestamp;

        emit ComputeJobCompleted(jobId, resultHash);
    }

    /**
     * @notice Data provider marks a compute job as failed.
     *         Payment is refunded to the requester.
     * @param jobId The compute job that failed
     */
    function failComputeJob(bytes32 jobId) external nonReentrant {
        ComputeJob storage job = _computeJobs[jobId];
        if (job.submittedAt == 0) revert JobNotFound();
        if (job.status != ComputeStatus.PENDING && job.status != ComputeStatus.RUNNING) {
            revert InvalidJobStatus();
        }

        DataAsset storage asset = _assets[job.assetId];
        if (msg.sender != asset.owner) revert NotJobProvider();

        job.status = ComputeStatus.FAILED;
        job.completedAt = block.timestamp;

        // Refund payment: reverse the revenue split
        if (job.payment > 0) {
            uint256 ownerCut = (job.payment * OWNER_SHARE_BPS) / BPS_DENOMINATOR;
            uint256 protocolCut = job.payment - ownerCut;

            ownerRevenue[job.assetId] -= ownerCut;
            protocolRevenue -= protocolCut;
            asset.totalRevenue -= job.payment;

            vibeToken.safeTransfer(job.requester, job.payment);
        }

        emit ComputeJobFailed(jobId);
    }

    // ============ Asset Management ============

    /**
     * @notice Update pricing for a data asset. Only the asset owner can call.
     * @param assetId      The asset to update
     * @param accessPrice  New price per access
     * @param computePrice New price per compute job
     */
    function updatePrice(
        uint256 assetId,
        uint256 accessPrice,
        uint256 computePrice
    ) external {
        DataAsset storage asset = _assets[assetId];
        if (asset.owner == address(0)) revert AssetNotFound();
        if (msg.sender != asset.owner) revert NotAssetOwner();

        asset.accessPrice = accessPrice;
        asset.computePrice = computePrice;

        emit PriceUpdated(assetId, accessPrice, computePrice);
    }

    /**
     * @notice Deactivate a data asset. Only the asset owner can call.
     *         Deactivated assets cannot be purchased or computed against.
     * @param assetId The asset to deactivate
     */
    function deactivateAsset(uint256 assetId) external {
        DataAsset storage asset = _assets[assetId];
        if (asset.owner == address(0)) revert AssetNotFound();
        if (msg.sender != asset.owner) revert NotAssetOwner();

        asset.active = false;

        emit AssetDeactivated(assetId);
    }

    // ============ Revenue ============

    /**
     * @notice Withdraw accumulated revenue for a data asset. Only the owner
     *         of the asset can withdraw.
     * @param assetId The asset to withdraw revenue for
     */
    function withdrawRevenue(uint256 assetId) external nonReentrant {
        DataAsset storage asset = _assets[assetId];
        if (asset.owner == address(0)) revert AssetNotFound();
        if (msg.sender != asset.owner) revert NotAssetOwner();

        uint256 amount = ownerRevenue[assetId];
        if (amount == 0) revert NoRevenueToWithdraw();

        ownerRevenue[assetId] = 0;
        vibeToken.safeTransfer(msg.sender, amount);

        emit RevenueWithdrawn(assetId, msg.sender, amount);
    }

    /**
     * @notice Withdraw accumulated protocol revenue (Shapley pool).
     *         Only the contract owner (governance) can call.
     * @param to The address to send protocol revenue to
     */
    function withdrawProtocolRevenue(address to) external onlyOwner nonReentrant {
        uint256 amount = protocolRevenue;
        if (amount == 0) revert NoRevenueToWithdraw();

        protocolRevenue = 0;
        vibeToken.safeTransfer(to, amount);

        emit ProtocolRevenueWithdrawn(to, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Get full details of a data asset.
     * @param assetId The asset ID to query
     * @return The DataAsset struct
     */
    function getAsset(uint256 assetId) external view returns (DataAsset memory) {
        if (_assets[assetId].owner == address(0)) revert AssetNotFound();
        return _assets[assetId];
    }

    /**
     * @notice Get full details of a compute job.
     * @param jobId The job ID to query
     * @return The ComputeJob struct
     */
    function getComputeJob(bytes32 jobId) external view returns (ComputeJob memory) {
        if (_computeJobs[jobId].submittedAt == 0) revert JobNotFound();
        return _computeJobs[jobId];
    }

    /**
     * @notice Get the total number of published assets.
     * @return count The number of assets published (nextAssetId - 1)
     */
    function totalAssets() external view returns (uint256) {
        return nextAssetId - 1;
    }

    // ============ Internal ============

    /**
     * @dev Split payment into owner share (90%) and protocol share (10%).
     */
    function _splitRevenue(uint256 assetId, uint256 amount) internal {
        uint256 ownerCut = (amount * OWNER_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 protocolCut = amount - ownerCut;

        ownerRevenue[assetId] += ownerCut;
        protocolRevenue += protocolCut;
        _assets[assetId].totalRevenue += amount;
    }

    /**
     * @dev Fetch an asset and revert if it doesn't exist or is inactive.
     */
    function _getActiveAsset(uint256 assetId) internal view returns (DataAsset storage) {
        DataAsset storage asset = _assets[assetId];
        if (asset.owner == address(0)) revert AssetNotFound();
        if (!asset.active) revert AssetNotActive();
        return asset;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
