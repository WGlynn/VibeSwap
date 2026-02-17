// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/messaging/CrossChainRouter.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockCCREndpoint {
    uint64 public nonce;

    function send(
        CrossChainRouter.MessagingParams memory,
        address
    ) external payable returns (CrossChainRouter.MessagingReceipt memory receipt) {
        nonce++;
        receipt.guid = keccak256(abi.encodePacked(nonce, block.timestamp));
        receipt.nonce = nonce;
        receipt.fee.nativeFee = msg.value;
    }
}

// ============ Fuzz Tests ============

contract CrossChainRouterFuzzTest is Test {
    CrossChainRouter public router;
    CommitRevealAuction public auction;
    MockCCREndpoint public endpoint;

    address public owner;
    address public authorized;

    uint32 constant CHAIN_B = 2;
    bytes32 constant PEER_B = bytes32(uint256(uint160(address(0xBBBB))));

    function setUp() public {
        owner = address(this);
        authorized = makeAddr("authorized");

        endpoint = new MockCCREndpoint();

        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            makeAddr("treasury"),
            address(0)
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);
        auction = CommitRevealAuction(payable(address(auctionProxy)));

        CrossChainRouter impl = new CrossChainRouter();
        bytes memory initData = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector,
            owner,
            address(endpoint),
            address(auction)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = CrossChainRouter(payable(address(proxy)));

        router.setAuthorized(authorized, true);
        router.setPeer(CHAIN_B, PEER_B);

        vm.deal(authorized, 100 ether);
        vm.deal(address(router), 100 ether);
    }

    // ============ Fuzz: rate limit resets per hour ============

    function testFuzz_rateLimitResetsPerHour(uint256 numMessages, uint256 timeDelta) public {
        numMessages = bound(numMessages, 1, 50);
        timeDelta = bound(timeDelta, 1 hours, 10 hours);

        // Send messages in first hour window
        for (uint256 i = 0; i < numMessages; i++) {
            _simulateReceive(keccak256(abi.encode("msg", i)));
        }

        assertEq(router.messageCount(CHAIN_B), numMessages, "Message count must match");

        // Advance past hour boundary
        vm.warp(block.timestamp + timeDelta);

        // Next message should reset counter
        _simulateReceive(keccak256(abi.encode("msg_after_reset")));
        assertEq(router.messageCount(CHAIN_B), 1, "Counter must reset after hour boundary");
    }

    // ============ Fuzz: replay prevention ============

    function testFuzz_replayPrevention(bytes32 guid) public {
        vm.assume(guid != bytes32(0));

        _simulateReceiveWithGuid(guid);
        assertTrue(router.isProcessed(guid), "GUID must be marked processed");

        // Replay same GUID should revert
        vm.expectRevert(CrossChainRouter.AlreadyProcessed.selector);
        _simulateReceiveWithGuid(guid);
    }

    // ============ Fuzz: unauthorized caller reverts ============

    function testFuzz_unauthorizedSendReverts(address caller) public {
        vm.assume(caller != authorized);
        vm.assume(caller != owner);
        vm.deal(caller, 1 ether);

        vm.prank(caller);
        vm.expectRevert(CrossChainRouter.Unauthorized.selector);
        router.sendCommit{value: 0.1 ether}(
            CHAIN_B,
            keccak256("commit"),
            bytes("")
        );
    }

    // ============ Fuzz: no peer reverts ============

    function testFuzz_noPeerReverts(uint32 chainId) public {
        vm.assume(chainId != CHAIN_B);
        vm.assume(chainId != 0);

        vm.prank(authorized);
        vm.expectRevert(CrossChainRouter.InvalidPeer.selector);
        router.sendCommit{value: 0.1 ether}(
            chainId,
            keccak256("commit"),
            bytes("")
        );
    }

    // ============ Fuzz: maxMessagesPerHour enforced ============

    function testFuzz_rateLimitEnforced(uint256 maxMessages) public {
        maxMessages = bound(maxMessages, 1, 20);

        router.setMaxMessagesPerHour(maxMessages);

        // Fill up to max
        for (uint256 i = 0; i < maxMessages; i++) {
            _simulateReceive(keccak256(abi.encode("fill", i)));
        }

        // Next one should be rate limited
        vm.expectRevert(CrossChainRouter.RateLimited.selector);
        _simulateReceive(keccak256(abi.encode("overflow")));
    }

    // ============ Fuzz: bridged deposit expiry bounded ============

    function testFuzz_bridgedDepositExpiryBounded(uint256 expiry) public {
        if (expiry < 1 hours) {
            vm.expectRevert("Expiry too short");
            router.setBridgedDepositExpiry(expiry);
        } else {
            router.setBridgedDepositExpiry(expiry);
            assertEq(router.bridgedDepositExpiry(), expiry, "Expiry must be set");
        }
    }

    // ============ Helpers ============

    function _simulateReceive(bytes32 guid) internal {
        _simulateReceiveWithGuid(guid);
    }

    function _simulateReceiveWithGuid(bytes32 guid) internal {
        CrossChainRouter.LiquiditySync memory sync = CrossChainRouter.LiquiditySync({
            poolId: keccak256("pool"),
            reserve0: 100 ether,
            reserve1: 100 ether,
            totalLiquidity: 200 ether
        });

        bytes memory message = abi.encode(
            CrossChainRouter.MessageType.LIQUIDITY_SYNC,
            abi.encode(sync)
        );

        CrossChainRouter.Origin memory origin = CrossChainRouter.Origin({
            srcEid: CHAIN_B,
            sender: PEER_B,
            nonce: 0
        });

        vm.prank(address(endpoint));
        router.lzReceive(origin, guid, message, address(0), bytes(""));
    }
}
