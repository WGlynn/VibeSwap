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

    // ============ C47: Bonded Permissionless Contest (Gap 5) ============
    //
    // ETM_ALIGNMENT_AUDIT.md Section 5.2 / Section 7 Gap 5 (MED leverage):
    //
    //   Adds a permissionless on-chain contest path alongside the existing
    //   FederatedConsensus authority-vote path. ANY party can post a bond and
    //   contest a clawback case before `executeClawback` may fire. The contest
    //   converts strict-on-chain-liability-with-only-off-chain-recourse into
    //   math-enforced rent-on-disputes-pays-discovery, mirroring OCR V2a
    //   (`OperatorCellRegistry.sol`) permissionless-challenge geometry.
    //
    // Adjudication: FederatedConsensus authorities REMAIN the dispute-resolution
    // oracle (right authority for regulatory adjudication; see audit Section 5.2
    // partial-mirror caveat). What changes:
    //   - Authority must engage with the contest on a math-enforced timeline.
    //   - During the active contest window, `executeClawback` is GATED and
    //     reverts with `ContestActive`.
    //   - Authority calls `upholdContest` (contest wins, case DISMISSED, bond +
    //     reward returned to contestant) or `dismissContest` (contest loses,
    //     bond forfeited to `contestRewardPool`, clawback may proceed).
    //   - If neither happens before window expiry, anyone may call
    //     `resolveExpiredContest` which forfeits the bond (default favors the
    //     standing case — contest must be proven, not assumed).
    //
    // Compensatory augmentation (mirrors OCR V2a §6.5):
    //   - On uphold: contestant receives bond + reward (paid from
    //     `contestRewardPool`, capped at MIN(reward, pool balance)).
    //   - On dismiss/expiry: bond credited to `contestRewardPool` to fund
    //     future successful contestants. Self-bootstrapping bug-bounty channel.

    enum ContestStatus {
        NONE,        // 0 - no contest
        ACTIVE,      // 1 - bond posted, window open
        UPHELD,      // 2 - contest succeeded, case dismissed
        DISMISSED,   // 3 - contest failed, bond forfeited
        EXPIRED      // 4 - window passed without resolution; bond forfeited
    }

    struct CaseContest {
        address contestant;
        uint256 bond;
        address bondToken;
        uint64  openedAt;
        uint64  deadline;
        ContestStatus status;
        string  evidenceURI;  // off-chain pointer (IPFS / etc) to evidence package
    }

    /// @notice Active / historical contest record per caseId. Only one contest
    ///         per caseId at a time; a dismissed/expired contest does NOT
    ///         re-open the slot — the case proceeds on the standing path.
    mapping(bytes32 => CaseContest) public caseContests;

    /// @notice Token used for contest bonds (governance-set). MAY be the same
    ///         as the case token, but governance can set a stable bond token
    ///         (e.g. CKB, JUL) so contestants don't need to acquire arbitrary
    ///         case-token denominations.
    address public contestBondToken;

    /// @notice Required contest bond amount (governance-set, floored).
    uint256 public contestBondAmount;

    /// @notice Minimum allowed contest bond. Mirrors OCR's MIN_BOND_PER_CELL
    ///         floor — prevents governance from disabling the bonded contest
    ///         primitive by setting bond to zero.
    uint256 public constant MIN_CONTEST_BOND = 0.1 ether;

    /// @notice Contest window length (governance-set, bounded).
    uint64 public contestWindow;

    /// @notice Floor on contestWindow.
    uint64 public constant MIN_CONTEST_WINDOW = 1 hours;

    /// @notice Ceiling on contestWindow.
    uint64 public constant MAX_CONTEST_WINDOW = 7 days;

    /// @notice Reward paid to a successful contestant on top of bond return.
    ///         Drawn from contestRewardPool; capped at pool balance at uphold
    ///         time (no underflow).
    uint256 public contestSuccessReward;

    /// @notice Pool of forfeited bonds + governance-seeded funds, used to pay
    ///         success rewards. Pull-based via internal accounting; tokens sit
    ///         in this contract until claimed. Mirrors OCR `slashPool`.
    uint256 public contestRewardPool;

    /// @notice C47 reinitializer version sentinel. Allows post-upgrade
    ///         initialization of contest parameters (initializeContestV1).
    bool public contestParamsInitialized;

    /// @dev Reserved storage gap for future upgrades.
    ///      C47 shrank 50 → 41:
    ///        +caseContests (1)
    ///        +contestBondToken (1) + contestBondAmount (1)
    ///        +contestWindow (1) + contestSuccessReward (1)
    ///        +contestRewardPool (1) + contestParamsInitialized (1)
    ///        Total consumed: 8 slots. (mappings count as 1 slot; the
    ///        constants are inlined and consume no slots. uint64
    ///        contestWindow is not packable with adjacent uint256 state,
    ///        so it occupies a full slot.)
    ///      Math-correct gap = 50 − 8 = 42. The declared __gap is 41,
    ///      one slot below the canonical-50 convention. This is a
    ///      conservative leftover from the prior 9-slot doc-count; left
    ///      at 41 here as a doc-only fix (zero functional / security
    ///      impact). Recovering the slot to 42 is deferred to the next
    ///      upgrade cycle to avoid touching storage layout in this pass.
    ///      Audit reference: docs/audits/2026-05-01-storage-layout-followup.md (C47-F1, LOW).
    uint256[41] private __gap;

    // ============ Events ============

    event WalletFlagged(address indexed wallet, TaintLevel level, bytes32 indexed caseId);
    event TaintPropagated(address indexed from, address indexed to, uint256 amount, uint256 depth);
    event CaseOpened(bytes32 indexed caseId, address indexed originWallet, address indexed claimant, string reason);
    event CaseStatusChanged(bytes32 indexed caseId, CaseStatus oldStatus, CaseStatus newStatus);
    event ClawbackExecuted(bytes32 indexed caseId, address indexed wallet, uint256 amount, address token);
    event WalletCleared(address indexed wallet, bytes32 indexed caseId);
    event TransactionRecorded(address indexed from, address indexed to, uint256 amount, address token);
    event AuthorizedTrackerUpdated(address indexed tracker, bool previous, bool current);
    event VaultUpdated(address indexed previous, address indexed current);
    event MaxCascadeDepthUpdated(uint256 previous, uint256 current);
    event MinTaintAmountUpdated(uint256 previous, uint256 current);
    event ConsensusUpdated(address indexed previous, address indexed current);

    // C47 (bonded permissionless contest, Gap 5)
    event ContestParamsInitialized(address bondToken, uint256 bondAmount, uint64 window, uint256 successReward);
    event ContestBondTokenUpdated(address indexed previous, address indexed current);
    event ContestBondAmountUpdated(uint256 previous, uint256 current);
    event ContestWindowUpdated(uint64 previous, uint64 current);
    event ContestSuccessRewardUpdated(uint256 previous, uint256 current);
    event ContestRewardPoolFunded(address indexed funder, uint256 amount, uint256 newPoolBalance);
    event ContestOpened(bytes32 indexed caseId, address indexed contestant, uint256 bond, uint64 deadline, string evidenceURI);
    event ContestUpheld(bytes32 indexed caseId, address indexed contestant, uint256 bondReturned, uint256 reward);
    event ContestDismissed(bytes32 indexed caseId, address indexed contestant, uint256 bondForfeited);
    event ContestExpired(bytes32 indexed caseId, address indexed contestant, uint256 bondForfeited);

    // ============ Errors ============

    error WalletNotFlagged();
    error CaseNotFound();
    error InvalidCaseStatus();
    error MaxCascadeDepthReached();
    error NotAuthorizedTracker();
    error ConsensusNotApproved();
    error WalletAlreadyFlagged();
    error VaultNotSet();

    // C47 (bonded permissionless contest)
    error ContestParamsNotInitialized();
    error ContestAlreadyInitialized();
    error ContestActive();
    error NoActiveContest();
    error ContestNotExpired();
    error ContestExpiredError();
    error ContestBondTokenNotSet();
    error InsufficientContestBond();
    error BondBelowMin();
    error WindowOutOfRange();
    error InvalidContestStatus();
    error InvalidEvidenceURI();

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

        // C47: bonded contest gate. If a contest is ACTIVE, clawback must wait
        //      for authority resolution (uphold/dismiss) or window expiry.
        //      UPHELD contests transition the case to DISMISSED via _upholdContest;
        //      DISMISSED/EXPIRED contests permit execution to proceed.
        CaseContest storage ct = caseContests[caseId];
        if (ct.status == ContestStatus.ACTIVE) revert ContestActive();

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

    // ============ C47: Bonded Permissionless Contest (Gap 5) ============
    //
    // Lives alongside (not replacing) the FederatedConsensus authority-vote path.
    // See storage block above for full design rationale + mirror to OCR V2a.

    /**
     * @notice Post-upgrade initializer for the C47 contest parameters.
     * @dev   reinitializer(2) — runs exactly once per proxy. MUST be packaged
     *        into `upgradeToAndCall(newImpl, abi.encodeCall(initializeContestV1, (...)))`
     *        so the contest path is wired atomically with the upgrade. Calling
     *        upgradeTo alone leaves contest params zeroed and contest entry
     *        functions revert with `ContestParamsNotInitialized` — fail-closed
     *        posture (security is no weaker than pre-upgrade, just unavailable
     *        until migration runs). Mirrors SoulboundIdentity.initializeV2 pattern.
     *
     * @param _bondToken       ERC20 used for contest bonds (governance choice).
     * @param _bondAmount      Required bond per contest (>= MIN_CONTEST_BOND).
     * @param _window          Contest window length in seconds; bounded by
     *                         MIN_CONTEST_WINDOW / MAX_CONTEST_WINDOW.
     * @param _successReward   Reward paid to a successful contestant on top of
     *                         bond return. Capped at pool balance at uphold time.
     */
    function initializeContestV1(
        address _bondToken,
        uint256 _bondAmount,
        uint64  _window,
        uint256 _successReward
    ) external reinitializer(2) onlyOwner {
        if (contestParamsInitialized) revert ContestAlreadyInitialized();
        if (_bondToken == address(0)) revert ContestBondTokenNotSet();
        if (_bondAmount < MIN_CONTEST_BOND) revert BondBelowMin();
        if (_window < MIN_CONTEST_WINDOW || _window > MAX_CONTEST_WINDOW) revert WindowOutOfRange();

        contestBondToken = _bondToken;
        contestBondAmount = _bondAmount;
        contestWindow = _window;
        contestSuccessReward = _successReward;
        contestParamsInitialized = true;

        emit ContestParamsInitialized(_bondToken, _bondAmount, _window, _successReward);
    }

    /**
     * @notice Permissionlessly contest an in-flight clawback case by posting a bond.
     * @dev   Anyone may call (typically a tainted-by-association holder, but the
     *        primitive is permissionless — third-party bond posting is allowed).
     *        Requires:
     *          - Contest params initialized (initializeContestV1 has run).
     *          - Case exists and is in OPEN or VOTING (not RESOLVED / DISMISSED / EXECUTING).
     *          - No active contest already on this caseId.
     *          - Bond amount transferred via safeTransferFrom (ERC20 approve required).
     *
     *        After this call, `executeClawback(caseId)` reverts with `ContestActive`
     *        until authority resolves the contest (uphold/dismiss) or the window
     *        expires.
     *
     * @param caseId        Case under contest.
     * @param evidenceURI   Off-chain evidence pointer (IPFS / arweave / etc).
     */
    function openContest(
        bytes32 caseId,
        string calldata evidenceURI
    ) external nonReentrant {
        if (!contestParamsInitialized) revert ContestParamsNotInitialized();
        if (bytes(evidenceURI).length == 0) revert InvalidEvidenceURI();

        ClawbackCase storage c = cases[caseId];
        if (c.createdAt == 0) revert CaseNotFound();

        // Must be in a contestable state — case still un-executed and un-dismissed.
        if (c.status != CaseStatus.OPEN && c.status != CaseStatus.VOTING) {
            revert InvalidCaseStatus();
        }

        CaseContest storage ct = caseContests[caseId];
        if (ct.status == ContestStatus.ACTIVE) revert ContestActive();

        uint256 bond = contestBondAmount;
        IERC20(contestBondToken).safeTransferFrom(msg.sender, address(this), bond);

        ct.contestant   = msg.sender;
        ct.bond         = bond;
        ct.bondToken    = contestBondToken;  // snapshot at open time
        ct.openedAt     = uint64(block.timestamp);
        ct.deadline     = uint64(block.timestamp) + contestWindow;
        ct.status       = ContestStatus.ACTIVE;
        ct.evidenceURI  = evidenceURI;

        emit ContestOpened(caseId, msg.sender, bond, ct.deadline, evidenceURI);
    }

    /**
     * @notice Authority upholds the contest — case is dismissed, bond returned
     *         to contestant + reward paid from contestRewardPool.
     * @dev   Authorization mirrors `dismissCase`: active FederatedConsensus
     *        authority OR contract owner (governance over-ride). Bond return
     *        + reward use the snapshot bondToken from openContest, not the
     *        current contestBondToken (governance may have rotated it mid-flight).
     *
     *        Side effects:
     *          - All wallets in the case are cleared (existing dismiss flow).
     *          - Case status → DISMISSED.
     *          - Contest status → UPHELD.
     */
    function upholdContest(bytes32 caseId) external nonReentrant {
        require(
            consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
            "Not authorized"
        );

        CaseContest storage ct = caseContests[caseId];
        if (ct.status != ContestStatus.ACTIVE) revert NoActiveContest();
        if (block.timestamp > ct.deadline) revert ContestExpiredError();

        ClawbackCase storage c = cases[caseId];
        if (c.createdAt == 0) revert CaseNotFound();

        address contestant_ = ct.contestant;
        uint256 bond = ct.bond;
        address bondToken_ = ct.bondToken;

        // Cap reward at current pool balance — never underflow.
        uint256 reward = contestSuccessReward;
        if (reward > contestRewardPool) {
            reward = contestRewardPool;
        }
        if (reward > 0) {
            contestRewardPool -= reward;
        }

        // Mark contest UPHELD before external transfers (CEI).
        ct.status = ContestStatus.UPHELD;

        // Dismiss the case — clears all wallets, transitions case status.
        CaseStatus oldStatus = c.status;
        c.status = CaseStatus.DISMISSED;
        c.resolvedAt = uint64(block.timestamp);

        address[] storage wallets = caseWallets[caseId];
        for (uint256 i = 0; i < wallets.length; i++) {
            _clearWallet(wallets[i], caseId);
        }

        emit CaseStatusChanged(caseId, oldStatus, CaseStatus.DISMISSED);

        // Pay contestant: bond + reward (single transfer to minimize external calls).
        // Reward uses the same token as the bond — natural, since the pool is
        // funded in contestBondToken which equals bondToken at uphold time
        // unless governance rotated. If they differ, reward is paid in the
        // current bondToken (the pool token) and bond returned in the snapshot
        // token — two separate transfers in that edge case.
        if (bondToken_ == contestBondToken) {
            // Common path: single transfer.
            IERC20(bondToken_).safeTransfer(contestant_, bond + reward);
        } else {
            // Edge: governance rotated bondToken between open and uphold.
            // Return original bond in snapshot token; pay reward in current pool token.
            IERC20(bondToken_).safeTransfer(contestant_, bond);
            if (reward > 0) {
                IERC20(contestBondToken).safeTransfer(contestant_, reward);
            }
        }

        emit ContestUpheld(caseId, contestant_, bond, reward);
    }

    /**
     * @notice Authority dismisses the contest — bond forfeited to reward pool,
     *         standing case path resumes (executeClawback may proceed once
     *         consensus is approved).
     * @dev   Authorization mirrors upholdContest. Forfeited bond is credited
     *        to contestRewardPool to bootstrap rewards for future successful
     *        contestants (self-funding bug-bounty channel).
     */
    function dismissContest(bytes32 caseId) external nonReentrant {
        require(
            consensus.isActiveAuthority(msg.sender) || msg.sender == owner(),
            "Not authorized"
        );

        CaseContest storage ct = caseContests[caseId];
        if (ct.status != ContestStatus.ACTIVE) revert NoActiveContest();
        if (block.timestamp > ct.deadline) revert ContestExpiredError();

        address contestant_ = ct.contestant;
        uint256 bond = ct.bond;
        address bondToken_ = ct.bondToken;

        ct.status = ContestStatus.DISMISSED;

        // Bond forfeit credited to pool ONLY if it's in the current pool token.
        // (Governance pool-token rotation case: forfeited bond in stale token
        // is held in-contract but not credited to the active pool, since the
        // pool can only pay out one token. Stale bonds can be swept via
        // sweepStaleContestBond if/when introduced. For now: simple credit
        // when token matches, hold otherwise.)
        if (bondToken_ == contestBondToken) {
            contestRewardPool += bond;
        }

        emit ContestDismissed(caseId, contestant_, bond);
    }

    /**
     * @notice Permissionless resolution of an expired contest. Anyone may call
     *         after the contest window passes without authority resolution.
     * @dev   Default outcome favors the standing case path: bond is forfeited
     *        to the pool, contest transitions to EXPIRED, and the standing
     *        executeClawback path is unblocked. Rationale: an active contest
     *        is a claim that must be substantiated — silence does not
     *        substantiate. Mirrors OCR V2a's `claimAssignmentSlash` (default-
     *        on-expiry favors the slash, not the operator).
     *
     *        Defensive: this is permissionless precisely so the case cannot
     *        be deadlocked by an authority who refuses to engage.
     */
    function resolveExpiredContest(bytes32 caseId) external nonReentrant {
        CaseContest storage ct = caseContests[caseId];
        if (ct.status != ContestStatus.ACTIVE) revert NoActiveContest();
        if (block.timestamp <= ct.deadline) revert ContestNotExpired();

        address contestant_ = ct.contestant;
        uint256 bond = ct.bond;
        address bondToken_ = ct.bondToken;

        ct.status = ContestStatus.EXPIRED;

        if (bondToken_ == contestBondToken) {
            contestRewardPool += bond;
        }

        emit ContestExpired(caseId, contestant_, bond);
    }

    /**
     * @notice Fund the contest reward pool. Anyone may call (governance,
     *         insurance pool, treasury, donors). Tokens pulled from caller.
     * @dev   Bootstrap path for the reward pool before any forfeitures
     *        accumulate. Pool is only funded in the current contestBondToken;
     *        a governance change to bondToken should be paired with a fresh
     *        funding call in the new token.
     */
    function fundContestRewardPool(uint256 amount) external nonReentrant {
        if (!contestParamsInitialized) revert ContestParamsNotInitialized();
        IERC20(contestBondToken).safeTransferFrom(msg.sender, address(this), amount);
        contestRewardPool += amount;
        emit ContestRewardPoolFunded(msg.sender, amount, contestRewardPool);
    }

    /**
     * @notice Read the active/historical contest record for a case.
     */
    function getCaseContest(bytes32 caseId) external view returns (CaseContest memory) {
        return caseContests[caseId];
    }

    /**
     * @notice True iff a contest is currently ACTIVE on this case (blocks executeClawback).
     */
    function hasActiveContest(bytes32 caseId) external view returns (bool) {
        return caseContests[caseId].status == ContestStatus.ACTIVE;
    }

    // ============ C47: Contest Admin (governance-tunable parameters) ============

    function setContestBondToken(address _bondToken) external onlyOwner {
        if (_bondToken == address(0)) revert ContestBondTokenNotSet();
        address prev = contestBondToken;
        contestBondToken = _bondToken;
        emit ContestBondTokenUpdated(prev, _bondToken);
    }

    function setContestBondAmount(uint256 _bondAmount) external onlyOwner {
        if (_bondAmount < MIN_CONTEST_BOND) revert BondBelowMin();
        uint256 prev = contestBondAmount;
        contestBondAmount = _bondAmount;
        emit ContestBondAmountUpdated(prev, _bondAmount);
    }

    function setContestWindow(uint64 _window) external onlyOwner {
        if (_window < MIN_CONTEST_WINDOW || _window > MAX_CONTEST_WINDOW) revert WindowOutOfRange();
        uint64 prev = contestWindow;
        contestWindow = _window;
        emit ContestWindowUpdated(prev, _window);
    }

    function setContestSuccessReward(uint256 _reward) external onlyOwner {
        uint256 prev = contestSuccessReward;
        contestSuccessReward = _reward;
        emit ContestSuccessRewardUpdated(prev, _reward);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set authorized tracker (e.g., VibeSwapCore)
     */
    function setAuthorizedTracker(address tracker, bool authorized) external onlyOwner {
        bool prev = authorizedTrackers[tracker];
        authorizedTrackers[tracker] = authorized;
        emit AuthorizedTrackerUpdated(tracker, prev, authorized);
    }

    /**
     * @notice Set ClawbackVault address
     */
    function setVault(address _vault) external onlyOwner {
        address prev = vault;
        vault = _vault;
        emit VaultUpdated(prev, _vault);
    }

    /**
     * @notice Update max cascade depth
     */
    function setMaxCascadeDepth(uint256 _maxCascadeDepth) external onlyOwner {
        uint256 prev = maxCascadeDepth;
        maxCascadeDepth = _maxCascadeDepth;
        emit MaxCascadeDepthUpdated(prev, _maxCascadeDepth);
    }

    /**
     * @notice Update minimum taint amount
     */
    function setMinTaintAmount(uint256 _minTaintAmount) external onlyOwner {
        uint256 prev = minTaintAmount;
        minTaintAmount = _minTaintAmount;
        emit MinTaintAmountUpdated(prev, _minTaintAmount);
    }

    /**
     * @notice Update consensus contract
     */
    function setConsensus(address _consensus) external onlyOwner {
        address prev = address(consensus);
        consensus = FederatedConsensus(_consensus);
        emit ConsensusUpdated(prev, _consensus);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
