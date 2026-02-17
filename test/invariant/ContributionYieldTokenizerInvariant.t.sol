// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/identity/ContributionYieldTokenizer.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockCYTIToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract CYTHandler is Test {
    ContributionYieldTokenizer public tokenizer;
    MockCYTIToken public rewardToken;

    address public alice;
    address public bob;
    address public carol;

    // Ghost variables
    uint256 public ghost_ideasCreated;
    uint256 public ghost_totalFunded;
    uint256 public ghost_streamsCreated;
    uint256 public ghost_milestones;
    uint256 public ghost_staleChecks;
    uint256 public ghost_claims;

    // Track ideas and streams
    uint256[] public ideaIds;
    uint256[] public streamIds;

    constructor(
        ContributionYieldTokenizer _tokenizer,
        MockCYTIToken _rewardToken,
        address _alice,
        address _bob,
        address _carol
    ) {
        tokenizer = _tokenizer;
        rewardToken = _rewardToken;
        alice = _alice;
        bob = _bob;
        carol = _carol;
    }

    function createIdea(uint256 fundingSeed) public {
        uint256 funding = bound(fundingSeed, 0, 1_000_000e18);

        vm.prank(alice);
        try tokenizer.createIdea(bytes32(uint256(ghost_ideasCreated)), funding) returns (uint256 ideaId) {
            ghost_ideasCreated++;
            ghost_totalFunded += funding;
            ideaIds.push(ideaId);
        } catch {}
    }

    function fundIdea(uint256 indexSeed, uint256 amountSeed) public {
        if (ideaIds.length == 0) return;
        uint256 index = indexSeed % ideaIds.length;
        uint256 amount = bound(amountSeed, 1e18, 100_000e18);

        vm.prank(carol);
        try tokenizer.fundIdea(ideaIds[index], amount) {
            ghost_totalFunded += amount;
        } catch {}
    }

    function proposeExecution(uint256 indexSeed) public {
        if (ideaIds.length == 0) return;
        uint256 index = indexSeed % ideaIds.length;

        vm.prank(bob);
        try tokenizer.proposeExecution(ideaIds[index]) returns (uint256 streamId) {
            ghost_streamsCreated++;
            streamIds.push(streamId);
        } catch {}
    }

    function reportMilestone(uint256 streamSeed) public {
        if (streamIds.length == 0) return;
        uint256 index = streamSeed % streamIds.length;
        uint256 streamId = streamIds[index];

        vm.prank(bob);
        try tokenizer.reportMilestone(streamId, bytes32("milestone")) {
            ghost_milestones++;
        } catch {}
    }

    function claimStream(uint256 streamSeed) public {
        if (streamIds.length == 0) return;
        uint256 index = streamSeed % streamIds.length;
        uint256 streamId = streamIds[index];

        vm.prank(bob);
        try tokenizer.claimStream(streamId) {
            ghost_claims++;
        } catch {}
    }

    function advanceTime(uint256 timeSeed) public {
        uint256 delta = bound(timeSeed, 1 hours, 30 days);
        vm.warp(block.timestamp + delta);
    }

    function checkStale(uint256 streamSeed) public {
        if (streamIds.length == 0) return;
        uint256 index = streamSeed % streamIds.length;
        uint256 streamId = streamIds[index];

        try tokenizer.checkStale(streamId) {
            ghost_staleChecks++;
        } catch {}
    }

    function getIdeaCount() external view returns (uint256) {
        return ideaIds.length;
    }

    function getStreamCount() external view returns (uint256) {
        return streamIds.length;
    }

    function getIdeaIdAt(uint256 index) external view returns (uint256) {
        return ideaIds[index];
    }

    function getStreamIdAt(uint256 index) external view returns (uint256) {
        return streamIds[index];
    }
}

// ============ Invariant Tests ============

contract ContributionYieldTokenizerInvariantTest is StdInvariant, Test {
    ContributionYieldTokenizer public tokenizer;
    MockCYTIToken public rewardToken;
    CYTHandler public handler;

    address public alice;
    address public bob;
    address public carol;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        rewardToken = new MockCYTIToken();

        tokenizer = new ContributionYieldTokenizer(
            address(rewardToken),
            address(0)
        );

        // Fund users with reward tokens
        rewardToken.mint(alice, 100_000_000e18);
        rewardToken.mint(carol, 100_000_000e18);
        vm.prank(alice);
        rewardToken.approve(address(tokenizer), type(uint256).max);
        vm.prank(carol);
        rewardToken.approve(address(tokenizer), type(uint256).max);

        handler = new CYTHandler(tokenizer, rewardToken, alice, bob, carol);
        targetContract(address(handler));
    }

    // ============ Invariant: nextIdeaId always > number of ideas created ============

    function invariant_ideaIdMonotonic() public view {
        assertEq(
            tokenizer.nextIdeaId(),
            handler.ghost_ideasCreated() + 1,
            "INVARIANT: nextIdeaId must equal ideasCreated + 1"
        );
    }

    // ============ Invariant: nextStreamId always > number of streams created ============

    function invariant_streamIdMonotonic() public view {
        assertEq(
            tokenizer.nextStreamId(),
            handler.ghost_streamsCreated() + 1,
            "INVARIANT: nextStreamId must equal streamsCreated + 1"
        );
    }

    // ============ Invariant: totalFunding always >= totalStreamed for each idea ============

    function invariant_fundingCoversStreamed() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 20; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);

            uint256[] memory streamIdsForIdea = tokenizer.getIdeaStreams(ideaId);
            uint256 totalStreamed = 0;
            for (uint256 j = 0; j < streamIdsForIdea.length; j++) {
                IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamIdsForIdea[j]);
                totalStreamed += stream.totalStreamed;
            }

            assertGe(
                idea.totalFunding,
                totalStreamed,
                "INVARIANT: totalFunding must be >= totalStreamed for idea"
            );
        }
    }

    // ============ Invariant: streams per idea never exceed MAX_STREAMS_PER_IDEA ============

    function invariant_streamsPerIdeaBounded() public view {
        uint256 ideaCount = handler.getIdeaCount();
        for (uint256 i = 0; i < ideaCount && i < 20; i++) {
            uint256 ideaId = handler.getIdeaIdAt(i);
            assertLe(
                tokenizer.getIdeaStreamCount(ideaId),
                10,
                "INVARIANT: streams per idea must be <= 10"
            );
        }
    }

    // ============ Invariant: stream status transitions are valid ============

    function invariant_streamStatusValid() public view {
        uint256 streamCount = handler.getStreamCount();
        for (uint256 i = 0; i < streamCount && i < 30; i++) {
            uint256 streamId = handler.getStreamIdAt(i);
            IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);

            // Status must be one of the valid enum values
            uint8 status = uint8(stream.status);
            assertTrue(status <= 3, "INVARIANT: stream status must be valid enum");

            // Completed/stalled streams must have rate = 0
            if (stream.status == IContributionYieldTokenizer.StreamStatus.COMPLETED ||
                stream.status == IContributionYieldTokenizer.StreamStatus.STALLED) {
                assertEq(stream.streamRate, 0, "INVARIANT: completed/stalled stream rate must be 0");
            }
        }
    }

    // ============ Invariant: reward token conservation ============

    function invariant_rewardTokenConservation() public view {
        uint256 total = rewardToken.balanceOf(address(tokenizer)) +
            rewardToken.balanceOf(alice) +
            rewardToken.balanceOf(bob) +
            rewardToken.balanceOf(carol);

        // Total should not exceed initial mint (200M)
        assertLe(total, 200_000_000e18, "INVARIANT: tokens must not be created from thin air");
    }
}
