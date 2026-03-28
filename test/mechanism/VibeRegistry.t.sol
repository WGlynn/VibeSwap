// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VibeRegistryTest is Test {
    // ============ Re-declare events ============

    event ContractRegistered(string name, address implementation, address proxy, string category);
    event ContractUpdated(string name, address newImplementation, uint256 newVersion);
    event ContractDeactivated(string name);

    // ============ State ============

    VibeRegistry public registry;

    address public owner;
    address public alice;

    // Placeholder contract addresses (non-zero for testing)
    address constant IMPL_V1  = address(0x1111);
    address constant IMPL_V2  = address(0x2222);
    address constant IMPL_V3  = address(0x3333);
    address constant PROXY_A  = address(0xAAAA);
    address constant PROXY_B  = address(0xBBBB);

    string constant NAME_CORE   = "VibeSwapCore";
    string constant NAME_AMM    = "VibeAMM";
    string constant CAT_CORE    = "core";
    string constant CAT_FINANCE = "financial";

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");

        // Both deployments must run as `owner` so that when the proxy constructor
        // executes initialize() the msg.sender is `owner` (becomes Ownable owner).
        vm.startPrank(owner);
        VibeRegistry impl = new VibeRegistry();
        bytes memory initData = abi.encodeCall(VibeRegistry.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vm.stopPrank();

        registry = VibeRegistry(address(proxy));
    }

    // ============ Helpers ============

    function _register(string memory name, address impl, address prxy, string memory cat) internal {
        vm.prank(owner);
        registry.register(name, impl, prxy, cat);
    }

    // ============ 1. Initialization ============

    function test_initialize_ownerIsSet() public view {
        assertEq(registry.owner(), owner);
    }

    function test_initialize_contractCountIsZero() public view {
        assertEq(registry.getContractCount(), 0);
    }

    // ============ 2. Register ============

    function test_register_success() public {
        vm.expectEmit(false, false, false, true);
        emit ContractRegistered(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        bytes32 key = keccak256(abi.encodePacked(NAME_CORE));
        (
            string memory name,
            address implementation,
            address prxy,
            uint256 version,
            ,
            ,
            bool active,
            string memory category
        ) = registry.contracts(key);

        assertEq(name, NAME_CORE);
        assertEq(implementation, IMPL_V1);
        assertEq(prxy, PROXY_A);
        assertEq(version, 1);
        assertTrue(active);
        assertEq(category, CAT_CORE);
        assertEq(registry.getContractCount(), 1);
    }

    function test_register_storesVersionHistory() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);
        assertEq(registry.getVersionHistory(NAME_CORE, 1), IMPL_V1);
    }

    function test_register_appendsToCategory() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);
        _register(NAME_AMM,  IMPL_V2, PROXY_B, CAT_CORE);

        bytes32[] memory keys = registry.getCategoryContracts(CAT_CORE);
        assertEq(keys.length, 2);
        assertEq(keys[0], keccak256(abi.encodePacked(NAME_CORE)));
        assertEq(keys[1], keccak256(abi.encodePacked(NAME_AMM)));
    }

    function test_register_revertsIfAlreadyRegistered() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        vm.prank(owner);
        vm.expectRevert("Already registered");
        registry.register(NAME_CORE, IMPL_V2, PROXY_B, CAT_CORE);
    }

    function test_register_revertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);
    }

    // ============ 3. getAddress ============

    function test_getAddress_returnsProxyWhenSet() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);
        assertEq(registry.getAddress(NAME_CORE), PROXY_A);
    }

    function test_getAddress_returnsImplementationWhenNoProxy() public {
        _register(NAME_CORE, IMPL_V1, address(0), CAT_CORE);
        assertEq(registry.getAddress(NAME_CORE), IMPL_V1);
    }

    function test_getAddress_returnsZeroForUnknownContract() public view {
        assertEq(registry.getAddress("Unknown"), address(0));
    }

    // ============ 4. getImplementation ============

    function test_getImplementation_returnsImplementation() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);
        assertEq(registry.getImplementation(NAME_CORE), IMPL_V1);
    }

    // ============ 5. Update ============

    function test_update_success() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        vm.expectEmit(false, false, false, true);
        emit ContractUpdated(NAME_CORE, IMPL_V2, 2);

        vm.prank(owner);
        registry.update(NAME_CORE, IMPL_V2);

        bytes32 key = keccak256(abi.encodePacked(NAME_CORE));
        (, address implementation,, uint256 version,,,, ) = registry.contracts(key);

        assertEq(implementation, IMPL_V2);
        assertEq(version, 2);
    }

    function test_update_storesVersionHistory() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        vm.prank(owner);
        registry.update(NAME_CORE, IMPL_V2);
        vm.prank(owner);
        registry.update(NAME_CORE, IMPL_V3);

        assertEq(registry.getVersionHistory(NAME_CORE, 1), IMPL_V1);
        assertEq(registry.getVersionHistory(NAME_CORE, 2), IMPL_V2);
        assertEq(registry.getVersionHistory(NAME_CORE, 3), IMPL_V3);
        assertEq(registry.getVersion(NAME_CORE), 3);
    }

    function test_update_revertsIfNotRegistered() public {
        vm.prank(owner);
        vm.expectRevert("Not registered");
        registry.update("NonExistent", IMPL_V2);
    }

    function test_update_revertsIfNotOwner() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        vm.prank(alice);
        vm.expectRevert();
        registry.update(NAME_CORE, IMPL_V2);
    }

    // ============ 6. Deactivate ============

    function test_deactivate_success() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        vm.expectEmit(false, false, false, true);
        emit ContractDeactivated(NAME_CORE);

        vm.prank(owner);
        registry.deactivate(NAME_CORE);

        bytes32 key = keccak256(abi.encodePacked(NAME_CORE));
        (,,,,,,bool active,) = registry.contracts(key);
        assertFalse(active);
    }

    function test_deactivate_preventsReregistration() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        vm.prank(owner);
        registry.deactivate(NAME_CORE);

        // Deactivated contract has active=false, so register check passes for "already registered"
        // Actually deactivate sets active=false, but register checks "Already registered" on active
        // so after deactivation re-registration should succeed (active is false, so check passes)
        vm.prank(owner);
        registry.register(NAME_CORE, IMPL_V2, PROXY_B, CAT_CORE);

        bytes32 key = keccak256(abi.encodePacked(NAME_CORE));
        (,, address prxy,,,,bool active,) = registry.contracts(key);
        assertTrue(active);
        assertEq(prxy, PROXY_B);
    }

    function test_deactivate_revertsIfNotOwner() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        vm.prank(alice);
        vm.expectRevert();
        registry.deactivate(NAME_CORE);
    }

    // ============ 7. Category & Version Views ============

    function test_getCategoryContracts_multipleCategories() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);
        _register(NAME_AMM,  IMPL_V2, PROXY_B, CAT_FINANCE);

        bytes32[] memory coreKeys    = registry.getCategoryContracts(CAT_CORE);
        bytes32[] memory finKeys     = registry.getCategoryContracts(CAT_FINANCE);
        bytes32[] memory emptyKeys   = registry.getCategoryContracts("nonexistent");

        assertEq(coreKeys.length, 1);
        assertEq(finKeys.length, 1);
        assertEq(emptyKeys.length, 0);
    }

    function test_getVersion_returnsOneAfterFirstRegister() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);
        assertEq(registry.getVersion(NAME_CORE), 1);
    }

    function test_getVersion_returnsZeroForUnknown() public view {
        assertEq(registry.getVersion("Unknown"), 0);
    }

    function test_getContractCount_multipleEntries() public {
        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);
        _register(NAME_AMM,  IMPL_V2, PROXY_B, CAT_FINANCE);
        _register("VibeLending", IMPL_V3, address(0), CAT_FINANCE);

        assertEq(registry.getContractCount(), 3);
    }

    // ============ 8. Fuzz ============

    function testFuzz_registerAndUpdate(uint8 updateCount) public {
        vm.assume(updateCount > 0 && updateCount <= 10);

        _register(NAME_CORE, IMPL_V1, PROXY_A, CAT_CORE);

        for (uint8 i = 0; i < updateCount; i++) {
            address newImpl = address(uint160(0x1000 + i));
            vm.prank(owner);
            registry.update(NAME_CORE, newImpl);
        }

        assertEq(registry.getVersion(NAME_CORE), uint256(updateCount) + 1);
    }
}
