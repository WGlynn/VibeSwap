// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/PredictionMarket.sol";

// ============ Mocks ============

contract MockPMFToken {
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

contract PredictionMarketFuzzTest is Test {
    PredictionMarket public pm;
    MockPMFToken public collateral;

    address public creator;
    address public resolver;
    address public alice;
    address public bob;
    address public treasuryAddr;

    function setUp() public {
        treasuryAddr = makeAddr("treasury");
        creator = makeAddr("creator");
        resolver = makeAddr("resolver");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        pm = new PredictionMarket(treasuryAddr);
        pm.addResolver(resolver);

        collateral = new MockPMFToken();

        collateral.mint(creator, type(uint128).max);
        vm.prank(creator);
        collateral.approve(address(pm), type(uint256).max);

        collateral.mint(alice, type(uint128).max);
        vm.prank(alice);
        collateral.approve(address(pm), type(uint256).max);

        collateral.mint(bob, type(uint128).max);
        vm.prank(bob);
        collateral.approve(address(pm), type(uint256).max);
    }

    // ============ Fuzz: prices always sum to 1 ============

    function testFuzz_pricesSumToOne(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 0.01 ether, 10_000 ether);

        uint256 start = block.timestamp;
        vm.prank(creator);
        uint256 id = pm.createMarket(
            bytes32("Q"),
            address(collateral),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        vm.prank(alice);
        pm.buyShares(id, true, buyAmount, 0);

        uint256 yesP = pm.getPrice(id, true);
        uint256 noP = pm.getPrice(id, false);
        assertApproxEqAbs(yesP + noP, 1 ether, 1, "Prices must sum to ~1");
    }

    // ============ Fuzz: YES buy increases YES price ============

    function testFuzz_yesBuyIncreasesYesPrice(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 0.01 ether, 10_000 ether);

        uint256 start = block.timestamp;
        vm.prank(creator);
        uint256 id = pm.createMarket(
            bytes32("Q"),
            address(collateral),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        uint256 priceBefore = pm.getPrice(id, true);

        vm.prank(alice);
        pm.buyShares(id, true, buyAmount, 0);

        uint256 priceAfter = pm.getPrice(id, true);
        assertGt(priceAfter, priceBefore, "YES price must increase after YES buy");
    }

    // ============ Fuzz: NO buy increases NO price ============

    function testFuzz_noBuyIncreasesNoPrice(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 0.01 ether, 10_000 ether);

        uint256 start = block.timestamp;
        vm.prank(creator);
        uint256 id = pm.createMarket(
            bytes32("Q"),
            address(collateral),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        uint256 priceBefore = pm.getPrice(id, false);

        vm.prank(alice);
        pm.buyShares(id, false, buyAmount, 0);

        uint256 priceAfter = pm.getPrice(id, false);
        assertGt(priceAfter, priceBefore, "NO price must increase after NO buy");
    }

    // ============ Fuzz: winners can claim after resolution ============

    function testFuzz_winnersCanClaim(uint256 yesAmount, uint256 noAmount, bool yesWins) public {
        yesAmount = bound(yesAmount, 1 ether, 1_000 ether);
        noAmount = bound(noAmount, 1 ether, 1_000 ether);

        uint256 start = block.timestamp;
        vm.prank(creator);
        uint256 id = pm.createMarket(
            bytes32("Q"),
            address(collateral),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        // Alice buys YES, Bob buys NO
        vm.prank(alice);
        pm.buyShares(id, true, yesAmount, 0);

        vm.prank(bob);
        pm.buyShares(id, false, noAmount, 0);

        // Resolve
        vm.warp(start + 7 days);

        IPredictionMarket.MarketOutcome outcome = yesWins
            ? IPredictionMarket.MarketOutcome.YES
            : IPredictionMarket.MarketOutcome.NO;

        vm.prank(resolver);
        pm.resolveMarket(id, outcome);

        // Winner claims
        address winner = yesWins ? alice : bob;
        IPredictionMarket.Position memory pos = pm.getPosition(id, winner);
        uint256 winningShares = yesWins ? pos.yesShares : pos.noShares;

        uint256 balBefore = collateral.balanceOf(winner);
        vm.prank(winner);
        pm.claimWinnings(id);

        assertEq(collateral.balanceOf(winner) - balBefore, winningShares, "Claim should return 1 collateral per share");
    }

    // ============ Fuzz: losing side cannot claim ============

    function testFuzz_losersCannotClaim(uint256 amount) public {
        amount = bound(amount, 1 ether, 1_000 ether);

        uint256 start = block.timestamp;
        vm.prank(creator);
        uint256 id = pm.createMarket(
            bytes32("Q"),
            address(collateral),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        vm.prank(alice);
        pm.buyShares(id, true, amount, 0);

        vm.warp(start + 7 days);
        vm.prank(resolver);
        pm.resolveMarket(id, IPredictionMarket.MarketOutcome.NO);

        vm.prank(alice);
        vm.expectRevert(IPredictionMarket.NoWinnings.selector);
        pm.claimWinnings(id);
    }

    // ============ Fuzz: buy then sell returns less (AMM + fees) ============

    function testFuzz_buyThenSellLoss(uint256 amount) public {
        amount = bound(amount, 1 ether, 100 ether);

        uint256 start = block.timestamp;
        vm.prank(creator);
        uint256 id = pm.createMarket(
            bytes32("Q"),
            address(collateral),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        uint256 balBefore = collateral.balanceOf(alice);

        vm.prank(alice);
        pm.buyShares(id, true, amount, 0);

        IPredictionMarket.Position memory pos = pm.getPosition(id, alice);

        vm.prank(alice);
        pm.sellShares(id, true, pos.yesShares, 0);

        uint256 balAfter = collateral.balanceOf(alice);
        assertLt(balAfter, balBefore, "Roundtrip should lose to AMM spread + fees");
    }

    // ============ Fuzz: pool product invariant (constant product) ============

    function testFuzz_poolProductNonDecreasing(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 1_000 ether);

        uint256 start = block.timestamp;
        vm.prank(creator);
        uint256 id = pm.createMarket(
            bytes32("Q"),
            address(collateral),
            100 ether,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        IPredictionMarket.PredictionMarketData memory mBefore = pm.getMarket(id);
        uint256 kBefore = mBefore.yPool * mBefore.nPool;

        vm.prank(alice);
        pm.buyShares(id, true, amount, 0);

        IPredictionMarket.PredictionMarketData memory mAfter = pm.getMarket(id);
        uint256 kAfter = mAfter.yPool * mAfter.nPool;

        // After adding liquidity (complete set mint) and swapping, k should increase or stay same
        assertGe(kAfter, kBefore, "Pool product k must not decrease");
    }

    // ============ Fuzz: liquidity param determines initial 50/50 ============

    function testFuzz_initialPricesEqual(uint256 liq) public {
        liq = bound(liq, 1 ether, 100_000 ether);

        uint256 start = block.timestamp;
        vm.prank(creator);
        uint256 id = pm.createMarket(
            bytes32("Q"),
            address(collateral),
            liq,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );

        uint256 yesP = pm.getPrice(id, true);
        uint256 noP = pm.getPrice(id, false);

        assertEq(yesP, 0.5 ether, "YES should start at 50%");
        assertEq(noP, 0.5 ether, "NO should start at 50%");
    }
}
