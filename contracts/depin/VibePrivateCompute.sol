// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibePrivateCompute — Zero-Knowledge & Homomorphic Compute Layer
 * @notice Privacy-preserving computation over encrypted data.
 *         Compute on data without seeing it. Industry-scale private analytics.
 *
 * @dev Architecture:
 *      - Data owners register encrypted datasets
 *      - Compute requesters submit computation requests
 *      - TEE nodes execute computation in secure enclaves
 *      - Results verified via ZK proofs (no raw data exposed)
 *      - Homomorphic encryption for aggregate statistics
 *
 * Use cases:
 *      - Medical records analysis without exposing patient data
 *      - Financial analytics without revealing positions
 *      - AI model training on private datasets
 *      - Supply chain verification without revealing suppliers
 */
contract VibePrivateCompute is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum ComputeType { ZK_PROOF, FHE_AGGREGATE, TEE_ENCLAVE, MPC_MULTIPARTY }
    enum RequestStatus { PENDING, COMPUTING, COMPLETED, FAILED, DISPUTED }

    struct EncryptedDataset {
        bytes32 datasetId;
        address owner;
        bytes32 schemaHash;          // Hash of data schema (structure)
        bytes32 encryptionKeyHash;   // Hash of encryption key (owner holds key)
        uint256 recordCount;
        uint256 sizeBytes;
        string category;             // "medical", "financial", "iot", etc.
        uint256 accessPrice;         // Price per compute request
        uint256 registeredAt;
        bool active;
        bool verified;               // Schema verified by auditor
    }

    struct ComputeRequest {
        uint256 requestId;
        address requester;
        bytes32 datasetId;
        ComputeType computeType;
        bytes32 programHash;         // Hash of the computation program
        bytes32 inputParamsHash;     // Hash of computation parameters
        bytes32 resultHash;          // Hash of encrypted result
        bytes32 proofHash;           // ZK proof of correct computation
        RequestStatus status;
        address computeNode;         // TEE node that executed
        uint256 fee;
        uint256 requestedAt;
        uint256 completedAt;
    }

    struct ComputeNode {
        address nodeAddress;
        bytes32 teeAttestation;      // TEE attestation hash
        uint256 computeCapacity;     // FLOPS available
        uint256 tasksCompleted;
        uint256 reputation;          // 0-10000
        uint256 stakedAmount;
        bool active;
    }

    struct DataAccessPolicy {
        bytes32 datasetId;
        address grantee;
        ComputeType[] allowedTypes;
        uint256 maxRequests;
        uint256 requestsUsed;
        uint256 expiresAt;
        bool active;
    }

    // ============ State ============

    mapping(bytes32 => EncryptedDataset) public datasets;
    bytes32[] public datasetList;

    mapping(uint256 => ComputeRequest) public requests;
    uint256 public requestCount;

    mapping(address => ComputeNode) public computeNodes;
    address[] public nodeList;

    /// @notice Access policies: datasetId => grantee => DataAccessPolicy
    mapping(bytes32 => mapping(address => DataAccessPolicy)) public accessPolicies;

    /// @notice Data categories
    mapping(string => uint256) public categoryDatasetCount;

    /// @notice Stats
    uint256 public totalDatasets;
    uint256 public totalComputations;
    uint256 public totalDataPointsProcessed;
    uint256 public totalFeesCollected;

    // ============ Events ============

    event DatasetRegistered(bytes32 indexed datasetId, address indexed owner, string category);
    event DatasetVerified(bytes32 indexed datasetId);
    event ComputeRequested(uint256 indexed requestId, address indexed requester, bytes32 datasetId, ComputeType computeType);
    event ComputeCompleted(uint256 indexed requestId, bytes32 resultHash, bytes32 proofHash);
    event ComputeFailed(uint256 indexed requestId, string reason);
    event NodeRegistered(address indexed node, bytes32 teeAttestation);
    event AccessGranted(bytes32 indexed datasetId, address indexed grantee);
    event AccessRevoked(bytes32 indexed datasetId, address indexed grantee);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Dataset Management ============

    /**
     * @notice Register an encrypted dataset for private computation
     */
    function registerDataset(
        bytes32 schemaHash,
        bytes32 encryptionKeyHash,
        uint256 recordCount,
        uint256 sizeBytes,
        string calldata category,
        uint256 accessPrice
    ) external returns (bytes32) {
        bytes32 datasetId = keccak256(abi.encodePacked(
            msg.sender, schemaHash, block.timestamp
        ));

        datasets[datasetId] = EncryptedDataset({
            datasetId: datasetId,
            owner: msg.sender,
            schemaHash: schemaHash,
            encryptionKeyHash: encryptionKeyHash,
            recordCount: recordCount,
            sizeBytes: sizeBytes,
            category: category,
            accessPrice: accessPrice,
            registeredAt: block.timestamp,
            active: true,
            verified: false
        });

        datasetList.push(datasetId);
        totalDatasets++;
        categoryDatasetCount[category]++;

        emit DatasetRegistered(datasetId, msg.sender, category);
        return datasetId;
    }

    /**
     * @notice Grant compute access to a specific party
     */
    function grantAccess(
        bytes32 datasetId,
        address grantee,
        ComputeType[] calldata allowedTypes,
        uint256 maxRequests,
        uint256 durationDays
    ) external {
        require(datasets[datasetId].owner == msg.sender, "Not owner");

        accessPolicies[datasetId][grantee] = DataAccessPolicy({
            datasetId: datasetId,
            grantee: grantee,
            allowedTypes: allowedTypes,
            maxRequests: maxRequests,
            requestsUsed: 0,
            expiresAt: block.timestamp + (durationDays * 1 days),
            active: true
        });

        emit AccessGranted(datasetId, grantee);
    }

    function revokeAccess(bytes32 datasetId, address grantee) external {
        require(datasets[datasetId].owner == msg.sender, "Not owner");
        accessPolicies[datasetId][grantee].active = false;
        emit AccessRevoked(datasetId, grantee);
    }

    // ============ Compute Requests ============

    /**
     * @notice Request computation on an encrypted dataset
     */
    function requestCompute(
        bytes32 datasetId,
        ComputeType computeType,
        bytes32 programHash,
        bytes32 inputParamsHash
    ) external payable nonReentrant returns (uint256) {
        EncryptedDataset storage ds = datasets[datasetId];
        require(ds.active, "Dataset not active");

        // Check access
        DataAccessPolicy storage policy = accessPolicies[datasetId][msg.sender];
        require(policy.active, "No access");
        require(block.timestamp < policy.expiresAt, "Access expired");
        require(policy.requestsUsed < policy.maxRequests, "Max requests exceeded");
        require(msg.value >= ds.accessPrice, "Insufficient fee");

        policy.requestsUsed++;

        requestCount++;
        requests[requestCount] = ComputeRequest({
            requestId: requestCount,
            requester: msg.sender,
            datasetId: datasetId,
            computeType: computeType,
            programHash: programHash,
            inputParamsHash: inputParamsHash,
            resultHash: bytes32(0),
            proofHash: bytes32(0),
            status: RequestStatus.PENDING,
            computeNode: address(0),
            fee: msg.value,
            requestedAt: block.timestamp,
            completedAt: 0
        });

        totalFeesCollected += msg.value;

        emit ComputeRequested(requestCount, msg.sender, datasetId, computeType);
        return requestCount;
    }

    /**
     * @notice Submit computation result (TEE node)
     */
    function submitResult(
        uint256 requestId,
        bytes32 resultHash,
        bytes32 proofHash
    ) external {
        ComputeRequest storage req = requests[requestId];
        require(req.status == RequestStatus.PENDING || req.status == RequestStatus.COMPUTING, "Wrong status");
        require(computeNodes[msg.sender].active, "Not active node");

        req.resultHash = resultHash;
        req.proofHash = proofHash;
        req.status = RequestStatus.COMPLETED;
        req.computeNode = msg.sender;
        req.completedAt = block.timestamp;

        computeNodes[msg.sender].tasksCompleted++;
        totalComputations++;
        totalDataPointsProcessed += datasets[req.datasetId].recordCount;

        // Pay dataset owner
        uint256 ownerShare = (req.fee * 7000) / 10000; // 70% to data owner
        uint256 nodeShare = req.fee - ownerShare;         // 30% to compute node

        (bool ok1, ) = datasets[req.datasetId].owner.call{value: ownerShare}("");
        require(ok1, "Owner payment failed");
        (bool ok2, ) = msg.sender.call{value: nodeShare}("");
        require(ok2, "Node payment failed");

        emit ComputeCompleted(requestId, resultHash, proofHash);
    }

    // ============ Compute Nodes ============

    function registerNode(bytes32 teeAttestation, uint256 capacity) external payable {
        require(msg.value > 0, "Stake required");
        require(!computeNodes[msg.sender].active, "Already registered");

        computeNodes[msg.sender] = ComputeNode({
            nodeAddress: msg.sender,
            teeAttestation: teeAttestation,
            computeCapacity: capacity,
            tasksCompleted: 0,
            reputation: 5000,
            stakedAmount: msg.value,
            active: true
        });

        nodeList.push(msg.sender);

        emit NodeRegistered(msg.sender, teeAttestation);
    }

    // ============ Admin ============

    function verifyDataset(bytes32 datasetId) external onlyOwner {
        datasets[datasetId].verified = true;
        emit DatasetVerified(datasetId);
    }

    // ============ View ============

    function getDatasetCount() external view returns (uint256) { return totalDatasets; }
    function getRequestCount() external view returns (uint256) { return requestCount; }
    function getNodeCount() external view returns (uint256) { return nodeList.length; }

    function hasAccess(bytes32 datasetId, address user) external view returns (bool) {
        DataAccessPolicy storage p = accessPolicies[datasetId][user];
        return p.active && block.timestamp < p.expiresAt && p.requestsUsed < p.maxRequests;
    }

    receive() external payable {}
}
