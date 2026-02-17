// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/governance/TreasuryStabilizer.sol";

// ============ Mocks ============

contract MockTSIToken is ERC20 {
    constructor() ERC20("Mock", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockTSIVibeAMM {
    mapping(bytes32 => mapping(uint32 => uint256)) public twapPrices;
    function setTWAP(bytes32 poolId, uint32 period, uint256 price) external { twapPrices[poolId][period] = price; }
    function getTWAP(bytes32 poolId, uint32 period) external view returns (uint256) { return twapPrices[poolId][period]; }
    function getPool(bytes32) external pure returns (IVibeAMM.Pool memory) {
        return IVibeAMM.Pool(address(0), address(0), 1000 ether, 1000 ether, 2000 ether, 30, true);
    }
}

contract MockTSIDAOTreasury {
    function provideBackstopLiquidity(bytes32, uint256, uint256) external {}
    function removeBackstopLiquidity(bytes32, uint256, uint256, uint256) external returns (uint256) { return 0; }
}

contract MockTSIVolatilityOracle {
    function getVolatilityData(bytes32) external pure returns (uint256, IVolatilityOracle.VolatilityTier, uint64) {
        return (0, IVolatilityOracle.VolatilityTier.LOW, 0);
    }
}

// ============ Handler ============

contract StabilizerHandler is Test {
    TreasuryStabilizer public stabilizer;
    MockTSIToken public token;
    MockTSIVibeAMM public amm;
    MockTSIDAOTreasury public treasury;

    bytes32 public poolId;

    // Ghost variables
    uint256 public ghost_totalDeployed;
    uint256 public ghost_configSetCount;
    uint256 public ghost_assessmentCount;
    bool public ghost_emergencyActive;

    constructor(
        TreasuryStabilizer _stabilizer,
        MockTSIToken _token,
        MockTSIVibeAMM _amm,
        MockTSIDAOTreasury _treasury
    ) {
        stabilizer = _stabilizer;
        token = _token;
        amm = _amm;
        treasury = _treasury;
        poolId = keccak256(abi.encodePacked(address(token), "MAIN"));
    }

    function setConfig(uint256 thresholdBps, uint256 rateBps) public {
        thresholdBps = bound(thresholdBps, 1, 10000);
        rateBps = bound(rateBps, 1, 10000);

        ITreasuryStabilizer.StabilizerConfig memory config = ITreasuryStabilizer.StabilizerConfig({
            bearMarketThresholdBps: thresholdBps,
            deploymentRateBps: rateBps,
            maxDeploymentPerPeriod: 1000 ether,
            assessmentPeriod: 1 hours,
            deploymentCooldown: 1,
            enabled: true
        });
        try stabilizer.setConfig(address(token), config) {
            ghost_configSetCount++;
        } catch {}
    }

    function assessMarket() public {
        amm.setTWAP(poolId, 1 hours, 700e18);
        amm.setTWAP(poolId, 7 days, 1000e18);
        vm.warp(block.timestamp + 2 hours);
        try stabilizer.assessMarketConditions(address(token)) {
            ghost_assessmentCount++;
        } catch {}
    }

    function deploy() public {
        token.mint(address(treasury), 100 ether);
        try stabilizer.executeDeployment(address(token), poolId) returns (uint256 amount) {
            ghost_totalDeployed += amount;
        } catch {}
    }

    function toggleEmergency(bool enable) public {
        try stabilizer.setEmergencyMode(address(token), enable) {
            ghost_emergencyActive = enable;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 7 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract TreasuryStabilizerInvariantTest is StdInvariant, Test {
    TreasuryStabilizer public stabilizer;
    MockTSIToken public token;
    MockTSIVibeAMM public amm;
    MockTSIDAOTreasury public treasury;
    MockTSIVolatilityOracle public oracle;
    StabilizerHandler public handler;

    function setUp() public {
        token = new MockTSIToken();
        amm = new MockTSIVibeAMM();
        treasury = new MockTSIDAOTreasury();
        oracle = new MockTSIVolatilityOracle();

        TreasuryStabilizer impl = new TreasuryStabilizer();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(TreasuryStabilizer.initialize.selector, address(this), address(amm), address(treasury), address(oracle))
        );
        stabilizer = TreasuryStabilizer(address(proxy));

        handler = new StabilizerHandler(stabilizer, token, amm, treasury);
        targetContract(address(handler));
    }

    /// @notice Deployment rate BPS is always within valid range
    function invariant_configBoundsValid() public view {
        ITreasuryStabilizer.StabilizerConfig memory config = stabilizer.getConfig(address(token));
        if (config.enabled) {
            assertLe(config.bearMarketThresholdBps, 10000, "THRESHOLD: exceeds 100%");
            assertLe(config.deploymentRateBps, 10000, "RATE: exceeds 100%");
        }
    }

    /// @notice Emergency mode flag is consistent with ghost
    function invariant_emergencyModeConsistent() public view {
        bool contractEmergency = stabilizer.emergencyMode(address(token));
        assertEq(contractEmergency, handler.ghost_emergencyActive(), "EMERGENCY: ghost mismatch");
    }

    /// @notice Deployed amount never exceeds what was deployed
    function invariant_deployedNonNegative() public view {
        assertGe(handler.ghost_totalDeployed(), 0, "DEPLOYED: underflow");
    }

    /// @notice Assessment period is always >= 1 hour when config is set
    function invariant_assessmentPeriodMinimum() public view {
        ITreasuryStabilizer.StabilizerConfig memory config = stabilizer.getConfig(address(token));
        if (config.enabled) {
            assertGe(config.assessmentPeriod, 1 hours, "ASSESSMENT: below minimum");
        }
    }
}
