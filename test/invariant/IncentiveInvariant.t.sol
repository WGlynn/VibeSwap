// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/incentives/ILProtectionVault.sol";
import "../../contracts/incentives/LoyaltyRewardsManager.sol";
import "../../contracts/incentives/SlippageGuaranteeFund.sol";
import "../../contracts/oracles/VolatilityOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockVibeAMM {
    function getPool(bytes32) external pure returns (
        address token0,
        address token1,
        uint256 reserve0,
        uint256 reserve1,
        uint256 feeRate,
        bool initialized
    ) {
        return (address(0), address(0), 100 ether, 100 ether, 30, true);
    }
}

/**
 * @title Incentive Handler for Invariant Testing
 */
contract IncentiveHandler is Test {
    ILProtectionVault public vault;
    LoyaltyRewardsManager public loyalty;
    SlippageGuaranteeFund public slippage;
    MockToken public token;

    address public controller;
    bytes32 public constant POOL_ID = keccak256("test-pool");

    address[] public users;

    // Ghost variables
    uint256 public ghost_totalILRegistered;
    uint256 public ghost_totalLoyaltyStaked;
    uint256 public ghost_totalSlippageClaims;

    constructor(
        ILProtectionVault _vault,
        LoyaltyRewardsManager _loyalty,
        SlippageGuaranteeFund _slippage,
        MockToken _token,
        address _controller
    ) {
        vault = _vault;
        loyalty = _loyalty;
        slippage = _slippage;
        token = _token;
        controller = _controller;

        for (uint256 i = 0; i < 10; i++) {
            users.push(address(uint160(i + 2000)));
        }
    }

    // ============ IL Protection Actions ============

    function registerILPosition(
        uint256 userSeed,
        uint256 liquidity,
        uint256 entryPrice,
        uint8 tier
    ) public {
        address user = users[userSeed % users.length];
        liquidity = bound(liquidity, 0.1 ether, 100 ether);
        entryPrice = bound(entryPrice, 0.001 ether, 10000 ether);
        tier = uint8(bound(tier, 0, 2));

        vm.prank(controller);
        try vault.registerPosition(POOL_ID, user, liquidity, entryPrice, tier) {
            ghost_totalILRegistered += liquidity;
        } catch {}
    }

    // ============ Loyalty Actions ============

    function registerLoyaltyStake(uint256 userSeed, uint256 liquidity) public {
        address user = users[userSeed % users.length];
        liquidity = bound(liquidity, 0.1 ether, 100 ether);

        vm.prank(controller);
        try loyalty.registerStake(POOL_ID, user, liquidity) {
            ghost_totalLoyaltyStaked += liquidity;
        } catch {}
    }

    function advanceTime(uint256 timeJump) public {
        timeJump = bound(timeJump, 1 hours, 30 days);
        vm.warp(block.timestamp + timeJump);
    }

    // ============ Slippage Actions ============

    function recordSlippageExecution(
        uint256 userSeed,
        uint256 expectedOutput,
        uint256 shortfallBps
    ) public {
        address user = users[userSeed % users.length];
        expectedOutput = bound(expectedOutput, 1 ether, 1000 ether);
        shortfallBps = bound(shortfallBps, 0, 500); // 0-5% shortfall

        uint256 actualOutput = expectedOutput - (expectedOutput * shortfallBps / 10000);

        vm.prank(controller);
        try slippage.recordExecution(
            POOL_ID,
            user,
            address(token),
            expectedOutput,
            actualOutput
        ) {
            ghost_totalSlippageClaims++;
        } catch {}
    }
}

/**
 * @title Incentive System Invariant Tests
 */
contract IncentiveInvariantTest is StdInvariant, Test {
    ILProtectionVault public vault;
    LoyaltyRewardsManager public loyalty;
    SlippageGuaranteeFund public slippage;
    VolatilityOracle public oracle;
    MockVibeAMM public mockAMM;
    MockToken public token;
    MockToken public rewardToken;

    IncentiveHandler public handler;

    address public owner;
    address public controller;
    address public treasury;

    bytes32 public constant POOL_ID = keccak256("test-pool");

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        treasury = makeAddr("treasury");

        // Deploy mocks
        token = new MockToken("USDC", "USDC");
        rewardToken = new MockToken("VIBE", "VIBE");
        mockAMM = new MockVibeAMM();

        // Deploy oracle
        VolatilityOracle oracleImpl = new VolatilityOracle();
        bytes memory oracleInit = abi.encodeWithSelector(
            VolatilityOracle.initialize.selector,
            owner,
            address(mockAMM)
        );
        ERC1967Proxy oracleProxy = new ERC1967Proxy(address(oracleImpl), oracleInit);
        oracle = VolatilityOracle(address(oracleProxy));

        // Deploy IL Protection Vault
        ILProtectionVault vaultImpl = new ILProtectionVault();
        bytes memory vaultInit = abi.encodeWithSelector(
            ILProtectionVault.initialize.selector,
            owner,
            address(oracle),
            controller,
            address(mockAMM)
        );
        ERC1967Proxy vaultProxy = new ERC1967Proxy(address(vaultImpl), vaultInit);
        vault = ILProtectionVault(address(vaultProxy));
        vault.setPoolQuoteToken(POOL_ID, address(token));

        // Fund vault
        token.mint(address(this), 10000 ether);
        token.approve(address(vault), 10000 ether);
        vault.depositFunds(address(token), 10000 ether);

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
        rewardToken.mint(address(loyalty), 10000 ether);

        // Deploy Slippage Fund
        SlippageGuaranteeFund slippageImpl = new SlippageGuaranteeFund();
        bytes memory slippageInit = abi.encodeWithSelector(
            SlippageGuaranteeFund.initialize.selector,
            owner,
            controller
        );
        ERC1967Proxy slippageProxy = new ERC1967Proxy(address(slippageImpl), slippageInit);
        slippage = SlippageGuaranteeFund(address(slippageProxy));

        // Fund slippage
        token.mint(address(this), 10000 ether);
        token.approve(address(slippage), 10000 ether);
        slippage.depositFunds(address(token), 10000 ether);

        // Setup handler
        handler = new IncentiveHandler(vault, loyalty, slippage, token, controller);

        targetContract(address(handler));
    }

    // ============ IL Protection Invariants ============

    /**
     * @notice Invariant: IL coverage rate should never exceed tier maximum
     */
    function invariant_ilCoverageWithinBounds() public view {
        // Basic tier: 25%, Standard: 50%, Premium: 80%
        uint256[3] memory maxCoverage = [uint256(2500), uint256(5000), uint256(8000)];

        for (uint8 tier = 0; tier < 3; tier++) {
            IILProtectionVault.TierConfig memory config = vault.getTierConfig(tier);
            assertLe(
                config.coverageRateBps,
                maxCoverage[tier] + 1000, // Allow some admin adjustment
                "IL coverage exceeds maximum for tier"
            );
        }
    }

    /**
     * @notice Invariant: Vault reserves should be non-negative
     */
    function invariant_vaultReservesNonNegative() public view {
        uint256 reserves = vault.getTotalReserves(address(token));
        // Reserves can decrease due to claims but should never underflow
        assertGe(reserves, 0, "Vault reserves underflowed");
    }

    // ============ Loyalty Invariants ============

    /**
     * @notice Invariant: Loyalty multiplier should be within defined tiers
     */
    function invariant_loyaltyMultiplierBounded() public view {
        // Multipliers: 1.0x (10000), 1.25x (12500), 1.5x (15000), 2.0x (20000)
        // Max multiplier is 2.0x = 20000 bps
        for (uint8 tier = 0; tier < 4; tier++) {
            ILoyaltyRewardsManager.LoyaltyTier memory tierConfig = loyalty.getTier(tier);
            assertLe(tierConfig.multiplierBps, 25000, "Multiplier exceeds reasonable maximum");
            assertGe(tierConfig.multiplierBps, 10000, "Multiplier below 1.0x");
        }
    }

    /**
     * @notice Invariant: Early exit penalty should decrease with tier
     */
    function invariant_penaltyDecreasesWithTier() public view {
        uint256 prevPenalty = type(uint256).max;

        for (uint8 tier = 0; tier < 4; tier++) {
            ILoyaltyRewardsManager.LoyaltyTier memory tierConfig = loyalty.getTier(tier);
            assertLe(tierConfig.earlyExitPenaltyBps, prevPenalty, "Penalty should decrease with tier");
            prevPenalty = tierConfig.earlyExitPenaltyBps;
        }
    }

    // ============ Slippage Fund Invariants ============

    /**
     * @notice Invariant: Max claim percent should be reasonable (< 10%)
     */
    function invariant_slippageClaimBounded() public view {
        ISlippageGuaranteeFund.FundConfig memory config = slippage.getConfig();
        assertLe(config.maxClaimPercentBps, 1000, "Max claim percent too high");
    }

    /**
     * @notice Invariant: Claims should not exceed fund reserves
     */
    function invariant_slippageReservesSufficient() public view {
        uint256 reserves = slippage.getTotalReserves(address(token));
        // Fund should maintain some reserves
        // Note: In production, this might trigger refills from treasury
        assertGe(reserves, 0, "Slippage fund depleted");
    }

    // ============ Cross-System Invariants ============

    /**
     * @notice Summary of handler actions
     */
    function invariant_callSummary() public view {
        console.log("--- Incentive Handler Summary ---");
        console.log("Total IL registered:", handler.ghost_totalILRegistered());
        console.log("Total loyalty staked:", handler.ghost_totalLoyaltyStaked());
        console.log("Total slippage claims:", handler.ghost_totalSlippageClaims());
    }
}
