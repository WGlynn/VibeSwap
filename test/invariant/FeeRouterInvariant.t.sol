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

contract FeeRouterInvariantTest is StdInvariant, Test {
    MockFeeInvToken token;
    FeeRouter router;
    FeeRouterHandler handler;

    address treasury = makeAddr("treasury");
    address insurance = makeAddr("insurance");
    address revShare = makeAddr("revShare");
    address buyback = makeAddr("buyback");
    address source = makeAddr("source");

    function setUp() public {
        token = new MockFeeInvToken();
        router = new FeeRouter(treasury, insurance, revShare, buyback);
        router.authorizeSource(source);

        handler = new FeeRouterHandler(router, token, source);
        targetContract(address(handler));
    }

    // ============ Invariant: collected = distributed + pending ============

    function invariant_accountingBalance() public view {
        uint256 collected = router.totalCollected(address(token));
        uint256 distributed = router.totalDistributed(address(token));
        uint256 pending = router.pendingFees(address(token));

        assertEq(collected, distributed + pending);
    }

    // ============ Invariant: router balance = pending fees ============

    function invariant_routerBalanceMatchesPending() public view {
        uint256 routerBal = token.balanceOf(address(router));
        uint256 pending = router.pendingFees(address(token));
        assertEq(routerBal, pending);
    }

    // ============ Invariant: all distributed tokens reach recipients ============

    function invariant_noTokensLost() public view {
        uint256 recipientTotal = token.balanceOf(treasury) +
            token.balanceOf(insurance) +
            token.balanceOf(revShare) +
            token.balanceOf(buyback);
        uint256 distributed = router.totalDistributed(address(token));

        assertEq(recipientTotal, distributed);
    }

    // ============ Invariant: ghost variables match contract ============

    function invariant_ghostMatchesContract() public view {
        assertEq(handler.ghost_totalCollected(), router.totalCollected(address(token)));
        assertEq(handler.ghost_totalDistributed(), router.totalDistributed(address(token)));
    }

    // ============ Invariant: config always sums to 10000 BPS ============

    function invariant_configSumsBPS() public view {
        IFeeRouter.FeeConfig memory cfg = router.config();
        uint256 total = uint256(cfg.treasuryBps) +
            uint256(cfg.insuranceBps) +
            uint256(cfg.revShareBps) +
            uint256(cfg.buybackBps);
        assertEq(total, 10_000);
    }
}
