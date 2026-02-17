// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/AGIResistantRecovery.sol";

// ============ Handler ============

contract AGIRecoveryHandler is Test {
    AGIResistantRecovery public recovery;
    address public verifier;

    uint256 public ghost_challengesIssued;
    uint256 public ghost_proofsSubmitted;

    constructor(AGIResistantRecovery _recovery, address _verifier) {
        recovery = _recovery;
        verifier = _verifier;
    }

    function issueChallenge(uint256 requestId) public {
        requestId = bound(requestId, 1, 100);
        vm.prank(verifier);
        try recovery.issueChallenge(requestId, AGIResistantRecovery.ChallengeType.RANDOM_PHRASE) {
            ghost_challengesIssued++;
        } catch {}
    }

    function submitProof(uint256 requestId, uint256 confidence) public {
        requestId = bound(requestId, 1, 100);
        confidence = bound(confidence, 0, 100);
        vm.prank(verifier);
        try recovery.submitHumanityProof(
            requestId,
            AGIResistantRecovery.ProofType.HARDWARE_KEY,
            keccak256(abi.encodePacked("proof", ghost_proofsSubmitted)),
            confidence
        ) {
            ghost_proofsSubmitted++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1 hours, 30 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract AGIResistantRecoveryInvariantTest is StdInvariant, Test {
    AGIResistantRecovery public recovery;
    AGIRecoveryHandler public handler;
    address public verifier;

    function setUp() public {
        verifier = makeAddr("verifier");

        AGIResistantRecovery impl = new AGIResistantRecovery();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(AGIResistantRecovery.initialize.selector)
        );
        recovery = AGIResistantRecovery(address(proxy));

        vm.warp(8 days);
        recovery.addVerifier(verifier);

        handler = new AGIRecoveryHandler(recovery, verifier);
        targetContract(address(handler));
    }

    /// @notice Constants never change
    function invariant_constantsImmutable() public view {
        assertEq(recovery.MIN_ACCOUNT_AGE(), 30 days);
        assertEq(recovery.MAX_RECOVERY_ATTEMPTS(), 3);
        assertEq(recovery.BOND_AMOUNT(), 1 ether);
    }

    /// @notice Humanity score is always bounded 0-100
    function invariant_humanityScoreBounded() public view {
        // Check a few request IDs
        for (uint256 i = 1; i <= 5; i++) {
            assertLe(recovery.getHumanityScore(i), 100);
        }
    }
}
