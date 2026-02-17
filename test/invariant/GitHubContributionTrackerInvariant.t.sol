// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/identity/GitHubContributionTracker.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "../../contracts/identity/RewardLedger.sol";
import "../../contracts/identity/interfaces/IGitHubContributionTracker.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockGCTIToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract GCTHandler is Test {
    GitHubContributionTracker public tracker;

    uint256 public relayerPk;
    address public relayer;
    address[] public contributors;

    // Ghost variables
    uint256 public ghost_totalContributions;
    uint256 public ghost_totalValue;
    uint256 public ghost_duplicateAttempts;
    uint256 public ghost_rootChanges;
    bytes32 public ghost_lastRoot;

    // Track unique timestamps per contributor to avoid replay
    mapping(address => uint256) public nextTimestamp;

    bytes32 constant REPO_HASH = keccak256("vibeswap/vibeswap");
    bytes32 constant EVIDENCE_HASH = keccak256("ipfs:QmTest");

    constructor(
        GitHubContributionTracker _tracker,
        uint256 _relayerPk,
        address _relayer,
        address[] memory _contributors
    ) {
        tracker = _tracker;
        relayerPk = _relayerPk;
        relayer = _relayer;
        contributors = _contributors;
        ghost_lastRoot = tracker.getContributionRoot();

        // Initialize timestamps
        for (uint256 i = 0; i < _contributors.length; i++) {
            nextTimestamp[_contributors[i]] = 1;
        }
    }

    /// @notice Record a contribution for a random contributor with a random type
    function recordContribution(uint256 contributorSeed, uint8 typeSeed, uint256 valueSeed) external {
        // Pick contributor
        uint256 idx = contributorSeed % contributors.length;
        address contributor = contributors[idx];

        // Pick type
        IGitHubContributionTracker.ContributionType contribType =
            IGitHubContributionTracker.ContributionType(typeSeed % 4);

        // Bound value
        uint256 value = bound(valueSeed, 1, 1e18);

        // Use unique timestamp
        uint256 ts = nextTimestamp[contributor];
        nextTimestamp[contributor] = ts + 1;

        IGitHubContributionTracker.GitHubContribution memory c =
            IGitHubContributionTracker.GitHubContribution({
                contributor: contributor,
                repoHash: REPO_HASH,
                commitHash: keccak256(abi.encodePacked("commit", contributor, ts, value)),
                contribType: contribType,
                value: value,
                timestamp: ts,
                evidenceHash: EVIDENCE_HASH
            });

        bytes32 structHash = keccak256(abi.encode(
            tracker.CONTRIBUTION_TYPEHASH(),
            c.contributor, c.repoHash, c.commitHash,
            uint8(c.contribType), c.value, c.timestamp, c.evidenceHash
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", tracker.domainSeparator(), structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(relayerPk, digest);

        tracker.recordContribution(c, abi.encodePacked(r, s, v));

        ghost_totalContributions++;
        ghost_totalValue += value;

        bytes32 newRoot = tracker.getContributionRoot();
        if (newRoot != ghost_lastRoot) {
            ghost_rootChanges++;
            ghost_lastRoot = newRoot;
        }
    }

    /// @notice Attempt to replay a contribution (should always revert)
    function attemptReplay(uint256 contributorSeed) external {
        uint256 idx = contributorSeed % contributors.length;
        address contributor = contributors[idx];

        // Only attempt if we've recorded at least one for this contributor
        uint256 ts = nextTimestamp[contributor];
        if (ts <= 1) return;

        // Try to replay timestamp 1 (the first one recorded)
        IGitHubContributionTracker.GitHubContribution memory c =
            IGitHubContributionTracker.GitHubContribution({
                contributor: contributor,
                repoHash: REPO_HASH,
                commitHash: keccak256(abi.encodePacked("commit", contributor, uint256(1), uint256(100))),
                contribType: IGitHubContributionTracker.ContributionType.COMMIT,
                value: 100,
                timestamp: 1,
                evidenceHash: EVIDENCE_HASH
            });

        bytes32 structHash = keccak256(abi.encode(
            tracker.CONTRIBUTION_TYPEHASH(),
            c.contributor, c.repoHash, c.commitHash,
            uint8(c.contribType), c.value, c.timestamp, c.evidenceHash
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", tracker.domainSeparator(), structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(relayerPk, digest);

        try tracker.recordContribution(c, abi.encodePacked(r, s, v)) {
            // Should not reach here — replay should revert
            revert("Replay succeeded - invariant broken");
        } catch {
            ghost_duplicateAttempts++;
        }
    }
}

// ============ Invariant Test ============

contract GitHubContributionTrackerInvariantTest is StdInvariant, Test {
    GitHubContributionTracker public tracker;
    ContributionDAG public dag;
    RewardLedger public ledger;
    MockGCTIToken public token;
    GCTHandler public handler;

    uint256 public relayerPk;
    address public relayer;
    address public alice;
    address public bob;
    address public carol;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        relayerPk = 0xA11CE;
        relayer = vm.addr(relayerPk);

        // Deploy stack
        token = new MockGCTIToken();
        dag = new ContributionDAG(address(0));
        dag.addFounder(alice);

        ledger = new RewardLedger(address(token), address(dag));
        token.mint(address(ledger), 100_000_000e18);

        tracker = new GitHubContributionTracker(address(dag), address(ledger));
        tracker.setAuthorizedRelayer(relayer, true);
        tracker.bindGitHubAccount(alice, keccak256("github:alice"));
        tracker.bindGitHubAccount(bob, keccak256("github:bob"));
        tracker.bindGitHubAccount(carol, keccak256("github:carol"));
        ledger.setAuthorizedCaller(address(tracker), true);

        // Setup trust chain: alice(founder) <-> bob <-> carol
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));
        vm.prank(bob);
        dag.addVouch(carol, bytes32(0));
        vm.prank(carol);
        dag.addVouch(bob, bytes32(0));
        dag.recalculateTrustScores();

        // Build handler
        address[] memory contributors = new address[](3);
        contributors[0] = alice;
        contributors[1] = bob;
        contributors[2] = carol;

        handler = new GCTHandler(tracker, relayerPk, relayer, contributors);

        // Target only the handler
        targetContract(address(handler));
    }

    // ============ Invariants ============

    /// @notice Contribution count always matches ghost counter
    function invariant_contributionCountMatchesGhost() public view {
        assertEq(
            tracker.getContributionCount(),
            handler.ghost_totalContributions(),
            "Contribution count mismatch"
        );
    }

    /// @notice Total value across all contributors matches ghost total
    function invariant_totalValueMatchesGhost() public view {
        uint256 onChainTotal = 0;
        (uint256 aliceCount, uint256 aliceValue) = tracker.getContributorStats(alice);
        (uint256 bobCount, uint256 bobValue) = tracker.getContributorStats(bob);
        (uint256 carolCount, uint256 carolValue) = tracker.getContributorStats(carol);

        onChainTotal = aliceValue + bobValue + carolValue;
        uint256 onChainCount = aliceCount + bobCount + carolCount;

        assertEq(onChainCount, handler.ghost_totalContributions(), "Count mismatch");
        assertEq(onChainTotal, handler.ghost_totalValue(), "Value mismatch");
    }

    /// @notice Root changes exactly once per contribution
    function invariant_rootChangesPerContribution() public view {
        assertEq(
            handler.ghost_rootChanges(),
            handler.ghost_totalContributions(),
            "Root should change exactly once per contribution"
        );
    }

    /// @notice Merkle root is never zero after at least one contribution
    function invariant_rootNeverZeroAfterInsert() public view {
        if (handler.ghost_totalContributions() > 0) {
            assertTrue(
                tracker.getContributionRoot() != bytes32(0),
                "Root should never be zero after insert"
            );
        }
    }

    /// @notice Current root is always in the known root history
    function invariant_currentRootAlwaysKnown() public view {
        assertTrue(
            tracker.isKnownRoot(tracker.getContributionRoot()),
            "Current root must always be in history"
        );
    }
}
