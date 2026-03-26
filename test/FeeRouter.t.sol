// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/FeeRouter.sol";
import "../contracts/core/interfaces/IFeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ FeeRouter Tests ============

contract FeeRouterTest is Test {
    FeeRouter public router;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public owner;
    address public treasuryAddr;
    address public insuranceAddr;
    address public revShareAddr;
    address public buybackAddr;
    address public authorizedSource;
    address public unauthorizedUser;
    address public newDestination;

    // ============ Events (re-declared for expectEmit) ============

    event FeeCollected(address indexed source, address indexed token, uint256 amount);
    event FeeDistributed(
        address indexed token,
        uint256 toTreasury,
        uint256 toInsurance,
        uint256 toRevShare,
        uint256 toBuyback
    );
    event ConfigUpdated(uint16 treasuryBps, uint16 insuranceBps, uint16 revShareBps, uint16 buybackBps);
    event SourceAuthorized(address indexed source);
    event SourceRevoked(address indexed source);
    event TreasuryUpdated(address indexed newTreasury);
    event InsuranceUpdated(address indexed newInsurance);
    event RevShareUpdated(address indexed newRevShare);
    event BuybackTargetUpdated(address indexed newTarget);
    event BuybackExecuted(address indexed token, uint256 amount, address indexed target);
    event EmergencyRecovered(address indexed token, uint256 amount, address indexed to);

    // ============ Setup ============

    function setUp() public {
        owner = makeAddr("owner");
        treasuryAddr = makeAddr("treasury");
        insuranceAddr = makeAddr("insurance");
        revShareAddr = makeAddr("revShare");
        buybackAddr = makeAddr("buyback");
        authorizedSource = makeAddr("authorizedSource");
        unauthorizedUser = makeAddr("unauthorizedUser");
        newDestination = makeAddr("newDestination");

        tokenA = new MockERC20("Token A", "TKNA");
        tokenB = new MockERC20("Token B", "TKNB");

        vm.prank(owner);
        router = new FeeRouter(treasuryAddr, insuranceAddr, revShareAddr, buybackAddr);
    }

    // ============ Helpers ============

    /// @dev Mint tokens to `from`, approve router, and prank as `from` to call collectFee.
    function _collectAs(address from, address token, uint256 amount) internal {
        MockERC20(token).mint(from, amount);
        vm.startPrank(from);
        IERC20(token).approve(address(router), amount);
        router.collectFee(token, amount);
        vm.stopPrank();
    }

    // ============ Constructor ============

    function test_constructor_setsParams() public view {
        assertEq(router.treasury(), treasuryAddr);
        assertEq(router.insurance(), insuranceAddr);
        assertEq(router.revShare(), revShareAddr);
        assertEq(router.buybackTarget(), buybackAddr);
        assertEq(router.owner(), owner);
    }

    function test_constructor_defaultConfig() public view {
        IFeeRouter.FeeConfig memory cfg = router.config();
        assertEq(cfg.treasuryBps, 4000);
        assertEq(cfg.insuranceBps, 2000);
        assertEq(cfg.revShareBps, 3000);
        assertEq(cfg.buybackBps, 1000);
    }

    function test_constructor_revertsZeroTreasury() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(address(0), insuranceAddr, revShareAddr, buybackAddr);
    }

    function test_constructor_revertsZeroInsurance() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(treasuryAddr, address(0), revShareAddr, buybackAddr);
    }

    function test_constructor_revertsZeroRevShare() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(treasuryAddr, insuranceAddr, address(0), buybackAddr);
    }

    function test_constructor_revertsZeroBuyback() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(treasuryAddr, insuranceAddr, revShareAddr, address(0));
    }

    // ============ collectFee ============

    function test_collectFee_authorizedSource() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        uint256 amount = 1000 ether;
        tokenA.mint(authorizedSource, amount);

        vm.startPrank(authorizedSource);
        tokenA.approve(address(router), amount);

        vm.expectEmit(true, true, false, true);
        emit FeeCollected(authorizedSource, address(tokenA), amount);

        router.collectFee(address(tokenA), amount);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(address(router)), amount);
        assertEq(router.pendingFees(address(tokenA)), amount);
        assertEq(router.totalCollected(address(tokenA)), amount);
    }

    function test_collectFee_ownerCanCollect() public {
        uint256 amount = 500 ether;
        tokenA.mint(owner, amount);

        vm.startPrank(owner);
        tokenA.approve(address(router), amount);
        router.collectFee(address(tokenA), amount);
        vm.stopPrank();

        assertEq(router.pendingFees(address(tokenA)), amount);
    }

    function test_collectFee_revertsUnauthorized() public {
        uint256 amount = 100 ether;
        tokenA.mint(unauthorizedUser, amount);

        vm.startPrank(unauthorizedUser);
        tokenA.approve(address(router), amount);

        vm.expectRevert(IFeeRouter.UnauthorizedSource.selector);
        router.collectFee(address(tokenA), amount);
        vm.stopPrank();
    }

    function test_collectFee_revertsZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.collectFee(address(0), 100);
    }

    function test_collectFee_revertsZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAmount.selector);
        router.collectFee(address(tokenA), 0);
    }

    function test_collectFee_accumulatesMultiple() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 100 ether);
        _collectAs(authorizedSource, address(tokenA), 250 ether);

        assertEq(router.pendingFees(address(tokenA)), 350 ether);
        assertEq(router.totalCollected(address(tokenA)), 350 ether);
    }

    // ============ distribute ============

    function test_distribute_correctSplitRatios() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        uint256 amount = 10_000 ether; // clean number for 40/20/30/10 split
        _collectAs(authorizedSource, address(tokenA), amount);

        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(tokenA.balanceOf(treasuryAddr), 4000 ether);   // 40%
        assertEq(tokenA.balanceOf(insuranceAddr), 2000 ether);  // 20%
        assertEq(tokenA.balanceOf(revShareAddr), 3000 ether);   // 30%
        assertEq(tokenA.balanceOf(buybackAddr), 1000 ether);    // 10%
    }

    function test_distribute_dustGoesToBuyback() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        // 10003 wei: treasury=4001, insurance=2000, revshare=3000, buyback=10003-4001-2000-3000=1002
        // The contract uses: toBuyback = pending - toTreasury - toInsurance - toRevShare
        // So dust (remainder from integer division) goes to buyback.
        uint256 amount = 10003;
        _collectAs(authorizedSource, address(tokenA), amount);

        vm.prank(owner);
        router.distribute(address(tokenA));

        uint256 toTreasury = (amount * 4000) / 10000;   // 4001
        uint256 toInsurance = (amount * 2000) / 10000;   // 2000
        uint256 toRevShare = (amount * 3000) / 10000;    // 3000
        uint256 toBuyback = amount - toTreasury - toInsurance - toRevShare; // 1002

        assertEq(tokenA.balanceOf(treasuryAddr), toTreasury);
        assertEq(tokenA.balanceOf(insuranceAddr), toInsurance);
        assertEq(tokenA.balanceOf(revShareAddr), toRevShare);
        assertEq(tokenA.balanceOf(buybackAddr), toBuyback);

        // Verify no dust left in router
        assertEq(tokenA.balanceOf(address(router)), 0);
    }

    function test_distribute_clearsPending() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 1000 ether);

        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(router.pendingFees(address(tokenA)), 0);
        assertEq(router.totalDistributed(address(tokenA)), 1000 ether);
    }

    function test_distribute_revertsNothingPending() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.NothingToDistribute.selector);
        router.distribute(address(tokenA));
    }

    function test_distribute_revertsUnauthorized() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 1000 ether);

        vm.prank(unauthorizedUser);
        vm.expectRevert("Not authorized to distribute");
        router.distribute(address(tokenA));
    }

    function test_distribute_authorizedSourceCanDistribute() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 1000 ether);

        vm.prank(authorizedSource);
        router.distribute(address(tokenA));

        assertEq(router.pendingFees(address(tokenA)), 0);
    }

    function test_distribute_emitsEvents() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        uint256 amount = 10_000 ether;
        _collectAs(authorizedSource, address(tokenA), amount);

        vm.expectEmit(true, false, false, true);
        emit FeeDistributed(address(tokenA), 4000 ether, 2000 ether, 3000 ether, 1000 ether);

        vm.prank(owner);
        router.distribute(address(tokenA));
    }

    // ============ distributeMultiple ============

    function test_distributeMultiple_batchDistribution() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 10_000 ether);
        _collectAs(authorizedSource, address(tokenB), 5_000 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        vm.prank(owner);
        router.distributeMultiple(tokens);

        // Token A: fully distributed
        assertEq(router.pendingFees(address(tokenA)), 0);
        assertEq(tokenA.balanceOf(treasuryAddr), 4000 ether);

        // Token B: fully distributed
        assertEq(router.pendingFees(address(tokenB)), 0);
        assertEq(tokenB.balanceOf(treasuryAddr), 2000 ether);
    }

    function test_distributeMultiple_skipsZeroPending() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        // Only tokenA has pending fees; tokenB has none
        _collectAs(authorizedSource, address(tokenA), 10_000 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        // Should not revert even though tokenB has nothing pending
        vm.prank(owner);
        router.distributeMultiple(tokens);

        assertEq(router.pendingFees(address(tokenA)), 0);
    }

    // ============ updateConfig ============

    function test_updateConfig_validConfig() public {
        IFeeRouter.FeeConfig memory newCfg = IFeeRouter.FeeConfig({
            treasuryBps: 2500,
            insuranceBps: 2500,
            revShareBps: 2500,
            buybackBps: 2500
        });

        vm.expectEmit(false, false, false, true);
        emit ConfigUpdated(2500, 2500, 2500, 2500);

        vm.prank(owner);
        router.updateConfig(newCfg);

        IFeeRouter.FeeConfig memory stored = router.config();
        assertEq(stored.treasuryBps, 2500);
        assertEq(stored.insuranceBps, 2500);
        assertEq(stored.revShareBps, 2500);
        assertEq(stored.buybackBps, 2500);
    }

    function test_updateConfig_revertsInvalidTotal() public {
        IFeeRouter.FeeConfig memory badCfg = IFeeRouter.FeeConfig({
            treasuryBps: 5000,
            insuranceBps: 2000,
            revShareBps: 2000,
            buybackBps: 2000
        });
        // Total = 11000, not 10000

        vm.prank(owner);
        vm.expectRevert(IFeeRouter.InvalidConfig.selector);
        router.updateConfig(badCfg);
    }

    function test_updateConfig_revertsInvalidTotalUnder() public {
        IFeeRouter.FeeConfig memory badCfg = IFeeRouter.FeeConfig({
            treasuryBps: 1000,
            insuranceBps: 1000,
            revShareBps: 1000,
            buybackBps: 1000
        });
        // Total = 4000, not 10000

        vm.prank(owner);
        vm.expectRevert(IFeeRouter.InvalidConfig.selector);
        router.updateConfig(badCfg);
    }

    function test_updateConfig_revertsNonOwner() public {
        IFeeRouter.FeeConfig memory cfg = IFeeRouter.FeeConfig({
            treasuryBps: 2500,
            insuranceBps: 2500,
            revShareBps: 2500,
            buybackBps: 2500
        });

        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.updateConfig(cfg);
    }

    function test_updateConfig_distributeUsesNewConfig() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        // Set 50/20/20/10 config
        IFeeRouter.FeeConfig memory newCfg = IFeeRouter.FeeConfig({
            treasuryBps: 5000,
            insuranceBps: 2000,
            revShareBps: 2000,
            buybackBps: 1000
        });
        vm.prank(owner);
        router.updateConfig(newCfg);

        _collectAs(authorizedSource, address(tokenA), 10_000 ether);

        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(tokenA.balanceOf(treasuryAddr), 5000 ether);
        assertEq(tokenA.balanceOf(insuranceAddr), 2000 ether);
        assertEq(tokenA.balanceOf(revShareAddr), 2000 ether);
        assertEq(tokenA.balanceOf(buybackAddr), 1000 ether);
    }

    // ============ Source Management ============

    function test_authorizeSource_works() public {
        assertFalse(router.isAuthorizedSource(authorizedSource));

        vm.expectEmit(true, false, false, true);
        emit SourceAuthorized(authorizedSource);

        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        assertTrue(router.isAuthorizedSource(authorizedSource));
    }

    function test_authorizeSource_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.authorizeSource(address(0));
    }

    function test_authorizeSource_revertsNonOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.authorizeSource(authorizedSource);
    }

    function test_revokeSource_works() public {
        vm.startPrank(owner);
        router.authorizeSource(authorizedSource);
        assertTrue(router.isAuthorizedSource(authorizedSource));

        vm.expectEmit(true, false, false, true);
        emit SourceRevoked(authorizedSource);

        router.revokeSource(authorizedSource);
        vm.stopPrank();

        assertFalse(router.isAuthorizedSource(authorizedSource));
    }

    function test_revokeSource_revertsNonOwner() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.revokeSource(authorizedSource);
    }

    function test_revokeSource_preventsCollection() public {
        vm.startPrank(owner);
        router.authorizeSource(authorizedSource);
        router.revokeSource(authorizedSource);
        vm.stopPrank();

        uint256 amount = 100 ether;
        tokenA.mint(authorizedSource, amount);

        vm.startPrank(authorizedSource);
        tokenA.approve(address(router), amount);
        vm.expectRevert(IFeeRouter.UnauthorizedSource.selector);
        router.collectFee(address(tokenA), amount);
        vm.stopPrank();
    }

    // ============ Destination Setters ============

    function test_setTreasury_works() public {
        vm.expectEmit(true, false, false, true);
        emit TreasuryUpdated(newDestination);

        vm.prank(owner);
        router.setTreasury(newDestination);

        assertEq(router.treasury(), newDestination);
    }

    function test_setTreasury_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setTreasury(address(0));
    }

    function test_setTreasury_revertsNonOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.setTreasury(newDestination);
    }

    function test_setInsurance_works() public {
        vm.expectEmit(true, false, false, true);
        emit InsuranceUpdated(newDestination);

        vm.prank(owner);
        router.setInsurance(newDestination);

        assertEq(router.insurance(), newDestination);
    }

    function test_setInsurance_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setInsurance(address(0));
    }

    function test_setInsurance_revertsNonOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.setInsurance(newDestination);
    }

    function test_setRevShare_works() public {
        vm.expectEmit(true, false, false, true);
        emit RevShareUpdated(newDestination);

        vm.prank(owner);
        router.setRevShare(newDestination);

        assertEq(router.revShare(), newDestination);
    }

    function test_setRevShare_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setRevShare(address(0));
    }

    function test_setRevShare_revertsNonOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.setRevShare(newDestination);
    }

    function test_setBuybackTarget_works() public {
        vm.expectEmit(true, false, false, true);
        emit BuybackTargetUpdated(newDestination);

        vm.prank(owner);
        router.setBuybackTarget(newDestination);

        assertEq(router.buybackTarget(), newDestination);
    }

    function test_setBuybackTarget_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setBuybackTarget(address(0));
    }

    function test_setBuybackTarget_revertsNonOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.setBuybackTarget(newDestination);
    }

    function test_setDestination_distributionUsesNew() public {
        // Change treasury, collect, distribute — fees go to new address
        address newTreasury = makeAddr("newTreasury");

        vm.startPrank(owner);
        router.setTreasury(newTreasury);
        router.authorizeSource(authorizedSource);
        vm.stopPrank();

        _collectAs(authorizedSource, address(tokenA), 10_000 ether);

        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(tokenA.balanceOf(newTreasury), 4000 ether);
        assertEq(tokenA.balanceOf(treasuryAddr), 0); // old treasury gets nothing
    }

    // ============ emergencyRecover ============

    function test_emergencyRecover_works() public {
        // Send tokens directly to router (simulating stuck tokens)
        uint256 amount = 500 ether;
        tokenA.mint(address(router), amount);

        address recipient = makeAddr("recipient");

        vm.expectEmit(true, false, true, true);
        emit EmergencyRecovered(address(tokenA), amount, recipient);

        vm.prank(owner);
        router.emergencyRecover(address(tokenA), amount, recipient);

        assertEq(tokenA.balanceOf(recipient), amount);
        assertEq(tokenA.balanceOf(address(router)), 0);
    }

    function test_emergencyRecover_revertsNonOwner() public {
        tokenA.mint(address(router), 100 ether);

        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.emergencyRecover(address(tokenA), 100 ether, unauthorizedUser);
    }

    function test_emergencyRecover_revertsZeroAddressTo() public {
        tokenA.mint(address(router), 100 ether);

        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.emergencyRecover(address(tokenA), 100 ether, address(0));
    }

    function test_emergencyRecover_canRecoverPendingFees() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 1000 ether);
        assertEq(router.pendingFees(address(tokenA)), 1000 ether);

        // Emergency recover all tokens (bypasses accounting)
        address recipient = makeAddr("emergencyRecipient");
        vm.prank(owner);
        router.emergencyRecover(address(tokenA), 1000 ether, recipient);

        assertEq(tokenA.balanceOf(recipient), 1000 ether);
    }

    // ============ View Functions ============

    function test_views_initialState() public view {
        assertEq(router.pendingFees(address(tokenA)), 0);
        assertEq(router.totalCollected(address(tokenA)), 0);
        assertEq(router.totalDistributed(address(tokenA)), 0);
        assertFalse(router.isAuthorizedSource(authorizedSource));
    }

    function test_views_afterCollectAndDistribute() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 2000 ether);

        // After collect
        assertEq(router.pendingFees(address(tokenA)), 2000 ether);
        assertEq(router.totalCollected(address(tokenA)), 2000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 0);

        vm.prank(owner);
        router.distribute(address(tokenA));

        // After distribute
        assertEq(router.pendingFees(address(tokenA)), 0);
        assertEq(router.totalCollected(address(tokenA)), 2000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 2000 ether);
    }

    function test_views_multipleCollectDistributeCycles() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        // Cycle 1
        _collectAs(authorizedSource, address(tokenA), 1000 ether);
        vm.prank(owner);
        router.distribute(address(tokenA));

        // Cycle 2
        _collectAs(authorizedSource, address(tokenA), 3000 ether);
        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(router.totalCollected(address(tokenA)), 4000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 4000 ether);
        assertEq(router.pendingFees(address(tokenA)), 0);
    }

    function test_views_configReturnsCurrentConfig() public {
        IFeeRouter.FeeConfig memory cfg = router.config();
        assertEq(cfg.treasuryBps + cfg.insuranceBps + cfg.revShareBps + cfg.buybackBps, 10000);
    }

    function test_views_destinationAddresses() public view {
        assertEq(router.treasury(), treasuryAddr);
        assertEq(router.insurance(), insuranceAddr);
        assertEq(router.revShare(), revShareAddr);
        assertEq(router.buybackTarget(), buybackAddr);
    }
}
