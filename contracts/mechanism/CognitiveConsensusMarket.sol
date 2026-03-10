// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CognitiveConsensusMarket
 * @notice Novel mechanism: a market where AI agents (shards) stake on knowledge claims
 *         and resolve them through commit-reveal pairwise comparison (CRPC).
 *
 * @dev This is fundamentally different from prediction markets:
 *      - Prediction markets resolve via external oracle ("Did X happen?")
 *      - Cognitive consensus markets resolve via internal evaluation ("Is X true/useful/correct?")
 *
 *      The mechanism incentivizes honest cognitive evaluation through:
 *      1. Commit-reveal to prevent copying (agents can't see others' evaluations)
 *      2. Pairwise comparison to avoid Keynesian beauty contest (agents evaluate truth, not popularity)
 *      3. Reputation-weighted stakes to give experienced evaluators more influence
 *      4. Asymmetric cost: correct evaluations earn linear rewards, incorrect ones lose quadratic
 *
 *      Use cases:
 *      - Code quality evaluation (is this PR good?)
 *      - Knowledge validation (is this research claim accurate?)
 *      - Content moderation (is this content harmful?)
 *      - Dispute resolution (who is right in this disagreement?)
 *
 *      Inspired by the Shards > Swarms thesis: each evaluator is a complete mind,
 *      not a specialized sub-agent. The market aggregates independent judgments.
 *
 * @author W. Glynn, JARVIS | March 2026
 */
contract CognitiveConsensusMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_EVALUATORS = 21;        // Odd number for tiebreaking
    uint256 public constant MIN_EVALUATORS = 3;          // Minimum for meaningful consensus
    uint256 public constant COMMIT_DURATION = 1 days;
    uint256 public constant REVEAL_DURATION = 12 hours;
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint256 public constant SLASH_MULTIPLIER = 2;        // Quadratic loss: wrong = 2x stake lost

    // ============ Enums ============

    enum ClaimState {
        OPEN,           // Accepting evaluator commits
        REVEAL,         // Commit phase ended, reveal phase active
        COMPARING,      // Reveals done, pairwise comparison in progress
        RESOLVED,       // Consensus reached
        EXPIRED         // Not enough evaluators, refunded
    }

    enum Verdict {
        NONE,
        TRUE,           // Claim is correct/valid/useful
        FALSE,          // Claim is incorrect/invalid/harmful
        UNCERTAIN       // Insufficient evidence to determine
    }

    // ============ Structs ============

    struct Claim {
        bytes32 claimHash;          // Hash of the claim content (IPFS CID or similar)
        address proposer;           // Who submitted the claim for evaluation
        uint256 bounty;             // Reward pool for evaluators
        uint256 commitDeadline;     // End of commit phase
        uint256 revealDeadline;     // End of reveal phase
        uint256 minEvaluators;      // Minimum evaluators needed
        ClaimState state;
        Verdict verdict;
        uint256 trueVotes;
        uint256 falseVotes;
        uint256 uncertainVotes;
        uint256 totalStake;
        uint256 totalReputationWeight;
    }

    struct Evaluation {
        bytes32 commitHash;         // hash(verdict || reasoning_hash || salt)
        Verdict verdict;
        bytes32 reasoningHash;      // IPFS hash of detailed reasoning
        uint256 stake;
        uint256 reputationWeight;
        bool revealed;
        bool rewarded;
    }

    struct EvaluatorProfile {
        uint256 totalEvaluations;
        uint256 correctEvaluations;
        uint256 reputationScore;    // 0-10000 (BPS scale)
        uint256 totalEarned;
        uint256 totalSlashed;
    }

    // ============ State ============

    IERC20 public stakeToken;
    uint256 public nextClaimId;

    mapping(uint256 => Claim) public claims;
    mapping(uint256 => address[]) public claimEvaluators;
    mapping(uint256 => mapping(address => Evaluation)) public evaluations;
    mapping(address => EvaluatorProfile) public profiles;

    // Authorized evaluators (registered AI agents or verified humans)
    mapping(address => bool) public authorizedEvaluators;

    // ============ Events ============

    event ClaimSubmitted(uint256 indexed claimId, bytes32 claimHash, address proposer, uint256 bounty);
    event EvaluationCommitted(uint256 indexed claimId, address indexed evaluator, uint256 stake);
    event EvaluationRevealed(uint256 indexed claimId, address indexed evaluator, Verdict verdict);
    event ClaimResolved(uint256 indexed claimId, Verdict verdict, uint256 trueVotes, uint256 falseVotes);
    event EvaluatorRewarded(uint256 indexed claimId, address indexed evaluator, uint256 reward);
    event EvaluatorSlashed(uint256 indexed claimId, address indexed evaluator, uint256 slashAmount);
    event ClaimExpired(uint256 indexed claimId);

    // ============ Errors ============

    error NotAuthorizedEvaluator();
    error ClaimNotInState(ClaimState expected, ClaimState actual);
    error AlreadyCommitted();
    error CommitDeadlinePassed();
    error RevealDeadlineNotReached();
    error RevealDeadlinePassed();
    error InvalidReveal();
    error InsufficientStake();
    error EvaluatorLimitReached();
    error InsufficientEvaluators();

    // ============ Constructor ============

    constructor(address _stakeToken) Ownable(msg.sender) {
        stakeToken = IERC20(_stakeToken);
        nextClaimId = 1;
    }

    // ============ Claim Submission ============

    /**
     * @notice Submit a knowledge claim for cognitive evaluation
     * @param claimHash Hash of the claim content
     * @param bounty Reward pool for evaluators (funded by proposer)
     * @param minEvaluators Minimum evaluators required (>= MIN_EVALUATORS)
     */
    function submitClaim(
        bytes32 claimHash,
        uint256 bounty,
        uint256 minEvaluators
    ) external nonReentrant returns (uint256 claimId) {
        require(claimHash != bytes32(0), "Empty claim");
        require(bounty > 0, "Zero bounty");
        require(minEvaluators >= MIN_EVALUATORS, "Too few evaluators");
        require(minEvaluators <= MAX_EVALUATORS, "Too many evaluators");

        stakeToken.safeTransferFrom(msg.sender, address(this), bounty);

        claimId = nextClaimId++;

        claims[claimId] = Claim({
            claimHash: claimHash,
            proposer: msg.sender,
            bounty: bounty,
            commitDeadline: block.timestamp + COMMIT_DURATION,
            revealDeadline: block.timestamp + COMMIT_DURATION + REVEAL_DURATION,
            minEvaluators: minEvaluators,
            state: ClaimState.OPEN,
            verdict: Verdict.NONE,
            trueVotes: 0,
            falseVotes: 0,
            uncertainVotes: 0,
            totalStake: 0,
            totalReputationWeight: 0
        });

        emit ClaimSubmitted(claimId, claimHash, msg.sender, bounty);
    }

    // ============ Evaluation Commit ============

    /**
     * @notice Commit an evaluation (blinded)
     * @param claimId Claim to evaluate
     * @param commitHash hash(verdict || reasoningHash || salt)
     * @param stake Amount to stake (higher stake = more skin in the game)
     */
    function commitEvaluation(
        uint256 claimId,
        bytes32 commitHash,
        uint256 stake
    ) external nonReentrant {
        if (!authorizedEvaluators[msg.sender]) revert NotAuthorizedEvaluator();

        Claim storage claim = claims[claimId];
        if (claim.state != ClaimState.OPEN) revert ClaimNotInState(ClaimState.OPEN, claim.state);
        if (block.timestamp > claim.commitDeadline) revert CommitDeadlinePassed();
        if (evaluations[claimId][msg.sender].commitHash != bytes32(0)) revert AlreadyCommitted();
        if (stake < MIN_STAKE) revert InsufficientStake();
        if (claimEvaluators[claimId].length >= MAX_EVALUATORS) revert EvaluatorLimitReached();

        stakeToken.safeTransferFrom(msg.sender, address(this), stake);

        // Reputation weight: sqrt(reputation) to prevent domination by high-rep evaluators
        EvaluatorProfile storage profile = profiles[msg.sender];
        uint256 repWeight = _sqrt(profile.reputationScore > 0 ? profile.reputationScore : BPS);

        evaluations[claimId][msg.sender] = Evaluation({
            commitHash: commitHash,
            verdict: Verdict.NONE,
            reasoningHash: bytes32(0),
            stake: stake,
            reputationWeight: repWeight,
            revealed: false,
            rewarded: false
        });

        claimEvaluators[claimId].push(msg.sender);
        claim.totalStake += stake;
        claim.totalReputationWeight += repWeight;

        emit EvaluationCommitted(claimId, msg.sender, stake);
    }

    // ============ Evaluation Reveal ============

    /**
     * @notice Reveal a committed evaluation
     * @param claimId Claim evaluated
     * @param verdict TRUE, FALSE, or UNCERTAIN
     * @param reasoningHash IPFS hash of detailed reasoning
     * @param salt Random salt used in commit
     */
    function revealEvaluation(
        uint256 claimId,
        Verdict verdict,
        bytes32 reasoningHash,
        bytes32 salt
    ) external nonReentrant {
        Claim storage claim = claims[claimId];

        // Transition to REVEAL state if commit deadline passed
        if (claim.state == ClaimState.OPEN && block.timestamp > claim.commitDeadline) {
            if (claimEvaluators[claimId].length < claim.minEvaluators) {
                // Not enough evaluators — expire and refund
                claim.state = ClaimState.EXPIRED;
                emit ClaimExpired(claimId);
                return;
            }
            claim.state = ClaimState.REVEAL;
        }

        if (claim.state != ClaimState.REVEAL) revert ClaimNotInState(ClaimState.REVEAL, claim.state);
        if (block.timestamp > claim.revealDeadline) revert RevealDeadlinePassed();

        Evaluation storage eval = evaluations[claimId][msg.sender];
        require(!eval.revealed, "Already revealed");

        // Verify commit
        bytes32 expected = keccak256(abi.encodePacked(verdict, reasoningHash, salt));
        if (eval.commitHash != expected) revert InvalidReveal();

        eval.verdict = verdict;
        eval.reasoningHash = reasoningHash;
        eval.revealed = true;

        // Tally votes (reputation-weighted)
        if (verdict == Verdict.TRUE) {
            claim.trueVotes += eval.reputationWeight;
        } else if (verdict == Verdict.FALSE) {
            claim.falseVotes += eval.reputationWeight;
        } else {
            claim.uncertainVotes += eval.reputationWeight;
        }

        emit EvaluationRevealed(claimId, msg.sender, verdict);
    }

    // ============ Resolution ============

    /**
     * @notice Resolve a claim after reveal period ends
     * @dev Determines consensus verdict and distributes rewards/slashing
     */
    function resolveClaim(uint256 claimId) external nonReentrant {
        Claim storage claim = claims[claimId];
        require(claim.state == ClaimState.REVEAL || claim.state == ClaimState.OPEN, "Not resolvable");
        require(block.timestamp > claim.revealDeadline, "Reveal period active");

        // Handle expiry
        if (claimEvaluators[claimId].length < claim.minEvaluators) {
            claim.state = ClaimState.EXPIRED;
            emit ClaimExpired(claimId);
            return;
        }

        // Determine verdict by reputation-weighted majority
        uint256 totalVotes = claim.trueVotes + claim.falseVotes + claim.uncertainVotes;
        require(totalVotes > 0, "No votes revealed");

        if (claim.trueVotes > claim.falseVotes && claim.trueVotes > claim.uncertainVotes) {
            claim.verdict = Verdict.TRUE;
        } else if (claim.falseVotes > claim.trueVotes && claim.falseVotes > claim.uncertainVotes) {
            claim.verdict = Verdict.FALSE;
        } else {
            claim.verdict = Verdict.UNCERTAIN;
        }

        claim.state = ClaimState.RESOLVED;

        // Distribute rewards and slashing
        _distributeOutcomes(claimId);

        emit ClaimResolved(claimId, claim.verdict, claim.trueVotes, claim.falseVotes);
    }

    // ============ Reward Distribution ============

    function _distributeOutcomes(uint256 claimId) internal {
        Claim storage claim = claims[claimId];
        address[] storage evaluators = claimEvaluators[claimId];

        uint256 totalCorrectWeight = 0;
        uint256 slashPool = 0;

        // First pass: calculate correct weight and slash incorrect
        for (uint256 i = 0; i < evaluators.length; i++) {
            Evaluation storage eval = evaluations[claimId][evaluators[i]];
            if (!eval.revealed) {
                // Unrevealed = slashed (broke the protocol)
                slashPool += eval.stake;
                profiles[evaluators[i]].totalSlashed += eval.stake;
                emit EvaluatorSlashed(claimId, evaluators[i], eval.stake);
                continue;
            }

            if (eval.verdict == claim.verdict) {
                // Correct evaluation
                totalCorrectWeight += eval.reputationWeight;
                profiles[evaluators[i]].correctEvaluations++;
            } else {
                // Incorrect evaluation — asymmetric cost (lose more than they could win)
                uint256 slashAmount = eval.stake > eval.stake / SLASH_MULTIPLIER
                    ? eval.stake / SLASH_MULTIPLIER
                    : eval.stake;
                slashPool += slashAmount;
                profiles[evaluators[i]].totalSlashed += slashAmount;
                // Return remaining stake
                uint256 returnAmount = eval.stake - slashAmount;
                if (returnAmount > 0) {
                    stakeToken.safeTransfer(evaluators[i], returnAmount);
                }
                emit EvaluatorSlashed(claimId, evaluators[i], slashAmount);
            }

            profiles[evaluators[i]].totalEvaluations++;
            _updateReputation(evaluators[i]);
        }

        // Second pass: distribute bounty + slash pool to correct evaluators
        uint256 rewardPool = claim.bounty + slashPool;
        if (totalCorrectWeight == 0) {
            // No one was correct — return bounty to proposer
            stakeToken.safeTransfer(claim.proposer, claim.bounty);
            return;
        }

        for (uint256 i = 0; i < evaluators.length; i++) {
            Evaluation storage eval = evaluations[claimId][evaluators[i]];
            if (!eval.revealed || eval.verdict != claim.verdict) continue;
            if (eval.rewarded) continue;

            eval.rewarded = true;

            // Pro-rata by reputation weight
            uint256 reward = (rewardPool * eval.reputationWeight) / totalCorrectWeight;
            // Return stake + reward
            uint256 total = eval.stake + reward;

            stakeToken.safeTransfer(evaluators[i], total);
            profiles[evaluators[i]].totalEarned += reward;

            emit EvaluatorRewarded(claimId, evaluators[i], reward);
        }
    }

    // ============ Refund (Expired Claims) ============

    /**
     * @notice Refund stakes for expired claims
     */
    function refundExpired(uint256 claimId) external nonReentrant {
        Claim storage claim = claims[claimId];
        require(claim.state == ClaimState.EXPIRED, "Not expired");

        // Return bounty to proposer
        if (claim.bounty > 0) {
            uint256 bounty = claim.bounty;
            claim.bounty = 0;
            stakeToken.safeTransfer(claim.proposer, bounty);
        }

        // Return all evaluator stakes
        address[] storage evaluators = claimEvaluators[claimId];
        for (uint256 i = 0; i < evaluators.length; i++) {
            Evaluation storage eval = evaluations[claimId][evaluators[i]];
            if (eval.stake > 0 && !eval.rewarded) {
                eval.rewarded = true;
                stakeToken.safeTransfer(evaluators[i], eval.stake);
            }
        }
    }

    // ============ Reputation ============

    function _updateReputation(address evaluator) internal {
        EvaluatorProfile storage profile = profiles[evaluator];
        if (profile.totalEvaluations == 0) {
            profile.reputationScore = BPS; // Default 100%
            return;
        }

        // Reputation = (correct / total) * 10000, with minimum floor of 1000 (10%)
        uint256 accuracy = (profile.correctEvaluations * BPS) / profile.totalEvaluations;
        profile.reputationScore = accuracy > 1000 ? accuracy : 1000;
    }

    // ============ Admin ============

    function setAuthorizedEvaluator(address evaluator, bool authorized) external onlyOwner {
        authorizedEvaluators[evaluator] = authorized;
    }

    // ============ View ============

    function getClaimEvaluators(uint256 claimId) external view returns (address[] memory) {
        return claimEvaluators[claimId];
    }

    function getProfile(address evaluator) external view returns (EvaluatorProfile memory) {
        return profiles[evaluator];
    }

    // ============ Internal ============

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = x / 2 + 1;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
