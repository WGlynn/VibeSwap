// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IStablecoinFlowRegistry.sol";
import "../libraries/SecurityLib.sol";

/**
 * @title StablecoinFlowRegistry
 * @notice Tracks USDT/USDC flow ratios and provides regime indicators
 * @dev Receives periodic updates from off-chain stablecoin analyzer
 *
 * Key insight from True Price framework:
 * - USDT flows typically enable leverage (volatility amplifier)
 * - USDC flows typically represent genuine capital (trend validator)
 *
 * Ratio interpretation:
 * - > 2.0: USDT-dominant (high leverage risk, manipulation likely)
 * - 1.0-2.0: Mixed, moderate leverage
 * - < 0.5: USDC-dominant (genuine capital, trend likely)
 */
contract StablecoinFlowRegistry is
    IStablecoinFlowRegistry,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_PRECISION = 10000;

    // Regime thresholds (18 decimals)
    uint256 public constant MANIPULATION_THRESHOLD = 2e18;  // ratio > 2.0 = USDT-dominant
    uint256 public constant TREND_THRESHOLD = 5e17;         // ratio < 0.5 = USDC-dominant

    // Volatility multiplier bounds
    uint256 public constant MIN_VOL_MULTIPLIER = 1e18;      // 1.0x
    uint256 public constant MAX_VOL_MULTIPLIER = 3e18;      // 3.0x

    // History settings
    uint8 public constant HISTORY_SIZE = 24;

    // ============ Structs ============

    struct FlowObservation {
        uint256 ratio;
        uint64 timestamp;
    }

    // ============ State ============

    /// @notice Current USDT/USDC flow ratio (18 decimals)
    uint256 public currentFlowRatio;

    /// @notice 7-day moving average flow ratio
    uint256 public avgFlowRatio7d;

    /// @notice Historical flow ratios (ring buffer)
    FlowObservation[24] public flowRatioHistory;
    uint8 public historyIndex;
    uint8 public historyCount;

    /// @notice Last update timestamp
    uint64 public lastUpdate;

    /// @notice Authorized updaters
    mapping(address => bool) public authorizedUpdaters;

    /// @notice Nonces for signed updates
    mapping(address => uint256) public updaterNonces;

    /// @notice Domain separator for EIP-712
    bytes32 public DOMAIN_SEPARATOR;

    // ============ EIP-712 Type Hash ============

    bytes32 public constant FLOW_UPDATE_TYPEHASH = keccak256(
        "FlowUpdate(uint256 newRatio,uint256 nonce,uint256 deadline)"
    );

    // ============ Errors ============

    error Unauthorized();
    error InvalidRatio();
    error ExpiredSignature();
    error InvalidNonce();
    error ZeroAddress();

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

        // Initialize with neutral ratio
        currentFlowRatio = PRECISION; // 1.0
        avgFlowRatio7d = PRECISION;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("StablecoinFlowRegistry"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ============ External View Functions ============

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function getCurrentFlowRatio() external view override returns (uint256) {
        return currentFlowRatio;
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function getAverageFlowRatio() external view override returns (uint256) {
        return avgFlowRatio7d;
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function isUSDTDominant() external view override returns (bool) {
        return currentFlowRatio > MANIPULATION_THRESHOLD;
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function isUSDCDominant() external view override returns (bool) {
        return currentFlowRatio < TREND_THRESHOLD;
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     * @dev Uses piecewise linear approximation of logistic function
     */
    function getManipulationProbability() external view override returns (uint256) {
        // Logistic: 1 / (1 + exp(-1.5 * (ratio - 2)))
        // On-chain approximation using piecewise linear:
        // ratio <= 1.0: ~0
        // ratio = 2.0: ~0.5
        // ratio >= 3.5: ~1.0

        if (currentFlowRatio <= PRECISION) {
            // ratio <= 1.0: very low probability
            return currentFlowRatio / 10; // 0 to 0.1
        }

        if (currentFlowRatio >= 35e17) {
            // ratio >= 3.5: very high probability
            return PRECISION; // 1.0
        }

        if (currentFlowRatio <= MANIPULATION_THRESHOLD) {
            // 1.0 < ratio <= 2.0: linear from 0.1 to 0.5
            uint256 normalizedLow = ((currentFlowRatio - PRECISION) * PRECISION) / PRECISION;
            return (PRECISION / 10) + (normalizedLow * 4) / 10; // 0.1 + 0.4 * (ratio - 1)
        }

        // 2.0 < ratio < 3.5: linear from 0.5 to 1.0
        uint256 normalizedHigh = ((currentFlowRatio - MANIPULATION_THRESHOLD) * PRECISION) / (15e17);
        return (PRECISION / 2) + (normalizedHigh / 2); // 0.5 + 0.5 * ((ratio - 2) / 1.5)
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function getVolatilityMultiplier() external view override returns (uint256) {
        // 1.0x at ratio 0, up to 3.0x at ratio 4.0+

        if (currentFlowRatio <= PRECISION) {
            // ratio <= 1.0: base multiplier
            return MIN_VOL_MULTIPLIER;
        }

        if (currentFlowRatio >= 4e18) {
            // ratio >= 4.0: max multiplier
            return MAX_VOL_MULTIPLIER;
        }

        // Linear interpolation: 1.0 + (ratio - 1.0) * (2.0 / 3.0)
        uint256 excess = currentFlowRatio - PRECISION;
        uint256 multiplierIncrease = (excess * 2e18) / (3e18);

        return MIN_VOL_MULTIPLIER + multiplierIncrease;
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function getTrustReduction() external view override returns (uint256) {
        // Trust reduction: 0 at ratio 1.0, up to 0.5 at ratio 3.0+

        if (currentFlowRatio <= PRECISION) {
            return 0;
        }

        if (currentFlowRatio >= 3e18) {
            return PRECISION / 2; // 0.5 max reduction
        }

        // Linear: (ratio - 1.0) * 0.25
        uint256 excess = currentFlowRatio - PRECISION;
        return (excess * 25) / 100;
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function getLastUpdate() external view override returns (uint64) {
        return lastUpdate;
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function getFlowRatioHistory(uint8 count) external view override returns (
        uint256[] memory ratios,
        uint64[] memory timestamps
    ) {
        uint8 actualCount = count > historyCount ? historyCount : count;
        ratios = new uint256[](actualCount);
        timestamps = new uint64[](actualCount);

        for (uint8 i = 0; i < actualCount; i++) {
            uint8 idx = (historyIndex + HISTORY_SIZE - i) % HISTORY_SIZE;
            ratios[i] = flowRatioHistory[idx].ratio;
            timestamps[i] = flowRatioHistory[idx].timestamp;
        }
    }

    // ============ Update Functions ============

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function updateFlowRatio(uint256 newRatio) external override nonReentrant {
        if (!authorizedUpdaters[msg.sender]) revert Unauthorized();
        _updateFlowRatio(newRatio);
    }

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function updateFlowRatioSigned(uint256 newRatio, bytes calldata signature) external override nonReentrant {
        // Verify signature
        (address signer, uint256 nonce, uint256 deadline) = _verifySignature(newRatio, signature);

        if (!authorizedUpdaters[signer]) revert Unauthorized();
        if (nonce != updaterNonces[signer]) revert InvalidNonce();
        updaterNonces[signer]++;
        if (block.timestamp > deadline) revert ExpiredSignature();

        _updateFlowRatio(newRatio);
    }

    // ============ Admin Functions ============

    /**
     * @inheritdoc IStablecoinFlowRegistry
     */
    function setAuthorizedUpdater(address updater, bool authorized) external override onlyOwner {
        if (updater == address(0)) revert ZeroAddress();
        authorizedUpdaters[updater] = authorized;
        emit UpdaterAuthorized(updater, authorized);
    }

    /**
     * @notice Get updater's current nonce
     * @param updater Updater address
     * @return Current nonce
     */
    function getNonce(address updater) external view returns (uint256) {
        return updaterNonces[updater];
    }

    // ============ Internal Functions ============

    function _updateFlowRatio(uint256 newRatio) internal {
        // Store previous state for regime change detection
        bool wasUsdtDominant = currentFlowRatio > MANIPULATION_THRESHOLD;
        bool wasUsdcDominant = currentFlowRatio < TREND_THRESHOLD;

        // Update current ratio
        currentFlowRatio = newRatio;
        lastUpdate = uint64(block.timestamp);

        // Update history
        uint8 nextIndex = (historyIndex + 1) % HISTORY_SIZE;
        flowRatioHistory[nextIndex] = FlowObservation({
            ratio: newRatio,
            timestamp: uint64(block.timestamp)
        });
        historyIndex = nextIndex;
        if (historyCount < HISTORY_SIZE) historyCount++;

        // Update 7-day average (using available history)
        avgFlowRatio7d = _calculateAverage();

        emit FlowRatioUpdated(newRatio, avgFlowRatio7d, uint64(block.timestamp));

        // Check for regime change
        bool isUsdtDominant = newRatio > MANIPULATION_THRESHOLD;
        bool isUsdcDominant = newRatio < TREND_THRESHOLD;

        if (isUsdtDominant != wasUsdtDominant || isUsdcDominant != wasUsdcDominant) {
            emit RegimeChanged(isUsdtDominant, isUsdcDominant);
        }
    }

    function _calculateAverage() internal view returns (uint256) {
        if (historyCount == 0) return currentFlowRatio;

        uint256 sum = 0;
        for (uint8 i = 0; i < historyCount; i++) {
            uint8 idx = (historyIndex + HISTORY_SIZE - i) % HISTORY_SIZE;
            sum += flowRatioHistory[idx].ratio;
        }

        return sum / historyCount;
    }

    function _verifySignature(
        uint256 newRatio,
        bytes calldata signature
    ) internal view returns (address signer, uint256 nonce, uint256 deadline) {
        // Signature format: [32 bytes r][32 bytes s][1 byte v][32 bytes nonce][32 bytes deadline]
        require(signature.length >= 129, "Invalid signature length");

        nonce = abi.decode(signature[65:97], (uint256));
        deadline = abi.decode(signature[97:129], (uint256));

        bytes32 structHash = keccak256(abi.encode(
            FLOW_UPDATE_TYPEHASH,
            newRatio,
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
