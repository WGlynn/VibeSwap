// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/core/FeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFeeInvToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract FeeRouterHandler is Test {
    FeeRouter public router;
    MockFeeInvToken public token;
    address public source;

    uint256 public ghost_totalCollected;
    uint256 public ghost_totalDistributed;
    uint256 public ghost_collectCount;
    uint256 public ghost_distributeCount;

    constructor(FeeRouter _router, MockFeeInvToken _token, address _source) {
        router = _router;
        token = _token;
        source = _source;
    }

    function collectFee(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);

        token.mint(source, amount);
        vm.prank(source);
        token.approve(address(router), amount);

        vm.prank(source);
        try router.collectFee(address(token), amount) {
            ghost_totalCollected += amount;
            ghost_collectCount++;
        } catch {}
    }

    function distribute() public {
        uint256 pending = router.pendingFees(address(token));
        if (pending == 0) return;

        try router.distribute(address(token)) {
            ghost_totalDistributed += pending;
            ghost_distributeCount++;
        } catch {}
    }
}

// ============ Invariant Tests ============
// Core invariant: totalCollected = totalDistributed + pending
// And: 100% of distributed fees end up at lpDistributor

contract FeeRouterInvariantTest is StdInvariant, Test {
    FeeRouter router;
    MockFeeInvToken token;
    FeeRouterHandler handler;

    address lpDistributor = makeAddr("lpDistributor");
    address source = makeAddr("source");

    function setUp() public {
        token = new MockFeeInvToken();
        router = new FeeRouter(lpDistributor);
        router.authorizeSource(source);

        token.mint(source, type(uint128).max);
        vm.prank(source);
        token.approve(address(router), type(uint256).max);

        handler = new FeeRouterHandler(router, token, source);
        targetContract(address(handler));
    }

    function invariant_accountingBalances() public view {
        uint256 collected = router.totalCollected(address(token));
        uint256 distributed = router.totalDistributed(address(token));
        uint256 pending = router.pendingFees(address(token));

        // Accounting invariant: collected = distributed + pending
        assertEq(collected, distributed + pending);
    }

    function invariant_100pctToLPs() public view {
        uint256 distributed = router.totalDistributed(address(token));

        // Everything distributed went to LP distributor
        // (router balance = pending only, LP distributor got the rest)
        assertEq(token.balanceOf(lpDistributor), distributed);
    }

    function invariant_routerHoldsOnlyPending() public view {
        uint256 pending = router.pendingFees(address(token));
        assertEq(token.balanceOf(address(router)), pending);
    }

    function invariant_ghostMatchesContract() public view {
        assertEq(handler.ghost_totalCollected(), router.totalCollected(address(token)));
        assertEq(handler.ghost_totalDistributed(), router.totalDistributed(address(token)));
    }
}
