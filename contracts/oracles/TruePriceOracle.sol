// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/ITruePriceOracle.sol";
import "./interfaces/IStablecoinFlowRegistry.sol";
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

    // ============ EIP-712 Type Hashes ============

    bytes32 public constant PRICE_UPDATE_TYPEHASH = keccak256(
        "PriceUpdate(bytes32 poolId,uint256 price,uint256 confidence,int256 deviationZScore,uint8 regime,uint256 manipulationProb,bytes32 dataHash,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant STABLECOIN_UPDATE_TYPEHASH = keccak256(
        "StablecoinUpdate(uint256 usdtUsdcRatio,bool usdtDominant,bool usdcDominant,uint256 volatilityMultiplier,uint256 nonce,uint256 deadline)"
    );

    // ============ Errors ============

    error UnauthorizedSigner();
    error StaleData();
    error InvalidSignature();
    error PriceJumpTooLarge(uint256 oldPrice, uint256 newPrice, uint256 jumpBps);
    error ExpiredSignature();
    error InvalidNonce();
    error ZeroAddress();
    error NoPriceData();

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

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("TruePriceOracle"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );

        // Initialize default stablecoin context
        stablecoinContext = StablecoinContext({
            usdtUsdcRatio: PRECISION, // 1.0 ratio
            usdtDominant: false,
            usdcDominant: false,
            volatilityMultiplier: PRECISION // 1.0x
        });
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
        // Verify signature and extract signer, nonce, deadline
        (address signer, uint256 nonce, uint256 deadline) = _verifyPriceSignature(
            poolId, price, confidence, deviationZScore, regime, manipulationProb, dataHash, signature
        );

        // Validate signer authorization
        if (!authorizedSigners[signer]) revert UnauthorizedSigner();

        // Validate nonce
        if (nonce != signerNonces[signer]) revert InvalidNonce();
        signerNonces[signer]++;

        // Validate deadline
        if (block.timestamp > deadline) revert ExpiredSignature();

        // Validate price jump (if existing data)
        TruePriceData memory existing = truePrices[poolId];
        if (existing.timestamp > 0 && existing.price > 0) {
            _validatePriceJump(existing.price, price);
        }

        // Store new data
        TruePriceData memory newData = TruePriceData({
            price: price,
            confidence: confidence,
            deviationZScore: deviationZScore,
            regime: regime,
            manipulationProb: manipulationProb,
            timestamp: uint64(block.timestamp),
            dataHash: dataHash
        });

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
        stablecoinRegistry = IStablecoinFlowRegistry(registry);
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

        bytes32 digest = SecurityLib.toTypedDataHash(DOMAIN_SEPARATOR, structHash);

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

        bytes32 digest = SecurityLib.toTypedDataHash(DOMAIN_SEPARATOR, structHash);

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

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
