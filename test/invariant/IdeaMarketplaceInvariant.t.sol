// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/community/IdeaMarketplace.sol";

// ============ Mock Contracts ============

contract MockERC20Inv is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockDAGInv {
    mapping(address => bool) public excluded;
    function setExcluded(address a, bool v) external { excluded[a] = v; }
    function isReferralExcluded(address a) external view returns (bool) { return excluded[a]; }
}

// ============ Handler ============

contract IdeaMarketplaceHandler is Test {
    IdeaMarketplace public marketplace;
    MockERC20Inv public vibe;
    address public marketplaceOwner;

    // Actors
    address[5] public actors;
    uint256 public actorCount = 5;

    // Scorers (set by the main test)
    address[3] public scorerAddresses;

    // Ghost variables for accounting
    uint256 public totalIdeasSubmitted;
    uint256 public totalBountyFunded;
    uint256 public totalBountyDistributed;
    uint256 public totalCollateralDeposited;
    uint256 public totalCollateralReturned;
    uint256 public totalCollateralSlashed;
    uint256 public totalStakeDeposited;
    uint256 public totalStakeReturned;

    // Track idea IDs for iteration
    uint256[] public ideaIds;

    constructor(
        IdeaMarketplace _marketplace,
        MockERC20Inv _vibe,
        address _owner,
        address[5] memory _actors,
        address[3] memory _scorers
    ) {
        marketplace = _marketplace;
        vibe = _vibe;
        marketplaceOwner = _owner;
        actors = _actors;
        scorerAddresses = _scorers;
    }

    function _getActor(uint256 seed) internal view returns (address) {
        return actors[seed % actorCount];
    }

    function _getScorer(uint256 seed) internal view returns (address) {
        return scorerAddresses[seed % 3];
    }

    function getIdeaCount() external view returns (uint256) {
        return ideaIds.length;
    }

    function getIdeaIdAt(uint256 index) external view returns (uint256) {
        return ideaIds[index];
    }

    // ============ Handler: submitIdea ============

    function submitIdea(uint8 categoryRaw) public {
        address actor = _getActor(uint256(categoryRaw));
        IIdeaMarketplace.IdeaCategory category = IIdeaMarketplace.IdeaCategory(categoryRaw % 5);
        uint256 stake = marketplace.minIdeaStake();

        vm.prank(actor);
        try marketplace.submitIdea(
            "Test Idea",
            keccak256(abi.encodePacked("desc", totalIdeasSubmitted)),
            category
        ) returns (uint256 ideaId) {
            totalIdeasSubmitted++;
            totalStakeDeposited += stake;
            ideaIds.push(ideaId);
        } catch {}
    }

    // ============ Handler: scoreIdea ============

    function scoreIdea(uint256 ideaIdRaw, uint8 f, uint8 i, uint8 n) public {
        if (ideaIds.length == 0) return;
        uint256 ideaId = ideaIds[ideaIdRaw % ideaIds.length];

        // Bound scores to valid range 0-10
        f = uint8(bound(uint256(f), 0, 10));
        i = uint8(bound(uint256(i), 0, 10));
        n = uint8(bound(uint256(n), 0, 10));

        // Rotate through scorers based on scorer count for this idea
        uint256 currentCount = marketplace.getScorerCount(ideaId);
        if (currentCount >= 3) return; // All scorers have scored

        address scorer = scorerAddresses[currentCount];

        vm.prank(scorer);
        try marketplace.scoreIdea(ideaId, f, i, n) {
            // Score succeeded — check if idea got auto-rejected (stake returned)
            IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
            if (idea.status == IIdeaMarketplace.IdeaStatus.REJECTED) {
                totalStakeReturned += marketplace.minIdeaStake();
            }
        } catch {}
    }

    // ============ Handler: fundBounty ============

    function fundBounty(uint256 ideaIdRaw, uint256 amount) public {
        if (ideaIds.length == 0) return;
        uint256 ideaId = ideaIds[ideaIdRaw % ideaIds.length];
        amount = bound(amount, 1, 10_000e18);

        address actor = _getActor(ideaIdRaw);

        vm.prank(actor);
        try marketplace.fundBounty(ideaId, amount) {
            totalBountyFunded += amount;
        } catch {}
    }

    // ============ Handler: claimBounty ============

    function claimBounty(uint256 ideaIdRaw) public {
        if (ideaIds.length == 0) return;
        uint256 ideaId = ideaIds[ideaIdRaw % ideaIds.length];

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        if (idea.status != IIdeaMarketplace.IdeaStatus.OPEN) return;

        // Pick an actor that is NOT the author
        address claimer;
        for (uint256 j = 0; j < actorCount; j++) {
            if (actors[j] != idea.author) {
                claimer = actors[j];
                break;
            }
        }
        if (claimer == address(0)) return;

        uint256 collateral = (idea.bountyAmount * marketplace.builderCollateralBps()) / marketplace.BPS_PRECISION();

        vm.prank(claimer);
        try marketplace.claimBounty(ideaId) {
            totalCollateralDeposited += collateral;
        } catch {}
    }

    // ============ Handler: submitWork ============

    function submitWork(uint256 ideaIdRaw) public {
        if (ideaIds.length == 0) return;
        uint256 ideaId = ideaIds[ideaIdRaw % ideaIds.length];

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        if (idea.status != IIdeaMarketplace.IdeaStatus.CLAIMED &&
            idea.status != IIdeaMarketplace.IdeaStatus.IN_PROGRESS) return;
        if (idea.builder == address(0)) return;

        bytes32 proofHash = keccak256(abi.encodePacked("proof", ideaId));

        vm.prank(idea.builder);
        try marketplace.submitWork(ideaId, proofHash) {} catch {}
    }

    // ============ Handler: approveWork ============

    function approveWork(uint256 ideaIdRaw) public {
        if (ideaIds.length == 0) return;
        uint256 ideaId = ideaIds[ideaIdRaw % ideaIds.length];

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        if (idea.status != IIdeaMarketplace.IdeaStatus.REVIEW) return;

        uint256 bounty = idea.bountyAmount;
        uint256 collateral = marketplace.builderCollateral(ideaId);
        uint256 stake = marketplace.ideatorStake(ideaId);

        vm.prank(marketplaceOwner);
        try marketplace.approveWork(ideaId) {
            totalBountyDistributed += bounty;
            totalCollateralReturned += collateral;
            totalStakeReturned += stake;
        } catch {}
    }

    // ============ Handler: cancelClaim ============

    function cancelClaim(uint256 ideaIdRaw) public {
        if (ideaIds.length == 0) return;
        uint256 ideaId = ideaIds[ideaIdRaw % ideaIds.length];

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        if (idea.status != IIdeaMarketplace.IdeaStatus.CLAIMED &&
            idea.status != IIdeaMarketplace.IdeaStatus.IN_PROGRESS) return;
        if (idea.builder == address(0)) return;

        uint256 collateral = marketplace.builderCollateral(ideaId);

        vm.prank(idea.builder);
        try marketplace.cancelClaim(ideaId) {
            totalCollateralSlashed += collateral;
        } catch {}
    }

    // ============ Handler: reclaimExpired ============

    function reclaimExpired(uint256 ideaIdRaw) public {
        if (ideaIds.length == 0) return;
        uint256 ideaId = ideaIds[ideaIdRaw % ideaIds.length];

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        if (idea.status != IIdeaMarketplace.IdeaStatus.CLAIMED &&
            idea.status != IIdeaMarketplace.IdeaStatus.IN_PROGRESS) return;

        // Warp past deadline to make reclaim possible
        uint256 deadline = idea.claimedAt + marketplace.buildDeadline();
        if (block.timestamp <= deadline) {
            vm.warp(deadline + 1);
        }

        uint256 collateral = marketplace.builderCollateral(ideaId);

        address actor = _getActor(ideaIdRaw);
        vm.prank(actor);
        try marketplace.reclaimExpired(ideaId) {
            totalCollateralSlashed += collateral;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract IdeaMarketplaceInvariant is StdInvariant, Test {
    IdeaMarketplace public marketplace;
    IdeaMarketplace public impl;
    MockERC20Inv public vibe;
    MockDAGInv public dag;
    IdeaMarketplaceHandler public handler;

    address public treasury;
    address public owner;

    address[5] public actors;
    address[3] public scorerAddresses;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");

        // Deploy mocks
        vibe = new MockERC20Inv();
        dag = new MockDAGInv();

        // Deploy marketplace via UUPS proxy
        impl = new IdeaMarketplace();
        bytes memory initData = abi.encodeWithSelector(
            IdeaMarketplace.initialize.selector,
            address(vibe),
            address(dag),
            treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        marketplace = IdeaMarketplace(address(proxy));

        // Create actors
        actors[0] = makeAddr("actor0");
        actors[1] = makeAddr("actor1");
        actors[2] = makeAddr("actor2");
        actors[3] = makeAddr("actor3");
        actors[4] = makeAddr("actor4");

        // Create scorers (separate from actors to avoid SelfClaim conflicts)
        scorerAddresses[0] = makeAddr("scorer0");
        scorerAddresses[1] = makeAddr("scorer1");
        scorerAddresses[2] = makeAddr("scorer2");

        // Set up scorers in marketplace
        marketplace.setScorer(scorerAddresses[0], true);
        marketplace.setScorer(scorerAddresses[1], true);
        marketplace.setScorer(scorerAddresses[2], true);

        // Mint VIBE and approve for each actor
        for (uint256 i = 0; i < 5; i++) {
            vibe.mint(actors[i], 1_000_000e18);
            vm.prank(actors[i]);
            vibe.approve(address(marketplace), type(uint256).max);
        }

        // Mint VIBE and approve for each scorer (they may also interact)
        for (uint256 i = 0; i < 3; i++) {
            vibe.mint(scorerAddresses[i], 1_000_000e18);
            vm.prank(scorerAddresses[i]);
            vibe.approve(address(marketplace), type(uint256).max);
        }

        // Deploy handler
        handler = new IdeaMarketplaceHandler(
            marketplace,
            vibe,
            owner,
            actors,
            scorerAddresses
        );

        targetContract(address(handler));
    }

    // ============ Invariant 1: Total Ideas Match Counter ============

    function invariant_totalIdeasMatchCounter() public view {
        assertEq(
            marketplace.totalIdeas(),
            handler.totalIdeasSubmitted(),
            "INVARIANT: marketplace.totalIdeas() must equal handler.totalIdeasSubmitted"
        );
    }

    // ============ Invariant 2: Token Conservation ============

    function invariant_tokenConservation() public view {
        uint256 marketplaceBalance = vibe.balanceOf(address(marketplace));
        uint256 totalIn = handler.totalStakeDeposited()
            + handler.totalBountyFunded()
            + handler.totalCollateralDeposited();
        uint256 totalOut = handler.totalBountyDistributed()
            + handler.totalCollateralReturned()
            + handler.totalCollateralSlashed()
            + handler.totalStakeReturned();

        assertEq(
            marketplaceBalance,
            totalIn - totalOut,
            "INVARIANT: token conservation - marketplace balance must equal deposits minus withdrawals"
        );
    }

    // ============ Invariant 3: No Double Scoring ============

    function invariant_noDoubleScoring() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 50; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            uint256 scoredCount = 0;
            for (uint256 j = 0; j < 3; j++) {
                if (marketplace.hasScored(ideaId, scorerAddresses[j])) {
                    scoredCount++;
                }
            }
            assertLe(
                scoredCount,
                3,
                "INVARIANT: no scorer should have scored more than once per idea"
            );
            assertEq(
                scoredCount,
                marketplace.getScorerCount(ideaId),
                "INVARIANT: scored count must match getScorerCount"
            );
        }
    }

    // ============ Invariant 4: Completed Ideas Have Builder ============

    function invariant_completedIdeasHaveBuilder() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 50; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
            if (idea.status == IIdeaMarketplace.IdeaStatus.COMPLETED) {
                assertTrue(
                    idea.builder != address(0),
                    "INVARIANT: completed ideas must have a builder"
                );
            }
        }
    }

    // ============ Invariant 5: Completed Ideas Have Proof ============

    function invariant_completedIdeasHaveProof() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 50; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
            if (idea.status == IIdeaMarketplace.IdeaStatus.COMPLETED) {
                assertTrue(
                    idea.proofHash != bytes32(0),
                    "INVARIANT: completed ideas must have a proofHash"
                );
            }
        }
    }

    // ============ Invariant 6: Open Ideas Have No Builder ============

    function invariant_openIdeasHaveNoBuilder() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 50; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
            if (idea.status == IIdeaMarketplace.IdeaStatus.OPEN) {
                assertEq(
                    idea.builder,
                    address(0),
                    "INVARIANT: OPEN ideas must have builder == address(0)"
                );
            }
        }
    }

    // ============ Invariant 7: Scorer Count Bounded ============

    function invariant_scorersCount() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 50; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            assertLe(
                marketplace.getScorerCount(ideaId),
                3,
                "INVARIANT: getScorerCount must be <= number of authorized scorers"
            );
        }
    }

    // ============ Invariant 8: Rejected Ideas Have Stake Returned ============

    function invariant_rejectedIdeasStakeZero() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 50; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
            if (idea.status == IIdeaMarketplace.IdeaStatus.REJECTED) {
                assertEq(
                    marketplace.ideatorStake(ideaId),
                    0,
                    "INVARIANT: rejected ideas must have ideatorStake == 0 (returned)"
                );
            }
        }
    }

    // ============ Invariant 9: Completed Ideas Have Zero Collateral ============

    function invariant_completedIdeasCollateralZero() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 50; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
            if (idea.status == IIdeaMarketplace.IdeaStatus.COMPLETED) {
                assertEq(
                    marketplace.builderCollateral(ideaId),
                    0,
                    "INVARIANT: completed ideas must have builderCollateral == 0 (returned)"
                );
                assertEq(
                    marketplace.ideatorStake(ideaId),
                    0,
                    "INVARIANT: completed ideas must have ideatorStake == 0 (returned)"
                );
            }
        }
    }

    // ============ Invariant 10: Score Bounded ============

    function invariant_scoreBounded() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 50; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
            assertLe(
                idea.score,
                30,
                "INVARIANT: idea score (average) must be <= MAX_TOTAL_SCORE (30)"
            );
        }
    }
}
