// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/bridge/AttributionBridge.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Test Suite ============

/**
 * @title AttributionBridgeTest
 * @notice Comprehensive Foundry tests for the AttributionBridge contract.
 *         Covers epoch lifecycle, merkle proof verification, access control,
 *         challenge period enforcement, Shapley game creation, and edge cases.
 */
contract AttributionBridgeTest is Test {

    // ============ Events (redeclared for 0.8.20 emit syntax) ============
    event EpochSubmitted(uint256 indexed epochId, bytes32 merkleRoot, uint256 totalPool, uint256 participantCount);
    event ContributionProven(uint256 indexed epochId, address indexed contributor, uint256 score);
    event EpochFinalized(uint256 indexed epochId);
    event ShapleyGameCreated(uint256 indexed epochId, bytes32 gameId);

    // ============ State ============

    AttributionBridge public bridge;
    ShapleyDistributor public shapley;
    MockERC20 public token;

    address public owner = address(this);
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public attacker = makeAddr("attacker");

    // Contribution data for building merkle trees
    uint256 constant ALICE_SCORE = 5000;
    uint256 constant BOB_SCORE = 3000;
    uint256 constant CAROL_SCORE = 2000;
    uint256 constant ALICE_DERIVATIONS = 12;
    uint256 constant BOB_DERIVATIONS = 8;
    uint256 constant CAROL_DERIVATIONS = 3;
    uint8 constant SOURCE_CODE = 3;
    uint8 constant SOURCE_PAPER = 2;
    uint8 constant SOURCE_VIDEO = 1;

    // Pre-computed merkle tree for (alice, bob, carol) contributions
    // Leaves are keccak256(abi.encodePacked(contributor, directScore, derivationCount, sourceType))
    bytes32 public aliceLeaf;
    bytes32 public bobLeaf;
    bytes32 public carolLeaf;
    bytes32 public merkleRoot;

    // Merkle proofs (computed in setUp)
    bytes32[] public aliceProof;
    bytes32[] public bobProof;
    bytes32[] public carolProof;

    // ============ Setup ============

    function setUp() public {
        // Deploy mock token
        token = new MockERC20();

        // Deploy ShapleyDistributor behind UUPS proxy
        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(ShapleyDistributor.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        shapley = ShapleyDistributor(payable(address(proxy)));

        // Deploy AttributionBridge
        bridge = new AttributionBridge(address(shapley));

        // Authorize the bridge as a game creator on ShapleyDistributor
        shapley.setAuthorizedCreator(address(bridge), true);

        // Build merkle tree
        // Leaves: sorted pairs hashed up the tree
        aliceLeaf = keccak256(abi.encodePacked(alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE));
        bobLeaf = keccak256(abi.encodePacked(bob, BOB_SCORE, BOB_DERIVATIONS, SOURCE_PAPER));
        carolLeaf = keccak256(abi.encodePacked(carol, CAROL_SCORE, CAROL_DERIVATIONS, SOURCE_VIDEO));

        // Three-leaf tree:
        //         root
        //        /    \
        //     ab       carol
        //    / \
        // alice bob
        //
        // We use OpenZeppelin's MerkleProof which expects sorted pairs.
        // hash(alice, bob) then hash(result, carol)

        bytes32 ab = _hashPair(aliceLeaf, bobLeaf);
        merkleRoot = _hashPair(ab, carolLeaf);

        // Alice proof: [bobLeaf, carolLeaf]
        aliceProof.push(bobLeaf);
        aliceProof.push(carolLeaf);

        // Bob proof: [aliceLeaf, carolLeaf]
        bobProof.push(aliceLeaf);
        bobProof.push(carolLeaf);

        // Carol proof: [ab]
        carolProof.push(ab);

        // Mint tokens for reward pool
        token.mint(address(shapley), 100_000 ether);
    }

    // ============ Helpers ============

    /// @dev Mirrors OpenZeppelin's MerkleProof internal hashing: sorted pair hash
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Submit a standard epoch for reuse in multiple tests
    function _submitDefaultEpoch() internal returns (uint256 epochId) {
        bridge.submitEpoch(merkleRoot, 10_000 ether, address(token), 3);
        epochId = bridge.epochCounter();
    }

    /// @dev Prove all three contributors for a given epoch
    function _proveAllContributors(uint256 epochId) internal {
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);
        bridge.proveContribution(epochId, bob, BOB_SCORE, BOB_DERIVATIONS, SOURCE_PAPER, bobProof);
        bridge.proveContribution(epochId, carol, CAROL_SCORE, CAROL_DERIVATIONS, SOURCE_VIDEO, carolProof);
    }

    // ============ Test: Epoch Submission ============

    function test_submitEpoch_success() public {
        uint256 epochId = _submitDefaultEpoch();

        assertEq(epochId, 1, "First epoch should be ID 1");
        assertEq(bridge.epochCounter(), 1);

        (
            bytes32 root,
            uint256 totalPool,
            address rewardToken,
            uint256 submittedAt,
            uint256 participantCount,
            bool finalized,
            bool settled
        ) = bridge.epochs(epochId);

        assertEq(root, merkleRoot);
        assertEq(totalPool, 10_000 ether);
        assertEq(rewardToken, address(token));
        assertEq(submittedAt, block.timestamp);
        assertEq(participantCount, 3);
        assertFalse(finalized);
        assertFalse(settled);
    }

    function test_submitEpoch_incrementsCounter() public {
        bridge.submitEpoch(merkleRoot, 1000, address(token), 2);
        bridge.submitEpoch(merkleRoot, 2000, address(token), 5);
        bridge.submitEpoch(merkleRoot, 3000, address(token), 10);

        assertEq(bridge.epochCounter(), 3);
    }

    function test_submitEpoch_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit EpochSubmitted(1, merkleRoot, 10_000 ether, 3);

        bridge.submitEpoch(merkleRoot, 10_000 ether, address(token), 3);
    }

    function test_submitEpoch_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
        bridge.submitEpoch(merkleRoot, 10_000 ether, address(token), 3);
    }

    // ============ Test: Prove Contribution ============

    function test_proveContribution_validProofAlice() public {
        uint256 epochId = _submitDefaultEpoch();

        vm.expectEmit(true, true, false, true);
        emit ContributionProven(epochId, alice, ALICE_SCORE);

        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);
    }

    function test_proveContribution_validProofBob() public {
        uint256 epochId = _submitDefaultEpoch();

        bridge.proveContribution(epochId, bob, BOB_SCORE, BOB_DERIVATIONS, SOURCE_PAPER, bobProof);
        // No revert = success
    }

    function test_proveContribution_validProofCarol() public {
        uint256 epochId = _submitDefaultEpoch();

        bridge.proveContribution(epochId, carol, CAROL_SCORE, CAROL_DERIVATIONS, SOURCE_VIDEO, carolProof);
        // No revert = success
    }

    function test_proveContribution_anyoneCanProve() public {
        uint256 epochId = _submitDefaultEpoch();

        // A random third party proves Alice's contribution — permissionless proving
        vm.prank(attacker);
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);
    }

    function test_proveContribution_revertsInvalidProof() public {
        uint256 epochId = _submitDefaultEpoch();

        // Use Bob's proof for Alice's data => invalid
        vm.expectRevert("Invalid proof");
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, bobProof);
    }

    function test_proveContribution_revertsWrongScore() public {
        uint256 epochId = _submitDefaultEpoch();

        // Tamper with score: 9999 instead of ALICE_SCORE
        vm.expectRevert("Invalid proof");
        bridge.proveContribution(epochId, alice, 9999, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);
    }

    function test_proveContribution_revertsWrongDerivationCount() public {
        uint256 epochId = _submitDefaultEpoch();

        vm.expectRevert("Invalid proof");
        bridge.proveContribution(epochId, alice, ALICE_SCORE, 999, SOURCE_CODE, aliceProof);
    }

    function test_proveContribution_revertsWrongSourceType() public {
        uint256 epochId = _submitDefaultEpoch();

        // Wrong source type (VIDEO instead of CODE)
        vm.expectRevert("Invalid proof");
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_VIDEO, aliceProof);
    }

    function test_proveContribution_revertsNonExistentEpoch() public {
        vm.expectRevert("Epoch not found");
        bridge.proveContribution(999, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);
    }

    function test_proveContribution_revertsAfterSettled() public {
        uint256 epochId = _submitDefaultEpoch();
        _proveAllContributors(epochId);

        // Finalize after challenge period
        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        // Create Shapley game (settles the epoch)
        bridge.createShapleyGame(epochId);

        // Now try to prove again — should revert
        vm.expectRevert("Already settled");
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);
    }

    // ============ Test: Finalize Epoch ============

    function test_finalizeEpoch_success() public {
        uint256 epochId = _submitDefaultEpoch();

        // Warp past challenge period (24 hours)
        vm.warp(block.timestamp + 24 hours);

        vm.expectEmit(true, false, false, false);
        emit EpochFinalized(epochId);

        bridge.finalizeEpoch(epochId);

        (, , , , , bool finalized, ) = bridge.epochs(epochId);
        assertTrue(finalized);
    }

    function test_finalizeEpoch_revertsDuringChallengePeriod() public {
        uint256 epochId = _submitDefaultEpoch();

        // Try to finalize immediately (challenge period still active)
        vm.expectRevert("Challenge period active");
        bridge.finalizeEpoch(epochId);
    }

    function test_finalizeEpoch_revertsOneSecondBeforeExpiry() public {
        uint256 epochId = _submitDefaultEpoch();

        // Warp to 1 second before challenge period ends
        vm.warp(block.timestamp + 24 hours - 1);

        vm.expectRevert("Challenge period active");
        bridge.finalizeEpoch(epochId);
    }

    function test_finalizeEpoch_succeedsExactlyAtExpiry() public {
        uint256 epochId = _submitDefaultEpoch();

        // Warp to exactly the challenge period boundary
        vm.warp(block.timestamp + 24 hours);

        bridge.finalizeEpoch(epochId);

        (, , , , , bool finalized, ) = bridge.epochs(epochId);
        assertTrue(finalized);
    }

    function test_finalizeEpoch_revertsAlreadyFinalized() public {
        uint256 epochId = _submitDefaultEpoch();
        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        vm.expectRevert("Already finalized");
        bridge.finalizeEpoch(epochId);
    }

    function test_finalizeEpoch_revertsNonExistentEpoch() public {
        vm.expectRevert("Epoch not found");
        bridge.finalizeEpoch(42);
    }

    function test_finalizeEpoch_anyoneCanFinalize() public {
        uint256 epochId = _submitDefaultEpoch();
        vm.warp(block.timestamp + 24 hours);

        // Non-owner can finalize — permissionless
        vm.prank(attacker);
        bridge.finalizeEpoch(epochId);

        (, , , , , bool finalized, ) = bridge.epochs(epochId);
        assertTrue(finalized);
    }

    // ============ Test: Create Shapley Game ============

    function test_createShapleyGame_success() public {
        uint256 epochId = _submitDefaultEpoch();
        _proveAllContributors(epochId);

        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        bytes32 expectedGameId = keccak256(abi.encodePacked("attribution_epoch_", epochId));

        vm.expectEmit(true, false, false, true);
        emit ShapleyGameCreated(epochId, expectedGameId);

        bridge.createShapleyGame(epochId);

        (, , , , , , bool settled) = bridge.epochs(epochId);
        assertTrue(settled);
    }

    function test_createShapleyGame_revertsNotFinalized() public {
        uint256 epochId = _submitDefaultEpoch();
        _proveAllContributors(epochId);

        // Don't finalize — should revert
        vm.expectRevert("Not finalized");
        bridge.createShapleyGame(epochId);
    }

    function test_createShapleyGame_revertsAlreadySettled() public {
        uint256 epochId = _submitDefaultEpoch();
        _proveAllContributors(epochId);

        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);
        bridge.createShapleyGame(epochId);

        // Try to create again
        vm.expectRevert("Already settled");
        bridge.createShapleyGame(epochId);
    }

    function test_createShapleyGame_revertsFewerThanTwoProofs() public {
        uint256 epochId = _submitDefaultEpoch();

        // Only prove one contributor
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);

        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        vm.expectRevert("Need at least 2 proven contributors");
        bridge.createShapleyGame(epochId);
    }

    function test_createShapleyGame_succeedsWithExactlyTwoProofs() public {
        uint256 epochId = _submitDefaultEpoch();

        // Prove exactly two contributors
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);
        bridge.proveContribution(epochId, bob, BOB_SCORE, BOB_DERIVATIONS, SOURCE_PAPER, bobProof);

        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        bridge.createShapleyGame(epochId);

        (, , , , , , bool settled) = bridge.epochs(epochId);
        assertTrue(settled);
    }

    function test_createShapleyGame_revertsZeroProofs() public {
        uint256 epochId = _submitDefaultEpoch();

        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        vm.expectRevert("Need at least 2 proven contributors");
        bridge.createShapleyGame(epochId);
    }

    // ============ Test: Source Type Scarcity Mapping ============

    /// @dev We test the internal _sourceTypeScarcity indirectly through the Shapley game
    ///      participant mapping. Since _sourceTypeScarcity is internal, we deploy a harness.

    function test_sourceTypeScarcity_viaBridge() public {
        // This test validates the full flow including scarcity mapping.
        // The scarcity values feed into ShapleyDistributor.Participant.scarcityScore.
        // sourceType 3 (CODE) => 9000, sourceType 2 (PAPER) => 8000, sourceType 1 (VIDEO) => 5000
        // We verify the game is created successfully, which proves the mapping works.
        uint256 epochId = _submitDefaultEpoch();
        _proveAllContributors(epochId);

        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        // Should not revert — proves scarcity values are within ShapleyDistributor's 10000 BPS limit
        bridge.createShapleyGame(epochId);
    }

    // ============ Test: Challenge Period Constant ============

    function test_challengePeriodIs24Hours() public view {
        assertEq(bridge.CHALLENGE_PERIOD(), 24 hours);
    }

    // ============ Test: Multiple Epochs Independence ============

    function test_multipleEpochsAreIndependent() public {
        // Submit two epochs
        uint256 epoch1 = _submitDefaultEpoch();

        bytes32 otherRoot = keccak256("other_root");
        bridge.submitEpoch(otherRoot, 5_000 ether, address(token), 2);
        uint256 epoch2 = bridge.epochCounter();

        assertEq(epoch1, 1);
        assertEq(epoch2, 2);

        // Verify they have different roots
        (bytes32 root1, , , , , , ) = bridge.epochs(epoch1);
        (bytes32 root2, , , , , , ) = bridge.epochs(epoch2);
        assertEq(root1, merkleRoot);
        assertEq(root2, otherRoot);
        assertTrue(root1 != root2);

        // Finalize epoch 1 only
        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epoch1);

        (, , , , , bool finalized1, ) = bridge.epochs(epoch1);
        (, , , , , bool finalized2, ) = bridge.epochs(epoch2);
        assertTrue(finalized1);
        assertFalse(finalized2); // epoch 2 not yet finalized — independent submission time
    }

    // ============ Test: Full Lifecycle (End-to-End) ============

    function test_fullLifecycle_submitProveFinalizSettle() public {
        // 1. Submit epoch
        uint256 epochId = _submitDefaultEpoch();

        // 2. Prove all contributors
        _proveAllContributors(epochId);

        // 3. Challenge period passes
        vm.warp(block.timestamp + 24 hours);

        // 4. Finalize
        bridge.finalizeEpoch(epochId);

        // 5. Create Shapley game
        bridge.createShapleyGame(epochId);

        // 6. Verify final state
        (
            bytes32 root,
            uint256 totalPool,
            address rewardToken,
            ,
            uint256 participantCount,
            bool finalized,
            bool settled
        ) = bridge.epochs(epochId);

        assertEq(root, merkleRoot);
        assertEq(totalPool, 10_000 ether);
        assertEq(rewardToken, address(token));
        assertEq(participantCount, 3);
        assertTrue(finalized);
        assertTrue(settled);
    }

    // ============ Test: Duplicate Proof Submission ============

    function test_proveContribution_duplicateProofAccepted() public {
        // The contract does NOT prevent duplicate proofs for the same contributor.
        // This is a known design choice — the Shapley game creation may revert
        // due to duplicate participant addresses in ShapleyDistributor.
        uint256 epochId = _submitDefaultEpoch();

        // Prove Alice twice — the bridge itself doesn't prevent this
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);

        // But when we try to create the Shapley game, ShapleyDistributor
        // will reject duplicate participants
        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        vm.expectRevert("Duplicate participant");
        bridge.createShapleyGame(epochId);
    }

    // ============ Test: Epoch with ETH (address(0) token) ============

    function test_submitEpoch_ethAsRewardToken() public {
        bridge.submitEpoch(merkleRoot, 5 ether, address(0), 3);
        uint256 epochId = bridge.epochCounter();

        (, , address rewardToken, , , , ) = bridge.epochs(epochId);
        assertEq(rewardToken, address(0));
    }

    // ============ Test: Empty Proof Array ============

    function test_proveContribution_emptyProofRevertsInvalidProof() public {
        uint256 epochId = _submitDefaultEpoch();

        bytes32[] memory emptyProof = new bytes32[](0);

        // An empty proof can only succeed if the leaf IS the root. Otherwise it fails.
        vm.expectRevert("Invalid proof");
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, emptyProof);
    }

    // ============ Test: Ownership ============

    function test_ownerIsDeployer() public view {
        assertEq(bridge.owner(), address(this));
    }

    function test_shapleyDistributorIsSet() public view {
        assertEq(address(bridge.shapleyDistributor()), address(shapley));
    }

    // ============ Test: Prove After Finalize But Before Settle ============

    function test_proveContribution_allowedAfterFinalizeBeforeSettle() public {
        uint256 epochId = _submitDefaultEpoch();

        // Prove Alice before finalize
        bridge.proveContribution(epochId, alice, ALICE_SCORE, ALICE_DERIVATIONS, SOURCE_CODE, aliceProof);

        // Finalize
        vm.warp(block.timestamp + 24 hours);
        bridge.finalizeEpoch(epochId);

        // Prove Bob AFTER finalize but before settle — should still work
        bridge.proveContribution(epochId, bob, BOB_SCORE, BOB_DERIVATIONS, SOURCE_PAPER, bobProof);

        // Now settle
        bridge.createShapleyGame(epochId);

        (, , , , , , bool settled) = bridge.epochs(epochId);
        assertTrue(settled);
    }
}
