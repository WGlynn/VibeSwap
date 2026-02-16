// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/SlippageGuaranteeFund.sol";
import "../../contracts/incentives/interfaces/ISlippageGuaranteeFund.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockSGFToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract SlippageGuaranteeFundFuzzTest is Test {
    SlippageGuaranteeFund public fund;
    MockSGFToken public token;

    address public owner;
    address public controller;
    address public trader;

    bytes32 constant POOL_ID = keccak256("pool-1");

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        trader = makeAddr("trader");

        token = new MockSGFToken("USDC", "USDC");

        SlippageGuaranteeFund impl = new SlippageGuaranteeFund();
        bytes memory initData = abi.encodeWithSelector(
            SlippageGuaranteeFund.initialize.selector,
            owner,
            controller
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        fund = SlippageGuaranteeFund(address(proxy));

        // Deposit reserves
        token.mint(address(this), 100_000 ether);
        token.approve(address(fund), 100_000 ether);
        fund.depositFunds(address(token), 100_000 ether);
    }

    // ============ Fuzz: no shortfall → no claim ============

    function testFuzz_noShortfallNoClaim(uint256 expected, uint256 bonus) public {
        expected = bound(expected, 1 ether, 1_000_000 ether);
        bonus = bound(bonus, 0, 1_000_000 ether);

        uint256 actual = expected + bonus; // actual >= expected

        vm.prank(controller);
        bytes32 claimId = fund.recordExecution(
            POOL_ID, trader, address(token), expected, actual
        );

        assertEq(claimId, bytes32(0), "No claim when actual >= expected");
    }

    // ============ Fuzz: shortfall below minimum → no claim ============

    function testFuzz_belowMinShortfallNoClaim(uint256 expected) public {
        expected = bound(expected, 10_000 ether, 1_000_000 ether);

        // Config: minShortfallBps = 50 (0.5%). So shortfall must be >= 0.5%.
        // Set actual to be just barely below threshold
        uint256 tinyShortfall = (expected * 49) / 10000; // 0.49%
        if (tinyShortfall == 0) return;
        uint256 actual = expected - tinyShortfall;

        vm.prank(controller);
        bytes32 claimId = fund.recordExecution(
            POOL_ID, trader, address(token), expected, actual
        );

        assertEq(claimId, bytes32(0), "No claim below min shortfall");
    }

    // ============ Fuzz: compensation capped at maxClaimPercentBps ============

    function testFuzz_compensationCapped(uint256 expected, uint256 shortfallBps) public {
        expected = bound(expected, 100 ether, 1_000_000 ether);
        shortfallBps = bound(shortfallBps, 50, 5000); // 0.5% to 50% shortfall

        uint256 shortfall = (expected * shortfallBps) / 10000;
        if (shortfall == 0) return;
        uint256 actual = expected - shortfall;

        vm.prank(controller);
        bytes32 claimId = fund.recordExecution(
            POOL_ID, trader, address(token), expected, actual
        );

        if (claimId == bytes32(0)) return;

        ISlippageGuaranteeFund.SlippageClaim memory claim = fund.getClaim(claimId);
        uint256 maxComp = (expected * 200) / 10000; // 2% max per config

        assertLe(
            claim.eligibleCompensation,
            maxComp,
            "Compensation must be capped at maxClaimPercent"
        );
        assertLe(
            claim.eligibleCompensation,
            shortfall,
            "Compensation must not exceed actual shortfall"
        );
    }

    // ============ Fuzz: expired claim can't be processed ============

    function testFuzz_expiredClaimReverts(uint256 expected, uint256 waitTime) public {
        expected = bound(expected, 100 ether, 100_000 ether);
        waitTime = bound(waitTime, 1 hours + 1, 7 days); // past claim window

        uint256 actual = (expected * 95) / 100; // 5% shortfall

        vm.prank(controller);
        bytes32 claimId = fund.recordExecution(
            POOL_ID, trader, address(token), expected, actual
        );

        if (claimId == bytes32(0)) return;

        vm.warp(block.timestamp + waitTime);

        vm.prank(controller);
        vm.expectRevert(SlippageGuaranteeFund.ClaimExpiredError.selector);
        fund.processClaim(claimId);
    }

    // ============ Fuzz: deposit increases reserves ============

    function testFuzz_depositIncreasesReserves(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);

        uint256 reserveBefore = fund.getTotalReserves(address(token));

        token.mint(address(this), amount);
        token.approve(address(fund), amount);
        fund.depositFunds(address(token), amount);

        assertEq(
            fund.getTotalReserves(address(token)),
            reserveBefore + amount,
            "Reserves must increase by deposit amount"
        );
    }

    // ============ Fuzz: processed claim reduces reserves ============

    function testFuzz_processedClaimReducesReserves(uint256 expected) public {
        expected = bound(expected, 1000 ether, 100_000 ether);

        uint256 actual = (expected * 95) / 100; // 5% shortfall

        vm.prank(controller);
        bytes32 claimId = fund.recordExecution(
            POOL_ID, trader, address(token), expected, actual
        );

        if (claimId == bytes32(0)) return;

        uint256 reserveBefore = fund.getTotalReserves(address(token));

        vm.prank(controller);
        uint256 compensation = fund.processClaim(claimId);

        uint256 reserveAfter = fund.getTotalReserves(address(token));
        assertEq(
            reserveAfter,
            reserveBefore - compensation,
            "Reserves must decrease by compensation"
        );
    }
}
