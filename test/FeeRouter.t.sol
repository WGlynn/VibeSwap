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
// 100% of swap fees go to LPs via ShapleyDistributor.
// No split. No treasury cut. No buyback. No extraction.

contract FeeRouterTest is Test {
    FeeRouter public router;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public owner;
    address public lpDistributorAddr;
    address public authorizedSource;
    address public unauthorizedUser;
    address public newDestination;

    // ============ Events (re-declared for expectEmit) ============

    event FeeCollected(address indexed source, address indexed token, uint256 amount);
    event FeeForwarded(address indexed token, uint256 amount, address indexed lpDistributor);
    event SourceAuthorized(address indexed source);
    event SourceRevoked(address indexed source);
    event LPDistributorUpdated(address indexed newDistributor);
    event EmergencyRecovered(address indexed token, uint256 amount, address indexed to);

    // ============ Setup ============

    function setUp() public {
        owner = makeAddr("owner");
        lpDistributorAddr = makeAddr("lpDistributor");
        authorizedSource = makeAddr("authorizedSource");
        unauthorizedUser = makeAddr("unauthorizedUser");
        newDestination = makeAddr("newDestination");

        tokenA = new MockERC20("Token A", "TKNA");
        tokenB = new MockERC20("Token B", "TKNB");

        vm.prank(owner);
        router = new FeeRouter(lpDistributorAddr);
    }

    // ============ Helpers ============

    function _collectAs(address from, address token, uint256 amount) internal {
        MockERC20(token).mint(from, amount);
        vm.startPrank(from);
        IERC20(token).approve(address(router), amount);
        router.collectFee(token, amount);
        vm.stopPrank();
    }

    // ============ Constructor ============

    function test_constructor_setsParams() public view {
        assertEq(router.lpDistributor(), lpDistributorAddr);
        assertEq(router.owner(), owner);
    }

    function test_constructor_revertsZeroDistributor() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        new FeeRouter(address(0));
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

    // ============ distribute — 100% to LPs ============

    function test_distribute_100pctToLPs() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        uint256 amount = 10_000 ether;
        _collectAs(authorizedSource, address(tokenA), amount);

        vm.prank(owner);
        router.distribute(address(tokenA));

        // 100% goes to LP distributor. No split.
        assertEq(tokenA.balanceOf(lpDistributorAddr), amount);
        assertEq(tokenA.balanceOf(address(router)), 0);
    }

    function test_distribute_noDustRemains() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        // Odd amount — no dust because there's no split math
        uint256 amount = 10003;
        _collectAs(authorizedSource, address(tokenA), amount);

        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(tokenA.balanceOf(lpDistributorAddr), amount);
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
        assertEq(tokenA.balanceOf(lpDistributorAddr), 1000 ether);
    }

    function test_distribute_emitsEvent() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        uint256 amount = 10_000 ether;
        _collectAs(authorizedSource, address(tokenA), amount);

        vm.expectEmit(true, false, true, true);
        emit FeeForwarded(address(tokenA), amount, lpDistributorAddr);

        vm.prank(owner);
        router.distribute(address(tokenA));
    }

    function test_distribute_feeAgnostic() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        // Collect in two different tokens — each forwarded in its own denomination
        _collectAs(authorizedSource, address(tokenA), 5000 ether);
        _collectAs(authorizedSource, address(tokenB), 3000 ether);

        vm.startPrank(owner);
        router.distribute(address(tokenA));
        router.distribute(address(tokenB));
        vm.stopPrank();

        // LP distributor gets tokenA in tokenA, tokenB in tokenB. Fee agnostic.
        assertEq(tokenA.balanceOf(lpDistributorAddr), 5000 ether);
        assertEq(tokenB.balanceOf(lpDistributorAddr), 3000 ether);
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

        assertEq(router.pendingFees(address(tokenA)), 0);
        assertEq(router.pendingFees(address(tokenB)), 0);
        assertEq(tokenA.balanceOf(lpDistributorAddr), 10_000 ether);
        assertEq(tokenB.balanceOf(lpDistributorAddr), 5_000 ether);
    }

    function test_distributeMultiple_skipsZeroPending() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 10_000 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        // Should not revert even though tokenB has nothing pending
        vm.prank(owner);
        router.distributeMultiple(tokens);

        assertEq(router.pendingFees(address(tokenA)), 0);
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

    // ============ LP Distributor Setter ============

    function test_setLPDistributor_works() public {
        vm.expectEmit(true, false, false, true);
        emit LPDistributorUpdated(newDestination);

        vm.prank(owner);
        router.setLPDistributor(newDestination);

        assertEq(router.lpDistributor(), newDestination);
    }

    function test_setLPDistributor_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setLPDistributor(address(0));
    }

    function test_setLPDistributor_revertsNonOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", unauthorizedUser));
        router.setLPDistributor(newDestination);
    }

    function test_setLPDistributor_distributionUsesNew() public {
        address newLP = makeAddr("newLPDistributor");

        vm.startPrank(owner);
        router.setLPDistributor(newLP);
        router.authorizeSource(authorizedSource);
        vm.stopPrank();

        _collectAs(authorizedSource, address(tokenA), 10_000 ether);

        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(tokenA.balanceOf(newLP), 10_000 ether);
        assertEq(tokenA.balanceOf(lpDistributorAddr), 0);
    }

    // ============ emergencyRecover ============

    function test_emergencyRecover_works() public {
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

        assertEq(router.pendingFees(address(tokenA)), 2000 ether);
        assertEq(router.totalCollected(address(tokenA)), 2000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 0);

        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(router.pendingFees(address(tokenA)), 0);
        assertEq(router.totalCollected(address(tokenA)), 2000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 2000 ether);
    }

    function test_views_multipleCollectDistributeCycles() public {
        vm.prank(owner);
        router.authorizeSource(authorizedSource);

        _collectAs(authorizedSource, address(tokenA), 1000 ether);
        vm.prank(owner);
        router.distribute(address(tokenA));

        _collectAs(authorizedSource, address(tokenA), 3000 ether);
        vm.prank(owner);
        router.distribute(address(tokenA));

        assertEq(router.totalCollected(address(tokenA)), 4000 ether);
        assertEq(router.totalDistributed(address(tokenA)), 4000 ether);
        assertEq(router.pendingFees(address(tokenA)), 0);
    }
}
