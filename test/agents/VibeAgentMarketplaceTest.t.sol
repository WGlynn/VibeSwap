// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeAgentMarketplace.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeAgentMarketplaceTest is Test {
    // ============ Re-declare Events ============

    event AgentRegistered(bytes32 indexed agentId, address indexed creator, string name);
    event AgentDeactivated(bytes32 indexed agentId);
    event AgentVerified(bytes32 indexed agentId);
    event TaskRequested(uint256 indexed taskId, address indexed requester, bytes32 indexed agentId, uint256 payment);
    event TaskAccepted(uint256 indexed taskId, bytes32 indexed agentId);
    event TaskCompleted(uint256 indexed taskId, bytes32 indexed agentId, uint256 agentPayout);
    event TaskDisputed(uint256 indexed taskId, address indexed requester);
    event DisputeResolved(uint256 indexed taskId, bool favorAgent);
    event AgentRated(bytes32 indexed agentId, uint256 indexed reviewId, uint256 rating);
    event PlatformWithdrawn(address indexed to, uint256 amount);

    // ============ State ============

    VibeAgentMarketplace public marketplace;
    address public owner;
    address public arbitrator;
    address public creator1;
    address public creator2;
    address public requester1;
    address public requester2;

    bytes32 public constant DESC_HASH = keccak256("agent description ipfs hash");
    bytes32 public constant TASK_HASH = keccak256("task spec ipfs hash");
    bytes32 public constant REVIEW_HASH = keccak256("review content hash");
    uint256 public constant PRICE_PER_TASK = 0.1 ether;
    uint256 public constant PRICE_PER_HOUR = 0.05 ether;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        arbitrator = makeAddr("arbitrator");
        creator1 = makeAddr("creator1");
        creator2 = makeAddr("creator2");
        requester1 = makeAddr("requester1");
        requester2 = makeAddr("requester2");

        vm.deal(creator1, 100 ether);
        vm.deal(creator2, 100 ether);
        vm.deal(requester1, 100 ether);
        vm.deal(requester2, 100 ether);
        vm.deal(arbitrator, 10 ether);

        VibeAgentMarketplace impl = new VibeAgentMarketplace();
        bytes memory initData = abi.encodeWithSelector(
            VibeAgentMarketplace.initialize.selector,
            arbitrator
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        marketplace = VibeAgentMarketplace(payable(address(proxy)));
    }

    // ============ Helpers ============

    function _registerAgent(
        address creator,
        string memory name,
        bytes32[] memory caps
    ) internal returns (bytes32 agentId) {
        vm.prank(creator);
        agentId = marketplace.registerAgent(name, DESC_HASH, caps, PRICE_PER_TASK, PRICE_PER_HOUR);
    }

    function _defaultCaps() internal pure returns (bytes32[] memory caps) {
        caps = new bytes32[](2);
        caps[0] = keccak256("trading");
        caps[1] = keccak256("analytics");
    }

    function _requestTask(
        address requester,
        bytes32 agentId,
        uint256 payment
    ) internal returns (uint256 taskId) {
        vm.prank(requester);
        taskId = marketplace.requestTask{value: payment}(agentId, TASK_HASH);
    }

    // ============ Agent Registration ============

    function test_RegisterAgent_Basic() public {
        bytes32[] memory caps = _defaultCaps();

        vm.expectEmit(false, true, false, true);
        emit AgentRegistered(bytes32(0), creator1, "TradingBot");

        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        assertNotEq(agentId, bytes32(0));

        VibeAgentMarketplace.AgentListing memory listing = marketplace.getAgent(agentId);
        assertEq(listing.creator, creator1);
        assertEq(listing.name, "TradingBot");
        assertEq(listing.descriptionHash, DESC_HASH);
        assertEq(listing.pricePerTask, PRICE_PER_TASK);
        assertEq(listing.pricePerHour, PRICE_PER_HOUR);
        assertEq(listing.capabilities.length, 2);
        assertTrue(listing.active);
        assertFalse(listing.verified);
        assertEq(listing.rating, 0);
        assertEq(listing.totalTasksCompleted, 0);
        assertEq(marketplace.totalAgents(), 1);
    }

    function test_RegisterAgent_EmptyCapabilities() public {
        bytes32[] memory caps = new bytes32[](0);
        bytes32 agentId = _registerAgent(creator1, "EmptyCapsBot", caps);
        assertNotEq(agentId, bytes32(0));
    }

    function test_RegisterAgent_RejectsOverMaxCapabilities() public {
        bytes32[] memory caps = new bytes32[](marketplace.MAX_CAPABILITIES() + 1);
        vm.prank(creator1);
        vm.expectRevert(VibeAgentMarketplace.TooManyCapabilities.selector);
        marketplace.registerAgent("Bot", DESC_HASH, caps, PRICE_PER_TASK, PRICE_PER_HOUR);
    }

    function test_RegisterAgent_MaxCapabilities() public {
        bytes32[] memory caps = new bytes32[](marketplace.MAX_CAPABILITIES());
        for (uint256 i = 0; i < caps.length; i++) {
            caps[i] = keccak256(abi.encodePacked("cap", i));
        }
        bytes32 agentId = _registerAgent(creator1, "MaxCapsBot", caps);
        assertNotEq(agentId, bytes32(0));
    }

    function test_DeactivateAgent() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        vm.expectEmit(true, false, false, false);
        emit AgentDeactivated(agentId);

        vm.prank(creator1);
        marketplace.deactivateAgent(agentId);

        assertFalse(marketplace.getAgent(agentId).active);
    }

    function test_DeactivateAgent_OnlyCreator() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        vm.prank(creator2);
        vm.expectRevert(VibeAgentMarketplace.NotAgentCreator.selector);
        marketplace.deactivateAgent(agentId);
    }

    function test_VerifyAgent_OnlyOwner() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        vm.expectEmit(true, false, false, false);
        emit AgentVerified(agentId);

        marketplace.verifyAgent(agentId);
        assertTrue(marketplace.getAgent(agentId).verified);
    }

    function test_VerifyAgent_RejectsUnknownAgent() public {
        vm.expectRevert(VibeAgentMarketplace.AgentNotFound.selector);
        marketplace.verifyAgent(keccak256("nonexistent"));
    }

    function test_VerifyAgent_Unauthorized() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        vm.prank(creator1);
        vm.expectRevert();
        marketplace.verifyAgent(agentId);
    }

    // ============ Task Lifecycle ============

    function test_RequestTask() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        vm.expectEmit(true, true, true, true);
        emit TaskRequested(0, requester1, agentId, PRICE_PER_TASK);

        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);
        assertEq(taskId, 0);

        VibeAgentMarketplace.TaskRequest memory t = marketplace.tasks(taskId);
        assertEq(t.requester, requester1);
        assertEq(t.agentId, agentId);
        assertEq(t.payment, PRICE_PER_TASK);
        assertEq(uint8(t.status), uint8(VibeAgentMarketplace.TaskStatus.PENDING));
        assertEq(t.taskHash, TASK_HASH);
    }

    function test_RequestTask_RejectsUnknownAgent() public {
        vm.prank(requester1);
        vm.expectRevert(VibeAgentMarketplace.AgentNotFound.selector);
        marketplace.requestTask{value: PRICE_PER_TASK}(keccak256("nonexistent"), TASK_HASH);
    }

    function test_RequestTask_RejectsInactiveAgent() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        vm.prank(creator1);
        marketplace.deactivateAgent(agentId);

        vm.prank(requester1);
        vm.expectRevert(VibeAgentMarketplace.AgentNotActive.selector);
        marketplace.requestTask{value: PRICE_PER_TASK}(agentId, TASK_HASH);
    }

    function test_RequestTask_RejectsInsufficientPayment() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        vm.prank(requester1);
        vm.expectRevert(VibeAgentMarketplace.InsufficientPayment.selector);
        marketplace.requestTask{value: PRICE_PER_TASK - 1}(agentId, TASK_HASH);
    }

    function test_AcceptTask() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.expectEmit(true, true, false, false);
        emit TaskAccepted(taskId, agentId);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        assertEq(uint8(marketplace.tasks(taskId).status), uint8(VibeAgentMarketplace.TaskStatus.ACTIVE));
    }

    function test_AcceptTask_RejectsNonCreator() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator2);
        vm.expectRevert(VibeAgentMarketplace.NotAgentCreator.selector);
        marketplace.acceptTask(taskId);
    }

    function test_AcceptTask_RejectsIfNotPending() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        vm.prank(creator1);
        vm.expectRevert(VibeAgentMarketplace.InvalidStatus.selector);
        marketplace.acceptTask(taskId);
    }

    function test_CompleteTask_PayoutsAgent() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        uint256 expectedPayout = PRICE_PER_TASK - (PRICE_PER_TASK * marketplace.PLATFORM_FEE_BPS()) / marketplace.BPS();
        uint256 creatorBalBefore = creator1.balance;

        vm.expectEmit(true, true, false, true);
        emit TaskCompleted(taskId, agentId, expectedPayout);

        vm.prank(creator1);
        marketplace.completeTask(taskId);

        assertEq(creator1.balance, creatorBalBefore + expectedPayout);
        assertEq(uint8(marketplace.tasks(taskId).status), uint8(VibeAgentMarketplace.TaskStatus.COMPLETED));
        assertEq(marketplace.getAgent(agentId).totalTasksCompleted, 1);
        assertEq(marketplace.getAgent(agentId).totalEarned, expectedPayout);
        assertEq(marketplace.platformBalance(), PRICE_PER_TASK - expectedPayout);
    }

    function test_CompleteTask_RejectsIfNotActive() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        // Still PENDING, not ACTIVE
        vm.prank(creator1);
        vm.expectRevert(VibeAgentMarketplace.InvalidStatus.selector);
        marketplace.completeTask(taskId);
    }

    function test_DisputeTask() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        vm.expectEmit(true, true, false, false);
        emit TaskDisputed(taskId, requester1);

        vm.prank(requester1);
        marketplace.disputeTask(taskId);

        assertEq(uint8(marketplace.tasks(taskId).status), uint8(VibeAgentMarketplace.TaskStatus.DISPUTED));
    }

    function test_DisputeTask_OnlyRequester() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        vm.prank(requester2);
        vm.expectRevert(VibeAgentMarketplace.NotRequester.selector);
        marketplace.disputeTask(taskId);
    }

    function test_ResolveDispute_FavorAgent() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        vm.prank(requester1);
        marketplace.disputeTask(taskId);

        uint256 creatorBalBefore = creator1.balance;

        vm.expectEmit(true, false, false, true);
        emit DisputeResolved(taskId, true);

        vm.prank(arbitrator);
        marketplace.resolveDispute(taskId, true);

        assertGt(creator1.balance, creatorBalBefore);
        assertEq(uint8(marketplace.tasks(taskId).status), uint8(VibeAgentMarketplace.TaskStatus.COMPLETED));
    }

    function test_ResolveDispute_FavorRequester() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        vm.prank(requester1);
        marketplace.disputeTask(taskId);

        uint256 requesterBalBefore = requester1.balance;

        vm.prank(arbitrator);
        marketplace.resolveDispute(taskId, false);

        assertEq(requester1.balance, requesterBalBefore + PRICE_PER_TASK);
    }

    function test_ResolveDispute_OnlyArbitrator() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        vm.prank(requester1);
        marketplace.disputeTask(taskId);

        vm.prank(creator1);
        vm.expectRevert(VibeAgentMarketplace.NotArbitrator.selector);
        marketplace.resolveDispute(taskId, true);
    }

    // ============ Reviews & Ratings ============

    function test_RateAgent_PostCompletion() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);
        vm.prank(creator1);
        marketplace.completeTask(taskId);

        uint256 rating = 8000;

        vm.expectEmit(true, false, false, true);
        emit AgentRated(agentId, 0, rating);

        vm.prank(requester1);
        uint256 reviewId = marketplace.rateAgent(taskId, rating, REVIEW_HASH);

        assertEq(reviewId, 0);
        assertEq(marketplace.getAgent(agentId).rating, rating);
        assertEq(marketplace.getAgent(agentId).ratingCount, 1);
    }

    function test_RateAgent_RejectsInvalidRating() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);
        vm.prank(creator1);
        marketplace.completeTask(taskId);

        vm.prank(requester1);
        vm.expectRevert(VibeAgentMarketplace.InvalidRating.selector);
        marketplace.rateAgent(taskId, marketplace.MAX_RATING() + 1, REVIEW_HASH);
    }

    function test_RateAgent_RejectsNonRequester() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);
        vm.prank(creator1);
        marketplace.completeTask(taskId);

        vm.prank(requester2);
        vm.expectRevert(VibeAgentMarketplace.NotRequester.selector);
        marketplace.rateAgent(taskId, 8000, REVIEW_HASH);
    }

    function test_RateAgent_RejectsDoubleReview() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);
        vm.prank(creator1);
        marketplace.completeTask(taskId);

        vm.prank(requester1);
        marketplace.rateAgent(taskId, 8000, REVIEW_HASH);

        vm.prank(requester1);
        vm.expectRevert(VibeAgentMarketplace.AlreadyReviewed.selector);
        marketplace.rateAgent(taskId, 5000, REVIEW_HASH);
    }

    function test_RateAgent_RejectsBeforeCompletion() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);

        // Task is ACTIVE, not COMPLETED
        vm.prank(requester1);
        vm.expectRevert(VibeAgentMarketplace.InvalidStatus.selector);
        marketplace.rateAgent(taskId, 8000, REVIEW_HASH);
    }

    // ============ Shapley Skill Matching ============

    function test_ShapleyMatch_PerfectMatch() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        // Required matches all agent capabilities in same order
        bytes32[] memory required = new bytes32[](2);
        required[0] = keccak256("trading");
        required[1] = keccak256("analytics");

        uint256 score = marketplace.shapleyMatch(agentId, required);
        assertEq(score, marketplace.BPS()); // perfect match = 10000
    }

    function test_ShapleyMatch_NoMatch() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        bytes32[] memory required = new bytes32[](2);
        required[0] = keccak256("cooking");
        required[1] = keccak256("painting");

        uint256 score = marketplace.shapleyMatch(agentId, required);
        assertEq(score, 0);
    }

    function test_ShapleyMatch_PartialMatch() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        bytes32[] memory required = new bytes32[](2);
        required[0] = keccak256("trading");
        required[1] = keccak256("cooking"); // not in caps

        uint256 score = marketplace.shapleyMatch(agentId, required);
        assertGt(score, 0);
        assertLt(score, marketplace.BPS());
    }

    function test_ShapleyMatch_UnknownAgentReturnsZero() public {
        bytes32[] memory required = _defaultCaps();
        uint256 score = marketplace.shapleyMatch(keccak256("nonexistent"), required);
        assertEq(score, 0);
    }

    function test_ShapleyMatch_EmptyRequiredReturnsZero() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        bytes32[] memory required = new bytes32[](0);
        uint256 score = marketplace.shapleyMatch(agentId, required);
        assertEq(score, 0);
    }

    // ============ Search & Discovery ============

    function test_SearchByCapability() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        bytes32[] memory results = marketplace.searchByCapability(keccak256("trading"));
        assertEq(results.length, 1);
        assertEq(results[0], agentId);
    }

    function test_SearchByCapability_MultipleAgents() public {
        bytes32[] memory caps1 = new bytes32[](1);
        caps1[0] = keccak256("trading");

        bytes32[] memory caps2 = new bytes32[](1);
        caps2[0] = keccak256("trading");

        _registerAgent(creator1, "Bot1", caps1);
        _registerAgent(creator2, "Bot2", caps2);

        bytes32[] memory results = marketplace.searchByCapability(keccak256("trading"));
        assertEq(results.length, 2);
    }

    function test_GetAgentTasks() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        _requestTask(requester1, agentId, PRICE_PER_TASK);
        _requestTask(requester2, agentId, PRICE_PER_TASK);

        uint256[] memory taskIds = marketplace.getAgentTasks(agentId);
        assertEq(taskIds.length, 2);
    }

    // ============ Admin ============

    function test_SetArbitrator() public {
        address newArbitrator = makeAddr("newArbitrator");
        marketplace.setArbitrator(newArbitrator);
        assertEq(marketplace.arbitrator(), newArbitrator);
    }

    function test_SetArbitrator_OnlyOwner() public {
        vm.prank(creator1);
        vm.expectRevert();
        marketplace.setArbitrator(creator1);
    }

    function test_WithdrawPlatformFees() public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);
        vm.prank(creator1);
        marketplace.acceptTask(taskId);
        vm.prank(creator1);
        marketplace.completeTask(taskId);

        uint256 platformFee = marketplace.platformBalance();
        assertGt(platformFee, 0);

        address recipient = makeAddr("treasury");
        uint256 balBefore = recipient.balance;

        vm.expectEmit(true, false, false, true);
        emit PlatformWithdrawn(recipient, platformFee);

        marketplace.withdrawPlatformFees(recipient);

        assertEq(recipient.balance, balBefore + platformFee);
        assertEq(marketplace.platformBalance(), 0);
    }

    function test_WithdrawPlatformFees_OnlyOwner() public {
        vm.prank(creator1);
        vm.expectRevert();
        marketplace.withdrawPlatformFees(creator1);
    }

    // ============ Fuzz ============

    function testFuzz_RequestTask_AnyPaymentAbovePrice(uint256 payment) public {
        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);

        payment = bound(payment, PRICE_PER_TASK, 10 ether);
        vm.deal(requester1, payment + 1 ether);

        vm.prank(requester1);
        uint256 taskId = marketplace.requestTask{value: payment}(agentId, TASK_HASH);

        assertEq(marketplace.tasks(taskId).payment, payment);
    }

    function testFuzz_RateAgent_RatingBounds(uint256 rating) public {
        rating = bound(rating, 0, marketplace.MAX_RATING());

        bytes32[] memory caps = _defaultCaps();
        bytes32 agentId = _registerAgent(creator1, "TradingBot", caps);
        uint256 taskId = _requestTask(requester1, agentId, PRICE_PER_TASK);

        vm.prank(creator1);
        marketplace.acceptTask(taskId);
        vm.prank(creator1);
        marketplace.completeTask(taskId);

        vm.prank(requester1);
        marketplace.rateAgent(taskId, rating, REVIEW_HASH);

        assertEq(marketplace.getAgent(agentId).rating, rating);
    }
}
