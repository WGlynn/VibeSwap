// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/compliance/FederatedConsensus.sol";

contract FederatedConsensusFuzzTest is Test {
    FederatedConsensus public consensus;

    function setUp() public {
        FederatedConsensus impl = new FederatedConsensus();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, address(this), 2, 1 days)
        );
        consensus = FederatedConsensus(address(proxy));
    }

    /// @notice Authority count is always consistent
    function testFuzz_authorityCountConsistent(uint8 numAuthorities) public {
        numAuthorities = uint8(bound(numAuthorities, 1, 20));

        for (uint8 i = 0; i < numAuthorities; i++) {
            address auth = makeAddr(string(abi.encodePacked("auth", i)));
            consensus.addAuthority(auth, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        }

        assertEq(consensus.authorityCount(), numAuthorities);
    }

    /// @notice Approval threshold validation works correctly
    function testFuzz_thresholdValidation(uint256 threshold) public {
        threshold = bound(threshold, 0, 100);

        // Add 5 authorities
        for (uint8 i = 0; i < 5; i++) {
            address auth = makeAddr(string(abi.encodePacked("auth", i)));
            consensus.addAuthority(auth, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        }

        if (threshold == 0 || threshold > 5) {
            vm.expectRevert(FederatedConsensus.InvalidThreshold.selector);
        }
        consensus.setThreshold(threshold);
    }

    /// @notice Grace period is always stored correctly
    function testFuzz_gracePeriodStored(uint256 period) public {
        period = bound(period, 0, 365 days);
        consensus.setGracePeriod(period);
        assertEq(consensus.gracePeriod(), period);
    }

    /// @notice Proposal expiry is always stored correctly
    function testFuzz_proposalExpiryStored(uint256 expiry) public {
        expiry = bound(expiry, 0, 365 days);
        consensus.setProposalExpiry(expiry);
        assertEq(consensus.proposalExpiry(), expiry);
    }

    /// @notice Proposal count is monotonically increasing
    function testFuzz_proposalCountMonotonic(uint8 numProposals) public {
        numProposals = uint8(bound(numProposals, 1, 10));

        // Add an authority to create proposals
        address auth = makeAddr("auth");
        consensus.addAuthority(auth, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");

        for (uint8 i = 0; i < numProposals; i++) {
            vm.prank(auth);
            consensus.createProposal(
                keccak256(abi.encodePacked("case", i)),
                makeAddr("target"),
                100 ether,
                address(0),
                "test"
            );
        }

        assertEq(consensus.proposalCount(), numProposals);
    }

    /// @notice Vote tracking is correct across multiple authorities
    function testFuzz_voteTracking(bool vote1, bool vote2) public {
        address auth1 = makeAddr("auth1");
        address auth2 = makeAddr("auth2");
        address auth3 = makeAddr("auth3");
        consensus.addAuthority(auth1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        consensus.addAuthority(auth2, FederatedConsensus.AuthorityRole.LEGAL, "EU");
        consensus.addAuthority(auth3, FederatedConsensus.AuthorityRole.COURT, "GLOBAL");

        vm.prank(auth1);
        bytes32 proposalId = consensus.createProposal(keccak256("case"), makeAddr("target"), 100 ether, address(0), "test");

        vm.prank(auth1);
        consensus.vote(proposalId, vote1);
        vm.prank(auth2);
        consensus.vote(proposalId, vote2);

        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        uint256 expectedApprovals = (vote1 ? 1 : 0) + (vote2 ? 1 : 0);
        uint256 expectedRejections = (vote1 ? 0 : 1) + (vote2 ? 0 : 1);

        // Note: if 2 approvals, proposal status changes to APPROVED
        if (expectedApprovals >= 2) {
            assertEq(uint8(p.status), uint8(FederatedConsensus.ProposalStatus.APPROVED));
        }
        assertEq(p.approvalCount, expectedApprovals);
        assertEq(p.rejectionCount, expectedRejections);
    }
}
