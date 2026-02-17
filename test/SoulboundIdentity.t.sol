// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/identity/SoulboundIdentity.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockRecoveryContract {
    SoulboundIdentity public identity;

    constructor(SoulboundIdentity _identity) {
        identity = _identity;
    }

    function doRecovery(uint256 tokenId, address newOwner) external {
        identity.recoveryTransfer(tokenId, newOwner);
    }
}

contract SoulboundIdentityTest is Test {
    SoulboundIdentity public sbi;
    MockRecoveryContract public recovery;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public recorder;

    event IdentityMinted(address indexed owner, uint256 indexed tokenId, string username, bool quantumEnabled);
    event UsernameChanged(uint256 indexed tokenId, string oldUsername, string newUsername);
    event AvatarUpdated(uint256 indexed tokenId, SoulboundIdentity.AvatarTraits newTraits);
    event XPGained(uint256 indexed tokenId, uint256 amount, string reason);
    event LevelUp(uint256 indexed tokenId, uint256 newLevel);
    event AlignmentChanged(uint256 indexed tokenId, int256 oldAlignment, int256 newAlignment);
    event ContributionRecorded(uint256 indexed contributionId, uint256 indexed tokenId, SoulboundIdentity.ContributionType cType);
    event ContributionVoted(uint256 indexed contributionId, address indexed voter, bool upvote);
    event QuantumModeEnabled(uint256 indexed tokenId, bytes32 quantumKeyRoot);
    event QuantumKeyRotated(uint256 indexed tokenId, bytes32 newKeyRoot);
    event RecoveryContractQueued(address indexed newContract, uint256 timelockEnd);
    event RecoveryContractChanged(address indexed oldContract, address indexed newContract);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        recorder = makeAddr("recorder");

        SoulboundIdentity impl = new SoulboundIdentity();
        bytes memory initData = abi.encodeWithSelector(SoulboundIdentity.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sbi = SoulboundIdentity(address(proxy));

        sbi.setAuthorizedRecorder(recorder, true);

        // Setup recovery contract
        recovery = new MockRecoveryContract(sbi);
        sbi.queueRecoveryContract(address(recovery));
        vm.warp(block.timestamp + 2 days + 1);
        sbi.executeRecoveryContractChange();
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(sbi.name(), "VibeSwap Identity");
        assertEq(sbi.symbol(), "VIBE-ID");
        assertEq(sbi.totalIdentities(), 0);
        assertEq(sbi.totalContributions(), 0);
    }

    // ============ Mint Identity ============

    function test_mintIdentity_success() public {
        vm.prank(alice);
        uint256 tokenId = sbi.mintIdentity("alice_vibe");

        assertEq(tokenId, 1);
        assertEq(sbi.ownerOf(1), alice);
        assertEq(sbi.addressToTokenId(alice), 1);
        assertTrue(sbi.usernameTaken("alice_vibe"));
        assertTrue(sbi.hasIdentity(alice));
        assertEq(sbi.totalIdentities(), 1);
    }

    function test_mintIdentity_identityDetails() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        SoulboundIdentity.Identity memory id = sbi.getIdentity(alice);
        assertEq(id.username, "alice_vibe");
        assertEq(id.level, 1);
        assertEq(id.xp, 0);
        assertEq(id.alignment, 0);
        assertEq(id.contributions, 0);
        assertEq(id.reputation, 0);
        assertEq(id.createdAt, block.timestamp);
        assertFalse(id.quantumEnabled);
    }

    function test_mintIdentity_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit IdentityMinted(alice, 1, "alice_vibe", false);
        sbi.mintIdentity("alice_vibe");
    }

    function test_mintIdentity_alreadyHasReverts() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.AlreadyHasIdentity.selector);
        sbi.mintIdentity("alice_vibe2");
    }

    function test_mintIdentity_usernameTaken() public {
        vm.prank(alice);
        sbi.mintIdentity("vibe_user");

        vm.prank(bob);
        vm.expectRevert(SoulboundIdentity.UsernameTaken.selector);
        sbi.mintIdentity("vibe_user");
    }

    function test_mintIdentity_caseInsensitiveUniqueness() public {
        vm.prank(alice);
        sbi.mintIdentity("VibeUser");

        vm.prank(bob);
        vm.expectRevert(SoulboundIdentity.UsernameTaken.selector);
        sbi.mintIdentity("vibeuser");
    }

    function test_mintIdentity_usernameTooShort() public {
        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.UsernameInvalid.selector);
        sbi.mintIdentity("ab");
    }

    function test_mintIdentity_usernameTooLong() public {
        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.UsernameInvalid.selector);
        sbi.mintIdentity("a]bcdefghijklmnopqrstu");
    }

    function test_mintIdentity_usernameInvalidChars() public {
        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.UsernameInvalid.selector);
        sbi.mintIdentity("user@name");
    }

    function test_mintIdentity_usernameWithUnderscore() public {
        vm.prank(alice);
        sbi.mintIdentity("user_name_1");
        assertTrue(sbi.hasIdentity(alice));
    }

    // ============ Quantum Mode ============

    function test_mintIdentityQuantum() public {
        bytes32 keyRoot = keccak256("quantum-keys");
        vm.prank(alice);
        sbi.mintIdentityQuantum("alice_q", keyRoot);

        SoulboundIdentity.Identity memory id = sbi.getIdentity(alice);
        assertTrue(id.quantumEnabled);
        assertEq(id.quantumKeyRoot, keyRoot);
    }

    function test_enableQuantumMode() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        bytes32 keyRoot = keccak256("quantum-keys");
        vm.prank(alice);
        sbi.enableQuantumMode(keyRoot);

        assertTrue(sbi.isQuantumEnabled(alice));
        assertEq(sbi.getQuantumKeyRoot(alice), keyRoot);
    }

    function test_enableQuantumMode_alreadyEnabled() public {
        bytes32 keyRoot = keccak256("quantum-keys");
        vm.prank(alice);
        sbi.mintIdentityQuantum("alice_q", keyRoot);

        vm.prank(alice);
        vm.expectRevert("Quantum mode already enabled");
        sbi.enableQuantumMode(keccak256("new-keys"));
    }

    function test_rotateQuantumKeys() public {
        bytes32 keyRoot = keccak256("quantum-keys-v1");
        vm.prank(alice);
        sbi.mintIdentityQuantum("alice_q", keyRoot);

        bytes32 newKeyRoot = keccak256("quantum-keys-v2");
        vm.prank(alice);
        sbi.rotateQuantumKeys(newKeyRoot);

        assertEq(sbi.getQuantumKeyRoot(alice), newKeyRoot);
    }

    function test_rotateQuantumKeys_notEnabled() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(alice);
        vm.expectRevert("Quantum mode not enabled");
        sbi.rotateQuantumKeys(keccak256("keys"));
    }

    function test_isQuantumEnabled_noIdentity() public view {
        assertFalse(sbi.isQuantumEnabled(alice));
    }

    // ============ Soulbound ============

    function test_transfer_reverts() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.SoulboundNoTransfer.selector);
        sbi.transferFrom(alice, bob, 1);
    }

    function test_safeTransfer_reverts() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.SoulboundNoTransfer.selector);
        sbi.safeTransferFrom(alice, bob, 1);
    }

    // ============ Username Change ============

    function test_changeUsername_success() public {
        vm.prank(alice);
        sbi.mintIdentity("old_name");

        vm.prank(alice);
        sbi.changeUsername("new_name");

        SoulboundIdentity.Identity memory id = sbi.getIdentity(alice);
        assertEq(id.username, "new_name");
        assertFalse(sbi.usernameTaken("old_name"));
        assertTrue(sbi.usernameTaken("new_name"));
    }

    function test_changeUsername_costsReputation() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        // Give some reputation via upvotes
        vm.prank(bob);
        sbi.mintIdentity("bob_vibe");

        // Record contribution and upvote it to build reputation
        vm.prank(recorder);
        uint256 cid = sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);

        vm.prank(bob);
        sbi.vote(cid, true);

        uint256 repBefore = sbi.getIdentity(alice).reputation;
        assertTrue(repBefore > 0);

        vm.prank(alice);
        sbi.changeUsername("new_alice");

        uint256 repAfter = sbi.getIdentity(alice).reputation;
        assertEq(repAfter, (repBefore * 90) / 100);
    }

    function test_changeUsername_noIdentityReverts() public {
        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.IdentityNotFound.selector);
        sbi.changeUsername("whatever");
    }

    function test_changeUsername_takenReverts() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_name");
        vm.prank(bob);
        sbi.mintIdentity("bob_name");

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.UsernameTaken.selector);
        sbi.changeUsername("bob_name");
    }

    // ============ Avatar ============

    function test_updateAvatar() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        SoulboundIdentity.AvatarTraits memory traits = SoulboundIdentity.AvatarTraits({
            background: 5,
            body: 3,
            eyes: 7,
            mouth: 2,
            accessory: 10,
            aura: 0
        });

        vm.prank(alice);
        sbi.updateAvatar(traits);

        SoulboundIdentity.Identity memory id = sbi.getIdentity(alice);
        assertEq(id.avatar.background, 5);
        assertEq(id.avatar.body, 3);
    }

    function test_updateAvatar_auraRequiresLevel3() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        SoulboundIdentity.AvatarTraits memory traits = SoulboundIdentity.AvatarTraits({
            background: 0, body: 0, eyes: 0, mouth: 0, accessory: 0, aura: 1
        });

        vm.prank(alice);
        vm.expectRevert("Aura unlocks at level 3");
        sbi.updateAvatar(traits);
    }

    // ============ Contributions ============

    function test_recordContribution_post() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(recorder);
        uint256 cid = sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);

        assertEq(cid, 1);
        assertEq(sbi.totalContributions(), 1);

        SoulboundIdentity.Identity memory id = sbi.getIdentity(alice);
        assertEq(id.contributions, 1);
        assertEq(id.xp, 10); // XP_PER_POST

        SoulboundIdentity.Contribution memory c = sbi.getContribution(1);
        assertEq(c.author, alice);
        assertEq(uint8(c.cType), uint8(SoulboundIdentity.ContributionType.POST));
    }

    function test_recordContribution_code() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(recorder);
        sbi.recordContribution(alice, keccak256("code"), SoulboundIdentity.ContributionType.CODE);

        assertEq(sbi.getIdentity(alice).xp, 100); // XP_PER_CODE
    }

    function test_recordContribution_proposal() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(recorder);
        sbi.recordContribution(alice, keccak256("proposal"), SoulboundIdentity.ContributionType.PROPOSAL);

        assertEq(sbi.getIdentity(alice).xp, 50); // XP_PER_PROPOSAL
    }

    function test_recordContribution_unauthorizedReverts() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.UnauthorizedRecorder.selector);
        sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);
    }

    function test_recordContribution_noIdentityReverts() public {
        vm.prank(recorder);
        vm.expectRevert(SoulboundIdentity.IdentityNotFound.selector);
        sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);
    }

    function test_recordContribution_ownerCanRecord() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        // Owner has recorder access
        sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);
        assertEq(sbi.getIdentity(alice).contributions, 1);
    }

    // ============ Voting ============

    function test_vote_upvote() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");
        vm.prank(bob);
        sbi.mintIdentity("bob_vibe");

        vm.prank(recorder);
        uint256 cid = sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);

        vm.prank(bob);
        sbi.vote(cid, true);

        SoulboundIdentity.Contribution memory c = sbi.getContribution(cid);
        assertEq(c.upvotes, 1);
        assertEq(c.downvotes, 0);

        // Author gains XP and reputation
        SoulboundIdentity.Identity memory aliceId = sbi.getIdentity(alice);
        assertEq(aliceId.reputation, 1);
        assertEq(aliceId.xp, 10 + 2); // POST XP + upvote XP

        // Voter gains 1 XP
        assertEq(sbi.getIdentity(bob).xp, 1);
    }

    function test_vote_downvote() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");
        vm.prank(bob);
        sbi.mintIdentity("bob_vibe");

        // Give alice some reputation first
        vm.prank(recorder);
        uint256 cid1 = sbi.recordContribution(alice, keccak256("c1"), SoulboundIdentity.ContributionType.POST);
        vm.prank(bob);
        sbi.vote(cid1, true);

        uint256 repBefore = sbi.getIdentity(alice).reputation;

        vm.prank(recorder);
        uint256 cid2 = sbi.recordContribution(alice, keccak256("c2"), SoulboundIdentity.ContributionType.POST);

        // Use carol for downvote
        vm.prank(carol);
        sbi.mintIdentity("carol_vibe");
        vm.prank(carol);
        sbi.vote(cid2, false);

        SoulboundIdentity.Contribution memory c = sbi.getContribution(cid2);
        assertEq(c.downvotes, 1);
        assertEq(sbi.getIdentity(alice).reputation, repBefore - 1);
    }

    function test_vote_cannotVoteOwnContent() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(recorder);
        uint256 cid = sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.CannotVoteOwnContent.selector);
        sbi.vote(cid, true);
    }

    function test_vote_alreadyVoted() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");
        vm.prank(bob);
        sbi.mintIdentity("bob_vibe");

        vm.prank(recorder);
        uint256 cid = sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);

        vm.prank(bob);
        sbi.vote(cid, true);

        vm.prank(bob);
        vm.expectRevert(SoulboundIdentity.AlreadyVoted.selector);
        sbi.vote(cid, false);
    }

    function test_vote_noIdentityReverts() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(recorder);
        uint256 cid = sbi.recordContribution(alice, keccak256("content"), SoulboundIdentity.ContributionType.POST);

        vm.prank(carol); // carol has no identity
        vm.expectRevert(SoulboundIdentity.IdentityNotFound.selector);
        sbi.vote(cid, true);
    }

    // ============ XP & Leveling ============

    function test_levelUp() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        // Award enough XP for level 2 (threshold = 100)
        sbi.awardXP(alice, 100, "test");

        assertEq(sbi.getIdentity(alice).level, 2);
    }

    function test_levelUp_multiplelevels() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        // Award enough XP for level 5 (threshold = 1000)
        sbi.awardXP(alice, 1000, "massive contribution");

        assertEq(sbi.getIdentity(alice).level, 5);
    }

    function test_awardXP_unauthorizedReverts() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.UnauthorizedRecorder.selector);
        sbi.awardXP(alice, 100, "test");
    }

    function test_alignment_clampToRange() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");
        vm.prank(bob);
        sbi.mintIdentity("bob_vibe");

        // Generate many upvotes to push alignment toward +100
        for (uint256 i = 0; i < 110; i++) {
            vm.prank(recorder);
            uint256 cid = sbi.recordContribution(alice, keccak256(abi.encodePacked("content", i)), SoulboundIdentity.ContributionType.REPLY);

            vm.prank(bob);
            sbi.vote(cid, true);
        }

        int256 alignment = sbi.getIdentity(alice).alignment;
        assertEq(alignment, 100); // Clamped at +100
    }

    // ============ Recovery ============

    function test_recoveryTransfer() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        recovery.doRecovery(1, bob);

        assertEq(sbi.ownerOf(1), bob);
        assertEq(sbi.addressToTokenId(bob), 1);
        assertEq(sbi.addressToTokenId(alice), 0);
    }

    function test_recoveryTransfer_onlyRecoveryContract() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.prank(bob);
        vm.expectRevert("Only recovery contract");
        sbi.recoveryTransfer(1, bob);
    }

    function test_recoveryTransfer_newOwnerAlreadyHasIdentity() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");
        vm.prank(bob);
        sbi.mintIdentity("bob_vibe");

        vm.expectRevert("New owner already has identity");
        recovery.doRecovery(1, bob);
    }

    function test_recoveryTransfer_zeroAddressReverts() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.expectRevert("Invalid new owner");
        recovery.doRecovery(1, address(0));
    }

    // ============ Recovery Contract Timelock ============

    function test_queueRecoveryContract() public {
        address newRecovery = makeAddr("newRecovery");
        sbi.queueRecoveryContract(newRecovery);

        assertEq(sbi.pendingRecoveryContract(), newRecovery);
        assertEq(sbi.recoveryContractTimelockEnd(), block.timestamp + 2 days);
    }

    function test_executeRecoveryContract_beforeTimelockReverts() public {
        address newRecovery = makeAddr("newRecovery");
        sbi.queueRecoveryContract(newRecovery);

        vm.expectRevert("Timelock active");
        sbi.executeRecoveryContractChange();
    }

    function test_executeRecoveryContract_afterTimelock() public {
        address newRecovery = makeAddr("newRecovery");
        sbi.queueRecoveryContract(newRecovery);

        vm.warp(block.timestamp + 2 days + 1);
        sbi.executeRecoveryContractChange();

        assertEq(sbi.recoveryContract(), newRecovery);
        assertEq(sbi.pendingRecoveryContract(), address(0));
    }

    function test_executeRecoveryContract_noPendingReverts() public {
        vm.expectRevert("No pending change");
        sbi.executeRecoveryContractChange();
    }

    // ============ View Functions ============

    function test_getIdentityByTokenId() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        SoulboundIdentity.Identity memory id = sbi.getIdentityByTokenId(1);
        assertEq(id.username, "alice_vibe");
    }

    function test_getIdentityByTokenId_invalidReverts() public {
        vm.expectRevert(SoulboundIdentity.IdentityNotFound.selector);
        sbi.getIdentityByTokenId(0);
    }

    function test_getContributionsByIdentity() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        vm.startPrank(recorder);
        sbi.recordContribution(alice, keccak256("c1"), SoulboundIdentity.ContributionType.POST);
        sbi.recordContribution(alice, keccak256("c2"), SoulboundIdentity.ContributionType.CODE);
        vm.stopPrank();

        uint256[] memory contribs = sbi.getContributionsByIdentity(1);
        assertEq(contribs.length, 2);
    }

    function test_tokenURI() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_vibe");

        string memory uri = sbi.tokenURI(1);
        assertTrue(bytes(uri).length > 0);
        // Starts with data:application/json;base64,
        assertTrue(_startsWith(uri, "data:application/json;base64,"));
    }

    // ============ Helpers ============

    function _startsWith(string memory str, string memory prefix) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        bytes memory prefixBytes = bytes(prefix);
        if (strBytes.length < prefixBytes.length) return false;
        for (uint256 i = 0; i < prefixBytes.length; i++) {
            if (strBytes[i] != prefixBytes[i]) return false;
        }
        return true;
    }
}
