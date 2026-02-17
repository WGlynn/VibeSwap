// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/CreatorTipJar.sol";

contract MockFuzzTipToken is ERC20 {
    constructor() ERC20("Mock", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract CreatorTipJarFuzzTest is Test {
    CreatorTipJar public jar;
    MockFuzzTipToken public token;
    address public creator;

    function setUp() public {
        creator = makeAddr("creator");
        jar = new CreatorTipJar(creator);
        token = new MockFuzzTipToken();
    }

    /// @notice ETH tips accumulate correctly for any amount
    function testFuzz_ethTipsAccumulate(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1, 100 ether);
        amount2 = bound(amount2, 1, 100 ether);
        address tipper = makeAddr("tipper");
        vm.deal(tipper, amount1 + amount2);

        vm.prank(tipper);
        jar.tipEth{value: amount1}("");
        vm.prank(tipper);
        jar.tipEth{value: amount2}("");

        assertEq(jar.totalEthTips(), amount1 + amount2);
        assertEq(jar.tipperEthTotal(tipper), amount1 + amount2);
        assertEq(address(jar).balance, amount1 + amount2);
    }

    /// @notice Token tips accumulate correctly for any amount
    function testFuzz_tokenTipsAccumulate(uint256 amount) public {
        amount = bound(amount, 1, 1e24);
        address tipper = makeAddr("tipper");
        token.mint(tipper, amount);

        vm.prank(tipper);
        token.approve(address(jar), amount);
        vm.prank(tipper);
        jar.tipToken(address(token), amount, "");

        assertEq(jar.totalTokenTips(address(token)), amount);
        assertEq(token.balanceOf(address(jar)), amount);
    }

    /// @notice Creator can withdraw any ETH balance
    function testFuzz_withdrawEth(uint256 amount) public {
        amount = bound(amount, 1, 100 ether);
        address tipper = makeAddr("tipper");
        vm.deal(tipper, amount);

        vm.prank(tipper);
        jar.tipEth{value: amount}("");

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        jar.withdrawEth();

        assertEq(creator.balance, balBefore + amount);
        assertEq(address(jar).balance, 0);
    }

    /// @notice Creator can withdraw any token balance
    function testFuzz_withdrawToken(uint256 amount) public {
        amount = bound(amount, 1, 1e24);
        address tipper = makeAddr("tipper");
        token.mint(tipper, amount);

        vm.prank(tipper);
        token.approve(address(jar), amount);
        vm.prank(tipper);
        jar.tipToken(address(token), amount, "");

        vm.prank(creator);
        jar.withdrawToken(address(token));

        assertEq(token.balanceOf(creator), amount);
        assertEq(token.balanceOf(address(jar)), 0);
    }

    /// @notice Multiple tippers tracked independently
    function testFuzz_multipleTippersIndependent(uint256 amt1, uint256 amt2) public {
        amt1 = bound(amt1, 1, 50 ether);
        amt2 = bound(amt2, 1, 50 ether);

        address t1 = makeAddr("t1");
        address t2 = makeAddr("t2");
        vm.deal(t1, amt1);
        vm.deal(t2, amt2);

        vm.prank(t1);
        jar.tipEth{value: amt1}("");
        vm.prank(t2);
        jar.tipEth{value: amt2}("");

        assertEq(jar.tipperEthTotal(t1), amt1);
        assertEq(jar.tipperEthTotal(t2), amt2);
        assertEq(jar.totalEthTips(), amt1 + amt2);
    }
}
