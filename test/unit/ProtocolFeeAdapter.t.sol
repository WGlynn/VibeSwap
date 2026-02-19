// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/ProtocolFeeAdapter.sol";
import "../../contracts/core/FeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockAdapterToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped ETH", "WETH") {}
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 amount) external { _burn(msg.sender, amount); payable(msg.sender).transfer(amount); }
}

// ============ Test Contract ============

contract ProtocolFeeAdapterTest is Test {
    MockAdapterToken tokenA;
    MockAdapterToken tokenB;
    MockWETH weth;
    FeeRouter router;
    ProtocolFeeAdapter adapter;

    address treasury = address(0x1111);
    address insurance = address(0x2222);
    address revShare = address(0x3333);
    address buyback = address(0x4444);

    address alice = address(0xA11CE);

    function setUp() public {
        tokenA = new MockAdapterToken();
        tokenB = new MockAdapterToken();
        weth = new MockWETH();

        // Deploy FeeRouter
        router = new FeeRouter(treasury, insurance, revShare, buyback);

        // Deploy adapter
        adapter = new ProtocolFeeAdapter(address(router), address(weth));

        // Authorize adapter as fee source on router
        router.authorizeSource(address(adapter));
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(adapter.feeRouter(), address(router));
    }

    function test_constructor_revert_zeroRouter() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        new ProtocolFeeAdapter(address(0), address(weth));
    }

    function test_constructor_revert_zeroWeth() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        new ProtocolFeeAdapter(address(router), address(0));
    }

    // ============ Forward Fees Tests ============

    function test_forwardFees() public {
        // Simulate VibeAMM sending fees to adapter (as treasury)
        tokenA.mint(address(adapter), 1000 ether);

        // Forward to FeeRouter
        adapter.forwardFees(address(tokenA));

        // Adapter should be empty
        assertEq(tokenA.balanceOf(address(adapter)), 0);
        // FeeRouter should have the fees
        assertEq(router.pendingFees(address(tokenA)), 1000 ether);
        assertEq(adapter.totalForwarded(address(tokenA)), 1000 ether);
    }

    function test_forwardFees_multipleTokens() public {
        tokenA.mint(address(adapter), 500 ether);
        tokenB.mint(address(adapter), 300 ether);

        adapter.forwardFees(address(tokenA));
        adapter.forwardFees(address(tokenB));

        assertEq(router.pendingFees(address(tokenA)), 500 ether);
        assertEq(router.pendingFees(address(tokenB)), 300 ether);
    }

    function test_forwardFees_multipleRounds() public {
        tokenA.mint(address(adapter), 100 ether);
        adapter.forwardFees(address(tokenA));

        tokenA.mint(address(adapter), 200 ether);
        adapter.forwardFees(address(tokenA));

        assertEq(router.pendingFees(address(tokenA)), 300 ether);
        assertEq(adapter.totalForwarded(address(tokenA)), 300 ether);
    }

    function test_forwardFees_revert_zeroBalance() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAmount.selector);
        adapter.forwardFees(address(tokenA));
    }

    function test_forwardFees_revert_zeroAddress() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        adapter.forwardFees(address(0));
    }

    // ============ Forward ETH Tests ============

    function test_forwardETH() public {
        // Send ETH to adapter
        vm.deal(address(adapter), 5 ether);

        adapter.forwardETH();

        // ETH should be wrapped to WETH and forwarded to FeeRouter
        assertEq(address(adapter).balance, 0);
        assertEq(router.pendingFees(address(weth)), 5 ether);
        assertEq(adapter.totalETHForwarded(), 5 ether);
    }

    function test_forwardETH_revert_zeroBalance() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAmount.selector);
        adapter.forwardETH();
    }

    function test_receiveETH() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        (bool success,) = address(adapter).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(adapter).balance, 1 ether);
    }

    // ============ Full Flow Test ============

    function test_fullFlow_AMMToCooperativeDistribution() public {
        // Step 1: VibeAMM sends accumulated fees to adapter (as "treasury")
        tokenA.mint(address(adapter), 10_000 ether);

        // Step 2: Anyone triggers forwarding to FeeRouter
        adapter.forwardFees(address(tokenA));

        // Step 3: FeeRouter distributes cooperatively
        router.distribute(address(tokenA));

        // Step 4: Verify cooperative split (40/20/30/10)
        assertEq(tokenA.balanceOf(treasury), 4000 ether);
        assertEq(tokenA.balanceOf(insurance), 2000 ether);
        assertEq(tokenA.balanceOf(revShare), 3000 ether);
        assertEq(tokenA.balanceOf(buyback), 1000 ether);

        // Accounting
        assertEq(router.totalCollected(address(tokenA)), 10_000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 10_000 ether);
        assertEq(adapter.totalForwarded(address(tokenA)), 10_000 ether);
    }

    // ============ Admin Tests ============

    function test_setFeeRouter() public {
        address newRouter = address(0xBEEF);
        adapter.setFeeRouter(newRouter);
        assertEq(adapter.feeRouter(), newRouter);
    }

    function test_setFeeRouter_revert_zero() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        adapter.setFeeRouter(address(0));
    }

    function test_setFeeRouter_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        adapter.setFeeRouter(address(0xBEEF));
    }

    function test_recoverToken() public {
        tokenA.mint(address(adapter), 100 ether);

        address recovery = address(0x9999);
        adapter.recoverToken(address(tokenA), 50 ether, recovery);

        assertEq(tokenA.balanceOf(recovery), 50 ether);
        assertEq(tokenA.balanceOf(address(adapter)), 50 ether);
    }

    function test_recoverToken_revert_zeroAddress() public {
        vm.expectRevert(IProtocolFeeAdapter.ZeroAddress.selector);
        adapter.recoverToken(address(tokenA), 100 ether, address(0));
    }

    // ============ Receive for ETH forwarding ============

    receive() external payable {}
}
