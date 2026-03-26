// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/ProtocolFeeAdapter.sol";

// ============ Mock Contracts ============

/// @notice Minimal ERC20 for testing token forwarding and recovery
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Minimal WETH mock that wraps/unwraps ETH
contract MockWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function totalSupply() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
    }
}

/// @notice Mock FeeRouter that records collectFee calls and holds tokens
contract MockFeeRouter {
    struct CollectCall {
        address token;
        uint256 amount;
        address caller;
    }

    CollectCall[] public calls;
    uint256 public callCount;

    function collectFee(address token, uint256 amount) external {
        // Pull tokens from caller (the adapter)
        // SafeERC20 in the adapter already approved us
        (bool success, ) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        require(success, "MockFeeRouter: transferFrom failed");

        calls.push(CollectCall({token: token, amount: amount, caller: msg.sender}));
        callCount++;
    }

    function getCall(uint256 index) external view returns (address token, uint256 amount, address caller) {
        CollectCall memory c = calls[index];
        return (c.token, c.amount, c.caller);
    }
}

// ============ Test Contract ============

contract ProtocolFeeAdapterTest is Test {
    ProtocolFeeAdapter public adapter;
    MockFeeRouter public feeRouter;
    MockWETH public weth;
    MockERC20 public token;

    address public owner;
    address public alice;
    address public bob;

    // ============ Events (must match IProtocolFeeAdapter) ============

    event FeeForwarded(address indexed token, uint256 amount, address indexed source);
    event ETHForwarded(uint256 amount, address indexed source);
    event FeeRouterUpdated(address indexed newRouter);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        feeRouter = new MockFeeRouter();
        weth = new MockWETH();
        token = new MockERC20("Test Token", "TST");

        adapter = new ProtocolFeeAdapter(address(feeRouter), address(weth));
    }

    // ============ Constructor ============

    function test_constructor_setsParamsCorrectly() public view {
        assertEq(adapter.feeRouter(), address(feeRouter));
        assertEq(adapter.weth(), address(weth));
        assertEq(adapter.owner(), owner);
    }

    function test_constructor_revertsOnZeroFeeRouter() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        new ProtocolFeeAdapter(address(0), address(weth));
    }

    function test_constructor_revertsOnZeroWeth() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        new ProtocolFeeAdapter(address(feeRouter), address(0));
    }

    function test_constructor_revertsOnBothZero() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        new ProtocolFeeAdapter(address(0), address(0));
    }

    // ============ forwardFees ============

    function test_forwardFees_forwardsFullBalance() public {
        uint256 amount = 1000 ether;
        token.mint(address(adapter), amount);

        vm.expectEmit(true, true, false, true);
        emit FeeForwarded(address(token), amount, address(this));

        adapter.forwardFees(address(token));

        // Tokens moved to FeeRouter
        assertEq(token.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(address(feeRouter)), amount);

        // FeeRouter recorded the call
        assertEq(feeRouter.callCount(), 1);
        (address callToken, uint256 callAmount, address callCaller) = feeRouter.getCall(0);
        assertEq(callToken, address(token));
        assertEq(callAmount, amount);
        assertEq(callCaller, address(adapter));
    }

    function test_forwardFees_updatesTotalForwarded() public {
        uint256 amount1 = 500 ether;
        uint256 amount2 = 300 ether;

        // First forward
        token.mint(address(adapter), amount1);
        adapter.forwardFees(address(token));
        assertEq(adapter.totalForwarded(address(token)), amount1);

        // Second forward accumulates
        token.mint(address(adapter), amount2);
        adapter.forwardFees(address(token));
        assertEq(adapter.totalForwarded(address(token)), amount1 + amount2);
    }

    function test_forwardFees_tracksSeparateTokens() public {
        MockERC20 tokenB = new MockERC20("Token B", "TKB");

        token.mint(address(adapter), 100 ether);
        tokenB.mint(address(adapter), 200 ether);

        adapter.forwardFees(address(token));
        adapter.forwardFees(address(tokenB));

        assertEq(adapter.totalForwarded(address(token)), 100 ether);
        assertEq(adapter.totalForwarded(address(tokenB)), 200 ether);
    }

    function test_forwardFees_revertsOnZeroBalance() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAmount.selector);
        adapter.forwardFees(address(token));
    }

    function test_forwardFees_revertsOnZeroAddress() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        adapter.forwardFees(address(0));
    }

    function test_forwardFees_callableByAnyone() public {
        token.mint(address(adapter), 100 ether);

        vm.prank(alice);
        adapter.forwardFees(address(token));

        assertEq(token.balanceOf(address(feeRouter)), 100 ether);
    }

    function test_forwardFees_emitsEventWithCorrectSource() public {
        token.mint(address(adapter), 50 ether);

        vm.expectEmit(true, true, false, true);
        emit FeeForwarded(address(token), 50 ether, alice);

        vm.prank(alice);
        adapter.forwardFees(address(token));
    }

    // ============ forwardETH ============

    function test_forwardETH_wrapsAndForwards() public {
        uint256 amount = 5 ether;
        vm.deal(address(adapter), amount);

        vm.expectEmit(true, false, false, true);
        emit ETHForwarded(amount, address(this));

        adapter.forwardETH();

        // ETH drained from adapter
        assertEq(address(adapter).balance, 0);

        // WETH forwarded to FeeRouter
        assertEq(weth.balanceOf(address(feeRouter)), amount);

        // FeeRouter recorded the call with WETH token
        assertEq(feeRouter.callCount(), 1);
        (address callToken, uint256 callAmount, ) = feeRouter.getCall(0);
        assertEq(callToken, address(weth));
        assertEq(callAmount, amount);
    }

    function test_forwardETH_updatesTotalETHForwarded() public {
        vm.deal(address(adapter), 3 ether);
        adapter.forwardETH();
        assertEq(adapter.totalETHForwarded(), 3 ether);

        vm.deal(address(adapter), 2 ether);
        adapter.forwardETH();
        assertEq(adapter.totalETHForwarded(), 5 ether);
    }

    function test_forwardETH_revertsOnZeroBalance() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAmount.selector);
        adapter.forwardETH();
    }

    function test_forwardETH_callableByAnyone() public {
        vm.deal(address(adapter), 1 ether);

        vm.prank(alice);
        adapter.forwardETH();

        assertEq(weth.balanceOf(address(feeRouter)), 1 ether);
    }

    function test_forwardETH_includesMessageValue() public {
        // Send ETH with the call — adapter.balance includes msg.value
        vm.deal(address(adapter), 2 ether);
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        adapter.forwardETH{value: 1 ether}();

        // Total forwarded = adapter balance (2) + msg.value (1) = 3 ether
        assertEq(adapter.totalETHForwarded(), 3 ether);
        assertEq(weth.balanceOf(address(feeRouter)), 3 ether);
    }

    function test_forwardETH_emitsEventWithCorrectSource() public {
        vm.deal(address(adapter), 1 ether);

        vm.expectEmit(true, true, false, true);
        emit ETHForwarded(1 ether, bob);

        vm.prank(bob);
        adapter.forwardETH();
    }

    // ============ receive ============

    function test_receive_acceptsETH() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        (bool success, ) = address(adapter).call{value: 5 ether}("");
        assertTrue(success);
        assertEq(address(adapter).balance, 5 ether);
    }

    function test_receive_acceptsMultipleDeposits() public {
        vm.deal(alice, 10 ether);

        vm.prank(alice);
        (bool s1, ) = address(adapter).call{value: 3 ether}("");
        assertTrue(s1);

        vm.prank(alice);
        (bool s2, ) = address(adapter).call{value: 2 ether}("");
        assertTrue(s2);

        assertEq(address(adapter).balance, 5 ether);
    }

    // ============ setFeeRouter ============

    function test_setFeeRouter_updatesRouter() public {
        address newRouter = makeAddr("newRouter");

        vm.expectEmit(true, false, false, false);
        emit FeeRouterUpdated(newRouter);

        adapter.setFeeRouter(newRouter);
        assertEq(adapter.feeRouter(), newRouter);
    }

    function test_setFeeRouter_revertsOnZeroAddress() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        adapter.setFeeRouter(address(0));
    }

    function test_setFeeRouter_onlyOwner() public {
        address newRouter = makeAddr("newRouter");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        adapter.setFeeRouter(newRouter);
    }

    function test_setFeeRouter_forwardUsesNewRouter() public {
        MockFeeRouter newRouter = new MockFeeRouter();
        adapter.setFeeRouter(address(newRouter));

        token.mint(address(adapter), 100 ether);
        adapter.forwardFees(address(token));

        // Old router should have nothing
        assertEq(feeRouter.callCount(), 0);
        // New router should have the tokens
        assertEq(newRouter.callCount(), 1);
        assertEq(token.balanceOf(address(newRouter)), 100 ether);
    }

    // ============ recoverToken ============

    function test_recoverToken_sendsTokensToRecipient() public {
        uint256 amount = 100 ether;
        token.mint(address(adapter), amount);

        adapter.recoverToken(address(token), amount, alice);

        assertEq(token.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(alice), amount);
    }

    function test_recoverToken_partialRecovery() public {
        token.mint(address(adapter), 100 ether);

        adapter.recoverToken(address(token), 40 ether, alice);

        assertEq(token.balanceOf(address(adapter)), 60 ether);
        assertEq(token.balanceOf(alice), 40 ether);
    }

    function test_recoverToken_revertsOnZeroAddressRecipient() public {
        token.mint(address(adapter), 100 ether);

        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        adapter.recoverToken(address(token), 100 ether, address(0));
    }

    function test_recoverToken_onlyOwner() public {
        token.mint(address(adapter), 100 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        adapter.recoverToken(address(token), 100 ether, alice);
    }

    function test_recoverToken_canRecoverWETH() public {
        // WETH stuck in adapter can be recovered
        vm.deal(address(this), 5 ether);
        // Deposit WETH directly to adapter by minting via deposit trick
        weth.deposit{value: 5 ether}();
        // Transfer WETH to adapter
        weth.transfer(address(adapter), 5 ether);

        adapter.recoverToken(address(weth), 5 ether, bob);
        assertEq(weth.balanceOf(bob), 5 ether);
    }

    // ============ View Functions ============

    function test_view_feeRouter() public view {
        assertEq(adapter.feeRouter(), address(feeRouter));
    }

    function test_view_weth() public view {
        assertEq(adapter.weth(), address(weth));
    }

    function test_view_totalForwarded_defaultsToZero() public view {
        assertEq(adapter.totalForwarded(address(token)), 0);
        assertEq(adapter.totalForwarded(alice), 0);
    }

    function test_view_totalETHForwarded_defaultsToZero() public view {
        assertEq(adapter.totalETHForwarded(), 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_forwardFees_anyAmount(uint256 amount) public {
        vm.assume(amount > 0 && amount < type(uint128).max);

        token.mint(address(adapter), amount);
        adapter.forwardFees(address(token));

        assertEq(token.balanceOf(address(feeRouter)), amount);
        assertEq(adapter.totalForwarded(address(token)), amount);
    }

    function testFuzz_forwardETH_anyAmount(uint256 amount) public {
        vm.assume(amount > 0 && amount < 1_000_000 ether);

        vm.deal(address(adapter), amount);
        adapter.forwardETH();

        assertEq(weth.balanceOf(address(feeRouter)), amount);
        assertEq(adapter.totalETHForwarded(), amount);
    }

    function testFuzz_recoverToken_anyAmount(uint256 mintAmount, uint256 recoverAmount) public {
        vm.assume(mintAmount > 0 && mintAmount < type(uint128).max);
        vm.assume(recoverAmount > 0 && recoverAmount <= mintAmount);

        token.mint(address(adapter), mintAmount);
        adapter.recoverToken(address(token), recoverAmount, alice);

        assertEq(token.balanceOf(alice), recoverAmount);
        assertEq(token.balanceOf(address(adapter)), mintAmount - recoverAmount);
    }

    // ============ Integration-style ============

    function test_fullFlow_feesCollectedAndForwarded() public {
        // Simulate VibeAMM sending fees to adapter (as "treasury")
        token.mint(address(adapter), 1000 ether);

        // Anyone triggers forwarding
        vm.prank(alice);
        adapter.forwardFees(address(token));

        // Verify entire flow
        assertEq(token.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(address(feeRouter)), 1000 ether);
        assertEq(adapter.totalForwarded(address(token)), 1000 ether);
        assertEq(feeRouter.callCount(), 1);
    }

    function test_fullFlow_ethPriorityBidsForwarded() public {
        // Simulate VibeSwapCore sending priority bid ETH
        vm.deal(address(adapter), 10 ether);

        vm.prank(bob);
        adapter.forwardETH();

        // ETH wrapped to WETH and forwarded
        assertEq(address(adapter).balance, 0);
        assertEq(weth.balanceOf(address(feeRouter)), 10 ether);
        assertEq(adapter.totalETHForwarded(), 10 ether);
    }

    function test_fullFlow_multipleTokensMultipleForwards() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");

        // Round 1
        tokenA.mint(address(adapter), 100 ether);
        tokenB.mint(address(adapter), 200 ether);
        adapter.forwardFees(address(tokenA));
        adapter.forwardFees(address(tokenB));

        // Round 2
        tokenA.mint(address(adapter), 50 ether);
        adapter.forwardFees(address(tokenA));

        // Verify totals
        assertEq(adapter.totalForwarded(address(tokenA)), 150 ether);
        assertEq(adapter.totalForwarded(address(tokenB)), 200 ether);
        assertEq(feeRouter.callCount(), 3);
    }
}
