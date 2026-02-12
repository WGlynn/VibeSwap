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
            address(auction)
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
        router.sendCommit{value: 0.1 ether}(CHAIN_B, commitHash, options);

        // Verify pending commit stored (commitId includes dstEid and srcTimestamp)
        bytes32 commitId = keccak256(abi.encodePacked(
            authorized,
            commitHash,
            block.chainid,
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
        router.sendCommit{value: 0.1 ether}(99, commitHash, ""); // Non-existent chain
    }

    function test_sendCommit_unauthorized() public {
        bytes32 commitHash = keccak256("order1");

        vm.deal(treasury, 1 ether);
        vm.prank(treasury);
        vm.expectRevert(CrossChainRouter.Unauthorized.selector);
        router.sendCommit{value: 0.1 ether}(CHAIN_B, commitHash, "");
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
            dstChainId: uint32(block.chainid),
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
            dstChainId: uint32(block.chainid),
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

    function test_recoverExpiredDeposit() public {
        // Simulate receiving a commit from chain B
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: keccak256("order"),
            depositor: authorized,
            depositAmount: 1 ether,
            srcChainId: CHAIN_B,
            dstChainId: uint32(block.chainid),
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        // Receive the commit (creates bridged deposit)
        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid-expire"), message, address(0), "");

        // Compute commitId
        bytes32 commitId = keccak256(abi.encodePacked(
            commit.depositor,
            commit.commitHash,
            commit.srcChainId,
            commit.dstChainId,
            commit.srcTimestamp
        ));

        // Verify deposit exists
        assertEq(router.bridgedDeposits(commitId), 1 ether);
        assertEq(router.totalBridgedDeposits(), 1 ether);

        // Try to recover before expiry - should fail
        vm.prank(authorized);
        vm.expectRevert(CrossChainRouter.DepositNotExpired.selector);
        router.recoverExpiredDeposit(commitId);

        // Warp past expiry
        vm.warp(block.timestamp + 24 hours + 1);

        // Recover as depositor
        vm.prank(authorized);
        router.recoverExpiredDeposit(commitId);

        // Verify cleanup
        assertEq(router.bridgedDeposits(commitId), 0);
        assertEq(router.totalBridgedDeposits(), 0);
    }

    function test_recoverExpiredDeposit_onlyDepositorOrOwner() public {
        // Simulate receiving a commit
        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 1
        });

        CrossChainRouter.CrossChainCommit memory commit = CrossChainRouter.CrossChainCommit({
            commitHash: keccak256("order2"),
            depositor: authorized,
            depositAmount: 1 ether,
            srcChainId: CHAIN_B,
            dstChainId: uint32(block.chainid),
            srcTimestamp: block.timestamp
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.ORDER_COMMIT,
            abi.encode(commit)
        );

        vm.prank(address(endpoint));
        router.lzReceive(origin, keccak256("guid-auth"), message, address(0), "");

        bytes32 commitId = keccak256(abi.encodePacked(
            commit.depositor,
            commit.commitHash,
            commit.srcChainId,
            commit.dstChainId,
            commit.srcTimestamp
        ));

        // Warp past expiry
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
}
