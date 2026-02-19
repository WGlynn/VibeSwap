// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/ProtocolFeeAdapter.sol";
import "../../contracts/core/FeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockAdapterFuzzToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract ProtocolFeeAdapterFuzzTest is Test {
    MockAdapterFuzzToken token;
    FeeRouter router;
    ProtocolFeeAdapter adapter;

    address treasury = makeAddr("treasury");
    address insurance = makeAddr("insurance");
    address revShare = makeAddr("revShare");
    address buyback = makeAddr("buyback");

    function setUp() public {
        token = new MockAdapterFuzzToken();
        router = new FeeRouter(treasury, insurance, revShare, buyback);
        adapter = new ProtocolFeeAdapter(address(router));
        router.authorizeSource(address(adapter));
    }

    // ============ Fuzz: forward then distribute = full amount ============

    function testFuzz_forwardAndDistribute(uint256 amount) public {
        amount = bound(amount, 1, 100_000_000 ether);

        token.mint(address(adapter), amount);
        adapter.forwardFees(address(token));
        router.distribute(address(token));

        uint256 totalOut = token.balanceOf(treasury) +
            token.balanceOf(insurance) +
            token.balanceOf(revShare) +
            token.balanceOf(buyback);

        assertEq(totalOut, amount);
        assertEq(adapter.totalForwarded(address(token)), amount);
    }

    // ============ Fuzz: multiple forwards accumulate ============

    function testFuzz_multipleForwards(uint256 amt1, uint256 amt2) public {
        amt1 = bound(amt1, 1, 50_000_000 ether);
        amt2 = bound(amt2, 1, 50_000_000 ether);

        token.mint(address(adapter), amt1);
        adapter.forwardFees(address(token));

        token.mint(address(adapter), amt2);
        adapter.forwardFees(address(token));

        assertEq(router.pendingFees(address(token)), amt1 + amt2);
        assertEq(adapter.totalForwarded(address(token)), amt1 + amt2);
    }

    // ============ Fuzz: ETH forwarding ============

    function testFuzz_forwardETH(uint256 amount) public {
        amount = bound(amount, 1, 1000 ether);

        vm.deal(address(adapter), amount);

        uint256 ownerBefore = address(this).balance;
        adapter.forwardETH();
        uint256 ownerAfter = address(this).balance;

        assertEq(ownerAfter - ownerBefore, amount);
        assertEq(adapter.totalETHForwarded(), amount);
    }

    receive() external payable {}
}
