// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/SlippageGuaranteeFund.sol";
import "../../contracts/incentives/interfaces/ISlippageGuaranteeFund.sol";
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

    bytes32 public constant POOL_ID = keccak256("pool-1");

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
        token.mint(address(this), 10000 ether);
        token.approve(address(fund), 10000 ether);
        fund.depositFunds(address(token), 10000 ether);
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(fund.owner(), owner);
        assertEq(fund.incentiveController(), controller);
    }

    function test_defaultConfig() public view {
        ISlippageGuaranteeFund.FundConfig memory cfg = fund.getConfig();

        assertEq(cfg.maxClaimPercentBps, 200);    // 2%
        assertGt(cfg.claimWindow, 0);
    }

    // ============ Reserve Management Tests ============

    function test_depositFunds() public {
        uint256 before = fund.getTotalReserves(address(token));

        token.mint(address(this), 100 ether);
        token.approve(address(fund), 100 ether);
        fund.depositFunds(address(token), 100 ether);

        assertEq(fund.getTotalReserves(address(token)), before + 100 ether);
    }

    // ============ Execution Recording Tests ============

    function test_recordExecution() public {
        vm.prank(controller);
        bytes32 claimId = fund.recordExecution(
            POOL_ID,
            alice,
            address(token),
            100 ether,      // expectedOutput
            98 ether        // actualOutput (2 ether shortfall)
        );

        ISlippageGuaranteeFund.SlippageClaim memory claim = fund.getClaim(claimId);

        assertEq(claim.trader, alice);
        assertEq(claim.token, address(token));
        assertEq(claim.expectedOutput, 100 ether);
        assertEq(claim.actualOutput, 98 ether);
        assertEq(claim.shortfall, 2 ether);
        assertFalse(claim.processed);
    }

    function test_recordExecution_revertUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert(SlippageGuaranteeFund.Unauthorized.selector);
        fund.recordExecution(POOL_ID, alice, address(token), 100 ether, 98 ether);
    }

    // ============ Claim Processing Tests ============

    function test_processClaim() public {
        vm.prank(controller);
        bytes32 claimId = fund.recordExecution(
            POOL_ID,
            alice,
            address(token),
            100 ether,
            98 ether       // 2 ether shortfall
        );

        uint256 balanceBefore = token.balanceOf(alice);

        vm.prank(controller);
        uint256 compensation = fund.processClaim(claimId);

        // Should get some compensation (up to 2% max)
        assertGt(compensation, 0);
        assertEq(token.balanceOf(alice), balanceBefore + compensation);

        // Claim should be marked processed
        ISlippageGuaranteeFund.SlippageClaim memory claim = fund.getClaim(claimId);
        assertTrue(claim.processed);
    }

    function test_processClaim_revertAlreadyProcessed() public {
        vm.startPrank(controller);
        bytes32 claimId = fund.recordExecution(POOL_ID, alice, address(token), 100 ether, 98 ether);
        fund.processClaim(claimId);

        vm.expectRevert(SlippageGuaranteeFund.ClaimAlreadyProcessed.selector);
        fund.processClaim(claimId);
        vm.stopPrank();
    }

    // ============ User State Tests ============

    function test_userState() public {
        vm.startPrank(controller);
        bytes32 claimId = fund.recordExecution(POOL_ID, alice, address(token), 100 ether, 98 ether);
        fund.processClaim(claimId);
        vm.stopPrank();

        ISlippageGuaranteeFund.UserClaimState memory state = fund.getUserState(alice);
        assertGt(state.claimedToday, 0);
        assertGt(state.totalLifetimeClaims, 0);
    }

    // ============ View Functions ============

    function test_canClaim() public {
        vm.prank(controller);
        bytes32 claimId = fund.recordExecution(POOL_ID, alice, address(token), 100 ether, 98 ether);

        (bool eligible,) = fund.canClaim(claimId);
        assertTrue(eligible);
    }

    // ============ Config Tests ============

    function test_setConfig() public {
        ISlippageGuaranteeFund.FundConfig memory newConfig = ISlippageGuaranteeFund.FundConfig({
            maxClaimPercentBps: 300,    // 3% max
            userDailyLimitBps: 1000,    // 10% daily limit
            claimWindow: 2 hours,
            minShortfallBps: 100        // 1% min shortfall
        });

        fund.setConfig(newConfig);

        ISlippageGuaranteeFund.FundConfig memory cfg = fund.getConfig();
        assertEq(cfg.maxClaimPercentBps, 300);
        assertEq(cfg.userDailyLimitBps, 1000);
        assertEq(cfg.claimWindow, 2 hours);
        assertEq(cfg.minShortfallBps, 100);
    }
}
