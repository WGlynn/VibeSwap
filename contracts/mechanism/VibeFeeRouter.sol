// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeFeeRouter — Protocol-Wide Fee Aggregation & Distribution
 * @notice Collects fees from all VSOS modules and routes them to stakeholders.
 *         Single source of truth for protocol fee configuration.
 *
 * @dev Distribution splits:
 *      - 40% → Stakers (veVIBE holders)
 *      - 25% → Liquidity Providers
 *      - 20% → Treasury
 *      - 10% → Insurance Fund
 *      - 5%  → Mind Contributors (Proof of Mind)
 */
contract VibeFeeRouter is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS = 10000;

    // ============ Types ============

    struct FeeRecipient {
        address recipient;
        uint256 shareBps;
        string label;
        uint256 totalReceived;
        bool active;
    }

    struct FeeSource {
        address source;
        string name;
        uint256 totalCollected;
        bool active;
    }

    // ============ State ============

    /// @notice Fee recipients
    FeeRecipient[] public recipients;

    /// @notice Authorized fee sources
    mapping(address => FeeSource) public sources;
    address[] public sourceList;

    /// @notice Pending fees per token
    mapping(address => uint256) public pendingFees;

    /// @notice Total distributed per token
    mapping(address => uint256) public totalDistributed;

    /// @notice Total collected across all tokens (in ETH equivalent)
    uint256 public totalCollectedETH;

    /// @notice Distribution threshold (min amount before distributing)
    uint256 public distributionThreshold;

    // ============ Events ============

    event FeeCollected(address indexed source, address indexed token, uint256 amount);
    event FeeDistributed(address indexed token, uint256 totalAmount);
    event RecipientAdded(address indexed recipient, uint256 shareBps, string label);
    event RecipientUpdated(uint256 indexed index, uint256 newShareBps);
    event SourceRegistered(address indexed source, string name);

    // ============ Init ============

    function initialize(
        address stakers,
        address lps,
        address treasury,
        address insurance,
        address mindContributors
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        distributionThreshold = 0.01 ether;

        // Default distribution
        recipients.push(FeeRecipient(stakers, 4000, "Stakers", 0, true));
        recipients.push(FeeRecipient(lps, 2500, "LPs", 0, true));
        recipients.push(FeeRecipient(treasury, 2000, "Treasury", 0, true));
        recipients.push(FeeRecipient(insurance, 1000, "Insurance", 0, true));
        recipients.push(FeeRecipient(mindContributors, 500, "Mind", 0, true));
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Fee Collection ============

    /**
     * @notice Collect ETH fees from a registered source
     */
    function collectETH() external payable {
        require(sources[msg.sender].active, "Not registered source");
        require(msg.value > 0, "Zero fee");

        sources[msg.sender].totalCollected += msg.value;
        pendingFees[address(0)] += msg.value;
        totalCollectedETH += msg.value;

        emit FeeCollected(msg.sender, address(0), msg.value);
    }

    /**
     * @notice Collect ERC20 token fees from a registered source
     */
    function collectToken(address token, uint256 amount) external {
        require(sources[msg.sender].active, "Not registered source");
        require(amount > 0, "Zero fee");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        pendingFees[token] += amount;

        emit FeeCollected(msg.sender, token, amount);
    }

    // ============ Distribution ============

    /**
     * @notice Distribute pending ETH fees to all recipients
     */
    function distributeETH() external nonReentrant {
        uint256 amount = pendingFees[address(0)];
        require(amount >= distributionThreshold, "Below threshold");

        pendingFees[address(0)] = 0;
        totalDistributed[address(0)] += amount;

        for (uint256 i = 0; i < recipients.length; i++) {
            if (!recipients[i].active) continue;

            uint256 share = (amount * recipients[i].shareBps) / BPS;
            if (share > 0) {
                recipients[i].totalReceived += share;
                (bool ok, ) = recipients[i].recipient.call{value: share}("");
                require(ok, "Distribution failed");
            }
        }

        emit FeeDistributed(address(0), amount);
    }

    /**
     * @notice Distribute pending token fees to all recipients
     */
    function distributeToken(address token) external nonReentrant {
        require(token != address(0), "Use distributeETH");
        uint256 amount = pendingFees[token];
        require(amount > 0, "No pending fees");

        pendingFees[token] = 0;
        totalDistributed[token] += amount;

        for (uint256 i = 0; i < recipients.length; i++) {
            if (!recipients[i].active) continue;

            uint256 share = (amount * recipients[i].shareBps) / BPS;
            if (share > 0) {
                recipients[i].totalReceived += share;
                IERC20(token).safeTransfer(recipients[i].recipient, share);
            }
        }

        emit FeeDistributed(token, amount);
    }

    // ============ Admin ============

    function registerSource(address source, string calldata name) external onlyOwner {
        sources[source] = FeeSource(source, name, 0, true);
        sourceList.push(source);
        emit SourceRegistered(source, name);
    }

    function removeSource(address source) external onlyOwner {
        sources[source].active = false;
    }

    function updateRecipientShare(uint256 index, uint256 newShareBps) external onlyOwner {
        require(index < recipients.length, "Invalid index");
        recipients[index].shareBps = newShareBps;

        // Verify total is 10000
        uint256 total;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i].active) total += recipients[i].shareBps;
        }
        require(total == BPS, "Shares must sum to 10000");

        emit RecipientUpdated(index, newShareBps);
    }

    function updateRecipientAddress(uint256 index, address newAddr) external onlyOwner {
        require(index < recipients.length, "Invalid index");
        require(newAddr != address(0), "Zero address");
        recipients[index].recipient = newAddr;
    }

    function setDistributionThreshold(uint256 threshold) external onlyOwner {
        distributionThreshold = threshold;
    }

    // ============ View ============

    function getRecipientCount() external view returns (uint256) { return recipients.length; }
    function getSourceCount() external view returns (uint256) { return sourceList.length; }

    function getPendingETH() external view returns (uint256) { return pendingFees[address(0)]; }
    function getPendingToken(address token) external view returns (uint256) { return pendingFees[token]; }

    function getDistributionPreview(uint256 amount) external view returns (uint256[] memory shares) {
        shares = new uint256[](recipients.length);
        for (uint256 i = 0; i < recipients.length; i++) {
            shares[i] = (amount * recipients[i].shareBps) / BPS;
        }
    }

    receive() external payable {
        pendingFees[address(0)] += msg.value;
        totalCollectedETH += msg.value;
    }
}
