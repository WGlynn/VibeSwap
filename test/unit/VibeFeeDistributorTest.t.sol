// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeFeeDistributor.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock ============

contract MockFeeToken is ERC20 {
    constructor() ERC20("FEE", "FEE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract VibeFeDistributorTest is Test {
    VibeFeeDistributor public dist;
    MockFeeToken public token;

    address treasuryAddr = address(0xDD);
    address insuranceAddr = address(0xEE);
    address mindAddr = address(0xFF);
    address alice = address(0xA1);
    address bob = address(0xB0);

    function setUp() public {
        dist = new VibeFeeDistributor();
        dist.initialize(treasuryAddr, insuranceAddr, mindAddr);

        token = new MockFeeToken();
        dist.addSupportedToken(address(token));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(address(this), 1000 ether);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(dist.stakerShareBps(), 4000);
        assertEq(dist.lpShareBps(), 2500);
        assertEq(dist.treasuryShareBps(), 2000);
        assertEq(dist.insuranceShareBps(), 1000);
        assertEq(dist.mindShareBps(), 500);
        assertEq(dist.treasury(), treasuryAddr);
        assertEq(dist.insuranceFund(), insuranceAddr);
        assertEq(dist.mindRewardPool(), mindAddr);
        assertEq(dist.epochDuration(), 7 days);
    }

    // ============ Fee Collection ============

    function test_collectETHFees() public {
        dist.collectETHFees{value: 10 ether}();
        assertEq(dist.pendingFees(address(0)), 10 ether);
    }

    function test_collectTokenFees() public {
        token.mint(alice, 1000e18);
        vm.prank(alice);
        token.approve(address(dist), type(uint256).max);

        vm.prank(alice);
        dist.collectFees(address(token), 500e18);

        assertEq(dist.pendingFees(address(token)), 500e18);
        assertEq(token.balanceOf(address(dist)), 500e18);
    }

    function test_revertCollectUnsupportedToken() public {
        MockFeeToken badToken = new MockFeeToken();
        badToken.mint(alice, 1000e18);

        vm.prank(alice);
        badToken.approve(address(dist), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert("Token not supported");
        dist.collectFees(address(badToken), 100e18);
    }

    function test_collectMultipleETHFees() public {
        dist.collectETHFees{value: 5 ether}();
        dist.collectETHFees{value: 3 ether}();

        assertEq(dist.pendingFees(address(0)), 8 ether);
    }

    // ============ Distribution ============

    function test_distributeETHFees() public {
        // Collect fees
        dist.collectETHFees{value: 100 ether}();

        // Wait for epoch
        vm.warp(block.timestamp + 7 days);

        uint256 treasuryBefore = treasuryAddr.balance;
        uint256 insuranceBefore = insuranceAddr.balance;
        uint256 mindBefore = mindAddr.balance;

        dist.distribute(address(0));

        // Treasury: 20% of 100 = 20 ETH
        assertEq(treasuryAddr.balance, treasuryBefore + 20 ether);
        // Insurance: 10% of 100 = 10 ETH
        assertEq(insuranceAddr.balance, insuranceBefore + 10 ether);
        // Mind: 5% of 100 = 5 ETH
        assertEq(mindAddr.balance, mindBefore + 5 ether);

        assertEq(dist.pendingFees(address(0)), 0);
        assertEq(dist.currentEpoch(), 1);
    }

    function test_revertDistributeBeforeEpoch() public {
        dist.collectETHFees{value: 10 ether}();

        vm.expectRevert("Epoch not ended");
        dist.distribute(address(0));
    }

    function test_revertDistributeNoFees() public {
        vm.warp(block.timestamp + 7 days);

        vm.expectRevert("No fees to distribute");
        dist.distribute(address(0));
    }

    function test_distributeTokenFees() public {
        token.mint(address(this), 1000e18);
        token.approve(address(dist), type(uint256).max);
        dist.collectFees(address(token), 1000e18);

        vm.warp(block.timestamp + 7 days);

        dist.distribute(address(token));

        // Treasury: 20% = 200
        assertEq(token.balanceOf(treasuryAddr), 200e18);
        // Insurance: 10% = 100
        assertEq(token.balanceOf(insuranceAddr), 100e18);
        // Mind: should get remainder after others
        assertGt(token.balanceOf(mindAddr), 0);
    }

    // ============ Staking ============

    function test_stake() public {
        vm.prank(alice);
        dist.stake{value: 10 ether}();

        assertEq(dist.userStake(alice), 10 ether);
        assertEq(dist.totalStaked(), 10 ether);
    }

    function test_unstake() public {
        vm.prank(alice);
        dist.stake{value: 10 ether}();

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        dist.unstake(5 ether);

        assertEq(dist.userStake(alice), 5 ether);
        assertEq(alice.balance, balanceBefore + 5 ether);
    }

    function test_revertStakeZero() public {
        vm.prank(alice);
        vm.expectRevert("Zero stake");
        dist.stake{value: 0}();
    }

    function test_revertUnstakeInsufficient() public {
        vm.prank(alice);
        dist.stake{value: 5 ether}();

        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        dist.unstake(10 ether);
    }

    // ============ Claiming ============

    function test_revertClaimNothing() public {
        vm.prank(alice);
        vm.expectRevert("Nothing to claim");
        dist.claim(address(0));
    }

    function test_getClaimable() public view {
        assertEq(dist.getClaimable(alice, address(0)), 0);
    }

    // ============ Admin ============

    function test_addSupportedToken() public {
        MockFeeToken newToken = new MockFeeToken();
        dist.addSupportedToken(address(newToken));

        assertTrue(dist.supportedTokens(address(newToken)));
    }

    function test_updateSplits() public {
        dist.updateSplits(5000, 2000, 1500, 1000, 500);

        assertEq(dist.stakerShareBps(), 5000);
        assertEq(dist.lpShareBps(), 2000);
        assertEq(dist.treasuryShareBps(), 1500);
    }

    function test_revertUpdateSplitsInvalidSum() public {
        vm.expectRevert("Must sum to 10000");
        dist.updateSplits(5000, 2000, 1500, 1000, 1000); // sum = 10500
    }

    function test_revertUpdateSplitsNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        dist.updateSplits(5000, 2000, 1500, 1000, 500);
    }

    function test_getSupportedTokens() public view {
        address[] memory tokens = dist.getSupportedTokens();
        assertEq(tokens.length, 1);
        assertEq(tokens[0], address(token));
    }

    // ============ Receive ============

    function test_receiveETH() public {
        (bool ok, ) = address(dist).call{value: 1 ether}("");
        assertTrue(ok);
    }

    receive() external payable {}
}
