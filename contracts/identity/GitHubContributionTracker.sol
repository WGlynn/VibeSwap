// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "../libraries/IncrementalMerkleTree.sol";
import "./interfaces/IGitHubContributionTracker.sol";
import "./interfaces/IContributionDAG.sol";
import "./interfaces/IRewardLedger.sol";

/**
 * @title GitHubContributionTracker
 * @notice Ingests GitHub contributions via authorized relayers, stores them in a
 *         Merkle-compressed tree, and records value events on RewardLedger.
 *
 * Flow:
 *   GitHub Webhook → Relayer → EIP-712 sign → recordContribution() →
 *     1. Verify signature from authorized relayer
 *     2. Replay protection via processedEvents
 *     3. Insert leaf into IncrementalMerkleTree
 *     4. Record value event on RewardLedger with trust chain from ContributionDAG
 *     5. Emit ContributionRecorded (for IPFS archival + off-chain indexer)
 *
 * @dev Non-upgradeable. Ownable(msg.sender) + ReentrancyGuard.
 */
contract GitHubContributionTracker is
    IGitHubContributionTracker,
    Ownable,
    ReentrancyGuard,
    EIP712
{
    using IncrementalMerkleTree for IncrementalMerkleTree.Tree;

    // ============ Constants ============

    uint256 public constant TREE_DEPTH = 20; // 2^20 = ~1M contributions

    bytes32 public constant CONTRIBUTION_TYPEHASH = keccak256(
        "GitHubContribution(address contributor,bytes32 repoHash,bytes32 commitHash,uint8 contribType,uint256 value,uint256 timestamp,bytes32 evidenceHash)"
    );

    // ============ State ============

    /// @notice Merkle tree of all contributions
    IncrementalMerkleTree.Tree private _contributionTree;

    /// @notice Replay protection: eventHash → processed
    mapping(bytes32 => bool) public processedEvents;

    /// @notice Address → hash(github_username) binding
    mapping(address => bytes32) public githubAccountHash;

    /// @notice Authorized webhook relayers
    mapping(address => bool) public authorizedRelayers;

    /// @notice Default reward values per contribution type
    mapping(ContributionType => uint256) public rewardValues;

    /// @notice Per-contributor stats
    mapping(address => ContributorStats) private _contributorStats;

    /// @notice ContributionDAG for trust chain lookups
    IContributionDAG public contributionDAG;

    /// @notice RewardLedger for value event recording
    IRewardLedger public rewardLedger;

    // ============ Constructor ============

    constructor(
        address _contributionDAG,
        address _rewardLedger
    ) Ownable(msg.sender) EIP712("GitHubContributionTracker", "1") {
        if (_contributionDAG == address(0) || _rewardLedger == address(0)) {
            revert ZeroAddress();
        }

        contributionDAG = IContributionDAG(_contributionDAG);
        rewardLedger = IRewardLedger(_rewardLedger);

        // Initialize Merkle tree
        _contributionTree.init(TREE_DEPTH);

        // Default reward values (can be updated by owner)
        rewardValues[ContributionType.COMMIT] = 100;
        rewardValues[ContributionType.PR_MERGED] = 500;
        rewardValues[ContributionType.REVIEW] = 200;
        rewardValues[ContributionType.ISSUE_CLOSED] = 300;
    }

    // ============ Admin Functions ============

    /// @notice Whitelist or remove a webhook relayer
    function setAuthorizedRelayer(address relayer, bool authorized) external onlyOwner {
        if (relayer == address(0)) revert ZeroAddress();
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    /// @notice Bind an on-chain address to a GitHub identity
    function bindGitHubAccount(address contributor, bytes32 githubHash) external onlyOwner {
        if (contributor == address(0)) revert ZeroAddress();
        if (githubAccountHash[contributor] != bytes32(0)) revert AlreadyBound();

        githubAccountHash[contributor] = githubHash;
        emit GitHubAccountBound(contributor, githubHash);
    }

    /// @notice Unbind a GitHub account (for re-binding)
    function unbindGitHubAccount(address contributor) external onlyOwner {
        if (contributor == address(0)) revert ZeroAddress();
        delete githubAccountHash[contributor];
        emit GitHubAccountUnbound(contributor);
    }

    /// @notice Set reward value for a contribution type
    function setRewardValue(ContributionType contribType, uint256 value) external onlyOwner {
        rewardValues[contribType] = value;
        emit RewardValueUpdated(contribType, value);
    }

    /// @notice Update ContributionDAG address
    function setContributionDAG(address _dag) external onlyOwner {
        if (_dag == address(0)) revert ZeroAddress();
        contributionDAG = IContributionDAG(_dag);
    }

    /// @notice Update RewardLedger address
    function setRewardLedger(address _ledger) external onlyOwner {
        if (_ledger == address(0)) revert ZeroAddress();
        rewardLedger = IRewardLedger(_ledger);
    }

    // ============ Ingestion Functions ============

    /// @inheritdoc IGitHubContributionTracker
    function recordContribution(
        GitHubContribution calldata contribution,
        bytes calldata signature
    ) external nonReentrant {
        _recordSingle(contribution, signature);
    }

    /// @inheritdoc IGitHubContributionTracker
    function recordContributionBatch(
        GitHubContribution[] calldata contributions,
        bytes[] calldata signatures
    ) external nonReentrant {
        uint256 len = contributions.length;
        require(len == signatures.length, "Length mismatch");

        for (uint256 i = 0; i < len; i++) {
            _recordSingle(contributions[i], signatures[i]);
        }
    }

    // ============ Verification Functions ============

    /// @inheritdoc IGitHubContributionTracker
    function verifyContribution(
        bytes32[] calldata proof,
        GitHubContribution calldata contribution
    ) external view returns (bool) {
        bytes32 leaf = _computeLeafHash(contribution);
        // Try current root first, then check history
        return _contributionTree.verify(proof, leaf)
            || _verifyAgainstHistory(proof, leaf);
    }

    /// @inheritdoc IGitHubContributionTracker
    function getContributionRoot() external view returns (bytes32) {
        return _contributionTree.getRoot();
    }

    /// @inheritdoc IGitHubContributionTracker
    function isKnownRoot(bytes32 root) external view returns (bool) {
        return _contributionTree.isKnownRoot(root);
    }

    // ============ View Functions ============

    /// @inheritdoc IGitHubContributionTracker
    function getContributionCount() external view returns (uint256) {
        return _contributionTree.getNextIndex();
    }

    /// @inheritdoc IGitHubContributionTracker
    function getContributorStats(address contributor) external view returns (
        uint256 totalContributions,
        uint256 totalValue
    ) {
        ContributorStats storage stats = _contributorStats[contributor];
        return (stats.totalContributions, stats.totalValue);
    }

    /// @notice Get the EIP-712 domain separator
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============ Internal ============

    function _recordSingle(
        GitHubContribution calldata contribution,
        bytes calldata signature
    ) internal {
        // 1. Verify EIP-712 signature from authorized relayer
        bytes32 structHash = keccak256(abi.encode(
            CONTRIBUTION_TYPEHASH,
            contribution.contributor,
            contribution.repoHash,
            contribution.commitHash,
            uint8(contribution.contribType),
            contribution.value,
            contribution.timestamp,
            contribution.evidenceHash
        ));

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (!authorizedRelayers[signer]) revert UnauthorizedRelayer();

        // 2. Replay protection
        bytes32 eventHash = keccak256(abi.encodePacked(
            contribution.contributor,
            contribution.repoHash,
            contribution.commitHash,
            contribution.contribType,
            contribution.timestamp
        ));
        if (processedEvents[eventHash]) revert DuplicateEvent();
        processedEvents[eventHash] = true;

        // 3. Verify contributor has bound GitHub account
        if (githubAccountHash[contribution.contributor] == bytes32(0)) {
            revert UnboundGitHubAccount();
        }

        // 4. Compute leaf and insert into Merkle tree
        bytes32 leaf = _computeLeafHash(contribution);
        uint256 leafIndex = _contributionTree.insert(leaf);

        // 5. Update contributor stats
        uint256 value = contribution.value > 0
            ? contribution.value
            : rewardValues[contribution.contribType];

        _contributorStats[contribution.contributor].totalContributions++;
        _contributorStats[contribution.contributor].totalValue += value;

        // 6. Record value event on RewardLedger (trust chain from ContributionDAG)
        _recordOnLedger(contribution.contributor, value, contribution.contribType);

        // 7. Emit for IPFS archival + off-chain indexer
        emit ContributionRecorded(
            contribution.contributor,
            contribution.repoHash,
            contribution.commitHash,
            contribution.contribType,
            value,
            leafIndex
        );
    }

    function _computeLeafHash(
        GitHubContribution calldata contribution
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            contribution.contributor,
            contribution.repoHash,
            contribution.commitHash,
            uint8(contribution.contribType),
            contribution.value,
            contribution.timestamp
        ));
    }

    function _recordOnLedger(
        address contributor,
        uint256 value,
        ContributionType contribType
    ) internal {
        // Map ContributionType to RewardLedger EventType
        IRewardLedger.EventType eventType;
        if (contribType == ContributionType.COMMIT) {
            eventType = IRewardLedger.EventType.GITHUB_COMMIT;
        } else if (contribType == ContributionType.PR_MERGED) {
            eventType = IRewardLedger.EventType.GITHUB_PR;
        } else if (contribType == ContributionType.REVIEW) {
            eventType = IRewardLedger.EventType.GITHUB_REVIEW;
        } else {
            eventType = IRewardLedger.EventType.GITHUB_ISSUE;
        }

        // Get trust chain from ContributionDAG
        (, , , , address[] memory trustChain) = contributionDAG.getTrustScore(contributor);

        // If no trust chain, create minimal one
        if (trustChain.length == 0) {
            trustChain = new address[](1);
            trustChain[0] = contributor;
        }

        // Record on RewardLedger (this contract must be an authorized caller)
        rewardLedger.recordValueEvent(contributor, value, eventType, trustChain);
    }

    function _verifyAgainstHistory(
        bytes32[] calldata proof,
        bytes32 leaf
    ) internal view returns (bool) {
        // Reconstruct the root from proof and leaf, then check history
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _commutativeHash(computedHash, proof[i]);
        }
        return _contributionTree.isKnownRoot(computedHash);
    }

    function _commutativeHash(bytes32 a, bytes32 b) internal pure returns (bytes32 value) {
        /// @solidity memory-safe-assembly
        assembly {
            if gt(a, b) {
                let t := a
                a := b
                b := t
            }
            mstore(0x00, a)
            mstore(0x20, b)
            value := keccak256(0x00, 0x40)
        }
    }
}
