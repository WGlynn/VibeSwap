// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/ITruePriceOracle.sol";
import "./interfaces/IStablecoinFlowRegistry.sol";
import "./interfaces/IIssuerReputationRegistry.sol";
import "./interfaces/IOracleAggregationCRA.sol";
import "../libraries/SecurityLib.sol";

/**
 * @title TruePriceOracle
 * @notice On-chain storage and validation for True Price updates from off-chain Kalman filter
 * @dev Receives signed True Price updates, validates them, stores historical data
 *
 * True Price is a Bayesian posterior estimate of equilibrium price that filters out:
 * - Leverage-driven distortions
 * - Liquidation cascades
 * - Stablecoin-enabled manipulation
 *
 * Key features:
 * - EIP-712 signed updates from authorized off-chain oracles
 * - Price jump validation to prevent manipulation
 * - Stablecoin-aware price bounds
 * - Historical data storage for trend analysis
 */
contract TruePriceOracle is
    ITruePriceOracle,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Admin Observability Events ============
    event StablecoinRegistryUpdated(address indexed previous, address indexed current);
    event IssuerRegistryUpdated(address indexed previous, address indexed current);
    event OracleAggregatorUpdated(address indexed previous, address indexed current);

    /// @notice C39 FAT-AUDIT-2 — emitted when a TruePrice is sourced from aggregator median.
    event TruePriceFromAggregator(bytes32 indexed poolId, uint256 indexed batchId, uint256 medianPrice, uint256 revealCount);

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant MAX_STALENESS = 5 minutes;
    uint256 public constant MAX_PRICE_JUMP_BPS = 1000; // 10% max jump between updates
    uint8 public constant HISTORY_SIZE = 24; // 2 hours of 5-min updates

    // Stablecoin adjustment factors (in bps)
    uint256 public constant USDT_DOMINANT_TIGHTENING = 8000; // 80% of normal bounds
    uint256 public constant USDC_DOMINANT_LOOSENING = 12000; // 120% of normal bounds

    // ============ Structs ============

    struct PriceHistory {
        TruePriceData[24] history;
        uint8 index;
        uint8 count;
    }

    // ============ State ============

    /// @notice Authorized signers for True Price updates
    mapping(address => bool) public authorizedSigners;

    /// @notice Current True Price data per pool
    mapping(bytes32 => TruePriceData) public truePrices;

    /// @notice Historical True Price data per pool (ring buffer)
    mapping(bytes32 => PriceHistory) internal priceHistory;

    /// @notice Current stablecoin context (global, not per-pool)
    StablecoinContext public stablecoinContext;

    /// @notice Nonces for replay protection
    mapping(address => uint256) public signerNonces;

    /// @notice Domain separator for EIP-712
    bytes32 public DOMAIN_SEPARATOR;

    /// @notice Reference to StablecoinFlowRegistry for additional context
    IStablecoinFlowRegistry public stablecoinRegistry;

    /// @notice C39 FAT-AUDIT-2 — Reference to the commit-reveal oracle aggregator.
    /// @dev address(0) disables the aggregator pull path. Set via setOracleAggregator.
    address public oracleAggregator;

    // ============ EIP-712 Type Hashes ============

    bytes32 public constant PRICE_UPDATE_TYPEHASH = keccak256(
        "PriceUpdate(bytes32 poolId,uint256 price,uint256 confidence,int256 deviationZScore,uint8 regime,uint256 manipulationProb,bytes32 dataHash,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant STABLECOIN_UPDATE_TYPEHASH = keccak256(
        "StablecoinUpdate(uint256 usdtUsdcRatio,bool usdtDominant,bool usdcDominant,uint256 volatilityMultiplier,uint256 nonce,uint256 deadline)"
    );

    // C12: EvidenceBundle typed data
    bytes32 public constant EVIDENCE_BUNDLE_TYPEHASH = keccak256(
        "EvidenceBundle(uint8 version,bytes32 poolId,uint256 price,uint256 confidence,int256 deviationZScore,uint8 regime,uint256 manipulationProb,bytes32 dataHash,bytes32 stablecoinContextHash,bytes32 issuerKey,uint256 nonce,uint256 deadline)"
    );

    uint8 public constant BUNDLE_VERSION = 1;

    /// @notice C12 — Issuer reputation registry for stake-bonded oracle identity.
    IIssuerReputationRegistry public issuerRegistry;

    /// @notice C37-F1 — chain ID captured at init, used to detect fork scenarios.
    ///         When `block.chainid != _cachedChainId`, `_domainSeparator()`
    ///         recomputes the domain separator against the live chain, making
    ///         cached-at-init signatures invalid on forked chains. Prevents
    ///         the cross-chain replay class documented in EIP-712 §Rationale.
    uint256 private _cachedChainId;

    /// @notice C37-F1 — compile-time name/version hashes used by
    ///         `_buildDomainSeparator` so recomputation is chain-aware
    ///         without re-hashing string literals at runtime.
    bytes32 private constant _HASHED_NAME = keccak256("TruePriceOracle");
    bytes32 private constant _HASHED_VERSION = keccak256("1");
    bytes32 private constant _TYPE_HASH_EIP712_DOMAIN = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    /// @dev Reserved storage gap for future upgrades.
    ///      C12: 50 → 49 (issuerRegistry). C37-F1: 49 → 48 (_cachedChainId).
    uint256[48] private __gap;

    // ============ Errors ============

    error UnauthorizedSigner();
    error StaleData();
    error InvalidSignature();
    error PriceJumpTooLarge(uint256 oldPrice, uint256 newPrice, uint256 jumpBps);
    error ExpiredSignature();
    error InvalidNonce();
    error ZeroAddress();
    error NoPriceData();
    // C12
    error UnsupportedBundleVersion(uint8 version);
    error IssuerRegistryNotSet();
    error IssuerNotActive(bytes32 issuerKey);
    error StablecoinContextMismatch();

    // ============ Modifiers ============

    modifier onlyAuthorizedSigner(address signer) {
        if (!authorizedSigners[signer]) revert UnauthorizedSigner();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner) external initializer {
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        // C37-F1: cache both the chain id and a domain separator computed
        // against it. `_domainSeparator()` returns this cached value when
        // block.chainid still matches, and recomputes on the fly if the chain
        // ever diverges (fork / migration). DOMAIN_SEPARATOR remains in
        // storage as the public fast-path value for the common case.
        _cachedChainId = block.chainid;
        DOMAIN_SEPARATOR = _buildDomainSeparator();

        // Initialize default stablecoin context
        stablecoinContext = StablecoinContext({
            usdtUsdcRatio: PRECISION, // 1.0 ratio
            usdtDominant: false,
            usdcDominant: false,
            volatilityMultiplier: PRECISION // 1.0x
        });
    }

    /// @notice C37-F1 — current-chain-aware domain separator. Use in place
    ///         of the cached public `DOMAIN_SEPARATOR` anywhere signatures
    ///         are verified. Cached fast path on the original chain; fresh
    ///         compute on forked chains.
    function _domainSeparator() internal view returns (bytes32) {
        if (block.chainid == _cachedChainId) {
            return DOMAIN_SEPARATOR;
        }
        return _buildDomainSeparator();
    }

    /// @notice C37-F1 — compute a domain separator against the live chain.
    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            _TYPE_HASH_EIP712_DOMAIN,
            _HASHED_NAME,
            _HASHED_VERSION,
            block.chainid,
            address(this)
        ));
    }

    /// @notice C37-F1 — external getter returning the fork-aware domain
    ///         separator. Off-chain keepers should prefer this over reading
    ///         the public `DOMAIN_SEPARATOR` storage slot directly.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    // ============ External View Functions ============

    /**
     * @inheritdoc ITruePriceOracle
     */
    function getTruePrice(bytes32 poolId) external view override returns (TruePriceData memory) {
        TruePriceData memory data = truePrices[poolId];
        if (data.timestamp == 0) revert NoPriceData();
        if (block.timestamp > data.timestamp + MAX_STALENESS) revert StaleData();
        return data;
    }

    /**
     * @inheritdoc ITruePriceOracle
     */
    function getStablecoinContext() external view override returns (StablecoinContext memory) {
        // Prefer registry if available
        if (address(stablecoinRegistry) != address(0)) {
            return StablecoinContext({
                usdtUsdcRatio: stablecoinRegistry.getCurrentFlowRatio(),
                usdtDominant: stablecoinRegistry.isUSDTDominant(),
                usdcDominant: stablecoinRegistry.isUSDCDominant(),
                volatilityMultiplier: stablecoinRegistry.getVolatilityMultiplier()
            });
        }
        return stablecoinContext;
    }

    /**
     * @inheritdoc ITruePriceOracle
     */
    function getDeviationMetrics(bytes32 poolId) external view override returns (
        uint256 truePrice,
        int256 deviationZScore,
        uint256 manipulationProb
    ) {
        TruePriceData memory data = truePrices[poolId];
        return (data.price, data.deviationZScore, data.manipulationProb);
    }

    /**
     * @inheritdoc ITruePriceOracle
     */
    function isManipulationLikely(bytes32 poolId, uint256 threshold) external view override returns (bool) {
        return truePrices[poolId].manipulationProb > threshold;
    }

    /**
     * @inheritdoc ITruePriceOracle
     */
    function getRegime(bytes32 poolId) external view override returns (RegimeType) {
        return truePrices[poolId].regime;
    }

    /**
     * @inheritdoc ITruePriceOracle
     */
    function isFresh(bytes32 poolId, uint256 maxAge) external view override returns (bool) {
        TruePriceData memory data = truePrices[poolId];
        if (data.timestamp == 0) return false;
        return block.timestamp <= data.timestamp + maxAge;
    }

    /**
     * @inheritdoc ITruePriceOracle
     */
    function getPriceBounds(bytes32 poolId, uint256 baseDeviationBps) external view override returns (
        uint256 lowerBound,
        uint256 upperBound
    ) {
        TruePriceData memory data = truePrices[poolId];
        if (data.price == 0) return (0, type(uint256).max);

        // Adjust bounds based on stablecoin context
        uint256 adjustedDeviationBps = baseDeviationBps;

        StablecoinContext memory ctx = _getStablecoinContext();
        if (ctx.usdtDominant) {
            // Tighter bounds during USDT-dominant (manipulation more likely)
            adjustedDeviationBps = (baseDeviationBps * USDT_DOMINANT_TIGHTENING) / BPS_PRECISION;
        } else if (ctx.usdcDominant) {
            // Looser bounds during USDC-dominant (genuine trend more likely)
            adjustedDeviationBps = (baseDeviationBps * USDC_DOMINANT_LOOSENING) / BPS_PRECISION;
        }

        // Also adjust based on regime
        if (data.regime == RegimeType.CASCADE || data.regime == RegimeType.MANIPULATION) {
            // Even tighter during cascade/manipulation
            adjustedDeviationBps = (adjustedDeviationBps * 7000) / BPS_PRECISION; // 70%
        } else if (data.regime == RegimeType.TREND) {
            // Looser during confirmed trends
            adjustedDeviationBps = (adjustedDeviationBps * 13000) / BPS_PRECISION; // 130%
        }

        lowerBound = data.price - (data.price * adjustedDeviationBps) / BPS_PRECISION;
        upperBound = data.price + (data.price * adjustedDeviationBps) / BPS_PRECISION;
    }

    // ============ Update Functions ============

    /**
     * @inheritdoc ITruePriceOracle
     */
    /// @dev Validate signature auth + nonce + deadline (extracted to reduce stack depth)
    function _validateAndAdvanceNonce(
        bytes32 poolId,
        uint256 price,
        uint256 confidence,
        int256 deviationZScore,
        RegimeType regime,
        uint256 manipulationProb,
        bytes32 dataHash,
        bytes calldata signature
    ) internal {
        (address signer, uint256 nonce, uint256 deadline) = _verifyPriceSignature(
            poolId, price, confidence, deviationZScore, regime, manipulationProb, dataHash, signature
        );
        if (!authorizedSigners[signer]) revert UnauthorizedSigner();
        if (nonce != signerNonces[signer]) revert InvalidNonce();
        signerNonces[signer]++;
        if (block.timestamp > deadline) revert ExpiredSignature();
    }

    function updateTruePrice(
        bytes32 poolId,
        uint256 price,
        uint256 confidence,
        int256 deviationZScore,
        RegimeType regime,
        uint256 manipulationProb,
        bytes32 dataHash,
        bytes calldata signature
    ) external override nonReentrant {
        _validateAndAdvanceNonce(poolId, price, confidence, deviationZScore, regime, manipulationProb, dataHash, signature);

        // Validate price jump (if existing data)
        if (truePrices[poolId].timestamp > 0 && truePrices[poolId].price > 0) {
            _validatePriceJump(truePrices[poolId].price, price);
        }

        // Store new data
        TruePriceData memory newData;
        newData.price = price;
        newData.confidence = confidence;
        newData.deviationZScore = deviationZScore;
        newData.regime = regime;
        newData.manipulationProb = manipulationProb;
        newData.timestamp = uint64(block.timestamp);
        newData.dataHash = dataHash;

        truePrices[poolId] = newData;
        _addToHistory(poolId, newData);

        emit TruePriceUpdated(poolId, price, deviationZScore, regime, manipulationProb, uint64(block.timestamp));
    }

    /**
     * @inheritdoc ITruePriceOracle
     */
    function updateStablecoinContext(
        uint256 usdtUsdcRatio,
        bool usdtDominant,
        bool usdcDominant,
        uint256 volatilityMultiplier,
        bytes calldata signature
    ) external override nonReentrant {
        (address signer, uint256 nonce, uint256 deadline) = _verifyStablecoinSignature(
            usdtUsdcRatio, usdtDominant, usdcDominant, volatilityMultiplier, signature
        );

        if (!authorizedSigners[signer]) revert UnauthorizedSigner();
        if (nonce != signerNonces[signer]) revert InvalidNonce();
        signerNonces[signer]++;
        if (block.timestamp > deadline) revert ExpiredSignature();

        stablecoinContext = StablecoinContext({
            usdtUsdcRatio: usdtUsdcRatio,
            usdtDominant: usdtDominant,
            usdcDominant: usdcDominant,
            volatilityMultiplier: volatilityMultiplier
        });

        emit StablecoinContextUpdated(usdtUsdcRatio, usdtDominant, usdcDominant, volatilityMultiplier);
    }

    // ============ Admin Functions ============

    /**
     * @inheritdoc ITruePriceOracle
     */
    function setAuthorizedSigner(address signer, bool authorized) external override onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        authorizedSigners[signer] = authorized;
        emit OracleSignerUpdated(signer, authorized);
    }

    /**
     * @notice Set StablecoinFlowRegistry address
     * @param registry Registry contract address
     */
    function setStablecoinRegistry(address registry) external onlyOwner {
        address prev = address(stablecoinRegistry);
        stablecoinRegistry = IStablecoinFlowRegistry(registry);
        emit StablecoinRegistryUpdated(prev, registry);
    }

    /**
     * @notice C12 — Set the IssuerReputationRegistry used by updateTruePriceBundle.
     * @param registry Registry contract address (zero to disable bundle path).
     */
    function setIssuerRegistry(address registry) external onlyOwner {
        address prev = address(issuerRegistry);
        issuerRegistry = IIssuerReputationRegistry(registry);
        emit IssuerRegistryUpdated(prev, registry);
    }

    /**
     * @notice C39 FAT-AUDIT-2 — Set the OracleAggregationCRA address used by pullFromAggregator.
     * @param aggregator Aggregator address (zero to disable the pull path).
     */
    function setOracleAggregator(address aggregator) external onlyOwner {
        address prev = oracleAggregator;
        oracleAggregator = aggregator;
        emit OracleAggregatorUpdated(prev, aggregator);
    }

    /**
     * @notice C39 FAT-AUDIT-2 — Permissionless pull of a settled batch's median into TruePrice.
     *
     * The aggregator's commit-reveal opacity replaces TPO's policy-level
     * 5% deviation gate. Anyone can trigger this pull; the aggregator's
     * own validation (committed before reveal, hash-matched, MIN_REVEALS≥3)
     * is the structural defense.
     *
     * Confidence is derived from revealCount — more honest reveals = higher
     * confidence. Caller specifies poolId since V1 aggregator is a single
     * price stream; V2 will host per-pool aggregator instances.
     *
     * @param poolId Pool identifier this median represents.
     * @param batchId Batch on the aggregator to pull from.
     */
    function pullFromAggregator(bytes32 poolId, uint256 batchId) external nonReentrant {
        require(oracleAggregator != address(0), "Aggregator unset");

        IOracleAggregationCRA.BatchInfo memory batch = IOracleAggregationCRA(oracleAggregator).getBatch(batchId);
        require(batch.phase == IOracleAggregationCRA.BatchPhase.SETTLED, "Batch not settled");
        require(batch.medianPrice > 0, "Zero median");

        // C49-F1 — Reject stale batches. The replay guard below only prevents
        // re-pulling a batch already pulled; without this gate, an adversary
        // can pull a long-settled batch (whose median reflects market conditions
        // from days/weeks ago) for the FIRST time and overwrite the live
        // TruePrice. `revealDeadline` is the moment settlement became eligible —
        // requiring the pull to land within MAX_STALENESS of that bound the
        // batch to the same freshness window the rest of TPO enforces on
        // signed updates (see getValidatedPrice / MAX_STALENESS).
        require(
            block.timestamp <= batch.revealDeadline + MAX_STALENESS,
            "Batch too stale"
        );

        // Confidence proportional to reveal count (capped at PRECISION).
        // 3 reveals -> ~30% confidence, 10+ reveals -> 100%.
        uint256 confidence = batch.revealCount * PRECISION / 10;
        if (confidence > PRECISION) confidence = PRECISION;

        TruePriceData memory newData;
        newData.price = batch.medianPrice;
        newData.confidence = confidence;
        newData.deviationZScore = 0;          // not applicable for aggregated path
        newData.regime = RegimeType.NORMAL;   // aggregator handles outlier defense structurally
        newData.manipulationProb = 0;         // commit-reveal opacity = anti-manipulation
        newData.timestamp = uint64(block.timestamp);
        newData.dataHash = keccak256(abi.encodePacked(poolId, batchId, batch.medianPrice));

        // Anti-replay: only accept if newer than last
        require(newData.timestamp > truePrices[poolId].timestamp, "Stale or replay");

        truePrices[poolId] = newData;
        _addToHistory(poolId, newData);

        emit TruePriceFromAggregator(poolId, batchId, batch.medianPrice, batch.revealCount);
        emit TruePriceUpdated(poolId, batch.medianPrice, 0, RegimeType.NORMAL, 0, uint64(block.timestamp));
    }

    // ============ C12: EvidenceBundle Update Path ============

    /// @inheritdoc ITruePriceOracle
    function updateTruePriceBundle(
        EvidenceBundle calldata bundle,
        bytes calldata signature
    ) external override nonReentrant {
        if (bundle.version != BUNDLE_VERSION) revert UnsupportedBundleVersion(bundle.version);
        if (address(issuerRegistry) == address(0)) revert IssuerRegistryNotSet();

        // Check stablecoin context snapshot matches current live context.
        if (bundle.stablecoinContextHash != _currentStablecoinContextHash()) {
            revert StablecoinContextMismatch();
        }

        (address signer, uint256 nonce, uint256 deadline) = _verifyBundleSignature(bundle, signature);

        // Issuer binding — the signer recovered from the signature must match the
        // signer registered under bundle.issuerKey, and the issuer must be ACTIVE
        // with reputation >= minReputation. This is the stake-bonded identity check.
        if (!issuerRegistry.verifyIssuer(bundle.issuerKey, signer)) {
            revert IssuerNotActive(bundle.issuerKey);
        }

        if (nonce != signerNonces[signer]) revert InvalidNonce();
        signerNonces[signer]++;
        if (block.timestamp > deadline) revert ExpiredSignature();

        // Price jump validation (if existing data).
        if (truePrices[bundle.poolId].timestamp > 0 && truePrices[bundle.poolId].price > 0) {
            _validatePriceJump(truePrices[bundle.poolId].price, bundle.price);
        }

        // Store new data.
        TruePriceData memory newData;
        newData.price = bundle.price;
        newData.confidence = bundle.confidence;
        newData.deviationZScore = bundle.deviationZScore;
        newData.regime = bundle.regime;
        newData.manipulationProb = bundle.manipulationProb;
        newData.timestamp = uint64(block.timestamp);
        newData.dataHash = bundle.dataHash;

        truePrices[bundle.poolId] = newData;
        _addToHistory(bundle.poolId, newData);

        emit TruePriceUpdated(bundle.poolId, bundle.price, bundle.deviationZScore, bundle.regime, bundle.manipulationProb, uint64(block.timestamp));
    }

    /// @dev Extracted to avoid stack-too-deep in _verifyBundleSignature.
    function _bundleStructHash(EvidenceBundle calldata bundle, uint256 nonce, uint256 deadline)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(
            EVIDENCE_BUNDLE_TYPEHASH,
            bundle.version,
            bundle.poolId,
            bundle.price,
            bundle.confidence,
            bundle.deviationZScore,
            uint8(bundle.regime),
            bundle.manipulationProb,
            bundle.dataHash,
            bundle.stablecoinContextHash,
            bundle.issuerKey,
            nonce,
            deadline
        ));
    }

    function _verifyBundleSignature(EvidenceBundle calldata bundle, bytes calldata signature)
        internal
        view
        returns (address signer, uint256 nonce, uint256 deadline)
    {
        require(signature.length >= 129, "Invalid signature length");

        nonce = abi.decode(signature[65:97], (uint256));
        deadline = abi.decode(signature[97:129], (uint256));

        // C37-F1: fork-aware domain separator
        bytes32 digest = SecurityLib.toTypedDataHash(
            _domainSeparator(),
            _bundleStructHash(bundle, nonce, deadline)
        );

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        signer = SecurityLib.recoverSigner(digest, v, r, s);
    }

    /// @notice Snapshot hash of the live stablecoin context. Off-chain issuer
    ///         must bind to this at attestation time for bundle replay to hold.
    function _currentStablecoinContextHash() internal view returns (bytes32) {
        StablecoinContext memory ctx = _getStablecoinContext();
        return keccak256(abi.encode(
            ctx.usdtUsdcRatio,
            ctx.usdtDominant,
            ctx.usdcDominant,
            ctx.volatilityMultiplier
        ));
    }

    /// @notice External helper so off-chain keepers can query the current hash.
    function currentStablecoinContextHash() external view returns (bytes32) {
        return _currentStablecoinContextHash();
    }

    /**
     * @notice Get signer's current nonce
     * @param signer Signer address
     * @return Current nonce
     */
    function getNonce(address signer) external view returns (uint256) {
        return signerNonces[signer];
    }

    // ============ Internal Functions ============

    function _getStablecoinContext() internal view returns (StablecoinContext memory) {
        if (address(stablecoinRegistry) != address(0)) {
            return StablecoinContext({
                usdtUsdcRatio: stablecoinRegistry.getCurrentFlowRatio(),
                usdtDominant: stablecoinRegistry.isUSDTDominant(),
                usdcDominant: stablecoinRegistry.isUSDCDominant(),
                volatilityMultiplier: stablecoinRegistry.getVolatilityMultiplier()
            });
        }
        return stablecoinContext;
    }

    function _validatePriceJump(uint256 oldPrice, uint256 newPrice) internal pure {
        uint256 diff = oldPrice > newPrice ? oldPrice - newPrice : newPrice - oldPrice;
        uint256 diffBps = (diff * BPS_PRECISION) / oldPrice;

        if (diffBps > MAX_PRICE_JUMP_BPS) {
            revert PriceJumpTooLarge(oldPrice, newPrice, diffBps);
        }
    }

    function _addToHistory(bytes32 poolId, TruePriceData memory data) internal {
        PriceHistory storage history = priceHistory[poolId];
        uint8 nextIndex = (history.index + 1) % HISTORY_SIZE;
        history.history[nextIndex] = data;
        history.index = nextIndex;
        if (history.count < HISTORY_SIZE) history.count++;
    }

    function _verifyPriceSignature(
        bytes32 poolId,
        uint256 price,
        uint256 confidence,
        int256 deviationZScore,
        RegimeType regime,
        uint256 manipulationProb,
        bytes32 dataHash,
        bytes calldata signature
    ) internal view returns (address signer, uint256 nonce, uint256 deadline) {
        // Signature format: [32 bytes r][32 bytes s][1 byte v][32 bytes nonce][32 bytes deadline]
        require(signature.length >= 129, "Invalid signature length");

        nonce = abi.decode(signature[65:97], (uint256));
        deadline = abi.decode(signature[97:129], (uint256));

        bytes32 structHash = keccak256(abi.encode(
            PRICE_UPDATE_TYPEHASH,
            poolId,
            price,
            confidence,
            deviationZScore,
            uint8(regime),
            manipulationProb,
            dataHash,
            nonce,
            deadline
        ));

        // C37-F1: fork-aware domain separator
        bytes32 digest = SecurityLib.toTypedDataHash(_domainSeparator(), structHash);

        // Extract r, s, v
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        signer = SecurityLib.recoverSigner(digest, v, r, s);
    }

    function _verifyStablecoinSignature(
        uint256 usdtUsdcRatio,
        bool usdtDominant,
        bool usdcDominant,
        uint256 volatilityMultiplier,
        bytes calldata signature
    ) internal view returns (address signer, uint256 nonce, uint256 deadline) {
        require(signature.length >= 129, "Invalid signature length");

        nonce = abi.decode(signature[65:97], (uint256));
        deadline = abi.decode(signature[97:129], (uint256));

        bytes32 structHash = keccak256(abi.encode(
            STABLECOIN_UPDATE_TYPEHASH,
            usdtUsdcRatio,
            usdtDominant,
            usdcDominant,
            volatilityMultiplier,
            nonce,
            deadline
        ));

        // C37-F1: fork-aware domain separator
        bytes32 digest = SecurityLib.toTypedDataHash(_domainSeparator(), structHash);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        signer = SecurityLib.recoverSigner(digest, v, r, s);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
