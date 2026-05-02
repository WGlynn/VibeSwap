// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeHarbergerPublicGoods — Harberger Tax for Semi-Public Goods
 * @notice Universal Harberger taxation applied to ALL semi-public goods in VSOS.
 *         DNS names, app store listings, premium slots, data feeds, API endpoints —
 *         anything that has excludable but non-rivalrous value.
 *
 * @dev Harberger mechanics:
 *      - Owner self-assesses value of the asset
 *      - Pays tax proportional to self-assessed value (annual rate)
 *      - Anyone can buy at the self-assessed price (forced sale)
 *      - Tax revenue funds public goods (grants, infrastructure, research)
 *      - Creates efficient allocation — no squatting, no speculation
 *
 * Asset types: DNS names, app store slots, gauge positions, API keys,
 * data feed slots, oracle slots, priority positions, premium features
 */
contract VibeHarbergerPublicGoods is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant TAX_RATE_BPS = 1000; // 10% annual tax on self-assessed value
    uint256 public constant BPS = 10000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MIN_PRICE = 0.001 ether;

    // ============ Types ============

    enum AssetCategory { DNS_NAME, APP_SLOT, GAUGE_POSITION, API_KEY, DATA_FEED, ORACLE_SLOT, PRIORITY_POSITION, PREMIUM_FEATURE }

    struct HarbergerAsset {
        bytes32 assetId;
        AssetCategory category;
        address owner;
        string name;
        uint256 selfAssessedValue;   // Owner's valuation
        uint256 taxDeposit;          // Prepaid tax balance
        uint256 lastTaxCollection;
        uint256 totalTaxPaid;
        uint256 acquisitionCount;    // Times this asset changed hands
        bool active;
    }

    // ============ State ============

    mapping(bytes32 => HarbergerAsset) public assets;
    bytes32[] public assetList;

    /// @notice Tax recipients (public goods funds)
    address public publicGoodsFund;
    address public grantsFund;
    address public researchFund;

    /// @notice Tax split: 50% public goods, 30% grants, 20% research
    uint256 public constant PUBLIC_GOODS_SHARE = 5000;
    uint256 public constant GRANTS_SHARE = 3000;
    uint256 public constant RESEARCH_SHARE = 2000;

    /// @notice Custom tax rates per category
    mapping(AssetCategory => uint256) public categoryTaxRateBps;

    /// @notice Stats
    uint256 public totalAssets;
    uint256 public totalTaxCollected;
    uint256 public totalForcedSales;
    uint256 public totalValueLocked;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event AssetCreated(bytes32 indexed assetId, AssetCategory category, string name);
    event AssetAcquired(bytes32 indexed assetId, address indexed oldOwner, address indexed newOwner, uint256 price);
    event TaxDeposited(bytes32 indexed assetId, uint256 amount);
    event TaxCollected(bytes32 indexed assetId, uint256 amount);
    event ValueReassessed(bytes32 indexed assetId, uint256 oldValue, uint256 newValue);
    event AssetForeclosed(bytes32 indexed assetId, address indexed formerOwner);

    // ============ Constructor ============

    /// @dev TRP C23-F6: Lock the implementation contract so only proxies can be
    ///      initialized. Without this, anyone could call `initialize` directly on
    ///      the deployed implementation and seize its `owner()` slot. The impl
    ///      holds no funds, but a hijacked impl is a persistent footgun for the
    ///      upgrade path and a confusing artifact for indexers.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Init ============

    function initialize(
        address _publicGoodsFund,
        address _grantsFund,
        address _researchFund
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        publicGoodsFund = _publicGoodsFund;
        grantsFund = _grantsFund;
        researchFund = _researchFund;

        // Default tax rates per category
        categoryTaxRateBps[AssetCategory.DNS_NAME] = 1000;           // 10%
        categoryTaxRateBps[AssetCategory.APP_SLOT] = 700;            // 7%
        categoryTaxRateBps[AssetCategory.GAUGE_POSITION] = 1500;     // 15%
        categoryTaxRateBps[AssetCategory.API_KEY] = 500;             // 5%
        categoryTaxRateBps[AssetCategory.DATA_FEED] = 800;           // 8%
        categoryTaxRateBps[AssetCategory.ORACLE_SLOT] = 1200;        // 12%
        categoryTaxRateBps[AssetCategory.PRIORITY_POSITION] = 2000;  // 20%
        categoryTaxRateBps[AssetCategory.PREMIUM_FEATURE] = 600;     // 6%
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Asset Creation ============

    /**
     * @notice Create a new Harberger-taxed asset
     */
    function createAsset(
        AssetCategory category,
        string calldata name,
        uint256 initialValue
    ) external payable nonReentrant returns (bytes32) {
        require(initialValue >= MIN_PRICE, "Value too low");
        require(msg.value > 0, "Need tax deposit");

        bytes32 assetId = keccak256(abi.encodePacked(name, category, block.timestamp));
        require(!assets[assetId].active, "Asset exists");

        assets[assetId] = HarbergerAsset({
            assetId: assetId,
            category: category,
            owner: msg.sender,
            name: name,
            selfAssessedValue: initialValue,
            taxDeposit: msg.value,
            lastTaxCollection: block.timestamp,
            totalTaxPaid: 0,
            acquisitionCount: 0,
            active: true
        });

        assetList.push(assetId);
        totalAssets++;
        totalValueLocked += msg.value;

        emit AssetCreated(assetId, category, name);
        return assetId;
    }

    // ============ Forced Sale (Harberger Core) ============

    /**
     * @notice Buy an asset at its self-assessed price (forced sale)
     * @dev Anyone can buy. Previous owner MUST sell at their stated price.
     *      This is the core Harberger mechanism — it prevents over-valuation.
     */
    function buyAsset(bytes32 assetId, uint256 newSelfAssessedValue) external payable nonReentrant {
        HarbergerAsset storage asset = assets[assetId];
        require(asset.active, "Not active");
        require(msg.sender != asset.owner, "Already owner");
        require(msg.value >= asset.selfAssessedValue, "Pay the assessed price");
        require(newSelfAssessedValue >= MIN_PRICE, "New value too low");

        // Collect pending tax first
        _collectTax(assetId);

        address oldOwner = asset.owner;
        uint256 price = asset.selfAssessedValue;
        uint256 taxRefund = asset.taxDeposit;

        // Transfer ownership
        asset.owner = msg.sender;
        asset.selfAssessedValue = newSelfAssessedValue;
        asset.taxDeposit = msg.value - price; // Excess becomes new tax deposit
        asset.lastTaxCollection = block.timestamp;
        asset.acquisitionCount++;

        totalForcedSales++;

        // Pay old owner: price + remaining tax deposit
        uint256 payout = price + taxRefund;
        if (payout > 0) {
            (bool ok, ) = oldOwner.call{value: payout}("");
            require(ok, "Payment failed");
        }

        emit AssetAcquired(assetId, oldOwner, msg.sender, price);
    }

    // ============ Tax Management ============

    /**
     * @notice Deposit more tax prepayment
     */
    function depositTax(bytes32 assetId) external payable {
        require(assets[assetId].owner == msg.sender, "Not owner");
        require(msg.value > 0, "Zero deposit");

        assets[assetId].taxDeposit += msg.value;
        totalValueLocked += msg.value;

        emit TaxDeposited(assetId, msg.value);
    }

    /**
     * @notice Reassess the value of your asset
     * @dev Lowering value = less tax but easier to buy
     *      Raising value = more tax but harder to buy
     */
    function reassessValue(bytes32 assetId, uint256 newValue) external {
        HarbergerAsset storage asset = assets[assetId];
        require(asset.owner == msg.sender, "Not owner");
        require(newValue >= MIN_PRICE, "Value too low");

        _collectTax(assetId);

        uint256 oldValue = asset.selfAssessedValue;
        asset.selfAssessedValue = newValue;

        emit ValueReassessed(assetId, oldValue, newValue);
    }

    /**
     * @notice Collect pending tax (permissionless)
     */
    function collectTax(bytes32 assetId) external {
        _collectTax(assetId);
    }

    /**
     * @notice Foreclose an asset whose tax deposit is depleted
     */
    function foreclose(bytes32 assetId) external nonReentrant {
        HarbergerAsset storage asset = assets[assetId];
        require(asset.active, "Not active");

        uint256 taxOwed = _calculateTaxOwed(assetId);
        require(taxOwed > asset.taxDeposit, "Not foreclosable");

        address formerOwner = asset.owner;
        asset.active = false;
        totalAssets--;

        // Remaining deposit goes to public goods
        if (asset.taxDeposit > 0) {
            _distributeTax(asset.taxDeposit);
            asset.taxDeposit = 0;
        }

        emit AssetForeclosed(assetId, formerOwner);
    }

    // ============ Internal ============

    function _collectTax(bytes32 assetId) internal {
        HarbergerAsset storage asset = assets[assetId];
        if (!asset.active) return;

        uint256 taxOwed = _calculateTaxOwed(assetId);
        if (taxOwed == 0) return;

        uint256 taxPaid = taxOwed > asset.taxDeposit ? asset.taxDeposit : taxOwed;

        asset.taxDeposit -= taxPaid;
        asset.totalTaxPaid += taxPaid;
        asset.lastTaxCollection = block.timestamp;
        totalTaxCollected += taxPaid;

        _distributeTax(taxPaid);

        emit TaxCollected(assetId, taxPaid);
    }

    function _calculateTaxOwed(bytes32 assetId) internal view returns (uint256) {
        HarbergerAsset storage asset = assets[assetId];
        uint256 elapsed = block.timestamp - asset.lastTaxCollection;
        uint256 taxRate = categoryTaxRateBps[asset.category];

        return (asset.selfAssessedValue * taxRate * elapsed) / (BPS * SECONDS_PER_YEAR);
    }

    function _distributeTax(uint256 amount) internal {
        uint256 publicShare = (amount * PUBLIC_GOODS_SHARE) / BPS;
        uint256 grantsShare = (amount * GRANTS_SHARE) / BPS;
        uint256 researchShare = amount - publicShare - grantsShare;

        if (publicShare > 0) {
            (bool ok1, ) = publicGoodsFund.call{value: publicShare}("");
            require(ok1, "PG transfer failed");
        }
        if (grantsShare > 0) {
            (bool ok2, ) = grantsFund.call{value: grantsShare}("");
            require(ok2, "Grants transfer failed");
        }
        if (researchShare > 0) {
            (bool ok3, ) = researchFund.call{value: researchShare}("");
            require(ok3, "Research transfer failed");
        }
    }

    // ============ Admin ============

    function setCategoryTaxRate(AssetCategory category, uint256 rateBps) external onlyOwner {
        require(rateBps <= 5000, "Max 50%");
        categoryTaxRateBps[category] = rateBps;
    }

    // ============ View ============

    function getTaxOwed(bytes32 assetId) external view returns (uint256) {
        return _calculateTaxOwed(assetId);
    }

    function getTimeUntilForeclosure(bytes32 assetId) external view returns (uint256) {
        HarbergerAsset storage asset = assets[assetId];
        if (!asset.active) return 0;

        uint256 taxRate = categoryTaxRateBps[asset.category];
        if (taxRate == 0 || asset.selfAssessedValue == 0) return type(uint256).max;

        // seconds = deposit * BPS * SECONDS_PER_YEAR / (value * rate)
        return (asset.taxDeposit * BPS * SECONDS_PER_YEAR) / (asset.selfAssessedValue * taxRate);
    }

    function getAssetCount() external view returns (uint256) { return totalAssets; }
    function getTotalTaxCollected() external view returns (uint256) { return totalTaxCollected; }

    receive() external payable {
        totalValueLocked += msg.value;
    }
}
