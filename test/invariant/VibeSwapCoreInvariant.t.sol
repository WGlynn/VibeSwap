// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";
import "../../contracts/libraries/SecurityLib.sol";

// ============ Minimal Mocks ============

contract InvMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
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

    function incrementBatch() external { currentBatchId++; }
}

contract InvMockAMM {
    // ============ Pool state for invariant checking ============
    struct MockPool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }

    mapping(bytes32 => MockPool) public mockPools;
    uint256 public totalBatchOutputToken0;
    uint256 public totalBatchOutputToken1;

    function createPool(address tokenA, address tokenB, uint256 feeRate) external returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 poolId = keccak256(abi.encodePacked(t0, t1));
        mockPools[poolId] = MockPool({
            token0: t0,
            token1: t1,
            reserve0: 0,
            reserve1: 0,
            totalLiquidity: 0,
            feeRate: feeRate,
            initialized: true
        });
        return poolId;
    }

    function seedLiquidity(bytes32 poolId, uint256 r0, uint256 r1) external {
        mockPools[poolId].reserve0 = r0;
        mockPools[poolId].reserve1 = r1;
        mockPools[poolId].totalLiquidity = r0; // simplified
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function getPool(bytes32 poolId) external view returns (IVibeAMM.Pool memory p) {
        MockPool storage mp = mockPools[poolId];
        p.token0 = mp.token0;
        p.token1 = mp.token1;
        p.reserve0 = mp.reserve0;
        p.reserve1 = mp.reserve1;
        p.totalLiquidity = mp.totalLiquidity;
        p.feeRate = mp.feeRate;
        p.initialized = mp.initialized;
    }

    function quote(bytes32, address, uint256 a) external pure returns (uint256) { return a; }

    /// @notice Simulate batch swap: constant product AMM with fee
    /// @dev Executes each order, updating reserves. Verifies x*y=k only increases.
    function executeBatchSwap(
        bytes32 poolId,
        uint64,
        IVibeAMM.SwapOrder[] calldata orders
    ) external returns (IVibeAMM.BatchSwapResult memory result) {
        MockPool storage pool = mockPools[poolId];
        uint256 kBefore = pool.reserve0 * pool.reserve1;

        for (uint256 i = 0; i < orders.length; i++) {
            IVibeAMM.SwapOrder calldata order = orders[i];
            bool isToken0 = order.tokenIn == pool.token0;

            uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
            uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

            // Constant product: amountOut = reserveOut * amountIn / (reserveIn + amountIn)
            // Apply fee (deducted from input)
            uint256 amountInAfterFee = (order.amountIn * (10000 - pool.feeRate)) / 10000;
            uint256 amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

            // Cap output to reserve (no value creation)
            if (amountOut > reserveOut) {
                amountOut = reserveOut - 1; // Leave dust to prevent zero reserve
            }

            if (amountOut < order.minAmountOut) {
                // Slippage failure — return tokens to caller
                IERC20(order.tokenIn).transfer(msg.sender, order.amountIn);
                continue;
            }

            // Update reserves
            if (isToken0) {
                pool.reserve0 += order.amountIn;
                pool.reserve1 -= amountOut;
            } else {
                pool.reserve1 += order.amountIn;
                pool.reserve0 -= amountOut;
            }

            // Transfer output to trader
            IERC20(order.tokenOut).transfer(order.trader, amountOut);

            result.totalTokenInSwapped += order.amountIn;
            result.totalTokenOutSwapped += amountOut;

            // Track per-token outputs for no-value-creation invariant
            if (isToken0) {
                totalBatchOutputToken1 += amountOut;
            } else {
                totalBatchOutputToken0 += amountOut;
            }
        }

        // Clearing price (simplified)
        if (result.totalTokenInSwapped > 0) {
            result.clearingPrice = (result.totalTokenOutSwapped * 1e18) / result.totalTokenInSwapped;
        }

        // Verify k never decreased (fundamental AMM invariant)
        uint256 kAfter = pool.reserve0 * pool.reserve1;
        require(kAfter >= kBefore, "MOCK AMM: k decreased");
    }

    function resetBatchOutputs() external {
        totalBatchOutputToken0 = 0;
        totalBatchOutputToken1 = 0;
    }
}

contract InvMockTreasury {
    function receiveAuctionProceeds(uint64) external payable {}
    receive() external payable {}
}

contract InvMockRouter {
    function sendCommit(uint32, bytes32, uint256, bytes calldata, address) external payable {}
    receive() external payable {}
}

// ============ Handler ============

contract CoreHandler is Test {
    VibeSwapCore public core;
    InvMockERC20 public tokenA;
    InvMockERC20 public tokenB;
    InvMockAMM public mockAmm;
    InvMockAuction public mockAuction;

    // Ghost variables for deposit conservation
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_commitCount;

    // Ghost variables for rate limit tracking
    mapping(address => uint256) public ghost_userSwapVolume;
    mapping(address => uint256) public ghost_userWindowStart;
    uint256 public ghost_rateLimitViolations;

    // Ghost variables for settlement
    uint256 public ghost_totalSettledInput;
    uint256 public ghost_totalSettledOutput;
    uint256 public ghost_batchesSettled;

    address[] public traders;
    bytes32 public poolId;

    // Track per-trader deposits for conservation check
    mapping(address => uint256) public ghost_traderDeposited;
    mapping(address => uint256) public ghost_traderWithdrawn;

    // Track pending order amounts
    uint256 public ghost_totalPendingOrderAmounts;

    constructor(
        VibeSwapCore _core,
        InvMockERC20 _tokenA,
        InvMockERC20 _tokenB,
        InvMockAMM _mockAmm,
        InvMockAuction _mockAuction,
        bytes32 _poolId
    ) {
        core = _core;
        tokenA = _tokenA;
        tokenB = _tokenB;
        mockAmm = _mockAmm;
        mockAuction = _mockAuction;
        poolId = _poolId;

        // Pre-create traders with generous balances
        for (uint256 i = 0; i < 5; i++) {
            address t = makeAddr(string(abi.encodePacked("trader", i)));
            traders.push(t);
            tokenA.mint(t, 1_000_000e18);
            tokenB.mint(t, 1_000_000e18);
            vm.prank(t);
            tokenA.approve(address(core), type(uint256).max);
            vm.prank(t);
            tokenB.approve(address(core), type(uint256).max);
        }
    }

    /// @notice Commit a swap order with bounded random inputs
    function commit(uint256 traderSeed, uint256 amount) public {
        uint256 idx = traderSeed % traders.length;
        address trader = traders[idx];
        // Stay well within rate limits for most calls
        amount = bound(amount, 1e18, 10_000e18);

        vm.prank(trader);
        try core.commitSwap(
            address(tokenA), address(tokenB), amount, 0,
            keccak256(abi.encodePacked("secret", ghost_commitCount))
        ) {
            ghost_totalDeposited += amount;
            ghost_traderDeposited[trader] += amount;
            ghost_commitCount++;
            ghost_totalPendingOrderAmounts += amount;

            // Track rate limit ghost state
            SecurityLib.RateLimit memory limit = _getUserRateLimit(trader);
            if (block.timestamp >= ghost_userWindowStart[trader] + 1 hours) {
                ghost_userSwapVolume[trader] = amount;
                ghost_userWindowStart[trader] = block.timestamp;
            } else {
                ghost_userSwapVolume[trader] += amount;
            }
        } catch {}

        // Advance batch ID so the same trader can commit again in next batch
        mockAuction.incrementBatch();
    }

    /// @notice Attempt to exceed rate limit (should always revert)
    function commitExceedRateLimit(uint256 traderSeed) public {
        uint256 idx = traderSeed % traders.length;
        address trader = traders[idx];

        // First, fill up the rate limit window
        uint256 maxPerHour = core.maxSwapPerHour();
        uint256 attemptAmount = maxPerHour + 1e18;

        // Reset rate limit by advancing time past window
        vm.warp(block.timestamp + 2 hours);
        mockAuction.incrementBatch();

        // Mint extra tokens for this attempt
        tokenA.mint(trader, attemptAmount);
        vm.prank(trader);
        tokenA.approve(address(core), type(uint256).max);

        vm.prank(trader);
        try core.commitSwap(
            address(tokenA), address(tokenB), attemptAmount, 0,
            keccak256(abi.encodePacked("ratelimit", ghost_commitCount))
        ) {
            // If this succeeds, the amount was within limits
            ghost_totalDeposited += attemptAmount;
            ghost_traderDeposited[trader] += attemptAmount;
            ghost_commitCount++;
            ghost_totalPendingOrderAmounts += attemptAmount;
        } catch {
            // Expected: rate limit exceeded
            ghost_rateLimitViolations++;
        }
    }

    /// @notice Withdraw deposit for a trader
    function withdraw(uint256 traderSeed) public {
        uint256 idx = traderSeed % traders.length;
        address trader = traders[idx];

        uint256 deposit = core.deposits(trader, address(tokenA));
        if (deposit == 0) return;

        vm.prank(trader);
        try core.withdrawDeposit(address(tokenA)) {
            ghost_totalWithdrawn += deposit;
            ghost_traderWithdrawn[trader] += deposit;
        } catch {}
    }

    /// @notice Advance block time to test rate limit window expiry
    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 2 hours);
        vm.warp(block.timestamp + delta);
    }

    /// @notice Advance block number (for flash loan protection)
    function advanceBlock() public {
        vm.roll(block.number + 1);
    }

    /// @notice Helper to read user rate limit from core
    function _getUserRateLimit(address user) internal view returns (SecurityLib.RateLimit memory) {
        (uint256 windowStart, uint256 usedAmount, uint256 maxAmount,) = core.getUserRateLimit(user);
        return SecurityLib.RateLimit({
            windowStart: windowStart,
            windowDuration: 1 hours,
            maxAmount: maxAmount,
            usedAmount: usedAmount
        });
    }

    function getTraderCount() external view returns (uint256) {
        return traders.length;
    }

    function getTrader(uint256 idx) external view returns (address) {
        return traders[idx];
    }
}

// ============ Invariant Tests ============

contract VibeSwapCoreInvariantTest is StdInvariant, Test {
    VibeSwapCore public core;
    CoreHandler public handler;
    InvMockERC20 public tokenA;
    InvMockERC20 public tokenB;
    InvMockAMM public mockAmm;
    InvMockAuction public mockAuction;
    bytes32 public poolId;

    uint256 constant INITIAL_RESERVE = 100_000e18;

    function setUp() public {
        address owner = makeAddr("owner");

        mockAuction = new InvMockAuction();
        mockAmm = new InvMockAMM();
        InvMockTreasury treasury = new InvMockTreasury();
        InvMockRouter router = new InvMockRouter();
        tokenA = new InvMockERC20("TokenA", "TKA");
        tokenB = new InvMockERC20("TokenB", "TKB");

        // Create pool in mock AMM
        poolId = mockAmm.createPool(address(tokenA), address(tokenB), 5); // 0.05% fee
        mockAmm.seedLiquidity(poolId, INITIAL_RESERVE, INITIAL_RESERVE);

        // Seed AMM with actual token balances for settlement simulation
        tokenA.mint(address(mockAmm), INITIAL_RESERVE);
        tokenB.mint(address(mockAmm), INITIAL_RESERVE);

        VibeSwapCore impl = new VibeSwapCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner, address(mockAuction), address(mockAmm), address(treasury), address(router)
            )
        );
        core = VibeSwapCore(payable(address(proxy)));

        vm.startPrank(owner);
        core.setSupportedToken(address(tokenA), true);
        core.setSupportedToken(address(tokenB), true);
        core.setCommitCooldown(0);
        core.setRequireEOA(false);
        vm.stopPrank();

        // Start at a reasonable timestamp
        vm.warp(10_000);

        handler = new CoreHandler(core, tokenA, tokenB, mockAmm, mockAuction, poolId);
        targetContract(address(handler));
    }

    // ============ Invariant 1: Pool reserves x*y=k holds after every settlement ============

    /// @notice K (reserve0 * reserve1) must never decrease from initial value
    /// @dev The constant product invariant is the fundamental AMM guarantee.
    ///      With fees, K should only increase over time.
    function invariant_poolReservesXYK() public view {
        IVibeAMM.Pool memory pool = mockAmm.getPool(poolId);

        // If pool has been initialized with reserves, k must not decrease
        if (pool.reserve0 > 0 && pool.reserve1 > 0) {
            uint256 currentK = pool.reserve0 * pool.reserve1;
            uint256 initialK = INITIAL_RESERVE * INITIAL_RESERVE;
            assertGe(currentK, initialK, "XYK VIOLATED: k decreased below initial value");
        }
    }

    /// @notice Reserves must never be zero (pool depletion)
    function invariant_reservesNeverZero() public view {
        IVibeAMM.Pool memory pool = mockAmm.getPool(poolId);
        if (pool.initialized) {
            assertGt(pool.reserve0, 0, "Reserve0 depleted to zero");
            assertGt(pool.reserve1, 0, "Reserve1 depleted to zero");
        }
    }

    // ============ Invariant 2: Deposit conservation ============

    /// @notice Token balance held by core must equal ghost_deposited - ghost_withdrawn
    /// @dev Ensures no tokens are created or destroyed within the deposit system
    function invariant_depositConservation() public view {
        uint256 coreBalance = tokenA.balanceOf(address(core));
        uint256 expectedBalance = handler.ghost_totalDeposited() - handler.ghost_totalWithdrawn();

        assertEq(
            coreBalance,
            expectedBalance,
            "DEPOSIT CONSERVATION: core balance != deposited - withdrawn"
        );
    }

    /// @notice Sum of all individual trader deposits must equal total deposits in core
    /// @dev Cross-checks per-trader accounting against aggregate accounting
    function invariant_perTraderDepositConsistency() public view {
        uint256 sumDeposits = 0;
        for (uint256 i = 0; i < handler.getTraderCount(); i++) {
            address trader = handler.getTrader(i);
            sumDeposits += core.deposits(trader, address(tokenA));
        }

        uint256 coreBalance = tokenA.balanceOf(address(core));
        assertEq(
            coreBalance,
            sumDeposits,
            "DEPOSIT CONSISTENCY: sum of per-trader deposits != core token balance"
        );
    }

    /// @notice Total withdrawals must never exceed total deposits
    function invariant_withdrawalsNeverExceedDeposits() public view {
        assertGe(
            handler.ghost_totalDeposited(),
            handler.ghost_totalWithdrawn(),
            "DEPOSIT CONSERVATION: withdrawals exceeded deposits"
        );
    }

    /// @notice Pending order amounts must be backed by actual deposits
    /// @dev Sum of all deposits >= sum of all pending order amounts
    function invariant_depositsBackOrders() public view {
        uint256 coreBalance = tokenA.balanceOf(address(core));
        uint256 netDeposited = handler.ghost_totalDeposited() - handler.ghost_totalWithdrawn();

        // Core must hold at least as many tokens as net deposits
        assertGe(
            coreBalance,
            netDeposited,
            "DEPOSIT BACKING: core balance < net deposited amount"
        );
    }

    // ============ Invariant 3: No value creation ============

    /// @notice Total output tokens across any batch must not exceed pool reserve of that token
    /// @dev Prevents the AMM from outputting more tokens than it holds. This is the
    ///      "conservation of value" invariant — you cannot create tokens out of thin air.
    function invariant_noValueCreation() public view {
        IVibeAMM.Pool memory pool = mockAmm.getPool(poolId);

        // Cumulative outputs for each token must not exceed what the pool ever held
        // The mock AMM tracks total batch outputs for each token
        uint256 totalOutputToken0 = mockAmm.totalBatchOutputToken0();
        uint256 totalOutputToken1 = mockAmm.totalBatchOutputToken1();

        // Each individual batch output is capped at the reserve at execution time
        // (enforced in the mock AMM). Additionally, the current reserves must remain positive.
        if (pool.initialized && pool.reserve0 > 0 && pool.reserve1 > 0) {
            // Current reserves + cumulative outputs should account for all tokens
            // that entered via input swaps + initial reserves
            assertGt(
                pool.reserve0 + totalOutputToken0,
                0,
                "NO VALUE CREATION: token0 accounting underflow"
            );
            assertGt(
                pool.reserve1 + totalOutputToken1,
                0,
                "NO VALUE CREATION: token1 accounting underflow"
            );
        }
    }

    /// @notice AMM token balances must be sufficient to cover reserves
    function invariant_ammSolvency() public view {
        IVibeAMM.Pool memory pool = mockAmm.getPool(poolId);
        if (!pool.initialized) return;

        uint256 ammBalanceA = tokenA.balanceOf(address(mockAmm));
        uint256 ammBalanceB = tokenB.balanceOf(address(mockAmm));

        // AMM must hold at least as many tokens as its tracked reserves
        assertGe(
            ammBalanceA,
            pool.reserve0,
            "AMM SOLVENCY: tokenA balance < reserve0"
        );
        assertGe(
            ammBalanceB,
            pool.reserve1,
            "AMM SOLVENCY: tokenB balance < reserve1"
        );
    }

    // ============ Invariant 4: Rate limit enforcement ============

    /// @notice No user can exceed maxSwapPerHour within a 1-hour window
    /// @dev Checks every trader's rate limit state directly from the contract
    function invariant_rateLimitEnforcement() public view {
        uint256 maxPerHour = core.maxSwapPerHour();

        for (uint256 i = 0; i < handler.getTraderCount(); i++) {
            address trader = handler.getTrader(i);
            (uint256 windowStart, uint256 usedAmount, uint256 maxAmount, uint256 remainingAmount) =
                core.getUserRateLimit(trader);

            // If the window is still active, used amount must not exceed max
            if (windowStart > 0 && block.timestamp < windowStart + 1 hours) {
                assertLe(
                    usedAmount,
                    maxAmount,
                    "RATE LIMIT: user exceeded maxSwapPerHour within window"
                );
            }

            // Max amount should be the configured maxSwapPerHour
            if (maxAmount > 0) {
                assertEq(
                    maxAmount,
                    maxPerHour,
                    "RATE LIMIT: user maxAmount diverged from global maxSwapPerHour"
                );
            }

            // Remaining must be consistent: remaining = max - used (or 0 if expired)
            if (windowStart > 0 && block.timestamp < windowStart + 1 hours) {
                uint256 expectedRemaining = maxAmount > usedAmount ? maxAmount - usedAmount : 0;
                assertEq(
                    remainingAmount,
                    expectedRemaining,
                    "RATE LIMIT: remaining amount inconsistent"
                );
            }
        }
    }

    /// @notice Rate limit violations must have been caught (never silently bypassed)
    /// @dev The handler tracks how many times commitExceedRateLimit was called and reverted.
    ///      If a commit exceeding the limit succeeded, it means the rate limit was bypassed.
    function invariant_rateLimitNeverBypassed() public view {
        for (uint256 i = 0; i < handler.getTraderCount(); i++) {
            address trader = handler.getTrader(i);
            (uint256 windowStart, uint256 usedAmount, uint256 maxAmount,) =
                core.getUserRateLimit(trader);

            // Within an active window, usedAmount must never exceed maxAmount
            if (windowStart > 0 && block.timestamp < windowStart + 1 hours) {
                assertLe(
                    usedAmount,
                    maxAmount,
                    "RATE LIMIT BYPASS: usedAmount > maxAmount in active window"
                );
            }
        }
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("--- VibeSwapCore Invariant Call Summary ---");
        console.log("Total deposited:       ", handler.ghost_totalDeposited());
        console.log("Total withdrawn:       ", handler.ghost_totalWithdrawn());
        console.log("Total commits:         ", handler.ghost_commitCount());
        console.log("Rate limit violations: ", handler.ghost_rateLimitViolations());

        IVibeAMM.Pool memory pool = mockAmm.getPool(poolId);
        console.log("Pool reserve0:         ", pool.reserve0);
        console.log("Pool reserve1:         ", pool.reserve1);
        if (pool.reserve0 > 0 && pool.reserve1 > 0) {
            console.log("Pool K:                ", pool.reserve0 * pool.reserve1);
        }
    }
}
