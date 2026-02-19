// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/FeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFeeRouterFuzzToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract FeeRouterFuzzTest is Test {
    MockFeeRouterFuzzToken token;
    FeeRouter router;

    address treasury = makeAddr("treasury");
    address insurance = makeAddr("insurance");
    address revShare = makeAddr("revShare");
    address buyback = makeAddr("buyback");
    address source = makeAddr("source");

    function setUp() public {
        token = new MockFeeRouterFuzzToken();
        router = new FeeRouter(treasury, insurance, revShare, buyback);
        router.authorizeSource(source);

        // Fund and approve source
        token.mint(source, 100_000_000 ether);
        vm.prank(source);
        token.approve(address(router), type(uint256).max);
    }

    // ============ Fuzz: collect then distribute = exact split ============

    function testFuzz_collectAndDistribute(uint256 amount) public {
        amount = bound(amount, 1, 100_000_000 ether);

        vm.prank(source);
        router.collectFee(address(token), amount);

        router.distribute(address(token));

        uint256 totalOut = token.balanceOf(treasury) +
            token.balanceOf(insurance) +
            token.balanceOf(revShare) +
            token.balanceOf(buyback);

        // All fees distributed, nothing left
        assertEq(totalOut, amount);
        assertEq(router.pendingFees(address(token)), 0);
    }

    // ============ Fuzz: split ratios correct ============

    function testFuzz_splitRatios(uint256 amount) public {
        amount = bound(amount, 10_000, 100_000_000 ether);

        vm.prank(source);
        router.collectFee(address(token), amount);
        router.distribute(address(token));

        uint256 expectedTreasury = (amount * 4000) / 10_000;
        uint256 expectedInsurance = (amount * 2000) / 10_000;
        uint256 expectedRevShare = (amount * 3000) / 10_000;
        uint256 expectedBuyback = amount - expectedTreasury - expectedInsurance - expectedRevShare;

        assertEq(token.balanceOf(treasury), expectedTreasury);
        assertEq(token.balanceOf(insurance), expectedInsurance);
        assertEq(token.balanceOf(revShare), expectedRevShare);
        assertEq(token.balanceOf(buyback), expectedBuyback);
    }

    // ============ Fuzz: multiple collects then single distribute ============

    function testFuzz_multipleCollects(uint256 amt1, uint256 amt2, uint256 amt3) public {
        amt1 = bound(amt1, 1, 10_000_000 ether);
        amt2 = bound(amt2, 1, 10_000_000 ether);
        amt3 = bound(amt3, 1, 10_000_000 ether);

        vm.startPrank(source);
        router.collectFee(address(token), amt1);
        router.collectFee(address(token), amt2);
        router.collectFee(address(token), amt3);
        vm.stopPrank();

        uint256 total = amt1 + amt2 + amt3;
        assertEq(router.pendingFees(address(token)), total);
        assertEq(router.totalCollected(address(token)), total);

        router.distribute(address(token));

        uint256 totalOut = token.balanceOf(treasury) +
            token.balanceOf(insurance) +
            token.balanceOf(revShare) +
            token.balanceOf(buyback);
        assertEq(totalOut, total);
    }

    // ============ Fuzz: config update with valid BPS ============

    function testFuzz_validConfig(uint16 t, uint16 i, uint16 r) public {
        // Ensure non-overflow
        uint256 tBig = uint256(t) % 10_001;
        uint256 iBig = uint256(i) % 10_001;
        uint256 rBig = uint256(r) % 10_001;

        if (tBig + iBig + rBig > 10_000) return;

        uint16 bBps = uint16(10_000 - tBig - iBig - rBig);

        IFeeRouter.FeeConfig memory cfg = IFeeRouter.FeeConfig({
            treasuryBps: uint16(tBig),
            insuranceBps: uint16(iBig),
            revShareBps: uint16(rBig),
            buybackBps: bBps
        });
        router.updateConfig(cfg);

        IFeeRouter.FeeConfig memory stored = router.config();
        assertEq(stored.treasuryBps, uint16(tBig));
        assertEq(stored.insuranceBps, uint16(iBig));
        assertEq(stored.revShareBps, uint16(rBig));
        assertEq(stored.buybackBps, bBps);
    }

    // ============ Fuzz: invalid config reverts ============

    function testFuzz_invalidConfigReverts(uint16 t, uint16 i, uint16 r, uint16 b) public {
        uint256 total = uint256(t) + uint256(i) + uint256(r) + uint256(b);
        if (total == 10_000) return; // skip valid configs

        IFeeRouter.FeeConfig memory cfg = IFeeRouter.FeeConfig({
            treasuryBps: t,
            insuranceBps: i,
            revShareBps: r,
            buybackBps: b
        });

        vm.expectRevert(IFeeRouter.InvalidConfig.selector);
        router.updateConfig(cfg);
    }

    // ============ Fuzz: custom config distribution ============

    function testFuzz_customConfigDistribute(uint256 amount, uint16 tBps) public {
        amount = bound(amount, 10_000, 10_000_000 ether);
        tBps = uint16(bound(tBps, 1, 9997));

        uint16 remaining = uint16(10_000 - tBps);
        uint16 iBps = remaining / 3;
        uint16 rBps = remaining / 3;
        uint16 bBps = remaining - iBps - rBps;

        IFeeRouter.FeeConfig memory cfg = IFeeRouter.FeeConfig({
            treasuryBps: tBps,
            insuranceBps: iBps,
            revShareBps: rBps,
            buybackBps: bBps
        });
        router.updateConfig(cfg);

        vm.prank(source);
        router.collectFee(address(token), amount);
        router.distribute(address(token));

        uint256 totalOut = token.balanceOf(treasury) +
            token.balanceOf(insurance) +
            token.balanceOf(revShare) +
            token.balanceOf(buyback);
        assertEq(totalOut, amount);
    }

    // ============ Fuzz: accounting invariants ============

    function testFuzz_accountingInvariants(uint256 amt1, uint256 amt2) public {
        amt1 = bound(amt1, 1, 50_000_000 ether);
        amt2 = bound(amt2, 1, 50_000_000 ether);

        vm.prank(source);
        router.collectFee(address(token), amt1);
        router.distribute(address(token));

        vm.prank(source);
        router.collectFee(address(token), amt2);

        // totalCollected = amt1 + amt2
        assertEq(router.totalCollected(address(token)), amt1 + amt2);
        // totalDistributed = amt1
        assertEq(router.totalDistributed(address(token)), amt1);
        // pending = amt2
        assertEq(router.pendingFees(address(token)), amt2);
    }

    // ============ Fuzz: emergency recover bounded ============

    function testFuzz_emergencyRecover(uint256 depositAmt, uint256 recoverAmt) public {
        depositAmt = bound(depositAmt, 1, 50_000_000 ether);
        recoverAmt = bound(recoverAmt, 1, 100_000_000 ether);

        vm.prank(source);
        router.collectFee(address(token), depositAmt);

        address recoveryTo = makeAddr("recovery");

        if (recoverAmt > depositAmt) {
            vm.expectRevert(); // ERC20 insufficient balance
            router.emergencyRecover(address(token), recoverAmt, recoveryTo);
        } else {
            router.emergencyRecover(address(token), recoverAmt, recoveryTo);
            assertEq(token.balanceOf(recoveryTo), recoverAmt);
        }
    }
}
