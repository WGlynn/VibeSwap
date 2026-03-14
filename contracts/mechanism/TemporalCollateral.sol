// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ITemporalCollateral.sol";

/**
 * @title TemporalCollateral
 * @notice Future state commitments used as present collateral.
 *         Part of the IT meta-pattern. Users make cryptographic commitments about future
 *         protocol state and stake ETH as backing. Collateral value grows with each
 *         verified checkpoint — time itself becomes an asset.
 *         Breached commitments are routed to AdversarialSymbiosis (attacks strengthen system).
 */
contract TemporalCollateral is ITemporalCollateral, Ownable, ReentrancyGuard {

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant MIN_DURATION = 100;              // Minimum 100 blocks
    uint256 public constant MAX_DURATION = 100_000;          // Maximum ~100k blocks
    uint256 public constant TIME_WEIGHT_MULTIPLIER = 1e15;   // Collateral value growth per checkpoint
    uint256 public constant BREACH_SLASH_BPS = 5000;         // 50% slash on breach

    // ============ State ============

    address public adversarialSymbiosis; // Breached commitments route here

    mapping(bytes32 => StateCommitment) private _commitments;
    mapping(bytes32 => uint64) private _checkpointIntervals; // Stored separately (not in struct)
    mapping(address => bytes32[]) private _userCommitments;
    mapping(address => bool) public authorizedVerifiers;

    uint256 private _commitmentCount;

    // ============ Constructor ============

    constructor(address _adversarialSymbiosis) Ownable(msg.sender) {
        if (_adversarialSymbiosis == address(0)) revert ZeroAddress();
        adversarialSymbiosis = _adversarialSymbiosis;
    }

    // ============ Admin ============

    /**
     * @notice Authorize or revoke a checkpoint verifier
     * @param verifier Address to update
     * @param authorized Whether the verifier is authorized
     */
    function setVerifier(address verifier, bool authorized) external onlyOwner {
        if (verifier == address(0)) revert ZeroAddress();
        authorizedVerifiers[verifier] = authorized;
    }

    /**
     * @notice Update the AdversarialSymbiosis routing address
     * @param _adversarialSymbiosis New address for breach slash forwarding
     */
    function setAdversarialSymbiosis(address _adversarialSymbiosis) external onlyOwner {
        if (_adversarialSymbiosis == address(0)) revert ZeroAddress();
        adversarialSymbiosis = _adversarialSymbiosis;
    }

    // ============ Core ============

    /// @inheritdoc ITemporalCollateral
    function createCommitment(
        CommitmentParams calldata params
    ) external payable nonReentrant returns (bytes32 commitmentId) {
        if (msg.value == 0) revert ZeroAmount();
        if (params.duration < MIN_DURATION || params.duration > MAX_DURATION) revert ZeroDuration();
        if (params.checkpointInterval == 0 || params.checkpointInterval > params.duration) {
            revert InvalidCheckpointInterval();
        }

        commitmentId = keccak256(
            abi.encodePacked(
                msg.sender,
                params.commitType,
                params.stateHash,
                block.number,
                _commitmentCount++
            )
        );

        uint64 startBlock = uint64(block.number);
        uint64 endBlock = startBlock + params.duration;

        _commitments[commitmentId] = StateCommitment({
            commitmentId: commitmentId,
            committer: msg.sender,
            commitType: params.commitType,
            stateHash: params.stateHash,
            stakedCollateral: msg.value,
            collateralValue: msg.value, // Initial value = staked amount
            startBlock: startBlock,
            endBlock: endBlock,
            lastCheckpoint: startBlock,
            checkpointsPassed: 0,
            status: CommitmentStatus.ACTIVE
        });

        _checkpointIntervals[commitmentId] = params.checkpointInterval;
        _userCommitments[msg.sender].push(commitmentId);

        emit CommitmentCreated(
            commitmentId,
            msg.sender,
            params.commitType,
            msg.value,
            startBlock,
            endBlock
        );
    }

    /// @inheritdoc ITemporalCollateral
    function verifyCheckpoint(
        bytes32 commitmentId,
        bytes calldata /* proof */
    ) external nonReentrant {
        if (!authorizedVerifiers[msg.sender] && msg.sender != owner()) revert NotAuthorized();

        StateCommitment storage commitment = _commitments[commitmentId];
        if (commitment.committer == address(0)) revert CommitmentNotFound();
        if (commitment.status != CommitmentStatus.ACTIVE) revert CommitmentNotActive();

        uint64 interval = _checkpointIntervals[commitmentId];
        if (uint64(block.number) < commitment.lastCheckpoint + interval) {
            revert CheckpointTooEarly();
        }

        commitment.lastCheckpoint = uint64(block.number);
        commitment.checkpointsPassed += 1;

        // Recompute collateral value: stakedCollateral * (1 + TIME_WEIGHT_MULTIPLIER * checkpointsPassed) / PRECISION
        uint256 oldValue = commitment.collateralValue;
        uint256 newValue = (commitment.stakedCollateral
            * (PRECISION + TIME_WEIGHT_MULTIPLIER * commitment.checkpointsPassed))
            / PRECISION;
        commitment.collateralValue = newValue;

        emit CollateralValueUpdated(commitmentId, oldValue, newValue);
        emit CommitmentVerified(commitmentId, commitment.checkpointsPassed, newValue);
    }

    /// @inheritdoc ITemporalCollateral
    function reportBreach(
        bytes32 commitmentId,
        bytes calldata /* evidence */
    ) external nonReentrant {
        StateCommitment storage commitment = _commitments[commitmentId];
        if (commitment.committer == address(0)) revert CommitmentNotFound();
        if (commitment.status != CommitmentStatus.ACTIVE) revert CommitmentNotActive();

        commitment.status = CommitmentStatus.BREACHED;

        uint256 slashAmount = (commitment.stakedCollateral * BREACH_SLASH_BPS) / 10_000;
        uint256 remainder = commitment.stakedCollateral - slashAmount;

        // Return remainder to committer
        if (remainder > 0) {
            _transferETH(payable(commitment.committer), remainder);
        }

        // Forward slash to AdversarialSymbiosis
        if (slashAmount > 0) {
            _transferETH(payable(adversarialSymbiosis), slashAmount);
        }

        emit CommitmentBreached(commitmentId, commitment.committer, slashAmount);
    }

    /// @inheritdoc ITemporalCollateral
    function completeCommitment(bytes32 commitmentId) external nonReentrant {
        StateCommitment storage commitment = _commitments[commitmentId];
        if (commitment.committer == address(0)) revert CommitmentNotFound();
        if (commitment.committer != msg.sender) revert NotCommitter();
        if (commitment.status != CommitmentStatus.ACTIVE) revert CommitmentNotActive();
        if (uint64(block.number) < commitment.endBlock) revert CheckpointTooEarly();

        commitment.status = CommitmentStatus.COMPLETED;

        uint256 returned = commitment.stakedCollateral;
        _transferETH(payable(msg.sender), returned);

        emit CommitmentCompleted(
            commitmentId,
            msg.sender,
            returned,
            commitment.checkpointsPassed
        );
    }

    // ============ Views ============

    /// @inheritdoc ITemporalCollateral
    function getCollateralValue(bytes32 commitmentId) external view returns (uint256) {
        return _getCollateralValue(commitmentId);
    }

    /// @inheritdoc ITemporalCollateral
    function getCommitment(bytes32 commitmentId) external view returns (StateCommitment memory) {
        StateCommitment memory commitment = _commitments[commitmentId];
        if (commitment.committer == address(0)) revert CommitmentNotFound();
        return commitment;
    }

    /// @inheritdoc ITemporalCollateral
    function getUserCommitments(address user) external view returns (bytes32[] memory) {
        return _userCommitments[user];
    }

    /// @inheritdoc ITemporalCollateral
    function getUserTotalCollateralValue(address user) external view returns (uint256) {
        bytes32[] memory ids = _userCommitments[user];
        uint256 total;
        for (uint256 i; i < ids.length; ++i) {
            total += _getCollateralValue(ids[i]);
        }
        return total;
    }

    /// @inheritdoc ITemporalCollateral
    function isCheckpointReady(bytes32 commitmentId) external view returns (bool) {
        StateCommitment storage commitment = _commitments[commitmentId];
        if (commitment.status != CommitmentStatus.ACTIVE) return false;
        uint64 interval = _checkpointIntervals[commitmentId];
        return uint64(block.number) >= commitment.lastCheckpoint + interval;
    }

    // ============ Internal ============

    /**
     * @dev Compute the time-weighted collateral value for a commitment.
     *      Returns 0 for breached, completed, or expired commitments.
     */
    function _getCollateralValue(bytes32 commitmentId) internal view returns (uint256) {
        StateCommitment storage commitment = _commitments[commitmentId];
        if (commitment.status != CommitmentStatus.ACTIVE) return 0;

        return (commitment.stakedCollateral
            * (PRECISION + TIME_WEIGHT_MULTIPLIER * commitment.checkpointsPassed))
            / PRECISION;
    }

    /**
     * @dev Safe ETH transfer using low-level call to avoid gas stipend issues.
     */
    function _transferETH(address payable to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}
