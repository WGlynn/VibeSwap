// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/FeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFeeRouterFuzzToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============
// 100% to LPs. No split math to fuzz — but we fuzz that
// every wei collected ends up at the LP distributor.

contract FeeRouterFuzzTest is Test {
    MockFeeRouterFuzzToken token;
    FeeRouter router;

    address lpDistributor = makeAddr("lpDistributor");
    address source = makeAddr("source");

    function setUp() public {
        token = new MockFeeRouterFuzzToken();
        router = new FeeRouter(lpDistributor);
        router.authorizeSource(source);

        token.mint(source, 100_000_000 ether);
        vm.prank(source);
        token.approve(address(router), type(uint256).max);
    }

    function testFuzz_collectAndDistribute(uint256 amount) public {
        amount = bound(amount, 1, 100_000_000 ether);

        vm.prank(source);
        router.collectFee(address(token), amount);

        router.distribute(address(token));

        // 100% to LP distributor, zero left in router
        assertEq(token.balanceOf(lpDistributor), amount);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(router.pendingFees(address(token)), 0);
        assertEq(router.totalDistributed(address(token)), amount);
    }

    function testFuzz_multipleCollectsThenDistribute(uint256 a, uint256 b) public {
        a = bound(a, 1, 50_000_000 ether);
        b = bound(b, 1, 50_000_000 ether);

        vm.startPrank(source);
        router.collectFee(address(token), a);
        router.collectFee(address(token), b);
        vm.stopPrank();

        router.distribute(address(token));

        assertEq(token.balanceOf(lpDistributor), a + b);
        assertEq(token.balanceOf(address(router)), 0);
    }
}
