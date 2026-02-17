// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";

// ============ Minimal Mocks ============

contract InvMockERC20 is ERC20 {
    constructor() ERC20("Token", "TKN") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract InvMockAuction {
    uint64 public currentBatchId = 1;
    uint256 public commitCount;

    function commitOrder(bytes32) external payable returns (bytes32) {
        commitCount++;
        return keccak256(abi.encodePacked("commit", commitCount));
    }

    function revealOrderCrossChain(bytes32, address, address, address, uint256, uint256, bytes32, uint256) external payable {}
    function advancePhase() external {}
    function settleBatch() external {}
    function getCurrentBatchId() external view returns (uint64) { return currentBatchId; }
    function getCurrentPhase() external pure returns (ICommitRevealAuction.BatchPhase) { return ICommitRevealAuction.BatchPhase.COMMIT; }
    function getTimeUntilPhaseChange() external pure returns (uint256) { return 5; }
    function getRevealedOrders(uint64) external pure returns (ICommitRevealAuction.RevealedOrder[] memory) {
        return new ICommitRevealAuction.RevealedOrder[](0);
    }
    function getExecutionOrder(uint64) external pure returns (uint256[] memory) { return new uint256[](0); }
    function getBatch(uint64) external pure returns (ICommitRevealAuction.Batch memory b) { return b; }
}

contract InvMockAMM {
    function createPool(address, address, uint256) external pure returns (bytes32) { return keccak256("pool"); }
    function getPoolId(address a, address b) external pure returns (bytes32) { return keccak256(abi.encodePacked(a, b)); }
    function getPool(bytes32) external pure returns (IVibeAMM.Pool memory p) { return p; }
    function quote(bytes32, address, uint256 a) external pure returns (uint256) { return a; }
}

contract InvMockTreasury {
    function receiveAuctionProceeds(uint64) external payable {}
    receive() external payable {}
}

contract InvMockRouter {
    function sendCommit(uint32, bytes32, bytes calldata) external payable {}
    receive() external payable {}
}

// ============ Handler ============

contract CoreHandler is Test {
    VibeSwapCore public core;
    InvMockERC20 public token;
    address public tokenB;

    uint256 public ghost_deposited;
    uint256 public ghost_withdrawn;
    uint256 public ghost_commitCount;

    address[] public traders;

    constructor(VibeSwapCore _core, InvMockERC20 _token, address _tokenB) {
        core = _core;
        token = _token;
        tokenB = _tokenB;

        // Pre-create traders
        for (uint256 i = 0; i < 5; i++) {
            address t = makeAddr(string(abi.encodePacked("trader", i)));
            traders.push(t);
            token.mint(t, 100_000e18);
            vm.prank(t);
            token.approve(address(core), type(uint256).max);
        }
    }

    function commit(uint256 traderSeed, uint256 amount) public {
        uint256 idx = traderSeed % traders.length;
        address trader = traders[idx];
        amount = bound(amount, 1e18, 10_000e18); // Stay within rate limits

        vm.prank(trader);
        try core.commitSwap(
            address(token), tokenB, amount, 0,
            keccak256(abi.encodePacked("secret", ghost_commitCount))
        ) {
            ghost_deposited += amount;
            ghost_commitCount++;
        } catch {}
    }

    function withdraw(uint256 traderSeed) public {
        uint256 idx = traderSeed % traders.length;
        address trader = traders[idx];

        uint256 deposit = core.deposits(trader, address(token));
        if (deposit == 0) return;

        vm.prank(trader);
        try core.withdrawDeposit(address(token)) {
            ghost_withdrawn += deposit;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 2 hours);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract VibeSwapCoreInvariantTest is StdInvariant, Test {
    VibeSwapCore public core;
    CoreHandler public handler;
    InvMockERC20 public tokenA;
    InvMockERC20 public tokenB;

    function setUp() public {
        address owner = makeAddr("owner");

        InvMockAuction auction = new InvMockAuction();
        InvMockAMM amm = new InvMockAMM();
        InvMockTreasury treasury = new InvMockTreasury();
        InvMockRouter router = new InvMockRouter();
        tokenA = new InvMockERC20();
        tokenB = new InvMockERC20();

        VibeSwapCore impl = new VibeSwapCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner, address(auction), address(amm), address(treasury), address(router)
            )
        );
        core = VibeSwapCore(payable(address(proxy)));

        vm.startPrank(owner);
        core.setSupportedToken(address(tokenA), true);
        core.setSupportedToken(address(tokenB), true);
        core.setCommitCooldown(0);
        core.setRequireEOA(false);
        vm.stopPrank();

        vm.warp(10_000);

        handler = new CoreHandler(core, tokenA, address(tokenB));
        targetContract(address(handler));
    }

    /// @notice Token balance in core always equals ghost_deposited - ghost_withdrawn
    function invariant_balanceMatchesGhost() public view {
        assertEq(
            tokenA.balanceOf(address(core)),
            handler.ghost_deposited() - handler.ghost_withdrawn()
        );
    }

    /// @notice Deposits never exceed total balance held
    function invariant_depositsNeverExceedBalance() public view {
        assertGe(
            tokenA.balanceOf(address(core)),
            handler.ghost_deposited() - handler.ghost_withdrawn()
        );
    }

    /// @notice Withdrawals never exceed deposits
    function invariant_withdrawalsNeverExceedDeposits() public view {
        assertGe(handler.ghost_deposited(), handler.ghost_withdrawn());
    }
}
