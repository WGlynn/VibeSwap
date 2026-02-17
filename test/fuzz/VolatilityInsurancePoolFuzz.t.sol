// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/incentives/VolatilityInsurancePool.sol";

contract MockVIPFToken is ERC20 {
    constructor() ERC20("Mock", "MTK") { _mint(msg.sender, 1e24); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockVIPFOracle {
    IVolatilityOracle.VolatilityTier public tier;
    function setTier(IVolatilityOracle.VolatilityTier _tier) external { tier = _tier; }
    function getVolatilityTier(bytes32) external view returns (IVolatilityOracle.VolatilityTier) { return tier; }
}

contract VolatilityInsurancePoolFuzzTest is Test {
    VolatilityInsurancePool public pool;
    MockVIPFToken public token;
    MockVIPFOracle public oracle;
    address public controller;
    bytes32 public poolId = keccak256("pool1");

    function setUp() public {
        controller = makeAddr("controller");
        token = new MockVIPFToken();
        oracle = new MockVIPFOracle();
        oracle.setTier(IVolatilityOracle.VolatilityTier.EXTREME);

        VolatilityInsurancePool impl = new VolatilityInsurancePool();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VolatilityInsurancePool.initialize.selector, address(this), address(oracle), controller)
        );
        pool = VolatilityInsurancePool(address(proxy));

        token.transfer(controller, 500 ether);
        vm.warp(25 hours);
    }

    /// @notice Deposits always increase reserve balance
    function testFuzz_depositsIncreaseReserve(uint256 amount) public {
        amount = bound(amount, 1, 100 ether);

        vm.prank(controller);
        token.approve(address(pool), amount);
        vm.prank(controller);
        pool.depositFees(poolId, address(token), amount);

        VolatilityInsurancePool.PoolInsurance memory ins = pool.getPoolInsurance(poolId, address(token));
        assertEq(ins.reserveBalance, amount);
        assertEq(ins.totalDeposited, amount);
    }

    /// @notice Coverage registration is idempotent
    function testFuzz_coverageIdempotent(uint256 liq1, uint256 liq2) public {
        liq1 = bound(liq1, 1, 1000 ether);
        liq2 = bound(liq2, 1, 1000 ether);

        address lp = makeAddr("lp");
        vm.prank(controller);
        pool.registerCoverage(poolId, lp, liq1);
        vm.prank(controller);
        pool.registerCoverage(poolId, lp, liq2);

        assertEq(pool.totalCoveredLiquidity(poolId), liq2);
    }

    /// @notice Claim payout never exceeds maxClaimPercent of reserves
    function testFuzz_claimCapped(uint256 deposit) public {
        deposit = bound(deposit, 1 ether, 100 ether);

        vm.prank(controller);
        token.approve(address(pool), deposit);
        vm.prank(controller);
        pool.depositFees(poolId, address(token), deposit);

        vm.prank(controller);
        pool.registerCoverage(poolId, address(this), 100 ether);

        vm.prank(controller);
        uint256 eventIdx = pool.triggerClaimEvent(poolId, address(token), 900e18);

        (, , uint256 payout, , ) = pool.claimEvents(eventIdx);
        uint256 maxPayout = (deposit * pool.maxClaimPercentBps()) / 10000;
        assertLe(payout, maxPayout, "Payout exceeds cap");
    }

    /// @notice Pro-rata distribution is correct
    function testFuzz_proRataDistribution(uint256 liq1, uint256 liq2) public {
        liq1 = bound(liq1, 1 ether, 100 ether);
        liq2 = bound(liq2, 1 ether, 100 ether);

        vm.prank(controller);
        token.approve(address(pool), 200 ether);
        vm.prank(controller);
        pool.depositFees(poolId, address(token), 200 ether);

        address lp1 = makeAddr("lp1");
        address lp2 = makeAddr("lp2");
        vm.prank(controller);
        pool.registerCoverage(poolId, lp1, liq1);
        vm.prank(controller);
        pool.registerCoverage(poolId, lp2, liq2);

        vm.prank(controller);
        uint256 eventIdx = pool.triggerClaimEvent(poolId, address(token), 900e18);

        (, , uint256 totalPayout, , ) = pool.claimEvents(eventIdx);

        uint256 totalLiq = liq1 + liq2;
        uint256 expected1 = (totalPayout * liq1) / totalLiq;
        uint256 expected2 = (totalPayout * liq2) / totalLiq;

        vm.prank(lp1);
        uint256 claimed1 = pool.claimInsurance(eventIdx, address(token));
        vm.prank(lp2);
        uint256 claimed2 = pool.claimInsurance(eventIdx, address(token));

        assertEq(claimed1, expected1);
        assertEq(claimed2, expected2);
    }

    /// @notice Claim parameters are always stored correctly
    function testFuzz_claimParamsStored(uint256 cooldown, uint256 maxBps, uint256 minTier) public {
        cooldown = bound(cooldown, 0, 30 days);
        maxBps = bound(maxBps, 0, 10000);
        minTier = bound(minTier, 0, 3);

        pool.setClaimParameters(cooldown, maxBps, minTier);
        assertEq(pool.claimCooldownPeriod(), cooldown);
        assertEq(pool.maxClaimPercentBps(), maxBps);
        assertEq(pool.minVolatilityTierForClaim(), minTier);
    }
}
