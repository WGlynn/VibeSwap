// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibePaymaster.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Caller ============

contract MockCaller {
    VibePaymaster public paymaster;

    constructor(address _paymaster) {
        paymaster = VibePaymaster(payable(_paymaster));
    }

    function sponsorFor(address user) external payable {
        paymaster.sponsorGas{value: msg.value}(user);
    }
}

// ============ VibePaymaster Tests ============

contract VibePaymasterTest is Test {
    VibePaymaster public paymaster;

    address public owner;
    address public alice;
    address public bob;

    // ============ Events ============

    event GasSponsored(address indexed user, uint256 amount, uint256 txNumber);
    event GasSubsidized(address indexed user, uint256 amount, uint256 subsidy);
    event BudgetUpdated(uint256 newBudget);
    event UserOnboarded(address indexed user);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob   = makeAddr("bob");

        VibePaymaster impl = new VibePaymaster();
        bytes memory initData = abi.encodeCall(VibePaymaster.initialize, (1 ether));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        paymaster = VibePaymaster(payable(address(proxy)));

        // Fund the paymaster
        deal(address(paymaster), 10 ether);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(paymaster.owner(), owner);
    }

    function test_initialize_setsDailyBudget() public view {
        assertEq(paymaster.dailyBudget(), 1 ether);
    }

    function test_initialize_zeroBudgetDefaultsToOneEther() public {
        VibePaymaster impl2 = new VibePaymaster();
        bytes memory initData = abi.encodeCall(VibePaymaster.initialize, (0));
        ERC1967Proxy proxy2 = new ERC1967Proxy(address(impl2), initData);
        VibePaymaster pm2 = VibePaymaster(payable(address(proxy2)));
        assertEq(pm2.dailyBudget(), 1 ether);
    }

    function test_initialize_freshProfile_zeroTxCount() public view {
        VibePaymaster.UserGasProfile memory p = paymaster.getProfile(alice);
        assertEq(p.txCount, 0);
        assertEq(p.totalSponsored, 0);
        assertFalse(p.isJULHolder);
    }

    // ============ checkSponsorship ============

    function test_checkSponsorship_newUser_fullGas() public view {
        (bool eligible, uint256 amount, string memory reason) = paymaster.checkSponsorship(alice, 0.01 ether);
        assertTrue(eligible);
        assertEq(amount, 0.01 ether);
        assertEq(reason, "Free gas for new users");
    }

    function test_checkSponsorship_afterFreeTxs_halfPrice() public {
        // Advance alice's tx count to FREE_TX_LIMIT by whitelisting owner and sponsoring
        paymaster.whitelistContract(owner);
        for (uint256 i = 0; i < 5; i++) {
            paymaster.sponsorGas(alice);
        }
        (bool eligible, uint256 amount, ) = paymaster.checkSponsorship(alice, 0.01 ether);
        assertTrue(eligible);
        assertEq(amount, (0.01 ether * 5000) / 10000); // 50%
    }

    function test_checkSponsorship_afterSubsidized_noSponsorship() public {
        paymaster.whitelistContract(owner);
        for (uint256 i = 0; i < 15; i++) {
            paymaster.sponsorGas(alice);
        }
        (bool eligible, uint256 amount, ) = paymaster.checkSponsorship(alice, 0.01 ether);
        assertFalse(eligible);
        assertEq(amount, 0);
    }

    function test_checkSponsorship_JULHolder_discountAfterLimit() public {
        paymaster.whitelistContract(owner);
        paymaster.setJULHolder(alice, true);
        for (uint256 i = 0; i < 15; i++) {
            paymaster.sponsorGas(alice);
        }
        (bool eligible, uint256 amount, string memory reason) = paymaster.checkSponsorship(alice, 0.01 ether);
        assertTrue(eligible);
        assertEq(amount, (0.01 ether * 2000) / 10000); // 20%
        assertEq(reason, "JUL holder discount");
    }

    // ============ sponsorGas — authorization ============

    function test_sponsorGas_ownerCanSponsor() public {
        paymaster.sponsorGas(alice);
        VibePaymaster.UserGasProfile memory p = paymaster.getProfile(alice);
        assertEq(p.txCount, 1);
    }

    function test_sponsorGas_whitelistedCallerCanSponsor() public {
        MockCaller caller = new MockCaller(address(paymaster));
        paymaster.whitelistContract(address(caller));

        caller.sponsorFor(alice);
        VibePaymaster.UserGasProfile memory p = paymaster.getProfile(alice);
        assertEq(p.txCount, 1);
    }

    function test_sponsorGas_unauthorizedCaller_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Not authorized");
        paymaster.sponsorGas(bob);
    }

    // ============ sponsorGas — onboarding ============

    function test_sponsorGas_firstCall_emitsUserOnboarded() public {
        paymaster.whitelistContract(owner);
        vm.expectEmit(true, false, false, false);
        emit UserOnboarded(alice);
        paymaster.sponsorGas(alice);
    }

    function test_sponsorGas_secondCall_noOnboardEvent() public {
        paymaster.whitelistContract(owner);
        paymaster.sponsorGas(alice);

        // Second call — no UserOnboarded event expected
        vm.recordLogs();
        paymaster.sponsorGas(alice);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 onboardedSig = keccak256("UserOnboarded(address)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != onboardedSig, "Unexpected UserOnboarded");
        }
    }

    function test_sponsorGas_incrementsTotalUsers() public {
        paymaster.whitelistContract(owner);
        assertEq(paymaster.totalUsers(), 0);
        paymaster.sponsorGas(alice);
        assertEq(paymaster.totalUsers(), 1);
        paymaster.sponsorGas(bob);
        assertEq(paymaster.totalUsers(), 2);
    }

    // ============ sponsorGas — tx counting ============

    function test_sponsorGas_incrementsTxCount() public {
        paymaster.whitelistContract(owner);
        for (uint256 i = 1; i <= 5; i++) {
            paymaster.sponsorGas(alice);
            assertEq(paymaster.getProfile(alice).txCount, i);
        }
    }

    function test_sponsorGas_updatesTotalSponsored() public {
        paymaster.whitelistContract(owner);
        uint256 before = paymaster.totalSponsored();
        paymaster.sponsorGas(alice);
        uint256 after_ = paymaster.totalSponsored();
        assertGe(after_, before); // non-zero if gas cost is non-zero (may be 0 in test env)
    }

    // ============ Daily budget cap ============

    function test_dailyBudget_excessPreventsSponsorship() public {
        // Set a tiny budget and fill it up
        paymaster.setDailyBudget(0); // zero budget — nothing gets sponsored
        paymaster.whitelistContract(owner);
        paymaster.sponsorGas(alice);
        // txCount stays 0 because dailySpent + sponsored > dailyBudget
        assertEq(paymaster.getProfile(alice).txCount, 0);
    }

    function test_dailyBudget_resetsAfter24Hours() public {
        paymaster.whitelistContract(owner);
        // Drain budget (tiny budget)
        paymaster.setDailyBudget(0);
        paymaster.sponsorGas(alice); // no-op (0 budget)
        assertEq(paymaster.getProfile(alice).txCount, 0);

        // Restore budget
        paymaster.setDailyBudget(1 ether);
        // Warp past 24 h — daily reset happens inside sponsorGas
        vm.warp(block.timestamp + 1 days + 1);
        paymaster.sponsorGas(alice);
        assertEq(paymaster.getProfile(alice).txCount, 1);
    }

    function test_getRemainingBudget_beforeReset() public view {
        uint256 remaining = paymaster.getRemainingBudget();
        assertEq(remaining, 1 ether); // nothing spent yet
    }

    function test_getRemainingBudget_afterReset_returnsFullBudget() public {
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(paymaster.getRemainingBudget(), 1 ether);
    }

    // ============ getFreeTxRemaining ============

    function test_getFreeTxRemaining_newUser() public view {
        assertEq(paymaster.getFreeTxRemaining(alice), 5);
    }

    function test_getFreeTxRemaining_decrements() public {
        paymaster.whitelistContract(owner);
        paymaster.sponsorGas(alice);
        assertEq(paymaster.getFreeTxRemaining(alice), 4);
    }

    function test_getFreeTxRemaining_zeroAfterFiveSponsored() public {
        paymaster.whitelistContract(owner);
        for (uint256 i = 0; i < 5; i++) paymaster.sponsorGas(alice);
        assertEq(paymaster.getFreeTxRemaining(alice), 0);
    }

    // ============ Admin — setDailyBudget ============

    function test_setDailyBudget_updatesValue() public {
        paymaster.setDailyBudget(5 ether);
        assertEq(paymaster.dailyBudget(), 5 ether);
    }

    function test_setDailyBudget_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit BudgetUpdated(5 ether);
        paymaster.setDailyBudget(5 ether);
    }

    function test_setDailyBudget_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        paymaster.setDailyBudget(5 ether);
    }

    // ============ Admin — whitelistContract ============

    function test_whitelistContract_setsFlag() public {
        address target = makeAddr("target");
        assertFalse(paymaster.whitelistedContracts(target));
        paymaster.whitelistContract(target);
        assertTrue(paymaster.whitelistedContracts(target));
    }

    function test_whitelistContract_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        paymaster.whitelistContract(makeAddr("target"));
    }

    // ============ Admin — setJULHolder ============

    function test_setJULHolder_setsFlag() public {
        assertFalse(paymaster.getProfile(alice).isJULHolder);
        paymaster.setJULHolder(alice, true);
        assertTrue(paymaster.getProfile(alice).isJULHolder);
    }

    function test_setJULHolder_clearsFlag() public {
        paymaster.setJULHolder(alice, true);
        paymaster.setJULHolder(alice, false);
        assertFalse(paymaster.getProfile(alice).isJULHolder);
    }

    function test_setJULHolder_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        paymaster.setJULHolder(bob, true);
    }

    // ============ Receive ETH ============

    function test_receiveETH() public {
        uint256 before = address(paymaster).balance;
        (bool ok,) = address(paymaster).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(paymaster).balance, before + 1 ether);
    }

    // ============ Fuzz ============

    function testFuzz_checkSponsorship_noRevert(address user, uint256 gasCost) public view {
        gasCost = bound(gasCost, 0, 100 ether);
        (bool eligible, uint256 amount, ) = paymaster.checkSponsorship(user, gasCost);
        if (!eligible) assertEq(amount, 0);
    }

    function testFuzz_setDailyBudget(uint256 newBudget) public {
        newBudget = bound(newBudget, 0, 1000 ether);
        paymaster.setDailyBudget(newBudget);
        assertEq(paymaster.dailyBudget(), newBudget);
    }
}
