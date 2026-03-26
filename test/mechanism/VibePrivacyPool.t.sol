// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibePrivacyPool.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibePrivacyPool Tests ============

contract VibePrivacyPoolTest is Test {
    VibePrivacyPool public pool;

    address public owner;
    address public alice;
    address public bob;
    address public asp;

    // Standard denominations (set in initialize)
    uint256 constant DENOM_01  = 0.1 ether;
    uint256 constant DENOM_1   = 1 ether;
    uint256 constant DENOM_10  = 10 ether;
    uint256 constant DENOM_100 = 100 ether;

    // ============ Events ============

    event DepositMade(bytes32 indexed commitment, uint256 amount, uint256 depositIndex);
    event WithdrawalMade(bytes32 indexed nullifier, address indexed recipient, uint256 amount);
    event AssociationSetCreated(uint256 indexed setId, address indexed provider, string name);
    event AssociationSetUpdated(uint256 indexed setId, bytes32 newRoot);
    event ASPApproved(address indexed asp);
    event ASPRevoked(address indexed asp);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob   = makeAddr("bob");
        asp   = makeAddr("asp");

        VibePrivacyPool impl = new VibePrivacyPool();
        bytes memory initData = abi.encodeCall(VibePrivacyPool.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        pool = VibePrivacyPool(payable(address(proxy)));

        // Fund accounts
        vm.deal(alice, 200 ether);
        vm.deal(bob,   200 ether);
    }

    // ============ Helpers ============

    function _makeCommitment(address user, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, nonce, "secret"));
    }

    function _makeNullifier(address user, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, nonce, "nullifier"));
    }

    function _makeProof(bytes32 nullifier, address recipient, uint256 amount, uint256 setId)
        internal pure returns (bytes memory)
    {
        // Dummy well-formed proof — _verifyProof just checks len > 0 and non-zero hashes
        return abi.encodePacked(nullifier, recipient, amount, setId, bytes32("proof_padding"));
    }

    function _setupASP() internal returns (uint256) {
        pool.approveASP(asp);
        vm.prank(asp);
        return pool.createAssociationSet(
            "Clean Set",
            keccak256("merkle_root"),
            100
        );
    }

    function _deposit(address user, uint256 amount, bytes32 commitment) internal {
        vm.prank(user);
        pool.deposit{value: amount}(commitment);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(pool.owner(), owner);
    }

    function test_initialize_addsDefaultDenominations() public view {
        uint256[] memory denoms = pool.getDenominations();
        assertEq(denoms.length, 4);
        assertEq(denoms[0], DENOM_01);
        assertEq(denoms[1], DENOM_1);
        assertEq(denoms[2], DENOM_10);
        assertEq(denoms[3], DENOM_100);
    }

    function test_initialize_validDenominationsSet() public view {
        assertTrue(pool.validDenomination(DENOM_01));
        assertTrue(pool.validDenomination(DENOM_1));
        assertTrue(pool.validDenomination(DENOM_10));
        assertTrue(pool.validDenomination(DENOM_100));
    }

    function test_initialize_depositCountZero() public view {
        assertEq(pool.getDepositCount(), 0);
    }

    // ============ Deposits ============

    function test_deposit_storesCommitment() public {
        bytes32 commitment = _makeCommitment(alice, 1);
        _deposit(alice, DENOM_1, commitment);

        assertTrue(pool.commitments(commitment));
    }

    function test_deposit_incrementsCount() public {
        _deposit(alice, DENOM_1, _makeCommitment(alice, 1));
        assertEq(pool.getDepositCount(), 1);

        _deposit(alice, DENOM_1, _makeCommitment(alice, 2));
        assertEq(pool.getDepositCount(), 2);
    }

    function test_deposit_updatesTotalDeposited() public {
        _deposit(alice, DENOM_1, _makeCommitment(alice, 1));
        assertEq(pool.totalDeposited(), DENOM_1);

        _deposit(alice, DENOM_10, _makeCommitment(alice, 2));
        assertEq(pool.totalDeposited(), DENOM_1 + DENOM_10);
    }

    function test_deposit_emitsEvent() public {
        bytes32 commitment = _makeCommitment(alice, 1);

        vm.expectEmit(true, false, false, true);
        emit DepositMade(commitment, DENOM_1, 1);

        vm.prank(alice);
        pool.deposit{value: DENOM_1}(commitment);
    }

    function test_deposit_invalidDenomination_reverts() public {
        bytes32 commitment = _makeCommitment(alice, 1);

        vm.prank(alice);
        vm.expectRevert("Invalid denomination");
        pool.deposit{value: 0.5 ether}(commitment);
    }

    function test_deposit_zeroValue_reverts() public {
        bytes32 commitment = _makeCommitment(alice, 1);

        vm.prank(alice);
        vm.expectRevert("Invalid denomination");
        pool.deposit{value: 0}(commitment);
    }

    function test_deposit_duplicateCommitment_reverts() public {
        bytes32 commitment = _makeCommitment(alice, 1);
        _deposit(alice, DENOM_1, commitment);

        vm.prank(alice);
        vm.expectRevert("Commitment exists");
        pool.deposit{value: DENOM_1}(commitment);
    }

    function test_deposit_allDenominations_accepted() public {
        _deposit(alice, DENOM_01,  _makeCommitment(alice, 1));
        _deposit(alice, DENOM_1,   _makeCommitment(alice, 2));
        _deposit(alice, DENOM_10,  _makeCommitment(alice, 3));
        _deposit(alice, DENOM_100, _makeCommitment(alice, 4));

        assertEq(pool.getDepositCount(), 4);
    }

    function test_deposit_poolBalanceIncreases() public {
        _deposit(alice, DENOM_1, _makeCommitment(alice, 1));
        assertEq(pool.getPoolBalance(), DENOM_1);
    }

    // ============ Association Set Providers ============

    function test_approveASP_setsApproval() public {
        pool.approveASP(asp);
        assertTrue(pool.approvedASPs(asp));
    }

    function test_approveASP_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ASPApproved(asp);
        pool.approveASP(asp);
    }

    function test_approveASP_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.approveASP(asp);
    }

    function test_revokeASP_clearsApproval() public {
        pool.approveASP(asp);
        pool.revokeASP(asp);
        assertFalse(pool.approvedASPs(asp));
    }

    function test_revokeASP_emitsEvent() public {
        pool.approveASP(asp);

        vm.expectEmit(true, false, false, false);
        emit ASPRevoked(asp);
        pool.revokeASP(asp);
    }

    // ============ Association Sets ============

    function test_createAssociationSet_incrementsCount() public {
        _setupASP();
        assertEq(pool.getSetCount(), 1);
    }

    function test_createAssociationSet_storesData() public {
        bytes32 root = keccak256("root");
        pool.approveASP(asp);

        vm.prank(asp);
        uint256 setId = pool.createAssociationSet("Clean Set", root, 50);

        (
            uint256 storedId,
            address provider,
            ,
            bytes32 merkleRoot,
            uint256 memberCount,
            ,
            bool active
        ) = pool.associationSets(setId);

        assertEq(storedId,    setId);
        assertEq(provider,    asp);
        assertEq(merkleRoot,  root);
        assertEq(memberCount, 50);
        assertTrue(active);
    }

    function test_createAssociationSet_emitsEvent() public {
        pool.approveASP(asp);
        bytes32 root = keccak256("root");

        vm.expectEmit(true, true, false, false);
        emit AssociationSetCreated(1, asp, "Clean Set");

        vm.prank(asp);
        pool.createAssociationSet("Clean Set", root, 100);
    }

    function test_createAssociationSet_unapprovedASP_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Not approved ASP");
        pool.createAssociationSet("Bad Set", bytes32(0), 0);
    }

    function test_updateAssociationSet_updatesRoot() public {
        uint256 setId = _setupASP();
        bytes32 newRoot = keccak256("updated_root");

        vm.prank(asp);
        pool.updateAssociationSet(setId, newRoot, 200);

        (, , , bytes32 storedRoot, uint256 memberCount, , ) = pool.associationSets(setId);
        assertEq(storedRoot,  newRoot);
        assertEq(memberCount, 200);
    }

    function test_updateAssociationSet_emitsEvent() public {
        uint256 setId = _setupASP();
        bytes32 newRoot = keccak256("updated_root");

        vm.expectEmit(true, false, false, true);
        emit AssociationSetUpdated(setId, newRoot);

        vm.prank(asp);
        pool.updateAssociationSet(setId, newRoot, 200);
    }

    function test_updateAssociationSet_notProvider_reverts() public {
        uint256 setId = _setupASP();

        vm.prank(alice);
        vm.expectRevert("Not provider");
        pool.updateAssociationSet(setId, bytes32(0), 0);
    }

    // ============ Withdrawals ============

    function test_withdraw_sendsETHToRecipient() public {
        uint256 setId = _setupASP();
        bytes32 commitment = _makeCommitment(alice, 1);
        _deposit(alice, DENOM_1, commitment);

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        uint256 bobBefore = bob.balance;
        vm.prank(alice);
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);

        assertEq(bob.balance, bobBefore + DENOM_1);
    }

    function test_withdraw_updatesTotalWithdrawn() public {
        uint256 setId = _setupASP();
        bytes32 commitment = _makeCommitment(alice, 1);
        _deposit(alice, DENOM_1, commitment);

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        vm.prank(alice);
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);

        assertEq(pool.totalWithdrawn(), DENOM_1);
    }

    function test_withdraw_marksNullifierUsed() public {
        uint256 setId = _setupASP();
        bytes32 commitment = _makeCommitment(alice, 1);
        _deposit(alice, DENOM_1, commitment);

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        vm.prank(alice);
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);

        assertTrue(pool.isNullifierUsed(nullifier));
    }

    function test_withdraw_emitsEvent() public {
        uint256 setId = _setupASP();
        bytes32 commitment = _makeCommitment(alice, 1);
        _deposit(alice, DENOM_1, commitment);

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        vm.expectEmit(true, true, false, true);
        emit WithdrawalMade(nullifier, bob, DENOM_1);

        vm.prank(alice);
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);
    }

    function test_withdraw_doubleSpend_reverts() public {
        uint256 setId = _setupASP();
        _deposit(alice, DENOM_1, _makeCommitment(alice, 1));
        _deposit(alice, DENOM_1, _makeCommitment(alice, 2));

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        vm.prank(alice);
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);

        // Second attempt with same nullifier
        vm.prank(alice);
        vm.expectRevert("Already withdrawn");
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);
    }

    function test_withdraw_invalidDenomination_reverts() public {
        uint256 setId = _setupASP();
        _deposit(alice, DENOM_1, _makeCommitment(alice, 1));

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, 0.5 ether, setId);

        vm.prank(alice);
        vm.expectRevert("Invalid denomination");
        pool.withdraw(nullifier, bob, 0.5 ether, setId, proof);
    }

    function test_withdraw_inactiveAssociationSet_reverts() public {
        _deposit(alice, DENOM_1, _makeCommitment(alice, 1));

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, 999);

        vm.prank(alice);
        vm.expectRevert("Invalid association set");
        pool.withdraw(nullifier, bob, DENOM_1, 999, proof);
    }

    function test_withdraw_emptyProof_reverts() public {
        uint256 setId = _setupASP();
        _deposit(alice, DENOM_1, _makeCommitment(alice, 1));

        bytes32 nullifier = _makeNullifier(alice, 1);

        vm.prank(alice);
        vm.expectRevert("Empty proof");
        pool.withdraw(nullifier, bob, DENOM_1, setId, "");
    }

    function test_withdraw_insufficientPoolBalance_reverts() public {
        uint256 setId = _setupASP();
        // Don't deposit anything — pool has no balance

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        vm.prank(alice);
        vm.expectRevert("Insufficient pool balance");
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);
    }

    // ============ Admin ============

    function test_addDenomination_validatesNewDenom() public {
        pool.addDenomination(0.01 ether);
        assertTrue(pool.validDenomination(0.01 ether));
    }

    function test_addDenomination_appearsInList() public {
        pool.addDenomination(0.01 ether);
        uint256[] memory denoms = pool.getDenominations();
        assertEq(denoms.length, 5);
        assertEq(denoms[4], 0.01 ether);
    }

    function test_addDenomination_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.addDenomination(0.01 ether);
    }

    // ============ Nullifier Tracking ============

    function test_isNullifierUsed_falseBeforeWithdraw() public view {
        bytes32 nullifier = _makeNullifier(alice, 1);
        assertFalse(pool.isNullifierUsed(nullifier));
    }

    function test_isNullifierUsed_trueAfterWithdraw() public {
        uint256 setId = _setupASP();
        _deposit(alice, DENOM_1, _makeCommitment(alice, 1));

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        vm.prank(alice);
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);

        assertTrue(pool.isNullifierUsed(nullifier));
    }

    // ============ Pool Balance ============

    function test_getPoolBalance_reflectsDeposits() public {
        _deposit(alice, DENOM_1,  _makeCommitment(alice, 1));
        _deposit(alice, DENOM_10, _makeCommitment(alice, 2));

        assertEq(pool.getPoolBalance(), DENOM_1 + DENOM_10);
    }

    function test_getPoolBalance_decreasesAfterWithdraw() public {
        uint256 setId = _setupASP();
        _deposit(alice, DENOM_10, _makeCommitment(alice, 1));

        bytes32 nullifier = _makeNullifier(alice, 1);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        // Deposit 1 eth worth
        _deposit(alice, DENOM_1, _makeCommitment(alice, 2));

        uint256 balanceBefore = pool.getPoolBalance();
        vm.prank(alice);
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);

        assertEq(pool.getPoolBalance(), balanceBefore - DENOM_1);
    }

    // ============ Multi-Denomination Lifecycle ============

    function test_fullLifecycle_depositAndWithdraw() public {
        uint256 setId = _setupASP();

        // Alice deposits 1 ETH
        bytes32 commitment = _makeCommitment(alice, 42);
        _deposit(alice, DENOM_1, commitment);
        assertEq(pool.getDepositCount(), 1);
        assertEq(pool.totalDeposited(), DENOM_1);

        // Bob withdraws 1 ETH using nullifier (simulates ZK proof)
        bytes32 nullifier = _makeNullifier(alice, 42);
        bytes memory proof = _makeProof(nullifier, bob, DENOM_1, setId);

        uint256 bobBefore = bob.balance;
        vm.prank(alice);
        pool.withdraw(nullifier, bob, DENOM_1, setId, proof);

        assertEq(bob.balance, bobBefore + DENOM_1);
        assertEq(pool.totalWithdrawn(), DENOM_1);
        assertTrue(pool.isNullifierUsed(nullifier));
    }

    // ============ Fuzz ============

    function testFuzz_multipleDeposits_uniqueCommitments(uint8 count) public {
        vm.assume(count > 0 && count <= 20);

        for (uint256 i = 0; i < count; i++) {
            bytes32 commitment = _makeCommitment(alice, i);
            _deposit(alice, DENOM_01, commitment);
        }

        assertEq(pool.getDepositCount(), count);
        assertEq(pool.totalDeposited(), DENOM_01 * count);
    }
}
