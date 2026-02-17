// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/GitHubContributionTracker.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "../../contracts/identity/RewardLedger.sol";
import "../../contracts/identity/interfaces/IGitHubContributionTracker.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract FuzzMockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract GitHubContributionTrackerFuzz is Test {
    GitHubContributionTracker public tracker;
    ContributionDAG public dag;
    RewardLedger public ledger;
    FuzzMockToken public token;

    uint256 public relayerPk;
    address public relayer;
    address public alice;

    bytes32 constant REPO_HASH = keccak256("vibeswap/vibeswap");
    bytes32 constant EVIDENCE_HASH = keccak256("ipfs:QmTest");

    function setUp() public {
        alice = makeAddr("alice");
        relayerPk = 0xA11CE;
        relayer = vm.addr(relayerPk);

        token = new FuzzMockToken();
        dag = new ContributionDAG(address(0));
        dag.addFounder(alice);

        ledger = new RewardLedger(address(token), address(dag));
        token.mint(address(ledger), 100_000_000e18);

        tracker = new GitHubContributionTracker(address(dag), address(ledger));
        tracker.setAuthorizedRelayer(relayer, true);
        tracker.bindGitHubAccount(alice, keccak256("github:alice"));
        ledger.setAuthorizedCaller(address(tracker), true);

        // Recalculate trust for alice
        dag.recalculateTrustScores();
    }

    // ============ Helpers ============

    function _signAndRecord(
        address contributor,
        IGitHubContributionTracker.ContributionType contribType,
        uint256 value,
        uint256 timestamp
    ) internal {
        IGitHubContributionTracker.GitHubContribution memory c =
            IGitHubContributionTracker.GitHubContribution({
                contributor: contributor,
                repoHash: REPO_HASH,
                commitHash: keccak256(abi.encodePacked("commit", contributor, timestamp, value)),
                contribType: contribType,
                value: value,
                timestamp: timestamp,
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
    }

    // ============ Fuzz: Sequential Contributions ============

    /// @notice N sequential contributions all recorded, count matches, values accumulate
    function testFuzz_sequentialContributions(uint8 n) public {
        // Bound to reasonable range
        uint256 count = bound(uint256(n), 1, 50);

        uint256 totalExpected = 0;
        for (uint256 i = 0; i < count; i++) {
            uint256 value = 100 + i;
            _signAndRecord(
                alice,
                IGitHubContributionTracker.ContributionType.COMMIT,
                value,
                i + 1 // unique timestamps
            );
            totalExpected += value;
        }

        assertEq(tracker.getContributionCount(), count);
        (uint256 statCount, uint256 statValue) = tracker.getContributorStats(alice);
        assertEq(statCount, count);
        assertEq(statValue, totalExpected);
    }

    // ============ Fuzz: Root Changes on Every Insert ============

    /// @notice Every insert produces a unique root
    function testFuzz_rootChangesEveryInsert(uint8 n) public {
        uint256 count = bound(uint256(n), 2, 30);

        bytes32 prevRoot = tracker.getContributionRoot();
        for (uint256 i = 0; i < count; i++) {
            _signAndRecord(
                alice,
                IGitHubContributionTracker.ContributionType.COMMIT,
                100,
                i + 1
            );
            bytes32 newRoot = tracker.getContributionRoot();
            assertTrue(newRoot != prevRoot, "Root must change on each insert");
            prevRoot = newRoot;
        }
    }

    // ============ Fuzz: Root History Ring Buffer ============

    /// @notice After > ROOT_HISTORY_SIZE inserts, oldest root is evicted but recent are kept
    function testFuzz_rootHistoryRingBuffer(uint8 extra) public {
        uint256 extraInserts = bound(uint256(extra), 1, 20);
        uint256 historySize = 30; // ROOT_HISTORY_SIZE

        // Record initial root (empty tree)
        bytes32 emptyRoot = tracker.getContributionRoot();

        // Fill history + extra
        bytes32[] memory roots = new bytes32[](historySize + extraInserts);
        for (uint256 i = 0; i < historySize + extraInserts; i++) {
            _signAndRecord(
                alice,
                IGitHubContributionTracker.ContributionType.COMMIT,
                100,
                i + 1
            );
            roots[i] = tracker.getContributionRoot();
        }

        // Empty root should be evicted
        assertFalse(tracker.isKnownRoot(emptyRoot), "Empty root should be evicted");

        // Recent roots should still be known
        bytes32 latestRoot = tracker.getContributionRoot();
        assertTrue(tracker.isKnownRoot(latestRoot), "Latest root must be known");
    }

    // ============ Fuzz: Replay Protection ============

    /// @notice Duplicate events with same contributor+repo+commit+type+timestamp always revert
    function testFuzz_replayProtection(uint256 timestamp) public {
        timestamp = bound(timestamp, 1, type(uint64).max);

        IGitHubContributionTracker.GitHubContribution memory c =
            IGitHubContributionTracker.GitHubContribution({
                contributor: alice,
                repoHash: REPO_HASH,
                commitHash: keccak256(abi.encodePacked("fuzzCommit", timestamp)),
                contribType: IGitHubContributionTracker.ContributionType.COMMIT,
                value: 100,
                timestamp: timestamp,
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
        bytes memory sig = abi.encodePacked(r, s, v);

        // First submission succeeds
        tracker.recordContribution(c, sig);

        // Second submission reverts
        vm.expectRevert(IGitHubContributionTracker.DuplicateEvent.selector);
        tracker.recordContribution(c, sig);
    }

    // ============ Fuzz: Contribution Value Accumulation ============

    /// @notice Total value always equals sum of individual contributions
    function testFuzz_valueAccumulation(uint64[5] memory values) public {
        uint256 expectedTotal = 0;

        for (uint256 i = 0; i < 5; i++) {
            uint256 value = bound(uint256(values[i]), 1, 1e18);
            _signAndRecord(
                alice,
                IGitHubContributionTracker.ContributionType.COMMIT,
                value,
                i + 1
            );
            expectedTotal += value;
        }

        (, uint256 totalValue) = tracker.getContributorStats(alice);
        assertEq(totalValue, expectedTotal, "Total value must equal sum of contributions");
    }

    // ============ Fuzz: Contribution Types ============

    /// @notice All contribution types are recordable
    function testFuzz_allContributionTypes(uint8 typeIdx) public {
        typeIdx = uint8(bound(uint256(typeIdx), 0, 3));
        IGitHubContributionTracker.ContributionType contribType =
            IGitHubContributionTracker.ContributionType(typeIdx);

        _signAndRecord(alice, contribType, 100, block.timestamp);

        assertEq(tracker.getContributionCount(), 1);
    }

    // ============ Fuzz: Unique Commit Hashes ============

    /// @notice Different commit hashes always produce different event hashes (no collision)
    function testFuzz_uniqueCommitHashes(bytes32 hash1, bytes32 hash2) public {
        vm.assume(hash1 != hash2);

        IGitHubContributionTracker.GitHubContribution memory c1 =
            IGitHubContributionTracker.GitHubContribution({
                contributor: alice,
                repoHash: REPO_HASH,
                commitHash: hash1,
                contribType: IGitHubContributionTracker.ContributionType.COMMIT,
                value: 100,
                timestamp: 1,
                evidenceHash: EVIDENCE_HASH
            });

        IGitHubContributionTracker.GitHubContribution memory c2 =
            IGitHubContributionTracker.GitHubContribution({
                contributor: alice,
                repoHash: REPO_HASH,
                commitHash: hash2,
                contribType: IGitHubContributionTracker.ContributionType.COMMIT,
                value: 100,
                timestamp: 1,
                evidenceHash: EVIDENCE_HASH
            });

        bytes32 structHash1 = keccak256(abi.encode(
            tracker.CONTRIBUTION_TYPEHASH(),
            c1.contributor, c1.repoHash, c1.commitHash,
            uint8(c1.contribType), c1.value, c1.timestamp, c1.evidenceHash
        ));
        bytes32 structHash2 = keccak256(abi.encode(
            tracker.CONTRIBUTION_TYPEHASH(),
            c2.contributor, c2.repoHash, c2.commitHash,
            uint8(c2.contribType), c2.value, c2.timestamp, c2.evidenceHash
        ));
        bytes32 digest1 = keccak256(abi.encodePacked("\x19\x01", tracker.domainSeparator(), structHash1));
        bytes32 digest2 = keccak256(abi.encodePacked("\x19\x01", tracker.domainSeparator(), structHash2));

        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(relayerPk, digest1);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(relayerPk, digest2);

        // Both should succeed (different commit hashes = different events)
        tracker.recordContribution(c1, abi.encodePacked(r1, s1, v1));
        tracker.recordContribution(c2, abi.encodePacked(r2, s2, v2));

        assertEq(tracker.getContributionCount(), 2);
    }
}
