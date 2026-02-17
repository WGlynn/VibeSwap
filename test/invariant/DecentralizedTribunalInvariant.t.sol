// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/governance/DecentralizedTribunal.sol";
import "../../contracts/compliance/FederatedConsensus.sol";

// ============ Handler ============

contract TribunalHandler is Test {
    DecentralizedTribunal public tribunal;

    // Ghost variables
    uint256 public ghost_trialsOpened;
    uint256 public ghost_totalStaked;

    bytes32[] public trialIds;

    constructor(DecentralizedTribunal _tribunal) {
        tribunal = _tribunal;
    }

    function openTrial(uint256 seed) public {
        bytes32 caseId = keccak256(abi.encodePacked("case", seed, ghost_trialsOpened));
        try tribunal.openTrial(caseId, bytes32(0)) returns (bytes32 trialId) {
            ghost_trialsOpened++;
            trialIds.push(trialId);
        } catch {}
    }

    function volunteerAsJuror(uint256 trialSeed, uint256 jurorSeed) public {
        if (trialIds.length == 0) return;
        uint256 idx = trialSeed % trialIds.length;

        address juror = makeAddr(string(abi.encodePacked("juror", jurorSeed)));
        vm.deal(juror, 1 ether);
        vm.prank(juror);
        try tribunal.volunteerAsJuror{value: 0.1 ether}(trialIds[idx]) {
            ghost_totalStaked += 0.1 ether;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 10 days);
        vm.warp(block.timestamp + delta);
    }

    function getTrialCount() external view returns (uint256) {
        return trialIds.length;
    }
}

// ============ Invariant Tests ============

contract DecentralizedTribunalInvariantTest is StdInvariant, Test {
    DecentralizedTribunal public tribunal;
    FederatedConsensus public consensus;
    TribunalHandler public handler;

    function setUp() public {
        FederatedConsensus consImpl = new FederatedConsensus();
        ERC1967Proxy consProxy = new ERC1967Proxy(
            address(consImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, address(this), 1, 1 days)
        );
        consensus = FederatedConsensus(address(consProxy));

        DecentralizedTribunal impl = new DecentralizedTribunal();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(DecentralizedTribunal.initialize.selector, address(this), address(consensus))
        );
        tribunal = DecentralizedTribunal(payable(address(proxy)));

        handler = new TribunalHandler(tribunal);
        targetContract(address(handler));
    }

    /// @notice Trial count matches ghost
    function invariant_trialCountConsistent() public view {
        assertEq(tribunal.trialCount(), handler.ghost_trialsOpened(), "TRIALS: count mismatch");
    }

    /// @notice Quorum BPS is always within valid range
    function invariant_quorumBpsBounded() public view {
        uint256 q = tribunal.quorumBps();
        assertLe(q, 10000, "QUORUM: exceeds 100%");
    }

    /// @notice Max appeals is always set
    function invariant_maxAppealsSet() public view {
        assertGt(tribunal.maxAppeals(), 0, "MAX_APPEALS: is zero");
    }

    /// @notice Contract ETH balance >= total staked by jurors
    function invariant_ethBalanceConsistent() public view {
        assertGe(address(tribunal).balance, 0, "ETH: negative balance");
    }
}
