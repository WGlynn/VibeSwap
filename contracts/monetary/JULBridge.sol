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

/// @notice Joule's internal-balance API (pre-rebase scalar). C7-GOV-005: rate
///         limiting must use rebase-invariant units so the cap doesn't drift
///         with monetary policy.
interface IJouleInternal {
    function internalBalanceOf(address account) external view returns (uint256);
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

    /// @notice DEPRECATED (C7-GOV-005): rate limit in EXTERNAL (post-rebase) JUL.
    /// @dev    Kept in storage for backward-compat views. No longer enforced.
    ///         The active gate is `maxInternalPerEpoch`.
    uint256 public maxPerEpoch;

    /// @notice Epoch duration for rate limiting
    uint256 public epochDuration;

    /// @notice Current epoch tracking
    uint256 public currentEpochStart;
    /// @notice DEPRECATED (C7-GOV-005): tracks EXTERNAL JUL converted this epoch.
    /// @dev    Still updated for view consumers. The enforcement counter is
    ///         `internalConvertedThisEpoch`.
    uint256 public convertedThisEpoch;

    /// @notice Total JUL permanently locked in this contract (external display amount)
    uint256 public totalJULLocked;

    /// @notice Total CKB-native minted through this bridge
    uint256 public totalCKBMinted;

    /// @notice Pause flag
    bool public paused;

    // ============ C7-GOV-005: Rebase-invariant rate limit ============

    /// @notice Rate limit in INTERNAL (pre-rebase) JUL units per epoch.
    /// @dev    The actual enforcement counter. Internal units are rebase-invariant,
    ///         so the cap reflects the same amount of "work-equivalent" JUL across
    ///         positive and negative rebases. On upgrades, owner MUST call
    ///         `setInternalRateLimit` before the first bridge call (default 0
    ///         denies all conversions).
    uint256 public maxInternalPerEpoch;

    /// @notice Internal (pre-rebase) JUL converted in the current epoch.
    uint256 public internalConvertedThisEpoch;

    /// @notice Total internal (pre-rebase) JUL ever locked in this contract.
    uint256 public totalInternalJULLocked;

    /// @dev Reserved storage gap for future upgrades (50 → 47 after C7-GOV-005)
    uint256[47] private __gap;

    // ============ Events ============

    event Bridged(
        address indexed user,
        uint256 julBurned,
        uint256 ckbMinted,
        uint256 exchangeRate
    );
    /// @dev `internalJulBurned` field added in C7-GOV-005 for off-chain monitoring
    ///      of rebase-adjusted bridge volume.
    event BridgedInternal(
        address indexed user,
        uint256 internalJulBurned,
        uint256 externalJulBurned,
        uint256 ckbMinted
    );
    event ExchangeRateUpdated(uint256 oldRate, uint256 newRate);
    event RateLimitUpdated(uint256 maxPerEpoch, uint256 epochDuration);
    event InternalRateLimitUpdated(uint256 maxInternalPerEpoch);
    event BridgePaused(bool paused);

    // ============ Errors ============

    error ZeroAmount();
    error RateLimitExceeded();
    error InternalRateLimitExceeded();
    error BridgeIsPaused();
    error ZeroAddress();
    error ZeroInternalDelta();

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
        maxPerEpoch = 100_000e18; // 100K JUL per epoch (DEPRECATED, see maxInternalPerEpoch)
        maxInternalPerEpoch = 100_000e18; // C7-GOV-005: 100K internal JUL per epoch (active gate)
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

        // Epoch rollover (resets both external and internal counters)
        _checkEpoch();

        // Calculate CKB-native output (still based on external display amount —
        // user is paying with their displayed JUL, exchange rate is in display units)
        ckbAmount = (julAmount * exchangeRate) / 1e18;
        if (ckbAmount == 0) revert ZeroAmount();

        // C7-GOV-005: Measure INTERNAL delta and gate on rebase-invariant units.
        // Snapshot before, transfer, snapshot after — the difference is independent
        // of the current rebase scalar, so the rate limit doesn't drift with monetary
        // policy. The transfer is reverted on failure (require below).
        uint256 internalBefore = IJouleInternal(address(julToken)).internalBalanceOf(address(this));

        // MON-002: Check transferFrom return value — JUL is custom ERC20
        bool success = julToken.transferFrom(msg.sender, address(this), julAmount);
        require(success, "JUL transfer failed");

        uint256 internalAfter = IJouleInternal(address(julToken)).internalBalanceOf(address(this));
        uint256 internalDelta = internalAfter - internalBefore;
        if (internalDelta == 0) revert ZeroInternalDelta();

        // C7-GOV-005: Internal-units gate (the actual enforcement)
        if (internalConvertedThisEpoch + internalDelta > maxInternalPerEpoch) {
            revert InternalRateLimitExceeded();
        }

        // Update accounting (CEI ordering already satisfied — only mint() remains)
        internalConvertedThisEpoch += internalDelta;
        totalInternalJULLocked += internalDelta;
        convertedThisEpoch += julAmount;       // backward-compat tracker (display units)
        totalJULLocked += julAmount;           // backward-compat tracker (display units)
        totalCKBMinted += ckbAmount;

        // Mint CKB-native to sender
        ckbNativeToken.mint(msg.sender, ckbAmount);

        emit Bridged(msg.sender, julAmount, ckbAmount, exchangeRate);
        emit BridgedInternal(msg.sender, internalDelta, julAmount, ckbAmount);
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
     * @notice DEPRECATED (C7-GOV-005): updates the legacy display-unit limit which
     *         is no longer enforced. Kept for migration / view consumers.
     *         Use `setInternalRateLimit` to change the active gate.
     */
    function setRateLimit(uint256 _maxPerEpoch, uint256 _epochDuration) external onlyOwner {
        if (_maxPerEpoch == 0 || _epochDuration == 0) revert ZeroAmount();
        maxPerEpoch = _maxPerEpoch;
        epochDuration = _epochDuration;
        emit RateLimitUpdated(_maxPerEpoch, _epochDuration);
    }

    /**
     * @notice C7-GOV-005: Update the rebase-invariant rate limit (active gate).
     * @dev    Internal units are pre-rebase JUL — the cap is invariant under
     *         rebase scalar changes. After upgrading existing proxies, owner
     *         MUST call this before the next bridge call (default 0 denies all).
     */
    function setInternalRateLimit(uint256 _maxInternalPerEpoch) external onlyOwner {
        if (_maxInternalPerEpoch == 0) revert ZeroAmount();
        maxInternalPerEpoch = _maxInternalPerEpoch;
        emit InternalRateLimitUpdated(_maxInternalPerEpoch);
    }

    /**
     * @notice Pause/unpause the bridge
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit BridgePaused(_paused);
    }

    // ============ View Functions ============

    /// @notice DEPRECATED (C7-GOV-005): legacy display-units remaining.
    ///         No longer reflects the real gate. Use `remainingInternalThisEpoch`.
    function remainingThisEpoch() external view returns (uint256) {
        if (block.timestamp >= currentEpochStart + epochDuration) {
            return maxPerEpoch; // New epoch would start on next bridge call
        }
        return maxPerEpoch > convertedThisEpoch ? maxPerEpoch - convertedThisEpoch : 0;
    }

    /// @notice C7-GOV-005: Remaining INTERNAL JUL convertible in the current epoch.
    /// @dev    This is the actually-enforced limit. Compare against the internal
    ///         delta a deposit would produce (depositAmount / rebaseScalar at deposit time).
    function remainingInternalThisEpoch() external view returns (uint256) {
        if (block.timestamp >= currentEpochStart + epochDuration) {
            return maxInternalPerEpoch; // Next bridge call rolls the epoch
        }
        return maxInternalPerEpoch > internalConvertedThisEpoch
            ? maxInternalPerEpoch - internalConvertedThisEpoch
            : 0;
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
            internalConvertedThisEpoch = 0; // C7-GOV-005: roll the active counter
        }
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
