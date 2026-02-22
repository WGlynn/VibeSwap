// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../compliance/FederatedConsensus.sol";

/// @notice Minimal interface for SoulboundIdentity juror eligibility checks
interface ISoulboundIdentityMinimal {
    struct AvatarTraits {
        uint8 background;
        uint8 body;
        uint8 eyes;
        uint8 mouth;
        uint8 accessory;
        uint8 aura;
    }
    struct IdentityInfo {
        string username;
        uint256 level;
        uint256 xp;
        int256 alignment;
        uint256 contributions;
        uint256 reputation;
        uint256 createdAt;
        uint256 lastActive;
        AvatarTraits avatar;
        bool quantumEnabled;
        bytes32 quantumKeyRoot;
    }
    function hasIdentity(address addr) external view returns (bool);
    function getIdentity(address addr) external view returns (IdentityInfo memory);
}

/**
 * @title DecentralizedTribunal
 * @notice On-chain equivalent of courts and juries
 * @dev Replaces off-chain COURT role in FederatedConsensus. Implements:
 *      - Jury summoning from eligible identity holders
 *      - Evidence submission and review periods
 *      - Majority verdict with configurable quorum
 *      - Stake-backed juror participation (skin in the game)
 *      - Appeal mechanism with escalating jury size
 *
 *      This contract IS a FederatedConsensus authority. It votes on behalf
 *      of the decentralized jury. When the jury reaches a verdict, this
 *      contract casts the on-chain COURT vote automatically.
 *
 *      Infrastructural inversion: Today this runs alongside off-chain courts.
 *      Eventually, this becomes the primary judicial system and off-chain
 *      courts reference its verdicts.
 */
contract DecentralizedTribunal is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    // ============ Enums ============

    enum TrialPhase {
        JURY_SELECTION,    // Summoning jurors
        EVIDENCE,          // Evidence submission period
        DELIBERATION,      // Jury votes
        VERDICT,           // Final decision rendered
        APPEAL,            // Appeal window
        CLOSED             // Case finalized
    }

    enum Verdict {
        PENDING,
        GUILTY,            // Clawback should proceed
        NOT_GUILTY,        // Case dismissed
        MISTRIAL           // Insufficient quorum or tie
    }

    // ============ Structs ============

    struct Trial {
        bytes32 caseId;
        bytes32 consensusProposalId;
        TrialPhase phase;
        Verdict verdict;
        uint64 phaseDeadline;
        uint256 jurySize;
        uint256 guiltyVotes;
        uint256 notGuiltyVotes;
        uint256 jurorStake;
        uint256 appealCount;
        string[] evidenceHashes;       // IPFS hashes of evidence
    }

    struct Juror {
        bool summoned;
        bool voted;
        bool votedGuilty;
        uint256 stakeAmount;
    }

    // ============ State ============

    /// @notice FederatedConsensus contract (this contract votes as ONCHAIN_TRIBUNAL)
    FederatedConsensus public consensus;

    /// @notice Trials by ID
    mapping(bytes32 => Trial) public trials;

    /// @notice Juror records: trialId => juror => record
    mapping(bytes32 => mapping(address => Juror)) public jurors;

    /// @notice Juror list per trial
    mapping(bytes32 => address[]) public trialJurors;

    /// @notice Minimum reputation to serve as juror
    uint256 public minJurorReputation;

    /// @notice Minimum identity level to serve as juror
    uint256 public minJurorLevel;

    /// @notice Default jury size
    uint256 public defaultJurySize;

    /// @notice Phase durations
    uint256 public jurySelectionDuration;
    uint256 public evidenceDuration;
    uint256 public deliberationDuration;
    uint256 public appealDuration;

    /// @notice Required juror stake (ETH)
    uint256 public jurorStakeAmount;

    /// @notice Maximum appeal rounds
    uint256 public maxAppeals;

    /// @notice Quorum percentage (BPS, e.g., 6000 = 60%)
    uint256 public quorumBps;

    /// @notice Trial counter
    uint256 public trialCount;

    /// @notice SoulboundIdentity contract for juror eligibility
    address public soulboundIdentity;

    /// @notice Pending stake withdrawals (pull pattern for safe ETH returns)
    mapping(address => uint256) public pendingStakeWithdrawals;

    // ============ Events ============

    event TrialOpened(bytes32 indexed trialId, bytes32 indexed caseId, uint256 jurySize);
    event JurorSummoned(bytes32 indexed trialId, address indexed juror);
    event EvidenceSubmitted(bytes32 indexed trialId, string evidenceHash, address indexed submitter);
    event JurorVoted(bytes32 indexed trialId, address indexed juror);
    event VerdictReached(bytes32 indexed trialId, Verdict verdict, uint256 guiltyVotes, uint256 notGuiltyVotes);
    event AppealFiled(bytes32 indexed trialId, uint256 appealRound);
    event TrialClosed(bytes32 indexed trialId, Verdict finalVerdict);
    event ConsensusVoteCast(bytes32 indexed trialId, bytes32 indexed proposalId, bool approved);
    event StakePendingWithdrawal(address indexed juror, uint256 amount);
    event StakeWithdrawn(address indexed juror, uint256 amount);
    event SoulboundIdentitySet(address indexed identity);

    // ============ Errors ============

    error TrialNotFound();
    error WrongPhase();
    error NotSummoned();
    error AlreadyVoted();
    error PhaseNotExpired();
    error QuorumNotMet();
    error MaxAppealsReached();
    error InsufficientStake();
    error JuryFull();
    error NoIdentity();
    error InsufficientLevel();
    error InsufficientReputation();
    error AlreadyJuror();
    error NoPendingStake();

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _consensus
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        consensus = FederatedConsensus(_consensus);

        // Defaults
        defaultJurySize = 7;
        jurySelectionDuration = 3 days;
        evidenceDuration = 5 days;
        deliberationDuration = 3 days;
        appealDuration = 7 days;
        jurorStakeAmount = 0.1 ether;
        maxAppeals = 2;
        quorumBps = 6000; // 60% quorum
        minJurorReputation = 10;
        minJurorLevel = 2;
    }

    // ============ Trial Management ============

    /**
     * @notice Open a trial for a clawback case
     * @param caseId Associated clawback case
     * @param consensusProposalId FederatedConsensus proposal this trial will vote on
     * @return trialId Unique trial ID
     */
    function openTrial(
        bytes32 caseId,
        bytes32 consensusProposalId
    ) external onlyOwner returns (bytes32 trialId) {
        trialCount++;
        trialId = keccak256(abi.encodePacked(caseId, trialCount, block.timestamp));

        trials[trialId] = Trial({
            caseId: caseId,
            consensusProposalId: consensusProposalId,
            phase: TrialPhase.JURY_SELECTION,
            verdict: Verdict.PENDING,
            phaseDeadline: uint64(block.timestamp + jurySelectionDuration),
            jurySize: defaultJurySize,
            guiltyVotes: 0,
            notGuiltyVotes: 0,
            jurorStake: jurorStakeAmount,
            appealCount: 0,
            evidenceHashes: new string[](0)
        });

        emit TrialOpened(trialId, caseId, defaultJurySize);
    }

    /**
     * @notice Volunteer as a juror (stake required)
     * @param trialId Trial to join
     */
    function volunteerAsJuror(bytes32 trialId) external payable nonReentrant {
        Trial storage trial = trials[trialId];
        if (trial.caseId == bytes32(0)) revert TrialNotFound();
        if (trial.phase != TrialPhase.JURY_SELECTION) revert WrongPhase();
        if (msg.value < trial.jurorStake) revert InsufficientStake();
        if (trialJurors[trialId].length >= trial.jurySize) revert JuryFull();
        if (jurors[trialId][msg.sender].summoned) revert AlreadyJuror();

        // SoulboundIdentity checks for sybil resistance
        if (soulboundIdentity != address(0)) {
            bool hasId = ISoulboundIdentityMinimal(soulboundIdentity).hasIdentity(msg.sender);
            if (!hasId) revert NoIdentity();

            ISoulboundIdentityMinimal.IdentityInfo memory id =
                ISoulboundIdentityMinimal(soulboundIdentity).getIdentity(msg.sender);
            if (id.level < minJurorLevel) revert InsufficientLevel();
            if (id.reputation < minJurorReputation) revert InsufficientReputation();
        }

        jurors[trialId][msg.sender] = Juror({
            summoned: true,
            voted: false,
            votedGuilty: false,
            stakeAmount: msg.value
        });

        trialJurors[trialId].push(msg.sender);
        emit JurorSummoned(trialId, msg.sender);

        // Auto-advance to evidence phase when jury is full
        if (trialJurors[trialId].length == trial.jurySize) {
            trial.phase = TrialPhase.EVIDENCE;
            trial.phaseDeadline = uint64(block.timestamp + evidenceDuration);
        }
    }

    /**
     * @notice Submit evidence (IPFS hash)
     * @param trialId Trial to submit evidence for
     * @param evidenceHash IPFS hash of evidence document
     */
    function submitEvidence(bytes32 trialId, string calldata evidenceHash) external {
        Trial storage trial = trials[trialId];
        if (trial.caseId == bytes32(0)) revert TrialNotFound();
        if (trial.phase != TrialPhase.EVIDENCE) revert WrongPhase();
        if (!jurors[trialId][msg.sender].summoned && msg.sender != owner()) revert NotSummoned();

        trial.evidenceHashes.push(evidenceHash);
        emit EvidenceSubmitted(trialId, evidenceHash, msg.sender);
    }

    /**
     * @notice Advance to deliberation phase (after evidence period)
     */
    function advanceToDeliberation(bytes32 trialId) external {
        Trial storage trial = trials[trialId];
        if (trial.phase != TrialPhase.EVIDENCE) revert WrongPhase();
        if (block.timestamp < trial.phaseDeadline) revert PhaseNotExpired();

        trial.phase = TrialPhase.DELIBERATION;
        trial.phaseDeadline = uint64(block.timestamp + deliberationDuration);
    }

    /**
     * @notice Cast jury vote
     * @param trialId Trial to vote on
     * @param guilty Whether the accused is guilty
     */
    function castJuryVote(bytes32 trialId, bool guilty) external {
        Trial storage trial = trials[trialId];
        if (trial.phase != TrialPhase.DELIBERATION) revert WrongPhase();

        Juror storage juror = jurors[trialId][msg.sender];
        if (!juror.summoned) revert NotSummoned();
        if (juror.voted) revert AlreadyVoted();

        juror.voted = true;
        juror.votedGuilty = guilty;

        if (guilty) {
            trial.guiltyVotes++;
        } else {
            trial.notGuiltyVotes++;
        }

        emit JurorVoted(trialId, msg.sender);
    }

    /**
     * @notice Render verdict after deliberation
     * @dev Also casts the ONCHAIN_TRIBUNAL vote in FederatedConsensus
     */
    function renderVerdict(bytes32 trialId) external {
        Trial storage trial = trials[trialId];
        if (trial.phase != TrialPhase.DELIBERATION) revert WrongPhase();
        if (block.timestamp < trial.phaseDeadline) revert PhaseNotExpired();

        uint256 totalVotes = trial.guiltyVotes + trial.notGuiltyVotes;
        uint256 quorumRequired = (trial.jurySize * quorumBps) / 10000;

        if (totalVotes < quorumRequired) {
            trial.verdict = Verdict.MISTRIAL;
        } else if (trial.guiltyVotes > trial.notGuiltyVotes) {
            trial.verdict = Verdict.GUILTY;
        } else if (trial.notGuiltyVotes > trial.guiltyVotes) {
            trial.verdict = Verdict.NOT_GUILTY;
        } else {
            trial.verdict = Verdict.MISTRIAL; // Tie
        }

        trial.phase = TrialPhase.VERDICT;
        trial.phaseDeadline = uint64(block.timestamp + appealDuration);

        emit VerdictReached(trialId, trial.verdict, trial.guiltyVotes, trial.notGuiltyVotes);

        // Cast vote in FederatedConsensus (the on-chain court speaks)
        if (trial.verdict == Verdict.GUILTY || trial.verdict == Verdict.NOT_GUILTY) {
            bool approve = trial.verdict == Verdict.GUILTY;
            consensus.vote(trial.consensusProposalId, approve);
            emit ConsensusVoteCast(trialId, trial.consensusProposalId, approve);
        }

        // Return stakes to jurors who voted with majority (incentivize honest voting)
        _settleStakes(trialId);
    }

    /**
     * @notice File an appeal (resets to new trial with larger jury)
     */
    function fileAppeal(bytes32 trialId) external payable {
        Trial storage trial = trials[trialId];
        if (trial.phase != TrialPhase.VERDICT) revert WrongPhase();
        if (block.timestamp >= trial.phaseDeadline) revert PhaseNotExpired();
        if (trial.appealCount >= maxAppeals) revert MaxAppealsReached();
        // Only past jurors or owner can file appeals (prevents external griefing)
        if (!jurors[trialId][msg.sender].summoned && msg.sender != owner()) revert NotSummoned();
        // Require appeal stake (escalates with each appeal round)
        if (msg.value < trial.jurorStake) revert InsufficientStake();

        trial.appealCount++;
        trial.phase = TrialPhase.APPEAL;

        emit AppealFiled(trialId, trial.appealCount);

        // Reset for new trial with larger jury (+4 jurors per appeal)
        trial.jurySize += 4;
        trial.guiltyVotes = 0;
        trial.notGuiltyVotes = 0;
        trial.phase = TrialPhase.JURY_SELECTION;
        trial.phaseDeadline = uint64(block.timestamp + jurySelectionDuration);

        // Clear previous jury
        delete trialJurors[trialId];
    }

    /**
     * @notice Close trial after appeal window expires
     */
    function closeTrial(bytes32 trialId) external {
        Trial storage trial = trials[trialId];
        if (trial.phase != TrialPhase.VERDICT) revert WrongPhase();
        if (block.timestamp < trial.phaseDeadline) revert PhaseNotExpired();

        trial.phase = TrialPhase.CLOSED;
        emit TrialClosed(trialId, trial.verdict);
    }

    // ============ Internal ============

    function _settleStakes(bytes32 trialId) internal {
        Trial storage trial = trials[trialId];
        address[] storage jurorList = trialJurors[trialId];
        bool majorityGuilty = trial.guiltyVotes > trial.notGuiltyVotes;

        for (uint256 i = 0; i < jurorList.length; i++) {
            Juror storage juror = jurors[trialId][jurorList[i]];
            if (!juror.voted) continue;

            // Jurors who voted with majority get stake back + bonus from minority
            bool votedWithMajority = juror.votedGuilty == majorityGuilty;
            if (votedWithMajority) {
                // Pull pattern: credit pending withdrawal instead of pushing ETH
                // This prevents a single reverting recipient from blocking all settlements
                pendingStakeWithdrawals[jurorList[i]] += juror.stakeAmount;
                emit StakePendingWithdrawal(jurorList[i], juror.stakeAmount);
            }
            // Minority stake stays in contract as penalty
        }
    }

    /// @notice Withdraw pending stake (pull pattern)
    function withdrawStake() external nonReentrant {
        uint256 amount = pendingStakeWithdrawals[msg.sender];
        if (amount == 0) revert NoPendingStake();

        pendingStakeWithdrawals[msg.sender] = 0;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Stake withdrawal failed");

        emit StakeWithdrawn(msg.sender, amount);
    }

    // ============ View Functions ============

    function getTrial(bytes32 trialId) external view returns (Trial memory) {
        return trials[trialId];
    }

    function getTrialJurors(bytes32 trialId) external view returns (address[] memory) {
        return trialJurors[trialId];
    }

    function getEvidenceCount(bytes32 trialId) external view returns (uint256) {
        return trials[trialId].evidenceHashes.length;
    }

    // ============ Admin ============

    function setJuryParameters(
        uint256 _defaultJurySize,
        uint256 _jurorStakeAmount,
        uint256 _quorumBps
    ) external onlyOwner {
        defaultJurySize = _defaultJurySize;
        jurorStakeAmount = _jurorStakeAmount;
        quorumBps = _quorumBps;
    }

    function setPhaseDurations(
        uint256 _jurySelection,
        uint256 _evidence,
        uint256 _deliberation,
        uint256 _appeal
    ) external onlyOwner {
        jurySelectionDuration = _jurySelection;
        evidenceDuration = _evidence;
        deliberationDuration = _deliberation;
        appealDuration = _appeal;
    }

    function setEligibility(uint256 _minReputation, uint256 _minLevel) external onlyOwner {
        minJurorReputation = _minReputation;
        minJurorLevel = _minLevel;
    }

    function setSoulboundIdentity(address _soulboundIdentity) external onlyOwner {
        soulboundIdentity = _soulboundIdentity;
        emit SoulboundIdentitySet(_soulboundIdentity);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    receive() external payable {}
}
