// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeAgentTrading.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeAgentTradingTest is Test {
    // ============ Re-declare Events ============

    event VaultCreated(uint256 indexed vaultId, bytes32 indexed agentId, VibeAgentTrading.StrategyType strategy);
    event Deposited(uint256 indexed vaultId, address indexed depositor, uint256 amount, uint256 shares);
    event Withdrawn(uint256 indexed vaultId, address indexed depositor, uint256 amount, uint256 shares);
    event TradeExecuted(uint256 indexed vaultId, uint256 tradeId, bool isBuy, uint256 amount, int256 pnl);
    event VaultPaused(uint256 indexed vaultId, string reason);
    event CopyPositionOpened(uint256 indexed positionId, address indexed follower, uint256 vaultId);
    event PerformanceFeeCharged(uint256 indexed vaultId, uint256 fee);

    // ============ State ============

    VibeAgentTrading public trading;
    address public owner;
    address public manager;
    address public depositor1;
    address public depositor2;
    address public follower;

    bytes32 public constant AGENT_ID = keccak256("test-agent-1");
    bytes32 public constant PAIR_HASH = keccak256("ETH/USDC");
    uint256 public constant DEFAULT_DRAWDOWN = 2000;  // 20%
    uint256 public constant DEFAULT_PERF_FEE = 1000;  // 10%
    uint256 public constant DEFAULT_MGMT_FEE = 200;   // 2%

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        manager = makeAddr("manager");
        depositor1 = makeAddr("depositor1");
        depositor2 = makeAddr("depositor2");
        follower = makeAddr("follower");

        vm.deal(manager, 100 ether);
        vm.deal(depositor1, 100 ether);
        vm.deal(depositor2, 100 ether);
        vm.deal(follower, 100 ether);

        VibeAgentTrading impl = new VibeAgentTrading();
        bytes memory initData = abi.encodeWithSelector(VibeAgentTrading.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        trading = VibeAgentTrading(payable(address(proxy)));
    }

    // ============ Helpers ============

    function _createVault() internal returns (uint256 vaultId) {
        vm.prank(manager);
        vaultId = trading.createVault(
            AGENT_ID,
            VibeAgentTrading.StrategyType.MOMENTUM,
            DEFAULT_DRAWDOWN,
            DEFAULT_PERF_FEE,
            DEFAULT_MGMT_FEE
        );
    }

    function _depositToVault(uint256 vaultId, address dep, uint256 amount) internal {
        vm.prank(dep);
        trading.deposit{value: amount}(vaultId);
    }

    // ============ Vault Creation ============

    function test_CreateVault_Basic() public {
        vm.expectEmit(true, true, true, true);
        emit VaultCreated(1, AGENT_ID, VibeAgentTrading.StrategyType.MOMENTUM);

        uint256 vaultId = _createVault();
        assertEq(vaultId, 1);
        assertEq(trading.vaultCount(), 1);

        VibeAgentTrading.TradingVault memory vault = trading.getVault(vaultId);
        assertEq(vault.vaultId, 1);
        assertEq(vault.agentId, AGENT_ID);
        assertEq(vault.manager, manager);
        assertEq(uint8(vault.strategy), uint8(VibeAgentTrading.StrategyType.MOMENTUM));
        assertEq(uint8(vault.status), uint8(VibeAgentTrading.VaultStatus.ACTIVE));
        assertEq(vault.maxDrawdownBps, DEFAULT_DRAWDOWN);
        assertEq(vault.performanceFeeBps, DEFAULT_PERF_FEE);
        assertEq(vault.managementFeeBps, DEFAULT_MGMT_FEE);
        assertEq(vault.depositorCount, 0);
        assertEq(vault.totalDeposited, 0);
    }

    function test_CreateVault_AllStrategyTypes() public {
        VibeAgentTrading.StrategyType[7] memory strategies = [
            VibeAgentTrading.StrategyType.MOMENTUM,
            VibeAgentTrading.StrategyType.MEAN_REVERSION,
            VibeAgentTrading.StrategyType.ARBITRAGE,
            VibeAgentTrading.StrategyType.MARKET_MAKING,
            VibeAgentTrading.StrategyType.GRID,
            VibeAgentTrading.StrategyType.DCA,
            VibeAgentTrading.StrategyType.CUSTOM
        ];

        for (uint256 i = 0; i < strategies.length; i++) {
            vm.prank(manager);
            uint256 vaultId = trading.createVault(
                AGENT_ID,
                strategies[i],
                1000,
                500,
                100
            );
            VibeAgentTrading.TradingVault memory vault = trading.getVault(vaultId);
            assertEq(uint8(vault.strategy), uint8(strategies[i]));
        }
        assertEq(trading.vaultCount(), 7);
    }

    function test_CreateVault_RejectsHighPerformanceFee() public {
        vm.prank(manager);
        vm.expectRevert("Performance fee too high");
        trading.createVault(AGENT_ID, VibeAgentTrading.StrategyType.CUSTOM, 1000, 3001, 100);
    }

    function test_CreateVault_RejectsHighManagementFee() public {
        vm.prank(manager);
        vm.expectRevert("Management fee too high");
        trading.createVault(AGENT_ID, VibeAgentTrading.StrategyType.CUSTOM, 1000, 1000, 501);
    }

    function test_CreateVault_RejectsZeroDrawdown() public {
        vm.prank(manager);
        vm.expectRevert("Invalid drawdown");
        trading.createVault(AGENT_ID, VibeAgentTrading.StrategyType.CUSTOM, 0, 1000, 100);
    }

    function test_CreateVault_RejectsDrawdownOver5000() public {
        vm.prank(manager);
        vm.expectRevert("Invalid drawdown");
        trading.createVault(AGENT_ID, VibeAgentTrading.StrategyType.CUSTOM, 5001, 1000, 100);
    }

    function test_CreateVault_AcceptsMaxFees() public {
        vm.prank(manager);
        uint256 vaultId = trading.createVault(
            AGENT_ID,
            VibeAgentTrading.StrategyType.CUSTOM,
            5000,
            trading.MAX_PERFORMANCE_FEE(),
            trading.MAX_MANAGEMENT_FEE()
        );
        assertEq(vaultId, 1);
    }

    // ============ Deposits ============

    function test_Deposit_FirstDeposit() public {
        uint256 vaultId = _createVault();
        uint256 depositAmount = 1 ether;

        vm.expectEmit(true, true, false, true);
        emit Deposited(vaultId, depositor1, depositAmount, depositAmount);

        _depositToVault(vaultId, depositor1, depositAmount);

        VibeAgentTrading.TradingVault memory vault = trading.getVault(vaultId);
        assertEq(vault.totalDeposited, depositAmount);
        assertEq(vault.currentValue, depositAmount);
        assertEq(vault.depositorCount, 1);
        assertEq(vault.highWaterMark, depositAmount);

        VibeAgentTrading.Depositor memory dep = trading.getDepositor(vaultId, depositor1);
        assertEq(dep.shares, depositAmount);
        assertEq(dep.totalDeposited, depositAmount);
        assertEq(trading.totalShares(vaultId), depositAmount);
        assertEq(trading.totalValueLocked(), depositAmount);
    }

    function test_Deposit_ProportionalShares() public {
        uint256 vaultId = _createVault();

        // First deposit: 1 ether → 1 ether shares
        _depositToVault(vaultId, depositor1, 1 ether);

        // Second deposit: same value → same shares (1:1 ratio)
        _depositToVault(vaultId, depositor2, 1 ether);

        VibeAgentTrading.Depositor memory dep1 = trading.getDepositor(vaultId, depositor1);
        VibeAgentTrading.Depositor memory dep2 = trading.getDepositor(vaultId, depositor2);

        assertEq(dep1.shares, dep2.shares);
        assertEq(trading.totalShares(vaultId), 2 ether);
        assertEq(trading.getVault(vaultId).depositorCount, 2);
    }

    function test_Deposit_RejectsBelowMinimum() public {
        uint256 vaultId = _createVault();
        vm.prank(depositor1);
        vm.expectRevert("Below minimum");
        trading.deposit{value: trading.MIN_DEPOSIT() - 1}(vaultId);
    }

    function test_Deposit_RejectsInactiveVault() public {
        uint256 vaultId = _createVault();
        vm.prank(manager);
        trading.pauseVault(vaultId);

        vm.prank(depositor1);
        vm.expectRevert("Vault not active");
        trading.deposit{value: 1 ether}(vaultId);
    }

    function test_Deposit_IncrementsTVL() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 1 ether);
        _depositToVault(vaultId, depositor2, 2 ether);
        assertEq(trading.totalValueLocked(), 3 ether);
    }

    // ============ Withdrawals ============

    function test_Withdraw_FullShares() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 1 ether);

        uint256 balanceBefore = depositor1.balance;
        VibeAgentTrading.Depositor memory dep = trading.getDepositor(vaultId, depositor1);

        vm.expectEmit(true, true, false, true);
        emit Withdrawn(vaultId, depositor1, 1 ether, dep.shares);

        vm.prank(depositor1);
        trading.withdraw(vaultId, dep.shares);

        assertEq(depositor1.balance, balanceBefore + 1 ether);
        assertEq(trading.totalValueLocked(), 0);
        assertEq(trading.totalShares(vaultId), 0);
        assertEq(trading.getVault(vaultId).depositorCount, 0);
    }

    function test_Withdraw_PartialShares() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 2 ether);

        VibeAgentTrading.Depositor memory dep = trading.getDepositor(vaultId, depositor1);
        uint256 halfShares = dep.shares / 2;

        vm.prank(depositor1);
        trading.withdraw(vaultId, halfShares);

        VibeAgentTrading.Depositor memory depAfter = trading.getDepositor(vaultId, depositor1);
        assertEq(depAfter.shares, dep.shares - halfShares);
        assertEq(trading.getVault(vaultId).depositorCount, 1); // still has shares
    }

    function test_Withdraw_RejectsInsufficientShares() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 1 ether);

        VibeAgentTrading.Depositor memory dep = trading.getDepositor(vaultId, depositor1);

        vm.prank(depositor1);
        vm.expectRevert("Insufficient shares");
        trading.withdraw(vaultId, dep.shares + 1);
    }

    function test_Withdraw_RejectsZeroShares() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 1 ether);

        vm.prank(depositor1);
        vm.expectRevert("Zero shares");
        trading.withdraw(vaultId, 0);
    }

    // ============ Trade Recording ============

    function test_RecordTrade_ProfitableTrade() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 10 ether);

        uint256 valueBefore = trading.getVault(vaultId).currentValue;
        int256 pnl = 1 ether;

        vm.expectEmit(true, false, false, true);
        emit TradeExecuted(vaultId, 0, true, 1 ether, pnl);

        vm.prank(manager);
        trading.recordTrade(vaultId, PAIR_HASH, true, 1 ether, 3000e18, pnl);

        uint256 valueAfter = trading.getVault(vaultId).currentValue;
        assertGt(valueAfter, valueBefore); // value increased (after fees)
        assertEq(trading.totalTradesExecuted(), 1);
        assertEq(trading.getTradeCount(vaultId), 1);
    }

    function test_RecordTrade_LossTrade() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 10 ether);

        int256 pnl = -1 ether;
        vm.prank(manager);
        trading.recordTrade(vaultId, PAIR_HASH, false, 1 ether, 3000e18, pnl);

        VibeAgentTrading.TradingVault memory vault = trading.getVault(vaultId);
        assertEq(vault.currentValue, 9 ether);
        assertEq(trading.totalProfitGenerated(), 0);
    }

    function test_RecordTrade_UpdatesAgentPnL() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 10 ether);

        vm.prank(manager);
        trading.recordTrade(vaultId, PAIR_HASH, true, 1 ether, 3000e18, 2 ether);

        assertGt(trading.agentPnL(AGENT_ID), 0);
    }

    function test_RecordTrade_OnlyManagerOrOwner() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 10 ether);

        vm.prank(depositor1);
        vm.expectRevert("Not manager");
        trading.recordTrade(vaultId, PAIR_HASH, true, 1 ether, 3000e18, 0);
    }

    function test_RecordTrade_MaxDrawdownPausesVault() public {
        uint256 vaultId = _createVault(); // 20% drawdown limit
        _depositToVault(vaultId, depositor1, 10 ether);

        // Loss exceeding 20% drawdown triggers pause
        int256 bigLoss = -3 ether; // 30% loss

        vm.expectEmit(true, false, false, false);
        emit VaultPaused(vaultId, "Max drawdown reached");

        vm.prank(manager);
        trading.recordTrade(vaultId, PAIR_HASH, false, 1 ether, 3000e18, bigLoss);

        assertEq(uint8(trading.getVault(vaultId).status), uint8(VibeAgentTrading.VaultStatus.PAUSED));
    }

    function test_RecordTrade_PerformanceFeeCharged() public {
        uint256 vaultId = _createVault(); // 10% perf fee
        _depositToVault(vaultId, depositor1, 10 ether);

        uint256 managerBalanceBefore = manager.balance;

        // Profitable trade — should trigger performance fee
        vm.prank(manager);
        trading.recordTrade(vaultId, PAIR_HASH, true, 5 ether, 3000e18, 5 ether);

        // Manager should receive performance fee
        assertGt(manager.balance, managerBalanceBefore);
        assertGt(trading.totalFeesCollected(), 0);
    }

    function test_RecordTrade_OwnerCanRecord() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 10 ether);

        // Owner (address(this)) should be able to record
        trading.recordTrade(vaultId, PAIR_HASH, true, 1 ether, 3000e18, 0);
        assertEq(trading.getTradeCount(vaultId), 1);
    }

    // ============ Copy Trading ============

    function test_OpenCopyPosition() public {
        uint256 vaultId = _createVault();

        vm.expectEmit(true, true, false, true);
        emit CopyPositionOpened(1, follower, vaultId);

        vm.prank(follower);
        uint256 posId = trading.openCopyPosition{value: 1 ether}(vaultId, 100);

        assertEq(posId, 1);
        assertEq(trading.copyPositionCount(), 1);

        VibeAgentTrading.CopyPosition memory pos = trading.getCopyPosition(posId);
        assertEq(pos.follower, follower);
        assertEq(pos.vaultId, vaultId);
        assertEq(pos.amount, 1 ether);
        assertEq(pos.multiplier, 100);
        assertTrue(pos.active);
    }

    function test_OpenCopyPosition_RejectsInvalidMultiplier() public {
        uint256 vaultId = _createVault();

        vm.prank(follower);
        vm.expectRevert("Invalid multiplier");
        trading.openCopyPosition{value: 1 ether}(vaultId, 49);

        vm.prank(follower);
        vm.expectRevert("Invalid multiplier");
        trading.openCopyPosition{value: 1 ether}(vaultId, 201);
    }

    function test_OpenCopyPosition_RejectsBelowMinDeposit() public {
        uint256 vaultId = _createVault();

        vm.prank(follower);
        vm.expectRevert("Below minimum");
        trading.openCopyPosition{value: trading.MIN_DEPOSIT() - 1}(vaultId, 100);
    }

    function test_OpenCopyPosition_RejectsInactiveVault() public {
        uint256 vaultId = _createVault();
        vm.prank(manager);
        trading.pauseVault(vaultId);

        vm.prank(follower);
        vm.expectRevert("Not active");
        trading.openCopyPosition{value: 1 ether}(vaultId, 100);
    }

    function test_CloseCopyPosition_ReturnsAmount() public {
        uint256 vaultId = _createVault();

        vm.prank(follower);
        uint256 posId = trading.openCopyPosition{value: 1 ether}(vaultId, 100);

        uint256 balanceBefore = follower.balance;
        vm.prank(follower);
        trading.closeCopyPosition(posId);

        assertEq(follower.balance, balanceBefore + 1 ether);
        assertFalse(trading.getCopyPosition(posId).active);
    }

    function test_CloseCopyPosition_OnlyFollower() public {
        uint256 vaultId = _createVault();

        vm.prank(follower);
        uint256 posId = trading.openCopyPosition{value: 1 ether}(vaultId, 100);

        vm.prank(depositor1);
        vm.expectRevert("Not follower");
        trading.closeCopyPosition(posId);
    }

    function test_CloseCopyPosition_CannotCloseInactive() public {
        uint256 vaultId = _createVault();

        vm.prank(follower);
        uint256 posId = trading.openCopyPosition{value: 1 ether}(vaultId, 100);

        vm.prank(follower);
        trading.closeCopyPosition(posId);

        vm.prank(follower);
        vm.expectRevert("Not active");
        trading.closeCopyPosition(posId);
    }

    // ============ Vault Admin ============

    function test_PauseVault_Manager() public {
        uint256 vaultId = _createVault();

        vm.expectEmit(true, false, false, true);
        emit VaultPaused(vaultId, "Manual pause");

        vm.prank(manager);
        trading.pauseVault(vaultId);

        assertEq(uint8(trading.getVault(vaultId).status), uint8(VibeAgentTrading.VaultStatus.PAUSED));
    }

    function test_PauseVault_Owner() public {
        uint256 vaultId = _createVault();
        trading.pauseVault(vaultId);
        assertEq(uint8(trading.getVault(vaultId).status), uint8(VibeAgentTrading.VaultStatus.PAUSED));
    }

    function test_PauseVault_Unauthorized() public {
        uint256 vaultId = _createVault();

        vm.prank(depositor1);
        vm.expectRevert("Not authorized");
        trading.pauseVault(vaultId);
    }

    function test_ResumeVault() public {
        uint256 vaultId = _createVault();

        vm.prank(manager);
        trading.pauseVault(vaultId);

        vm.prank(manager);
        trading.resumeVault(vaultId);

        assertEq(uint8(trading.getVault(vaultId).status), uint8(VibeAgentTrading.VaultStatus.ACTIVE));
    }

    function test_ResumeVault_RejectsIfNotPaused() public {
        uint256 vaultId = _createVault();

        vm.prank(manager);
        vm.expectRevert("Not paused");
        trading.resumeVault(vaultId);
    }

    // ============ View Functions ============

    function test_GetVaultCount() public {
        assertEq(trading.getVaultCount(), 0);
        _createVault();
        assertEq(trading.getVaultCount(), 1);
        _createVault();
        assertEq(trading.getVaultCount(), 2);
    }

    function test_GetTradeCount() public {
        uint256 vaultId = _createVault();
        _depositToVault(vaultId, depositor1, 10 ether);

        assertEq(trading.getTradeCount(vaultId), 0);

        vm.prank(manager);
        trading.recordTrade(vaultId, PAIR_HASH, true, 1 ether, 3000e18, 0);

        assertEq(trading.getTradeCount(vaultId), 1);
    }

    // ============ Fuzz ============

    function testFuzz_CreateVault_FeeRange(uint256 perfFee, uint256 mgmtFee) public {
        perfFee = bound(perfFee, 0, trading.MAX_PERFORMANCE_FEE());
        mgmtFee = bound(mgmtFee, 0, trading.MAX_MANAGEMENT_FEE());

        vm.prank(manager);
        uint256 vaultId = trading.createVault(
            AGENT_ID,
            VibeAgentTrading.StrategyType.CUSTOM,
            1000,
            perfFee,
            mgmtFee
        );
        assertGt(vaultId, 0);
    }

    function testFuzz_Deposit_ShareCalc(uint256 amount) public {
        amount = bound(amount, trading.MIN_DEPOSIT(), 50 ether);

        uint256 vaultId = _createVault();
        vm.deal(depositor1, amount + 1 ether);

        vm.prank(depositor1);
        trading.deposit{value: amount}(vaultId);

        VibeAgentTrading.Depositor memory dep = trading.getDepositor(vaultId, depositor1);
        // First deposit: shares == amount
        assertEq(dep.shares, amount);
        assertEq(trading.totalShares(vaultId), amount);
    }
}
