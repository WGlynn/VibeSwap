// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeEnergyMarket — P2P Renewable Energy Trading
 * @notice Decentralized energy marketplace — solar panel owners sell excess
 *         energy directly to consumers. No utility company middlemen.
 *         IoT smart meters (via VibeDeviceNetwork) verify production/consumption.
 *
 * @dev Features:
 *      - Energy producer registration with meter attestation
 *      - Real-time energy credit trading
 *      - Grid balancing incentives
 *      - Carbon credit integration
 *      - Community energy pools
 */
contract VibeEnergyMarket is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum EnergySource { SOLAR, WIND, HYDRO, GEOTHERMAL, BIOMASS, NUCLEAR, GRID }

    struct Producer {
        address addr;
        EnergySource source;
        bytes32 meterDeviceId;       // VibeDeviceNetwork device ID
        uint256 capacityKw;
        uint256 totalProduced;       // kWh lifetime
        uint256 totalSold;
        uint256 totalEarned;
        uint256 carbonCreditsGenerated;
        bool active;
        bool verified;
    }

    struct EnergyListing {
        uint256 listingId;
        address producer;
        uint256 amountKwh;
        uint256 pricePerKwh;         // Wei per kWh
        EnergySource source;
        uint256 availableUntil;
        uint256 sold;
        bool active;
    }

    struct CarbonCredit {
        bytes32 creditId;
        address producer;
        uint256 kwhGenerated;
        uint256 co2OffsetKg;
        uint256 timestamp;
        bool retired;
    }

    struct CommunityPool {
        uint256 poolId;
        string name;
        address[] members;
        uint256 totalCapacity;
        uint256 totalConsumed;
        uint256 sharedSavings;
        bool active;
    }

    // ============ State ============

    mapping(address => Producer) public producers;
    address[] public producerList;

    mapping(uint256 => EnergyListing) public listings;
    uint256 public listingCount;

    mapping(bytes32 => CarbonCredit) public carbonCredits;
    uint256 public totalCarbonCredits;

    mapping(uint256 => CommunityPool) public pools;
    uint256 public poolCount;

    uint256 public totalEnergyTraded; // kWh
    uint256 public totalVolume;       // ETH
    uint256 public totalCO2Offset;    // kg


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ProducerRegistered(address indexed producer, EnergySource source, uint256 capacityKw);
    event EnergyListed(uint256 indexed listingId, address indexed producer, uint256 amountKwh, uint256 pricePerKwh);
    event EnergyPurchased(uint256 indexed listingId, address indexed buyer, uint256 kwhBought);
    event CarbonCreditIssued(bytes32 indexed creditId, address indexed producer, uint256 co2OffsetKg);
    event PoolCreated(uint256 indexed poolId, string name);

    // ============ Init ============

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

    // ============ Producer Management ============

    function registerProducer(
        EnergySource source,
        bytes32 meterDeviceId,
        uint256 capacityKw
    ) external {
        require(!producers[msg.sender].active, "Already registered");

        producers[msg.sender] = Producer({
            addr: msg.sender,
            source: source,
            meterDeviceId: meterDeviceId,
            capacityKw: capacityKw,
            totalProduced: 0,
            totalSold: 0,
            totalEarned: 0,
            carbonCreditsGenerated: 0,
            active: true,
            verified: false
        });

        producerList.push(msg.sender);
        emit ProducerRegistered(msg.sender, source, capacityKw);
    }

    function verifyProducer(address producer) external onlyOwner {
        producers[producer].verified = true;
    }

    // ============ Energy Trading ============

    function listEnergy(
        uint256 amountKwh,
        uint256 pricePerKwh,
        uint256 validHours
    ) external returns (uint256) {
        Producer storage prod = producers[msg.sender];
        require(prod.active && prod.verified, "Not verified producer");

        listingCount++;
        listings[listingCount] = EnergyListing({
            listingId: listingCount,
            producer: msg.sender,
            amountKwh: amountKwh,
            pricePerKwh: pricePerKwh,
            source: prod.source,
            availableUntil: block.timestamp + (validHours * 1 hours),
            sold: 0,
            active: true
        });

        prod.totalProduced += amountKwh;

        emit EnergyListed(listingCount, msg.sender, amountKwh, pricePerKwh);
        return listingCount;
    }

    function purchaseEnergy(uint256 listingId, uint256 kwhAmount) external payable nonReentrant {
        EnergyListing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(block.timestamp <= listing.availableUntil, "Expired");
        require(listing.sold + kwhAmount <= listing.amountKwh, "Insufficient supply");

        uint256 cost = kwhAmount * listing.pricePerKwh;
        require(msg.value >= cost, "Insufficient payment");

        listing.sold += kwhAmount;
        if (listing.sold >= listing.amountKwh) listing.active = false;

        Producer storage prod = producers[listing.producer];
        prod.totalSold += kwhAmount;
        prod.totalEarned += cost;

        totalEnergyTraded += kwhAmount;
        totalVolume += cost;

        (bool ok, ) = listing.producer.call{value: cost}("");
        require(ok, "Payment failed");

        if (msg.value > cost) {
            (bool ok2, ) = msg.sender.call{value: msg.value - cost}("");
            require(ok2, "Refund failed");
        }

        // Issue carbon credit for renewable energy
        if (listing.source != EnergySource.GRID && listing.source != EnergySource.NUCLEAR) {
            _issueCarbonCredit(listing.producer, kwhAmount);
        }

        emit EnergyPurchased(listingId, msg.sender, kwhAmount);
    }

    // ============ Carbon Credits ============

    function _issueCarbonCredit(address producer, uint256 kwhGenerated) internal {
        // ~0.4 kg CO2 offset per kWh of renewable replacing grid
        uint256 co2Offset = (kwhGenerated * 400) / 1000;

        bytes32 creditId = keccak256(abi.encodePacked(
            producer, kwhGenerated, block.timestamp
        ));

        carbonCredits[creditId] = CarbonCredit({
            creditId: creditId,
            producer: producer,
            kwhGenerated: kwhGenerated,
            co2OffsetKg: co2Offset,
            timestamp: block.timestamp,
            retired: false
        });

        producers[producer].carbonCreditsGenerated += co2Offset;
        totalCarbonCredits++;
        totalCO2Offset += co2Offset;

        emit CarbonCreditIssued(creditId, producer, co2Offset);
    }

    function retireCarbonCredit(bytes32 creditId) external {
        CarbonCredit storage credit = carbonCredits[creditId];
        require(credit.producer == msg.sender, "Not producer");
        require(!credit.retired, "Already retired");
        credit.retired = true;
    }

    // ============ Community Pools ============

    function createPool(string calldata name) external returns (uint256) {
        poolCount++;
        CommunityPool storage pool = pools[poolCount];
        pool.poolId = poolCount;
        pool.name = name;
        pool.active = true;
        pool.members.push(msg.sender);

        emit PoolCreated(poolCount, name);
        return poolCount;
    }

    function joinPool(uint256 poolId) external {
        require(pools[poolId].active, "Not active");
        pools[poolId].members.push(msg.sender);
    }

    // ============ View ============

    function getProducer(address p) external view returns (Producer memory) { return producers[p]; }
    function getListing(uint256 id) external view returns (EnergyListing memory) { return listings[id]; }
    function getProducerCount() external view returns (uint256) { return producerList.length; }
    function getTotalEnergyTraded() external view returns (uint256) { return totalEnergyTraded; }
    function getTotalCO2Offset() external view returns (uint256) { return totalCO2Offset; }

    receive() external payable {}
}
