// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibePredictionEngine.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ VibePredictionEngine Tests ============

contract VibePredictionEngineTest is Test {

    VibePredictionEngine public engine;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;
    address public dave;

    // ============ Events (re-declared for vm.expectEmit) ============

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        bytes32 agentId,
        VibePredictionEngine.MarketType mType,
        bytes32 questionHash
    );
    event TokensMinted(uint256 indexed marketId, address indexed user, uint256 yesAmount, uint256 noAmount);
    event TokensBurned(uint256 indexed marketId, address indexed user, uint256 amount);
    event SharesBought(uint256 indexed marketId, address indexed buyer, bool isYes, uint256 shares, uint256 cost);
    event MarketResolved(uint256 indexed marketId, uint256 outcome, VibePredictionEngine.ResolutionMethod method);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event InsurancePolicyCreated(uint256 indexed policyId, uint256 indexed marketId, address indexed insured, uint256 coverage);
    event RiskPoolCreated(uint256 indexed poolId, address indexed underwriter, uint256 deposit);
    event ResolutionEvidenceSubmitted(uint256 indexed marketId, bytes32 evidenceHash, address indexed validator);
    event MarketDisputed(uint256 indexed marketId, address indexed disputer);

    // Allow test contract (= owner) to receive ETH from withdrawProtocolRevenue
    receive() external payable {}

    // ============ Setup ============

    function setUp() public {
        owner   = address(this);
        alice   = makeAddr("alice");
        bob     = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave    = makeAddr("dave");

        VibePredictionEngine impl = new VibePredictionEngine();
        bytes memory initData = abi.encodeWithSelector(VibePredictionEngine.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        engine = VibePredictionEngine(payable(address(proxy)));

        vm.deal(alice,   1000 ether);
        vm.deal(bob,     1000 ether);
        vm.deal(charlie, 1000 ether);
        vm.deal(dave,    1000 ether);
    }

    // ============ Helpers ============

    function _createBinaryMarket(address creator, uint256 seed) internal returns (uint256 marketId) {
        vm.prank(creator);
        marketId = engine.createMarket{value: seed}(
            keccak256("Will ETH hit 10k?"),
            bytes32(0),
            bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.SINGLE_RESOLVER,
            block.timestamp + 7 days,
            block.timestamp + 14 days
        );
    }

    function _resolveMarket(uint256 marketId, uint256 outcome) internal {
        vm.warp(block.timestamp + 7 days);
        engine.resolveMarket(marketId, outcome);
    }

    // ============ Initialize ============

    function test_initialize_setsOwner() public view {
        assertEq(engine.owner(), owner);
    }

    function test_initialize_zeroStats() public view {
        assertEq(engine.marketCount(), 0);
        assertEq(engine.totalVolume(), 0);
        assertEq(engine.policyCount(), 0);
        assertEq(engine.riskPoolCount(), 0);
    }

    // ============ createMarket ============

    function test_createMarket_happyPath() public {
        uint256 seed = 1 ether;

        vm.expectEmit(true, true, false, true);
        emit MarketCreated(
            1,
            alice,
            bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            keccak256("Will ETH hit 10k?")
        );

        uint256 id = _createBinaryMarket(alice, seed);

        assertEq(id, 1);
        assertEq(engine.marketCount(), 1);

        VibePredictionEngine.Market memory m = engine.getMarket(1);
        assertEq(m.creator, alice);
        assertEq(m.collateralPool, seed);
        assertEq(m.yesPool, seed);
        assertEq(m.noPool, seed);
        assertEq(uint8(m.phase), uint8(VibePredictionEngine.MarketPhase.OPEN));
        assertEq(m.resolvedOutcome, 0);
    }

    function test_createMarket_multipleMarketsIncrementId() public {
        uint256 id1 = _createBinaryMarket(alice, 1 ether);
        uint256 id2 = _createBinaryMarket(bob, 1 ether);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(engine.marketCount(), 2);
    }

    function test_createMarket_revertsInsufficientLiquidity() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient liquidity");
        engine.createMarket{value: 0.001 ether}(
            keccak256("q"),
            bytes32(0), bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.SINGLE_RESOLVER,
            block.timestamp + 1 days,
            block.timestamp + 2 days
        );
    }

    function test_createMarket_revertsLockInPast() public {
        vm.prank(alice);
        vm.expectRevert("Lock in past");
        engine.createMarket{value: 1 ether}(
            keccak256("q"),
            bytes32(0), bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.SINGLE_RESOLVER,
            block.timestamp - 1,
            block.timestamp + 1 days
        );
    }

    function test_createMarket_revertsDeadlineBeforeLock() public {
        vm.prank(alice);
        vm.expectRevert("Deadline before lock");
        engine.createMarket{value: 1 ether}(
            keccak256("q"),
            bytes32(0), bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.SINGLE_RESOLVER,
            block.timestamp + 7 days,
            block.timestamp + 3 days // deadline < lockTime
        );
    }

    function test_createMarket_withContextAnchor() public {
        bytes32 anchor = keccak256("context-data");

        vm.prank(alice);
        uint256 id = engine.createMarket{value: 1 ether}(
            keccak256("q"),
            bytes32(0),
            anchor,
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.SINGLE_RESOLVER,
            block.timestamp + 7 days,
            block.timestamp + 14 days
        );

        assertEq(engine.marketContext(id), anchor);
    }

    // ============ mintCompleteSet / burnCompleteSet ============

    function test_mintCompleteSet_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);
        uint256 mintAmount = 0.5 ether;

        vm.expectEmit(true, true, false, true);
        emit TokensMinted(id, bob, mintAmount, mintAmount);

        vm.prank(bob);
        engine.mintCompleteSet{value: mintAmount}(id);

        assertEq(engine.yesBalances(id, bob), mintAmount);
        assertEq(engine.noBalances(id, bob), mintAmount);
        assertEq(engine.yesTotalSupply(id), mintAmount);
        assertEq(engine.noTotalSupply(id), mintAmount);

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        assertEq(m.collateralPool, 1 ether + mintAmount);
    }

    function test_burnCompleteSet_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);
        uint256 mintAmount = 0.5 ether;

        vm.prank(bob);
        engine.mintCompleteSet{value: mintAmount}(id);

        uint256 bobBalBefore = bob.balance;

        vm.expectEmit(true, true, false, true);
        emit TokensBurned(id, bob, mintAmount);

        vm.prank(bob);
        engine.burnCompleteSet(id, mintAmount);

        assertEq(engine.yesBalances(id, bob), 0);
        assertEq(engine.noBalances(id, bob), 0);
        assertApproxEqAbs(bob.balance, bobBalBefore + mintAmount, 1 wei);
    }

    function test_burnCompleteSet_revertsInsufficientYes() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        engine.mintCompleteSet{value: 0.5 ether}(id);

        // Transfer away YES tokens so YES < NO
        vm.prank(bob);
        engine.transferYes(id, charlie, 0.3 ether);

        vm.prank(bob);
        vm.expectRevert("Insufficient YES");
        engine.burnCompleteSet(id, 0.5 ether);
    }

    function test_burnCompleteSet_revertsInsufficientNo() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        engine.mintCompleteSet{value: 0.5 ether}(id);

        // Transfer away NO tokens so NO < YES
        vm.prank(bob);
        engine.transferNo(id, charlie, 0.3 ether);

        vm.prank(bob);
        vm.expectRevert("Insufficient NO");
        engine.burnCompleteSet(id, 0.5 ether);
    }

    // ============ Token Transfers ============

    function test_transferYes_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        engine.mintCompleteSet{value: 1 ether}(id);

        vm.prank(bob);
        engine.transferYes(id, charlie, 0.4 ether);

        assertEq(engine.yesBalances(id, bob), 0.6 ether);
        assertEq(engine.yesBalances(id, charlie), 0.4 ether);
    }

    function test_transferNo_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        engine.mintCompleteSet{value: 1 ether}(id);

        vm.prank(bob);
        engine.transferNo(id, charlie, 0.6 ether);

        assertEq(engine.noBalances(id, bob), 0.4 ether);
        assertEq(engine.noBalances(id, charlie), 0.6 ether);
    }

    function test_transferYes_revertsInsufficientBalance() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        vm.expectRevert("Insufficient balance");
        engine.transferYes(id, charlie, 1 ether); // bob has 0 YES
    }

    function test_approveAndTransferYesFrom() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        engine.mintCompleteSet{value: 1 ether}(id);

        // Bob approves charlie to spend 0.5 YES
        vm.prank(bob);
        engine.approveYes(id, charlie, 0.5 ether);

        // Charlie transfers from bob to dave
        vm.prank(charlie);
        engine.transferYesFrom(id, bob, dave, 0.5 ether);

        assertEq(engine.yesBalances(id, bob), 0.5 ether);
        assertEq(engine.yesBalances(id, dave), 0.5 ether);
        assertEq(engine.yesApprovals(id, bob, charlie), 0);
    }

    function test_transferYesFrom_revertsNotApproved() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        engine.mintCompleteSet{value: 1 ether}(id);

        vm.prank(charlie);
        vm.expectRevert("Not approved");
        engine.transferYesFrom(id, bob, dave, 0.5 ether);
    }

    // ============ buyShares (AMM) ============

    function test_buyShares_yes_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);
        uint256 cost = 1 ether;
        uint256 fee = (cost * engine.PROTOCOL_FEE()) / 10000;
        uint256 netAmount = cost - fee;

        vm.expectEmit(true, true, false, false);
        emit SharesBought(id, bob, true, 0, cost);

        vm.prank(bob);
        engine.buyShares{value: cost}(id, true, 0);

        uint256 yesBal = engine.yesBalances(id, bob);
        assertGt(yesBal, 0, "Bob should have YES tokens");
        // Shares = netAmount + AMM out >= netAmount
        assertGe(yesBal, netAmount);
    }

    function test_buyShares_no_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(bob);
        engine.buyShares{value: 1 ether}(id, false, 0);

        uint256 noBal = engine.noBalances(id, bob);
        assertGt(noBal, 0, "Bob should have NO tokens");
    }

    function test_buyShares_yesMovesPrice() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        uint256 yesBefore = engine.getPrice(id, true);

        vm.prank(bob);
        engine.buyShares{value: 2 ether}(id, true, 0);

        uint256 yesAfter = engine.getPrice(id, true);
        assertGt(yesAfter, yesBefore, "YES price should rise after YES buys");
    }

    function test_buyShares_noMovesPrice() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        uint256 noBefore = engine.getPrice(id, false);

        vm.prank(bob);
        engine.buyShares{value: 2 ether}(id, false, 0);

        uint256 noAfter = engine.getPrice(id, false);
        assertGt(noAfter, noBefore, "NO price should rise after NO buys");
    }

    function test_buyShares_feeAccruesToProtocol() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);
        uint256 cost = 1 ether;

        uint256 revBefore = engine.protocolRevenue();

        vm.prank(bob);
        engine.buyShares{value: cost}(id, true, 0);

        uint256 expectedFee = (cost * engine.PROTOCOL_FEE()) / 10000;
        assertEq(engine.protocolRevenue(), revBefore + expectedFee);
    }

    function test_buyShares_revertsNotOpen() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.warp(block.timestamp + 7 days);
        engine.resolveMarket(id, 1);

        vm.prank(bob);
        vm.expectRevert("Not open");
        engine.buyShares{value: 1 ether}(id, true, 0);
    }

    function test_buyShares_revertsSlippage() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(bob);
        vm.expectRevert("Slippage exceeded");
        engine.buyShares{value: 1 ether}(id, true, type(uint256).max);
    }

    function test_buyShares_totalVolumeTracked() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(bob);
        engine.buyShares{value: 1 ether}(id, true, 0);
        vm.prank(charlie);
        engine.buyShares{value: 2 ether}(id, false, 0);

        assertEq(engine.totalVolume(), 3 ether);
        VibePredictionEngine.Market memory m = engine.getMarket(id);
        assertEq(m.totalVolume, 3 ether);
    }

    // ============ getPrice ============

    function test_getPrice_startsAt50_50() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        uint256 yesPrice = engine.getPrice(id, true);
        uint256 noPrice  = engine.getPrice(id, false);

        assertEq(yesPrice, 0.5 ether);
        assertEq(noPrice, 0.5 ether);
    }

    function test_getPrice_sumToOne() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(bob);
        engine.buyShares{value: 3 ether}(id, true, 0);

        uint256 yesPrice = engine.getPrice(id, true);
        uint256 noPrice  = engine.getPrice(id, false);

        // Sum must be PRECISION (integer division may cause off-by-one rounding)
        assertApproxEqAbs(yesPrice + noPrice, engine.PRECISION(), 1, "Prices must sum to PRECISION");
    }

    // ============ resolveMarket ============

    function test_resolveMarket_singleResolver_creator() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);
        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, false, false, true);
        emit MarketResolved(id, 1, VibePredictionEngine.ResolutionMethod.SINGLE_RESOLVER);

        vm.prank(alice);
        engine.resolveMarket(id, 1);

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        assertEq(uint8(m.phase), uint8(VibePredictionEngine.MarketPhase.RESOLVED));
        assertEq(m.resolvedOutcome, 1);
        assertEq(engine.totalMarketsResolved(), 1);
    }

    function test_resolveMarket_singleResolver_owner() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);
        vm.warp(block.timestamp + 7 days);

        // Owner (this contract) can also resolve
        engine.resolveMarket(id, 2);

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        assertEq(m.resolvedOutcome, 2);
    }

    function test_resolveMarket_revertsBeforeLockTime() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert("Not locked yet");
        engine.resolveMarket(id, 1);
    }

    function test_resolveMarket_revertsInvalidOutcome() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);
        vm.warp(block.timestamp + 7 days);

        vm.prank(alice);
        vm.expectRevert("Invalid outcome");
        engine.resolveMarket(id, 0);

        vm.prank(alice);
        vm.expectRevert("Invalid outcome");
        engine.resolveMarket(id, 4);
    }

    function test_resolveMarket_revertsUnauthorizedResolver() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);
        vm.warp(block.timestamp + 7 days);

        vm.prank(bob); // bob is not creator or owner
        vm.expectRevert("Not resolver");
        engine.resolveMarket(id, 1);
    }

    // ============ claimWinnings ============

    function test_claimWinnings_yesWins() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        // Bob buys YES
        vm.prank(bob);
        engine.buyShares{value: 2 ether}(id, true, 0);

        uint256 yesBal = engine.yesBalances(id, bob);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        engine.resolveMarket(id, 1); // YES wins

        uint256 balBefore = bob.balance;

        vm.expectEmit(true, true, false, true);
        emit WinningsClaimed(id, bob, yesBal);

        vm.prank(bob);
        engine.claimWinnings(id);

        assertEq(bob.balance, balBefore + yesBal, "Should get 1 ETH per winning YES token");
        assertEq(engine.yesBalances(id, bob), 0);
    }

    function test_claimWinnings_noWins() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(bob);
        engine.buyShares{value: 2 ether}(id, false, 0);

        uint256 noBal = engine.noBalances(id, bob);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        engine.resolveMarket(id, 2); // NO wins

        uint256 balBefore = bob.balance;
        vm.prank(bob);
        engine.claimWinnings(id);

        assertEq(bob.balance, balBefore + noBal);
        assertEq(engine.noBalances(id, bob), 0);
    }

    function test_claimWinnings_voidReturnsHalf() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(bob);
        engine.mintCompleteSet{value: 2 ether}(id);
        // Bob holds 2e YES and 2e NO

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        engine.resolveMarket(id, 3); // VOID

        uint256 balBefore = bob.balance;
        vm.prank(bob);
        engine.claimWinnings(id);

        // VOID: payout = (yesTokens + noTokens) / 2 = (2e + 2e) / 2 = 2e
        assertApproxEqAbs(bob.balance - balBefore, 2 ether, 1);
    }

    function test_claimWinnings_revertsNotResolved() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        vm.expectRevert("Not resolved");
        engine.claimWinnings(id);
    }

    function test_claimWinnings_revertsAlreadyClaimed() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(bob);
        engine.buyShares{value: 1 ether}(id, true, 0);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        engine.resolveMarket(id, 1);

        vm.prank(bob);
        engine.claimWinnings(id);

        vm.prank(bob);
        vm.expectRevert("Already claimed");
        engine.claimWinnings(id);
    }

    function test_claimWinnings_revertsNoWinnings() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        // Bob buys YES but market resolves NO
        vm.prank(bob);
        engine.buyShares{value: 1 ether}(id, true, 0);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        engine.resolveMarket(id, 2); // NO wins

        vm.prank(bob);
        vm.expectRevert("No winnings");
        engine.claimWinnings(id);
    }

    // ============ CRPC Resolution ============

    function test_crpcResolution_happyPath() public {
        vm.prank(alice);
        uint256 id = engine.createMarket{value: 1 ether}(
            keccak256("crpc question"),
            bytes32(0), bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.CRPC_CONSENSUS,
            block.timestamp + 1 days,
            block.timestamp + 10 days
        );

        vm.warp(block.timestamp + 1 days);

        // Submit evidence: 2 YES, 1 NO
        vm.prank(alice);
        engine.submitResolutionEvidence(id, keccak256("ev1"), true);
        vm.prank(bob);
        engine.submitResolutionEvidence(id, keccak256("ev2"), true);
        vm.prank(charlie);
        engine.submitResolutionEvidence(id, keccak256("ev3"), false);

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        assertEq(uint8(m.phase), uint8(VibePredictionEngine.MarketPhase.RESOLVING));

        VibePredictionEngine.ResolutionRound memory r = engine.getResolution(id);
        assertEq(r.yesVotes, 2);
        assertEq(r.noVotes, 1);

        // Warp past resolution period
        vm.warp(r.deadline + 1);

        vm.expectEmit(true, false, false, true);
        emit MarketResolved(id, 1, VibePredictionEngine.ResolutionMethod.CRPC_CONSENSUS);

        engine.finalizeResolution(id);

        m = engine.getMarket(id);
        assertEq(m.resolvedOutcome, 1, "YES should win with 2 votes vs 1");
        assertEq(uint8(m.phase), uint8(VibePredictionEngine.MarketPhase.RESOLVED));
    }

    function test_crpcResolution_tieResultsInVoid() public {
        vm.prank(alice);
        uint256 id = engine.createMarket{value: 1 ether}(
            keccak256("tie question"),
            bytes32(0), bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.CRPC_CONSENSUS,
            block.timestamp + 1 days,
            block.timestamp + 10 days
        );

        vm.warp(block.timestamp + 1 days);

        // 1 YES, 1 NO — tie
        vm.prank(alice);
        engine.submitResolutionEvidence(id, keccak256("evA"), true);
        vm.prank(bob);
        engine.submitResolutionEvidence(id, keccak256("evB"), false);

        VibePredictionEngine.ResolutionRound memory r = engine.getResolution(id);
        vm.warp(r.deadline + 1);

        engine.finalizeResolution(id);

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        assertEq(m.resolvedOutcome, 3, "Tie should result in VOID");
    }

    function test_crpcResolution_revertsBeforeLock() public {
        vm.prank(alice);
        uint256 id = engine.createMarket{value: 1 ether}(
            keccak256("q"),
            bytes32(0), bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.CRPC_CONSENSUS,
            block.timestamp + 7 days,
            block.timestamp + 14 days
        );

        // Not locked yet
        vm.prank(alice);
        vm.expectRevert("Not locked");
        engine.submitResolutionEvidence(id, keccak256("ev"), true);
    }

    function test_finalizeResolution_revertsStillResolving() public {
        vm.prank(alice);
        uint256 id = engine.createMarket{value: 1 ether}(
            keccak256("q"),
            bytes32(0), bytes32(0),
            VibePredictionEngine.MarketType.BINARY,
            VibePredictionEngine.ResolutionMethod.CRPC_CONSENSUS,
            block.timestamp + 1 days,
            block.timestamp + 10 days
        );

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        engine.submitResolutionEvidence(id, keccak256("ev1"), true);

        // Deadline not passed yet
        vm.expectRevert("Still resolving");
        engine.finalizeResolution(id);
    }

    // ============ disputeResolution ============

    function test_disputeResolution_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);
        _resolveMarket(id, 1);

        vm.expectEmit(true, true, false, false);
        emit MarketDisputed(id, bob);

        vm.prank(bob);
        engine.disputeResolution{value: 0.01 ether}(id);

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        assertEq(uint8(m.phase), uint8(VibePredictionEngine.MarketPhase.DISPUTED));
    }

    function test_disputeResolution_revertsInsufficientBond() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);
        _resolveMarket(id, 1);

        vm.prank(bob);
        vm.expectRevert("Dispute bond required");
        engine.disputeResolution{value: 0.001 ether}(id);
    }

    function test_disputeResolution_revertsNotResolved() public {
        uint256 id = _createBinaryMarket(alice, 1 ether);

        vm.prank(bob);
        vm.expectRevert("Not resolved");
        engine.disputeResolution{value: 0.01 ether}(id);
    }

    // ============ Risk Pools ============

    function test_createRiskPool_happyPath() public {
        uint256 deposit = 5 ether;

        vm.expectEmit(true, true, false, true);
        emit RiskPoolCreated(1, alice, deposit);

        vm.prank(alice);
        uint256 poolId = engine.createRiskPool{value: deposit}();

        assertEq(poolId, 1);
        assertEq(engine.riskPoolCount(), 1);

        VibePredictionEngine.RiskPool memory rp = engine.getRiskPool(1);
        assertEq(rp.underwriter, alice);
        assertEq(rp.totalDeposits, deposit);
        assertEq(rp.totalExposure, 0);
        assertTrue(rp.active);
    }

    function test_createRiskPool_revertsZeroDeposit() public {
        vm.prank(alice);
        vm.expectRevert("Zero deposit");
        engine.createRiskPool{value: 0}();
    }

    function test_addToRiskPool_increasesDeposit() public {
        vm.prank(alice);
        uint256 poolId = engine.createRiskPool{value: 5 ether}();

        vm.prank(bob);
        engine.addToRiskPool{value: 3 ether}(poolId);

        VibePredictionEngine.RiskPool memory rp = engine.getRiskPool(poolId);
        assertEq(rp.totalDeposits, 8 ether);
    }

    // ============ Insurance (purchaseInsurance + isPolicyTriggerable + claimInsurance) ============

    function test_purchaseInsurance_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(charlie);
        uint256 poolId = engine.createRiskPool{value: 50 ether}();

        uint256 coverage = 1 ether;

        // Calculate expected premium: equal pools → prob = 50%
        // premium = coverage * prob * riskMultiplier / (10000 * 10000)
        // prob = noPool * 10000 / (yesPool + noPool) = 10e * 10000 / 20e = 5000
        // premium = 1e * 5000 * 1500 / (10000 * 10000)

        vm.expectEmit(true, true, true, true);
        emit InsurancePolicyCreated(1, id, bob, coverage);

        // Estimate premium via _calculatePremium equivalent
        VibePredictionEngine.Market memory m = engine.getMarket(id);
        uint256 total = m.yesPool + m.noPool;
        uint256 prob = (m.noPool * 10000) / total; // insuredOutcome=YES → YES prob
        uint256 expectedPremium = (coverage * prob * 1500) / (10000 * 10000);

        vm.prank(bob);
        uint256 policyId = engine.purchaseInsurance{value: expectedPremium + 0.1 ether}(
            id, poolId, true, coverage
        );

        assertEq(policyId, 1);

        VibePredictionEngine.InsurancePolicy memory pol = engine.getPolicy(1);
        assertEq(pol.insured, bob);
        assertEq(pol.marketId, id);
        assertEq(pol.coverageAmount, coverage);
        assertEq(pol.riskPoolId, poolId);
        assertFalse(pol.triggered);
        assertFalse(pol.paid);
        assertFalse(pol.paid);

        // Exposure tracked
        VibePredictionEngine.RiskPool memory rp = engine.getRiskPool(poolId);
        assertEq(rp.totalExposure, coverage);
    }

    function test_purchaseInsurance_revertsExceedsPoolCapacity() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(charlie);
        uint256 poolId = engine.createRiskPool{value: 1 ether}();

        // Try to insure 10 ether (10x pool = exceeds MAX_COVERAGE_RATIO of 5)
        uint256 coverage = 6 ether; // 1 ether * 5 = 5 ether max

        vm.prank(bob);
        vm.expectRevert("Exceeds pool capacity");
        engine.purchaseInsurance{value: 1 ether}(id, poolId, true, coverage);
    }

    function test_isPolicyTriggerable_trueWhenOutcomeMatches() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(charlie);
        uint256 poolId = engine.createRiskPool{value: 50 ether}();

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        uint256 total = m.yesPool + m.noPool;
        uint256 prob = (m.noPool * 10000) / total;
        uint256 premium = (1 ether * prob * 1500) / (10000 * 10000);

        // Bob insures the YES outcome
        vm.prank(bob);
        uint256 policyId = engine.purchaseInsurance{value: premium + 0.1 ether}(
            id, poolId, true, 1 ether
        );

        // Market resolves YES
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        engine.resolveMarket(id, 1);

        // Policy should be triggerable (insuredOutcome=YES, resolvedOutcome=YES)
        assertTrue(engine.isPolicyTriggerable(policyId));
    }

    function test_isPolicyTriggerable_falseWhenOutcomeMismatch() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(charlie);
        uint256 poolId = engine.createRiskPool{value: 50 ether}();

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        uint256 total = m.yesPool + m.noPool;
        uint256 prob = (m.noPool * 10000) / total;
        uint256 premium = (1 ether * prob * 1500) / (10000 * 10000);

        // Bob insures YES but market resolves NO
        vm.prank(bob);
        uint256 policyId = engine.purchaseInsurance{value: premium + 0.1 ether}(
            id, poolId, true, 1 ether
        );

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        engine.resolveMarket(id, 2); // NO wins

        assertFalse(engine.isPolicyTriggerable(policyId));
    }

    function test_isPolicyTriggerable_falseBeforeResolution() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(charlie);
        uint256 poolId = engine.createRiskPool{value: 50 ether}();

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        uint256 total = m.yesPool + m.noPool;
        uint256 prob = (m.noPool * 10000) / total;
        uint256 premium = (1 ether * prob * 1500) / (10000 * 10000);

        vm.prank(bob);
        uint256 policyId = engine.purchaseInsurance{value: premium + 0.1 ether}(
            id, poolId, true, 1 ether
        );

        // Market not yet resolved
        assertFalse(engine.isPolicyTriggerable(policyId));
    }

    // ============ claimInsurance ============

    function test_claimInsurance_revertsNotTriggered() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(charlie);
        uint256 poolId = engine.createRiskPool{value: 50 ether}();

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        uint256 total = m.yesPool + m.noPool;
        uint256 prob = (m.noPool * 10000) / total;
        uint256 premium = (1 ether * prob * 1500) / (10000 * 10000);

        vm.prank(bob);
        uint256 policyId = engine.purchaseInsurance{value: premium + 0.1 ether}(
            id, poolId, true, 1 ether
        );

        vm.prank(bob);
        vm.expectRevert("Not triggered");
        engine.claimInsurance(policyId);
    }

    function test_claimInsurance_revertsNotInsured() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(charlie);
        uint256 poolId = engine.createRiskPool{value: 50 ether}();

        VibePredictionEngine.Market memory m = engine.getMarket(id);
        uint256 total = m.yesPool + m.noPool;
        uint256 prob = (m.noPool * 10000) / total;
        uint256 premium = (1 ether * prob * 1500) / (10000 * 10000);

        vm.prank(bob);
        uint256 policyId = engine.purchaseInsurance{value: premium + 0.1 ether}(
            id, poolId, true, 1 ether
        );

        vm.prank(dave);
        vm.expectRevert("Not insured");
        engine.claimInsurance(policyId);
    }

    // ============ Admin ============

    function test_withdrawProtocolRevenue_happyPath() public {
        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.prank(bob);
        engine.buyShares{value: 1 ether}(id, true, 0);

        uint256 rev = engine.protocolRevenue();
        assertGt(rev, 0);

        uint256 ownerBefore = owner.balance;
        engine.withdrawProtocolRevenue();

        assertEq(owner.balance, ownerBefore + rev);
        assertEq(engine.protocolRevenue(), 0);
    }

    function test_withdrawProtocolRevenue_revertsNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.withdrawProtocolRevenue();
    }

    function test_authorizeAgent_onlyOwner() public {
        bytes32 agentId = keccak256("agent1");
        engine.authorizeAgent(agentId);
        assertTrue(engine.authorizedAgents(agentId));

        vm.prank(alice);
        vm.expectRevert();
        engine.authorizeAgent(keccak256("agent2"));
    }

    // ============ Fuzz Tests ============

    function testFuzz_buyShares_pricesAlwaysSumToOne(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 0.01 ether, 100 ether);

        uint256 id = _createBinaryMarket(alice, 50 ether);

        vm.deal(bob, buyAmount + 1 ether);
        vm.prank(bob);
        engine.buyShares{value: buyAmount}(id, true, 0);

        uint256 yesPrice = engine.getPrice(id, true);
        uint256 noPrice  = engine.getPrice(id, false);

        assertApproxEqAbs(yesPrice + noPrice, engine.PRECISION(), 1, "Prices must always sum to 1");
    }

    function testFuzz_mintBurn_isNeutral(uint256 amount) public {
        amount = bound(amount, 0.001 ether, 10 ether);

        uint256 id = _createBinaryMarket(alice, 10 ether);

        vm.deal(bob, amount);
        vm.prank(bob);
        engine.mintCompleteSet{value: amount}(id);

        uint256 collateralBefore = engine.getMarket(id).collateralPool;

        vm.prank(bob);
        engine.burnCompleteSet(id, amount);

        uint256 collateralAfter = engine.getMarket(id).collateralPool;
        assertEq(collateralAfter, collateralBefore - amount, "Burn should reduce collateral by exact amount");
    }
}
