// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeLiquidityLocker.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockLP is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ VibeLiquidityLocker Tests ============

contract VibeLiquidityLockerTest is Test {
    VibeLiquidityLocker public locker;
    MockLP public lpToken;

    address public owner;
    address public alice;
    address public bob;

    uint256 constant LOCK_FEE    = 0.01 ether;
    uint256 constant CLIFF_1W    = 7 days;
    uint256 constant VESTING_4W  = 28 days;

    // ============ Events ============

    event LiquidityLocked(uint256 indexed lockId, address indexed owner, address lpToken, uint256 amount, uint256 cliffEnd, uint256 vestingEnd);
    event LiquidityClaimed(uint256 indexed lockId, uint256 amount);
    event LockExtended(uint256 indexed lockId, uint256 newVestingEnd);
    event LockTransferred(uint256 indexed lockId, address indexed from, address indexed to);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob   = makeAddr("bob");

        lpToken = new MockLP("VIBE/ETH LP", "VBLP");

        VibeLiquidityLocker impl = new VibeLiquidityLocker();
        bytes memory initData = abi.encodeCall(VibeLiquidityLocker.initialize, (LOCK_FEE));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        locker = VibeLiquidityLocker(address(proxy));

        // Mint LP tokens and approve
        lpToken.mint(alice, 1_000_000 ether);
        lpToken.mint(bob,   1_000_000 ether);

        vm.prank(alice);
        lpToken.approve(address(locker), type(uint256).max);

        vm.prank(bob);
        lpToken.approve(address(locker), type(uint256).max);

        // Fund test accounts with ETH for fees
        vm.deal(alice, 10 ether);
        vm.deal(bob,   10 ether);
    }

    // ============ Helpers ============

    function _lock(address user, uint256 amount, uint256 cliff, uint256 vesting)
        internal returns (uint256)
    {
        vm.prank(user);
        return locker.lockLiquidity{value: LOCK_FEE}(address(lpToken), amount, cliff, vesting);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(locker.owner(), owner);
    }

    function test_initialize_setsLockFee() public view {
        assertEq(locker.lockFee(), LOCK_FEE);
    }

    function test_initialize_lockCountZero() public view {
        assertEq(locker.getLockCount(), 0);
    }

    // ============ Lock Creation ============

    function test_lock_incrementsCount() public {
        _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);
        assertEq(locker.getLockCount(), 1);
    }

    function test_lock_transfersTokens() public {
        uint256 aliceBefore = lpToken.balanceOf(alice);
        _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        assertEq(lpToken.balanceOf(alice),          aliceBefore - 1000 ether);
        assertEq(lpToken.balanceOf(address(locker)), 1000 ether);
    }

    function test_lock_storesTotalLocked() public {
        _lock(alice, 500 ether, CLIFF_1W, VESTING_4W);
        _lock(bob,   300 ether, CLIFF_1W, VESTING_4W);

        assertEq(locker.getTotalLocked(address(lpToken)), 800 ether);
    }

    function test_lock_emitsEvent() public {
        uint256 cliffEnd   = block.timestamp + CLIFF_1W;
        uint256 vestingEnd = cliffEnd + VESTING_4W;

        vm.expectEmit(true, true, false, true);
        emit LiquidityLocked(1, alice, address(lpToken), 1000 ether, cliffEnd, vestingEnd);

        vm.prank(alice);
        locker.lockLiquidity{value: LOCK_FEE}(address(lpToken), 1000 ether, CLIFF_1W, VESTING_4W);
    }

    function test_lock_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Zero amount");
        locker.lockLiquidity{value: LOCK_FEE}(address(lpToken), 0, CLIFF_1W, VESTING_4W);
    }

    function test_lock_zeroCliff_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Zero cliff");
        locker.lockLiquidity{value: LOCK_FEE}(address(lpToken), 1000 ether, 0, VESTING_4W);
    }

    function test_lock_insufficientFee_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient fee");
        locker.lockLiquidity{value: LOCK_FEE - 1}(address(lpToken), 1000 ether, CLIFF_1W, VESTING_4W);
    }

    function test_lock_refundsExcessFee() public {
        uint256 aliceETHBefore = alice.balance;
        uint256 excess = 0.5 ether;

        vm.prank(alice);
        locker.lockLiquidity{value: LOCK_FEE + excess}(
            address(lpToken), 1000 ether, CLIFF_1W, VESTING_4W
        );

        // Alice paid exactly LOCK_FEE, got back the excess
        assertEq(alice.balance, aliceETHBefore - LOCK_FEE);
    }

    function test_lock_indexedByOwner() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        uint256[] memory aliceLocks = locker.getOwnerLocks(alice);
        assertEq(aliceLocks.length, 1);
        assertEq(aliceLocks[0], lockId);
    }

    function test_lock_indexedByToken() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        uint256[] memory tokenLocks = locker.getTokenLocks(address(lpToken));
        assertEq(tokenLocks.length, 1);
        assertEq(tokenLocks[0], lockId);
    }

    function test_lock_collectsFee() public {
        _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);
        _lock(bob,   500 ether,  CLIFF_1W, VESTING_4W);

        assertEq(locker.totalFees(), LOCK_FEE * 2);
    }

    // ============ Cliff Enforcement ============

    function test_claimVested_beforeCliff_reverts() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.prank(alice);
        vm.expectRevert("Cliff not passed");
        locker.claimVested(lockId);
    }

    function test_claimVested_atCliffStart_claimable() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        // Exactly at cliff end — 0 elapsed vesting, nothing claimable yet
        vm.warp(block.timestamp + CLIFF_1W);

        uint256 claimable = locker.getClaimable(lockId);
        assertEq(claimable, 0); // 0 elapsed past cliff, 0 vested
    }

    function test_claimVested_linearVesting_midpoint() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        // Warp to cliff + half of vesting period
        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W / 2);

        uint256 claimable = locker.getClaimable(lockId);
        // Should be ~50% of 1000 ether
        assertApproxEqAbs(claimable, 500 ether, 1e15);
    }

    function test_claimVested_fullyVested() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);

        uint256 claimable = locker.getClaimable(lockId);
        assertEq(claimable, 1000 ether);
    }

    function test_claimVested_transfersTokens() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);

        uint256 aliceBefore = lpToken.balanceOf(alice);
        vm.prank(alice);
        locker.claimVested(lockId);

        assertEq(lpToken.balanceOf(alice), aliceBefore + 1000 ether);
    }

    function test_claimVested_reducesTotalLocked() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);
        vm.prank(alice);
        locker.claimVested(lockId);

        assertEq(locker.getTotalLocked(address(lpToken)), 0);
    }

    function test_claimVested_emitsEvent() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);

        vm.expectEmit(true, false, false, false);
        emit LiquidityClaimed(lockId, 0);

        vm.prank(alice);
        locker.claimVested(lockId);
    }

    function test_claimVested_notOwner_reverts() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);

        vm.prank(bob);
        vm.expectRevert("Not owner");
        locker.claimVested(lockId);
    }

    function test_claimVested_nothingToClaim_reverts() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        // Already past cliff but no time elapsed in vesting
        vm.warp(block.timestamp + CLIFF_1W);

        vm.prank(alice);
        vm.expectRevert("Nothing to claim");
        locker.claimVested(lockId);
    }

    function test_claimVested_deactivatesWhenFullyClaimed() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);
        vm.prank(alice);
        locker.claimVested(lockId);

        (, , , , , , , , bool active) = locker.locks(lockId);
        assertFalse(active);
    }

    function test_claimVested_incrementalClaims() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        // Claim at 25% through vesting
        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W / 4);
        vm.prank(alice);
        locker.claimVested(lockId);

        uint256 firstClaim = 1000 ether - lpToken.balanceOf(alice) + 1_000_000 ether;
        // firstClaim should be ~250 ether
        assertApproxEqAbs(firstClaim, 250 ether, 1e15);

        // Warp to 75% through vesting and claim again
        vm.warp(block.timestamp + VESTING_4W / 2);
        uint256 aliceBefore = lpToken.balanceOf(alice);
        vm.prank(alice);
        locker.claimVested(lockId);
        uint256 secondClaim = lpToken.balanceOf(alice) - aliceBefore;
        // Should be another ~50% ≈ 500 ether
        assertApproxEqAbs(secondClaim, 500 ether, 1e15);
    }

    // ============ Extend Lock ============

    function test_extendLock_updatesVestingEnd() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        (,,,,,  uint256 currentVestingEnd, , ) = locker.locks(lockId);
        uint256 newVestingEnd = currentVestingEnd + 30 days;

        vm.prank(alice);
        locker.extendLock(lockId, newVestingEnd);

        (, , , , , uint256 updatedEnd, , ) = locker.locks(lockId);
        assertEq(updatedEnd, newVestingEnd);
    }

    function test_extendLock_emitsEvent() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        (,,,,, uint256 currentVestingEnd,,) = locker.locks(lockId);
        uint256 newVestingEnd = currentVestingEnd + 30 days;

        vm.expectEmit(true, false, false, true);
        emit LockExtended(lockId, newVestingEnd);

        vm.prank(alice);
        locker.extendLock(lockId, newVestingEnd);
    }

    function test_extendLock_cannotShorten_reverts() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        (,,,,, uint256 currentVestingEnd,,) = locker.locks(lockId);

        vm.prank(alice);
        vm.expectRevert("Must extend");
        locker.extendLock(lockId, currentVestingEnd - 1);
    }

    function test_extendLock_notOwner_reverts() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        (,,,,, uint256 currentVestingEnd,,) = locker.locks(lockId);

        vm.prank(bob);
        vm.expectRevert("Not owner");
        locker.extendLock(lockId, currentVestingEnd + 1 days);
    }

    // ============ Transfer Lock ============

    function test_transferLock_updatesOwner() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.prank(alice);
        locker.transferLock(lockId, bob);

        (, address newOwner, , , , , , ) = locker.locks(lockId);
        assertEq(newOwner, bob);
    }

    function test_transferLock_bobCanClaim() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.prank(alice);
        locker.transferLock(lockId, bob);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);

        uint256 bobBefore = lpToken.balanceOf(bob);
        vm.prank(bob);
        locker.claimVested(lockId);
        assertEq(lpToken.balanceOf(bob), bobBefore + 1000 ether);
    }

    function test_transferLock_emitsEvent() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.expectEmit(true, true, true, false);
        emit LockTransferred(lockId, alice, bob);

        vm.prank(alice);
        locker.transferLock(lockId, bob);
    }

    function test_transferLock_toZeroAddress_reverts() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.prank(alice);
        vm.expectRevert("Zero address");
        locker.transferLock(lockId, address(0));
    }

    function test_transferLock_notOwner_reverts() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.prank(bob);
        vm.expectRevert("Not owner");
        locker.transferLock(lockId, bob);
    }

    function test_transferLock_addedToBobLocks() public {
        uint256 lockId = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.prank(alice);
        locker.transferLock(lockId, bob);

        uint256[] memory bobLocks = locker.getOwnerLocks(bob);
        assertEq(bobLocks.length, 1);
        assertEq(bobLocks[0], lockId);
    }

    // ============ Admin ============

    function test_setLockFee_updatesState() public {
        locker.setLockFee(0.05 ether);
        assertEq(locker.lockFee(), 0.05 ether);
    }

    function test_setLockFee_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        locker.setLockFee(0.05 ether);
    }

    function test_withdrawFees_transfersETH() public {
        _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);
        _lock(bob,   500 ether,  CLIFF_1W, VESTING_4W);

        uint256 ownerBefore = owner.balance;
        locker.withdrawFees();

        assertEq(owner.balance, ownerBefore + LOCK_FEE * 2);
        assertEq(address(locker).balance, 0);
    }

    function test_withdrawFees_noFees_reverts() public {
        vm.expectRevert("No fees");
        locker.withdrawFees();
    }

    function test_withdrawFees_notOwner_reverts() public {
        _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);

        vm.prank(alice);
        vm.expectRevert();
        locker.withdrawFees();
    }

    // ============ Multiple Locks ============

    function test_multipleLocks_independent() public {
        uint256 lockId1 = _lock(alice, 1000 ether, CLIFF_1W, VESTING_4W);
        uint256 lockId2 = _lock(alice, 500 ether,  CLIFF_1W, VESTING_4W * 2);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);

        // Lock 1 fully vested, lock 2 only half vested
        assertEq(locker.getClaimable(lockId1), 1000 ether);
        assertApproxEqAbs(locker.getClaimable(lockId2), 250 ether, 1e15);
    }

    // ============ Fuzz ============

    function testFuzz_lockAndClaimFull(uint96 amount) public {
        vm.assume(amount > 0 && amount <= 1_000_000 ether);

        uint256 lockId = _lock(alice, uint256(amount), CLIFF_1W, VESTING_4W);

        vm.warp(block.timestamp + CLIFF_1W + VESTING_4W);

        uint256 aliceBefore = lpToken.balanceOf(alice);
        vm.prank(alice);
        locker.claimVested(lockId);

        assertEq(lpToken.balanceOf(alice), aliceBefore + uint256(amount));
        assertEq(locker.getTotalLocked(address(lpToken)), 0);
    }
}
