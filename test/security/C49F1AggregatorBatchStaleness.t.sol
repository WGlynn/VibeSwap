// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/oracles/OracleAggregationCRA.sol";
import "../../contracts/oracles/interfaces/IOracleAggregationCRA.sol";
import "../../contracts/oracles/TruePriceOracle.sol";
import "../../contracts/oracles/interfaces/ITruePriceOracle.sol";

/**
 * @title C49-F1 — Aggregator batch staleness regression
 * @notice Reproduces the stale-batch attack against TruePriceOracle.pullFromAggregator
 *         and verifies the C49-F1 fix (revealDeadline-anchored MAX_STALENESS gate)
 *         closes it.
 *
 *         Attack: an adversary lets a SETTLED batch sit unpulled for an extended
 *         period (days/weeks). When market conditions shift in their favor,
 *         they pull that ancient median into TPO. The pre-fix replay guard
 *         only forbids RE-pulling an already-pulled batch — it never required
 *         the batch itself to be recent. After the fix, the contract enforces
 *         `block.timestamp <= batch.revealDeadline + MAX_STALENESS`, blocking
 *         the attack.
 */
contract C49F1AggregatorBatchStalenessTest is Test {
    OracleAggregationCRA public agg;
    TruePriceOracle public tpo;

    address public owner;
    address public issuer1;
    address public issuer2;
    address public issuer3;
    address public stubRegistry;

    bytes32 internal constant POOL_ID = keccak256("ETH/USD");

    function setUp() public {
        owner = address(this);
        issuer1 = makeAddr("issuer1");
        issuer2 = makeAddr("issuer2");
        issuer3 = makeAddr("issuer3");
        stubRegistry = makeAddr("registry");

        // Stand up TPO first (aggregator points at it; address must be non-zero)
        TruePriceOracle tpoImpl = new TruePriceOracle();
        ERC1967Proxy tpoProxy = new ERC1967Proxy(
            address(tpoImpl),
            abi.encodeWithSelector(TruePriceOracle.initialize.selector, owner)
        );
        tpo = TruePriceOracle(address(tpoProxy));

        OracleAggregationCRA aggImpl = new OracleAggregationCRA();
        ERC1967Proxy aggProxy = new ERC1967Proxy(
            address(aggImpl),
            abi.encodeWithSelector(OracleAggregationCRA.initialize.selector, stubRegistry, address(tpo))
        );
        agg = OracleAggregationCRA(address(aggProxy));

        tpo.setOracleAggregator(address(agg));
    }

    // ============ Helpers ============

    function _commitHash(uint256 price, bytes32 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(price, nonce));
    }

    /// @dev Run a full commit/reveal/settle cycle on the current open batch
    ///      using three issuers with the supplied prices, returning the
    ///      settled batchId.
    function _settleBatchWithPrices(uint256[3] memory prices) internal returns (uint256 batchId) {
        bytes32[3] memory nonces = [bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3))];
        address[3] memory issuers = [issuer1, issuer2, issuer3];

        batchId = agg.getCurrentBatchId();

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(issuers[i]);
            agg.commitPrice(_commitHash(prices[i], nonces[i]));
        }
        vm.warp(block.timestamp + agg.COMMIT_PHASE_DURATION() + 1);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(issuers[i]);
            agg.revealPrice(batchId, prices[i], nonces[i]);
        }
        vm.warp(block.timestamp + agg.REVEAL_PHASE_DURATION() + 1);
        agg.settleBatch(batchId);
    }

    // ============ Attack reproduction (now blocked) ============

    /// @notice Demonstrates that the stale-batch attack is rejected post-fix.
    ///         Settle a batch, let MAX_STALENESS + safety buffer elapse, then
    ///         attempt to pull. The fix should revert with "Batch too stale".
    function test_C49F1_rejectsStaleSettledBatch() public {
        // Settle a batch with median = 1500e18
        uint256 batchId = _settleBatchWithPrices([uint256(1400e18), uint256(1500e18), uint256(1600e18)]);

        // Skip ahead well past TPO MAX_STALENESS (5 minutes). 1 hour is comfortably outside.
        vm.warp(block.timestamp + 1 hours);

        // Attacker tries to pull this ancient batch into TPO. Pre-fix this would
        // have succeeded and stamped the price at the current block. Post-fix
        // the C49-F1 guard rejects.
        vm.expectRevert(bytes("Batch too stale"));
        tpo.pullFromAggregator(POOL_ID, batchId);

        // Sanity: TPO never received any data for this pool.
        vm.expectRevert(); // NoPriceData
        tpo.getTruePrice(POOL_ID);
    }

    /// @notice Boundary: pulling exactly at revealDeadline + MAX_STALENESS
    ///         must still succeed (gate is inclusive, off-by-one regression).
    function test_C49F1_acceptsAtMaxStalenessBoundary() public {
        uint256 batchId = _settleBatchWithPrices([uint256(1400e18), uint256(1500e18), uint256(1600e18)]);

        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(batchId);
        // Move to exactly revealDeadline + MAX_STALENESS
        uint256 boundary = info.revealDeadline + tpo.MAX_STALENESS();
        vm.warp(boundary);

        tpo.pullFromAggregator(POOL_ID, batchId);

        ITruePriceOracle.TruePriceData memory data = tpo.getTruePrice(POOL_ID);
        assertEq(data.price, 1500e18, "boundary pull must succeed");
    }

    /// @notice One-second past the boundary must revert (gate is tight).
    function test_C49F1_rejectsOneSecondPastBoundary() public {
        uint256 batchId = _settleBatchWithPrices([uint256(1400e18), uint256(1500e18), uint256(1600e18)]);

        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(batchId);
        uint256 boundary = info.revealDeadline + tpo.MAX_STALENESS();
        vm.warp(boundary + 1);

        vm.expectRevert(bytes("Batch too stale"));
        tpo.pullFromAggregator(POOL_ID, batchId);
    }

    /// @notice Happy path still works: pull immediately after settlement.
    function test_C49F1_freshBatchPullsCleanly() public {
        uint256 batchId = _settleBatchWithPrices([uint256(1400e18), uint256(1500e18), uint256(1600e18)]);

        // No additional warp — pull right away.
        tpo.pullFromAggregator(POOL_ID, batchId);

        ITruePriceOracle.TruePriceData memory data = tpo.getTruePrice(POOL_ID);
        assertEq(data.price, 1500e18);
        assertEq(uint256(data.regime), uint256(ITruePriceOracle.RegimeType.NORMAL));
    }

    /// @notice The replay guard remains active: pulling the same batch twice
    ///         must still revert (defense-in-depth — fix doesn't regress C39 wire-in).
    function test_C49F1_replayGuardStillActive() public {
        uint256 batchId = _settleBatchWithPrices([uint256(1400e18), uint256(1500e18), uint256(1600e18)]);
        tpo.pullFromAggregator(POOL_ID, batchId);

        // Second pull in the same block trips the existing "Stale or replay" guard
        // (newData.timestamp == truePrices[poolId].timestamp).
        vm.expectRevert(bytes("Stale or replay"));
        tpo.pullFromAggregator(POOL_ID, batchId);
    }
}
