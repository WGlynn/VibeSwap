// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/depin/VibeInfoFi.sol";

contract VibeInfoFiTest is Test {
    VibeInfoFi public infofi;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;
    address public verifierAddr;

    event PrimitiveContributed(bytes32 indexed primitiveId, address indexed contributor, VibeInfoFi.PrimitiveType pType);
    event PrimitiveVerified(bytes32 indexed primitiveId, address indexed verifier);
    event PrimitiveCited(bytes32 indexed citingId, bytes32 indexed citedId);
    event KnowledgeStaked(bytes32 indexed primitiveId, address indexed staker, uint256 amount);
    event ShapleyAttributed(bytes32 indexed primitiveId, address indexed contributor, uint256 value);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        verifierAddr = makeAddr("verifier");

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
        vm.deal(owner, 100 ether);

        VibeInfoFi impl = new VibeInfoFi();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeInfoFi.initialize.selector)
        );
        infofi = VibeInfoFi(payable(address(proxy)));

        infofi.addVerifier(verifierAddr);
    }

    // ============ Helpers ============

    function _contribute(address user, bytes32 contentHash) internal returns (bytes32) {
        bytes32[] memory deps = new bytes32[](0);
        vm.prank(user);
        return infofi.contributePrimitive(
            VibeInfoFi.PrimitiveType.INSIGHT,
            contentHash,
            deps
        );
    }

    function _contributeWithDeps(address user, bytes32 contentHash, bytes32[] memory deps)
        internal returns (bytes32)
    {
        vm.prank(user);
        return infofi.contributePrimitive(
            VibeInfoFi.PrimitiveType.SYNTHESIS,
            contentHash,
            deps
        );
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(infofi.totalPrimitives(), 0);
        assertEq(infofi.totalCitations(), 0);
        assertEq(infofi.totalValueLocked(), 0);
        assertEq(infofi.totalAttributed(), 0);
    }

    // ============ Knowledge Contribution ============

    function test_contributePrimitive() public {
        bytes32 contentHash = keccak256("first insight");
        bytes32 primitiveId = _contribute(alice, contentHash);

        assertTrue(primitiveId != bytes32(0));
        assertEq(infofi.totalPrimitives(), 1);

        VibeInfoFi.KnowledgePrimitive memory kp = infofi.getPrimitive(primitiveId);
        assertEq(kp.primitiveId, primitiveId);
        assertEq(kp.contributor, alice);
        assertEq(uint8(kp.primitiveType), uint8(VibeInfoFi.PrimitiveType.INSIGHT));
        assertEq(kp.contentHash, contentHash);
        assertEq(kp.citationCount, 0);
        assertEq(kp.intrinsicValue, 0);
        assertFalse(kp.verified);
        assertTrue(kp.active);
    }

    function test_contributePrimitive_updatesContributorProfile() public {
        _contribute(alice, keccak256("insight1"));

        VibeInfoFi.ContributorProfile memory profile = infofi.getContributor(alice);
        assertEq(profile.contributor, alice);
        assertEq(profile.totalPrimitives, 1);
        assertGt(profile.firstContribution, 0);
    }

    function test_contributePrimitive_withDependencies() public {
        bytes32 dep1 = _contribute(alice, keccak256("base1"));
        bytes32 dep2 = _contribute(bob, keccak256("base2"));

        bytes32[] memory deps = new bytes32[](2);
        deps[0] = dep1;
        deps[1] = dep2;

        vm.warp(block.timestamp + 1);
        bytes32 synthesisId = _contributeWithDeps(charlie, keccak256("synthesis"), deps);

        // Check citations
        assertEq(infofi.totalCitations(), 2);

        bytes32[] memory citations = infofi.getCitations(synthesisId);
        assertEq(citations.length, 2);
        assertEq(citations[0], dep1);
        assertEq(citations[1], dep2);

        // Check citation counts on dependencies
        VibeInfoFi.KnowledgePrimitive memory kp1 = infofi.getPrimitive(dep1);
        assertEq(kp1.citationCount, 1);

        VibeInfoFi.KnowledgePrimitive memory kp2 = infofi.getPrimitive(dep2);
        assertEq(kp2.citationCount, 1);
    }

    function test_contributePrimitive_revert_invalidDependency() public {
        bytes32[] memory deps = new bytes32[](1);
        deps[0] = keccak256("nonexistent");

        vm.prank(alice);
        vm.expectRevert("Invalid dependency");
        infofi.contributePrimitive(VibeInfoFi.PrimitiveType.INSIGHT, keccak256("content"), deps);
    }

    function test_contributePrimitive_initializesMarket() public {
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        (bytes32 mId, uint256 totalStaked, uint256 buyPrice, uint256 sellPrice, ) =
            infofi.markets(primitiveId);

        assertEq(mId, primitiveId);
        assertEq(totalStaked, 0);
        assertEq(buyPrice, 0.001 ether);
        assertEq(sellPrice, 0);
    }

    function test_contributePrimitive_allTypes() public {
        bytes32[] memory deps = new bytes32[](0);

        vm.startPrank(alice);
        infofi.contributePrimitive(VibeInfoFi.PrimitiveType.INSIGHT, keccak256("1"), deps);
        vm.warp(block.timestamp + 1);
        infofi.contributePrimitive(VibeInfoFi.PrimitiveType.DISCOVERY, keccak256("2"), deps);
        vm.warp(block.timestamp + 1);
        infofi.contributePrimitive(VibeInfoFi.PrimitiveType.SYNTHESIS, keccak256("3"), deps);
        vm.warp(block.timestamp + 1);
        infofi.contributePrimitive(VibeInfoFi.PrimitiveType.PROOF, keccak256("4"), deps);
        vm.warp(block.timestamp + 1);
        infofi.contributePrimitive(VibeInfoFi.PrimitiveType.DATA, keccak256("5"), deps);
        vm.warp(block.timestamp + 1);
        infofi.contributePrimitive(VibeInfoFi.PrimitiveType.MODEL, keccak256("6"), deps);
        vm.warp(block.timestamp + 1);
        infofi.contributePrimitive(VibeInfoFi.PrimitiveType.FRAMEWORK, keccak256("7"), deps);
        vm.stopPrank();

        assertEq(infofi.totalPrimitives(), 7);
    }

    // ============ Verification ============

    function test_verifyPrimitive() public {
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        vm.prank(verifierAddr);
        infofi.verifyPrimitive(primitiveId);

        VibeInfoFi.KnowledgePrimitive memory kp = infofi.getPrimitive(primitiveId);
        assertTrue(kp.verified);
    }

    function test_verifyPrimitive_revert_notVerifier() public {
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        vm.prank(alice);
        vm.expectRevert("Not verifier");
        infofi.verifyPrimitive(primitiveId);
    }

    function test_verifyPrimitive_revert_selfVerify() public {
        // Verifier contributes and tries to self-verify
        infofi.addVerifier(alice);
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        vm.prank(alice);
        vm.expectRevert("Self-verify");
        infofi.verifyPrimitive(primitiveId);
    }

    function test_verifyPrimitive_revert_notActive() public {
        // Non-existent primitive (active defaults to false)
        vm.prank(verifierAddr);
        vm.expectRevert("Not active");
        infofi.verifyPrimitive(keccak256("nonexistent"));
    }

    // ============ Knowledge Market ============

    function test_stakeOnKnowledge() public {
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        vm.prank(bob);
        infofi.stakeOnKnowledge{value: 1 ether}(primitiveId);

        assertEq(infofi.stakes(primitiveId, bob), 1 ether);
        assertEq(infofi.totalValueLocked(), 1 ether);

        (bytes32 mId, uint256 totalStaked, uint256 buyPrice, uint256 sellPrice, ) =
            infofi.markets(primitiveId);

        assertEq(totalStaked, 1 ether);
        // Price = (1 ether / 1000) + 0.001 ether = 0.001001 ether
        assertEq(buyPrice, (1 ether / 1000) + 0.001 ether);
        // Sell = buy * 9 / 10
        assertEq(sellPrice, buyPrice * 9 / 10);

        VibeInfoFi.KnowledgePrimitive memory kp = infofi.getPrimitive(primitiveId);
        assertEq(kp.intrinsicValue, 1 ether);
    }

    function test_stakeOnKnowledge_revert_zeroStake() public {
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        vm.prank(bob);
        vm.expectRevert("Zero stake");
        infofi.stakeOnKnowledge{value: 0}(primitiveId);
    }

    function test_stakeOnKnowledge_revert_notActive() public {
        vm.prank(bob);
        vm.expectRevert("Not active");
        infofi.stakeOnKnowledge{value: 1 ether}(keccak256("nonexistent"));
    }

    function test_stakeOnKnowledge_multipleStakers() public {
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        vm.prank(bob);
        infofi.stakeOnKnowledge{value: 1 ether}(primitiveId);

        vm.prank(charlie);
        infofi.stakeOnKnowledge{value: 2 ether}(primitiveId);

        assertEq(infofi.stakes(primitiveId, bob), 1 ether);
        assertEq(infofi.stakes(primitiveId, charlie), 2 ether);
        assertEq(infofi.totalValueLocked(), 3 ether);
    }

    // ============ Shapley Attribution ============

    function test_distributeShapleyAttribution_noDeps() public {
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));
        uint256 aliceBefore = alice.balance;

        // No dependencies: 100% to contributor
        infofi.distributeShapleyAttribution{value: 1 ether}(primitiveId, 1 ether);

        assertEq(alice.balance, aliceBefore + 1 ether);
        assertEq(infofi.totalAttributed(), 1 ether);

        VibeInfoFi.ContributorProfile memory profile = infofi.getContributor(alice);
        assertEq(profile.totalEarned, 1 ether);
        assertEq(profile.shapleyScore, 1 ether);
    }

    function test_distributeShapleyAttribution_withDeps() public {
        bytes32 dep1 = _contribute(alice, keccak256("base"));
        vm.warp(block.timestamp + 1);

        bytes32[] memory deps = new bytes32[](1);
        deps[0] = dep1;
        bytes32 synthesisId = _contributeWithDeps(bob, keccak256("synthesis"), deps);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        // With dependencies: 60% to direct contributor, 40% split among deps
        infofi.distributeShapleyAttribution{value: 1 ether}(synthesisId, 1 ether);

        uint256 directShare = (1 ether * 6000) / 10000; // 0.6 ether
        uint256 depShare = 1 ether - directShare;         // 0.4 ether

        assertEq(bob.balance, bobBefore + directShare);
        assertEq(alice.balance, aliceBefore + depShare);
        assertEq(infofi.totalAttributed(), 1 ether);
    }

    function test_distributeShapleyAttribution_multipleDeps() public {
        bytes32 dep1 = _contribute(alice, keccak256("base1"));
        vm.warp(block.timestamp + 1);
        bytes32 dep2 = _contribute(bob, keccak256("base2"));
        vm.warp(block.timestamp + 1);

        bytes32[] memory deps = new bytes32[](2);
        deps[0] = dep1;
        deps[1] = dep2;
        bytes32 synthesisId = _contributeWithDeps(charlie, keccak256("synthesis"), deps);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        uint256 charlieBefore = charlie.balance;

        infofi.distributeShapleyAttribution{value: 1 ether}(synthesisId, 1 ether);

        uint256 directShare = (1 ether * 6000) / 10000; // 0.6 ether
        uint256 remaining = 1 ether - directShare;       // 0.4 ether
        uint256 perDep = remaining / 2;                   // 0.2 ether each

        assertEq(charlie.balance, charlieBefore + directShare);
        assertEq(alice.balance, aliceBefore + perDep);
        assertEq(bob.balance, bobBefore + perDep);
    }

    function test_distributeShapleyAttribution_revert_insufficientValue() public {
        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        vm.expectRevert("Insufficient value");
        infofi.distributeShapleyAttribution{value: 0.5 ether}(primitiveId, 1 ether);
    }

    function test_distributeShapleyAttribution_revert_notActive() public {
        vm.expectRevert("Not active");
        infofi.distributeShapleyAttribution{value: 1 ether}(keccak256("nonexistent"), 1 ether);
    }

    // ============ Admin ============

    function test_addVerifier() public {
        address newVerifier = makeAddr("newVerifier");
        infofi.addVerifier(newVerifier);
        assertTrue(infofi.verifiers(newVerifier));
    }

    function test_removeVerifier() public {
        infofi.removeVerifier(verifierAddr);
        assertFalse(infofi.verifiers(verifierAddr));
    }

    function test_addVerifier_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        infofi.addVerifier(alice);
    }

    // ============ View Functions ============

    function test_getPrimitiveCount() public {
        assertEq(infofi.getPrimitiveCount(), 0);
        _contribute(alice, keccak256("1"));
        assertEq(infofi.getPrimitiveCount(), 1);
    }

    function test_getTotalValueLocked() public view {
        assertEq(infofi.getTotalValueLocked(), 0);
    }

    function test_getAttributionCount() public view {
        assertEq(infofi.getAttributionCount(), 0);
    }

    function test_getContributor_noProfile() public view {
        VibeInfoFi.ContributorProfile memory profile = infofi.getContributor(alice);
        assertEq(profile.contributor, address(0));
        assertEq(profile.totalPrimitives, 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_stakeOnKnowledge_anyAmount(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(bob, uint256(amount));

        bytes32 primitiveId = _contribute(alice, keccak256("insight"));

        vm.prank(bob);
        infofi.stakeOnKnowledge{value: amount}(primitiveId);

        assertEq(infofi.stakes(primitiveId, bob), uint256(amount));
        assertEq(infofi.totalValueLocked(), uint256(amount));
    }

    function testFuzz_distributeAttribution_noDeps(uint96 value) public {
        vm.assume(value > 0);
        vm.deal(owner, uint256(value));

        bytes32 primitiveId = _contribute(alice, keccak256("insight"));
        uint256 aliceBefore = alice.balance;

        infofi.distributeShapleyAttribution{value: value}(primitiveId, uint256(value));

        assertEq(alice.balance, aliceBefore + uint256(value));
    }

    // ============ Edge Cases ============

    function test_receive_ether() public {
        uint256 before = infofi.totalValueLocked();
        (bool ok,) = address(infofi).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(infofi.totalValueLocked(), before + 1 ether);
    }

    function test_multiplePrimitivesFromSameContributor() public {
        vm.warp(100);
        _contribute(alice, keccak256("1"));
        vm.warp(101);
        _contribute(alice, keccak256("2"));
        vm.warp(102);
        _contribute(alice, keccak256("3"));

        VibeInfoFi.ContributorProfile memory profile = infofi.getContributor(alice);
        assertEq(profile.totalPrimitives, 3);
        assertEq(profile.firstContribution, 100);
    }
}
