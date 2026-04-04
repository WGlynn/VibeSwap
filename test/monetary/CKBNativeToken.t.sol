// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract CKBNativeTokenTest is Test {
    CKBNativeToken public ckb;
    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address locker = makeAddr("locker");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");

    function setUp() public {
        CKBNativeToken impl = new CKBNativeToken();
        bytes memory data = abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), data);
        ckb = CKBNativeToken(address(proxy));

        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        ckb.setLocker(locker, true);
        vm.stopPrank();
    }

    // ============ Initialization ============

    function test_zeroInitialSupply() public view {
        assertEq(ckb.totalSupply(), 0);
        assertEq(ckb.totalMinted(), 0);
        assertEq(ckb.totalOccupied(), 0);
    }

    function test_nameAndSymbol() public view {
        assertEq(ckb.name(), "CKB Native");
        assertEq(ckb.symbol(), "CKBn");
    }

    // ============ Minting ============

    function test_authorizedMinterCanMint() public {
        vm.prank(minter);
        ckb.mint(user1, 1000e18);

        assertEq(ckb.balanceOf(user1), 1000e18);
        assertEq(ckb.totalMinted(), 1000e18);
    }

    function test_unauthorizedCannotMint() public {
        vm.prank(user1);
        vm.expectRevert(CKBNativeToken.Unauthorized.selector);
        ckb.mint(user1, 1000e18);
    }

    function test_noHardCap() public {
        // CKB-native has no hard cap — can mint unlimited
        vm.startPrank(minter);
        ckb.mint(user1, 1_000_000_000e18);
        ckb.mint(user1, 1_000_000_000e18);
        vm.stopPrank();

        assertEq(ckb.totalMinted(), 2_000_000_000e18);
    }

    // ============ Burning ============

    function test_userCanBurnOwnTokens() public {
        vm.prank(minter);
        ckb.mint(user1, 1000e18);

        vm.prank(user1);
        ckb.burn(400e18);

        assertEq(ckb.balanceOf(user1), 600e18);
        assertEq(ckb.totalBurned(), 400e18);
    }

    function test_burnFromWithAllowance() public {
        vm.prank(minter);
        ckb.mint(user1, 1000e18);

        vm.prank(user1);
        ckb.approve(user2, 500e18);

        vm.prank(user2);
        ckb.burnFrom(user1, 500e18);

        assertEq(ckb.balanceOf(user1), 500e18);
        assertEq(ckb.totalBurned(), 500e18);
    }

    // ============ Lock/Unlock (State Rent) ============

    function test_lockReducesCirculatingSupply() public {
        vm.prank(minter);
        ckb.mint(user1, 1000e18);

        // User approves locker
        vm.prank(user1);
        ckb.approve(locker, 1000e18);

        // Locker locks tokens for state
        vm.prank(locker);
        ckb.lock(user1, 400e18);

        assertEq(ckb.totalSupply(), 1000e18, "totalSupply unchanged");
        assertEq(ckb.totalOccupied(), 400e18);
        assertEq(ckb.circulatingSupply(), 600e18);
        assertEq(ckb.balanceOf(user1), 600e18);
    }

    function test_unlockReturnsTokens() public {
        vm.prank(minter);
        ckb.mint(user1, 1000e18);

        vm.prank(user1);
        ckb.approve(locker, 1000e18);

        vm.prank(locker);
        ckb.lock(user1, 400e18);

        vm.prank(locker);
        ckb.unlock(user1, 400e18);

        assertEq(ckb.totalOccupied(), 0);
        assertEq(ckb.circulatingSupply(), 1000e18);
        assertEq(ckb.balanceOf(user1), 1000e18);
    }

    function test_unauthorizedCannotLock() public {
        vm.prank(minter);
        ckb.mint(user1, 1000e18);

        vm.prank(user1);
        vm.expectRevert(CKBNativeToken.Unauthorized.selector);
        ckb.lock(user1, 400e18);
    }

    function test_unauthorizedCannotUnlock() public {
        vm.prank(user1);
        vm.expectRevert(CKBNativeToken.Unauthorized.selector);
        ckb.unlock(user1, 400e18);
    }

    function test_cannotUnlockMoreThanOccupied() public {
        vm.prank(minter);
        ckb.mint(user1, 1000e18);

        vm.prank(user1);
        ckb.approve(locker, 1000e18);

        vm.prank(locker);
        ckb.lock(user1, 400e18);

        vm.prank(locker);
        vm.expectRevert(CKBNativeToken.InsufficientLockedBalance.selector);
        ckb.unlock(user1, 500e18);
    }

    // ============ Circulating Supply Math ============

    function test_circulatingSupplyAccountsForLocksAndBurns() public {
        vm.prank(minter);
        ckb.mint(user1, 1000e18);

        // Lock 300
        vm.prank(user1);
        ckb.approve(locker, 300e18);
        vm.prank(locker);
        ckb.lock(user1, 300e18);

        // Burn 200
        vm.prank(user1);
        ckb.burn(200e18);

        // totalSupply = 1000 - 200 = 800
        // totalOccupied = 300
        // circulatingSupply = 800 - 300 = 500
        assertEq(ckb.totalSupply(), 800e18);
        assertEq(ckb.circulatingSupply(), 500e18);
    }

    // ============ Admin ============

    function test_onlyOwnerCanSetMinter() public {
        vm.prank(user1);
        vm.expectRevert();
        ckb.setMinter(user2, true);
    }

    function test_onlyOwnerCanSetLocker() public {
        vm.prank(user1);
        vm.expectRevert();
        ckb.setLocker(user2, true);
    }

    // ============ Fuzz ============

    function testFuzz_lockUnlockConservation(uint256 mintAmount, uint256 lockAmount) public {
        mintAmount = bound(mintAmount, 1, 1e30);
        lockAmount = bound(lockAmount, 1, mintAmount);

        vm.prank(minter);
        ckb.mint(user1, mintAmount);

        vm.prank(user1);
        ckb.approve(locker, lockAmount);

        vm.prank(locker);
        ckb.lock(user1, lockAmount);

        assertEq(ckb.totalSupply(), mintAmount);
        assertEq(ckb.circulatingSupply(), mintAmount - lockAmount);

        vm.prank(locker);
        ckb.unlock(user1, lockAmount);

        assertEq(ckb.circulatingSupply(), mintAmount);
        assertEq(ckb.totalOccupied(), 0);
    }
}
