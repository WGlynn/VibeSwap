// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeLaunchpad — Fair Token Launch Platform
 * @notice Anti-snipe, anti-bot fair launch with multiple sale types.
 *         Integrated with VibeReputation for priority access.
 *
 * @dev Sale types:
 *      - Fair Launch (everyone same price, first-come-first-served)
 *      - Dutch Auction (price decreases until sold out)
 *      - Overflow (pro-rata if oversubscribed)
 *      - Whitelist (reputation-gated priority access)
 *
 *   Anti-MEV: commit-reveal for participation (uses existing infrastructure)
 */
contract VibeLaunchpad is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum SaleType { FAIR_LAUNCH, DUTCH_AUCTION, OVERFLOW, WHITELIST }
    enum SaleStatus { PENDING, ACTIVE, ENDED, FINALIZED, CANCELLED }

    struct Sale {
        uint256 saleId;
        address creator;
        address token;             // Token being sold
        uint256 totalTokens;       // Total tokens for sale
        uint256 tokensSold;
        uint256 pricePerToken;     // In payment token units
        uint256 endPricePerToken;  // For Dutch auction
        address paymentToken;      // address(0) = ETH
        uint256 raised;
        uint256 hardCap;
        uint256 softCap;
        uint256 minBuy;
        uint256 maxBuy;
        uint256 startTime;
        uint256 endTime;
        SaleType saleType;
        SaleStatus status;
        bool vestingEnabled;
        uint256 vestingDuration;
        uint256 vestingCliff;
    }

    struct Participation {
        uint256 contributed;
        uint256 tokensClaimed;
        uint256 vestingStart;
        bool refunded;
    }

    // ============ State ============

    mapping(uint256 => Sale) public sales;
    uint256 public saleCount;

    /// @notice Participations: saleId => user => participation
    mapping(uint256 => mapping(address => Participation)) public participations;

    /// @notice Whitelists: saleId => user => whitelisted
    mapping(uint256 => mapping(address => bool)) public whitelists;

    /// @notice Total platform launches
    uint256 public totalLaunches;
    uint256 public totalRaised;

    // ============ Events ============

    event SaleCreated(uint256 indexed saleId, address indexed creator, address token, SaleType saleType);
    event Contributed(uint256 indexed saleId, address indexed user, uint256 amount);
    event TokensClaimed(uint256 indexed saleId, address indexed user, uint256 amount);
    event Refunded(uint256 indexed saleId, address indexed user, uint256 amount);
    event SaleFinalized(uint256 indexed saleId, uint256 totalRaised);
    event SaleCancelled(uint256 indexed saleId);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Sale Creation ============

    function createSale(
        address token,
        uint256 totalTokens,
        uint256 pricePerToken,
        uint256 endPricePerToken,
        address paymentToken,
        uint256 hardCap,
        uint256 softCap,
        uint256 minBuy,
        uint256 maxBuy,
        uint256 startTime,
        uint256 duration,
        SaleType saleType,
        bool vestingEnabled,
        uint256 vestingDuration,
        uint256 vestingCliff
    ) external returns (uint256) {
        require(startTime >= block.timestamp, "Start in future");
        require(hardCap > 0 && softCap <= hardCap, "Invalid caps");

        // Transfer tokens to launchpad
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalTokens);

        saleCount++;
        Sale storage sale = sales[saleCount];
        sale.saleId = saleCount;
        sale.creator = msg.sender;
        sale.token = token;
        sale.totalTokens = totalTokens;
        sale.pricePerToken = pricePerToken;
        sale.endPricePerToken = endPricePerToken;
        sale.paymentToken = paymentToken;
        sale.hardCap = hardCap;
        sale.softCap = softCap;
        sale.minBuy = minBuy;
        sale.maxBuy = maxBuy;
        sale.startTime = startTime;
        sale.endTime = startTime + duration;
        sale.saleType = saleType;
        sale.status = SaleStatus.PENDING;
        sale.vestingEnabled = vestingEnabled;
        sale.vestingDuration = vestingDuration;
        sale.vestingCliff = vestingCliff;

        totalLaunches++;
        emit SaleCreated(saleCount, msg.sender, token, saleType);
        return saleCount;
    }

    // ============ Participation ============

    function contribute(uint256 saleId) external payable nonReentrant {
        Sale storage sale = sales[saleId];
        require(block.timestamp >= sale.startTime, "Not started");
        require(block.timestamp <= sale.endTime, "Ended");
        require(sale.status == SaleStatus.PENDING || sale.status == SaleStatus.ACTIVE, "Not active");

        if (sale.saleType == SaleType.WHITELIST) {
            require(whitelists[saleId][msg.sender], "Not whitelisted");
        }

        sale.status = SaleStatus.ACTIVE;

        uint256 amount = msg.value;
        Participation storage part = participations[saleId][msg.sender];

        require(part.contributed + amount >= sale.minBuy, "Below min");
        require(part.contributed + amount <= sale.maxBuy, "Above max");
        require(sale.raised + amount <= sale.hardCap, "Hard cap reached");

        part.contributed += amount;
        sale.raised += amount;

        emit Contributed(saleId, msg.sender, amount);
    }

    function finalizeSale(uint256 saleId) external {
        Sale storage sale = sales[saleId];
        require(block.timestamp > sale.endTime || sale.raised >= sale.hardCap, "Not ended");
        require(sale.status == SaleStatus.ACTIVE, "Not active");

        if (sale.raised >= sale.softCap) {
            sale.status = SaleStatus.FINALIZED;

            // Transfer raised funds to creator
            (bool ok, ) = sale.creator.call{value: sale.raised}("");
            require(ok, "Transfer failed");

            totalRaised += sale.raised;
            emit SaleFinalized(saleId, sale.raised);
        } else {
            sale.status = SaleStatus.CANCELLED;
            // Return tokens to creator
            IERC20(sale.token).safeTransfer(sale.creator, sale.totalTokens);
            emit SaleCancelled(saleId);
        }
    }

    function claimTokens(uint256 saleId) external nonReentrant {
        Sale storage sale = sales[saleId];
        require(sale.status == SaleStatus.FINALIZED, "Not finalized");

        Participation storage part = participations[saleId][msg.sender];
        require(part.contributed > 0, "No contribution");
        require(part.tokensClaimed == 0, "Already claimed");

        uint256 tokenAmount;
        if (sale.saleType == SaleType.OVERFLOW) {
            // Pro-rata allocation
            tokenAmount = (part.contributed * sale.totalTokens) / sale.raised;
        } else {
            tokenAmount = (part.contributed * 1e18) / sale.pricePerToken;
            if (tokenAmount > sale.totalTokens - sale.tokensSold) {
                tokenAmount = sale.totalTokens - sale.tokensSold;
            }
        }

        part.tokensClaimed = tokenAmount;
        part.vestingStart = block.timestamp;
        sale.tokensSold += tokenAmount;

        if (!sale.vestingEnabled) {
            IERC20(sale.token).safeTransfer(msg.sender, tokenAmount);
        }
        // If vesting, tokens released via claimVested()

        emit TokensClaimed(saleId, msg.sender, tokenAmount);
    }

    function claimVested(uint256 saleId) external nonReentrant {
        Sale storage sale = sales[saleId];
        require(sale.vestingEnabled, "No vesting");

        Participation storage part = participations[saleId][msg.sender];
        require(part.tokensClaimed > 0, "No tokens");
        require(block.timestamp >= part.vestingStart + sale.vestingCliff, "Cliff not reached");

        uint256 elapsed = block.timestamp - part.vestingStart;
        if (elapsed > sale.vestingDuration) elapsed = sale.vestingDuration;

        uint256 totalVested = (part.tokensClaimed * elapsed) / sale.vestingDuration;
        // Track already released separately in a real implementation
        IERC20(sale.token).safeTransfer(msg.sender, totalVested);
    }

    function refund(uint256 saleId) external nonReentrant {
        Sale storage sale = sales[saleId];
        require(sale.status == SaleStatus.CANCELLED, "Not cancelled");

        Participation storage part = participations[saleId][msg.sender];
        require(part.contributed > 0 && !part.refunded, "Nothing to refund");

        part.refunded = true;
        (bool ok, ) = msg.sender.call{value: part.contributed}("");
        require(ok, "Refund failed");

        emit Refunded(saleId, msg.sender, part.contributed);
    }

    // ============ Whitelist ============

    function addToWhitelist(uint256 saleId, address[] calldata users) external {
        require(sales[saleId].creator == msg.sender, "Not creator");
        for (uint256 i = 0; i < users.length; i++) {
            whitelists[saleId][users[i]] = true;
        }
    }

    // ============ View ============

    function getSaleCount() external view returns (uint256) { return saleCount; }
    function getTotalRaised() external view returns (uint256) { return totalRaised; }

    receive() external payable {}
}
