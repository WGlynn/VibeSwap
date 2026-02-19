// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/core/ProtocolFeeAdapter.sol";
import "../../contracts/core/FeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockAdapterInvToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockInvWETH is ERC20 {
    constructor() ERC20("Wrapped ETH", "WETH") {}
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 amount) external { _burn(msg.sender, amount); payable(msg.sender).transfer(amount); }
}

// ============ Handler ============

contract AdapterHandler is Test {
    ProtocolFeeAdapter public adapter;
    FeeRouter public router;
    MockAdapterInvToken public token;

    uint256 public ghost_totalSent;
    uint256 public ghost_totalForwarded;
    uint256 public ghost_totalDistributed;

    constructor(ProtocolFeeAdapter _adapter, FeeRouter _router, MockAdapterInvToken _token) {
        adapter = _adapter;
        router = _router;
        token = _token;
    }

    function sendFees(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);
        token.mint(address(adapter), amount);
        ghost_totalSent += amount;
    }

    function forwardFees() public {
        uint256 bal = token.balanceOf(address(adapter));
        if (bal == 0) return;

        try adapter.forwardFees(address(token)) {
            ghost_totalForwarded += bal;
        } catch {}
    }

    function distribute() public {
        uint256 pending = router.pendingFees(address(token));
        if (pending == 0) return;

        try router.distribute(address(token)) {
            ghost_totalDistributed += pending;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract ProtocolFeeAdapterInvariantTest is StdInvariant, Test {
    MockAdapterInvToken token;
    FeeRouter router;
    ProtocolFeeAdapter adapter;
    AdapterHandler handler;

    address treasury = makeAddr("treasury");
    address insurance = makeAddr("insurance");
    address revShare = makeAddr("revShare");
    address buyback = makeAddr("buyback");

    function setUp() public {
        token = new MockAdapterInvToken();
        MockInvWETH weth = new MockInvWETH();
        router = new FeeRouter(treasury, insurance, revShare, buyback);
        adapter = new ProtocolFeeAdapter(address(router), address(weth));
        router.authorizeSource(address(adapter));

        handler = new AdapterHandler(adapter, router, token);
        targetContract(address(handler));
    }

    // ============ Invariant: total sent = adapter + router + distributed ============

    function invariant_tokenConservation() public view {
        uint256 inAdapter = token.balanceOf(address(adapter));
        uint256 inRouter = token.balanceOf(address(router));
        uint256 distributed = token.balanceOf(treasury) +
            token.balanceOf(insurance) +
            token.balanceOf(revShare) +
            token.balanceOf(buyback);

        assertEq(handler.ghost_totalSent(), inAdapter + inRouter + distributed);
    }

    // ============ Invariant: adapter totalForwarded = router totalCollected ============

    function invariant_forwardMatchesCollected() public view {
        assertEq(
            adapter.totalForwarded(address(token)),
            router.totalCollected(address(token))
        );
    }

    // ============ Invariant: ghost tracking matches contract state ============

    function invariant_ghostAccuracy() public view {
        assertEq(handler.ghost_totalForwarded(), adapter.totalForwarded(address(token)));
        assertEq(handler.ghost_totalDistributed(), router.totalDistributed(address(token)));
    }
}
