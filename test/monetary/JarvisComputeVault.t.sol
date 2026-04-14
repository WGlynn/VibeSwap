// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/JarvisComputeVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Minimal mock JUL token for testing (no rebase — scalar = 1:1)
contract MockJUL {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    /// @dev C7-GOV-006: JCV queries this for rebase-invariant backing.
    ///      In this no-rebase mock, internal == external.
    function internalBalanceOf(address account) external view returns (uint256) {
        return balanceOf[account];
    }
}

contract JarvisComputeVaultTest is Test {
    JarvisComputeVault public vault;
    MockJUL public jul;

    // owner = address(this) because initialize uses __Ownable_init(msg.sender)
    uint256 verifierKey = 0xBEEF;
    address verifier;
    uint256 user1Key = 0xCAFE;
    address user1;
    address user2 = makeAddr("user2");
    address attacker = makeAddr("attacker");

    bytes32 constant MINING_PROOF = keccak256("mined-block-42");

    function setUp() public {
        verifier = vm.addr(verifierKey);
        user1 = vm.addr(user1Key);

        // Deploy mock JUL
        jul = new MockJUL();

        // Deploy vault behind proxy
        JarvisComputeVault impl = new JarvisComputeVault();
        bytes memory data = abi.encodeWithSelector(
            JarvisComputeVault.initialize.selector, address(jul), verifier
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), data);
        vault = JarvisComputeVault(payable(address(proxy)));

        // Mint JUL to users
        jul.mint(user1, 100_000e18);
        jul.mint(user2, 100_000e18);

        // Approve vault
        vm.prank(user1);
        jul.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        jul.approve(address(vault), type(uint256).max);
    }

    // ============ Helpers ============

    uint256 private _depositNonce;

    function _commitAndDeposit(address user, uint256 amount) internal returns (uint256 receiptId) {
        _depositNonce++;
        bytes32 secret = keccak256(abi.encodePacked("secret", user, amount, _depositNonce));
        bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, user));

        vm.prank(user);
        vault.commitDeposit(commitHash);

        vm.prank(user);
        vault.deposit(amount, secret, MINING_PROOF);

        receiptId = vault.receiptCount();
    }

    // ============ Commit-Reveal ============

    function test_commitDeposit() public {
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(1e18), bytes32("secret"), user1));

        vm.prank(user1);
        vault.commitDeposit(commitHash);

        (bytes32 stored, uint256 committedAt, bool revealed) = vault.commits(commitHash);
        assertEq(stored, commitHash);
        assertGt(committedAt, 0);
        assertFalse(revealed);
    }

    function test_revert_commitTwice() public {
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(1e18), bytes32("secret"), user1));

        vm.prank(user1);
        vault.commitDeposit(commitHash);

        vm.prank(user1);
        vm.expectRevert("Already committed");
        vault.commitDeposit(commitHash);
    }

    // ============ Deposit ============

    function test_deposit() public {
        uint256 amount = 10e18;
        uint256 receiptId = _commitAndDeposit(user1, amount);

        assertEq(receiptId, 1);
        assertEq(vault.totalJulDeposited(), amount);

        JarvisComputeVault.CreditReceipt memory r = vault.getReceipt(receiptId);
        assertEq(r.depositor, user1);
        assertEq(r.julAmount, amount);
        // 10e18 * 1000 / 1e18 = 10000 credits
        assertEq(r.computeCredits, 10000);
        assertFalse(r.consumed);
        assertFalse(r.fraudSlashed);

        JarvisComputeVault.UserAccount memory acct = vault.getAccount(user1);
        assertEq(acct.totalDeposited, amount);
        assertEq(acct.activeCredits, 10000);
    }

    function test_deposit_transfersJUL() public {
        uint256 amount = 5e18;
        uint256 balBefore = jul.balanceOf(user1);

        _commitAndDeposit(user1, amount);

        assertEq(jul.balanceOf(user1), balBefore - amount);
        assertEq(jul.balanceOf(address(vault)), amount);
    }

    function test_revert_deposit_noCommit() public {
        vm.prank(user1);
        vm.expectRevert("No commitment found");
        vault.deposit(1e18, bytes32("secret"), MINING_PROOF);
    }

    function test_revert_deposit_commitExpired() public {
        uint256 amount = 1e18;
        bytes32 secret = keccak256(abi.encodePacked("secret", user1, amount));
        bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, user1));

        vm.prank(user1);
        vault.commitDeposit(commitHash);

        // Warp past commit window (5 min)
        vm.warp(block.timestamp + 6 minutes);

        vm.prank(user1);
        vm.expectRevert("Commit expired");
        vault.deposit(amount, secret, MINING_PROOF);
    }

    function test_revert_deposit_belowMinimum() public {
        uint256 amount = 1e14; // Below MIN_DEPOSIT (1e15)
        bytes32 secret = keccak256(abi.encodePacked("secret", user1, amount));
        bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, user1));

        vm.prank(user1);
        vault.commitDeposit(commitHash);

        vm.prank(user1);
        vm.expectRevert("Below minimum");
        vault.deposit(amount, secret, MINING_PROOF);
    }

    function test_revert_deposit_alreadyRevealed() public {
        uint256 amount = 1e18;
        bytes32 secret = keccak256(abi.encodePacked("secret", user1, amount));
        bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, user1));

        vm.prank(user1);
        vault.commitDeposit(commitHash);

        vm.prank(user1);
        vault.deposit(amount, secret, MINING_PROOF);

        // Try to reveal again
        vm.prank(user1);
        vm.expectRevert("Already revealed");
        vault.deposit(amount, secret, MINING_PROOF);
    }

    // ============ Rate Limiting ============

    function test_rateLimit_maxDepositsPerDay() public {
        // Make 10 deposits (MAX_DEPOSITS_PER_DAY)
        for (uint256 i = 0; i < 10; i++) {
            uint256 amount = 1e18;
            bytes32 secret = keccak256(abi.encodePacked("secret", user1, amount, i));
            bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, user1));

            vm.prank(user1);
            vault.commitDeposit(commitHash);
            vm.prank(user1);
            vault.deposit(amount, secret, MINING_PROOF);
        }

        // 11th should fail
        uint256 amount = 1e18;
        bytes32 secret = keccak256(abi.encodePacked("secret", user1, amount, uint256(10)));
        bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, user1));

        vm.prank(user1);
        vault.commitDeposit(commitHash);
        vm.prank(user1);
        vm.expectRevert("Daily limit reached");
        vault.deposit(amount, secret, MINING_PROOF);
    }

    function test_rateLimit_resetsNextDay() public {
        // Use all 10 slots
        for (uint256 i = 0; i < 10; i++) {
            uint256 amount = 1e18;
            bytes32 secret = keccak256(abi.encodePacked("secret", user1, amount, i));
            bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, user1));
            vm.prank(user1);
            vault.commitDeposit(commitHash);
            vm.prank(user1);
            vault.deposit(amount, secret, MINING_PROOF);
        }

        // Warp to next day
        vm.warp(block.timestamp + 1 days);

        // Should work again
        uint256 amount = 1e18;
        bytes32 secret = keccak256(abi.encodePacked("secret-day2", user1, amount));
        bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, user1));
        vm.prank(user1);
        vault.commitDeposit(commitHash);
        vm.prank(user1);
        vault.deposit(amount, secret, MINING_PROOF);
    }

    // ============ Credit Consumption ============

    function test_consumeCredits() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        // Sign consumption authorization
        uint256 creditsToUse = 5000;
        JarvisComputeVault.CreditReceipt memory r = vault.getReceipt(receiptId);

        bytes32 innerHash = keccak256(abi.encodePacked(receiptId, creditsToUse, r.nonce));
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", innerHash
        ));
        (uint8 v, bytes32 rSig, bytes32 s) = vm.sign(user1Key, messageHash);
        bytes memory sig = abi.encodePacked(rSig, s, v);

        vm.prank(verifier);
        vault.consumeCredits(receiptId, creditsToUse, sig);

        JarvisComputeVault.CreditReceipt memory rAfter = vault.getReceipt(receiptId);
        assertEq(rAfter.computeCredits, 5000); // 10000 - 5000
        assertFalse(rAfter.consumed);

        assertEq(vault.getActiveCredits(user1), 5000);
    }

    function test_consumeCredits_fullConsumption() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        uint256 creditsToUse = 10000;
        JarvisComputeVault.CreditReceipt memory r = vault.getReceipt(receiptId);

        bytes32 innerHash = keccak256(abi.encodePacked(receiptId, creditsToUse, r.nonce));
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", innerHash
        ));
        (uint8 v, bytes32 rSig, bytes32 s) = vm.sign(user1Key, messageHash);
        bytes memory sig = abi.encodePacked(rSig, s, v);

        vm.prank(verifier);
        vault.consumeCredits(receiptId, creditsToUse, sig);

        JarvisComputeVault.CreditReceipt memory rAfter = vault.getReceipt(receiptId);
        assertTrue(rAfter.consumed);
        assertEq(vault.getActiveCredits(user1), 0);
    }

    function test_revert_consumeCredits_wrongSigner() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);
        JarvisComputeVault.CreditReceipt memory r = vault.getReceipt(receiptId);

        // Sign with wrong key
        uint256 wrongKey = 0xDEAD;
        bytes32 innerHash = keccak256(abi.encodePacked(receiptId, uint256(1000), r.nonce));
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", innerHash
        ));
        (uint8 v, bytes32 rSig, bytes32 s) = vm.sign(wrongKey, messageHash);
        bytes memory sig = abi.encodePacked(rSig, s, v);

        vm.prank(verifier);
        vm.expectRevert("Invalid signature");
        vault.consumeCredits(receiptId, 1000, sig);
    }

    function test_revert_consumeCredits_notVerifier() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        vm.prank(attacker);
        vm.expectRevert("Not verifier");
        vault.consumeCredits(receiptId, 1000, new bytes(65));
    }

    // ============ Credit Expiry ============

    function test_expireCredits() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        // Warp past expiry (30 days)
        vm.warp(block.timestamp + 31 days);

        vault.expireCredits(receiptId);

        JarvisComputeVault.CreditReceipt memory r = vault.getReceipt(receiptId);
        assertTrue(r.consumed);
        assertEq(r.computeCredits, 0);
        assertEq(vault.getActiveCredits(user1), 0);
    }

    function test_revert_expireCredits_notExpired() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        vm.expectRevert("Not expired");
        vault.expireCredits(receiptId);
    }

    /// @notice C9-AUDIT-2: expireCredits on an already-slashed receipt must revert.
    ///         Pre-fix behavior: the slashed receipt's ORIGINAL computeCredits got
    ///         double-counted in totalCreditsExpired, and the depositor's activeCredits
    ///         (holding legitimate credits from OTHER receipts) were incorrectly
    ///         affected via the activeCredits fallback branch.
    function test_revert_expireCredits_fraudSlashed() public {
        uint256 r1 = _commitAndDeposit(user1, 10e18);

        // Slash r1 via fraud report
        vm.prank(verifier);
        vault.reportFraud(user1, r1);

        JarvisComputeVault.CreditReceipt memory r1View = vault.getReceipt(r1);
        assertTrue(r1View.fraudSlashed, "r1 marked slashed");
        assertFalse(r1View.consumed, "r1 not auto-consumed (stat remains non-terminal)");

        // Capture totalCreditsExpired before
        uint256 expiredBefore = vault.totalCreditsExpired();

        // Warp past expiry
        vm.warp(block.timestamp + 31 days);

        // Anyone can call expireCredits — this MUST revert on slashed receipts.
        vm.expectRevert("Fraud slashed");
        vault.expireCredits(r1);

        // Global expired counter must NOT have moved
        assertEq(vault.totalCreditsExpired(), expiredBefore, "no phantom expiry credit");
    }

    /// @notice Companion test: healthy receipts still expire normally.
    function test_expireCredits_healthyReceiptUnaffectedByFraudGuard() public {
        uint256 r1 = _commitAndDeposit(user1, 10e18);
        // No fraud. Warp past expiry.
        vm.warp(block.timestamp + 31 days);

        vault.expireCredits(r1);
        assertTrue(vault.getReceipt(r1).consumed);
    }

    // ============ Fraud Proof (C5-MON-001 Fixed) ============

    function test_fraudProof_cannotSlashWithArbitraryHash() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        // C5-MON-001: After fix, submitFraudProof takes no external parameter.
        // The contract recomputes the proof internally. If the stored proof matches
        // the recomputed proof (which it should for valid deposits), fraud is NOT detected.
        vm.prank(attacker);
        vm.expectRevert("No fraud detected");
        vault.submitFraudProof(receiptId);
    }

    function test_fraudProof_validDepositNotFraudulent() public {
        // A properly created receipt should never be flagged as fraud
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        vm.expectRevert("No fraud detected");
        vault.submitFraudProof(receiptId);

        // Credits should be untouched
        assertEq(vault.getActiveCredits(user1), 10000);
        assertFalse(vault.isBanned(user1));
    }

    // ============ Report Fraud (Backend) ============

    function test_reportFraud() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        uint256 creditsBefore = vault.getActiveCredits(user1);

        vm.prank(verifier);
        vault.reportFraud(user1, receiptId);

        // 50% slash
        assertEq(vault.getActiveCredits(user1), creditsBefore / 2);
    }

    function test_reportFraud_banAfter3Strikes() public {
        uint256 r1 = _commitAndDeposit(user1, 1e18);
        uint256 r2 = _commitAndDeposit(user1, 1e18);
        uint256 r3 = _commitAndDeposit(user1, 1e18);

        vm.startPrank(verifier);
        vault.reportFraud(user1, r1);
        vault.reportFraud(user1, r2);
        vault.reportFraud(user1, r3);
        vm.stopPrank();

        assertTrue(vault.isBanned(user1));
    }

    function test_revert_reportFraud_notAuthorized() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        vm.prank(attacker);
        vm.expectRevert("Not authorized");
        vault.reportFraud(user1, receiptId);
    }

    // ============ Banned Users ============

    function test_revert_banned_cannotCommit() public {
        uint256 r1 = _commitAndDeposit(user1, 1e18);
        uint256 r2 = _commitAndDeposit(user1, 1e18);
        uint256 r3 = _commitAndDeposit(user1, 1e18);

        vm.startPrank(verifier);
        vault.reportFraud(user1, r1);
        vault.reportFraud(user1, r2);
        vault.reportFraud(user1, r3);
        vm.stopPrank();

        assertTrue(vault.isBanned(user1));

        vm.prank(user1);
        vm.expectRevert("Banned");
        vault.commitDeposit(keccak256("anything"));
    }

    // ============ Binding Proof Verification ============

    function test_verifyBindingProof() public {
        uint256 receiptId = _commitAndDeposit(user1, 10e18);

        JarvisComputeVault.CreditReceipt memory r = vault.getReceipt(receiptId);

        (bool valid, uint256 id) = vault.verifyBindingProof(r.bindingProof);
        assertTrue(valid);
        assertEq(id, receiptId);
    }

    function test_verifyBindingProof_invalidProof() public {
        (bool valid, uint256 id) = vault.verifyBindingProof(keccak256("garbage"));
        assertFalse(valid);
        assertEq(id, 0);
    }

    // ============ Admin ============

    function test_setVerifier() public {
        address newVerifier = makeAddr("newVerifier");
        // owner = address(this) — no prank needed
        vault.setVerifier(newVerifier);
    }

    function test_withdrawJul_respectsBacking() public {
        _commitAndDeposit(user1, 10e18);

        // Active credits = 10000, backing = 10000 * 1e18 / 1000 = 10e18
        // Vault has exactly 10e18 JUL — cannot withdraw anything
        vm.expectRevert("Would undercollateralize active credits");
        vault.withdrawJul(1);
    }

    function test_withdrawJul_afterExpiry() public {
        _commitAndDeposit(user1, 10e18);

        // Warp past credit expiry
        vm.warp(block.timestamp + 31 days);
        vault.expireCredits(1);

        // Credits expired — all JUL is now withdrawable
        vault.withdrawJul(10e18);

        assertEq(jul.balanceOf(address(vault)), 0);
    }

    function test_unban() public {
        uint256 r1 = _commitAndDeposit(user1, 10e18);
        uint256 r2 = _commitAndDeposit(user1, 10e18);
        uint256 r3 = _commitAndDeposit(user1, 10e18);

        vm.startPrank(verifier);
        vault.reportFraud(user1, r1);
        vault.reportFraud(user1, r2);
        vault.reportFraud(user1, r3);
        vm.stopPrank();

        assertTrue(vault.isBanned(user1));

        vault.unban(user1);
        assertFalse(vault.isBanned(user1));
    }

    // ============ ETH Trap Removed (C5-MON-007) ============

    function test_revert_sendETH() public {
        // C5-MON-007: receive() removed — ETH sends should revert
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok, "ETH send should revert - no receive()");
    }

    // ============ C9-AUDIT-1: Backing Migration ============

    /// @notice Fresh deploys set backingMigrationComplete = true in initialize().
    function test_freshDeploySetsMigrationComplete() public view {
        assertTrue(vault.backingMigrationComplete(), "fresh deploy is pre-migrated");
    }

    /// @notice withdrawJul must revert if backingMigrationComplete = false.
    ///         This blocks the post-upgrade rug scenario where totalActiveInternalJul == 0
    ///         on a proxy with legacy receipts.
    function test_withdrawJul_blockedUntilMigrationComplete() public {
        // Simulate upgrade-state: clear the flag via vm.store at the known slot.
        // backingMigrationComplete is the slot immediately after totalActiveInternalJul.
        // Rather than hunt the slot, use a different test strategy: verify that the
        // require on an UNMIGRATED state blocks withdrawJul. We cannot flip the flag
        // back to false from outside the contract, so instead test the reinitializer
        // behavior with a fresh vault whose initialize() runs differently...
        //
        // Simpler: verify the require text by checking error-selector behavior via
        // a targeted vm.store on the storage slot.

        // Find the slot for backingMigrationComplete. The contract has specific storage
        // layout — locate empirically by walking slots.
        // For test reliability: use a dedicated fresh vault proxy, toggle the slot,
        // and confirm revert.
        JarvisComputeVault impl = new JarvisComputeVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(JarvisComputeVault.initialize.selector, address(jul), verifier)
        );
        JarvisComputeVault freshVault = JarvisComputeVault(address(proxy));

        // Locate slot of backingMigrationComplete by searching for the bool
        uint256 slot = _findMigrationFlagSlot(address(freshVault));
        // Set to false (simulate post-upgrade default)
        vm.store(address(freshVault), bytes32(slot), bytes32(uint256(0)));

        assertFalse(freshVault.backingMigrationComplete(), "slot toggled to false");

        vm.expectRevert("Legacy migration pending");
        freshVault.withdrawJul(1);
    }

    /// @dev Scans the first 100 slots for the single-byte bool.
    function _findMigrationFlagSlot(address target) internal view returns (uint256) {
        for (uint256 i = 0; i < 300; i++) {
            bytes32 raw = vm.load(target, bytes32(i));
            // backingMigrationComplete == true stored as 0x...01
            if (raw == bytes32(uint256(1))) return i;
        }
        revert("flag slot not found");
    }
}
