// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/identity/RewardLedger.sol";
import "../contracts/identity/ContributionDAG.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockRewardToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Test Contract ============

contract RewardLedgerTest is Test {
    RewardLedger public ledger;
    ContributionDAG public dag;
    MockRewardToken public token;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public authorized;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        authorized = makeAddr("authorized");

        token = new MockRewardToken();

        // Deploy DAG without soulbound
        dag = new ContributionDAG(address(0));
        dag.addFounder(alice);

        // Deploy ledger
        ledger = new RewardLedger(address(token), address(dag));

        // Authorize a caller
        ledger.setAuthorizedCaller(authorized, true);

        // Fund ledger with reward tokens for claims
        token.mint(address(ledger), 1_000_000e18);
    }

    // ============ Helpers ============

    function _setupTrustChain() internal {
        // alice(founder) <-> bob <-> carol
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));
        vm.prank(bob);
        dag.addVouch(carol, bytes32(0));
        vm.prank(carol);
        dag.addVouch(bob, bytes32(0));
        dag.recalculateTrustScores();
    }

    // ============ Constructor Tests ============

    function test_constructor_setsState() public view {
        assertEq(address(ledger.rewardToken()), address(token));
        assertEq(address(ledger.contributionDAG()), address(dag));
        assertEq(ledger.owner(), owner);
        assertFalse(ledger.retroactiveFinalized());
    }

    function test_constructor_zeroToken_reverts() public {
        vm.expectRevert(IRewardLedger.ZeroAddress.selector);
        new RewardLedger(address(0), address(dag));
    }

    // ============ Retroactive Recording Tests ============

    function test_recordRetroactive_success() public {
        ledger.recordRetroactiveContribution(alice, 1000e18, IRewardLedger.EventType.CODE, bytes32("ipfs1"));

        assertEq(ledger.retroactiveBalances(alice), 1000e18);
        assertEq(ledger.totalRetroactiveDistributed(), 1000e18);
    }

    function test_recordRetroactive_multipleContributions() public {
        ledger.recordRetroactiveContribution(alice, 500e18, IRewardLedger.EventType.CODE, bytes32("ipfs1"));
        ledger.recordRetroactiveContribution(alice, 300e18, IRewardLedger.EventType.MECHANISM_DESIGN, bytes32("ipfs2"));

        assertEq(ledger.retroactiveBalances(alice), 800e18);
        assertEq(ledger.totalRetroactiveDistributed(), 800e18);
    }

    function test_recordRetroactive_multipleContributors() public {
        ledger.recordRetroactiveContribution(alice, 500e18, IRewardLedger.EventType.CODE, bytes32(0));
        ledger.recordRetroactiveContribution(bob, 300e18, IRewardLedger.EventType.CONTRIBUTION, bytes32(0));

        assertEq(ledger.retroactiveBalances(alice), 500e18);
        assertEq(ledger.retroactiveBalances(bob), 300e18);
        assertEq(ledger.totalRetroactiveDistributed(), 800e18);
    }

    function test_recordRetroactive_onlyOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        ledger.recordRetroactiveContribution(alice, 100e18, IRewardLedger.EventType.CODE, bytes32(0));
    }

    function test_recordRetroactive_zeroValue_reverts() public {
        vm.expectRevert(IRewardLedger.ZeroValue.selector);
        ledger.recordRetroactiveContribution(alice, 0, IRewardLedger.EventType.CODE, bytes32(0));
    }

    function test_recordRetroactive_zeroAddress_reverts() public {
        vm.expectRevert(IRewardLedger.ZeroAddress.selector);
        ledger.recordRetroactiveContribution(address(0), 100e18, IRewardLedger.EventType.CODE, bytes32(0));
    }

    function test_recordRetroactive_afterFinalized_reverts() public {
        ledger.finalizeRetroactive();

        vm.expectRevert(IRewardLedger.RetroactiveAlreadyFinalized.selector);
        ledger.recordRetroactiveContribution(alice, 100e18, IRewardLedger.EventType.CODE, bytes32(0));
    }

    // ============ Finalize Tests ============

    function test_finalizeRetroactive_success() public {
        ledger.recordRetroactiveContribution(alice, 100e18, IRewardLedger.EventType.CODE, bytes32(0));
        ledger.finalizeRetroactive();

        assertTrue(ledger.retroactiveFinalized());
    }

    function test_finalizeRetroactive_doubleCall_reverts() public {
        ledger.finalizeRetroactive();

        vm.expectRevert(IRewardLedger.RetroactiveAlreadyFinalized.selector);
        ledger.finalizeRetroactive();
    }

    function test_finalizeRetroactive_onlyOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        ledger.finalizeRetroactive();
    }

    // ============ Retroactive Claim Tests ============

    function test_claimRetroactive_success() public {
        ledger.recordRetroactiveContribution(alice, 500e18, IRewardLedger.EventType.CODE, bytes32(0));
        ledger.finalizeRetroactive();

        uint256 balBefore = token.balanceOf(alice);

        vm.prank(alice);
        ledger.claimRetroactive();

        assertEq(token.balanceOf(alice) - balBefore, 500e18);
        assertEq(ledger.retroactiveBalances(alice), 0);
    }

    function test_claimRetroactive_beforeFinalized_reverts() public {
        ledger.recordRetroactiveContribution(alice, 500e18, IRewardLedger.EventType.CODE, bytes32(0));

        vm.prank(alice);
        vm.expectRevert(IRewardLedger.RetroactiveNotFinalized.selector);
        ledger.claimRetroactive();
    }

    function test_claimRetroactive_nothingToClaim_reverts() public {
        ledger.finalizeRetroactive();

        vm.prank(bob); // bob has no balance
        vm.expectRevert(IRewardLedger.NothingToClaim.selector);
        ledger.claimRetroactive();
    }

    function test_claimRetroactive_doubleClaimReverts() public {
        ledger.recordRetroactiveContribution(alice, 500e18, IRewardLedger.EventType.CODE, bytes32(0));
        ledger.finalizeRetroactive();

        vm.prank(alice);
        ledger.claimRetroactive();

        vm.prank(alice);
        vm.expectRevert(IRewardLedger.NothingToClaim.selector);
        ledger.claimRetroactive();
    }

    // ============ Active Value Event Tests ============

    function test_recordValueEvent_success() public {
        address[] memory chain = new address[](2);
        chain[0] = alice;
        chain[1] = bob;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(bob, 100e18, IRewardLedger.EventType.TRADE, chain);

        IRewardLedger.ValueEvent memory evt = ledger.getValueEvent(eventId);
        assertEq(evt.actor, bob);
        assertEq(evt.value, 100e18);
        assertFalse(evt.distributed);
    }

    function test_recordValueEvent_unauthorized_reverts() public {
        address[] memory chain = new address[](1);
        chain[0] = alice;

        vm.prank(bob); // not authorized
        vm.expectRevert(IRewardLedger.UnauthorizedCaller.selector);
        ledger.recordValueEvent(alice, 100e18, IRewardLedger.EventType.TRADE, chain);
    }

    function test_recordValueEvent_ownerCanCall() public {
        address[] memory chain = new address[](1);
        chain[0] = alice;

        bytes32 eventId = ledger.recordValueEvent(alice, 100e18, IRewardLedger.EventType.TRADE, chain);
        assertTrue(eventId != bytes32(0));
    }

    function test_recordValueEvent_emptyChain_reverts() public {
        address[] memory chain = new address[](0);

        vm.prank(authorized);
        vm.expectRevert(IRewardLedger.EmptyTrustChain.selector);
        ledger.recordValueEvent(alice, 100e18, IRewardLedger.EventType.TRADE, chain);
    }

    // ============ Distribute Event Tests ============

    function test_distributeEvent_singlePersonChain() public {
        _setupTrustChain();

        // Record event for alice (founder, chain = [alice])
        address[] memory chain = new address[](1);
        chain[0] = alice;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(alice, 1000e18, IRewardLedger.EventType.TRADE, chain);

        // Distribute — alice gets everything (single person chain from getTrustScore)
        ledger.distributeEvent(eventId);

        assertEq(ledger.activeBalances(alice), 1000e18);
        assertEq(ledger.totalActiveDistributed(), 1000e18);
    }

    function test_distributeEvent_multiPersonChain() public {
        _setupTrustChain();

        // Record event for carol (chain = [alice, bob, carol])
        address[] memory chain = new address[](3);
        chain[0] = alice;
        chain[1] = bob;
        chain[2] = carol;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(carol, 1000e18, IRewardLedger.EventType.CODE, chain);

        ledger.distributeEvent(eventId);

        // Carol (actor) should get the largest share (~50%)
        uint256 carolBal = ledger.activeBalances(carol);
        uint256 bobBal = ledger.activeBalances(bob);
        uint256 aliceBal = ledger.activeBalances(alice);

        // Efficiency axiom: all value distributed
        assertEq(carolBal + bobBal + aliceBal, 1000e18);

        // Actor gets majority
        assertGt(carolBal, bobBal);
        assertGt(carolBal, aliceBal);
    }

    function test_distributeEvent_notFound_reverts() public {
        vm.expectRevert(IRewardLedger.EventNotFound.selector);
        ledger.distributeEvent(bytes32("nonexistent"));
    }

    function test_distributeEvent_alreadyDistributed_reverts() public {
        _setupTrustChain();

        address[] memory chain = new address[](1);
        chain[0] = alice;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(alice, 100e18, IRewardLedger.EventType.TRADE, chain);

        ledger.distributeEvent(eventId);

        vm.expectRevert(IRewardLedger.EventAlreadyDistributed.selector);
        ledger.distributeEvent(eventId);
    }

    // ============ Active Claim Tests ============

    function test_claimActive_success() public {
        _setupTrustChain();

        address[] memory chain = new address[](1);
        chain[0] = alice;

        vm.prank(authorized);
        bytes32 eventId = ledger.recordValueEvent(alice, 500e18, IRewardLedger.EventType.TRADE, chain);

        ledger.distributeEvent(eventId);

        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        ledger.claimActive();

        assertEq(token.balanceOf(alice) - balBefore, 500e18);
        assertEq(ledger.activeBalances(alice), 0);
    }

    function test_claimActive_nothingToClaim_reverts() public {
        vm.prank(bob);
        vm.expectRevert(IRewardLedger.NothingToClaim.selector);
        ledger.claimActive();
    }

    // ============ View Function Tests ============

    function test_getTotalDistributed() public {
        ledger.recordRetroactiveContribution(alice, 100e18, IRewardLedger.EventType.CODE, bytes32(0));

        (uint256 retro, uint256 active) = ledger.getTotalDistributed();
        assertEq(retro, 100e18);
        assertEq(active, 0);
    }

    function test_getRetroactiveBalance() public {
        ledger.recordRetroactiveContribution(alice, 777e18, IRewardLedger.EventType.CODE, bytes32(0));
        assertEq(ledger.getRetroactiveBalance(alice), 777e18);
    }

    function test_isRetroactiveFinalized() public {
        assertFalse(ledger.isRetroactiveFinalized());
        ledger.finalizeRetroactive();
        assertTrue(ledger.isRetroactiveFinalized());
    }

    // ============ Admin Tests ============

    function test_setAuthorizedCaller_success() public {
        ledger.setAuthorizedCaller(bob, true);
        assertTrue(ledger.authorizedCallers(bob));
    }

    function test_setAuthorizedCaller_onlyOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        ledger.setAuthorizedCaller(bob, true);
    }

    function test_setContributionDAG_success() public {
        address newDAG = makeAddr("newDAG");
        ledger.setContributionDAG(newDAG);
        assertEq(address(ledger.contributionDAG()), newDAG);
    }

    function test_setContributionDAG_zero_reverts() public {
        vm.expectRevert(IRewardLedger.ZeroAddress.selector);
        ledger.setContributionDAG(address(0));
    }

    function test_setRewardToken_success() public {
        MockRewardToken newToken = new MockRewardToken();
        ledger.setRewardToken(address(newToken));
        assertEq(address(ledger.rewardToken()), address(newToken));
    }

    function test_setRewardToken_zero_reverts() public {
        vm.expectRevert(IRewardLedger.ZeroAddress.selector);
        ledger.setRewardToken(address(0));
    }

    // ============ Shapley Efficiency Axiom Test ============

    function test_shapley_efficiencyAxiom_allValueDistributed() public {
        _setupTrustChain();

        // Create multiple events and verify all value is fully distributed
        uint256 totalValue = 0;

        for (uint256 i = 0; i < 5; i++) {
            address[] memory chain = new address[](3);
            chain[0] = alice;
            chain[1] = bob;
            chain[2] = carol;

            uint256 val = (i + 1) * 100e18;
            totalValue += val;

            vm.prank(authorized);
            bytes32 eventId = ledger.recordValueEvent(carol, val, IRewardLedger.EventType.TRADE, chain);
            ledger.distributeEvent(eventId);
        }

        uint256 totalDistributed = ledger.activeBalances(alice) + ledger.activeBalances(bob) + ledger.activeBalances(carol);
        assertEq(totalDistributed, totalValue);
    }
}
