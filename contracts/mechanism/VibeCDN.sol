// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeCDN — Decentralized Content Delivery Network
 * @notice BitTorrent + Livepeer-inspired content distribution.
 *         Nodes cache and serve content, earn fees for bandwidth.
 *         IPFS pinning + CDN serving + video transcoding unified.
 */
contract VibeCDN is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct ContentNode {
        address nodeAddress;
        uint256 stake;
        uint256 bandwidth;         // Mbps capacity
        uint256 storage_;          // GB capacity
        uint256 served;            // Total bytes served
        uint256 earnings;
        string endpoint;
        string[] regions;          // Geographic regions
        bool active;
        uint256 registeredAt;
    }

    struct ContentPin {
        bytes32 contentHash;       // IPFS CID or content hash
        address publisher;
        uint256 size;              // bytes
        uint256 replicationTarget; // How many nodes should pin this
        uint256 replicationCount;
        uint256 bountyPerNode;     // Payment per pinning node per epoch
        uint256 expiresAt;
        bool active;
    }

    struct TranscodeJob {
        uint256 jobId;
        address requester;
        bytes32 sourceHash;
        string outputFormat;       // "720p", "1080p", "4k", etc.
        uint256 bounty;
        bytes32 resultHash;
        address transcoder;
        bool completed;
    }

    // ============ State ============

    mapping(address => ContentNode) public nodes;
    address[] public nodeList;

    mapping(bytes32 => ContentPin) public pins;
    bytes32[] public pinList;

    /// @notice Which nodes pin which content: contentHash => node => pinned
    mapping(bytes32 => mapping(address => bool)) public nodePins;

    mapping(uint256 => TranscodeJob) public transcodeJobs;
    uint256 public jobCount;

    uint256 public totalBytesServed;
    uint256 public totalEarnings;

    uint256 public minNodeStake;

    // ============ Events ============

    event NodeRegistered(address indexed node, uint256 stake, string endpoint);
    event NodeExited(address indexed node);
    event ContentPinned(bytes32 indexed contentHash, address indexed publisher, uint256 bounty);
    event ContentServed(bytes32 indexed contentHash, address indexed node, uint256 bytes_);
    event TranscodeRequested(uint256 indexed jobId, bytes32 sourceHash, string format);
    event TranscodeCompleted(uint256 indexed jobId, address indexed transcoder, bytes32 resultHash);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        minNodeStake = 0.05 ether;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Node Management ============

    function registerNode(
        uint256 bandwidth,
        uint256 storage_,
        string calldata endpoint,
        string[] calldata regions
    ) external payable {
        require(msg.value >= minNodeStake, "Insufficient stake");
        require(!nodes[msg.sender].active, "Already registered");

        nodes[msg.sender] = ContentNode({
            nodeAddress: msg.sender,
            stake: msg.value,
            bandwidth: bandwidth,
            storage_: storage_,
            served: 0,
            earnings: 0,
            endpoint: endpoint,
            regions: regions,
            active: true,
            registeredAt: block.timestamp
        });

        nodeList.push(msg.sender);
        emit NodeRegistered(msg.sender, msg.value, endpoint);
    }

    function exitNode() external nonReentrant {
        ContentNode storage node = nodes[msg.sender];
        require(node.active, "Not active");
        node.active = false;

        uint256 stake = node.stake;
        node.stake = 0;
        (bool ok, ) = msg.sender.call{value: stake}("");
        require(ok, "Transfer failed");

        emit NodeExited(msg.sender);
    }

    // ============ Content Pinning ============

    function pinContent(
        bytes32 contentHash,
        uint256 size,
        uint256 replicationTarget,
        uint256 duration,
        uint256 bountyPerNode
    ) external payable {
        uint256 totalBounty = bountyPerNode * replicationTarget;
        require(msg.value >= totalBounty, "Insufficient bounty");

        pins[contentHash] = ContentPin({
            contentHash: contentHash,
            publisher: msg.sender,
            size: size,
            replicationTarget: replicationTarget,
            replicationCount: 0,
            bountyPerNode: bountyPerNode,
            expiresAt: block.timestamp + duration,
            active: true
        });

        pinList.push(contentHash);
        emit ContentPinned(contentHash, msg.sender, totalBounty);
    }

    function claimPin(bytes32 contentHash) external {
        require(nodes[msg.sender].active, "Not a node");
        ContentPin storage pin = pins[contentHash];
        require(pin.active, "Not active");
        require(!nodePins[contentHash][msg.sender], "Already pinned");
        require(pin.replicationCount < pin.replicationTarget, "Fully replicated");

        nodePins[contentHash][msg.sender] = true;
        pin.replicationCount++;
    }

    function reportServed(bytes32 contentHash, uint256 bytesServed) external {
        require(nodes[msg.sender].active && nodePins[contentHash][msg.sender], "Not pinning");

        nodes[msg.sender].served += bytesServed;
        totalBytesServed += bytesServed;

        emit ContentServed(contentHash, msg.sender, bytesServed);
    }

    // ============ Transcoding ============

    function requestTranscode(
        bytes32 sourceHash,
        string calldata outputFormat
    ) external payable returns (uint256) {
        require(msg.value > 0, "Need bounty");

        jobCount++;
        transcodeJobs[jobCount] = TranscodeJob({
            jobId: jobCount,
            requester: msg.sender,
            sourceHash: sourceHash,
            outputFormat: outputFormat,
            bounty: msg.value,
            resultHash: bytes32(0),
            transcoder: address(0),
            completed: false
        });

        emit TranscodeRequested(jobCount, sourceHash, outputFormat);
        return jobCount;
    }

    function submitTranscode(uint256 jobId, bytes32 resultHash) external nonReentrant {
        require(nodes[msg.sender].active, "Not a node");
        TranscodeJob storage job = transcodeJobs[jobId];
        require(!job.completed, "Already completed");

        job.completed = true;
        job.transcoder = msg.sender;
        job.resultHash = resultHash;

        (bool ok, ) = msg.sender.call{value: job.bounty}("");
        require(ok, "Bounty failed");

        nodes[msg.sender].earnings += job.bounty;
        totalEarnings += job.bounty;

        emit TranscodeCompleted(jobId, msg.sender, resultHash);
    }

    // ============ View ============

    function getNodeCount() external view returns (uint256) { return nodeList.length; }
    function getPinCount() external view returns (uint256) { return pinList.length; }
    function getJobCount() external view returns (uint256) { return jobCount; }

    receive() external payable {}
}
