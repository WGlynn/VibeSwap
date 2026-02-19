// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/governance/TreasuryStabilizer.sol";
import "../../contracts/governance/DAOTreasury.sol";

// ============ Mocks ============

contract MockGSToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockGSVibeAMM {
    mapping(bytes32 => IVibeAMM.Pool) public pools;
    mapping(bytes32 => mapping(uint32 => uint256)) public twapPrices;
    bool public liquidityAdded;

    function setPool(bytes32 poolId, address t0, address t1, uint256 r0, uint256 r1) external {
        pools[poolId] = IVibeAMM.Pool(t0, t1, r0, r1, r0 + r1, 30, true);
    }

    function setTWAP(bytes32 poolId, uint32 period, uint256 price) external {
        twapPrices[poolId][period] = price;
    }

    function getPool(bytes32 poolId) external view returns (IVibeAMM.Pool memory) {
        return pools[poolId];
    }

    function getTWAP(bytes32 poolId, uint32 period) external view returns (uint256) {
        return twapPrices[poolId][period];
    }

    function addLiquidity(bytes32, uint256, uint256, uint256, uint256) external returns (uint256, uint256, uint256) {
        liquidityAdded = true;
        return (0, 0, 100 ether);
    }

    function removeLiquidity(bytes32, uint256, uint256, uint256) external returns (uint256, uint256) {
        return (50 ether, 50 ether);
    }
}

contract MockGSVolatilityOracle {
    mapping(bytes32 => uint256) public volatilities;

    function setVolatility(bytes32 poolId, uint256 vol) external {
        volatilities[poolId] = vol;
    }

    function getVolatilityData(bytes32 poolId) external view returns (uint256, IVolatilityOracle.VolatilityTier, uint64) {
        uint256 vol = volatilities[poolId];
        IVolatilityOracle.VolatilityTier tier = vol > 10000
            ? IVolatilityOracle.VolatilityTier.EXTREME
            : IVolatilityOracle.VolatilityTier.LOW;
        return (vol, tier, uint64(block.timestamp));
    }
}

// ============ Tests ============

contract GovernanceStabilizationPipelineTest is Test {
    TreasuryStabilizer stabilizer;
    DAOTreasury treasury;
    MockGSVibeAMM amm;
    MockGSVolatilityOracle oracle;
    MockGSToken tokenA;
    MockGSToken tokenB;

    bytes32 poolId;
    address owner;

    function setUp() public {
        owner = address(this);
        tokenA = new MockGSToken("Token A", "TKA");
        tokenB = new MockGSToken("Token B", "TKB");
        amm = new MockGSVibeAMM();
        oracle = new MockGSVolatilityOracle();

        // Deploy DAOTreasury
        DAOTreasury treasuryImpl = new DAOTreasury();
        ERC1967Proxy treasuryProxy = new ERC1967Proxy(
            address(treasuryImpl),
            abi.encodeWithSelector(DAOTreasury.initialize.selector, owner, address(amm))
        );
        treasury = DAOTreasury(payable(address(treasuryProxy)));

        // Deploy TreasuryStabilizer
        TreasuryStabilizer stabImpl = new TreasuryStabilizer();
        ERC1967Proxy stabProxy = new ERC1967Proxy(
            address(stabImpl),
            abi.encodeWithSelector(
                TreasuryStabilizer.initialize.selector,
                owner, address(amm), address(treasury), address(oracle)
            )
        );
        stabilizer = TreasuryStabilizer(address(stabProxy));

        // Wire: Authorize stabilizer as backstop operator on treasury
        treasury.setBackstopOperator(address(stabilizer), true);

        // Create pool
        poolId = keccak256(abi.encodePacked(address(tokenA), address(tokenB)));
        amm.setPool(poolId, address(tokenA), address(tokenB), 1000 ether, 1000 ether);

        // Configure stabilizer
        stabilizer.setMainPool(address(tokenA), poolId);
        stabilizer.setConfig(address(tokenA), ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000,
            deploymentRateBps: 500,
            maxDeploymentPerPeriod: 100 ether,
            assessmentPeriod: 1 hours,
            deploymentCooldown: 1 hours,
            enabled: true
        }));

        // Fund treasury with tokens
        tokenA.mint(address(treasury), 10_000 ether);
        tokenB.mint(address(treasury), 10_000 ether);
    }

    // ============ Full Pipeline Tests ============

    function test_fullPipeline_bearMarket_deploy_recover() public {
        // Phase 1: Enter bear market (price drops 30%)
        amm.setTWAP(poolId, 1 hours, 700e18);   // short-term: 700
        amm.setTWAP(poolId, 7 days, 1000e18);    // long-term: 1000
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));
        assertTrue(stabilizer.isBearMarket(address(tokenA)));

        // Phase 2: Deploy backstop
        (bool should, uint256 amount) = stabilizer.shouldDeployBackstop(address(tokenA));
        assertTrue(should);
        assertGt(amount, 0);

        uint256 deployed = stabilizer.executeDeployment(address(tokenA), poolId);
        assertGt(deployed, 0);

        ITreasuryStabilizer.MarketState memory state = stabilizer.getMarketState(address(tokenA));
        assertEq(state.deployedThisPeriod, deployed);
        assertEq(state.totalDeployed, deployed);

        // Phase 3: Market recovers (price back to normal)
        amm.setTWAP(poolId, 1 hours, 1050e18);  // short-term: 1050
        amm.setTWAP(poolId, 7 days, 1000e18);   // long-term: 1000
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));
        assertFalse(stabilizer.isBearMarket(address(tokenA)));

        // Phase 4: Withdraw deployed liquidity
        uint256 received = stabilizer.withdrawDeployment(address(tokenA), poolId, 100 ether);
        assertGt(received, 0);
    }

    function test_stabilizer_treasuryIntegration_backstopAuthorized() public {
        // Verify stabilizer is authorized as backstop operator
        assertTrue(treasury.backstopOperators(address(stabilizer)));
    }

    function test_emergencyMode_haltsDeployment() public {
        // Enter bear market
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));
        assertTrue(stabilizer.isBearMarket(address(tokenA)));

        // Deploy once successfully
        stabilizer.executeDeployment(address(tokenA), poolId);

        // Emergency mode blocks further deployments
        stabilizer.setEmergencyMode(address(tokenA), true);
        vm.warp(block.timestamp + 2 hours); // past cooldown
        vm.expectRevert(TreasuryStabilizer.EmergencyModeActive.selector);
        stabilizer.executeDeployment(address(tokenA), poolId);

        // shouldDeployBackstop also returns false
        (bool should,) = stabilizer.shouldDeployBackstop(address(tokenA));
        assertFalse(should);

        // Disable emergency mode
        stabilizer.setEmergencyMode(address(tokenA), false);
    }

    function test_cooldown_preventsRapidDeployment() public {
        // Use high period limit so we don't hit it before testing cooldown
        stabilizer.setConfig(address(tokenA), ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000,
            deploymentRateBps: 500,
            maxDeploymentPerPeriod: 10_000 ether,
            assessmentPeriod: 1 hours,
            deploymentCooldown: 1 hours,
            enabled: true
        }));

        // Enter bear market
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));

        // First deployment succeeds
        stabilizer.executeDeployment(address(tokenA), poolId);

        // Second deployment during cooldown fails
        vm.expectRevert(TreasuryStabilizer.CooldownActive.selector);
        stabilizer.executeDeployment(address(tokenA), poolId);

        // After cooldown, re-assess and deploy again
        vm.warp(block.timestamp + 2 hours);
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        stabilizer.assessMarketConditions(address(tokenA));
        uint256 deployed2 = stabilizer.executeDeployment(address(tokenA), poolId);
        assertGt(deployed2, 0);
    }

    function test_deploymentLimit_capsPerPeriod() public {
        // Configure tiny limit
        stabilizer.setConfig(address(tokenA), ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000,
            deploymentRateBps: 10000,          // 100% of treasury balance
            maxDeploymentPerPeriod: 50 ether,  // cap at 50
            assessmentPeriod: 1 hours,
            deploymentCooldown: 1,
            enabled: true
        }));

        // Enter bear market
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));

        // Deploy — should be capped at 50 ether
        uint256 deployed = stabilizer.executeDeployment(address(tokenA), poolId);
        assertEq(deployed, 50 ether);

        // Advance past cooldown (1 second), then next deploy fails with period limit
        vm.warp(block.timestamp + 2);
        vm.expectRevert(TreasuryStabilizer.DeploymentLimitReached.selector);
        stabilizer.executeDeployment(address(tokenA), poolId);
    }

    function test_volatilityFallback_triggersBearMarket() public {
        // Don't set TWAP — will fail and fall back to volatility oracle
        oracle.setVolatility(poolId, 8000); // High vol => bear

        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));

        // High volatility (8000) → trend = -(8000-5000)*2 = -6000 → exceeds 2000 threshold
        assertTrue(stabilizer.isBearMarket(address(tokenA)));
    }

    function test_bearToBull_resetsPeriodCounters() public {
        // Enter bear market and deploy
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));
        stabilizer.executeDeployment(address(tokenA), poolId);

        ITreasuryStabilizer.MarketState memory stateBear = stabilizer.getMarketState(address(tokenA));
        assertGt(stateBear.deployedThisPeriod, 0);

        // Transition to bull
        amm.setTWAP(poolId, 1 hours, 1200e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));
        assertFalse(stabilizer.isBearMarket(address(tokenA)));

        // Period counters should be reset
        ITreasuryStabilizer.MarketState memory stateBull = stabilizer.getMarketState(address(tokenA));
        assertEq(stateBull.deployedThisPeriod, 0);
    }

    function test_multipleTokens_independentAssessment() public {
        // Configure tokenB
        bytes32 poolIdB = keccak256(abi.encodePacked(address(tokenB), address(tokenA)));
        amm.setPool(poolIdB, address(tokenB), address(tokenA), 500 ether, 500 ether);
        stabilizer.setMainPool(address(tokenB), poolIdB);
        stabilizer.setConfig(address(tokenB), ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000,
            deploymentRateBps: 500,
            maxDeploymentPerPeriod: 100 ether,
            assessmentPeriod: 1 hours,
            deploymentCooldown: 1 hours,
            enabled: true
        }));

        // TokenA: bear, TokenB: bull
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        amm.setTWAP(poolIdB, 1 hours, 1200e18);
        amm.setTWAP(poolIdB, 7 days, 1000e18);

        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));
        stabilizer.assessMarketConditions(address(tokenB));

        assertTrue(stabilizer.isBearMarket(address(tokenA)));
        assertFalse(stabilizer.isBearMarket(address(tokenB)));
    }

    function test_deploymentHistory_tracked() public {
        // Enter bear market
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));

        // Deploy
        uint256 deployed = stabilizer.executeDeployment(address(tokenA), poolId);

        // Check history
        ITreasuryStabilizer.DeploymentRecord[] memory history = stabilizer.getDeploymentHistory(address(tokenA));
        assertEq(history.length, 1);
        assertEq(history[0].poolId, poolId);
        assertEq(history[0].amount, deployed);
        assertEq(history[0].timestamp, uint64(block.timestamp));
    }

    function test_pauseStopsAssessmentAndDeployment() public {
        // Pause stabilizer
        stabilizer.pause();

        // Assessment blocked
        vm.expectRevert();
        stabilizer.assessMarketConditions(address(tokenA));

        // Unpause
        stabilizer.unpause();

        // Now works
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(tokenA));
        assertTrue(stabilizer.isBearMarket(address(tokenA)));
    }
}
