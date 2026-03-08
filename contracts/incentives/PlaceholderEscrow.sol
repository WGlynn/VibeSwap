// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ============ Interfaces ============

interface IVIBEMint {
    function mint(address to, uint256 amount) external;
}

interface IPairwiseVerifier {
    function getTaskResult(bytes32 taskId) external view returns (address winner, bool settled);
}

/**
 * @title PlaceholderEscrow — VIBE Escrow for Contributors Without Wallets
 * @notice Holds earned VIBE for contributors who haven't linked a wallet yet.
 *         Rewards accrue to identity-anchored placeholder accounts and can be
 *         claimed once the contributor's wallet is verified via:
 *           1. CRPC consensus (PairwiseVerifier)
 *           2. Handshake verification (ContributionDAG vouch)
 *           3. Governance conviction vote (last resort)
 *
 * @dev Design:
 *   - Each contributor gets an identity hash: keccak256(platform, username)
 *   - Authorized recorders (EmissionController, ShapleyDistributor) accrue VIBE
 *   - VIBE stays in this contract until wallet is verified
 *   - Three claim paths with decreasing trust assumptions
 *   - Unclaimed VIBE never expires — it belongs to the contributor forever
 */
contract PlaceholderEscrow is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant GOVERNANCE_APPROVAL_THRESHOLD = 6600; // 66% supermajority

    // ============ State ============

    /// @notice VIBE token address
    address public vibeToken;

    /// @notice PairwiseVerifier for CRPC claims
    address public pairwiseVerifier;

    /// @notice Authorized recorders (EmissionController, ShapleyDistributor, etc.)
    mapping(address => bool) public recorders;

    /// @notice Placeholder accounts: identityHash → PlaceholderAccount
    mapping(bytes32 => PlaceholderAccount) public placeholders;

    /// @notice All identity hashes (for enumeration)
    bytes32[] public allIdentities;

    /// @notice Wallet → identityHash mapping (reverse lookup after claim)
    mapping(address => bytes32) public walletToIdentity;

    /// @notice CRPC task → identityHash mapping (for claim verification)
    mapping(bytes32 => bytes32) public crpcTaskToIdentity;

    /// @notice Governance proposals for disputed claims
    mapping(bytes32 => GovernanceProposal) public proposals;

    /// @notice Handshake verifiers — trusted addresses that can approve claims
    mapping(address => bool) public handshakeVerifiers;

    // ============ Structs ============

    struct PlaceholderAccount {
        bytes32 identityHash;
        string platform;        // "github", "telegram", "discord", "twitter"
        string username;        // Platform-specific username
        uint256 vibeAccrued;    // Total VIBE earned
        uint256 createdAt;
        uint256 lastAccrual;
        bool claimed;
        address claimedBy;      // Wallet that claimed this account
        uint256 claimedAt;
        uint256 accrualCount;   // Number of individual accruals
    }

    struct GovernanceProposal {
        bytes32 identityHash;
        address proposedWallet;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 proposedAt;
        uint256 deadline;
        bool executed;
        string evidence;        // IPFS hash or description of evidence
    }

    // ============ Events ============

    event PlaceholderCreated(bytes32 indexed identityHash, string platform, string username);
    event VibeAccrued(bytes32 indexed identityHash, uint256 amount, string reason);
    event ClaimedViaCRPC(bytes32 indexed identityHash, address indexed wallet, uint256 amount, bytes32 crpcTaskId);
    event ClaimedViaHandshake(bytes32 indexed identityHash, address indexed wallet, uint256 amount, address verifier);
    event ClaimedViaGovernance(bytes32 indexed identityHash, address indexed wallet, uint256 amount);
    event RecorderUpdated(address indexed recorder, bool authorized);
    event HandshakeVerifierUpdated(address indexed verifier, bool authorized);
    event GovernanceProposalCreated(bytes32 indexed identityHash, address proposedWallet, string evidence);

    // ============ Errors ============

    error Unauthorized();
    error AlreadyClaimed();
    error IdentityNotFound();
    error ZeroAmount();
    error InvalidWallet();
    error CRPCNotSettled();
    error CRPCWalletMismatch();
    error ProposalNotExpired();
    error ProposalAlreadyExecuted();
    error InsufficientVotes();
    error AlreadyExists();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _vibeToken,
        address _pairwiseVerifier
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = _vibeToken;
        pairwiseVerifier = _pairwiseVerifier;
    }

    // ============ Admin ============

    function setRecorder(address recorder, bool authorized) external onlyOwner {
        recorders[recorder] = authorized;
        emit RecorderUpdated(recorder, authorized);
    }

    function setHandshakeVerifier(address verifier, bool authorized) external onlyOwner {
        handshakeVerifiers[verifier] = authorized;
        emit HandshakeVerifierUpdated(verifier, authorized);
    }

    function setPairwiseVerifier(address _pairwiseVerifier) external onlyOwner {
        pairwiseVerifier = _pairwiseVerifier;
    }

    // ============ Identity Registration ============

    /**
     * @notice Create a placeholder account for a contributor
     * @param platform Platform identifier (e.g., "github", "telegram")
     * @param username Platform-specific username
     * @return identityHash The identity hash for this contributor
     */
    function createPlaceholder(
        string calldata platform,
        string calldata username
    ) external returns (bytes32 identityHash) {
        if (!recorders[msg.sender] && msg.sender != owner()) revert Unauthorized();

        identityHash = getIdentityHash(platform, username);

        // Don't revert if exists — just return the hash (idempotent)
        if (placeholders[identityHash].createdAt != 0) {
            return identityHash;
        }

        placeholders[identityHash] = PlaceholderAccount({
            identityHash: identityHash,
            platform: platform,
            username: username,
            vibeAccrued: 0,
            createdAt: block.timestamp,
            lastAccrual: 0,
            claimed: false,
            claimedBy: address(0),
            claimedAt: 0,
            accrualCount: 0
        });

        allIdentities.push(identityHash);
        emit PlaceholderCreated(identityHash, platform, username);
    }

    // ============ VIBE Accrual ============

    /**
     * @notice Record VIBE earned by a placeholder contributor
     * @dev Called by EmissionController, ShapleyDistributor, or other authorized recorders.
     *      VIBE is held in this contract until the contributor claims with a verified wallet.
     * @param identityHash The contributor's identity hash
     * @param amount Amount of VIBE accrued
     * @param reason Human-readable reason (e.g., "commit: fix AMM math", "session-042")
     */
    function accrueVibe(
        bytes32 identityHash,
        uint256 amount,
        string calldata reason
    ) external {
        if (!recorders[msg.sender] && msg.sender != owner()) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();

        PlaceholderAccount storage acct = placeholders[identityHash];
        if (acct.createdAt == 0) revert IdentityNotFound();
        if (acct.claimed) revert AlreadyClaimed();

        acct.vibeAccrued += amount;
        acct.lastAccrual = block.timestamp;
        acct.accrualCount++;

        emit VibeAccrued(identityHash, amount, reason);
    }

    // ============ Claim Path 1: CRPC Consensus ============

    /**
     * @notice Initiate a CRPC claim — link a wallet to an identity via PairwiseVerifier
     * @param identityHash The contributor's identity hash
     * @param crpcTaskId The PairwiseVerifier task ID that verified wallet ownership
     * @param wallet The wallet to receive VIBE
     */
    function claimViaCRPC(
        bytes32 identityHash,
        bytes32 crpcTaskId,
        address wallet
    ) external nonReentrant {
        if (wallet == address(0)) revert InvalidWallet();

        PlaceholderAccount storage acct = placeholders[identityHash];
        if (acct.createdAt == 0) revert IdentityNotFound();
        if (acct.claimed) revert AlreadyClaimed();

        // Verify CRPC consensus
        (address winner, bool settled) = IPairwiseVerifier(pairwiseVerifier).getTaskResult(crpcTaskId);
        if (!settled) revert CRPCNotSettled();
        if (winner != wallet) revert CRPCWalletMismatch();

        // Execute claim
        _executeClaim(acct, wallet);

        walletToIdentity[wallet] = identityHash;
        emit ClaimedViaCRPC(identityHash, wallet, acct.vibeAccrued, crpcTaskId);
    }

    // ============ Claim Path 2: Handshake Verification ============

    /**
     * @notice Claim via handshake — a trusted DAG member vouches for the wallet mapping
     * @param identityHash The contributor's identity hash
     * @param wallet The wallet to receive VIBE
     * @dev Only callable by authorized handshake verifiers (trusted DAG members)
     */
    function claimViaHandshake(
        bytes32 identityHash,
        address wallet
    ) external nonReentrant {
        if (!handshakeVerifiers[msg.sender]) revert Unauthorized();
        if (wallet == address(0)) revert InvalidWallet();

        PlaceholderAccount storage acct = placeholders[identityHash];
        if (acct.createdAt == 0) revert IdentityNotFound();
        if (acct.claimed) revert AlreadyClaimed();

        _executeClaim(acct, wallet);

        walletToIdentity[wallet] = identityHash;
        emit ClaimedViaHandshake(identityHash, wallet, acct.vibeAccrued, msg.sender);
    }

    // ============ Claim Path 3: Governance Vote (Last Resort) ============

    /**
     * @notice Propose a wallet mapping via governance (when CRPC and handshake fail)
     * @param identityHash The contributor's identity hash
     * @param wallet The proposed wallet
     * @param evidence IPFS hash or description of evidence
     */
    function proposeGovernanceClaim(
        bytes32 identityHash,
        address wallet,
        string calldata evidence
    ) external {
        if (wallet == address(0)) revert InvalidWallet();

        PlaceholderAccount storage acct = placeholders[identityHash];
        if (acct.createdAt == 0) revert IdentityNotFound();
        if (acct.claimed) revert AlreadyClaimed();

        bytes32 proposalId = keccak256(abi.encodePacked(identityHash, wallet, block.timestamp));

        proposals[proposalId] = GovernanceProposal({
            identityHash: identityHash,
            proposedWallet: wallet,
            votesFor: 0,
            votesAgainst: 0,
            proposedAt: block.timestamp,
            deadline: block.timestamp + 7 days,
            executed: false,
            evidence: evidence
        });

        emit GovernanceProposalCreated(identityHash, wallet, evidence);
    }

    /**
     * @notice Vote on a governance claim proposal
     * @param proposalId The proposal to vote on
     * @param support True = for, false = against
     * @param weight Voter's conviction weight (VIBE balance or trust score)
     */
    function voteOnProposal(
        bytes32 proposalId,
        bool support,
        uint256 weight
    ) external {
        // In production, weight would be derived from VIBE balance or trust score
        // For now, only authorized voters (owner or handshake verifiers)
        if (!handshakeVerifiers[msg.sender] && msg.sender != owner()) revert Unauthorized();

        GovernanceProposal storage prop = proposals[proposalId];
        if (prop.proposedAt == 0) revert IdentityNotFound();
        if (prop.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp > prop.deadline) revert ProposalNotExpired();

        if (support) {
            prop.votesFor += weight;
        } else {
            prop.votesAgainst += weight;
        }
    }

    /**
     * @notice Execute a governance proposal after voting period
     * @param proposalId The proposal to execute
     */
    function executeProposal(bytes32 proposalId) external nonReentrant {
        GovernanceProposal storage prop = proposals[proposalId];
        if (prop.proposedAt == 0) revert IdentityNotFound();
        if (prop.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp < prop.deadline) revert ProposalNotExpired();

        uint256 totalVotes = prop.votesFor + prop.votesAgainst;
        if (totalVotes == 0) revert InsufficientVotes();

        uint256 approvalRate = (prop.votesFor * 10000) / totalVotes;
        if (approvalRate < GOVERNANCE_APPROVAL_THRESHOLD) revert InsufficientVotes();

        PlaceholderAccount storage acct = placeholders[prop.identityHash];
        if (acct.claimed) revert AlreadyClaimed();

        prop.executed = true;
        _executeClaim(acct, prop.proposedWallet);

        walletToIdentity[prop.proposedWallet] = prop.identityHash;
        emit ClaimedViaGovernance(prop.identityHash, prop.proposedWallet, acct.vibeAccrued);
    }

    // ============ Internal ============

    function _executeClaim(PlaceholderAccount storage acct, address wallet) internal {
        uint256 amount = acct.vibeAccrued;
        acct.claimed = true;
        acct.claimedBy = wallet;
        acct.claimedAt = block.timestamp;

        // Transfer VIBE from this contract to the verified wallet
        if (amount > 0) {
            IERC20(vibeToken).safeTransfer(wallet, amount);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Compute identity hash for a platform + username pair
     */
    function getIdentityHash(
        string memory platform,
        string memory username
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(platform, ":", username));
    }

    /**
     * @notice Get placeholder account details
     */
    function getPlaceholder(bytes32 identityHash)
        external
        view
        returns (
            string memory platform,
            string memory username,
            uint256 vibeAccrued,
            bool claimed,
            address claimedBy,
            uint256 accrualCount
        )
    {
        PlaceholderAccount storage acct = placeholders[identityHash];
        return (
            acct.platform,
            acct.username,
            acct.vibeAccrued,
            acct.claimed,
            acct.claimedBy,
            acct.accrualCount
        );
    }

    /**
     * @notice Total unclaimed VIBE across all placeholders
     */
    function totalUnclaimed() external view returns (uint256 total) {
        for (uint256 i = 0; i < allIdentities.length; i++) {
            PlaceholderAccount storage acct = placeholders[allIdentities[i]];
            if (!acct.claimed) {
                total += acct.vibeAccrued;
            }
        }
    }

    /**
     * @notice Number of placeholder accounts
     */
    function placeholderCount() external view returns (uint256) {
        return allIdentities.length;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
