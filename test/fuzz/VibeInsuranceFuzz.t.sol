// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeInsurance.sol";
import "../../contracts/financial/interfaces/IVibeInsurance.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFuzzToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockFuzzOracle is IReputationOracle {
    mapping(address => uint8) public tiers;

    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Fuzz Tests ============

/**
 * @title VibeInsurance Fuzz Tests
 * @notice Property-based testing for insurance premium calculations,
 *         capacity constraints, and payout invariants.
 *         Part of VSOS mandatory verification layer.
 */
contract VibeInsuranceFuzzTest is Test {
    VibeInsurance public ins;
    VibeInsurance public julIns; // JUL-collateral instance
    MockFuzzToken public usdc;
    MockFuzzToken public jul;
    MockFuzzOracle public oracle;

    address public alice;   // underwriter
    address public bob;     // policyholder

    uint16 constant PREMIUM_BPS = 500; // 5%
    uint40 constant WINDOW_DURATION = 30 days;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        jul = new MockFuzzToken("JUL Token", "JUL");
        usdc = new MockFuzzToken("USD Coin", "USDC");
        oracle = new MockFuzzOracle();

        ins = new VibeInsurance(address(jul), address(oracle), address(usdc));
        julIns = new VibeInsurance(address(jul), address(oracle), address(jul));

        // Fund actors generously
        usdc.mint(alice, type(uint128).max);
        usdc.mint(bob, type(uint128).max);
        jul.mint(alice, type(uint128).max);
        jul.mint(bob, type(uint128).max);
        jul.mint(address(this), type(uint128).max);

        vm.prank(alice);
        usdc.approve(address(ins), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(ins), type(uint256).max);
        vm.prank(alice);
        jul.approve(address(julIns), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(julIns), type(uint256).max);
        jul.approve(address(ins), type(uint256).max);
        jul.approve(address(julIns), type(uint256).max);
    }

    function _createMarket(VibeInsurance _ins) internal returns (uint8) {
        return _ins.createMarket(IVibeInsurance.CreateMarketParams({
            description: "Fuzz test market",
            triggerType: IVibeInsurance.TriggerType.PRICE_DROP,
            triggerData: bytes32(0),
            windowStart: uint40(block.timestamp + 1),
            windowEnd: uint40(block.timestamp + 1 + WINDOW_DURATION),
            premiumBps: PREMIUM_BPS
        }));
    }

    // ============ Premium Calculation Fuzz Tests ============

    /**
     * @notice Premium must always be > 0 for non-zero coverage, regardless of tier/discount
     */
    function testFuzz_premiumAlwaysPositive(uint256 coverage, uint8 tierSeed) public {
        coverage = bound(coverage, 1 ether, 1_000_000 ether);
        uint8 tier = uint8(bound(tierSeed, 0, 4));

        uint8 marketId = _createMarket(ins);
        oracle.setTier(bob, tier);

        uint256 premium = ins.effectivePremium(marketId, coverage, bob);
        assertGt(premium, 0, "Premium must be > 0 for non-zero coverage");
    }

    /**
     * @notice Premium scales linearly with coverage (proportional)
     */
    function testFuzz_premiumScalesWithCoverage(uint256 coverage1) public {
        coverage1 = bound(coverage1, 1 ether, 500_000 ether);
        uint256 coverage2 = coverage1 * 2;

        uint8 marketId = _createMarket(ins);
        oracle.setTier(bob, 0); // no discount for clean comparison

        uint256 prem1 = ins.effectivePremium(marketId, coverage1, bob);
        uint256 prem2 = ins.effectivePremium(marketId, coverage2, bob);

        // Allow 1 wei rounding from integer division
        assertApproxEqAbs(prem2, prem1 * 2, 1, "Premium should scale linearly with coverage");
    }

    /**
     * @notice Higher reputation tier always means equal or lower premium
     */
    function testFuzz_tierDiscountMonotonic(uint256 coverage) public {
        coverage = bound(coverage, 1 ether, 1_000_000 ether);
        uint8 marketId = _createMarket(ins);

        uint256 prevPremium = type(uint256).max;
        for (uint8 tier = 0; tier <= 4; tier++) {
            oracle.setTier(bob, tier);
            uint256 premium = ins.effectivePremium(marketId, coverage, bob);
            assertLe(premium, prevPremium, "Higher tier must give equal or lower premium");
            prevPremium = premium;
        }
    }

    /**
     * @notice Premium with discount never exceeds base premium (no discount)
     */
    function testFuzz_premiumNeverExceedsBase(uint256 coverage, uint8 tierSeed) public {
        coverage = bound(coverage, 1 ether, 1_000_000 ether);
        uint8 tier = uint8(bound(tierSeed, 0, 4));

        uint8 marketId = _createMarket(ins);

        oracle.setTier(bob, 0);
        uint256 basePremium = ins.effectivePremium(marketId, coverage, bob);

        oracle.setTier(bob, tier);
        uint256 discountedPremium = ins.effectivePremium(marketId, coverage, bob);

        assertLe(discountedPremium, basePremium, "Discounted premium must <= base premium");
    }

    /**
     * @notice Discount never exceeds 50% — insurance is never free
     */
    function testFuzz_premiumDiscountCapped(uint256 coverage, uint8 tierSeed) public {
        coverage = bound(coverage, 1 ether, 1_000_000 ether);
        uint8 tier = uint8(bound(tierSeed, 0, 4));

        // Use JUL collateral for max discount (tier discount + JUL bonus)
        uint8 marketId = _createMarket(julIns);
        oracle.setTier(bob, tier);

        uint256 premium = julIns.effectivePremium(marketId, coverage, bob);
        uint256 basePremium = (coverage * PREMIUM_BPS) / 10_000;

        // Premium must be at least 50% of base (cap at 5000 BPS discount)
        assertGe(premium, basePremium / 2, "Premium discount must not exceed 50%");
    }

    // ============ Capacity Fuzz Tests ============

    /**
     * @notice Underwriting always increases totalCapital by exact amount
     */
    function testFuzz_underwriteIncreasesCapital(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);
        uint8 marketId = _createMarket(ins);

        IVibeInsurance.InsuranceMarket memory mktBefore = ins.getMarket(marketId);

        vm.prank(alice);
        ins.underwrite(marketId, amount);

        IVibeInsurance.InsuranceMarket memory mktAfter = ins.getMarket(marketId);
        assertEq(mktAfter.totalCapital, mktBefore.totalCapital + amount, "Capital must increase by exact deposit");
    }

    /**
     * @notice Policy purchase never exceeds pool capacity
     */
    function testFuzz_policyBoundedByCapacity(uint256 capital, uint256 coverage) public {
        capital = bound(capital, 1 ether, 10_000_000 ether);
        coverage = bound(coverage, 1, capital); // bounded to capacity

        uint8 marketId = _createMarket(ins);
        vm.prank(alice);
        ins.underwrite(marketId, capital);

        oracle.setTier(bob, 0);
        vm.prank(bob);
        ins.buyPolicy(marketId, coverage);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        assertLe(mkt.totalCoverage, mkt.totalCapital, "Coverage must never exceed capital");
    }

    /**
     * @notice Coverage exceeding capacity always reverts
     */
    function testFuzz_excessCoverageReverts(uint256 capital, uint256 excess) public {
        capital = bound(capital, 1 ether, 10_000_000 ether);
        excess = bound(excess, 1, 10_000_000 ether);

        uint8 marketId = _createMarket(ins);
        vm.prank(alice);
        ins.underwrite(marketId, capital);

        oracle.setTier(bob, 0);
        vm.prank(bob);
        vm.expectRevert(IVibeInsurance.InsufficientPoolCapacity.selector);
        ins.buyPolicy(marketId, capital + excess);
    }

    // ============ Payout Fuzz Tests ============

    /**
     * @notice Triggered payout equals coverage when pool is sufficient
     */
    function testFuzz_payoutEqualsCoverage(uint256 capital, uint256 coverage) public {
        capital = bound(capital, 10 ether, 10_000_000 ether);
        coverage = bound(coverage, 1 ether, capital);

        uint8 marketId = _createMarket(ins);
        oracle.setTier(bob, 0);

        vm.prank(alice);
        ins.underwrite(marketId, capital);

        vm.prank(bob);
        uint256 policyId = ins.buyPolicy(marketId, coverage);

        // Warp past window and resolve as triggered
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        uint256 payout = ins.policyPayout(policyId);
        assertEq(payout, coverage, "Payout must equal coverage when pool is sufficient");
    }

    /**
     * @notice Not-triggered payout is always zero
     */
    function testFuzz_noPayoutWhenNotTriggered(uint256 capital, uint256 coverage) public {
        capital = bound(capital, 10 ether, 10_000_000 ether);
        coverage = bound(coverage, 1 ether, capital);

        uint8 marketId = _createMarket(ins);
        oracle.setTier(bob, 0);

        vm.prank(alice);
        ins.underwrite(marketId, capital);

        vm.prank(bob);
        uint256 policyId = ins.buyPolicy(marketId, coverage);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        assertEq(ins.policyPayout(policyId), 0, "Payout must be zero when not triggered");
    }

    /**
     * @notice Underwriter gets back more than deposit when market resolves without trigger
     */
    function testFuzz_underwriterProfitsOnNoTrigger(uint256 capital, uint256 coverage) public {
        capital = bound(capital, 10 ether, 10_000_000 ether);
        coverage = bound(coverage, 1 ether, capital);

        uint8 marketId = _createMarket(ins);
        oracle.setTier(bob, 0);

        vm.prank(alice);
        ins.underwrite(marketId, capital);

        vm.prank(bob);
        ins.buyPolicy(marketId, coverage);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        uint256 payout = ins.underwriterPayout(marketId, alice);
        assertGt(payout, capital, "Underwriter must profit when no trigger (premium earned)");
    }

    // ============ Premium Rate Fuzz Tests ============

    /**
     * @notice Market creation with valid premium rates succeeds, invalid reverts
     */
    function testFuzz_premiumRateBounds(uint16 premiumBps) public {
        IVibeInsurance.CreateMarketParams memory p = IVibeInsurance.CreateMarketParams({
            description: "Rate test",
            triggerType: IVibeInsurance.TriggerType.PRICE_DROP,
            triggerData: bytes32(0),
            windowStart: uint40(block.timestamp + 1),
            windowEnd: uint40(block.timestamp + 1 + WINDOW_DURATION),
            premiumBps: premiumBps
        });

        if (premiumBps == 0 || premiumBps >= 10_000) {
            vm.expectRevert(IVibeInsurance.InvalidPremiumRate.selector);
            ins.createMarket(p);
        } else {
            uint8 id = ins.createMarket(p);
            IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(id);
            assertEq(mkt.premiumBps, premiumBps);
        }
    }
}
