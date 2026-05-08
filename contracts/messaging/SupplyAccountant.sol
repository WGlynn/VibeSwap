// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {ISupplyAccountant} from "./interfaces/ISupplyAccountant.sol";

/**
 * @title SupplyAccountant
 * @notice Per-chain bookkeeping for the total-supply invariant.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §4, §6.3
 *         Interface: contracts/messaging/interfaces/ISupplyAccountant.sol
 *
 *         Local invariant (checked per token per batch):
 *
 *           localSupply(T) + outboundPending(T) =
 *               baseline(T) + totalInbound(T) - totalOutboundConfirmed(T)
 *
 *         Where:
 *           - localSupply: mirrors ERC20 totalSupply on this chain
 *           - outboundPending: burns initiated locally not yet confirmed delivered
 *           - baseline: genesis-chain initial seed (zero on non-genesis chains)
 *           - totalInbound: cumulative mints against attested foreign burns
 *           - totalOutboundConfirmed: cumulative burns whose foreign mint has been confirmed
 *
 *         The global cross-chain invariant Σ supply(c) = TOTAL is the *aggregate*
 *         of these per-chain invariants. v0.1 leaves cross-chain reconciliation
 *         to off-chain monitors; v0.2 adds a Merkle-committed invariant beacon
 *         that lets any chain prove its accounting is consistent with a global
 *         root.
 */
contract SupplyAccountant is
    ISupplyAccountant,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Storage ============

    /// @notice The MessagingHub authorized to mutate this accountant's state.
    address public messagingHub;

    /// @notice The canonical token contract authorized to call syncLocalSupply.
    /// @dev Multiple tokens can be registered; this maps token address → bool.
    mapping(address => bool) public registeredTokens;

    /// @notice Genesis-chain seed amount per token (non-zero only on genesis chain).
    mapping(address => uint256) public baseline;

    /// @notice Mirror of ERC20 totalSupply per registered token.
    mapping(address => uint256) public localSupplyByToken;

    /// @notice Pending outbound burns (initiated, not yet confirmed delivered).
    /// @dev token → cumulative pending across all destinations.
    mapping(address => uint256) public outboundPendingByToken;

    /// @notice Cumulative outbound burns confirmed delivered, per (token, dstChain).
    mapping(address => mapping(uint64 => uint256)) public outboundConfirmedByChain;

    /// @notice Cumulative inbound mints, per (token, sourceChain).
    mapping(address => mapping(uint64 => uint256)) public inboundConsumedByChain;

    /// @notice Total cumulative outbound (confirmed) per token.
    mapping(address => uint256) public totalOutboundByToken;

    /// @notice Total cumulative inbound per token.
    mapping(address => uint256) public totalInboundByToken;

    /// @dev (token, dstChain, nonce) → row state for in-flight outbound burns.
    struct OutboundRow {
        uint128 amount;
        bool confirmed;
        bool reversed;
    }
    mapping(address => mapping(uint64 => mapping(uint256 => OutboundRow)))
        internal outboundRows;

    /// @dev (chainId, nonce) → consumed flag. Used for replay checks across
    ///      both inbound (mint) nonces and outbound (burn) row tracking.
    mapping(uint64 => mapping(uint256 => bool)) internal nonceConsumedByChain;

    /// @dev List of registered tokens for batch invariant iteration.
    address[] internal registeredList;

    /// @dev Reserved storage gap for upgrade safety.
    uint256[40] private __gap;

    // ============ Constants ============

    bytes32 internal constant TAG_LOCAL_BALANCE = bytes32("LOCAL_BALANCE");
    bytes32 internal constant TAG_OUTBOUND_OVERFLOW = bytes32("OUTBOUND_OVERFLOW");

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _messagingHub, address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        messagingHub = _messagingHub;
    }

    // ============ Modifiers ============

    modifier onlyHub() {
        if (msg.sender != messagingHub) revert UnauthorizedWriter();
        _;
    }

    modifier onlyHubOrToken(address token) {
        if (msg.sender != messagingHub && msg.sender != token) revert UnauthorizedWriter();
        _;
    }

    modifier registeredToken(address token) {
        if (!registeredTokens[token]) revert UnknownToken(token);
        _;
    }

    // ============ Admin ============

    function registerToken(address token, uint256 baselineAmount) external onlyOwner {
        if (!registeredTokens[token]) {
            registeredTokens[token] = true;
            registeredList.push(token);
        }
        baseline[token] = baselineAmount;
    }

    function setMessagingHub(address newHub) external onlyOwner {
        messagingHub = newHub;
    }

    // ============ Hub-only writers ============

    /// @inheritdoc ISupplyAccountant
    function recordOutboundBurn(
        address token,
        uint64 dstChainId,
        uint256 nonce,
        uint256 amount
    ) external onlyHub registeredToken(token) {
        OutboundRow storage row = outboundRows[token][dstChainId][nonce];
        if (row.amount != 0) revert DuplicateNonce(dstChainId, nonce);

        row.amount = uint128(amount);
        outboundPendingByToken[token] += amount;

        emit OutboundBurnRecorded(token, dstChainId, nonce, amount);
    }

    /// @inheritdoc ISupplyAccountant
    function confirmOutboundBurn(
        address token,
        uint64 dstChainId,
        uint256 nonce
    ) external onlyHub registeredToken(token) {
        OutboundRow storage row = outboundRows[token][dstChainId][nonce];
        if (row.amount == 0) revert UnknownNonce(dstChainId, nonce);
        if (row.confirmed || row.reversed) revert UnknownNonce(dstChainId, nonce);

        uint256 amt = uint256(row.amount);
        row.confirmed = true;

        if (outboundPendingByToken[token] < amt) revert NegativeOutbound(token, dstChainId);
        outboundPendingByToken[token] -= amt;

        outboundConfirmedByChain[token][dstChainId] += amt;
        totalOutboundByToken[token] += amt;

        emit OutboundBurnConfirmed(token, dstChainId, nonce);
    }

    /// @inheritdoc ISupplyAccountant
    function reverseOutboundBurn(
        address token,
        uint64 dstChainId,
        uint256 nonce
    ) external onlyHub registeredToken(token) returns (uint256 amount) {
        OutboundRow storage row = outboundRows[token][dstChainId][nonce];
        if (row.amount == 0) revert UnknownNonce(dstChainId, nonce);
        if (row.confirmed || row.reversed) revert UnknownNonce(dstChainId, nonce);

        amount = uint256(row.amount);
        row.reversed = true;

        if (outboundPendingByToken[token] < amount) revert NegativeOutbound(token, dstChainId);
        outboundPendingByToken[token] -= amount;

        emit OutboundBurnReversed(token, dstChainId, nonce, amount);
    }

    /// @inheritdoc ISupplyAccountant
    function recordInboundMint(
        address token,
        uint64 sourceChainId,
        uint256 nonce,
        uint256 amount
    ) external onlyHub registeredToken(token) {
        if (nonceConsumedByChain[sourceChainId][nonce]) {
            revert DuplicateNonce(sourceChainId, nonce);
        }
        nonceConsumedByChain[sourceChainId][nonce] = true;

        inboundConsumedByChain[token][sourceChainId] += amount;
        totalInboundByToken[token] += amount;

        emit InboundMintRecorded(token, sourceChainId, nonce, amount);
    }

    /// @inheritdoc ISupplyAccountant
    function syncLocalSupply(address token, uint256 newLocalSupply)
        external
        onlyHubOrToken(token)
        registeredToken(token)
    {
        localSupplyByToken[token] = newLocalSupply;
        emit LocalSupplyChanged(token, newLocalSupply);
    }

    // ============ Invariant check ============

    /// @inheritdoc ISupplyAccountant
    function checkInvariant(address token)
        public
        view
        returns (bool ok, bytes32 tag)
    {
        if (!registeredTokens[token]) return (false, bytes32("NOT_REGISTERED"));

        // RHS = baseline + totalInbound - totalOutboundConfirmed
        uint256 rhsAdd = baseline[token] + totalInboundByToken[token];
        uint256 rhsSub = totalOutboundByToken[token];
        if (rhsSub > rhsAdd) return (false, TAG_OUTBOUND_OVERFLOW);
        uint256 rhs = rhsAdd - rhsSub;

        // LHS = localSupply + outboundPending
        uint256 lhs = localSupplyByToken[token] + outboundPendingByToken[token];

        if (lhs != rhs) return (false, TAG_LOCAL_BALANCE);
        return (true, bytes32(0));
    }

    /// @inheritdoc ISupplyAccountant
    function checkBatchInvariants() external view {
        uint256 n = registeredList.length;
        for (uint256 i = 0; i < n; i++) {
            (bool ok, bytes32 tag) = checkInvariant(registeredList[i]);
            if (!ok) revert InvariantBroken(registeredList[i], tag);
        }
    }

    // ============ Views ============

    function localSupply(address token) external view returns (uint256) {
        return localSupplyByToken[token];
    }

    function outboundBurned(address token, uint64 dstChainId)
        external
        view
        returns (uint256)
    {
        return outboundConfirmedByChain[token][dstChainId];
    }

    function inboundConsumed(address token, uint64 sourceChainId)
        external
        view
        returns (uint256)
    {
        return inboundConsumedByChain[token][sourceChainId];
    }

    function totalInbound(address token) external view returns (uint256) {
        return totalInboundByToken[token];
    }

    function totalOutbound(address token) external view returns (uint256) {
        return totalOutboundByToken[token];
    }

    function nonceConsumed(uint64 chainId, uint256 nonce) external view returns (bool) {
        return nonceConsumedByChain[chainId][nonce];
    }

    function outboundPending(address token) external view returns (uint256) {
        return outboundPendingByToken[token];
    }

    function getOutboundRow(address token, uint64 dstChainId, uint256 nonce)
        external
        view
        returns (uint128 amount, bool confirmed, bool reversed)
    {
        OutboundRow storage row = outboundRows[token][dstChainId][nonce];
        return (row.amount, row.confirmed, row.reversed);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
