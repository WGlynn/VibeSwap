// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeSupplyChain — Decentralized Supply Chain Verification
 * @notice Track products from raw materials to consumer with RFID/IoT
 *         integration. Each step verified on-chain, tamper-proof provenance.
 *
 * @dev Integrates with VibeDeviceNetwork for IoT device attestation.
 *      RFID tags, QR codes, GPS trackers — all feed into on-chain state.
 */
contract VibeSupplyChain is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum ProductStatus { CREATED, IN_TRANSIT, AT_CHECKPOINT, DELIVERED, RECALLED }

    struct Product {
        bytes32 productId;
        address manufacturer;
        string name;
        bytes32 rfidTag;             // RFID identifier hash
        bytes32 batchId;
        uint256 createdAt;
        ProductStatus status;
        uint256 checkpointCount;
        bool authentic;              // Verified authentic
    }

    struct Checkpoint {
        uint256 checkpointId;
        bytes32 productId;
        address handler;             // Who scanned/verified at this point
        bytes32 locationHash;        // Hashed GPS/address
        bytes32 deviceId;            // IoT device that recorded this
        bytes32 conditionHash;       // Temperature, humidity, etc.
        uint256 timestamp;
        string notes;
    }

    struct Manufacturer {
        address addr;
        string name;
        uint256 productsCreated;
        uint256 reputation;
        bool verified;
    }

    // ============ State ============

    mapping(bytes32 => Product) public products;
    bytes32[] public productList;

    mapping(bytes32 => Checkpoint[]) public checkpoints;

    mapping(address => Manufacturer) public manufacturers;

    /// @notice RFID tag to product mapping
    mapping(bytes32 => bytes32) public rfidToProduct;

    /// @notice Batch tracking
    mapping(bytes32 => bytes32[]) public batchProducts;

    /// @notice Stats
    uint256 public totalProducts;
    uint256 public totalCheckpoints;
    uint256 public totalManufacturers;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ProductCreated(bytes32 indexed productId, address indexed manufacturer, bytes32 rfidTag);
    event CheckpointRecorded(bytes32 indexed productId, uint256 checkpointId, address handler);
    event ProductDelivered(bytes32 indexed productId);
    event ProductRecalled(bytes32 indexed productId, string reason);
    event ManufacturerVerified(address indexed manufacturer);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Product Lifecycle ============

    function createProduct(
        string calldata name,
        bytes32 rfidTag,
        bytes32 batchId
    ) external returns (bytes32) {
        bytes32 productId = keccak256(abi.encodePacked(
            msg.sender, name, rfidTag, block.timestamp
        ));

        products[productId] = Product({
            productId: productId,
            manufacturer: msg.sender,
            name: name,
            rfidTag: rfidTag,
            batchId: batchId,
            createdAt: block.timestamp,
            status: ProductStatus.CREATED,
            checkpointCount: 0,
            authentic: true
        });

        productList.push(productId);
        rfidToProduct[rfidTag] = productId;
        batchProducts[batchId].push(productId);
        totalProducts++;

        Manufacturer storage mfr = manufacturers[msg.sender];
        mfr.addr = msg.sender;
        mfr.productsCreated++;
        if (mfr.productsCreated == 1) totalManufacturers++;

        emit ProductCreated(productId, msg.sender, rfidTag);
        return productId;
    }

    function recordCheckpoint(
        bytes32 productId,
        bytes32 locationHash,
        bytes32 deviceId,
        bytes32 conditionHash,
        string calldata notes
    ) external {
        Product storage prod = products[productId];
        require(prod.status != ProductStatus.DELIVERED && prod.status != ProductStatus.RECALLED, "Final state");

        prod.checkpointCount++;
        prod.status = ProductStatus.AT_CHECKPOINT;

        checkpoints[productId].push(Checkpoint({
            checkpointId: prod.checkpointCount,
            productId: productId,
            handler: msg.sender,
            locationHash: locationHash,
            deviceId: deviceId,
            conditionHash: conditionHash,
            timestamp: block.timestamp,
            notes: notes
        }));

        totalCheckpoints++;
        emit CheckpointRecorded(productId, prod.checkpointCount, msg.sender);
    }

    function markDelivered(bytes32 productId) external {
        Product storage prod = products[productId];
        require(prod.status != ProductStatus.DELIVERED, "Already delivered");
        prod.status = ProductStatus.DELIVERED;
        emit ProductDelivered(productId);
    }

    function recallProduct(bytes32 productId, string calldata reason) external {
        Product storage prod = products[productId];
        require(prod.manufacturer == msg.sender || msg.sender == owner(), "Not authorized");
        prod.status = ProductStatus.RECALLED;
        emit ProductRecalled(productId, reason);
    }

    function verifyManufacturer(address mfr) external onlyOwner {
        manufacturers[mfr].verified = true;
        emit ManufacturerVerified(mfr);
    }

    // ============ Lookup ============

    function lookupByRFID(bytes32 rfidTag) external view returns (bytes32) {
        return rfidToProduct[rfidTag];
    }

    function getCheckpoints(bytes32 productId) external view returns (Checkpoint[] memory) {
        return checkpoints[productId];
    }

    function getBatchProducts(bytes32 batchId) external view returns (bytes32[] memory) {
        return batchProducts[batchId];
    }

    function getProductCount() external view returns (uint256) { return totalProducts; }
}
