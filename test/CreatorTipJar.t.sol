// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/CreatorTipJar.sol";

contract MockTipToken is ERC20 {
    constructor() ERC20("Mock", "MTK") {
        _mint(msg.sender, 1e24);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CreatorTipJarTest is Test {
    CreatorTipJar public jar;
    MockTipToken public token;
    address public creator;
    address public tipper1;
    address public tipper2;

    event EthTip(address indexed tipper, uint256 amount, string message);
    event TokenTip(address indexed tipper, address indexed token, uint256 amount, string message);
    event Withdrawal(address indexed token, uint256 amount);

    function setUp() public {
        creator = makeAddr("creator");
        tipper1 = makeAddr("tipper1");
        tipper2 = makeAddr("tipper2");

        jar = new CreatorTipJar(creator);
        token = new MockTipToken();

        // Fund tippers
        vm.deal(tipper1, 100 ether);
        vm.deal(tipper2, 100 ether);
        token.mint(tipper1, 1000e18);
        token.mint(tipper2, 1000e18);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(jar.creator(), creator);
        assertEq(jar.totalEthTips(), 0);
    }

    function test_constructor_zeroAddress() public {
        vm.expectRevert("Invalid creator address");
        new CreatorTipJar(address(0));
    }

    // ============ ETH Tips ============

    function test_tipEth() public {
        vm.prank(tipper1);
        jar.tipEth{value: 1 ether}("Great protocol!");

        assertEq(jar.totalEthTips(), 1 ether);
        assertEq(jar.tipperEthTotal(tipper1), 1 ether);
        assertEq(address(jar).balance, 1 ether);
    }

    function test_tipEth_multipleTips() public {
        vm.prank(tipper1);
        jar.tipEth{value: 1 ether}("Tip 1");

        vm.prank(tipper1);
        jar.tipEth{value: 2 ether}("Tip 2");

        assertEq(jar.totalEthTips(), 3 ether);
        assertEq(jar.tipperEthTotal(tipper1), 3 ether);
    }

    function test_tipEth_multipleTippers() public {
        vm.prank(tipper1);
        jar.tipEth{value: 1 ether}("");

        vm.prank(tipper2);
        jar.tipEth{value: 2 ether}("");

        assertEq(jar.totalEthTips(), 3 ether);
        assertEq(jar.tipperEthTotal(tipper1), 1 ether);
        assertEq(jar.tipperEthTotal(tipper2), 2 ether);
    }

    function test_tipEth_zeroReverts() public {
        vm.prank(tipper1);
        vm.expectRevert("Tip must be > 0");
        jar.tipEth{value: 0}("No tip");
    }

    function test_tipEth_emitsEvent() public {
        vm.prank(tipper1);
        vm.expectEmit(true, false, false, true);
        emit EthTip(tipper1, 1 ether, "Thanks!");
        jar.tipEth{value: 1 ether}("Thanks!");
    }

    // ============ Receive (direct ETH send) ============

    function test_receive_directEth() public {
        vm.prank(tipper1);
        (bool success,) = address(jar).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(jar.totalEthTips(), 1 ether);
        assertEq(jar.tipperEthTotal(tipper1), 1 ether);
    }

    // ============ Token Tips ============

    function test_tipToken() public {
        vm.prank(tipper1);
        token.approve(address(jar), 100e18);

        vm.prank(tipper1);
        jar.tipToken(address(token), 100e18, "Token tip!");

        assertEq(jar.totalTokenTips(address(token)), 100e18);
        assertEq(jar.tipperTokenTotal(tipper1, address(token)), 100e18);
        assertEq(token.balanceOf(address(jar)), 100e18);
    }

    function test_tipToken_multipleTips() public {
        vm.startPrank(tipper1);
        token.approve(address(jar), 300e18);
        jar.tipToken(address(token), 100e18, "");
        jar.tipToken(address(token), 200e18, "");
        vm.stopPrank();

        assertEq(jar.totalTokenTips(address(token)), 300e18);
        assertEq(jar.tipperTokenTotal(tipper1, address(token)), 300e18);
    }

    function test_tipToken_zeroAmountReverts() public {
        vm.prank(tipper1);
        vm.expectRevert("Tip must be > 0");
        jar.tipToken(address(token), 0, "");
    }

    function test_tipToken_zeroAddressReverts() public {
        vm.prank(tipper1);
        vm.expectRevert("Invalid token");
        jar.tipToken(address(0), 100e18, "");
    }

    function test_tipToken_emitsEvent() public {
        vm.prank(tipper1);
        token.approve(address(jar), 100e18);

        vm.prank(tipper1);
        vm.expectEmit(true, true, false, true);
        emit TokenTip(tipper1, address(token), 100e18, "Thanks!");
        jar.tipToken(address(token), 100e18, "Thanks!");
    }

    // ============ Withdraw ETH ============

    function test_withdrawEth() public {
        vm.prank(tipper1);
        jar.tipEth{value: 5 ether}("");

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        jar.withdrawEth();

        assertEq(creator.balance, balBefore + 5 ether);
        assertEq(address(jar).balance, 0);
    }

    function test_withdrawEth_onlyCreator() public {
        vm.prank(tipper1);
        jar.tipEth{value: 1 ether}("");

        vm.prank(tipper1);
        vm.expectRevert("Only creator");
        jar.withdrawEth();
    }

    function test_withdrawEth_noBalance() public {
        vm.prank(creator);
        vm.expectRevert("No ETH to withdraw");
        jar.withdrawEth();
    }

    function test_withdrawEth_emitsEvent() public {
        vm.prank(tipper1);
        jar.tipEth{value: 1 ether}("");

        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit Withdrawal(address(0), 1 ether);
        jar.withdrawEth();
    }

    // ============ Withdraw Token ============

    function test_withdrawToken() public {
        vm.prank(tipper1);
        token.approve(address(jar), 100e18);
        vm.prank(tipper1);
        jar.tipToken(address(token), 100e18, "");

        vm.prank(creator);
        jar.withdrawToken(address(token));

        assertEq(token.balanceOf(creator), 100e18);
        assertEq(token.balanceOf(address(jar)), 0);
    }

    function test_withdrawToken_onlyCreator() public {
        vm.prank(tipper1);
        token.approve(address(jar), 100e18);
        vm.prank(tipper1);
        jar.tipToken(address(token), 100e18, "");

        vm.prank(tipper1);
        vm.expectRevert("Only creator");
        jar.withdrawToken(address(token));
    }

    function test_withdrawToken_noBalance() public {
        vm.prank(creator);
        vm.expectRevert("No tokens to withdraw");
        jar.withdrawToken(address(token));
    }

    function test_withdrawToken_emitsEvent() public {
        vm.prank(tipper1);
        token.approve(address(jar), 100e18);
        vm.prank(tipper1);
        jar.tipToken(address(token), 100e18, "");

        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit Withdrawal(address(token), 100e18);
        jar.withdrawToken(address(token));
    }

    // ============ Views ============

    function test_getTipperEthTotal() public {
        vm.prank(tipper1);
        jar.tipEth{value: 3 ether}("");

        assertEq(jar.getTipperEthTotal(tipper1), 3 ether);
        assertEq(jar.getTipperEthTotal(tipper2), 0);
    }

    function test_getBalance() public {
        assertEq(jar.getBalance(), 0);

        vm.prank(tipper1);
        jar.tipEth{value: 5 ether}("");

        assertEq(jar.getBalance(), 5 ether);
    }

    function test_getTokenBalance() public {
        assertEq(jar.getTokenBalance(address(token)), 0);

        vm.prank(tipper1);
        token.approve(address(jar), 50e18);
        vm.prank(tipper1);
        jar.tipToken(address(token), 50e18, "");

        assertEq(jar.getTokenBalance(address(token)), 50e18);
    }
}
