// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeIndexer — On-Chain Event Indexing Registry (The Graph Alternative)
 * @notice Decentralized subgraph registry and query routing.
 *         Indexers stake to serve queries, earn fees for honest indexing.
 *
 * @dev Replaces The Graph with:
 *      - On-chain subgraph registry (what data is indexed)
 *      - Indexer staking + slashing (quality guarantee)
 *      - Query fee market (indexers compete on price/speed)
 *      - Dispute resolution for incorrect queries
 */
contract VibeIndexer is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct Subgraph {
        uint256 subgraphId;
        address creator;
        string name;
        string schema;          // Schema hash/URI
        bytes32 manifestHash;   // IPFS hash of subgraph manifest
        uint256 signalAmount;   // Total VIBE signaled to this subgraph
        uint256 queryCount;
        bool active;
        uint256 createdAt;
    }

    struct Indexer {
        address indexerAddress;
        uint256 stake;
        uint256 allocatedStake;  // Stake allocated to subgraphs
        uint256 queryFeesClaimed;
        uint256 slashCount;
        bool active;
        uint256 registeredAt;
    }

    struct Allocation {
        uint256 allocationId;
        address indexer;
        uint256 subgraphId;
        uint256 allocatedStake;
        uint256 queryFeesCollected;
        uint256 createdAt;
        bool active;
    }

    struct QueryDispute {
        uint256 disputeId;
        address challenger;
        address indexer;
        uint256 subgraphId;
        bytes32 queryHash;
        bytes32 expectedResponse;
        bytes32 actualResponse;
        uint256 stake;
        bool resolved;
        bool challengerWon;
    }

    // ============ State ============

    mapping(uint256 => Subgraph) public subgraphs;
    uint256 public subgraphCount;

    mapping(address => Indexer) public indexers;
    address[] public indexerList;

    mapping(uint256 => Allocation) public allocations;
    uint256 public allocationCount;

    mapping(uint256 => QueryDispute) public disputes;
    uint256 public disputeCount;

    /// @notice Signal: subgraphId => signaler => amount
    mapping(uint256 => mapping(address => uint256)) public signals;

    /// @notice Minimum indexer stake
    uint256 public minIndexerStake;

    /// @notice Query fee rate (per query, in wei)
    uint256 public baseQueryFee;

    /// @notice Slash percentage for invalid query responses
    uint256 public slashPercentBps;

    // ============ Events ============

    event SubgraphCreated(uint256 indexed subgraphId, address indexed creator, string name);
    event SubgraphSignaled(uint256 indexed subgraphId, address indexed signaler, uint256 amount);
    event IndexerRegistered(address indexed indexer, uint256 stake);
    event IndexerExited(address indexed indexer);
    event AllocationCreated(uint256 indexed allocationId, address indexed indexer, uint256 subgraphId);
    event AllocationClosed(uint256 indexed allocationId, uint256 queryFeesCollected);
    event DisputeCreated(uint256 indexed disputeId, address indexed challenger, address indexed indexer);
    event DisputeResolved(uint256 indexed disputeId, bool challengerWon);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        minIndexerStake = 0.1 ether;
        baseQueryFee = 0.0001 ether;
        slashPercentBps = 2500; // 25%
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Subgraph Registry ============

    function createSubgraph(
        string calldata name,
        string calldata schema,
        bytes32 manifestHash
    ) external returns (uint256) {
        subgraphCount++;
        subgraphs[subgraphCount] = Subgraph({
            subgraphId: subgraphCount,
            creator: msg.sender,
            name: name,
            schema: schema,
            manifestHash: manifestHash,
            signalAmount: 0,
            queryCount: 0,
            active: true,
            createdAt: block.timestamp
        });

        emit SubgraphCreated(subgraphCount, msg.sender, name);
        return subgraphCount;
    }

    /**
     * @notice Signal interest in a subgraph (curate)
     */
    function signal(uint256 subgraphId) external payable {
        require(subgraphs[subgraphId].active, "Subgraph not active");
        signals[subgraphId][msg.sender] += msg.value;
        subgraphs[subgraphId].signalAmount += msg.value;
        emit SubgraphSignaled(subgraphId, msg.sender, msg.value);
    }

    // ============ Indexer Management ============

    function registerIndexer() external payable {
        require(msg.value >= minIndexerStake, "Insufficient stake");
        require(!indexers[msg.sender].active, "Already registered");

        indexers[msg.sender] = Indexer({
            indexerAddress: msg.sender,
            stake: msg.value,
            allocatedStake: 0,
            queryFeesClaimed: 0,
            slashCount: 0,
            active: true,
            registeredAt: block.timestamp
        });

        indexerList.push(msg.sender);
        emit IndexerRegistered(msg.sender, msg.value);
    }

    function exitIndexer() external {
        Indexer storage idx = indexers[msg.sender];
        require(idx.active, "Not active");
        require(idx.allocatedStake == 0, "Close allocations first");

        idx.active = false;
        uint256 stake = idx.stake;
        idx.stake = 0;

        (bool ok, ) = msg.sender.call{value: stake}("");
        require(ok, "Transfer failed");
        emit IndexerExited(msg.sender);
    }

    // ============ Allocation ============

    function createAllocation(uint256 subgraphId, uint256 stakeAmount) external returns (uint256) {
        Indexer storage idx = indexers[msg.sender];
        require(idx.active, "Not active indexer");
        require(idx.stake - idx.allocatedStake >= stakeAmount, "Insufficient unallocated stake");

        idx.allocatedStake += stakeAmount;
        allocationCount++;

        allocations[allocationCount] = Allocation({
            allocationId: allocationCount,
            indexer: msg.sender,
            subgraphId: subgraphId,
            allocatedStake: stakeAmount,
            queryFeesCollected: 0,
            createdAt: block.timestamp,
            active: true
        });

        emit AllocationCreated(allocationCount, msg.sender, subgraphId);
        return allocationCount;
    }

    function closeAllocation(uint256 allocationId) external {
        Allocation storage alloc = allocations[allocationId];
        require(alloc.indexer == msg.sender, "Not your allocation");
        require(alloc.active, "Already closed");

        alloc.active = false;
        indexers[msg.sender].allocatedStake -= alloc.allocatedStake;

        // Claim query fees
        if (alloc.queryFeesCollected > 0) {
            indexers[msg.sender].queryFeesClaimed += alloc.queryFeesCollected;
            (bool ok, ) = msg.sender.call{value: alloc.queryFeesCollected}("");
            require(ok, "Fee transfer failed");
        }

        emit AllocationClosed(allocationId, alloc.queryFeesCollected);
    }

    // ============ Disputes ============

    function createDispute(
        address indexer,
        uint256 subgraphId,
        bytes32 queryHash,
        bytes32 expectedResponse,
        bytes32 actualResponse
    ) external payable returns (uint256) {
        require(msg.value >= baseQueryFee * 10, "Dispute stake too low");

        disputeCount++;
        disputes[disputeCount] = QueryDispute({
            disputeId: disputeCount,
            challenger: msg.sender,
            indexer: indexer,
            subgraphId: subgraphId,
            queryHash: queryHash,
            expectedResponse: expectedResponse,
            actualResponse: actualResponse,
            stake: msg.value,
            resolved: false,
            challengerWon: false
        });

        emit DisputeCreated(disputeCount, msg.sender, indexer);
        return disputeCount;
    }

    function resolveDispute(uint256 disputeId, bool challengerWins) external onlyOwner {
        QueryDispute storage dispute = disputes[disputeId];
        require(!dispute.resolved, "Already resolved");

        dispute.resolved = true;
        dispute.challengerWon = challengerWins;

        if (challengerWins) {
            // Slash indexer
            Indexer storage idx = indexers[dispute.indexer];
            uint256 slashAmount = (idx.stake * slashPercentBps) / 10000;
            idx.stake -= slashAmount;
            idx.slashCount++;

            // Reward challenger
            uint256 reward = dispute.stake + slashAmount;
            (bool ok, ) = dispute.challenger.call{value: reward}("");
            require(ok, "Reward failed");
        } else {
            // Return stake minus penalty
            uint256 penalty = dispute.stake / 10;
            uint256 refund = dispute.stake - penalty;
            (bool ok, ) = dispute.challenger.call{value: refund}("");
            require(ok, "Refund failed");
        }

        emit DisputeResolved(disputeId, challengerWins);
    }

    // ============ View ============

    function getSubgraphCount() external view returns (uint256) { return subgraphCount; }
    function getIndexerCount() external view returns (uint256) { return indexerList.length; }
    function getDisputeCount() external view returns (uint256) { return disputeCount; }

    receive() external payable {}
}
