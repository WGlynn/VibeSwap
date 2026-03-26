// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/VibeStateVM.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VibeStateVMTest is Test {
    VibeStateVM public vm_;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    event ScriptRegistered(bytes32 indexed scriptHash, VibeStateVM.ScriptType scriptType, address indexed registrar);
    event PowLockSet(bytes32 indexed cellTypeHash, uint256 baseDifficulty);
    event PowSolved(uint256 indexed cellId, address indexed solver, uint256 nonce, uint256 difficulty);
    event TransitionCommitted(bytes32 indexed commitHash, address indexed committer);
    event TransitionRevealed(bytes32 indexed commitHash, uint256 indexed cellId);
    event AccountCreated(address indexed owner);
    event CellDeposited(address indexed owner, uint256 indexed cellId, uint256 amount);
    event CellWithdrawn(address indexed owner, uint256 indexed cellId, uint256 amount);
    event UncleRecorded(uint256 indexed uncleId, uint256 indexed parentBlock, address indexed proposer);
    event ContentionAdjusted(bytes32 indexed cellTypeHash, uint256 oldDifficulty, uint256 newDifficulty);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        // Deploy with UUPS proxy
        VibeStateVM impl = new VibeStateVM();
        bytes memory initData = abi.encodeWithSelector(VibeStateVM.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vm_ = VibeStateVM(payable(address(proxy)));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    // ============ Helpers ============

    function _registerScript(address who, bytes32 codeHash, VibeStateVM.ScriptType scriptType, uint256 gasLimit)
        internal
        returns (bytes32)
    {
        vm.prank(who);
        return vm_.registerScript(codeHash, scriptType, gasLimit);
    }

    function _setPowLock(bytes32 typeHash, uint256 difficulty) internal {
        vm_.setPowLock(typeHash, difficulty);
    }

    function _createAccount(address who) internal {
        vm.prank(who);
        vm_.createAccount();
    }

    function _createAccountFunded(address who, uint256 amount) internal {
        vm.prank(who);
        vm_.createAccount{value: amount}();
    }

    /// @dev Brute-force find a nonce satisfying the PoW puzzle for the given params
    function _findPoWNonce(uint256 cellId, address solver, uint256 difficulty) internal pure returns (uint256) {
        uint256 target = type(uint256).max / difficulty;
        for (uint256 nonce = 0; nonce < 100_000; nonce++) {
            bytes32 h = keccak256(abi.encodePacked(cellId, solver, nonce));
            if (uint256(h) < target) {
                return nonce;
            }
        }
        revert("No nonce found within search range");
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(vm_.owner(), owner);
    }

    function test_initialize_countersZero() public view {
        assertEq(vm_.scriptCount(), 0);
        assertEq(vm_.totalAccounts(), 0);
        assertEq(vm_.commitCount(), 0);
        assertEq(vm_.uncleCount(), 0);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        vm_.initialize();
    }

    // ============ Script Registry ============

    function test_registerScript_lock() public {
        bytes32 codeHash = keccak256("my-lock-script");

        vm.expectEmit(false, false, true, true);
        emit ScriptRegistered(bytes32(0), VibeStateVM.ScriptType.LOCK, alice);

        bytes32 scriptHash = _registerScript(alice, codeHash, VibeStateVM.ScriptType.LOCK, 1_000_000);

        assertNotEq(scriptHash, bytes32(0));
        assertEq(vm_.scriptCount(), 1);

        VibeStateVM.Script memory s = vm_.getScript(scriptHash);
        assertEq(s.scriptHash, scriptHash);
        assertEq(s.codeHash, codeHash);
        assertEq(s.registrar, alice);
        assertTrue(s.scriptType == VibeStateVM.ScriptType.LOCK);
        assertEq(s.gasLimit, 1_000_000);
        assertTrue(s.active);
    }

    function test_registerScript_type() public {
        bytes32 scriptHash = _registerScript(bob, keccak256("type-script"), VibeStateVM.ScriptType.TYPE, 500_000);

        VibeStateVM.Script memory s = vm_.getScript(scriptHash);
        assertTrue(s.scriptType == VibeStateVM.ScriptType.TYPE);
        assertEq(s.registrar, bob);
    }

    function test_registerScript_extension() public {
        bytes32 scriptHash = _registerScript(alice, keccak256("ext"), VibeStateVM.ScriptType.EXTENSION, 250_000);
        assertTrue(vm_.getScript(scriptHash).scriptType == VibeStateVM.ScriptType.EXTENSION);
    }

    function test_registerScript_differentTimestamps_differentHashes() public {
        bytes32 codeHash = keccak256("same-code");

        bytes32 hash1 = _registerScript(alice, codeHash, VibeStateVM.ScriptType.LOCK, 100_000);

        vm.warp(block.timestamp + 1);
        bytes32 hash2 = _registerScript(alice, codeHash, VibeStateVM.ScriptType.LOCK, 100_000);

        assertNotEq(hash1, hash2);
        assertEq(vm_.scriptCount(), 2);
    }

    function test_registerScript_anyoneCanRegister() public {
        _registerScript(alice, keccak256("a"), VibeStateVM.ScriptType.LOCK, 1);
        _registerScript(bob, keccak256("b"), VibeStateVM.ScriptType.TYPE, 1);
        assertEq(vm_.scriptCount(), 2);
    }

    // ============ PoW Lock Scripts ============

    function test_setPowLock_succeeds() public {
        bytes32 typeHash = keccak256("mytype");

        vm.expectEmit(true, false, false, true);
        emit PowLockSet(typeHash, 2000);

        _setPowLock(typeHash, 2000);

        VibeStateVM.PowLockRequirement memory req = vm_.getPowLock(typeHash);
        assertEq(req.baseDifficulty, 2000);
        assertEq(req.currentDifficulty, 2000);
        assertEq(req.contentionCount, 0);
        assertEq(req.adjustmentInterval, 10);
    }

    function test_setPowLock_zeroUsesDefault() public {
        bytes32 typeHash = keccak256("mytype");
        _setPowLock(typeHash, 0);

        VibeStateVM.PowLockRequirement memory req = vm_.getPowLock(typeHash);
        assertEq(req.baseDifficulty, vm_.POW_BASE_DIFFICULTY());
        assertEq(req.currentDifficulty, vm_.POW_BASE_DIFFICULTY());
    }

    function test_setPowLock_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vm_.setPowLock(keccak256("t"), 1000);
    }

    function test_verifyPow_validNonce() public {
        bytes32 typeHash = keccak256("mytype");
        uint256 difficulty = 100; // Low difficulty for testing
        _setPowLock(typeHash, difficulty);

        uint256 cellId = 1;
        uint256 nonce = _findPoWNonce(cellId, alice, difficulty);

        vm.expectEmit(true, true, false, false);
        emit PowSolved(cellId, alice, nonce, difficulty);

        vm.prank(alice);
        bool result = vm_.verifyPow(cellId, typeHash, nonce);
        assertTrue(result);
    }

    function test_verifyPow_incrementsContention() public {
        bytes32 typeHash = keccak256("mytype");
        _setPowLock(typeHash, 100);

        uint256 cellId = 1;
        uint256 nonce = _findPoWNonce(cellId, alice, 100);

        vm.prank(alice);
        vm_.verifyPow(cellId, typeHash, nonce);

        assertEq(vm_.getCellContention(cellId), 1);

        VibeStateVM.PowLockRequirement memory req = vm_.getPowLock(typeHash);
        assertEq(req.contentionCount, 1);
    }

    function test_verifyPow_revert_noPowRequired() public {
        bytes32 typeHash = keccak256("notype");
        // No PoW lock set for this type

        vm.prank(alice);
        vm.expectRevert("No PoW required for this type");
        vm_.verifyPow(1, typeHash, 0);
    }

    function test_verifyPow_revert_invalidNonce() public {
        bytes32 typeHash = keccak256("mytype");
        _setPowLock(typeHash, type(uint256).max / 2); // Very high difficulty — nearly impossible

        vm.prank(alice);
        vm.expectRevert("PoW not valid");
        vm_.verifyPow(1, typeHash, 0);
    }

    function test_verifyPow_difficultyAdjusts_highContention() public {
        bytes32 typeHash = keccak256("hotcell");
        uint256 difficulty = 50;
        _setPowLock(typeHash, difficulty);

        // Submit 11+ contentions to trigger upward adjustment
        for (uint256 i = 0; i < 11; i++) {
            uint256 cellId = i + 1;
            uint256 nonce = _findPoWNonce(cellId, alice, difficulty);
            vm.prank(alice);
            vm_.verifyPow(cellId, typeHash, nonce);
        }

        // Warp past adjustmentInterval
        vm.roll(block.number + 11);

        // Next solve triggers the adjustment
        uint256 lastCellId = 100;
        uint256 nonce = _findPoWNonce(lastCellId, alice, difficulty);
        vm.prank(alice);
        vm_.verifyPow(lastCellId, typeHash, nonce);

        VibeStateVM.PowLockRequirement memory req = vm_.getPowLock(typeHash);
        // Difficulty should have increased
        assertGe(req.currentDifficulty, difficulty);
    }

    // ============ Siren Protocol (Commit-Reveal) ============

    function test_commitTransition_succeeds() public {
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(1), keccak256("data"), uint256(42), keccak256("secret")));

        vm.expectEmit(true, true, false, false);
        emit TransitionCommitted(commitHash, alice);

        vm.prank(alice);
        vm_.commitTransition(commitHash);

        assertEq(vm_.commitCount(), 1);

        VibeStateVM.TransitionCommit memory c = vm_.getCommit(commitHash);
        assertEq(c.commitHash, commitHash);
        assertEq(c.committer, alice);
        assertFalse(c.revealed);
        assertFalse(c.executed);
    }

    function test_commitTransition_revert_alreadyCommitted() public {
        bytes32 commitHash = keccak256("commit");

        vm.prank(alice);
        vm_.commitTransition(commitHash);

        vm.prank(bob);
        vm.expectRevert("Already committed");
        vm_.commitTransition(commitHash);
    }

    function test_commitTransition_multipleCommitters() public {
        bytes32 hash1 = keccak256("commit1");
        bytes32 hash2 = keccak256("commit2");

        vm.prank(alice);
        vm_.commitTransition(hash1);

        vm.prank(bob);
        vm_.commitTransition(hash2);

        assertEq(vm_.commitCount(), 2);
        assertEq(vm_.getCommit(hash1).committer, alice);
        assertEq(vm_.getCommit(hash2).committer, bob);
    }

    function test_revealTransition_succeeds() public {
        uint256 cellId = 1;
        bytes32 newDataHash = keccak256("newdata");
        uint256 powNonce = 999;
        bytes32 secret = keccak256("secret");

        bytes32 commitHash = keccak256(abi.encodePacked(cellId, newDataHash, powNonce, secret));

        vm.prank(alice);
        vm_.commitTransition(commitHash);

        vm.expectEmit(true, true, false, false);
        emit TransitionRevealed(commitHash, cellId);

        vm.prank(alice);
        vm_.revealTransition(cellId, newDataHash, powNonce, secret);

        assertTrue(vm_.getCommit(commitHash).revealed);
    }

    function test_revealTransition_revert_notCommitter() public {
        uint256 cellId = 1;
        bytes32 newDataHash = keccak256("data");
        uint256 powNonce = 0;
        bytes32 secret = keccak256("s");

        bytes32 commitHash = keccak256(abi.encodePacked(cellId, newDataHash, powNonce, secret));

        vm.prank(alice);
        vm_.commitTransition(commitHash);

        vm.prank(bob); // Wrong committer
        vm.expectRevert("Not committer");
        vm_.revealTransition(cellId, newDataHash, powNonce, secret);
    }

    function test_revealTransition_revert_alreadyRevealed() public {
        uint256 cellId = 1;
        bytes32 newDataHash = keccak256("data");
        uint256 powNonce = 0;
        bytes32 secret = keccak256("s");

        bytes32 commitHash = keccak256(abi.encodePacked(cellId, newDataHash, powNonce, secret));

        vm.prank(alice);
        vm_.commitTransition(commitHash);
        vm.prank(alice);
        vm_.revealTransition(cellId, newDataHash, powNonce, secret);

        vm.prank(alice);
        vm.expectRevert("Already revealed");
        vm_.revealTransition(cellId, newDataHash, powNonce, secret);
    }

    function test_revealTransition_revert_wrongPreimage() public {
        uint256 cellId = 1;
        bytes32 newDataHash = keccak256("data");
        uint256 powNonce = 0;
        bytes32 secret = keccak256("s");

        bytes32 commitHash = keccak256(abi.encodePacked(cellId, newDataHash, powNonce, secret));

        vm.prank(alice);
        vm_.commitTransition(commitHash);

        // Reveal with wrong data — commitHash won't match → "Not committer"
        vm.prank(alice);
        vm.expectRevert("Not committer");
        vm_.revealTransition(cellId, keccak256("WRONG"), powNonce, secret);
    }

    // ============ Hybrid Account Model ============

    function test_createAccount_succeeds() public {
        vm.expectEmit(true, false, false, false);
        emit AccountCreated(alice);

        _createAccount(alice);

        assertEq(vm_.totalAccounts(), 1);

        VibeStateVM.HybridAccount memory acct = vm_.getAccount(alice);
        assertEq(acct.owner, alice);
        assertEq(acct.balance, 0);
        assertEq(acct.nonce, 0);
        assertEq(acct.cellCount, 0);
        assertEq(acct.totalCellCapacity, 0);
    }

    function test_createAccount_withInitialBalance() public {
        _createAccountFunded(alice, 2 ether);

        VibeStateVM.HybridAccount memory acct = vm_.getAccount(alice);
        assertEq(acct.balance, 2 ether);
    }

    function test_createAccount_revert_alreadyExists() public {
        _createAccount(alice);

        vm.prank(alice);
        vm.expectRevert("Already exists");
        vm_.createAccount();
    }

    function test_depositToAccount_succeeds() public {
        _createAccountFunded(alice, 1 ether);

        vm.prank(alice);
        vm_.depositToAccount{value: 0.5 ether}();

        assertEq(vm_.getAccount(alice).balance, 1.5 ether);
    }

    function test_depositToAccount_revert_noAccount() public {
        vm.prank(carol);
        vm.expectRevert("No account");
        vm_.depositToAccount{value: 1 ether}();
    }

    function test_depositToCell_succeeds() public {
        _createAccountFunded(alice, 5 ether);

        vm.expectEmit(true, true, false, true);
        emit CellDeposited(alice, 42, 2 ether);

        vm.prank(alice);
        vm_.depositToCell(42, 2 ether);

        VibeStateVM.HybridAccount memory acct = vm_.getAccount(alice);
        assertEq(acct.balance, 3 ether);       // 5 - 2
        assertEq(acct.cellCount, 1);
        assertEq(acct.totalCellCapacity, 2 ether);
        assertEq(acct.nonce, 1);
    }

    function test_depositToCell_revert_noAccount() public {
        vm.prank(carol);
        vm.expectRevert("No account");
        vm_.depositToCell(1, 1 ether);
    }

    function test_depositToCell_revert_insufficientBalance() public {
        _createAccountFunded(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert("Insufficient balance");
        vm_.depositToCell(1, 2 ether);
    }

    function test_withdrawFromCell_succeeds() public {
        _createAccountFunded(alice, 5 ether);

        vm.prank(alice);
        vm_.depositToCell(42, 2 ether);

        vm.expectEmit(true, true, false, true);
        emit CellWithdrawn(alice, 42, 2 ether);

        vm.prank(alice);
        vm_.withdrawFromCell(42, 2 ether);

        VibeStateVM.HybridAccount memory acct = vm_.getAccount(alice);
        assertEq(acct.balance, 5 ether);       // 3 + 2 = back to 5
        assertEq(acct.cellCount, 0);
        assertEq(acct.totalCellCapacity, 0);
        assertEq(acct.nonce, 2);
    }

    function test_withdrawFromCell_revert_noAccount() public {
        vm.prank(carol);
        vm.expectRevert("No account");
        vm_.withdrawFromCell(1, 1 ether);
    }

    function test_depositWithdraw_nonceIncrementsPerOp() public {
        _createAccountFunded(alice, 10 ether);

        vm.prank(alice);
        vm_.depositToCell(1, 1 ether);
        assertEq(vm_.getAccount(alice).nonce, 1);

        vm.prank(alice);
        vm_.withdrawFromCell(1, 1 ether);
        assertEq(vm_.getAccount(alice).nonce, 2);
    }

    // ============ NC-max Uncle Blocks ============

    function test_recordUncle_succeeds() public {
        bytes32 blockHash = keccak256("uncle-block");
        address proposer = alice;

        vm.expectEmit(true, true, true, false);
        emit UncleRecorded(1, 0, proposer);

        vm_.recordUncle(0, blockHash, proposer);

        assertEq(vm_.uncleCount(), 1);

        VibeStateVM.UncleBlock memory u = vm_.getUncle(1);
        assertEq(u.uncleId, 1);
        assertEq(u.parentBlockNumber, 0);
        assertEq(u.blockHash, blockHash);
        assertEq(u.proposer, proposer);
        assertEq(u.reward, 0);
    }

    function test_recordUncle_indexedByBlock() public {
        vm_.recordUncle(0, keccak256("u1"), alice);
        vm_.recordUncle(0, keccak256("u2"), bob);

        uint256[] memory unclesForBlock1 = vm_.getBlockUncles(1);
        assertEq(unclesForBlock1.length, 2);
    }

    function test_recordUncle_revert_maxUnclesPerBlock() public {
        vm_.recordUncle(0, keccak256("u1"), alice);
        vm_.recordUncle(0, keccak256("u2"), bob);

        vm.expectRevert("Too many uncles");
        vm_.recordUncle(0, keccak256("u3"), carol);
    }

    function test_recordUncle_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vm_.recordUncle(0, keccak256("u"), alice);
    }

    function test_recordUncle_differentParentBlocks() public {
        vm_.recordUncle(0, keccak256("u0"), alice);
        vm_.recordUncle(1, keccak256("u1"), bob);

        // Each parent gets its own uncle list
        assertEq(vm_.getBlockUncles(1).length, 1);
        assertEq(vm_.getBlockUncles(2).length, 1);
    }

    // ============ Constants ============

    function test_constants() public view {
        assertEq(vm_.POW_BASE_DIFFICULTY(), 1000);
        assertEq(vm_.POW_ADJUSTMENT_FACTOR(), 200);
        assertEq(vm_.COMMIT_WINDOW(), 8);
        assertEq(vm_.REVEAL_WINDOW(), 2);
        assertEq(vm_.UNCLE_REWARD_PCT(), 5000);
        assertEq(vm_.MAX_UNCLES_PER_BLOCK(), 2);
    }

    // ============ View Functions ============

    function test_getScript_defaultValues() public view {
        VibeStateVM.Script memory s = vm_.getScript(keccak256("nonexistent"));
        assertEq(s.registrar, address(0));
        assertFalse(s.active);
    }

    function test_getPowLock_defaultValues() public view {
        VibeStateVM.PowLockRequirement memory req = vm_.getPowLock(keccak256("none"));
        assertEq(req.baseDifficulty, 0);
        assertEq(req.currentDifficulty, 0);
    }

    function test_getAccount_defaultValues() public view {
        VibeStateVM.HybridAccount memory acct = vm_.getAccount(carol);
        assertEq(acct.owner, address(0));
        assertEq(acct.balance, 0);
    }

    function test_getCommit_defaultValues() public view {
        VibeStateVM.TransitionCommit memory c = vm_.getCommit(keccak256("none"));
        assertEq(c.committer, address(0));
        assertFalse(c.revealed);
    }

    function test_getCellContention_defaultZero() public view {
        assertEq(vm_.getCellContention(999), 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_registerScript_countsUp(uint8 n) public {
        vm.assume(n > 0 && n < 20);
        for (uint256 i = 0; i < n; i++) {
            vm.warp(block.timestamp + i + 1);
            _registerScript(alice, keccak256(abi.encode(i)), VibeStateVM.ScriptType.LOCK, 100_000);
        }
        assertEq(vm_.scriptCount(), n);
    }

    function testFuzz_commitReveal_roundtrip(uint256 cellId, bytes32 newData, uint256 powNonce, bytes32 secret)
        public
    {
        bytes32 commitHash = keccak256(abi.encodePacked(cellId, newData, powNonce, secret));

        vm.prank(alice);
        vm_.commitTransition(commitHash);

        vm.prank(alice);
        vm_.revealTransition(cellId, newData, powNonce, secret);

        assertTrue(vm_.getCommit(commitHash).revealed);
    }

    function testFuzz_account_depositWithdraw(uint256 amount) public {
        vm.assume(amount > 0 && amount <= 10 ether);
        vm.deal(alice, amount * 2);

        _createAccountFunded(alice, amount);

        vm.prank(alice);
        vm_.depositToCell(1, amount);
        assertEq(vm_.getAccount(alice).balance, 0);

        vm.prank(alice);
        vm_.withdrawFromCell(1, amount);
        assertEq(vm_.getAccount(alice).balance, amount);
    }

    // ============ UUPS Upgrade ============

    function test_authorizeUpgrade_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vm_.upgradeToAndCall(address(0xdead), "");
    }

    function test_authorizeUpgrade_revert_notContract() public {
        vm.expectRevert("Not a contract");
        vm_.upgradeToAndCall(makeAddr("eoa"), "");
    }

    // ============ Receive ETH ============

    function test_receiveETH() public {
        (bool ok,) = address(vm_).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vm_).balance, 1 ether);
    }
}
