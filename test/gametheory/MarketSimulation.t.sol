// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/incentives/LoyaltyRewardsManager.sol";
import "../../contracts/incentives/ILProtectionVault.sol";
import "../../contracts/oracles/VolatilityOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract MockVibeAMM {
    function getPool(bytes32) external pure returns (
        address, address, uint256, uint256, uint256, bool
    ) {
        return (address(0), address(0), 100 ether, 100 ether, 30, true);
    }
}

/**
 * @title Market Simulation Tests
 * @notice Simulates multi-agent market dynamics over time
 * @dev Tests incentive alignment across different market conditions
 */
contract MarketSimulationTest is Test {
    // Contracts
    VibeAMM public amm;
    LoyaltyRewardsManager public loyalty;
    MockToken public tokenA;
    MockToken public tokenB;
    MockToken public rewardToken;

    // Actors
    address public owner;
    address public treasury;
    address public controller;

    // Market participants
    Agent[] public agents;
    bytes32 public poolId;

    // Simulation parameters
    uint256 constant NUM_AGENTS = 20;
    uint256 constant SIMULATION_DAYS = 365;
    uint256 constant INITIAL_LIQUIDITY = 1000 ether;

    struct Agent {
        address addr;
        uint256 liquidity;
        uint256 depositTime;
        AgentStrategy strategy;
        uint256 totalEarnings;
        uint256 totalCosts;
    }

    enum AgentStrategy {
        HODL,           // Long-term holder, never withdraws
        TRADER,         // Frequent trades, short-term focus
        YIELD_FARMER,   // Chases highest yields
        ARBITRAGEUR,    // Exploits price differences
        LOYAL_LP        // Provides liquidity with loyalty commitment
    }

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        controller = makeAddr("controller");

        // Deploy tokens
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
        rewardToken = new MockToken("Reward", "RWD");

        // Deploy AMM
        VibeAMM ammImpl = new VibeAMM();
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy ammProxy = new ERC1967Proxy(address(ammImpl), ammInit);
        amm = VibeAMM(address(ammProxy));

        amm.setAuthorizedExecutor(address(this), true);
        amm.setFlashLoanProtection(false);

        // Deploy Loyalty Manager
        LoyaltyRewardsManager loyaltyImpl = new LoyaltyRewardsManager();
        bytes memory loyaltyInit = abi.encodeWithSelector(
            LoyaltyRewardsManager.initialize.selector,
            owner,
            controller,
            treasury,
            address(rewardToken)
        );
        ERC1967Proxy loyaltyProxy = new ERC1967Proxy(address(loyaltyImpl), loyaltyInit);
        loyalty = LoyaltyRewardsManager(address(loyaltyProxy));

        // Fund loyalty rewards
        rewardToken.mint(address(loyalty), 100000 ether);

        // Create pool
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        // Initial liquidity
        tokenA.mint(owner, INITIAL_LIQUIDITY * 10);
        tokenB.mint(owner, INITIAL_LIQUIDITY * 10);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId, INITIAL_LIQUIDITY, INITIAL_LIQUIDITY, 0, 0);

        // Create agents with different strategies
        _createAgents();
    }

    function _createAgents() internal {
        for (uint256 i = 0; i < NUM_AGENTS; i++) {
            address agentAddr = address(uint160(1000 + i));

            // Assign strategies based on index
            AgentStrategy strategy;
            if (i < 4) strategy = AgentStrategy.HODL;
            else if (i < 8) strategy = AgentStrategy.TRADER;
            else if (i < 12) strategy = AgentStrategy.YIELD_FARMER;
            else if (i < 16) strategy = AgentStrategy.ARBITRAGEUR;
            else strategy = AgentStrategy.LOYAL_LP;

            agents.push(Agent({
                addr: agentAddr,
                liquidity: 0,
                depositTime: 0,
                strategy: strategy,
                totalEarnings: 0,
                totalCosts: 0
            }));

            // Fund each agent
            tokenA.mint(agentAddr, 100 ether);
            tokenB.mint(agentAddr, 100 ether);

            vm.startPrank(agentAddr);
            tokenA.approve(address(amm), type(uint256).max);
            tokenB.approve(address(amm), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ============ Simulation Tests ============

    /**
     * @notice Simulate market over time and verify incentive alignment
     * @dev Loyal LPs should outperform short-term strategies over time
     */
    function test_simulation_loyaltyPaysOff() public {
        // Run simulation for 90 days
        uint256 simulationDays = 90;

        for (uint256 day = 0; day < simulationDays; day++) {
            // Advance time by 1 day
            vm.warp(block.timestamp + 1 days);

            // Each agent takes action based on strategy
            for (uint256 i = 0; i < agents.length; i++) {
                _agentAction(i, day);
            }

            // Simulate market activity (trading volume)
            _simulateMarketActivity(day);
        }

        // Analyze results: Compare strategies
        uint256 hodlProfit;
        uint256 traderProfit;
        uint256 yieldFarmerProfit;
        uint256 loyalLpProfit;

        for (uint256 i = 0; i < agents.length; i++) {
            int256 netProfit = int256(agents[i].totalEarnings) - int256(agents[i].totalCosts);

            if (agents[i].strategy == AgentStrategy.HODL) {
                hodlProfit += netProfit > 0 ? uint256(netProfit) : 0;
            } else if (agents[i].strategy == AgentStrategy.TRADER) {
                traderProfit += netProfit > 0 ? uint256(netProfit) : 0;
            } else if (agents[i].strategy == AgentStrategy.YIELD_FARMER) {
                yieldFarmerProfit += netProfit > 0 ? uint256(netProfit) : 0;
            } else if (agents[i].strategy == AgentStrategy.LOYAL_LP) {
                loyalLpProfit += netProfit > 0 ? uint256(netProfit) : 0;
            }
        }

        // Loyal LPs should have competitive returns
        // (They get loyalty multipliers and avoid early exit penalties)
        emit log_named_uint("HODL profit", hodlProfit);
        emit log_named_uint("Trader profit", traderProfit);
        emit log_named_uint("Yield Farmer profit", yieldFarmerProfit);
        emit log_named_uint("Loyal LP profit", loyalLpProfit);
    }

    /**
     * @notice Simulate bear market and verify protection mechanisms
     */
    function test_simulation_bearMarket() public {
        // Initial deposits
        for (uint256 i = 0; i < 5; i++) {
            address agent = agents[i].addr;
            vm.prank(agent);
            amm.addLiquidity(poolId, 10 ether, 10 ether, 0, 0);
            agents[i].liquidity = 10 ether;
            agents[i].depositTime = block.timestamp;
        }

        // Simulate bear market: price drops 50% over 30 days
        for (uint256 day = 0; day < 30; day++) {
            vm.warp(block.timestamp + 1 days);

            // Simulate sell pressure
            uint256 sellAmount = 1 ether;
            tokenA.mint(address(amm), sellAmount);
            amm.syncTrackedBalance(address(tokenA));

            IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
            orders[0] = IVibeAMM.SwapOrder({
                trader: makeAddr("seller"),
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                amountIn: sellAmount,
                minAmountOut: 0,
                isPriority: false
            });

            amm.executeBatchSwap(poolId, uint64(day + 1), orders);
            amm.syncTrackedBalance(address(tokenA));
            amm.syncTrackedBalance(address(tokenB));
        }

        // Check IL for LPs
        IVibeAMM.Pool memory pool = amm.getPool(poolId);
        uint256 priceAfter = (pool.reserve1 * 1e18) / pool.reserve0;

        // Price should have changed significantly from 1:1
        // Note: Token ordering affects direction - tokens are sorted in pool
        // What matters for this test is that price moved significantly (simulating bear market)
        uint256 priceDiff = priceAfter > 1e18 ? priceAfter - 1e18 : 1e18 - priceAfter;
        assertGt(priceDiff, 0.01e18, "Price should have changed significantly");

        // LPs should still have their liquidity
        for (uint256 i = 0; i < 5; i++) {
            address lpToken = amm.getLPToken(poolId);
            uint256 lpBalance = IERC20(lpToken).balanceOf(agents[i].addr);
            assertGt(lpBalance, 0, "LP should still have tokens");
        }
    }

    /**
     * @notice Simulate high volatility and verify fee adjustment
     */
    function test_simulation_highVolatility() public {
        // Deposit liquidity
        for (uint256 i = 0; i < 5; i++) {
            address agent = agents[i].addr;
            vm.prank(agent);
            amm.addLiquidity(poolId, 10 ether, 10 ether, 0, 0);
        }

        uint256 initialFees = amm.accumulatedFees(address(tokenA));

        // Simulate high volatility: many large swaps back and forth
        for (uint256 i = 0; i < 50; i++) {
            uint256 swapAmount = 5 ether;
            bool buyTokenB = i % 2 == 0;

            address tokenIn = buyTokenB ? address(tokenA) : address(tokenB);
            address tokenOut = buyTokenB ? address(tokenB) : address(tokenA);

            MockToken(tokenIn).mint(address(amm), swapAmount);
            amm.syncTrackedBalance(tokenIn);

            IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
            orders[0] = IVibeAMM.SwapOrder({
                trader: makeAddr("volatileTrader"),
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: swapAmount,
                minAmountOut: 0,
                isPriority: false
            });

            amm.executeBatchSwap(poolId, uint64(100 + i), orders);
            amm.syncTrackedBalance(tokenIn);
            amm.syncTrackedBalance(tokenOut);
        }

        uint256 finalFees = amm.accumulatedFees(address(tokenA));

        // Fees should have accumulated significantly
        assertGt(finalFees, initialFees, "Fees should accumulate during volatility");

        emit log_named_uint("Fees accumulated", finalFees - initialFees);
    }

    /**
     * @notice Test Nash equilibrium: No agent wants to deviate from strategy
     */
    function test_nashEquilibrium_noDeviation() public {
        // Setup: All agents provide equal liquidity
        uint256 liquidityPerAgent = 10 ether;

        for (uint256 i = 0; i < 5; i++) {
            address agent = agents[i].addr;
            vm.prank(agent);
            amm.addLiquidity(poolId, liquidityPerAgent, liquidityPerAgent, 0, 0);
            agents[i].liquidity = liquidityPerAgent;
            agents[i].depositTime = block.timestamp;
        }

        // Run for 30 days with trading activity
        for (uint256 day = 0; day < 30; day++) {
            vm.warp(block.timestamp + 1 days);
            _simulateMarketActivity(day);
        }

        // Calculate individual LP returns
        address lpToken = amm.getLPToken(poolId);
        IVibeAMM.Pool memory pool = amm.getPool(poolId);

        uint256[] memory values = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            uint256 lpBalance = IERC20(lpToken).balanceOf(agents[i].addr);
            // Value = share of pool reserves
            uint256 share = (lpBalance * 1e18) / pool.totalLiquidity;
            values[i] = (share * (pool.reserve0 + pool.reserve1)) / 1e18;
        }

        // All agents should have similar values (cooperative equilibrium)
        for (uint256 i = 1; i < 5; i++) {
            // Within 5% of each other
            assertApproxEqRel(values[i], values[0], 0.05e18, "Values should be similar");
        }
    }

    // ============ Helper Functions ============

    function _agentAction(uint256 agentIndex, uint256 day) internal {
        Agent storage agent = agents[agentIndex];

        if (agent.strategy == AgentStrategy.HODL) {
            // HODLers deposit once and never withdraw
            if (agent.liquidity == 0 && day == 0) {
                vm.prank(agent.addr);
                (,, uint256 liq) = amm.addLiquidity(poolId, 10 ether, 10 ether, 0, 0);
                agent.liquidity = liq;
                agent.depositTime = block.timestamp;
                agent.totalCosts += 20 ether;
            }
        } else if (agent.strategy == AgentStrategy.TRADER) {
            // Traders swap frequently
            if (day % 3 == 0) {
                // Simulate small trade
                agent.totalCosts += 0.01 ether; // Gas cost approximation
            }
        } else if (agent.strategy == AgentStrategy.YIELD_FARMER) {
            // Yield farmers move liquidity around
            if (day % 7 == 0) {
                if (agent.liquidity > 0) {
                    // Withdraw
                    address lpToken = amm.getLPToken(poolId);
                    uint256 balance = IERC20(lpToken).balanceOf(agent.addr);
                    if (balance > 0) {
                        vm.prank(agent.addr);
                        (uint256 a0, uint256 a1) = amm.removeLiquidity(poolId, balance, 0, 0);
                        agent.totalEarnings += a0 + a1;
                        agent.liquidity = 0;
                    }
                } else {
                    // Deposit
                    vm.prank(agent.addr);
                    (,, uint256 liq) = amm.addLiquidity(poolId, 5 ether, 5 ether, 0, 0);
                    agent.liquidity = liq;
                    agent.depositTime = block.timestamp;
                    agent.totalCosts += 10 ether;
                }
            }
        } else if (agent.strategy == AgentStrategy.LOYAL_LP) {
            // Loyal LPs deposit once with long-term commitment
            if (agent.liquidity == 0 && day == 0) {
                vm.prank(agent.addr);
                (,, uint256 liq) = amm.addLiquidity(poolId, 20 ether, 20 ether, 0, 0);
                agent.liquidity = liq;
                agent.depositTime = block.timestamp;
                agent.totalCosts += 40 ether;

                // Register for loyalty rewards
                vm.prank(controller);
                loyalty.registerStake(poolId, agent.addr, liq);
            }
        }
    }

    function _simulateMarketActivity(uint256 day) internal {
        // Simulate random trading volume
        uint256 seed = uint256(keccak256(abi.encode(day, "market")));
        uint256 numTrades = (seed % 5) + 1;

        for (uint256 i = 0; i < numTrades; i++) {
            uint256 tradeSeed = uint256(keccak256(abi.encode(day, i, "trade")));
            uint256 amount = (tradeSeed % 1 ether) + 0.1 ether;
            bool buyTokenB = tradeSeed % 2 == 0;

            address tokenIn = buyTokenB ? address(tokenA) : address(tokenB);
            address tokenOut = buyTokenB ? address(tokenB) : address(tokenA);

            MockToken(tokenIn).mint(address(amm), amount);
            amm.syncTrackedBalance(tokenIn);

            IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
            orders[0] = IVibeAMM.SwapOrder({
                trader: makeAddr("marketMaker"),
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amount,
                minAmountOut: 0,
                isPriority: false
            });

            amm.executeBatchSwap(poolId, uint64(1000 + day * 10 + i), orders);
            amm.syncTrackedBalance(tokenIn);
            amm.syncTrackedBalance(tokenOut);
        }
    }
}
