// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/messaging/CrossChainRouter.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockLZEndpoint {
    uint64 public nonce;

    event MessageSent(uint32 dstEid, bytes32 receiver, bytes message, uint256 fee);

    function send(
        CrossChainRouter.MessagingParams memory params,
        address /*refundAddress*/
    ) external payable returns (CrossChainRouter.MessagingReceipt memory receipt) {
        nonce++;

        emit MessageSent(params.dstEid, params.receiver, params.message, msg.value);

        receipt.guid = keccak256(abi.encodePacked(nonce, params.dstEid));
        receipt.nonce = nonce;
        receipt.fee.nativeFee = msg.value;
    }
}

contract CrossChainRouterTest is Test {
    CrossChainRouter public router;
    CommitRevealAuction public auction;
    MockLZEndpoint public endpoint;

    address public owner;
    address public treasury;
    address public authorized;

    uint32 constant CHAIN_A = 1;
    uint32 constant CHAIN_B = 2;
    bytes32 constant PEER_B = bytes32(uint256(uint160(address(0xBBBB))));

    event PeerSet(uint32 indexed eid, bytes32 peer);
    event CrossChainCommitSent(bytes32 indexed commitId, uint32 indexed dstEid, address depositor);
    event CrossChainCommitReceived(bytes32 indexed commitId, uint32 indexed srcEid, address depositor);
    event BridgedCommitPendingFunding(bytes32 indexed commitId, uint256 expectedAmount);
    event BridgedDepositFunded(bytes32 indexed commitId, uint256 amount);

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        authorized = makeAddr("authorized");

        // Deploy mock endpoint
        endpoint = new MockLZEndpoint();

        // Deploy auction
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury,
            address(0) // complianceRegistry (not needed for this test)
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);
        auction = CommitRevealAuction(payable(address(auctionProxy)));

        // Deploy router
        CrossChainRouter impl = new CrossChainRouter();
        bytes memory initData = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector,
            owner,
            address(endpoint),
            address(auction),
            uint32(1)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = CrossChainRouter(payable(address(proxy)));

        // Setup authorizations
        router.setAuthorized(authorized, true);
        router.setPeer(CHAIN_B, PEER_B);
        auction.setAuthorizedSettler(address(router), true);

        // Fund accounts
        vm.deal(authorized, 10 ether);
        vm.deal(address(router), 10 ether);
    }

    // ============ Initialization Tests ============

    function test_initialization() public view {
        assertEq(router.lzEndpoint(), address(endpoint));
        assertEq(router.auction(), address(auction));
        assertEq(router.maxMessagesPerHour(), 1000);
    }

    // ============ Peer Management Tests ============

    function test_setPeer() public {
        bytes32 newPeer = bytes32(uint256(uint160(address(0xCCCC))));

        vm.expectEmit(true, false, false, true);
        emit PeerSet(3, newPeer);

        router.setPeer(3, newPeer);

        assertEq(router.peers(3), newPeer);
    }

    function test_setPeer_onlyOwner() public {
        vm.prank(authorized);
        vm.expectRevert();
        router.setPeer(3, PEER_B);
    }

    // ============ Cross-Chain Commit Tests ============

    function test_sendCommit() public {
        bytes32 commitHash = keccak256("order1");
        bytes memory options = "";

        vm.prank(authorized);
        router.sendCommit{value: 0.01 ether}(CHAIN_B, commitHash, 0.1 ether, options);

        // Verify pending commit stored (commitId uses localEid, not block.chainid)
        bytes32 commitId = keccak256(abi.encodePacked(
            authorized,
            commitHash,
            CHAIN_A,        // localEid (TRP-R22-NEW02 fix)
            CHAIN_B,        // dstEid
            block.timestamp // srcTimestamp
        ));

        // pendingCommits returns all 6 struct fields
        (bytes32 storedHash, address depositor, , , , ) =
            router.pendingCommits(commitId);

        assertEq(storedHash, commitHash);
        assertEq(depositor, authorized);
    }

    function test_sendCommit_invalidPeer() public {
        bytes32 commitHash = keccak256("order1");

        vm.prank(authorized);
        vm.expectRevert(CrossChainRouter.InvalidPeer.selector);
        router.sendCommit{value: 0.01 ether}(99, commitHash, 0.1 ether, ""); // Non-existent chain
    }

    function test_sendCommit_unauthorized() public {
        bytes32 commitHash = keccak256("order1");

        vm.deal(treasury, 1 ether);
        vm.prank(treasury);
        vm.expectRevert(CrossChainRouter.Unauthorized.selector);
        router.sendCommit{value: 0.01 ether}(CHAIN_B, commitHash, 0.1 ether, "");
    }

    // ============ Cross-Chain Reveal Tests ============

    function test_sendReveal() public {
        CrossChainRouter.CrossChainReveal memory reveal = CrossChainRouter.CrossChainReveal({
            commitId: keccak256("commit1"),
            tokenIn: address(0x1),
            tokenOut: address(0x2),
            amountIn: 1 ether,
            minAmountOut: 0.9 ether,
            secret: keccak256("secret"),
            priorityBid: 0.01 ether,
            srcChainId: CHAIN_A
        });

        vm.prank(authorized);
        router.sendReveal{value: 0.1 ether}(CHAIN_B, reveal, "");

        // Message sent (verified by endpoint mock event)
    }

    // ============ Batch Result Broadcast Tests ============

    function test_broadcastBatchResult() public {
        CrossChainRouter.BatchResult memory result = CrossChainRouter.BatchResult({
            batchId: 1,
            poolId: keccak256("pool"),
            clearingPrice: 1e18,
            filledTraders: new address[](0),
            filledAmounts: new uint256[](0)
        });

        uint32[] memory dstEids = new uint32[](1);
        dstEids[0] = CHAIN_B;

        bytes[] memory options = new bytes[](1);
        options[0] = "";

        vm.prank(authorized);
        router.broadcastBatchResult{value: 0.1 ether}(result, dstEids, options);
    }

    // ============ Liquidity Sync Tests ============

    function test_syncLiquidity() public {
        CrossChainRouter.LiquiditySync memory sync = CrossChainRouter.LiquiditySync({
            poolId: keccak256("pool"),
            reserve0: 100 ether,
            reserve1: 100 ether,
            totalLiquidity: 100 ether
        });

        uint32[] memory dstEids = new uint32[](1);
        dstEids[0] = CHAIN_B;

        bytes[] memory options = new bytes[](1);
        options[0] = "";

        vm.prank(authorized);
        router.syncLiquidity{value: 0.1 ether}(sync, dstEids, options);
    }

    // ============ Message Reception Tests ============

    function test_lzReceive_commit() public {
        // Simulate receiving a commit from chain B
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: keccak256("order"),
            depositor: authorized,
            depositAmount: 0.01 ether,
            srcChainId: CHAIN_B,
            dstChainId: CHAIN_A,  // Must match localEid
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        bytes32 guid = keccak256("guid1");

        // Call from endpoint
        vm.prank(address(endpoint));
        router.lzReceive(origin, guid, message, address(0), "");

        // Verify message processed
        assertTrue(router.isProcessed(guid));
    }

    function test_lzReceive_replayPrevention() public {
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: keccak256("order"),
            depositor: authorized,
            depositAmount: 0.01 ether,
            srcChainId: CHAIN_B,
            dstChainId: CHAIN_A,  // Must match localEid
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        bytes32 guid = keccak256("guid1");

        // First receive
        vm.prank(address(endpoint));
        router.lzReceive(origin, guid, message, address(0), "");

        // Replay attempt
        vm.prank(address(endpoint));
        vm.expectRevert(CrossChainRouter.AlreadyProcessed.selector);
        router.lzReceive(origin, guid, message, address(0), "");
    }

    function test_lzReceive_invalidPeer() public {
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: bytes32(uint256(uint160(address(0xDEAD)))), // Wrong peer
            nonce: 1
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(CrossChainRouter.CrossChainCommit({
                commitHash: keccak256("order"),
                depositor: authorized,
                depositAmount: 0.01 ether,
                srcChainId: CHAIN_B,
                dstChainId: CHAIN_A,
                srcTimestamp: block.timestamp
            }))
        );

        vm.prank(address(endpoint));
        vm.expectRevert(CrossChainRouter.InvalidPeer.selector);
        router.lzReceive(origin, keccak256("guid"), message, address(0), "");
    }

    function test_lzReceive_notEndpoint() public {
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        bytes memory message = "";

        vm.prank(authorized);
        vm.expectRevert(CrossChainRouter.NotEndpoint.selector);
        router.lzReceive(origin, keccak256("guid"), message, address(0), "");
    }

    // ============ Rate Limiting Tests ============

    function test_rateLimiting() public {
        router.setMaxMessagesPerHour(2);

        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.LIQUIDITY_SYNC,
            abi.encode(CrossChainRouter.LiquiditySync({
                poolId: keccak256("pool"),
                reserve0: 100 ether,
                reserve1: 100 ether,
                totalLiquidity: 100 ether
            }))
        );

        // First two should succeed
        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid1"), message, address(0), "");

        origin.nonce = 2;
        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid2"), message, address(0), "");

        // Third should fail
        origin.nonce = 3;
        vm.prank(address(endpoint));
        vm.expectRevert(CrossChainRouter.RateLimited.selector);
        router.lzReceive(origin, keccak256("guid3"), message, address(0), "");
    }

    function test_rateLimiting_resetsAfterHour() public {
        router.setMaxMessagesPerHour(1);

        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.LIQUIDITY_SYNC,
            abi.encode(CrossChainRouter.LiquiditySync({
                poolId: keccak256("pool"),
                reserve0: 100 ether,
                reserve1: 100 ether,
                totalLiquidity: 100 ether
            }))
        );

        // First succeeds
        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid1"), message, address(0), "");

        // Second fails
        origin.nonce = 2;
        vm.prank(address(endpoint));
        vm.expectRevert(CrossChainRouter.RateLimited.selector);
        router.lzReceive(origin, keccak256("guid2"), message, address(0), "");

        // After 1 hour, should work again
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid2"), message, address(0), "");
    }

    // ============ View Function Tests ============

    function test_quote() public view {
        CrossChainRouter.MessagingFee memory fee = router.quote(CHAIN_B, "", "");
        assertEq(fee.nativeFee, 0.01 ether);
    }

    function test_getLiquidityState() public {
        // Simulate receiving liquidity sync
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        bytes32 poolId = keccak256("pool");
        CrossChainRouter.LiquiditySync memory sync = CrossChainRouter.LiquiditySync({
            poolId: poolId,
            reserve0: 100 ether,
            reserve1: 200 ether,
            totalLiquidity: 141 ether
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.LIQUIDITY_SYNC,
            abi.encode(sync)
        );

        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid"), message, address(0), "");

        CrossChainRouter.LiquiditySync memory stored = router.getLiquidityState(poolId);
        assertEq(stored.reserve0, 100 ether);
        assertEq(stored.reserve1, 200 ether);
        assertEq(stored.totalLiquidity, 141 ether);
    }

    // ============ Admin Tests ============

    function test_setAuthorized() public {
        address newAuth = makeAddr("newAuth");

        router.setAuthorized(newAuth, true);
        assertTrue(router.authorized(newAuth));

        router.setAuthorized(newAuth, false);
        assertFalse(router.authorized(newAuth));
    }

    function test_setMaxMessagesPerHour() public {
        router.setMaxMessagesPerHour(500);
        assertEq(router.maxMessagesPerHour(), 500);
    }

    function test_setEndpoint() public {
        address newEndpoint = makeAddr("newEndpoint");
        router.setEndpoint(newEndpoint);
        assertEq(router.lzEndpoint(), newEndpoint);
    }

    function test_setAuction() public {
        address newAuction = makeAddr("newAuction");
        router.setAuction(newAuction);
        assertEq(router.auction(), newAuction);
    }

    // ============ Bridged Deposit Expiration Tests ============

    function test_bridgedDepositExpiry_default() public view {
        assertEq(router.bridgedDepositExpiry(), 24 hours);
    }

    function test_setBridgedDepositExpiry() public {
        router.setBridgedDepositExpiry(48 hours);
        assertEq(router.bridgedDepositExpiry(), 48 hours);
    }

    function test_setBridgedDepositExpiry_tooShort() public {
        vm.expectRevert("Expiry too short");
        router.setBridgedDepositExpiry(30 minutes);
    }

    // ============ NEW-04: recoverExpiredDeposit — correct chain routing ============

    /// @notice Helper: receive a commit from Chain B and return its commitId
    function _receiveCommit(
        bytes32 commitHash,
        uint256 depositAmount,
        bytes32 guid
    ) internal returns (bytes32 commitId) {
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: commitHash,
            depositor: authorized,
            depositAmount: depositAmount,
            srcChainId: CHAIN_B,
            dstChainId: CHAIN_A,
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        vm.prank(address(endpoint));
        router.lzReceive(origin, guid, message, address(0), "");

        commitId = keccak256(abi.encodePacked(
            commit.depositor,
            commit.commitHash,
            commit.srcChainId,
            commit.dstChainId,
            commit.srcTimestamp
        ));
    }

    /// @notice TRP-R34-NEW01: Commit receipt must not inflate totalBridgedDeposits
    function test_commitReceiptNoPhantomDeposits() public {
        bytes32 commitId = _receiveCommit(keccak256("order-phantom"), 1 ether, keccak256("guid-phantom"));
        assertEq(router.bridgedDeposits(commitId), 1 ether);
        assertEq(router.totalBridgedDeposits(), 0, "TRP-R34-NEW01: no phantom deposits");
    }

    /// @notice NEW-04: Unfunded commit expiry → no ETH sent to source-chain address.
    ///         Must emit CrossChainCommitExpired so depositor reclaims on source chain.
    function test_recoverExpiredDeposit_unfunded_noEthTransfer() public {
        bytes32 commitId = _receiveCommit(keccak256("order-unfunded"), 1 ether, keccak256("guid-unfunded"));

        // TRP-R34-NEW01: No phantom accounting — only bridgedDeposits mapping set
        assertEq(router.bridgedDeposits(commitId), 1 ether);
        assertEq(router.totalBridgedDeposits(), 0); // No real ETH arrived

        // Before expiry: reverts
        vm.prank(authorized);
        vm.expectRevert(CrossChainRouter.DepositNotExpired.selector);
        router.recoverExpiredDeposit(commitId);

        vm.warp(block.timestamp + 24 hours + 1);

        uint256 routerBalanceBefore = address(router).balance;

        // Depositor triggers recovery — no ETH should leave the router
        vm.prank(authorized);
        router.recoverExpiredDeposit(commitId);

        // Accounting cleaned up
        assertEq(router.bridgedDeposits(commitId), 0);
        assertEq(router.totalBridgedDeposits(), 0);

        // NEW-04: No ETH transferred to authorized (source-chain address)
        // Router balance unchanged — funds were never bridged here
        assertEq(address(router).balance, routerBalanceBefore);

        // Nothing claimable either (unfunded path doesn't escrow)
        assertEq(router.claimableDeposits(commitId), 0);
    }

    /// @notice NEW-04: Funded commit expiry → ETH escrowed in claimableDeposits, NOT sent to source-chain address.
    function test_recoverExpiredDeposit_funded_escrowed() public {
        bytes32 commitId = _receiveCommit(keccak256("order-funded"), 1 ether, keccak256("guid-funded"));

        // Manually mark as funded (simulates a scenario where ETH arrived but was not forwarded)
        // We use vm.store to set bridgedDepositFunded[commitId] = true and totalBridgedDeposits
        // For simplicity, directly call a cheatcode on the mapping slot.
        // mapping slot = keccak256(abi.encode(commitId, storageSlot))
        // bridgedDepositFunded is at slot 9 (0-indexed from state layout)
        // State order: lzEndpoint(0), auction(1), peers(2), processedMessages(3),
        //   messageCount(4), lastResetTime(5), maxMessagesPerHour(6), pendingCommits(7),
        //   liquidityState(8), bridgedDeposits(9), bridgedDepositTimestamp(10),
        //   bridgedDepositFunded(11), totalBridgedDeposits(12),
        //   bridgedDepositExpiry(14), claimableDeposits(15), authorized(16), localEid(17)
        // (Proxy adds 2 slots for OZ proxy; we store directly)
        bytes32 fundedSlot = keccak256(abi.encode(commitId, uint256(11)));
        vm.store(address(router), fundedSlot, bytes32(uint256(1)));
        // Also set totalBridgedDeposits to 1 ether (slot 13)
        vm.store(address(router), bytes32(uint256(13)), bytes32(uint256(1 ether)));
        // Ensure router has the ETH (setUp already gave it 10 ether)

        assertTrue(router.bridgedDepositFunded(commitId));
        assertEq(router.totalBridgedDeposits(), 1 ether);

        vm.warp(block.timestamp + 24 hours + 1);

        uint256 authorizedBalanceBefore = authorized.balance;
        uint256 routerBalanceBefore = address(router).balance;

        // Recovery should NOT send ETH to authorized (source-chain address)
        vm.prank(authorized);
        router.recoverExpiredDeposit(commitId);

        // NEW-04: No direct ETH transfer to the source-chain depositor address
        assertEq(authorized.balance, authorizedBalanceBefore);

        // ETH escrowed, not sent
        assertEq(router.claimableDeposits(commitId), 1 ether);
        assertEq(address(router).balance, routerBalanceBefore); // Router still holds it

        // totalBridgedDeposits decremented
        assertEq(router.totalBridgedDeposits(), 0);
    }

    /// @notice NEW-04: claimExpiredDeposit — depositor claims on dest chain with their local address.
    function test_claimExpiredDeposit_self() public {
        bytes32 commitId = _receiveCommit(keccak256("order-claim"), 1 ether, keccak256("guid-claim"));

        // Force funded state
        bytes32 fundedSlot = keccak256(abi.encode(commitId, uint256(11)));
        vm.store(address(router), fundedSlot, bytes32(uint256(1)));
        vm.store(address(router), bytes32(uint256(13)), bytes32(uint256(1 ether)));

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(authorized);
        router.recoverExpiredDeposit(commitId);
        assertEq(router.claimableDeposits(commitId), 1 ether);

        // Depositor claims using their dest-chain address (msg.sender == recipient)
        address payable destRecipient = payable(authorized);
        uint256 balBefore = destRecipient.balance;

        vm.prank(authorized);
        router.claimExpiredDeposit(commitId, destRecipient);

        assertEq(destRecipient.balance, balBefore + 1 ether);
        assertEq(router.claimableDeposits(commitId), 0);
    }

    /// @notice NEW-04: Owner can route claimable ETH to a different address (e.g., smart wallet).
    function test_claimExpiredDeposit_ownerRedirect() public {
        bytes32 commitId = _receiveCommit(keccak256("order-redirect"), 1 ether, keccak256("guid-redirect"));

        bytes32 fundedSlot = keccak256(abi.encode(commitId, uint256(11)));
        vm.store(address(router), fundedSlot, bytes32(uint256(1)));
        vm.store(address(router), bytes32(uint256(13)), bytes32(uint256(1 ether)));

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(authorized);
        router.recoverExpiredDeposit(commitId);

        address payable altAddress = payable(makeAddr("altAddress"));
        uint256 balBefore = altAddress.balance;

        // Owner redirects to altAddress
        router.claimExpiredDeposit(commitId, altAddress);

        assertEq(altAddress.balance, balBefore + 1 ether);
        assertEq(router.claimableDeposits(commitId), 0);
    }

    /// @notice NEW-04: Non-owner non-recipient cannot claim someone else's escrow.
    function test_claimExpiredDeposit_unauthorized() public {
        bytes32 commitId = _receiveCommit(keccak256("order-unauth"), 1 ether, keccak256("guid-unauth"));

        bytes32 fundedSlot = keccak256(abi.encode(commitId, uint256(11)));
        vm.store(address(router), fundedSlot, bytes32(uint256(1)));
        vm.store(address(router), bytes32(uint256(13)), bytes32(uint256(1 ether)));

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(authorized);
        router.recoverExpiredDeposit(commitId);

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert("Not authorized to claim");
        router.claimExpiredDeposit(commitId, payable(attacker));
    }

    /// @notice NEW-04: Claim fails if nothing is claimable.
    function test_claimExpiredDeposit_noDeposit() public {
        vm.expectRevert(CrossChainRouter.NoClaimableDeposit.selector);
        router.claimExpiredDeposit(keccak256("nonexistent"), payable(authorized));
    }

    function test_recoverExpiredDeposit_onlyDepositorOrOwner() public {
        bytes32 commitId = _receiveCommit(keccak256("order-auth"), 1 ether, keccak256("guid-auth2"));

        vm.warp(block.timestamp + 24 hours + 1);

        // Random address cannot recover
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert("Not authorized to recover");
        router.recoverExpiredDeposit(commitId);

        // Owner can recover
        router.recoverExpiredDeposit(commitId);
        assertEq(router.bridgedDeposits(commitId), 0);
    }

    function test_recoverExpiredDeposit_noDeposit() public {
        vm.expectRevert(CrossChainRouter.NoDepositToRecover.selector);
        router.recoverExpiredDeposit(keccak256("nonexistent"));
    }

    // ============ TRP-R34-NEW01: Phantom Bridged Deposit Tests ============

    /// @notice Core test: _handleCommit must NOT inflate totalBridgedDeposits
    /// This is the exact exploit vector from NEW-01. A cross-chain commit message
    /// arrives via LayerZero with NO ETH. If totalBridgedDeposits is incremented,
    /// the contract believes it holds funds it doesn't have (phantom deposits).
    function test_TRP_R34_NEW01_noPhantomDepositsOnCommit() public {
        uint256 totalBefore = router.totalBridgedDeposits();
        uint256 balanceBefore = address(router).balance;

        // Simulate receiving a commit from chain B (no ETH arrives with this message)
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: keccak256("phantom-test"),
            depositor: authorized,
            depositAmount: 5 ether,  // Large amount to make phantom obvious
            srcChainId: CHAIN_B,
            dstChainId: CHAIN_A,
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid-phantom"), message, address(0), "");

        // CRITICAL ASSERTION: totalBridgedDeposits must NOT increase
        assertEq(
            router.totalBridgedDeposits(),
            totalBefore,
            "TRP-R34-NEW01: totalBridgedDeposits must not increase on commit receipt"
        );

        // The contract balance should also be unchanged (no ETH arrived)
        assertEq(
            address(router).balance,
            balanceBefore,
            "No ETH should arrive with a LayerZero message"
        );

        // But the pending deposit record should exist
        bytes32 commitId = keccak256(abi.encodePacked(
            commit.depositor,
            commit.commitHash,
            commit.srcChainId,
            commit.dstChainId,
            commit.srcTimestamp
        ));
        assertEq(router.bridgedDeposits(commitId), 5 ether, "Pending deposit should be recorded");
        assertFalse(router.bridgedDepositFunded(commitId), "Should not be marked as funded");
    }

    /// @notice Multiple commits should not inflate totalBridgedDeposits
    function test_TRP_R34_NEW01_multipleCommitsNoInflation() public {
        uint256 ts = block.timestamp;

        for (uint256 i = 0; i < 5; i++) {
            CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
                srcEid: CHAIN_B,
                sender: PEER_B,
                nonce: uint64(i + 1)
            });

            CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
                commitHash: keccak256(abi.encodePacked("order", i)),
                depositor: authorized,
                depositAmount: 1 ether,
                srcChainId: CHAIN_B,
                dstChainId: CHAIN_A,
                srcTimestamp: ts + i  // Different timestamps for unique commitIds
            });

            bytes memory message = abi.encode(
                CrossChainRouter.MessageType.ORDER_COMMIT,
                abi.encode(commit)
            );

            vm.prank(address(endpoint));
            router.lzReceive(
                origin,
                keccak256(abi.encodePacked("guid-multi", i)),
                message,
                address(0),
                ""
            );
        }

        // 5 commits of 1 ETH each — totalBridgedDeposits must remain 0
        assertEq(
            router.totalBridgedDeposits(),
            0,
            "TRP-R34-NEW01: 5 phantom commits must not inflate totalBridgedDeposits"
        );
    }

    /// @notice Emergency withdraw must not be blocked by phantom deposits
    /// Old bug: phantom totalBridgedDeposits reduced surplus, locking real ETH
    function test_TRP_R34_NEW01_emergencyWithdrawNotBlockedByPhantom() public {
        // Router has 10 ETH from setUp
        uint256 routerBalance = address(router).balance;
        assertEq(routerBalance, 10 ether);

        // Receive a commit for 5 ETH (no actual ETH arrives)
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: keccak256("emergency-test"),
            depositor: authorized,
            depositAmount: 5 ether,
            srcChainId: CHAIN_B,
            dstChainId: CHAIN_A,
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid-emergency"), message, address(0), "");

        // With the fix, totalBridgedDeposits is 0, so all 10 ETH is surplus
        // Old bug: totalBridgedDeposits would be 5 ETH, making only 5 ETH withdrawable
        address recipient = makeAddr("recipient");
        uint256 recipientBefore = recipient.balance;

        router.emergencyWithdrawETH(recipient);

        // All 10 ETH should be withdrawable — no phantom protection
        assertEq(
            recipient.balance - recipientBefore,
            10 ether,
            "TRP-R34-NEW01: Full balance should be withdrawable, no phantom protection"
        );
    }

    /// @notice fundBridgedDeposit should work correctly without totalBridgedDeposits manipulation
    function test_TRP_R34_NEW01_fundBridgedDeposit_correctFlow() public {
        // Step 1: Receive cross-chain commit
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: keccak256("fund-test"),
            depositor: authorized,
            depositAmount: 1 ether,
            srcChainId: CHAIN_B,
            dstChainId: CHAIN_A,
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid-fund"), message, address(0), "");

        bytes32 commitId = keccak256(abi.encodePacked(
            commit.depositor,
            commit.commitHash,
            commit.srcChainId,
            commit.dstChainId,
            commit.srcTimestamp
        ));

        // Step 2: Verify state before funding
        assertEq(router.totalBridgedDeposits(), 0, "No phantom deposits");
        assertEq(router.bridgedDeposits(commitId), 1 ether, "Pending deposit recorded");
        assertFalse(router.bridgedDepositFunded(commitId), "Not yet funded");

        // Step 3: Fund with real ETH
        vm.prank(authorized);
        router.fundBridgedDeposit{value: 1 ether}(commitId);

        // Step 4: Verify state after funding
        assertEq(router.totalBridgedDeposits(), 0, "No deposits held after forwarding to auction");
        assertEq(router.bridgedDeposits(commitId), 0, "Pending deposit cleared");
        assertTrue(router.bridgedDepositFunded(commitId), "Marked as funded");
    }

    /// @notice Double-funding must be prevented
    function test_TRP_R34_NEW01_doubleFundingPrevented() public {
        // Receive commit
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: keccak256("double-fund"),
            depositor: authorized,
            depositAmount: 1 ether,
            srcChainId: CHAIN_B,
            dstChainId: CHAIN_A,
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid-double"), message, address(0), "");

        bytes32 commitId = keccak256(abi.encodePacked(
            commit.depositor,
            commit.commitHash,
            commit.srcChainId,
            commit.dstChainId,
            commit.srcTimestamp
        ));

        // Fund once — should succeed
        vm.prank(authorized);
        router.fundBridgedDeposit{value: 1 ether}(commitId);

        // Fund again — should fail (pendingCommits deleted after first funding)
        vm.prank(authorized);
        vm.expectRevert("Unknown commit");
        router.fundBridgedDeposit{value: 1 ether}(commitId);
    }
}
