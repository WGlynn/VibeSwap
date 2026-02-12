// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/PriorityRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title PriorityRegistry Tests
 * @notice Tests for the first-to-publish priority registry
 */
contract PriorityRegistryTest is Test {
    PriorityRegistry public registry;

    address public owner;
    address public recorder;
    address public alice;
    address public bob;

    bytes32 constant SCOPE_ETH_USDC = keccak256("ETH/USDC");
    bytes32 constant SCOPE_BTC_ETH = keccak256("BTC/ETH");

    function setUp() public {
        owner = address(this);
        recorder = makeAddr("recorder");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        PriorityRegistry impl = new PriorityRegistry();
        bytes memory initData = abi.encodeWithSelector(
            PriorityRegistry.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = PriorityRegistry(address(proxy));

        registry.setAuthorizedRecorder(recorder, true);
    }

    // ============ Recording Priority ============

    function test_recordPriority_success() public {
        vm.prank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);

        assertEq(registry.getPioneer(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION), alice);
        assertTrue(registry.isPioneer(alice, SCOPE_ETH_USDC));
        assertEq(registry.pioneerRecordCount(alice), 1);
    }

    function test_recordPriority_firstComeFirstServed() public {
        // Alice records first
        vm.prank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);

        // Bob tries same (scope, category) → reverts
        vm.prank(recorder);
        vm.expectRevert(PriorityRegistry.PriorityAlreadyClaimed.selector);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, bob);

        // Alice stays pioneer
        assertEq(registry.getPioneer(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION), alice);
    }

    function test_recordPriority_multipleCategories() public {
        vm.startPrank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.LIQUIDITY_BOOTSTRAP, alice);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.STRATEGY_AUTHOR, bob);
        vm.stopPrank();

        assertEq(registry.pioneerRecordCount(alice), 2);
        assertEq(registry.pioneerRecordCount(bob), 1);
        assertTrue(registry.isPioneer(alice, SCOPE_ETH_USDC));
        assertTrue(registry.isPioneer(bob, SCOPE_ETH_USDC));
    }

    function test_recordPriority_differentScopes() public {
        vm.startPrank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);
        registry.recordPriority(SCOPE_BTC_ETH, PriorityRegistry.Category.POOL_CREATION, bob);
        vm.stopPrank();

        assertEq(registry.getPioneer(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION), alice);
        assertEq(registry.getPioneer(SCOPE_BTC_ETH, PriorityRegistry.Category.POOL_CREATION), bob);
    }

    function test_recordPriority_zeroAddress_reverts() public {
        vm.prank(recorder);
        vm.expectRevert(PriorityRegistry.ZeroAddress.selector);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, address(0));
    }

    function test_recordPriority_storesTimestamp() public {
        vm.warp(1000);
        vm.roll(50);

        vm.prank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);

        PriorityRegistry.Record memory record = registry.getRecord(
            SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION
        );

        assertEq(record.timestamp, 1000);
        assertEq(record.blockNumber, 50);
        assertTrue(record.active);
    }

    // ============ Pioneer Score ============

    function test_getPioneerScore_singleCategory() public {
        vm.prank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);

        uint256 score = registry.getPioneerScore(alice, SCOPE_ETH_USDC);
        assertEq(score, 10000, "POOL_CREATION weight should be 10000");
    }

    function test_getPioneerScore_multipleCategories() public {
        vm.startPrank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.LIQUIDITY_BOOTSTRAP, alice);
        vm.stopPrank();

        uint256 score = registry.getPioneerScore(alice, SCOPE_ETH_USDC);
        assertEq(score, 10000 + 7500, "Should sum POOL_CREATION + LIQUIDITY_BOOTSTRAP");
    }

    function test_getPioneerScore_notPioneer() public {
        uint256 score = registry.getPioneerScore(alice, SCOPE_ETH_USDC);
        assertEq(score, 0, "Non-pioneer should have score 0");
    }

    function test_getPioneerScore_allCategories() public {
        vm.startPrank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.LIQUIDITY_BOOTSTRAP, alice);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.STRATEGY_AUTHOR, alice);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.INFRASTRUCTURE, alice);
        vm.stopPrank();

        uint256 score = registry.getPioneerScore(alice, SCOPE_ETH_USDC);
        assertEq(score, 10000 + 7500 + 5000 + 5000, "Should sum all category weights");
    }

    // ============ Deactivation ============

    function test_deactivateRecord() public {
        vm.prank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);

        assertEq(registry.getPioneerScore(alice, SCOPE_ETH_USDC), 10000);

        // Owner deactivates
        registry.deactivateRecord(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION);

        // Score drops to 0
        assertEq(registry.getPioneerScore(alice, SCOPE_ETH_USDC), 0);

        // Record still exists but inactive
        PriorityRegistry.Record memory record = registry.getRecord(
            SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION
        );
        assertEq(record.pioneer, alice);
        assertFalse(record.active);
    }

    function test_deactivateRecord_notFound_reverts() public {
        vm.expectRevert(PriorityRegistry.RecordNotFound.selector);
        registry.deactivateRecord(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION);
    }

    function test_deactivateRecord_nonOwner_reverts() public {
        vm.prank(recorder);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);

        vm.prank(recorder);
        vm.expectRevert();
        registry.deactivateRecord(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION);
    }

    // ============ Authorization ============

    function test_unauthorized_reverts() public {
        vm.prank(alice);
        vm.expectRevert(PriorityRegistry.Unauthorized.selector);
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);
    }

    function test_ownerCanRecord() public {
        // Owner is always authorized
        registry.recordPriority(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION, alice);
        assertEq(registry.getPioneer(SCOPE_ETH_USDC, PriorityRegistry.Category.POOL_CREATION), alice);
    }

    // ============ Fuzz ============

    function testFuzz_recordPriority(bytes32 scopeId, uint8 categoryIndex, address pioneer) public {
        vm.assume(pioneer != address(0));
        categoryIndex = uint8(bound(categoryIndex, 0, 3));

        PriorityRegistry.Category category = PriorityRegistry.Category(categoryIndex);

        vm.prank(recorder);
        registry.recordPriority(scopeId, category, pioneer);

        assertEq(registry.getPioneer(scopeId, category), pioneer);
        assertTrue(registry.isPioneer(pioneer, scopeId));
        assertGt(registry.getPioneerScore(pioneer, scopeId), 0);
    }
}
