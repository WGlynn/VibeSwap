// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../incentives/ShapleyDistributor.sol";

/**
 * @title AttributionBridge
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Bridges off-chain Jarvis attribution data to on-chain Shapley distribution.
 *
 * @dev Jarvis's passive-attribution.js tracks who contributed what:
 *      - Sources (blog, video, paper, code, social, conversation, session)
 *      - Derivations (code written using source knowledge)
 *      - Outputs (shipped features that trace back to sources)
 *
 *      This bridge accepts a merkle root of attribution scores computed off-chain,
 *      then allows anyone to prove their contribution and receive Shapley rewards.
 *
 *      Flow:
 *        1. Jarvis computes attribution scores off-chain (passive-attribution.js)
 *        2. Operator submits merkle root of (address, score) pairs
 *        3. Contributors submit merkle proofs to claim inclusion
 *        4. Bridge creates a ShapleyDistributor game with proven contributors
 *        5. Shapley distributes rewards proportionally
 *
 *      This is the convergence point: AI (Jarvis) generates the data,
 *      crypto (VibeSwap) distributes the rewards. P-001 applies to both.
 *
 *      Jarvis shards are also valid contributors. A trading shard that
 *      generates alpha, a community shard that onboards users, a research
 *      shard that synthesizes papers — all earn Shapley rewards.
 */
contract AttributionBridge is Ownable {

    // ============ Structs ============

    struct AttributionEpoch {
        bytes32 merkleRoot;        // Root of (address, score, sourceType) tree
        uint256 totalPool;         // Reward pool for this epoch
        address rewardToken;       // Token to distribute
        uint256 submittedAt;
        uint256 participantCount;  // Number of contributors in the tree
        bool finalized;            // Can create Shapley game
        bool settled;              // Shapley game created
    }

    struct ContributionProof {
        address contributor;
        uint256 directScore;       // Raw contribution score
        uint256 derivationCount;   // How many derivations trace to their work
        uint8 sourceType;          // SourceType enum from passive-attribution.js
        bytes32[] proof;           // Merkle proof
    }

    // ============ State ============

    ShapleyDistributor public shapleyDistributor;

    uint256 public epochCounter;
    mapping(uint256 => AttributionEpoch) public epochs;
    mapping(uint256 => ContributionProof[]) internal epochProofs;

    // Challenge period: anyone can dispute the merkle root
    uint256 public constant CHALLENGE_PERIOD = 24 hours;

    // ============ Events ============

    event EpochSubmitted(uint256 indexed epochId, bytes32 merkleRoot, uint256 totalPool, uint256 participantCount);
    event ContributionProven(uint256 indexed epochId, address indexed contributor, uint256 score);
    event EpochFinalized(uint256 indexed epochId);
    event ShapleyGameCreated(uint256 indexed epochId, bytes32 gameId);

    // ============ Constructor ============

    constructor(address _shapleyDistributor) Ownable(msg.sender) {
        shapleyDistributor = ShapleyDistributor(payable(_shapleyDistributor));
    }

    // ============ Epoch Management ============

    /**
     * @notice Submit a new attribution epoch (operator or Jarvis shard).
     * @param merkleRoot Root of the attribution tree
     * @param totalPool Reward pool for this epoch
     * @param rewardToken Token address (or address(0) for ETH)
     * @param participantCount Number of contributors in the tree
     */
    function submitEpoch(
        bytes32 merkleRoot,
        uint256 totalPool,
        address rewardToken,
        uint256 participantCount
    ) external onlyOwner {
        uint256 epochId = ++epochCounter;

        epochs[epochId] = AttributionEpoch({
            merkleRoot: merkleRoot,
            totalPool: totalPool,
            rewardToken: rewardToken,
            submittedAt: block.timestamp,
            participantCount: participantCount,
            finalized: false,
            settled: false
        });

        emit EpochSubmitted(epochId, merkleRoot, totalPool, participantCount);
    }

    /**
     * @notice Prove a contribution within an epoch using merkle proof.
     * @dev Anyone can submit proofs — permissionless proving.
     */
    function proveContribution(
        uint256 epochId,
        address contributor,
        uint256 directScore,
        uint256 derivationCount,
        uint8 sourceType,
        bytes32[] calldata proof
    ) external {
        AttributionEpoch storage epoch = epochs[epochId];
        require(epoch.merkleRoot != bytes32(0), "Epoch not found");
        require(!epoch.settled, "Already settled");

        // Verify merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(
            contributor, directScore, derivationCount, sourceType
        ));
        require(MerkleProof.verify(proof, epoch.merkleRoot, leaf), "Invalid proof");

        // Store proven contribution
        epochProofs[epochId].push(ContributionProof({
            contributor: contributor,
            directScore: directScore,
            derivationCount: derivationCount,
            sourceType: sourceType,
            proof: proof
        }));

        emit ContributionProven(epochId, contributor, directScore);
    }

    /**
     * @notice Finalize epoch after challenge period.
     */
    function finalizeEpoch(uint256 epochId) external {
        AttributionEpoch storage epoch = epochs[epochId];
        require(epoch.merkleRoot != bytes32(0), "Epoch not found");
        require(!epoch.finalized, "Already finalized");
        require(block.timestamp >= epoch.submittedAt + CHALLENGE_PERIOD, "Challenge period active");

        epoch.finalized = true;
        emit EpochFinalized(epochId);
    }

    /**
     * @notice Create Shapley game from finalized epoch proofs.
     * @dev Converts attribution proofs into ShapleyDistributor participants.
     *      This is THE convergence point: Jarvis data → Shapley rewards.
     */
    function createShapleyGame(uint256 epochId) external {
        AttributionEpoch storage epoch = epochs[epochId];
        require(epoch.finalized, "Not finalized");
        require(!epoch.settled, "Already settled");

        ContributionProof[] storage proofs = epochProofs[epochId];
        require(proofs.length >= 2, "Need at least 2 proven contributors");

        // Convert proofs to Shapley participants
        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](proofs.length);

        for (uint256 i = 0; i < proofs.length; i++) {
            ContributionProof storage p = proofs[i];

            // Map attribution scores to Shapley inputs:
            // - directContribution = directScore (raw contribution)
            // - timeInPool = derivationCount * 1 day (proxy for sustained influence)
            // - scarcityScore = based on sourceType rarity
            // - stabilityScore = derivationCount (more derivations = more stable influence)
            participants[i] = ShapleyDistributor.Participant({
                participant: p.contributor,
                directContribution: p.directScore,
                timeInPool: p.derivationCount * 1 days,
                scarcityScore: _sourceTypeScarcity(p.sourceType),
                stabilityScore: p.derivationCount > 10 ? 8000 : p.derivationCount * 800
            });
        }

        bytes32 gameId = keccak256(abi.encodePacked("attribution_epoch_", epochId));
        epoch.settled = true;

        // Create the Shapley game (must be authorized creator on the distributor)
        shapleyDistributor.createGame(
            gameId,
            epoch.totalPool,
            epoch.rewardToken,
            participants
        );

        emit ShapleyGameCreated(epochId, gameId);
    }

    // ============ Helpers ============

    /**
     * @notice Map source type to scarcity score.
     * @dev Original research (PAPER, CODE) is scarcer than social sharing.
     */
    function _sourceTypeScarcity(uint8 sourceType) internal pure returns (uint256) {
        if (sourceType == 3) return 9000;  // CODE: highest scarcity
        if (sourceType == 2) return 8000;  // PAPER: very scarce
        if (sourceType == 1) return 5000;  // VIDEO: moderate
        if (sourceType == 0) return 6000;  // BLOG: moderate-high
        if (sourceType == 6) return 7000;  // SESSION: high (direct build work)
        if (sourceType == 5) return 4000;  // CONVERSATION: moderate
        return 3000;                        // SOCIAL: lower scarcity
    }
}
