// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IRetroactiveFunding.sol";
import "../oracle/IReputationOracle.sol";

/// @notice Minimal SoulboundIdentity interface for Sybil checks
interface ISoulboundIdentityRF {
    function hasIdentity(address addr) external view returns (bool);
}

/**
 * @title RetroactiveFunding
 * @notice Quadratic funding for retroactive community project grants
 * @dev Projects are funded AFTER demonstrating value. Quadratic funding formula
 *      ensures democratic distribution: many small contributors > one whale.
 *      matchedAmount_i = matchPool * (sum(sqrt(c_ij)))^2 / sum_all((sum(sqrt(c_kj)))^2)
 *      Cooperative Capitalism: reward proven value, not promises.
 */
contract RetroactiveFunding is Ownable, ReentrancyGuard, IRetroactiveFunding {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MAX_PROJECTS_DEFAULT = 50;

    // ============ State ============

    /// @notice ReputationOracle for nominator eligibility
    IReputationOracle public immutable reputationOracle;

    /// @notice SoulboundIdentity for Sybil resistance
    ISoulboundIdentityRF public immutable soulboundIdentity;

    /// @notice Number of rounds created
    uint256 public roundCount;

    /// @notice Minimum reputation tier to nominate projects
    uint8 public minNominatorTier;

    /// @notice Maximum projects per round
    uint256 public maxProjectsPerRound;

    /// @notice Rounds by ID (1-indexed)
    mapping(uint256 => FundingRound) internal _rounds;

    /// @notice Projects per round: roundId => projectId => Project
    mapping(uint256 => mapping(uint256 => Project)) internal _projects;

    /// @notice Contributions: roundId => projectId => contributor => amount
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) internal _contributions;

    // ============ Constructor ============

    constructor(
        address _reputationOracle,
        address _soulboundIdentity
    ) Ownable(msg.sender) {
        reputationOracle = IReputationOracle(_reputationOracle);
        soulboundIdentity = ISoulboundIdentityRF(_soulboundIdentity);
        minNominatorTier = 1;
        maxProjectsPerRound = MAX_PROJECTS_DEFAULT;
    }

    // ============ Core Functions ============

    /// @inheritdoc IRetroactiveFunding
    function createRound(
        address token,
        uint256 matchPool,
        uint64 nominationEnd,
        uint64 evaluationEnd
    ) external onlyOwner returns (uint256 roundId) {
        if (token == address(0)) revert ZeroAddress();
        if (matchPool == 0) revert ZeroAmount();
        require(nominationEnd > block.timestamp, "Nomination end must be future");
        require(evaluationEnd > nominationEnd, "Evaluation must be after nomination");

        roundId = ++roundCount;

        _rounds[roundId] = FundingRound({
            token: token,
            matchPool: matchPool,
            nominationEnd: nominationEnd,
            evaluationEnd: evaluationEnd,
            state: RoundState.NOMINATION,
            totalContributions: 0,
            totalDistributed: 0,
            projectCount: 0
        });

        // Pull match pool from owner
        IERC20(token).safeTransferFrom(msg.sender, address(this), matchPool);

        emit RoundCreated(roundId, token, matchPool, nominationEnd, evaluationEnd);
    }

    /// @inheritdoc IRetroactiveFunding
    function nominateProject(
        uint256 roundId,
        address beneficiary,
        bytes32 ipfsHash
    ) external returns (uint256 projectId) {
        FundingRound storage round = _rounds[roundId];
        if (round.token == address(0)) revert RoundNotFound();
        if (round.state != RoundState.NOMINATION) revert WrongPhase();
        if (block.timestamp >= round.nominationEnd) revert WrongPhase();
        if (beneficiary == address(0)) revert ZeroAddress();

        // Sybil check
        if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

        // Reputation gate
        if (!reputationOracle.isEligible(msg.sender, minNominatorTier)) {
            revert InsufficientReputation();
        }

        if (round.projectCount >= maxProjectsPerRound) revert MaxProjectsReached();

        projectId = ++round.projectCount;

        _projects[roundId][projectId] = Project({
            beneficiary: beneficiary,
            nominator: msg.sender,
            ipfsHash: ipfsHash,
            communityContributions: 0,
            contributorCount: 0,
            sqrtSum: 0,
            matchedAmount: 0,
            claimed: false
        });

        emit ProjectNominated(roundId, projectId, beneficiary, msg.sender, ipfsHash);
    }

    /// @inheritdoc IRetroactiveFunding
    function contribute(
        uint256 roundId,
        uint256 projectId,
        uint256 amount
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        FundingRound storage round = _rounds[roundId];
        if (round.token == address(0)) revert RoundNotFound();

        // Contributions allowed during EVALUATION phase
        // (or late NOMINATION — auto-advance if past nominationEnd)
        _advanceToEvaluation(round);
        if (round.state != RoundState.EVALUATION) revert WrongPhase();
        if (block.timestamp >= round.evaluationEnd) revert WrongPhase();

        Project storage project = _projects[roundId][projectId];
        if (project.beneficiary == address(0)) revert ProjectNotFound();

        // Sybil check
        if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

        // Update contribution (handles repeat contributors correctly)
        uint256 oldContrib = _contributions[roundId][projectId][msg.sender];
        uint256 newContrib = oldContrib + amount;
        _contributions[roundId][projectId][msg.sender] = newContrib;

        // Update sqrtSum: remove old sqrt, add new sqrt (prevents gaming by splitting)
        uint256 oldSqrt = Math.sqrt(oldContrib);
        uint256 newSqrt = Math.sqrt(newContrib);
        project.sqrtSum = project.sqrtSum - oldSqrt + newSqrt;

        if (oldContrib == 0) {
            project.contributorCount++;
        }

        project.communityContributions += amount;
        round.totalContributions += amount;

        // Pull contribution tokens
        IERC20(round.token).safeTransferFrom(msg.sender, address(this), amount);

        emit ContributionMade(roundId, projectId, msg.sender, amount, newContrib);
    }

    /// @inheritdoc IRetroactiveFunding
    function finalizeRound(uint256 roundId) external {
        FundingRound storage round = _rounds[roundId];
        if (round.token == address(0)) revert RoundNotFound();

        _advanceToEvaluation(round);
        if (round.state != RoundState.EVALUATION) revert WrongPhase();
        if (block.timestamp < round.evaluationEnd) revert WrongPhase();

        uint256 count = round.projectCount;

        // First pass: compute total quadratic score
        uint256 totalQScore = 0;
        for (uint256 i = 1; i <= count; i++) {
            Project storage p = _projects[roundId][i];
            totalQScore += p.sqrtSum * p.sqrtSum;
        }

        // Second pass: distribute match pool proportionally
        if (totalQScore > 0) {
            for (uint256 i = 1; i <= count; i++) {
                Project storage p = _projects[roundId][i];
                uint256 qScore = p.sqrtSum * p.sqrtSum;
                p.matchedAmount = (round.matchPool * qScore) / totalQScore;
                round.totalDistributed += p.matchedAmount;
            }
        }

        round.state = RoundState.DISTRIBUTION;

        emit RoundFinalized(roundId, round.totalDistributed, count);
    }

    /// @inheritdoc IRetroactiveFunding
    function claimFunds(uint256 roundId, uint256 projectId) external nonReentrant {
        FundingRound storage round = _rounds[roundId];
        if (round.state != RoundState.DISTRIBUTION && round.state != RoundState.SETTLED) {
            revert WrongPhase();
        }

        Project storage project = _projects[roundId][projectId];
        if (project.beneficiary == address(0)) revert ProjectNotFound();
        if (msg.sender != project.beneficiary) revert NotBeneficiary();
        if (project.claimed) revert AlreadyClaimed();

        project.claimed = true;

        uint256 totalClaim = project.matchedAmount + project.communityContributions;

        if (totalClaim > 0) {
            IERC20(round.token).safeTransfer(msg.sender, totalClaim);
        }

        emit FundsClaimed(roundId, projectId, msg.sender, project.matchedAmount, project.communityContributions);
    }

    /// @inheritdoc IRetroactiveFunding
    function settleRound(uint256 roundId) external {
        FundingRound storage round = _rounds[roundId];
        if (round.state != RoundState.DISTRIBUTION) revert RoundNotSettleable();

        // Check all projects claimed
        uint256 count = round.projectCount;
        bool allClaimed = true;
        for (uint256 i = 1; i <= count; i++) {
            if (!_projects[roundId][i].claimed) {
                allClaimed = false;
                break;
            }
        }

        // Return unused match pool to owner (rounding dust)
        uint256 unusedMatch = round.matchPool - round.totalDistributed;
        if (unusedMatch > 0) {
            IERC20(round.token).safeTransfer(owner(), unusedMatch);
        }

        round.state = RoundState.SETTLED;

        emit RoundSettled(roundId, unusedMatch);
    }

    // ============ Internal Functions ============

    /**
     * @notice Auto-advance from NOMINATION to EVALUATION when past nominationEnd
     */
    function _advanceToEvaluation(FundingRound storage round) internal {
        if (round.state == RoundState.NOMINATION && block.timestamp >= round.nominationEnd) {
            round.state = RoundState.EVALUATION;
        }
    }

    // ============ View Functions ============

    /// @inheritdoc IRetroactiveFunding
    function getRound(uint256 roundId) external view returns (FundingRound memory) {
        return _rounds[roundId];
    }

    /// @inheritdoc IRetroactiveFunding
    function getProject(uint256 roundId, uint256 projectId) external view returns (Project memory) {
        return _projects[roundId][projectId];
    }

    /// @inheritdoc IRetroactiveFunding
    function getContribution(
        uint256 roundId,
        uint256 projectId,
        address contributor
    ) external view returns (uint256) {
        return _contributions[roundId][projectId][contributor];
    }

    // ============ Admin Functions ============

    function setMinNominatorTier(uint8 _tier) external onlyOwner {
        uint8 old = minNominatorTier;
        minNominatorTier = _tier;
        emit MinNominatorTierUpdated(old, _tier);
    }

    function setMaxProjectsPerRound(uint256 _max) external onlyOwner {
        uint256 old = maxProjectsPerRound;
        maxProjectsPerRound = _max;
        emit MaxProjectsUpdated(old, _max);
    }
}
