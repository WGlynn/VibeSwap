// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "../../contracts/compliance/FederatedConsensus.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock FederatedConsensus ============
//
// Mirrors the mock used in test/unit/ClawbackRegistry.t.sol so the contest
// path tests are isolated from the real FederatedConsensus state machine but
// still exercise the same authority/executable gating semantics.

contract MockConsensus {
    mapping(address => bool) public activeAuthorities;
    mapping(bytes32 => bool) public executableProposals;
    mapping(bytes32 => bool) public executedProposals;
    uint256 proposalCount;

    function setActiveAuthority(address addr, bool active) external {
        activeAuthorities[addr] = active;
    }

    function isActiveAuthority(address addr) external view returns (bool) {
        return activeAuthorities[addr];
    }

    function createProposal(bytes32, address, uint256, address, string calldata)
        external returns (bytes32) {
        proposalCount++;
        bytes32 pid = keccak256(abi.encodePacked(proposalCount));
        return pid;
    }

    function setExecutable(bytes32 proposalId, bool executable) external {
        executableProposals[proposalId] = executable;
    }

    function isExecutable(bytes32 proposalId) external view returns (bool) {
        return executableProposals[proposalId];
    }

    function markExecuted(bytes32 proposalId) external {
        executedProposals[proposalId] = true;
    }
}

// ============ Mock Token ============

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ ClawbackRegistry V2 (test re-deploy stub) ============
//
// To exercise reinitializer(2) end-to-end we deploy V1 (current
// ClawbackRegistry as initialize() initializer(1)) and then call
// initializeContestV1() which is reinitializer(2). The same contract
// implementation handles both — V2 is the same bytecode with the contest
// init function. This mirrors how a production upgrade would work
// (upgradeToAndCall packaging).

// ============ Tests ============

contract ClawbackContestTest is Test {
    ClawbackRegistry registry;
    MockConsensus consensus;
    MockERC20 caseToken;
    MockERC20 bondToken;

    address owner       = makeAddr("owner");
    address authority   = makeAddr("authority");
    address tracker     = makeAddr("tracker");
    address badActor    = makeAddr("badActor");
    address recipient   = makeAddr("recipient");
    address vault       = makeAddr("vault");
    address contestant  = makeAddr("contestant");
    address otherUser   = makeAddr("otherUser");
    address poolFunder  = makeAddr("poolFunder");

    uint256 constant DEFAULT_BOND   = 0.5 ether;
    uint64  constant DEFAULT_WINDOW = 24 hours;
    uint256 constant DEFAULT_REWARD = 0.1 ether;

    function setUp() public {
        consensus = new MockConsensus();
        caseToken = new MockERC20();
        bondToken = new MockERC20();

        // Deploy as proxy (UUPS)
        ClawbackRegistry impl = new ClawbackRegistry();
        bytes memory initData = abi.encodeWithSelector(
            ClawbackRegistry.initialize.selector,
            owner,
            address(consensus),
            5,       // maxCascadeDepth
            1 ether  // minTaintAmount
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = ClawbackRegistry(address(proxy));

        // Setup authority
        consensus.setActiveAuthority(authority, true);

        // Setup tracker
        vm.prank(owner);
        registry.setAuthorizedTracker(tracker, true);

        // Setup vault
        vm.prank(owner);
        registry.setVault(vault);

        // ----- C47 reinitializer step (post-upgrade migration analog) -----
        vm.prank(owner);
        registry.initializeContestV1(
            address(bondToken),
            DEFAULT_BOND,
            DEFAULT_WINDOW,
            DEFAULT_REWARD
        );

        // Fund actors
        caseToken.mint(badActor, 1000 ether);
        bondToken.mint(contestant, 100 ether);
        bondToken.mint(otherUser, 100 ether);
        bondToken.mint(poolFunder, 100 ether);

        // Pre-approve registry to pull bonds
        vm.prank(contestant);
        bondToken.approve(address(registry), type(uint256).max);
        vm.prank(otherUser);
        bondToken.approve(address(registry), type(uint256).max);
        vm.prank(poolFunder);
        bondToken.approve(address(registry), type(uint256).max);
    }

    // ============ Helpers ============

    function _openCase() internal returns (bytes32 caseId) {
        vm.prank(owner);
        caseId = registry.openCase(badActor, 100 ether, address(caseToken), "theft");
    }

    function _submitForVoting(bytes32 caseId) internal {
        vm.prank(owner);
        registry.submitForVoting(caseId);
    }

    function _getCaseStatus(bytes32 caseId) internal view returns (ClawbackRegistry.CaseStatus) {
        (,,,,ClawbackRegistry.CaseStatus status,,,,,,) = registry.cases(caseId);
        return status;
    }

    function _getCaseProposalId(bytes32 caseId) internal view returns (bytes32) {
        (,,,,,,,,,bytes32 proposalId,) = registry.cases(caseId);
        return proposalId;
    }

    // ============ Initialization & Parameter Setters ============

    function test_initializeContestV1_setsState() public view {
        assertEq(registry.contestBondToken(), address(bondToken));
        assertEq(registry.contestBondAmount(), DEFAULT_BOND);
        assertEq(uint256(registry.contestWindow()), uint256(DEFAULT_WINDOW));
        assertEq(registry.contestSuccessReward(), DEFAULT_REWARD);
        assertTrue(registry.contestParamsInitialized());
    }

    function test_initializeContestV1_revertsIfCalledAgain() public {
        // reinitializer(2) is single-shot per proxy
        vm.expectRevert();  // OZ Initializable: InvalidInitialization
        vm.prank(owner);
        registry.initializeContestV1(
            address(bondToken),
            DEFAULT_BOND,
            DEFAULT_WINDOW,
            DEFAULT_REWARD
        );
    }

    function test_setContestBondAmount_revertsBelowMin() public {
        vm.expectRevert(ClawbackRegistry.BondBelowMin.selector);
        vm.prank(owner);
        registry.setContestBondAmount(0.05 ether);  // below 0.1 ether floor
    }

    function test_setContestWindow_revertsBelowMin() public {
        vm.expectRevert(ClawbackRegistry.WindowOutOfRange.selector);
        vm.prank(owner);
        registry.setContestWindow(30 minutes);  // below 1 hour floor
    }

    function test_setContestWindow_revertsAboveMax() public {
        vm.expectRevert(ClawbackRegistry.WindowOutOfRange.selector);
        vm.prank(owner);
        registry.setContestWindow(8 days);  // above 7 day ceiling
    }

    // ============ openContest happy path ============

    function test_openContest_acceptsBond_setsActive() public {
        bytes32 caseId = _openCase();

        uint256 bondBefore = bondToken.balanceOf(contestant);

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        // Bond pulled from contestant
        assertEq(bondToken.balanceOf(contestant), bondBefore - DEFAULT_BOND);
        assertEq(bondToken.balanceOf(address(registry)), DEFAULT_BOND);

        // Contest record populated
        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(caseId);
        assertEq(ct.contestant, contestant);
        assertEq(ct.bond, DEFAULT_BOND);
        assertEq(ct.bondToken, address(bondToken));
        assertEq(uint256(ct.status), uint256(ClawbackRegistry.ContestStatus.ACTIVE));
        assertEq(ct.evidenceURI, "ipfs://Qm-evidence");

        assertTrue(registry.hasActiveContest(caseId));
    }

    function test_openContest_revertsIfCaseDoesNotExist() public {
        vm.expectRevert(ClawbackRegistry.CaseNotFound.selector);
        vm.prank(contestant);
        registry.openContest(keccak256("nonexistent"), "ipfs://Qm-evidence");
    }

    function test_openContest_revertsIfCaseAlreadyResolved() public {
        bytes32 caseId = _openCase();
        _submitForVoting(caseId);

        bytes32 proposalId = _getCaseProposalId(caseId);
        consensus.setExecutable(proposalId, true);

        // Execute clawback first — case becomes RESOLVED
        vm.prank(owner);
        registry.executeClawback(caseId);

        // Now contest should reject because case is RESOLVED, not OPEN/VOTING
        vm.expectRevert(ClawbackRegistry.InvalidCaseStatus.selector);
        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");
    }

    function test_openContest_revertsIfContestActive() public {
        bytes32 caseId = _openCase();

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence-1");

        // Second contestant cannot open another contest while first is active
        vm.expectRevert(ClawbackRegistry.ContestActive.selector);
        vm.prank(otherUser);
        registry.openContest(caseId, "ipfs://Qm-evidence-2");
    }

    function test_openContest_revertsOnEmptyEvidence() public {
        bytes32 caseId = _openCase();

        vm.expectRevert(ClawbackRegistry.InvalidEvidenceURI.selector);
        vm.prank(contestant);
        registry.openContest(caseId, "");
    }

    function test_openContest_revertsIfBondInsufficient() public {
        bytes32 caseId = _openCase();

        // Burn allowance for a fresh user with no balance
        address poorUser = makeAddr("poorUser");
        vm.prank(poorUser);
        bondToken.approve(address(registry), type(uint256).max);

        vm.expectRevert();  // ERC20InsufficientBalance from OZ v5
        vm.prank(poorUser);
        registry.openContest(caseId, "ipfs://Qm-evidence");
    }

    // ============ executeClawback gating ============

    function test_executeClawback_revertsWhileContestActive() public {
        bytes32 caseId = _openCase();
        _submitForVoting(caseId);

        bytes32 proposalId = _getCaseProposalId(caseId);
        consensus.setExecutable(proposalId, true);

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        // Even though consensus says executable, contest gate blocks
        vm.expectRevert(ClawbackRegistry.ContestActive.selector);
        vm.prank(owner);
        registry.executeClawback(caseId);
    }

    // ============ upholdContest happy path ============

    function test_upholdContest_dismissesCaseAndReturnsBondPlusReward() public {
        bytes32 caseId = _openCase();

        // Cascade some taint so the dismiss path has wallets to clear
        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 10 ether, address(caseToken));

        // Open contest
        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        // Fund reward pool so reward is paid
        vm.prank(poolFunder);
        registry.fundContestRewardPool(1 ether);
        assertEq(registry.contestRewardPool(), 1 ether);

        uint256 contestantBefore = bondToken.balanceOf(contestant);

        // Authority upholds
        vm.prank(authority);
        registry.upholdContest(caseId);

        // Contest is UPHELD
        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(caseId);
        assertEq(uint256(ct.status), uint256(ClawbackRegistry.ContestStatus.UPHELD));

        // Case is DISMISSED
        assertEq(uint8(_getCaseStatus(caseId)), uint8(ClawbackRegistry.CaseStatus.DISMISSED));

        // Wallets cleared
        (ClawbackRegistry.TaintLevel bl,,,) = registry.checkWallet(badActor);
        (ClawbackRegistry.TaintLevel rl,,,) = registry.checkWallet(recipient);
        assertEq(uint256(bl), uint256(ClawbackRegistry.TaintLevel.CLEAN));
        assertEq(uint256(rl), uint256(ClawbackRegistry.TaintLevel.CLEAN));

        // Contestant got back bond + reward
        assertEq(
            bondToken.balanceOf(contestant),
            contestantBefore + DEFAULT_BOND + DEFAULT_REWARD
        );

        // Reward pool decremented by the reward amount
        assertEq(registry.contestRewardPool(), 1 ether - DEFAULT_REWARD);
    }

    function test_upholdContest_capsRewardAtPoolBalance() public {
        bytes32 caseId = _openCase();

        // Pool empty — reward should cap at 0; contestant gets only bond back
        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        uint256 contestantBefore = bondToken.balanceOf(contestant);

        vm.prank(authority);
        registry.upholdContest(caseId);

        // Bond returned, no reward (pool was empty, capped to 0)
        assertEq(bondToken.balanceOf(contestant), contestantBefore + DEFAULT_BOND);
        assertEq(registry.contestRewardPool(), 0);
    }

    function test_upholdContest_revertsAfterDeadline() public {
        bytes32 caseId = _openCase();

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        // Roll past deadline
        vm.warp(block.timestamp + DEFAULT_WINDOW + 1);

        vm.expectRevert(ClawbackRegistry.ContestExpiredError.selector);
        vm.prank(authority);
        registry.upholdContest(caseId);
    }

    function test_upholdContest_revertsUnauthorized() public {
        bytes32 caseId = _openCase();

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        vm.expectRevert("Not authorized");
        vm.prank(otherUser);
        registry.upholdContest(caseId);
    }

    // ============ dismissContest (failed contest) ============

    function test_dismissContest_forfeitsBondToPool() public {
        bytes32 caseId = _openCase();

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        uint256 contestantBefore = bondToken.balanceOf(contestant);
        uint256 poolBefore = registry.contestRewardPool();

        vm.prank(authority);
        registry.dismissContest(caseId);

        // Contest is DISMISSED
        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(caseId);
        assertEq(uint256(ct.status), uint256(ClawbackRegistry.ContestStatus.DISMISSED));

        // Contestant's bond is gone
        assertEq(bondToken.balanceOf(contestant), contestantBefore);

        // Pool received the forfeit
        assertEq(registry.contestRewardPool(), poolBefore + DEFAULT_BOND);
    }

    function test_dismissContest_unblocksExecuteClawback() public {
        bytes32 caseId = _openCase();
        _submitForVoting(caseId);

        bytes32 proposalId = _getCaseProposalId(caseId);
        consensus.setExecutable(proposalId, true);

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        // Authority dismisses contest
        vm.prank(authority);
        registry.dismissContest(caseId);

        // Now executeClawback proceeds (the contest gate no longer blocks)
        vm.prank(owner);
        registry.executeClawback(caseId);

        assertEq(uint8(_getCaseStatus(caseId)), uint8(ClawbackRegistry.CaseStatus.RESOLVED));
    }

    function test_dismissContest_revertsAfterDeadline() public {
        bytes32 caseId = _openCase();

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        vm.warp(block.timestamp + DEFAULT_WINDOW + 1);

        vm.expectRevert(ClawbackRegistry.ContestExpiredError.selector);
        vm.prank(authority);
        registry.dismissContest(caseId);
    }

    function test_dismissContest_revertsNoActiveContest() public {
        bytes32 caseId = _openCase();
        // No contest opened

        vm.expectRevert(ClawbackRegistry.NoActiveContest.selector);
        vm.prank(authority);
        registry.dismissContest(caseId);
    }

    // ============ resolveExpiredContest ============

    function test_resolveExpiredContest_forfeitsBond_unblocksExecution() public {
        bytes32 caseId = _openCase();
        _submitForVoting(caseId);

        bytes32 proposalId = _getCaseProposalId(caseId);
        consensus.setExecutable(proposalId, true);

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        uint256 contestantBefore = bondToken.balanceOf(contestant);
        uint256 poolBefore = registry.contestRewardPool();

        // Roll past deadline
        vm.warp(block.timestamp + DEFAULT_WINDOW + 1);

        // Anyone can call resolveExpiredContest — permissionless
        vm.prank(otherUser);
        registry.resolveExpiredContest(caseId);

        // Contest is EXPIRED
        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(caseId);
        assertEq(uint256(ct.status), uint256(ClawbackRegistry.ContestStatus.EXPIRED));

        // Bond forfeited to pool
        assertEq(bondToken.balanceOf(contestant), contestantBefore);
        assertEq(registry.contestRewardPool(), poolBefore + DEFAULT_BOND);

        // executeClawback now works
        vm.prank(owner);
        registry.executeClawback(caseId);
        assertEq(uint8(_getCaseStatus(caseId)), uint8(ClawbackRegistry.CaseStatus.RESOLVED));
    }

    function test_resolveExpiredContest_revertsBeforeDeadline() public {
        bytes32 caseId = _openCase();

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        // Still within window
        vm.expectRevert(ClawbackRegistry.ContestNotExpired.selector);
        vm.prank(otherUser);
        registry.resolveExpiredContest(caseId);
    }

    function test_resolveExpiredContest_revertsNoActiveContest() public {
        bytes32 caseId = _openCase();
        vm.warp(block.timestamp + DEFAULT_WINDOW + 1);

        vm.expectRevert(ClawbackRegistry.NoActiveContest.selector);
        vm.prank(otherUser);
        registry.resolveExpiredContest(caseId);
    }

    // ============ Pool funding ============

    function test_fundContestRewardPool_creditsPool() public {
        uint256 amount = 5 ether;

        uint256 funderBefore = bondToken.balanceOf(poolFunder);

        vm.prank(poolFunder);
        registry.fundContestRewardPool(amount);

        assertEq(registry.contestRewardPool(), amount);
        assertEq(bondToken.balanceOf(poolFunder), funderBefore - amount);
    }

    // ============ Pre-existing flow regression ============

    function test_regression_preExistingClawbackFlow_noContest() public {
        // Mirror the existing test_executeClawback_resolvesCase_noTokenApproval
        // path: case opens, taint propagates, vote submitted, executable, claw
        // executes — no contest interference.
        bytes32 caseId = _openCase();

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 10 ether, address(caseToken));

        _submitForVoting(caseId);

        bytes32 proposalId = _getCaseProposalId(caseId);
        consensus.setExecutable(proposalId, true);

        vm.prank(owner);
        registry.executeClawback(caseId);

        assertEq(uint8(_getCaseStatus(caseId)), uint8(ClawbackRegistry.CaseStatus.RESOLVED));

        // hasActiveContest is false — no contest was ever opened
        assertFalse(registry.hasActiveContest(caseId));
        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(caseId);
        assertEq(uint256(ct.status), uint256(ClawbackRegistry.ContestStatus.NONE));
    }

    function test_regression_dismissCase_doesNotInteractWithContest() public {
        // Authority's existing dismissCase path should still work even when
        // contest hasn't been opened. The two adjudication paths coexist.
        bytes32 caseId = _openCase();

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 10 ether, address(caseToken));

        // Direct authority dismissal (no contest)
        vm.prank(owner);
        registry.dismissCase(caseId);

        assertEq(uint8(_getCaseStatus(caseId)), uint8(ClawbackRegistry.CaseStatus.DISMISSED));

        // Wallets cleared
        (ClawbackRegistry.TaintLevel bl,,,) = registry.checkWallet(badActor);
        assertEq(uint256(bl), uint256(ClawbackRegistry.TaintLevel.CLEAN));
    }

    // ============ Geometry parity with OCR V2a ============

    function test_geometry_default_on_expiry_favors_standing_case() public {
        // Mirror of OCR V2a `claimAssignmentSlash`: when the response window
        // expires without resolution, the default outcome favors the
        // standing path (here: clawback proceeds, bond forfeited).
        bytes32 caseId = _openCase();
        _submitForVoting(caseId);
        bytes32 proposalId = _getCaseProposalId(caseId);
        consensus.setExecutable(proposalId, true);

        vm.prank(contestant);
        registry.openContest(caseId, "ipfs://Qm-evidence");

        vm.warp(block.timestamp + DEFAULT_WINDOW + 1);

        // Permissionless expiry resolution
        vm.prank(otherUser);
        registry.resolveExpiredContest(caseId);

        // Bond forfeited; case can proceed
        vm.prank(owner);
        registry.executeClawback(caseId);

        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(caseId);
        assertEq(uint256(ct.status), uint256(ClawbackRegistry.ContestStatus.EXPIRED));
        assertEq(uint8(_getCaseStatus(caseId)), uint8(ClawbackRegistry.CaseStatus.RESOLVED));
    }

    function test_geometry_self_funding_reward_pool() public {
        // Forfeited bonds bootstrap rewards for future successful contestants.
        // Mirrors OCR `slashPool` self-funding pattern.

        // Round 1: dismissed contest forfeits bond to pool
        bytes32 caseId1 = _openCase();
        vm.prank(contestant);
        registry.openContest(caseId1, "ipfs://Qm-c1");
        vm.prank(authority);
        registry.dismissContest(caseId1);
        assertEq(registry.contestRewardPool(), DEFAULT_BOND);

        // Round 2: a NEW case, contestant 2 wins — reward paid from forfeited pool
        // Open a second case
        vm.prank(owner);
        bytes32 caseId2 = registry.openCase(makeAddr("badActor2"), 100 ether, address(caseToken), "fraud2");

        uint256 c2Before = bondToken.balanceOf(otherUser);
        vm.prank(otherUser);
        registry.openContest(caseId2, "ipfs://Qm-c2");

        vm.prank(authority);
        registry.upholdContest(caseId2);

        // otherUser got bond back + reward, paid from the previously-forfeited pool
        assertEq(bondToken.balanceOf(otherUser), c2Before + DEFAULT_REWARD);
        // (Bond returned: c2Before - DEFAULT_BOND + DEFAULT_BOND = c2Before; plus reward.)
        assertEq(registry.contestRewardPool(), DEFAULT_BOND - DEFAULT_REWARD);
    }
}
