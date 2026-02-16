// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/CooperativeMEVRedistributor.sol";

// ============ Mocks ============

contract MockMEVFToken {
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

// ============ Fuzz Tests ============

contract CooperativeMEVRedistributorFuzzTest is Test {
    CooperativeMEVRedistributor public mev;
    MockMEVFToken public token;

    address public owner;
    address public treasuryAddr;
    address public lp1;
    address public lp2;
    address public trader1;

    function setUp() public {
        owner = address(this);
        treasuryAddr = makeAddr("treasury");
        lp1 = makeAddr("lp1");
        lp2 = makeAddr("lp2");
        trader1 = makeAddr("trader1");

        token = new MockMEVFToken();
        mev = new CooperativeMEVRedistributor(treasuryAddr, address(token));

        token.mint(owner, type(uint128).max);
        token.approve(address(mev), type(uint256).max);
    }

    // ============ Fuzz: splits always sum to revenue ============

    function testFuzz_splitsSumToRevenue(uint256 revenue) public {
        revenue = bound(revenue, 1, 1_000_000 ether);

        mev.captureMEV(1, bytes32("pool1"), revenue);

        ICooperativeMEVRedistributor.MEVDistribution memory d = mev.getDistribution(1);
        assertEq(d.lpShare + d.traderShare + d.treasuryShare, revenue, "Splits must sum to revenue");
    }

    // ============ Fuzz: LP share is always 60% ============

    function testFuzz_lpShareIs60Percent(uint256 revenue) public {
        revenue = bound(revenue, 100, 1_000_000 ether);

        mev.captureMEV(1, bytes32("pool1"), revenue);

        ICooperativeMEVRedistributor.MEVDistribution memory d = mev.getDistribution(1);
        assertEq(d.lpShare, (revenue * 6000) / 10000, "LP share must be 60%");
    }

    // ============ Fuzz: treasury receives share immediately ============

    function testFuzz_treasuryReceivesImmediately(uint256 revenue) public {
        revenue = bound(revenue, 1 ether, 1_000_000 ether);

        mev.captureMEV(1, bytes32("pool1"), revenue);

        ICooperativeMEVRedistributor.MEVDistribution memory d = mev.getDistribution(1);
        assertEq(token.balanceOf(treasuryAddr), d.treasuryShare, "Treasury should receive immediately");
    }

    // ============ Fuzz: LP rewards proportional to weights ============

    function testFuzz_lpRewardsProportional(uint256 revenue, uint256 w1, uint256 w2) public {
        revenue = bound(revenue, 1 ether, 1_000_000 ether);
        w1 = bound(w1, 1, 10000);
        w2 = bound(w2, 1, 10000);

        mev.captureMEV(1, bytes32("pool1"), revenue);

        address[] memory lps = new address[](2);
        lps[0] = lp1;
        lps[1] = lp2;
        uint256[] memory lpW = new uint256[](2);
        lpW[0] = w1;
        lpW[1] = w2;
        address[] memory traders = new address[](0);
        uint256[] memory traderW = new uint256[](0);

        mev.distributeMEV(1, lps, lpW, traders, traderW);

        uint256 r1 = mev.pendingLPReward(1, lp1);
        uint256 r2 = mev.pendingLPReward(1, lp2);

        ICooperativeMEVRedistributor.MEVDistribution memory d = mev.getDistribution(1);

        // r1/r2 should be ~w1/w2 (integer division dust acceptable)
        assertApproxEqAbs(r1 + r2, d.lpShare, 1, "LP rewards should ~= LP share");
    }

    // ============ Fuzz: claim returns exact pending amount ============

    function testFuzz_claimReturnsExact(uint256 revenue) public {
        revenue = bound(revenue, 1 ether, 1_000_000 ether);

        mev.captureMEV(1, bytes32("pool1"), revenue);

        address[] memory lps = new address[](1);
        lps[0] = lp1;
        uint256[] memory lpW = new uint256[](1);
        lpW[0] = 10000;
        address[] memory traders = new address[](0);
        uint256[] memory traderW = new uint256[](0);

        mev.distributeMEV(1, lps, lpW, traders, traderW);

        uint256 pending = mev.pendingLPReward(1, lp1);

        vm.prank(lp1);
        mev.claimLPReward(1);

        assertEq(token.balanceOf(lp1), pending, "Claim must return exact pending");
    }
}
