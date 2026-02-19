// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/FeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockFeeToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 10_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Test Contract ============

contract FeeRouterTest is Test {
    MockFeeToken tokenA;
    MockFeeToken tokenB;
    FeeRouter router;

    address treasury = address(0x1111);
    address insurance = address(0x2222);
    address revShare = address(0x3333);
    address buyback = address(0x4444);

    address ammSource = address(0xAA);
    address auctionSource = address(0xBB);
    address alice = address(0xA11CE);

    function setUp() public {
        tokenA = new MockFeeToken("Token A", "TKA");
        tokenB = new MockFeeToken("Token B", "TKB");

        router = new FeeRouter(treasury, insurance, revShare, buyback);

        // Authorize sources
        router.authorizeSource(ammSource);
        router.authorizeSource(auctionSource);

        // Fund sources
        tokenA.transfer(ammSource, 100_000 ether);
        tokenA.transfer(auctionSource, 100_000 ether);
        tokenB.transfer(ammSource, 100_000 ether);

        // Approve router
        vm.prank(ammSource);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(ammSource);
        tokenB.approve(address(router), type(uint256).max);
        vm.prank(auctionSource);
        tokenA.approve(address(router), type(uint256).max);
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(router.treasury(), treasury);
        assertEq(router.insurance(), insurance);
        assertEq(router.revShare(), revShare);
        assertEq(router.buybackTarget(), buyback);

        IFeeRouter.FeeConfig memory cfg = router.config();
        assertEq(cfg.treasuryBps, 4000);
        assertEq(cfg.insuranceBps, 2000);
        assertEq(cfg.revShareBps, 3000);
        assertEq(cfg.buybackBps, 1000);
    }

    function test_constructor_revert_zeroAddresses() public {
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(address(0), insurance, revShare, buyback);

        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(treasury, address(0), revShare, buyback);

        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(treasury, insurance, address(0), buyback);

        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(treasury, insurance, revShare, address(0));
    }

    // ============ Fee Collection Tests ============

    function test_collectFee() public {
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 1000 ether);

        assertEq(router.pendingFees(address(tokenA)), 1000 ether);
        assertEq(router.totalCollected(address(tokenA)), 1000 ether);
    }

    function test_collectFee_multiple() public {
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 500 ether);
        vm.prank(auctionSource);
        router.collectFee(address(tokenA), 300 ether);

        assertEq(router.pendingFees(address(tokenA)), 800 ether);
        assertEq(router.totalCollected(address(tokenA)), 800 ether);
    }

    function test_collectFee_multipleTokens() public {
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 500 ether);
        vm.prank(ammSource);
        router.collectFee(address(tokenB), 300 ether);

        assertEq(router.pendingFees(address(tokenA)), 500 ether);
        assertEq(router.pendingFees(address(tokenB)), 300 ether);
    }

    function test_collectFee_revert_unauthorized() public {
        tokenA.transfer(alice, 1000 ether);
        vm.prank(alice);
        tokenA.approve(address(router), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(IFeeRouter.UnauthorizedSource.selector);
        router.collectFee(address(tokenA), 100 ether);
    }

    function test_collectFee_revert_zeroAmount() public {
        vm.prank(ammSource);
        vm.expectRevert(IFeeRouter.ZeroAmount.selector);
        router.collectFee(address(tokenA), 0);
    }

    function test_collectFee_revert_zeroAddress() public {
        vm.prank(ammSource);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.collectFee(address(0), 100 ether);
    }

    function test_collectFee_ownerCanCollect() public {
        tokenA.approve(address(router), type(uint256).max);
        router.collectFee(address(tokenA), 100 ether);
        assertEq(router.pendingFees(address(tokenA)), 100 ether);
    }

    // ============ Distribution Tests ============

    function test_distribute() public {
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 10_000 ether);

        router.distribute(address(tokenA));

        // Default split: 40/20/30/10
        assertEq(tokenA.balanceOf(treasury), 4000 ether);
        assertEq(tokenA.balanceOf(insurance), 2000 ether);
        assertEq(tokenA.balanceOf(revShare), 3000 ether);
        assertEq(tokenA.balanceOf(buyback), 1000 ether);

        assertEq(router.pendingFees(address(tokenA)), 0);
        assertEq(router.totalDistributed(address(tokenA)), 10_000 ether);
    }

    function test_distribute_revert_nothingPending() public {
        vm.expectRevert(IFeeRouter.NothingToDistribute.selector);
        router.distribute(address(tokenA));
    }

    function test_distribute_dustGoesToBuyback() public {
        // Use an amount that won't divide evenly
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 9999);

        router.distribute(address(tokenA));

        // Check all went somewhere
        uint256 total = tokenA.balanceOf(treasury) +
            tokenA.balanceOf(insurance) +
            tokenA.balanceOf(revShare) +
            tokenA.balanceOf(buyback);
        assertEq(total, 9999);
    }

    function test_distributeMultiple() public {
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 1000 ether);
        vm.prank(ammSource);
        router.collectFee(address(tokenB), 500 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        router.distributeMultiple(tokens);

        assertEq(router.pendingFees(address(tokenA)), 0);
        assertEq(router.pendingFees(address(tokenB)), 0);
    }

    // ============ Config Tests ============

    function test_updateConfig() public {
        IFeeRouter.FeeConfig memory newCfg = IFeeRouter.FeeConfig({
            treasuryBps: 5000,
            insuranceBps: 1500,
            revShareBps: 2500,
            buybackBps: 1000
        });
        router.updateConfig(newCfg);

        IFeeRouter.FeeConfig memory cfg = router.config();
        assertEq(cfg.treasuryBps, 5000);
        assertEq(cfg.insuranceBps, 1500);
        assertEq(cfg.revShareBps, 2500);
        assertEq(cfg.buybackBps, 1000);
    }

    function test_updateConfig_revert_invalidTotal() public {
        IFeeRouter.FeeConfig memory badCfg = IFeeRouter.FeeConfig({
            treasuryBps: 5000,
            insuranceBps: 3000,
            revShareBps: 2000,
            buybackBps: 1000
        });
        vm.expectRevert(IFeeRouter.InvalidConfig.selector);
        router.updateConfig(badCfg); // sum = 11000
    }

    function test_updateConfig_revert_notOwner() public {
        IFeeRouter.FeeConfig memory cfg = IFeeRouter.FeeConfig({
            treasuryBps: 5000,
            insuranceBps: 1500,
            revShareBps: 2500,
            buybackBps: 1000
        });
        vm.prank(alice);
        vm.expectRevert();
        router.updateConfig(cfg);
    }

    function test_distribute_afterConfigChange() public {
        // Change to 50/10/30/10
        IFeeRouter.FeeConfig memory newCfg = IFeeRouter.FeeConfig({
            treasuryBps: 5000,
            insuranceBps: 1000,
            revShareBps: 3000,
            buybackBps: 1000
        });
        router.updateConfig(newCfg);

        vm.prank(ammSource);
        router.collectFee(address(tokenA), 10_000 ether);
        router.distribute(address(tokenA));

        assertEq(tokenA.balanceOf(treasury), 5000 ether);
        assertEq(tokenA.balanceOf(insurance), 1000 ether);
        assertEq(tokenA.balanceOf(revShare), 3000 ether);
        assertEq(tokenA.balanceOf(buyback), 1000 ether);
    }

    // ============ Source Management Tests ============

    function test_authorizeSource() public {
        address newSource = address(0xCC);
        router.authorizeSource(newSource);
        assertTrue(router.isAuthorizedSource(newSource));
    }

    function test_revokeSource() public {
        router.revokeSource(ammSource);
        assertFalse(router.isAuthorizedSource(ammSource));
    }

    function test_authorizeSource_revert_zero() public {
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.authorizeSource(address(0));
    }

    // ============ Recipient Update Tests ============

    function test_setTreasury() public {
        address newTreasury = address(0x5555);
        router.setTreasury(newTreasury);
        assertEq(router.treasury(), newTreasury);
    }

    function test_setInsurance() public {
        address newIns = address(0x5555);
        router.setInsurance(newIns);
        assertEq(router.insurance(), newIns);
    }

    function test_setRevShare() public {
        address newRS = address(0x5555);
        router.setRevShare(newRS);
        assertEq(router.revShare(), newRS);
    }

    function test_setBuybackTarget() public {
        address newBB = address(0x5555);
        router.setBuybackTarget(newBB);
        assertEq(router.buybackTarget(), newBB);
    }

    function test_setRecipient_revert_zero() public {
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setTreasury(address(0));

        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setInsurance(address(0));

        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setRevShare(address(0));

        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setBuybackTarget(address(0));
    }

    // ============ Emergency Recovery Tests ============

    function test_emergencyRecover() public {
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 1000 ether);

        address recoveryAddr = address(0x9999);
        router.emergencyRecover(address(tokenA), 500 ether, recoveryAddr);

        assertEq(tokenA.balanceOf(recoveryAddr), 500 ether);
    }

    function test_emergencyRecover_revert_zero() public {
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.emergencyRecover(address(tokenA), 100 ether, address(0));
    }

    function test_emergencyRecover_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        router.emergencyRecover(address(tokenA), 100 ether, alice);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // 1. Multiple sources collect fees
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 5000 ether);
        vm.prank(auctionSource);
        router.collectFee(address(tokenA), 3000 ether);
        vm.prank(ammSource);
        router.collectFee(address(tokenB), 2000 ether);

        // 2. Distribute token A
        router.distribute(address(tokenA));

        assertEq(tokenA.balanceOf(treasury), 3200 ether);  // 40% of 8000
        assertEq(tokenA.balanceOf(insurance), 1600 ether);  // 20%
        assertEq(tokenA.balanceOf(revShare), 2400 ether);   // 30%
        assertEq(tokenA.balanceOf(buyback), 800 ether);     // 10%

        // 3. Token B still pending
        assertEq(router.pendingFees(address(tokenB)), 2000 ether);

        // 4. Distribute token B
        router.distribute(address(tokenB));

        assertEq(tokenB.balanceOf(treasury), 800 ether);
        assertEq(tokenB.balanceOf(insurance), 400 ether);
        assertEq(tokenB.balanceOf(revShare), 600 ether);
        assertEq(tokenB.balanceOf(buyback), 200 ether);

        // 5. Accounting
        assertEq(router.totalCollected(address(tokenA)), 8000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 8000 ether);
        assertEq(router.totalCollected(address(tokenB)), 2000 ether);
        assertEq(router.totalDistributed(address(tokenB)), 2000 ether);
    }

    function test_collectAndDistribute_repeat() public {
        // Round 1
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 1000 ether);
        router.distribute(address(tokenA));

        // Round 2
        vm.prank(ammSource);
        router.collectFee(address(tokenA), 2000 ether);
        router.distribute(address(tokenA));

        // Treasury got 40% of both rounds
        assertEq(tokenA.balanceOf(treasury), 400 ether + 800 ether);
        assertEq(router.totalCollected(address(tokenA)), 3000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 3000 ether);
    }
}
