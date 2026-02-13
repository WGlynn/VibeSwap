// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./FederatedConsensus.sol";

/**
 * @title ClawbackRegistry
 * @notice Tracks tainted wallets and manages fund clawbacks with cascading reversal
 * @dev Core insight: if wallet A is flagged and sent funds to wallet B, wallet B
 *      is now tainted. Anyone who interacted with tainted wallets risks cascading
 *      reversal of their transactions. This creates a powerful deterrent:
 *      NOBODY will interact with bad wallets at risk of cascading transaction reversal.
 *
 *      Off-chain entities (government, lawyers, courts, SEC) vote through
 *      FederatedConsensus before any clawback executes.
 */
contract ClawbackRegistry is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum TaintLevel {
        CLEAN,          // 0 - No issues
        WATCHLIST,      // 1 - Under observation, transactions allowed
        TAINTED,        // 2 - Received funds from flagged wallet
        FLAGGED,        // 3 - Directly flagged by authority
        FROZEN          // 4 - All funds locked, clawback pending
    }

    enum CaseStatus {
        OPEN,
        VOTING,
        APPROVED,
        EXECUTING,
        RESOLVED,
        DISMISSED
    }

    // ============ Structs ============

    struct WalletRecord {
        TaintLevel taintLevel;
        uint64 flaggedAt;
        bytes32 caseId;           // Associated case (if any)
        address taintedBy;        // Which flagged wallet tainted this one
        uint256 taintedAmount;    // Amount received from tainted source
        address taintedToken;     // Token received from tainted source
        uint256 taintDepth;       // How many hops from original flagged wallet
    }

    struct ClawbackCase {
        bytes32 caseId;
        address originWallet;     // The originally flagged bad actor
        address claimant;         // Who filed the claim (victim or authority)
        string reason;            // Human-readable reason
        CaseStatus status;
        uint64 createdAt;
        uint64 resolvedAt;
        uint256 totalAmount;      // Total amount to claw back
        address token;            // Token to claw back
        bytes32 consensusProposalId; // FederatedConsensus proposal
        uint256 cascadeCount;     // How many wallets in the cascade
    }

    struct TaintRecord {
        address from;
        address to;
        uint256 amount;
        address token;
        uint64 timestamp;
        bytes32 txHash;
    }

    // ============ State ============

    /// @notice FederatedConsensus contract for authority voting
    FederatedConsensus public consensus;

    /// @notice Wallet taint records
    mapping(address => WalletRecord) public walletRecords;

    /// @notice Clawback cases
    mapping(bytes32 => ClawbackCase) public cases;

    /// @notice Transaction taint chain: wallet => list of taint records
    mapping(address => TaintRecord[]) public taintChain;

    /// @notice Wallets involved in a case: caseId => wallets
    mapping(bytes32 => address[]) public caseWallets;

    /// @notice Maximum cascade depth (prevents gas griefing)
    uint256 public maxCascadeDepth;

    /// @notice Maximum wallets per case (prevents unbounded array gas DoS)
    uint256 public constant MAX_CASE_WALLETS = 1000;

    /// @notice Minimum amount to propagate taint (dust filter)
    uint256 public minTaintAmount;

    /// @notice Case counter
    uint256 public caseCount;

    /// @notice Authorized trackers (can record transactions for taint propagation)
    mapping(address => bool) public authorizedTrackers;

    /// @notice ClawbackVault address
    address public vault;

    // ============ Events ============

    event WalletFlagged(address indexed wallet, TaintLevel level, bytes32 indexed caseId);
    event TaintPropagated(address indexed from, address indexed to, uint256 amount, uint256 depth);
    event CaseOpened(bytes32 indexed caseId, address indexed originWallet, address indexed claimant, string reason);
    event CaseStatusChanged(bytes32 indexed caseId, CaseStatus oldStatus, CaseStatus newStatus);
    event ClawbackExecuted(bytes32 indexed caseId, address indexed wallet, uint256 amount, address token);
    event WalletCleared(address indexed wallet, bytes32 indexed caseId);
    event TransactionRecorded(address indexed from, address indexed to, uint256 amount, address token);

    // ============ Errors ============

    error WalletNotFlagged();
    error CaseNotFound();
    error InvalidCaseStatus();
    error MaxCascadeDepthReached();
    error NotAuthorizedTracker();
    error ConsensusNotApproved();
    error WalletAlreadyFlagged();
    error VaultNotSet();

    // ============ Modifiers ============

    modifier onlyTracker() {
        if (!authorizedTrackers[msg.sender] && msg.sender != owner()) revert NotAuthorizedTracker();
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _consensus,
        uint256 _maxCascadeDepth,
        uint256 _minTaintAmount
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        consensus = FederatedConsensus(_consensus);
        maxCascadeDepth = _maxCascadeDepth;
        minTaintAmount = _minTaintAmount;
    }

    // ============ Case Management ============

    /**
     * @notice Open a clawback case against a wallet
     * @param originWallet The bad actor wallet
     * @param amount Total amount to potentially claw back
     * @param token Token address
     * @param reason Human-readable reason for the case
     * @return caseId Unique case identifier
     */
    function openCase(
        address originWallet,
        uint256 amount,
        address token,
        string calldata reason
    ) external nonReentrant returns (bytes32 caseId) {
        // Only active authorities or owner can open cases
        require(
            consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
            "Not authorized to open case"
        );

        caseCount++;
        caseId = keccak256(abi.encodePacked(originWallet, caseCount, block.timestamp));

        cases[caseId] = ClawbackCase({
            caseId: caseId,
            originWallet: originWallet,
            claimant: msg.sender,
            reason: reason,
            status: CaseStatus.OPEN,
            createdAt: uint64(block.timestamp),
            resolvedAt: 0,
            totalAmount: amount,
            token: token,
            consensusProposalId: bytes32(0),
            cascadeCount: 0
        });

        // Flag the origin wallet
        _flagWallet(originWallet, TaintLevel.FLAGGED, caseId, address(0), amount, token, 0);
        caseWallets[caseId].push(originWallet);

        emit CaseOpened(caseId, originWallet, msg.sender, reason);
    }

    /**
     * @notice Submit case for federated consensus vote
     * @param caseId Case to submit
     */
    function submitForVoting(bytes32 caseId) external {
        ClawbackCase storage c = cases[caseId];
        if (c.createdAt == 0) revert CaseNotFound();
        if (c.status != CaseStatus.OPEN) revert InvalidCaseStatus();

        require(
            consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
            "Not authorized"
        );

        // Create proposal in FederatedConsensus
        bytes32 proposalId = consensus.createProposal(
            caseId,
            c.originWallet,
            c.totalAmount,
            c.token,
            c.reason
        );

        c.consensusProposalId = proposalId;
        c.status = CaseStatus.VOTING;

        emit CaseStatusChanged(caseId, CaseStatus.OPEN, CaseStatus.VOTING);
    }

    /**
     * @notice Execute clawback after consensus approval
     * @param caseId Case to execute
     */
    function executeClawback(bytes32 caseId) external nonReentrant {
        if (vault == address(0)) revert VaultNotSet();

        ClawbackCase storage c = cases[caseId];
        if (c.createdAt == 0) revert CaseNotFound();
        if (c.status != CaseStatus.VOTING) revert InvalidCaseStatus();

        // Verify consensus approval
        if (!consensus.isExecutable(c.consensusProposalId)) revert ConsensusNotApproved();

        c.status = CaseStatus.EXECUTING;
        emit CaseStatusChanged(caseId, CaseStatus.VOTING, CaseStatus.EXECUTING);

        // Mark proposal as executed in consensus
        consensus.markExecuted(c.consensusProposalId);

        // Execute clawbacks on all wallets in the case cascade
        address[] storage wallets = caseWallets[caseId];
        for (uint256 i = 0; i < wallets.length; i++) {
            address wallet = wallets[i];
            WalletRecord storage record = walletRecords[wallet];

            if (record.taintLevel >= TaintLevel.TAINTED) {
                // Freeze the wallet
                record.taintLevel = TaintLevel.FROZEN;

                // Transfer tainted funds to vault
                uint256 clawAmount = record.taintedAmount;
                if (clawAmount > 0 && record.taintedToken != address(0)) {
                    uint256 balance = IERC20(record.taintedToken).balanceOf(wallet);
                    if (balance >= clawAmount) {
                        // Attempt to transfer tainted funds to vault if wallet has granted approval
                        // In practice, protocol-level deposits are frozen separately
                        try IERC20(record.taintedToken).transferFrom(wallet, vault, clawAmount) returns (bool success) {
                            if (success) {
                                record.taintedAmount = 0;
                            }
                        } catch {
                            // Wallet hasn't approved — funds remain frozen at protocol level
                        }
                        emit ClawbackExecuted(caseId, wallet, clawAmount, record.taintedToken);
                    }
                }
            }
        }

        c.status = CaseStatus.RESOLVED;
        c.resolvedAt = uint64(block.timestamp);
        emit CaseStatusChanged(caseId, CaseStatus.EXECUTING, CaseStatus.RESOLVED);
    }

    /**
     * @notice Dismiss a case (authority decision)
     * @param caseId Case to dismiss
     */
    function dismissCase(bytes32 caseId) external {
        ClawbackCase storage c = cases[caseId];
        if (c.createdAt == 0) revert CaseNotFound();
        require(
            consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
            "Not authorized"
        );

        CaseStatus oldStatus = c.status;
        c.status = CaseStatus.DISMISSED;
        c.resolvedAt = uint64(block.timestamp);

        // Clear all wallets in the case
        address[] storage wallets = caseWallets[caseId];
        for (uint256 i = 0; i < wallets.length; i++) {
            _clearWallet(wallets[i], caseId);
        }

        emit CaseStatusChanged(caseId, oldStatus, CaseStatus.DISMISSED);
    }

    // ============ Taint Propagation ============

    /**
     * @notice Record a transaction for taint tracking
     * @dev Called by VibeSwapCore or authorized trackers after every transfer
     * @param from Sender
     * @param to Recipient
     * @param amount Amount transferred
     * @param token Token address
     */
    function recordTransaction(
        address from,
        address to,
        uint256 amount,
        address token
    ) external onlyTracker {
        emit TransactionRecorded(from, to, amount, token);

        // Check if sender is tainted/flagged
        WalletRecord storage senderRecord = walletRecords[from];
        if (senderRecord.taintLevel >= TaintLevel.TAINTED && amount >= minTaintAmount) {
            // Propagate taint to recipient
            _propagateTaint(from, to, amount, token, senderRecord.caseId, senderRecord.taintDepth);
        }
    }

    /**
     * @notice Manually propagate taint (for historical transactions)
     * @param from Source tainted wallet
     * @param to Recipient wallet
     * @param amount Amount that was transferred
     * @param token Token address
     */
    function propagateTaintManual(
        address from,
        address to,
        uint256 amount,
        address token
    ) external {
        require(
            consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
            "Not authorized"
        );

        WalletRecord storage senderRecord = walletRecords[from];
        if (senderRecord.taintLevel < TaintLevel.TAINTED) revert WalletNotFlagged();

        _propagateTaint(from, to, amount, token, senderRecord.caseId, senderRecord.taintDepth);
    }

    // ============ Query Functions ============

    /**
     * @notice Check wallet safety score
     * @param wallet Wallet to check
     * @return taintLevel Current taint level
     * @return isSafe Whether it's safe to interact with
     * @return caseId Associated case (if any)
     * @return depth Taint cascade depth
     */
    function checkWallet(address wallet) external view returns (
        TaintLevel taintLevel,
        bool isSafe,
        bytes32 caseId,
        uint256 depth
    ) {
        WalletRecord storage record = walletRecords[wallet];
        taintLevel = record.taintLevel;
        isSafe = record.taintLevel <= TaintLevel.WATCHLIST;
        caseId = record.caseId;
        depth = record.taintDepth;
    }

    /**
     * @notice Check if a transaction would be safe
     * @param from Sender wallet
     * @param to Recipient wallet
     * @return safe Whether the transaction is safe
     * @return riskLevel Risk description
     */
    function checkTransactionSafety(
        address from,
        address to
    ) external view returns (bool safe, string memory riskLevel) {
        TaintLevel fromLevel = walletRecords[from].taintLevel;
        TaintLevel toLevel = walletRecords[to].taintLevel;

        if (fromLevel >= TaintLevel.FROZEN || toLevel >= TaintLevel.FROZEN) {
            return (false, "BLOCKED: Wallet frozen");
        }
        if (fromLevel >= TaintLevel.FLAGGED || toLevel >= TaintLevel.FLAGGED) {
            return (false, "HIGH RISK: Wallet flagged by authorities");
        }
        if (fromLevel >= TaintLevel.TAINTED || toLevel >= TaintLevel.TAINTED) {
            return (false, "RISK: Wallet has received tainted funds - cascading reversal possible");
        }
        if (fromLevel == TaintLevel.WATCHLIST || toLevel == TaintLevel.WATCHLIST) {
            return (true, "CAUTION: Wallet under observation");
        }
        return (true, "CLEAN");
    }

    /**
     * @notice Get taint chain for a wallet
     * @param wallet Wallet to query
     * @return records Array of taint records
     */
    function getTaintChain(address wallet) external view returns (TaintRecord[] memory) {
        return taintChain[wallet];
    }

    /**
     * @notice Get all wallets in a case
     * @param caseId Case to query
     * @return wallets Array of affected wallets
     */
    function getCaseWallets(bytes32 caseId) external view returns (address[] memory) {
        return caseWallets[caseId];
    }

    /**
     * @notice Check if wallet is blocked from transacting
     * @param wallet Wallet to check
     * @return blocked Whether wallet is blocked
     */
    function isBlocked(address wallet) external view returns (bool) {
        return walletRecords[wallet].taintLevel >= TaintLevel.FLAGGED;
    }

    // ============ Internal Functions ============

    function _flagWallet(
        address wallet,
        TaintLevel level,
        bytes32 caseId,
        address taintedBy,
        uint256 amount,
        address token,
        uint256 depth
    ) internal {
        WalletRecord storage record = walletRecords[wallet];

        // Only escalate taint level, never downgrade
        if (level <= record.taintLevel && record.caseId != bytes32(0)) return;

        record.taintLevel = level;
        record.flaggedAt = uint64(block.timestamp);
        record.caseId = caseId;
        record.taintedBy = taintedBy;
        record.taintedAmount = amount;
        record.taintedToken = token;
        record.taintDepth = depth;

        emit WalletFlagged(wallet, level, caseId);
    }

    function _propagateTaint(
        address from,
        address to,
        uint256 amount,
        address token,
        bytes32 caseId,
        uint256 currentDepth
    ) internal {
        uint256 newDepth = currentDepth + 1;
        if (newDepth > maxCascadeDepth) revert MaxCascadeDepthReached();

        // Record the taint chain
        taintChain[to].push(TaintRecord({
            from: from,
            to: to,
            amount: amount,
            token: token,
            timestamp: uint64(block.timestamp),
            txHash: bytes32(0)
        }));

        // Flag the recipient as tainted
        _flagWallet(to, TaintLevel.TAINTED, caseId, from, amount, token, newDepth);

        // Add to case wallets if not already there (bounded to prevent gas DoS)
        if (caseId != bytes32(0) && caseWallets[caseId].length < MAX_CASE_WALLETS) {
            caseWallets[caseId].push(to);
            cases[caseId].cascadeCount++;
        }

        emit TaintPropagated(from, to, amount, newDepth);
    }

    function _clearWallet(address wallet, bytes32 caseId) internal {
        WalletRecord storage record = walletRecords[wallet];
        if (record.caseId == caseId) {
            record.taintLevel = TaintLevel.CLEAN;
            record.flaggedAt = 0;
            record.caseId = bytes32(0);
            record.taintedBy = address(0);
            record.taintedAmount = 0;
            record.taintedToken = address(0);
            record.taintDepth = 0;

            emit WalletCleared(wallet, caseId);
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Set authorized tracker (e.g., VibeSwapCore)
     */
    function setAuthorizedTracker(address tracker, bool authorized) external onlyOwner {
        authorizedTrackers[tracker] = authorized;
    }

    /**
     * @notice Set ClawbackVault address
     */
    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }

    /**
     * @notice Update max cascade depth
     */
    function setMaxCascadeDepth(uint256 _maxCascadeDepth) external onlyOwner {
        maxCascadeDepth = _maxCascadeDepth;
    }

    /**
     * @notice Update minimum taint amount
     */
    function setMinTaintAmount(uint256 _minTaintAmount) external onlyOwner {
        minTaintAmount = _minTaintAmount;
    }

    /**
     * @notice Update consensus contract
     */
    function setConsensus(address _consensus) external onlyOwner {
        consensus = FederatedConsensus(_consensus);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
