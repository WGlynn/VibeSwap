// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/rwa/VibeSupplyChain.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeSupplyChainTest is Test {
    // ============ State ============

    VibeSupplyChain public supply;
    address public deployer;
    address public manufacturer;
    address public handler1;
    address public handler2;
    address public consumer;

    // ============ setUp ============

    function setUp() public {
        deployer = makeAddr("deployer");
        manufacturer = makeAddr("manufacturer");
        handler1 = makeAddr("handler1");
        handler2 = makeAddr("handler2");
        consumer = makeAddr("consumer");

        vm.startPrank(deployer);
        VibeSupplyChain impl = new VibeSupplyChain();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeSupplyChain.initialize, ())
        );
        supply = VibeSupplyChain(payable(address(proxy)));
        vm.stopPrank();
    }

    // ============ Helpers ============

    function _createProduct() internal returns (bytes32 productId) {
        vm.prank(manufacturer);
        productId = supply.createProduct(
            "Premium Widget",
            keccak256("rfid-tag-001"),
            keccak256("batch-2026-Q1")
        );
    }

    function _createProductWithRfid(bytes32 rfidTag) internal returns (bytes32 productId) {
        vm.prank(manufacturer);
        productId = supply.createProduct("Widget", rfidTag, keccak256("batch"));
    }

    // ============ Product Creation Tests ============

    function test_CreateProduct_SetsFields() public {
        bytes32 productId = _createProduct();

        (
            bytes32 pid,
            address mfr,
            string memory name,
            bytes32 rfidTag,
            bytes32 batchId,
            uint256 createdAt,
            VibeSupplyChain.ProductStatus status,
            uint256 checkpointCount,
            bool authentic
        ) = supply.products(productId);

        assertEq(pid, productId);
        assertEq(mfr, manufacturer);
        assertEq(name, "Premium Widget");
        assertEq(rfidTag, keccak256("rfid-tag-001"));
        assertEq(batchId, keccak256("batch-2026-Q1"));
        assertEq(createdAt, block.timestamp);
        assertEq(uint8(status), uint8(VibeSupplyChain.ProductStatus.CREATED));
        assertEq(checkpointCount, 0);
        assertTrue(authentic);
    }

    function test_CreateProduct_IncrementsCounters() public {
        _createProduct();
        assertEq(supply.totalProducts(), 1);
        assertEq(supply.getProductCount(), 1);
        assertEq(supply.totalManufacturers(), 1);
    }

    function test_CreateProduct_MapsRFID() public {
        bytes32 rfidTag = keccak256("rfid-tag-001");
        bytes32 productId = _createProduct();

        assertEq(supply.rfidToProduct(rfidTag), productId);
        assertEq(supply.lookupByRFID(rfidTag), productId);
    }

    function test_CreateProduct_AddsToBatch() public {
        bytes32 batchId = keccak256("batch-2026-Q1");
        _createProduct();

        bytes32[] memory batchProducts = supply.getBatchProducts(batchId);
        assertEq(batchProducts.length, 1);
    }

    function test_CreateProduct_MultipleProducts() public {
        vm.prank(manufacturer);
        supply.createProduct("Widget A", keccak256("rfid-a"), keccak256("batch-1"));

        vm.warp(block.timestamp + 1);
        vm.prank(manufacturer);
        supply.createProduct("Widget B", keccak256("rfid-b"), keccak256("batch-1"));

        assertEq(supply.totalProducts(), 2);

        bytes32[] memory batch = supply.getBatchProducts(keccak256("batch-1"));
        assertEq(batch.length, 2);
    }

    function test_CreateProduct_ManufacturerCountedOnce() public {
        vm.prank(manufacturer);
        supply.createProduct("A", keccak256("rfid-a"), keccak256("batch"));

        vm.warp(block.timestamp + 1);
        vm.prank(manufacturer);
        supply.createProduct("B", keccak256("rfid-b"), keccak256("batch"));

        assertEq(supply.totalManufacturers(), 1); // Same manufacturer, counted once
    }

    function test_CreateProduct_MultipleManufacturers() public {
        vm.prank(manufacturer);
        supply.createProduct("A", keccak256("rfid-a"), keccak256("batch"));

        vm.prank(handler1); // Different "manufacturer"
        supply.createProduct("B", keccak256("rfid-b"), keccak256("batch"));

        assertEq(supply.totalManufacturers(), 2);
    }

    // ============ Checkpoint Tests ============

    function test_RecordCheckpoint_Success() public {
        bytes32 productId = _createProduct();

        vm.prank(handler1);
        supply.recordCheckpoint(
            productId,
            keccak256("warehouse-A"),
            keccak256("device-001"),
            keccak256("temp:22C,humidity:45%"),
            "Received at warehouse A"
        );

        VibeSupplyChain.Checkpoint[] memory cps = supply.getCheckpoints(productId);
        assertEq(cps.length, 1);
        assertEq(cps[0].handler, handler1);
        assertEq(cps[0].checkpointId, 1);
        assertEq(cps[0].locationHash, keccak256("warehouse-A"));
        assertEq(supply.totalCheckpoints(), 1);
    }

    function test_RecordCheckpoint_UpdatesProductStatus() public {
        bytes32 productId = _createProduct();

        vm.prank(handler1);
        supply.recordCheckpoint(
            productId,
            keccak256("loc"),
            keccak256("dev"),
            keccak256("cond"),
            "In transit"
        );

        (, , , , , , VibeSupplyChain.ProductStatus status, uint256 cpCount, ) = supply.products(productId);
        assertEq(uint8(status), uint8(VibeSupplyChain.ProductStatus.AT_CHECKPOINT));
        assertEq(cpCount, 1);
    }

    function test_RecordCheckpoint_MultipleCheckpoints() public {
        bytes32 productId = _createProduct();

        vm.prank(handler1);
        supply.recordCheckpoint(productId, keccak256("loc-1"), keccak256("dev-1"), keccak256("c-1"), "Step 1");

        vm.warp(block.timestamp + 1 hours);
        vm.prank(handler2);
        supply.recordCheckpoint(productId, keccak256("loc-2"), keccak256("dev-2"), keccak256("c-2"), "Step 2");

        VibeSupplyChain.Checkpoint[] memory cps = supply.getCheckpoints(productId);
        assertEq(cps.length, 2);
        assertEq(cps[0].handler, handler1);
        assertEq(cps[1].handler, handler2);
        assertEq(supply.totalCheckpoints(), 2);
    }

    function test_RecordCheckpoint_RevertsDelivered() public {
        bytes32 productId = _createProduct();

        vm.prank(consumer);
        supply.markDelivered(productId);

        vm.prank(handler1);
        vm.expectRevert("Final state");
        supply.recordCheckpoint(productId, keccak256("loc"), keccak256("dev"), keccak256("c"), "Too late");
    }

    function test_RecordCheckpoint_RevertsRecalled() public {
        bytes32 productId = _createProduct();

        vm.prank(manufacturer);
        supply.recallProduct(productId, "Defect found");

        vm.prank(handler1);
        vm.expectRevert("Final state");
        supply.recordCheckpoint(productId, keccak256("loc"), keccak256("dev"), keccak256("c"), "Too late");
    }

    // ============ Delivery Tests ============

    function test_MarkDelivered_Success() public {
        bytes32 productId = _createProduct();

        vm.prank(consumer);
        supply.markDelivered(productId);

        (, , , , , , VibeSupplyChain.ProductStatus status, , ) = supply.products(productId);
        assertEq(uint8(status), uint8(VibeSupplyChain.ProductStatus.DELIVERED));
    }

    function test_MarkDelivered_RevertsAlready() public {
        bytes32 productId = _createProduct();

        vm.prank(consumer);
        supply.markDelivered(productId);

        vm.prank(consumer);
        vm.expectRevert("Already delivered");
        supply.markDelivered(productId);
    }

    // ============ Recall Tests ============

    function test_RecallProduct_ByManufacturer() public {
        bytes32 productId = _createProduct();

        vm.prank(manufacturer);
        supply.recallProduct(productId, "Safety defect found in batch");

        (, , , , , , VibeSupplyChain.ProductStatus status, , ) = supply.products(productId);
        assertEq(uint8(status), uint8(VibeSupplyChain.ProductStatus.RECALLED));
    }

    function test_RecallProduct_ByOwner() public {
        bytes32 productId = _createProduct();

        vm.prank(deployer); // Contract owner
        supply.recallProduct(productId, "Regulatory recall");

        (, , , , , , VibeSupplyChain.ProductStatus status, , ) = supply.products(productId);
        assertEq(uint8(status), uint8(VibeSupplyChain.ProductStatus.RECALLED));
    }

    function test_RecallProduct_RevertsUnauthorized() public {
        bytes32 productId = _createProduct();

        vm.prank(handler1); // Not manufacturer or owner
        vm.expectRevert("Not authorized");
        supply.recallProduct(productId, "Unauthorized recall");
    }

    // ============ Manufacturer Verification Tests ============

    function test_VerifyManufacturer_ByOwner() public {
        _createProduct(); // Auto-registers manufacturer

        vm.prank(deployer);
        supply.verifyManufacturer(manufacturer);

        (, , , , bool verified) = supply.manufacturers(manufacturer);
        assertTrue(verified);
    }

    function test_VerifyManufacturer_RevertsNonOwner() public {
        _createProduct();

        vm.prank(handler1);
        vm.expectRevert();
        supply.verifyManufacturer(manufacturer);
    }

    // ============ RFID Lookup Tests ============

    function test_LookupByRFID_ReturnsCorrectProduct() public {
        bytes32 rfid = keccak256("unique-rfid");
        bytes32 productId = _createProductWithRfid(rfid);

        assertEq(supply.lookupByRFID(rfid), productId);
    }

    function test_LookupByRFID_ReturnsZeroForUnknown() public view {
        assertEq(supply.lookupByRFID(keccak256("nonexistent")), bytes32(0));
    }

    // ============ Full Lifecycle Test ============

    function test_FullSupplyChainLifecycle() public {
        // 1. Manufacturer creates product
        bytes32 productId = _createProduct();

        // 2. Verify manufacturer
        vm.prank(deployer);
        supply.verifyManufacturer(manufacturer);

        // 3. Record checkpoints as product moves through supply chain
        vm.prank(handler1);
        supply.recordCheckpoint(
            productId,
            keccak256("factory-warehouse"),
            keccak256("scanner-001"),
            keccak256("temp:20C"),
            "Packaged and stored"
        );

        vm.warp(block.timestamp + 2 hours);
        vm.prank(handler1);
        supply.recordCheckpoint(
            productId,
            keccak256("loading-dock"),
            keccak256("scanner-002"),
            keccak256("temp:21C"),
            "Loaded onto truck"
        );

        vm.warp(block.timestamp + 1 days);
        vm.prank(handler2);
        supply.recordCheckpoint(
            productId,
            keccak256("distribution-center"),
            keccak256("scanner-003"),
            keccak256("temp:22C"),
            "Arrived at distribution center"
        );

        vm.warp(block.timestamp + 12 hours);
        vm.prank(handler2);
        supply.recordCheckpoint(
            productId,
            keccak256("retail-store"),
            keccak256("scanner-004"),
            keccak256("temp:23C"),
            "On shelf"
        );

        // 4. Verify checkpoint trail
        VibeSupplyChain.Checkpoint[] memory trail = supply.getCheckpoints(productId);
        assertEq(trail.length, 4);

        // 5. Consumer marks delivered
        vm.prank(consumer);
        supply.markDelivered(productId);

        (, , , , , , VibeSupplyChain.ProductStatus status, uint256 cpCount, bool authentic) = supply.products(productId);
        assertEq(uint8(status), uint8(VibeSupplyChain.ProductStatus.DELIVERED));
        assertEq(cpCount, 4);
        assertTrue(authentic);
        assertEq(supply.totalCheckpoints(), 4);
    }

    // ============ Batch Tracking Tests ============

    function test_BatchTracking_MultipleProducts() public {
        bytes32 batchId = keccak256("batch-2026-Q1");

        vm.startPrank(manufacturer);
        supply.createProduct("Widget 1", keccak256("rfid-1"), batchId);
        vm.warp(block.timestamp + 1);
        supply.createProduct("Widget 2", keccak256("rfid-2"), batchId);
        vm.warp(block.timestamp + 1);
        supply.createProduct("Widget 3", keccak256("rfid-3"), batchId);
        vm.stopPrank();

        bytes32[] memory batch = supply.getBatchProducts(batchId);
        assertEq(batch.length, 3);
    }

    function test_BatchTracking_SeparateBatches() public {
        bytes32 batch1 = keccak256("batch-1");
        bytes32 batch2 = keccak256("batch-2");

        vm.startPrank(manufacturer);
        supply.createProduct("A", keccak256("rfid-a"), batch1);
        vm.warp(block.timestamp + 1);
        supply.createProduct("B", keccak256("rfid-b"), batch2);
        vm.warp(block.timestamp + 1);
        supply.createProduct("C", keccak256("rfid-c"), batch1);
        vm.stopPrank();

        assertEq(supply.getBatchProducts(batch1).length, 2);
        assertEq(supply.getBatchProducts(batch2).length, 1);
    }

    // ============ Recall After Delivery Tests ============

    function test_RecallAfterDelivery_Succeeds() public {
        bytes32 productId = _createProduct();

        vm.prank(consumer);
        supply.markDelivered(productId);

        // Manufacturer can still recall after delivery (safety issue discovered later)
        vm.prank(manufacturer);
        supply.recallProduct(productId, "Post-delivery safety recall");

        (, , , , , , VibeSupplyChain.ProductStatus status, , ) = supply.products(productId);
        assertEq(uint8(status), uint8(VibeSupplyChain.ProductStatus.RECALLED));
    }

    // ============ Fuzz Tests ============

    function testFuzz_CreateProduct_UniqueIds(bytes32 rfidTag) public {
        vm.assume(rfidTag != bytes32(0));

        vm.prank(manufacturer);
        bytes32 productId = supply.createProduct("FuzzWidget", rfidTag, keccak256("fuzz-batch"));

        assertTrue(productId != bytes32(0));
        assertEq(supply.lookupByRFID(rfidTag), productId);
    }

    function testFuzz_MultipleCheckpoints_IncrementCorrectly(uint8 checkpointCount) public {
        checkpointCount = uint8(bound(uint256(checkpointCount), 1, 20));

        bytes32 productId = _createProduct();

        for (uint256 i = 0; i < checkpointCount; i++) {
            vm.warp(block.timestamp + 1 hours);
            vm.prank(handler1);
            supply.recordCheckpoint(
                productId,
                keccak256(abi.encodePacked("loc-", i)),
                keccak256(abi.encodePacked("dev-", i)),
                keccak256(abi.encodePacked("cond-", i)),
                "checkpoint"
            );
        }

        VibeSupplyChain.Checkpoint[] memory cps = supply.getCheckpoints(productId);
        assertEq(cps.length, uint256(checkpointCount));
        assertEq(supply.totalCheckpoints(), uint256(checkpointCount));

        (, , , , , , , uint256 cpCount, ) = supply.products(productId);
        assertEq(cpCount, uint256(checkpointCount));
    }
}
