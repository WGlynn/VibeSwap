// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/SlippageGuaranteeFund.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SlippageGuaranteeFundTest is Test {
    SlippageGuaranteeFund public fund;
    MockERC20 public token;

    address public owner;
    address public controller;
    address public alice;
    address public bob;

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy token
        token = new MockERC20("USDC", "USDC");

        // Deploy fund
        SlippageGuaranteeFund impl = new SlippageGuaranteeFund();
        bytes memory initData = abi.encodeWithSelector(
            SlippageGuaranteeFund.initialize.selector,
            owner,
            controller
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        fund = SlippageGuaranteeFund(address(proxy));

        // Fund reserves
        token.mint(address(fund), 10000 ether);
        fund.addReserves(address(token), 10000 ether);
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(fund.owner(), owner);
        assertEq(fund.incentiveController(), controller);
    }

    function test_defaultConfig() public view {
        ISlippageGuaranteeFund.FundConfig memory cfg = fund.getConfig();

        assertEq(cfg.maxCompensationBps, 200);    // 2%
        assertEq(cfg.minShortfallBps, 10);        // 0.1%
        assertEq(cfg.userDailyLimitBps, 500);     // 5% of user volume
        assertEq(cfg.claimExpirySeconds, 1 hours);
    }

    // ============ Claim Submission Tests ============

    function test_submitClaim() public {
        vm.prank(controller);
        bytes32 claimId = fund.submitClaim(
            alice,
            address(token),
            100 ether,      // expectedOutput
            98 ether,       // actualOutput
            1000 ether      // tradeValue
        );

        ISlippageGuaranteeFund.SlippageClaim memory claim = fund.getClaim(claimId);

        assertEq(claim.trader, alice);
        assertEq(claim.token, address(token));
        assertEq(claim.expectedOutput, 100 ether);
        assertEq(claim.actualOutput, 98 ether);
        assertEq(claim.shortfall, 2 ether);
        assertFalse(claim.processed);
    }

    function test_submitClaim_revertUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert(SlippageGuaranteeFund.Unauthorized.selector);
        fund.submitClaim(alice, address(token), 100 ether, 98 ether, 1000 ether);
    }

    function test_submitClaim_revertBelowMinimum() public {
        // Shortfall of 0.05% is below 0.1% minimum
        vm.prank(controller);
        vm.expectRevert(SlippageGuaranteeFund.ShortfallBelowMinimum.selector);
        fund.submitClaim(
            alice,
            address(token),
            100 ether,
            99.95 ether,    // Only 0.05% shortfall
            1000 ether
        );
    }

    // ============ Claim Processing Tests ============

    function test_processClaim() public {
        vm.prank(controller);
        bytes32 claimId = fund.submitClaim(
            alice,
            address(token),
            100 ether,
            98 ether,       // 2 ether shortfall
            1000 ether
        );

        uint256 balanceBefore = token.balanceOf(alice);

        vm.prank(controller);
        uint256 compensation = fund.processClaim(claimId);

        // Should get 2 ether (full shortfall, within 2% cap)
        assertEq(compensation, 2 ether);
        assertEq(token.balanceOf(alice), balanceBefore + 2 ether);

        // Claim should be marked processed
        ISlippageGuaranteeFund.SlippageClaim memory claim = fund.getClaim(claimId);
        assertTrue(claim.processed);
    }

    function test_processClaim_capAt2Percent() public {
        vm.prank(controller);
        bytes32 claimId = fund.submitClaim(
            alice,
            address(token),
            100 ether,
            90 ether,       // 10% shortfall (10 ether)
            100 ether       // Trade value = 100 ether
        );

        vm.prank(controller);
        uint256 compensation = fund.processClaim(claimId);

        // Capped at 2% of trade value = 2 ether
        assertEq(compensation, 2 ether);
    }

    function test_processClaim_revertAlreadyProcessed() public {
        vm.startPrank(controller);
        bytes32 claimId = fund.submitClaim(alice, address(token), 100 ether, 98 ether, 1000 ether);
        fund.processClaim(claimId);

        vm.expectRevert(SlippageGuaranteeFund.ClaimAlreadyProcessed.selector);
        fund.processClaim(claimId);
        vm.stopPrank();
    }

    function test_processClaim_revertExpired() public {
        vm.prank(controller);
        bytes32 claimId = fund.submitClaim(alice, address(token), 100 ether, 98 ether, 1000 ether);

        // Warp past expiry (1 hour)
        vm.warp(block.timestamp + 2 hours);

        vm.prank(controller);
        vm.expectRevert(SlippageGuaranteeFund.ClaimExpired.selector);
        fund.processClaim(claimId);
    }

    // ============ User Limit Tests ============

    function test_userDailyLimit() public {
        // First claim within limit
        vm.prank(controller);
        bytes32 claimId1 = fund.submitClaim(
            alice,
            address(token),
            100 ether,
            98 ether,       // 2 ether shortfall
            1000 ether      // Trade value
        );

        vm.prank(controller);
        fund.processClaim(claimId1);

        // User daily limit is 5% of trade volume
        // After first claim, Alice has used 2 ether
        // For a 1000 ether trade, limit is 50 ether

        ISlippageGuaranteeFund.UserClaimState memory state = fund.getUserState(alice);
        assertEq(state.dailyClaimedAmount, 2 ether);
    }

    function test_userDailyLimit_resetsNextDay() public {
        vm.prank(controller);
        bytes32 claimId = fund.submitClaim(alice, address(token), 100 ether, 98 ether, 1000 ether);

        vm.prank(controller);
        fund.processClaim(claimId);

        ISlippageGuaranteeFund.UserClaimState memory stateBefore = fund.getUserState(alice);
        assertGt(stateBefore.dailyClaimedAmount, 0);

        // Warp to next day
        vm.warp(block.timestamp + 1 days + 1);

        // Make another claim
        vm.prank(controller);
        bytes32 claimId2 = fund.submitClaim(alice, address(token), 100 ether, 99 ether, 1000 ether);

        vm.prank(controller);
        fund.processClaim(claimId2);

        // Limit should have reset
        ISlippageGuaranteeFund.UserClaimState memory stateAfter = fund.getUserState(alice);
        assertEq(stateAfter.dailyClaimedAmount, 1 ether); // Only today's claim
    }

    // ============ Reserve Management Tests ============

    function test_addReserves() public {
        uint256 before = fund.reserves(address(token));

        token.mint(address(fund), 100 ether);
        fund.addReserves(address(token), 100 ether);

        assertEq(fund.reserves(address(token)), before + 100 ether);
    }

    function test_processClaim_revertInsufficientReserves() public {
        // Create fund with no reserves
        SlippageGuaranteeFund emptyFund = _deployEmptyFund();

        vm.prank(controller);
        bytes32 claimId = emptyFund.submitClaim(alice, address(token), 100 ether, 98 ether, 1000 ether);

        vm.prank(controller);
        vm.expectRevert(SlippageGuaranteeFund.InsufficientReserves.selector);
        emptyFund.processClaim(claimId);
    }

    // ============ Statistics Tests ============

    function test_statistics() public {
        vm.startPrank(controller);

        fund.submitClaim(alice, address(token), 100 ether, 98 ether, 1000 ether);
        fund.processClaim(fund.submitClaim(alice, address(token), 100 ether, 99 ether, 1000 ether));
        fund.processClaim(fund.submitClaim(bob, address(token), 100 ether, 97 ether, 1000 ether));

        vm.stopPrank();

        assertEq(fund.totalClaimsProcessed(), 2);
        assertEq(fund.totalCompensationPaid(), 1 ether + 3 ether); // 1 + 3
    }

    // ============ Admin Tests ============

    function test_setConfig() public {
        fund.setConfig(
            300,    // 3% max
            20,     // 0.2% min shortfall
            1000,   // 10% daily limit
            2 hours // 2 hour expiry
        );

        ISlippageGuaranteeFund.FundConfig memory cfg = fund.getConfig();
        assertEq(cfg.maxCompensationBps, 300);
        assertEq(cfg.minShortfallBps, 20);
        assertEq(cfg.userDailyLimitBps, 1000);
        assertEq(cfg.claimExpirySeconds, 2 hours);
    }

    // ============ Edge Cases ============

    function test_noShortfall() public {
        // Actual output >= expected output = no claim
        vm.prank(controller);
        vm.expectRevert(); // Should revert or return 0
        fund.submitClaim(alice, address(token), 100 ether, 100 ether, 1000 ether);
    }

    function test_multipleTokens() public {
        MockERC20 token2 = new MockERC20("WETH", "WETH");
        token2.mint(address(fund), 100 ether);
        fund.addReserves(address(token2), 100 ether);

        vm.startPrank(controller);
        bytes32 claim1 = fund.submitClaim(alice, address(token), 100 ether, 98 ether, 1000 ether);
        bytes32 claim2 = fund.submitClaim(alice, address(token2), 10 ether, 9.9 ether, 100 ether);

        fund.processClaim(claim1);
        fund.processClaim(claim2);
        vm.stopPrank();

        // Both claims processed in different tokens
        assertEq(fund.totalClaimsProcessed(), 2);
    }

    // ============ Helpers ============

    function _deployEmptyFund() internal returns (SlippageGuaranteeFund) {
        SlippageGuaranteeFund impl = new SlippageGuaranteeFund();
        bytes memory initData = abi.encodeWithSelector(
            SlippageGuaranteeFund.initialize.selector,
            owner,
            controller
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        return SlippageGuaranteeFund(address(proxy));
    }
}
