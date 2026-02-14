// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibePluginRegistry
 * @notice On-chain registry of approved protocol extensions — curve types,
 *         oracle adapters, compliance modules, hook contracts.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         Governance-gated: plugins must be proposed, reviewed (grace period),
 *         and activated before protocol contracts can use them.
 *
 *         Plugin lifecycle:
 *           PROPOSED → APPROVED → ACTIVE → (DEPRECATED | DEACTIVATED)
 *
 *         Categories:
 *           - CURVE: AMM pricing curves (constant product, stable, concentrated)
 *           - ORACLE: Price feed adapters (Chainlink, TWAP, Kalman)
 *           - COMPLIANCE: Regulatory modules (KYC, AML, jurisdiction)
 *           - HOOK: Pre/post swap hooks (fees, rewards, compliance checks)
 *           - KEEPER: Keeper task definitions
 *           - OTHER: Uncategorized extensions
 *
 *         Reputation integration:
 *           - Higher trust tier = shorter grace period for activation
 *           - Plugin authors build reputation through successful deployments
 *           - Deprecated plugins don't affect author reputation
 */
interface IVibePluginRegistry {
    // ============ Enums ============

    enum PluginCategory {
        CURVE,
        ORACLE,
        COMPLIANCE,
        HOOK,
        KEEPER,
        OTHER
    }

    enum PluginState {
        PROPOSED,     // Submitted, awaiting approval
        APPROVED,     // Approved, in grace period before activation
        ACTIVE,       // Live, can be used by protocol contracts
        DEPRECATED,   // Soft sunset — still functional, no new integrations
        DEACTIVATED   // Hard kill — cannot be used
    }

    // ============ Structs ============

    /// @notice Registered plugin
    struct Plugin {
        // Slot 0
        address implementation;    // 20 bytes — contract address
        PluginCategory category;   // 1 byte
        PluginState state;         // 1 byte
        uint8 version;             // 1 byte — major version (0-255)

        // Slot 1
        address author;            // 20 bytes — who proposed it
        uint40 proposedAt;         // 5 bytes
        uint40 approvedAt;         // 5 bytes — 0 if not yet approved

        // Slot 2
        uint40 activatedAt;        // 5 bytes — 0 if not yet active
        uint40 deprecatedAt;       // 5 bytes — 0 if not deprecated
        uint32 gracePeriod;        // 4 bytes — seconds before activation after approval
        uint16 auditScore;         // 2 bytes — governance-assigned audit score (0-10000 BPS)

        // Full slots
        bytes32 metadataHash;      // Slot 3 — IPFS hash or content hash for off-chain docs
        uint256 integrations;      // Slot 4 — count of protocol contracts using this plugin
    }

    // ============ Events ============

    event PluginProposed(
        uint256 indexed pluginId,
        address indexed implementation,
        PluginCategory category,
        address indexed author
    );
    event PluginApproved(uint256 indexed pluginId, uint32 gracePeriod);
    event PluginActivated(uint256 indexed pluginId);
    event PluginDeprecated(uint256 indexed pluginId, string reason);
    event PluginDeactivated(uint256 indexed pluginId, string reason);
    event PluginMetadataUpdated(uint256 indexed pluginId, bytes32 metadataHash);
    event PluginAuditScoreSet(uint256 indexed pluginId, uint16 score);
    event IntegrationAdded(uint256 indexed pluginId, address indexed consumer);
    event IntegrationRemoved(uint256 indexed pluginId, address indexed consumer);
    event ReviewerUpdated(address indexed reviewer, bool status);
    event DefaultGracePeriodUpdated(uint32 newPeriod);
    event JulRewardsDeposited(address indexed depositor, uint256 amount);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error NotReviewer();
    error NotPluginAuthor();
    error PluginNotFound();
    error InvalidState();
    error GracePeriodNotElapsed();
    error PluginNotActive();
    error PluginAlreadyActive();
    error DuplicateImplementation();
    error InvalidCategory();
    error InvalidAuditScore();
    error AlreadyIntegrated();
    error NotIntegrated();

    // ============ Author Functions ============

    function proposePlugin(
        address implementation,
        PluginCategory category,
        bytes32 metadataHash
    ) external returns (uint256 pluginId);

    function updateMetadata(uint256 pluginId, bytes32 metadataHash) external;

    // ============ Reviewer Functions ============

    function approvePlugin(uint256 pluginId) external;
    function activatePlugin(uint256 pluginId) external;
    function deprecatePlugin(uint256 pluginId, string calldata reason) external;
    function deactivatePlugin(uint256 pluginId, string calldata reason) external;
    function setAuditScore(uint256 pluginId, uint16 score) external;

    // ============ Integration Functions ============

    function addIntegration(uint256 pluginId) external;
    function removeIntegration(uint256 pluginId) external;

    // ============ Admin Functions ============

    function setReviewer(address reviewer, bool status) external;
    function setDefaultGracePeriod(uint32 period) external;
    function depositJulRewards(uint256 amount) external;

    // ============ View Functions ============

    function getPlugin(uint256 pluginId) external view returns (Plugin memory);
    function totalPlugins() external view returns (uint256);
    function isActive(uint256 pluginId) external view returns (bool);
    function isActiveImplementation(address impl) external view returns (bool);
    function getPluginsByCategory(PluginCategory category) external view returns (uint256[] memory);
    function getPluginByImplementation(address impl) external view returns (uint256);
    function effectiveGracePeriod(address author) external view returns (uint32);
    function isReviewer(address account) external view returns (bool);
}
