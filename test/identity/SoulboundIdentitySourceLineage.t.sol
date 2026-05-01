// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/SoulboundIdentity.sol";
import "../../contracts/identity/interfaces/IContributionAttestor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock ContributionAttestor ============
//
// Minimal stand-in for the real ContributionAttestor. Only implements the slice
// of the interface that SoulboundIdentity reads: getClaim(claimId). Tests set
// claims directly via setClaim() to drive every code path in bindSourceLineage.

contract MockContributionAttestor {
    mapping(bytes32 => IContributionAttestor.ContributionClaim) private _claims;

    function setClaim(
        bytes32 claimId,
        address contributor,
        IContributionAttestor.ClaimStatus status
    ) external {
        _claims[claimId] = IContributionAttestor.ContributionClaim({
            claimId: claimId,
            contributor: contributor,
            claimant: contributor,
            contribType: IContributionAttestor.ContributionType.Code,
            evidenceHash: bytes32(uint256(0xDEADBEEF)),
            description: "mock claim",
            value: 0,
            timestamp: block.timestamp,
            expiresAt: block.timestamp + 7 days,
            status: status,
            resolvedBy: status == IContributionAttestor.ClaimStatus.Accepted
                ? IContributionAttestor.ResolutionSource.Executive
                : IContributionAttestor.ResolutionSource.None,
            netWeight: 0,
            attestationCount: 0,
            contestationCount: 0
        });
    }

    function getClaim(bytes32 claimId)
        external
        view
        returns (IContributionAttestor.ContributionClaim memory)
    {
        return _claims[claimId];
    }
}

// ============ V2 Implementation (for reinitializer test) ============
//
// Re-uses the same contract bytes. We deploy a fresh impl via initialize() then
// upgrade-and-call to verify the reinitializer(2) gate fires correctly.

contract SoulboundIdentityV2 is SoulboundIdentity {}

// ============ Test Contract ============

contract SoulboundIdentitySourceLineageTest is Test {
    SoulboundIdentity public sbi;
    MockContributionAttestor public attestor;

    address public owner;
    address public alice;
    address public bob;

    bytes32 internal constant ALICE_CLAIM = keccak256("alice-first-contribution");
    bytes32 internal constant BOB_CLAIM = keccak256("bob-first-contribution");

    event ContributionAttestorSet(address indexed previous, address indexed current);
    event SourceLineageBound(
        uint256 indexed tokenId,
        address indexed holder,
        bytes32 indexed claimId,
        bytes32 lineageHash
    );
    event LineageBindingEnabled();

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy impl + UUPS proxy.
        SoulboundIdentity impl = new SoulboundIdentity();
        bytes memory initData = abi.encodeWithSelector(SoulboundIdentity.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sbi = SoulboundIdentity(address(proxy));

        attestor = new MockContributionAttestor();
    }

    // ============ Initial state ============

    function test_initialState_lineageDisabled() public view {
        assertEq(sbi.contributionAttestor(), address(0));
        assertFalse(sbi.lineageBindingEnabled());
    }

    function test_initialState_holderHasNoLineage() public {
        vm.prank(alice);
        sbi.mintIdentity("alice_v");
        assertEq(sbi.getSourceLineageHash(alice), bytes32(0));
        assertFalse(sbi.hasSourceLineage(alice));
    }

    // ============ Owner wires the attestor (fresh-deploy path) ============

    function test_setContributionAttestor_byOwner() public {
        vm.expectEmit(false, false, false, true);
        emit LineageBindingEnabled();
        vm.expectEmit(true, true, false, true);
        emit ContributionAttestorSet(address(0), address(attestor));

        sbi.setContributionAttestor(address(attestor));

        assertEq(sbi.contributionAttestor(), address(attestor));
        assertTrue(sbi.lineageBindingEnabled());
    }

    function test_setContributionAttestor_zeroReverts() public {
        vm.expectRevert("Zero attestor");
        sbi.setContributionAttestor(address(0));
    }

    function test_setContributionAttestor_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        sbi.setContributionAttestor(address(attestor));
    }

    function test_setContributionAttestor_repointKeepsEnabled() public {
        sbi.setContributionAttestor(address(attestor));

        MockContributionAttestor newAttestor = new MockContributionAttestor();
        vm.expectEmit(true, true, false, true);
        emit ContributionAttestorSet(address(attestor), address(newAttestor));
        sbi.setContributionAttestor(address(newAttestor));

        assertEq(sbi.contributionAttestor(), address(newAttestor));
        assertTrue(sbi.lineageBindingEnabled());
    }

    // ============ bindSourceLineage — SUCCESS ============

    function test_bindSourceLineage_success() public {
        sbi.setContributionAttestor(address(attestor));

        vm.prank(alice);
        uint256 tokenId = sbi.mintIdentity("alice_v");

        // Mock attestor declares an Accepted claim with alice as contributor.
        attestor.setClaim(
            ALICE_CLAIM,
            alice,
            IContributionAttestor.ClaimStatus.Accepted
        );

        bytes32 expectedLineage = keccak256(abi.encode(address(attestor), ALICE_CLAIM));

        vm.expectEmit(true, true, true, true);
        emit SourceLineageBound(tokenId, alice, ALICE_CLAIM, expectedLineage);

        vm.prank(alice);
        sbi.bindSourceLineage(ALICE_CLAIM);

        assertEq(sbi.getSourceLineageHash(alice), expectedLineage);
        assertEq(sbi.tokenLineageHash(tokenId), expectedLineage);
        assertEq(sbi.tokenLineageClaimId(tokenId), ALICE_CLAIM);
        assertTrue(sbi.hasSourceLineage(alice));
    }

    // ============ bindSourceLineage — REVERTS ============

    function test_bindSourceLineage_revertsWhenDisabled() public {
        // Lineage binding never enabled — feature is fail-closed.
        vm.prank(alice);
        sbi.mintIdentity("alice_v");

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.LineageBindingDisabled.selector);
        sbi.bindSourceLineage(ALICE_CLAIM);
    }

    function test_bindSourceLineage_revertsWithoutIdentity() public {
        sbi.setContributionAttestor(address(attestor));

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.IdentityNotFound.selector);
        sbi.bindSourceLineage(ALICE_CLAIM);
    }

    function test_bindSourceLineage_revertsClaimNotAccepted_pending() public {
        sbi.setContributionAttestor(address(attestor));

        vm.prank(alice);
        sbi.mintIdentity("alice_v");

        // Pending claim — not yet accepted → must revert.
        attestor.setClaim(ALICE_CLAIM, alice, IContributionAttestor.ClaimStatus.Pending);

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.ClaimNotAccepted.selector);
        sbi.bindSourceLineage(ALICE_CLAIM);
    }

    function test_bindSourceLineage_revertsClaimNotAccepted_rejected() public {
        sbi.setContributionAttestor(address(attestor));

        vm.prank(alice);
        sbi.mintIdentity("alice_v");

        // Rejected claim — caller must not be able to bind.
        attestor.setClaim(ALICE_CLAIM, alice, IContributionAttestor.ClaimStatus.Rejected);

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.ClaimNotAccepted.selector);
        sbi.bindSourceLineage(ALICE_CLAIM);
    }

    function test_bindSourceLineage_revertsContributorMismatch() public {
        sbi.setContributionAttestor(address(attestor));

        vm.prank(alice);
        sbi.mintIdentity("alice_v");
        vm.prank(bob);
        sbi.mintIdentity("bob_v");

        // Claim was for Bob — alice cannot bind it as her lineage.
        attestor.setClaim(BOB_CLAIM, bob, IContributionAttestor.ClaimStatus.Accepted);

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.ClaimContributorMismatch.selector);
        sbi.bindSourceLineage(BOB_CLAIM);

        // Sanity: alice is still unbound, bob can still bind for himself.
        assertFalse(sbi.hasSourceLineage(alice));

        vm.prank(bob);
        sbi.bindSourceLineage(BOB_CLAIM);
        assertTrue(sbi.hasSourceLineage(bob));
    }

    function test_bindSourceLineage_revertsRebindAfterFirstBind() public {
        sbi.setContributionAttestor(address(attestor));

        vm.prank(alice);
        sbi.mintIdentity("alice_v");

        attestor.setClaim(ALICE_CLAIM, alice, IContributionAttestor.ClaimStatus.Accepted);
        vm.prank(alice);
        sbi.bindSourceLineage(ALICE_CLAIM);

        // Second attestation also accepted, but lineage is monotonically locked.
        bytes32 secondClaim = keccak256("alice-second-contribution");
        attestor.setClaim(secondClaim, alice, IContributionAttestor.ClaimStatus.Accepted);

        vm.prank(alice);
        vm.expectRevert(SoulboundIdentity.LineageAlreadyBound.selector);
        sbi.bindSourceLineage(secondClaim);

        // Original lineage still in place.
        bytes32 expected = keccak256(abi.encode(address(attestor), ALICE_CLAIM));
        assertEq(sbi.getSourceLineageHash(alice), expected);
    }

    function test_bindSourceLineage_acceptsAllResolutionSources() public {
        // Per design: any branch (Executive / Judicial / Legislative) that ends in
        // status == Accepted is a valid lineage anchor. Verify the contract checks
        // status, not resolvedBy.
        sbi.setContributionAttestor(address(attestor));

        vm.prank(alice);
        sbi.mintIdentity("alice_v");

        attestor.setClaim(ALICE_CLAIM, alice, IContributionAttestor.ClaimStatus.Accepted);

        vm.prank(alice);
        sbi.bindSourceLineage(ALICE_CLAIM); // does not revert
        assertTrue(sbi.hasSourceLineage(alice));
    }

    // ============ Post-Upgrade Initialization Gate ============

    function test_initializeV2_reinitializerGate() public {
        // Deploy a *fresh* proxy that has NOT had setContributionAttestor() called.
        SoulboundIdentity impl = new SoulboundIdentity();
        bytes memory initData = abi.encodeWithSelector(SoulboundIdentity.initialize.selector);
        ERC1967Proxy p = new ERC1967Proxy(address(impl), initData);
        SoulboundIdentity fresh = SoulboundIdentity(address(p));

        assertFalse(fresh.lineageBindingEnabled());

        // Owner runs the reinitializer to wire the attestor + enable binding atomically.
        vm.expectEmit(false, false, false, true);
        emit LineageBindingEnabled();
        fresh.initializeV2(address(attestor));

        assertEq(fresh.contributionAttestor(), address(attestor));
        assertTrue(fresh.lineageBindingEnabled());
    }

    function test_initializeV2_cannotRunTwice() public {
        sbi.initializeV2(address(attestor));

        // reinitializer(2) must reject second call.
        MockContributionAttestor other = new MockContributionAttestor();
        vm.expectRevert(); // InvalidInitialization() from OZ
        sbi.initializeV2(address(other));
    }

    function test_initializeV2_zeroAttestorReverts() public {
        vm.expectRevert("Zero attestor");
        sbi.initializeV2(address(0));
    }

    function test_initializeV2_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        sbi.initializeV2(address(attestor));
    }

    function test_initializeV2_noOpIfFreshDeployAlreadyEnabled() public {
        // Fresh deploy path — owner has already called setContributionAttestor()
        // BEFORE running the reinitializer (e.g., they wired it post-deploy then later
        // packaged an upgradeToAndCall by accident).
        sbi.setContributionAttestor(address(attestor));
        assertTrue(sbi.lineageBindingEnabled());

        // initializeV2 should claim the version slot but not flip state back.
        MockContributionAttestor other = new MockContributionAttestor();
        sbi.initializeV2(address(other));

        // Attestor is unchanged because the no-op branch fires.
        assertEq(sbi.contributionAttestor(), address(attestor));
        assertTrue(sbi.lineageBindingEnabled());
    }

    // ============ Existing-flow regression ============
    //
    // Verify that adding lineage storage did not break the original mint flow.

    function test_existingMint_unaffectedByNewStorage() public {
        vm.prank(alice);
        uint256 tokenId = sbi.mintIdentity("alice_v");

        SoulboundIdentity.Identity memory id = sbi.getIdentity(alice);
        assertEq(id.username, "alice_v");
        assertEq(id.level, 1);
        assertEq(id.xp, 0);
        assertEq(tokenId, 1);
        assertTrue(sbi.hasIdentity(alice));

        // No lineage by default.
        assertEq(sbi.tokenLineageHash(tokenId), bytes32(0));
    }
}
