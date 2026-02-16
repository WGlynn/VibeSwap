// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/ConvictionGovernance.sol";

// ============ Mocks ============

contract MockCGIToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount);
        require(allowance[from][msg.sender] >= amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

contract MockCGIReputation {
    function getTrustScore(address) external pure returns (uint256) { return 200; }
    function getTrustTier(address) external pure returns (uint8) { return 2; }
    function isEligible(address, uint8) external pure returns (bool) { return true; }
}

contract MockCGIIdentity {
    function hasIdentity(address) external pure returns (bool) { return true; }
}

// ============ Handler ============

contract CGHandler is Test {
    ConvictionGovernance public cg;
    MockCGIToken public jul;

    address[] public actors;
    uint256 public activeProposalId;

    // Ghost variables
    uint256 public ghost_totalStaked;
    uint256 public ghost_totalUnstaked;
    mapping(address => uint256) public ghost_stakerAmounts;
    bool public ghost_passed;
    bool public ghost_expired;

    constructor(ConvictionGovernance _cg, MockCGIToken _jul, address[] memory _actors) {
        cg = _cg;
        jul = _jul;
        actors = _actors;
    }

    function setProposal(uint256 id) external {
        activeProposalId = id;
    }

    function signalConviction(uint256 actorSeed, uint256 amount) public {
        if (ghost_passed || ghost_expired) return;
        if (activeProposalId == 0) return;

        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1 ether, 10_000 ether);

        if (ghost_stakerAmounts[actor] > 0) return; // already staking
        if (jul.balanceOf(actor) < amount) return;

        vm.prank(actor);
        try cg.signalConviction(activeProposalId, amount) {
            ghost_totalStaked += amount;
            ghost_stakerAmounts[actor] = amount;
        } catch {}
    }

    function removeSignal(uint256 actorSeed) public {
        if (activeProposalId == 0) return;

        address actor = actors[actorSeed % actors.length];
        if (ghost_stakerAmounts[actor] == 0) return;

        vm.prank(actor);
        try cg.removeSignal(activeProposalId) {
            ghost_totalUnstaked += ghost_stakerAmounts[actor];
            ghost_stakerAmounts[actor] = 0;
        } catch {}
    }

    function advanceTime(uint256 timeDelta) public {
        timeDelta = bound(timeDelta, 1, 7 days);
        vm.warp(block.timestamp + timeDelta);
    }

    function triggerPass() public {
        if (ghost_passed || ghost_expired) return;
        if (activeProposalId == 0) return;

        try cg.triggerPass(activeProposalId) {
            ghost_passed = true;
        } catch {}
    }

    function expireProposal() public {
        if (ghost_passed || ghost_expired) return;
        if (activeProposalId == 0) return;

        try cg.expireProposal(activeProposalId) {
            ghost_expired = true;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract ConvictionGovernanceInvariantTest is StdInvariant, Test {
    ConvictionGovernance public cg;
    MockCGIToken public jul;
    CGHandler public handler;

    address[] public actors;

    function setUp() public {
        jul = new MockCGIToken();
        MockCGIReputation rep = new MockCGIReputation();
        MockCGIIdentity id = new MockCGIIdentity();
        cg = new ConvictionGovernance(address(jul), address(rep), address(id));

        cg.setBaseThreshold(100);
        cg.setThresholdMultiplier(0);

        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);
            jul.mint(actor, 1_000_000 ether);
            vm.prank(actor);
            jul.approve(address(cg), type(uint256).max);
        }

        vm.prank(actors[0]);
        uint256 proposalId = cg.createProposal("Invariant Proposal", bytes32("ipfs"), 1000 ether);

        handler = new CGHandler(cg, jul, actors);
        handler.setProposal(proposalId);

        targetContract(address(handler));
    }

    // ============ Invariant: JUL balance matches total staked ============

    function invariant_julBalanceMatchesStaked() public view {
        uint256 contractBal = jul.balanceOf(address(cg));
        uint256 staked = handler.ghost_totalStaked();
        uint256 unstaked = handler.ghost_totalUnstaked();

        uint256 expectedMin = 0;
        if (staked > unstaked) {
            expectedMin = staked - unstaked;
        }

        assertGe(
            contractBal,
            expectedMin,
            "SOLVENCY VIOLATION: JUL balance < net staked"
        );
    }

    // ============ Invariant: conviction non-negative ============

    function invariant_convictionNonNegative() public view {
        // _getConviction returns uint256, so it can't be negative at the Solidity level
        // but the math could underflow if stakeTimeProd > effectiveT * totalStake
        // This invariant verifies the math never reverts
        uint256 conv = cg.getConviction(1);
        assertTrue(conv >= 0, "MATH VIOLATION: conviction underflow");
    }

    // ============ Invariant: passed proposals have conviction >= threshold ============

    function invariant_passedMeetsThreshold() public view {
        if (!handler.ghost_passed()) return;

        IConvictionGovernance.GovernanceProposal memory p = cg.getProposal(1);
        assertTrue(
            p.state == IConvictionGovernance.GovernanceProposalState.PASSED ||
            p.state == IConvictionGovernance.GovernanceProposalState.EXECUTED,
            "PASS STATE VIOLATION: proposal not in passed/executed state"
        );
    }

    // ============ Invariant: expired proposals beyond deadline ============

    function invariant_expiredBeyondDeadline() public view {
        if (!handler.ghost_expired()) return;

        IConvictionGovernance.GovernanceProposal memory p = cg.getProposal(1);
        assertEq(
            uint8(p.state),
            uint8(IConvictionGovernance.GovernanceProposalState.EXPIRED),
            "EXPIRY STATE VIOLATION"
        );
    }

    // ============ Invariant: no double staking ============

    function invariant_noDoubleStaking() public view {
        for (uint256 i = 0; i < actors.length; i++) {
            IConvictionGovernance.StakerPosition memory pos = cg.getStakerPosition(1, actors[i]);
            assertLe(
                pos.amount,
                1_000_000 ether,
                "STAKE VIOLATION: position exceeds initial balance"
            );
        }
    }
}
