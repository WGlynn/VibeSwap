// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IVibePluginRegistry.sol";
import "../oracle/IReputationOracle.sol";

/**
 * @title VibePluginRegistry
 * @notice On-chain registry of approved protocol extensions.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Governs which contracts can plug into the VibeSwap protocol:
 *        - AMM curve implementations
 *        - Oracle adapters
 *        - Compliance modules
 *        - Pre/post swap hooks
 *        - Keeper task definitions
 *
 *      Lifecycle: PROPOSED → APPROVED → (grace period) → ACTIVE → DEPRECATED/DEACTIVATED
 *
 *      Reputation integration:
 *        - Higher trust tier = shorter grace period (6h/tier reduction)
 *        - Minimum grace period floor: 6 hours (prevents instant activation)
 *        - Authors earn JUL tip when plugin reaches ACTIVE state
 *
 *      Security model:
 *        - Reviewers (governance-appointed) approve/reject plugins
 *        - Grace period after approval lets users inspect before activation
 *        - Deactivation is immediate (emergency kill)
 *        - Deprecation is soft — existing integrations keep working
 *        - Implementation address uniqueness enforced (no duplicates)
 */
contract VibePluginRegistry is Ownable, ReentrancyGuard, IVibePluginRegistry {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint32 public constant MIN_GRACE_PERIOD = 6 hours;
    uint32 public constant MAX_GRACE_PERIOD = 30 days;
    uint32 public constant GRACE_REDUCTION_PER_TIER = 6 hours;
    uint256 public constant AUTHOR_TIP = 10 ether;
    uint16 private constant MAX_AUDIT_SCORE = 10_000;

    // ============ Immutables ============

    IERC20 public immutable julToken;
    IReputationOracle public immutable reputationOracle;

    // ============ State ============

    uint32 public defaultGracePeriod;
    uint256 public julRewardPool;

    Plugin[] private _plugins;

    mapping(address => bool) private _reviewers;
    mapping(address => uint256) private _implToPluginId;  // implementation → pluginId + 1 (0 = not registered)
    mapping(uint256 => mapping(address => bool)) private _integrated; // pluginId → consumer → bool

    // Category index: category → pluginId[]
    mapping(PluginCategory => uint256[]) private _categoryPlugins;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle,
        uint32 _defaultGracePeriod
    ) Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        if (_reputationOracle == address(0)) revert ZeroAddress();
        if (_defaultGracePeriod < MIN_GRACE_PERIOD) _defaultGracePeriod = MIN_GRACE_PERIOD;
        if (_defaultGracePeriod > MAX_GRACE_PERIOD) _defaultGracePeriod = MAX_GRACE_PERIOD;

        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
        defaultGracePeriod = _defaultGracePeriod;
    }

    // ============ Modifiers ============

    modifier onlyReviewer() {
        if (!_reviewers[msg.sender]) revert NotReviewer();
        _;
    }

    // ============ Author Functions ============

    /**
     * @notice Propose a new plugin for registry approval.
     * @param implementation Contract address of the plugin
     * @param category Plugin category
     * @param metadataHash IPFS/content hash for off-chain documentation
     * @return pluginId The ID of the newly created plugin entry
     */
    function proposePlugin(
        address implementation,
        PluginCategory category,
        bytes32 metadataHash
    ) external returns (uint256 pluginId) {
        if (implementation == address(0)) revert ZeroAddress();
        if (_implToPluginId[implementation] != 0) revert DuplicateImplementation();

        pluginId = _plugins.length;
        uint32 grace = effectiveGracePeriod(msg.sender);

        _plugins.push(Plugin({
            implementation: implementation,
            category: category,
            state: PluginState.PROPOSED,
            version: 1,
            author: msg.sender,
            proposedAt: uint40(block.timestamp),
            approvedAt: 0,
            activatedAt: 0,
            deprecatedAt: 0,
            gracePeriod: grace,
            auditScore: 0,
            metadataHash: metadataHash,
            integrations: 0
        }));

        _implToPluginId[implementation] = pluginId + 1;
        _categoryPlugins[category].push(pluginId);

        emit PluginProposed(pluginId, implementation, category, msg.sender);
    }

    /**
     * @notice Update plugin metadata (only by author, only before ACTIVE).
     */
    function updateMetadata(uint256 pluginId, bytes32 metadataHash) external {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        Plugin storage p = _plugins[pluginId];
        if (msg.sender != p.author) revert NotPluginAuthor();
        if (p.state == PluginState.ACTIVE || p.state == PluginState.DEPRECATED || p.state == PluginState.DEACTIVATED) {
            revert InvalidState();
        }

        p.metadataHash = metadataHash;
        emit PluginMetadataUpdated(pluginId, metadataHash);
    }

    // ============ Reviewer Functions ============

    /**
     * @notice Approve a proposed plugin. Starts the grace period countdown.
     */
    function approvePlugin(uint256 pluginId) external onlyReviewer {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        Plugin storage p = _plugins[pluginId];
        if (p.state != PluginState.PROPOSED) revert InvalidState();

        p.state = PluginState.APPROVED;
        p.approvedAt = uint40(block.timestamp);

        emit PluginApproved(pluginId, p.gracePeriod);
    }

    /**
     * @notice Activate a plugin after grace period has elapsed.
     *         Anyone can call this (permissionless activation after grace).
     *         Author earns JUL tip on activation.
     */
    function activatePlugin(uint256 pluginId) external nonReentrant {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        Plugin storage p = _plugins[pluginId];
        if (p.state != PluginState.APPROVED) revert InvalidState();
        if (block.timestamp < uint256(p.approvedAt) + p.gracePeriod) revert GracePeriodNotElapsed();

        p.state = PluginState.ACTIVE;
        p.activatedAt = uint40(block.timestamp);

        // Author tip
        if (julRewardPool >= AUTHOR_TIP) {
            julRewardPool -= AUTHOR_TIP;
            julToken.safeTransfer(p.author, AUTHOR_TIP);
        }

        emit PluginActivated(pluginId);
    }

    /**
     * @notice Soft-deprecate an active plugin. Existing integrations keep working.
     */
    function deprecatePlugin(uint256 pluginId, string calldata reason) external onlyReviewer {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        Plugin storage p = _plugins[pluginId];
        if (p.state != PluginState.ACTIVE) revert InvalidState();

        p.state = PluginState.DEPRECATED;
        p.deprecatedAt = uint40(block.timestamp);

        emit PluginDeprecated(pluginId, reason);
    }

    /**
     * @notice Hard-deactivate a plugin. Emergency kill — prevents all usage.
     *         Can deactivate from PROPOSED, APPROVED, ACTIVE, or DEPRECATED.
     */
    function deactivatePlugin(uint256 pluginId, string calldata reason) external onlyReviewer {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        Plugin storage p = _plugins[pluginId];
        if (p.state == PluginState.DEACTIVATED) revert InvalidState();

        p.state = PluginState.DEACTIVATED;
        emit PluginDeactivated(pluginId, reason);
    }

    /**
     * @notice Set audit score for a plugin (0-10000 BPS).
     */
    function setAuditScore(uint256 pluginId, uint16 score) external onlyReviewer {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        if (score > MAX_AUDIT_SCORE) revert InvalidAuditScore();

        _plugins[pluginId].auditScore = score;
        emit PluginAuditScoreSet(pluginId, score);
    }

    // ============ Integration Functions ============

    /**
     * @notice Register a protocol contract as a consumer of this plugin.
     *         Only active or deprecated plugins can be integrated.
     */
    function addIntegration(uint256 pluginId) external {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        Plugin storage p = _plugins[pluginId];
        if (p.state != PluginState.ACTIVE) revert PluginNotActive();
        if (_integrated[pluginId][msg.sender]) revert AlreadyIntegrated();

        _integrated[pluginId][msg.sender] = true;
        p.integrations++;

        emit IntegrationAdded(pluginId, msg.sender);
    }

    /**
     * @notice Remove a protocol contract's integration with this plugin.
     */
    function removeIntegration(uint256 pluginId) external {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        Plugin storage p = _plugins[pluginId];
        if (!_integrated[pluginId][msg.sender]) revert NotIntegrated();

        _integrated[pluginId][msg.sender] = false;
        p.integrations--;

        emit IntegrationRemoved(pluginId, msg.sender);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set or revoke reviewer status.
     */
    function setReviewer(address reviewer, bool status) external onlyOwner {
        if (reviewer == address(0)) revert ZeroAddress();
        _reviewers[reviewer] = status;
        emit ReviewerUpdated(reviewer, status);
    }

    /**
     * @notice Update default grace period for new plugins.
     */
    function setDefaultGracePeriod(uint32 period) external onlyOwner {
        if (period < MIN_GRACE_PERIOD) period = MIN_GRACE_PERIOD;
        if (period > MAX_GRACE_PERIOD) period = MAX_GRACE_PERIOD;
        defaultGracePeriod = period;
        emit DefaultGracePeriodUpdated(period);
    }

    /**
     * @notice Deposit JUL into the author reward pool.
     */
    function depositJulRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        julRewardPool += amount;
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        emit JulRewardsDeposited(msg.sender, amount);
    }

    // ============ View Functions ============

    function getPlugin(uint256 pluginId) external view returns (Plugin memory) {
        if (pluginId >= _plugins.length) revert PluginNotFound();
        return _plugins[pluginId];
    }

    function totalPlugins() external view returns (uint256) {
        return _plugins.length;
    }

    function isActive(uint256 pluginId) external view returns (bool) {
        if (pluginId >= _plugins.length) return false;
        return _plugins[pluginId].state == PluginState.ACTIVE;
    }

    function isActiveImplementation(address impl) external view returns (bool) {
        uint256 id = _implToPluginId[impl];
        if (id == 0) return false;
        return _plugins[id - 1].state == PluginState.ACTIVE;
    }

    function getPluginsByCategory(PluginCategory category) external view returns (uint256[] memory) {
        return _categoryPlugins[category];
    }

    function getPluginByImplementation(address impl) external view returns (uint256) {
        uint256 id = _implToPluginId[impl];
        if (id == 0) revert PluginNotFound();
        return id - 1;
    }

    /**
     * @notice Reputation-gated grace period. Higher trust = shorter wait.
     */
    function effectiveGracePeriod(address author) public view returns (uint32) {
        uint8 tier = reputationOracle.getTrustTier(author);
        uint32 reduction = uint32(tier) * GRACE_REDUCTION_PER_TIER;
        uint32 period = defaultGracePeriod > reduction ? defaultGracePeriod - reduction : 0;
        return period < MIN_GRACE_PERIOD ? MIN_GRACE_PERIOD : period;
    }

    function isReviewer(address account) external view returns (bool) {
        return _reviewers[account];
    }
}
