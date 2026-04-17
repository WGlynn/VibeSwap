// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeBountyBoard — Decentralized Bug Bounty & Task Marketplace
 * @notice On-chain bounty system for security audits, feature requests,
 *         and community contributions. Escrow-based with dispute resolution.
 *
 * Bounty types:
 * - SECURITY: Bug bounties (highest priority, 2x payout multiplier)
 * - FEATURE: Feature development bounties
 * - DOCS: Documentation and guides
 * - COMMUNITY: Community building, content creation
 *
 * Flow:
 * 1. Creator posts bounty with ETH escrow
 * 2. Hunters submit solutions with proof
 * 3. Creator approves → funds released
 * 4. Dispute → goes to DecentralizedTribunal
 */
contract VibeBountyBoard is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum BountyType { SECURITY, FEATURE, DOCS, COMMUNITY }
    enum BountyStatus { OPEN, IN_PROGRESS, SUBMITTED, COMPLETED, DISPUTED, CANCELLED }

    struct Bounty {
        address creator;
        string title;
        string descriptionHash;      // IPFS hash
        BountyType bountyType;
        BountyStatus status;
        uint256 reward;
        uint256 createdAt;
        uint256 deadline;
        address hunter;              // Assigned hunter
        address[] applicants;
    }

    struct Submission {
        address hunter;
        string proofHash;            // IPFS hash of solution
        uint256 submittedAt;
        bool approved;
    }

    // ============ State ============

    mapping(uint256 => Bounty) public bounties;
    uint256 public bountyCount;
    mapping(uint256 => Submission[]) public submissions;
    mapping(address => uint256) public hunterReputation;
    mapping(address => uint256) public hunterEarnings;

    uint256 public constant SECURITY_MULTIPLIER = 200; // 2x payout
    uint256 public constant PLATFORM_FEE_BPS = 250;    // 2.5%
    uint256 public platformFees;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event BountyCreated(uint256 indexed id, address creator, BountyType bountyType, uint256 reward);
    event BountyAssigned(uint256 indexed id, address hunter);
    event SubmissionMade(uint256 indexed id, address hunter, string proofHash);
    event BountyCompleted(uint256 indexed id, address hunter, uint256 payout);
    event BountyCancelled(uint256 indexed id);
    event BountyDisputed(uint256 indexed id);

    // ============ Initialize ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Bounty Management ============

    function createBounty(
        string calldata title,
        string calldata descriptionHash,
        BountyType bountyType,
        uint256 deadline
    ) external payable {
        require(msg.value > 0, "Bounty requires escrow");
        require(deadline > block.timestamp, "Invalid deadline");

        uint256 id = bountyCount++;
        bounties[id] = Bounty({
            creator: msg.sender,
            title: title,
            descriptionHash: descriptionHash,
            bountyType: bountyType,
            status: BountyStatus.OPEN,
            reward: msg.value,
            createdAt: block.timestamp,
            deadline: deadline,
            hunter: address(0),
            applicants: new address[](0)
        });

        emit BountyCreated(id, msg.sender, bountyType, msg.value);
    }

    function applyForBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.status == BountyStatus.OPEN, "Not open");
        require(block.timestamp < b.deadline, "Expired");
        b.applicants.push(msg.sender);
    }

    function assignBounty(uint256 id, address hunter) external {
        Bounty storage b = bounties[id];
        require(msg.sender == b.creator, "Not creator");
        require(b.status == BountyStatus.OPEN, "Not open");
        b.hunter = hunter;
        b.status = BountyStatus.IN_PROGRESS;
        emit BountyAssigned(id, hunter);
    }

    function submitSolution(uint256 id, string calldata proofHash) external {
        Bounty storage b = bounties[id];
        require(b.status == BountyStatus.IN_PROGRESS || b.status == BountyStatus.OPEN, "Not submittable");
        require(block.timestamp < b.deadline, "Expired");

        submissions[id].push(Submission({
            hunter: msg.sender,
            proofHash: proofHash,
            submittedAt: block.timestamp,
            approved: false
        }));

        b.status = BountyStatus.SUBMITTED;
        emit SubmissionMade(id, msg.sender, proofHash);
    }

    function approveSubmission(uint256 id, uint256 submissionIndex) external nonReentrant {
        Bounty storage b = bounties[id];
        require(msg.sender == b.creator, "Not creator");
        require(b.status == BountyStatus.SUBMITTED, "No submissions");

        Submission storage sub = submissions[id][submissionIndex];
        sub.approved = true;
        b.status = BountyStatus.COMPLETED;
        b.hunter = sub.hunter;

        uint256 fee = (b.reward * PLATFORM_FEE_BPS) / 10000;
        uint256 payout = b.reward - fee;
        platformFees += fee;

        hunterReputation[sub.hunter]++;
        hunterEarnings[sub.hunter] += payout;

        (bool ok, ) = sub.hunter.call{value: payout}("");
        require(ok, "Payout failed");

        emit BountyCompleted(id, sub.hunter, payout);
    }

    function cancelBounty(uint256 id) external nonReentrant {
        Bounty storage b = bounties[id];
        require(msg.sender == b.creator, "Not creator");
        require(b.status == BountyStatus.OPEN, "Not cancellable");

        b.status = BountyStatus.CANCELLED;
        (bool ok, ) = b.creator.call{value: b.reward}("");
        require(ok, "Refund failed");

        emit BountyCancelled(id);
    }

    function disputeBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.status == BountyStatus.SUBMITTED, "Not submitted");
        b.status = BountyStatus.DISPUTED;
        emit BountyDisputed(id);
    }

    // ============ Views ============

    function getBounty(uint256 id) external view returns (Bounty memory) {
        return bounties[id];
    }

    function getSubmissions(uint256 id) external view returns (Submission[] memory) {
        return submissions[id];
    }

    function getHunterStats(address hunter) external view returns (uint256 reputation, uint256 earnings) {
        return (hunterReputation[hunter], hunterEarnings[hunter]);
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = platformFees;
        platformFees = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    receive() external payable {}
}
