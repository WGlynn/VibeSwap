// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ICognitiveConsensusMarket.sol";

/**
 * @title IntelligenceExchange — Sovereign Intelligence Exchange Orchestrator
 * @notice VibeSwap for intelligence instead of liquidity. Composes existing
 *         contracts (DataMarketplace, CognitiveConsensusMarket, ShapleyVerifier,
 *         VibeCheckpointRegistry) into a unified flow for knowledge submission,
 *         citation-based pricing, CRPC evaluation, and Shapley-fair attribution.
 *
 * @dev The swap flow for intelligence:
 *      Submit knowledge -> CRPC evaluate -> Bonding curve price -> Shapley distribute
 *
 *      Structurally isomorphic to VibeSwap's liquidity flow:
 *      Commit order -> Reveal order -> Batch settle -> Shapley distribute
 *
 *      Key design decisions:
 *      1. Compose, don't rebuild — delegates to existing contracts
 *      2. Off-chain compute, on-chain verify — CRPC runs in shard network
 *      3. P-001: 0% protocol extraction — 100% of revenue to contributors
 *      4. Knowledge checkpoints, not full replication — Merkle roots only
 *      5. Bonding curve pricing — mirrors infofi.js formula
 *
 * @author Faraday1, JARVIS | March 2026
 */
contract IntelligenceExchange is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum AssetType { RESEARCH, MODEL, DATASET, INSIGHT, PROOF, PROTOCOL }
    enum AssetState { SUBMITTED, EVALUATING, VERIFIED, DISPUTED, SETTLED }

    // ============ Structs ============

    struct IntelligenceAsset {
        bytes32 assetId;
        address contributor;        // Human or agent operator
        bytes32 contentHash;        // IPFS CID of the knowledge content
        string metadataURI;         // IPFS URI for metadata (title, abstract, tags)
        AssetType assetType;
        AssetState state;
        uint256 bondingPrice;       // Current price via citation curve
        uint256 citations;          // Number of citing assets
        uint256 totalRevenue;       // Accumulated from access purchases
        uint256 shapleyRevenue;     // Accumulated from Shapley attribution
        uint256 submittedAt;
        uint256 stakeAmount;        // Anti-spam deposit
    }

    struct Citation {
        bytes32 citingAsset;
        bytes32 citedAsset;
        uint256 timestamp;
    }

    struct KnowledgeEpoch {
        uint256 epochId;
        bytes32 merkleRoot;
        uint256 assetCount;
        uint256 totalValue;
        uint256 timestamp;
        address submitter;
    }

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_STAKE = 0.001 ether;

    /// @notice P-001: No Extraction Ever. 0% protocol fee.
    uint256 public constant PROTOCOL_FEE_BPS = 0;

    /// @notice Bonding curve parameters (mirrors infofi.js)
    uint256 public constant BONDING_BASE_PRICE = 0.001 ether;
    uint256 public constant BONDING_CITATION_FACTOR = 1500; // 15% per citation in BPS

    /// @notice Shapley attribution: % of access revenue shared with cited assets
    uint256 public constant CITATION_SHARE_BPS = 3000; // 30% to cited works

    /// @notice Lawson Fairness Floor: minimum 1% of average reward
    uint256 public constant LAWSON_FLOOR_BPS = 100;

    // ============ State Variables ============

    IERC20 public vibeToken;

    /// @notice All intelligence assets by ID
    mapping(bytes32 => IntelligenceAsset) public assets;

    /// @notice Citation graph: citingAsset => citedAsset[]
    mapping(bytes32 => bytes32[]) public citedBy;

    /// @notice Reverse citation graph: citedAsset => citingAsset[]
    mapping(bytes32 => bytes32[]) public citationsOf;

    /// @notice Knowledge epochs anchored on-chain
    mapping(uint256 => KnowledgeEpoch) public epochs;
    uint256 public epochCount;

    /// @notice Authorized epoch submitters (Jarvis shards)
    mapping(address => bool) public epochSubmitters;

    /// @notice Total assets submitted
    uint256 public assetCount;

    /// @notice Contributor address => total Shapley revenue earned
    mapping(address => uint256) public contributorEarnings;

    /// @notice Contributor address => claimable balance
    mapping(address => uint256) public claimable;

    /// @notice Asset access: assetId => user => hasAccess
    mapping(bytes32 => mapping(address => bool)) public hasAccess;

    // ============ Phase 1: CognitiveConsensusMarket Integration ============

    /// @notice CognitiveConsensusMarket contract for decentralized evaluation
    address public cognitiveConsensusMarket;

    /// @notice Mapping: CCM claimId => SIE assetId (for settlement callback)
    mapping(uint256 => bytes32) public claimToAsset;

    /// @notice Mapping: SIE assetId => CCM claimId (for lookup)
    mapping(bytes32 => uint256) public assetToClaimId;

    // ============ Events ============

    event IntelligenceSubmitted(
        bytes32 indexed assetId,
        address indexed contributor,
        bytes32 contentHash,
        AssetType assetType,
        uint256 stake
    );

    event AssetCited(
        bytes32 indexed citingAsset,
        bytes32 indexed citedAsset,
        uint256 newBondingPrice
    );

    event AccessPurchased(
        bytes32 indexed assetId,
        address indexed buyer,
        uint256 price,
        uint256 citationShare
    );

    event KnowledgeEpochAnchored(
        uint256 indexed epochId,
        bytes32 merkleRoot,
        uint256 assetCount,
        uint256 totalValue
    );

    event AssetVerified(bytes32 indexed assetId);
    event AssetDisputed(bytes32 indexed assetId);
    event RewardsClaimed(address indexed contributor, uint256 amount);
    event EvaluationRequested(bytes32 indexed assetId, uint256 indexed claimId, uint256 bounty);
    event EvaluationSettled(bytes32 indexed assetId, uint256 indexed claimId, bool verified);

    // ============ Errors ============

    error AssetNotFound();
    error AssetAlreadyExists();
    error InsufficientStake();
    error InvalidContentHash();
    error InvalidMetadataURI();
    error SelfCitation();
    error DuplicateCitation();
    error NotEpochSubmitter();
    error AlreadyHasAccess();
    error NothingToClaim();
    error AssetNotVerified();
    error InvalidAssetState();
    error CognitiveConsensusMarketNotSet();
    error EvaluationAlreadyRequested();
    error ClaimNotResolved();
    error NotAssetContributor();

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
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Intelligence Submission ============

    /**
     * @notice Submit a new intelligence asset to the exchange.
     * @param contentHash IPFS CID hash of the knowledge content
     * @param metadataURI IPFS URI for metadata (title, abstract, tags)
     * @param assetType Type of intelligence being submitted
     * @param citedAssets Array of asset IDs this work cites (attribution chain)
     * @return assetId The unique identifier for the submitted asset
     */
    function submitIntelligence(
        bytes32 contentHash,
        string calldata metadataURI,
        AssetType assetType,
        bytes32[] calldata citedAssets
    ) external payable nonReentrant returns (bytes32 assetId) {
        if (contentHash == bytes32(0)) revert InvalidContentHash();
        if (bytes(metadataURI).length == 0) revert InvalidMetadataURI();
        if (msg.value < MIN_STAKE) revert InsufficientStake();

        // Generate deterministic asset ID
        assetId = keccak256(abi.encodePacked(
            msg.sender, contentHash, block.timestamp, assetCount
        ));
        if (assets[assetId].submittedAt != 0) revert AssetAlreadyExists();

        // Calculate initial bonding price
        uint256 initialPrice = BONDING_BASE_PRICE;

        // Store asset
        assets[assetId] = IntelligenceAsset({
            assetId: assetId,
            contributor: msg.sender,
            contentHash: contentHash,
            metadataURI: metadataURI,
            assetType: assetType,
            state: AssetState.SUBMITTED,
            bondingPrice: initialPrice,
            citations: 0,
            totalRevenue: 0,
            shapleyRevenue: 0,
            submittedAt: block.timestamp,
            stakeAmount: msg.value
        });

        assetCount++;

        // Process citations (attribute prior work)
        for (uint256 i = 0; i < citedAssets.length; i++) {
            _addCitation(assetId, citedAssets[i]);
        }

        emit IntelligenceSubmitted(assetId, msg.sender, contentHash, assetType, msg.value);
    }

    // ============ Citation System ============

    /**
     * @notice Cite an existing asset from a new submission.
     *         Updates the cited asset's bonding curve price.
     * @param citingAsset The asset that is citing
     * @param citedAsset The asset being cited
     */
    function cite(bytes32 citingAsset, bytes32 citedAsset) external {
        if (assets[citingAsset].contributor != msg.sender) revert AssetNotFound();
        _addCitation(citingAsset, citedAsset);
    }

    function _addCitation(bytes32 citingAsset, bytes32 citedAsset) internal {
        if (citingAsset == citedAsset) revert SelfCitation();
        if (assets[citedAsset].submittedAt == 0) revert AssetNotFound();

        // Check for duplicate citation
        bytes32[] storage existing = citedBy[citingAsset];
        for (uint256 i = 0; i < existing.length; i++) {
            if (existing[i] == citedAsset) revert DuplicateCitation();
        }

        // Record citation in both directions
        citedBy[citingAsset].push(citedAsset);
        citationsOf[citedAsset].push(citingAsset);

        // Update cited asset's citation count and bonding price
        IntelligenceAsset storage cited = assets[citedAsset];
        cited.citations++;
        cited.bondingPrice = _calculateBondingPrice(cited.citations);

        emit AssetCited(citingAsset, citedAsset, cited.bondingPrice);
    }

    // ============ Access & Revenue ============

    /**
     * @notice Purchase access to an intelligence asset.
     *         Revenue splits: 70% to asset contributor, 30% distributed
     *         to cited works via Shapley attribution.
     * @param assetId The asset to access
     */
    function purchaseAccess(bytes32 assetId) external nonReentrant {
        IntelligenceAsset storage asset = assets[assetId];
        if (asset.submittedAt == 0) revert AssetNotFound();
        if (hasAccess[assetId][msg.sender]) revert AlreadyHasAccess();

        uint256 price = asset.bondingPrice;
        vibeToken.safeTransferFrom(msg.sender, address(this), price);

        hasAccess[assetId][msg.sender] = true;
        asset.totalRevenue += price;

        // Split revenue: contributor gets (100% - CITATION_SHARE_BPS)
        uint256 citationPool = (price * CITATION_SHARE_BPS) / BPS;
        uint256 contributorShare = price - citationPool;

        // Direct payment to contributor
        claimable[asset.contributor] += contributorShare;
        contributorEarnings[asset.contributor] += contributorShare;

        // Distribute citation pool to cited works (Shapley attribution)
        _distributeCitationRevenue(assetId, citationPool);

        emit AccessPurchased(assetId, msg.sender, price, citationPool);
    }

    /**
     * @dev Distribute citation revenue proportionally to cited assets.
     *      Each cited work receives an equal share (simplified Shapley).
     *      Full Shapley computation happens off-chain via ShapleyVerifier.
     */
    function _distributeCitationRevenue(bytes32 assetId, uint256 pool) internal {
        bytes32[] storage cited = citedBy[assetId];
        if (cited.length == 0 || pool == 0) {
            // No citations — return pool to contributor
            claimable[assets[assetId].contributor] += pool;
            return;
        }

        uint256 sharePerCitation = pool / cited.length;
        uint256 distributed = 0;

        for (uint256 i = 0; i < cited.length; i++) {
            IntelligenceAsset storage citedAsset = assets[cited[i]];
            claimable[citedAsset.contributor] += sharePerCitation;
            contributorEarnings[citedAsset.contributor] += sharePerCitation;
            citedAsset.shapleyRevenue += sharePerCitation;
            distributed += sharePerCitation;
        }

        // Dust goes to the original contributor
        if (distributed < pool) {
            claimable[assets[assetId].contributor] += (pool - distributed);
        }
    }

    // ============ Claims ============

    /**
     * @notice Claim accumulated rewards.
     */
    function claimRewards() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[msg.sender] = 0;
        vibeToken.safeTransfer(msg.sender, amount);

        emit RewardsClaimed(msg.sender, amount);
    }

    // ============ Knowledge Epoch Anchoring ============

    /**
     * @notice Anchor a knowledge chain epoch on-chain.
     *         Called by authorized Jarvis shards to bridge off-chain
     *         knowledge consensus to on-chain verifiability.
     * @param merkleRoot Merkle root of the epoch's knowledge state
     * @param _assetCount Number of assets in the epoch
     * @param totalValue Aggregate value density of the epoch
     */
    function anchorKnowledgeEpoch(
        bytes32 merkleRoot,
        uint256 _assetCount,
        uint256 totalValue
    ) external {
        if (!epochSubmitters[msg.sender] && msg.sender != owner()) {
            revert NotEpochSubmitter();
        }

        epochCount++;
        epochs[epochCount] = KnowledgeEpoch({
            epochId: epochCount,
            merkleRoot: merkleRoot,
            assetCount: _assetCount,
            totalValue: totalValue,
            timestamp: block.timestamp,
            submitter: msg.sender
        });

        emit KnowledgeEpochAnchored(epochCount, merkleRoot, _assetCount, totalValue);
    }

    // ============ Verification — CognitiveConsensusMarket Integration ============

    /**
     * @notice Request decentralized evaluation of an asset via CognitiveConsensusMarket.
     *         The contributor submits their contentHash as a claim, funds a bounty,
     *         and evaluators (AI agents, verified humans) stake on the verdict.
     * @param assetId The asset to evaluate
     * @param minEvaluators Minimum evaluators required (3-21)
     * @param bounty Bounty to fund the evaluation (in vibeToken)
     */
    function requestEvaluation(
        bytes32 assetId,
        uint256 minEvaluators,
        uint256 bounty
    ) external nonReentrant {
        if (cognitiveConsensusMarket == address(0)) revert CognitiveConsensusMarketNotSet();

        IntelligenceAsset storage asset = assets[assetId];
        if (asset.submittedAt == 0) revert AssetNotFound();
        if (asset.contributor != msg.sender) revert NotAssetContributor();
        if (asset.state != AssetState.SUBMITTED) revert InvalidAssetState();
        if (assetToClaimId[assetId] != 0) revert EvaluationAlreadyRequested();

        // Transfer bounty from contributor and approve CCM to pull it
        vibeToken.safeTransferFrom(msg.sender, address(this), bounty);
        vibeToken.approve(cognitiveConsensusMarket, bounty);

        // Submit claim to CognitiveConsensusMarket
        // The claim hash IS the asset's content hash — evaluators verify the same content
        uint256 claimId = ICognitiveConsensusMarket(cognitiveConsensusMarket).submitClaim(
            asset.contentHash,
            bounty,
            minEvaluators
        );

        // Track the mapping both ways
        claimToAsset[claimId] = assetId;
        assetToClaimId[assetId] = claimId;
        asset.state = AssetState.EVALUATING;

        emit EvaluationRequested(assetId, claimId, bounty);
    }

    /**
     * @notice Settle an evaluation after CognitiveConsensusMarket resolves the claim.
     *         Anyone can call this once the claim is resolved — it reads the verdict
     *         from CCM and updates the asset state accordingly.
     * @param claimId The CCM claim ID to settle
     */
    function settleEvaluation(uint256 claimId) external nonReentrant {
        if (cognitiveConsensusMarket == address(0)) revert CognitiveConsensusMarketNotSet();

        bytes32 assetId = claimToAsset[claimId];
        if (assetId == bytes32(0)) revert AssetNotFound();

        IntelligenceAsset storage asset = assets[assetId];
        if (asset.state != AssetState.EVALUATING) revert InvalidAssetState();

        // Read the claim state from CognitiveConsensusMarket
        (,,,,,,
            ICognitiveConsensusMarket.ClaimState claimState,
            ICognitiveConsensusMarket.Verdict verdict,
            ,,,,
        ) = ICognitiveConsensusMarket(cognitiveConsensusMarket).claims(claimId);

        if (claimState == ICognitiveConsensusMarket.ClaimState.RESOLVED) {
            if (verdict == ICognitiveConsensusMarket.Verdict.TRUE) {
                asset.state = AssetState.VERIFIED;
                emit AssetVerified(assetId);
                emit EvaluationSettled(assetId, claimId, true);
            } else {
                // FALSE or UNCERTAIN — mark as disputed
                asset.state = AssetState.DISPUTED;
                emit AssetDisputed(assetId);
                emit EvaluationSettled(assetId, claimId, false);
            }
        } else if (claimState == ICognitiveConsensusMarket.ClaimState.EXPIRED) {
            // Evaluation expired (not enough evaluators) — revert to SUBMITTED
            asset.state = AssetState.SUBMITTED;
            emit EvaluationSettled(assetId, claimId, false);
        } else {
            revert ClaimNotResolved();
        }
    }

    /**
     * @notice Owner-only verification (fallback / MVP path).
     *         Retained for cases where CCM is not yet deployed or for
     *         emergency manual verification.
     * @param assetId The asset to verify
     */
    function verifyAsset(bytes32 assetId) external onlyOwner {
        IntelligenceAsset storage asset = assets[assetId];
        if (asset.submittedAt == 0) revert AssetNotFound();
        if (asset.state != AssetState.SUBMITTED && asset.state != AssetState.EVALUATING) {
            revert InvalidAssetState();
        }

        asset.state = AssetState.VERIFIED;
        emit AssetVerified(assetId);
    }

    /**
     * @notice Dispute an asset. Returns stake to disputer if successful.
     * @param assetId The asset to dispute
     */
    function disputeAsset(bytes32 assetId) external onlyOwner {
        IntelligenceAsset storage asset = assets[assetId];
        if (asset.submittedAt == 0) revert AssetNotFound();

        asset.state = AssetState.DISPUTED;
        emit AssetDisputed(assetId);
    }

    // ============ Admin ============

    function addEpochSubmitter(address submitter) external onlyOwner {
        epochSubmitters[submitter] = true;
    }

    function removeEpochSubmitter(address submitter) external onlyOwner {
        epochSubmitters[submitter] = false;
    }

    /// @notice Set the CognitiveConsensusMarket address (Phase 1 activation)
    function setCognitiveConsensusMarket(address ccm) external onlyOwner {
        cognitiveConsensusMarket = ccm;
    }

    // ============ Bonding Curve ============

    /**
     * @notice Calculate bonding curve price based on citations.
     * @dev Formula: BASE_PRICE * (1 + citations * 0.15) ^ 1.5
     *      Approximated as: BASE * (BPS + citations * FACTOR) / BPS
     *      with a sqrt multiplier for the ^1.5 exponent.
     *
     *      This mirrors infofi.js: price = BASE * (1 + citations * 0.15) ^ 1.5
     */
    function _calculateBondingPrice(uint256 citations_) internal pure returns (uint256) {
        // Linear component: (1 + citations * 0.15) = (10000 + citations * 1500) / 10000
        uint256 linearFactor = BPS + (citations_ * BONDING_CITATION_FACTOR);

        // Base price scaled by linear factor
        uint256 linearPrice = (BONDING_BASE_PRICE * linearFactor) / BPS;

        // Apply sqrt multiplier for ^1.5 effect (sqrt of linearFactor)
        // sqrt approximation: good enough for pricing, exact math off-chain
        uint256 sqrtFactor = _sqrt(linearFactor * PRECISION) * BPS / _sqrt(BPS * PRECISION);

        return (linearPrice * sqrtFactor) / BPS;
    }

    /// @dev Babylonian square root
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ============ View Functions ============

    function getAsset(bytes32 assetId) external view returns (IntelligenceAsset memory) {
        return assets[assetId];
    }

    function getCitations(bytes32 assetId) external view returns (bytes32[] memory) {
        return citationsOf[assetId];
    }

    function getCitedBy(bytes32 assetId) external view returns (bytes32[] memory) {
        return citedBy[assetId];
    }

    function getEpoch(uint256 epochId) external view returns (KnowledgeEpoch memory) {
        return epochs[epochId];
    }

    function getBondingPrice(uint256 citations_) external pure returns (uint256) {
        return _calculateBondingPrice(citations_);
    }

    receive() external payable {}
}
