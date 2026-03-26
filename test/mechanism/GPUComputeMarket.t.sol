// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/GPUComputeMarket.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {
        _mint(msg.sender, 100_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Test Contract ============

contract GPUComputeMarketTest is Test {
    // ============ Events ============

    event ProviderRegistered(address indexed provider, uint256 stake, uint256 vramGB, uint256 tflops, uint256 pricePerHour);
    event ProviderUpdated(address indexed provider, uint256 pricePerHour, bool available);
    event UnstakeRequested(address indexed provider, uint256 cooldownEnds);
    event ProviderUnregistered(address indexed provider, uint256 stakeReturned);
    event JobPosted(bytes32 indexed jobId, address indexed requester, uint256 budget, uint256 minVRAM, uint256 minTFLOPS);
    event JobAccepted(bytes32 indexed jobId, address indexed provider);
    event ResultSubmitted(bytes32 indexed jobId, bytes32 resultHash, uint256 challengeDeadline);
    event JobChallenged(bytes32 indexed jobId, address indexed challenger);
    event JobFinalized(bytes32 indexed jobId, uint256 providerPayment, uint256 protocolFee, uint256 insuranceFee);
    event JobCancelled(bytes32 indexed jobId, uint256 refund);
    event ProviderSlashed(address indexed provider, uint256 amount, bytes32 indexed jobId);

    // ============ State ============

    GPUComputeMarket public market;
    MockVIBE public vibe;

    address public owner;
    address public treasury;
    address public insurance;
    address public providerAddr;
    address public requester;

    uint256 constant MIN_STAKE     = 1000 ether; // matches contract constant
    uint256 constant VRAM_GB       = 24;
    uint256 constant TFLOPS        = 1250;        // 12.50 TFLOPS * 100
    uint256 constant PRICE_PER_HR  = 10 ether;
    uint256 constant JOB_BUDGET    = 100 ether;
    uint256 constant MAX_HOURS     = 10;

    bytes32 constant INPUT_HASH    = keccak256("input-data");
    bytes32 constant RESULT_HASH   = keccak256("result-data");

    // ============ setUp ============

    function setUp() public {
        owner        = makeAddr("owner");
        treasury     = makeAddr("treasury");
        insurance    = makeAddr("insurance");
        providerAddr = makeAddr("provider");
        requester    = makeAddr("requester");

        vibe = new MockVIBE();

        GPUComputeMarket impl = new GPUComputeMarket();
        bytes memory initData = abi.encodeCall(
            GPUComputeMarket.initialize,
            (address(vibe), treasury, insurance, owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        market = GPUComputeMarket(address(proxy));

        // Fund accounts with VIBE
        vibe.mint(providerAddr, 100_000 ether);
        vibe.mint(requester,    100_000 ether);

        vm.prank(providerAddr);
        vibe.approve(address(market), type(uint256).max);
        vm.prank(requester);
        vibe.approve(address(market), type(uint256).max);
    }

    // ============ Helpers ============

    /// @dev Register providerAddr with default specs (VIBE stake, no ETH)
    function _registerProvider() internal {
        vm.prank(providerAddr);
        market.registerProvider(VRAM_GB, TFLOPS, PRICE_PER_HR);
    }

    /// @dev Post a job from requester with JOB_BUDGET
    /// postJob requires msg.value == budget AND vibeToken.safeTransferFrom(budget)
    function _postJob() internal returns (bytes32 jobId) {
        vm.deal(requester, JOB_BUDGET);
        vm.prank(requester);
        jobId = market.postJob{value: JOB_BUDGET}(
            VRAM_GB,
            TFLOPS,
            MAX_HOURS,
            INPUT_HASH
        );
    }

    // ============ Provider Registration ============

    function test_registerProvider_vibeStake() public {
        uint256 balBefore = vibe.balanceOf(providerAddr);

        vm.expectEmit(true, false, false, true);
        emit ProviderRegistered(providerAddr, MIN_STAKE, VRAM_GB, TFLOPS, PRICE_PER_HR);

        _registerProvider();

        (
            address p,
            uint256 stake,
            uint256 vram,
            uint256 tflops,
            uint256 price,
            uint256 rep,
            , , bool avail, bool active
        ) = market.providers(providerAddr);

        assertEq(p, providerAddr);
        assertEq(stake, MIN_STAKE);
        assertEq(vram, VRAM_GB);
        assertEq(tflops, TFLOPS);
        assertEq(price, PRICE_PER_HR);
        assertEq(rep, market.INITIAL_REPUTATION());
        assertTrue(avail);
        assertTrue(active);
        assertEq(vibe.balanceOf(providerAddr), balBefore - MIN_STAKE);
        assertEq(market.providerCount(), 1);
    }

    function test_registerProvider_revertsAlreadyRegistered() public {
        _registerProvider();
        vm.prank(providerAddr);
        vm.expectRevert(GPUComputeMarket.AlreadyRegistered.selector);
        market.registerProvider(VRAM_GB, TFLOPS, PRICE_PER_HR);
    }

    function test_updateProvider_priceAndAvailability() public {
        _registerProvider();

        uint256 newPrice = 20 ether;

        vm.expectEmit(true, false, false, true);
        emit ProviderUpdated(providerAddr, newPrice, false);

        vm.prank(providerAddr);
        market.updateProvider(newPrice, false);

        (, , , , uint256 price, , , , bool avail, ) = market.providers(providerAddr);
        assertEq(price, newPrice);
        assertFalse(avail);
    }

    function test_updateProvider_revertsNotRegistered() public {
        vm.prank(providerAddr);
        vm.expectRevert(GPUComputeMarket.NotRegistered.selector);
        market.updateProvider(10 ether, true);
    }

    // ============ Unstake / Unregister ============

    function test_requestUnstake_setsTimestampAndUnavailable() public {
        _registerProvider();

        vm.expectEmit(true, false, false, false);
        emit UnstakeRequested(providerAddr, 0); // timestamp not checked precisely

        vm.prank(providerAddr);
        market.requestUnstake();

        (, , , , , , , , bool avail, ) = market.providers(providerAddr);
        assertFalse(avail);
        assertGt(market.unstakeRequestedAt(providerAddr), 0);
    }

    function test_unregisterProvider_afterCooldown() public {
        _registerProvider();
        uint256 balBefore = vibe.balanceOf(providerAddr);

        vm.prank(providerAddr);
        market.requestUnstake();

        // Warp past 7-day cooldown
        vm.warp(block.timestamp + 7 days + 1);

        vm.expectEmit(true, false, false, true);
        emit ProviderUnregistered(providerAddr, MIN_STAKE);

        vm.prank(providerAddr);
        market.unregisterProvider();

        (, , , , , , , , , bool active) = market.providers(providerAddr);
        assertFalse(active);
        assertEq(vibe.balanceOf(providerAddr), balBefore + MIN_STAKE);
    }

    function test_unregisterProvider_revertsCooldownNotElapsed() public {
        _registerProvider();

        vm.prank(providerAddr);
        market.requestUnstake();

        // Only 3 days passed — too early
        vm.warp(block.timestamp + 3 days);

        vm.prank(providerAddr);
        vm.expectRevert(GPUComputeMarket.CooldownNotElapsed.selector);
        market.unregisterProvider();
    }

    function test_unregisterProvider_revertsNoRequestMade() public {
        _registerProvider();
        vm.prank(providerAddr);
        vm.expectRevert(GPUComputeMarket.CooldownNotElapsed.selector);
        market.unregisterProvider();
    }

    // ============ Job Posting ============

    function test_postJob_emitsAndStores() public {
        _registerProvider();

        vm.deal(requester, JOB_BUDGET);

        vm.expectEmit(false, true, false, true);
        emit JobPosted(bytes32(0), requester, JOB_BUDGET, VRAM_GB, TFLOPS);

        vm.prank(requester);
        bytes32 jobId = market.postJob{value: JOB_BUDGET}(VRAM_GB, TFLOPS, MAX_HOURS, INPUT_HASH);

        (
            bytes32 id,
            address req,
            address prov,
            uint256 budget,
            , , , ,
            bytes32 resultHash,
            GPUComputeMarket.JobStatus status,
            , ,
        ) = market.jobs(jobId);

        assertEq(id, jobId);
        assertEq(req, requester);
        assertEq(prov, address(0));
        assertEq(budget, JOB_BUDGET);
        assertEq(resultHash, bytes32(0));
        assertEq(uint8(status), uint8(GPUComputeMarket.JobStatus.OPEN));
        assertEq(market.openJobCount(), 1);
    }

    function test_postJob_revertsZeroBudget() public {
        vm.prank(requester);
        vm.expectRevert(GPUComputeMarket.ZeroBudget.selector);
        market.postJob{value: 0}(VRAM_GB, TFLOPS, MAX_HOURS, INPUT_HASH);
    }

    // ============ Job Lifecycle ============

    function test_acceptJob_emitsAndAssigns() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.expectEmit(true, true, false, false);
        emit JobAccepted(jobId, providerAddr);

        vm.prank(providerAddr);
        market.acceptJob(jobId);

        (, , address prov, , , , , , , GPUComputeMarket.JobStatus status, , , ) = market.jobs(jobId);
        assertEq(prov, providerAddr);
        assertEq(uint8(status), uint8(GPUComputeMarket.JobStatus.ASSIGNED));
        assertEq(market.openJobCount(), 0); // removed from open jobs
    }

    function test_acceptJob_revertsIfProviderSpecsInsufficient() public {
        // Register a provider with lower VRAM than required
        address weakProvider = makeAddr("weakProvider");
        vibe.mint(weakProvider, MIN_STAKE);
        vm.prank(weakProvider);
        vibe.approve(address(market), type(uint256).max);

        vm.prank(weakProvider);
        market.registerProvider(4, 100, PRICE_PER_HR); // only 4 GB VRAM, far too little

        bytes32 jobId = _postJob(); // requires VRAM_GB=24

        vm.prank(weakProvider);
        vm.expectRevert(GPUComputeMarket.ProviderSpecsInsufficient.selector);
        market.acceptJob(jobId);
    }

    function test_acceptJob_revertsIfTooExpensive() public {
        // Register a provider whose hourly price exceeds the job budget
        address expensiveProvider = makeAddr("expProv");
        vibe.mint(expensiveProvider, MIN_STAKE);
        vm.prank(expensiveProvider);
        vibe.approve(address(market), type(uint256).max);

        uint256 highPrice = JOB_BUDGET + 1 ether; // maxCost > budget for 1 hour
        vm.prank(expensiveProvider);
        market.registerProvider(VRAM_GB, TFLOPS, highPrice);

        bytes32 jobId = _postJob();

        vm.prank(expensiveProvider);
        vm.expectRevert(GPUComputeMarket.ProviderSpecsInsufficient.selector);
        market.acceptJob(jobId);
    }

    function test_submitResult_basic() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        market.acceptJob(jobId);

        vm.expectEmit(true, false, false, false);
        emit ResultSubmitted(jobId, RESULT_HASH, 0);

        vm.prank(providerAddr);
        market.submitResult(jobId, RESULT_HASH);

        (, , , , , , , , bytes32 rh, GPUComputeMarket.JobStatus status, , , ) = market.jobs(jobId);
        assertEq(rh, RESULT_HASH);
        assertEq(uint8(status), uint8(GPUComputeMarket.JobStatus.RESULT_SUBMITTED));
    }

    function test_submitResult_revertsNotProvider() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        market.acceptJob(jobId);

        vm.prank(requester);
        vm.expectRevert(GPUComputeMarket.NotJobProvider.selector);
        market.submitResult(jobId, RESULT_HASH);
    }

    function test_challengeResult_withinWindow() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        market.acceptJob(jobId);
        vm.prank(providerAddr);
        market.submitResult(jobId, RESULT_HASH);

        vm.expectEmit(true, true, false, false);
        emit JobChallenged(jobId, requester);

        vm.prank(requester);
        market.challengeResult(jobId);

        (, , , , , , , , , GPUComputeMarket.JobStatus status, , , ) = market.jobs(jobId);
        assertEq(uint8(status), uint8(GPUComputeMarket.JobStatus.CHALLENGED));
    }

    function test_challengeResult_revertsAfterDeadline() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        market.acceptJob(jobId);
        vm.prank(providerAddr);
        market.submitResult(jobId, RESULT_HASH);

        // Warp past the challenge window
        vm.warp(block.timestamp + 25 hours);

        vm.prank(requester);
        vm.expectRevert(GPUComputeMarket.ChallengePeriodExpired.selector);
        market.challengeResult(jobId);
    }

    function test_finalizeJob_paymentsAndReputation() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        market.acceptJob(jobId);
        vm.prank(providerAddr);
        market.submitResult(jobId, RESULT_HASH);

        // Advance past challenge window
        vm.warp(block.timestamp + 25 hours);

        uint256 expectedProvider  = (JOB_BUDGET * 9000) / 10000; // 90%
        uint256 expectedProtocol  = (JOB_BUDGET *  500) / 10000; // 5%
        uint256 expectedInsurance = JOB_BUDGET - expectedProvider - expectedProtocol; // 5%

        uint256 provBefore     = vibe.balanceOf(providerAddr);
        uint256 treasBefore    = vibe.balanceOf(treasury);
        uint256 insBefore      = vibe.balanceOf(insurance);

        vm.expectEmit(true, false, false, true);
        emit JobFinalized(jobId, expectedProvider, expectedProtocol, expectedInsurance);

        market.finalizeJob(jobId); // permissionless

        assertEq(vibe.balanceOf(providerAddr), provBefore + expectedProvider);
        assertEq(vibe.balanceOf(treasury),     treasBefore + expectedProtocol);
        assertEq(vibe.balanceOf(insurance),    insBefore + expectedInsurance);

        (, uint256 stake, , , , uint256 rep, uint256 completed, uint256 earned, , ) = market.providers(providerAddr);
        assertEq(completed, 1);
        assertEq(earned, expectedProvider);
        assertEq(rep, market.INITIAL_REPUTATION() + market.REPUTATION_GAIN());
        assertGt(stake, 0); // stake unchanged for good job

        assertEq(market.totalProtocolFees(), expectedProtocol);
        assertEq(market.totalInsuranceFees(), expectedInsurance);
    }

    function test_finalizeJob_revertsBeforeChallengePeriod() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        market.acceptJob(jobId);
        vm.prank(providerAddr);
        market.submitResult(jobId, RESULT_HASH);

        // Challenge period not over yet
        vm.expectRevert(GPUComputeMarket.ChallengePeriodNotOver.selector);
        market.finalizeJob(jobId);
    }

    function test_cancelJob_refundsBudget() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        uint256 balBefore = vibe.balanceOf(requester);

        vm.expectEmit(true, false, false, true);
        emit JobCancelled(jobId, JOB_BUDGET);

        vm.prank(requester);
        market.cancelJob(jobId);

        assertEq(vibe.balanceOf(requester), balBefore + JOB_BUDGET);
        assertEq(market.openJobCount(), 0);
    }

    function test_cancelJob_revertsNotRequester() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        vm.expectRevert(GPUComputeMarket.NotJobRequester.selector);
        market.cancelJob(jobId);
    }

    function test_cancelJob_revertsAlreadyAssigned() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        market.acceptJob(jobId);

        vm.prank(requester);
        vm.expectRevert();
        market.cancelJob(jobId);
    }

    // ============ Slash Tests ============

    function test_slashProvider_reducesStakeAndReputation() public {
        _registerProvider();
        bytes32 jobId = _postJob();

        vm.prank(providerAddr);
        market.acceptJob(jobId);
        vm.prank(providerAddr);
        market.submitResult(jobId, RESULT_HASH);

        vm.prank(requester);
        market.challengeResult(jobId);

        (, uint256 stakeBefore, , , , uint256 repBefore, , , , ) = market.providers(providerAddr);
        uint256 expectedSlash = (stakeBefore * 50) / 100;

        vm.expectEmit(true, false, false, false);
        emit ProviderSlashed(providerAddr, expectedSlash, jobId);

        uint256 reqBalBefore = vibe.balanceOf(requester);
        uint256 insBefore    = vibe.balanceOf(insurance);

        vm.prank(owner);
        market.slashProvider(jobId);

        (, uint256 stakeAfter, , , , uint256 repAfter, , , , ) = market.providers(providerAddr);
        assertEq(stakeAfter, stakeBefore - expectedSlash);
        assertEq(repAfter,   repBefore > market.REPUTATION_LOSS()
            ? repBefore - market.REPUTATION_LOSS()
            : 0
        );

        // requester refunded full budget, slashed stake goes to insurance
        assertEq(vibe.balanceOf(requester), reqBalBefore + JOB_BUDGET);
        assertEq(vibe.balanceOf(insurance), insBefore + expectedSlash);
    }

    function test_slashProvider_onlyOwner() public {
        _registerProvider();
        bytes32 jobId = _postJob();
        vm.prank(providerAddr);
        market.acceptJob(jobId);
        vm.prank(providerAddr);
        market.submitResult(jobId, RESULT_HASH);
        vm.prank(requester);
        market.challengeResult(jobId);

        vm.prank(requester);
        vm.expectRevert();
        market.slashProvider(jobId);
    }

    // ============ Admin Tests ============

    function test_setProtocolTreasury_onlyOwner() public {
        vm.prank(alice_);
        vm.expectRevert();
        market.setProtocolTreasury(makeAddr("newTreasury"));
    }

    function test_setInsurancePool_onlyOwner() public {
        vm.prank(alice_);
        vm.expectRevert();
        market.setInsurancePool(makeAddr("newPool"));
    }

    function test_setProtocolTreasury_updatesAddress() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        market.setProtocolTreasury(newTreasury);
        assertEq(market.protocolTreasury(), newTreasury);
    }

    function test_setInsurancePool_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(GPUComputeMarket.ZeroAddress.selector);
        market.setInsurancePool(address(0));
    }

    // ============ Multiple Jobs — Open Job Tracking ============

    function test_openJobCount_multiplePostsAndCancels() public {
        _registerProvider();

        // Post 3 jobs
        bytes32 j1 = _postJob();
        bytes32 j2 = _postJob();
        bytes32 j3 = _postJob();
        assertEq(market.openJobCount(), 3);

        // Cancel middle job — tests swap-and-pop
        vm.prank(requester);
        market.cancelJob(j2);
        assertEq(market.openJobCount(), 2);

        // Accept one — removes from openJobs
        vm.prank(providerAddr);
        market.acceptJob(j1);
        assertEq(market.openJobCount(), 1);

        // j3 still open
        vm.prank(requester);
        market.cancelJob(j3);
        assertEq(market.openJobCount(), 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_postAndCancelReturnsFullBudget(uint96 budget) public {
        vm.assume(budget >= 1 ether && budget <= 10_000 ether);

        _registerProvider();
        vibe.mint(requester, uint256(budget));
        vm.deal(requester, uint256(budget));

        vm.prank(requester);
        bytes32 jobId = market.postJob{value: uint256(budget)}(
            VRAM_GB, TFLOPS, MAX_HOURS, INPUT_HASH
        );

        uint256 balBefore = vibe.balanceOf(requester);
        vm.prank(requester);
        market.cancelJob(jobId);

        assertEq(vibe.balanceOf(requester), balBefore + uint256(budget));
    }

    // ============ Helpers (private) ============

    address private alice_ = address(0xA11CE);
}
