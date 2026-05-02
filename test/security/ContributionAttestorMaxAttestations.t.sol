// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionAttestor.sol";
import "../../contracts/identity/interfaces/IContributionAttestor.sol";

/// @notice Minimal mock of ContributionDAG returning a constant trust score
contract DAGStub {
    function setScore(address /*u*/, uint256 /*s*/, uint256 /*m*/) external pure {}

    function getTrustScore(address /*user*/)
        external
        pure
        returns (uint256 score, string memory level, uint256 multiplier, uint8 hops, address[] memory trustChain)
    {
        score = 1e18;        // 1.0 trust
        multiplier = 10000;  // 1.0x (BPS scale)
        level = "Stub";
        hops = 0;
        trustChain = new address[](0);
    }
}

/**
 * @title ContributionAttestorMaxAttestationsTest
 * @notice C7-CCS / signature-replay scan finding (this file: per-claim attestation bound).
 *
 *   Finding: ContributionAttestor declares
 *     `MAX_ATTESTATIONS_PER_CLAIM = 50`
 *   but `attest()` and `contest()` never enforce it. _attestations[claimId] grows
 *   unbounded as long as fresh addresses keep attesting. View helpers like
 *   getAttestations() / getCumulativeWeight() iterate the full array, so a
 *   griefer can OOG the indexer / off-chain consumers and bloat storage.
 *
 *   Test demonstrates exploit (51st attestation succeeds pre-fix) and verifies
 *   the post-fix behavior (51st reverts with TooManyAttestations).
 */
contract ContributionAttestorMaxAttestationsTest is Test {
    ContributionAttestor private att;
    DAGStub private dag;

    address private contributor = address(0xC0FFEE);
    address private claimant = address(0xCAFE);

    // Pick a threshold larger than 50 attestations × 1e18 weight, but well within int256 max
    // so casting to int256 stays positive and auto-accept never triggers during the test.
    uint256 private constant THRESHOLD = 1_000_000 ether; // 1e6 × 1e18 = 1e24 (vs 50 × 1e18 = 5e19)
    uint256 private constant TTL = 30 days;

    function setUp() public {
        dag = new DAGStub();
        att = new ContributionAttestor(address(dag), THRESHOLD, TTL);
    }

    function _submit() internal returns (bytes32 id) {
        vm.prank(claimant);
        id = att.submitClaim(
            contributor,
            IContributionAttestor.ContributionType.Code,
            bytes32(uint256(0xABCD)),
            "test claim",
            1
        );
    }

    /// @notice After fix, the 51st attest() call MUST revert. Pre-fix it would succeed.
    function test_attest_isCappedAtMax() public {
        bytes32 id = _submit();

        // Cap is 50. Attest 50 times — all should succeed.
        for (uint256 i = 0; i < 50; i++) {
            address attester = address(uint160(0x1000 + i));
            vm.prank(attester);
            att.attest(id);
        }

        // 51st attempt must be rejected.
        address overflow = address(uint160(0x1000 + 50));
        vm.prank(overflow);
        vm.expectRevert(IContributionAttestor.TooManyAttestations.selector);
        att.attest(id);
    }

    /// @notice The cap applies to the COMBINED count of attestations and contestations.
    function test_contest_alsoCounts() public {
        bytes32 id = _submit();

        // 25 attestations + 25 contestations = 50.
        for (uint256 i = 0; i < 25; i++) {
            address attester = address(uint160(0x2000 + i));
            vm.prank(attester);
            att.attest(id);
        }
        for (uint256 i = 0; i < 25; i++) {
            address contester = address(uint160(0x3000 + i));
            vm.prank(contester);
            att.contest(id, bytes32(uint256(i)));
        }

        // 51st (either path) must revert.
        address overflowA = address(0xAAAA1);
        vm.prank(overflowA);
        vm.expectRevert(IContributionAttestor.TooManyAttestations.selector);
        att.attest(id);

        address overflowC = address(0xCCCC1);
        vm.prank(overflowC);
        vm.expectRevert(IContributionAttestor.TooManyAttestations.selector);
        att.contest(id, bytes32(uint256(99)));
    }
}
