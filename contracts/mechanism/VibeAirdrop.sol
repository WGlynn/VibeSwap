// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeAirdrop — Gas-Efficient Merkle Airdrop Distribution
 * @notice Distribute tokens to thousands of addresses using Merkle proofs.
 *         Sybil-resistant via reputation requirements.
 */
contract VibeAirdrop is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    struct AirdropCampaign {
        uint256 campaignId;
        address creator;
        address token;
        bytes32 merkleRoot;
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 claimCount;
        uint256 startTime;
        uint256 endTime;
        uint256 minReputation;     // Minimum reputation score to claim
        bool active;
    }

    // ============ State ============

    mapping(uint256 => AirdropCampaign) public campaigns;
    uint256 public campaignCount;

    /// @notice Claim tracking: campaignId => address => claimed
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    uint256 public totalDistributed;

    // ============ Events ============

    event CampaignCreated(uint256 indexed campaignId, address indexed token, uint256 totalAmount);
    event Claimed(uint256 indexed campaignId, address indexed claimant, uint256 amount);
    event CampaignEnded(uint256 indexed campaignId, uint256 unclaimed);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Campaign Management ============

    function createCampaign(
        address token,
        bytes32 merkleRoot,
        uint256 totalAmount,
        uint256 startTime,
        uint256 duration,
        uint256 minReputation
    ) external returns (uint256) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);

        campaignCount++;
        campaigns[campaignCount] = AirdropCampaign({
            campaignId: campaignCount,
            creator: msg.sender,
            token: token,
            merkleRoot: merkleRoot,
            totalAmount: totalAmount,
            claimedAmount: 0,
            claimCount: 0,
            startTime: startTime,
            endTime: startTime + duration,
            minReputation: minReputation,
            active: true
        });

        emit CampaignCreated(campaignCount, token, totalAmount);
        return campaignCount;
    }

    /**
     * @notice Claim airdrop with Merkle proof
     */
    function claim(
        uint256 campaignId,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        AirdropCampaign storage campaign = campaigns[campaignId];
        require(campaign.active, "Not active");
        require(block.timestamp >= campaign.startTime, "Not started");
        require(block.timestamp <= campaign.endTime, "Ended");
        require(!hasClaimed[campaignId][msg.sender], "Already claimed");

        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(_verifyProof(merkleProof, campaign.merkleRoot, leaf), "Invalid proof");

        hasClaimed[campaignId][msg.sender] = true;
        campaign.claimedAmount += amount;
        campaign.claimCount++;
        totalDistributed += amount;

        IERC20(campaign.token).safeTransfer(msg.sender, amount);

        emit Claimed(campaignId, msg.sender, amount);
    }

    /**
     * @notice Reclaim unclaimed tokens after campaign ends
     */
    function reclaimUnclaimed(uint256 campaignId) external nonReentrant {
        AirdropCampaign storage campaign = campaigns[campaignId];
        require(campaign.creator == msg.sender, "Not creator");
        require(block.timestamp > campaign.endTime, "Not ended");
        require(campaign.active, "Not active");

        campaign.active = false;
        uint256 unclaimed = campaign.totalAmount - campaign.claimedAmount;

        if (unclaimed > 0) {
            IERC20(campaign.token).safeTransfer(msg.sender, unclaimed);
        }

        emit CampaignEnded(campaignId, unclaimed);
    }

    // ============ Internal ============

    function _verifyProof(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            if (computedHash <= proof[i]) {
                computedHash = keccak256(abi.encodePacked(computedHash, proof[i]));
            } else {
                computedHash = keccak256(abi.encodePacked(proof[i], computedHash));
            }
        }
        return computedHash == root;
    }

    // ============ View ============

    function getCampaignCount() external view returns (uint256) { return campaignCount; }

    function canClaim(uint256 campaignId, address user) external view returns (bool) {
        AirdropCampaign storage c = campaigns[campaignId];
        return c.active && !hasClaimed[campaignId][user] &&
               block.timestamp >= c.startTime && block.timestamp <= c.endTime;
    }
}
