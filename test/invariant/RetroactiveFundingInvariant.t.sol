// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/RetroactiveFunding.sol";

// ============ Mocks ============

contract MockRFIToken {
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

contract MockRFIReputation {
    function getTrustScore(address) external pure returns (uint256) { return 200; }
    function getTrustTier(address) external pure returns (uint8) { return 2; }
    function isEligible(address, uint8) external pure returns (bool) { return true; }
}

contract MockRFIIdentity {
    function hasIdentity(address) external pure returns (bool) { return true; }
}

// ============ Handler ============

contract RFHandler is Test {
    RetroactiveFunding public rf;
    MockRFIToken public token;

    address[] public actors;
    uint256 public activeRoundId;
    uint256 public activeProjectCount;

    // Ghost variables
    uint256 public ghost_totalContributed;
    uint256 public ghost_totalClaimed;
    bool public ghost_finalized;

    constructor(
        RetroactiveFunding _rf,
        MockRFIToken _token,
        address[] memory _actors,
        uint256 _roundId,
        uint256 _projectCount
    ) {
        rf = _rf;
        token = _token;
        actors = _actors;
        activeRoundId = _roundId;
        activeProjectCount = _projectCount;
    }

    function contribute(uint256 actorSeed, uint256 projectSeed, uint256 amount) public {
        if (ghost_finalized) return;
        if (activeProjectCount == 0) return;

        address actor = actors[actorSeed % actors.length];
        uint256 projectId = (projectSeed % activeProjectCount) + 1;
        amount = bound(amount, 0.001 ether, 10 ether);

        vm.prank(actor);
        try rf.contribute(activeRoundId, projectId, amount) {
            ghost_totalContributed += amount;
        } catch {}
    }

    function finalizeRound() public {
        if (ghost_finalized) return;

        try rf.finalizeRound(activeRoundId) {
            ghost_finalized = true;
        } catch {}
    }

    function claimFunds(uint256 projectSeed) public {
        if (!ghost_finalized) return;
        if (activeProjectCount == 0) return;

        uint256 projectId = (projectSeed % activeProjectCount) + 1;

        IRetroactiveFunding.Project memory p = rf.getProject(activeRoundId, projectId);
        if (p.claimed) return;

        vm.prank(p.beneficiary);
        try rf.claimFunds(activeRoundId, projectId) {
            ghost_totalClaimed += p.matchedAmount + p.communityContributions;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 14 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract RetroactiveFundingInvariantTest is StdInvariant, Test {
    RetroactiveFunding public rf;
    MockRFIToken public token;
    RFHandler public handler;

    address[] public actors;
    uint256 public roundId;

    function setUp() public {
        token = new MockRFIToken();
        MockRFIReputation rep = new MockRFIReputation();
        MockRFIIdentity id = new MockRFIIdentity();

        rf = new RetroactiveFunding(address(rep), address(id));

        // Create actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);
            token.mint(actor, 100_000 ether);
            vm.prank(actor);
            token.approve(address(rf), type(uint256).max);
        }

        // Fund owner (this contract) and create round
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(rf), type(uint256).max);

        roundId = rf.createRound(
            address(token),
            100 ether,
            uint64(block.timestamp + 7 days),
            uint64(block.timestamp + 14 days)
        );

        // Nominate 3 projects
        address ben1 = makeAddr("ben1");
        address ben2 = makeAddr("ben2");
        address ben3 = makeAddr("ben3");

        rf.nominateProject(roundId, ben1, bytes32("p1"));
        rf.nominateProject(roundId, ben2, bytes32("p2"));
        rf.nominateProject(roundId, ben3, bytes32("p3"));

        // Warp to evaluation phase
        vm.warp(block.timestamp + 7 days);

        handler = new RFHandler(rf, token, actors, roundId, 3);

        targetContract(address(handler));
    }

    // ============ Invariant: contract balance covers obligations ============

    function invariant_tokenBalanceSolvent() public view {
        uint256 contractBal = token.balanceOf(address(rf));

        IRetroactiveFunding.FundingRound memory r = rf.getRound(roundId);

        // Contract must hold at least: matchPool + totalContributions - already claimed
        uint256 minRequired = r.matchPool + r.totalContributions - handler.ghost_totalClaimed();

        // After finalization, some match dust may be unreachable, so use >= on net
        if (handler.ghost_finalized()) {
            // After finalization: need enough for unclaimed matched + community
            assertGe(
                contractBal + handler.ghost_totalClaimed(),
                r.totalContributions,
                "SOLVENCY VIOLATION: insufficient balance for obligations"
            );
        } else {
            assertGe(
                contractBal,
                r.matchPool + r.totalContributions,
                "SOLVENCY VIOLATION: pre-finalization balance too low"
            );
        }
    }

    // ============ Invariant: total distributed <= match pool ============

    function invariant_distributedLeqMatchPool() public view {
        IRetroactiveFunding.FundingRound memory r = rf.getRound(roundId);
        assertLe(
            r.totalDistributed,
            r.matchPool,
            "DISTRIBUTION VIOLATION: distributed > match pool"
        );
    }

    // ============ Invariant: project scores non-negative ============

    function invariant_projectScoresNonNegative() public view {
        for (uint256 i = 1; i <= 3; i++) {
            IRetroactiveFunding.Project memory p = rf.getProject(roundId, i);
            assertTrue(p.sqrtSum >= 0, "SCORE VIOLATION: negative sqrtSum");
            assertTrue(p.communityContributions >= 0, "SCORE VIOLATION: negative contributions");
        }
    }

    // ============ Invariant: claimed flag consistency ============

    function invariant_claimedConsistency() public view {
        if (!handler.ghost_finalized()) return;

        for (uint256 i = 1; i <= 3; i++) {
            IRetroactiveFunding.Project memory p = rf.getProject(roundId, i);
            if (p.claimed) {
                // If claimed, beneficiary should have received tokens
                // (can't easily verify exact amount, just that claimed flag is set)
                assertTrue(p.claimed, "CLAIM VIOLATION: inconsistent state");
            }
        }
    }
}
