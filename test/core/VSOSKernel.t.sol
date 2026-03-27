// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/core/VSOSKernel.sol";

contract VSOSKernelTest is Test {

    VSOSKernel public kernel;

    address public owner;
    address public stranger;

    // Mock service addresses (no real contracts needed — registry only stores addresses)
    address public commitRevealAuction;
    address public soulboundIdentity;
    address public crossChainRouter;
    address public shapleyDistributor;
    address public vibePluginRegistry;
    address public circuitBreaker;

    // ============ Setup ============

    function setUp() public {
        owner    = makeAddr("owner");
        stranger = makeAddr("stranger");

        commitRevealAuction = makeAddr("CommitRevealAuction");
        soulboundIdentity   = makeAddr("SoulboundIdentity");
        crossChainRouter    = makeAddr("CrossChainRouter");
        shapleyDistributor  = makeAddr("ShapleyDistributor");
        vibePluginRegistry  = makeAddr("VibePluginRegistry");
        circuitBreaker      = makeAddr("CircuitBreaker");

        vm.startPrank(owner);

        VSOSKernel impl = new VSOSKernel();
        bytes memory initData = abi.encodeCall(VSOSKernel.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        kernel = VSOSKernel(address(proxy));

        vm.stopPrank();
    }

    // ============ Test 1: Register a service and verify it exists ============

    function test_RegisterService_ExistsAfterRegistration() public {
        vm.prank(owner);
        bytes32 serviceId = kernel.registerService(
            "CommitRevealAuction",
            commitRevealAuction,
            VSOSKernel.ServiceCategory.KERNEL,
            "1.0.0"
        );

        // serviceId must be non-zero
        assertNotEq(serviceId, bytes32(0));

        // getService returns the correct implementation
        address impl = kernel.getService("CommitRevealAuction");
        assertEq(impl, commitRevealAuction);
    }

    // ============ Test 2: Register multiple services across categories ============

    function test_RegisterService_MultipleCategories() public {
        vm.startPrank(owner);

        kernel.registerService("CommitRevealAuction", commitRevealAuction, VSOSKernel.ServiceCategory.KERNEL,     "1.0.0");
        kernel.registerService("SoulboundIdentity",   soulboundIdentity,   VSOSKernel.ServiceCategory.IDENTITY,   "1.0.0");
        kernel.registerService("CrossChainRouter",    crossChainRouter,    VSOSKernel.ServiceCategory.NETWORKING, "1.0.0");
        kernel.registerService("ShapleyDistributor",  shapleyDistributor,  VSOSKernel.ServiceCategory.RESOURCES,  "1.0.0");
        kernel.registerService("VibePluginRegistry",  vibePluginRegistry,  VSOSKernel.ServiceCategory.PACKAGES,   "1.0.0");

        vm.stopPrank();

        assertEq(kernel.getService("CommitRevealAuction"), commitRevealAuction);
        assertEq(kernel.getService("SoulboundIdentity"),   soulboundIdentity);
        assertEq(kernel.getService("CrossChainRouter"),    crossChainRouter);
        assertEq(kernel.getService("ShapleyDistributor"),  shapleyDistributor);
        assertEq(kernel.getService("VibePluginRegistry"),  vibePluginRegistry);
    }

    // ============ Test 3: Get service by name ============

    function test_GetService_ByName() public {
        vm.prank(owner);
        kernel.registerService("CircuitBreaker", circuitBreaker, VSOSKernel.ServiceCategory.KERNEL, "2.1.0");

        address result = kernel.getService("CircuitBreaker");
        assertEq(result, circuitBreaker);
    }

    // ============ Test 4: Get services by category ============

    function test_GetServicesByCategory_ReturnsCorrectIds() public {
        vm.startPrank(owner);

        bytes32 id1 = kernel.registerService("CommitRevealAuction", commitRevealAuction, VSOSKernel.ServiceCategory.KERNEL, "1.0.0");
        bytes32 id2 = kernel.registerService("CircuitBreaker",      circuitBreaker,      VSOSKernel.ServiceCategory.KERNEL, "1.0.0");

        vm.stopPrank();

        bytes32[] memory kernelServices = kernel.getServicesByCategory(VSOSKernel.ServiceCategory.KERNEL);

        assertEq(kernelServices.length, 2);
        assertEq(kernelServices[0], id1);
        assertEq(kernelServices[1], id2);
    }

    function test_GetServicesByCategory_EmptyForUnusedCategory() public view {
        bytes32[] memory govServices = kernel.getServicesByCategory(VSOSKernel.ServiceCategory.GOVERNANCE);
        assertEq(govServices.length, 0);
    }

    // ============ Test 5: Update a service implementation ============

    function test_UpdateService_ChangesImplementation() public {
        vm.startPrank(owner);

        bytes32 serviceId = kernel.registerService(
            "CrossChainRouter",
            crossChainRouter,
            VSOSKernel.ServiceCategory.NETWORKING,
            "1.0.0"
        );

        address newRouter = makeAddr("CrossChainRouterV2");
        kernel.updateService(serviceId, newRouter, "2.0.0");

        vm.stopPrank();

        assertEq(kernel.getService("CrossChainRouter"), newRouter);
    }

    // ============ Test 6: Deactivate a service — getService reverts ============

    function test_DeactivateService_GetServiceReverts() public {
        vm.startPrank(owner);

        bytes32 serviceId = kernel.registerService(
            "SoulboundIdentity",
            soulboundIdentity,
            VSOSKernel.ServiceCategory.IDENTITY,
            "1.0.0"
        );

        kernel.deactivateService(serviceId);

        vm.stopPrank();

        vm.expectRevert("Service not found or inactive");
        kernel.getService("SoulboundIdentity");
    }

    // ============ Test 7: Only owner can register, update, deactivate ============

    function test_OnlyOwner_RegisterReverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        kernel.registerService("Unauthorized", makeAddr("x"), VSOSKernel.ServiceCategory.KERNEL, "1.0.0");
    }

    function test_OnlyOwner_UpdateReverts() public {
        vm.prank(owner);
        bytes32 serviceId = kernel.registerService(
            "CommitRevealAuction",
            commitRevealAuction,
            VSOSKernel.ServiceCategory.KERNEL,
            "1.0.0"
        );

        vm.prank(stranger);
        vm.expectRevert();
        kernel.updateService(serviceId, makeAddr("newImpl"), "2.0.0");
    }

    function test_OnlyOwner_DeactivateReverts() public {
        vm.prank(owner);
        bytes32 serviceId = kernel.registerService(
            "CommitRevealAuction",
            commitRevealAuction,
            VSOSKernel.ServiceCategory.KERNEL,
            "1.0.0"
        );

        vm.prank(stranger);
        vm.expectRevert();
        kernel.deactivateService(serviceId);
    }

    // ============ Test 8: serviceCount increments correctly ============

    function test_ServiceCount_IncrementsOnEachRegistration() public {
        assertEq(kernel.serviceCount(), 0);

        vm.startPrank(owner);

        kernel.registerService("CommitRevealAuction", commitRevealAuction, VSOSKernel.ServiceCategory.KERNEL,     "1.0.0");
        assertEq(kernel.serviceCount(), 1);

        kernel.registerService("SoulboundIdentity",   soulboundIdentity,   VSOSKernel.ServiceCategory.IDENTITY,   "1.0.0");
        assertEq(kernel.serviceCount(), 2);

        kernel.registerService("CrossChainRouter",    crossChainRouter,    VSOSKernel.ServiceCategory.NETWORKING, "1.0.0");
        assertEq(kernel.serviceCount(), 3);

        vm.stopPrank();
    }

    function test_ServiceCount_UnaffectedByDeactivation() public {
        vm.startPrank(owner);

        bytes32 id = kernel.registerService(
            "CommitRevealAuction",
            commitRevealAuction,
            VSOSKernel.ServiceCategory.KERNEL,
            "1.0.0"
        );

        assertEq(kernel.serviceCount(), 1);
        kernel.deactivateService(id);

        // deactivation does not remove from serviceList — count stays at 1
        assertEq(kernel.serviceCount(), 1);

        vm.stopPrank();
    }

    // ============ Test 9: Real VSOS services — canonical registration ============

    function test_VSOSBoot_CanonicalServiceRegistry() public {
        vm.startPrank(owner);

        // Mirror the OS table from the contract's NatSpec comment
        kernel.registerService("CommitRevealAuction", commitRevealAuction, VSOSKernel.ServiceCategory.KERNEL,     "1.0.0");
        kernel.registerService("SoulboundIdentity",   soulboundIdentity,   VSOSKernel.ServiceCategory.IDENTITY,   "1.0.0");
        kernel.registerService("CrossChainRouter",    crossChainRouter,    VSOSKernel.ServiceCategory.NETWORKING, "1.0.0");
        kernel.registerService("ShapleyDistributor",  shapleyDistributor,  VSOSKernel.ServiceCategory.RESOURCES,  "1.0.0");
        kernel.registerService("VibePluginRegistry",  vibePluginRegistry,  VSOSKernel.ServiceCategory.PACKAGES,   "1.0.0");

        vm.stopPrank();

        // All five services are resolvable by name
        assertEq(kernel.getService("CommitRevealAuction"), commitRevealAuction);
        assertEq(kernel.getService("SoulboundIdentity"),   soulboundIdentity);
        assertEq(kernel.getService("CrossChainRouter"),    crossChainRouter);
        assertEq(kernel.getService("ShapleyDistributor"),  shapleyDistributor);
        assertEq(kernel.getService("VibePluginRegistry"),  vibePluginRegistry);

        // Correct category bucketing
        assertEq(kernel.getServicesByCategory(VSOSKernel.ServiceCategory.KERNEL).length,     1);
        assertEq(kernel.getServicesByCategory(VSOSKernel.ServiceCategory.IDENTITY).length,   1);
        assertEq(kernel.getServicesByCategory(VSOSKernel.ServiceCategory.NETWORKING).length, 1);
        assertEq(kernel.getServicesByCategory(VSOSKernel.ServiceCategory.RESOURCES).length,  1);
        assertEq(kernel.getServicesByCategory(VSOSKernel.ServiceCategory.PACKAGES).length,   1);

        // Total count
        assertEq(kernel.serviceCount(), 5);
    }

    // ============ Test 10: Events are emitted correctly ============

    function test_Events_ServiceRegistered() public {
        bytes32 expectedId = keccak256(abi.encodePacked("CommitRevealAuction", uint8(VSOSKernel.ServiceCategory.KERNEL)));

        vm.expectEmit(true, false, false, true);
        emit VSOSKernel.ServiceRegistered(
            expectedId,
            "CommitRevealAuction",
            VSOSKernel.ServiceCategory.KERNEL,
            commitRevealAuction
        );

        vm.prank(owner);
        kernel.registerService("CommitRevealAuction", commitRevealAuction, VSOSKernel.ServiceCategory.KERNEL, "1.0.0");
    }

    function test_Events_ServiceUpdated() public {
        vm.startPrank(owner);

        bytes32 serviceId = kernel.registerService(
            "CrossChainRouter",
            crossChainRouter,
            VSOSKernel.ServiceCategory.NETWORKING,
            "1.0.0"
        );

        address newRouter = makeAddr("CrossChainRouterV2");

        vm.expectEmit(true, false, false, true);
        emit VSOSKernel.ServiceUpdated(serviceId, crossChainRouter, newRouter);

        kernel.updateService(serviceId, newRouter, "2.0.0");

        vm.stopPrank();
    }

    function test_Events_ServiceDeactivated() public {
        vm.startPrank(owner);

        bytes32 serviceId = kernel.registerService(
            "SoulboundIdentity",
            soulboundIdentity,
            VSOSKernel.ServiceCategory.IDENTITY,
            "1.0.0"
        );

        vm.expectEmit(true, false, false, false);
        emit VSOSKernel.ServiceDeactivated(serviceId);

        kernel.deactivateService(serviceId);

        vm.stopPrank();
    }

    // ============ Test 11: Update inactive service reverts ============

    function test_UpdateService_InactiveReverts() public {
        vm.startPrank(owner);

        bytes32 serviceId = kernel.registerService(
            "ShapleyDistributor",
            shapleyDistributor,
            VSOSKernel.ServiceCategory.RESOURCES,
            "1.0.0"
        );

        kernel.deactivateService(serviceId);

        vm.expectRevert("Service not active");
        kernel.updateService(serviceId, makeAddr("newImpl"), "2.0.0");

        vm.stopPrank();
    }

    // ============ Test 12: serviceId is deterministic (name + category) ============

    function test_ServiceId_IsDeterministic() public {
        vm.startPrank(owner);

        bytes32 returnedId = kernel.registerService(
            "VibePluginRegistry",
            vibePluginRegistry,
            VSOSKernel.ServiceCategory.PACKAGES,
            "1.0.0"
        );

        vm.stopPrank();

        bytes32 expectedId = keccak256(abi.encodePacked("VibePluginRegistry", uint8(VSOSKernel.ServiceCategory.PACKAGES)));
        assertEq(returnedId, expectedId);
    }
}
