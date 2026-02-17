// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/governance/DisputeResolver.sol";
import "../../contracts/governance/DecentralizedTribunal.sol";
import "../../contracts/compliance/FederatedConsensus.sol";

contract DisputeResolverFuzzTest is Test {
    DisputeResolver public resolver;
    FederatedConsensus public consensus;
    address public claimant;
    address public respondent;

    function setUp() public {
        claimant = makeAddr("claimant");
        respondent = makeAddr("respondent");
        vm.deal(claimant, 100 ether);
        vm.deal(respondent, 100 ether);

        FederatedConsensus consImpl = new FederatedConsensus();
        ERC1967Proxy consProxy = new ERC1967Proxy(
            address(consImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, address(this), 2, 1 days)
        );
        consensus = FederatedConsensus(address(consProxy));

        DisputeResolver impl = new DisputeResolver();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(DisputeResolver.initialize.selector, address(this), address(consensus))
        );
        resolver = DisputeResolver(payable(address(proxy)));

        consensus.addAuthority(address(resolver), FederatedConsensus.AuthorityRole.ONCHAIN_ARBITRATION, "GLOBAL");
    }

    /// @notice Filing fee is always enforced
    function testFuzz_filingFeeEnforced(uint256 fee) public {
        fee = bound(fee, 0, 1 ether);

        if (fee < 0.01 ether) {
            vm.prank(claimant);
            vm.expectRevert(DisputeResolver.InsufficientFee.selector);
            resolver.fileDispute{value: fee}(
                keccak256("case"), bytes32(0), respondent, 10 ether, address(0), "claim", "Qm"
            );
        } else {
            vm.prank(claimant);
            bytes32 disputeId = resolver.fileDispute{value: fee}(
                keccak256("case"), bytes32(0), respondent, 10 ether, address(0), "claim", "Qm"
            );
            DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
            assertEq(d.filingFee, fee);
        }
    }

    /// @notice Arbitrator stake minimum is enforced
    function testFuzz_arbitratorStakeEnforced(uint256 stake) public {
        stake = bound(stake, 0, 10 ether);
        address arb = makeAddr("arb");
        vm.deal(arb, 10 ether);

        if (stake < 1 ether) {
            vm.prank(arb);
            vm.expectRevert(DisputeResolver.InsufficientStake.selector);
            resolver.registerArbitrator{value: stake}();
        } else {
            vm.prank(arb);
            resolver.registerArbitrator{value: stake}();
            DisputeResolver.Arbitrator memory a = resolver.getArbitrator(arb);
            assertTrue(a.registered);
            assertEq(a.stake, 1 ether); // Always stores minArbitratorStake
            // Excess refunded
            assertEq(arb.balance, 10 ether - 1 ether);
        }
    }

    /// @notice Dispute count is monotonically increasing
    function testFuzz_disputeCountIncreases(uint8 numDisputes) public {
        numDisputes = uint8(bound(numDisputes, 1, 10));

        for (uint8 i = 0; i < numDisputes; i++) {
            vm.prank(claimant);
            resolver.fileDispute{value: 0.01 ether}(
                keccak256(abi.encodePacked("case", i)), bytes32(0), respondent, 10 ether, address(0), "claim", "Qm"
            );
        }

        assertEq(resolver.disputeCount(), numDisputes);
    }

    /// @notice Arbitrator reputation calculation is correct
    function testFuzz_arbitratorReputation(uint8 correct, uint8 total) public {
        total = uint8(bound(total, 1, 20));
        // Ensure arbitrator won't be suspended mid-loop (suspended when casesHandled>=5 && rep<5000)
        // Correct rulings come first, so need enough to stay above 50% throughout processing
        // Minimum: correct >= ceil(total/2) when total >= 5, otherwise correct can be 0
        if (total >= 5) {
            correct = uint8(bound(correct, (total + 1) / 2, total));
        } else {
            correct = uint8(bound(correct, 0, total));
        }

        address arb = makeAddr("arb");
        vm.deal(arb, 100 ether);
        vm.prank(arb);
        resolver.registerArbitrator{value: 1 ether}();

        // Simulate cases via recordAppealOutcome
        for (uint8 i = 0; i < total; i++) {
            // File, advance, resolve each dispute
            vm.prank(claimant);
            bytes32 did = resolver.fileDispute{value: 0.01 ether}(
                keccak256(abi.encodePacked("repcase", i)), bytes32(0), respondent, 10 ether, address(0), "claim", "Qm"
            );
            vm.warp(block.timestamp + 8 days);
            resolver.advanceToArbitration(did);
            vm.prank(arb);
            resolver.resolveDispute(did, DisputeResolver.Resolution.CLAIMANT_WINS);

            bool overturned = i >= correct;
            resolver.recordAppealOutcome(did, overturned);
        }

        DisputeResolver.Arbitrator memory a = resolver.getArbitrator(arb);
        assertEq(a.casesHandled, total);
        assertEq(a.correctRulings, correct);
        if (total > 0) {
            assertEq(a.reputation, (uint256(correct) * 10000) / total);
        }
    }

    /// @notice Response deadline is always responseDuration from filing
    function testFuzz_responseDeadline(uint256 filingTime) public {
        filingTime = bound(filingTime, 1, 365 days);
        vm.warp(filingTime);

        vm.prank(claimant);
        bytes32 did = resolver.fileDispute{value: 0.01 ether}(
            keccak256("deadline_test"), bytes32(0), respondent, 10 ether, address(0), "claim", "Qm"
        );

        DisputeResolver.Dispute memory d = resolver.getDispute(did);
        assertEq(d.phaseDeadline, uint64(filingTime + resolver.responseDuration()));
    }

    /// @notice Escalation fee is always 2x filing fee
    function testFuzz_escalationFeeIs2x(uint256 filingFeeVal) public {
        filingFeeVal = bound(filingFeeVal, 0.001 ether, 1 ether);
        resolver.setFees(filingFeeVal, 1 ether);

        // Register arb, file, advance, resolve
        address arb = makeAddr("arb");
        vm.deal(arb, 100 ether);
        vm.prank(arb);
        resolver.registerArbitrator{value: 1 ether}();

        vm.prank(claimant);
        bytes32 did = resolver.fileDispute{value: filingFeeVal}(
            keccak256("esc"), bytes32(0), respondent, 10 ether, address(0), "claim", "Qm"
        );
        vm.warp(block.timestamp + 8 days);
        resolver.advanceToArbitration(did);
        vm.prank(arb);
        resolver.resolveDispute(did, DisputeResolver.Resolution.RESPONDENT_WINS);

        // Escalation with exactly 2x filing fee should work
        vm.prank(claimant);
        resolver.escalateToTribunal{value: filingFeeVal * 2}(did);

        DisputeResolver.Dispute memory d = resolver.getDispute(did);
        assertEq(uint8(d.phase), uint8(DisputeResolver.DisputePhase.APPEALED));
    }
}
