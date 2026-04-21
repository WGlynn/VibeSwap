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
}
