// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/intent-markets/CreatorLiquidityLock.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 1_000_000e18);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CreatorLiquidityLockTest is Test {
    CreatorLiquidityLock public lock;
    MockERC20 public token;

    address public creator = makeAddr("creator");
    address public slasher = makeAddr("slasher");
    address public lpPool = makeAddr("lpPool");

    uint64 constant MIN_DURATION = 30 days;
    uint64 constant MAX_DURATION = 365 days;
    uint256 constant MIN_AMOUNT = 0.01 ether;

    function setUp() public {
        CreatorLiquidityLock impl = new CreatorLiquidityLock();
        bytes memory initData = abi.encodeCall(
            CreatorLiquidityLock.initialize,
            (lpPool, MIN_DURATION, MAX_DURATION, MIN_AMOUNT)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        lock = CreatorLiquidityLock(payable(address(proxy)));

        lock.authorizeSlasher(slasher);

        token = new MockERC20();
        token.mint(creator, 100e18);

        vm.deal(creator, 10 ether);
    }

    // ============ ETH Locks ============

    function test_lock_ETH_happyPath() public {
        vm.prank(creator);
        uint256 lockId = lock.lock{value: 1 ether}(creator, address(0), 1 ether, MIN_DURATION, 1);

        assertEq(lockId, 1);
        assertTrue(lock.isLocked(lockId));

        ICreatorLiquidityLock.LiquidityLock memory lk = lock.getLock(lockId);
        assertEq(lk.creator, creator);
        assertEq(lk.token, address(0));
        assertEq(lk.amount, 1 ether);
        assertEq(lk.lockDuration, MIN_DURATION);
        assertFalse(lk.slashed);
        assertFalse(lk.withdrawn);
    }

    function test_withdraw_ETH_afterDuration() public {
        vm.prank(creator);
        uint256 lockId = lock.lock{value: 1 ether}(creator, address(0), 1 ether, MIN_DURATION, 1);

        // Warp past lock duration
        vm.warp(block.timestamp + MIN_DURATION + 1);

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        lock.withdraw(lockId);

        assertEq(creator.balance - balBefore, 1 ether);
        assertFalse(lock.isLocked(lockId));
    }

    function test_withdraw_beforeDuration_reverts() public {
        vm.prank(creator);
        uint256 lockId = lock.lock{value: 1 ether}(creator, address(0), 1 ether, MIN_DURATION, 1);

        vm.prank(creator);
        vm.expectRevert(ICreatorLiquidityLock.LockNotExpired.selector);
        lock.withdraw(lockId);
    }

    function test_slash_sendsToLPPool() public {
        vm.prank(creator);
        uint256 lockId = lock.lock{value: 1 ether}(creator, address(0), 1 ether, MIN_DURATION, 1);

        uint256 lpBefore = lpPool.balance;
        vm.prank(slasher);
        lock.slash(lockId);

        // 50% of 1 ether = 0.5 ether to LP pool
        assertEq(lpPool.balance - lpBefore, 0.5 ether);

        ICreatorLiquidityLock.LiquidityLock memory lk = lock.getLock(lockId);
        assertTrue(lk.slashed);
    }

    function test_withdraw_afterSlash_reverts() public {
        vm.prank(creator);
        uint256 lockId = lock.lock{value: 1 ether}(creator, address(0), 1 ether, MIN_DURATION, 1);

        vm.prank(slasher);
        lock.slash(lockId);

        vm.warp(block.timestamp + MIN_DURATION + 1);
        vm.prank(creator);
        vm.expectRevert(ICreatorLiquidityLock.AlreadySlashed.selector);
        lock.withdraw(lockId);
    }

    // ============ ERC20 Locks ============

    function test_lock_ERC20_happyPath() public {
        vm.startPrank(creator);
        token.approve(address(lock), 10e18);
        uint256 lockId = lock.lock(creator, address(token), 10e18, MIN_DURATION, 2);
        vm.stopPrank();

        assertEq(lockId, 1);
        assertTrue(lock.isLocked(lockId));
        assertEq(token.balanceOf(address(lock)), 10e18);
    }

    function test_slash_ERC20_sendsToLPPool() public {
        vm.startPrank(creator);
        token.approve(address(lock), 10e18);
        uint256 lockId = lock.lock(creator, address(token), 10e18, MIN_DURATION, 2);
        vm.stopPrank();

        vm.prank(slasher);
        lock.slash(lockId);

        // 50% of 10e18 = 5e18 to LP pool
        assertEq(token.balanceOf(lpPool), 5e18);
    }

    // ============ Duration Enforcement ============

    function test_durationTooShort_reverts() public {
        vm.prank(creator);
        vm.expectRevert(ICreatorLiquidityLock.DurationTooShort.selector);
        lock.lock{value: 1 ether}(creator, address(0), 1 ether, 1 days, 1);
    }

    function test_durationTooLong_reverts() public {
        vm.prank(creator);
        vm.expectRevert(ICreatorLiquidityLock.DurationTooLong.selector);
        lock.lock{value: 1 ether}(creator, address(0), 1 ether, 400 days, 1);
    }

    // ============ Access Control ============

    function test_slash_unauthorizedReverts() public {
        vm.prank(creator);
        uint256 lockId = lock.lock{value: 1 ether}(creator, address(0), 1 ether, MIN_DURATION, 1);

        vm.prank(creator); // not an authorized slasher
        vm.expectRevert(ICreatorLiquidityLock.NotAuthorizedSlasher.selector);
        lock.slash(lockId);
    }

    function test_withdraw_notCreator_reverts() public {
        vm.prank(creator);
        uint256 lockId = lock.lock{value: 1 ether}(creator, address(0), 1 ether, MIN_DURATION, 1);

        vm.warp(block.timestamp + MIN_DURATION + 1);
        vm.prank(slasher); // not the creator
        vm.expectRevert(ICreatorLiquidityLock.NotLockCreator.selector);
        lock.withdraw(lockId);
    }
}
