// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/compliance/FederatedConsensus.sol";

// ============ Handler ============

contract ConsensusHandler is Test {
    FederatedConsensus public consensus;
    address public owner;

    // Ghost variables
    uint256 public ghost_authoritiesAdded;
    uint256 public ghost_authoritiesRemoved;
    uint256 public ghost_proposalsCreated;

    address[] public authorityList;

    constructor(FederatedConsensus _consensus, address _owner) {
        consensus = _consensus;
        owner = _owner;
    }

    function addAuthority(uint256 seed) public {
        address auth = makeAddr(string(abi.encodePacked("auth", seed, ghost_authoritiesAdded)));
        vm.prank(owner);
        try consensus.addAuthority(auth, FederatedConsensus.AuthorityRole.GOVERNMENT, "US") {
            ghost_authoritiesAdded++;
            authorityList.push(auth);
        } catch {}
    }

    function removeAuthority(uint256 seed) public {
        if (authorityList.length == 0) return;
        uint256 idx = seed % authorityList.length;

        vm.prank(owner);
        try consensus.removeAuthority(authorityList[idx]) {
            ghost_authoritiesRemoved++;
            // Swap and pop
            authorityList[idx] = authorityList[authorityList.length - 1];
            authorityList.pop();
        } catch {}
    }

    function createProposal(uint256 seed) public {
        if (authorityList.length == 0) return;

        uint256 idx = seed % authorityList.length;
        vm.prank(authorityList[idx]);
        try consensus.createProposal(
            keccak256(abi.encodePacked("case", seed)),
            makeAddr("target"),
            100 ether,
            address(0),
            "test"
        ) {
            ghost_proposalsCreated++;
        } catch {}
    }

    function getActiveAuthorityCount() external view returns (uint256) {
        return authorityList.length;
    }
}

// ============ Invariant Tests ============

contract FederatedConsensusInvariantTest is StdInvariant, Test {
    FederatedConsensus public consensus;
    ConsensusHandler public handler;

    function setUp() public {
        FederatedConsensus impl = new FederatedConsensus();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, address(this), 2, 1 days)
        );
        consensus = FederatedConsensus(address(proxy));

        handler = new ConsensusHandler(consensus, address(this));
        targetContract(address(handler));
    }

    /// @notice Authority count matches ghost (added - removed)
    function invariant_authorityCountConsistent() public view {
        assertEq(
            consensus.authorityCount(),
            handler.ghost_authoritiesAdded() - handler.ghost_authoritiesRemoved(),
            "AUTHORITIES: count mismatch"
        );
    }

    /// @notice Proposal count matches ghost
    function invariant_proposalCountConsistent() public view {
        assertEq(
            consensus.proposalCount(),
            handler.ghost_proposalsCreated(),
            "PROPOSALS: count mismatch"
        );
    }

    /// @notice Grace period is always set (initialized to 1 day)
    function invariant_gracePeriodSet() public view {
        assertGt(consensus.gracePeriod(), 0, "GRACE: is zero");
    }

    /// @notice Approval threshold is always positive
    function invariant_thresholdPositive() public view {
        assertGt(consensus.approvalThreshold(), 0, "THRESHOLD: is zero");
    }
}
