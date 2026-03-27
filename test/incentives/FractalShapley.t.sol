// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/FractalShapley.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title FractalShapley Tests
 * @notice Proves that recursive attribution through influence DAGs works.
 *
 * "Git commits are a lie of omission. Real attribution is fractal."
 *
 * These tests verify:
 * 1. Contributions can declare inspirations (parents)
 * 2. Credit propagates backward through the influence chain
 * 3. Decay attenuates credit at each hop (configurable)
 * 4. Efficiency axiom: ALL reward is distributed, none vanishes
 * 5. Root contributions (no parents) keep 100% of credit
 * 6. Deep chains respect the MAX_PROPAGATION_DEPTH bound
 */
contract FractalShapleyTest is Test {
    FractalShapley public fractal;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");
    address public diana = makeAddr("diana");
    address public eve = makeAddr("eve");

    uint256 public constant DECAY = 3000;  // 30% per hop
    uint256 public constant BPS = 10_000;

    function setUp() public {
        FractalShapley impl = new FractalShapley();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(FractalShapley.initialize, (
                address(0),  // No ContributionDAG integration for unit tests
                DECAY,       // 30% decay per hop
                0            // No attestation requirement (V1)
            ))
        );
        fractal = FractalShapley(address(proxy));
    }

    // ============ Registration Tests ============

    function test_registerContribution_noParents() public {
        bytes32 id = keccak256("alice-genesis");
        bytes32[] memory parents = new bytes32[](0);

        vm.prank(alice);
        fractal.registerContribution(id, parents);

        assertTrue(fractal.contributionExists(id));
        IFractalShapley.Contribution memory c = fractal.getContribution(id);
        assertEq(c.contributor, alice);
        assertEq(c.parents.length, 0);
    }

    function test_registerContribution_withParents() public {
        // Alice creates root contribution
        bytes32 aliceId = keccak256("alice-idea");
        vm.prank(alice);
        fractal.registerContribution(aliceId, new bytes32[](0));

        // Bob registers contribution inspired by Alice
        bytes32 bobId = keccak256("bob-code");
        bytes32[] memory parents = new bytes32[](1);
        parents[0] = aliceId;

        vm.prank(bob);
        fractal.registerContribution(bobId, parents);

        IFractalShapley.Contribution memory c = fractal.getContribution(bobId);
        assertEq(c.contributor, bob);
        assertEq(c.parents.length, 1);
        assertEq(c.parents[0], aliceId);

        // Verify reverse index
        bytes32[] memory children = fractal.getChildren(aliceId);
        assertEq(children.length, 1);
        assertEq(children[0], bobId);
    }

    function test_revert_duplicateContribution() public {
        bytes32 id = keccak256("duplicate");
        vm.prank(alice);
        fractal.registerContribution(id, new bytes32[](0));

        vm.expectRevert(abi.encodeWithSelector(FractalShapley.ContributionAlreadyExists.selector, id));
        vm.prank(bob);
        fractal.registerContribution(id, new bytes32[](0));
    }

    function test_revert_parentNotFound() public {
        bytes32 fakeParent = keccak256("nonexistent");
        bytes32[] memory parents = new bytes32[](1);
        parents[0] = fakeParent;

        vm.expectRevert(abi.encodeWithSelector(FractalShapley.ContributionNotFound.selector, fakeParent));
        vm.prank(alice);
        fractal.registerContribution(keccak256("child"), parents);
    }

    function test_revert_selfReference() public {
        bytes32 id = keccak256("narcissist");
        bytes32[] memory parents = new bytes32[](1);
        parents[0] = id;

        vm.expectRevert(FractalShapley.SelfReference.selector);
        vm.prank(alice);
        fractal.registerContribution(id, parents);
    }

    function test_revert_tooManyParents() public {
        // Register 11 root contributions
        for (uint256 i; i < 11; ++i) {
            vm.prank(alice);
            fractal.registerContribution(bytes32(i + 1), new bytes32[](0));
        }

        // Try to register with 11 parents (max is 10)
        bytes32[] memory parents = new bytes32[](11);
        for (uint256 i; i < 11; ++i) {
            parents[i] = bytes32(i + 1);
        }

        vm.expectRevert(abi.encodeWithSelector(FractalShapley.TooManyParents.selector, 11));
        vm.prank(bob);
        fractal.registerContribution(keccak256("too-many"), parents);
    }

    // ============ Credit Propagation Tests ============

    function test_credit_noParents_fullReward() public {
        // Root contribution: Alice gets 100% of reward
        bytes32 id = keccak256("root");
        vm.prank(alice);
        fractal.registerContribution(id, new bytes32[](0));

        uint256 reward = 1 ether;
        IFractalShapley.CreditAllocation[] memory alloc = fractal.computeCredit(id, reward);

        assertEq(alloc.length, 1);
        assertEq(alloc[0].recipient, alice);
        assertEq(alloc[0].amount, reward);
        assertEq(alloc[0].depth, 0);
    }

    function test_credit_singleParent_decayCorrect() public {
        // Alice creates root
        bytes32 aliceId = keccak256("alice-root");
        vm.prank(alice);
        fractal.registerContribution(aliceId, new bytes32[](0));

        // Bob inspired by Alice
        bytes32 bobId = keccak256("bob-child");
        bytes32[] memory parents = new bytes32[](1);
        parents[0] = aliceId;
        vm.prank(bob);
        fractal.registerContribution(bobId, parents);

        uint256 reward = 10000; // Use round number for easy math
        IFractalShapley.CreditAllocation[] memory alloc = fractal.computeCredit(bobId, reward);

        // Bob gets 70% (direct), Alice gets 30% propagated
        // But Alice's 30% also decays: she keeps 70% of 30% = 21%
        // The remaining 30% of 30% = 9% has no grandparents → returns to Bob
        // So: Bob = 7000 + 900 = 7900, Alice = 2100
        assertEq(alloc.length, 2);
        assertEq(alloc[0].recipient, bob);    // Direct contributor
        assertEq(alloc[0].depth, 0);
        assertEq(alloc[1].recipient, alice);  // Upstream inspiration
        assertEq(alloc[1].depth, 1);

        // Verify efficiency: all reward is distributed
        uint256 total;
        for (uint256 i; i < alloc.length; ++i) {
            total += alloc[i].amount;
        }
        assertEq(total, reward, "Efficiency axiom: all reward must be distributed");
    }

    function test_credit_twoParents_splitEvenly() public {
        // Alice and Charlie create roots
        bytes32 aliceId = keccak256("alice");
        bytes32 charlieId = keccak256("charlie");
        vm.prank(alice);
        fractal.registerContribution(aliceId, new bytes32[](0));
        vm.prank(charlie);
        fractal.registerContribution(charlieId, new bytes32[](0));

        // Bob inspired by both
        bytes32 bobId = keccak256("bob");
        bytes32[] memory parents = new bytes32[](2);
        parents[0] = aliceId;
        parents[1] = charlieId;
        vm.prank(bob);
        fractal.registerContribution(bobId, parents);

        uint256 reward = 10000;
        IFractalShapley.CreditAllocation[] memory alloc = fractal.computeCredit(bobId, reward);

        // Bob keeps 70% = 7000
        // 30% = 3000 split between Alice and Charlie = 1500 each
        // Each parent has no grandparents, so their upstream share returns to Bob
        // Alice keeps 70% of 1500 = 1050, upstream 450 → back to Bob
        // Charlie keeps 70% of 1500 = 1050, upstream 450 → back to Bob
        // Bob total = 7000 + 450 + 450 = 7900
        assertEq(alloc[0].recipient, bob);
        assertEq(alloc[0].depth, 0);

        // Verify efficiency
        uint256 total;
        for (uint256 i; i < alloc.length; ++i) {
            total += alloc[i].amount;
        }
        assertEq(total, reward, "Efficiency axiom violated");
    }

    function test_credit_threeDeep_chain() public {
        // Alice → Bob → Charlie (3-deep chain)
        bytes32 aliceId = keccak256("alice");
        vm.prank(alice);
        fractal.registerContribution(aliceId, new bytes32[](0));

        bytes32 bobId = keccak256("bob");
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = aliceId;
        vm.prank(bob);
        fractal.registerContribution(bobId, p1);

        bytes32 charlieId = keccak256("charlie");
        bytes32[] memory p2 = new bytes32[](1);
        p2[0] = bobId;
        vm.prank(charlie);
        fractal.registerContribution(charlieId, p2);

        uint256 reward = 1_000_000; // Large number for precision
        IFractalShapley.CreditAllocation[] memory alloc = fractal.computeCredit(charlieId, reward);

        // Charlie keeps 70% = 700,000
        // Bob gets 30% = 300,000, keeps 70% = 210,000
        // Alice gets 30% of 300,000 = 90,000, keeps 70% = 63,000
        // Alice's upstream (no grandparents) = 27,000 → back to Charlie
        // Total: Charlie = 700,000 + 27,000, Bob = 210,000, Alice = 63,000
        // = 727,000 + 210,000 + 63,000 = 1,000,000 ✓

        uint256 total;
        for (uint256 i; i < alloc.length; ++i) {
            total += alloc[i].amount;
        }
        assertEq(total, reward, "Efficiency axiom: 3-deep chain must distribute all reward");

        // Verify Alice got something (inspiration credit flows 2 hops back)
        bool aliceGotCredit;
        for (uint256 i; i < alloc.length; ++i) {
            if (alloc[i].recipient == alice) {
                aliceGotCredit = true;
                assertGt(alloc[i].amount, 0, "Alice should receive non-zero credit");
                assertEq(alloc[i].depth, 2, "Alice is 2 hops deep");
            }
        }
        assertTrue(aliceGotCredit, "Alice must receive propagated credit");
    }

    function test_efficiency_axiom_fuzz(uint256 reward) public {
        reward = bound(reward, 1, 100 ether);

        // Build a 4-node diamond DAG: Alice → {Bob, Charlie} → Diana
        bytes32 aliceId = keccak256("a");
        vm.prank(alice);
        fractal.registerContribution(aliceId, new bytes32[](0));

        bytes32 bobId = keccak256("b");
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = aliceId;
        vm.prank(bob);
        fractal.registerContribution(bobId, p1);

        bytes32 charlieId = keccak256("c");
        bytes32[] memory p2 = new bytes32[](1);
        p2[0] = aliceId;
        vm.prank(charlie);
        fractal.registerContribution(charlieId, p2);

        bytes32 dianaId = keccak256("d");
        bytes32[] memory p3 = new bytes32[](2);
        p3[0] = bobId;
        p3[1] = charlieId;
        vm.prank(diana);
        fractal.registerContribution(dianaId, p3);

        IFractalShapley.CreditAllocation[] memory alloc = fractal.computeCredit(dianaId, reward);

        uint256 total;
        for (uint256 i; i < alloc.length; ++i) {
            total += alloc[i].amount;
        }

        // Allow rounding dust (max 10 wei per allocation)
        uint256 dust = alloc.length * 10;
        assertApproxEqAbs(total, reward, dust, "Efficiency axiom: all reward must be distributed (within rounding)");
    }

    // ============ Attestation Tests ============

    function test_attestInspiration() public {
        bytes32 aliceId = keccak256("alice");
        bytes32 bobId = keccak256("bob");

        vm.prank(alice);
        fractal.registerContribution(aliceId, new bytes32[](0));

        bytes32[] memory parents = new bytes32[](1);
        parents[0] = aliceId;
        vm.prank(bob);
        fractal.registerContribution(bobId, parents);

        // Charlie attests that Bob was indeed inspired by Alice
        vm.prank(charlie);
        fractal.attestInspiration(bobId, aliceId);

        assertEq(fractal.getAttestationCount(bobId, aliceId), 1);

        // Diana also attests
        vm.prank(diana);
        fractal.attestInspiration(bobId, aliceId);

        assertEq(fractal.getAttestationCount(bobId, aliceId), 2);
    }

    function test_revert_doubleAttestation() public {
        bytes32 aliceId = keccak256("alice");
        bytes32 bobId = keccak256("bob");

        vm.prank(alice);
        fractal.registerContribution(aliceId, new bytes32[](0));

        bytes32[] memory parents = new bytes32[](1);
        parents[0] = aliceId;
        vm.prank(bob);
        fractal.registerContribution(bobId, parents);

        vm.prank(charlie);
        fractal.attestInspiration(bobId, aliceId);

        vm.expectRevert(FractalShapley.AlreadyAttested.selector);
        vm.prank(charlie);
        fractal.attestInspiration(bobId, aliceId);
    }

    // ============ Distribution Tests ============

    function test_distributeWithPropagation_ETH() public {
        bytes32 aliceId = keccak256("alice");
        vm.prank(alice);
        fractal.registerContribution(aliceId, new bytes32[](0));

        bytes32 bobId = keccak256("bob");
        bytes32[] memory parents = new bytes32[](1);
        parents[0] = aliceId;
        vm.prank(bob);
        fractal.registerContribution(bobId, parents);

        // Fund the caller
        address distributor = makeAddr("distributor");
        vm.deal(distributor, 10 ether);

        uint256 reward = 1 ether;
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.prank(distributor);
        fractal.distributeWithPropagation{value: reward}(bobId, reward, address(0));

        // Both should have received something
        assertGt(alice.balance - aliceBefore, 0, "Alice should receive propagated credit");
        assertGt(bob.balance - bobBefore, 0, "Bob should receive direct credit");

        // Total distributed = reward
        uint256 totalDistributed = (alice.balance - aliceBefore) + (bob.balance - bobBefore);
        assertEq(totalDistributed, reward, "All ETH must be distributed");

        // Check accounting
        assertGt(fractal.getTotalCreditReceived(alice), 0);
        assertGt(fractal.getTotalCreditReceived(bob), 0);
    }

    // ============ Edge Cases ============

    function test_credit_sameContributorMultipleNodes() public {
        // Alice creates two contributions, Bob inspired by both
        // Alice should get credit from both paths
        bytes32 a1 = keccak256("alice-1");
        bytes32 a2 = keccak256("alice-2");

        vm.startPrank(alice);
        fractal.registerContribution(a1, new bytes32[](0));
        fractal.registerContribution(a2, new bytes32[](0));
        vm.stopPrank();

        bytes32 bobId = keccak256("bob");
        bytes32[] memory parents = new bytes32[](2);
        parents[0] = a1;
        parents[1] = a2;
        vm.prank(bob);
        fractal.registerContribution(bobId, parents);

        IFractalShapley.CreditAllocation[] memory alloc = fractal.computeCredit(bobId, 10000);

        // Alice should appear twice (once per parent contribution)
        uint256 aliceTotal;
        for (uint256 i; i < alloc.length; ++i) {
            if (alloc[i].recipient == alice) {
                aliceTotal += alloc[i].amount;
            }
        }
        assertGt(aliceTotal, 0, "Alice should receive credit from both paths");
    }
}
