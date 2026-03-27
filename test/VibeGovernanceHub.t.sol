// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/governance/VibeGovernanceHub.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {
        _mint(msg.sender, 1_000_000 ether);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockStVIBE is ERC20 {
    constructor() ERC20("stVIBE", "stVIBE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockGovTarget {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
    function revertAlways() external pure { revert("MockGovTarget: revert"); }
}

// ============ Test Contract ============

contract VibeGovernanceHubTest is Test {
    VibeGovernanceHub public hub;
    MockVIBE public vibe;
    MockStVIBE public stVibe;
    MockGovTarget public target;

    // ============ Actors ============

    address public deployer;
    address public owner;
    address public securityCouncil;
    address public voter1;
    address public voter2;
    address public voter3;
    address public nobody;

    // ============ Constants ============

    uint256 constant PROPOSAL_THRESHOLD = 1000 ether;
    uint256 constant STANDARD_TIMELOCK = 48 hours;
    uint256 constant EMERGENCY_TIMELOCK = 6 hours;
    uint256 constant VETO_SUNSET = 730 days;

    // ============ Re-declared Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        VibeGovernanceHub.GovernanceType govType,
        string title,
        bool emergency
    );
    event ProposalActivated(uint256 indexed proposalId, uint256 voteStart, uint256 voteEnd);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event VoteCommitted(uint256 indexed proposalId, address indexed voter, bytes32 commitHash);
    event VoteRevealed(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalQueued(uint256 indexed proposalId, uint256 executionTime);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalVetoed(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);

    function setUp() public {
        deployer = address(this);
        owner = makeAddr("owner");
        securityCouncil = makeAddr("securityCouncil");
        voter1 = makeAddr("voter1");
        voter2 = makeAddr("voter2");
        voter3 = makeAddr("voter3");
        nobody = makeAddr("nobody");

        // Deploy tokens
        vibe = new MockVIBE();
        stVibe = new MockStVIBE();

        // Deploy target
        target = new MockGovTarget();

        // Deploy hub via proxy
        VibeGovernanceHub impl = new VibeGovernanceHub();
        bytes memory initData = abi.encodeCall(
            VibeGovernanceHub.initialize,
            (
                address(vibe),
                address(stVibe),
                address(0),          // lpPositionSource
                address(0),          // mindScoreSource
                securityCouncil,
                PROPOSAL_THRESHOLD,
                owner
            )
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        hub = VibeGovernanceHub(payable(address(proxy)));

        // Distribute VIBE tokens to voters
        vibe.mint(voter1, 10_000 ether);
        vibe.mint(voter2, 10_000 ether);
        vibe.mint(voter3, 10_000 ether);

        // Fund hub for ETH proposals
        vm.deal(address(hub), 10 ether);
    }

    // ============ Helpers ============

    function _createTokenProposal(bool emergency) internal returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockGovTarget.setValue, (42));

        vm.prank(voter1);
        proposalId = hub.propose(
            VibeGovernanceHub.GovernanceType.TOKEN,
            "Set value to 42",
            targets,
            values,
            calldatas,
            emergency
        );
    }

    function _createQuadraticProposal() internal returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockGovTarget.setValue, (100));

        vm.prank(voter1);
        proposalId = hub.propose(
            VibeGovernanceHub.GovernanceType.QUADRATIC,
            "Quadratic proposal",
            targets,
            values,
            calldatas,
            false
        );
    }

    function _createCommitRevealProposal() internal returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockGovTarget.setValue, (200));

        vm.prank(voter1);
        proposalId = hub.propose(
            VibeGovernanceHub.GovernanceType.COMMIT_REVEAL,
            "Commit reveal proposal",
            targets,
            values,
            calldatas,
            false
        );
    }

    function _createConvictionProposal() internal returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockGovTarget.setValue, (300));

        vm.prank(voter1);
        proposalId = hub.propose(
            VibeGovernanceHub.GovernanceType.CONVICTION,
            "Conviction proposal",
            targets,
            values,
            calldatas,
            false
        );
    }

    function _activateProposal(uint256 proposalId) internal {
        vm.prank(voter1);
        hub.activateProposal(proposalId);
    }

    // ============ Initialization ============

    function test_initialize_setsState() public view {
        assertEq(address(hub.vibeToken()), address(vibe));
        assertEq(address(hub.stVibeToken()), address(stVibe));
        assertEq(hub.securityCouncil(), securityCouncil);
        assertEq(hub.proposalThreshold(), PROPOSAL_THRESHOLD);
        assertEq(hub.owner(), owner);
    }

    function test_initialize_setsDefaultConfigs() public view {
        (uint256 votingPeriod, uint256 quorumBps, uint256 timelockDelay, bool enabled) =
            hub.govConfigs(VibeGovernanceHub.GovernanceType.TOKEN);
        assertEq(votingPeriod, 7 days);
        assertEq(quorumBps, 1000);
        assertEq(timelockDelay, STANDARD_TIMELOCK);
        assertTrue(enabled);
    }

    function test_initialize_revertsZeroVibeToken() public {
        VibeGovernanceHub impl = new VibeGovernanceHub();
        bytes memory initData = abi.encodeCall(
            VibeGovernanceHub.initialize,
            (address(0), address(stVibe), address(0), address(0), securityCouncil, PROPOSAL_THRESHOLD, owner)
        );
        vm.expectRevert(VibeGovernanceHub.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    // ============ Proposal Creation ============

    function test_propose_tokenVoting() public {
        uint256 proposalId = _createTokenProposal(false);
        assertEq(proposalId, 1);
        assertEq(hub.proposalCount(), 1);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.DRAFT));
    }

    function test_propose_emergency() public {
        uint256 proposalId = _createTokenProposal(true);
        (,,,,,,,,,,,,bool emergency,,,) = hub.proposals(proposalId);
        assertTrue(emergency);
    }

    function test_propose_revertsBelowThreshold() public {
        address poorVoter = makeAddr("poor");
        vibe.mint(poorVoter, 100 ether); // Below threshold

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockGovTarget.setValue, (1));

        vm.prank(poorVoter);
        vm.expectRevert(
            abi.encodeWithSelector(
                VibeGovernanceHub.BelowProposalThreshold.selector,
                100 ether,
                PROPOSAL_THRESHOLD
            )
        );
        hub.propose(VibeGovernanceHub.GovernanceType.TOKEN, "Underfunded", targets, values, calldatas, false);
    }

    function test_propose_revertsEmptyProposal() public {
        address[] memory targets = new address[](0);
        uint256[] memory values = new uint256[](0);
        bytes[] memory calldatas = new bytes[](0);

        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.EmptyProposal.selector);
        hub.propose(VibeGovernanceHub.GovernanceType.TOKEN, "Empty", targets, values, calldatas, false);
    }

    function test_propose_revertsTooManyOperations() public {
        address[] memory targets = new address[](11);
        uint256[] memory values = new uint256[](11);
        bytes[] memory calldatas = new bytes[](11);
        for (uint256 i = 0; i < 11; i++) {
            targets[i] = address(target);
            calldatas[i] = abi.encodeCall(MockGovTarget.setValue, (i));
        }

        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.TooManyOperations.selector);
        hub.propose(VibeGovernanceHub.GovernanceType.TOKEN, "Too many ops", targets, values, calldatas, false);
    }

    function test_propose_revertsArrayLengthMismatch() public {
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](2);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockGovTarget.setValue, (1));

        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.ArrayLengthMismatch.selector);
        hub.propose(VibeGovernanceHub.GovernanceType.TOKEN, "Mismatch", targets, values, calldatas, false);
    }

    function test_propose_revertsDisabledGovernanceType() public {
        // Disable TOKEN governance
        vm.prank(owner);
        hub.setGovernanceConfig(
            VibeGovernanceHub.GovernanceType.TOKEN,
            7 days,
            1000,
            STANDARD_TIMELOCK,
            false
        );

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockGovTarget.setValue, (1));

        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.GovernanceTypeDisabled.selector);
        hub.propose(VibeGovernanceHub.GovernanceType.TOKEN, "Disabled", targets, values, calldatas, false);
    }

    // ============ Proposal Activation ============

    function test_activate_movesToActive() public {
        uint256 proposalId = _createTokenProposal(false);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.DRAFT));

        _activateProposal(proposalId);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.ACTIVE));
    }

    function test_activate_ownerCanActivate() public {
        uint256 proposalId = _createTokenProposal(false);
        vm.prank(owner);
        hub.activateProposal(proposalId);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.ACTIVE));
    }

    function test_activate_revertsUnauthorized() public {
        uint256 proposalId = _createTokenProposal(false);
        vm.prank(nobody);
        vm.expectRevert("Not authorized");
        hub.activateProposal(proposalId);
    }

    // ============ Token Voting ============

    function test_castVote_recordsVote() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vm.prank(voter1);
        hub.castVote(proposalId, true);

        uint256 votedWeight = hub.hasVoted(proposalId, voter1);
        assertTrue(votedWeight > 0);
    }

    function test_castVote_forAndAgainst() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vm.prank(voter1);
        hub.castVote(proposalId, true);

        vm.prank(voter2);
        hub.castVote(proposalId, false);

        (,,,,uint256 votesFor, uint256 votesAgainst,,,,,,,,,,) = hub.proposals(proposalId);
        assertTrue(votesFor > 0);
        assertTrue(votesAgainst > 0);
    }

    function test_castVote_revertsDoubleVote() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vm.prank(voter1);
        hub.castVote(proposalId, true);

        vm.prank(voter1);
        vm.expectRevert(
            abi.encodeWithSelector(
                VibeGovernanceHub.AlreadyVoted.selector,
                proposalId,
                voter1
            )
        );
        hub.castVote(proposalId, true);
    }

    function test_castVote_revertsWrongGovernanceType() public {
        uint256 proposalId = _createQuadraticProposal();
        _activateProposal(proposalId);

        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.InvalidGovernanceType.selector);
        hub.castVote(proposalId, true);
    }

    function test_castVote_revertsIfNotActive() public {
        uint256 proposalId = _createTokenProposal(false);
        // Still in DRAFT, not activated

        vm.prank(voter1);
        vm.expectRevert(
            abi.encodeWithSelector(
                VibeGovernanceHub.ProposalNotInState.selector,
                proposalId,
                uint8(VibeGovernanceHub.ProposalState.ACTIVE),
                uint8(VibeGovernanceHub.ProposalState.DRAFT)
            )
        );
        hub.castVote(proposalId, true);
    }

    // ============ Quadratic Voting ============

    function test_castQuadraticVote_usesSqrtWeight() public {
        uint256 proposalId = _createQuadraticProposal();
        _activateProposal(proposalId);

        vm.prank(voter1);
        hub.castQuadraticVote(proposalId, true);

        uint256 votedWeight = hub.hasVoted(proposalId, voter1);
        // voter1 has 10,000 ether VIBE, sqrt(10000e18) should be much less than 10000e18
        assertTrue(votedWeight > 0);
        assertTrue(votedWeight < 10_000 ether);
    }

    function test_castQuadraticVote_revertsDoubleVote() public {
        uint256 proposalId = _createQuadraticProposal();
        _activateProposal(proposalId);

        vm.prank(voter1);
        hub.castQuadraticVote(proposalId, true);

        vm.prank(voter1);
        vm.expectRevert(
            abi.encodeWithSelector(
                VibeGovernanceHub.AlreadyVoted.selector,
                proposalId,
                voter1
            )
        );
        hub.castQuadraticVote(proposalId, true);
    }

    // ============ Commit-Reveal Voting ============

    function test_commitReveal_fullLifecycle() public {
        uint256 proposalId = _createCommitRevealProposal();
        _activateProposal(proposalId);

        // Commit
        bytes32 salt = bytes32("voter1salt");
        bytes32 commitHash = keccak256(abi.encodePacked(proposalId, true, salt));

        vm.prank(voter1);
        hub.commitVote(proposalId, commitHash);

        // Check commit recorded
        (bytes32 storedHash,,,) = hub.commitBallots(proposalId, voter1);
        assertEq(storedHash, commitHash);

        // Advance past voting period (5 days for commit-reveal)
        vm.warp(block.timestamp + 5 days + 1);

        // Reveal
        vm.prank(voter1);
        hub.revealVote(proposalId, true, salt);

        (,, bool revealed, bool supported) = hub.commitBallots(proposalId, voter1);
        assertTrue(revealed);
        assertTrue(supported);
    }

    function test_commitReveal_revertsDoubleCommit() public {
        uint256 proposalId = _createCommitRevealProposal();
        _activateProposal(proposalId);

        bytes32 salt = bytes32("salt1");
        bytes32 commitHash = keccak256(abi.encodePacked(proposalId, true, salt));

        vm.prank(voter1);
        hub.commitVote(proposalId, commitHash);

        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.CommitAlreadyMade.selector);
        hub.commitVote(proposalId, commitHash);
    }

    function test_commitReveal_revertsRevealBeforeDeadline() public {
        uint256 proposalId = _createCommitRevealProposal();
        _activateProposal(proposalId);

        bytes32 salt = bytes32("salt1");
        bytes32 commitHash = keccak256(abi.encodePacked(proposalId, true, salt));
        vm.prank(voter1);
        hub.commitVote(proposalId, commitHash);

        // Try to reveal before voting ends
        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.RevealWindowNotOpen.selector);
        hub.revealVote(proposalId, true, salt);
    }

    function test_commitReveal_revertsRevealAfterWindow() public {
        uint256 proposalId = _createCommitRevealProposal();
        _activateProposal(proposalId);

        bytes32 salt = bytes32("salt1");
        bytes32 commitHash = keccak256(abi.encodePacked(proposalId, true, salt));
        vm.prank(voter1);
        hub.commitVote(proposalId, commitHash);

        // Advance past reveal window (5 days voting + 1 day reveal)
        vm.warp(block.timestamp + 5 days + 1 days + 1);

        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.RevealWindowClosed.selector);
        hub.revealVote(proposalId, true, salt);
    }

    function test_commitReveal_revertsRevealMismatch() public {
        uint256 proposalId = _createCommitRevealProposal();
        _activateProposal(proposalId);

        bytes32 salt = bytes32("salt1");
        bytes32 commitHash = keccak256(abi.encodePacked(proposalId, true, salt));
        vm.prank(voter1);
        hub.commitVote(proposalId, commitHash);

        // Advance to reveal window
        vm.warp(block.timestamp + 5 days + 1);

        // Reveal with wrong support value
        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.RevealMismatch.selector);
        hub.revealVote(proposalId, false, salt); // committed true, revealing false
    }

    // ============ Conviction Voting ============

    function test_conviction_signalAndWithdraw() public {
        uint256 proposalId = _createConvictionProposal();
        _activateProposal(proposalId);

        uint256 stakeAmount = 1000 ether;
        vm.startPrank(voter1);
        vibe.approve(address(hub), stakeAmount);
        hub.signalConviction(proposalId, stakeAmount);
        vm.stopPrank();

        uint256 staked = hub.convictionStake(proposalId, voter1);
        assertEq(staked, stakeAmount);

        // Advance time for conviction to accrue
        vm.warp(block.timestamp + 7 days);

        // Withdraw
        vm.prank(voter1);
        hub.withdrawConviction(proposalId);

        staked = hub.convictionStake(proposalId, voter1);
        assertEq(staked, 0);
        assertEq(vibe.balanceOf(voter1), 10_000 ether); // Full balance restored
    }

    function test_conviction_revertsNoStake() public {
        uint256 proposalId = _createConvictionProposal();
        _activateProposal(proposalId);

        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.NoConvictionStake.selector);
        hub.withdrawConviction(proposalId);
    }

    // ============ Delegation ============

    function test_delegate_delegatesToAnother() public {
        vm.prank(voter1);
        hub.delegate(voter2);

        (address delegatee,) = hub.delegations(voter1);
        assertEq(delegatee, voter2);

        // voter2 now has delegated weight
        uint256 dWeight = hub.delegatedWeight(voter2);
        assertTrue(dWeight > 0);
    }

    function test_delegate_revokeDelegation() public {
        vm.prank(voter1);
        hub.delegate(voter2);

        // Revoke by delegating to address(0)
        vm.prank(voter1);
        hub.delegate(address(0));

        (address delegatee,) = hub.delegations(voter1);
        assertEq(delegatee, address(0));
    }

    function test_delegate_revertsSelfDelegation() public {
        vm.prank(voter1);
        vm.expectRevert(VibeGovernanceHub.SelfDelegation.selector);
        hub.delegate(voter1);
    }

    // ============ Proposal State Machine ============

    function test_state_draftBeforeActivation() public {
        uint256 proposalId = _createTokenProposal(false);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.DRAFT));
    }

    function test_state_activeDuringVoting() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.ACTIVE));
    }

    function test_state_failedNoQuorum() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        // Advance past voting period without any votes
        vm.warp(block.timestamp + 7 days + 1);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.FAILED));
    }

    function test_state_passedWithMajorityAndQuorum() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        // All 3 voters vote for (30,000 out of 1,030,000 total supply)
        // Need 10% quorum = 103,000 ether. With only 30,000 ether votes this won't reach quorum.
        // Mint more VIBE to voter1 to ensure quorum
        vibe.mint(voter1, 200_000 ether); // voter1 now has 210,000 VIBE

        vm.prank(voter1);
        hub.castVote(proposalId, true);

        // Advance past voting
        vm.warp(block.timestamp + 7 days + 1);

        // Total supply = 1,000,000 + 30,000 + 200,000 = 1,230,000
        // voter1 weight = 210,000 ether. 10% quorum = 123,000. 210,000 > 123,000 -> quorum met
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.PASSED));
    }

    // ============ Proposal Queue and Execution ============

    function test_queue_setsExecutionTime() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vibe.mint(voter1, 200_000 ether);
        vm.prank(voter1);
        hub.castVote(proposalId, true);

        vm.warp(block.timestamp + 7 days + 1);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.PASSED));

        hub.queue(proposalId);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.QUEUED));
    }

    function test_execute_afterTimelock() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vibe.mint(voter1, 200_000 ether);
        vm.prank(voter1);
        hub.castVote(proposalId, true);

        vm.warp(block.timestamp + 7 days + 1);
        hub.queue(proposalId);

        vm.warp(block.timestamp + STANDARD_TIMELOCK);
        hub.execute(proposalId);

        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.EXECUTED));
        assertEq(target.value(), 42);
    }

    function test_execute_revertsBeforeTimelock() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vibe.mint(voter1, 200_000 ether);
        vm.prank(voter1);
        hub.castVote(proposalId, true);

        vm.warp(block.timestamp + 7 days + 1);
        hub.queue(proposalId);

        vm.expectRevert();
        hub.execute(proposalId);
    }

    function test_execute_emergencyHasShorterTimelock() public {
        uint256 proposalId = _createTokenProposal(true); // emergency = true
        _activateProposal(proposalId);

        vibe.mint(voter1, 1_000_000 ether); // Need 60% quorum for emergency
        vm.prank(voter1);
        hub.castVote(proposalId, true);

        vm.warp(block.timestamp + 7 days + 1);
        hub.queue(proposalId);

        // Emergency timelock is 6 hours
        vm.warp(block.timestamp + EMERGENCY_TIMELOCK);
        hub.execute(proposalId);

        assertEq(target.value(), 42);
    }

    // ============ Security Council Veto ============

    function test_veto_securityCouncilCanVeto() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vm.prank(securityCouncil);
        hub.veto(proposalId);

        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.VETOED));
    }

    function test_veto_revertsNotSecurityCouncil() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vm.prank(nobody);
        vm.expectRevert(VibeGovernanceHub.NotSecurityCouncil.selector);
        hub.veto(proposalId);
    }

    function test_veto_revertsAfterSunset() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        // Warp past veto sunset (2 years)
        vm.warp(block.timestamp + VETO_SUNSET + 1);

        vm.prank(securityCouncil);
        vm.expectRevert(VibeGovernanceHub.VetoSunsetPassed.selector);
        hub.veto(proposalId);
    }

    function test_isVetoActive_beforeAndAfterSunset() public {
        assertTrue(hub.isVetoActive());

        vm.warp(block.timestamp + VETO_SUNSET + 1);
        assertFalse(hub.isVetoActive());
    }

    // ============ Cancellation ============

    function test_cancel_proposerCanCancel() public {
        uint256 proposalId = _createTokenProposal(false);

        vm.prank(voter1);
        hub.cancel(proposalId);

        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.CANCELLED));
    }

    function test_cancel_ownerCanCancel() public {
        uint256 proposalId = _createTokenProposal(false);

        vm.prank(owner);
        hub.cancel(proposalId);

        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.CANCELLED));
    }

    function test_cancel_revertsUnauthorized() public {
        uint256 proposalId = _createTokenProposal(false);

        vm.prank(nobody);
        vm.expectRevert("Not authorized");
        hub.cancel(proposalId);
    }

    function test_cancel_cannotCancelExecuted() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vibe.mint(voter1, 200_000 ether);
        vm.prank(voter1);
        hub.castVote(proposalId, true);

        vm.warp(block.timestamp + 7 days + 1);
        hub.queue(proposalId);

        vm.warp(block.timestamp + STANDARD_TIMELOCK);
        hub.execute(proposalId);

        vm.prank(owner);
        vm.expectRevert("Terminal state");
        hub.cancel(proposalId);
    }

    // ============ Cross-Chain Governance ============

    function test_crossChainVote_receivesVote() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        address endpoint = makeAddr("lzEndpoint");
        vm.prank(owner);
        hub.setCrossChainEndpoint(endpoint);

        vm.prank(owner);
        hub.setTrustedRemote(42161, makeAddr("arbitrumRemote"));

        vm.prank(endpoint);
        hub.receiveCrossChainVote(42161, proposalId, 5000 ether, true);

        (,,,,uint256 votesFor,,,,,,,,,,,) = hub.proposals(proposalId);
        assertEq(votesFor, 5000 ether);
    }

    function test_crossChainVote_revertsNotEndpoint() public {
        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vm.prank(nobody);
        vm.expectRevert(VibeGovernanceHub.NotCrossChainEndpoint.selector);
        hub.receiveCrossChainVote(42161, proposalId, 5000 ether, true);
    }

    // ============ Admin Functions ============

    function test_setGovernanceConfig_updatesConfig() public {
        vm.prank(owner);
        hub.setGovernanceConfig(
            VibeGovernanceHub.GovernanceType.TOKEN,
            14 days,
            2000,
            72 hours,
            true
        );

        (uint256 votingPeriod, uint256 quorumBps, uint256 timelockDelay, bool enabled) =
            hub.govConfigs(VibeGovernanceHub.GovernanceType.TOKEN);
        assertEq(votingPeriod, 14 days);
        assertEq(quorumBps, 2000);
        assertEq(timelockDelay, 72 hours);
        assertTrue(enabled);
    }

    function test_setGovernanceConfig_revertsNotOwner() public {
        vm.prank(nobody);
        vm.expectRevert();
        hub.setGovernanceConfig(VibeGovernanceHub.GovernanceType.TOKEN, 14 days, 2000, 72 hours, true);
    }

    function test_setProposalThreshold_updates() public {
        vm.prank(owner);
        hub.setProposalThreshold(5000 ether);
        assertEq(hub.proposalThreshold(), 5000 ether);
    }

    function test_setSecurityCouncil_updates() public {
        address newCouncil = makeAddr("newCouncil");
        vm.prank(owner);
        hub.setSecurityCouncil(newCouncil);
        assertEq(hub.securityCouncil(), newCouncil);
    }

    // ============ View Functions ============

    function test_getVoteWeight_usesVibeBalance() public view {
        uint256 weight = hub.getVoteWeight(voter1);
        assertEq(weight, 10_000 ether);
    }

    function test_getVoteWeight_includesStVibeBalance() public {
        stVibe.mint(voter1, 5000 ether);
        uint256 weight = hub.getVoteWeight(voter1);
        assertEq(weight, 15_000 ether); // 10,000 VIBE + 5,000 stVIBE
    }

    function test_getEffectiveWeight_includesDelegated() public {
        // voter1 delegates to voter2
        vm.prank(voter1);
        hub.delegate(voter2);

        uint256 effectiveWeight = hub.getEffectiveWeight(voter2);
        // voter2's own weight (10,000) + voter1's delegated weight (10,000)
        assertEq(effectiveWeight, 20_000 ether);

        // voter1's effective weight is 0 (delegated away)
        uint256 voter1Effective = hub.getEffectiveWeight(voter1);
        assertEq(voter1Effective, 0);
    }

    function test_getProposalActions_returnsCorrectly() public {
        uint256 proposalId = _createTokenProposal(false);

        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) =
            hub.getProposalActions(proposalId);
        assertEq(targets.length, 1);
        assertEq(targets[0], address(target));
        assertEq(values[0], 0);
        assertEq(calldatas[0], abi.encodeCall(MockGovTarget.setValue, (42)));
    }

    // ============ Full Lifecycle — End to End ============

    function test_fullLifecycle_tokenVoting() public {
        // 1. Propose
        uint256 proposalId = _createTokenProposal(false);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.DRAFT));

        // 2. Activate
        _activateProposal(proposalId);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.ACTIVE));

        // 3. Vote (ensure quorum)
        vibe.mint(voter1, 200_000 ether);
        vm.prank(voter1);
        hub.castVote(proposalId, true);
        vm.prank(voter2);
        hub.castVote(proposalId, true);

        // 4. Finalize
        vm.warp(block.timestamp + 7 days + 1);
        hub.finalizeVoting(proposalId);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.PASSED));

        // 5. Queue
        hub.queue(proposalId);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.QUEUED));

        // 6. Execute
        vm.warp(block.timestamp + STANDARD_TIMELOCK);
        hub.execute(proposalId);
        assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.EXECUTED));
        assertEq(target.value(), 42);
    }

    // ============ Fuzz Tests ============

    function testFuzz_proposalThreshold(uint256 balance) public {
        balance = bound(balance, 0, 100_000 ether);
        address fuzzVoter = makeAddr("fuzzVoter");
        vibe.mint(fuzzVoter, balance);

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(MockGovTarget.setValue, (1));

        vm.prank(fuzzVoter);
        if (balance < PROPOSAL_THRESHOLD) {
            vm.expectRevert();
            hub.propose(VibeGovernanceHub.GovernanceType.TOKEN, "Fuzz", targets, values, calldatas, false);
        } else {
            uint256 proposalId = hub.propose(VibeGovernanceHub.GovernanceType.TOKEN, "Fuzz", targets, values, calldatas, false);
            assertTrue(proposalId > 0);
        }
    }

    function testFuzz_vetoSunset(uint256 timeOffset) public {
        timeOffset = bound(timeOffset, 0, 4 * 365 days);

        uint256 proposalId = _createTokenProposal(false);
        _activateProposal(proposalId);

        vm.warp(block.timestamp + timeOffset);

        vm.prank(securityCouncil);
        if (timeOffset > VETO_SUNSET) {
            vm.expectRevert(VibeGovernanceHub.VetoSunsetPassed.selector);
            hub.veto(proposalId);
        } else {
            hub.veto(proposalId);
            assertEq(uint8(hub.state(proposalId)), uint8(VibeGovernanceHub.ProposalState.VETOED));
        }
    }
}
