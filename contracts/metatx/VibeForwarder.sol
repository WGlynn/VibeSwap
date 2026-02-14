// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IVibeForwarder.sol";
import "../oracle/IReputationOracle.sol";

/**
 * @title VibeForwarder
 * @notice Gasless meta-transaction forwarder with relayer management.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Extends OpenZeppelin's ERC2771Forwarder to add:
 *        - Relayer registry with JUL tips per successful forward
 *        - Per-user hourly rate limiting (prevents spam)
 *        - Reputation-gated: minimum trust tier to use gasless
 *        - Target whitelisting: only approved contracts accept forwards
 *        - Open or permissioned relaying mode
 *
 *      Users sign standard EIP-712 ForwardRequestData off-chain.
 *      Relayers call execute()/executeBatch() to forward on-chain.
 *      Target contracts use ERC2771Context._msgSender() for real user.
 *
 *      This contract IS the trusted forwarder that target contracts
 *      check via isTrustedForwarder(address).
 */
contract VibeForwarder is ERC2771Forwarder, Ownable, IVibeForwarder {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MAX_TIP = 100 ether;
    uint32 public constant MAX_RATE_LIMIT = 1000; // requests per hour

    // ============ Immutables ============

    IERC20 public immutable julToken;
    IReputationOracle public immutable reputationOracle;

    // ============ State ============

    uint256 public relayerTip;
    uint8 public minTrustTier;
    uint32 public userRateLimit;
    bool public openRelaying;
    uint256 public julRewardPool;

    mapping(address => RelayerInfo) private _relayers;
    mapping(address => bool) private _isRelayer;
    mapping(address => bool) private _targetWhitelist;

    // Rate limiting: user => hour bucket => count
    mapping(address => mapping(uint256 => uint256)) private _userRequests;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle,
        uint256 _relayerTip,
        uint32 _userRateLimit
    ) ERC2771Forwarder("VibeForwarder") Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        if (_reputationOracle == address(0)) revert ZeroAddress();

        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);

        relayerTip = _relayerTip > MAX_TIP ? MAX_TIP : _relayerTip;
        userRateLimit = _userRateLimit > MAX_RATE_LIMIT ? MAX_RATE_LIMIT : _userRateLimit;
        if (userRateLimit == 0) userRateLimit = 10; // sensible default
    }

    // ============ Forwarding Overrides ============

    /**
     * @notice Execute a signed forward request with relayer tracking.
     * @dev Wraps OZ's execute() with relayer validation, rate limiting,
     *      reputation checks, and JUL tip distribution.
     */
    function executeWithTracking(
        ForwardRequestData calldata request
    ) external payable {
        _validateForward(msg.sender, request.from, request.to);

        // Execute via parent
        execute(request);

        // Track and tip
        _recordSuccess(msg.sender, request.from, request.to);
    }

    /**
     * @notice Execute a batch of signed forward requests with relayer tracking.
     */
    function executeBatchWithTracking(
        ForwardRequestData[] calldata requests
    ) external payable {
        _validateRelayer(msg.sender);

        uint256 succeeded;
        for (uint256 i = 0; i < requests.length; i++) {
            // Validate each request individually (different users/targets)
            if (!_canForward(requests[i].from, requests[i].to)) continue;

            try this.execute(requests[i]) {
                _recordSuccessInternal(msg.sender, requests[i].from, requests[i].to);
                succeeded++;
            } catch {}
        }

        emit BatchForwarded(msg.sender, requests.length, succeeded);
    }

    // ============ Relayer Functions ============

    /**
     * @notice Register as a relayer.
     */
    function registerRelayer() external {
        if (_isRelayer[msg.sender]) revert AlreadyRegistered();

        _relayers[msg.sender] = RelayerInfo({
            active: true,
            registeredAt: uint40(block.timestamp),
            totalForwarded: 0,
            totalEarned: 0
        });
        _isRelayer[msg.sender] = true;

        emit RelayerRegistered(msg.sender);
    }

    /**
     * @notice Deactivate yourself as a relayer.
     */
    function deactivateRelayer() external {
        if (!_isRelayer[msg.sender]) revert NotRegistered();

        _relayers[msg.sender].active = false;
        emit RelayerDeactivated(msg.sender);
    }

    // ============ Admin Functions ============

    function setRelayerTip(uint256 tip) external onlyOwner {
        relayerTip = tip > MAX_TIP ? MAX_TIP : tip;
        emit RelayerTipUpdated(relayerTip);
    }

    function setMinTrustTier(uint8 tier) external onlyOwner {
        minTrustTier = tier;
        emit MinTrustTierUpdated(tier);
    }

    function setUserRateLimit(uint32 limit) external onlyOwner {
        userRateLimit = limit > MAX_RATE_LIMIT ? MAX_RATE_LIMIT : limit;
        if (userRateLimit == 0) userRateLimit = 1;
        emit UserRateLimitUpdated(userRateLimit);
    }

    function setOpenRelaying(bool open) external onlyOwner {
        openRelaying = open;
        emit OpenRelayingUpdated(open);
    }

    function setTargetWhitelist(address target, bool status) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        _targetWhitelist[target] = status;
        emit TargetWhitelisted(target, status);
    }

    function depositJulRewards(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        julRewardPool += amount;
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        emit JulRewardsDeposited(msg.sender, amount);
    }

    // ============ View Functions ============

    function getRelayer(address relayer) external view returns (RelayerInfo memory) {
        return _relayers[relayer];
    }

    function isActiveRelayer(address relayer) external view returns (bool) {
        if (openRelaying) return true;
        return _isRelayer[relayer] && _relayers[relayer].active;
    }

    function userRequestCount(address user) external view returns (uint256) {
        uint256 bucket = block.timestamp / 1 hours;
        return _userRequests[user][bucket];
    }

    function isTargetWhitelisted(address target) external view returns (bool) {
        return _targetWhitelist[target];
    }

    // ============ Internal ============

    function _validateForward(address relayer, address from, address to) internal view {
        _validateRelayer(relayer);
        if (!_canForward(from, to)) revert UserRateLimited();
    }

    function _validateRelayer(address relayer) internal view {
        if (!openRelaying) {
            if (!_isRelayer[relayer] || !_relayers[relayer].active) revert NotActiveRelayer();
        }
    }

    function _canForward(address from, address to) internal view returns (bool) {
        // Target whitelist check
        if (!_targetWhitelist[to]) return false;

        // Reputation check
        if (minTrustTier > 0) {
            if (reputationOracle.getTrustTier(from) < minTrustTier) return false;
        }

        // Rate limit check
        uint256 bucket = block.timestamp / 1 hours;
        if (_userRequests[from][bucket] >= userRateLimit) return false;

        return true;
    }

    function _recordSuccess(address relayer, address from, address to) internal {
        _recordSuccessInternal(relayer, from, to);
        emit RequestForwarded(relayer, from, to, true);
    }

    function _recordSuccessInternal(address relayer, address from, address to) internal {
        // Rate limit tracking
        uint256 bucket = block.timestamp / 1 hours;
        _userRequests[from][bucket]++;

        // Relayer stats
        if (_isRelayer[relayer]) {
            _relayers[relayer].totalForwarded++;

            // JUL tip
            if (relayerTip > 0 && julRewardPool >= relayerTip) {
                julRewardPool -= relayerTip;
                _relayers[relayer].totalEarned += relayerTip;
                julToken.safeTransfer(relayer, relayerTip);
            }
        }

        // Suppress unused variable warning
        to;
    }
}
