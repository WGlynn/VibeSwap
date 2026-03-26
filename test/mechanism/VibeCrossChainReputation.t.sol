// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeCrossChainReputation.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibeCrossChainReputation Tests ============

contract VibeCrossChainReputationTest is Test {
    VibeCrossChainReputation public rep;

    address public owner;
    address public bridge;
    address public alice;
    address public bob;

    uint32 constant HOME_CHAIN   = 1;
    uint32 constant REMOTE_CHAIN = 137;

    // ============ Events ============

    event ReputationExported(address indexed user, uint32 indexed destChain, uint256 score, bytes32 proofHash);
    event ReputationImported(address indexed user, uint32 indexed sourceChain, uint256 score);
    event SnapshotCreated(uint256 indexed snapshotId, address indexed user, uint256 score, uint32 sourceChain);
    event MerkleRootVerified(uint32 indexed chainId, bytes32 root);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        bridge = makeAddr("bridge");
        alice  = makeAddr("alice");
        bob    = makeAddr("bob");

        VibeCrossChainReputation impl = new VibeCrossChainReputation();
        bytes memory initData = abi.encodeWithSelector(
            VibeCrossChainReputation.initialize.selector
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        rep = VibeCrossChainReputation(payable(address(proxy)));

        // Register bridge
        rep.addBridge(bridge);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(rep.owner(), owner);
    }

    function test_initialize_bridgeRegistered() public view {
        assertTrue(rep.bridges(bridge));
    }

    // ============ Bridge Access Control ============

    function test_exportReputation_revertsIfNotBridgeOrOwner() public {
        rep.updateLocalScore(alice, 5000);

        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert("Not bridge");
        rep.exportReputation(alice, REMOTE_CHAIN);
    }

    function test_importReputation_revertsIfNotBridgeOrOwner() public {
        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert("Not bridge");
        rep.importReputation(alice, HOME_CHAIN, 5000, bytes32(0));
    }

    function test_updateLocalScore_revertsIfNotAuthorized() public {
        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert("Not authorized");
        rep.updateLocalScore(alice, 5000);
    }

    function test_addBridge_revertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        rep.addBridge(alice);
    }

    function test_removeBridge_revokesAccess() public {
        rep.removeBridge(bridge);
        assertFalse(rep.bridges(bridge));

        rep.updateLocalScore(alice, 1000);

        vm.prank(bridge);
        vm.expectRevert("Not bridge");
        rep.exportReputation(alice, REMOTE_CHAIN);
    }

    // ============ Export ============

    function test_exportReputation_createsSnapshotAndEmitsEvent() public {
        rep.updateLocalScore(alice, 7500);

        vm.prank(bridge);
        vm.expectEmit(true, true, false, false);
        emit ReputationExported(alice, REMOTE_CHAIN, 7500, bytes32(0));
        bytes32 proofHash = rep.exportReputation(alice, REMOTE_CHAIN);

        assertNotEq(proofHash, bytes32(0));
        assertEq(rep.snapshotCount(), 1);
        assertEq(rep.totalExports(), 1);

        VibeCrossChainReputation.ReputationSnapshot memory snap = rep.getSnapshot(1);
        assertEq(snap.user, alice);
        assertEq(snap.score, 7500);
        assertEq(snap.snapshotId, 1);
    }

    function test_exportReputation_revertsOnNoReputation() public {
        vm.prank(bridge);
        vm.expectRevert("No reputation");
        rep.exportReputation(alice, REMOTE_CHAIN);
    }

    function test_exportReputation_ownerCanExportDirectly() public {
        rep.updateLocalScore(alice, 3000);
        // owner (no prank) should succeed
        bytes32 h = rep.exportReputation(alice, REMOTE_CHAIN);
        assertNotEq(h, bytes32(0));
    }

    // ============ Import ============

    function test_importReputation_appliesForeignMultiplier() public {
        uint256 rawScore = 10000;
        bytes32 proofHash = keccak256("proof");

        vm.prank(bridge);
        vm.expectEmit(true, true, false, false);
        emit ReputationImported(alice, HOME_CHAIN, 8000); // 10000 * 80% = 8000
        rep.importReputation(alice, HOME_CHAIN, rawScore, proofHash);

        VibeCrossChainReputation.ChainReputation memory chainRep = rep.getChainReputation(alice, HOME_CHAIN);
        assertEq(chainRep.score, 8000);
        assertEq(chainRep.user, alice);
        assertEq(chainRep.chainId, HOME_CHAIN);
        assertTrue(chainRep.verified);
        assertEq(chainRep.proofHash, proofHash);
        assertEq(rep.totalImports(), 1);
    }

    function test_importReputation_multiplierIsExact80Percent() public {
        vm.prank(bridge);
        rep.importReputation(alice, HOME_CHAIN, 5000, bytes32(0));

        VibeCrossChainReputation.ChainReputation memory chainRep = rep.getChainReputation(alice, HOME_CHAIN);
        assertEq(chainRep.score, 4000); // 5000 * 0.8
    }

    function test_importReputation_revertsOnScoreAboveMax() public {
        vm.prank(bridge);
        vm.expectRevert("Invalid score");
        rep.importReputation(alice, HOME_CHAIN, 10001, bytes32(0));
    }

    function test_importReputation_updatesLocalScoreIfHigher() public {
        // Start with local score of 3000
        rep.updateLocalScore(alice, 3000);

        // Import 9000 from remote -> adjusted 7200, which is higher than 3000
        vm.prank(bridge);
        rep.importReputation(alice, HOME_CHAIN, 9000, bytes32(0));

        // Local should be average of 3000 + 7200 = 5100
        assertEq(rep.localScores(alice), 5100);
    }

    function test_importReputation_doesNotUpdateLocalScoreIfLower() public {
        rep.updateLocalScore(alice, 9000);

        // Import 5000 -> adjusted 4000, lower than 9000
        vm.prank(bridge);
        rep.importReputation(alice, HOME_CHAIN, 5000, bytes32(0));

        // Local remains 9000
        assertEq(rep.localScores(alice), 9000);
    }

    // ============ Local Score Updates ============

    function test_updateLocalScore_setsScore() public {
        rep.updateLocalScore(alice, 6000);
        assertEq(rep.localScores(alice), 6000);
    }

    function test_updateLocalScore_revertsAbove10000() public {
        vm.expectRevert("Invalid score");
        rep.updateLocalScore(alice, 10001);
    }

    function test_updateLocalScore_bridgeCanUpdate() public {
        vm.prank(bridge);
        rep.updateLocalScore(alice, 4000);
        assertEq(rep.localScores(alice), 4000);
    }

    function test_getBestScore_returnsLocalScore() public {
        rep.updateLocalScore(alice, 7777);
        assertEq(rep.getBestScore(alice), 7777);
    }

    function test_getBestScore_returnsZeroForUnknownUser() public view {
        assertEq(rep.getBestScore(bob), 0);
    }

    // ============ Verified Roots ============

    function test_verifyRoot_storesRootAndEmitsEvent() public {
        bytes32 root = keccak256("merkle-root");

        vm.expectEmit(true, false, false, true);
        emit MerkleRootVerified(REMOTE_CHAIN, root);
        rep.verifyRoot(REMOTE_CHAIN, root);

        assertEq(rep.verifiedRoots(REMOTE_CHAIN), root);
    }

    function test_verifyRoot_revertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        rep.verifyRoot(REMOTE_CHAIN, keccak256("root"));
    }

    // ============ Multiple Imports / Snapshots ============

    function test_multipleExports_incrementsSnapshotCount() public {
        rep.updateLocalScore(alice, 5000);
        rep.updateLocalScore(bob, 3000);

        vm.prank(bridge);
        rep.exportReputation(alice, REMOTE_CHAIN);

        vm.prank(bridge);
        rep.exportReputation(bob, REMOTE_CHAIN);

        assertEq(rep.snapshotCount(), 2);
        assertEq(rep.totalExports(), 2);
    }

    function test_importFromMultipleChains_storesIndependently() public {
        uint32 chainA = 1;
        uint32 chainB = 137;
        bytes32 proofA = keccak256("proofA");
        bytes32 proofB = keccak256("proofB");

        vm.prank(bridge);
        rep.importReputation(alice, chainA, 8000, proofA);

        vm.prank(bridge);
        rep.importReputation(alice, chainB, 6000, proofB);

        VibeCrossChainReputation.ChainReputation memory rA = rep.getChainReputation(alice, chainA);
        VibeCrossChainReputation.ChainReputation memory rB = rep.getChainReputation(alice, chainB);

        assertEq(rA.score, 6400); // 8000 * 0.8
        assertEq(rB.score, 4800); // 6000 * 0.8
        assertEq(rA.proofHash, proofA);
        assertEq(rB.proofHash, proofB);
    }

    // ============ Fuzz ============

    function testFuzz_importReputation_scoreAlwaysWithinBounds(uint256 rawScore) public {
        rawScore = bound(rawScore, 1, 10000);

        vm.prank(bridge);
        rep.importReputation(alice, HOME_CHAIN, rawScore, bytes32(0));

        VibeCrossChainReputation.ChainReputation memory chainRep = rep.getChainReputation(alice, HOME_CHAIN);
        assertLe(chainRep.score, 10000);
        assertEq(chainRep.score, (rawScore * 8000) / 10000);
    }

    function testFuzz_exportReputation_snapshotCountGrows(uint8 count) public {
        vm.assume(count > 0 && count < 50);
        rep.updateLocalScore(alice, 5000);

        for (uint256 i = 0; i < count; i++) {
            vm.prank(bridge);
            rep.exportReputation(alice, REMOTE_CHAIN);
        }

        assertEq(rep.snapshotCount(), count);
    }
}
