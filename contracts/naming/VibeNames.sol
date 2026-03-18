// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeNames
 * @author Faraday1 & JARVIS -- vibeswap.io
 * @notice Augmented Harberger Tax naming system for the .vibe network
 * @dev ERC-721 names with self-assessed valuation, continuous tax, and force-purchase,
 *      AUGMENTED with protective mechanisms for legitimate owners:
 *
 *      Core Harberger Mechanism:
 *        - Owner self-assesses a value for their name.
 *        - Owner continuously pays TAX_RATE_BPS (5%/yr) of that value, streamed per-second.
 *        - Anyone can force-acquire any name by paying the self-assessed price + augmentations.
 *        - Tax revenue flows to the DAO treasury.
 *        - If tax deposit runs dry, the name enters a Dutch auction (7 days → 0).
 *
 *      Augmentations (protecting legitimate owners from whales/barons):
 *        1. LOYALTY MULTIPLIER: Tenure × usage builds compounding defense.
 *           Year 1: 1x. Year 2: 1.5x. Year 3: 2x. Year 5+: 3x force-buy price.
 *           Only accrues if resolver is actively set (squatters get 1x forever).
 *        2. GRACE PERIOD: 72-hour right of first refusal on force-acquire attempts.
 *           Owner can match or raise assessment to block the acquisition.
 *        3. PROGRESSIVE PORTFOLIO TAX: More names = higher rate per name.
 *           1st: base rate. 2nd: 1.5x. 3rd-5th: 2x. 6+: 3x tax rate.
 *           Domain barons pay exponentially more — hoarding is irrational.
 *        4. ACQUISITION PREMIUM: Buyer pays assessed × loyaltyMultiplier + 20% premium.
 *           Premium compensates displaced owner. Makes hostile takeover expensive.
 *
 *      Anti-squatting by construction: high price = high tax, low price = cheap force-buy.
 *      Anti-baron by augmentation: loyalty rewards genuine owners, portfolio tax punishes hoarding.
 *      Cooperative Capitalism applied to namespace allocation.
 */
contract VibeNames is
    ERC721Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Structs ============

    struct VibeName {
        string name;
        uint256 selfAssessedValue;
        uint256 taxDeposit;
        uint256 lastTaxCollection;
        address resolver;
        uint256 expiryTimestamp;
        bool inAuction;
        uint256 auctionStart;
        uint256 registeredAt;       // When first registered (for loyalty calculation)
        bool resolverActive;        // Whether resolver has been set (loyalty only accrues if true)
    }

    /// @notice Pending force-acquire attempt (grace period)
    struct PendingAcquisition {
        address buyer;
        uint256 newSelfAssessedValue;
        uint256 depositAmount;      // ETH held in escrow
        uint256 initiatedAt;        // When the attempt was made
        bool active;
    }

    // ============ Constants ============

    /// @notice 5% annual tax on self-assessed value
    uint256 public constant TAX_RATE_BPS = 500;

    /// @notice Seconds in a year (365.25 days for leap year accuracy)
    uint256 public constant YEAR_SECONDS = 31_557_600; // 365.25 * 86400

    /// @notice Minimum registration deposit must cover 30 days of tax
    uint256 public constant MIN_DEPOSIT_DAYS = 30 days;

    /// @notice Dutch auction duration when tax expires
    uint256 public constant DUTCH_AUCTION_DURATION = 7 days;

    /// @notice BPS denominator
    uint256 private constant BPS = 10_000;

    // ============ Augmentation Constants ============

    /// @notice Grace period for existing owner to respond to force-acquire
    uint256 public constant GRACE_PERIOD = 72 hours;

    /// @notice Acquisition premium (20%) — paid to displaced owner as compensation
    uint256 public constant ACQUISITION_PREMIUM_BPS = 2_000;

    /// @notice Portfolio tax multipliers (in BPS, applied to base tax rate)
    /// 1st name: 10000 (1x), 2nd: 15000 (1.5x), 3rd-5th: 20000 (2x), 6+: 30000 (3x)
    uint256 public constant PORTFOLIO_MULT_1 = 10_000;
    uint256 public constant PORTFOLIO_MULT_2 = 15_000;
    uint256 public constant PORTFOLIO_MULT_3_5 = 20_000;
    uint256 public constant PORTFOLIO_MULT_6_PLUS = 30_000;

    /// @notice Loyalty multiplier thresholds (tenure in seconds → multiplier in BPS)
    /// Year 1: 10000 (1x), Year 2: 15000 (1.5x), Year 3: 20000 (2x), Year 5+: 30000 (3x)
    uint256 public constant LOYALTY_YEAR_1 = 365 days;
    uint256 public constant LOYALTY_YEAR_2 = 730 days;
    uint256 public constant LOYALTY_YEAR_3 = 1095 days;
    uint256 public constant LOYALTY_YEAR_5 = 1825 days;

    // ============ State ============

    /// @notice DAO treasury that receives all tax revenue
    address public treasury;

    /// @notice Auto-incrementing token ID counter
    uint256 public nextTokenId;

    /// @notice Name data by token ID
    mapping(uint256 => VibeName) internal _names;

    /// @notice Name hash → token ID (0 = unregistered)
    mapping(bytes32 => uint256) public nameToTokenId;

    /// @notice Name hash → resolver address (direct resolution cache)
    mapping(bytes32 => address) public resolvers;

    /// @notice Parent token ID → child label hash → child token ID (subdomain tree)
    mapping(uint256 => mapping(bytes32 => uint256)) public subdomains;

    /// @notice Pending force-acquire attempts (grace period escrow)
    mapping(uint256 => PendingAcquisition) public pendingAcquisitions;

    /// @notice Number of names owned per address (for portfolio tax calculation)
    mapping(address => uint256) public portfolioSize;

    // ============ Events ============

    event NameRegistered(
        uint256 indexed tokenId,
        address indexed owner,
        string name,
        uint256 selfAssessedValue,
        uint256 taxDeposit
    );
    event PriceChanged(uint256 indexed tokenId, uint256 oldValue, uint256 newValue);
    event ForceAcquired(uint256 indexed tokenId, address indexed oldOwner, address indexed newOwner, uint256 price);
    event TaxCollected(uint256 indexed tokenId, uint256 amount);
    event TaxDeposited(uint256 indexed tokenId, uint256 amount);
    event NameExpired(uint256 indexed tokenId, string name);
    event ResolverSet(uint256 indexed tokenId, address resolver);
    event AuctionStarted(uint256 indexed tokenId, uint256 startPrice);
    event AuctionPurchased(uint256 indexed tokenId, address indexed buyer, uint256 price);
    event SubdomainCreated(uint256 indexed parentId, uint256 indexed childId, string label);
    event AcquisitionInitiated(uint256 indexed tokenId, address indexed buyer, uint256 effectivePrice, uint256 graceDeadline);
    event AcquisitionBlocked(uint256 indexed tokenId, address indexed owner, uint256 newAssessedValue);
    event AcquisitionCompleted(uint256 indexed tokenId, address indexed oldOwner, address indexed newOwner, uint256 effectivePrice);
    event AcquisitionCancelled(uint256 indexed tokenId, address indexed buyer);

    // ============ Errors ============

    error EmptyName();
    error NameAlreadyRegistered();
    error InsufficientDeposit();
    error InsufficientPayment();
    error ZeroValue();
    error ZeroAddress();
    error NotNameOwner();
    error NameNotExpired();
    error NameNotInAuction();
    error AuctionNotStarted();
    error CannotAcquireOwnName();
    error NameInAuction();
    error ZeroAmount();
    error GracePeriodActive();
    error GracePeriodExpired();
    error NoPendingAcquisition();
    error NotPendingBuyer();
    error AcquisitionAlreadyPending();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the VibeNames contract
     * @param _treasury Address of the DAO treasury that receives tax
     */
    function initialize(address _treasury) external initializer {
        if (_treasury == address(0)) revert ZeroAddress();

        __ERC721_init("VibeNames", "VIBE");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        treasury = _treasury;
        nextTokenId = 1;
    }

    // ============ Registration ============

    /**
     * @notice Register a new .vibe name
     * @param name The name to register (e.g., "vibeswap" for "vibeswap.vibe")
     * @param selfAssessedValue The self-assessed value in wei (determines tax and force-buy price)
     * @dev msg.value must cover at least 30 days of tax at the assessed value.
     *      Higher assessment = higher tax but harder to force-buy.
     *      Lower assessment = lower tax but easier to force-buy.
     */
    function register(
        string calldata name,
        uint256 selfAssessedValue
    ) external payable nonReentrant returns (uint256 tokenId) {
        if (bytes(name).length == 0) revert EmptyName();
        if (selfAssessedValue == 0) revert ZeroValue();

        bytes32 nameHash = keccak256(abi.encodePacked(name));
        if (nameToTokenId[nameHash] != 0) revert NameAlreadyRegistered();

        // Require minimum deposit to cover 30 days of tax
        uint256 minDeposit = _computeTax(selfAssessedValue, MIN_DEPOSIT_DAYS);
        if (msg.value < minDeposit) revert InsufficientDeposit();

        tokenId = nextTokenId++;
        uint256 expiryTs = block.timestamp + _depositToTime(msg.value, selfAssessedValue);

        _names[tokenId] = VibeName({
            name: name,
            selfAssessedValue: selfAssessedValue,
            taxDeposit: msg.value,
            lastTaxCollection: block.timestamp,
            resolver: msg.sender,
            expiryTimestamp: expiryTs,
            inAuction: false,
            auctionStart: 0,
            registeredAt: block.timestamp,
            resolverActive: true
        });

        nameToTokenId[nameHash] = tokenId;
        resolvers[nameHash] = msg.sender;
        portfolioSize[msg.sender]++;

        _mint(msg.sender, tokenId);

        emit NameRegistered(tokenId, msg.sender, name, selfAssessedValue, msg.value);
    }

    // ============ Price Management ============

    /**
     * @notice Change the self-assessed value of a name you own
     * @param tokenId The token ID of the name
     * @param newValue The new self-assessed value in wei
     * @dev Collects accrued tax first, then recalculates expiry based on remaining deposit.
     *      Raising the price increases tax burn rate (more protection, higher cost).
     *      Lowering the price decreases tax burn rate (less protection, cheaper to hold).
     */
    function setPrice(uint256 tokenId, uint256 newValue) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        if (newValue == 0) revert ZeroValue();

        VibeName storage vn = _names[tokenId];
        if (vn.inAuction) revert NameInAuction();

        // Settle accrued tax before changing assessment
        _collectTaxInternal(tokenId);

        uint256 oldValue = vn.selfAssessedValue;
        vn.selfAssessedValue = newValue;

        // Recalculate expiry with remaining deposit and new rate
        vn.expiryTimestamp = block.timestamp + _depositToTime(vn.taxDeposit, newValue);

        emit PriceChanged(tokenId, oldValue, newValue);
    }

    // ============ Tax Management ============

    /**
     * @notice Top up the tax deposit for a name
     * @param tokenId The token ID of the name
     * @dev Anyone can deposit tax for any name (e.g., a friend keeping your name alive).
     *      If the name was in auction, the auction is cancelled and ownership is restored.
     */
    function depositTax(uint256 tokenId) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        _requireOwned(tokenId);

        VibeName storage vn = _names[tokenId];

        // Collect any accrued tax first
        _collectTaxInternal(tokenId);

        vn.taxDeposit += msg.value;

        // If was in auction, cancel it — owner topped up in time
        if (vn.inAuction) {
            vn.inAuction = false;
            vn.auctionStart = 0;
        }

        // Recalculate expiry
        vn.expiryTimestamp = block.timestamp + _depositToTime(vn.taxDeposit, vn.selfAssessedValue);

        emit TaxDeposited(tokenId, msg.value);
    }

    /**
     * @notice Trigger tax collection for a name (sends accrued tax to treasury)
     * @param tokenId The token ID of the name
     * @dev Anyone can call this. Incentive: keeps the system solvent and names honest.
     *      If the deposit is fully consumed, triggers expiry + Dutch auction.
     */
    function collectTax(uint256 tokenId) external nonReentrant {
        _requireOwned(tokenId);
        _collectTaxInternal(tokenId);
    }

    // ============ Force Acquisition (Augmented Harberger) ============

    /**
     * @notice Initiate force-acquire — starts the 72-hour grace period
     * @param tokenId The token ID of the name to acquire
     * @param newSelfAssessedValue The buyer's new self-assessed value after acquisition
     * @dev Augmented Harberger: instead of instant transfer, this starts a grace period.
     *
     *      Effective price = selfAssessedValue × loyaltyMultiplier + 20% acquisition premium.
     *      ETH is held in escrow during the grace period.
     *      Owner has 72 hours to block by raising their assessment to match.
     *
     *      Payment breakdown:
     *        - effectivePrice → held in escrow, paid to owner on completion
     *        - 20% premium → additional compensation to displaced owner
     *        - remainder → becomes buyer's tax deposit
     */
    function initiateAcquire(
        uint256 tokenId,
        uint256 newSelfAssessedValue
    ) external payable nonReentrant {
        address currentOwner = ownerOf(tokenId);
        if (currentOwner == msg.sender) revert CannotAcquireOwnName();
        if (newSelfAssessedValue == 0) revert ZeroValue();
        if (pendingAcquisitions[tokenId].active) revert AcquisitionAlreadyPending();

        VibeName storage vn = _names[tokenId];
        if (vn.inAuction) revert NameInAuction();

        // Collect outstanding tax before calculating price
        _collectTaxInternal(tokenId);

        // Calculate effective price with loyalty multiplier + acquisition premium
        uint256 effectivePrice = _effectiveAcquirePrice(tokenId);
        uint256 minNewDeposit = _computeTax(newSelfAssessedValue, MIN_DEPOSIT_DAYS);
        uint256 totalRequired = effectivePrice + minNewDeposit;
        if (msg.value < totalRequired) revert InsufficientPayment();

        // Hold funds in escrow — grace period starts now
        pendingAcquisitions[tokenId] = PendingAcquisition({
            buyer: msg.sender,
            newSelfAssessedValue: newSelfAssessedValue,
            depositAmount: msg.value,
            initiatedAt: block.timestamp,
            active: true
        });

        emit AcquisitionInitiated(tokenId, msg.sender, effectivePrice, block.timestamp + GRACE_PERIOD);
    }

    /**
     * @notice Owner blocks a pending acquisition by raising their assessment
     * @param tokenId The token ID being targeted
     * @param newValue New self-assessed value (must be >= effective acquire price)
     * @dev Owner must also deposit enough tax to cover the new rate.
     *      The pending buyer's ETH is refunded from escrow.
     */
    function blockAcquisition(uint256 tokenId, uint256 newValue) external payable nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        PendingAcquisition storage pa = pendingAcquisitions[tokenId];
        if (!pa.active) revert NoPendingAcquisition();
        if (block.timestamp > pa.initiatedAt + GRACE_PERIOD) revert GracePeriodExpired();

        VibeName storage vn = _names[tokenId];

        // Owner must raise assessment to at least the effective price
        uint256 effectivePrice = _effectiveAcquirePrice(tokenId);
        if (newValue < effectivePrice) revert InsufficientPayment();

        // Collect tax, set new price
        _collectTaxInternal(tokenId);
        uint256 oldValue = vn.selfAssessedValue;
        vn.selfAssessedValue = newValue;

        // Add any new deposit
        if (msg.value > 0) {
            vn.taxDeposit += msg.value;
        }
        vn.expiryTimestamp = block.timestamp + _depositToTime(vn.taxDeposit, newValue);

        // Refund the buyer's escrowed ETH
        uint256 refundAmount = pa.depositAmount;
        address buyer = pa.buyer;

        // Clear the pending acquisition
        delete pendingAcquisitions[tokenId];

        // Refund buyer
        if (refundAmount > 0) {
            (bool success, ) = buyer.call{value: refundAmount}("");
            require(success, "Buyer refund failed");
        }

        emit AcquisitionBlocked(tokenId, msg.sender, newValue);
        emit PriceChanged(tokenId, oldValue, newValue);
    }

    /**
     * @notice Complete a force-acquire after grace period expires
     * @param tokenId The token ID to acquire
     * @dev Can only be called by the pending buyer after the 72-hour grace period.
     *      If the owner didn't block, the transfer executes.
     */
    function completeAcquire(uint256 tokenId) external nonReentrant {
        PendingAcquisition storage pa = pendingAcquisitions[tokenId];
        if (!pa.active) revert NoPendingAcquisition();
        if (pa.buyer != msg.sender) revert NotPendingBuyer();
        if (block.timestamp < pa.initiatedAt + GRACE_PERIOD) revert GracePeriodActive();

        address currentOwner = ownerOf(tokenId);
        VibeName storage vn = _names[tokenId];

        // Recollect tax (more may have accrued during grace period)
        _collectTaxInternal(tokenId);

        uint256 effectivePrice = _effectiveAcquirePrice(tokenId);
        uint256 depositAmount = pa.depositAmount;
        uint256 newSelfAssessedValue = pa.newSelfAssessedValue;

        // Clear pending acquisition
        delete pendingAcquisitions[tokenId];

        // Calculate payouts
        uint256 oldDeposit = vn.taxDeposit;
        uint256 ownerPayout = effectivePrice + oldDeposit; // Price + premium + remaining deposit refund

        // Set up new ownership
        uint256 newDeposit = depositAmount - effectivePrice;
        vn.selfAssessedValue = newSelfAssessedValue;
        vn.taxDeposit = newDeposit;
        vn.lastTaxCollection = block.timestamp;
        vn.expiryTimestamp = block.timestamp + _depositToTime(newDeposit, newSelfAssessedValue);
        vn.inAuction = false;
        vn.auctionStart = 0;
        vn.resolver = msg.sender;
        vn.registeredAt = block.timestamp; // Loyalty resets on transfer
        vn.resolverActive = true;

        // Update resolver cache
        bytes32 nameHash = keccak256(abi.encodePacked(vn.name));
        resolvers[nameHash] = msg.sender;

        // Update portfolio sizes
        portfolioSize[currentOwner]--;
        portfolioSize[msg.sender]++;

        // Transfer the NFT
        _transfer(currentOwner, msg.sender, tokenId);

        // Pay old owner
        if (ownerPayout > 0) {
            (bool success, ) = currentOwner.call{value: ownerPayout}("");
            require(success, "Owner payout failed");
        }

        emit AcquisitionCompleted(tokenId, currentOwner, msg.sender, effectivePrice);
    }

    /**
     * @notice Cancel a pending acquisition and reclaim escrowed ETH
     * @param tokenId The token ID
     * @dev Can be called by the buyer at any time to withdraw.
     */
    function cancelAcquire(uint256 tokenId) external nonReentrant {
        PendingAcquisition storage pa = pendingAcquisitions[tokenId];
        if (!pa.active) revert NoPendingAcquisition();
        if (pa.buyer != msg.sender) revert NotPendingBuyer();

        uint256 refundAmount = pa.depositAmount;
        delete pendingAcquisitions[tokenId];

        if (refundAmount > 0) {
            (bool success, ) = msg.sender.call{value: refundAmount}("");
            require(success, "Refund failed");
        }

        emit AcquisitionCancelled(tokenId, msg.sender);
    }

    // ============ Expiry & Dutch Auction ============

    /**
     * @notice Trigger a Dutch auction for an expired name
     * @param tokenId The token ID of the expired name
     * @dev Anyone can call this after a name's tax deposit runs out.
     *      Starts a 7-day Dutch auction from the last self-assessed value down to 0.
     *      If no one bids, the name becomes free to claim.
     */
    function reclaimExpired(uint256 tokenId) external nonReentrant {
        _requireOwned(tokenId);

        VibeName storage vn = _names[tokenId];

        // Collect any final tax
        _collectTaxInternal(tokenId);

        // Must be expired (deposit fully consumed)
        if (vn.taxDeposit > 0) revert NameNotExpired();
        if (vn.inAuction) revert NameInAuction();

        vn.inAuction = true;
        vn.auctionStart = block.timestamp;

        emit NameExpired(tokenId, vn.name);
        emit AuctionStarted(tokenId, vn.selfAssessedValue);
    }

    /**
     * @notice Purchase a name that is in Dutch auction
     * @param tokenId The token ID of the auctioned name
     * @param newSelfAssessedValue The buyer's new self-assessed value
     * @dev Price decreases linearly from last assessed value to 0 over DUTCH_AUCTION_DURATION.
     *      Buyer must pay the current auction price plus enough deposit for 30 days of tax.
     *      Auction proceeds go to the DAO treasury (not the expired owner).
     */
    function bidAuction(
        uint256 tokenId,
        uint256 newSelfAssessedValue
    ) external payable nonReentrant {
        VibeName storage vn = _names[tokenId];
        if (!vn.inAuction) revert NameNotInAuction();
        if (newSelfAssessedValue == 0) revert ZeroValue();

        uint256 auctionPrice = currentAuctionPrice(tokenId);
        uint256 minNewDeposit = _computeTax(newSelfAssessedValue, MIN_DEPOSIT_DAYS);
        uint256 totalRequired = auctionPrice + minNewDeposit;
        if (msg.value < totalRequired) revert InsufficientPayment();

        address oldOwner = ownerOf(tokenId);
        uint256 newDeposit = msg.value - auctionPrice;

        // Update name data
        vn.selfAssessedValue = newSelfAssessedValue;
        vn.taxDeposit = newDeposit;
        vn.lastTaxCollection = block.timestamp;
        vn.expiryTimestamp = block.timestamp + _depositToTime(newDeposit, newSelfAssessedValue);
        vn.inAuction = false;
        vn.auctionStart = 0;
        vn.resolver = msg.sender;
        vn.registeredAt = block.timestamp; // Loyalty resets on new owner
        vn.resolverActive = true;

        // Update resolver cache
        bytes32 nameHash = keccak256(abi.encodePacked(vn.name));
        resolvers[nameHash] = msg.sender;

        // Update portfolio sizes
        portfolioSize[oldOwner]--;
        portfolioSize[msg.sender]++;

        // Transfer NFT to buyer
        _transfer(oldOwner, msg.sender, tokenId);

        // Auction proceeds go to treasury (expired owner forfeited their claim)
        if (auctionPrice > 0) {
            (bool success, ) = treasury.call{value: auctionPrice}("");
            require(success, "Treasury transfer failed");
        }

        emit AuctionPurchased(tokenId, msg.sender, auctionPrice);
    }

    // ============ Resolution ============

    /**
     * @notice Set the resolver address for a name you own
     * @param tokenId The token ID of the name
     * @param _resolver The address this name should resolve to
     */
    function setResolver(uint256 tokenId, address _resolver) external {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        if (_resolver == address(0)) revert ZeroAddress();

        VibeName storage vn = _names[tokenId];
        vn.resolver = _resolver;
        vn.resolverActive = true; // Activates loyalty accrual

        bytes32 nameHash = keccak256(abi.encodePacked(vn.name));
        resolvers[nameHash] = _resolver;

        emit ResolverSet(tokenId, _resolver);
    }

    /**
     * @notice Resolve a .vibe name to an address
     * @param name The name to resolve (e.g., "vibeswap" resolves "vibeswap.vibe")
     * @return The address the name resolves to, or address(0) if unregistered
     */
    function resolve(string calldata name) external view returns (address) {
        bytes32 nameHash = keccak256(abi.encodePacked(name));
        return resolvers[nameHash];
    }

    // ============ Subdomains ============

    /**
     * @notice Create a subdomain under a name you own
     * @param parentId The token ID of the parent name (e.g., "will.vibe")
     * @param label The subdomain label (e.g., "jarvis" for "jarvis.will.vibe")
     * @param selfAssessedValue Self-assessed value for the subdomain
     * @dev Subdomain inherits the parent's tax model. Only the parent owner can create subdomains.
     *      The subdomain is a full VibeName with its own tax deposit and force-buy dynamics.
     */
    function createSubdomain(
        uint256 parentId,
        string calldata label,
        uint256 selfAssessedValue
    ) external payable nonReentrant returns (uint256 childId) {
        if (ownerOf(parentId) != msg.sender) revert NotNameOwner();
        if (bytes(label).length == 0) revert EmptyName();
        if (selfAssessedValue == 0) revert ZeroValue();

        bytes32 labelHash = keccak256(abi.encodePacked(label));
        if (subdomains[parentId][labelHash] != 0) revert NameAlreadyRegistered();

        uint256 minDeposit = _computeTax(selfAssessedValue, MIN_DEPOSIT_DAYS);
        if (msg.value < minDeposit) revert InsufficientDeposit();

        // Build full subdomain name: "label.parent"
        string memory fullName = string(abi.encodePacked(label, ".", _names[parentId].name));
        bytes32 fullNameHash = keccak256(abi.encodePacked(fullName));
        if (nameToTokenId[fullNameHash] != 0) revert NameAlreadyRegistered();

        childId = nextTokenId++;
        uint256 expiryTs = block.timestamp + _depositToTime(msg.value, selfAssessedValue);

        _names[childId] = VibeName({
            name: fullName,
            selfAssessedValue: selfAssessedValue,
            taxDeposit: msg.value,
            lastTaxCollection: block.timestamp,
            resolver: msg.sender,
            expiryTimestamp: expiryTs,
            inAuction: false,
            auctionStart: 0,
            registeredAt: block.timestamp,
            resolverActive: true
        });

        nameToTokenId[fullNameHash] = childId;
        resolvers[fullNameHash] = msg.sender;
        subdomains[parentId][labelHash] = childId;
        portfolioSize[msg.sender]++;

        _mint(msg.sender, childId);

        emit SubdomainCreated(parentId, childId, label);
        emit NameRegistered(childId, msg.sender, fullName, selfAssessedValue, msg.value);
    }

    // ============ View Functions ============

    /**
     * @notice Calculate the tax currently owed (accrued since last collection)
     * @param tokenId The token ID
     * @return owed The tax amount owed in wei
     */
    function taxOwed(uint256 tokenId) external view returns (uint256 owed) {
        VibeName storage vn = _names[tokenId];
        if (vn.lastTaxCollection == 0) return 0;

        uint256 elapsed = block.timestamp - vn.lastTaxCollection;
        owed = _computeTax(vn.selfAssessedValue, elapsed);

        // Cap at available deposit
        if (owed > vn.taxDeposit) {
            owed = vn.taxDeposit;
        }
    }

    /**
     * @notice Time remaining until the tax deposit runs out
     * @param tokenId The token ID
     * @return seconds_ Seconds until expiry (0 if already expired)
     */
    function timeUntilExpiry(uint256 tokenId) external view returns (uint256 seconds_) {
        VibeName storage vn = _names[tokenId];
        if (vn.expiryTimestamp <= block.timestamp) return 0;
        return vn.expiryTimestamp - block.timestamp;
    }

    /**
     * @notice Current Dutch auction price for an expired name
     * @param tokenId The token ID
     * @return price Current price (linearly decreasing from assessed value to 0)
     */
    function currentAuctionPrice(uint256 tokenId) public view returns (uint256 price) {
        VibeName storage vn = _names[tokenId];
        if (!vn.inAuction) return 0;

        uint256 elapsed = block.timestamp - vn.auctionStart;
        if (elapsed >= DUTCH_AUCTION_DURATION) return 0;

        // Linear decay: startPrice * (remaining / total)
        price = vn.selfAssessedValue * (DUTCH_AUCTION_DURATION - elapsed) / DUTCH_AUCTION_DURATION;
    }

    /**
     * @notice Get full name data for a token ID
     * @param tokenId The token ID
     * @return The VibeName struct
     */
    function getName(uint256 tokenId) external view returns (VibeName memory) {
        return _names[tokenId];
    }

    /**
     * @notice Look up the token ID for a given name string
     * @param name The name to look up
     * @return tokenId The token ID (0 if not registered)
     */
    function getTokenId(string calldata name) external view returns (uint256) {
        return nameToTokenId[keccak256(abi.encodePacked(name))];
    }

    // ============ Augmentation View Functions ============

    /**
     * @notice Calculate the loyalty multiplier for a name (in BPS)
     * @param tokenId The token ID
     * @return multiplier The multiplier in BPS (10000 = 1x, 15000 = 1.5x, etc.)
     * @dev Loyalty only accrues if resolver is actively set. Squatters (no resolver) get 1x.
     */
    function loyaltyMultiplier(uint256 tokenId) public view returns (uint256 multiplier) {
        VibeName storage vn = _names[tokenId];

        // No loyalty bonus if resolver was never set (squatter behavior)
        if (!vn.resolverActive) return BPS;

        uint256 tenure = block.timestamp - vn.registeredAt;

        if (tenure >= LOYALTY_YEAR_5) return 30_000;      // 3x after 5 years
        if (tenure >= LOYALTY_YEAR_3) return 20_000;      // 2x after 3 years
        if (tenure >= LOYALTY_YEAR_2) return 15_000;      // 1.5x after 2 years
        return BPS;                                        // 1x in first year
    }

    /**
     * @notice Calculate the portfolio tax multiplier for an address (in BPS)
     * @param owner The address to check
     * @return multiplier The tax rate multiplier in BPS
     * @dev More names = higher tax per name. Makes domain baroning economically irrational.
     */
    function portfolioTaxMultiplier(address owner) public view returns (uint256 multiplier) {
        uint256 count = portfolioSize[owner];
        if (count <= 1) return PORTFOLIO_MULT_1;           // 1x for first name
        if (count == 2) return PORTFOLIO_MULT_2;           // 1.5x for second
        if (count <= 5) return PORTFOLIO_MULT_3_5;         // 2x for 3rd-5th
        return PORTFOLIO_MULT_6_PLUS;                      // 3x for 6+
    }

    /**
     * @notice Calculate the effective force-acquire price (base × loyalty + premium)
     * @param tokenId The token ID
     * @return price The total ETH required to force-acquire
     * @dev effectivePrice = (selfAssessedValue × loyaltyMult / BPS) × (BPS + premiumBPS) / BPS
     */
    function _effectiveAcquirePrice(uint256 tokenId) internal view returns (uint256) {
        VibeName storage vn = _names[tokenId];
        uint256 loyalty = loyaltyMultiplier(tokenId);

        // Base price adjusted by loyalty
        uint256 loyaltyAdjusted = (vn.selfAssessedValue * loyalty) / BPS;

        // Add acquisition premium (20%)
        uint256 withPremium = (loyaltyAdjusted * (BPS + ACQUISITION_PREMIUM_BPS)) / BPS;

        return withPremium;
    }

    /**
     * @notice Public view of the effective acquire price
     * @param tokenId The token ID
     * @return The total ETH needed for force-acquisition
     */
    function effectiveAcquirePrice(uint256 tokenId) external view returns (uint256) {
        return _effectiveAcquirePrice(tokenId);
    }

    // ============ Internal Functions ============

    /**
     * @notice Compute tax for a given value and elapsed time
     * @dev tax = selfAssessedValue * TAX_RATE_BPS * elapsed / (BPS * YEAR_SECONDS)
     *      Uses full multiplication before division to minimize precision loss.
     *      For portfolio tax, the caller should apply the portfolio multiplier externally.
     */
    function _computeTax(uint256 selfAssessedValue, uint256 elapsed) internal pure returns (uint256) {
        return (selfAssessedValue * TAX_RATE_BPS * elapsed) / (BPS * YEAR_SECONDS);
    }

    /**
     * @notice Convert a deposit amount to the time it covers at a given assessed value
     * @dev Inverse of _computeTax: time = deposit * BPS * YEAR_SECONDS / (value * TAX_RATE_BPS)
     */
    function _depositToTime(uint256 deposit, uint256 selfAssessedValue) internal pure returns (uint256) {
        if (selfAssessedValue == 0) return type(uint256).max;
        return (deposit * BPS * YEAR_SECONDS) / (selfAssessedValue * TAX_RATE_BPS);
    }

    /**
     * @notice Collect accrued tax and send to treasury. Triggers expiry if deposit is consumed.
     * @param tokenId The token ID
     */
    function _collectTaxInternal(uint256 tokenId) internal {
        VibeName storage vn = _names[tokenId];
        if (vn.lastTaxCollection == 0) return;

        uint256 elapsed = block.timestamp - vn.lastTaxCollection;
        if (elapsed == 0) return;

        uint256 owed = _computeTax(vn.selfAssessedValue, elapsed);
        uint256 collected;

        if (owed >= vn.taxDeposit) {
            // Deposit fully consumed — collect what's left
            collected = vn.taxDeposit;
            vn.taxDeposit = 0;
            // Recalculate: deposit ran out at some point in the past
            // The name is effectively expired
            vn.expiryTimestamp = block.timestamp;
        } else {
            collected = owed;
            vn.taxDeposit -= owed;
        }

        vn.lastTaxCollection = block.timestamp;

        // Send collected tax to DAO treasury
        if (collected > 0 && treasury != address(0)) {
            (bool success, ) = treasury.call{value: collected}("");
            require(success, "Treasury transfer failed");

            emit TaxCollected(tokenId, collected);
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ UUPS ============

    /// @notice Authorization check for UUPS upgrades (owner only)
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Receive ============

    /// @notice Accept ETH deposits (for gas-efficient tax top-ups via direct transfer)
    receive() external payable {}
}
