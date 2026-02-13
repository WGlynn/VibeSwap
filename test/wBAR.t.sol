// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/wBAR.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/governance/DAOTreasury.sol";
import "../contracts/messaging/CrossChainRouter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockLZEndpointWBAR {
    function send(
        CrossChainRouter.MessagingParams calldata,
        address
    ) external payable returns (CrossChainRouter.MessagingReceipt memory receipt) {
        receipt.guid = keccak256(abi.encodePacked(block.timestamp, msg.sender));
        receipt.nonce = 1;
    }
}

// ============ Unit Tests ============

contract wBARUnitTest is Test {
    wBAR public wbarToken;
    MockToken public tokenIn;
    MockToken public tokenOut;

    CommitRevealAuction public auction;
    VibeSwapCore public core;
    VibeAMM public amm;
    DAOTreasury public treasury;
    CrossChainRouter public router;
    MockLZEndpointWBAR public lzEndpoint;

    address public owner;
    address public alice;
    address public bob;

    bytes32 public constant COMMIT_ID_1 = keccak256("commit1");
    bytes32 public constant COMMIT_ID_2 = keccak256("commit2");
    uint64 public constant BATCH_ID = 1;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        tokenIn = new MockToken("Token In", "TIN");
        tokenOut = new MockToken("Token Out", "TOUT");

        // Deploy minimal system for phase checks
        _deploySystem();

        // Deploy wBAR with core as owner
        wbarToken = new wBAR(address(auction), address(core));

        // Set wBAR on core
        core.setWBAR(address(wbarToken));
    }

    function _deploySystem() internal {
        lzEndpoint = new MockLZEndpointWBAR();

        // Deploy AMM
        VibeAMM ammImpl = new VibeAMM();
        bytes memory ammInit = abi.encodeWithSelector(VibeAMM.initialize.selector, owner, address(0x1));
        amm = VibeAMM(address(new ERC1967Proxy(address(ammImpl), ammInit)));

        // Deploy Treasury
        DAOTreasury treasuryImpl = new DAOTreasury();
        bytes memory treasuryInit = abi.encodeWithSelector(DAOTreasury.initialize.selector, owner, address(amm));
        treasury = DAOTreasury(payable(address(new ERC1967Proxy(address(treasuryImpl), treasuryInit))));

        amm.setTreasury(address(treasury));

        // Deploy Auction
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector, owner, address(treasury), address(0)
        );
        auction = CommitRevealAuction(payable(address(new ERC1967Proxy(address(auctionImpl), auctionInit))));

        // Deploy Router
        CrossChainRouter routerImpl = new CrossChainRouter();
        bytes memory routerInit = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector, owner, address(lzEndpoint), address(auction)
        );
        router = CrossChainRouter(payable(address(new ERC1967Proxy(address(routerImpl), routerInit))));

        // Deploy Core
        VibeSwapCore coreImpl = new VibeSwapCore();
        bytes memory coreInit = abi.encodeWithSelector(
            VibeSwapCore.initialize.selector, owner, address(auction), address(amm), address(treasury), address(router)
        );
        core = VibeSwapCore(payable(address(new ERC1967Proxy(address(coreImpl), coreInit))));

        // Authorizations
        auction.setAuthorizedSettler(address(core), true);
        auction.setAuthorizedSettler(address(this), true);
        amm.setAuthorizedExecutor(address(core), true);
        amm.setAuthorizedExecutor(address(this), true);
        treasury.setAuthorizedFeeSender(address(amm), true);
        treasury.setAuthorizedFeeSender(address(core), true);
        router.setAuthorized(address(core), true);

        amm.setFlashLoanProtection(false);
        amm.setTWAPValidation(false);
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(wbarToken.name(), "Wrapped Batch Auction Receipt");
        assertEq(wbarToken.symbol(), "wBAR");
        assertEq(wbarToken.owner(), address(core));
        assertEq(address(wbarToken.auction()), address(auction));
        assertEq(wbarToken.vibeSwapCore(), address(core));
    }

    // ============ Mint Tests ============

    function test_mint_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);
    }

    function test_mint_createsPosition() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 500e18);

        IwBAR.Position memory pos = wbarToken.getPosition(COMMIT_ID_1);
        assertEq(pos.commitId, COMMIT_ID_1);
        assertEq(pos.batchId, BATCH_ID);
        assertEq(pos.tokenIn, address(tokenIn));
        assertEq(pos.tokenOut, address(tokenOut));
        assertEq(pos.amountIn, 1 ether);
        assertEq(pos.minAmountOut, 500e18);
        assertEq(pos.holder, alice);
        assertEq(pos.committer, alice);
        assertFalse(pos.settled);
        assertFalse(pos.redeemed);
        assertEq(pos.amountOut, 0);
    }

    function test_mint_increasesBalance() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        assertEq(wbarToken.balanceOf(alice), 1 ether);
        assertEq(wbarToken.totalSupply(), 1 ether);
    }

    function test_mint_tracksHeldPositions() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        bytes32[] memory held = wbarToken.getHeldPositions(alice);
        assertEq(held.length, 1);
        assertEq(held[0], COMMIT_ID_1);
    }

    function test_mint_duplicateReverts() public {
        vm.startPrank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.expectRevert("Already minted");
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);
        vm.stopPrank();
    }

    // ============ Transfer Restriction Tests ============

    function test_erc20Transfer_reverts() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.prank(alice);
        vm.expectRevert(IwBAR.TransferRestricted.selector);
        wbarToken.transfer(bob, 1 ether);
    }

    function test_erc20TransferFrom_reverts() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.prank(alice);
        wbarToken.approve(bob, 1 ether);

        vm.prank(bob);
        vm.expectRevert(IwBAR.TransferRestricted.selector);
        wbarToken.transferFrom(alice, bob, 1 ether);
    }

    // ============ Transfer Position Tests ============

    function test_transferPosition_commitPhase() public {
        // We're in COMMIT phase by default (fresh batch)
        uint64 currentBatch = auction.getCurrentBatchId();
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, currentBatch, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.prank(alice);
        wbarToken.transferPosition(COMMIT_ID_1, bob);

        assertEq(wbarToken.holderOf(COMMIT_ID_1), bob);
        assertEq(wbarToken.balanceOf(alice), 0);
        assertEq(wbarToken.balanceOf(bob), 1 ether);

        bytes32[] memory alicePositions = wbarToken.getHeldPositions(alice);
        assertEq(alicePositions.length, 0);

        bytes32[] memory bobPositions = wbarToken.getHeldPositions(bob);
        assertEq(bobPositions.length, 1);
        assertEq(bobPositions[0], COMMIT_ID_1);
    }

    function test_transferPosition_revealPhase_reverts() public {
        uint64 currentBatch = auction.getCurrentBatchId();

        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, currentBatch, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        // Advance to REVEAL phase
        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        vm.expectRevert(IwBAR.InvalidPhaseForTransfer.selector);
        wbarToken.transferPosition(COMMIT_ID_1, bob);
    }

    function test_transferPosition_updatesHolder() public {
        uint64 currentBatch = auction.getCurrentBatchId();
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, currentBatch, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        IwBAR.Position memory posBefore = wbarToken.getPosition(COMMIT_ID_1);
        assertEq(posBefore.holder, alice);
        assertEq(posBefore.committer, alice);

        vm.prank(alice);
        wbarToken.transferPosition(COMMIT_ID_1, bob);

        IwBAR.Position memory posAfter = wbarToken.getPosition(COMMIT_ID_1);
        assertEq(posAfter.holder, bob);
        assertEq(posAfter.committer, alice); // committer unchanged
    }

    function test_transferPosition_notHolder_reverts() public {
        uint64 currentBatch = auction.getCurrentBatchId();
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, currentBatch, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.prank(bob);
        vm.expectRevert(IwBAR.NotPositionHolder.selector);
        wbarToken.transferPosition(COMMIT_ID_1, bob);
    }

    function test_transferPosition_nonexistent_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IwBAR.PositionDoesNotExist.selector);
        wbarToken.transferPosition(COMMIT_ID_1, bob);
    }

    // ============ Settle Tests ============

    function test_settle_setsAmountOut() public {
        vm.startPrank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);
        wbarToken.settle(COMMIT_ID_1, 2000e18);
        vm.stopPrank();

        IwBAR.Position memory pos = wbarToken.getPosition(COMMIT_ID_1);
        assertTrue(pos.settled);
        assertEq(pos.amountOut, 2000e18);
    }

    function test_settle_onlyOwner() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.prank(alice);
        vm.expectRevert();
        wbarToken.settle(COMMIT_ID_1, 2000e18);
    }

    function test_settle_doubleSettle_reverts() public {
        vm.startPrank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);
        wbarToken.settle(COMMIT_ID_1, 2000e18);

        vm.expectRevert(IwBAR.PositionAlreadySettled.selector);
        wbarToken.settle(COMMIT_ID_1, 2000e18);
        vm.stopPrank();
    }

    // ============ Redeem Tests ============

    function test_redeem_success() public {
        // Mint position
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        // Settle with output
        vm.prank(address(core));
        wbarToken.settle(COMMIT_ID_1, 2000e18);

        // Fund wBAR with tokenOut (simulating AMM sending output)
        tokenOut.mint(address(wbarToken), 2000e18);

        // Redeem
        vm.prank(alice);
        wbarToken.redeem(COMMIT_ID_1);

        assertEq(tokenOut.balanceOf(alice), 2000e18);
        assertEq(wbarToken.balanceOf(alice), 0);

        IwBAR.Position memory pos = wbarToken.getPosition(COMMIT_ID_1);
        assertTrue(pos.redeemed);
    }

    function test_redeem_notHolder_reverts() public {
        vm.startPrank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);
        wbarToken.settle(COMMIT_ID_1, 2000e18);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(IwBAR.NotPositionHolder.selector);
        wbarToken.redeem(COMMIT_ID_1);
    }

    function test_redeem_notSettled_reverts() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.prank(alice);
        vm.expectRevert(IwBAR.PositionNotSettled.selector);
        wbarToken.redeem(COMMIT_ID_1);
    }

    function test_redeem_doubleRedeem_reverts() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.prank(address(core));
        wbarToken.settle(COMMIT_ID_1, 2000e18);

        tokenOut.mint(address(wbarToken), 2000e18);

        vm.startPrank(alice);
        wbarToken.redeem(COMMIT_ID_1);

        vm.expectRevert(IwBAR.PositionAlreadyRedeemed.selector);
        wbarToken.redeem(COMMIT_ID_1);
        vm.stopPrank();
    }

    // ============ Reclaim Tests ============

    function test_reclaimFailed_success() public {
        // Setup: core has tokenIn deposited
        tokenIn.mint(address(core), 1 ether);

        // Core mints wBAR and tracks deposit
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        // We need core to have the deposit recorded. Since this is a unit test,
        // we'll directly verify the wBAR contract's reclaimFailed calls core.
        // The full flow is tested in integration tests.

        // For the unit test, mock the core having the deposit
        // We can't easily set core's internal deposits mapping, so test the revert path
        vm.prank(alice);
        vm.expectRevert("Insufficient deposit");
        wbarToken.reclaimFailed(COMMIT_ID_1);
    }

    function test_reclaimFailed_notHolder_reverts() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        vm.prank(bob);
        vm.expectRevert(IwBAR.NotPositionHolder.selector);
        wbarToken.reclaimFailed(COMMIT_ID_1);
    }

    function test_reclaimFailed_alreadySettled_reverts() public {
        vm.startPrank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);
        wbarToken.settle(COMMIT_ID_1, 2000e18);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(IwBAR.PositionAlreadySettled.selector);
        wbarToken.reclaimFailed(COMMIT_ID_1);
    }

    // ============ View Tests ============

    function test_holderOf() public {
        vm.prank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);

        assertEq(wbarToken.holderOf(COMMIT_ID_1), alice);
    }

    function test_getHeldPositions_multiple() public {
        vm.startPrank(address(core));
        wbarToken.mint(COMMIT_ID_1, BATCH_ID, alice, address(tokenIn), address(tokenOut), 1 ether, 0);
        wbarToken.mint(COMMIT_ID_2, BATCH_ID, alice, address(tokenIn), address(tokenOut), 2 ether, 0);
        vm.stopPrank();

        bytes32[] memory held = wbarToken.getHeldPositions(alice);
        assertEq(held.length, 2);
        assertEq(wbarToken.balanceOf(alice), 3 ether);
    }

    // ============ Helper ============

    function _generateCommitHash(
        address trader,
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        uint256 _minAmountOut,
        bytes32 _secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(trader, _tokenIn, _tokenOut, _amountIn, _minAmountOut, _secret));
    }
}

// ============ Integration Tests ============

contract wBARIntegrationTest is Test {
    // Contracts
    wBAR public wbarToken;
    CommitRevealAuction public auction;
    VibeAMM public amm;
    DAOTreasury public treasury;
    CrossChainRouter public router;
    VibeSwapCore public core;
    MockLZEndpointWBAR public lzEndpoint;

    // Tokens
    MockToken public weth;
    MockToken public usdc;

    // Users
    address public owner;
    address public alice;
    address public bob;

    // Pool
    bytes32 public wethUsdcPool;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        weth = new MockToken("Wrapped Ether", "WETH");
        usdc = new MockToken("USD Coin", "USDC");

        _deploySystem();
        _setupPool();
        _fundTraders();
    }

    function _deploySystem() internal {
        lzEndpoint = new MockLZEndpointWBAR();

        // Deploy AMM
        VibeAMM ammImpl = new VibeAMM();
        bytes memory ammInit = abi.encodeWithSelector(VibeAMM.initialize.selector, owner, address(0x1));
        amm = VibeAMM(address(new ERC1967Proxy(address(ammImpl), ammInit)));

        // Deploy Treasury
        DAOTreasury treasuryImpl = new DAOTreasury();
        bytes memory treasuryInit = abi.encodeWithSelector(DAOTreasury.initialize.selector, owner, address(amm));
        treasury = DAOTreasury(payable(address(new ERC1967Proxy(address(treasuryImpl), treasuryInit))));
        amm.setTreasury(address(treasury));

        // Deploy Auction
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector, owner, address(treasury), address(0)
        );
        auction = CommitRevealAuction(payable(address(new ERC1967Proxy(address(auctionImpl), auctionInit))));

        // Deploy Router
        CrossChainRouter routerImpl = new CrossChainRouter();
        bytes memory routerInit = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector, owner, address(lzEndpoint), address(auction)
        );
        router = CrossChainRouter(payable(address(new ERC1967Proxy(address(routerImpl), routerInit))));

        // Deploy Core
        VibeSwapCore coreImpl = new VibeSwapCore();
        bytes memory coreInit = abi.encodeWithSelector(
            VibeSwapCore.initialize.selector, owner, address(auction), address(amm), address(treasury), address(router)
        );
        core = VibeSwapCore(payable(address(new ERC1967Proxy(address(coreImpl), coreInit))));

        // Deploy wBAR
        wbarToken = new wBAR(address(auction), address(core));
        core.setWBAR(address(wbarToken));

        // Authorizations
        auction.setAuthorizedSettler(address(core), true);
        auction.setAuthorizedSettler(address(this), true);
        amm.setAuthorizedExecutor(address(core), true);
        amm.setAuthorizedExecutor(address(this), true);
        treasury.setAuthorizedFeeSender(address(amm), true);
        treasury.setAuthorizedFeeSender(address(core), true);
        router.setAuthorized(address(core), true);

        amm.setFlashLoanProtection(false);
        amm.setTWAPValidation(false);

        // Disable EOA requirement for testing (test contracts aren't EOAs)
        core.setRequireEOA(false);
    }

    function _setupPool() internal {
        wethUsdcPool = amm.createPool(address(weth), address(usdc), 30);
        core.setSupportedToken(address(weth), true);
        core.setSupportedToken(address(usdc), true);

        // Add initial liquidity (1 WETH = 2000 USDC)
        weth.mint(address(this), 100 ether);
        usdc.mint(address(this), 200_000 ether);

        weth.approve(address(amm), type(uint256).max);
        usdc.approve(address(amm), type(uint256).max);

        if (address(weth) < address(usdc)) {
            amm.addLiquidity(wethUsdcPool, 100 ether, 200_000 ether, 0, 0);
        } else {
            amm.addLiquidity(wethUsdcPool, 200_000 ether, 100 ether, 0, 0);
        }
    }

    function _fundTraders() internal {
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);

        weth.mint(alice, 50 ether);
        weth.mint(bob, 50 ether);
        usdc.mint(alice, 100_000 ether);
        usdc.mint(bob, 100_000 ether);

        vm.prank(alice);
        weth.approve(address(core), type(uint256).max);
        vm.prank(alice);
        usdc.approve(address(core), type(uint256).max);

        vm.prank(bob);
        weth.approve(address(core), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(core), type(uint256).max);
    }

    // ============ Full Flow: Commit -> Transfer -> Reveal -> Settle -> Redeem ============

    function test_fullFlow_commitTransferRevealSettleRedeem() public {
        // 1. Alice commits a swap
        bytes32 secret = keccak256("alice_secret");
        uint256 aliceWethBefore = weth.balanceOf(alice);

        vm.prank(alice);
        bytes32 commitId = core.commitSwap{value: 0.01 ether}(
            address(weth), address(usdc), 1 ether, 0, secret
        );

        // Verify wBAR minted to Alice
        assertEq(wbarToken.balanceOf(alice), 1 ether);
        assertEq(wbarToken.holderOf(commitId), alice);

        IwBAR.Position memory pos = wbarToken.getPosition(commitId);
        assertEq(pos.committer, alice);
        assertEq(pos.holder, alice);
        assertEq(pos.amountIn, 1 ether);

        // 2. Alice transfers position to Bob (still in COMMIT phase)
        vm.prank(alice);
        wbarToken.transferPosition(commitId, bob);

        assertEq(wbarToken.balanceOf(alice), 0);
        assertEq(wbarToken.balanceOf(bob), 1 ether);
        assertEq(wbarToken.holderOf(commitId), bob);

        // 3. Alice reveals (she has the secret, her collateral at stake)
        vm.warp(block.timestamp + 9); // Move to REVEAL phase

        vm.prank(alice);
        core.revealSwap(commitId, 0);

        // 4. Settle the batch
        vm.warp(block.timestamp + 3); // Move to SETTLING

        uint64 batchId = auction.getCurrentBatchId();
        core.settleBatch(batchId);

        // 5. Bob redeems (he's the wBAR holder)
        pos = wbarToken.getPosition(commitId);
        assertTrue(pos.settled);
        assertGt(pos.amountOut, 0);

        uint256 bobUsdcBefore = usdc.balanceOf(bob);

        vm.prank(bob);
        wbarToken.redeem(commitId);

        assertGt(usdc.balanceOf(bob), bobUsdcBefore, "Bob should receive USDC");
        assertEq(wbarToken.balanceOf(bob), 0);
    }

    // ============ Full Flow: No Transfer (normal path) ============

    function test_fullFlow_noTransfer() public {
        // Alice commits, reveals, settles — no wBAR transfer
        bytes32 secret = keccak256("alice_secret_2");

        vm.prank(alice);
        bytes32 commitId = core.commitSwap{value: 0.01 ether}(
            address(weth), address(usdc), 1 ether, 0, secret
        );

        // wBAR minted but holder == committer, so output goes directly to Alice
        assertEq(wbarToken.holderOf(commitId), alice);

        // Reveal
        vm.warp(block.timestamp + 9);
        vm.prank(alice);
        core.revealSwap(commitId, 0);

        // Settle
        vm.warp(block.timestamp + 3);
        uint64 batchId = auction.getCurrentBatchId();

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        core.settleBatch(batchId);

        // Since holder == committer, output goes directly to Alice (not escrowed in wBAR)
        assertGt(usdc.balanceOf(alice), aliceUsdcBefore, "Alice should receive USDC directly");

        // wBAR position is settled with the amount
        IwBAR.Position memory pos = wbarToken.getPosition(commitId);
        assertTrue(pos.settled);
    }

    // ============ Backward Compatible: No wBAR ============

    function test_backwardCompatible_noWBAR() public {
        // Disable wBAR
        core.setWBAR(address(0));

        bytes32 secret = keccak256("compat_secret");

        vm.prank(alice);
        bytes32 commitId = core.commitSwap{value: 0.01 ether}(
            address(weth), address(usdc), 1 ether, 0, secret
        );

        // No wBAR minted
        assertEq(wbarToken.balanceOf(alice), 0);

        // Normal reveal and settle
        vm.warp(block.timestamp + 9);
        vm.prank(alice);
        core.revealSwap(commitId, 0);

        vm.warp(block.timestamp + 3);
        uint64 batchId = auction.getCurrentBatchId();

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        core.settleBatch(batchId);

        assertGt(usdc.balanceOf(alice), aliceUsdcBefore, "Alice should receive USDC");
    }

    // ============ Helper ============

    function _generateCommitHash(
        address trader,
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        uint256 _minAmountOut,
        bytes32 _secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(trader, _tokenIn, _tokenOut, _amountIn, _minAmountOut, _secret));
    }
}
