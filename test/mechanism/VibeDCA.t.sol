// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeDCA.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockDCAToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ VibeDCA Tests ============

contract VibeDCATest is Test {
    VibeDCA public dca;
    MockDCAToken public tokenIn;
    MockDCAToken public tokenOut;

    address public owner;
    address public alice;
    address public bob;
    address public keeper;

    // ============ Events ============

    event DCACreated(uint256 indexed orderId, address indexed user, address tokenIn, address tokenOut, VibeDCA.Frequency freq);
    event DCAExecuted(uint256 indexed orderId, address indexed keeper, uint256 amountIn, uint256 executionNum);
    event DCACancelled(uint256 indexed orderId);
    event DCACompleted(uint256 indexed orderId);

    // ============ Setup ============

    function setUp() public {
        owner  = address(this);
        alice  = makeAddr("alice");
        bob    = makeAddr("bob");
        keeper = makeAddr("keeper");

        tokenIn  = new MockDCAToken("TokenIn",  "TKI");
        tokenOut = new MockDCAToken("TokenOut", "TKO");

        VibeDCA impl = new VibeDCA();
        bytes memory initData = abi.encodeCall(VibeDCA.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        dca = VibeDCA(address(proxy));

        tokenIn.mint(alice, 1_000_000 ether);
        tokenIn.mint(bob,   1_000_000 ether);
        tokenOut.mint(keeper, 1_000_000 ether); // keeper provides tokenOut

        vm.prank(alice);
        tokenIn.approve(address(dca), type(uint256).max);
        vm.prank(bob);
        tokenIn.approve(address(dca), type(uint256).max);
        vm.prank(keeper);
        tokenOut.approve(address(dca), type(uint256).max);
    }

    // ============ Helpers ============

    /// @dev Create a default daily DCA for alice: 1200 total, 100 per execution, 12 executions
    function _createDefaultDCA() internal returns (uint256 orderId) {
        vm.prank(alice);
        orderId = dca.createDCA(
            address(tokenIn),
            address(tokenOut),
            1200 ether,   // totalAmount
            100 ether,    // amountPerExecution
            12,           // maxExecutions
            VibeDCA.Frequency.DAILY
        );
    }

    /// @dev Execute one interval of a DCA order as keeper, providing amountOut of tokenOut
    function _executeAs(uint256 orderId, address _keeper, uint256 amountOut) internal {
        vm.prank(_keeper);
        dca.executeDCA(orderId, amountOut);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(dca.owner(), owner);
    }

    function test_initialize_defaultKeeperBounty() public view {
        assertEq(dca.keeperBountyBps(), 50); // 0.5%
    }

    function test_initialize_zeroOrderCount() public view {
        assertEq(dca.getOrderCount(), 0);
    }

    // ============ Create DCA ============

    function test_createDCA_storesOrder() public {
        uint256 orderId = _createDefaultDCA();
        assertEq(orderId, 1);
        assertEq(dca.getOrderCount(), 1);

        VibeDCA.DCAOrder memory o = dca.getOrder(orderId);
        assertEq(o.orderId,              orderId);
        assertEq(o.user,                 alice);
        assertEq(o.tokenIn,              address(tokenIn));
        assertEq(o.tokenOut,             address(tokenOut));
        assertEq(o.totalDeposited,       1200 ether);
        assertEq(o.amountPerExecution,   100 ether);
        assertEq(o.totalExecuted,        0);
        assertEq(o.executionCount,       0);
        assertEq(o.maxExecutions,        12);
        assertEq(uint8(o.frequency),     uint8(VibeDCA.Frequency.DAILY));
        assertTrue(o.active);
    }

    function test_createDCA_transfersTokenIn() public {
        uint256 aliceBefore = tokenIn.balanceOf(alice);
        _createDefaultDCA();
        assertEq(tokenIn.balanceOf(alice), aliceBefore - 1200 ether);
        assertEq(tokenIn.balanceOf(address(dca)), 1200 ether);
    }

    function test_createDCA_emitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit DCACreated(1, alice, address(tokenIn), address(tokenOut), VibeDCA.Frequency.DAILY);

        vm.prank(alice);
        dca.createDCA(address(tokenIn), address(tokenOut),
            1200 ether, 100 ether, 12, VibeDCA.Frequency.DAILY);
    }

    function test_createDCA_addsToUserOrders() public {
        _createDefaultDCA();
        uint256[] memory orders = dca.getUserOrders(alice);
        assertEq(orders.length, 1);
        assertEq(orders[0], 1);
    }

    function test_createDCA_multipleOrders() public {
        _createDefaultDCA();
        vm.prank(alice);
        dca.createDCA(address(tokenIn), address(tokenOut), 200 ether, 100 ether, 2, VibeDCA.Frequency.WEEKLY);
        assertEq(dca.getOrderCount(), 2);
        assertEq(dca.getUserOrders(alice).length, 2);
    }

    function test_createDCA_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Zero amount");
        dca.createDCA(address(tokenIn), address(tokenOut), 0, 100 ether, 1, VibeDCA.Frequency.DAILY);
    }

    function test_createDCA_zeroPerExecution_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Zero per execution");
        dca.createDCA(address(tokenIn), address(tokenOut), 1000 ether, 0, 1, VibeDCA.Frequency.DAILY);
    }

    function test_createDCA_insufficientDeposit_reverts() public {
        // 100 per execution * 12 = 1200 but only depositing 1100
        vm.prank(alice);
        vm.expectRevert("Insufficient deposit");
        dca.createDCA(address(tokenIn), address(tokenOut), 1100 ether, 100 ether, 12, VibeDCA.Frequency.DAILY);
    }

    // ============ Execute DCA ============

    function test_executeDCA_transfersTokenInToKeeper() public {
        uint256 orderId = _createDefaultDCA();
        vm.warp(block.timestamp + 1 days + 1);

        uint256 keeperBefore = tokenIn.balanceOf(keeper);
        _executeAs(orderId, keeper, 99 ether);

        uint256 bounty    = (100 ether * 50) / 10000; // 0.5% = 0.5 ether
        uint256 swapAmount = 100 ether - bounty;

        // keeper gets swapAmount + bounty = full 100 ether
        assertEq(tokenIn.balanceOf(keeper), keeperBefore + swapAmount + bounty);
    }

    function test_executeDCA_deliversTokenOutToUser() public {
        uint256 orderId = _createDefaultDCA();
        vm.warp(block.timestamp + 1 days + 1);

        uint256 aliceBefore = tokenOut.balanceOf(alice);
        _executeAs(orderId, keeper, 99 ether);

        assertEq(tokenOut.balanceOf(alice), aliceBefore + 99 ether);
    }

    function test_executeDCA_updatesOrderState() public {
        uint256 orderId = _createDefaultDCA();
        vm.warp(block.timestamp + 1 days + 1);

        _executeAs(orderId, keeper, 99 ether);

        assertEq(dca.getOrder(orderId).executionCount, 1);
        assertEq(dca.getOrder(orderId).totalExecuted,  100 ether);
    }

    function test_executeDCA_updatesGlobalCounters() public {
        uint256 orderId = _createDefaultDCA();
        vm.warp(block.timestamp + 1 days + 1);
        _executeAs(orderId, keeper, 99 ether);

        assertEq(dca.totalVolume(),     100 ether);
        assertEq(dca.totalExecutions(), 1);
    }

    function test_executeDCA_emitsEvent() public {
        uint256 orderId = _createDefaultDCA();
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, true, false, true);
        emit DCAExecuted(orderId, keeper, 100 ether, 1);
        _executeAs(orderId, keeper, 99 ether);
    }

    function test_executeDCA_notYetExecutable_reverts() public {
        uint256 orderId = _createDefaultDCA();
        // lastExecuted = block.timestamp, need to wait 1 day
        vm.expectRevert("Not yet executable");
        _executeAs(orderId, keeper, 99 ether);
    }

    function test_executeDCA_notActive_reverts() public {
        uint256 orderId = _createDefaultDCA();
        vm.prank(alice);
        dca.cancelDCA(orderId);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(keeper);
        vm.expectRevert("Not active");
        dca.executeDCA(orderId, 99 ether);
    }

    function test_executeDCA_maxExecutionsReached_reverts() public {
        // 1-execution order
        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            100 ether, 100 ether, 1, VibeDCA.Frequency.DAILY);

        vm.warp(block.timestamp + 1 days + 1);
        _executeAs(orderId, keeper, 99 ether); // completes

        vm.warp(block.timestamp + 2 days);
        vm.prank(keeper);
        vm.expectRevert("Not active"); // order deactivated on completion
        dca.executeDCA(orderId, 99 ether);
    }

    function test_executeDCA_completesOrder_returnsRemainder() public {
        // Deposit 150, 100 per exec, 1 max → 50 left over
        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            150 ether, 100 ether, 1, VibeDCA.Frequency.DAILY);

        vm.warp(block.timestamp + 1 days + 1);

        uint256 aliceTokenInBefore = tokenIn.balanceOf(alice);
        _executeAs(orderId, keeper, 99 ether);

        // Alice should get 50 ether remainder back
        assertEq(tokenIn.balanceOf(alice), aliceTokenInBefore + 50 ether);

        assertFalse(dca.getOrder(orderId).active);
    }

    function test_executeDCA_completesOrder_emitsDCACompleted() public {
        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            100 ether, 100 ether, 1, VibeDCA.Frequency.DAILY);

        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, false, false, false);
        emit DCACompleted(orderId);
        _executeAs(orderId, keeper, 99 ether);
    }

    function test_executeDCA_zeroAmountOut_skipsTokenOutTransfer() public {
        uint256 orderId = _createDefaultDCA();
        vm.warp(block.timestamp + 1 days + 1);

        uint256 aliceBefore = tokenOut.balanceOf(alice);
        _executeAs(orderId, keeper, 0); // keeper passes 0 for amountOut

        // Alice receives nothing (keeper didn't provide tokenOut)
        assertEq(tokenOut.balanceOf(alice), aliceBefore);
    }

    // ============ Cancel DCA ============

    function test_cancelDCA_returnsRemainder() public {
        uint256 orderId = _createDefaultDCA();
        vm.warp(block.timestamp + 1 days + 1);
        _executeAs(orderId, keeper, 99 ether); // 100 used, 1100 remaining

        uint256 aliceBefore = tokenIn.balanceOf(alice);
        vm.prank(alice);
        dca.cancelDCA(orderId);

        assertEq(tokenIn.balanceOf(alice), aliceBefore + 1100 ether);
    }

    function test_cancelDCA_deactivatesOrder() public {
        uint256 orderId = _createDefaultDCA();
        vm.prank(alice);
        dca.cancelDCA(orderId);

        assertFalse(dca.getOrder(orderId).active);
    }

    function test_cancelDCA_emitsEvent() public {
        uint256 orderId = _createDefaultDCA();

        vm.expectEmit(true, false, false, false);
        emit DCACancelled(orderId);

        vm.prank(alice);
        dca.cancelDCA(orderId);
    }

    function test_cancelDCA_notOwner_reverts() public {
        uint256 orderId = _createDefaultDCA();
        vm.prank(bob);
        vm.expectRevert("Not owner");
        dca.cancelDCA(orderId);
    }

    function test_cancelDCA_notActive_reverts() public {
        uint256 orderId = _createDefaultDCA();
        vm.prank(alice);
        dca.cancelDCA(orderId);

        vm.prank(alice);
        vm.expectRevert("Not active");
        dca.cancelDCA(orderId);
    }

    // ============ Frequency Intervals ============

    function test_frequency_hourly_interval() public {
        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            200 ether, 100 ether, 2, VibeDCA.Frequency.HOURLY);

        // Should not be executable immediately
        assertFalse(dca.isExecutable(orderId));

        vm.warp(block.timestamp + 1 hours + 1);
        assertTrue(dca.isExecutable(orderId));
    }

    function test_frequency_weekly_interval() public {
        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            200 ether, 100 ether, 2, VibeDCA.Frequency.WEEKLY);

        vm.warp(block.timestamp + 6 days);
        assertFalse(dca.isExecutable(orderId));

        vm.warp(block.timestamp + 1 days + 1); // total 7 days+1
        assertTrue(dca.isExecutable(orderId));
    }

    function test_frequency_biweekly_interval() public {
        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            200 ether, 100 ether, 2, VibeDCA.Frequency.BIWEEKLY);

        vm.warp(block.timestamp + 13 days);
        assertFalse(dca.isExecutable(orderId));

        vm.warp(block.timestamp + 1 days + 1);
        assertTrue(dca.isExecutable(orderId));
    }

    function test_frequency_monthly_interval() public {
        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            200 ether, 100 ether, 2, VibeDCA.Frequency.MONTHLY);

        vm.warp(block.timestamp + 29 days);
        assertFalse(dca.isExecutable(orderId));

        vm.warp(block.timestamp + 1 days + 1);
        assertTrue(dca.isExecutable(orderId));
    }

    function test_isExecutable_falseAfterExecution() public {
        uint256 orderId = _createDefaultDCA();
        vm.warp(block.timestamp + 1 days + 1);

        assertTrue(dca.isExecutable(orderId));
        _executeAs(orderId, keeper, 99 ether);

        assertFalse(dca.isExecutable(orderId));
    }

    // ============ Admin ============

    function test_setKeeperBounty_valid() public {
        dca.setKeeperBounty(200); // 2%
        assertEq(dca.keeperBountyBps(), 200);
    }

    function test_setKeeperBounty_maxAllowed() public {
        dca.setKeeperBounty(500); // 5% = max
        assertEq(dca.keeperBountyBps(), 500);
    }

    function test_setKeeperBounty_aboveMax_reverts() public {
        vm.expectRevert("Max 5%");
        dca.setKeeperBounty(501);
    }

    function test_setKeeperBounty_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        dca.setKeeperBounty(100);
    }

    // ============ View Helpers ============

    function test_getRemainingExecutions() public {
        uint256 orderId = _createDefaultDCA();
        assertEq(dca.getRemainingExecutions(orderId), 12);

        vm.warp(block.timestamp + 1 days + 1);
        _executeAs(orderId, keeper, 99 ether);

        assertEq(dca.getRemainingExecutions(orderId), 11);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle_completes() public {
        // 3 executions, daily, 300 total, 100 per exec
        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            300 ether, 100 ether, 3, VibeDCA.Frequency.DAILY);

        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + 1 days + 1);
            _executeAs(orderId, keeper, 95 ether);
        }

        assertEq(dca.getOrder(orderId).executionCount, dca.getOrder(orderId).maxExecutions);
        assertFalse(dca.getOrder(orderId).active);
        assertEq(dca.totalExecutions(), 3);
    }

    // ============ Fuzz ============

    function testFuzz_createDCA_validParams(
        uint256 total,
        uint256 perExec,
        uint256 maxExec
    ) public {
        maxExec = bound(maxExec, 1, 100);
        perExec = bound(perExec, 1 ether, 1000 ether);
        total   = perExec * maxExec; // exactly sufficient

        tokenIn.mint(alice, total);

        vm.prank(alice);
        uint256 orderId = dca.createDCA(address(tokenIn), address(tokenOut),
            total, perExec, maxExec, VibeDCA.Frequency.DAILY);

        assertEq(dca.getRemainingExecutions(orderId), maxExec);
    }
}
