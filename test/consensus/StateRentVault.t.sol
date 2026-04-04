// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/StateRentVault.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract StateRentVaultTest is Test {
    StateRentVault public vault;
    CKBNativeToken public ckb;

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address manager = makeAddr("cellManager");
    address user1 = makeAddr("user1");

    function setUp() public {
        // Deploy CKB-native
        CKBNativeToken ckbImpl = new CKBNativeToken();
        bytes memory ckbData = abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner);
        ERC1967Proxy ckbProxy = new ERC1967Proxy(address(ckbImpl), ckbData);
        ckb = CKBNativeToken(address(ckbProxy));

        // Deploy vault
        StateRentVault vaultImpl = new StateRentVault();
        bytes memory vaultData = abi.encodeWithSelector(
            StateRentVault.initialize.selector, address(ckb), owner
        );
        ERC1967Proxy vaultProxy = new ERC1967Proxy(address(vaultImpl), vaultData);
        vault = StateRentVault(address(vaultProxy));

        // Wire permissions
        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        ckb.setLocker(address(vault), true);
        vault.setCellManager(manager, true);
        vm.stopPrank();

        // Give manager tokens
        vm.prank(minter);
        ckb.mint(manager, 10_000e18);

        // Manager approves vault to spend on its behalf
        vm.prank(manager);
        ckb.approve(address(vault), type(uint256).max);
    }

    function test_createCell() public {
        bytes32 cellId = keccak256("cell-1");

        vm.prank(manager);
        vault.createCell(cellId, 500e18, keccak256("content"));

        StateRentVault.Cell memory cell = vault.getCell(cellId);
        assertEq(cell.owner, manager);
        assertEq(cell.capacity, 500e18);
        assertTrue(cell.active);
        assertEq(vault.activeCellCount(), 1);
        assertEq(ckb.totalOccupied(), 500e18);
        assertEq(ckb.circulatingSupply(), 9500e18);
    }

    function test_destroyCell() public {
        bytes32 cellId = keccak256("cell-1");

        vm.prank(manager);
        vault.createCell(cellId, 500e18, keccak256("content"));

        vm.prank(manager);
        vault.destroyCell(cellId);

        StateRentVault.Cell memory cell = vault.getCell(cellId);
        assertFalse(cell.active);
        assertEq(vault.activeCellCount(), 0);
        assertEq(ckb.totalOccupied(), 0);
        assertEq(ckb.balanceOf(manager), 10_000e18);
    }

    function test_cannotCreateDuplicateCell() public {
        bytes32 cellId = keccak256("cell-1");

        vm.prank(manager);
        vault.createCell(cellId, 500e18, keccak256("content"));

        vm.prank(manager);
        vm.expectRevert(StateRentVault.CellAlreadyExists.selector);
        vault.createCell(cellId, 500e18, keccak256("content2"));
    }

    function test_unauthorizedCannotCreateCell() public {
        vm.prank(user1);
        vm.expectRevert(StateRentVault.Unauthorized.selector);
        vault.createCell(keccak256("cell"), 100e18, keccak256("c"));
    }

    function test_cannotDestroyInactiveCell() public {
        vm.prank(manager);
        vm.expectRevert(StateRentVault.CellNotFound.selector);
        vault.destroyCell(keccak256("nonexistent"));
    }

    function test_multipleCells() public {
        vm.startPrank(manager);
        vault.createCell(keccak256("a"), 100e18, keccak256("ca"));
        vault.createCell(keccak256("b"), 200e18, keccak256("cb"));
        vault.createCell(keccak256("c"), 300e18, keccak256("cc"));
        vm.stopPrank();

        assertEq(vault.activeCellCount(), 3);
        assertEq(ckb.totalOccupied(), 600e18);
        assertEq(vault.cellCount(manager), 3);

        vm.prank(manager);
        vault.destroyCell(keccak256("b"));

        assertEq(vault.activeCellCount(), 2);
        assertEq(ckb.totalOccupied(), 400e18);
    }

    function testFuzz_createDestroy(uint256 capacity) public {
        capacity = bound(capacity, 1, 10_000e18);
        bytes32 cellId = keccak256(abi.encodePacked("fuzz", capacity));

        uint256 balBefore = ckb.balanceOf(manager);

        vm.prank(manager);
        vault.createCell(cellId, capacity, keccak256("c"));

        assertEq(ckb.balanceOf(manager), balBefore - capacity);

        vm.prank(manager);
        vault.destroyCell(cellId);

        assertEq(ckb.balanceOf(manager), balBefore);
    }
}
