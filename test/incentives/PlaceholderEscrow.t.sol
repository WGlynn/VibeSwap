// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/PlaceholderEscrow.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockPairwiseVerifier {
    mapping(bytes32 => address) public winners;
    mapping(bytes32 => bool) public settled;

    function setTaskResult(bytes32 taskId, address winner, bool isSettled) external {
        winners[taskId] = winner;
        settled[taskId] = isSettled;
    }

    function getTaskResult(bytes32 taskId) external view returns (address winner, bool isSettled) {
        return (winners[taskId], settled[taskId]);
    }
}

// ============ PlaceholderEscrow Tests ============

contract PlaceholderEscrowTest is Test {
    PlaceholderEscrow public escrow;
    MockVIBE public vibe;
    MockPairwiseVerifier public verifier;

    address public owner;
    address public recorder1;
    address public recorder2;
    address public handshakeVerifier1;
    address public handshakeVerifier2;
    address public alice;   // wallet claiming VIBE
    address public bob;     // another wallet
    address public unauthorized;

    // ============ Events (re-declared for expectEmit) ============

    event PlaceholderCreated(bytes32 indexed identityHash, string platform, string username);
    event VibeAccrued(bytes32 indexed identityHash, uint256 amount, string reason);
    event ClaimedViaCRPC(bytes32 indexed identityHash, address indexed wallet, uint256 amount, bytes32 crpcTaskId);
    event ClaimedViaHandshake(bytes32 indexed identityHash, address indexed wallet, uint256 amount, address verifier_);
    event ClaimedViaGovernance(bytes32 indexed identityHash, address indexed wallet, uint256 amount);
    event RecorderUpdated(address indexed recorder, bool authorized);
    event HandshakeVerifierUpdated(address indexed verifier_, bool authorized);
    event GovernanceProposalCreated(bytes32 indexed identityHash, address proposedWallet, string evidence);

    function setUp() public {
        owner = address(this);
        recorder1 = makeAddr("recorder1");
        recorder2 = makeAddr("recorder2");
        handshakeVerifier1 = makeAddr("handshakeVerifier1");
        handshakeVerifier2 = makeAddr("handshakeVerifier2");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        unauthorized = makeAddr("unauthorized");

        // Deploy mocks
        vibe = new MockVIBE();
        verifier = new MockPairwiseVerifier();

        // Deploy escrow behind UUPS proxy
        PlaceholderEscrow impl = new PlaceholderEscrow();
        bytes memory initData = abi.encodeWithSelector(
            PlaceholderEscrow.initialize.selector,
            owner,
            address(vibe),
            address(verifier)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        escrow = PlaceholderEscrow(address(proxy));

        // Setup recorders and verifiers
        escrow.setRecorder(recorder1, true);
        escrow.setRecorder(recorder2, true);
        escrow.setHandshakeVerifier(handshakeVerifier1, true);
        escrow.setHandshakeVerifier(handshakeVerifier2, true);

        // Fund escrow with VIBE for claims
        vibe.mint(address(escrow), 1_000_000e18);
    }

    // ============ Helpers ============

    function _createAndAccrue(
        string memory platform,
        string memory username,
        uint256 amount
    ) internal returns (bytes32 identityHash) {
        vm.prank(recorder1);
        identityHash = escrow.createPlaceholder(platform, username);

        if (amount > 0) {
            vm.prank(recorder1);
            escrow.accrueVibe(identityHash, amount, "test accrual");
        }
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(escrow.owner(), owner);
    }

    function test_initialize_setsVibeToken() public view {
        assertEq(escrow.vibeToken(), address(vibe));
    }

    function test_initialize_setsPairwiseVerifier() public view {
        assertEq(escrow.pairwiseVerifier(), address(verifier));
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        escrow.initialize(owner, address(vibe), address(verifier));
    }

    // ============ Admin: Recorders ============

    function test_setRecorder_grantsAccess() public {
        address newRecorder = makeAddr("newRecorder");
        escrow.setRecorder(newRecorder, true);
        assertTrue(escrow.recorders(newRecorder));
    }

    function test_setRecorder_revokesAccess() public {
        escrow.setRecorder(recorder1, false);
        assertFalse(escrow.recorders(recorder1));
    }

    function test_setRecorder_emitsEvent() public {
        address newRecorder = makeAddr("newRecorder");
        vm.expectEmit(true, false, false, true);
        emit RecorderUpdated(newRecorder, true);
        escrow.setRecorder(newRecorder, true);
    }

    function test_setRecorder_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        escrow.setRecorder(unauthorized, true);
    }

    // ============ Admin: Handshake Verifiers ============

    function test_setHandshakeVerifier_grantsAccess() public {
        address newVerifier = makeAddr("newVerifier");
        escrow.setHandshakeVerifier(newVerifier, true);
        assertTrue(escrow.handshakeVerifiers(newVerifier));
    }

    function test_setHandshakeVerifier_emitsEvent() public {
        address newVerifier = makeAddr("newVerifier");
        vm.expectEmit(true, false, false, true);
        emit HandshakeVerifierUpdated(newVerifier, true);
        escrow.setHandshakeVerifier(newVerifier, true);
    }

    function test_setHandshakeVerifier_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        escrow.setHandshakeVerifier(unauthorized, true);
    }

    // ============ Admin: PairwiseVerifier ============

    function test_setPairwiseVerifier_updates() public {
        address newPV = makeAddr("newPV");
        escrow.setPairwiseVerifier(newPV);
        assertEq(escrow.pairwiseVerifier(), newPV);
    }

    function test_setPairwiseVerifier_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        escrow.setPairwiseVerifier(unauthorized);
    }

    // ============ Placeholder Creation ============

    function test_createPlaceholder_createsAccount() public {
        vm.prank(recorder1);
        bytes32 id = escrow.createPlaceholder("github", "willg");

        bytes32 expectedHash = keccak256(abi.encodePacked("github", ":", "willg"));
        assertEq(id, expectedHash);

        (string memory platform, string memory username, uint256 vibeAccrued,
         bool claimed, address claimedBy, uint256 accrualCount) = escrow.getPlaceholder(id);

        assertEq(platform, "github");
        assertEq(username, "willg");
        assertEq(vibeAccrued, 0);
        assertFalse(claimed);
        assertEq(claimedBy, address(0));
        assertEq(accrualCount, 0);
    }

    function test_createPlaceholder_emitsEvent() public {
        bytes32 expectedHash = keccak256(abi.encodePacked("github", ":", "willg"));

        vm.expectEmit(true, false, false, true);
        emit PlaceholderCreated(expectedHash, "github", "willg");

        vm.prank(recorder1);
        escrow.createPlaceholder("github", "willg");
    }

    function test_createPlaceholder_idempotent() public {
        vm.startPrank(recorder1);
        bytes32 id1 = escrow.createPlaceholder("github", "willg");
        bytes32 id2 = escrow.createPlaceholder("github", "willg");
        vm.stopPrank();

        assertEq(id1, id2);
        assertEq(escrow.placeholderCount(), 1); // only one entry
    }

    function test_createPlaceholder_ownerCanCreate() public {
        // Owner should be able to create even without being a recorder
        bytes32 id = escrow.createPlaceholder("telegram", "willg");
        assertTrue(id != bytes32(0));
    }

    function test_createPlaceholder_revertsUnauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(PlaceholderEscrow.Unauthorized.selector);
        escrow.createPlaceholder("github", "willg");
    }

    function test_createPlaceholder_multiplePlatforms() public {
        vm.startPrank(recorder1);
        bytes32 gh = escrow.createPlaceholder("github", "willg");
        bytes32 tg = escrow.createPlaceholder("telegram", "willg");
        bytes32 tw = escrow.createPlaceholder("twitter", "willg");
        vm.stopPrank();

        // Different platforms = different identity hashes
        assertTrue(gh != tg);
        assertTrue(tg != tw);
        assertEq(escrow.placeholderCount(), 3);
    }

    // ============ VIBE Accrual ============

    function test_accrueVibe_addsToBalance() public {
        bytes32 id = _createAndAccrue("github", "willg", 0);

        vm.prank(recorder1);
        escrow.accrueVibe(id, 100e18, "commit fix");

        (, , uint256 vibeAccrued, , , uint256 accrualCount) = escrow.getPlaceholder(id);
        assertEq(vibeAccrued, 100e18);
        assertEq(accrualCount, 1);
    }

    function test_accrueVibe_accumulates() public {
        bytes32 id = _createAndAccrue("github", "willg", 0);

        vm.startPrank(recorder1);
        escrow.accrueVibe(id, 100e18, "commit 1");
        escrow.accrueVibe(id, 200e18, "commit 2");
        escrow.accrueVibe(id, 50e18, "commit 3");
        vm.stopPrank();

        (, , uint256 vibeAccrued, , , uint256 accrualCount) = escrow.getPlaceholder(id);
        assertEq(vibeAccrued, 350e18);
        assertEq(accrualCount, 3);
    }

    function test_accrueVibe_emitsEvent() public {
        bytes32 id = _createAndAccrue("github", "willg", 0);

        vm.expectEmit(true, false, false, true);
        emit VibeAccrued(id, 100e18, "commit fix");

        vm.prank(recorder1);
        escrow.accrueVibe(id, 100e18, "commit fix");
    }

    function test_accrueVibe_revertsZeroAmount() public {
        bytes32 id = _createAndAccrue("github", "willg", 0);

        vm.prank(recorder1);
        vm.expectRevert(PlaceholderEscrow.ZeroAmount.selector);
        escrow.accrueVibe(id, 0, "nothing");
    }

    function test_accrueVibe_revertsIdentityNotFound() public {
        bytes32 fakeId = keccak256("nonexistent");

        vm.prank(recorder1);
        vm.expectRevert(PlaceholderEscrow.IdentityNotFound.selector);
        escrow.accrueVibe(fakeId, 100e18, "reason");
    }

    function test_accrueVibe_revertsAfterClaim() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);

        // Claim via handshake
        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);

        // Try to accrue more
        vm.prank(recorder1);
        vm.expectRevert(PlaceholderEscrow.AlreadyClaimed.selector);
        escrow.accrueVibe(id, 100e18, "post-claim");
    }

    function test_accrueVibe_revertsUnauthorized() public {
        bytes32 id = _createAndAccrue("github", "willg", 0);

        vm.prank(unauthorized);
        vm.expectRevert(PlaceholderEscrow.Unauthorized.selector);
        escrow.accrueVibe(id, 100e18, "hack attempt");
    }

    function test_accrueVibe_multipleRecordersCanAccrue() public {
        bytes32 id = _createAndAccrue("github", "willg", 0);

        vm.prank(recorder1);
        escrow.accrueVibe(id, 100e18, "from recorder1");

        vm.prank(recorder2);
        escrow.accrueVibe(id, 200e18, "from recorder2");

        (, , uint256 vibeAccrued, , , ) = escrow.getPlaceholder(id);
        assertEq(vibeAccrued, 300e18);
    }

    // ============ Claim Path 1: CRPC ============

    function test_claimViaCRPC_transfersVibe() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);

        // Setup CRPC verification
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, true);

        uint256 balanceBefore = vibe.balanceOf(alice);

        escrow.claimViaCRPC(id, taskId, alice);

        uint256 balanceAfter = vibe.balanceOf(alice);
        assertEq(balanceAfter - balanceBefore, 500e18);
    }

    function test_claimViaCRPC_marksAsClaimed() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, true);

        escrow.claimViaCRPC(id, taskId, alice);

        (, , , bool claimed, address claimedBy, ) = escrow.getPlaceholder(id);
        assertTrue(claimed);
        assertEq(claimedBy, alice);
    }

    function test_claimViaCRPC_setsWalletMapping() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, true);

        escrow.claimViaCRPC(id, taskId, alice);

        assertEq(escrow.walletToIdentity(alice), id);
    }

    function test_claimViaCRPC_emitsEvent() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, true);

        vm.expectEmit(true, true, false, true);
        emit ClaimedViaCRPC(id, alice, 500e18, taskId);
        escrow.claimViaCRPC(id, taskId, alice);
    }

    function test_claimViaCRPC_revertsZeroWallet() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, address(0), true);

        vm.expectRevert(PlaceholderEscrow.InvalidWallet.selector);
        escrow.claimViaCRPC(id, taskId, address(0));
    }

    function test_claimViaCRPC_revertsIdentityNotFound() public {
        bytes32 fakeId = keccak256("nonexistent");
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, true);

        vm.expectRevert(PlaceholderEscrow.IdentityNotFound.selector);
        escrow.claimViaCRPC(fakeId, taskId, alice);
    }

    function test_claimViaCRPC_revertsAlreadyClaimed() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, true);

        escrow.claimViaCRPC(id, taskId, alice);

        // Second claim attempt
        vm.expectRevert(PlaceholderEscrow.AlreadyClaimed.selector);
        escrow.claimViaCRPC(id, taskId, alice);
    }

    function test_claimViaCRPC_revertsCRPCNotSettled() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, false); // NOT settled

        vm.expectRevert(PlaceholderEscrow.CRPCNotSettled.selector);
        escrow.claimViaCRPC(id, taskId, alice);
    }

    function test_claimViaCRPC_revertsCRPCWalletMismatch() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);
        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, bob, true); // winner is bob, not alice

        vm.expectRevert(PlaceholderEscrow.CRPCWalletMismatch.selector);
        escrow.claimViaCRPC(id, taskId, alice);
    }

    function test_claimViaCRPC_worksWithZeroBalance() public {
        bytes32 id = _createAndAccrue("github", "willg", 0); // 0 VIBE accrued

        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, true);

        // Should not revert, just transfers 0
        escrow.claimViaCRPC(id, taskId, alice);

        (, , , bool claimed, , ) = escrow.getPlaceholder(id);
        assertTrue(claimed);
        assertEq(vibe.balanceOf(alice), 0);
    }

    // ============ Claim Path 2: Handshake ============

    function test_claimViaHandshake_transfersVibe() public {
        bytes32 id = _createAndAccrue("github", "willg", 300e18);

        uint256 balanceBefore = vibe.balanceOf(alice);

        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);

        assertEq(vibe.balanceOf(alice) - balanceBefore, 300e18);
    }

    function test_claimViaHandshake_marksAsClaimed() public {
        bytes32 id = _createAndAccrue("github", "willg", 300e18);

        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);

        (, , , bool claimed, address claimedBy, ) = escrow.getPlaceholder(id);
        assertTrue(claimed);
        assertEq(claimedBy, alice);
    }

    function test_claimViaHandshake_setsWalletMapping() public {
        bytes32 id = _createAndAccrue("github", "willg", 300e18);

        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);

        assertEq(escrow.walletToIdentity(alice), id);
    }

    function test_claimViaHandshake_emitsEvent() public {
        bytes32 id = _createAndAccrue("github", "willg", 300e18);

        vm.expectEmit(true, true, false, true);
        emit ClaimedViaHandshake(id, alice, 300e18, handshakeVerifier1);

        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);
    }

    function test_claimViaHandshake_revertsUnauthorized() public {
        bytes32 id = _createAndAccrue("github", "willg", 300e18);

        vm.prank(unauthorized);
        vm.expectRevert(PlaceholderEscrow.Unauthorized.selector);
        escrow.claimViaHandshake(id, alice);
    }

    function test_claimViaHandshake_revertsZeroWallet() public {
        bytes32 id = _createAndAccrue("github", "willg", 300e18);

        vm.prank(handshakeVerifier1);
        vm.expectRevert(PlaceholderEscrow.InvalidWallet.selector);
        escrow.claimViaHandshake(id, address(0));
    }

    function test_claimViaHandshake_revertsAlreadyClaimed() public {
        bytes32 id = _createAndAccrue("github", "willg", 300e18);

        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);

        vm.prank(handshakeVerifier2);
        vm.expectRevert(PlaceholderEscrow.AlreadyClaimed.selector);
        escrow.claimViaHandshake(id, bob);
    }

    function test_claimViaHandshake_revertsIdentityNotFound() public {
        bytes32 fakeId = keccak256("nonexistent");

        vm.prank(handshakeVerifier1);
        vm.expectRevert(PlaceholderEscrow.IdentityNotFound.selector);
        escrow.claimViaHandshake(fakeId, alice);
    }

    // ============ Claim Path 3: Governance ============

    function test_proposeGovernanceClaim_createsProposal() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);

        escrow.proposeGovernanceClaim(id, alice, "ipfs://evidence-hash");

        // Proposal exists (no direct getter for all fields, but no revert means success)
        // The proposal is created, verified by executing later
    }

    function test_proposeGovernanceClaim_emitsEvent() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);

        vm.expectEmit(true, false, false, true);
        emit GovernanceProposalCreated(id, alice, "ipfs://evidence");
        escrow.proposeGovernanceClaim(id, alice, "ipfs://evidence");
    }

    function test_proposeGovernanceClaim_revertsZeroWallet() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);

        vm.expectRevert(PlaceholderEscrow.InvalidWallet.selector);
        escrow.proposeGovernanceClaim(id, address(0), "evidence");
    }

    function test_proposeGovernanceClaim_revertsIdentityNotFound() public {
        vm.expectRevert(PlaceholderEscrow.IdentityNotFound.selector);
        escrow.proposeGovernanceClaim(keccak256("fake"), alice, "evidence");
    }

    function test_proposeGovernanceClaim_revertsAlreadyClaimed() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);

        // Claim via handshake first
        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);

        vm.expectRevert(PlaceholderEscrow.AlreadyClaimed.selector);
        escrow.proposeGovernanceClaim(id, bob, "evidence");
    }

    // ============ Governance Voting ============

    function test_voteOnProposal_recordsVote() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);

        // Create proposal — need the proposalId
        uint256 proposalTimestamp = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, proposalTimestamp));

        // Vote for
        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 100);

        // Vote against
        vm.prank(handshakeVerifier2);
        escrow.voteOnProposal(proposalId, false, 30);

        // Check via proposal mapping — votesFor/votesAgainst
        (,,,,,,bool executed,) = escrow.proposals(proposalId);
        assertFalse(executed);
    }

    function test_voteOnProposal_revertsUnauthorized() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        vm.prank(unauthorized);
        vm.expectRevert(PlaceholderEscrow.Unauthorized.selector);
        escrow.voteOnProposal(proposalId, true, 100);
    }

    function test_voteOnProposal_revertsAfterDeadline() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        // Warp past deadline (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(handshakeVerifier1);
        vm.expectRevert(PlaceholderEscrow.ProposalNotExpired.selector);
        escrow.voteOnProposal(proposalId, true, 100);
    }

    function test_voteOnProposal_revertsNonexistentProposal() public {
        bytes32 fakeProposalId = keccak256("fake-proposal");

        vm.prank(handshakeVerifier1);
        vm.expectRevert(PlaceholderEscrow.IdentityNotFound.selector);
        escrow.voteOnProposal(fakeProposalId, true, 100);
    }

    // ============ Governance Execution ============

    function test_executeProposal_transfersVibeOnApproval() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        // Vote: 70 for, 30 against = 70% > 66% threshold
        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 70);
        vm.prank(handshakeVerifier2);
        escrow.voteOnProposal(proposalId, false, 30);

        // Warp past deadline
        vm.warp(block.timestamp + 7 days);

        uint256 balanceBefore = vibe.balanceOf(alice);
        escrow.executeProposal(proposalId);
        assertEq(vibe.balanceOf(alice) - balanceBefore, 1000e18);
    }

    function test_executeProposal_marksAccountClaimed() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 100);

        vm.warp(block.timestamp + 7 days);
        escrow.executeProposal(proposalId);

        (, , , bool claimed, address claimedBy, ) = escrow.getPlaceholder(id);
        assertTrue(claimed);
        assertEq(claimedBy, alice);
    }

    function test_executeProposal_setsWalletMapping() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 100);

        vm.warp(block.timestamp + 7 days);
        escrow.executeProposal(proposalId);

        assertEq(escrow.walletToIdentity(alice), id);
    }

    function test_executeProposal_emitsEvent() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 100);

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, true, false, true);
        emit ClaimedViaGovernance(id, alice, 1000e18);
        escrow.executeProposal(proposalId);
    }

    function test_executeProposal_revertsBeforeDeadline() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 100);

        // Don't warp — still before deadline
        vm.expectRevert(PlaceholderEscrow.ProposalNotExpired.selector);
        escrow.executeProposal(proposalId);
    }

    function test_executeProposal_revertsInsufficientVotes_noVotes() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        vm.warp(block.timestamp + 7 days);

        // No votes cast
        vm.expectRevert(PlaceholderEscrow.InsufficientVotes.selector);
        escrow.executeProposal(proposalId);
    }

    function test_executeProposal_revertsInsufficientVotes_belowThreshold() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        // Vote: 60 for, 40 against = 60% < 66% threshold
        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 60);
        vm.prank(handshakeVerifier2);
        escrow.voteOnProposal(proposalId, false, 40);

        vm.warp(block.timestamp + 7 days);

        vm.expectRevert(PlaceholderEscrow.InsufficientVotes.selector);
        escrow.executeProposal(proposalId);
    }

    function test_executeProposal_revertsAlreadyExecuted() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 100);

        vm.warp(block.timestamp + 7 days);
        escrow.executeProposal(proposalId);

        vm.expectRevert(PlaceholderEscrow.ProposalAlreadyExecuted.selector);
        escrow.executeProposal(proposalId);
    }

    function test_executeProposal_exactThreshold66Percent() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        // 66% exactly = 6600 BPS. 66 for, 34 against = 6600 / 10000 = exactly 66%
        // Actually: (66 * 10000) / 100 = 6600, which == GOVERNANCE_APPROVAL_THRESHOLD
        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 66);
        vm.prank(handshakeVerifier2);
        escrow.voteOnProposal(proposalId, false, 34);

        vm.warp(block.timestamp + 7 days);

        // Exactly at threshold — should pass
        escrow.executeProposal(proposalId);

        (, , , bool claimed, , ) = escrow.getPlaceholder(id);
        assertTrue(claimed);
    }

    function test_executeProposal_justBelowThresholdFails() public {
        bytes32 id = _createAndAccrue("github", "willg", 1000e18);
        uint256 ts = block.timestamp;
        escrow.proposeGovernanceClaim(id, alice, "evidence");
        bytes32 proposalId = keccak256(abi.encodePacked(id, alice, ts));

        // 6599 / 10000 = 65.99% < 66%
        // Need: (votesFor * 10000) / totalVotes < 6600
        // 6599 for, 3401 against: (6599 * 10000) / 10000 = 6599 < 6600
        vm.prank(handshakeVerifier1);
        escrow.voteOnProposal(proposalId, true, 6599);
        vm.prank(handshakeVerifier2);
        escrow.voteOnProposal(proposalId, false, 3401);

        vm.warp(block.timestamp + 7 days);

        vm.expectRevert(PlaceholderEscrow.InsufficientVotes.selector);
        escrow.executeProposal(proposalId);
    }

    // ============ View Functions ============

    function test_getIdentityHash_deterministic() public view {
        bytes32 h1 = escrow.getIdentityHash("github", "willg");
        bytes32 h2 = escrow.getIdentityHash("github", "willg");
        assertEq(h1, h2);
        assertEq(h1, keccak256(abi.encodePacked("github", ":", "willg")));
    }

    function test_getIdentityHash_differentForDifferentInputs() public view {
        bytes32 h1 = escrow.getIdentityHash("github", "willg");
        bytes32 h2 = escrow.getIdentityHash("twitter", "willg");
        bytes32 h3 = escrow.getIdentityHash("github", "bob");
        assertTrue(h1 != h2);
        assertTrue(h1 != h3);
    }

    function test_totalUnclaimed_tracksCorrectly() public {
        _createAndAccrue("github", "alice", 100e18);
        _createAndAccrue("github", "bob", 200e18);
        _createAndAccrue("github", "carol", 300e18);

        assertEq(escrow.totalUnclaimed(), 600e18);

        // Claim one
        bytes32 bobId = escrow.getIdentityHash("github", "bob");
        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(bobId, alice);

        assertEq(escrow.totalUnclaimed(), 400e18); // 100 + 300
    }

    function test_placeholderCount_tracksCorrectly() public {
        assertEq(escrow.placeholderCount(), 0);

        _createAndAccrue("github", "alice", 0);
        assertEq(escrow.placeholderCount(), 1);

        _createAndAccrue("github", "bob", 0);
        assertEq(escrow.placeholderCount(), 2);

        // Idempotent — same identity doesn't add
        _createAndAccrue("github", "alice", 0);
        assertEq(escrow.placeholderCount(), 2);
    }

    // ============ Cross-Path Tests ============

    function test_claimExclusivity_crpcBlocksHandshake() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);

        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, alice, true);
        escrow.claimViaCRPC(id, taskId, alice);

        vm.prank(handshakeVerifier1);
        vm.expectRevert(PlaceholderEscrow.AlreadyClaimed.selector);
        escrow.claimViaHandshake(id, bob);
    }

    function test_claimExclusivity_handshakeBlocksCRPC() public {
        bytes32 id = _createAndAccrue("github", "willg", 500e18);

        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);

        bytes32 taskId = keccak256("task-1");
        verifier.setTaskResult(taskId, bob, true);

        vm.expectRevert(PlaceholderEscrow.AlreadyClaimed.selector);
        escrow.claimViaCRPC(id, taskId, bob);
    }

    // ============ Fuzz Tests ============

    function testFuzz_accrueVibe_neverOverflows(uint128 amount1, uint128 amount2) public {
        bytes32 id = _createAndAccrue("github", "willg", 0);

        vm.startPrank(recorder1);
        escrow.accrueVibe(id, uint256(amount1) + 1, "accrual 1"); // +1 to avoid zero
        escrow.accrueVibe(id, uint256(amount2) + 1, "accrual 2");
        vm.stopPrank();

        (, , uint256 vibeAccrued, , , ) = escrow.getPlaceholder(id);
        assertEq(vibeAccrued, uint256(amount1) + uint256(amount2) + 2);
    }

    function testFuzz_claimViaHandshake_transfersExactAmount(uint128 amount) public {
        vm.assume(amount > 0);
        vm.assume(amount <= 1_000_000e18); // within escrow balance

        bytes32 id = _createAndAccrue("github", "willg", uint256(amount));

        uint256 escrowBefore = vibe.balanceOf(address(escrow));

        vm.prank(handshakeVerifier1);
        escrow.claimViaHandshake(id, alice);

        assertEq(vibe.balanceOf(alice), uint256(amount));
        assertEq(vibe.balanceOf(address(escrow)), escrowBefore - uint256(amount));
    }
}
