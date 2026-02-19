// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/governance/TreasuryStabilizer.sol";

contract MockTSFToken is ERC20 {
    constructor() ERC20("Mock", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockTSFVibeAMM {
    mapping(bytes32 => mapping(uint32 => uint256)) public twapPrices;
    function setTWAP(bytes32 poolId, uint32 period, uint256 price) external { twapPrices[poolId][period] = price; }
    function getTWAP(bytes32 poolId, uint32 period) external view returns (uint256) { return twapPrices[poolId][period]; }
    function getPool(bytes32) external pure returns (IVibeAMM.Pool memory) {
        return IVibeAMM.Pool(address(0), address(0), 1000 ether, 1000 ether, 2000 ether, 30, true);
    }
}

contract MockTSFDAOTreasury {
    function provideBackstopLiquidity(bytes32, uint256, uint256) external {}
    function removeBackstopLiquidity(bytes32, uint256, uint256, uint256) external returns (uint256) { return 0; }
}

contract MockTSFVolatilityOracle {
    function getVolatilityData(bytes32) external pure returns (uint256, IVolatilityOracle.VolatilityTier, uint64) {
        return (0, IVolatilityOracle.VolatilityTier.LOW, 0);
    }
}

contract TreasuryStabilizerFuzzTest is Test {
    TreasuryStabilizer public stabilizer;
    MockTSFToken public token;
    MockTSFVibeAMM public amm;
    MockTSFDAOTreasury public treasury;
    MockTSFVolatilityOracle public oracle;

    function setUp() public {
        token = new MockTSFToken();
        amm = new MockTSFVibeAMM();
        treasury = new MockTSFDAOTreasury();
        oracle = new MockTSFVolatilityOracle();

        TreasuryStabilizer impl = new TreasuryStabilizer();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(TreasuryStabilizer.initialize.selector, address(this), address(amm), address(treasury), address(oracle))
        );
        stabilizer = TreasuryStabilizer(address(proxy));
    }

    /// @notice Config validation always enforces bounds
    function testFuzz_setConfig_validatesAssessmentPeriod(uint64 period) public {
        period = uint64(bound(period, 0, 365 days));
        ITreasuryStabilizer.StabilizerConfig memory config = ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000, deploymentRateBps: 500, maxDeploymentPerPeriod: 100 ether,
            assessmentPeriod: period, deploymentCooldown: 1 hours, enabled: true
        });

        if (period < 1 hours) {
            vm.expectRevert(TreasuryStabilizer.InvalidConfig.selector);
        }
        stabilizer.setConfig(address(token), config);
    }

    /// @notice Config validation always enforces threshold bounds
    function testFuzz_setConfig_validatesThreshold(uint256 threshold) public {
        threshold = bound(threshold, 0, 20000);
        ITreasuryStabilizer.StabilizerConfig memory config = ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: threshold, deploymentRateBps: 500, maxDeploymentPerPeriod: 100 ether,
            assessmentPeriod: 1 hours, deploymentCooldown: 1 hours, enabled: true
        });

        if (threshold == 0 || threshold > 10000) {
            vm.expectRevert(TreasuryStabilizer.InvalidConfig.selector);
        }
        stabilizer.setConfig(address(token), config);
    }

    /// @notice Deployment amount never exceeds period limit
    function testFuzz_deploymentCappedByPeriodLimit(uint256 treasuryBalance, uint256 maxPerPeriod, uint256 rateBps) public {
        treasuryBalance = bound(treasuryBalance, 1 ether, 1e30);
        maxPerPeriod = bound(maxPerPeriod, 1, 1e30);
        rateBps = bound(rateBps, 1, 10000);

        ITreasuryStabilizer.StabilizerConfig memory config = ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000, deploymentRateBps: rateBps, maxDeploymentPerPeriod: maxPerPeriod,
            assessmentPeriod: 1 hours, deploymentCooldown: 1, enabled: true
        });
        stabilizer.setConfig(address(token), config);

        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        stabilizer.setMainPool(address(token), poolId);
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));

        token.mint(address(treasury), treasuryBalance);

        uint256 deployed = stabilizer.executeDeployment(address(token), poolId);
        assertLe(deployed, maxPerPeriod, "Deployed exceeds period limit");
    }

    /// @notice Deployment amount is correct percentage of treasury balance
    function testFuzz_deploymentRateCorrect(uint256 treasuryBalance, uint256 rateBps) public {
        treasuryBalance = bound(treasuryBalance, 1 ether, 1e30);
        rateBps = bound(rateBps, 1, 10000);

        ITreasuryStabilizer.StabilizerConfig memory config = ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000, deploymentRateBps: rateBps, maxDeploymentPerPeriod: type(uint256).max,
            assessmentPeriod: 1 hours, deploymentCooldown: 1, enabled: true
        });
        stabilizer.setConfig(address(token), config);

        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        stabilizer.setMainPool(address(token), poolId);
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));

        token.mint(address(treasury), treasuryBalance);

        uint256 deployed = stabilizer.executeDeployment(address(token), poolId);
        uint256 expected = (treasuryBalance * rateBps) / 10000;
        assertEq(deployed, expected, "Deployment rate incorrect");
    }

    /// @notice Emergency mode always blocks deployment
    function testFuzz_emergencyBlocksDeployment(bool emergencyEnabled) public {
        ITreasuryStabilizer.StabilizerConfig memory config = ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000, deploymentRateBps: 500, maxDeploymentPerPeriod: 100 ether,
            assessmentPeriod: 1 hours, deploymentCooldown: 1, enabled: true
        });
        stabilizer.setConfig(address(token), config);

        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        stabilizer.setMainPool(address(token), poolId);
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));

        token.mint(address(treasury), 1000 ether);

        if (emergencyEnabled) {
            stabilizer.setEmergencyMode(address(token), true);
            vm.expectRevert(TreasuryStabilizer.EmergencyModeActive.selector);
        }
        stabilizer.executeDeployment(address(token), poolId);
    }

    /// @notice Cooldown always prevents deployment within period
    function testFuzz_cooldownEnforced(uint64 cooldown) public {
        cooldown = uint64(bound(cooldown, 1, 30 days));

        ITreasuryStabilizer.StabilizerConfig memory config = ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: 2000, deploymentRateBps: 500, maxDeploymentPerPeriod: type(uint256).max,
            assessmentPeriod: 1 hours, deploymentCooldown: cooldown, enabled: true
        });
        stabilizer.setConfig(address(token), config);

        bytes32 poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
        stabilizer.setMainPool(address(token), poolId);
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        stabilizer.assessMarketConditions(address(token));

        token.mint(address(treasury), 1000 ether);
        stabilizer.executeDeployment(address(token), poolId);

        // Try again within cooldown
        vm.expectRevert(TreasuryStabilizer.CooldownActive.selector);
        stabilizer.executeDeployment(address(token), poolId);
    }
}
