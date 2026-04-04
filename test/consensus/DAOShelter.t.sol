// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/DAOShelter.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract DAOShelterTest is Test {
    DAOShelter public shelter;
    CKBNativeToken public ckb;

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address controller = makeAddr("issuanceController");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");

    function setUp() public {
        // Deploy CKB-native
        CKBNativeToken ckbImpl = new CKBNativeToken();
        bytes memory ckbData = abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner);
        ERC1967Proxy ckbProxy = new ERC1967Proxy(address(ckbImpl), ckbData);
        ckb = CKBNativeToken(address(ckbProxy));

        // Deploy shelter
        DAOShelter shelterImpl = new DAOShelter();
        bytes memory shelterData = abi.encodeWithSelector(
            DAOShelter.initialize.selector, address(ckb), owner
        );
        ERC1967Proxy shelterProxy = new ERC1967Proxy(address(shelterImpl), shelterData);
        shelter = DAOShelter(address(shelterProxy));

        // Wire
        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        shelter.setIssuanceController(controller);
        vm.stopPrank();

        // Give users tokens
        vm.startPrank(minter);
        ckb.mint(user1, 10_000e18);
        ckb.mint(user2, 10_000e18);
        ckb.mint(controller, 100_000e18);
        vm.stopPrank();

        // Approve shelter
        vm.prank(user1);
        ckb.approve(address(shelter), type(uint256).max);
        vm.prank(user2);
        ckb.approve(address(shelter), type(uint256).max);
        vm.prank(controller);
        ckb.approve(address(shelter), type(uint256).max);
    }

    function test_deposit() public {
        vm.prank(user1);
        shelter.deposit(5000e18);

        assertEq(shelter.totalDeposited(), 5000e18);
        DAOShelter.DepositInfo memory info = shelter.getDepositInfo(user1);
        assertEq(info.amount, 5000e18);
    }

    function test_yieldAccumulation() public {
        // User1 deposits 5000
        vm.prank(user1);
        shelter.deposit(5000e18);

        // Controller deposits yield of 1000
        vm.prank(controller);
        shelter.depositYield(1000e18);

        // User1 should have 1000 pending
        assertEq(shelter.pendingYield(user1), 1000e18);
    }

    function test_yieldSplitProportionally() public {
        // User1 deposits 7500, user2 deposits 2500 (75/25 split)
        vm.prank(user1);
        shelter.deposit(7500e18);
        vm.prank(user2);
        shelter.deposit(2500e18);

        // 1000 yield deposited
        vm.prank(controller);
        shelter.depositYield(1000e18);

        assertEq(shelter.pendingYield(user1), 750e18);
        assertEq(shelter.pendingYield(user2), 250e18);
    }

    function test_claimYield() public {
        vm.prank(user1);
        shelter.deposit(5000e18);

        vm.prank(controller);
        shelter.depositYield(1000e18);

        uint256 balBefore = ckb.balanceOf(user1);

        vm.prank(user1);
        shelter.claimYield();

        assertEq(ckb.balanceOf(user1), balBefore + 1000e18);
        assertEq(shelter.pendingYield(user1), 0);
    }

    function test_withdrawalTimelock() public {
        vm.prank(user1);
        shelter.deposit(5000e18);

        vm.prank(user1);
        shelter.requestWithdrawal(3000e18);

        // Cannot withdraw immediately
        vm.prank(user1);
        vm.expectRevert(DAOShelter.WithdrawalLocked.selector);
        shelter.completeWithdrawal();

        // Advance past timelock
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(user1);
        shelter.completeWithdrawal();

        DAOShelter.DepositInfo memory info = shelter.getDepositInfo(user1);
        assertEq(info.amount, 2000e18);
        assertEq(info.pendingWithdrawal, 0);
    }

    function test_cannotWithdrawMoreThanDeposited() public {
        vm.prank(user1);
        shelter.deposit(1000e18);

        vm.prank(user1);
        vm.expectRevert(DAOShelter.InsufficientDeposit.selector);
        shelter.requestWithdrawal(2000e18);
    }

    function test_unauthorizedCannotDepositYield() public {
        vm.prank(user1);
        shelter.deposit(1000e18);

        vm.prank(user1);
        vm.expectRevert(DAOShelter.Unauthorized.selector);
        shelter.depositYield(100e18);
    }

    function test_yieldClaimedOnDeposit() public {
        vm.prank(user1);
        shelter.deposit(5000e18);

        vm.prank(controller);
        shelter.depositYield(1000e18);

        // Second deposit should auto-claim
        uint256 balBefore = ckb.balanceOf(user1);

        vm.prank(user1);
        shelter.deposit(1000e18);

        // Should have received 1000 yield, spent 1000 deposit = net 0
        assertEq(ckb.balanceOf(user1), balBefore + 1000e18 - 1000e18);
        assertEq(shelter.pendingYield(user1), 0);
    }
}
