// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/JarvisComputeVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title JCV Rebase-Invariant Backing (RSI C8 Phase 8.3 — C7-GOV-006)
 * @notice Proves that JCV's backing check is now rebase-invariant.
 *         - Positive rebase: owner can NOT withdraw the rebase gain
 *         - Negative rebase: check still enforces backing correctly
 *         - Partial consumption: proportional internal release
 */

/// @dev Mock Joule-style rebasing JUL with internal/external conversion
contract MockRebasingJUL {
    mapping(address => uint256) private _internalBalances;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public rebaseScalar = 1e18;  // 1.0 = no rebase
    uint256 public constant PRECISION = 1e18;

    function mint(address to, uint256 externalAmount) external {
        uint256 internalAmount = (externalAmount * PRECISION) / rebaseScalar;
        _internalBalances[to] += internalAmount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return (_internalBalances[account] * rebaseScalar) / PRECISION;
    }

    function internalBalanceOf(address account) external view returns (uint256) {
        return _internalBalances[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 externalAmount) external returns (bool) {
        uint256 internalAmount = (externalAmount * PRECISION) / rebaseScalar;
        require(_internalBalances[from] >= internalAmount, "Insufficient balance");
        require(allowance[from][msg.sender] >= externalAmount, "Insufficient allowance");
        _internalBalances[from] -= internalAmount;
        allowance[from][msg.sender] -= externalAmount;
        _internalBalances[to] += internalAmount;
        return true;
    }

    function transfer(address to, uint256 externalAmount) external returns (bool) {
        uint256 internalAmount = (externalAmount * PRECISION) / rebaseScalar;
        require(_internalBalances[msg.sender] >= internalAmount, "Insufficient balance");
        _internalBalances[msg.sender] -= internalAmount;
        _internalBalances[to] += internalAmount;
        return true;
    }

    /// @notice Rebase up: external balances grow, internal unchanged
    function rebaseUp(uint256 percentBps) external {
        rebaseScalar = (rebaseScalar * (10000 + percentBps)) / 10000;
    }

    /// @notice Rebase down: external balances shrink, internal unchanged
    function rebaseDown(uint256 percentBps) external {
        rebaseScalar = (rebaseScalar * (10000 - percentBps)) / 10000;
    }
}

contract JcvRebaseInvariantTest is Test {
    JarvisComputeVault public vault;
    MockRebasingJUL public jul;

    uint256 verifierKey = 0xBEEF;
    address verifier;
    uint256 user1Key = 0xCAFE;
    address user1;

    bytes32 constant MINING_PROOF = keccak256("mined-block-rebase");

    function setUp() public {
        verifier = vm.addr(verifierKey);
        user1 = vm.addr(user1Key);

        jul = new MockRebasingJUL();

        JarvisComputeVault impl = new JarvisComputeVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(JarvisComputeVault.initialize.selector, address(jul), verifier)
        );
        vault = JarvisComputeVault(payable(address(proxy)));

        jul.mint(user1, 100_000e18);
    }

    function _deposit(address depositor, uint256 depositorKey, uint256 amount) internal returns (uint256 receiptId) {
        bytes32 secret = keccak256(abi.encodePacked("secret", depositor, amount, block.number));
        bytes32 commitHash = keccak256(abi.encodePacked(amount, secret, depositor));

        vm.prank(depositor);
        vault.commitDeposit(commitHash);

        vm.prank(depositor);
        jul.approve(address(vault), amount);

        vm.prank(depositor);
        vault.deposit(amount, secret, MINING_PROOF);

        return vault.receiptCount();
    }

    function _consume(uint256 receiptId, uint256 creditsToUse, uint256 depositorKey) internal {
        JarvisComputeVault.CreditReceipt memory r = vault.getReceipt(receiptId);
        bytes32 innerHash = keccak256(abi.encodePacked(receiptId, creditsToUse, r.nonce));
        bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", innerHash));
        (uint8 v, bytes32 rSig, bytes32 s) = vm.sign(depositorKey, messageHash);
        bytes memory sig = abi.encodePacked(rSig, s, v);

        vm.prank(verifier);
        vault.consumeCredits(receiptId, creditsToUse, sig);
    }

    // ============ Test: Positive Rebase ============

    function test_ownerCannotWithdrawPositiveRebaseGain() public {
        // User deposits 10k JUL — active backing = 10k internal (scalar = 1:1)
        uint256 receiptId = _deposit(user1, user1Key, 10_000e18);
        assertEq(vault.totalActiveInternalJul(), 10_000e18);
        assertEq(jul.balanceOf(address(vault)), 10_000e18);

        // Joule rebases UP 20%
        jul.rebaseUp(2000);

        // Vault's external balance grew, internal unchanged
        assertEq(jul.balanceOf(address(vault)), 12_000e18);
        assertEq(jul.internalBalanceOf(address(vault)), 10_000e18);
        assertEq(vault.totalActiveInternalJul(), 10_000e18);

        // BEFORE FIX: owner could withdraw the 2000 rebase gain.
        // AFTER FIX: any withdraw would push internal below active backing → reverts.
        vm.prank(vault.owner());
        vm.expectRevert(bytes("Would undercollateralize active credits"));
        vault.withdrawJul(2_000e18);

        // The receipt is untouched — user's share of the rebase is preserved
        (,, uint256 julAmount,,,,,,,,,) = vault.receipts(receiptId);
        assertEq(julAmount, 10_000e18); // original deposit amount unchanged
    }

    // ============ Test: Negative Rebase ============

    function test_negativeRebaseStillEnforcesBacking() public {
        _deposit(user1, user1Key, 10_000e18);
        assertEq(vault.totalActiveInternalJul(), 10_000e18);

        // Joule rebases DOWN 10%
        jul.rebaseDown(1000);

        // Vault's external balance shrank, internal unchanged
        assertEq(jul.balanceOf(address(vault)), 9_000e18);
        assertEq(jul.internalBalanceOf(address(vault)), 10_000e18);

        // Owner cannot withdraw — internal balance exactly matches active backing
        vm.prank(vault.owner());
        vm.expectRevert(bytes("Would undercollateralize active credits"));
        vault.withdrawJul(100e18);
    }

    // ============ Test: Full Consumption Releases Backing ============

    function test_fullConsumptionReleasesBacking() public {
        uint256 receiptId = _deposit(user1, user1Key, 10_000e18);
        uint256 originalCredits = vault.originalCreditsByReceipt(receiptId);
        assertEq(originalCredits, 10_000e18 * 1000 / 1e18);  // 10_000_000 credits

        // Consume ALL credits
        _consume(receiptId, originalCredits, user1Key);

        // All internal backing released
        assertEq(vault.totalActiveInternalJul(), 0);
        assertEq(vault.internalReleasedByReceipt(receiptId), 10_000e18);

        // Owner can now withdraw everything
        vm.prank(vault.owner());
        vault.withdrawJul(10_000e18);
        assertEq(jul.balanceOf(address(vault)), 0);
    }

    // ============ Test: Partial Consumption Releases Proportionally ============

    function test_partialConsumptionReleasesProportionally() public {
        uint256 receiptId = _deposit(user1, user1Key, 10_000e18);
        uint256 originalCredits = vault.originalCreditsByReceipt(receiptId);

        // Consume 30% of credits
        uint256 toConsume = originalCredits * 3 / 10;
        _consume(receiptId, toConsume, user1Key);

        // 30% of internal backing released (proportional)
        uint256 expectedReleased = (10_000e18 * toConsume) / originalCredits;
        assertEq(vault.internalReleasedByReceipt(receiptId), expectedReleased);
        assertEq(vault.totalActiveInternalJul(), 10_000e18 - expectedReleased);

        // Owner can withdraw the 30% proportional
        vm.prank(vault.owner());
        vault.withdrawJul(expectedReleased);

        // But NOT more
        vm.prank(vault.owner());
        vm.expectRevert(bytes("Would undercollateralize active credits"));
        vault.withdrawJul(1e18);
    }

    // ============ Test: Expiry Releases Backing ============

    function test_expiryReleasesBacking() public {
        uint256 receiptId = _deposit(user1, user1Key, 10_000e18);
        assertEq(vault.totalActiveInternalJul(), 10_000e18);

        // Fast-forward past expiration
        vm.warp(block.timestamp + 31 days);
        vault.expireCredits(receiptId);

        // All backing released
        assertEq(vault.totalActiveInternalJul(), 0);

        // Owner can withdraw
        vm.prank(vault.owner());
        vault.withdrawJul(10_000e18);
    }

    // ============ Test: Rebase + Partial Consume (compound scenario) ============

    function test_rebaseAfterPartialConsume() public {
        uint256 receiptId = _deposit(user1, user1Key, 10_000e18);
        uint256 originalCredits = vault.originalCreditsByReceipt(receiptId);

        // Consume 50% first
        _consume(receiptId, originalCredits / 2, user1Key);
        uint256 releasedAfterConsume = vault.internalReleasedByReceipt(receiptId);
        assertEq(vault.totalActiveInternalJul(), 10_000e18 - releasedAfterConsume);

        // THEN rebase up 50%
        jul.rebaseUp(5000);

        // Tokens haven't moved — vault still physically holds the full 10k internal.
        // But only 5k is "active backing" (the rest was released by consumption accounting).
        assertEq(jul.internalBalanceOf(address(vault)), 10_000e18);
        assertEq(vault.totalActiveInternalJul(), 10_000e18 - releasedAfterConsume);

        // Owner can withdraw the released 50% in EXTERNAL terms — but the amount of
        // external JUL they can pull depends on the current scalar. The invariant we
        // check: after withdrawal, internalBalance >= totalActiveInternalJul.

        // 5000e18 internal at 1.5x scalar = 7500e18 external they could withdraw.
        // Anything up to that should pass; anything more should revert.
        vm.prank(vault.owner());
        vault.withdrawJul(7_499e18);  // just under the limit

        // Invariant holds
        assertGe(jul.internalBalanceOf(address(vault)), vault.totalActiveInternalJul());

        // Trying to go further reverts
        vm.prank(vault.owner());
        vm.expectRevert(bytes("Would undercollateralize active credits"));
        vault.withdrawJul(100e18);
    }
}
