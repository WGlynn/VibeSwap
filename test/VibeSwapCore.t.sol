// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/interfaces/ICommitRevealAuction.sol";
import "../contracts/core/interfaces/IVibeAMM.sol";
import "../contracts/core/interfaces/IDAOTreasury.sol";
import "../contracts/core/interfaces/IwBAR.sol";
import "../contracts/libraries/SecurityLib.sol";

// ============ Mock Tokens ============

contract MockCoreERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Mock Auction ============

contract MockAuction {
    uint64 public currentBatchId = 1;
    ICommitRevealAuction.BatchPhase public currentPhase = ICommitRevealAuction.BatchPhase.COMMIT;
    uint256 public commitCount;
    bool public phaseAdvanced;
    bool public batchSettled;

    ICommitRevealAuction.RevealedOrder[] private _revealedOrders;
    uint256[] private _executionOrder;
    ICommitRevealAuction.Batch private _batch;

    function commitOrder(bytes32) external payable returns (bytes32) {
        commitCount++;
        return keccak256(abi.encodePacked("commit", commitCount));
    }

    function revealOrderCrossChain(
        bytes32, address, address, address, uint256, uint256, bytes32, uint256
    ) external payable {}

    function advancePhase() external { phaseAdvanced = true; }
    function settleBatch() external { batchSettled = true; }

    function getCurrentBatchId() external view returns (uint64) { return currentBatchId; }
    function getCurrentPhase() external view returns (ICommitRevealAuction.BatchPhase) { return currentPhase; }
    function getTimeUntilPhaseChange() external pure returns (uint256) { return 5; }

    function getRevealedOrders(uint64) external view returns (ICommitRevealAuction.RevealedOrder[] memory) {
        return _revealedOrders;
    }

    function getExecutionOrder(uint64) external view returns (uint256[] memory) {
        return _executionOrder;
    }

    function getBatch(uint64) external view returns (ICommitRevealAuction.Batch memory) {
        return _batch;
    }

    // Test helpers
    function setRevealedOrders(ICommitRevealAuction.RevealedOrder[] memory orders) external {
        delete _revealedOrders;
        for (uint256 i = 0; i < orders.length; i++) {
            _revealedOrders.push(orders[i]);
        }
    }

    function setExecutionOrder(uint256[] memory order) external {
        _executionOrder = order;
    }

    function setBatch(ICommitRevealAuction.Batch memory batch) external {
        _batch = batch;
    }

    function setBatchId(uint64 id) external { currentBatchId = id; }
}

// ============ Mock AMM ============

contract MockAMM {
    uint256 public swapOutput = 1000e18;
    bool public poolCreated;
    bytes32 public lastPoolId;

    function createPool(address token0, address token1, uint256) external returns (bytes32) {
        poolCreated = true;
        bytes32 poolId = keccak256(abi.encodePacked(token0, token1));
        lastPoolId = poolId;
        return poolId;
    }

    function executeBatchSwap(bytes32, uint64, IVibeAMM.SwapOrder[] calldata orders)
        external returns (IVibeAMM.BatchSwapResult memory result)
    {
        if (orders.length > 0) {
            result.totalTokenInSwapped = orders[0].amountIn;
            result.totalTokenOutSwapped = swapOutput;
            result.clearingPrice = 1e18;

            // Transfer output to trader
            // In real AMM, tokens come from reserves. Here we just track.
        }
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenA, tokenB));
    }

    function getPool(bytes32) external pure returns (IVibeAMM.Pool memory pool) {
        pool.token0 = address(1);
        pool.token1 = address(2);
        pool.reserve0 = 1000e18;
        pool.reserve1 = 1000e18;
        pool.feeRate = 30;
        pool.initialized = true;
    }

    function quote(bytes32, address, uint256 amountIn) external pure returns (uint256) {
        return amountIn * 99 / 100; // 1% fee simulation
    }

    function setSwapOutput(uint256 output) external { swapOutput = output; }
}

// ============ Mock Treasury ============

contract MockTreasury {
    uint256 public auctionProceeds;
    uint64 public lastBatchId;

    function receiveAuctionProceeds(uint64 batchId) external payable {
        auctionProceeds += msg.value;
        lastBatchId = batchId;
    }

    receive() external payable {}
}

// ============ Mock Router ============

contract MockRouter {
    bytes32 public lastCommitHash;
    uint32 public lastDstChainId;

    function sendCommit(uint32 dstChainId, bytes32 commitHash, bytes calldata) external payable {
        lastCommitHash = commitHash;
        lastDstChainId = dstChainId;
    }

    receive() external payable {}
}

// ============ Mock ClawbackRegistry ============

contract MockClawback {
    mapping(address => bool) public blocked;

    function isBlocked(address wallet) external view returns (bool) {
        return blocked[wallet];
    }

    function setBlocked(address wallet, bool status) external {
        blocked[wallet] = status;
    }

    function recordTransaction(address, address, uint256, address) external {}
}

// ============ Mock wBAR ============

contract MockWBAR {
    mapping(bytes32 => address) public holders;
    bytes32 public lastMintCommitId;
    bytes32 public lastSettleCommitId;
    uint256 public lastSettleAmountOut;

    function mint(bytes32 commitId, uint64, address holder, address, address, uint256, uint256) external {
        holders[commitId] = holder;
        lastMintCommitId = commitId;
    }

    function settle(bytes32 commitId, uint256 amountOut) external {
        lastSettleCommitId = commitId;
        lastSettleAmountOut = amountOut;
    }

    function holderOf(bytes32 commitId) external view returns (address) {
        return holders[commitId];
    }

    function setHolder(bytes32 commitId, address holder) external {
        holders[commitId] = holder;
    }
}

// ============ Test Contract ============

contract VibeSwapCoreTest is Test {
    VibeSwapCore public core;
    MockAuction public auction;
    MockAMM public amm;
    MockTreasury public treasury;
    MockRouter public router;
    MockClawback public clawback;
    MockWBAR public wbar;
    MockCoreERC20 public tokenA;
    MockCoreERC20 public tokenB;

    address public owner;
    address public trader;
    address public guardian;

    event SwapCommitted(bytes32 indexed commitId, address indexed trader, uint64 indexed batchId);
    event SwapRevealed(bytes32 indexed commitId, address indexed trader, address tokenIn, address tokenOut, uint256 amountIn);
    event TokenSupported(address indexed token, bool supported);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event UserBlacklisted(address indexed user, bool status);
    event ContractWhitelisted(address indexed contractAddr, bool status);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    function setUp() public {
        owner = makeAddr("owner");
        trader = makeAddr("trader");
        guardian = makeAddr("guardian");

        auction = new MockAuction();
        amm = new MockAMM();
        treasury = new MockTreasury();
        router = new MockRouter();
        clawback = new MockClawback();
        wbar = new MockWBAR();

        tokenA = new MockCoreERC20("Token A", "TKA");
        tokenB = new MockCoreERC20("Token B", "TKB");

        VibeSwapCore impl = new VibeSwapCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner,
                address(auction),
                address(amm),
                address(treasury),
                address(router)
            )
        );
        core = VibeSwapCore(payable(address(proxy)));

        // Setup: support tokens, mint to trader, approve
        vm.startPrank(owner);
        core.setSupportedToken(address(tokenA), true);
        core.setSupportedToken(address(tokenB), true);
        core.setCommitCooldown(0); // Disable cooldown for testing ease
        core.setRequireEOA(false); // Disable EOA check for testing ease (tested explicitly)
        vm.stopPrank();

        tokenA.mint(trader, 1_000_000e18);
        tokenB.mint(trader, 1_000_000e18);

        vm.prank(trader);
        tokenA.approve(address(core), type(uint256).max);
        vm.prank(trader);
        tokenB.approve(address(core), type(uint256).max);

        vm.warp(100); // Avoid timestamp-zero edge cases
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(address(core.auction()), address(auction));
        assertEq(address(core.amm()), address(amm));
        assertEq(address(core.treasury()), address(treasury));
        assertEq(address(core.router()), address(router));
        assertEq(core.maxSwapPerHour(), 100_000e18);
        assertFalse(core.requireEOA()); // Disabled in setUp (tested explicitly)
        assertEq(core.commitCooldown(), 0); // Disabled in setUp
        assertEq(core.guardian(), owner); // Guardian defaults to owner
        assertFalse(core.paused());
    }

    function test_initializeRevertsZeroAddress() public {
        VibeSwapCore impl = new VibeSwapCore();

        vm.expectRevert("Invalid owner");
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeSwapCore.initialize.selector, address(0), address(1), address(2), address(3), address(4))
        );

        vm.expectRevert("Invalid auction");
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeSwapCore.initialize.selector, owner, address(0), address(2), address(3), address(4))
        );

        vm.expectRevert("Invalid amm");
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeSwapCore.initialize.selector, owner, address(1), address(0), address(3), address(4))
        );

        vm.expectRevert("Invalid treasury");
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeSwapCore.initialize.selector, owner, address(1), address(2), address(0), address(4))
        );

        vm.expectRevert("Invalid router");
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeSwapCore.initialize.selector, owner, address(1), address(2), address(3), address(0))
        );
    }

    // ============ commitSwap ============

    function test_commitSwap_success() public {
        vm.prank(trader);
        bytes32 commitId = core.commitSwap(
            address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret")
        );

        assertTrue(commitId != bytes32(0));
        assertEq(core.deposits(trader, address(tokenA)), 100e18);
        assertEq(tokenA.balanceOf(address(core)), 100e18);
        assertEq(core.commitOwners(commitId), trader);
    }

    function test_commitSwap_emitsEvent() public {
        vm.prank(trader);
        // commitId is dynamic (from mock), check trader and batchId indexed params
        vm.expectEmit(false, true, true, true);
        emit SwapCommitted(bytes32(0), trader, 1);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret"));
    }

    function test_commitSwap_storesPendingSwap() public {
        vm.prank(trader);
        bytes32 commitId = core.commitSwap(
            address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret")
        );

        (address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes32 secret,) = core.pendingSwaps(commitId);
        assertEq(tokenIn, address(tokenA));
        assertEq(tokenOut, address(tokenB));
        assertEq(amountIn, 100e18);
        assertEq(minAmountOut, 90e18);
        assertEq(secret, keccak256("secret"));
    }

    function test_commitSwap_revertsWhenPaused() public {
        vm.prank(owner);
        core.pause();

        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.ContractPaused.selector);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret"));
    }

    function test_commitSwap_revertsUnsupportedToken() public {
        address unsupported = makeAddr("unsupported");

        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.UnsupportedToken.selector);
        core.commitSwap(unsupported, address(tokenB), 100e18, 90e18, keccak256("secret"));
    }

    function test_commitSwap_revertsZeroAmount() public {
        vm.prank(trader);
        vm.expectRevert("Zero amount");
        core.commitSwap(address(tokenA), address(tokenB), 0, 0, keccak256("secret"));
    }

    function test_commitSwap_revertsSameToken() public {
        vm.prank(trader);
        vm.expectRevert("Same token");
        core.commitSwap(address(tokenA), address(tokenA), 100e18, 90e18, keccak256("secret"));
    }

    function test_commitSwap_revertsBlacklisted() public {
        vm.prank(owner);
        core.setBlacklist(trader, true);

        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.Blacklisted.selector);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret"));
    }

    function test_commitSwap_revertsNotEOA() public {
        // Re-enable EOA check for this test
        vm.prank(owner);
        core.setRequireEOA(true);

        ContractCaller caller = new ContractCaller(core);
        tokenA.mint(address(caller), 1000e18);

        vm.expectRevert(VibeSwapCore.NotEOA.selector);
        caller.tryCommit(address(tokenA), address(tokenB), 100e18);
    }

    function test_commitSwap_allowsWhitelistedContract() public {
        // Re-enable EOA check
        vm.prank(owner);
        core.setRequireEOA(true);

        ContractCaller caller = new ContractCaller(core);
        tokenA.mint(address(caller), 1000e18);

        vm.prank(owner);
        core.setContractWhitelist(address(caller), true);

        // Should succeed now — whitelisted bypasses EOA check
        caller.tryCommit(address(tokenA), address(tokenB), 100e18);
        assertEq(core.deposits(address(caller), address(tokenA)), 100e18);
    }

    function test_commitSwap_revertsTainted() public {
        vm.prank(owner);
        core.setClawbackRegistry(address(clawback));
        clawback.setBlocked(trader, true);

        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.WalletTainted.selector);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret"));
    }

    function test_commitSwap_mintswBAR() public {
        vm.prank(owner);
        core.setWBAR(address(wbar));

        vm.prank(trader);
        bytes32 commitId = core.commitSwap(
            address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret")
        );

        assertEq(wbar.lastMintCommitId(), commitId);
        assertEq(wbar.holders(commitId), trader);
    }

    // ============ Cooldown ============

    function test_commitSwap_cooldownBlocks() public {
        vm.prank(owner);
        core.setCommitCooldown(10); // 10 second cooldown

        vm.prank(trader);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("s1"));

        // Immediately try again
        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.CommitCooldownActive.selector);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("s2"));

        // After cooldown
        vm.warp(block.timestamp + 11);
        vm.prank(trader);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("s3"));
        assertEq(core.deposits(trader, address(tokenA)), 200e18);
    }

    // ============ Rate Limiting ============

    function test_commitSwap_rateLimitExceeded() public {
        // maxSwapPerHour is 100_000e18 by default
        vm.prank(trader);
        core.commitSwap(address(tokenA), address(tokenB), 100_000e18, 0, keccak256("s1"));

        // Second commit should exceed rate limit
        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.RateLimitExceededError.selector);
        core.commitSwap(address(tokenA), address(tokenB), 1e18, 0, keccak256("s2"));
    }

    function test_rateLimit_resetsAfterWindow() public {
        vm.prank(trader);
        core.commitSwap(address(tokenA), address(tokenB), 100_000e18, 0, keccak256("s1"));

        // Advance past 1 hour window
        vm.warp(block.timestamp + 1 hours + 1);

        // Should work again
        vm.prank(trader);
        core.commitSwap(address(tokenA), address(tokenB), 50_000e18, 0, keccak256("s2"));
        assertEq(core.deposits(trader, address(tokenA)), 150_000e18);
    }

    // ============ revealSwap ============

    function test_revealSwap_success() public {
        vm.prank(trader);
        bytes32 commitId = core.commitSwap(
            address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret")
        );

        vm.prank(trader);
        core.revealSwap(commitId, 0);
    }

    function test_revealSwap_revertsNotOwner() public {
        vm.prank(trader);
        bytes32 commitId = core.commitSwap(
            address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret")
        );

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert("Not commit owner");
        core.revealSwap(commitId, 0);
    }

    function test_revealSwap_revertsInvalidCommit() public {
        vm.prank(trader);
        vm.expectRevert("Invalid commit");
        core.revealSwap(keccak256("nonexistent"), 0);
    }

    function test_revealSwap_emitsEvent() public {
        vm.prank(trader);
        bytes32 commitId = core.commitSwap(
            address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret")
        );

        vm.prank(trader);
        vm.expectEmit(true, true, false, true);
        emit SwapRevealed(commitId, trader, address(tokenA), address(tokenB), 100e18);
        core.revealSwap(commitId, 0);
    }

    // ============ settleBatch ============

    function test_settleBatch_emptyBatch() public {
        // No orders, just settle
        core.settleBatch(1);
        assertTrue(auction.phaseAdvanced());
        assertTrue(auction.batchSettled());
    }

    function test_settleBatch_wrongBatchId() public {
        vm.expectRevert("Wrong batch ID");
        core.settleBatch(999);
    }

    // ============ withdrawDeposit ============

    function test_withdrawDeposit_success() public {
        vm.prank(trader);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret"));

        uint256 balBefore = tokenA.balanceOf(trader);
        vm.prank(trader);
        core.withdrawDeposit(address(tokenA));

        assertEq(tokenA.balanceOf(trader), balBefore + 100e18);
        assertEq(core.deposits(trader, address(tokenA)), 0);
    }

    function test_withdrawDeposit_revertsNoDeposit() public {
        vm.prank(trader);
        vm.expectRevert("No deposit");
        core.withdrawDeposit(address(tokenA));
    }

    // ============ Cross-Chain ============

    function test_commitCrossChainSwap_success() public {
        vm.prank(trader);
        core.commitCrossChainSwap(
            101, // dstChainId
            address(tokenA),
            address(tokenB),
            100e18,
            90e18,
            keccak256("secret"),
            ""
        );

        assertEq(core.deposits(trader, address(tokenA)), 100e18);
        assertEq(router.lastDstChainId(), 101);
        assertTrue(router.lastCommitHash() != bytes32(0));
    }

    function test_commitCrossChainSwap_revertsBlacklisted() public {
        vm.prank(owner);
        core.setBlacklist(trader, true);

        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.Blacklisted.selector);
        core.commitCrossChainSwap(101, address(tokenA), address(tokenB), 100e18, 90e18, keccak256("s"), "");
    }

    function test_commitCrossChainSwap_revertsTainted() public {
        vm.prank(owner);
        core.setClawbackRegistry(address(clawback));
        clawback.setBlocked(trader, true);

        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.WalletTainted.selector);
        core.commitCrossChainSwap(101, address(tokenA), address(tokenB), 100e18, 90e18, keccak256("s"), "");
    }

    function test_commitCrossChainSwap_rateLimitApplies() public {
        vm.prank(trader);
        core.commitCrossChainSwap(101, address(tokenA), address(tokenB), 100_000e18, 0, keccak256("s1"), "");

        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.RateLimitExceededError.selector);
        core.commitCrossChainSwap(101, address(tokenA), address(tokenB), 1e18, 0, keccak256("s2"), "");
    }

    // ============ View Functions ============

    function test_getCurrentBatch() public view {
        (uint64 batchId, ICommitRevealAuction.BatchPhase phase, uint256 timeLeft) = core.getCurrentBatch();
        assertEq(batchId, 1);
        assertEq(uint256(phase), uint256(ICommitRevealAuction.BatchPhase.COMMIT));
        assertEq(timeLeft, 5);
    }

    function test_getQuote() public view {
        uint256 amountOut = core.getQuote(address(tokenA), address(tokenB), 100e18);
        assertEq(amountOut, 99e18); // MockAMM returns 99%
    }

    function test_getDeposit() public {
        assertEq(core.getDeposit(trader, address(tokenA)), 0);

        vm.prank(trader);
        core.commitSwap(address(tokenA), address(tokenB), 100e18, 90e18, keccak256("s"));
        assertEq(core.getDeposit(trader, address(tokenA)), 100e18);
    }

    function test_getUserRateLimit_initial() public view {
        (uint256 windowStart, uint256 usedAmount, uint256 maxAmount, uint256 remaining) = core.getUserRateLimit(trader);
        assertEq(windowStart, 0);
        assertEq(usedAmount, 0);
        assertEq(maxAmount, 100_000e18);
        assertEq(remaining, 100_000e18);
    }

    function test_getUserRateLimit_afterSwap() public {
        vm.prank(trader);
        core.commitSwap(address(tokenA), address(tokenB), 30_000e18, 0, keccak256("s"));

        (, uint256 usedAmount, uint256 maxAmount, uint256 remaining) = core.getUserRateLimit(trader);
        assertEq(usedAmount, 30_000e18);
        assertEq(maxAmount, 100_000e18);
        assertEq(remaining, 70_000e18);
    }

    // ============ Admin Functions ============

    function test_pause_unpause() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit Paused(owner);
        core.pause();
        assertTrue(core.paused());

        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit Unpaused(owner);
        core.unpause();
        assertFalse(core.paused());
    }

    function test_pause_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        core.pause();
    }

    function test_emergencyPause_byGuardian() public {
        vm.prank(owner);
        core.setGuardian(guardian);

        vm.prank(guardian);
        core.emergencyPause();
        assertTrue(core.paused());
    }

    function test_emergencyPause_byOwner() public {
        vm.prank(owner);
        core.emergencyPause();
        assertTrue(core.paused());
    }

    function test_emergencyPause_revertsUnauthorized() public {
        vm.prank(owner);
        core.setGuardian(guardian);

        vm.prank(trader);
        vm.expectRevert(VibeSwapCore.NotGuardian.selector);
        core.emergencyPause();
    }

    function test_setSupportedToken() public {
        address newToken = makeAddr("newToken");

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit TokenSupported(newToken, true);
        core.setSupportedToken(newToken, true);

        assertTrue(core.supportedTokens(newToken));
    }

    function test_setBlacklist() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit UserBlacklisted(trader, true);
        core.setBlacklist(trader, true);

        assertTrue(core.blacklisted(trader));
    }

    function test_batchBlacklist() public {
        address[] memory users = new address[](3);
        users[0] = makeAddr("u1");
        users[1] = makeAddr("u2");
        users[2] = makeAddr("u3");

        vm.prank(owner);
        core.batchBlacklist(users, true);

        for (uint256 i = 0; i < users.length; i++) {
            assertTrue(core.blacklisted(users[i]));
        }
    }

    function test_setContractWhitelist() public {
        address contractAddr = makeAddr("contractAddr");

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit ContractWhitelisted(contractAddr, true);
        core.setContractWhitelist(contractAddr, true);

        assertTrue(core.whitelistedContracts(contractAddr));
    }

    function test_setMaxSwapPerHour() public {
        vm.prank(owner);
        core.setMaxSwapPerHour(500_000e18);
        assertEq(core.maxSwapPerHour(), 500_000e18);
    }

    function test_setRequireEOA() public {
        vm.prank(owner);
        core.setRequireEOA(false);
        assertFalse(core.requireEOA());
    }

    function test_setGuardian() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit GuardianUpdated(owner, guardian);
        core.setGuardian(guardian);

        assertEq(core.guardian(), guardian);
    }

    function test_setClawbackRegistry() public {
        vm.prank(owner);
        core.setClawbackRegistry(address(clawback));
        assertEq(address(core.clawbackRegistry()), address(clawback));
    }

    function test_setWBAR() public {
        vm.prank(owner);
        core.setWBAR(address(wbar));
        assertEq(address(core.wbar()), address(wbar));
    }

    function test_updateContracts() public {
        MockAuction newAuction = new MockAuction();
        MockAMM newAmm = new MockAMM();

        vm.prank(owner);
        core.updateContracts(address(newAuction), address(newAmm), address(0), address(0));

        assertEq(address(core.auction()), address(newAuction));
        assertEq(address(core.amm()), address(newAmm));
        // Treasury and router should remain unchanged
        assertEq(address(core.treasury()), address(treasury));
        assertEq(address(core.router()), address(router));
    }

    function test_createPool() public {
        vm.prank(owner);
        bytes32 poolId = core.createPool(address(tokenA), address(tokenB), 30);

        assertTrue(amm.poolCreated());
        assertTrue(core.supportedTokens(address(tokenA)));
        assertTrue(core.supportedTokens(address(tokenB)));
        assertTrue(poolId != bytes32(0));
    }

    // ============ wBAR Integration ============

    function test_releaseFailedDeposit() public {
        // First, create a deposit
        vm.prank(trader);
        bytes32 commitId = core.commitSwap(
            address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret")
        );

        vm.prank(owner);
        core.setWBAR(address(wbar));

        address recipient = makeAddr("recipient");
        uint256 balBefore = tokenA.balanceOf(recipient);

        // wBAR calls releaseFailedDeposit
        vm.prank(address(wbar));
        core.releaseFailedDeposit(commitId, recipient, address(tokenA), 100e18);

        assertEq(tokenA.balanceOf(recipient), balBefore + 100e18);
        assertEq(core.deposits(trader, address(tokenA)), 0);
    }

    function test_releaseFailedDeposit_onlyWBAR() public {
        vm.prank(trader);
        bytes32 commitId = core.commitSwap(
            address(tokenA), address(tokenB), 100e18, 90e18, keccak256("secret")
        );

        vm.prank(owner);
        core.setWBAR(address(wbar));

        vm.prank(trader);
        vm.expectRevert("Only wBAR");
        core.releaseFailedDeposit(commitId, trader, address(tokenA), 100e18);
    }

    // ============ Admin Access Control ============

    function test_adminFunctions_onlyOwner() public {
        vm.startPrank(trader);

        vm.expectRevert();
        core.setSupportedToken(address(tokenA), false);

        vm.expectRevert();
        core.setBlacklist(trader, true);

        vm.expectRevert();
        core.setContractWhitelist(trader, true);

        vm.expectRevert();
        core.setMaxSwapPerHour(0);

        vm.expectRevert();
        core.setRequireEOA(false);

        vm.expectRevert();
        core.setGuardian(trader);

        vm.expectRevert();
        core.setClawbackRegistry(address(0));

        vm.expectRevert();
        core.setWBAR(address(0));

        vm.expectRevert();
        core.updateContracts(address(0), address(0), address(0), address(0));

        vm.stopPrank();
    }

    // ============ Receive ETH ============

    function test_receiveETH() public {
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        (bool success,) = address(core).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(core).balance, 1 ether);
    }
}

// ============ Helper: Contract Caller (for EOA check test) ============

contract ContractCaller {
    VibeSwapCore public core;

    constructor(VibeSwapCore _core) {
        core = _core;
    }

    function tryCommit(address tokenIn, address tokenOut, uint256 amount) external {
        IERC20(tokenIn).approve(address(core), amount);
        core.commitSwap(tokenIn, tokenOut, amount, 0, keccak256("secret"));
    }
}
