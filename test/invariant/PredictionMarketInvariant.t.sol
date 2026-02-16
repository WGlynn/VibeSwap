// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/PredictionMarket.sol";

// ============ Mock Token ============

contract MockPMIToken {
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

// ============ Handler ============

contract PMHandler is Test {
    PredictionMarket public pm;
    MockPMIToken public collateral;
    uint256 public marketId;

    address[] public actors;

    // Ghost variables
    uint256 public ghost_totalCollateralIn;
    uint256 public ghost_totalCollateralOut;

    constructor(
        PredictionMarket _pm,
        MockPMIToken _collateral,
        uint256 _marketId,
        address[] memory _actors
    ) {
        pm = _pm;
        collateral = _collateral;
        marketId = _marketId;
        actors = _actors;
    }

    function buyYes(uint256 actorSeed, uint256 amount) public {
        amount = bound(amount, 0.01 ether, 10 ether);
        address actor = actors[actorSeed % actors.length];

        vm.prank(actor);
        try pm.buyShares(marketId, true, amount, 0) {
            ghost_totalCollateralIn += amount;
        } catch {}
    }

    function buyNo(uint256 actorSeed, uint256 amount) public {
        amount = bound(amount, 0.01 ether, 10 ether);
        address actor = actors[actorSeed % actors.length];

        vm.prank(actor);
        try pm.buyShares(marketId, false, amount, 0) {
            ghost_totalCollateralIn += amount;
        } catch {}
    }

    function sellYes(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        IPredictionMarket.Position memory pos = pm.getPosition(marketId, actor);
        if (pos.yesShares == 0) return;

        amount = bound(amount, 1, pos.yesShares);

        uint256 balBefore = collateral.balanceOf(actor);
        vm.prank(actor);
        try pm.sellShares(marketId, true, amount, 0) {
            ghost_totalCollateralOut += collateral.balanceOf(actor) - balBefore;
        } catch {}
    }

    function sellNo(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        IPredictionMarket.Position memory pos = pm.getPosition(marketId, actor);
        if (pos.noShares == 0) return;

        amount = bound(amount, 1, pos.noShares);

        uint256 balBefore = collateral.balanceOf(actor);
        vm.prank(actor);
        try pm.sellShares(marketId, false, amount, 0) {
            ghost_totalCollateralOut += collateral.balanceOf(actor) - balBefore;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract PredictionMarketInvariantTest is StdInvariant, Test {
    PredictionMarket public pm;
    MockPMIToken public collateral;
    PMHandler public handler;

    address public treasuryAddr;
    address public creator;
    address[] public actors;
    uint256 public marketId;

    function setUp() public {
        treasuryAddr = makeAddr("treasury");
        creator = makeAddr("creator");

        pm = new PredictionMarket(treasuryAddr);

        collateral = new MockPMIToken();

        // Fund creator
        collateral.mint(creator, 1_000_000 ether);
        vm.prank(creator);
        collateral.approve(address(pm), type(uint256).max);

        // Create actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);
            collateral.mint(actor, 100_000 ether);
            vm.prank(actor);
            collateral.approve(address(pm), type(uint256).max);
        }

        // Create market with 7-day lock
        uint256 start = block.timestamp;
        vm.prank(creator);
        marketId = pm.createMarket(
            bytes32("Test"),
            address(collateral),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        handler = new PMHandler(pm, collateral, marketId, actors);
        targetContract(address(handler));
    }

    // ============ Invariant: prices sum to 1 ============

    function invariant_pricesSumToOne() public view {
        uint256 yesP = pm.getPrice(marketId, true);
        uint256 noP = pm.getPrice(marketId, false);
        assertApproxEqAbs(yesP + noP, 1 ether, 1, "PRICE: YES + NO must equal ~1");
    }

    // ============ Invariant: pool product non-decreasing ============

    function invariant_poolProductNonDecreasing() public view {
        IPredictionMarket.PredictionMarketData memory m = pm.getMarket(marketId);
        // Initial k = liquidityParam^2 = 100e18 * 100e18
        uint256 k = m.yPool * m.nPool;
        uint256 initialK = m.liquidityParam * m.liquidityParam;
        assertGe(k, initialK, "POOL: k must not decrease below initial");
    }

    // ============ Invariant: collateral balance covers total sets + liquidity ============

    function invariant_collateralSolvent() public view {
        IPredictionMarket.PredictionMarketData memory m = pm.getMarket(marketId);
        uint256 contractBal = collateral.balanceOf(address(pm));

        // Contract should hold at least totalSets + initial liquidity
        // Some collateral goes to treasury as fees, so just check >= totalSets
        assertGe(
            contractBal,
            m.totalSets,
            "SOLVENCY: collateral balance < totalSets"
        );
    }

    // ============ Invariant: collateral in >= collateral out ============

    function invariant_collateralFlowPositive() public view {
        assertGe(
            handler.ghost_totalCollateralIn(),
            handler.ghost_totalCollateralOut(),
            "FLOW: more collateral out than in"
        );
    }

    // ============ Invariant: pools always positive ============

    function invariant_poolsPositive() public view {
        IPredictionMarket.PredictionMarketData memory m = pm.getMarket(marketId);
        assertGt(m.yPool, 0, "POOL: yPool must be positive");
        assertGt(m.nPool, 0, "POOL: nPool must be positive");
    }
}
