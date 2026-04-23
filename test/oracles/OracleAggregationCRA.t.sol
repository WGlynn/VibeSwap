// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/oracles/OracleAggregationCRA.sol";
import "../../contracts/oracles/interfaces/IOracleAggregationCRA.sol";
import "../../contracts/oracles/TruePriceOracle.sol";
import "../../contracts/oracles/interfaces/ITruePriceOracle.sol";

/**
 * @title OracleAggregationCRA tests — C39 FAT-AUDIT-2
 * @notice Commit-reveal batch oracle aggregation regression suite.
 *         Scaffold + initialize tests in this commit; phase + median +
 *         slash tests land in subsequent commits per cadence-restore.
 */
contract OracleAggregationCRATest is Test {
    OracleAggregationCRA public agg;

    // Local mirror of the interface event so `vm.expectEmit` can match it under solc 0.8.20
    // (interface-qualified event access `IOracleAggregationCRA.IssuerSlashed` requires ≥0.8.21).
    event IssuerSlashed(uint256 indexed batchId, address indexed issuer, uint256 amount, string reason);

    address public owner;
    address public issuer1;
    address public issuer2;
    address public issuer3;
    address public stubRegistry;
    address public stubTPO;

    function setUp() public {
        owner = address(this);
        issuer1 = makeAddr("issuer1");
        issuer2 = makeAddr("issuer2");
        issuer3 = makeAddr("issuer3");
        // Stub registry + TPO addresses — real wire-in tests come later.
        stubRegistry = makeAddr("registry");
        stubTPO = makeAddr("tpo");

        OracleAggregationCRA impl = new OracleAggregationCRA();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(OracleAggregationCRA.initialize.selector, stubRegistry, stubTPO)
        );
        agg = OracleAggregationCRA(address(proxy));
    }

    // ============ Initialization ============

    function test_initialize_setsRegistryAndTPO() public view {
        assertEq(agg.issuerRegistry(), stubRegistry);
        assertEq(agg.truePriceOracle(), stubTPO);
    }

    function test_initialize_opensFirstBatch() public view {
        assertEq(agg.getCurrentBatchId(), 1);
        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(1);
        assertEq(info.batchId, 1);
        assertTrue(info.commitDeadline > block.timestamp);
        assertTrue(info.revealDeadline > info.commitDeadline);
        assertEq(uint256(info.phase), uint256(IOracleAggregationCRA.BatchPhase.COMMIT));
    }

    function test_initialize_revertOnZeroRegistry() public {
        OracleAggregationCRA impl = new OracleAggregationCRA();
        vm.expectRevert(bytes("Invalid registry"));
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(OracleAggregationCRA.initialize.selector, address(0), stubTPO)
        );
    }

    function test_initialize_revertOnZeroTPO() public {
        OracleAggregationCRA impl = new OracleAggregationCRA();
        vm.expectRevert(bytes("Invalid TPO"));
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(OracleAggregationCRA.initialize.selector, stubRegistry, address(0))
        );
    }

    // ============ Commit Phase ============

    function _commitHash(uint256 price, bytes32 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(price, nonce));
    }

    function test_commitPrice_happy() public {
        bytes32 ch = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1);
        agg.commitPrice(ch);

        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(1);
        assertEq(info.commitCount, 1);
    }

    function test_commitPrice_revertZeroHash() public {
        vm.prank(issuer1);
        vm.expectRevert(bytes("Zero hash"));
        agg.commitPrice(bytes32(0));
    }

    function test_commitPrice_revertDoubleCommit() public {
        bytes32 ch = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1);
        agg.commitPrice(ch);
        vm.prank(issuer1);
        vm.expectRevert(bytes("Already committed"));
        agg.commitPrice(ch);
    }

    function test_commitPrice_autoAdvancesBatchAfterDeadline() public {
        bytes32 ch1 = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1);
        agg.commitPrice(ch1);
        assertEq(agg.getCurrentBatchId(), 1);

        // Skip past commit + reveal deadlines for batch 1
        vm.warp(block.timestamp + 100);

        bytes32 ch2 = _commitHash(1600e18, bytes32(uint256(2)));
        vm.prank(issuer2);
        agg.commitPrice(ch2);
        assertEq(agg.getCurrentBatchId(), 2);

        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(2);
        assertEq(info.commitCount, 1);
    }

    // ============ Reveal Phase ============

    function _commitAndAdvanceToReveal(address[] memory issuers, uint256[] memory prices, bytes32[] memory nonces) internal {
        for (uint256 i = 0; i < issuers.length; i++) {
            vm.prank(issuers[i]);
            agg.commitPrice(_commitHash(prices[i], nonces[i]));
        }
        // Advance past commit deadline into reveal window
        vm.warp(block.timestamp + agg.COMMIT_PHASE_DURATION() + 1);
    }

    function test_revealPrice_happy() public {
        address[] memory issuers = new address[](1);
        uint256[] memory prices = new uint256[](1);
        bytes32[] memory nonces = new bytes32[](1);
        issuers[0] = issuer1;
        prices[0] = 1500e18;
        nonces[0] = bytes32(uint256(42));

        _commitAndAdvanceToReveal(issuers, prices, nonces);

        vm.prank(issuer1);
        agg.revealPrice(1, 1500e18, bytes32(uint256(42)));

        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(1);
        assertEq(info.revealCount, 1);
        assertEq(uint256(info.phase), uint256(IOracleAggregationCRA.BatchPhase.REVEAL));
    }

    function test_revealPrice_revertHashMismatch() public {
        address[] memory issuers = new address[](1);
        uint256[] memory prices = new uint256[](1);
        bytes32[] memory nonces = new bytes32[](1);
        issuers[0] = issuer1;
        prices[0] = 1500e18;
        nonces[0] = bytes32(uint256(42));

        _commitAndAdvanceToReveal(issuers, prices, nonces);

        // Wrong price — hash won't match
        vm.prank(issuer1);
        vm.expectRevert(bytes("Hash mismatch"));
        agg.revealPrice(1, 9999e18, bytes32(uint256(42)));
    }

    function test_revealPrice_revertStillInCommitPhase() public {
        bytes32 ch = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1);
        agg.commitPrice(ch);

        // No time advance — still in commit phase
        vm.prank(issuer1);
        vm.expectRevert(bytes("Still in commit phase"));
        agg.revealPrice(1, 1500e18, bytes32(uint256(1)));
    }

    function test_revealPrice_revertDoubleReveal() public {
        address[] memory issuers = new address[](1);
        uint256[] memory prices = new uint256[](1);
        bytes32[] memory nonces = new bytes32[](1);
        issuers[0] = issuer1;
        prices[0] = 1500e18;
        nonces[0] = bytes32(uint256(42));

        _commitAndAdvanceToReveal(issuers, prices, nonces);

        vm.prank(issuer1);
        agg.revealPrice(1, 1500e18, bytes32(uint256(42)));

        vm.prank(issuer1);
        vm.expectRevert(bytes("Already revealed"));
        agg.revealPrice(1, 1500e18, bytes32(uint256(42)));
    }

    // ============ Settle Phase ============

    function _threeCommitsAndReveals(uint256[3] memory prices) internal {
        bytes32[3] memory nonces = [bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3))];
        address[3] memory issuers = [issuer1, issuer2, issuer3];

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(issuers[i]);
            agg.commitPrice(_commitHash(prices[i], nonces[i]));
        }
        vm.warp(block.timestamp + agg.COMMIT_PHASE_DURATION() + 1);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(issuers[i]);
            agg.revealPrice(1, prices[i], nonces[i]);
        }
        // Advance past reveal deadline
        vm.warp(block.timestamp + agg.REVEAL_PHASE_DURATION() + 1);
    }

    function test_settleBatch_medianOfThreeOdd() public {
        // Prices: 1400, 1500, 1600 — median = 1500
        _threeCommitsAndReveals([uint256(1400e18), uint256(1500e18), uint256(1600e18)]);
        uint256 median = agg.settleBatch(1);
        assertEq(median, 1500e18);
    }

    function test_settleBatch_medianRobustToOutlier() public {
        // One extreme outlier: 1500, 1510, 999999 — median = 1510 (not skewed by outlier)
        _threeCommitsAndReveals([uint256(1500e18), uint256(1510e18), uint256(999999e18)]);
        uint256 median = agg.settleBatch(1);
        assertEq(median, 1510e18, "median should resist extreme outlier");
    }

    function test_settleBatch_revertInsufficientReveals() public {
        // Only 1 commit + reveal — below MIN_REVEALS_FOR_SETTLEMENT (3)
        address[] memory issuers = new address[](1);
        uint256[] memory prices = new uint256[](1);
        bytes32[] memory nonces = new bytes32[](1);
        issuers[0] = issuer1;
        prices[0] = 1500e18;
        nonces[0] = bytes32(uint256(42));

        _commitAndAdvanceToReveal(issuers, prices, nonces);
        vm.prank(issuer1);
        agg.revealPrice(1, 1500e18, bytes32(uint256(42)));
        vm.warp(block.timestamp + agg.REVEAL_PHASE_DURATION() + 1);

        vm.expectRevert(bytes("Insufficient reveals"));
        agg.settleBatch(1);
    }

    function test_settleBatch_revertRevealNotYetEnded() public {
        _threeCommitsAndReveals([uint256(1400e18), uint256(1500e18), uint256(1600e18)]);
        // Rewind to before reveal deadline to simulate premature settle attempt
        // (not really possible since _threeCommitsAndReveals advances past it —
        // so skip this in favor of direct setup)

        // Fresh state: commits only, no warp past reveal deadline
        // Setup again without the final warp
        address[] memory issuers = new address[](3);
        uint256[] memory prices = new uint256[](3);
        bytes32[] memory nonces = new bytes32[](3);
        issuers[0] = makeAddr("alt1"); prices[0] = 100; nonces[0] = bytes32(uint256(11));
        issuers[1] = makeAddr("alt2"); prices[1] = 200; nonces[1] = bytes32(uint256(12));
        issuers[2] = makeAddr("alt3"); prices[2] = 300; nonces[2] = bytes32(uint256(13));
        _commitAndAdvanceToReveal(issuers, prices, nonces);
        // Reveals land in reveal phase — do NOT warp past reveal deadline.
        // Read getCurrentBatchId OUTSIDE the prank — vm.prank applies to the next
        // external call, and getCurrentBatchId would consume it instead of revealPrice.
        uint256 currentBatch = agg.getCurrentBatchId();
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(issuers[i]);
            agg.revealPrice(currentBatch, prices[i], nonces[i]);
        }

        vm.expectRevert(bytes("Reveal not yet ended"));
        agg.settleBatch(currentBatch);
    }

    // ============ Slash ============

    function test_slashNonRevealer_happy() public {
        // Two commits, only one reveals → other is slashable
        bytes32 ch1 = _commitHash(1500e18, bytes32(uint256(1)));
        bytes32 ch2 = _commitHash(1600e18, bytes32(uint256(2)));
        vm.prank(issuer1); agg.commitPrice(ch1);
        vm.prank(issuer2); agg.commitPrice(ch2);
        vm.warp(block.timestamp + agg.COMMIT_PHASE_DURATION() + 1);
        vm.prank(issuer1); agg.revealPrice(1, 1500e18, bytes32(uint256(1)));
        vm.warp(block.timestamp + agg.REVEAL_PHASE_DURATION() + 1);

        // issuer2 did not reveal — slashable
        vm.prank(issuer3);
        vm.expectEmit(true, true, false, true);
        emit IssuerSlashed(1, issuer2, 0, "non-reveal");
        agg.slashNonRevealer(1, issuer2);
    }

    function test_slashNonRevealer_revertIfRevealed() public {
        bytes32 ch = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1); agg.commitPrice(ch);
        vm.warp(block.timestamp + agg.COMMIT_PHASE_DURATION() + 1);
        vm.prank(issuer1); agg.revealPrice(1, 1500e18, bytes32(uint256(1)));
        vm.warp(block.timestamp + agg.REVEAL_PHASE_DURATION() + 1);

        vm.expectRevert(bytes("Issuer revealed - not slashable"));
        agg.slashNonRevealer(1, issuer1);
    }

    function test_slashNonRevealer_revertIfNoCommit() public {
        // No commits at all
        vm.warp(block.timestamp + agg.COMMIT_PHASE_DURATION() + agg.REVEAL_PHASE_DURATION() + 1);
        vm.expectRevert(bytes("Issuer did not commit"));
        agg.slashNonRevealer(1, issuer1);
    }

    function test_slashNonRevealer_revertIfRevealNotEnded() public {
        bytes32 ch = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1); agg.commitPrice(ch);
        // Don't advance past reveal deadline
        vm.expectRevert(bytes("Reveal not yet ended"));
        agg.slashNonRevealer(1, issuer1);
    }

    // ============ TPO Wire-In (C39) ============

    function test_tpoWireIn_pullFromAggregator() public {
        // Stand up a real TPO and wire it to the aggregator
        TruePriceOracle tpoImpl = new TruePriceOracle();
        ERC1967Proxy tpoProxy = new ERC1967Proxy(
            address(tpoImpl),
            abi.encodeWithSelector(TruePriceOracle.initialize.selector, address(this))
        );
        TruePriceOracle tpo = TruePriceOracle(address(tpoProxy));
        tpo.setOracleAggregator(address(agg));

        // Run a full batch on the aggregator: median should be 1500e18
        _threeCommitsAndReveals([uint256(1400e18), uint256(1500e18), uint256(1600e18)]);
        uint256 median = agg.settleBatch(1);
        assertEq(median, 1500e18, "aggregator median sanity");

        // Pull median into TPO for some poolId
        bytes32 poolId = keccak256("ETH/USD");
        tpo.pullFromAggregator(poolId, 1);

        // TPO now reflects the aggregated median
        ITruePriceOracle.TruePriceData memory data = tpo.getTruePrice(poolId);
        assertEq(data.price, 1500e18);
        assertEq(uint256(data.regime), uint256(ITruePriceOracle.RegimeType.NORMAL));
        assertEq(data.manipulationProb, 0);
        assertGt(data.confidence, 0);
    }

    function test_tpoWireIn_revertOnAggregatorUnset() public {
        TruePriceOracle tpoImpl = new TruePriceOracle();
        ERC1967Proxy tpoProxy = new ERC1967Proxy(
            address(tpoImpl),
            abi.encodeWithSelector(TruePriceOracle.initialize.selector, address(this))
        );
        TruePriceOracle tpo = TruePriceOracle(address(tpoProxy));
        // Don't call setOracleAggregator — should revert
        vm.expectRevert(bytes("Aggregator unset"));
        tpo.pullFromAggregator(keccak256("ETH/USD"), 1);
    }

    function test_tpoWireIn_revertOnUnsettledBatch() public {
        TruePriceOracle tpoImpl = new TruePriceOracle();
        ERC1967Proxy tpoProxy = new ERC1967Proxy(
            address(tpoImpl),
            abi.encodeWithSelector(TruePriceOracle.initialize.selector, address(this))
        );
        TruePriceOracle tpo = TruePriceOracle(address(tpoProxy));
        tpo.setOracleAggregator(address(agg));

        // Aggregator's batch 1 is open / not settled
        vm.expectRevert(bytes("Batch not settled"));
        tpo.pullFromAggregator(keccak256("ETH/USD"), 1);
    }
}
