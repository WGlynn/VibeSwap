// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/PriorityRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Fuzz Tests ============

contract PriorityRegistryFuzzTest is Test {
    PriorityRegistry public registry;

    address public owner;
    address public recorder;

    function setUp() public {
        owner = address(this);
        recorder = makeAddr("recorder");

        PriorityRegistry impl = new PriorityRegistry();
        bytes memory initData = abi.encodeWithSelector(
            PriorityRegistry.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = PriorityRegistry(address(proxy));

        registry.setAuthorizedRecorder(recorder, true);
    }

    // ============ Fuzz: any valid record produces positive score ============

    function testFuzz_recordProducesPositiveScore(
        bytes32 scopeId,
        uint8 categoryIdx,
        address pioneer
    ) public {
        vm.assume(pioneer != address(0));
        categoryIdx = uint8(bound(categoryIdx, 0, 3));

        PriorityRegistry.Category category = PriorityRegistry.Category(categoryIdx);

        vm.prank(recorder);
        registry.recordPriority(scopeId, category, pioneer);

        uint256 score = registry.getPioneerScore(pioneer, scopeId);
        assertGt(score, 0, "Active record must produce positive score");
        assertTrue(registry.isPioneer(pioneer, scopeId));
    }

    // ============ Fuzz: first-come-first-served ============

    function testFuzz_firstComeFirstServed(
        bytes32 scopeId,
        uint8 categoryIdx,
        address pioneer1,
        address pioneer2
    ) public {
        vm.assume(pioneer1 != address(0) && pioneer2 != address(0));
        vm.assume(pioneer1 != pioneer2);
        categoryIdx = uint8(bound(categoryIdx, 0, 3));

        PriorityRegistry.Category category = PriorityRegistry.Category(categoryIdx);

        vm.prank(recorder);
        registry.recordPriority(scopeId, category, pioneer1);

        vm.prank(recorder);
        vm.expectRevert(PriorityRegistry.PriorityAlreadyClaimed.selector);
        registry.recordPriority(scopeId, category, pioneer2);

        assertEq(registry.getPioneer(scopeId, category), pioneer1);
    }

    // ============ Fuzz: score is sum of category weights ============

    function testFuzz_scoreIsSumOfWeights(bytes32 scopeId, address pioneer) public {
        vm.assume(pioneer != address(0));

        uint256 expectedScore = 0;

        vm.startPrank(recorder);

        // Record all 4 categories
        registry.recordPriority(scopeId, PriorityRegistry.Category.POOL_CREATION, pioneer);
        expectedScore += 10000;

        registry.recordPriority(scopeId, PriorityRegistry.Category.LIQUIDITY_BOOTSTRAP, pioneer);
        expectedScore += 7500;

        registry.recordPriority(scopeId, PriorityRegistry.Category.STRATEGY_AUTHOR, pioneer);
        expectedScore += 5000;

        registry.recordPriority(scopeId, PriorityRegistry.Category.INFRASTRUCTURE, pioneer);
        expectedScore += 5000;

        vm.stopPrank();

        uint256 actualScore = registry.getPioneerScore(pioneer, scopeId);
        assertEq(actualScore, expectedScore, "Score must equal sum of category weights");
        assertEq(actualScore, 27500, "Max score = 27500");
    }

    // ============ Fuzz: deactivation reduces score ============

    function testFuzz_deactivationReducesScore(
        bytes32 scopeId,
        address pioneer,
        uint8 deactivateIdx
    ) public {
        vm.assume(pioneer != address(0));
        deactivateIdx = uint8(bound(deactivateIdx, 0, 3));

        // Record all categories
        vm.startPrank(recorder);
        registry.recordPriority(scopeId, PriorityRegistry.Category.POOL_CREATION, pioneer);
        registry.recordPriority(scopeId, PriorityRegistry.Category.LIQUIDITY_BOOTSTRAP, pioneer);
        registry.recordPriority(scopeId, PriorityRegistry.Category.STRATEGY_AUTHOR, pioneer);
        registry.recordPriority(scopeId, PriorityRegistry.Category.INFRASTRUCTURE, pioneer);
        vm.stopPrank();

        uint256 scoreBefore = registry.getPioneerScore(pioneer, scopeId);

        // Deactivate one
        PriorityRegistry.Category cat = PriorityRegistry.Category(deactivateIdx);
        registry.deactivateRecord(scopeId, cat);

        uint256 scoreAfter = registry.getPioneerScore(pioneer, scopeId);
        assertLt(scoreAfter, scoreBefore, "Deactivation must reduce score");
    }

    // ============ Fuzz: different scopes are independent ============

    function testFuzz_scopesIndependent(
        bytes32 scope1,
        bytes32 scope2,
        address pioneer1,
        address pioneer2
    ) public {
        vm.assume(pioneer1 != address(0) && pioneer2 != address(0));
        vm.assume(scope1 != scope2);

        vm.startPrank(recorder);
        registry.recordPriority(scope1, PriorityRegistry.Category.POOL_CREATION, pioneer1);
        registry.recordPriority(scope2, PriorityRegistry.Category.POOL_CREATION, pioneer2);
        vm.stopPrank();

        assertEq(registry.getPioneer(scope1, PriorityRegistry.Category.POOL_CREATION), pioneer1);
        assertEq(registry.getPioneer(scope2, PriorityRegistry.Category.POOL_CREATION), pioneer2);
    }

    // ============ Fuzz: pioneer count tracks correctly ============

    function testFuzz_pioneerCountCorrect(bytes32 scopeId, address pioneer) public {
        vm.assume(pioneer != address(0));

        uint256 countBefore = registry.pioneerRecordCount(pioneer);

        vm.prank(recorder);
        registry.recordPriority(scopeId, PriorityRegistry.Category.POOL_CREATION, pioneer);

        assertEq(
            registry.pioneerRecordCount(pioneer),
            countBefore + 1,
            "Count must increment by 1"
        );
    }
}
