// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title ComplianceRegistry
 * @notice Centralized compliance controls for regulatory flexibility
 * @dev Designed to satisfy potential SEC requirements for:
 *      - User tier-based access (retail/accredited/institutional)
 *      - Per-user account freezing
 *      - KYC/AML integration hooks
 *      - Jurisdiction restrictions
 *      - Transaction limits by tier
 *      - Compliance officer controls
 */
contract ComplianceRegistry is OwnableUpgradeable, UUPSUpgradeable {

    // ============ Enums ============

    /// @notice User KYC/accreditation tiers
    enum UserTier {
        BLOCKED,        // 0 - Cannot transact
        PENDING,        // 1 - KYC submitted, awaiting verification
        RETAIL,         // 2 - Verified retail user
        ACCREDITED,     // 3 - Accredited investor
        INSTITUTIONAL,  // 4 - Institutional/QIB
        EXEMPT          // 5 - Regulatory exempt (e.g., smart contracts)
    }

    /// @notice Account status flags
    enum AccountStatus {
        ACTIVE,         // Normal operations
        FROZEN,         // Temporarily frozen (investigation)
        SUSPENDED,      // Suspended pending review
        TERMINATED      // Permanently terminated
    }

    // ============ Structs ============

    /// @notice User compliance profile
    struct UserProfile {
        UserTier tier;
        AccountStatus status;
        uint64 kycTimestamp;        // When KYC was verified
        uint64 kycExpiry;           // When KYC expires (requires re-verification)
        bytes2 jurisdiction;        // ISO 3166-1 alpha-2 country code
        uint256 dailyVolumeUsed;    // Volume traded today (USD)
        uint256 lastVolumeReset;    // Timestamp of last daily reset
        string kycProvider;         // KYC provider identifier
        bytes32 kycHash;            // Hash of KYC data (off-chain reference)
    }

    /// @notice Tier-specific limits
    struct TierLimits {
        uint256 maxDailyVolume;     // Max USD volume per day (0 = unlimited)
        uint256 maxSingleTrade;     // Max USD per single trade (0 = unlimited)
        uint256 maxPositionSize;    // Max USD position in any pool (0 = unlimited)
        bool canAccessSecurities;   // Can trade security tokens
        bool canAccessDerivatives;  // Can trade derivative products
        bool canProvideLiquidity;   // Can be an LP
        bool canUsePriority;        // Can use priority auction
    }

    /// @notice Jurisdiction restrictions
    struct JurisdictionConfig {
        bool blocked;               // Completely blocked
        bool retailAllowed;         // Retail users allowed
        bool requiresAccreditation; // Only accredited+ allowed
        uint256 maxDailyVolume;     // Jurisdiction-wide daily limit
    }

    // ============ State Variables ============

    /// @notice User compliance profiles
    mapping(address => UserProfile) public userProfiles;

    /// @notice Tier-specific limits
    mapping(UserTier => TierLimits) public tierLimits;

    /// @notice Jurisdiction configurations
    mapping(bytes2 => JurisdictionConfig) public jurisdictions;

    /// @notice Compliance officers who can update user status
    mapping(address => bool) public complianceOfficers;

    /// @notice KYC providers authorized to verify users
    mapping(address => bool) public kycProviders;

    /// @notice Authorized contracts that can query compliance
    mapping(address => bool) public authorizedContracts;

    /// @notice Global compliance pause
    bool public compliancePaused;

    /// @notice Default KYC validity period (default 1 year)
    uint64 public defaultKycValidity;

    /// @notice Token-specific restrictions (e.g., security tokens)
    mapping(address => bool) public securityTokens;
    mapping(address => bool) public derivativeTokens;

    // ============ Events ============

    event UserTierUpdated(address indexed user, UserTier oldTier, UserTier newTier, address indexed updatedBy);
    event UserStatusUpdated(address indexed user, AccountStatus oldStatus, AccountStatus newStatus, string reason);
    event UserKYCVerified(address indexed user, string provider, bytes2 jurisdiction, uint64 expiry);
    event UserFrozen(address indexed user, string reason, address indexed frozenBy);
    event UserUnfrozen(address indexed user, address indexed unfrozenBy);
    event TierLimitsUpdated(UserTier tier, uint256 maxDaily, uint256 maxSingle);
    event JurisdictionUpdated(bytes2 indexed jurisdiction, bool blocked);
    event ComplianceOfficerUpdated(address indexed officer, bool authorized);
    event VolumeRecorded(address indexed user, uint256 volumeUsd, uint256 dailyTotal);

    // ============ Errors ============

    error UserBlocked();
    error AccountFrozen();
    error AccountSuspended();
    error KYCExpired();
    error KYCRequired();
    error JurisdictionBlocked();
    error DailyLimitExceeded(uint256 requested, uint256 remaining);
    error SingleTradeLimitExceeded(uint256 requested, uint256 limit);
    error SecurityTokenRestricted();
    error DerivativeRestricted();
    error LiquidityProvisionRestricted();
    error PriorityAuctionRestricted();
    error NotComplianceOfficer();
    error NotKYCProvider();
    error NotAuthorizedContract();
    error CompliancePaused();

    // ============ Modifiers ============

    modifier onlyComplianceOfficer() {
        if (!complianceOfficers[msg.sender] && msg.sender != owner()) revert NotComplianceOfficer();
        _;
    }

    modifier onlyKYCProvider() {
        if (!kycProviders[msg.sender] && msg.sender != owner()) revert NotKYCProvider();
        _;
    }

    modifier onlyAuthorizedContract() {
        if (!authorizedContracts[msg.sender] && msg.sender != owner()) revert NotAuthorizedContract();
        _;
    }

    modifier whenNotPaused() {
        if (compliancePaused) revert CompliancePaused();
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        defaultKycValidity = 365 days;

        // Set default tier limits
        _setDefaultTierLimits();
    }

    function _setDefaultTierLimits() internal {
        // BLOCKED - no access
        tierLimits[UserTier.BLOCKED] = TierLimits({
            maxDailyVolume: 0,
            maxSingleTrade: 0,
            maxPositionSize: 0,
            canAccessSecurities: false,
            canAccessDerivatives: false,
            canProvideLiquidity: false,
            canUsePriority: false
        });

        // PENDING - limited access while KYC processes
        tierLimits[UserTier.PENDING] = TierLimits({
            maxDailyVolume: 1000 * 1e18,      // $1,000/day
            maxSingleTrade: 500 * 1e18,       // $500/trade
            maxPositionSize: 1000 * 1e18,     // $1,000 position
            canAccessSecurities: false,
            canAccessDerivatives: false,
            canProvideLiquidity: false,
            canUsePriority: false
        });

        // RETAIL - standard verified users
        tierLimits[UserTier.RETAIL] = TierLimits({
            maxDailyVolume: 50000 * 1e18,     // $50,000/day
            maxSingleTrade: 10000 * 1e18,     // $10,000/trade
            maxPositionSize: 100000 * 1e18,   // $100,000 position
            canAccessSecurities: false,        // No security tokens
            canAccessDerivatives: false,       // No derivatives
            canProvideLiquidity: true,
            canUsePriority: true
        });

        // ACCREDITED - accredited investors
        tierLimits[UserTier.ACCREDITED] = TierLimits({
            maxDailyVolume: 500000 * 1e18,    // $500,000/day
            maxSingleTrade: 100000 * 1e18,    // $100,000/trade
            maxPositionSize: 1000000 * 1e18,  // $1M position
            canAccessSecurities: true,         // Can trade securities
            canAccessDerivatives: true,        // Can trade derivatives
            canProvideLiquidity: true,
            canUsePriority: true
        });

        // INSTITUTIONAL - QIBs and institutions
        tierLimits[UserTier.INSTITUTIONAL] = TierLimits({
            maxDailyVolume: 0,                 // Unlimited
            maxSingleTrade: 0,                 // Unlimited
            maxPositionSize: 0,                // Unlimited
            canAccessSecurities: true,
            canAccessDerivatives: true,
            canProvideLiquidity: true,
            canUsePriority: true
        });

        // EXEMPT - smart contracts, protocol addresses
        tierLimits[UserTier.EXEMPT] = TierLimits({
            maxDailyVolume: 0,
            maxSingleTrade: 0,
            maxPositionSize: 0,
            canAccessSecurities: true,
            canAccessDerivatives: true,
            canProvideLiquidity: true,
            canUsePriority: true
        });
    }

    // ============ Core Compliance Checks ============

    /**
     * @notice Check if user can execute a trade
     * @param user User address
     * @param volumeUsd Trade volume in USD (18 decimals)
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @return allowed Whether trade is allowed
     * @return reason Revert reason if not allowed (empty if allowed)
     */
    function canTrade(
        address user,
        uint256 volumeUsd,
        address tokenIn,
        address tokenOut
    ) external view whenNotPaused returns (bool allowed, string memory reason) {
        UserProfile storage profile = userProfiles[user];
        TierLimits storage limits = tierLimits[profile.tier];

        // Check account status
        if (profile.status == AccountStatus.FROZEN) return (false, "Account frozen");
        if (profile.status == AccountStatus.SUSPENDED) return (false, "Account suspended");
        if (profile.status == AccountStatus.TERMINATED) return (false, "Account terminated");
        if (profile.tier == UserTier.BLOCKED) return (false, "User blocked");

        // Check KYC expiry (skip for EXEMPT tier)
        if (profile.tier != UserTier.EXEMPT && profile.tier != UserTier.BLOCKED) {
            if (profile.kycExpiry > 0 && block.timestamp > profile.kycExpiry) {
                return (false, "KYC expired");
            }
        }

        // Check jurisdiction
        if (profile.jurisdiction != bytes2(0)) {
            JurisdictionConfig storage jConfig = jurisdictions[profile.jurisdiction];
            if (jConfig.blocked) return (false, "Jurisdiction blocked");
            if (jConfig.requiresAccreditation && profile.tier < UserTier.ACCREDITED) {
                return (false, "Accreditation required for jurisdiction");
            }
        }

        // Check single trade limit
        if (limits.maxSingleTrade > 0 && volumeUsd > limits.maxSingleTrade) {
            return (false, "Single trade limit exceeded");
        }

        // Check daily volume (with reset logic)
        uint256 dailyUsed = _getDailyVolumeUsed(user);
        if (limits.maxDailyVolume > 0 && dailyUsed + volumeUsd > limits.maxDailyVolume) {
            return (false, "Daily volume limit exceeded");
        }

        // Check security token restrictions
        if (securityTokens[tokenIn] || securityTokens[tokenOut]) {
            if (!limits.canAccessSecurities) {
                return (false, "Security token access restricted");
            }
        }

        // Check derivative restrictions
        if (derivativeTokens[tokenIn] || derivativeTokens[tokenOut]) {
            if (!limits.canAccessDerivatives) {
                return (false, "Derivative access restricted");
            }
        }

        return (true, "");
    }

    /**
     * @notice Check if user can provide liquidity
     * @param user User address
     * @return allowed Whether LP is allowed
     */
    function canProvideLiquidity(address user) external view whenNotPaused returns (bool) {
        UserProfile storage profile = userProfiles[user];
        if (profile.status != AccountStatus.ACTIVE) return false;
        if (profile.tier == UserTier.BLOCKED) return false;
        return tierLimits[profile.tier].canProvideLiquidity;
    }

    /**
     * @notice Check if user can use priority auction
     * @param user User address
     * @return allowed Whether priority is allowed
     */
    function canUsePriorityAuction(address user) external view whenNotPaused returns (bool) {
        UserProfile storage profile = userProfiles[user];
        if (profile.status != AccountStatus.ACTIVE) return false;
        if (profile.tier == UserTier.BLOCKED) return false;
        return tierLimits[profile.tier].canUsePriority;
    }

    /**
     * @notice Record trade volume (called by authorized contracts)
     * @param user User address
     * @param volumeUsd Volume in USD
     */
    function recordVolume(address user, uint256 volumeUsd) external onlyAuthorizedContract {
        UserProfile storage profile = userProfiles[user];

        // Reset daily volume if new day
        if (block.timestamp / 1 days > profile.lastVolumeReset / 1 days) {
            profile.dailyVolumeUsed = 0;
            profile.lastVolumeReset = block.timestamp;
        }

        profile.dailyVolumeUsed += volumeUsd;
        emit VolumeRecorded(user, volumeUsd, profile.dailyVolumeUsed);
    }

    // ============ KYC Management ============

    /**
     * @notice Verify user KYC (called by authorized KYC providers)
     * @param user User address
     * @param tier User tier after verification
     * @param jurisdiction ISO 3166-1 alpha-2 country code
     * @param kycHash Hash of off-chain KYC data
     * @param providerName KYC provider identifier
     */
    function verifyKYC(
        address user,
        UserTier tier,
        bytes2 jurisdiction,
        bytes32 kycHash,
        string calldata providerName
    ) external onlyKYCProvider {
        require(tier != UserTier.BLOCKED, "Cannot verify as blocked");

        UserProfile storage profile = userProfiles[user];
        UserTier oldTier = profile.tier;

        profile.tier = tier;
        profile.status = AccountStatus.ACTIVE;
        profile.kycTimestamp = uint64(block.timestamp);
        profile.kycExpiry = uint64(block.timestamp + defaultKycValidity);
        profile.jurisdiction = jurisdiction;
        profile.kycProvider = providerName;
        profile.kycHash = kycHash;

        emit UserTierUpdated(user, oldTier, tier, msg.sender);
        emit UserKYCVerified(user, providerName, jurisdiction, profile.kycExpiry);
    }

    /**
     * @notice Extend KYC validity
     * @param user User address
     * @param additionalTime Additional validity period
     */
    function extendKYC(address user, uint64 additionalTime) external onlyKYCProvider {
        userProfiles[user].kycExpiry += additionalTime;
    }

    // ============ Compliance Officer Functions ============

    /**
     * @notice Freeze user account
     * @param user User address
     * @param reason Reason for freezing
     */
    function freezeUser(address user, string calldata reason) external onlyComplianceOfficer {
        UserProfile storage profile = userProfiles[user];
        AccountStatus oldStatus = profile.status;
        profile.status = AccountStatus.FROZEN;

        emit UserStatusUpdated(user, oldStatus, AccountStatus.FROZEN, reason);
        emit UserFrozen(user, reason, msg.sender);
    }

    /**
     * @notice Unfreeze user account
     * @param user User address
     */
    function unfreezeUser(address user) external onlyComplianceOfficer {
        UserProfile storage profile = userProfiles[user];
        AccountStatus oldStatus = profile.status;
        profile.status = AccountStatus.ACTIVE;

        emit UserStatusUpdated(user, oldStatus, AccountStatus.ACTIVE, "Unfrozen");
        emit UserUnfrozen(user, msg.sender);
    }

    /**
     * @notice Suspend user account
     * @param user User address
     * @param reason Reason for suspension
     */
    function suspendUser(address user, string calldata reason) external onlyComplianceOfficer {
        UserProfile storage profile = userProfiles[user];
        AccountStatus oldStatus = profile.status;
        profile.status = AccountStatus.SUSPENDED;

        emit UserStatusUpdated(user, oldStatus, AccountStatus.SUSPENDED, reason);
    }

    /**
     * @notice Terminate user account (permanent)
     * @param user User address
     * @param reason Reason for termination
     */
    function terminateUser(address user, string calldata reason) external onlyComplianceOfficer {
        UserProfile storage profile = userProfiles[user];
        AccountStatus oldStatus = profile.status;
        profile.status = AccountStatus.TERMINATED;
        profile.tier = UserTier.BLOCKED;

        emit UserStatusUpdated(user, oldStatus, AccountStatus.TERMINATED, reason);
    }

    /**
     * @notice Block user (simpler than terminate, just blocks trading)
     * @param user User address
     */
    function blockUser(address user) external onlyComplianceOfficer {
        UserProfile storage profile = userProfiles[user];
        UserTier oldTier = profile.tier;
        profile.tier = UserTier.BLOCKED;

        emit UserTierUpdated(user, oldTier, UserTier.BLOCKED, msg.sender);
    }

    /**
     * @notice Batch freeze multiple users
     * @param users Array of user addresses
     * @param reason Reason for freezing
     */
    function batchFreezeUsers(address[] calldata users, string calldata reason) external onlyComplianceOfficer {
        for (uint256 i = 0; i < users.length; i++) {
            UserProfile storage profile = userProfiles[users[i]];
            profile.status = AccountStatus.FROZEN;
            emit UserFrozen(users[i], reason, msg.sender);
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Set tier limits
     * @param tier User tier
     * @param limits New limits for tier
     */
    function setTierLimits(UserTier tier, TierLimits calldata limits) external onlyOwner {
        tierLimits[tier] = limits;
        emit TierLimitsUpdated(tier, limits.maxDailyVolume, limits.maxSingleTrade);
    }

    /**
     * @notice Set jurisdiction configuration
     * @param jurisdiction ISO 3166-1 alpha-2 country code
     * @param config Jurisdiction configuration
     */
    function setJurisdiction(bytes2 jurisdiction, JurisdictionConfig calldata config) external onlyOwner {
        jurisdictions[jurisdiction] = config;
        emit JurisdictionUpdated(jurisdiction, config.blocked);
    }

    /**
     * @notice Block a jurisdiction
     * @param jurisdiction ISO 3166-1 alpha-2 country code
     */
    function blockJurisdiction(bytes2 jurisdiction) external onlyOwner {
        jurisdictions[jurisdiction].blocked = true;
        emit JurisdictionUpdated(jurisdiction, true);
    }

    /**
     * @notice Set compliance officer status
     * @param officer Officer address
     * @param authorized Whether authorized
     */
    function setComplianceOfficer(address officer, bool authorized) external onlyOwner {
        complianceOfficers[officer] = authorized;
        emit ComplianceOfficerUpdated(officer, authorized);
    }

    /**
     * @notice Set KYC provider status
     * @param provider Provider address
     * @param authorized Whether authorized
     */
    function setKYCProvider(address provider, bool authorized) external onlyOwner {
        kycProviders[provider] = authorized;
    }

    /**
     * @notice Set authorized contract status
     * @param contractAddr Contract address
     * @param authorized Whether authorized
     */
    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        authorizedContracts[contractAddr] = authorized;
    }

    /**
     * @notice Set security token status
     * @param token Token address
     * @param isSecurity Whether token is a security
     */
    function setSecurityToken(address token, bool isSecurity) external onlyOwner {
        securityTokens[token] = isSecurity;
    }

    /**
     * @notice Set derivative token status
     * @param token Token address
     * @param isDerivative Whether token is a derivative
     */
    function setDerivativeToken(address token, bool isDerivative) external onlyOwner {
        derivativeTokens[token] = isDerivative;
    }

    /**
     * @notice Set default KYC validity period
     * @param validity Validity period in seconds
     */
    function setDefaultKycValidity(uint64 validity) external onlyOwner {
        defaultKycValidity = validity;
    }

    /**
     * @notice Pause/unpause compliance checks
     * @param paused Whether to pause
     */
    function setCompliancePaused(bool paused) external onlyOwner {
        compliancePaused = paused;
    }

    /**
     * @notice Set user tier directly (admin override)
     * @param user User address
     * @param tier New tier
     */
    function setUserTier(address user, UserTier tier) external onlyOwner {
        UserProfile storage profile = userProfiles[user];
        UserTier oldTier = profile.tier;
        profile.tier = tier;
        emit UserTierUpdated(user, oldTier, tier, msg.sender);
    }

    /**
     * @notice Exempt an address (e.g., protocol contracts)
     * @param addr Address to exempt
     */
    function exemptAddress(address addr) external onlyOwner {
        UserProfile storage profile = userProfiles[addr];
        profile.tier = UserTier.EXEMPT;
        profile.status = AccountStatus.ACTIVE;
        emit UserTierUpdated(addr, UserTier.BLOCKED, UserTier.EXEMPT, msg.sender);
    }

    // ============ View Functions ============

    /**
     * @notice Get user's current daily volume used
     * @param user User address
     * @return volume Daily volume used (resets at midnight UTC)
     */
    function _getDailyVolumeUsed(address user) internal view returns (uint256) {
        UserProfile storage profile = userProfiles[user];
        // Reset if new day
        if (block.timestamp / 1 days > profile.lastVolumeReset / 1 days) {
            return 0;
        }
        return profile.dailyVolumeUsed;
    }

    /**
     * @notice Get user's remaining daily volume
     * @param user User address
     * @return remaining Remaining volume allowed today
     */
    function getRemainingDailyVolume(address user) external view returns (uint256) {
        UserProfile storage profile = userProfiles[user];
        TierLimits storage limits = tierLimits[profile.tier];

        if (limits.maxDailyVolume == 0) return type(uint256).max; // Unlimited

        uint256 used = _getDailyVolumeUsed(user);
        if (used >= limits.maxDailyVolume) return 0;
        return limits.maxDailyVolume - used;
    }

    /**
     * @notice Get user compliance profile
     * @param user User address
     * @return profile User's compliance profile
     */
    function getUserProfile(address user) external view returns (UserProfile memory) {
        return userProfiles[user];
    }

    /**
     * @notice Check if user is in good standing
     * @param user User address
     * @return inGoodStanding Whether user can transact
     */
    function isInGoodStanding(address user) external view returns (bool) {
        UserProfile storage profile = userProfiles[user];
        return profile.status == AccountStatus.ACTIVE &&
               profile.tier != UserTier.BLOCKED &&
               (profile.kycExpiry == 0 || block.timestamp <= profile.kycExpiry);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
