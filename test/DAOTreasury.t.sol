// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/governance/DAOTreasury.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockVibeAMM {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }

    mapping(bytes32 => Pool) public pools;

    function setPool(bytes32 poolId, address t0, address t1) external {
        pools[poolId] = Pool({
            token0: t0,
            token1: t1,
            reserve0: 100 ether,
            reserve1: 100 ether,
            totalLiquidity: 100 ether,
            feeRate: 30,
            initialized: true
        });
    }

    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    function addLiquidity(
        bytes32,
        uint256 amount0,
        uint256 amount1,
        uint256,
        uint256
    ) external returns (uint256, uint256, uint256) {
        return (amount0, amount1, amount0);
    }
}

contract DAOTreasuryTest is Test {
    DAOTreasury public treasury;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockVibeAMM public mockAMM;

    address public owner;
    address public feeSender;
    address public recipient;

    event ProtocolFeesReceived(
        address indexed token,
        uint256 amount,
        uint64 indexed batchId
    );

    event AuctionProceedsReceived(
        uint256 amount,
        uint64 indexed batchId
    );

    event WithdrawalQueued(
        uint256 indexed requestId,
        address indexed recipient,
        address indexed token,
        uint256 amount,
        uint256 executeAfter
    );

    event WithdrawalExecuted(
        uint256 indexed requestId,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    function setUp() public {
        owner = address(this);
        feeSender = makeAddr("feeSender");
        recipient = makeAddr("recipient");

        // Deploy tokens
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");

        // Deploy mock AMM
        mockAMM = new MockVibeAMM();

        // Deploy treasury
        DAOTreasury impl = new DAOTreasury();
        bytes memory initData = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            address(mockAMM)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        treasury = DAOTreasury(payable(address(proxy)));

        // Authorize fee sender
        treasury.setAuthorizedFeeSender(feeSender, true);

        // Mint tokens
        tokenA.mint(feeSender, 1000 ether);
        tokenB.mint(feeSender, 1000 ether);
        tokenA.mint(address(treasury), 100 ether);
        tokenB.mint(address(treasury), 100 ether);

        // Approvals
        vm.prank(feeSender);
        tokenA.approve(address(treasury), type(uint256).max);
        vm.prank(feeSender);
        tokenB.approve(address(treasury), type(uint256).max);

        // Fund treasury with ETH
        vm.deal(address(treasury), 10 ether);
    }

    // ============ Initialization Tests ============

    function test_initialization() public view {
        assertEq(treasury.vibeAMM(), address(mockAMM));
        assertEq(treasury.timelockDuration(), 2 days);
        assertEq(treasury.nextRequestId(), 1);
    }

    // ============ Fee Reception Tests ============

    function test_receiveProtocolFees() public {
        vm.prank(feeSender);
        vm.expectEmit(true, false, true, true);
        emit ProtocolFeesReceived(address(tokenA), 10 ether, 1);

        treasury.receiveProtocolFees(address(tokenA), 10 ether, 1);

        assertEq(treasury.totalFeesReceived(address(tokenA)), 10 ether);
        assertEq(tokenA.balanceOf(address(treasury)), 110 ether);
    }

    function test_receiveProtocolFees_unauthorized() public {
        vm.prank(recipient);
        vm.expectRevert("Not authorized");
        treasury.receiveProtocolFees(address(tokenA), 10 ether, 1);
    }

    function test_receiveAuctionProceeds() public {
        vm.expectEmit(false, true, true, true);
        emit AuctionProceedsReceived(1 ether, 1);

        treasury.receiveAuctionProceeds{value: 1 ether}(1);

        assertEq(treasury.totalAuctionProceeds(), 1 ether);
    }

    // ============ Backstop Configuration Tests ============

    function test_configureBackstop() public {
        treasury.configureBackstop(
            address(tokenA),
            100 ether,      // target reserve
            0.1e18,         // 10% smoothing factor
            true            // is store of value
        );

        IDAOTreasury.BackstopConfig memory config = treasury.getBackstopConfig(address(tokenA));
        assertEq(config.token, address(tokenA));
        assertEq(config.targetReserve, 100 ether);
        assertEq(config.smoothingFactor, 0.1e18);
        assertTrue(config.isStoreOfValue);
        assertTrue(config.isActive);
    }

    function test_configureBackstop_updatesReserve() public {
        treasury.configureBackstop(address(tokenA), 100 ether, 0.1e18, true);

        // Receive fees
        vm.prank(feeSender);
        treasury.receiveProtocolFees(address(tokenA), 10 ether, 1);

        IDAOTreasury.BackstopConfig memory config = treasury.getBackstopConfig(address(tokenA));
        assertEq(config.currentReserve, 10 ether);
    }

    function test_checkBackstopReserves() public {
        treasury.configureBackstop(address(tokenA), 100 ether, 0.1e18, true);

        (bool sufficient, uint256 deficit) = treasury.checkBackstopReserves(address(tokenA));
        assertFalse(sufficient);
        assertEq(deficit, 100 ether);

        // Add reserves
        vm.prank(feeSender);
        treasury.receiveProtocolFees(address(tokenA), 100 ether, 1);

        (sufficient, deficit) = treasury.checkBackstopReserves(address(tokenA));
        assertTrue(sufficient);
        assertEq(deficit, 0);
    }

    // ============ Price Smoothing Tests ============

    function test_calculateSmoothedPrice_noHistory() public {
        treasury.configureBackstop(address(tokenA), 100 ether, 0.1e18, true);

        uint256 smoothed = treasury.calculateSmoothedPrice(address(tokenA), 1000);
        assertEq(smoothed, 1000); // No history, returns current
    }

    function test_calculateSmoothedPrice_withHistory() public {
        treasury.configureBackstop(address(tokenA), 100 ether, 0.2e18, true);

        // Update price to establish history
        vm.prank(feeSender);
        treasury.updateSmoothedPrice(address(tokenA), 1000);

        // Calculate smoothed price with new value
        uint256 smoothed = treasury.calculateSmoothedPrice(address(tokenA), 1100);

        // EMA: 0.2 * 1100 + 0.8 * 1000 = 220 + 800 = 1020
        assertEq(smoothed, 1020);
    }

    // ============ Withdrawal Tests ============

    function test_queueWithdrawal() public {
        vm.expectEmit(true, true, true, true);
        emit WithdrawalQueued(1, recipient, address(tokenA), 10 ether, block.timestamp + 2 days);

        uint256 requestId = treasury.queueWithdrawal(recipient, address(tokenA), 10 ether);

        assertEq(requestId, 1);

        IDAOTreasury.WithdrawalRequest memory request = treasury.getWithdrawalRequest(1);
        assertEq(request.recipient, recipient);
        assertEq(request.token, address(tokenA));
        assertEq(request.amount, 10 ether);
        assertEq(request.executeAfter, block.timestamp + 2 days);
        assertFalse(request.executed);
        assertFalse(request.cancelled);
    }

    function test_queueWithdrawal_eth() public {
        uint256 requestId = treasury.queueWithdrawal(recipient, address(0), 1 ether);

        IDAOTreasury.WithdrawalRequest memory request = treasury.getWithdrawalRequest(requestId);
        assertEq(request.token, address(0));
        assertEq(request.amount, 1 ether);
    }

    function test_executeWithdrawal() public {
        uint256 requestId = treasury.queueWithdrawal(recipient, address(tokenA), 10 ether);

        // Fast forward past timelock
        vm.warp(block.timestamp + 2 days + 1);

        uint256 balanceBefore = tokenA.balanceOf(recipient);

        vm.expectEmit(true, true, true, true);
        emit WithdrawalExecuted(requestId, recipient, address(tokenA), 10 ether);

        treasury.executeWithdrawal(requestId);

        assertEq(tokenA.balanceOf(recipient), balanceBefore + 10 ether);

        IDAOTreasury.WithdrawalRequest memory request = treasury.getWithdrawalRequest(requestId);
        assertTrue(request.executed);
    }

    function test_executeWithdrawal_eth() public {
        uint256 requestId = treasury.queueWithdrawal(recipient, address(0), 1 ether);

        vm.warp(block.timestamp + 2 days + 1);

        uint256 balanceBefore = recipient.balance;
        treasury.executeWithdrawal(requestId);

        assertEq(recipient.balance, balanceBefore + 1 ether);
    }

    function test_executeWithdrawal_tooEarly() public {
        uint256 requestId = treasury.queueWithdrawal(recipient, address(tokenA), 10 ether);

        vm.expectRevert("Timelock active");
        treasury.executeWithdrawal(requestId);
    }

    function test_executeWithdrawal_alreadyExecuted() public {
        uint256 requestId = treasury.queueWithdrawal(recipient, address(tokenA), 10 ether);

        vm.warp(block.timestamp + 2 days + 1);
        treasury.executeWithdrawal(requestId);

        vm.expectRevert("Already executed");
        treasury.executeWithdrawal(requestId);
    }

    function test_cancelWithdrawal() public {
        uint256 requestId = treasury.queueWithdrawal(recipient, address(tokenA), 10 ether);

        treasury.cancelWithdrawal(requestId);

        IDAOTreasury.WithdrawalRequest memory request = treasury.getWithdrawalRequest(requestId);
        assertTrue(request.cancelled);
    }

    function test_cancelWithdrawal_cannotExecuteCancelled() public {
        uint256 requestId = treasury.queueWithdrawal(recipient, address(tokenA), 10 ether);
        treasury.cancelWithdrawal(requestId);

        vm.warp(block.timestamp + 2 days + 1);

        vm.expectRevert("Cancelled");
        treasury.executeWithdrawal(requestId);
    }

    // ============ Balance Tests ============

    function test_getBalance_token() public view {
        uint256 balance = treasury.getBalance(address(tokenA));
        assertEq(balance, 100 ether);
    }

    function test_getBalance_eth() public view {
        uint256 balance = treasury.getBalance(address(0));
        assertEq(balance, 10 ether);
    }

    // ============ Admin Tests ============

    function test_setTimelockDuration() public {
        treasury.setTimelockDuration(7 days);
        assertEq(treasury.timelockDuration(), 7 days);
    }

    function test_setTimelockDuration_exceedsMax() public {
        vm.expectRevert("Exceeds maximum");
        treasury.setTimelockDuration(31 days);
    }

    function test_deactivateBackstop() public {
        treasury.configureBackstop(address(tokenA), 100 ether, 0.1e18, true);

        treasury.deactivateBackstop(address(tokenA));

        IDAOTreasury.BackstopConfig memory config = treasury.getBackstopConfig(address(tokenA));
        assertFalse(config.isActive);
    }

    // ============ Emergency Withdrawal (Governed) Tests ============

    function test_queueEmergencyWithdraw() public {
        uint256 emergencyId = treasury.queueEmergencyWithdraw(address(tokenA), recipient, 50 ether);
        (address token, address recip, uint256 amount, uint256 executeAfter, bool executed, bool cancelled, bool guardianApproved) = treasury.emergencyRequests(emergencyId);
        assertEq(token, address(tokenA));
        assertEq(recip, recipient);
        assertEq(amount, 50 ether);
        assertEq(executeAfter, block.timestamp + 6 hours);
        assertFalse(executed);
        assertFalse(cancelled);
        assertTrue(guardianApproved); // no guardian set, auto-approved
    }

    function test_executeEmergencyWithdraw_token() public {
        uint256 emergencyId = treasury.queueEmergencyWithdraw(address(tokenA), recipient, 50 ether);
        vm.warp(block.timestamp + 6 hours + 1);

        uint256 balanceBefore = tokenA.balanceOf(recipient);
        treasury.executeEmergencyWithdraw(emergencyId);
        assertEq(tokenA.balanceOf(recipient), balanceBefore + 50 ether);
    }

    function test_executeEmergencyWithdraw_eth() public {
        uint256 emergencyId = treasury.queueEmergencyWithdraw(address(0), recipient, 5 ether);
        vm.warp(block.timestamp + 6 hours + 1);

        uint256 balanceBefore = recipient.balance;
        treasury.executeEmergencyWithdraw(emergencyId);
        assertEq(recipient.balance, balanceBefore + 5 ether);
    }

    function test_executeEmergencyWithdraw_tooEarly() public {
        uint256 emergencyId = treasury.queueEmergencyWithdraw(address(tokenA), recipient, 50 ether);
        vm.expectRevert("Emergency timelock active");
        treasury.executeEmergencyWithdraw(emergencyId);
    }

    function test_cancelEmergencyWithdraw() public {
        uint256 emergencyId = treasury.queueEmergencyWithdraw(address(tokenA), recipient, 50 ether);
        treasury.cancelEmergencyWithdraw(emergencyId);

        vm.warp(block.timestamp + 6 hours + 1);
        vm.expectRevert("Cancelled");
        treasury.executeEmergencyWithdraw(emergencyId);
    }

    function test_emergencyGuardian_required() public {
        address guardian = makeAddr("guardian");
        treasury.setEmergencyGuardian(guardian);

        uint256 emergencyId = treasury.queueEmergencyWithdraw(address(tokenA), recipient, 50 ether);
        vm.warp(block.timestamp + 6 hours + 1);

        // Fails without guardian approval
        vm.expectRevert("Guardian approval required");
        treasury.executeEmergencyWithdraw(emergencyId);

        // Guardian approves
        vm.prank(guardian);
        treasury.approveEmergencyWithdraw(emergencyId);

        // Now succeeds
        uint256 balanceBefore = tokenA.balanceOf(recipient);
        treasury.executeEmergencyWithdraw(emergencyId);
        assertEq(tokenA.balanceOf(recipient), balanceBefore + 50 ether);
    }

    function test_emergencyGuardian_onlyGuardian() public {
        address guardian = makeAddr("guardian");
        treasury.setEmergencyGuardian(guardian);

        uint256 emergencyId = treasury.queueEmergencyWithdraw(address(tokenA), recipient, 50 ether);

        vm.prank(makeAddr("rando"));
        vm.expectRevert("Not emergency guardian");
        treasury.approveEmergencyWithdraw(emergencyId);
    }

    function test_setEmergencyGuardian() public {
        address guardian = makeAddr("guardian");
        treasury.setEmergencyGuardian(guardian);
        assertEq(treasury.emergencyGuardian(), guardian);
    }

    // ============ Backstop Operator Tests ============

    function test_setBackstopOperator() public {
        address operator = makeAddr("stabilizer");
        treasury.setBackstopOperator(operator, true);
        assertTrue(treasury.backstopOperators(operator));

        treasury.setBackstopOperator(operator, false);
        assertFalse(treasury.backstopOperators(operator));
    }

    function test_setBackstopOperator_onlyOwner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        treasury.setBackstopOperator(makeAddr("stabilizer"), true);
    }

    function test_setBackstopOperator_zeroAddress_reverts() public {
        vm.expectRevert("Invalid operator");
        treasury.setBackstopOperator(address(0), true);
    }
}
