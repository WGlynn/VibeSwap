// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title JULBridge — PoW→PoS Token Bridge
 * @notice Burns JUL (Proof of Work token) to mint CKB-native (Proof of Stake token).
 *
 * @dev ONE-WAY bridge: JUL→CKB-native only. No reverse.
 *      This is permanent conversion — PoW energy crystallized into PoS collateral.
 *
 *      JUL has no burn function (custom ERC20 with rebase scalar), so this contract
 *      receives JUL via transferFrom and holds it permanently. The JUL is effectively
 *      burned — locked in this contract with no withdrawal function.
 *
 *      Rate limiting prevents flash-conversion attacks where an attacker accumulates
 *      massive JUL in one block and converts it all to CKB-native stake weight.
 *
 *      Exchange rate: 1:1 initially. Can be updated by governance to reflect
 *      the oracle-determined JUL/CKB-native rate.
 *
 *      "Energy becomes collateral. Work becomes stake." — Will
 */
/// @notice Minimal JUL interface (custom ERC20, not OZ)
interface IJULToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Minimal CKB-native interface
interface ICKBNative {
    function mint(address to, uint256 amount) external;
}

contract JULBridge is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ State ============

    /// @notice JUL token address
    IJULToken public julToken;

    /// @notice CKB-native token address
    ICKBNative public ckbNativeToken;

    /// @notice Exchange rate: CKB-native minted per JUL burned (18 decimals)
    /// @dev 1e18 = 1:1 rate. Can be adjusted by governance.
    uint256 public exchangeRate;

    /// @notice MON-004: Maximum rate change per update (10% = 0.1e18)
    uint256 public constant MAX_RATE_DELTA = 0.1e18;

    /// @notice Rate limit: max JUL convertible per epoch
    uint256 public maxPerEpoch;

    /// @notice Epoch duration for rate limiting
    uint256 public epochDuration;

    /// @notice Current epoch tracking
    uint256 public currentEpochStart;
    uint256 public convertedThisEpoch;

    /// @notice Total JUL permanently locked in this contract
    uint256 public totalJULLocked;

    /// @notice Total CKB-native minted through this bridge
    uint256 public totalCKBMinted;

    /// @notice Pause flag
    bool public paused;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event Bridged(
        address indexed user,
        uint256 julBurned,
        uint256 ckbMinted,
        uint256 exchangeRate
    );
    event ExchangeRateUpdated(uint256 oldRate, uint256 newRate);
    event RateLimitUpdated(uint256 maxPerEpoch, uint256 epochDuration);
    event BridgePaused(bool paused);

    // ============ Errors ============

    error ZeroAmount();
    error RateLimitExceeded();
    error BridgeIsPaused();
    error ZeroAddress();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _julToken,
        address _ckbNativeToken,
        address _owner
    ) external initializer {
        if (_julToken == address(0) || _ckbNativeToken == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        julToken = IJULToken(_julToken);
        ckbNativeToken = ICKBNative(_ckbNativeToken);

        exchangeRate = 1e18; // 1:1 initial rate
        maxPerEpoch = 100_000e18; // 100K JUL per epoch
        epochDuration = 1 hours;
        currentEpochStart = block.timestamp;
    }

    // ============ Bridge ============

    /**
     * @notice Convert JUL to CKB-native (one-way, permanent)
     * @dev Caller must approve this contract to spend their JUL first.
     *      JUL is transferred to this contract and held permanently.
     *      CKB-native is minted to the caller.
     * @param julAmount Amount of JUL to convert
     * @return ckbAmount Amount of CKB-native minted
     */
    function bridge(uint256 julAmount) external nonReentrant returns (uint256 ckbAmount) {
        if (paused) revert BridgeIsPaused();
        if (julAmount == 0) revert ZeroAmount();

        // Epoch rollover
        _checkEpoch();

        // Rate limit check
        if (convertedThisEpoch + julAmount > maxPerEpoch) revert RateLimitExceeded();

        // Calculate CKB-native output
        ckbAmount = (julAmount * exchangeRate) / 1e18;
        if (ckbAmount == 0) revert ZeroAmount();

        // MON-014: Update state BEFORE external calls (CEI pattern)
        convertedThisEpoch += julAmount;
        totalJULLocked += julAmount;
        totalCKBMinted += ckbAmount;

        // MON-002: Check transferFrom return value — JUL is custom ERC20
        bool success = julToken.transferFrom(msg.sender, address(this), julAmount);
        require(success, "JUL transfer failed");

        // Mint CKB-native to sender
        ckbNativeToken.mint(msg.sender, ckbAmount);

        emit Bridged(msg.sender, julAmount, ckbAmount, exchangeRate);
    }

    // ============ Admin ============

    /**
     * @notice Update the exchange rate
     * @dev Only governance. Rate is JUL-denominated: how many CKB-native per JUL.
     *      MON-004: Bounded to ±10% per update to prevent hyperinflation.
     */
    function setExchangeRate(uint256 newRate) external onlyOwner {
        if (newRate == 0) revert ZeroAmount();
        uint256 oldRate = exchangeRate;
        // MON-004: Prevent extreme rate changes
        uint256 maxDelta = (oldRate * MAX_RATE_DELTA) / 1e18;
        if (maxDelta == 0) maxDelta = 1; // Minimum delta of 1 wei
        require(
            newRate <= oldRate + maxDelta && newRate >= (oldRate > maxDelta ? oldRate - maxDelta : 0),
            "Rate change exceeds 10%"
        );
        exchangeRate = newRate;
        emit ExchangeRateUpdated(oldRate, newRate);
    }

    /**
     * @notice Update rate limit parameters
     */
    function setRateLimit(uint256 _maxPerEpoch, uint256 _epochDuration) external onlyOwner {
        if (_maxPerEpoch == 0 || _epochDuration == 0) revert ZeroAmount();
        maxPerEpoch = _maxPerEpoch;
        epochDuration = _epochDuration;
        emit RateLimitUpdated(_maxPerEpoch, _epochDuration);
    }

    /**
     * @notice Pause/unpause the bridge
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit BridgePaused(_paused);
    }

    // ============ View Functions ============

    /// @notice Remaining JUL convertible in the current epoch
    function remainingThisEpoch() external view returns (uint256) {
        if (block.timestamp >= currentEpochStart + epochDuration) {
            return maxPerEpoch; // New epoch would start on next bridge call
        }
        return maxPerEpoch > convertedThisEpoch ? maxPerEpoch - convertedThisEpoch : 0;
    }

    /// @notice Preview how much CKB-native you'd get for a given JUL amount
    function preview(uint256 julAmount) external view returns (uint256) {
        return (julAmount * exchangeRate) / 1e18;
    }

    // ============ Internal ============

    /// @dev MON-008: Advance by epochDuration increments, not to block.timestamp.
    ///      Prevents 2x rate limit exploit by timing calls around epoch boundaries.
    function _checkEpoch() internal {
        if (block.timestamp >= currentEpochStart + epochDuration) {
            // Advance to the latest complete epoch boundary (not current timestamp)
            uint256 elapsed = block.timestamp - currentEpochStart;
            uint256 epochsElapsed = elapsed / epochDuration;
            currentEpochStart += epochsElapsed * epochDuration;
            convertedThisEpoch = 0;
        }
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
