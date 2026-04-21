// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/OperatorCellRegistry.sol";
import "../../contracts/consensus/ContentMerkleRegistry.sol";
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

    // ============ C36-F1: bondPerCell floor (Sybil-resistance invariant) ============

    /// @notice C36-F1: zero bond would disable Sybil resistance. Setter rejects.
    ///         Supersedes the prior test_C30_ZeroBond_StillRegisters which
    ///         documented the vulnerable behavior.
    function test_C36F1_setBondPerCell_revertsAtZero() public {
        vm.prank(owner);
        vm.expectRevert(OperatorCellRegistry.BondBelowMin.selector);
        registry.setBondPerCell(0);
    }

    /// @notice C36-F1: anything below MIN_BOND_PER_CELL is rejected.
    function test_C36F1_setBondPerCell_revertsBelowMin() public {
        uint256 min = registry.MIN_BOND_PER_CELL();
        vm.prank(owner);
        vm.expectRevert(OperatorCellRegistry.BondBelowMin.selector);
        registry.setBondPerCell(min - 1);
    }

    /// @notice C36-F1: exactly MIN is accepted (boundary).
    function test_C36F1_setBondPerCell_acceptsAtMin() public {
        uint256 min = registry.MIN_BOND_PER_CELL();
        vm.prank(owner);
        registry.setBondPerCell(min);
        assertEq(registry.bondPerCell(), min);
    }

    /// @notice C36-F1: initialize enforces the same floor.
    function test_C36F1_initialize_revertsBelowMin() public {
        OperatorCellRegistry impl2 = new OperatorCellRegistry();
        vm.expectRevert(OperatorCellRegistry.BondBelowMin.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(
                OperatorCellRegistry.initialize.selector,
                address(ckb),
                address(vault),
                uint256(0), // zero bond at genesis
                owner
            )
        );
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

    // ============ C31: V2 Availability Challenge ============
    //
    // Permissionless challenge/respond/slash game. Calibration drawn from
    // augmented-mechanism-design.md — see OperatorCellRegistry.sol constants
    // block for citation. Tests verify happy paths, the 50/50/50% split math,
    // cooldown enforcement, and grief-resistance behaviors.

    /// @dev Helper: op1 claims cell1 under default conditions, returns the
    ///      assignment bond used. Simplifies most C31 tests.
    function _assignCell1ToOp1() internal returns (uint256 assignmentBond) {
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);
        return BOND;
    }

    // ---- challengeAssignment ----

    function test_C31_ChallengeAssignment_HappyPath() public {
        _assignCell1ToOp1();
        uint256 op2Before = ckb.balanceOf(op2);
        bytes32 nonce = keccak256("nonce-1");

        vm.prank(op2);
        registry.challengeAssignment(cell1, nonce);

        (bytes32 storedNonce, address challenger, uint256 cBond, uint256 deadline, uint256 lastFailedAt)
            = registry.assignmentChallenges(cell1);

        assertEq(storedNonce, nonce);
        assertEq(challenger, op2);
        assertEq(cBond, registry.ASSIGNMENT_CHALLENGE_BOND());
        assertEq(deadline, block.timestamp + registry.ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW());
        assertEq(lastFailedAt, 0);

        // Challenger paid the bond
        assertEq(ckb.balanceOf(op2), op2Before - registry.ASSIGNMENT_CHALLENGE_BOND());
    }

    function test_C31_ChallengeAssignment_RevertsIfNoAssignment() public {
        // cell1 not claimed
        vm.prank(op2);
        vm.expectRevert(OperatorCellRegistry.NotAssigned.selector);
        registry.challengeAssignment(cell1, keccak256("nonce"));
    }

    function test_C31_ChallengeAssignment_RevertsIfSelfChallenge() public {
        _assignCell1ToOp1();

        vm.prank(op1);  // same as assignment operator
        vm.expectRevert(OperatorCellRegistry.SelfChallenge.selector);
        registry.challengeAssignment(cell1, keccak256("nonce"));
    }

    function test_C31_ChallengeAssignment_RevertsIfAlreadyChallenged() public {
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("nonce-1"));

        address op3 = makeAddr("op3");
        vm.prank(minter);
        ckb.mint(op3, 1_000e18);
        vm.prank(op3);
        ckb.approve(address(registry), type(uint256).max);

        vm.prank(op3);
        vm.expectRevert(OperatorCellRegistry.ChallengeActive.selector);
        registry.challengeAssignment(cell1, keccak256("nonce-2"));
    }

    // ---- respondToAssignmentChallenge ----

    function test_C31_Respond_RefundsChallengerBondToOperator() public {
        _assignCell1ToOp1();
        bytes32 nonce = keccak256("n1");
        uint256 op1Before = ckb.balanceOf(op1);

        vm.prank(op2);
        registry.challengeAssignment(cell1, nonce);

        vm.prank(op1);
        registry.respondToAssignmentChallenge(cell1, nonce);

        // Challenger's bond flows to operator (SOR pattern: attentive-operator reward)
        assertEq(ckb.balanceOf(op1), op1Before + registry.ASSIGNMENT_CHALLENGE_BOND());

        // Challenge cleared, cooldown stamp set
        (, address challenger, , , uint256 lastFailedAt) = registry.assignmentChallenges(cell1);
        assertEq(challenger, address(0));
        assertEq(lastFailedAt, block.timestamp);
    }

    function test_C31_Respond_RevertsIfWrongOperator() public {
        _assignCell1ToOp1();
        bytes32 nonce = keccak256("n1");
        vm.prank(op2);
        registry.challengeAssignment(cell1, nonce);

        vm.prank(op2);  // op2 is challenger, not operator
        vm.expectRevert(OperatorCellRegistry.NotOperator.selector);
        registry.respondToAssignmentChallenge(cell1, nonce);
    }

    function test_C31_Respond_RevertsIfExpired() public {
        _assignCell1ToOp1();
        bytes32 nonce = keccak256("n1");
        vm.prank(op2);
        registry.challengeAssignment(cell1, nonce);

        vm.warp(block.timestamp + registry.ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW() + 1);

        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.ChallengeExpired.selector);
        registry.respondToAssignmentChallenge(cell1, nonce);
    }

    function test_C31_Respond_RevertsOnNonceMismatch() public {
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("correct"));

        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.NonceMismatch.selector);
        registry.respondToAssignmentChallenge(cell1, keccak256("wrong"));
    }

    // ---- claimAssignmentSlash ----

    function test_C31_ClaimSlash_RevertsIfNotExpired() public {
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));

        vm.expectRevert(OperatorCellRegistry.ChallengeNotExpired.selector);
        registry.claimAssignmentSlash(cell1);
    }

    function test_C31_ClaimSlash_RevertsIfNoChallenge() public {
        _assignCell1ToOp1();
        vm.expectRevert(OperatorCellRegistry.NoActiveChallenge.selector);
        registry.claimAssignmentSlash(cell1);
    }

    function test_C31_ClaimSlash_SplitMathCorrect() public {
        // Full split verification: 50% slashed, of which 50% → challenger, 50% → slashPool.
        // 50% remainder → pendingOperatorRefunds[operator].
        uint256 assignmentBond = _assignCell1ToOp1();  // = BOND
        uint256 challengeBond = registry.ASSIGNMENT_CHALLENGE_BOND();
        uint256 op2Before = ckb.balanceOf(op2);

        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));

        // Warp past deadline
        vm.warp(block.timestamp + registry.ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW() + 1);

        // Anyone can trigger — pick a random address
        address rando = makeAddr("rando");
        vm.prank(rando);
        registry.claimAssignmentSlash(cell1);

        uint256 expectedSlashed = (assignmentBond * registry.ASSIGNMENT_SLASH_BPS()) / 10_000;
        uint256 expectedRemainder = assignmentBond - expectedSlashed;
        uint256 expectedChallengerPayout = (expectedSlashed * registry.CHALLENGER_PAYOUT_BPS()) / 10_000;
        uint256 expectedSlashPoolAdd = expectedSlashed - expectedChallengerPayout;

        // slashPool received its half of the slashed portion
        assertEq(registry.slashPool(), expectedSlashPoolAdd, "slashPool += slashed/2");

        // Operator's 50% remainder queued in pull map
        assertEq(registry.pendingOperatorRefunds(op1), expectedRemainder, "op1 remainder queued");

        // Challenger received: their original challenge bond back + payout (50% of slashed)
        uint256 expectedChallengerReceived = challengeBond + expectedChallengerPayout;
        assertEq(
            ckb.balanceOf(op2),
            op2Before - challengeBond + expectedChallengerReceived,
            "challenger net: challenge bond refunded + payout reward"
        );

        // Assignment no longer active
        assertFalse(registry.isAssigned(cell1, op1));
        assertEq(registry.totalBondsLocked(), 0, "totalBondsLocked zeroed");
    }

    function test_C31_ClaimSlash_PermissionlessAnyoneCanCall() public {
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));
        vm.warp(block.timestamp + registry.ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW() + 1);

        // A completely unrelated EOA triggers the slash
        address poker = makeAddr("poker");
        vm.prank(poker);
        registry.claimAssignmentSlash(cell1);

        assertFalse(registry.isAssigned(cell1, op1));
        // Poker received nothing — only challenger is rewarded
        assertEq(ckb.balanceOf(poker), 0);
    }

    // ---- cooldown ----

    function test_C31_Cooldown_EnforcedAfterHonestRefute() public {
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));
        vm.prank(op1);
        registry.respondToAssignmentChallenge(cell1, keccak256("n1"));

        // Immediately try to re-challenge — cooldown blocks
        vm.prank(op2);
        vm.expectRevert(OperatorCellRegistry.CooldownActive.selector);
        registry.challengeAssignment(cell1, keccak256("n2"));
    }

    function test_C31_Cooldown_ExpiresAfterWindow() public {
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));
        vm.prank(op1);
        registry.respondToAssignmentChallenge(cell1, keccak256("n1"));

        vm.warp(block.timestamp + registry.PER_CELL_CHALLENGE_COOLDOWN() + 1);

        // Re-challenge now allowed
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n2"));

        (, address challenger, , , ) = registry.assignmentChallenges(cell1);
        assertEq(challenger, op2);
    }

    // ---- pull queue ----

    function test_C31_WithdrawPendingRefund_HappyPath() public {
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));
        vm.warp(block.timestamp + registry.ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW() + 1);
        registry.claimAssignmentSlash(cell1);

        uint256 queued = registry.pendingOperatorRefunds(op1);
        uint256 op1Before = ckb.balanceOf(op1);

        vm.prank(op1);
        registry.withdrawPendingRefund();

        assertEq(ckb.balanceOf(op1), op1Before + queued, "operator pulled remainder");
        assertEq(registry.pendingOperatorRefunds(op1), 0, "queue cleared");
    }

    function test_C31_WithdrawPendingRefund_RevertsIfZero() public {
        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.NothingToWithdraw.selector);
        registry.withdrawPendingRefund();
    }

    // ---- relinquish-under-challenge edge case ----

    function test_C31_Relinquish_RevertsWhileChallengeActive() public {
        // Operator cannot escape an active challenge by relinquishing — they
        // must respond or be slashed.
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));

        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.ChallengeActive.selector);
        registry.relinquishCell(cell1);
    }

    function test_C31_Relinquish_ClearsChallengeStateAfterExpiredChallengeRefutedLong_Ago() public {
        // If a challenge was honestly refuted and the cooldown has lapsed,
        // relinquish should still work (challenger slot is empty).
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));
        vm.prank(op1);
        registry.respondToAssignmentChallenge(cell1, keccak256("n1"));

        // Now relinquish — no active challenger, just a lastFailedAt stamp
        vm.prank(op1);
        registry.relinquishCell(cell1);

        // All challenge state wiped, including lastFailedAt — future claimants start fresh
        (, address challenger, , , uint256 lastFailedAt) = registry.assignmentChallenges(cell1);
        assertEq(challenger, address(0));
        assertEq(lastFailedAt, 0, "cooldown state cleaned on relinquish");
    }

    // ---- deprecated escape hatch still works + refunds active challenger ----

    function test_C31_DeprecatedAdminSlash_RefundsActiveChallenger() public {
        _assignCell1ToOp1();
        uint256 op2Before = ckb.balanceOf(op2);

        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));
        // op2 is now down one ASSIGNMENT_CHALLENGE_BOND

        // Admin pre-empts the challenge with the escape-hatch slash
        vm.prank(owner);
        registry.slashAssignment(cell1);

        // Active challenger gets their bond back (admin slash pre-empts, challenger was not wrong)
        assertEq(ckb.balanceOf(op2), op2Before, "challenger bond refunded on admin slash");

        // Challenge state wiped
        (, address challenger, , , ) = registry.assignmentChallenges(cell1);
        assertEq(challenger, address(0));

        // Assignment gone, slashPool has full BOND (admin slash is 100%)
        assertFalse(registry.isAssigned(cell1, op1));
        assertEq(registry.slashPool(), BOND);
    }

    // ---- integration: reclaim-after-slash starts with clean cooldown ----

    function test_C31_FutureClaimantInheritsNoCooldown() public {
        _assignCell1ToOp1();
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("n1"));
        vm.warp(block.timestamp + registry.ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW() + 1);
        registry.claimAssignmentSlash(cell1);

        // A new operator claims the freshly-slashed cell
        vm.prank(op2);
        registry.claimCell(cell1);

        // A third party tries to challenge the new assignment — should work,
        // no stale cooldown from the prior assignment
        address op3 = makeAddr("op3");
        vm.prank(minter);
        ckb.mint(op3, 1_000e18);
        vm.prank(op3);
        ckb.approve(address(registry), type(uint256).max);
        vm.prank(op3);
        registry.challengeAssignment(cell1, keccak256("n-fresh"));

        (, address challenger, , , ) = registry.assignmentChallenges(cell1);
        assertEq(challenger, op3);
    }

    // ============ C32: V2b Chunk-Availability Challenge ============
    //
    // End-to-end chunk-availability sampling. Tests build real Merkle trees
    // (OZ sorted-pair hashing), commit them in ContentMerkleRegistry, and
    // verify the challenge/respond/slash flow with actual proof verification.

    ContentMerkleRegistry public cmr;

    uint256 constant CHUNK_COUNT = 64;   // power of 2 for the test tree
    uint256 constant CHUNK_SIZE = 32;

    /// @dev Initialise V2b infrastructure: deploy ContentMerkleRegistry, wire
    ///      it into OCR. Called at the top of every V2b test that needs it.
    function _setupV2b() internal {
        ContentMerkleRegistry impl = new ContentMerkleRegistry();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                ContentMerkleRegistry.initialize.selector,
                address(vault),
                owner
            )
        );
        cmr = ContentMerkleRegistry(address(proxy));
        vm.prank(owner);
        registry.setContentRegistry(address(cmr));
    }

    /// @dev Sorted-pair hash matching OZ's MerkleProof.verify.
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Build a Merkle tree over `chunks` with leaf = keccak256(abi.encode(idx, chunk)).
    ///      Returns (root, proofs[] for each leaf). Requires chunks.length to be a power of 2.
    function _buildMerkleTree(bytes[] memory chunks)
        internal
        pure
        returns (bytes32 root, bytes32[][] memory proofs)
    {
        uint256 n = chunks.length;
        // Build leaves
        bytes32[] memory current = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            current[i] = keccak256(abi.encode(i, chunks[i]));
        }
        // Stash each level for proof extraction
        bytes32[][] memory levels = new bytes32[][](_log2(n) + 1);
        levels[0] = current;
        uint256 lvl = 0;
        while (current.length > 1) {
            uint256 parentLen = current.length / 2;
            bytes32[] memory parents = new bytes32[](parentLen);
            for (uint256 i = 0; i < parentLen; i++) {
                parents[i] = _hashPair(current[2 * i], current[2 * i + 1]);
            }
            current = parents;
            lvl++;
            levels[lvl] = current;
        }
        root = current[0];

        // Build a proof for each leaf
        proofs = new bytes32[][](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 depth = lvl;
            bytes32[] memory pf = new bytes32[](depth);
            uint256 idx = i;
            for (uint256 d = 0; d < depth; d++) {
                uint256 sib = (idx % 2 == 0) ? idx + 1 : idx - 1;
                pf[d] = levels[d][sib];
                idx /= 2;
            }
            proofs[i] = pf;
        }
    }

    function _log2(uint256 n) internal pure returns (uint256 r) {
        while (n > 1) {
            n >>= 1;
            r++;
        }
    }

    /// @dev Build a Merkle tree with a deterministic chunk layout, claim cell
    ///      for op1, commit the tree root, and return the chunks + proofs for
    ///      use in challenge-response.
    function _claimAndCommit(address operator, bytes32 cellId)
        internal
        returns (bytes[] memory chunks, bytes32[][] memory proofs, bytes32 chunkRoot)
    {
        vault.setActive(cellId, true);
        vm.prank(operator);
        registry.claimCell(cellId);

        chunks = new bytes[](CHUNK_COUNT);
        for (uint256 i = 0; i < CHUNK_COUNT; i++) {
            // Deterministic chunk content seeded by index
            chunks[i] = abi.encodePacked(keccak256(abi.encode("chunk-seed", operator, cellId, i)));
        }
        (chunkRoot, proofs) = _buildMerkleTree(chunks);

        vm.prank(operator);
        cmr.commitChunks(cellId, chunkRoot, CHUNK_COUNT, CHUNK_SIZE);
    }

    /// @dev Pick the K_SAMPLES chunks + proofs corresponding to the sampled
    ///      indices for a given (cellId, challenger, nonce).
    function _buildResponse(
        bytes32 cellId,
        address challenger,
        bytes32 nonce,
        bytes[] memory allChunks,
        bytes32[][] memory allProofs
    )
        internal
        view
        returns (bytes[] memory sampledChunks, bytes32[][] memory sampledProofs)
    {
        uint256 k = registry.K_SAMPLES();
        sampledChunks = new bytes[](k);
        sampledProofs = new bytes32[][](k);
        for (uint256 i = 0; i < k; i++) {
            uint256 idx = registry.deriveSampledIndex(cellId, challenger, nonce, i, CHUNK_COUNT);
            sampledChunks[i] = allChunks[idx];
            sampledProofs[i] = allProofs[idx];
        }
    }

    // ---- happy path ----

    function test_C32_ChallengeAndRespondHappyPath() public {
        _setupV2b();
        (bytes[] memory chunks, bytes32[][] memory proofs, ) = _claimAndCommit(op1, cell1);

        bytes32 nonce = keccak256("c32-nonce-1");
        uint256 op1Before = ckb.balanceOf(op1);

        vm.prank(op2);
        registry.challengeChunkAvailability(cell1, nonce);

        (bytes[] memory sChunks, bytes32[][] memory sProofs) = _buildResponse(cell1, op2, nonce, chunks, proofs);

        vm.prank(op1);
        registry.respondWithChunks(cell1, nonce, sChunks, sProofs);

        // Operator received challenger's bond as attentiveness reward
        assertEq(ckb.balanceOf(op1), op1Before + registry.CHUNK_CHALLENGE_BOND());

        // Challenge state cleared, cooldown stamp set
        (, address challenger, , , uint256 lastFailedAt) = registry.chunkChallenges(cell1);
        assertEq(challenger, address(0));
        assertEq(lastFailedAt, block.timestamp);
    }

    // ---- commitment required ----

    function test_C32_Challenge_RevertsIfNoCommitment() public {
        _setupV2b();
        // op1 claims but does not commit chunks
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);

        vm.prank(op2);
        vm.expectRevert(OperatorCellRegistry.NoChunkCommitment.selector);
        registry.challengeChunkAvailability(cell1, keccak256("n"));
    }

    function test_C32_Challenge_RevertsIfContentRegistryUnset() public {
        // NB: no _setupV2b() — contentRegistry remains address(0)
        vault.setActive(cell1, true);
        vm.prank(op1);
        registry.claimCell(cell1);

        vm.prank(op2);
        vm.expectRevert(OperatorCellRegistry.ContentRegistryNotSet.selector);
        registry.challengeChunkAvailability(cell1, keccak256("n"));
    }

    function test_C32_Challenge_RevertsOnSelfChallenge() public {
        _setupV2b();
        _claimAndCommit(op1, cell1);

        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.SelfChallenge.selector);
        registry.challengeChunkAvailability(cell1, keccak256("n"));
    }

    function test_C32_Challenge_RevertsIfAlreadyChallenged() public {
        _setupV2b();
        _claimAndCommit(op1, cell1);

        vm.prank(op2);
        registry.challengeChunkAvailability(cell1, keccak256("n1"));

        address op3 = makeAddr("op3");
        vm.prank(minter);
        ckb.mint(op3, 1_000e18);
        vm.prank(op3);
        ckb.approve(address(registry), type(uint256).max);

        vm.prank(op3);
        vm.expectRevert(OperatorCellRegistry.ChunkChallengeActive.selector);
        registry.challengeChunkAvailability(cell1, keccak256("n2"));
    }

    // ---- respond reverts ----

    function test_C32_Respond_RevertsOnBadProof() public {
        _setupV2b();
        (bytes[] memory chunks, bytes32[][] memory proofs, ) = _claimAndCommit(op1, cell1);

        bytes32 nonce = keccak256("n1");
        vm.prank(op2);
        registry.challengeChunkAvailability(cell1, nonce);

        (bytes[] memory sChunks, bytes32[][] memory sProofs) = _buildResponse(cell1, op2, nonce, chunks, proofs);

        // Corrupt the first chunk so the Merkle proof no longer verifies
        sChunks[0] = abi.encodePacked(keccak256("wrong-chunk"));

        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.InvalidMerkleProof.selector);
        registry.respondWithChunks(cell1, nonce, sChunks, sProofs);
    }

    function test_C32_Respond_RevertsOnWrongLength() public {
        _setupV2b();
        _claimAndCommit(op1, cell1);

        bytes32 nonce = keccak256("n1");
        vm.prank(op2);
        registry.challengeChunkAvailability(cell1, nonce);

        bytes[] memory tooFewChunks = new bytes[](3);
        bytes32[][] memory tooFewProofs = new bytes32[][](3);

        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.InvalidResponseLength.selector);
        registry.respondWithChunks(cell1, nonce, tooFewChunks, tooFewProofs);
    }

    // ---- slash ----

    function test_C32_ClaimSlash_SplitMath() public {
        _setupV2b();
        _claimAndCommit(op1, cell1);
        uint256 op2Before = ckb.balanceOf(op2);

        bytes32 nonce = keccak256("n1");
        vm.prank(op2);
        registry.challengeChunkAvailability(cell1, nonce);

        // Operator doesn't respond
        vm.warp(block.timestamp + registry.CHUNK_CHALLENGE_RESPONSE_WINDOW() + 1);

        // Anyone triggers the slash
        address poker = makeAddr("poker");
        vm.prank(poker);
        registry.claimChunkAvailabilitySlash(cell1);

        uint256 assignmentBond = BOND;  // default cell bond
        uint256 expectedSlashed = (assignmentBond * registry.CHUNK_SLASH_BPS()) / 10_000;
        uint256 expectedRemainder = assignmentBond - expectedSlashed;
        uint256 expectedChallengerPayout = (expectedSlashed * registry.CHUNK_CHALLENGER_PAYOUT_BPS()) / 10_000;
        uint256 expectedSlashPoolAdd = expectedSlashed - expectedChallengerPayout;

        assertEq(registry.slashPool(), expectedSlashPoolAdd, "slashPool += slashed/2");
        assertEq(registry.pendingOperatorRefunds(op1), expectedRemainder, "op1 remainder queued");

        // Challenger received: challenge bond back + payout
        uint256 challengeBond = registry.CHUNK_CHALLENGE_BOND();
        assertEq(
            ckb.balanceOf(op2),
            op2Before - challengeBond + (challengeBond + expectedChallengerPayout),
            "challenger refunded + rewarded"
        );

        assertFalse(registry.isAssigned(cell1, op1));
    }

    // ---- cooldown ----

    function test_C32_Cooldown_EnforcedAfterRefute() public {
        _setupV2b();
        (bytes[] memory chunks, bytes32[][] memory proofs, ) = _claimAndCommit(op1, cell1);

        bytes32 nonce = keccak256("n1");
        vm.prank(op2);
        registry.challengeChunkAvailability(cell1, nonce);

        (bytes[] memory sChunks, bytes32[][] memory sProofs) = _buildResponse(cell1, op2, nonce, chunks, proofs);
        vm.prank(op1);
        registry.respondWithChunks(cell1, nonce, sChunks, sProofs);

        // Immediate re-challenge — cooldown blocks
        vm.prank(op2);
        vm.expectRevert(OperatorCellRegistry.ChunkChallengeCooldownActive.selector);
        registry.challengeChunkAvailability(cell1, keccak256("n2"));
    }

    // ---- coexistence with V2a ----

    function test_C32_Coexistence_V2aAndV2b_BothActive() public {
        _setupV2b();
        _claimAndCommit(op1, cell1);

        // op2 raises V2a liveness challenge
        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("v2a-nonce"));

        // op2 also raises V2b chunk-availability challenge (different game)
        vm.prank(op2);
        registry.challengeChunkAvailability(cell1, keccak256("v2b-nonce"));

        (, address v2aChallenger, , , ) = registry.assignmentChallenges(cell1);
        (, address v2bChallenger, , , ) = registry.chunkChallenges(cell1);
        assertEq(v2aChallenger, op2);
        assertEq(v2bChallenger, op2);
    }

    function test_C32_V2bSlash_RefundsActiveV2aChallenger() public {
        _setupV2b();
        _claimAndCommit(op1, cell1);

        // Two separate challengers — op2 raises V2a, op3 raises V2b
        address op3 = makeAddr("op3");
        vm.prank(minter);
        ckb.mint(op3, 1_000e18);
        vm.prank(op3);
        ckb.approve(address(registry), type(uint256).max);

        uint256 op2Before = ckb.balanceOf(op2);

        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("v2a"));
        vm.prank(op3);
        registry.challengeChunkAvailability(cell1, keccak256("v2b"));

        vm.warp(block.timestamp + registry.CHUNK_CHALLENGE_RESPONSE_WINDOW() + 1);

        // V2b slash wins — should also refund the active V2a challenger (op2)
        registry.claimChunkAvailabilitySlash(cell1);

        // op2 was not wrong to raise V2a — they get their bond back
        assertEq(ckb.balanceOf(op2), op2Before, "v2a challenger refunded on v2b slash");
        (, address v2aChallenger, , , ) = registry.assignmentChallenges(cell1);
        assertEq(v2aChallenger, address(0), "v2a challenge wiped");
    }

    function test_C32_V2aSlash_RefundsActiveV2bChallenger() public {
        _setupV2b();
        _claimAndCommit(op1, cell1);

        address op3 = makeAddr("op3");
        vm.prank(minter);
        ckb.mint(op3, 1_000e18);
        vm.prank(op3);
        ckb.approve(address(registry), type(uint256).max);

        uint256 op3Before = ckb.balanceOf(op3);

        vm.prank(op2);
        registry.challengeAssignment(cell1, keccak256("v2a"));
        vm.prank(op3);
        registry.challengeChunkAvailability(cell1, keccak256("v2b"));

        vm.warp(block.timestamp + registry.ASSIGNMENT_CHALLENGE_RESPONSE_WINDOW() + 1);

        registry.claimAssignmentSlash(cell1);

        assertEq(ckb.balanceOf(op3), op3Before, "v2b challenger refunded on v2a slash");
        (, address v2bChallenger, , , ) = registry.chunkChallenges(cell1);
        assertEq(v2bChallenger, address(0), "v2b challenge wiped");
    }

    function test_C32_Relinquish_BlockedDuringChunkChallenge() public {
        _setupV2b();
        _claimAndCommit(op1, cell1);

        vm.prank(op2);
        registry.challengeChunkAvailability(cell1, keccak256("n1"));

        vm.prank(op1);
        vm.expectRevert(OperatorCellRegistry.ChunkChallengeActive.selector);
        registry.relinquishCell(cell1);
    }

    function test_C32_DeriveSampledIndex_Deterministic() public view {
        bytes32 nonce = keccak256("det");
        uint256 idx1 = registry.deriveSampledIndex(cell1, op2, nonce, 0, 64);
        uint256 idx1Again = registry.deriveSampledIndex(cell1, op2, nonce, 0, 64);
        assertEq(idx1, idx1Again, "same inputs = same index");

        uint256 idx2 = registry.deriveSampledIndex(cell1, op2, nonce, 1, 64);
        // Different k MAY coincide but should be independent — spot check they differ for k=0,1
        // (collision probability 1/64 ≈ 1.5%, acceptable for a single assertion)
        assertTrue(idx1 < 64 && idx2 < 64, "bounded by chunkCount");
    }
}
