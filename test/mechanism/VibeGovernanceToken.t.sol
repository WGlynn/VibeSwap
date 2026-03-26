// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeGovernanceToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VibeGovernanceTokenTest
 * @notice Unit tests for VibeGovernanceToken (veVIBE)
 *
 * Coverage:
 *   - Lock: minting veVIBE, min/max duration guards, double-lock revert
 *   - Unlock: full duration wait, cannot unlock early
 *   - Early exit: 50% penalty applied, penalty pool accumulates
 *   - Extend lock: increases voting power, only forward extension
 *   - Increase lock: more ETH in = more voting power
 *   - Delegation: power moves to delegate, not tokens
 *   - Boost: linear 1x–2.5x based on veVIBE share
 *   - Admin: distributePenalties onlyOwner
 *   - UUPS upgrade: only owner
 */
contract VibeGovernanceTokenTest is Test {
    VibeGovernanceToken public vgt;
    VibeGovernanceToken public impl;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    // ============ Events ============

    event Locked(address indexed user, uint256 amount, uint256 lockEnd, uint256 votingPower);
    event Unlocked(address indexed user, uint256 amount);
    event EarlyExit(address indexed user, uint256 returned, uint256 penalized);
    event Extended(address indexed user, uint256 newLockEnd, uint256 newVotingPower);
    event Increased(address indexed user, uint256 additionalAmount, uint256 newVotingPower);
    event Delegated(address indexed from, address indexed to, uint256 power);
    event PenaltyDistributed(uint256 amount);

    uint256 constant MIN_LOCK = 7 days;
    uint256 constant MAX_LOCK = 4 * 365 days;

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);

        vm.prank(owner);
        impl = new VibeGovernanceToken();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeGovernanceToken.initialize, ())
        );
        vgt = VibeGovernanceToken(payable(address(proxy)));
    }

    // ============ Initialization ============

    function test_initialize_constants() public view {
        assertEq(vgt.MAX_LOCK_TIME(), MAX_LOCK);
        assertEq(vgt.MIN_LOCK_TIME(), MIN_LOCK);
        assertEq(vgt.EARLY_EXIT_PENALTY_BPS(), 5000);
        assertEq(vgt.MAX_BOOST_BPS(), 25000);
    }

    function test_initialize_zeroState() public view {
        assertEq(vgt.totalLocked(), 0);
        assertEq(vgt.totalVotingPower(), 0);
        assertEq(vgt.penaltyPool(), 0);
        assertEq(vgt.lockCount(), 0);
    }

    // ============ Lock ============

    function test_lock_basicLock() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        (uint256 amount,, uint256 lockEnd, uint256 votingPower,, bool active) = vgt.locks(alice);
        assertTrue(active);
        assertEq(amount, 1 ether);
        assertApproxEqAbs(lockEnd, block.timestamp + MIN_LOCK, 1);
        assertGt(votingPower, 0);
        assertEq(vgt.totalLocked(), 1 ether);
        assertEq(vgt.lockCount(), 1);
    }

    function test_lock_longerLock_moreVotingPower() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);
        (,,, uint256 minPower,,) = vgt.locks(alice);

        // Reset
        vm.warp(block.timestamp + MIN_LOCK + 1);
        vm.prank(alice);
        vgt.unlock();

        vm.prank(bob);
        vgt.lock{value: 1 ether}(MAX_LOCK);
        (,,, uint256 maxPower,,) = vgt.locks(bob);

        assertGt(maxPower, minPower, "Max lock should yield more voting power");
    }

    function test_lock_maxLock_fullVotingPower() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        (,,, uint256 power,,) = vgt.locks(alice);
        // MAX_LOCK gives amount * MAX_LOCK / MAX_LOCK = amount
        assertEq(power, 1 ether);
    }

    function test_lock_revert_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Zero amount");
        vgt.lock{value: 0}(MIN_LOCK);
    }

    function test_lock_revert_tooShort() public {
        vm.prank(alice);
        vm.expectRevert("Lock too short");
        vgt.lock{value: 1 ether}(MIN_LOCK - 1);
    }

    function test_lock_revert_tooLong() public {
        vm.prank(alice);
        vm.expectRevert("Lock too long");
        vgt.lock{value: 1 ether}(MAX_LOCK + 1);
    }

    function test_lock_revert_alreadyLocked() public {
        vm.startPrank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);
        vm.expectRevert("Already locked");
        vgt.lock{value: 1 ether}(MIN_LOCK);
        vm.stopPrank();
    }

    function test_lock_emitsEvent() public {
        uint256 expectedPower = (1 ether * MIN_LOCK) / MAX_LOCK;
        uint256 expectedLockEnd = block.timestamp + MIN_LOCK;

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit Locked(alice, 1 ether, expectedLockEnd, expectedPower);
        vgt.lock{value: 1 ether}(MIN_LOCK);
    }

    // ============ Unlock ============

    function test_unlock_afterExpiry() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        vm.warp(block.timestamp + MIN_LOCK + 1);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        vgt.unlock();

        assertEq(alice.balance - balBefore, 1 ether, "Should receive full amount back");
        assertEq(vgt.totalLocked(), 0);
        assertEq(vgt.totalVotingPower(), 0);

        (, , , , , bool active) = vgt.locks(alice);
        assertFalse(active);
    }

    function test_unlock_revert_noActiveLock() public {
        vm.prank(alice);
        vm.expectRevert("No active lock");
        vgt.unlock();
    }

    function test_unlock_revert_stillLocked() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        vm.prank(alice);
        vm.expectRevert("Still locked");
        vgt.unlock();
    }

    function test_unlock_emitsEvent() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        vm.warp(block.timestamp + MIN_LOCK + 1);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit Unlocked(alice, 1 ether);
        vgt.unlock();
    }

    // ============ Early Exit ============

    function test_earlyExit_50PercentPenalty() public {
        vm.prank(alice);
        vgt.lock{value: 2 ether}(MAX_LOCK);

        uint256 balBefore = alice.balance;

        vm.prank(alice);
        vgt.earlyExit();

        uint256 received = alice.balance - balBefore;
        assertEq(received, 1 ether, "Should receive exactly 50% back");
        assertEq(vgt.penaltyPool(), 1 ether, "Penalty pool should hold the 50%");
        assertEq(vgt.totalLocked(), 0, "Total locked should be cleared");
    }

    function test_earlyExit_revert_noActiveLock() public {
        vm.prank(alice);
        vm.expectRevert("No active lock");
        vgt.earlyExit();
    }

    function test_earlyExit_revert_afterExpiry() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        vm.warp(block.timestamp + MIN_LOCK + 1);

        vm.prank(alice);
        vm.expectRevert("Already unlocked");
        vgt.earlyExit();
    }

    function test_earlyExit_emitsEvent() public {
        vm.prank(alice);
        vgt.lock{value: 2 ether}(MAX_LOCK);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit EarlyExit(alice, 1 ether, 1 ether);
        vgt.earlyExit();
    }

    // ============ Extend Lock ============

    function test_extendLock_increasesVotingPower() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        (,,, uint256 powerBefore,,) = vgt.locks(alice);
        uint256 newLockEnd = block.timestamp + 2 * MIN_LOCK;

        vm.prank(alice);
        vgt.extendLock(newLockEnd);

        (,,, uint256 powerAfter,,) = vgt.locks(alice);
        assertGt(powerAfter, powerBefore, "Extended lock should have more power");
    }

    function test_extendLock_revert_noActiveLock() public {
        vm.prank(alice);
        vm.expectRevert("No active lock");
        vgt.extendLock(block.timestamp + MIN_LOCK);
    }

    function test_extendLock_revert_notExtending() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        (,, uint256 lockEnd,,,) = vgt.locks(alice);

        vm.prank(alice);
        vm.expectRevert("Must extend");
        vgt.extendLock(lockEnd); // same end time
    }

    function test_extendLock_revert_tooLong() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        vm.prank(alice);
        vm.expectRevert("Too long");
        vgt.extendLock(block.timestamp + MAX_LOCK + 1);
    }

    function test_extendLock_emitsEvent() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        uint256 newLockEnd = block.timestamp + MAX_LOCK;

        vm.prank(alice);
        vm.expectEmit(true, false, false, false); // only check indexed
        emit Extended(alice, newLockEnd, 0);
        vgt.extendLock(newLockEnd);
    }

    // ============ Increase Lock ============

    function test_increaseLock_moreETH_moreVotingPower() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        (,,, uint256 powerBefore,,) = vgt.locks(alice);

        vm.prank(alice);
        vgt.increaseLock{value: 1 ether}();

        (,,, uint256 powerAfter,,) = vgt.locks(alice);
        assertGt(powerAfter, powerBefore, "Adding ETH should increase voting power");
        assertEq(vgt.totalLocked(), 2 ether);
    }

    function test_increaseLock_revert_zeroAmount() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        vm.prank(alice);
        vm.expectRevert("Zero amount");
        vgt.increaseLock{value: 0}();
    }

    function test_increaseLock_revert_noActiveLock() public {
        vm.prank(alice);
        vm.expectRevert("No active lock");
        vgt.increaseLock{value: 1 ether}();
    }

    // ============ Delegation ============

    function test_delegate_movesVotingPower() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        (,,, uint256 alicePower,,) = vgt.locks(alice);
        uint256 aliceDelegatedBefore = vgt.delegatedPower(alice);

        vm.prank(alice);
        vgt.delegate(bob);

        assertEq(vgt.delegatedPower(alice), 0, "Alice loses delegated power");
        assertEq(vgt.delegatedPower(bob), alicePower, "Bob gains delegated power");
        assertEq(vgt.delegatedPower(alice) + aliceDelegatedBefore, alicePower,
            "Total power conserved");
    }

    function test_delegate_emitsEvent() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        (,,, uint256 alicePower,,) = vgt.locks(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Delegated(alice, bob, alicePower);
        vgt.delegate(bob);
    }

    function test_delegate_revert_zeroAddress() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        vm.prank(alice);
        vm.expectRevert("Zero delegate");
        vgt.delegate(address(0));
    }

    function test_delegate_revert_noActiveLock() public {
        vm.prank(alice);
        vm.expectRevert("No active lock");
        vgt.delegate(bob);
    }

    // ============ Voting Power (getVotingPower) ============

    function test_getVotingPower_zeroIfNoLock() public view {
        assertEq(vgt.getVotingPower(alice), 0);
    }

    function test_getVotingPower_zeroAfterExpiry() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        vm.warp(block.timestamp + MIN_LOCK + 1);

        assertEq(vgt.getVotingPower(alice), 0, "No power after lock expires");
    }

    function test_getVotingPower_decaysOverTime() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        uint256 powerNow = vgt.getVotingPower(alice);

        vm.warp(block.timestamp + MAX_LOCK / 2);
        uint256 powerHalf = vgt.getVotingPower(alice);

        assertLt(powerHalf, powerNow, "Voting power should decay over time");
        assertGt(powerHalf, 0, "Still some power remaining at halfway point");
    }

    function test_getTimeRemaining_decreases() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        uint256 remaining = vgt.getTimeRemaining(alice);
        assertApproxEqAbs(remaining, MIN_LOCK, 2);

        vm.warp(block.timestamp + MIN_LOCK / 2);
        uint256 remainingHalf = vgt.getTimeRemaining(alice);
        assertApproxEqAbs(remainingHalf, MIN_LOCK / 2, 2);
    }

    // ============ Boost ============

    function test_calculateBoost_noLockers_returns1x() public view {
        assertEq(vgt.calculateBoost(alice), 10000, "1x boost when no one has locked");
    }

    function test_calculateBoost_soloLocker_maxBoost() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        // Alice has 100% of voting power — should be at max boost (2.5x)
        assertEq(vgt.calculateBoost(alice), 25000, "Solo locker gets max boost");
    }

    function test_calculateBoost_halfShare_midBoost() public {
        // Alice and Bob lock equal amounts for same duration
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        vm.prank(bob);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        uint256 boost = vgt.calculateBoost(alice);
        // 50% share → boost = 10000 + 0.5 * (25000 - 10000) = 17500
        assertEq(boost, 17500, "50% share = 1.75x boost");
    }

    function test_calculateBoost_noLock_minimum() public {
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MAX_LOCK);

        // Bob has no lock, should get minimum boost (but not zero — formula returns 10000)
        uint256 boost = vgt.calculateBoost(bob);
        assertEq(boost, 10000, "No lock = 1x boost (base)");
    }

    // ============ Admin: distributePenalties ============

    function test_distributePenalties_onlyOwner() public {
        vm.prank(alice);
        vgt.lock{value: 2 ether}(MAX_LOCK);

        vm.prank(alice);
        vgt.earlyExit(); // creates 1 ether penalty

        vm.prank(alice); // not owner
        vm.expectRevert();
        vgt.distributePenalties();
    }

    function test_distributePenalties_revert_noPenalties() public {
        // owner of proxy is the test contract (deployed via ERC1967Proxy with no prank)
        // Find the proxy owner
        address proxyOwner = vgt.owner();

        vm.prank(proxyOwner);
        vm.expectRevert("No penalties");
        vgt.distributePenalties();
    }

    function test_distributePenalties_clearsPool() public {
        vm.prank(alice);
        vgt.lock{value: 2 ether}(MAX_LOCK);

        vm.prank(alice);
        vgt.earlyExit();

        assertEq(vgt.penaltyPool(), 1 ether);

        address proxyOwner = vgt.owner();
        vm.prank(proxyOwner);
        vgt.distributePenalties();

        assertEq(vgt.penaltyPool(), 0);
        assertEq(vgt.totalLocked(), 1 ether, "Penalty added to locked pool");
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_onlyOwner() public {
        VibeGovernanceToken newImpl = new VibeGovernanceToken();

        vm.prank(alice);
        vm.expectRevert();
        vgt.upgradeToAndCall(address(newImpl), "");

        // Owner can upgrade
        address proxyOwner = vgt.owner();
        vm.prank(proxyOwner);
        vgt.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Integration: Full Lock/Extend/Unlock Lifecycle ============

    function test_lifecycle_lockExtendUnlock() public {
        // 1. Lock
        vm.prank(alice);
        vgt.lock{value: 1 ether}(MIN_LOCK);

        assertEq(vgt.totalLocked(), 1 ether);

        // 2. Extend
        uint256 newEnd = block.timestamp + 2 * MIN_LOCK;
        vm.prank(alice);
        vgt.extendLock(newEnd);

        // 3. Increase
        vm.prank(alice);
        vgt.increaseLock{value: 0.5 ether}();
        assertEq(vgt.totalLocked(), 1.5 ether);

        // 4. Wait for lock expiry
        vm.warp(newEnd + 1);

        // 5. Unlock and receive back
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        vgt.unlock();

        assertEq(alice.balance - balBefore, 1.5 ether, "Should receive full 1.5 ether back");
        assertEq(vgt.totalLocked(), 0);
    }

    // ============ Fuzz ============

    function testFuzz_lockDurationBounds(uint256 duration) public {
        duration = bound(duration, MIN_LOCK, MAX_LOCK);
        vm.prank(alice);
        vgt.lock{value: 1 ether}(duration);

        (,, uint256 lockEnd,,,) = vgt.locks(alice);
        assertApproxEqAbs(lockEnd, block.timestamp + duration, 1);
    }

    function testFuzz_lockAmount(uint256 amount) public {
        amount = bound(amount, 1 wei, 100 ether);
        vm.deal(alice, amount);

        vm.prank(alice);
        vgt.lock{value: amount}(MIN_LOCK);

        assertEq(vgt.totalLocked(), amount);
    }
}
