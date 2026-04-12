// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../settlement/VerifiedCompute.sol";
import "./interfaces/IBehavioralReputation.sol";
import "./interfaces/ICredentialRegistry.sol";

/**
 * @title BehavioralReputationVerifier — Off-Chain Fraud, On-Chain Truth
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Verifies off-chain CogProof behavioral analysis against on-chain
 *         invariants. The 6 fraud detectors (selective reveal, sybil timing,
 *         collusion ring, plagiarism, reputation churn, velocity spike) run
 *         off-chain; Merkle-proven results land here.
 *
 * @dev Extends VerifiedCompute — same pattern as TrustScoreVerifier.
 *      Implements IBehavioralReputation which extends IReputationOracle,
 *      so this plugs directly into CommitRevealAuction.setReputationOracle()
 *      with zero changes to existing contracts.
 *
 *      CogProof JS origin: cogproof/src/trust/behavior-analyzer.js
 *      See: docs/COGPROOF_INTEGRATION.md
 *      P-000: Fairness Above All.
 */
contract BehavioralReputationVerifier is VerifiedCompute, IBehavioralReputation {
    // ============ Constants ============

    /// @notice Maximum valid trust score (matches CogProof's 0-100 range)
    uint256 public constant MAX_TRUST_SCORE = 100;

    /// @notice Scale factor for IReputationOracle compatibility (0-10000)
    uint256 public constant ORACLE_SCALE = 100;

    /// @notice Default rate limit: max actions per epoch before flagged
    uint256 public constant DEFAULT_RATE_LIMIT = 100;

    // ============ State ============

    /// @notice user => latest finalized BehaviorReport
    mapping(address => BehaviorReport) private _reports;

    /// @notice user => FraudFlag enum => active
    mapping(address => mapping(uint8 => bool)) private _activeFlags;

    /// @notice user => total active flag count by min severity
    mapping(address => mapping(uint8 => uint16)) private _flagCounts;

    /// @notice epoch => Merkle root of behavior reports
    mapping(uint64 => bytes32) private _epochRoots;

    /// @notice epoch => finalized
    mapping(uint64 => bool) private _epochFinalized;

    /// @notice epoch => user addresses submitted in that epoch
    mapping(uint64 => address[]) private _epochUsers;

    /// @notice epoch => user => report (pending until finalization)
    mapping(uint64 => mapping(address => BehaviorReport)) private _pendingReports;

    /// @notice epoch => user => flags array (pending)
    mapping(uint64 => mapping(address => FraudFlag[])) private _pendingFlags;
    mapping(uint64 => mapping(address => Severity[])) private _pendingFlagSeverities;

    /// @notice On-chain rate limiting: user => epoch action count
    mapping(address => uint256) private _actionCounts;
    mapping(address => uint64) private _actionEpoch;

    /// @notice Current epoch number
    uint64 public currentEpoch;

    /// @notice Rate limit threshold
    uint256 public rateLimit;

    /// @notice Authorized callers for recordAction
    mapping(address => bool) public authorizedRecorders;

    /// @dev Reserved storage gap
    uint256[50] private __gap_behavioral;

    // ============ Init ============

    function initialize(
        uint256 _disputeWindow,
        uint256 _bondAmount,
        uint256 _rateLimit
    ) external initializer {
        __VerifiedCompute_init(_disputeWindow, _bondAmount);
        rateLimit = _rateLimit > 0 ? _rateLimit : DEFAULT_RATE_LIMIT;
        currentEpoch = 1;
    }

    // ============ Admin ============

    function authorizeRecorder(address recorder) external onlyOwner {
        authorizedRecorders[recorder] = true;
    }

    function revokeRecorder(address recorder) external onlyOwner {
        authorizedRecorders[recorder] = false;
    }

    function setRateLimit(uint256 _rateLimit) external onlyOwner {
        rateLimit = _rateLimit;
    }

    // ============ Epoch Submission ============

    /**
     * @notice Submit a batch of behavior reports for an epoch.
     * @dev Bonded submitter pushes Merkle root + individual reports.
     *      Reports sit in pending state until dispute window passes.
     */
    function submitBehaviorEpoch(
        uint64 epoch,
        address[] calldata users,
        BehaviorReport[] calldata reports,
        FraudFlag[][] calldata flags,
        Severity[][] calldata severities,
        bytes32 merkleRoot
    ) external {
        if (!submitters[msg.sender]) revert NotBondedSubmitter();
        if (_epochRoots[epoch] != bytes32(0)) revert EpochAlreadySubmitted();
        if (users.length != reports.length) revert ReportArrayMismatch();
        if (flags.length != users.length) revert ReportArrayMismatch();
        if (severities.length != users.length) revert ReportArrayMismatch();

        _epochRoots[epoch] = merkleRoot;

        // Store pending reports
        for (uint256 i = 0; i < users.length; i++) {
            if (reports[i].trustScore > MAX_TRUST_SCORE) revert InvalidTrustScore();
            _pendingReports[epoch][users[i]] = reports[i];
            _epochUsers[epoch].push(users[i]);

            // Store pending flags
            for (uint256 j = 0; j < flags[i].length; j++) {
                _pendingFlags[epoch][users[i]].push(flags[i][j]);
                _pendingFlagSeverities[epoch][users[i]].push(severities[i][j]);
            }
        }

        // Submit to VerifiedCompute for dispute tracking
        bytes32 computeId = keccak256(abi.encode("BEHAVIOR_EPOCH", epoch));
        results[computeId] = ComputeResult({
            resultHash: merkleRoot,
            submitter: msg.sender,
            timestamp: block.timestamp,
            status: ResultStatus.Pending
        });

        emit BehaviorEpochSubmitted(epoch, merkleRoot, msg.sender);
        emit ResultSubmitted(computeId, merkleRoot, msg.sender);
    }

    /**
     * @notice Finalize an epoch after the dispute window passes.
     * @dev Writes pending reports to canonical state.
     */
    function finalizeEpoch(uint64 epoch) external {
        bytes32 computeId = keccak256(abi.encode("BEHAVIOR_EPOCH", epoch));
        ComputeResult storage r = results[computeId];
        if (r.status != ResultStatus.Pending) revert ResultNotPending();
        if (block.timestamp < r.timestamp + disputeWindow) revert DisputeWindowActive();

        r.status = ResultStatus.Finalized;
        _epochFinalized[epoch] = true;

        // Promote pending reports to canonical
        address[] storage users = _epochUsers[epoch];
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            _reports[user] = _pendingReports[epoch][user];

            // Clear old flags for this user, apply new ones
            _clearFlags(user);
            FraudFlag[] storage userFlags = _pendingFlags[epoch][user];
            Severity[] storage userSeverities = _pendingFlagSeverities[epoch][user];
            for (uint256 j = 0; j < userFlags.length; j++) {
                _activeFlags[user][uint8(userFlags[j])] = true;
                _incrementFlagCounts(user, userSeverities[j]);
                emit FraudFlagRecorded(user, userFlags[j], userSeverities[j]);
            }
        }

        emit BehaviorEpochFinalized(epoch, users.length);
        emit ResultFinalized(computeId, r.resultHash);

        if (epoch >= currentEpoch) {
            currentEpoch = epoch + 1;
        }
    }

    // ============ IReputationOracle ============

    /// @notice Returns trust score scaled to 0-10000 for IReputationOracle compatibility
    function getTrustScore(address user) external view override returns (uint256 score) {
        return _reports[user].trustScore * ORACLE_SCALE;
    }

    /// @notice Returns trust tier as uint8 (FLAGGED=0 through TRUSTED=4)
    function getTrustTier(address user) external view override returns (uint8 tier) {
        return uint8(_reports[user].tier);
    }

    /// @notice Check if user meets minimum tier requirement
    function isEligible(address user, uint8 requiredTier) external view override returns (bool) {
        return uint8(_reports[user].tier) >= requiredTier;
    }

    // ============ IBehavioralReputation ============

    /// @inheritdoc IBehavioralReputation
    function getBehaviorReport(address user) external view override returns (BehaviorReport memory) {
        return _reports[user];
    }

    /// @inheritdoc IBehavioralReputation
    function hasActiveFlag(address user, FraudFlag flag) external view override returns (bool) {
        return _activeFlags[user][uint8(flag)];
    }

    /// @inheritdoc IBehavioralReputation
    function getFlagCount(address user, Severity minSeverity) external view override returns (uint16) {
        return _flagCounts[user][uint8(minSeverity)];
    }

    /// @inheritdoc IBehavioralReputation
    function isRateLimited(address user) external view override returns (bool) {
        if (_actionEpoch[user] != currentEpoch) return false;
        return _actionCounts[user] >= rateLimit;
    }

    /// @inheritdoc IBehavioralReputation
    function recordAction(address user) external override {
        require(authorizedRecorders[msg.sender], "Not authorized recorder");

        if (_actionEpoch[user] != currentEpoch) {
            _actionEpoch[user] = currentEpoch;
            _actionCounts[user] = 0;
        }
        _actionCounts[user]++;

        emit ActionRecorded(user, _actionCounts[user]);
    }

    // ============ VerifiedCompute Overrides ============

    /// @dev Returns the Merkle root for a given compute ID
    function _getExpectedRoot(bytes32 computeId) internal view override returns (bytes32) {
        return results[computeId].resultHash;
    }

    /// @dev Validates dispute evidence for a behavior epoch
    function _validateDispute(bytes32, bytes calldata evidence) internal pure override returns (bool) {
        // Dispute evidence should contain a counter-proof showing the
        // submitted report violates invariants (e.g., score > 100,
        // flag counts inconsistent, tier doesn't match score).
        // For now: evidence must be non-empty (actual validation
        // would decode and verify specific invariant violations).
        return evidence.length > 0;
    }

    // ============ Internal ============

    function _clearFlags(address user) internal {
        for (uint8 i = 1; i <= 6; i++) {
            _activeFlags[user][i] = false;
        }
        for (uint8 s = 0; s <= 3; s++) {
            _flagCounts[user][s] = 0;
        }
    }

    function _incrementFlagCounts(address user, Severity sev) internal {
        // A CRITICAL flag also counts as HIGH, WARNING, and INFO
        uint8 sevVal = uint8(sev);
        for (uint8 s = 0; s <= sevVal; s++) {
            _flagCounts[user][s]++;
        }
    }
}
