// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/incentives/VolatilityInsurancePool.sol";

contract MockVIPToken is ERC20 {
    constructor() ERC20("Mock", "MTK") { _mint(msg.sender, 1e24); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockVIPVolatilityOracle {
    IVolatilityOracle.VolatilityTier public tier;
    function setTier(IVolatilityOracle.VolatilityTier _tier) external { tier = _tier; }
    function getVolatilityTier(bytes32) external view returns (IVolatilityOracle.VolatilityTier) { return tier; }
}

contract VolatilityInsurancePoolTest is Test {
    VolatilityInsurancePool public pool;
    MockVIPToken public token;
    MockVIPVolatilityOracle public oracle;
    address public controller;
    address public lp1;
    address public lp2;
    bytes32 public poolId = keccak256("pool1");

    function setUp() public {
        controller = makeAddr("controller");
        lp1 = makeAddr("lp1");
        lp2 = makeAddr("lp2");
        token = new MockVIPToken();
        oracle = new MockVIPVolatilityOracle();
        oracle.setTier(IVolatilityOracle.VolatilityTier.EXTREME);

        VolatilityInsurancePool impl = new VolatilityInsurancePool();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VolatilityInsurancePool.initialize.selector, address(this), address(oracle), controller)
        );
        pool = VolatilityInsurancePool(address(proxy));

        // Fund controller with tokens
        token.transfer(controller, 500 ether);

        // Warp past initial cooldown (lastClaimTimestamp=0, cooldown=24h, block.timestamp starts at 1)
        vm.warp(25 hours);
    }

    // ============ Helpers ============

    function _depositFees(uint256 amount) internal {
        vm.prank(controller);
        token.approve(address(pool), amount);
        vm.prank(controller);
        pool.depositFees(poolId, address(token), amount);
    }

    function _registerCoverage(address lp, uint256 liquidity) internal {
        vm.prank(controller);
        pool.registerCoverage(poolId, lp, liquidity);
    }

    function _triggerClaim(uint256 triggerPrice) internal returns (uint256) {
        vm.prank(controller);
        return pool.triggerClaimEvent(poolId, address(token), triggerPrice);
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(pool.claimCooldownPeriod(), 24 hours);
        assertEq(pool.maxClaimPercentBps(), 5000);
        assertEq(pool.incentiveController(), controller);
    }

    function test_initialize_zeroAddress() public {
        VolatilityInsurancePool impl = new VolatilityInsurancePool();
        vm.expectRevert(VolatilityInsurancePool.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VolatilityInsurancePool.initialize.selector, address(this), address(0), controller)
        );
    }

    // ============ Deposit Fees ============

    function test_depositFees() public {
        _depositFees(100 ether);

        VolatilityInsurancePool.PoolInsurance memory ins = pool.getPoolInsurance(poolId, address(token));
        assertEq(ins.reserveBalance, 100 ether);
        assertEq(ins.totalDeposited, 100 ether);
    }

    function test_depositFees_accumulates() public {
        _depositFees(50 ether);
        _depositFees(30 ether);

        VolatilityInsurancePool.PoolInsurance memory ins = pool.getPoolInsurance(poolId, address(token));
        assertEq(ins.reserveBalance, 80 ether);
        assertEq(ins.totalDeposited, 80 ether);
    }

    function test_depositFees_zeroAmount() public {
        vm.prank(controller);
        token.approve(address(pool), 1 ether);
        vm.prank(controller);
        vm.expectRevert(VolatilityInsurancePool.InvalidAmount.selector);
        pool.depositFees(poolId, address(token), 0);
    }

    function test_depositFees_unauthorized() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert(VolatilityInsurancePool.Unauthorized.selector);
        pool.depositFees(poolId, address(token), 1 ether);
    }

    // ============ Register Coverage ============

    function test_registerCoverage() public {
        _registerCoverage(lp1, 100 ether);

        VolatilityInsurancePool.LPCoverage memory cov = pool.getLPCoverage(poolId, lp1);
        assertEq(cov.liquidityAtRisk, 100 ether);
        assertEq(pool.totalCoveredLiquidity(poolId), 100 ether);
    }

    function test_registerCoverage_update() public {
        _registerCoverage(lp1, 100 ether);
        _registerCoverage(lp1, 200 ether);

        VolatilityInsurancePool.LPCoverage memory cov = pool.getLPCoverage(poolId, lp1);
        assertEq(cov.liquidityAtRisk, 200 ether);
        assertEq(pool.totalCoveredLiquidity(poolId), 200 ether);
    }

    function test_registerCoverage_multipleLPs() public {
        _registerCoverage(lp1, 100 ether);
        _registerCoverage(lp2, 50 ether);

        assertEq(pool.totalCoveredLiquidity(poolId), 150 ether);
    }

    // ============ Remove Coverage ============

    function test_removeCoverage() public {
        _registerCoverage(lp1, 100 ether);

        vm.prank(controller);
        pool.removeCoverage(poolId, lp1);

        VolatilityInsurancePool.LPCoverage memory cov = pool.getLPCoverage(poolId, lp1);
        assertEq(cov.liquidityAtRisk, 0);
        assertEq(pool.totalCoveredLiquidity(poolId), 0);
    }

    function test_removeCoverage_noExistingCoverage() public {
        // Should not revert, just no-op
        vm.prank(controller);
        pool.removeCoverage(poolId, lp1);
    }

    // ============ Trigger Claim Event ============

    function test_triggerClaimEvent() public {
        _depositFees(100 ether);

        uint256 eventIdx = _triggerClaim(900e18);

        assertEq(eventIdx, 0);
        (bytes32 ePoolId, uint64 timestamp, uint256 totalPayout, uint256 triggerPrice, bool processed) = pool.claimEvents(0);
        assertEq(ePoolId, poolId);
        assertGt(totalPayout, 0);
        assertEq(triggerPrice, 900e18);
        assertFalse(processed);
    }

    function test_triggerClaimEvent_cappedAt50Percent() public {
        _depositFees(100 ether);

        uint256 eventIdx = _triggerClaim(900e18);
        (, , uint256 totalPayout, , ) = pool.claimEvents(eventIdx);

        // 50% of 100 ether = 50 ether
        assertEq(totalPayout, 50 ether);
    }

    function test_triggerClaimEvent_cooldownActive() public {
        _depositFees(100 ether);
        _triggerClaim(900e18);

        vm.prank(controller);
        vm.expectRevert(VolatilityInsurancePool.ClaimCooldownActive.selector);
        pool.triggerClaimEvent(poolId, address(token), 850e18);
    }

    function test_triggerClaimEvent_cooldownExpires() public {
        _depositFees(100 ether);
        _triggerClaim(900e18);

        vm.warp(block.timestamp + 24 hours + 1);
        // Should succeed after cooldown
        _triggerClaim(850e18);
    }

    function test_triggerClaimEvent_lowVolatility_reverts() public {
        _depositFees(100 ether);
        oracle.setTier(IVolatilityOracle.VolatilityTier.LOW);

        vm.prank(controller);
        vm.expectRevert(VolatilityInsurancePool.NoCoverageAvailable.selector);
        pool.triggerClaimEvent(poolId, address(token), 900e18);
    }

    // ============ Claim Insurance ============

    function test_claimInsurance() public {
        _depositFees(100 ether);
        _registerCoverage(lp1, 100 ether);

        uint256 eventIdx = _triggerClaim(900e18);

        vm.prank(lp1);
        uint256 claimed = pool.claimInsurance(eventIdx, address(token));

        // lp1 has 100% of covered liquidity, should get full payout (50 ether)
        assertEq(claimed, 50 ether);
        assertEq(token.balanceOf(lp1), 50 ether);
    }

    function test_claimInsurance_proRata() public {
        _depositFees(100 ether);
        _registerCoverage(lp1, 75 ether);
        _registerCoverage(lp2, 25 ether);

        uint256 eventIdx = _triggerClaim(900e18);

        vm.prank(lp1);
        uint256 claimed1 = pool.claimInsurance(eventIdx, address(token));

        vm.prank(lp2);
        uint256 claimed2 = pool.claimInsurance(eventIdx, address(token));

        // 75% of 50 ether = 37.5 ether
        assertEq(claimed1, 37.5 ether);
        // 25% of 50 ether = 12.5 ether
        assertEq(claimed2, 12.5 ether);
    }

    function test_claimInsurance_doubleClaim_reverts() public {
        _depositFees(100 ether);
        _registerCoverage(lp1, 100 ether);

        uint256 eventIdx = _triggerClaim(900e18);

        vm.prank(lp1);
        pool.claimInsurance(eventIdx, address(token));

        vm.prank(lp1);
        vm.expectRevert(VolatilityInsurancePool.AlreadyClaimed.selector);
        pool.claimInsurance(eventIdx, address(token));
    }

    function test_claimInsurance_noCoverage() public {
        _depositFees(100 ether);
        _registerCoverage(lp1, 100 ether);

        uint256 eventIdx = _triggerClaim(900e18);

        vm.prank(lp2); // lp2 has no coverage
        vm.expectRevert(VolatilityInsurancePool.NoCoverageAvailable.selector);
        pool.claimInsurance(eventIdx, address(token));
    }

    function test_claimInsurance_multipleEvents() public {
        _depositFees(200 ether);
        _registerCoverage(lp1, 100 ether);

        uint256 event1 = _triggerClaim(900e18);

        vm.warp(block.timestamp + 24 hours + 1);
        uint256 event2 = _triggerClaim(800e18);

        vm.prank(lp1);
        pool.claimInsurance(event1, address(token));

        vm.prank(lp1);
        pool.claimInsurance(event2, address(token));

        // Should be able to claim from both events
        assertGt(token.balanceOf(lp1), 0);
    }

    // ============ View Functions ============

    function test_getPendingClaim() public {
        _depositFees(100 ether);
        _registerCoverage(lp1, 100 ether);
        _triggerClaim(900e18);

        uint256 pending = pool.getPendingClaim(poolId, lp1, address(token));
        assertEq(pending, 50 ether);
    }

    function test_getPendingClaim_noCoverage() public {
        assertEq(pool.getPendingClaim(poolId, lp1, address(token)), 0);
    }

    function test_getPendingClaim_afterClaim() public {
        _depositFees(100 ether);
        _registerCoverage(lp1, 100 ether);

        uint256 eventIdx = _triggerClaim(900e18);
        vm.prank(lp1);
        pool.claimInsurance(eventIdx, address(token));

        // After claiming, pending should be 0
        assertEq(pool.getPendingClaim(poolId, lp1, address(token)), 0);
    }

    // ============ Admin ============

    function test_setTargetReserve() public {
        pool.setTargetReserve(poolId, address(token), 1000 ether);
        VolatilityInsurancePool.PoolInsurance memory ins = pool.getPoolInsurance(poolId, address(token));
        assertEq(ins.targetReserve, 1000 ether);
    }

    function test_setClaimParameters() public {
        pool.setClaimParameters(48 hours, 3000, 2);
        assertEq(pool.claimCooldownPeriod(), 48 hours);
        assertEq(pool.maxClaimPercentBps(), 3000);
        assertEq(pool.minVolatilityTierForClaim(), 2);
    }

    function test_setIncentiveController() public {
        address newCtrl = makeAddr("newCtrl");
        pool.setIncentiveController(newCtrl);
        assertEq(pool.incentiveController(), newCtrl);
    }

    function test_setIncentiveController_zeroAddress() public {
        vm.expectRevert(VolatilityInsurancePool.ZeroAddress.selector);
        pool.setIncentiveController(address(0));
    }

    function test_admin_onlyOwner() public {
        address rando = makeAddr("rando");

        vm.prank(rando);
        vm.expectRevert();
        pool.setTargetReserve(poolId, address(token), 1000 ether);

        vm.prank(rando);
        vm.expectRevert();
        pool.setClaimParameters(48 hours, 3000, 2);

        vm.prank(rando);
        vm.expectRevert();
        pool.setIncentiveController(makeAddr("x"));
    }
}
