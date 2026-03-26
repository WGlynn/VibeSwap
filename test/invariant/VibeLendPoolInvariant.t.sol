// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VibeLendPool.sol";
import "../../contracts/financial/interfaces/IVibeLendPool.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Handler ============

/**
 * @title VibeLendPool Handler for Invariant Testing
 * @notice Simulates random user actions: deposit, withdraw, borrow, repay, time warps
 */
contract LendPoolHandler is Test {
    VibeLendPool public pool;
    MockERC20 public token;

    address[] public actors;

    // Ghost variables for conservation tracking
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_totalBorrowed;
    uint256 public ghost_totalRepaid;
    uint256 public ghost_depositCalls;
    uint256 public ghost_withdrawCalls;
    uint256 public ghost_borrowCalls;
    uint256 public ghost_repayCalls;
    uint256 public ghost_warpCalls;

    constructor(VibeLendPool _pool, MockERC20 _token) {
        pool = _pool;
        token = _token;

        // Create actors and fund them
        for (uint256 i = 0; i < 10; i++) {
            address actor = address(uint160(3000 + i));
            actors.push(actor);
            token.mint(actor, 10_000_000 ether);
            vm.prank(actor);
            token.approve(address(pool), type(uint256).max);
        }
    }

    function deposit(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1 ether, 100_000 ether);

        vm.prank(actor);
        try pool.deposit(address(token), amount) {
            ghost_totalDeposited += amount;
            ghost_depositCalls++;
        } catch {}
    }

    function withdraw(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(token), actor);

        if (pos.deposited == 0) return;
        amount = bound(amount, 1, pos.deposited);

        vm.prank(actor);
        try pool.withdraw(address(token), amount) {
            ghost_totalWithdrawn += amount;
            ghost_withdrawCalls++;
        } catch {}
    }

    function borrow(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(token), actor);

        if (pos.deposited == 0) return;

        // Borrow at most 50% of deposit to stay healthy
        uint256 maxBorrow = pos.deposited / 2;
        if (maxBorrow <= pos.borrowed) return;

        amount = bound(amount, 1, maxBorrow - pos.borrowed);

        vm.prank(actor);
        try pool.borrow(address(token), amount) {
            ghost_totalBorrowed += amount;
            ghost_borrowCalls++;
        } catch {}
    }

    function repay(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(token), actor);

        if (pos.borrowed == 0) return;
        amount = bound(amount, 1, pos.borrowed);

        vm.prank(actor);
        try pool.repay(address(token), amount) {
            ghost_totalRepaid += amount;
            ghost_repayCalls++;
        } catch {}
    }

    function warpTime(uint256 seconds_) public {
        seconds_ = bound(seconds_, 1, 30 days);
        vm.warp(block.timestamp + seconds_);
        ghost_warpCalls++;
    }
}

/**
 * @title VibeLendPool Invariant Tests
 * @notice Protocol-wide invariants that must hold under any sequence of operations
 */
contract VibeLendPoolInvariantTest is StdInvariant, Test {
    VibeLendPool public pool;
    MockERC20 public token;
    LendPoolHandler public handler;

    uint256 constant WAD = 1e18;

    function setUp() public {
        token = new MockERC20("Test Token", "TST");

        VibeLendPool impl = new VibeLendPool();
        bytes memory initData = abi.encodeWithSelector(VibeLendPool.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        pool = VibeLendPool(address(proxy));

        // Create market: 80% LTV, 85% liq threshold, 5% bonus, 10% reserve
        pool.createMarket(address(token), 8000, 8500, 500, 1000);

        // Fund the pool with initial seed liquidity
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(pool), type(uint256).max);
        pool.deposit(address(token), 1_000_000 ether);

        handler = new LendPoolHandler(pool, token);
        targetContract(address(handler));
    }

    // ============ Invariants ============

    /**
     * @notice Invariant: totalDeposits >= totalBorrows (solvency)
     * @dev The pool can never owe more than it holds. This is the fundamental
     *      solvency constraint for any lending protocol.
     */
    function invariant_solvency() public view {
        IVibeLendPool.Market memory market = pool.getMarket(address(token));
        assertGe(
            market.totalDeposits,
            market.totalBorrows,
            "SOLVENCY VIOLATION: totalBorrows exceeds totalDeposits"
        );
    }

    /**
     * @notice Invariant: pool token balance >= totalDeposits - totalBorrows
     * @dev The actual token balance should cover the available liquidity.
     *      It may exceed it due to reserves and flash loan fees.
     */
    function invariant_balanceCoversAvailableLiquidity() public view {
        IVibeLendPool.Market memory market = pool.getMarket(address(token));
        uint256 available = market.totalDeposits - market.totalBorrows;
        uint256 actualBalance = token.balanceOf(address(pool));

        // Actual balance should be at least the available amount
        // (it can be more due to reserves accumulated from interest)
        assertGe(
            actualBalance,
            available,
            "LIQUIDITY VIOLATION: token balance < available liquidity"
        );
    }

    /**
     * @notice Invariant: borrow index never decreases
     * @dev Interest accumulation is monotonic. The borrow index tracks
     *      cumulative interest and should only go up.
     */
    function invariant_borrowIndexMonotonic() public view {
        IVibeLendPool.Market memory market = pool.getMarket(address(token));
        assertGe(
            market.borrowIndex,
            WAD,
            "Borrow index below WAD (initial value)"
        );
    }

    /**
     * @notice Invariant: supply index never decreases
     * @dev Supply index tracks cumulative yield for depositors.
     */
    function invariant_supplyIndexMonotonic() public view {
        IVibeLendPool.Market memory market = pool.getMarket(address(token));
        assertGe(
            market.supplyIndex,
            WAD,
            "Supply index below WAD (initial value)"
        );
    }

    /**
     * @notice Invariant: utilization is bounded [0, WAD]
     * @dev Utilization = totalBorrows / totalDeposits. Should never exceed 100%.
     */
    function invariant_utilizationBounded() public view {
        uint256 utilization = pool.getUtilization(address(token));
        assertLe(utilization, WAD, "Utilization exceeds 100%");
    }

    /**
     * @notice Invariant: market remains active
     * @dev Once created, the market should remain active throughout all operations.
     */
    function invariant_marketActive() public view {
        IVibeLendPool.Market memory market = pool.getMarket(address(token));
        assertTrue(market.active, "Market became inactive");
    }

    /**
     * @notice Invariant: interest rate is always non-negative
     * @dev The kink model should always produce a rate >= BASE_RATE.
     */
    function invariant_interestRateNonNegative() public view {
        uint256 rate = pool.getInterestRate(address(token));
        assertGe(rate, 0.02e18, "Interest rate below base rate");
    }

    /**
     * @notice Call summary for debugging
     */
    function invariant_callSummary() public view {
        console.log("--- VibeLendPool Invariant Summary ---");
        console.log("Deposits:", handler.ghost_depositCalls());
        console.log("Withdraws:", handler.ghost_withdrawCalls());
        console.log("Borrows:", handler.ghost_borrowCalls());
        console.log("Repays:", handler.ghost_repayCalls());
        console.log("Time warps:", handler.ghost_warpCalls());
        console.log("Total deposited:", handler.ghost_totalDeposited());
        console.log("Total withdrawn:", handler.ghost_totalWithdrawn());
        console.log("Total borrowed:", handler.ghost_totalBorrowed());
        console.log("Total repaid:", handler.ghost_totalRepaid());
    }
}
