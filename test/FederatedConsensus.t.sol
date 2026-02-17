// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/compliance/FederatedConsensus.sol";

contract FederatedConsensusTest is Test {
    FederatedConsensus public consensus;
    address public owner;
    address public authority1;
    address public authority2;
    address public authority3;

    function setUp() public {
        owner = address(this);
        authority1 = makeAddr("auth1");
        authority2 = makeAddr("auth2");
        authority3 = makeAddr("auth3");

        FederatedConsensus impl = new FederatedConsensus();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, owner, 2, 1 days)
        );
        consensus = FederatedConsensus(address(proxy));
    }

    // ============ Helpers ============

    function _addAuthorities() internal {
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        consensus.addAuthority(authority2, FederatedConsensus.AuthorityRole.LEGAL, "EU");
        consensus.addAuthority(authority3, FederatedConsensus.AuthorityRole.COURT, "GLOBAL");
    }

    function _createProposal() internal returns (bytes32) {
        _addAuthorities();
        vm.prank(authority1);
        return consensus.createProposal(
            keccak256("case1"),
            makeAddr("target"),
            100 ether,
            address(0),
            "test case"
        );
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(consensus.approvalThreshold(), 2);
        assertEq(consensus.gracePeriod(), 1 days);
        assertEq(consensus.proposalExpiry(), 30 days);
        assertEq(consensus.authorityCount(), 0);
    }

    // ============ Authority Management ============

    function test_addAuthority() public {
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");

        assertTrue(consensus.isActiveAuthority(authority1));
        assertEq(consensus.authorityCount(), 1);
    }

    function test_addAuthority_allRoles() public {
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        consensus.addAuthority(authority2, FederatedConsensus.AuthorityRole.ONCHAIN_TRIBUNAL, "GLOBAL");
        consensus.addAuthority(authority3, FederatedConsensus.AuthorityRole.ONCHAIN_REGULATOR, "GLOBAL");
        assertEq(consensus.authorityCount(), 3);
    }

    function test_addAuthority_zeroAddress() public {
        vm.expectRevert("Zero address");
        consensus.addAuthority(address(0), FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
    }

    function test_addAuthority_noneRole() public {
        vm.expectRevert("Invalid role");
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.NONE, "US");
    }

    function test_addAuthority_alreadyExists() public {
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");

        vm.expectRevert(FederatedConsensus.AuthorityAlreadyExists.selector);
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.LEGAL, "EU");
    }

    function test_addAuthority_onlyOwner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
    }

    function test_removeAuthority() public {
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        consensus.removeAuthority(authority1);

        assertFalse(consensus.isActiveAuthority(authority1));
        assertEq(consensus.authorityCount(), 0);
    }

    function test_removeAuthority_notActive() public {
        vm.expectRevert("Not active");
        consensus.removeAuthority(authority1);
    }

    // ============ Proposal Creation ============

    function test_createProposal() public {
        _addAuthorities();

        vm.prank(authority1);
        bytes32 proposalId = consensus.createProposal(
            keccak256("case1"),
            makeAddr("target"),
            100 ether,
            address(0),
            "test case"
        );

        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        assertEq(p.proposer, authority1);
        assertEq(p.amount, 100 ether);
        assertEq(uint8(p.status), uint8(FederatedConsensus.ProposalStatus.PENDING));
        assertEq(consensus.proposalCount(), 1);
    }

    function test_createProposal_byOwner() public {
        bytes32 proposalId = consensus.createProposal(
            keccak256("case1"),
            makeAddr("target"),
            100 ether,
            address(0),
            "owner created"
        );
        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        assertEq(p.proposer, owner);
    }

    function test_createProposal_byExecutor() public {
        address exec = makeAddr("executor");
        consensus.setExecutor(exec);

        vm.prank(exec);
        bytes32 proposalId = consensus.createProposal(
            keccak256("case1"),
            makeAddr("target"),
            100 ether,
            address(0),
            "executor created"
        );
        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        assertEq(p.proposer, exec);
    }

    function test_createProposal_unauthorizedReverts() public {
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(FederatedConsensus.NotActiveAuthority.selector);
        consensus.createProposal(keccak256("case1"), makeAddr("target"), 100 ether, address(0), "nope");
    }

    // ============ Voting ============

    function test_vote_approve() public {
        bytes32 proposalId = _createProposal();

        vm.prank(authority1);
        consensus.vote(proposalId, true);

        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        assertEq(p.approvalCount, 1);
        assertTrue(consensus.hasVoted(proposalId, authority1));
    }

    function test_vote_reject() public {
        bytes32 proposalId = _createProposal();

        vm.prank(authority1);
        consensus.vote(proposalId, false);

        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        assertEq(p.rejectionCount, 1);
    }

    function test_vote_reachesThreshold() public {
        bytes32 proposalId = _createProposal();

        vm.prank(authority1);
        consensus.vote(proposalId, true);

        vm.prank(authority2);
        consensus.vote(proposalId, true);

        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        assertEq(uint8(p.status), uint8(FederatedConsensus.ProposalStatus.APPROVED));
        assertGt(p.gracePeriodEnd, 0);
    }

    function test_vote_autoRejectWhenMathCertain() public {
        bytes32 proposalId = _createProposal();

        // 2 reject, 1 remaining can't reach threshold of 2
        vm.prank(authority1);
        consensus.vote(proposalId, false);
        vm.prank(authority2);
        consensus.vote(proposalId, false);

        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        assertEq(uint8(p.status), uint8(FederatedConsensus.ProposalStatus.REJECTED));
    }

    function test_vote_alreadyVoted() public {
        bytes32 proposalId = _createProposal();

        vm.prank(authority1);
        consensus.vote(proposalId, true);

        vm.prank(authority1);
        vm.expectRevert(FederatedConsensus.AlreadyVoted.selector);
        consensus.vote(proposalId, true);
    }

    function test_vote_notActiveAuthority() public {
        bytes32 proposalId = _createProposal();

        vm.prank(makeAddr("rando"));
        vm.expectRevert(FederatedConsensus.NotActiveAuthority.selector);
        consensus.vote(proposalId, true);
    }

    function test_vote_expired() public {
        bytes32 proposalId = _createProposal();

        vm.warp(block.timestamp + 31 days);
        vm.prank(authority1);
        vm.expectRevert(FederatedConsensus.ProposalExpiredError.selector);
        consensus.vote(proposalId, true);
    }

    // ============ Execution ============

    function test_isExecutable() public {
        bytes32 proposalId = _createProposal();

        vm.prank(authority1);
        consensus.vote(proposalId, true);
        vm.prank(authority2);
        consensus.vote(proposalId, true);

        assertFalse(consensus.isExecutable(proposalId)); // grace period active
        vm.warp(block.timestamp + 1 days + 1);
        assertTrue(consensus.isExecutable(proposalId));
    }

    function test_markExecuted() public {
        bytes32 proposalId = _createProposal();

        vm.prank(authority1);
        consensus.vote(proposalId, true);
        vm.prank(authority2);
        consensus.vote(proposalId, true);

        vm.warp(block.timestamp + 1 days + 1);
        consensus.markExecuted(proposalId);

        FederatedConsensus.Proposal memory p = consensus.getProposal(proposalId);
        assertEq(uint8(p.status), uint8(FederatedConsensus.ProposalStatus.EXECUTED));
    }

    function test_markExecuted_gracePeriodActive() public {
        bytes32 proposalId = _createProposal();

        vm.prank(authority1);
        consensus.vote(proposalId, true);
        vm.prank(authority2);
        consensus.vote(proposalId, true);

        vm.expectRevert(FederatedConsensus.GracePeriodActive.selector);
        consensus.markExecuted(proposalId);
    }

    function test_markExecuted_notApproved() public {
        bytes32 proposalId = _createProposal();

        vm.expectRevert(FederatedConsensus.ProposalNotApproved.selector);
        consensus.markExecuted(proposalId);
    }

    function test_markExecuted_byExecutor() public {
        address exec = makeAddr("executor");
        consensus.setExecutor(exec);

        bytes32 proposalId = _createProposal();
        vm.prank(authority1);
        consensus.vote(proposalId, true);
        vm.prank(authority2);
        consensus.vote(proposalId, true);
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(exec);
        consensus.markExecuted(proposalId);
    }

    function test_markExecuted_notExecutor() public {
        bytes32 proposalId = _createProposal();
        vm.prank(authority1);
        consensus.vote(proposalId, true);
        vm.prank(authority2);
        consensus.vote(proposalId, true);
        vm.warp(block.timestamp + 1 days + 1);

        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(FederatedConsensus.NotExecutor.selector);
        consensus.markExecuted(proposalId);
    }

    // ============ Admin ============

    function test_setThreshold() public {
        _addAuthorities();
        consensus.setThreshold(3);
        assertEq(consensus.approvalThreshold(), 3);
    }

    function test_setThreshold_invalid_zero() public {
        _addAuthorities();
        vm.expectRevert(FederatedConsensus.InvalidThreshold.selector);
        consensus.setThreshold(0);
    }

    function test_setThreshold_invalid_exceedsCount() public {
        _addAuthorities();
        vm.expectRevert(FederatedConsensus.InvalidThreshold.selector);
        consensus.setThreshold(4);
    }

    function test_setThreshold_needsMinAuthorities() public {
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        vm.expectRevert(FederatedConsensus.InvalidThreshold.selector);
        consensus.setThreshold(1);
    }

    function test_setExecutor() public {
        address exec = makeAddr("executor");
        consensus.setExecutor(exec);
        assertEq(consensus.executor(), exec);
    }

    function test_setGracePeriod() public {
        consensus.setGracePeriod(7 days);
        assertEq(consensus.gracePeriod(), 7 days);
    }

    function test_setProposalExpiry() public {
        consensus.setProposalExpiry(14 days);
        assertEq(consensus.proposalExpiry(), 14 days);
    }

    function test_admin_onlyOwner() public {
        address rando = makeAddr("rando");

        vm.prank(rando);
        vm.expectRevert();
        consensus.setGracePeriod(7 days);

        vm.prank(rando);
        vm.expectRevert();
        consensus.setProposalExpiry(14 days);

        vm.prank(rando);
        vm.expectRevert();
        consensus.setExecutor(rando);
    }

    // ============ View Functions ============

    function test_isActiveAuthority() public {
        assertFalse(consensus.isActiveAuthority(authority1));
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        assertTrue(consensus.isActiveAuthority(authority1));
        consensus.removeAuthority(authority1);
        assertFalse(consensus.isActiveAuthority(authority1));
    }
}
