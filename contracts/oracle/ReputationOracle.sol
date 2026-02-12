// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./IReputationOracle.sol";

/**
 * @title ReputationOracle
 * @notice Decentralized trust scoring through commit-reveal pairwise comparisons
 * @dev Own commit-reveal logic (not inherited from CommitRevealAuction).
 *      Integrates with SoulboundIdentity for voter eligibility and
 *      ShapleyDistributor for fair reward distribution.
 *
 *      Flow:
 *        1. Oracle generates random pairwise comparisons per round
 *        2. Voters commit hidden preference: hash(choice || secret)
 *        3. Voters reveal choice + secret (verified against commitment)
 *        4. Settlement: aggregate votes, update trust scores, reward honest voters
 *        5. Tier promotion/demotion based on percentile trust scores
 */
contract ReputationOracle is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IReputationOracle
{
    // ============ Structs ============

    struct Comparison {
        address walletA;
        address walletB;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint32 votesForA;
        uint32 votesForB;
        uint32 votesEquivalent;
        uint32 totalVotes;
        bool settled;
    }

    struct VoteCommitment {
        bytes32 commitment;
        uint8 revealedChoice; // 0=not revealed, 1=A, 2=B, 3=equivalent
        bool revealed;
    }

    struct TrustProfile {
        uint256 score;          // 0-10000 BPS (basis points)
        uint256 wins;
        uint256 losses;
        uint256 equivalences;
        uint256 totalComparisons;
        uint256 lastUpdated;
        uint8 tier;             // 0-4
    }

    // ============ Constants ============

    uint256 public constant BPS = 10000;
    uint256 public constant INITIAL_TRUST_SCORE = 5000; // 50th percentile start

    // Commit-reveal timing (own cycle, independent of trading batches)
    uint256 public constant VOTE_COMMIT_DURATION = 300;  // 5 minutes
    uint256 public constant VOTE_REVEAL_DURATION = 120;  // 2 minutes

    // Tier thresholds (trust score in BPS)
    uint256 public constant TIER_1_THRESHOLD = 2000; // 20th percentile
    uint256 public constant TIER_2_THRESHOLD = 4000; // 40th percentile
    uint256 public constant TIER_3_THRESHOLD = 6000; // 60th percentile
    uint256 public constant TIER_4_THRESHOLD = 8000; // 80th percentile

    // Slashing
    uint256 public constant SLASH_RATE_BPS = 5000; // 50% of deposit

    // Score update constants
    uint256 public constant WIN_SCORE_DELTA = 200;    // +2% for consensus win
    uint256 public constant LOSS_SCORE_DELTA = 100;   // -1% for consensus loss
    uint256 public constant DECAY_RATE_BPS = 50;      // 0.5% per decay period
    uint256 public constant DECAY_PERIOD = 30 days;

    // Min deposit to vote (skin in the game)
    uint256 public constant MIN_VOTE_DEPOSIT = 0.0005 ether;

    // ============ State ============

    /// @notice All comparisons by ID
    mapping(bytes32 => Comparison) public comparisons;

    /// @notice Vote commitments: comparisonId => voter => commitment
    mapping(bytes32 => mapping(address => VoteCommitment)) public voteCommitments;

    /// @notice Vote deposits: comparisonId => voter => deposit amount
    mapping(bytes32 => mapping(address => uint256)) public voteDeposits;

    /// @notice Voters per comparison (for settlement iteration)
    mapping(bytes32 => address[]) public comparisonVoters;

    /// @notice Trust profiles per user
    mapping(address => TrustProfile) public trustProfiles;

    /// @notice Round counter
    uint256 public currentRound;

    /// @notice Comparisons per round
    mapping(uint256 => bytes32[]) public roundComparisons;

    /// @notice Authorized comparison generators (governance, oracle keeper)
    mapping(address => bool) public authorizedGenerators;

    /// @notice SoulboundIdentity contract (for voter eligibility)
    address public soulboundIdentity;

    /// @notice Treasury for slashed funds
    address public treasury;

    // ============ Events ============

    event ComparisonCreated(bytes32 indexed comparisonId, uint256 indexed round, address walletA, address walletB);
    event VoteCommitted(bytes32 indexed comparisonId, address indexed voter);
    event VoteRevealed(bytes32 indexed comparisonId, address indexed voter, uint8 choice);
    event VoteSlashed(bytes32 indexed comparisonId, address indexed voter, uint256 slashAmount);
    event ComparisonSettled(bytes32 indexed comparisonId, uint8 consensus);
    event TrustScoreUpdated(address indexed user, uint256 oldScore, uint256 newScore, uint8 newTier);
    event TierChanged(address indexed user, uint8 oldTier, uint8 newTier);

    // ============ Errors ============

    error Unauthorized();
    error InvalidPhase();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error InvalidReveal();
    error AlreadySettled();
    error ComparisonNotFound();
    error InsufficientDeposit();
    error CannotVoteOnSelf();
    error NoIdentity();
    error ZeroAddress();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner) public initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        currentRound = 1;
    }

    // ============ Admin ============

    function setAuthorizedGenerator(address generator, bool authorized) external onlyOwner {
        authorizedGenerators[generator] = authorized;
    }

    function setSoulboundIdentity(address _soulboundIdentity) external onlyOwner {
        soulboundIdentity = _soulboundIdentity;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ Comparison Generation ============

    /**
     * @notice Create a pairwise comparison for the current round
     * @param walletA First wallet to compare
     * @param walletB Second wallet to compare
     */
    function createComparison(address walletA, address walletB) external returns (bytes32) {
        if (!authorizedGenerators[msg.sender] && msg.sender != owner()) revert Unauthorized();
        if (walletA == walletB) revert CannotVoteOnSelf();
        if (walletA == address(0) || walletB == address(0)) revert ZeroAddress();

        bytes32 comparisonId = keccak256(abi.encodePacked(
            walletA, walletB, currentRound, block.timestamp
        ));

        comparisons[comparisonId] = Comparison({
            walletA: walletA,
            walletB: walletB,
            commitDeadline: uint64(block.timestamp + VOTE_COMMIT_DURATION),
            revealDeadline: uint64(block.timestamp + VOTE_COMMIT_DURATION + VOTE_REVEAL_DURATION),
            votesForA: 0,
            votesForB: 0,
            votesEquivalent: 0,
            totalVotes: 0,
            settled: false
        });

        // Initialize trust profiles if first time
        if (trustProfiles[walletA].lastUpdated == 0) {
            trustProfiles[walletA] = TrustProfile({
                score: INITIAL_TRUST_SCORE,
                wins: 0, losses: 0, equivalences: 0,
                totalComparisons: 0,
                lastUpdated: block.timestamp,
                tier: 2 // Start at tier 2 (40th percentile)
            });
        }
        if (trustProfiles[walletB].lastUpdated == 0) {
            trustProfiles[walletB] = TrustProfile({
                score: INITIAL_TRUST_SCORE,
                wins: 0, losses: 0, equivalences: 0,
                totalComparisons: 0,
                lastUpdated: block.timestamp,
                tier: 2
            });
        }

        roundComparisons[currentRound].push(comparisonId);

        emit ComparisonCreated(comparisonId, currentRound, walletA, walletB);
        return comparisonId;
    }

    /**
     * @notice Advance to next round
     */
    function advanceRound() external {
        if (!authorizedGenerators[msg.sender] && msg.sender != owner()) revert Unauthorized();
        currentRound++;
    }

    // ============ Commit Phase ============

    /**
     * @notice Commit a hidden vote on a pairwise comparison
     * @param comparisonId The comparison to vote on
     * @param commitment Hash of (choice || secret): keccak256(abi.encodePacked(choice, secret))
     */
    function commitVote(bytes32 comparisonId, bytes32 commitment) external payable nonReentrant {
        Comparison storage comp = comparisons[comparisonId];
        if (comp.walletA == address(0)) revert ComparisonNotFound();
        if (block.timestamp > comp.commitDeadline) revert InvalidPhase();
        if (msg.value < MIN_VOTE_DEPOSIT) revert InsufficientDeposit();
        if (voteCommitments[comparisonId][msg.sender].commitment != bytes32(0)) revert AlreadyCommitted();

        // Cannot vote on comparison involving yourself
        if (msg.sender == comp.walletA || msg.sender == comp.walletB) revert CannotVoteOnSelf();

        // Optional: require SoulboundIdentity
        if (soulboundIdentity != address(0)) {
            (bool success, bytes memory data) = soulboundIdentity.staticcall(
                abi.encodeWithSignature("addressToTokenId(address)", msg.sender)
            );
            if (!success || abi.decode(data, (uint256)) == 0) revert NoIdentity();
        }

        voteCommitments[comparisonId][msg.sender] = VoteCommitment({
            commitment: commitment,
            revealedChoice: 0,
            revealed: false
        });

        voteDeposits[comparisonId][msg.sender] = msg.value;
        comparisonVoters[comparisonId].push(msg.sender);

        emit VoteCommitted(comparisonId, msg.sender);
    }

    // ============ Reveal Phase ============

    /**
     * @notice Reveal vote with choice and secret
     * @param comparisonId The comparison voted on
     * @param choice 1=walletA better, 2=walletB better, 3=equivalent
     * @param secret Random value used in commitment
     */
    function revealVote(
        bytes32 comparisonId,
        uint8 choice,
        bytes32 secret
    ) external nonReentrant {
        Comparison storage comp = comparisons[comparisonId];
        if (comp.walletA == address(0)) revert ComparisonNotFound();
        if (block.timestamp <= comp.commitDeadline || block.timestamp > comp.revealDeadline) {
            revert InvalidPhase();
        }

        VoteCommitment storage vc = voteCommitments[comparisonId][msg.sender];
        if (vc.commitment == bytes32(0)) revert NotCommitted();
        if (vc.revealed) revert AlreadyRevealed();

        // Verify commitment
        bytes32 computed = keccak256(abi.encodePacked(choice, secret));
        if (computed != vc.commitment) revert InvalidReveal();

        require(choice >= 1 && choice <= 3, "Invalid choice");

        vc.revealed = true;
        vc.revealedChoice = choice;

        // Tally
        if (choice == 1) {
            comp.votesForA++;
        } else if (choice == 2) {
            comp.votesForB++;
        } else {
            comp.votesEquivalent++;
        }
        comp.totalVotes++;

        emit VoteRevealed(comparisonId, msg.sender, choice);
    }

    // ============ Settlement ============

    /**
     * @notice Settle a comparison after reveal phase ends
     * @dev Updates trust scores, slashes non-revealers, rewards honest voters
     */
    function settleComparison(bytes32 comparisonId) external nonReentrant {
        Comparison storage comp = comparisons[comparisonId];
        if (comp.walletA == address(0)) revert ComparisonNotFound();
        if (block.timestamp <= comp.revealDeadline) revert InvalidPhase();
        if (comp.settled) revert AlreadySettled();

        comp.settled = true;

        // Determine consensus
        uint8 consensus;
        if (comp.votesForA > comp.votesForB && comp.votesForA > comp.votesEquivalent) {
            consensus = 1; // A is more trustworthy
        } else if (comp.votesForB > comp.votesForA && comp.votesForB > comp.votesEquivalent) {
            consensus = 2; // B is more trustworthy
        } else {
            consensus = 3; // Equivalent (includes ties)
        }

        // Update trust scores for compared wallets
        _updateComparedWallets(comp.walletA, comp.walletB, consensus);

        // Process voters: slash non-revealers, refund honest voters
        address[] storage voters = comparisonVoters[comparisonId];
        for (uint256 i = 0; i < voters.length; i++) {
            address voter = voters[i];
            VoteCommitment storage vc = voteCommitments[comparisonId][voter];
            uint256 deposit = voteDeposits[comparisonId][voter];

            if (!vc.revealed) {
                // Slash non-revealer
                _slashVoter(comparisonId, voter, deposit);
            } else {
                // Refund deposit to honest voter
                if (deposit > 0) {
                    voteDeposits[comparisonId][voter] = 0;
                    (bool success,) = voter.call{value: deposit}("");
                    if (!success) {
                        // Hold for later claim
                        voteDeposits[comparisonId][voter] = deposit;
                    }
                }
            }
        }

        emit ComparisonSettled(comparisonId, consensus);
    }

    /**
     * @notice Claim deposit if refund failed during settlement
     */
    function claimDeposit(bytes32 comparisonId) external nonReentrant {
        Comparison storage comp = comparisons[comparisonId];
        require(comp.settled, "Not settled");
        VoteCommitment storage vc = voteCommitments[comparisonId][msg.sender];
        require(vc.revealed, "Not revealed");

        uint256 deposit = voteDeposits[comparisonId][msg.sender];
        require(deposit > 0, "Nothing to claim");

        voteDeposits[comparisonId][msg.sender] = 0;
        (bool success,) = msg.sender.call{value: deposit}("");
        require(success, "Transfer failed");
    }

    // ============ Trust Score Logic ============

    function _updateComparedWallets(address walletA, address walletB, uint8 consensus) internal {
        TrustProfile storage profileA = trustProfiles[walletA];
        TrustProfile storage profileB = trustProfiles[walletB];

        // Apply decay before update
        _applyDecay(profileA);
        _applyDecay(profileB);

        uint256 oldScoreA = profileA.score;
        uint256 oldScoreB = profileB.score;

        profileA.totalComparisons++;
        profileB.totalComparisons++;

        if (consensus == 1) {
            // A wins
            profileA.wins++;
            profileB.losses++;
            profileA.score = _min(profileA.score + WIN_SCORE_DELTA, BPS);
            profileB.score = profileB.score > LOSS_SCORE_DELTA ? profileB.score - LOSS_SCORE_DELTA : 0;
        } else if (consensus == 2) {
            // B wins
            profileB.wins++;
            profileA.losses++;
            profileB.score = _min(profileB.score + WIN_SCORE_DELTA, BPS);
            profileA.score = profileA.score > LOSS_SCORE_DELTA ? profileA.score - LOSS_SCORE_DELTA : 0;
        } else {
            // Equivalent
            profileA.equivalences++;
            profileB.equivalences++;
            // No score change for equivalence
        }

        profileA.lastUpdated = block.timestamp;
        profileB.lastUpdated = block.timestamp;

        // Update tiers
        uint8 oldTierA = profileA.tier;
        uint8 oldTierB = profileB.tier;
        profileA.tier = _calculateTier(profileA.score);
        profileB.tier = _calculateTier(profileB.score);

        emit TrustScoreUpdated(walletA, oldScoreA, profileA.score, profileA.tier);
        emit TrustScoreUpdated(walletB, oldScoreB, profileB.score, profileB.tier);

        if (profileA.tier != oldTierA) {
            emit TierChanged(walletA, oldTierA, profileA.tier);
        }
        if (profileB.tier != oldTierB) {
            emit TierChanged(walletB, oldTierB, profileB.tier);
        }
    }

    function _applyDecay(TrustProfile storage profile) internal {
        if (profile.lastUpdated == 0) return;

        uint256 elapsed = block.timestamp - profile.lastUpdated;
        uint256 periods = elapsed / DECAY_PERIOD;

        if (periods > 0) {
            // Decay toward INITIAL_TRUST_SCORE (mean reversion)
            for (uint256 i = 0; i < periods && i < 24; i++) {
                if (profile.score > INITIAL_TRUST_SCORE) {
                    uint256 excess = profile.score - INITIAL_TRUST_SCORE;
                    uint256 decay = (excess * DECAY_RATE_BPS) / BPS;
                    profile.score -= decay;
                } else if (profile.score < INITIAL_TRUST_SCORE) {
                    uint256 deficit = INITIAL_TRUST_SCORE - profile.score;
                    uint256 recovery = (deficit * DECAY_RATE_BPS) / BPS;
                    profile.score += recovery;
                }
            }
        }
    }

    function _calculateTier(uint256 score) internal pure returns (uint8) {
        if (score >= TIER_4_THRESHOLD) return 4;
        if (score >= TIER_3_THRESHOLD) return 3;
        if (score >= TIER_2_THRESHOLD) return 2;
        if (score >= TIER_1_THRESHOLD) return 1;
        return 0;
    }

    function _slashVoter(bytes32 comparisonId, address voter, uint256 deposit) internal {
        if (deposit == 0) return;

        uint256 slashAmount = (deposit * SLASH_RATE_BPS) / BPS;
        uint256 refundAmount = deposit - slashAmount;

        voteDeposits[comparisonId][voter] = 0;

        // Send slashed funds to treasury
        if (treasury != address(0) && slashAmount > 0) {
            (bool success,) = treasury.call{value: slashAmount}("");
            if (!success) {
                // If treasury transfer fails, refund everything
                refundAmount = deposit;
            }
        }

        // Refund remainder
        if (refundAmount > 0) {
            (bool success,) = voter.call{value: refundAmount}("");
            if (!success) {
                voteDeposits[comparisonId][voter] = refundAmount;
            }
        }

        emit VoteSlashed(comparisonId, voter, slashAmount);
    }

    // ============ IReputationOracle Views ============

    function getTrustScore(address user) external view override returns (uint256) {
        TrustProfile storage profile = trustProfiles[user];
        if (profile.lastUpdated == 0) return INITIAL_TRUST_SCORE;
        return profile.score;
    }

    function getTrustTier(address user) external view override returns (uint8) {
        TrustProfile storage profile = trustProfiles[user];
        if (profile.lastUpdated == 0) return 2; // Default tier
        return profile.tier;
    }

    function isEligible(address user, uint8 requiredTier) external view override returns (bool) {
        TrustProfile storage profile = trustProfiles[user];
        if (profile.lastUpdated == 0) return requiredTier <= 2; // Default eligibility
        return profile.tier >= requiredTier;
    }

    // ============ Additional Views ============

    function getComparison(bytes32 comparisonId) external view returns (Comparison memory) {
        return comparisons[comparisonId];
    }

    function getTrustProfile(address user) external view returns (TrustProfile memory) {
        return trustProfiles[user];
    }

    function getRoundComparisons(uint256 round) external view returns (bytes32[] memory) {
        return roundComparisons[round];
    }

    function getComparisonVoterCount(bytes32 comparisonId) external view returns (uint256) {
        return comparisonVoters[comparisonId].length;
    }

    function inCommitPhase(bytes32 comparisonId) external view returns (bool) {
        Comparison storage comp = comparisons[comparisonId];
        return block.timestamp <= comp.commitDeadline;
    }

    function inRevealPhase(bytes32 comparisonId) external view returns (bool) {
        Comparison storage comp = comparisons[comparisonId];
        return block.timestamp > comp.commitDeadline && block.timestamp <= comp.revealDeadline;
    }

    // ============ Helpers ============

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Receive ============

    receive() external payable {}
}
