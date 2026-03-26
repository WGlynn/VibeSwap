// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/VerifiedCompute.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice Concrete harness exposing VerifiedCompute's abstract internals for testing
contract ConcreteVerifiedCompute is VerifiedCompute {
    mapping(bytes32 => bytes32) public expectedRoots;
    bool public disputeAlwaysValid;

    function initialize(uint256 _disputeWindow, uint256 _bondAmount) external initializer {
        __VerifiedCompute_init(_disputeWindow, _bondAmount);
    }

    function setExpectedRoot(bytes32 computeId, bytes32 root) external {
        expectedRoots[computeId] = root;
    }

    function setDisputeAlwaysValid(bool _val) external {
        disputeAlwaysValid = _val;
    }

    function _getExpectedRoot(bytes32 computeId) internal view override returns (bytes32) {
        return expectedRoots[computeId];
    }

    function _validateDispute(bytes32, bytes calldata) internal view override returns (bool) {
        return disputeAlwaysValid;
    }
}

contract VerifiedComputeTest is Test {
    ConcreteVerifiedCompute public vc;

    address public owner;
    address public submitter;
    address public disputer;
    address public alice;

    uint256 public constant DISPUTE_WINDOW = 1 hours;
    uint256 public constant BOND_AMOUNT = 0.01 ether;

    bytes32 public constant COMPUTE_ID = keccak256("compute-1");

    event ResultSubmitted(bytes32 indexed computeId, bytes32 resultHash, address indexed submitter);
    event ResultFinalized(bytes32 indexed computeId, bytes32 resultHash);
    event ResultDisputed(bytes32 indexed computeId, address indexed disputer, address indexed submitter);
    event SubmitterSlashed(address indexed submitter, uint256 amount, address indexed disputer);
    event SubmitterBonded(address indexed submitter, uint256 amount);
    event SubmitterUnbonded(address indexed submitter, uint256 amount);
    event DisputeWindowUpdated(uint256 oldWindow, uint256 newWindow);
    event BondAmountUpdated(uint256 oldAmount, uint256 newAmount);

    function setUp() public {
        owner = address(this);
        submitter = makeAddr("submitter");
        disputer = makeAddr("disputer");
        alice = makeAddr("alice");

        // Deploy with proxy
        ConcreteVerifiedCompute impl = new ConcreteVerifiedCompute();
        bytes memory initData = abi.encodeWithSelector(
            ConcreteVerifiedCompute.initialize.selector, DISPUTE_WINDOW, BOND_AMOUNT
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vc = ConcreteVerifiedCompute(payable(address(proxy)));

        // Fund actors
        vm.deal(submitter, 10 ether);
        vm.deal(disputer, 10 ether);
        vm.deal(alice, 10 ether);
    }

    // ============ Helpers ============

    /// @dev Build a single-leaf Merkle tree: root == leaf
    function _buildMerkleLeaf(bytes32 computeId, bytes32 resultHash) internal pure returns (bytes32, bytes32[] memory) {
        // For a single-leaf tree the root IS the leaf and the proof is empty
        // But MerkleProof.verify with empty proof checks leaf == root
        // So we need root == resultHash
        bytes32 root = resultHash;
        bytes32[] memory proof = new bytes32[](0);
        // Actually, OpenZeppelin MerkleProof with empty proof returns processProof == leaf
        // And checks processProof == root, so leaf must equal root
        return (root, proof);
    }

    function _bondSubmitter(address who) internal {
        vm.prank(who);
        vc.bond{value: BOND_AMOUNT}();
    }

    function _submitResult(address who, bytes32 computeId, bytes32 resultHash) internal {
        (bytes32 root, bytes32[] memory proof) = _buildMerkleLeaf(computeId, resultHash);
        vc.setExpectedRoot(computeId, root);
        vm.prank(who);
        vc.submitResult(computeId, resultHash, proof);
    }

    function _defaultResultHash() internal pure returns (bytes32) {
        return keccak256("result-data-1");
    }

    // ============ Initialization ============

    function test_init_setsOwner() public view {
        assertEq(vc.owner(), owner);
    }

    function test_init_setsDisputeWindow() public view {
        assertEq(vc.disputeWindow(), DISPUTE_WINDOW);
    }

    function test_init_setsBondAmount() public view {
        assertEq(vc.bondAmount(), BOND_AMOUNT);
    }

    function test_init_defaultDisputeWindow() public {
        // If disputeWindow is 0, should default to 1 hour
        ConcreteVerifiedCompute impl2 = new ConcreteVerifiedCompute();
        bytes memory initData = abi.encodeWithSelector(
            ConcreteVerifiedCompute.initialize.selector, 0, BOND_AMOUNT
        );
        ERC1967Proxy proxy2 = new ERC1967Proxy(address(impl2), initData);
        ConcreteVerifiedCompute vc2 = ConcreteVerifiedCompute(payable(address(proxy2)));
        assertEq(vc2.disputeWindow(), 1 hours);
    }

    function test_init_cannotReinitialize() public {
        vm.expectRevert();
        vc.initialize(DISPUTE_WINDOW, BOND_AMOUNT);
    }

    // ============ Bond Management ============

    function test_bond_succeeds() public {
        vm.expectEmit(true, false, false, true);
        emit SubmitterBonded(submitter, BOND_AMOUNT);

        _bondSubmitter(submitter);

        assertTrue(vc.submitters(submitter));
        assertEq(vc.bonds(submitter), BOND_AMOUNT);
    }

    function test_bond_revert_insufficient() public {
        vm.prank(submitter);
        vm.expectRevert(VerifiedCompute.InsufficientBond.selector);
        vc.bond{value: BOND_AMOUNT - 1}();
    }

    function test_bond_additionalBond() public {
        _bondSubmitter(submitter);

        vm.prank(submitter);
        vc.bond{value: BOND_AMOUNT}();

        assertEq(vc.bonds(submitter), BOND_AMOUNT * 2);
    }

    function test_unbond_succeeds() public {
        _bondSubmitter(submitter);

        uint256 balBefore = submitter.balance;

        vm.expectEmit(true, false, false, true);
        emit SubmitterUnbonded(submitter, BOND_AMOUNT);

        vm.prank(submitter);
        vc.unbond(BOND_AMOUNT);

        assertEq(submitter.balance, balBefore + BOND_AMOUNT);
        assertFalse(vc.submitters(submitter)); // Below bondAmount threshold
        assertEq(vc.bonds(submitter), 0);
    }

    function test_unbond_partialKeepsSubmitterStatus() public {
        // Bond double the amount
        vm.prank(submitter);
        vc.bond{value: BOND_AMOUNT * 2}();

        // Unbond half — still above bondAmount threshold
        vm.prank(submitter);
        vc.unbond(BOND_AMOUNT);

        assertTrue(vc.submitters(submitter));
        assertEq(vc.bonds(submitter), BOND_AMOUNT);
    }

    function test_unbond_revert_notBonded() public {
        vm.prank(alice);
        vm.expectRevert(VerifiedCompute.NotBondedSubmitter.selector);
        vc.unbond(1);
    }

    function test_unbond_revert_zeroAmount() public {
        _bondSubmitter(submitter);

        vm.prank(submitter);
        vm.expectRevert(VerifiedCompute.ZeroAmount.selector);
        vc.unbond(0);
    }

    function test_unbond_revert_insufficientBalance() public {
        _bondSubmitter(submitter);

        vm.prank(submitter);
        vm.expectRevert(VerifiedCompute.InsufficientBond.selector);
        vc.unbond(BOND_AMOUNT + 1);
    }

    // ============ Result Submission ============

    function test_submitResult_succeeds() public {
        _bondSubmitter(submitter);
        bytes32 resultHash = _defaultResultHash();

        vm.expectEmit(true, false, false, true);
        emit ResultSubmitted(COMPUTE_ID, resultHash, submitter);

        _submitResult(submitter, COMPUTE_ID, resultHash);

        assertTrue(vc.isPending(COMPUTE_ID));
        assertFalse(vc.isFinalized(COMPUTE_ID));
    }

    function test_submitResult_storesCorrectData() public {
        _bondSubmitter(submitter);
        bytes32 resultHash = _defaultResultHash();

        _submitResult(submitter, COMPUTE_ID, resultHash);

        VerifiedCompute.ComputeResult memory r = vc.getResult(COMPUTE_ID);
        assertEq(r.resultHash, resultHash);
        assertEq(r.submitter, submitter);
        assertEq(r.timestamp, block.timestamp);
        assertTrue(r.status == VerifiedCompute.ResultStatus.Pending);
    }

    function test_submitResult_revert_notBonded() public {
        bytes32 resultHash = _defaultResultHash();
        (bytes32 root, bytes32[] memory proof) = _buildMerkleLeaf(COMPUTE_ID, resultHash);
        vc.setExpectedRoot(COMPUTE_ID, root);

        vm.prank(alice);
        vm.expectRevert(VerifiedCompute.NotBondedSubmitter.selector);
        vc.submitResult(COMPUTE_ID, resultHash, proof);
    }

    function test_submitResult_revert_alreadyExists() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());

        vm.expectRevert(VerifiedCompute.ResultAlreadyExists.selector);
        _submitResult(submitter, COMPUTE_ID, keccak256("different"));
    }

    function test_submitResult_revert_invalidProof() public {
        _bondSubmitter(submitter);
        bytes32 resultHash = _defaultResultHash();

        // Set root to something that doesn't match
        vc.setExpectedRoot(COMPUTE_ID, keccak256("wrong-root"));

        bytes32[] memory emptyProof = new bytes32[](0);

        vm.prank(submitter);
        vm.expectRevert(VerifiedCompute.InvalidMerkleProof.selector);
        vc.submitResult(COMPUTE_ID, resultHash, emptyProof);
    }

    function test_submitResult_revert_invalidProofWithNonEmptyProof() public {
        _bondSubmitter(submitter);
        bytes32 resultHash = _defaultResultHash();

        // Set root to something specific
        vc.setExpectedRoot(COMPUTE_ID, keccak256("specific-root"));

        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256("garbage");

        vm.prank(submitter);
        vm.expectRevert(VerifiedCompute.InvalidMerkleProof.selector);
        vc.submitResult(COMPUTE_ID, resultHash, badProof);
    }

    // ============ Finalize Result ============

    function test_finalizeResult_succeeds() public {
        _bondSubmitter(submitter);
        bytes32 resultHash = _defaultResultHash();
        _submitResult(submitter, COMPUTE_ID, resultHash);

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectEmit(true, false, false, true);
        emit ResultFinalized(COMPUTE_ID, resultHash);

        vc.finalizeResult(COMPUTE_ID);

        assertTrue(vc.isFinalized(COMPUTE_ID));
        assertFalse(vc.isPending(COMPUTE_ID));
    }

    function test_finalizeResult_revert_notPending() public {
        vm.expectRevert(VerifiedCompute.ResultNotPending.selector);
        vc.finalizeResult(COMPUTE_ID);
    }

    function test_finalizeResult_revert_disputeWindowActive() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());

        vm.warp(block.timestamp + DISPUTE_WINDOW - 1);

        vm.expectRevert(VerifiedCompute.DisputeWindowActive.selector);
        vc.finalizeResult(COMPUTE_ID);
    }

    function test_finalizeResult_revert_alreadyFinalized() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vc.finalizeResult(COMPUTE_ID);

        vm.expectRevert(VerifiedCompute.ResultNotPending.selector);
        vc.finalizeResult(COMPUTE_ID);
    }

    function test_finalizeResult_anyoneCanCall() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(alice);
        vc.finalizeResult(COMPUTE_ID);

        assertTrue(vc.isFinalized(COMPUTE_ID));
    }

    // ============ Dispute Result ============

    function test_disputeResult_succeeds() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());
        vc.setDisputeAlwaysValid(true);

        uint256 slashAmount = (BOND_AMOUNT * vc.SLASH_RATE()) / vc.BASIS_POINTS();
        uint256 disputerBalBefore = disputer.balance;

        vm.expectEmit(true, true, true, false);
        emit ResultDisputed(COMPUTE_ID, disputer, submitter);

        vm.prank(disputer);
        vc.disputeResult(COMPUTE_ID, "");

        // Disputer receives slash reward
        assertEq(disputer.balance, disputerBalBefore + slashAmount);

        // Result is now Disputed
        VerifiedCompute.ComputeResult memory r = vc.getResult(COMPUTE_ID);
        assertTrue(r.status == VerifiedCompute.ResultStatus.Disputed);
    }

    function test_disputeResult_slashes50Percent() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());
        vc.setDisputeAlwaysValid(true);

        uint256 bondBefore = vc.bonds(submitter);
        uint256 expectedSlash = (bondBefore * 5000) / 10000; // 50%

        vm.prank(disputer);
        vc.disputeResult(COMPUTE_ID, "");

        assertEq(vc.bonds(submitter), bondBefore - expectedSlash);
    }

    function test_disputeResult_removesSubmitterStatus() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());
        vc.setDisputeAlwaysValid(true);

        vm.prank(disputer);
        vc.disputeResult(COMPUTE_ID, "");

        // After 50% slash, submitter's bond < bondAmount → no longer a submitter
        assertFalse(vc.submitters(submitter));
    }

    function test_disputeResult_revert_notPending() public {
        vc.setDisputeAlwaysValid(true);

        vm.prank(disputer);
        vm.expectRevert(VerifiedCompute.ResultNotPending.selector);
        vc.disputeResult(COMPUTE_ID, "");
    }

    function test_disputeResult_revert_windowExpired() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());
        vc.setDisputeAlwaysValid(true);

        vm.warp(block.timestamp + DISPUTE_WINDOW);

        vm.prank(disputer);
        vm.expectRevert(VerifiedCompute.DisputeWindowExpired.selector);
        vc.disputeResult(COMPUTE_ID, "");
    }

    function test_disputeResult_revert_invalidDispute() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());
        vc.setDisputeAlwaysValid(false);

        vm.prank(disputer);
        vm.expectRevert("Invalid dispute");
        vc.disputeResult(COMPUTE_ID, "");
    }

    function test_disputeResult_revert_alreadyDisputed() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());
        vc.setDisputeAlwaysValid(true);

        vm.prank(disputer);
        vc.disputeResult(COMPUTE_ID, "");

        // Second dispute should fail — status is Disputed, not Pending
        vm.prank(alice);
        vm.expectRevert(VerifiedCompute.ResultNotPending.selector);
        vc.disputeResult(COMPUTE_ID, "");
    }

    function test_disputeResult_cannotFinalizeAfterDispute() public {
        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());
        vc.setDisputeAlwaysValid(true);

        vm.prank(disputer);
        vc.disputeResult(COMPUTE_ID, "");

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectRevert(VerifiedCompute.ResultNotPending.selector);
        vc.finalizeResult(COMPUTE_ID);
    }

    // ============ Admin ============

    function test_setDisputeWindow_onlyOwner() public {
        vm.expectEmit(false, false, false, true);
        emit DisputeWindowUpdated(DISPUTE_WINDOW, 2 hours);

        vc.setDisputeWindow(2 hours);
        assertEq(vc.disputeWindow(), 2 hours);
    }

    function test_setDisputeWindow_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vc.setDisputeWindow(2 hours);
    }

    function test_setBondAmount_onlyOwner() public {
        vm.expectEmit(false, false, false, true);
        emit BondAmountUpdated(BOND_AMOUNT, 0.05 ether);

        vc.setBondAmount(0.05 ether);
        assertEq(vc.bondAmount(), 0.05 ether);
    }

    function test_setBondAmount_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vc.setBondAmount(0.05 ether);
    }

    // ============ UUPS Upgrade Auth ============

    function test_authorizeUpgrade_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vc.upgradeToAndCall(address(0xdead), "");
    }

    function test_authorizeUpgrade_revert_notContract() public {
        // Owner tries to upgrade to an EOA — should fail
        vm.expectRevert("Not a contract");
        vc.upgradeToAndCall(makeAddr("eoa"), "");
    }

    // ============ View Functions ============

    function test_getResult_defaultValues() public view {
        VerifiedCompute.ComputeResult memory r = vc.getResult(keccak256("nonexistent"));
        assertEq(r.resultHash, bytes32(0));
        assertEq(r.submitter, address(0));
        assertEq(r.timestamp, 0);
        assertTrue(r.status == VerifiedCompute.ResultStatus.None);
    }

    function test_isFinalized_false_whenNone() public view {
        assertFalse(vc.isFinalized(keccak256("nonexistent")));
    }

    function test_isPending_false_whenNone() public view {
        assertFalse(vc.isPending(keccak256("nonexistent")));
    }

    // ============ Receive ETH ============

    function test_receiveETH() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(vc).call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(address(vc).balance, 0.5 ether);
    }

    // ============ Fuzz Tests ============

    function testFuzz_bond_exactAmount(uint256 amount) public {
        vm.assume(amount >= BOND_AMOUNT);
        vm.assume(amount <= 100 ether);

        vm.deal(submitter, amount);
        vm.prank(submitter);
        vc.bond{value: amount}();

        assertEq(vc.bonds(submitter), amount);
        assertTrue(vc.submitters(submitter));
    }

    function testFuzz_unbond_partialAmount(uint256 unbondAmount) public {
        uint256 bonded = BOND_AMOUNT * 3;
        vm.assume(unbondAmount > 0);
        vm.assume(unbondAmount <= bonded);

        vm.deal(submitter, bonded);
        vm.prank(submitter);
        vc.bond{value: bonded}();

        vm.prank(submitter);
        vc.unbond(unbondAmount);

        assertEq(vc.bonds(submitter), bonded - unbondAmount);

        if (bonded - unbondAmount < BOND_AMOUNT) {
            assertFalse(vc.submitters(submitter));
        } else {
            assertTrue(vc.submitters(submitter));
        }
    }

    function testFuzz_finalizeResult_afterWindow(uint256 extraTime) public {
        vm.assume(extraTime > 0);
        vm.assume(extraTime < 365 days);

        _bondSubmitter(submitter);
        _submitResult(submitter, COMPUTE_ID, _defaultResultHash());

        vm.warp(block.timestamp + DISPUTE_WINDOW + extraTime);

        vc.finalizeResult(COMPUTE_ID);
        assertTrue(vc.isFinalized(COMPUTE_ID));
    }

    // ============ Multiple Results ============

    function test_multipleResults_independent() public {
        _bondSubmitter(submitter);

        bytes32 id1 = keccak256("compute-1");
        bytes32 id2 = keccak256("compute-2");
        bytes32 hash1 = keccak256("result-1");
        bytes32 hash2 = keccak256("result-2");

        _submitResult(submitter, id1, hash1);
        _submitResult(submitter, id2, hash2);

        assertTrue(vc.isPending(id1));
        assertTrue(vc.isPending(id2));

        // Finalize only one
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vc.finalizeResult(id1);

        assertTrue(vc.isFinalized(id1));
        assertTrue(vc.isPending(id2));
    }

    // ============ Constants ============

    function test_constants() public view {
        assertEq(vc.SLASH_RATE(), 5000);
        assertEq(vc.BASIS_POINTS(), 10000);
    }
}
