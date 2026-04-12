// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/reputation/CredentialRegistry.sol";

contract CredentialRegistryTest is Test {
    CredentialRegistry public registry;
    address public issuer = makeAddr("issuer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    function setUp() public {
        CredentialRegistry impl = new CredentialRegistry();
        bytes memory initData = abi.encodeCall(CredentialRegistry.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = CredentialRegistry(address(proxy));

        registry.authorizeIssuer(issuer);
    }

    // ============ issueCredential ============

    function test_issueCredential_updatesScore() public {
        bytes32 hash = keccak256("cred1");
        vm.prank(issuer);
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.HONEST_REVEAL, hash, bytes32(uint256(1)));

        assertEq(registry.getUserScore(alice), 2); // HONEST_REVEAL weight = +2
        assertEq(registry.getCredentialCount(alice), 1);
        assertTrue(registry.verifyCredential(hash));
    }

    function test_negativeCredential_decreasesScore() public {
        // First give alice some positive score
        vm.startPrank(issuer);
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.BATCH_PARTICIPANT, keccak256("c1"), bytes32(0));
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.BATCH_PARTICIPANT, keccak256("c2"), bytes32(0));
        assertEq(registry.getUserScore(alice), 2); // +1 +1

        // FAILED_REVEAL = -3
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.FAILED_REVEAL, keccak256("c3"), bytes32(0));
        vm.stopPrank();

        assertEq(registry.getUserScore(alice), -1); // 2 + (-3) = -1
    }

    function test_tierComputation() public {
        vm.startPrank(issuer);

        // NEWCOMER: score 0
        assertEq(uint8(registry.getUserTier(alice)), uint8(ICredentialRegistry.ReputationTier.NEWCOMER));

        // BRONZE: score >= 5 (5 BATCH_PARTICIPANT credentials = 5)
        for (uint256 i = 0; i < 5; i++) {
            registry.issueCredential(alice, ICredentialRegistry.CredentialType.BATCH_PARTICIPANT, bytes32(i), bytes32(0));
        }
        assertEq(uint8(registry.getUserTier(alice)), uint8(ICredentialRegistry.ReputationTier.BRONZE));

        // SILVER: score >= 15 (add CONSISTENT_CONTRIBUTOR = +10, total = 15)
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.CONSISTENT_CONTRIBUTOR, keccak256("cc1"), bytes32(0));
        assertEq(uint8(registry.getUserTier(alice)), uint8(ICredentialRegistry.ReputationTier.SILVER));

        // GOLD: score >= 30 (add more HIGH_CONTRIBUTOR = +5 each, need 15 more)
        for (uint256 i = 0; i < 3; i++) {
            registry.issueCredential(alice, ICredentialRegistry.CredentialType.HIGH_CONTRIBUTOR, bytes32(uint256(100 + i)), bytes32(0));
        }
        assertEq(uint8(registry.getUserTier(alice)), uint8(ICredentialRegistry.ReputationTier.GOLD));

        // DIAMOND: score >= 50 (add 2 more CONSISTENT_CONTRIBUTOR = +20, total = 50)
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.CONSISTENT_CONTRIBUTOR, keccak256("cc2"), bytes32(0));
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.CONSISTENT_CONTRIBUTOR, keccak256("cc3"), bytes32(0));
        assertEq(uint8(registry.getUserTier(alice)), uint8(ICredentialRegistry.ReputationTier.DIAMOND));

        vm.stopPrank();
    }

    function test_flaggedTier_negativeScore() public {
        vm.startPrank(issuer);
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.FAILED_REVEAL, keccak256("f1"), bytes32(0));
        vm.stopPrank();

        assertEq(registry.getUserScore(alice), -3);
        assertEq(uint8(registry.getUserTier(alice)), uint8(ICredentialRegistry.ReputationTier.FLAGGED));
    }

    function test_onlyAuthorizedIssuer() public {
        vm.prank(alice); // not authorized
        vm.expectRevert(ICredentialRegistry.NotAuthorizedIssuer.selector);
        registry.issueCredential(bob, ICredentialRegistry.CredentialType.BATCH_PARTICIPANT, keccak256("x"), bytes32(0));
    }

    function test_duplicateCredential_reverts() public {
        bytes32 hash = keccak256("dup");
        vm.startPrank(issuer);
        registry.issueCredential(alice, ICredentialRegistry.CredentialType.BATCH_PARTICIPANT, hash, bytes32(0));

        vm.expectRevert(ICredentialRegistry.CredentialAlreadyExists.selector);
        registry.issueCredential(bob, ICredentialRegistry.CredentialType.BATCH_PARTICIPANT, hash, bytes32(0));
        vm.stopPrank();
    }

    function test_getCredentialWeight() public view {
        assertEq(registry.getCredentialWeight(ICredentialRegistry.CredentialType.BATCH_PARTICIPANT), 1);
        assertEq(registry.getCredentialWeight(ICredentialRegistry.CredentialType.HONEST_REVEAL), 2);
        assertEq(registry.getCredentialWeight(ICredentialRegistry.CredentialType.FAILED_REVEAL), -3);
        assertEq(registry.getCredentialWeight(ICredentialRegistry.CredentialType.CONSISTENT_CONTRIBUTOR), 10);
        assertEq(registry.getCredentialWeight(ICredentialRegistry.CredentialType.REPUTATION_BURN), 4);
    }
}
