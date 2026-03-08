// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAppStore — DeFi Lego App Marketplace
 * @notice Users compose protocol modules into custom setups without code.
 *         Full flexibility, full abstraction. No-code DeFi.
 *
 * @dev Each "app" is a composable configuration of VSOS modules:
 *      - Pick modules (lending, swap, options, synths, etc.)
 *      - Configure parameters (rates, limits, strategies)
 *      - Deploy as a personal DeFi setup
 *      - Share/sell configurations to other users
 *
 *   "GAME OVER." — Will
 */
contract VibeAppStore is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct AppModule {
        bytes32 moduleId;
        string name;             // "VibeLend", "VibeSwap", "VibeOptions", etc.
        address implementation;   // Contract address
        bytes4[] selectors;      // Allowed function selectors
        bool active;
        uint256 usageCount;
    }

    struct AppConfig {
        uint256 configId;
        address creator;
        string name;
        string description;
        bytes32[] modules;       // Which modules are included
        bytes[] moduleParams;    // Config params per module
        uint256 installCount;
        uint256 rating;          // Average rating (1-5 scaled by 1e18)
        uint256 ratingCount;
        uint256 price;           // 0 = free, >0 = one-time install price
        uint256 createdAt;
        bool active;
        bool verified;           // Community-verified safe config
    }

    struct UserSetup {
        uint256 setupId;
        address owner;
        uint256 configId;        // Which config template
        bytes[] customParams;    // User's custom overrides
        uint256 installedAt;
        bool active;
    }

    // ============ State ============

    /// @notice Registry of available modules
    mapping(bytes32 => AppModule) public modules;
    bytes32[] public moduleList;

    /// @notice App configurations (templates)
    mapping(uint256 => AppConfig) public configs;
    uint256 public configCount;

    /// @notice User setups (installed apps)
    mapping(uint256 => UserSetup) public setups;
    uint256 public setupCount;

    /// @notice User's installed setups
    mapping(address => uint256[]) public userSetups;

    /// @notice Ratings: configId => user => rating
    mapping(uint256 => mapping(address => uint256)) public userRatings;

    /// @notice Revenue from paid apps
    mapping(address => uint256) public creatorRevenue;

    /// @notice Featured/curated apps
    uint256[] public featuredApps;

    // ============ Events ============

    event ModuleRegistered(bytes32 indexed moduleId, string name, address implementation);
    event AppPublished(uint256 indexed configId, address indexed creator, string name);
    event AppInstalled(uint256 indexed setupId, address indexed user, uint256 configId);
    event AppUninstalled(uint256 indexed setupId, address indexed user);
    event AppRated(uint256 indexed configId, address indexed user, uint256 rating);
    event AppVerified(uint256 indexed configId);
    event AppFeatured(uint256 indexed configId);
    event RevenueWithdrawn(address indexed creator, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Module Registry ============

    /**
     * @notice Register a VSOS module that apps can compose with
     */
    function registerModule(
        string calldata name,
        address implementation,
        bytes4[] calldata selectors
    ) external onlyOwner {
        bytes32 moduleId = keccak256(abi.encodePacked(name, implementation));

        modules[moduleId] = AppModule({
            moduleId: moduleId,
            name: name,
            implementation: implementation,
            selectors: selectors,
            active: true,
            usageCount: 0
        });

        moduleList.push(moduleId);
        emit ModuleRegistered(moduleId, name, implementation);
    }

    // ============ App Publishing ============

    /**
     * @notice Publish an app configuration (anyone can publish)
     * @param name App name
     * @param description What this app does
     * @param moduleIds Which modules to compose
     * @param moduleParams Configuration for each module
     * @param price Install price (0 for free)
     */
    function publishApp(
        string calldata name,
        string calldata description,
        bytes32[] calldata moduleIds,
        bytes[] calldata moduleParams,
        uint256 price
    ) external returns (uint256) {
        require(moduleIds.length > 0, "Need at least one module");
        require(moduleIds.length == moduleParams.length, "Params mismatch");

        // Verify all modules exist and are active
        for (uint256 i = 0; i < moduleIds.length; i++) {
            require(modules[moduleIds[i]].active, "Module not active");
            modules[moduleIds[i]].usageCount++;
        }

        configCount++;
        AppConfig storage config = configs[configCount];
        config.configId = configCount;
        config.creator = msg.sender;
        config.name = name;
        config.description = description;
        config.modules = moduleIds;
        config.moduleParams = moduleParams;
        config.price = price;
        config.createdAt = block.timestamp;
        config.active = true;

        emit AppPublished(configCount, msg.sender, name);
        return configCount;
    }

    /**
     * @notice Install an app (creates a personal setup)
     */
    function installApp(
        uint256 configId,
        bytes[] calldata customParams
    ) external payable nonReentrant returns (uint256) {
        AppConfig storage config = configs[configId];
        require(config.active, "App not active");

        if (config.price > 0) {
            require(msg.value >= config.price, "Insufficient payment");
            creatorRevenue[config.creator] += config.price;
            // Refund excess
            if (msg.value > config.price) {
                (bool ok, ) = msg.sender.call{value: msg.value - config.price}("");
                require(ok, "Refund failed");
            }
        }

        config.installCount++;
        setupCount++;

        setups[setupCount] = UserSetup({
            setupId: setupCount,
            owner: msg.sender,
            configId: configId,
            customParams: customParams,
            installedAt: block.timestamp,
            active: true
        });

        userSetups[msg.sender].push(setupCount);

        emit AppInstalled(setupCount, msg.sender, configId);
        return setupCount;
    }

    /**
     * @notice Uninstall an app
     */
    function uninstallApp(uint256 setupId) external {
        require(setups[setupId].owner == msg.sender, "Not owner");
        setups[setupId].active = false;
        emit AppUninstalled(setupId, msg.sender);
    }

    /**
     * @notice Rate an app (1-5)
     */
    function rateApp(uint256 configId, uint256 rating) external {
        require(rating >= 1 && rating <= 5, "Rating 1-5");
        require(configs[configId].active, "App not active");
        require(userRatings[configId][msg.sender] == 0, "Already rated");

        userRatings[configId][msg.sender] = rating;

        AppConfig storage config = configs[configId];
        uint256 totalRating = config.rating * config.ratingCount + rating * 1e18;
        config.ratingCount++;
        config.rating = totalRating / config.ratingCount;

        emit AppRated(configId, msg.sender, rating);
    }

    /**
     * @notice Mark an app as community-verified
     */
    function verifyApp(uint256 configId) external onlyOwner {
        configs[configId].verified = true;
        emit AppVerified(configId);
    }

    /**
     * @notice Feature an app on the store front page
     */
    function featureApp(uint256 configId) external onlyOwner {
        featuredApps.push(configId);
        emit AppFeatured(configId);
    }

    /**
     * @notice Withdraw revenue from paid app sales
     */
    function withdrawRevenue() external nonReentrant {
        uint256 amount = creatorRevenue[msg.sender];
        require(amount > 0, "No revenue");
        creatorRevenue[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit RevenueWithdrawn(msg.sender, amount);
    }

    // ============ View Functions ============

    function getModuleCount() external view returns (uint256) {
        return moduleList.length;
    }

    function getUserSetups(address user) external view returns (uint256[] memory) {
        return userSetups[user];
    }

    function getFeaturedApps() external view returns (uint256[] memory) {
        return featuredApps;
    }

    function getAppModules(uint256 configId) external view returns (bytes32[] memory) {
        return configs[configId].modules;
    }
}
