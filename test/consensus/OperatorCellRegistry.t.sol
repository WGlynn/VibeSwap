// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/OperatorCellRegistry.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev C30 test double. Lets tests mark cellIds active/inactive without
///      deploying a full StateRentVault. Mirrors IStateRentVaultForCellRegistry.
contract MockCellVault is IStateRentVaultForCellRegistry {
    mapping(bytes32 => bool) public activeCells;

    function setActive(bytes32 cellId, bool active) external {
        activeCells[cellId] = active;
    }

    function getCell(bytes32 cellId) external view returns (Cell memory) {
        return Cell({
            owner: address(0),
            capacity: 0,
            contentHash: bytes32(0),
            createdAt: 0,
            active: activeCells[cellId]
        });
    }
}

contract OperatorCellRegistryTest is Test {
    OperatorCellRegistry public registry;
    CKBNativeToken public ckb;
    MockCellVault public vault;

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address op1 = makeAddr("op1");
    address op2 = makeAddr("op2");

    bytes32 cell1 = keccak256("cell1");
    bytes32 cell2 = keccak256("cell2");
    bytes32 cell3 = keccak256("cell3");

    uint256 constant BOND = 10e18;

    event CellClaimed(bytes32 indexed cellId, address indexed operator, uint256 bond);
    event CellRelinquished(bytes32 indexed cellId, address indexed operator, uint256 bondReturned);
    event CellAssignmentSlashed(bytes32 indexed cellId, address indexed operator, uint256 bondSlashed);
    event SlashPoolSwept(address indexed destination, uint256 amount);

    function setUp() public {
        // CKB
        CKBNativeToken ckbImpl = new CKBNativeToken();
        ERC1967Proxy ckbProxy = new ERC1967Proxy(
            address(ckbImpl),
            abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner)
        );
        ckb = CKBNativeToken(address(ckbProxy));

        vault = new MockCellVault();

        OperatorCellRegistry impl = new OperatorCellRegistry();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                OperatorCellRegistry.initialize.selector,
                address(ckb),
                address(vault),
                BOND,
                owner
            )
        );
        registry = OperatorCellRegistry(payable(address(proxy)));

        // Fund operators with CKB
        vm.prank(owner);
        ckb.setMinter(minter, true);

        vm.startPrank(minter);
        ckb.mint(op1, 10_000e18);
        ckb.mint(op2, 10_000e18);
        vm.stopPrank();

        vm.prank(op1);
        ckb.approve(address(registry), type(uint256).max);
        vm.prank(op2);
        ckb.approve(address(registry), type(uint256).max);
    }

    // ============ Claim ============

    function test_C30_ClaimCell_HappyPath() public {
        vault.setActive(cell1, true);
        uint256 bal0 = ckb.balanceOf(op1);

        vm.expectEmit(true, true, false, true);
        emit CellClaimed(cell1, op1, BOND);

        vm.prank(op1);
        registry.claimCell(cell1);

        OperatorCellRegistry.Assignment memory a = registry.getAssignment(cell1);
        assertEq(a.operator, op1);
        assertEq(a.bond, BOND);
        assertTrue(a.active);
        assertEq(registry.totalBondsLocked(), BOND);
        assertEq(ckb.balanceOf(op1), bal0 - BOND);
        assertEq(ckb.balanceOf(address(registry)), BOND);
        assertTrue(registry.isAssigned(cell1, op1));
    }

    function test_C30_ClaimCell_RevertsIfInactive() public {
        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.InactiveCell.selector);
        registry.claimCell(cell1);
    }

    function test_C30_ClaimCell_RevertsIfVaultUnset() public {
        vm.prank(owner);
        registry.setStateRentVault(address(0));

        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.VaultNotSet.selector);
        registry.claimCell(cell1);
    }

    function test_C30_ClaimCell_RevertsIfAlreadyClaimed() public {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);

        vm.prank(op2);
        vm.expectRevert(OperatorCellRegistry.AlreadyClaimed.selector);
        registry.claimCell(cell1);
    }

    // ============ Relinquish ============

    function test_C30_RelinquishCell_ReturnsBond() public {
        vault.setActive(cell1, true);
        uint256 bal0 = ckb.balanceOf(op1);

        vm.startPrank(op1);
        registry.claimCell(cell1);
        registry.relinquishCell(cell1);
        vm.stopPrank();

        assertEq(ckb.balanceOf(op1), bal0, "bond returned in full");
        assertFalse(registry.isAssigned(cell1, op1));
        assertEq(registry.totalBondsLocked(), 0);
        assertEq(registry.operatorCellCount(op1), 0);
    }

    function test_C30_RelinquishCell_RevertsIfNotAssigned() public {
        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.NotAssigned.selector);
        registry.relinquishCell(cell1);
    }

    function test_C30_RelinquishCell_RevertsIfNotOperator() public {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);

        vm.prank(op2);
        vm.expectRevert(OperatorCellRegistry.NotOperator.selector);
        registry.relinquishCell(cell1);
    }

    function test_C30_ReClaimAfterRelinquish() public {
        vault.setActive(cell1, true);
        vm.startPrank(op1);
        registry.claimCell(cell1);
        registry.relinquishCell(cell1);
        registry.claimCell(cell1);
        vm.stopPrank();

        assertTrue(registry.isAssigned(cell1, op1));
    }

    // ============ Slash ============

    function test_C30_SlashAssignment_OnlyOwner() public {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);

        vm.prank(op2);
        vm.expectRevert();
        registry.slashAssignment(cell1);
    }

    function test_C30_SlashAssignment_AccumulatesToSlashPool() public {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);

        vm.expectEmit(true, true, false, true);
        emit CellAssignmentSlashed(cell1, op1, BOND);

        vm.prank(owner);
        registry.slashAssignment(cell1);

        assertEq(registry.slashPool(), BOND);
        assertFalse(registry.isAssigned(cell1, op1));
        assertEq(registry.totalBondsLocked(), 0);
    }

    function test_C30_SlashAssignment_RevertsIfNotActive() public {
        vm.prank(owner);
        vm.expectRevert(OperatorCellRegistry.NotAssigned.selector);
        registry.slashAssignment(cell1);
    }

    // ============ Sweep ============

    function test_C30_Sweep_ToTreasury() public {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);
        vm.prank(owner);
        registry.slashAssignment(cell1);

        address treasury = makeAddr("treasury");
        vm.expectEmit(true, false, false, true);
        emit SlashPoolSwept(treasury, BOND);

        vm.prank(owner);
        registry.sweepSlashPoolToTreasury(treasury);

        assertEq(ckb.balanceOf(treasury), BOND);
        assertEq(registry.slashPool(), 0);
    }

    function test_C30_Sweep_RejectsZeroAddress() public {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);
        vm.prank(owner);
        registry.slashAssignment(cell1);

        vm.prank(owner);
        vm.expectRevert(OperatorCellRegistry.ZeroAddress.selector);
        registry.sweepSlashPoolToTreasury(address(0));
    }

    function test_C30_Sweep_RejectsEmptyPool() public {
        vm.prank(owner);
        vm.expectRevert(OperatorCellRegistry.EmptyPool.selector);
        registry.sweepSlashPoolToTreasury(makeAddr("treasury"));
    }

    function test_C30_Sweep_OnlyOwner() public {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);
        vm.prank(owner);
        registry.slashAssignment(cell1);

        vm.prank(op1);
        vm.expectRevert();
        registry.sweepSlashPoolToTreasury(makeAddr("treasury"));
    }

    function test_C30_Sweep_AccumulatesAcrossSlashes() public {
        vault.setActive(cell1, true);
        vault.setActive(cell2, true);

        vm.startPrank(op1);
        registry.claimCell(cell1);
        registry.claimCell(cell2);
        vm.stopPrank();

        vm.startPrank(owner);
        registry.slashAssignment(cell1);
        registry.slashAssignment(cell2);
        vm.stopPrank();

        assertEq(registry.slashPool(), BOND * 2);

        address treasury = makeAddr("treasury");
        vm.prank(owner);
        registry.sweepSlashPoolToTreasury(treasury);
        assertEq(ckb.balanceOf(treasury), BOND * 2);
    }

    // ============ Enumeration (Phantom Array discipline) ============

    function test_C30_OperatorCells_MultiClaim() public {
        vault.setActive(cell1, true);
        vault.setActive(cell2, true);
        vault.setActive(cell3, true);

        vm.startPrank(op1);
        registry.claimCell(cell1);
        registry.claimCell(cell2);
        registry.claimCell(cell3);
        vm.stopPrank();

        assertEq(registry.operatorCellCount(op1), 3);
        bytes32[] memory cells = registry.getOperatorCells(op1);
        assertEq(cells.length, 3);
    }

    function test_C30_SwapAndPop_PreservesSiblings() public {
        vault.setActive(cell1, true);
        vault.setActive(cell2, true);
        vault.setActive(cell3, true);

        vm.startPrank(op1);
        registry.claimCell(cell1);
        registry.claimCell(cell2);
        registry.claimCell(cell3);
        registry.relinquishCell(cell2);   // middle element
        vm.stopPrank();

        bytes32[] memory cells = registry.getOperatorCells(op1);
        assertEq(cells.length, 2);
        // Both cell1 and cell3 must still be present, order-independent
        bool sawCell1 = (cells[0] == cell1) || (cells[1] == cell1);
        bool sawCell3 = (cells[0] == cell3) || (cells[1] == cell3);
        assertTrue(sawCell1, "cell1 still present");
        assertTrue(sawCell3, "cell3 still present");
    }

    function test_C30_SwapAndPop_LastElement() public {
        vault.setActive(cell1, true);
        vault.setActive(cell2, true);

        vm.startPrank(op1);
        registry.claimCell(cell1);
        registry.claimCell(cell2);
        registry.relinquishCell(cell2);   // last element
        vm.stopPrank();

        bytes32[] memory cells = registry.getOperatorCells(op1);
        assertEq(cells.length, 1);
        assertEq(cells[0], cell1);
    }

    // ============ Admin ============

    function test_C30_SetBondPerCell() public {
        vm.prank(owner);
        registry.setBondPerCell(20e18);
        assertEq(registry.bondPerCell(), 20e18);
    }

    function test_C30_SetBondPerCell_OnlyOwner() public {
        vm.prank(op1);
        vm.expectRevert();
        registry.setBondPerCell(20e18);
    }

    function test_C30_ZeroBond_StillRegisters() public {
        vm.prank(owner);
        registry.setBondPerCell(0);

        vault.setActive(cell1, true);
        uint256 bal0 = ckb.balanceOf(op1);

        vm.prank(op1);
        registry.claimCell(cell1);

        assertTrue(registry.isAssigned(cell1, op1));
        assertEq(registry.totalBondsLocked(), 0);
        assertEq(ckb.balanceOf(op1), bal0, "no bond pulled at zero");
    }

    function test_C30_SetStateRentVault_OnlyOwner() public {
        vm.prank(op1);
        vm.expectRevert();
        registry.setStateRentVault(address(0));
    }

    // ============ Views ============

    function test_C30_IsAssigned_WrongOperator() public {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);

        assertTrue(registry.isAssigned(cell1, op1));
        assertFalse(registry.isAssigned(cell1, op2));
    }

    function test_C30_IsAssigned_UnclaimedCell() public view {
        assertFalse(registry.isAssigned(cell1, op1));
    }
}
