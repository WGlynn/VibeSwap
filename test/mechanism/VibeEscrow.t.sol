// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeEscrow.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ VibeEscrow Tests ============

contract VibeEscrowTest is Test {
    VibeEscrow public escrow;
    MockToken  public token;

    address public owner;
    address public alice;      // depositor
    address public bob;        // beneficiary
    address public carol;      // arbiter
    address public feeRecipient;

    // ============ Events ============

    event EscrowCreated(uint256 indexed escrowId, address indexed depositor, address indexed beneficiary, uint256 amount);
    event EscrowFunded(uint256 indexed escrowId, uint256 amount);
    event MilestoneCompleted(uint256 indexed escrowId, uint256 milestoneIndex);
    event MilestoneApproved(uint256 indexed escrowId, uint256 milestoneIndex, uint256 amount);
    event EscrowReleased(uint256 indexed escrowId, uint256 amount);
    event EscrowDisputed(uint256 indexed escrowId, address disputant);
    event EscrowResolved(uint256 indexed escrowId, uint256 depositorShare, uint256 beneficiaryShare);
    event EscrowRefunded(uint256 indexed escrowId, uint256 amount);

    // ============ Setup ============

    function setUp() public {
        owner        = address(this);
        alice        = makeAddr("alice");
        bob          = makeAddr("bob");
        carol        = makeAddr("carol");
        feeRecipient = makeAddr("feeRecipient");

        token = new MockToken("USDC", "USDC");

        VibeEscrow impl = new VibeEscrow();
        bytes memory initData = abi.encodeCall(VibeEscrow.initialize, (feeRecipient));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        escrow = VibeEscrow(payable(address(proxy)));

        // Fund alice with ETH and tokens
        deal(alice, 100 ether);
        token.mint(alice, 100_000e18);

        vm.prank(alice);
        token.approve(address(escrow), type(uint256).max);
    }

    // ============ Helpers ============

    string[] private _emptyDescs;
    uint256[] private _emptyAmounts;

    function _createETHEscrow(uint256 amount, uint256 duration) internal returns (uint256) {
        vm.prank(alice);
        return escrow.createEscrow{value: amount}(
            bob, carol, address(0), amount, "Test escrow", duration,
            _emptyDescs, _emptyAmounts
        );
    }

    function _createTokenEscrow(uint256 amount, uint256 duration) internal returns (uint256) {
        vm.prank(alice);
        return escrow.createEscrow(
            bob, carol, address(token), amount, "Token escrow", duration,
            _emptyDescs, _emptyAmounts
        );
    }

    function _createMilestoneEscrow(uint256 total) internal returns (uint256) {
        string[] memory descs = new string[](2);
        descs[0] = "Phase 1";
        descs[1] = "Phase 2";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = total / 2;
        amounts[1] = total - amounts[0];

        vm.prank(alice);
        return escrow.createEscrow{value: total}(
            bob, carol, address(0), total, "Milestone escrow", 30 days,
            descs, amounts
        );
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(escrow.owner(), owner);
    }

    function test_initialize_setsFeeRecipient() public view {
        assertEq(escrow.feeRecipient(), feeRecipient);
    }

    function test_initialize_setsDefaultFee() public view {
        assertEq(escrow.feeBps(), 100); // 1%
    }

    function test_initialize_zeroCounters() public view {
        assertEq(escrow.getEscrowCount(), 0);
        assertEq(escrow.getActiveCount(), 0);
    }

    // ============ createEscrow — ETH ============

    function test_createEscrow_ETH_incrementsCount() public {
        _createETHEscrow(1 ether, 7 days);
        assertEq(escrow.getEscrowCount(), 1);
        assertEq(escrow.getActiveCount(), 1);
    }

    function test_createEscrow_ETH_holdsValue() public {
        _createETHEscrow(1 ether, 7 days);
        assertEq(address(escrow).balance, 1 ether);
    }

    function test_createEscrow_ETH_storesFields() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        (
            uint256 escrowId, address depositor, address beneficiary, address arbiter,
            address tkn, uint256 amount, , , , VibeEscrow.EscrowStatus status, ,
        ) = escrow.escrows(id);

        assertEq(escrowId,    id);
        assertEq(depositor,   alice);
        assertEq(beneficiary, bob);
        assertEq(arbiter,     carol);
        assertEq(tkn,         address(0));
        assertEq(amount,      1 ether);
        assertEq(uint8(status), uint8(VibeEscrow.EscrowStatus.FUNDED));
    }

    function test_createEscrow_ETH_emitsEvents() public {
        vm.expectEmit(true, true, true, true);
        emit EscrowCreated(1, alice, bob, 1 ether);

        vm.prank(alice);
        escrow.createEscrow{value: 1 ether}(
            bob, carol, address(0), 1 ether, "X", 7 days, _emptyDescs, _emptyAmounts
        );
    }

    function test_createEscrow_ETH_insufficientValue_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient ETH");
        escrow.createEscrow{value: 0.5 ether}(
            bob, carol, address(0), 1 ether, "X", 7 days, _emptyDescs, _emptyAmounts
        );
    }

    function test_createEscrow_zeroBeneficiary_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Zero beneficiary");
        escrow.createEscrow{value: 1 ether}(
            address(0), carol, address(0), 1 ether, "X", 7 days, _emptyDescs, _emptyAmounts
        );
    }

    // ============ createEscrow — ERC20 ============

    function test_createEscrow_ERC20_transfersTokens() public {
        uint256 before = token.balanceOf(alice);
        _createTokenEscrow(100e18, 7 days);
        assertEq(token.balanceOf(alice), before - 100e18);
        assertEq(token.balanceOf(address(escrow)), 100e18);
    }

    function test_createEscrow_ERC20_volumeAccumulated() public {
        _createTokenEscrow(100e18, 7 days);
        assertEq(escrow.totalEscrowVolume(), 100e18);
    }

    // ============ createEscrow — milestones ============

    function test_createEscrow_milestones_storesData() public {
        uint256 id = _createMilestoneEscrow(2 ether);
        (,,,,,,,,,, uint256 milestoneCount, uint256 milestonesCompleted) = escrow.escrows(id);
        assertEq(milestoneCount,       2);
        assertEq(milestonesCompleted,  0);
    }

    function test_createEscrow_milestones_mismatch_reverts() public {
        string[] memory descs = new string[](2);
        descs[0] = "P1"; descs[1] = "P2";
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.prank(alice);
        vm.expectRevert("Mismatch");
        escrow.createEscrow{value: 1 ether}(
            bob, carol, address(0), 1 ether, "X", 7 days, descs, amounts
        );
    }

    function test_createEscrow_milestones_sumMismatch_reverts() public {
        string[] memory descs = new string[](2);
        descs[0] = "P1"; descs[1] = "P2";
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 0.4 ether;
        amounts[1] = 0.4 ether; // sum = 0.8 != 1 ether

        vm.prank(alice);
        vm.expectRevert("Milestones must sum to amount");
        escrow.createEscrow{value: 1 ether}(
            bob, carol, address(0), 1 ether, "X", 7 days, descs, amounts
        );
    }

    // ============ releaseAll ============

    function test_releaseAll_transfersNetToBeneficiary() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        uint256 fee = (1 ether * 100) / 10000; // 1%
        uint256 net = 1 ether - fee;

        uint256 bobBefore = bob.balance;
        vm.prank(alice);
        escrow.releaseAll(id);

        assertEq(bob.balance,              bobBefore + net);
        assertEq(feeRecipient.balance,     fee);
    }

    function test_releaseAll_updatesStatus() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice);
        escrow.releaseAll(id);

        (,,,,,,,,, VibeEscrow.EscrowStatus status,,) = escrow.escrows(id);
        assertEq(uint8(status), uint8(VibeEscrow.EscrowStatus.RELEASED));
    }

    function test_releaseAll_decrementsActiveCount() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        assertEq(escrow.getActiveCount(), 1);
        vm.prank(alice);
        escrow.releaseAll(id);
        assertEq(escrow.getActiveCount(), 0);
    }

    function test_releaseAll_emitsEvent() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.expectEmit(true, false, false, true);
        emit EscrowReleased(id, 1 ether);
        vm.prank(alice);
        escrow.releaseAll(id);
    }

    function test_releaseAll_notDepositor_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(bob);
        vm.expectRevert("Not depositor");
        escrow.releaseAll(id);
    }

    function test_releaseAll_notFunded_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice);
        escrow.releaseAll(id); // first release

        vm.prank(alice);
        vm.expectRevert("Not funded");
        escrow.releaseAll(id); // second release should revert
    }

    // ============ Milestone flow ============

    function test_completeMilestone_marksDone() public {
        uint256 id = _createMilestoneEscrow(2 ether);
        vm.prank(bob);
        escrow.completeMilestone(id, 0);

        (,, bool completed, bool approved) = escrow.milestones(id, 0);
        assertTrue(completed);
        assertFalse(approved);
    }

    function test_completeMilestone_notBeneficiary_reverts() public {
        uint256 id = _createMilestoneEscrow(2 ether);
        vm.prank(alice);
        vm.expectRevert("Not beneficiary");
        escrow.completeMilestone(id, 0);
    }

    function test_approveMilestone_paysBeneficiary() public {
        uint256 id = _createMilestoneEscrow(2 ether);

        vm.prank(bob);
        escrow.completeMilestone(id, 0);

        uint256 bobBefore = bob.balance;
        uint256 payout = 1 ether;
        uint256 fee    = (payout * 100) / 10000;
        uint256 net    = payout - fee;

        vm.prank(alice);
        escrow.approveMilestone(id, 0);

        assertEq(bob.balance, bobBefore + net);
        assertEq(feeRecipient.balance, fee);
    }

    function test_approveMilestone_emitsEvent() public {
        uint256 id = _createMilestoneEscrow(2 ether);
        vm.prank(bob); escrow.completeMilestone(id, 0);

        vm.expectEmit(true, false, false, true);
        emit MilestoneApproved(id, 0, 1 ether);
        vm.prank(alice);
        escrow.approveMilestone(id, 0);
    }

    function test_approveMilestone_allMilestones_releasesEscrow() public {
        uint256 id = _createMilestoneEscrow(2 ether);

        vm.prank(bob); escrow.completeMilestone(id, 0);
        vm.prank(alice); escrow.approveMilestone(id, 0);

        vm.prank(bob); escrow.completeMilestone(id, 1);
        vm.prank(alice); escrow.approveMilestone(id, 1);

        (,,,,,,,,, VibeEscrow.EscrowStatus status,,) = escrow.escrows(id);
        assertEq(uint8(status), uint8(VibeEscrow.EscrowStatus.RELEASED));
        assertEq(escrow.getActiveCount(), 0);
    }

    function test_approveMilestone_notDepositor_reverts() public {
        uint256 id = _createMilestoneEscrow(2 ether);
        vm.prank(bob); escrow.completeMilestone(id, 0);

        vm.prank(carol);
        vm.expectRevert("Not depositor");
        escrow.approveMilestone(id, 0);
    }

    function test_approveMilestone_notCompleted_reverts() public {
        uint256 id = _createMilestoneEscrow(2 ether);
        vm.prank(alice);
        vm.expectRevert("Not completed");
        escrow.approveMilestone(id, 0);
    }

    function test_approveMilestone_alreadyApproved_reverts() public {
        uint256 id = _createMilestoneEscrow(2 ether);
        vm.prank(bob); escrow.completeMilestone(id, 0);
        vm.prank(alice); escrow.approveMilestone(id, 0);

        vm.prank(alice);
        vm.expectRevert("Already approved");
        escrow.approveMilestone(id, 0);
    }

    // ============ dispute ============

    function test_dispute_depositorCanDispute() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice);
        escrow.dispute(id);

        (,,,,,,,,, VibeEscrow.EscrowStatus status,,) = escrow.escrows(id);
        assertEq(uint8(status), uint8(VibeEscrow.EscrowStatus.DISPUTED));
    }

    function test_dispute_beneficiaryCanDispute() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(bob);
        escrow.dispute(id);

        (,,,,,,,,, VibeEscrow.EscrowStatus status,,) = escrow.escrows(id);
        assertEq(uint8(status), uint8(VibeEscrow.EscrowStatus.DISPUTED));
    }

    function test_dispute_emitsEvent() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.expectEmit(true, false, false, true);
        emit EscrowDisputed(id, alice);
        vm.prank(alice);
        escrow.dispute(id);
    }

    function test_dispute_thirdParty_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert("Not party");
        escrow.dispute(id);
    }

    function test_dispute_notFunded_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice); escrow.releaseAll(id); // status → RELEASED

        vm.prank(alice);
        vm.expectRevert("Not funded");
        escrow.dispute(id);
    }

    // ============ resolveDispute ============

    function test_resolveDispute_fullDepositor() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice); escrow.dispute(id);

        uint256 aliceBefore = alice.balance;
        vm.prank(carol);
        escrow.resolveDispute(id, 10000); // 100% to depositor

        assertEq(alice.balance, aliceBefore + 1 ether);
    }

    function test_resolveDispute_fullBeneficiary() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice); escrow.dispute(id);

        uint256 bobBefore = bob.balance;
        vm.prank(carol);
        escrow.resolveDispute(id, 0); // 100% to beneficiary

        assertEq(bob.balance, bobBefore + 1 ether);
    }

    function test_resolveDispute_split() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice); escrow.dispute(id);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore   = bob.balance;
        vm.prank(carol);
        escrow.resolveDispute(id, 5000); // 50/50

        assertEq(alice.balance, aliceBefore + 0.5 ether);
        assertEq(bob.balance,   bobBefore   + 0.5 ether);
    }

    function test_resolveDispute_updatesStatus() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice); escrow.dispute(id);
        vm.prank(carol); escrow.resolveDispute(id, 5000);

        (,,,,,,,,, VibeEscrow.EscrowStatus status,,) = escrow.escrows(id);
        assertEq(uint8(status), uint8(VibeEscrow.EscrowStatus.RESOLVED));
        assertEq(escrow.getActiveCount(), 0);
    }

    function test_resolveDispute_emitsEvent() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice); escrow.dispute(id);

        vm.expectEmit(true, false, false, true);
        emit EscrowResolved(id, 0.5 ether, 0.5 ether);
        vm.prank(carol);
        escrow.resolveDispute(id, 5000);
    }

    function test_resolveDispute_notArbiter_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice); escrow.dispute(id);

        vm.prank(alice);
        vm.expectRevert("Not arbiter");
        escrow.resolveDispute(id, 5000);
    }

    function test_resolveDispute_notDisputed_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(carol);
        vm.expectRevert("Not disputed");
        escrow.resolveDispute(id, 5000);
    }

    function test_resolveDispute_invalidSplit_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.prank(alice); escrow.dispute(id);

        vm.prank(carol);
        vm.expectRevert("Invalid split");
        escrow.resolveDispute(id, 10001);
    }

    // ============ refundExpired ============

    function test_refundExpired_returnsFunds() public {
        uint256 id = _createETHEscrow(1 ether, 1 days);

        uint256 aliceBefore = alice.balance;
        vm.warp(block.timestamp + 1 days + 1);
        escrow.refundExpired(id);

        assertEq(alice.balance, aliceBefore + 1 ether);
    }

    function test_refundExpired_updatesStatus() public {
        uint256 id = _createETHEscrow(1 ether, 1 days);
        vm.warp(block.timestamp + 1 days + 1);
        escrow.refundExpired(id);

        (,,,,,,,,, VibeEscrow.EscrowStatus status,,) = escrow.escrows(id);
        assertEq(uint8(status), uint8(VibeEscrow.EscrowStatus.REFUNDED));
        assertEq(escrow.getActiveCount(), 0);
    }

    function test_refundExpired_emitsEvent() public {
        uint256 id = _createETHEscrow(1 ether, 1 days);
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, false, false, true);
        emit EscrowRefunded(id, 1 ether);
        escrow.refundExpired(id);
    }

    function test_refundExpired_notExpired_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 7 days);
        vm.expectRevert("Not expired");
        escrow.refundExpired(id);
    }

    function test_refundExpired_notFunded_reverts() public {
        uint256 id = _createETHEscrow(1 ether, 1 days);
        vm.prank(alice); escrow.releaseAll(id); // already released

        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert("Not funded");
        escrow.refundExpired(id);
    }

    function test_refundExpired_noExpiry_cannotExpire() public {
        // duration = 0 → expiresAt = type(uint256).max
        uint256 id = _createETHEscrow(1 ether, 0);
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert("Not expired");
        escrow.refundExpired(id);
    }

    // ============ Fuzz ============

    function testFuzz_createAndRelease_ETH(uint256 amount) public {
        amount = bound(amount, 0.001 ether, 10 ether);
        deal(alice, amount);

        uint256 id = _createETHEscrow(amount, 7 days);
        uint256 fee = (amount * 100) / 10000;
        uint256 net = amount - fee;

        uint256 bobBefore = bob.balance;
        vm.prank(alice);
        escrow.releaseAll(id);
        assertEq(bob.balance, bobBefore + net);
    }

    function testFuzz_resolveDispute_splitIsConsistent(uint256 depositorBps) public {
        depositorBps = bound(depositorBps, 0, 10000);
        uint256 amount = 1 ether;

        uint256 id = _createETHEscrow(amount, 7 days);
        vm.prank(alice); escrow.dispute(id);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore   = bob.balance;

        vm.prank(carol);
        escrow.resolveDispute(id, depositorBps);

        uint256 depositorShare   = (amount * depositorBps) / 10000;
        uint256 beneficiaryShare = amount - depositorShare;

        assertEq(alice.balance, aliceBefore + depositorShare);
        assertEq(bob.balance,   bobBefore   + beneficiaryShare);
    }
}
