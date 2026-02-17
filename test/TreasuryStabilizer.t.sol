// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/governance/TreasuryStabilizer.sol";

// ============ Mocks ============

contract MockTSToken is ERC20 {
    constructor() ERC20("MockToken", "MTK") {
        _mint(msg.sender, 1_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockTSVibeAMM {
    mapping(bytes32 => IVibeAMM.Pool) public pools;
    mapping(bytes32 => mapping(uint32 => uint256)) public twapPrices;

    function setPool(bytes32 poolId, uint256 r0, uint256 r1) external {
        pools[poolId] = IVibeAMM.Pool({
            token0: address(0),
            token1: address(0),
            reserve0: r0,
            reserve1: r1,
            totalLiquidity: r0 + r1,
            feeRate: 30,
            initialized: true
        });
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
}

contract MockTSDAOTreasury {
    bool public liquidityProvided;
    bool public shouldRevertRemove;
    uint256 public lastRemoveReturn;

    function provideBackstopLiquidity(bytes32, uint256, uint256) external {
        liquidityProvided = true;
    }

    function removeBackstopLiquidity(bytes32, uint256, uint256, uint256) external returns (uint256) {
        if (shouldRevertRemove) revert("remove failed");
        lastRemoveReturn = 100 ether;
        return lastRemoveReturn;
    }

    function setShouldRevertRemove(bool val) external {
        shouldRevertRemove = val;
    }
}

contract MockTSVolatilityOracle {
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

contract TreasuryStabilizerTest is Test {
    TreasuryStabilizer public stabilizer;
    MockTSToken public token;
    MockTSVibeAMM public amm;
    MockTSDAOTreasury public treasury;
    MockTSVolatilityOracle public oracle;
    address public owner;

    function setUp() public {
        owner = address(this);
        token = new MockTSToken();
        amm = new MockTSVibeAMM();
        treasury = new MockTSDAOTreasury();
        oracle = new MockTSVolatilityOracle();

        TreasuryStabilizer impl = new TreasuryStabilizer();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                TreasuryStabilizer.initialize.selector,
                owner,
                address(amm),
                address(treasury),
                address(oracle)
            )
        );
        stabilizer = TreasuryStabilizer(address(proxy));
    }

    function _defaultConfig() internal pure returns (ITreasuryStabilizer.StabilizerConfig memory) {
        return ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000,
            deploymentRateBps: 500,
            maxDeploymentPerPeriod: 100 ether,
            assessmentPeriod: 1 hours,
            deploymentCooldown: 1 hours,
            enabled: true
        });
    }

    function _setupBearMarket() internal returns (bytes32 poolId) {
        stabilizer.setConfig(address(token), _defaultConfig());

        poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        // Set TWAP so short < long (bear market with > 20% decline)
        amm.setTWAP(poolId, 1 hours, 700e18);    // short-term low
        amm.setTWAP(poolId, 7 days, 1000e18);    // long-term high
        amm.setPool(poolId, 1000 ether, 1000 ether);

        // Advance past assessment period
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(stabilizer.owner(), owner);
        assertEq(address(stabilizer.vibeAMM()), address(amm));
        assertEq(address(stabilizer.daoTreasury()), address(treasury));
        assertEq(address(stabilizer.volatilityOracle()), address(oracle));
        assertEq(stabilizer.shortTermPeriod(), 1 hours);
        assertEq(stabilizer.longTermPeriod(), 7 days);
    }

    function test_initialize_zeroAddress_reverts() public {
        TreasuryStabilizer impl = new TreasuryStabilizer();
        vm.expectRevert(TreasuryStabilizer.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(TreasuryStabilizer.initialize.selector, owner, address(0), address(treasury), address(oracle))
        );
    }

    // ============ Config ============

    function test_setConfig() public {
        ITreasuryStabilizer.StabilizerConfig memory config = _defaultConfig();
        stabilizer.setConfig(address(token), config);

        ITreasuryStabilizer.StabilizerConfig memory stored = stabilizer.getConfig(address(token));
        assertEq(stored.bearMarketThresholdBps, 2000);
        assertEq(stored.deploymentRateBps, 500);
        assertTrue(stored.enabled);
    }

    function test_setConfig_onlyOwner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        stabilizer.setConfig(address(token), _defaultConfig());
    }

    function test_setConfig_invalidAssessmentPeriod() public {
        ITreasuryStabilizer.StabilizerConfig memory config = _defaultConfig();
        config.assessmentPeriod = 30 minutes; // Below MIN_ASSESSMENT_PERIOD
        vm.expectRevert(TreasuryStabilizer.InvalidConfig.selector);
        stabilizer.setConfig(address(token), config);
    }

    function test_setConfig_invalidThreshold_zero() public {
        ITreasuryStabilizer.StabilizerConfig memory config = _defaultConfig();
        config.bearMarketThresholdBps = 0;
        vm.expectRevert(TreasuryStabilizer.InvalidConfig.selector);
        stabilizer.setConfig(address(token), config);
    }

    function test_setConfig_invalidThreshold_tooHigh() public {
        ITreasuryStabilizer.StabilizerConfig memory config = _defaultConfig();
        config.bearMarketThresholdBps = 10001;
        vm.expectRevert(TreasuryStabilizer.InvalidConfig.selector);
        stabilizer.setConfig(address(token), config);
    }

    function test_setConfig_initializesPeriodStart() public {
        stabilizer.setConfig(address(token), _defaultConfig());
        ITreasuryStabilizer.MarketState memory state = stabilizer.getMarketState(address(token));
        assertEq(state.periodStart, uint64(block.timestamp));
    }

    // ============ Market Assessment ============

    function test_assessMarketConditions_bearMarket() public {
        _setupBearMarket();
        assertTrue(stabilizer.isBearMarket(address(token)));
    }

    function test_assessMarketConditions_bullMarket() public {
        stabilizer.setConfig(address(token), _defaultConfig());
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        // short > long = bull market
        amm.setTWAP(poolId, 1 hours, 1200e18);
        amm.setTWAP(poolId, 7 days, 1000e18);

        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));
        assertFalse(stabilizer.isBearMarket(address(token)));
    }

    function test_assessMarketConditions_notEnabled_reverts() public {
        ITreasuryStabilizer.StabilizerConfig memory config = _defaultConfig();
        config.enabled = false;
        stabilizer.setConfig(address(token), config);

        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(TreasuryStabilizer.InvalidConfig.selector);
        stabilizer.assessMarketConditions(address(token));
    }

    function test_assessMarketConditions_tooSoon_reverts() public {
        stabilizer.setConfig(address(token), _defaultConfig());
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        amm.setTWAP(poolId, 1 hours, 1000e18);
        amm.setTWAP(poolId, 7 days, 1000e18);

        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));

        // Try again immediately
        vm.expectRevert(TreasuryStabilizer.AssessmentTooSoon.selector);
        stabilizer.assessMarketConditions(address(token));
    }

    function test_assessMarketConditions_paused_reverts() public {
        stabilizer.setConfig(address(token), _defaultConfig());
        stabilizer.pause();
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert();
        stabilizer.assessMarketConditions(address(token));
    }

    function test_assessMarketConditions_bearToBull_resetsPeriod() public {
        _setupBearMarket();
        assertTrue(stabilizer.isBearMarket(address(token)));

        // Switch to bull
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        amm.setTWAP(poolId, 1 hours, 1200e18);
        amm.setTWAP(poolId, 7 days, 1000e18);

        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));
        assertFalse(stabilizer.isBearMarket(address(token)));
    }

    function test_assessMarketConditions_volatilityFallback() public {
        stabilizer.setConfig(address(token), _defaultConfig());
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        // Don't set TWAP (will fail) — should fall back to volatility oracle
        oracle.setVolatility(poolId, 8000); // High volatility => bear

        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));
        // With high volatility, trend = -(8000-5000)*2 = -6000, which > 2000 threshold
        assertTrue(stabilizer.isBearMarket(address(token)));
    }

    // ============ shouldDeployBackstop ============

    function test_shouldDeployBackstop_bearMarket() public {
        _setupBearMarket();

        // Give treasury some tokens
        token.mint(address(treasury), 1000 ether);

        (bool should, uint256 amount) = stabilizer.shouldDeployBackstop(address(token));
        assertTrue(should);
        assertEq(amount, (1000 ether * 500) / 10000); // 5%
    }

    function test_shouldDeployBackstop_notBear() public {
        stabilizer.setConfig(address(token), _defaultConfig());
        (bool should,) = stabilizer.shouldDeployBackstop(address(token));
        assertFalse(should);
    }

    function test_shouldDeployBackstop_emergencyMode() public {
        _setupBearMarket();
        stabilizer.setEmergencyMode(address(token), true);
        (bool should,) = stabilizer.shouldDeployBackstop(address(token));
        assertFalse(should);
    }

    function test_shouldDeployBackstop_cooldownActive() public {
        _setupBearMarket();
        token.mint(address(treasury), 1000 ether);
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        stabilizer.executeDeployment(address(token), poolId);

        // Still in cooldown
        (bool should,) = stabilizer.shouldDeployBackstop(address(token));
        assertFalse(should);
    }

    // ============ executeDeployment ============

    function test_executeDeployment() public {
        _setupBearMarket();
        token.mint(address(treasury), 1000 ether);
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        uint256 deployed = stabilizer.executeDeployment(address(token), poolId);
        assertGt(deployed, 0);
        assertTrue(treasury.liquidityProvided());

        ITreasuryStabilizer.MarketState memory state = stabilizer.getMarketState(address(token));
        assertEq(state.deployedThisPeriod, deployed);
        assertEq(state.totalDeployed, deployed);
    }

    function test_executeDeployment_notBear_reverts() public {
        stabilizer.setConfig(address(token), _defaultConfig());
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        vm.expectRevert(TreasuryStabilizer.NotBearMarket.selector);
        stabilizer.executeDeployment(address(token), poolId);
    }

    function test_executeDeployment_emergencyMode_reverts() public {
        _setupBearMarket();
        stabilizer.setEmergencyMode(address(token), true);
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        vm.expectRevert(TreasuryStabilizer.EmergencyModeActive.selector);
        stabilizer.executeDeployment(address(token), poolId);
    }

    function test_executeDeployment_cooldown_reverts() public {
        _setupBearMarket();
        token.mint(address(treasury), 1000 ether);
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        stabilizer.executeDeployment(address(token), poolId);

        vm.expectRevert(TreasuryStabilizer.CooldownActive.selector);
        stabilizer.executeDeployment(address(token), poolId);
    }

    function test_executeDeployment_periodLimitReached_reverts() public {
        ITreasuryStabilizer.StabilizerConfig memory config = _defaultConfig();
        config.maxDeploymentPerPeriod = 1; // tiny limit
        config.deploymentRateBps = 10000; // 100%
        config.deploymentCooldown = 1; // minimal cooldown so it doesn't hit CooldownActive first
        stabilizer.setConfig(address(token), config);

        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        amm.setPool(poolId, 1000 ether, 1000 ether);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));

        token.mint(address(treasury), 1000 ether);
        stabilizer.executeDeployment(address(token), poolId);

        // Advance past cooldown but still within deployment period
        vm.warp(block.timestamp + 2);
        vm.expectRevert(TreasuryStabilizer.DeploymentLimitReached.selector);
        stabilizer.executeDeployment(address(token), poolId);
    }

    function test_executeDeployment_periodReset() public {
        _setupBearMarket();
        token.mint(address(treasury), 1000 ether);
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        stabilizer.executeDeployment(address(token), poolId);

        // Advance past MAX_DEPLOYMENT_PERIOD (7 days) + cooldown
        vm.warp(block.timestamp + 8 days);

        // Re-assess to confirm still bear
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        stabilizer.assessMarketConditions(address(token));

        // Should work since period reset
        uint256 deployed = stabilizer.executeDeployment(address(token), poolId);
        assertGt(deployed, 0);
    }

    // ============ withdrawDeployment ============

    function test_withdrawDeployment() public {
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        uint256 received = stabilizer.withdrawDeployment(address(token), poolId, 10 ether);
        assertEq(received, 100 ether);
    }

    function test_withdrawDeployment_onlyOwner() public {
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        stabilizer.withdrawDeployment(address(token), poolId, 10 ether);
    }

    function test_withdrawDeployment_revertHandled() public {
        treasury.setShouldRevertRemove(true);
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        uint256 received = stabilizer.withdrawDeployment(address(token), poolId, 10 ether);
        assertEq(received, 0);
    }

    // ============ Emergency Mode ============

    function test_setEmergencyMode() public {
        stabilizer.setEmergencyMode(address(token), true);
        assertTrue(stabilizer.emergencyMode(address(token)));

        stabilizer.setEmergencyMode(address(token), false);
        assertFalse(stabilizer.emergencyMode(address(token)));
    }

    function test_setEmergencyMode_onlyOwner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        stabilizer.setEmergencyMode(address(token), true);
    }

    // ============ Admin ============

    function test_setTWAPPeriods() public {
        stabilizer.setTWAPPeriods(30 minutes, 14 days);
        assertEq(stabilizer.shortTermPeriod(), 30 minutes);
        assertEq(stabilizer.longTermPeriod(), 14 days);
    }

    function test_setVibeAMM() public {
        address newAMM = makeAddr("newAMM");
        stabilizer.setVibeAMM(newAMM);
        assertEq(address(stabilizer.vibeAMM()), newAMM);
    }

    function test_setVibeAMM_zeroAddress_reverts() public {
        vm.expectRevert(TreasuryStabilizer.ZeroAddress.selector);
        stabilizer.setVibeAMM(address(0));
    }

    function test_setDAOTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        stabilizer.setDAOTreasury(newTreasury);
        assertEq(address(stabilizer.daoTreasury()), newTreasury);
    }

    function test_setDAOTreasury_zeroAddress_reverts() public {
        vm.expectRevert(TreasuryStabilizer.ZeroAddress.selector);
        stabilizer.setDAOTreasury(address(0));
    }

    function test_setVolatilityOracle() public {
        address newOracle = makeAddr("newOracle");
        stabilizer.setVolatilityOracle(newOracle);
        assertEq(address(stabilizer.volatilityOracle()), newOracle);
    }

    function test_setVolatilityOracle_zeroAddress_reverts() public {
        vm.expectRevert(TreasuryStabilizer.ZeroAddress.selector);
        stabilizer.setVolatilityOracle(address(0));
    }

    function test_pauseUnpause() public {
        stabilizer.pause();
        stabilizer.unpause();
    }

    // ============ View Functions ============

    function test_getDeploymentHistory() public {
        _setupBearMarket();
        token.mint(address(treasury), 1000 ether);
        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));

        stabilizer.executeDeployment(address(token), poolId);

        ITreasuryStabilizer.DeploymentRecord[] memory history = stabilizer.getDeploymentHistory(address(token));
        assertEq(history.length, 1);
        assertEq(history[0].poolId, poolId);
        assertGt(history[0].amount, 0);
    }

    function test_getAvailableForDeployment() public {
        _setupBearMarket();
        token.mint(address(treasury), 1000 ether);

        uint256 available = stabilizer.getAvailableForDeployment(address(token));
        assertGt(available, 0);
    }

    function test_getAvailableForDeployment_notBear() public {
        stabilizer.setConfig(address(token), _defaultConfig());
        uint256 available = stabilizer.getAvailableForDeployment(address(token));
        assertEq(available, 0);
    }
}
