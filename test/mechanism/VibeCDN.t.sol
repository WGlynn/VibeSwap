// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeCDN.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VibeCDNTest is Test {
    // ============ Re-declare events ============

    event NodeRegistered(address indexed node, uint256 stake, string endpoint);
    event NodeExited(address indexed node);
    event ContentPinned(bytes32 indexed contentHash, address indexed publisher, uint256 bounty);
    event ContentServed(bytes32 indexed contentHash, address indexed node, uint256 bytes_);
    event TranscodeRequested(uint256 indexed jobId, bytes32 sourceHash, string format);
    event TranscodeCompleted(uint256 indexed jobId, address indexed transcoder, bytes32 resultHash);

    // ============ State ============

    VibeCDN public cdn;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    uint256 constant MIN_STAKE       = 0.05 ether;
    uint256 constant NODE_BANDWIDTH  = 1000;   // 1000 Mbps
    uint256 constant NODE_STORAGE    = 500;    // 500 GB
    string  constant ENDPOINT        = "https://cdn.alice.io";

    bytes32 constant CONTENT_HASH    = keccak256("ipfs://QmContent1");
    uint256 constant CONTENT_SIZE    = 1024 * 1024; // 1 MB
    uint256 constant REPLICATION     = 2;
    uint256 constant DURATION        = 30 days;
    uint256 constant BOUNTY_PER_NODE = 0.01 ether;

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob   = makeAddr("bob");
        carol = makeAddr("carol");

        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
        vm.deal(carol, 100 ether);

        // Deploy behind UUPS proxy
        vm.prank(owner);
        VibeCDN impl = new VibeCDN();
        bytes memory initData = abi.encodeCall(VibeCDN.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        cdn = VibeCDN(payable(address(proxy)));
    }

    // ============ Helpers ============

    function _registerNode(address node) internal {
        string[] memory regions = new string[](1);
        regions[0] = "us-east";
        vm.prank(node);
        cdn.registerNode{value: MIN_STAKE}(NODE_BANDWIDTH, NODE_STORAGE, ENDPOINT, regions);
    }

    function _pinContent(address publisher) internal {
        uint256 totalBounty = BOUNTY_PER_NODE * REPLICATION;
        vm.prank(publisher);
        cdn.pinContent{value: totalBounty}(CONTENT_HASH, CONTENT_SIZE, REPLICATION, DURATION, BOUNTY_PER_NODE);
    }

    // ============ 1. Initialization ============

    function test_initialize_setsMinStake() public view {
        assertEq(cdn.minNodeStake(), MIN_STAKE);
    }

    function test_initialize_ownerIsSet() public view {
        // Owner is the deployer (owner address used vm.prank above but
        // ERC1967Proxy constructor calls initialize internally — owner is this test contract)
        // We just check it's non-zero
        assertTrue(cdn.owner() != address(0));
    }

    // ============ 2. Node Registration ============

    function test_registerNode_success() public {
        string[] memory regions = new string[](2);
        regions[0] = "us-east";
        regions[1] = "eu-west";

        vm.expectEmit(true, false, false, true);
        emit NodeRegistered(alice, MIN_STAKE, ENDPOINT);

        vm.prank(alice);
        cdn.registerNode{value: MIN_STAKE}(NODE_BANDWIDTH, NODE_STORAGE, ENDPOINT, regions);

        VibeCDN.ContentNode memory node = cdn.nodes(alice);
        assertTrue(node.active);
        assertEq(node.stake, MIN_STAKE);
        assertEq(node.bandwidth, NODE_BANDWIDTH);
        assertEq(node.storage_, NODE_STORAGE);
        assertEq(node.endpoint, ENDPOINT);
        assertEq(cdn.getNodeCount(), 1);
    }

    function test_registerNode_appendsToNodeList() public {
        _registerNode(alice);
        _registerNode(bob);

        assertEq(cdn.getNodeCount(), 2);
        assertEq(cdn.nodeList(0), alice);
        assertEq(cdn.nodeList(1), bob);
    }

    function test_registerNode_revertsOnInsufficientStake() public {
        string[] memory regions = new string[](0);
        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        cdn.registerNode{value: MIN_STAKE - 1}(NODE_BANDWIDTH, NODE_STORAGE, ENDPOINT, regions);
    }

    function test_registerNode_revertsIfAlreadyRegistered() public {
        _registerNode(alice);

        string[] memory regions = new string[](0);
        vm.prank(alice);
        vm.expectRevert("Already registered");
        cdn.registerNode{value: MIN_STAKE}(NODE_BANDWIDTH, NODE_STORAGE, ENDPOINT, regions);
    }

    // ============ 3. Node Exit ============

    function test_exitNode_refundsStake() public {
        _registerNode(alice);

        uint256 balBefore = alice.balance;

        vm.expectEmit(true, false, false, false);
        emit NodeExited(alice);

        vm.prank(alice);
        cdn.exitNode();

        assertFalse(cdn.nodes(alice).active);
        assertEq(cdn.nodes(alice).stake, 0);
        assertEq(alice.balance, balBefore + MIN_STAKE);
    }

    function test_exitNode_revertsIfNotActive() public {
        vm.prank(alice);
        vm.expectRevert("Not active");
        cdn.exitNode();
    }

    function test_exitNode_cannotExitTwice() public {
        _registerNode(alice);
        vm.prank(alice);
        cdn.exitNode();

        vm.prank(alice);
        vm.expectRevert("Not active");
        cdn.exitNode();
    }

    // ============ 4. Content Pinning ============

    function test_pinContent_success() public {
        uint256 totalBounty = BOUNTY_PER_NODE * REPLICATION;

        vm.expectEmit(true, true, false, true);
        emit ContentPinned(CONTENT_HASH, alice, totalBounty);

        vm.prank(alice);
        cdn.pinContent{value: totalBounty}(CONTENT_HASH, CONTENT_SIZE, REPLICATION, DURATION, BOUNTY_PER_NODE);

        VibeCDN.ContentPin memory pin = cdn.pins(CONTENT_HASH);
        assertTrue(pin.active);
        assertEq(pin.publisher, alice);
        assertEq(pin.size, CONTENT_SIZE);
        assertEq(pin.replicationTarget, REPLICATION);
        assertEq(pin.replicationCount, 0);
        assertEq(pin.bountyPerNode, BOUNTY_PER_NODE);
        assertGt(pin.expiresAt, block.timestamp);
        assertEq(cdn.getPinCount(), 1);
    }

    function test_pinContent_revertsOnInsufficientBounty() public {
        uint256 totalBounty = BOUNTY_PER_NODE * REPLICATION;
        vm.prank(alice);
        vm.expectRevert("Insufficient bounty");
        cdn.pinContent{value: totalBounty - 1}(CONTENT_HASH, CONTENT_SIZE, REPLICATION, DURATION, BOUNTY_PER_NODE);
    }

    // ============ 5. Claim Pin ============

    function test_claimPin_success() public {
        _registerNode(alice);
        _pinContent(bob);

        vm.prank(alice);
        cdn.claimPin(CONTENT_HASH);

        assertTrue(cdn.nodePins(CONTENT_HASH, alice));
        assertEq(cdn.pins(CONTENT_HASH).replicationCount, 1);
    }

    function test_claimPin_revertsIfNotNode() public {
        _pinContent(bob);

        vm.prank(carol);
        vm.expectRevert("Not a node");
        cdn.claimPin(CONTENT_HASH);
    }

    function test_claimPin_revertsIfAlreadyPinned() public {
        _registerNode(alice);
        _pinContent(bob);

        vm.prank(alice);
        cdn.claimPin(CONTENT_HASH);

        vm.prank(alice);
        vm.expectRevert("Already pinned");
        cdn.claimPin(CONTENT_HASH);
    }

    function test_claimPin_revertsWhenFullyReplicated() public {
        _registerNode(alice);
        _registerNode(bob);
        _registerNode(carol);
        _pinContent(alice); // replicationTarget = 2

        vm.prank(bob);
        cdn.claimPin(CONTENT_HASH);
        vm.prank(carol);
        cdn.claimPin(CONTENT_HASH);

        // fourth node address
        address dave = makeAddr("dave");
        vm.deal(dave, 10 ether);
        _registerNode(dave);

        vm.prank(dave);
        vm.expectRevert("Fully replicated");
        cdn.claimPin(CONTENT_HASH);
    }

    // ============ 6. Report Served ============

    function test_reportServed_updatesCounters() public {
        _registerNode(alice);
        _pinContent(bob);

        vm.prank(alice);
        cdn.claimPin(CONTENT_HASH);

        uint256 bytesServed = 512 * 1024;

        vm.expectEmit(true, true, false, true);
        emit ContentServed(CONTENT_HASH, alice, bytesServed);

        vm.prank(alice);
        cdn.reportServed(CONTENT_HASH, bytesServed);

        assertEq(cdn.nodes(alice).served, bytesServed);
        assertEq(cdn.totalBytesServed(), bytesServed);
    }

    function test_reportServed_revertsIfNotPinning() public {
        _registerNode(alice);
        _pinContent(bob);
        // alice hasn't claimed pin

        vm.prank(alice);
        vm.expectRevert("Not pinning");
        cdn.reportServed(CONTENT_HASH, 1024);
    }

    function test_reportServed_accumulates() public {
        _registerNode(alice);
        _pinContent(bob);
        vm.prank(alice);
        cdn.claimPin(CONTENT_HASH);

        vm.prank(alice);
        cdn.reportServed(CONTENT_HASH, 1000);
        vm.prank(alice);
        cdn.reportServed(CONTENT_HASH, 2000);

        assertEq(cdn.nodes(alice).served, 3000);
        assertEq(cdn.totalBytesServed(), 3000);
    }

    // ============ 7. Transcode Jobs ============

    function test_requestTranscode_success() public {
        bytes32 srcHash = keccak256("video.mp4");

        vm.expectEmit(true, false, false, true);
        emit TranscodeRequested(1, srcHash, "1080p");

        vm.prank(alice);
        uint256 jobId = cdn.requestTranscode{value: 0.5 ether}(srcHash, "1080p");

        assertEq(jobId, 1);
        assertEq(cdn.getJobCount(), 1);

        VibeCDN.TranscodeJob memory job = cdn.transcodeJobs(1);
        assertEq(job.requester, alice);
        assertEq(job.sourceHash, srcHash);
        assertEq(job.outputFormat, "1080p");
        assertEq(job.bounty, 0.5 ether);
        assertFalse(job.completed);
    }

    function test_requestTranscode_revertsOnZeroBounty() public {
        vm.prank(alice);
        vm.expectRevert("Need bounty");
        cdn.requestTranscode{value: 0}(keccak256("video.mp4"), "720p");
    }

    function test_submitTranscode_success() public {
        _registerNode(bob);

        vm.prank(alice);
        uint256 jobId = cdn.requestTranscode{value: 0.5 ether}(keccak256("video.mp4"), "1080p");

        bytes32 resultHash = keccak256("result.mp4");
        uint256 balBefore = bob.balance;

        vm.expectEmit(true, true, false, true);
        emit TranscodeCompleted(jobId, bob, resultHash);

        vm.prank(bob);
        cdn.submitTranscode(jobId, resultHash);

        VibeCDN.TranscodeJob memory job = cdn.transcodeJobs(jobId);
        assertTrue(job.completed);
        assertEq(job.transcoder, bob);
        assertEq(job.resultHash, resultHash);

        assertEq(bob.balance, balBefore + 0.5 ether);
        assertEq(cdn.nodes(bob).earnings, 0.5 ether);
        assertEq(cdn.totalEarnings(), 0.5 ether);
    }

    function test_submitTranscode_revertsIfNotNode() public {
        vm.prank(alice);
        cdn.requestTranscode{value: 0.5 ether}(keccak256("video.mp4"), "1080p");

        vm.prank(carol);
        vm.expectRevert("Not a node");
        cdn.submitTranscode(1, keccak256("result.mp4"));
    }

    function test_submitTranscode_revertsIfAlreadyCompleted() public {
        _registerNode(bob);
        _registerNode(carol);

        vm.prank(alice);
        cdn.requestTranscode{value: 0.5 ether}(keccak256("video.mp4"), "1080p");

        vm.prank(bob);
        cdn.submitTranscode(1, keccak256("result.mp4"));

        vm.prank(carol);
        vm.expectRevert("Already completed");
        cdn.submitTranscode(1, keccak256("other-result.mp4"));
    }

    function test_multipleJobsIncrementJobCount() public {
        _registerNode(bob);

        vm.startPrank(alice);
        cdn.requestTranscode{value: 0.1 ether}(keccak256("a.mp4"), "720p");
        cdn.requestTranscode{value: 0.1 ether}(keccak256("b.mp4"), "1080p");
        cdn.requestTranscode{value: 0.1 ether}(keccak256("c.mp4"), "4k");
        vm.stopPrank();

        assertEq(cdn.getJobCount(), 3);
    }

    // ============ 8. Fuzz ============

    function testFuzz_registerNodeWithVariousStakes(uint96 stake) public {
        vm.assume(stake >= MIN_STAKE);
        vm.deal(alice, uint256(stake));

        string[] memory regions = new string[](0);
        vm.prank(alice);
        cdn.registerNode{value: stake}(100, 50, "endpoint", regions);

        assertEq(cdn.nodes(alice).stake, stake);
        assertTrue(cdn.nodes(alice).active);
    }

    function testFuzz_pinContentWithVariousBounties(uint96 bountyPerNode) public {
        vm.assume(bountyPerNode > 0 && bountyPerNode < 10 ether);
        uint256 total = uint256(bountyPerNode) * REPLICATION;
        vm.deal(alice, total + 1 ether);

        vm.prank(alice);
        cdn.pinContent{value: total}(CONTENT_HASH, CONTENT_SIZE, REPLICATION, DURATION, bountyPerNode);

        assertEq(cdn.pins(CONTENT_HASH).bountyPerNode, bountyPerNode);
    }
}
