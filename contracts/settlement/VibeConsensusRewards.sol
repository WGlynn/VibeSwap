// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeConsensusRewards — Proof of Mind Validator Incentives
 * @notice Reward distribution for the state chain's Proof of Mind consensus.
 *         Validators earn rewards not just for block production, but for
 *         demonstrable cognitive contribution (knowledge creation, dispute
 *         resolution, governance participation).
 *
 * Reward components:
 * 1. Block production: Base reward for producing/validating blocks
 * 2. Knowledge creation: Bonus for contributing to the knowledge graph
 * 3. Dispute resolution: Bonus for serving as tribunal judge
 * 4. Governance: Bonus for voting on proposals
 * 5. Uptime: Multiplier for consistent availability
 */
contract VibeConsensusRewards is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct ValidatorProfile {
        uint256 blocksProduced;
        uint256 knowledgeContributions;
        uint256 disputesResolved;
        uint256 governanceVotes;
        uint256 uptimeScore;          // 0-10000 (basis points)
        uint256 pendingRewards;
        uint256 totalClaimed;
        uint256 lastActive;
    }

    // ============ State ============

    mapping(address => ValidatorProfile) public validators;
    address[] public validatorList;
    mapping(address => bool) public isValidator;

    uint256 public baseBlockReward;
    uint256 public knowledgeBonus;
    uint256 public disputeBonus;
    uint256 public governanceBonus;

    uint256 public totalDistributed;
    uint256 public currentEpoch;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event BlockRewarded(address indexed validator, uint256 reward, uint256 blockNumber);
    event KnowledgeRewarded(address indexed validator, uint256 bonus);
    event DisputeRewarded(address indexed validator, uint256 bonus);
    event GovernanceRewarded(address indexed validator, uint256 bonus);
    event RewardsClaimed(address indexed validator, uint256 amount);
    event ValidatorRegistered(address indexed validator);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        baseBlockReward = 0.01 ether;
        knowledgeBonus = 0.005 ether;
        disputeBonus = 0.003 ether;
        governanceBonus = 0.002 ether;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Validator Management ============

    function registerValidator() external {
        require(!isValidator[msg.sender], "Already registered");
        isValidator[msg.sender] = true;
        validatorList.push(msg.sender);
        validators[msg.sender].lastActive = block.timestamp;
        emit ValidatorRegistered(msg.sender);
    }

    // ============ Reward Distribution ============

    function rewardBlockProduction(address validator, uint256 blockNumber) external onlyOwner {
        require(isValidator[validator], "Not validator");
        ValidatorProfile storage v = validators[validator];

        // Apply uptime multiplier
        uint256 reward = baseBlockReward;
        if (v.uptimeScore > 9000) reward = (reward * 120) / 100; // +20% for >90% uptime
        else if (v.uptimeScore > 8000) reward = (reward * 110) / 100; // +10% for >80%

        v.blocksProduced++;
        v.pendingRewards += reward;
        v.lastActive = block.timestamp;
        totalDistributed += reward;

        emit BlockRewarded(validator, reward, blockNumber);
    }

    function rewardKnowledgeContribution(address validator) external onlyOwner {
        require(isValidator[validator], "Not validator");
        ValidatorProfile storage v = validators[validator];
        v.knowledgeContributions++;
        v.pendingRewards += knowledgeBonus;
        v.lastActive = block.timestamp;
        totalDistributed += knowledgeBonus;
        emit KnowledgeRewarded(validator, knowledgeBonus);
    }

    function rewardDisputeResolution(address validator) external onlyOwner {
        require(isValidator[validator], "Not validator");
        ValidatorProfile storage v = validators[validator];
        v.disputesResolved++;
        v.pendingRewards += disputeBonus;
        v.lastActive = block.timestamp;
        totalDistributed += disputeBonus;
        emit DisputeRewarded(validator, disputeBonus);
    }

    function rewardGovernanceParticipation(address validator) external onlyOwner {
        require(isValidator[validator], "Not validator");
        ValidatorProfile storage v = validators[validator];
        v.governanceVotes++;
        v.pendingRewards += governanceBonus;
        v.lastActive = block.timestamp;
        totalDistributed += governanceBonus;
        emit GovernanceRewarded(validator, governanceBonus);
    }

    function updateUptimeScore(address validator, uint256 score) external onlyOwner {
        require(score <= 10000, "Max 10000");
        validators[validator].uptimeScore = score;
    }

    // ============ Claiming ============

    function claimRewards() external nonReentrant {
        ValidatorProfile storage v = validators[msg.sender];
        uint256 amount = v.pendingRewards;
        require(amount > 0, "No rewards");

        v.pendingRewards = 0;
        v.totalClaimed += amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Claim failed");

        emit RewardsClaimed(msg.sender, amount);
    }

    // ============ Admin ============

    function setRewardRates(
        uint256 _blockReward,
        uint256 _knowledgeBonus,
        uint256 _disputeBonus,
        uint256 _governanceBonus
    ) external onlyOwner {
        baseBlockReward = _blockReward;
        knowledgeBonus = _knowledgeBonus;
        disputeBonus = _disputeBonus;
        governanceBonus = _governanceBonus;
    }

    // ============ Views ============

    function getValidator(address v) external view returns (ValidatorProfile memory) {
        return validators[v];
    }

    function getValidatorCount() external view returns (uint256) {
        return validatorList.length;
    }

    function getPending(address v) external view returns (uint256) {
        return validators[v].pendingRewards;
    }

    receive() external payable {}
}
