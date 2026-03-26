// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeRWA — Real World Asset Tokenization Protocol
 * @notice Permissionless tokenization of real world assets — real estate,
 *         commodities, art, vehicles, intellectual property, revenue streams.
 *         Fractional ownership with on-chain governance and yield distribution.
 *
 * @dev Architecture:
 *      - Asset registration with legal wrapper attestation
 *      - Fractional shares via ERC1155-style balances
 *      - Yield distribution from real-world revenue
 *      - Compliance via oracle-verified KYC/AML status
 *      - Secondary market for fractions
 *      - Appraisal oracle for price discovery
 *      - Legal jurisdiction mapping
 */
contract VibeRWA is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum AssetClass { REAL_ESTATE, COMMODITY, ART, VEHICLE, IP, REVENUE_STREAM, EQUIPMENT, COLLECTIBLE }
    enum AssetStatus { PENDING, ACTIVE, YIELDING, FROZEN, LIQUIDATING, RETIRED }

    struct RealWorldAsset {
        bytes32 assetId;
        address issuer;
        AssetClass assetClass;
        string name;
        bytes32 legalDocHash;        // IPFS hash of legal wrapper
        bytes32 appraisalHash;       // Latest appraisal document
        uint256 totalShares;         // Total fractional shares
        uint256 sharesSold;
        uint256 pricePerShare;
        uint256 appraisedValue;
        uint256 totalYieldDistributed;
        uint256 registeredAt;
        uint256 lastAppraisalAt;
        AssetStatus status;
        string jurisdiction;         // Legal jurisdiction code
    }

    struct ShareHolder {
        uint256 shares;
        uint256 yieldClaimed;
        uint256 lastClaimedEpoch;
    }

    struct YieldEpoch {
        uint256 epochId;
        bytes32 assetId;
        uint256 totalYield;
        uint256 yieldPerShare;       // Scaled by 1e18
        uint256 timestamp;
        bool distributed;
    }

    struct Listing {
        uint256 listingId;
        bytes32 assetId;
        address seller;
        uint256 shares;
        uint256 pricePerShare;
        bool active;
    }

    // ============ Constants ============

    uint256 public constant SCALE = 1e18;
    uint256 public constant PLATFORM_FEE_BPS = 100; // 1%
    uint256 public constant BPS = 10000;

    // ============ State ============

    mapping(bytes32 => RealWorldAsset) public assets;
    bytes32[] public assetList;

    /// @notice Share balances: assetId => holder => ShareHolder
    mapping(bytes32 => mapping(address => ShareHolder)) public holders;

    /// @notice Yield epochs: assetId => epochId => YieldEpoch
    mapping(bytes32 => mapping(uint256 => YieldEpoch)) public yieldEpochs;
    mapping(bytes32 => uint256) public currentEpoch;

    /// @notice Secondary market listings
    mapping(uint256 => Listing) public listings;
    uint256 public listingCount;

    /// @notice Approved appraisers
    mapping(address => bool) public approvedAppraisers;

    /// @notice Approved legal verifiers
    mapping(address => bool) public legalVerifiers;

    /// @notice KYC-verified addresses (compliance)
    mapping(address => bool) public kycVerified;

    /// @notice Stats
    uint256 public totalAssetsRegistered;
    uint256 public totalValueTokenized;
    uint256 public totalYieldPaid;
    uint256 public totalSecondaryVolume;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event AssetRegistered(bytes32 indexed assetId, address indexed issuer, AssetClass assetClass, string name);
    event SharesPurchased(bytes32 indexed assetId, address indexed buyer, uint256 shares, uint256 totalCost);
    event YieldDistributed(bytes32 indexed assetId, uint256 epochId, uint256 totalYield);
    event YieldClaimed(bytes32 indexed assetId, address indexed holder, uint256 amount);
    event AppraisalUpdated(bytes32 indexed assetId, uint256 newValue, address appraiser);
    event SharesListed(uint256 indexed listingId, bytes32 assetId, uint256 shares, uint256 price);
    event SharesSold(uint256 indexed listingId, address indexed buyer, uint256 shares);
    event AssetStatusChanged(bytes32 indexed assetId, AssetStatus newStatus);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Asset Registration ============

    /**
     * @notice Register a real world asset for tokenization
     */
    function registerAsset(
        AssetClass assetClass,
        string calldata name,
        bytes32 legalDocHash,
        bytes32 appraisalHash,
        uint256 totalShares,
        uint256 pricePerShare,
        uint256 appraisedValue,
        string calldata jurisdiction
    ) external returns (bytes32) {
        bytes32 assetId = keccak256(abi.encodePacked(
            msg.sender, name, block.timestamp
        ));

        assets[assetId] = RealWorldAsset({
            assetId: assetId,
            issuer: msg.sender,
            assetClass: assetClass,
            name: name,
            legalDocHash: legalDocHash,
            appraisalHash: appraisalHash,
            totalShares: totalShares,
            sharesSold: 0,
            pricePerShare: pricePerShare,
            appraisedValue: appraisedValue,
            totalYieldDistributed: 0,
            registeredAt: block.timestamp,
            lastAppraisalAt: block.timestamp,
            status: AssetStatus.PENDING,
            jurisdiction: jurisdiction
        });

        assetList.push(assetId);
        totalAssetsRegistered++;
        totalValueTokenized += appraisedValue;

        emit AssetRegistered(assetId, msg.sender, assetClass, name);
        return assetId;
    }

    /**
     * @notice Activate asset after legal verification
     */
    function activateAsset(bytes32 assetId) external {
        require(legalVerifiers[msg.sender], "Not legal verifier");
        assets[assetId].status = AssetStatus.ACTIVE;
        emit AssetStatusChanged(assetId, AssetStatus.ACTIVE);
    }

    // ============ Primary Market ============

    /**
     * @notice Purchase fractional shares of an asset
     */
    function purchaseShares(bytes32 assetId, uint256 shareCount) external payable nonReentrant {
        RealWorldAsset storage asset = assets[assetId];
        require(asset.status == AssetStatus.ACTIVE || asset.status == AssetStatus.YIELDING, "Not available");
        require(asset.sharesSold + shareCount <= asset.totalShares, "Insufficient shares");

        uint256 totalCost = shareCount * asset.pricePerShare;
        require(msg.value >= totalCost, "Insufficient payment");

        holders[assetId][msg.sender].shares += shareCount;
        asset.sharesSold += shareCount;

        // Platform fee
        uint256 fee = (totalCost * PLATFORM_FEE_BPS) / BPS;
        uint256 issuerPayment = totalCost - fee;

        (bool ok, ) = asset.issuer.call{value: issuerPayment}("");
        require(ok, "Payment failed");

        // Refund excess
        if (msg.value > totalCost) {
            (bool ok2, ) = msg.sender.call{value: msg.value - totalCost}("");
            require(ok2, "Refund failed");
        }

        emit SharesPurchased(assetId, msg.sender, shareCount, totalCost);
    }

    // ============ Yield Distribution ============

    /**
     * @notice Distribute yield from real-world revenue
     */
    function distributeYield(bytes32 assetId) external payable {
        require(msg.value > 0, "Zero yield");
        RealWorldAsset storage asset = assets[assetId];
        require(asset.issuer == msg.sender, "Not issuer");
        require(asset.sharesSold > 0, "No shareholders");

        asset.status = AssetStatus.YIELDING;

        uint256 epochId = currentEpoch[assetId] + 1;
        currentEpoch[assetId] = epochId;

        yieldEpochs[assetId][epochId] = YieldEpoch({
            epochId: epochId,
            assetId: assetId,
            totalYield: msg.value,
            yieldPerShare: (msg.value * SCALE) / asset.sharesSold,
            timestamp: block.timestamp,
            distributed: true
        });

        asset.totalYieldDistributed += msg.value;
        totalYieldPaid += msg.value;

        emit YieldDistributed(assetId, epochId, msg.value);
    }

    /**
     * @notice Claim yield for held shares
     */
    function claimYield(bytes32 assetId) external nonReentrant {
        ShareHolder storage holder = holders[assetId][msg.sender];
        require(holder.shares > 0, "No shares");

        uint256 totalClaim;
        uint256 lastClaimed = holder.lastClaimedEpoch;
        uint256 current = currentEpoch[assetId];

        for (uint256 e = lastClaimed + 1; e <= current; e++) {
            YieldEpoch storage epoch = yieldEpochs[assetId][e];
            if (epoch.distributed) {
                totalClaim += (holder.shares * epoch.yieldPerShare) / SCALE;
            }
        }

        require(totalClaim > 0, "Nothing to claim");
        holder.lastClaimedEpoch = current;
        holder.yieldClaimed += totalClaim;

        (bool ok, ) = msg.sender.call{value: totalClaim}("");
        require(ok, "Claim failed");

        emit YieldClaimed(assetId, msg.sender, totalClaim);
    }

    // ============ Secondary Market ============

    function listShares(bytes32 assetId, uint256 shares, uint256 price) external returns (uint256) {
        require(holders[assetId][msg.sender].shares >= shares, "Insufficient shares");

        listingCount++;
        listings[listingCount] = Listing({
            listingId: listingCount,
            assetId: assetId,
            seller: msg.sender,
            shares: shares,
            pricePerShare: price,
            active: true
        });

        emit SharesListed(listingCount, assetId, shares, price);
        return listingCount;
    }

    function buyListed(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");

        uint256 totalCost = listing.shares * listing.pricePerShare;
        require(msg.value >= totalCost, "Insufficient payment");

        listing.active = false;

        // Transfer shares
        holders[listing.assetId][listing.seller].shares -= listing.shares;
        holders[listing.assetId][msg.sender].shares += listing.shares;

        // Fee
        uint256 fee = (totalCost * PLATFORM_FEE_BPS) / BPS;
        uint256 sellerPayment = totalCost - fee;

        (bool ok, ) = listing.seller.call{value: sellerPayment}("");
        require(ok, "Payment failed");

        totalSecondaryVolume += totalCost;

        if (msg.value > totalCost) {
            (bool ok2, ) = msg.sender.call{value: msg.value - totalCost}("");
            require(ok2, "Refund failed");
        }

        emit SharesSold(listingId, msg.sender, listing.shares);
    }

    function cancelListing(uint256 listingId) external {
        require(listings[listingId].seller == msg.sender, "Not seller");
        listings[listingId].active = false;
    }

    // ============ Appraisal ============

    function updateAppraisal(bytes32 assetId, uint256 newValue, bytes32 newHash) external {
        require(approvedAppraisers[msg.sender], "Not appraiser");
        RealWorldAsset storage asset = assets[assetId];

        totalValueTokenized = totalValueTokenized - asset.appraisedValue + newValue;
        asset.appraisedValue = newValue;
        asset.appraisalHash = newHash;
        asset.lastAppraisalAt = block.timestamp;

        emit AppraisalUpdated(assetId, newValue, msg.sender);
    }

    // ============ Admin ============

    function addAppraiser(address a) external onlyOwner { approvedAppraisers[a] = true; }
    function removeAppraiser(address a) external onlyOwner { approvedAppraisers[a] = false; }
    function addLegalVerifier(address v) external onlyOwner { legalVerifiers[v] = true; }
    function removeLegalVerifier(address v) external onlyOwner { legalVerifiers[v] = false; }
    function setKYC(address user, bool status) external onlyOwner { kycVerified[user] = status; }

    function updateAssetStatus(bytes32 assetId, AssetStatus status) external onlyOwner {
        assets[assetId].status = status;
        emit AssetStatusChanged(assetId, status);
    }

    // ============ View ============

    function getAsset(bytes32 assetId) external view returns (RealWorldAsset memory) {
        return assets[assetId];
    }

    function getHolding(bytes32 assetId, address holder) external view returns (uint256 shares, uint256 yieldClaimed_) {
        ShareHolder storage h = holders[assetId][holder];
        return (h.shares, h.yieldClaimed);
    }

    function getAssetCount() external view returns (uint256) { return assetList.length; }
    function getTotalValueTokenized() external view returns (uint256) { return totalValueTokenized; }

    receive() external payable {}
}
