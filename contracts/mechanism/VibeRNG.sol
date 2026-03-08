// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VibeRNG — Verifiable Random Number Generator
 * @notice Commit-reveal based VRF alternative. No Chainlink dependency.
 *         Multiple entropy sources combined for manipulation resistance.
 *
 * @dev Entropy sources:
 *      1. Block prevrandao (post-merge)
 *      2. Commit-reveal from requesters
 *      3. Trinity node contributed entropy
 *      4. Historical block hashes
 *      Combined via XOR + Keccak for uniform distribution.
 */
contract VibeRNG {
    // ============ Types ============

    struct RandomRequest {
        uint256 requestId;
        address requester;
        bytes32 commitHash;        // Hash of requester's secret
        bytes32 requesterReveal;   // Revealed secret
        bytes32 nodeEntropy;       // Entropy contributed by nodes
        uint256 blockNumber;       // Block when requested
        uint256 randomResult;      // Final random number
        uint256 createdAt;
        bool fulfilled;
        bool revealed;
    }

    // ============ State ============

    mapping(uint256 => RandomRequest) public requests;
    uint256 public requestCount;

    /// @notice Entropy contributors (Trinity nodes)
    mapping(address => bool) public entropyProviders;

    /// @notice Callback registry: requestId => callback contract
    mapping(uint256 => address) public callbacks;

    /// @notice Total requests fulfilled
    uint256 public totalFulfilled;

    // ============ Events ============

    event RandomRequested(uint256 indexed requestId, address indexed requester);
    event EntropyContributed(uint256 indexed requestId, address indexed provider);
    event RandomFulfilled(uint256 indexed requestId, uint256 randomNumber);
    event ProviderRegistered(address indexed provider);

    // ============ Constructor ============

    constructor() {}

    // ============ Provider Management ============

    function registerProvider(address provider) external {
        entropyProviders[provider] = true;
        emit ProviderRegistered(provider);
    }

    // ============ Request Flow ============

    /**
     * @notice Request a random number (commit phase)
     * @param commitHash Hash of the requester's secret entropy
     */
    function requestRandom(bytes32 commitHash) external returns (uint256) {
        requestCount++;

        requests[requestCount] = RandomRequest({
            requestId: requestCount,
            requester: msg.sender,
            commitHash: commitHash,
            requesterReveal: bytes32(0),
            nodeEntropy: bytes32(0),
            blockNumber: block.number,
            randomResult: 0,
            createdAt: block.timestamp,
            fulfilled: false,
            revealed: false
        });

        callbacks[requestCount] = msg.sender;

        emit RandomRequested(requestCount, msg.sender);
        return requestCount;
    }

    /**
     * @notice Contribute node entropy (Trinity nodes)
     */
    function contributeEntropy(uint256 requestId, bytes32 entropy) external {
        require(entropyProviders[msg.sender], "Not a provider");
        RandomRequest storage req = requests[requestId];
        require(!req.fulfilled, "Already fulfilled");

        // XOR existing entropy with new contribution
        req.nodeEntropy = req.nodeEntropy ^ entropy;

        emit EntropyContributed(requestId, msg.sender);
    }

    /**
     * @notice Reveal requester's secret and generate random number
     */
    function revealAndFulfill(uint256 requestId, bytes32 secret) external {
        RandomRequest storage req = requests[requestId];
        require(req.requester == msg.sender, "Not requester");
        require(!req.fulfilled, "Already fulfilled");
        require(keccak256(abi.encodePacked(secret)) == req.commitHash, "Invalid reveal");
        require(block.number > req.blockNumber, "Same block");

        req.requesterReveal = secret;
        req.revealed = true;

        // Combine all entropy sources
        bytes32 combined = keccak256(abi.encodePacked(
            secret,                                    // Requester entropy
            req.nodeEntropy,                           // Node entropy
            blockhash(req.blockNumber),                // Historical block hash
            block.prevrandao,                          // Post-merge randomness
            block.timestamp,                           // Timestamp
            requestId                                  // Request-specific
        ));

        req.randomResult = uint256(combined);
        req.fulfilled = true;
        totalFulfilled++;

        emit RandomFulfilled(requestId, req.randomResult);

        // Callback to requester
        try IRandomCallback(callbacks[requestId]).onRandomFulfilled(requestId, req.randomResult) {} catch {}
    }

    // ============ View ============

    function getRandomResult(uint256 requestId) external view returns (uint256) {
        require(requests[requestId].fulfilled, "Not fulfilled");
        return requests[requestId].randomResult;
    }

    function getRequestCount() external view returns (uint256) { return requestCount; }

    /**
     * @notice Generate a random number in range [0, max)
     */
    function getRandomInRange(uint256 requestId, uint256 max) external view returns (uint256) {
        require(requests[requestId].fulfilled, "Not fulfilled");
        return requests[requestId].randomResult % max;
    }
}

interface IRandomCallback {
    function onRandomFulfilled(uint256 requestId, uint256 randomNumber) external;
}
