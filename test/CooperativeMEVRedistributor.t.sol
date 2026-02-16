// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/CooperativeMEVRedistributor.sol";

// ============ Mock Token ============

contract MockMEVToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount);
        require(allowance[from][msg.sender] >= amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

// ============ Test Contract ============

contract CooperativeMEVRedistributorTest is Test {
    CooperativeMEVRedistributor public mev;
    MockMEVToken public token;

    address public owner;
    address public treasuryAddr;
    address public capturer;
    address public lp1;
    address public lp2;
    address public trader1;
    address public trader2;

    uint256 constant REVENUE = 100 ether;

    function setUp() public {
        owner = makeAddr("owner");
        treasuryAddr = makeAddr("treasury");
        capturer = makeAddr("capturer");
        lp1 = makeAddr("lp1");
        lp2 = makeAddr("lp2");
        trader1 = makeAddr("trader1");
        trader2 = makeAddr("trader2");

        token = new MockMEVToken();

        vm.prank(owner);
        mev = new CooperativeMEVRedistributor(treasuryAddr, address(token));

        vm.prank(owner);
        mev.addCapturer(capturer);

        // Fund capturer
        token.mint(capturer, 1_000_000 ether);
        vm.prank(capturer);
        token.approve(address(mev), type(uint256).max);
    }

    // ============ Helpers ============

    function _captureDefault() internal {
        vm.prank(capturer);
        mev.captureMEV(1, bytes32("pool1"), REVENUE);
    }

    function _distributeDefault() internal {
        address[] memory lps = new address[](2);
        lps[0] = lp1;
        lps[1] = lp2;
        uint256[] memory lpW = new uint256[](2);
        lpW[0] = 7000; // 70%
        lpW[1] = 3000; // 30%

        address[] memory traders = new address[](2);
        traders[0] = trader1;
        traders[1] = trader2;
        uint256[] memory traderW = new uint256[](2);
        traderW[0] = 5000;
        traderW[1] = 5000;

        vm.prank(capturer);
        mev.distributeMEV(1, lps, lpW, traders, traderW);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsState() public view {
        assertEq(mev.treasury(), treasuryAddr);
        assertEq(mev.token(), address(token));
        assertEq(mev.owner(), owner);
    }

    // ============ captureMEV Tests ============

    function test_captureMEV_happyPath() public {
        _captureDefault();

        ICooperativeMEVRedistributor.MEVDistribution memory d = mev.getDistribution(1);
        assertEq(d.totalPriorityRevenue, REVENUE);
        assertEq(d.lpShare, (REVENUE * 6000) / 10000);
        assertEq(d.traderShare, (REVENUE * 3000) / 10000);
        assertEq(d.treasuryShare, REVENUE - d.lpShare - d.traderShare);
        assertFalse(d.distributed);

        // Treasury got its share immediately
        assertEq(token.balanceOf(treasuryAddr), d.treasuryShare);
    }

    function test_captureMEV_revertsAlreadyCaptured() public {
        _captureDefault();

        vm.prank(capturer);
        vm.expectRevert(ICooperativeMEVRedistributor.AlreadyCaptured.selector);
        mev.captureMEV(1, bytes32("pool1"), 50 ether);
    }

    function test_captureMEV_revertsZeroAmount() public {
        vm.prank(capturer);
        vm.expectRevert(ICooperativeMEVRedistributor.ZeroAmount.selector);
        mev.captureMEV(1, bytes32("pool1"), 0);
    }

    // ============ distributeMEV Tests ============

    function test_distributeMEV_happyPath() public {
        _captureDefault();
        _distributeDefault();

        ICooperativeMEVRedistributor.MEVDistribution memory d = mev.getDistribution(1);
        assertTrue(d.distributed);

        // LP1 gets 70% of LP share (60 ether * 70% = 42 ether)
        uint256 lp1Reward = mev.pendingLPReward(1, lp1);
        assertEq(lp1Reward, (d.lpShare * 7000) / 10000);

        // Trader1 gets 50% of trader share
        uint256 t1Refund = mev.pendingTraderRefund(1, trader1);
        assertEq(t1Refund, (d.traderShare * 5000) / 10000);
    }

    function test_distributeMEV_revertsAlreadyDistributed() public {
        _captureDefault();
        _distributeDefault();

        address[] memory lps = new address[](0);
        uint256[] memory lpW = new uint256[](0);
        address[] memory traders = new address[](0);
        uint256[] memory traderW = new uint256[](0);

        vm.prank(capturer);
        vm.expectRevert(ICooperativeMEVRedistributor.AlreadyDistributed.selector);
        mev.distributeMEV(1, lps, lpW, traders, traderW);
    }

    // ============ claimLPReward Tests ============

    function test_claimLPReward_happyPath() public {
        _captureDefault();
        _distributeDefault();

        uint256 expected = mev.pendingLPReward(1, lp1);
        assertGt(expected, 0);

        vm.prank(lp1);
        mev.claimLPReward(1);

        assertEq(token.balanceOf(lp1), expected);
        assertEq(mev.pendingLPReward(1, lp1), 0);
    }

    function test_claimLPReward_revertsAlreadyClaimed() public {
        _captureDefault();
        _distributeDefault();

        vm.prank(lp1);
        mev.claimLPReward(1);

        vm.prank(lp1);
        vm.expectRevert(ICooperativeMEVRedistributor.AlreadyClaimed.selector);
        mev.claimLPReward(1);
    }

    function test_claimLPReward_revertsNothingToClaim() public {
        _captureDefault();
        _distributeDefault();

        vm.prank(makeAddr("rando"));
        vm.expectRevert(ICooperativeMEVRedistributor.NothingToClaim.selector);
        mev.claimLPReward(1);
    }

    // ============ claimTraderRefund Tests ============

    function test_claimTraderRefund_happyPath() public {
        _captureDefault();
        _distributeDefault();

        uint256 expected = mev.pendingTraderRefund(1, trader1);

        vm.prank(trader1);
        mev.claimTraderRefund(1);

        assertEq(token.balanceOf(trader1), expected);
    }

    function test_claimTraderRefund_revertsNotDistributed() public {
        _captureDefault();
        // Don't distribute

        vm.prank(trader1);
        vm.expectRevert(ICooperativeMEVRedistributor.NotDistributed.selector);
        mev.claimTraderRefund(1);
    }

    // ============ Split Verification ============

    function test_splitsSumToRevenue() public {
        _captureDefault();

        ICooperativeMEVRedistributor.MEVDistribution memory d = mev.getDistribution(1);
        assertEq(d.lpShare + d.traderShare + d.treasuryShare, REVENUE);
    }
}
